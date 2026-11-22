export const CATEGORIES = {
  food: { label: 'Ăn uống / Đi chợ', icon: '🛒', color: '#10b981' },
  household: { label: 'Đồ dùng phòng', icon: '🧴', color: '#f59e0b' },
  utilities: { label: 'Sinh hoạt chung', icon: '💡', color: '#0284c7' },
  fun: { label: 'Ăn chơi / Tụ tập', icon: '🎉', color: '#ec4899' },
  other: { label: 'Khác', icon: '📦', color: '#64748b' },
};

export const AVATAR_COLORS = [
  '#0f766e', '#2563eb', '#d97706', '#db2777', '#7c3aed', '#059669', '#dc2626', '#0891b2'
];

export function formatVND(amount) {
  const num = Math.round(Number(amount) || 0);
  return new Intl.NumberFormat('vi-VN').format(num) + ' ₫';
}

export function formatNumberInput(val) {
  const digits = String(val ?? '').replace(/[^\d]/g, '');
  if (!digits) return '';
  return new Intl.NumberFormat('vi-VN').format(Number(digits));
}

export function parseVND(val) {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const digits = String(val ?? '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getMonthKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function shiftMonthKey(monthKey, delta) {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return getMonthKey(d);
}

export function formatMonthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return `Tháng ${m}/${y}`;
}

export function getInitials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function computeMonthFinancials(state, monthKey) {
  const members = state.members || [];
  const memberIds = members.map((m) => m.id);
  const memberMap = Object.fromEntries(members.map((m) => [m.id, m]));

  const monthData = state.months[monthKey] || {
    expenses: [],
    settlements: [],
  };

  const expenses = monthData.expenses || [];
  const settlements = monthData.settlements || [];

  const paid = {};
  const owed = {};
  for (const id of memberIds) {
    paid[id] = 0;
    owed[id] = 0;
  }

  let grandTotal = 0;
  const categoryTotals = {
    food: 0,
    household: 0,
    utilities: 0,
    fun: 0,
    other: 0,
  };

  for (const exp of expenses) {
    const amt = parseVND(exp.amount);
    if (amt <= 0) continue;
    grandTotal += amt;
    const cat = categoryTotals[exp.category] !== undefined ? exp.category : 'other';
    categoryTotals[cat] += amt;

    if (paid[exp.payerId] !== undefined) {
      paid[exp.payerId] += amt;
    }

    if (exp.splitType === 'custom' && exp.customSplits) {
      for (const [mid, shareVal] of Object.entries(exp.customSplits)) {
        if (owed[mid] !== undefined) {
          owed[mid] += parseVND(shareVal);
        }
      }
    } else {
      const participants = (exp.participants || memberIds).filter((id) => owed[id] !== undefined);
      if (participants.length > 0) {
        const base = Math.floor(amt / participants.length);
        let rem = amt - base * participants.length;
        for (const pid of participants) {
          owed[pid] += base + (rem > 0 ? 1 : 0);
          if (rem > 0) rem -= 1;
        }
      }
    }
  }

  // Recorded settlements
  for (const s of settlements) {
    const amt = parseVND(s.amount);
    if (amt <= 0) continue;
    if (paid[s.fromId] !== undefined) paid[s.fromId] += amt;
    if (owed[s.toId] !== undefined) owed[s.toId] += amt;
  }

  // Balances & debt simplification
  const memberStats = members.map((m) => {
    const p = Math.round(paid[m.id] || 0);
    const o = Math.round(owed[m.id] || 0);
    return {
      member: m,
      paid: p,
      owed: o,
      balance: p - o,
    };
  });

  const debtors = memberStats
    .filter((s) => s.balance < -100)
    .map((s) => ({ id: s.member.id, amount: -s.balance }))
    .sort((a, b) => b.amount - a.amount);

  const creditors = memberStats
    .filter((s) => s.balance > 100)
    .map((s) => ({ id: s.member.id, amount: s.balance }))
    .sort((a, b) => b.amount - a.amount);

  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const payAmt = Math.min(d.amount, c.amount);
    if (payAmt > 100) {
      transfers.push({
        from: memberMap[d.id],
        to: memberMap[c.id],
        amount: Math.round(payAmt),
      });
    }
    d.amount -= payAmt;
    c.amount -= payAmt;
    if (d.amount <= 100) i++;
    if (c.amount <= 100) j++;
  }

  return {
    grandTotal,
    perPersonAvg: members.length > 0 ? Math.round(grandTotal / members.length) : 0,
    memberStats,
    transfers,
    categoryTotals,
    expensesCount: expenses.length,
    settlements,
  };
}

export function buildZaloSummary(state, monthKey) {
  const fin = computeMonthFinancials(state, monthKey);
  const monthData = state.months[monthKey] || {};
  const exps = monthData.expenses || [];
  const lines = [];

  lines.push(`🧾 TỔNG KẾT CHI TIÊU ${formatMonthLabel(monthKey).toUpperCase()}`);
  lines.push(`📍 ${state.roomName || 'Chi tiêu chung'}`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━`);

  if (exps.length === 0) {
    lines.push(`Chưa có khoản chi nào trong tháng này.`);
  } else {
    exps.slice(0, 20).forEach((e) => {
      const payer = state.members.find((m) => m.id === e.payerId)?.name || '?';
      lines.push(`• ${e.title}: ${formatVND(e.amount)} (${payer} trả)`);
    });
    if (exps.length > 20) {
      lines.push(`• ... và ${exps.length - 20} khoản khác`);
    }
  }

  lines.push('');
  lines.push(`💰 Tổng chi (${fin.expensesCount} khoản): ${formatVND(fin.grandTotal)}`);
  lines.push(`👤 Bình quân mỗi người: ${formatVND(fin.perPersonAvg)}`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`✅ CHỐT CHUYỂN KHOẢN:`);

  if (fin.transfers.length === 0) {
    lines.push(`🎉 Hai bạn đã cân bằng, không ai nợ ai!`);
  } else {
    fin.transfers.forEach((t) => {
      lines.push(`👉 ${t.from.name} chuyển cho ${t.to.name}: ${formatVND(t.amount)}`);
    });
  }

  return lines.join('\n');
}

export function createDemoState(monthKey) {
  const m1 = { id: 'm_1', name: 'Bạn A', color: '#0f766e' };
  const m2 = { id: 'm_2', name: 'Bạn B', color: '#2563eb' };
  const [y, m] = monthKey.split('-');
  const d = (day) => `${y}-${m}-${String(day).padStart(2, '0')}`;

  return {
    roomName: 'Chi tiêu chung phòng trọ',
    members: [m1, m2],
    months: {
      [monthKey]: {
        expenses: [
          {
            id: uid('exp'),
            title: 'Đi chợ mua thịt, rau, trứng',
            amount: 240000,
            date: d(5),
            category: 'food',
            payerId: 'm_2',
            splitType: 'equal',
            participants: ['m_1', 'm_2'],
            note: 'Bách Hóa Xanh',
          },
          {
            id: uid('exp'),
            title: 'Nước giặt + giấy vệ sinh',
            amount: 160000,
            date: d(9),
            category: 'household',
            payerId: 'm_1',
            splitType: 'equal',
            participants: ['m_1', 'm_2'],
            note: '',
          },
          {
            id: uid('exp'),
            title: 'Đổi 2 bình nước uống 20L',
            amount: 40000,
            date: d(14),
            category: 'utilities',
            payerId: 'm_2',
            splitType: 'equal',
            participants: ['m_1', 'm_2'],
            note: '',
          },
        ],
        settlements: [],
      },
    },
  };
}
