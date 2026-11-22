import {
  AVATAR_COLORS,
  CATEGORIES,
  buildZaloSummary,
  computeFixedBill,
  computeMonthFinancials,
  createDemoState,
  decodeStateFromHash,
  defaultFixedBill,
  encodeStateToHash,
  escapeHtml,
  formatMonthLabel,
  formatNumberInput,
  formatVND,
  getInitials,
  getMonthKey,
  parseVND,
  shiftMonthKey,
  uid,
} from './utils.js';
import { renderCategoryDonut, renderMemberBarChart } from './charts.js';
import {
  connectRoom,
  disconnectRoom,
  getActiveRoomCode,
  loadSyncSettings,
  normalizeRoomCode,
  saveSyncSettings,
  schedulePushState,
  setSyncCallbacks,
} from './sync.js';

const STORAGE_KEY = 'troshare_state_v2';
const LEGACY_STORAGE_KEY = 'troshare_state_v1';
const THEME_KEY = 'troshare_theme_v1';

// Clear legacy v1 data so the app starts cleanly at 0
try {
  localStorage.removeItem(LEGACY_STORAGE_KEY);
} catch {}

let state = loadState();
let currentMonth = getMonthKey(new Date());
let currentSplitType = 'equal';
let currentWaterMode = 'per_person';
let pendingSharedState = null;

function createDefaultState() {
  return {
    roomName: 'Phòng trọ của chúng mình',
    members: [
      { id: 'm_1', name: 'Bạn A (Tôi)', color: '#0f766e' },
      { id: 'm_2', name: 'Bạn B', color: '#2563eb' },
    ],
    months: {},
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.members) || parsed.members.length === 0) {
      return createDefaultState();
    }
    parsed.months = parsed.months || {};
    return parsed;
  } catch {
    return createDefaultState();
  }
}

function saveState(skipCloudPush = false) {
  if (pendingSharedState) return; // Don't overwrite local data while previewing a shared link
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!skipCloudPush) {
    schedulePushState(state);
  }
}

function ensureMonth(monthKey) {
  if (!state.months[monthKey]) {
    state.months[monthKey] = {
      fixed: defaultFixedBill(state.members.length),
      expenses: [],
      settlements: [],
    };
  }
  return state.months[monthKey];
}

// Toast
let toastTimer = null;
function showToast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// Theme
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  document.getElementById('iconSun')?.classList.toggle('hidden', theme !== 'dark');
  document.getElementById('iconMoon')?.classList.toggle('hidden', theme === 'dark');
}

// Check URL hash for shared state
function checkSharedUrl() {
  const hash = window.location.hash || '';
  if (!hash.startsWith('#share=')) return;
  const encoded = hash.slice('#share='.length);
  if (!encoded) return;
  try {
    const decoded = decodeStateFromHash(encoded);
    if (decoded && Array.isArray(decoded.members) && decoded.members.length > 0) {
      pendingSharedState = state; // keep original local state as backup
      state = decoded;
      const availableMonths = Object.keys(state.months || {}).sort();
      if (availableMonths.length > 0 && !state.months[currentMonth]) {
        currentMonth = availableMonths[availableMonths.length - 1];
      }
      document.getElementById('sharedBanner')?.classList.remove('hidden');
    }
  } catch {
    showToast('Đường link chia sẻ không hợp lệ.');
  }
}

// Render everything
function renderAll() {
  ensureMonth(currentMonth);

  document.getElementById('roomNameDisplay').textContent = state.roomName || 'Phòng trọ của chúng mình';
  document.getElementById('roomNameInput').value = state.roomName || '';
  document.getElementById('currentMonthLabel').textContent = formatMonthLabel(currentMonth);

  renderOverview();
  renderMemberSelects();
  renderSplitParticipants();
  renderExpenseList();
  populateFixedForm();
  renderMembersSettings();
}

function renderOverview() {
  const fin = computeMonthFinancials(state, currentMonth);

  document.getElementById('kpiTotal').textContent = formatVND(fin.grandTotal);
  document.getElementById('kpiFixed').textContent = formatVND(fin.fixedCalc.total);
  document.getElementById('kpiFixedSub').textContent =
    fin.fixedCalc.total > 0
      ? `Mỗi người ~${formatVND(fin.fixedCalc.perPerson)}`
      : 'Chưa nhập hóa đơn tháng này';
  document.getElementById('kpiShared').textContent = formatVND(fin.sharedTotal);
  document.getElementById('kpiSharedSub').textContent = `${fin.expensesCount} khoản chi`;
  document.getElementById('kpiPerPerson').textContent = formatVND(fin.perPersonAvg);
  document.getElementById('kpiPerPersonSub').textContent = `${state.members.length} thành viên`;

  // Settlement Transfers
  const settlementList = document.getElementById('settlementList');
  if (fin.transfers.length === 0) {
    settlementList.innerHTML = `
      <div class="settlement-empty">
        🎉 Tuyệt vời! Tháng ${currentMonth.split('-')[1]} hiện không có ai nợ ai.
      </div>
    `;
  } else {
    settlementList.innerHTML = fin.transfers
      .map(
        (t) => `
      <div class="settlement-item">
        <div class="settlement-flow">
          <span class="avatar avatar-sm" style="background:${t.from.color}">${escapeHtml(getInitials(t.from.name))}</span>
          <strong>${escapeHtml(t.from.name)}</strong>
          <span class="settlement-arrow">➔</span>
          <span class="avatar avatar-sm" style="background:${t.to.color}">${escapeHtml(getInitials(t.to.name))}</span>
          <strong>${escapeHtml(t.to.name)}</strong>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="settlement-amount mono">${formatVND(t.amount)}</span>
          <button class="btn btn-outline btn-sm" data-settle-from="${t.from.id}" data-settle-to="${t.to.id}" data-settle-amount="${t.amount}">
            ✓ Đã trả
          </button>
        </div>
      </div>
    `
      )
      .join('');
  }

  // Settlement history
  const histWrap = document.getElementById('settlementHistoryWrap');
  const histList = document.getElementById('settlementHistoryList');
  if (fin.settlements.length > 0) {
    histWrap.classList.remove('hidden');
    histList.innerHTML = fin.settlements
      .map((s) => {
        const from = state.members.find((m) => m.id === s.fromId)?.name || '?';
        const to = state.members.find((m) => m.id === s.toId)?.name || '?';
        return `
          <div class="history-item">
            <span>✅ <strong>${escapeHtml(from)}</strong> đã trả <strong>${escapeHtml(to)}</strong> <span class="mono">${formatVND(s.amount)}</span> <span class="muted">(${s.date})</span></span>
            <button class="btn btn-ghost btn-sm" data-undo-settlement="${s.id}" title="Hoàn tác">Hoàn tác</button>
          </div>
        `;
      })
      .join('');
  } else {
    histWrap.classList.add('hidden');
    histList.innerHTML = '';
  }

  // Member summary
  const summaryEl = document.getElementById('memberSummaryList');
  summaryEl.innerHTML = fin.memberStats
    .map((s) => {
      let badgeClass = 'zero';
      let badgeText = 'Cân bằng';
      if (s.balance > 100) {
        badgeClass = 'pos';
        badgeText = `+${formatVND(s.balance)} (được nhận)`;
      } else if (s.balance < -100) {
        badgeClass = 'neg';
        badgeText = `-${formatVND(-s.balance)} (cần trả)`;
      }
      return `
        <div class="member-summary-row">
          <div class="member-summary-left">
            <span class="avatar" style="background:${s.member.color}">${escapeHtml(getInitials(s.member.name))}</span>
            <div>
              <div class="member-summary-name">${escapeHtml(s.member.name)}</div>
              <div class="member-summary-meta mono">Đã ứng: ${formatVND(s.paid)} · Phần chịu: ${formatVND(s.owed)}</div>
            </div>
          </div>
          <div class="member-summary-balance">
            <span class="balance-badge mono ${badgeClass}">${badgeText}</span>
          </div>
        </div>
      `;
    })
    .join('');

  // Charts
  renderCategoryDonut(document.getElementById('categoryChartContainer'), fin.categoryTotals, fin.grandTotal);
  renderMemberBarChart(document.getElementById('memberBarChartContainer'), fin.memberStats);
}

function renderMemberSelects() {
  const payerSelect = document.getElementById('expensePayer');
  const filterPayer = document.getElementById('filterPayer');
  const fixedPayer = document.getElementById('fixedPayer');

  const prevExpensePayer = payerSelect.value;
  const prevFilterPayer = filterPayer.value;

  const memberOpts = state.members
    .map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`)
    .join('');

  payerSelect.innerHTML = memberOpts;
  if (state.members.some((m) => m.id === prevExpensePayer)) {
    payerSelect.value = prevExpensePayer;
  }

  filterPayer.innerHTML = `<option value="all">Tất cả người trả</option>${memberOpts}`;
  if (prevFilterPayer === 'all' || state.members.some((m) => m.id === prevFilterPayer)) {
    filterPayer.value = prevFilterPayer;
  }

  fixedPayer.innerHTML = `
    <option value="split_self">Mỗi người tự đóng phần mình</option>
    ${state.members.map((m) => `<option value="${m.id}">${escapeHtml(m.name)} ứng trước toàn bộ</option>`).join('')}
  `;
}

function renderSplitParticipants(existingExpense = null) {
  const wrap = document.getElementById('splitParticipantsWrap');
  const totalAmount = parseVND(document.getElementById('expenseAmount').value);

  if (currentSplitType === 'equal') {
    const selectedIds = existingExpense?.participants || state.members.map((m) => m.id);
    wrap.innerHTML =
      state.members
        .map((m) => {
          const checked = selectedIds.includes(m.id) ? 'checked' : '';
          return `
          <div class="split-row">
            <label class="split-check">
              <input type="checkbox" class="split-participant-cb" value="${m.id}" ${checked} />
              <span class="avatar avatar-sm" style="background:${m.color}">${escapeHtml(getInitials(m.name))}</span>
              <span>${escapeHtml(m.name)}</span>
            </label>
            <span class="mono muted split-preview-share" data-share-for="${m.id}">0 ₫</span>
          </div>
        `;
        })
        .join('') +
      `<div class="split-status"><span>Chia đều cho người được chọn</span><span id="splitEqualInfo" class="mono"></span></div>`;
    updateEqualSplitPreview();
  } else {
    const customSplits = existingExpense?.customSplits || {};
    const defaultPerPerson = state.members.length > 0 ? Math.floor(totalAmount / state.members.length) : 0;
    wrap.innerHTML =
      state.members
        .map((m, idx) => {
          let val = customSplits[m.id];
          if (val === undefined) {
            val = idx === 0 ? totalAmount - defaultPerPerson * (state.members.length - 1) : defaultPerPerson;
          }
          return `
          <div class="split-row">
            <div class="split-check">
              <span class="avatar avatar-sm" style="background:${m.color}">${escapeHtml(getInitials(m.name))}</span>
              <span>${escapeHtml(m.name)}</span>
            </div>
            <input type="text" inputmode="numeric" class="split-custom-input" data-custom-member="${m.id}" value="${val ? formatNumberInput(val) : ''}" placeholder="0" />
          </div>
        `;
        })
        .join('') +
      `<div class="split-status"><span>Tổng chia tùy chỉnh:</span><span id="splitCustomStatus" class="mono"></span></div>`;
    updateCustomSplitStatus();
  }
}

function updateEqualSplitPreview() {
  if (currentSplitType !== 'equal') return;
  const total = parseVND(document.getElementById('expenseAmount').value);
  const checked = [...document.querySelectorAll('.split-participant-cb:checked')].map((el) => el.value);
  const per = checked.length > 0 ? Math.round(total / checked.length) : 0;

  document.querySelectorAll('.split-preview-share').forEach((el) => {
    const id = el.dataset.shareFor;
    el.textContent = checked.includes(id) ? formatVND(per) : '0 ₫';
  });

  const info = document.getElementById('splitEqualInfo');
  if (info) {
    info.textContent = checked.length > 0 ? `${checked.length} người · ${formatVND(per)}/người` : 'Chọn ít nhất 1 người';
  }
}

function updateCustomSplitStatus() {
  if (currentSplitType !== 'custom') return;
  const total = parseVND(document.getElementById('expenseAmount').value);
  let sum = 0;
  document.querySelectorAll('.split-custom-input').forEach((el) => {
    sum += parseVND(el.value);
  });
  const diff = total - sum;
  const statusEl = document.getElementById('splitCustomStatus');
  if (!statusEl) return;
  if (diff === 0) {
    statusEl.textContent = `✓ Khớp ${formatVND(sum)}`;
    statusEl.className = 'mono text-positive';
  } else if (diff > 0) {
    statusEl.textContent = `Còn thiếu ${formatVND(diff)}`;
    statusEl.className = 'mono text-negative';
  } else {
    statusEl.textContent = `Dư ${formatVND(-diff)}`;
    statusEl.className = 'mono text-negative';
  }
}

function renderExpenseList() {
  const monthData = ensureMonth(currentMonth);
  const search = (document.getElementById('filterSearch').value || '').trim().toLowerCase();
  const payerFilter = document.getElementById('filterPayer').value;
  const catFilter = document.getElementById('filterCategory').value;

  const filtered = (monthData.expenses || [])
    .filter((e) => {
      if (payerFilter !== 'all' && e.payerId !== payerFilter) return false;
      if (catFilter !== 'all' && e.category !== catFilter) return false;
      if (search && !e.title.toLowerCase().includes(search) && !(e.note || '').toLowerCase().includes(search)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  document.getElementById('expenseListCount').textContent = `${filtered.length} khoản chi`;
  const listEl = document.getElementById('expenseList');

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-state">Chưa có khoản chi chung nào trong ${formatMonthLabel(currentMonth)}.<br/>Hãy thêm khoản đầu tiên ở form bên cạnh!</div>`;
    return;
  }

  listEl.innerHTML = filtered
    .map((e) => {
      const cat = CATEGORIES[e.category] || CATEGORIES.other;
      const payer = state.members.find((m) => m.id === e.payerId);
      const splitLabel =
        e.splitType === 'custom'
          ? 'Chia tùy chỉnh'
          : `Chia đều ${(e.participants || state.members.map((m) => m.id)).length} người`;

      return `
        <div class="expense-item">
          <div class="expense-left">
            <div class="expense-cat-badge" title="${escapeHtml(cat.label)}">${cat.icon}</div>
            <div>
              <div class="expense-title">${escapeHtml(e.title)}</div>
              <div class="expense-meta">
                <span>${e.date}</span> ·
                <span><strong>${escapeHtml(payer?.name || '?')}</strong> trả</span> ·
                <span>${splitLabel}</span>
              </div>
              ${e.note ? `<div class="expense-note">"${escapeHtml(e.note)}"</div>` : ''}
            </div>
          </div>
          <div class="expense-right">
            <div class="expense-amount mono">${formatVND(e.amount)}</div>
            <div class="expense-actions">
              <button class="btn btn-ghost btn-sm" data-edit-expense="${e.id}">Sửa</button>
              <button class="btn btn-ghost btn-sm text-negative" data-delete-expense="${e.id}">Xóa</button>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

// Fixed Bills Form
function populateFixedForm() {
  const monthData = ensureMonth(currentMonth);
  const f = monthData.fixed || defaultFixedBill(state.members.length);

  document.getElementById('fixedIncludeInSettlement').checked = f.includeInSettlement !== false;
  document.getElementById('fixedPayer').value =
    f.payerId && (f.payerId === 'split_self' || state.members.some((m) => m.id === f.payerId))
      ? f.payerId
      : 'split_self';

  document.getElementById('fixedRent').value = f.rent ? formatNumberInput(f.rent) : '';
  document.getElementById('elecOld').value = f.elecOld ?? '';
  document.getElementById('elecNew').value = f.elecNew ?? '';
  document.getElementById('elecRate').value = f.elecRate ? formatNumberInput(f.elecRate) : '';

  currentWaterMode = f.waterMode === 'meter' ? 'meter' : 'per_person';
  updateWaterModeUI();

  document.getElementById('waterPerPersonRate').value = f.waterPerPersonRate ? formatNumberInput(f.waterPerPersonRate) : '';
  document.getElementById('waterPersonCount').value = f.waterPersonCount || state.members.length;
  document.getElementById('waterOld').value = f.waterOld ?? '';
  document.getElementById('waterNew').value = f.waterNew ?? '';
  document.getElementById('waterMeterRate').value = f.waterMeterRate ? formatNumberInput(f.waterMeterRate) : '';

  document.getElementById('fixedWifi').value = f.wifi ? formatNumberInput(f.wifi) : '';
  document.getElementById('fixedTrash').value = f.trash ? formatNumberInput(f.trash) : '';
  document.getElementById('fixedParking').value = f.parking ? formatNumberInput(f.parking) : '';
  document.getElementById('fixedOtherNote').value = f.note || '';

  updateFixedLivePreview();
}

function readFixedForm() {
  return {
    includeInSettlement: document.getElementById('fixedIncludeInSettlement').checked,
    payerId: document.getElementById('fixedPayer').value,
    rent: parseVND(document.getElementById('fixedRent').value),
    elecOld: document.getElementById('elecOld').value,
    elecNew: document.getElementById('elecNew').value,
    elecRate: parseVND(document.getElementById('elecRate').value),
    waterMode: currentWaterMode,
    waterPerPersonRate: parseVND(document.getElementById('waterPerPersonRate').value),
    waterPersonCount: Math.max(1, Number(document.getElementById('waterPersonCount').value) || state.members.length),
    waterOld: document.getElementById('waterOld').value,
    waterNew: document.getElementById('waterNew').value,
    waterMeterRate: parseVND(document.getElementById('waterMeterRate').value),
    wifi: parseVND(document.getElementById('fixedWifi').value),
    trash: parseVND(document.getElementById('fixedTrash').value),
    parking: parseVND(document.getElementById('fixedParking').value),
    note: document.getElementById('fixedOtherNote').value.trim(),
  };
}

function updateWaterModeUI() {
  document.querySelectorAll('#waterModeControl .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.waterMode === currentWaterMode);
  });
  document.getElementById('waterPerPersonFields').classList.toggle('hidden', currentWaterMode !== 'per_person');
  document.getElementById('waterMeterFields').classList.toggle('hidden', currentWaterMode !== 'meter');
}

function updateFixedLivePreview() {
  const data = readFixedForm();
  const calc = computeFixedBill(data, state.members.length);

  document.getElementById('elecComputed').textContent = `${calc.elecUsage} kWh = ${formatVND(calc.elecTotal)}`;
  document.getElementById('waterComputed').textContent =
    currentWaterMode === 'meter'
      ? `${calc.waterUsage} m³ = ${formatVND(calc.waterTotal)}`
      : formatVND(calc.waterTotal);

  document.getElementById('fixedTotalDisplay').textContent = formatVND(calc.total);
  document.getElementById('fixedMemberCountDisplay').textContent = String(state.members.length);
  document.getElementById('fixedPerPersonDisplay').textContent = formatVND(calc.perPerson);
}

// Members Settings
function renderMembersSettings() {
  const list = document.getElementById('membersList');
  list.innerHTML = state.members
    .map(
      (m) => `
      <div class="member-row" data-member-id="${m.id}">
        <span class="avatar" style="background:${m.color}">${escapeHtml(getInitials(m.name))}</span>
        <input type="text" class="member-name-input" value="${escapeHtml(m.name)}" aria-label="Tên thành viên" />
        <input type="color" class="color-input member-color-input" value="${m.color}" title="Chọn màu đại diện" />
        ${
          state.members.length > 1
            ? `<button class="btn btn-danger btn-sm" data-remove-member="${m.id}" title="Xóa thành viên">Xóa</button>`
            : ''
        }
      </div>
    `
    )
    .join('');
}

// Reset expense form
function resetExpenseForm() {
  document.getElementById('expenseForm').reset();
  document.getElementById('expenseId').value = '';
  document.getElementById('expenseFormTitle').textContent = 'Thêm khoản chi chung';
  document.getElementById('btnSubmitExpense').textContent = '+ Lưu khoản chi';
  document.getElementById('btnCancelEditExpense').classList.add('hidden');
  document.getElementById('expenseDate').value = getDefaultDateForMonth(currentMonth);
  currentSplitType = 'equal';
  document.querySelectorAll('#splitTypeControl .seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.split === 'equal');
  });
  renderSplitParticipants();
}

function getDefaultDateForMonth(monthKey) {
  const today = new Date();
  if (getMonthKey(today) === monthKey) {
    return today.toISOString().slice(0, 10);
  }
  return `${monthKey}-01`;
}

function switchTab(tabName) {
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });
  if (window.innerWidth <= 768) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

async function copyText(text, successMsg) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast(successMsg);
  }
}

function handleShareLink() {
  try {
    const encoded = encodeStateToHash(state);
    const url = `${window.location.origin}${window.location.pathname}#share=${encoded}`;
    copyText(url, '🔗 Đã sao chép đường link chia sẻ! Gửi cho bạn cùng phòng nhé.');
  } catch {
    showToast('Không thể tạo link chia sẻ.');
  }
}

// Wire all events
function bindEvents() {
  // Tabs
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('btnQuickAddFromOverview').addEventListener('click', () => {
    switchTab('expenses');
    document.getElementById('expenseTitle').focus();
  });

  // Month navigation
  document.getElementById('btnPrevMonth').addEventListener('click', () => {
    currentMonth = shiftMonthKey(currentMonth, -1);
    resetExpenseForm();
    renderAll();
  });
  document.getElementById('btnNextMonth').addEventListener('click', () => {
    currentMonth = shiftMonthKey(currentMonth, 1);
    resetExpenseForm();
    renderAll();
  });

  // Theme toggle
  document.getElementById('btnThemeToggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });

  // Shared banner actions
  document.getElementById('btnAcceptShare').addEventListener('click', () => {
    pendingSharedState = null;
    saveState();
    history.replaceState(null, '', window.location.pathname);
    document.getElementById('sharedBanner').classList.add('hidden');
    showToast('✅ Đã lưu dữ liệu chia sẻ vào máy của bạn!');
  });

  document.getElementById('btnDismissShare').addEventListener('click', () => {
    if (pendingSharedState) {
      state = pendingSharedState;
      pendingSharedState = null;
    }
    history.replaceState(null, '', window.location.pathname);
    document.getElementById('sharedBanner').classList.add('hidden');
    renderAll();
    showToast('Đã quay lại dữ liệu trước đó của bạn.');
  });

  // Zalo Summary Modal
  document.getElementById('btnCopyZalo').addEventListener('click', () => {
    const text = buildZaloSummary(state, currentMonth);
    document.getElementById('zaloSummaryText').value = text;
    document.getElementById('zaloModal').classList.remove('hidden');
  });

  document.getElementById('btnConfirmCopyZalo').addEventListener('click', () => {
    const text = document.getElementById('zaloSummaryText').value;
    copyText(text, '📋 Đã copy tổng kết! Dán vào Zalo/Messenger ngay nhé.');
    document.getElementById('zaloModal').classList.add('hidden');
  });

  document.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', () => {
      document.getElementById(el.dataset.closeModal)?.classList.add('hidden');
    });
  });

  // Share Link
  document.getElementById('btnShareLink').addEventListener('click', handleShareLink);
  document.getElementById('btnShareLink2').addEventListener('click', handleShareLink);

  // Format currency inputs smoothly
  const currencyInputIds = [
    'expenseAmount',
    'fixedRent',
    'elecRate',
    'waterPerPersonRate',
    'waterMeterRate',
    'fixedWifi',
    'fixedTrash',
    'fixedParking',
  ];
  currencyInputIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      el.value = formatNumberInput(el.value);
      if (id === 'expenseAmount') {
        updateEqualSplitPreview();
        updateCustomSplitStatus();
      } else {
        updateFixedLivePreview();
      }
    });
  });

  // Quick amount chips
  document.querySelectorAll('.quick-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const input = document.getElementById('expenseAmount');
      const cur = parseVND(input.value);
      let next = cur;
      if (chip.dataset.addAmount) {
        next = cur + Number(chip.dataset.addAmount);
      } else if (chip.dataset.mul1000) {
        next = cur > 0 ? cur * 1000 : 1000;
      }
      input.value = formatNumberInput(next);
      updateEqualSplitPreview();
      updateCustomSplitStatus();
    });
  });

  // Split type toggle
  document.querySelectorAll('#splitTypeControl .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentSplitType = btn.dataset.split;
      document.querySelectorAll('#splitTypeControl .seg-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.split === currentSplitType);
      });
      renderSplitParticipants();
    });
  });

  // Split participants change delegation
  document.getElementById('splitParticipantsWrap').addEventListener('input', (e) => {
    if (e.target.classList.contains('split-custom-input')) {
      e.target.value = formatNumberInput(e.target.value);
      updateCustomSplitStatus();
    }
  });
  document.getElementById('splitParticipantsWrap').addEventListener('change', (e) => {
    if (e.target.classList.contains('split-participant-cb')) {
      updateEqualSplitPreview();
    }
  });

  // Expense form submit
  document.getElementById('expenseForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('expenseTitle').value.trim();
    const amount = parseVND(document.getElementById('expenseAmount').value);
    const date = document.getElementById('expenseDate').value || getDefaultDateForMonth(currentMonth);
    const category = document.getElementById('expenseCategory').value;
    const payerId = document.getElementById('expensePayer').value;
    const note = document.getElementById('expenseNote').value.trim();
    const editId = document.getElementById('expenseId').value;

    if (!title || amount <= 0) {
      showToast('Vui lòng nhập tên khoản chi và số tiền hợp lệ.');
      return;
    }

    let participants = [];
    let customSplits = null;

    if (currentSplitType === 'equal') {
      participants = [...document.querySelectorAll('.split-participant-cb:checked')].map((el) => el.value);
      if (participants.length === 0) {
        showToast('Hãy chọn ít nhất 1 người tham gia chia tiền.');
        return;
      }
    } else {
      customSplits = {};
      let sum = 0;
      document.querySelectorAll('.split-custom-input').forEach((el) => {
        const val = parseVND(el.value);
        customSplits[el.dataset.customMember] = val;
        sum += val;
      });
      if (sum !== amount) {
        showToast(`Tổng chia tùy chỉnh (${formatVND(sum)}) chưa khớp số tiền (${formatVND(amount)}).`);
        return;
      }
      participants = Object.keys(customSplits).filter((id) => customSplits[id] > 0);
    }

    const monthData = ensureMonth(currentMonth);
    const payload = {
      id: editId || uid('exp'),
      title,
      amount,
      date,
      category,
      payerId,
      splitType: currentSplitType,
      participants,
      customSplits,
      note,
    };

    if (editId) {
      const idx = monthData.expenses.findIndex((x) => x.id === editId);
      if (idx !== -1) monthData.expenses[idx] = payload;
      showToast('✏️ Đã cập nhật khoản chi.');
    } else {
      monthData.expenses.push(payload);
      showToast('✅ Đã thêm khoản chi mới.');
    }

    saveState();
    resetExpenseForm();
    renderAll();
  });

  document.getElementById('btnCancelEditExpense').addEventListener('click', resetExpenseForm);

  // Filters
  ['filterSearch', 'filterPayer', 'filterCategory'].forEach((id) => {
    document.getElementById(id).addEventListener('input', renderExpenseList);
    document.getElementById(id).addEventListener('change', renderExpenseList);
  });

  // Expense list edit / delete
  document.getElementById('expenseList').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-expense]');
    const delBtn = e.target.closest('[data-delete-expense]');
    const monthData = ensureMonth(currentMonth);

    if (editBtn) {
      const exp = monthData.expenses.find((x) => x.id === editBtn.dataset.editExpense);
      if (!exp) return;
      document.getElementById('expenseId').value = exp.id;
      document.getElementById('expenseTitle').value = exp.title;
      document.getElementById('expenseAmount').value = formatNumberInput(exp.amount);
      document.getElementById('expenseDate').value = exp.date;
      document.getElementById('expenseCategory').value = exp.category;
      document.getElementById('expensePayer').value = exp.payerId;
      document.getElementById('expenseNote').value = exp.note || '';
      currentSplitType = exp.splitType === 'custom' ? 'custom' : 'equal';
      document.querySelectorAll('#splitTypeControl .seg-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.split === currentSplitType);
      });
      renderSplitParticipants(exp);
      document.getElementById('expenseFormTitle').textContent = 'Chỉnh sửa khoản chi';
      document.getElementById('btnSubmitExpense').textContent = '💾 Cập nhật khoản chi';
      document.getElementById('btnCancelEditExpense').classList.remove('hidden');
      document.getElementById('expenseTitle').focus();
    } else if (delBtn) {
      if (!confirm('Bạn có chắc muốn xóa khoản chi này?')) return;
      monthData.expenses = monthData.expenses.filter((x) => x.id !== delBtn.dataset.deleteExpense);
      saveState();
      renderAll();
      showToast('🗑️ Đã xóa khoản chi.');
    }
  });

  // Settlement actions (Mark as paid / Undo)
  document.getElementById('settlementList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-settle-from]');
    if (!btn) return;
    const fromId = btn.dataset.settleFrom;
    const toId = btn.dataset.settleTo;
    const amount = Number(btn.dataset.settleAmount);
    const fromName = state.members.find((m) => m.id === fromId)?.name || '?';
    const toName = state.members.find((m) => m.id === toId)?.name || '?';

    if (!confirm(`Xác nhận ${fromName} đã chuyển khoản ${formatVND(amount)} cho ${toName}?`)) return;
    const monthData = ensureMonth(currentMonth);
    monthData.settlements = monthData.settlements || [];
    monthData.settlements.push({
      id: uid('stl'),
      fromId,
      toId,
      amount,
      date: new Date().toISOString().slice(0, 10),
    });
    saveState();
    renderAll();
    showToast('✅ Đã ghi nhận thanh toán!');
  });

  document.getElementById('settlementHistoryList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-undo-settlement]');
    if (!btn) return;
    const monthData = ensureMonth(currentMonth);
    monthData.settlements = (monthData.settlements || []).filter((s) => s.id !== btn.dataset.undoSettlement);
    saveState();
    renderAll();
    showToast('Đã hoàn tác lượt thanh toán.');
  });

  // Fixed bill form events
  document.querySelectorAll('#waterModeControl .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentWaterMode = btn.dataset.waterMode;
      updateWaterModeUI();
      updateFixedLivePreview();
    });
  });

  ['elecOld', 'elecNew', 'waterPersonCount', 'waterOld', 'waterNew'].forEach((id) => {
    document.getElementById(id).addEventListener('input', updateFixedLivePreview);
  });

  document.getElementById('fixedForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const monthData = ensureMonth(currentMonth);
    monthData.fixed = readFixedForm();
    saveState();
    renderAll();
    showToast('💾 Đã lưu hóa đơn phòng & điện nước!');
  });

  document.getElementById('btnCopyPrevFixed').addEventListener('click', () => {
    const prevKey = shiftMonthKey(currentMonth, -1);
    const prevFixed = state.months[prevKey]?.fixed;
    if (!prevFixed) {
      showToast(`Không tìm thấy hóa đơn của ${formatMonthLabel(prevKey)}.`);
      return;
    }
    const monthData = ensureMonth(currentMonth);
    monthData.fixed = {
      ...prevFixed,
      elecOld: prevFixed.elecNew || prevFixed.elecOld || '',
      elecNew: '',
      waterOld: prevFixed.waterNew || prevFixed.waterOld || '',
      waterNew: '',
    };
    saveState();
    populateFixedForm();
    renderOverview();
    showToast(`📋 Đã chép đơn giá & đẩy chỉ số mới của ${formatMonthLabel(prevKey)} sang số cũ!`);
  });

  // Settings: Room name
  document.getElementById('btnSaveRoomName').addEventListener('click', () => {
    const name = document.getElementById('roomNameInput').value.trim();
    state.roomName = name || 'Phòng trọ của chúng mình';
    saveState();
    renderAll();
    showToast('Đã cập nhật tên phòng trọ.');
  });

  // Settings: Members edit / remove
  document.getElementById('membersList').addEventListener('change', (e) => {
    const row = e.target.closest('.member-row');
    if (!row) return;
    const member = state.members.find((m) => m.id === row.dataset.memberId);
    if (!member) return;
    if (e.target.classList.contains('member-name-input')) {
      const val = e.target.value.trim();
      if (val) member.name = val;
    } else if (e.target.classList.contains('member-color-input')) {
      member.color = e.target.value;
    }
    saveState();
    renderAll();
    showToast('Đã cập nhật thông tin thành viên.');
  });

  document.getElementById('membersList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-member]');
    if (!btn) return;
    if (state.members.length <= 1) {
      showToast('Phòng trọ cần ít nhất 1 thành viên.');
      return;
    }
    const target = state.members.find((m) => m.id === btn.dataset.removeMember);
    if (!confirm(`Xóa thành viên "${target?.name}" khỏi danh sách?`)) return;
    state.members = state.members.filter((m) => m.id !== btn.dataset.removeMember);
    saveState();
    renderAll();
    showToast('Đã xóa thành viên.');
  });

  // Add member
  document.getElementById('addMemberForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('newMemberName');
    const name = input.value.trim();
    if (!name) return;
    const color = AVATAR_COLORS[state.members.length % AVATAR_COLORS.length];
    state.members.push({ id: uid('m'), name, color });
    input.value = '';
    saveState();
    renderAll();
    showToast(`👋 Đã thêm ${name} vào phòng!`);
  });

  // Export / Import JSON
  document.getElementById('btnExportJson').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `troshare-backup-${currentMonth}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('📥 Đã tải xuống file sao lưu JSON.');
  });

  document.getElementById('inputImportJson').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || !Array.isArray(parsed.members) || parsed.members.length === 0) {
          throw new Error('Invalid format');
        }
        state = parsed;
        pendingSharedState = null;
        saveState();
        renderAll();
        showToast('✅ Đã khôi phục dữ liệu từ file JSON!');
      } catch {
        showToast('❌ File JSON không đúng định dạng TrọShare.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // Demo & Reset
  document.getElementById('btnLoadDemo').addEventListener('click', () => {
    if (!confirm('Nạp dữ liệu mẫu sẽ thay thế dữ liệu hiện tại của tháng này. Tiếp tục?')) return;
    state = createDemoState(currentMonth);
    pendingSharedState = null;
    saveState();
    renderAll();
    switchTab('overview');
    showToast('✨ Đã nạp dữ liệu mẫu! Xem thử tổng quan nhé.');
  });

  document.getElementById('btnResetAll').addEventListener('click', () => {
    if (!confirm('Bạn có chắc muốn xóa toàn bộ dữ liệu và đặt lại từ đầu?')) return;
    state = createDefaultState();
    pendingSharedState = null;
    saveState();
    resetExpenseForm();
    renderAll();
    showToast('Đã đặt lại toàn bộ dữ liệu.');
  });

  // Cloud Sync (Supabase) UI events
  document.getElementById('btnSyncStatus').addEventListener('click', () => {
    switchTab('settings');
    document.getElementById('cloudSyncCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.getElementById('btnSaveSupabaseConfig').addEventListener('click', () => {
    const url = document.getElementById('supabaseUrlInput').value.trim();
    const anonKey = document.getElementById('supabaseKeyInput').value.trim();
    if (!url || !anonKey) {
      showToast('Vui lòng nhập đầy đủ Supabase URL và Anon Key.');
      return;
    }
    saveSyncSettings({ url, anonKey });
    document.getElementById('supabaseConfigDetails').open = false;
    showToast('✅ Đã lưu cấu hình Supabase! Giờ hãy nhập Mã phòng và bấm Kết nối.');
  });

  document.getElementById('btnConnectRoom').addEventListener('click', async () => {
    const input = document.getElementById('syncRoomCode');
    const code = normalizeRoomCode(input.value);
    input.value = code;
    if (!code || code.length < 3) {
      showToast('Mã phòng cần ít nhất 3 ký tự (chữ không dấu hoặc số).');
      return;
    }

    const res = await connectRoom(code, state);
    if (!res.ok) {
      if (res.reason === 'missing_config') {
        document.getElementById('supabaseConfigDetails').open = true;
        showToast('⚠️ Hãy điền Supabase URL & Anon Key trước khi kết nối.');
      } else if (res.reason === 'db_error') {
        showToast('❌ Lỗi Supabase: Hãy chắc chắn bạn đã chạy file supabase-setup.sql.');
      } else {
        showToast('❌ Không thể kết nối Supabase. Kiểm tra lại URL / Key và mạng.');
      }
      return;
    }

    updateSyncConnectedUI(res.roomCode);
    if (res.loadedRemote) {
      showToast(`☁️ Đã kết nối phòng "${res.roomCode}" và tải dữ liệu mới nhất!`);
    } else {
      showToast(`☁️ Đã tạo & đồng bộ phòng mới "${res.roomCode}" lên Supabase!`);
    }
  });

  document.getElementById('btnDisconnectRoom').addEventListener('click', async () => {
    await disconnectRoom();
    updateSyncConnectedUI(null);
    showToast('Đã ngắt đồng bộ đám mây (dữ liệu vẫn lưu trên máy này).');
  });

  document.getElementById('btnCopyRoomInvite').addEventListener('click', () => {
    const code = getActiveRoomCode();
    if (!code) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(code)}`;
    copyText(url, `🔗 Đã copy link mời vào phòng "${code}"! Gửi cho bạn cùng phòng nhé.`);
  });
}

function updateSyncStatusPill(status, label) {
  const pill = document.getElementById('btnSyncStatus');
  const text = document.getElementById('syncStatusText');
  if (!pill || !text) return;
  pill.className = `sync-pill ${status}`;
  text.textContent = label;
}

function updateSyncConnectedUI(roomCode) {
  const bar = document.getElementById('syncConnectedActions');
  const label = document.getElementById('syncConnectedRoomLabel');
  if (roomCode) {
    bar?.classList.remove('hidden');
    if (label) label.textContent = roomCode;
    document.getElementById('syncRoomCode').value = roomCode;
  } else {
    bar?.classList.add('hidden');
  }
}

async function initCloudSync() {
  const settings = loadSyncSettings();
  document.getElementById('supabaseUrlInput').value = settings.url || '';
  document.getElementById('supabaseKeyInput').value = settings.anonKey || '';
  if (settings.isHardcoded) {
    document.getElementById('supabaseConfigDetails')?.classList.add('hidden');
  } else if (!settings.url || !settings.anonKey) {
    document.getElementById('supabaseConfigDetails').open = true;
  }

  setSyncCallbacks({
    onStatusChange: (status, label) => updateSyncStatusPill(status, label),
    onRemoteData: (remoteData, { initial }) => {
      state = {
        roomName: remoteData.roomName || 'Phòng trọ của chúng mình',
        members: remoteData.members,
        months: remoteData.months || {},
      };
      pendingSharedState = null;
      saveState(true);
      renderAll();
      if (!initial) {
        showToast('☁️ Đã cập nhật dữ liệu mới từ bạn cùng phòng!');
      }
    },
  });

  const params = new URLSearchParams(window.location.search);
  const urlRoom = normalizeRoomCode(params.get('room') || '');
  const targetRoom = urlRoom || settings.roomCode;

  if (targetRoom) {
    document.getElementById('syncRoomCode').value = targetRoom;
    if (settings.url && settings.anonKey) {
      const res = await connectRoom(targetRoom, state);
      if (res.ok) {
        updateSyncConnectedUI(res.roomCode);
      }
    }
  } else if (settings.isHardcoded) {
    updateSyncStatusPill('offline', 'Chọn mã phòng');
  }
}

// Init
initTheme();
checkSharedUrl();
bindEvents();
document.getElementById('expenseDate').value = getDefaultDateForMonth(currentMonth);
renderAll();
initCloudSync();
