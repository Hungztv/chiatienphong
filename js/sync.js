import { SUPABASE_CONFIG } from './supabase-config.js';

const DEFAULT_ROOM_CODE = 'phong-chung';
const CLIENT_ID = `cli_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

let supabaseClient = null;
let realtimeChannel = null;
let isReady = false;
let pushTimer = null;
let onRemoteDataCallback = null;
let onStatusChangeCallback = null;

export function setSyncCallbacks({ onRemoteData, onStatusChange }) {
  onRemoteDataCallback = onRemoteData;
  onStatusChangeCallback = onStatusChange;
}

function emitStatus(status, label) {
  if (onStatusChangeCallback) onStatusChangeCallback(status, label);
}

async function getClient() {
  const url = (SUPABASE_CONFIG.url || '').trim();
  const anonKey = (SUPABASE_CONFIG.anonKey || '').trim();
  if (!url || !anonKey) return null;
  if (supabaseClient) return supabaseClient;
  const mod = await import('https://esm.sh/@supabase/supabase-js@2');
  supabaseClient = mod.createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabaseClient;
}

export async function startAutoSync(localState) {
  emitStatus('syncing', 'Đang đồng bộ...');

  try {
    const client = await getClient();
    if (!client) {
      emitStatus('offline', 'Lưu trên máy');
      return;
    }

    // 1. Fetch existing cloud state
    const { data: row, error } = await client
      .from('troshare_rooms')
      .select('room_code, data, updated_at')
      .eq('room_code', DEFAULT_ROOM_CODE)
      .maybeSingle();

    if (error) {
      emitStatus('error', 'Lỗi đồng bộ');
      return;
    }

    isReady = true;

    if (row && row.data && Array.isArray(row.data.members) && row.data.members.length > 0) {
      if (onRemoteDataCallback) {
        onRemoteDataCallback(stripMeta(row.data), { initial: true });
      }
    } else {
      await pushStateImmediate(localState);
    }

    // 2. Subscribe to real-time updates
    if (realtimeChannel) {
      try {
        await client.removeChannel(realtimeChannel);
      } catch {}
    }

    realtimeChannel = client
      .channel(`room:${DEFAULT_ROOM_CODE}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'troshare_rooms',
          filter: `room_code=eq.${DEFAULT_ROOM_CODE}`,
        },
        (payload) => {
          const newData = payload.new?.data;
          if (!newData || newData._lastClient === CLIENT_ID) return;
          if (!Array.isArray(newData.members) || newData.members.length === 0) return;
          if (onRemoteDataCallback) {
            onRemoteDataCallback(stripMeta(newData), { initial: false });
          }
          emitStatus('synced', 'Đã đồng bộ');
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          emitStatus('synced', 'Đã đồng bộ');
        }
      });

    emitStatus('synced', 'Đã đồng bộ');
  } catch {
    emitStatus('error', 'Mất mạng');
  }
}

export function schedulePushState(state) {
  if (!isReady) return;
  emitStatus('syncing', 'Đang lưu...');
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushStateImmediate(state);
  }, 350);
}

export async function pushStateImmediate(state) {
  if (!isReady) return;
  try {
    const client = await getClient();
    if (!client) return;
    const payload = {
      ...state,
      _lastClient: CLIENT_ID,
      _updatedAt: Date.now(),
    };
    const { error } = await client.from('troshare_rooms').upsert(
      {
        room_code: DEFAULT_ROOM_CODE,
        data: payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'room_code' }
    );
    if (error) {
      emitStatus('error', 'Lỗi lưu');
    } else {
      emitStatus('synced', 'Đã đồng bộ');
    }
  } catch {
    emitStatus('error', 'Mất mạng');
  }
}

function stripMeta(data) {
  const { _lastClient, _updatedAt, ...rest } = data || {};
  return rest;
}
