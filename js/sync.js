import { SUPABASE_CONFIG } from './supabase-config.js';

const SYNC_SETTINGS_KEY = 'troshare_sync_settings_v1';
const CLIENT_ID = `cli_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

let supabaseClient = null;
let realtimeChannel = null;
let activeRoomCode = null;
let pushTimer = null;
let onRemoteDataCallback = null;
let onStatusChangeCallback = null;

export function normalizeRoomCode(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
}

export function loadSyncSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SYNC_SETTINGS_KEY) || '{}') || {};
  } catch {
    saved = {};
  }
  return {
    url: (SUPABASE_CONFIG.url || saved.url || '').trim(),
    anonKey: (SUPABASE_CONFIG.anonKey || saved.anonKey || '').trim(),
    roomCode: normalizeRoomCode(saved.roomCode || ''),
    isHardcoded: Boolean(SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey),
  };
}

export function saveSyncSettings({ url, anonKey, roomCode }) {
  const current = loadSyncSettings();
  const next = {
    url: url !== undefined ? String(url).trim() : current.url,
    anonKey: anonKey !== undefined ? String(anonKey).trim() : current.anonKey,
    roomCode: roomCode !== undefined ? normalizeRoomCode(roomCode) : current.roomCode,
  };
  localStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify(next));
  return loadSyncSettings();
}

export function getActiveRoomCode() {
  return activeRoomCode;
}

export function setSyncCallbacks({ onRemoteData, onStatusChange }) {
  onRemoteDataCallback = onRemoteData;
  onStatusChangeCallback = onStatusChange;
}

function emitStatus(status, label) {
  if (onStatusChangeCallback) onStatusChangeCallback(status, label);
}

async function getClient(url, anonKey) {
  if (!url || !anonKey) return null;
  if (supabaseClient && supabaseClient._troUrl === url && supabaseClient._troKey === anonKey) {
    return supabaseClient;
  }
  const mod = await import('https://esm.sh/@supabase/supabase-js@2');
  const client = mod.createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  client._troUrl = url;
  client._troKey = anonKey;
  supabaseClient = client;
  return client;
}

export async function disconnectRoom() {
  if (realtimeChannel && supabaseClient) {
    try {
      await supabaseClient.removeChannel(realtimeChannel);
    } catch {}
  }
  realtimeChannel = null;
  activeRoomCode = null;
  clearTimeout(pushTimer);
  saveSyncSettings({ roomCode: '' });
  emitStatus('offline', 'Lưu trên máy');
}

export async function connectRoom(roomCodeInput, localState) {
  const settings = loadSyncSettings();
  const roomCode = normalizeRoomCode(roomCodeInput || settings.roomCode);

  if (!settings.url || !settings.anonKey) {
    emitStatus('unconfigured', 'Chưa cài Supabase');
    return { ok: false, reason: 'missing_config' };
  }

  if (!roomCode || roomCode.length < 3) {
    return { ok: false, reason: 'invalid_room_code' };
  }

  emitStatus('syncing', 'Đang kết nối...');

  try {
    const client = await getClient(settings.url, settings.anonKey);

    if (realtimeChannel) {
      try {
        await client.removeChannel(realtimeChannel);
      } catch {}
      realtimeChannel = null;
    }

    // 1. Fetch existing room data from Supabase
    const { data: row, error } = await client
      .from('troshare_rooms')
      .select('room_code, data, updated_at')
      .eq('room_code', roomCode)
      .maybeSingle();

    if (error) {
      emitStatus('error', 'Lỗi kết nối');
      return { ok: false, reason: 'db_error', error };
    }

    activeRoomCode = roomCode;
    saveSyncSettings({ roomCode });

    let loadedRemote = false;
    if (row && row.data && Array.isArray(row.data.members) && row.data.members.length > 0) {
      const cleanData = stripMeta(row.data);
      if (onRemoteDataCallback) onRemoteDataCallback(cleanData, { initial: true });
      loadedRemote = true;
    } else {
      // Room doesn't exist yet -> create it with current local state
      await pushStateImmediate(localState);
    }

    // 2. Subscribe to real-time updates for this room
    realtimeChannel = client
      .channel(`room:${roomCode}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'troshare_rooms',
          filter: `room_code=eq.${roomCode}`,
        },
        (payload) => {
          const newData = payload.new?.data;
          if (!newData || newData._lastClient === CLIENT_ID) return;
          if (!Array.isArray(newData.members) || newData.members.length === 0) return;
          if (onRemoteDataCallback) {
            onRemoteDataCallback(stripMeta(newData), { initial: false });
          }
          emitStatus('synced', `Phòng: ${roomCode}`);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          emitStatus('synced', `Phòng: ${roomCode}`);
        }
      });

    emitStatus('synced', `Phòng: ${roomCode}`);
    return { ok: true, roomCode, loadedRemote };
  } catch (err) {
    emitStatus('error', 'Lỗi mạng');
    return { ok: false, reason: 'network_error', error: err };
  }
}

export function schedulePushState(state) {
  if (!activeRoomCode) return;
  emitStatus('syncing', 'Đang đồng bộ...');
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushStateImmediate(state);
  }, 450);
}

export async function pushStateImmediate(state) {
  if (!activeRoomCode) return;
  const settings = loadSyncSettings();
  if (!settings.url || !settings.anonKey) return;

  try {
    const client = await getClient(settings.url, settings.anonKey);
    const payload = {
      ...state,
      _lastClient: CLIENT_ID,
      _updatedAt: Date.now(),
    };
    const { error } = await client.from('troshare_rooms').upsert(
      {
        room_code: activeRoomCode,
        data: payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'room_code' }
    );
    if (error) {
      emitStatus('error', 'Lỗi lưu Cloud');
    } else {
      emitStatus('synced', `Phòng: ${activeRoomCode}`);
    }
  } catch {
    emitStatus('error', 'Mất mạng');
  }
}

function stripMeta(data) {
  const { _lastClient, _updatedAt, ...rest } = data || {};
  return rest;
}
