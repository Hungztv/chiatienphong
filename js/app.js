import {
  AVATAR_COLORS,
  CATEGORIES,
  buildZaloSummary,
  computeMonthFinancials,
  escapeHtml,
  formatMonthLabel,
  formatNumberInput,
  formatShortDate,
  formatVND,
  getInitials,
  getMonthKey,
  parseVND,
  shiftMonthKey,
  uid,
} from './utils.js';
import { renderCategoryDonut, renderMemberBarChart } from './charts.js';
import { schedulePushState, setSyncCallbacks, startAutoSync } from './sync.js';

const STORAGE_KEY = 'troshare_state_v3';
const THEME_KEY = 'troshare_theme_v1';

// Clean up older keys
try {
  localStorage.removeItem('troshare_state_v1');
  localStorage.removeItem('troshare_state_v2');
  localStorage.removeItem('troshare_sync_settings_v1');
} catch {}

let state = loadState();
let currentMonth = getMonthKey(new Date());
let currentSplitType = 'equal';

function createDefaultState() {
  return {
    roomName: 'Chi tiêu chung phòng trọ',
    members: [
      { id: 'm_1', name: 'Bạn A', color: '#0f766e' },
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!skipCloudPush) {
    schedulePushState(state);
  }
}

function ensureMonth(monthKey) {
  if (!state.months[monthKey]) {
    state.months[monthKey] = {
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
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// Theme
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  document.getElementById('iconSun')?.classList.toggle('hidden', theme !== 'dark');
  document.getElementById('iconMoon')?.classList.toggle('hidden', theme === 'dark');
}

function updateSyncStatusPill(status, label) {
  const pill = document.getElementById('syncStatusPill');
  const text = document.getElementById('syncStatusText');
  if (!pill || !text) return;
  pill.className = `sync-pill ${status}`;
  text.textContent = label;
}

// Render all
function renderAll() {
  ensureMonth(currentMonth);

  document.getElementById('roomNameDisplay').textContent = state.roomName || 'Chi tiêu chung phòng trọ';
  document.getElementById('roomNameInput').value = state.roomName || '';
  document.getElementById('currentMonthLabel').textContent = formatMonthLabel(currentMonth);

  renderOverview();
  renderMemberSelects();
  renderCategoryPills();
  renderSplitParticipants();
  renderExpenseList();
  renderMembersSettings();
}

function renderOverview() {
  const fin = computeMonthFinancials(state, currentMonth);

  document.getElementById('kpiTotal').textContent = formatVND(fin.grandTotal);
  document.getElementById('kpiPerPerson').textContent = formatVND(fin.perPersonAvg);
  document.getElementById('kpiCount').textContent = `${fin.expensesCount} khoản`;

  // Settlement Transfers
  const settlementList = document.getElementById('settlementList');
  if (fin.transfers.length === 0) {
    settlementList.innerHTML = `
      <div class="settlement-empty">
        🎉 Hiện tại hai bạn đã cân bằng, không ai nợ ai!
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
        <div class="settlement-right">
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
            <button class="btn btn-ghost btn-sm" data-undo-settlement="${s.id}">Hoàn tác</button>
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

  // Recent expenses preview (top 3)
  renderRecentExpenses();

  // Charts
  renderCategoryDonut(document.getElementById('categoryChartContainer'), fin.categoryTotals, fin.grandTotal);
  renderMemberBarChart(document.getElementById('memberBarChartContainer'), fin.memberStats);
}

function renderRecentExpenses() {
  const monthData = ensureMonth(currentMonth);
  const recent = [...(monthData.expenses || [])]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 3);

  const listEl = document.getElementById('recentExpenseList');
  if (!listEl) return;

  if (recent.length === 0) {
    listEl.innerHTML = `<div class="empty-state compact">Chưa có khoản chi nào. Bấm <strong>+ Thêm chi</strong> ở trên để bắt đầu nhé!</div>`;
    return;
  }

  listEl.innerHTML = recent
    .map((e) => {
      const cat = CATEGORIES[e.category] || CATEGORIES.other;
      const payer = state.members.find((m) => m.id === e.payerId);
      return `
        <div class="expense-item compact">
          <div class="expense-left">
            <div class="expense-cat-badge" style="background:${cat.bg}; border-color:transparent;">${cat.icon}</div>
            <div>
              <div class="expense-title">${escapeHtml(e.title)}</div>
              <div class="expense-meta">
                <span>${formatShortDate(e.date)}</span> ·
                <span class="payer-inline"><span class="payer-dot" style="background:${payer?.color || '#64748b'}"></span>${escapeHtml(payer?.name || '?')} trả</span>
              </div>
            </div>
          </div>
          <div class="expense-amount mono">${formatVND(e.amount)}</div>
        </div>
      `;
    })
    .join('');
}

function renderMemberSelects() {
  const payerInput = document.getElementById('expensePayer');
  const filterPayer = document.getElementById('filterPayer');
  const payerGroup = document.getElementById('payerPillGroup');

  const prevPayer = payerInput.value;
  const activePayer = state.members.some((m) => m.id === prevPayer) ? prevPayer : state.members[0]?.id || '';
  payerInput.value = activePayer;

  if (payerGroup) {
    payerGroup.innerHTML = state.members
      .map(
        (m) => `
      <button type="button" class="payer-pill ${m.id === activePayer ? 'active' : ''}" data-select-payer="${m.id}">
        <span class="avatar avatar-sm" style="background:${m.color}">${escapeHtml(getInitials(m.name))}</span>
        <span>${escapeHtml(m.name)}</span>
      </button>
    `
      )
      .join('');
  }

  const prevFilterPayer = filterPayer.value;
  const memberOpts = state.members
    .map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`)
    .join('');
  filterPayer.innerHTML = `<option value="all">Tất cả người trả</option>${memberOpts}`;
  if (prevFilterPayer === 'all' || state.members.some((m) => m.id === prevFilterPayer)) {
    filterPayer.value = prevFilterPayer;
  }
}

function renderCategoryPills() {
  const grid = document.getElementById('categoryPillGrid');
  const catInput = document.getElementById('expenseCategory');
  if (!grid || !catInput) return;
  const activeCat = catInput.value || 'food';

  grid.innerHTML = Object.entries(CATEGORIES)
    .map(
      ([key, meta]) => `
    <button type="button" class="cat-pill ${key === activeCat ? 'active' : ''}" data-select-category="${key}" style="--cat-color:${meta.color}; --cat-bg:${meta.bg}">
      <span class="cat-pill-icon">${meta.icon}</span>
      <span class="cat-pill-label">${escapeHtml(meta.short)}</span>
    </button>
  `
    )
    .join('');
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
      `<div class="split-status"><span>Chia đều</span><span id="splitEqualInfo" class="mono"></span></div>`;
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
    listEl.innerHTML = `<div class="empty-state">Chưa có khoản chi nào trong ${formatMonthLabel(currentMonth)}.<br/>Thêm khoản đầu tiên ở trên nhé!</div>`;
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
            <div class="expense-cat-badge" style="background:${cat.bg}; border-color:transparent;" title="${escapeHtml(cat.label)}">${cat.icon}</div>
            <div>
              <div class="expense-title">${escapeHtml(e.title)}</div>
              <div class="expense-meta">
                <span>${formatShortDate(e.date)}</span> ·
                <span class="payer-inline"><span class="payer-dot" style="background:${payer?.color || '#64748b'}"></span><strong>${escapeHtml(payer?.name || '?')}</strong> trả</span> ·
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

function resetExpenseForm() {
  document.getElementById('expenseForm').reset();
  document.getElementById('expenseId').value = '';
  document.getElementById('expenseCategory').value = 'food';
  document.getElementById('expenseFormTitle').textContent = 'Thêm khoản chi mới';
  document.getElementById('btnSubmitExpense').textContent = '+ Lưu khoản chi';
  document.getElementById('btnCancelEditExpense').classList.add('hidden');
  document.getElementById('expenseDate').value = getDefaultDateForMonth(currentMonth);
  currentSplitType = 'equal';
  document.querySelectorAll('#splitTypeControl .seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.split === 'equal');
  });
  renderMemberSelects();
  renderCategoryPills();
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

function bindEvents() {
  // Tabs
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('btnQuickAddFromOverview').addEventListener('click', () => {
    switchTab('expenses');
    setTimeout(() => document.getElementById('expenseAmount').focus(), 120);
  });

  document.getElementById('btnViewAllExpenses')?.addEventListener('click', () => {
    switchTab('expenses');
  });

  // Visual Payer & Category pill selectors
  document.getElementById('payerPillGroup').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-select-payer]');
    if (!btn) return;
    document.getElementById('expensePayer').value = btn.dataset.selectPayer;
    renderMemberSelects();
  });

  document.getElementById('categoryPillGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-select-category]');
    if (!btn) return;
    document.getElementById('expenseCategory').value = btn.dataset.selectCategory;
    renderCategoryPills();
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

  // Zalo Summary Modal
  document.getElementById('btnCopyZalo').addEventListener('click', () => {
    document.getElementById('zaloSummaryText').value = buildZaloSummary(state, currentMonth);
    document.getElementById('zaloModal').classList.remove('hidden');
  });

  document.getElementById('btnConfirmCopyZalo').addEventListener('click', () => {
    const text = document.getElementById('zaloSummaryText').value;
    copyText(text, '📋 Đã copy tổng kết! Dán vào Zalo ngay nhé.');
    document.getElementById('zaloModal').classList.add('hidden');
  });

  document.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', () => {
      document.getElementById(el.dataset.closeModal)?.classList.add('hidden');
    });
  });

  // Format currency input
  const amountEl = document.getElementById('expenseAmount');
  amountEl.addEventListener('input', () => {
    amountEl.value = formatNumberInput(amountEl.value);
    updateEqualSplitPreview();
    updateCustomSplitStatus();
  });

  // Quick amount chips
  document.querySelectorAll('.quick-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const cur = parseVND(amountEl.value);
      let next = cur;
      if (chip.dataset.addAmount) {
        next = cur + Number(chip.dataset.addAmount);
      } else if (chip.dataset.mul1000) {
        next = cur > 0 ? cur * 1000 : 1000;
      }
      amountEl.value = formatNumberInput(next);
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
    const amount = parseVND(amountEl.value);
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
      showToast('✅ Đã lưu & đồng bộ khoản chi!');
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
      amountEl.value = formatNumberInput(exp.amount);
      document.getElementById('expenseDate').value = exp.date;
      document.getElementById('expenseCategory').value = exp.category;
      document.getElementById('expensePayer').value = exp.payerId;
      document.getElementById('expenseNote').value = exp.note || '';
      currentSplitType = exp.splitType === 'custom' ? 'custom' : 'equal';
      document.querySelectorAll('#splitTypeControl .seg-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.split === currentSplitType);
      });
      renderMemberSelects();
      renderCategoryPills();
      renderSplitParticipants(exp);
      document.getElementById('expenseFormTitle').textContent = 'Chỉnh sửa khoản chi';
      document.getElementById('btnSubmitExpense').textContent = '💾 Cập nhật khoản chi';
      document.getElementById('btnCancelEditExpense').classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      document.getElementById('expenseTitle').focus();
    } else if (delBtn) {
      if (!confirm('Bạn có chắc muốn xóa khoản chi này?')) return;
      monthData.expenses = monthData.expenses.filter((x) => x.id !== delBtn.dataset.deleteExpense);
      saveState();
      renderAll();
      showToast('🗑️ Đã xóa khoản chi.');
    }
  });

  // Settlement actions
  document.getElementById('settlementList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-settle-from]');
    if (!btn) return;
    const fromId = btn.dataset.settleFrom;
    const toId = btn.dataset.settleTo;
    const amount = Number(btn.dataset.settleAmount);
    const fromName = state.members.find((m) => m.id === fromId)?.name || '?';
    const toName = state.members.find((m) => m.id === toId)?.name || '?';

    if (!confirm(`Xác nhận ${fromName} đã chuyển ${formatVND(amount)} cho ${toName}?`)) return;
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
    showToast('✅ Đã chốt thanh toán!');
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

  // Settings: Room name
  document.getElementById('btnSaveRoomName').addEventListener('click', () => {
    const name = document.getElementById('roomNameInput').value.trim();
    state.roomName = name || 'Chi tiêu chung phòng trọ';
    saveState();
    renderAll();
    showToast('Đã cập nhật tên nhóm.');
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
    showToast('Đã cập nhật thành viên.');
  });

  document.getElementById('membersList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-member]');
    if (!btn) return;
    if (state.members.length <= 1) {
      showToast('Cần ít nhất 1 thành viên.');
      return;
    }
    const target = state.members.find((m) => m.id === btn.dataset.removeMember);
    if (!confirm(`Xóa "${target?.name}" khỏi danh sách?`)) return;
    state.members = state.members.filter((m) => m.id !== btn.dataset.removeMember);
    saveState();
    renderAll();
    showToast('Đã xóa thành viên.');
  });

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
    showToast(`👋 Đã thêm ${name}!`);
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
    showToast('📥 Đã tải file sao lưu JSON.');
  });

  document.getElementById('inputImportJson').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || !Array.isArray(parsed.members) || parsed.members.length === 0) {
          throw new Error('Invalid');
        }
        state = parsed;
        saveState();
        renderAll();
        showToast('✅ Đã khôi phục & đồng bộ từ JSON!');
      } catch {
        showToast('❌ File JSON không hợp lệ.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // Reset all
  document.getElementById('btnResetAll').addEventListener('click', () => {
    if (!confirm('Xóa toàn bộ dữ liệu chi tiêu của cả 2 máy về 0?')) return;
    state = createDefaultState();
    saveState();
    resetExpenseForm();
    renderAll();
    showToast('🗑️ Đã xóa toàn bộ dữ liệu về 0.');
  });
}

// Auto-sync init
setSyncCallbacks({
  onStatusChange: (status, label) => updateSyncStatusPill(status, label),
  onRemoteData: (remoteData, { initial }) => {
    state = {
      roomName: remoteData.roomName || 'Chi tiêu chung phòng trọ',
      members: remoteData.members,
      months: remoteData.months || {},
    };
    saveState(true);
    renderAll();
    if (!initial) {
      showToast('☁️ Đã cập nhật dữ liệu mới!');
    }
  },
});

initTheme();
bindEvents();
document.getElementById('expenseDate').value = getDefaultDateForMonth(currentMonth);
renderAll();
startAutoSync(state);
