export const CATEGORIES = {
  fixed_rent: { label: 'Tiền phòng', icon: '🏠', color: '#0f766e' },
  fixed_utility: { label: 'Điện nước & dịch vụ', icon: '⚡', color: '#0284c7' },
  food: { label: 'Ăn uống / Đi chợ', icon: '🛒', color: '#10b981' },
  household: { label: 'Đồ dùng phòng', icon: '🧴', color: '#f59e0b' },
  utilities: { label: 'Sinh hoạt chung', icon: '💡', color: '#6366f1' },
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

export function defaultFixedBill(memberCount = 2) {
  return {
    includeInSettlement: true,
    payerId: 'split_self', // 'split_self' or a member id
    rent: 0,
    elecOld: '',
    elecNew: '',
    elecRate: 0,
    waterMode: 'per_person', // 'per_person' | 'meter'
    waterPerPersonRate: 0,
    waterPersonCount: memberCount,
    waterOld: '',
    waterNew: '',
    waterMeterRate: 0,
    wifi: 0,
    trash: 0,
    parking: 0,
    note: '',
  };
}

export function computeFixedBill(fixed, memberCount = 2) {
  if (!fixed) {
    return {
      rent: 0, elecUsage: 0, elecTotal: 0, waterUsage: 0, waterTotal: 0,
      wifi: 0, trash: 0, parking: 0, utilitiesTotal: 0, total: 0, perPerson: 0
    };
  }
  const rent = parseVND(fixed.rent);
  const elecOld = Number(fixed.elecOld) || 0;
  const elecNew = Number(fixed.elecNew) || 0;
  const elecUsage = elecNew > elecOld ? Number((elecNew - elecOld).toFixed(2)) : 0;
  const elecRate = parseVND(fixed.elecRate);
  const elecTotal = Math.round(elecUsage * elecRate);

  let waterUsage = 0;
  let waterTotal = 0;
  if (fixed.waterMode === 'meter') {
    const wOld = Number(fixed.waterOld) || 0;
    const wNew = Number(fixed.waterNew) || 0;
    waterUsage = wNew > wOld ? Number((wNew - wOld).toFixed(2)) : 0;
    waterTotal = Math.round(waterUsage * parseVND(fixed.waterMeterRate));
  } else {
    const count = Math.max(1, Number(fixed.waterPersonCount) || memberCount);
    waterTotal = Math.round(count * parseVND(fixed.waterPerPersonRate));
  }

  const wifi = parseVND(fixed.wifi);
  const trash = parseVND(fixed.trash);
  const parking = parseVND(fixed.parking);
  const utilitiesTotal = elecTotal + waterTotal + wifi + trash + parking;
  const total = rent + utilitiesTotal;
  const perPerson = memberCount > 0 ? Math.round(total / memberCount) : 0;

  return {
    rent, elecUsage, elecTotal, waterUsage, waterTotal,
    wifi, trash, parking, utilitiesTotal, total, perPerson
  };
}

export function computeMonthFinancials(state, monthKey) {
  const members = state.members || [];
  const memberIds = members.map((m) => m.id);
  const memberMap = Object.fromEntries(members.map((m) => [m.id, m]));

  const monthData = state.months[monthKey] || {
    fixed: defaultFixedBill(members.length),
    expenses: [],
    settlements: [],
  };

  const fixedCalc = computeFixedBill(monthData.fixed, members.length);
  const expenses = monthData.expenses || [];
  const settlements = monthData.settlements || [];

  const paid = {};
  const owed = {};
  for (const id of memberIds) {
    paid[id] = 0;
    owed[id] = 0;
  }

  // 1. Fixed bills
  const includeFixed = monthData.fixed?.includeInSettlement !== false;
  if (includeFixed && fixedCalc.total > 0 && members.length > 0) {
    const baseShare = Math.floor(fixedCalc.total / members.length);
    let remainder = fixedCalc.total - baseShare * members.length;

    members.forEach((m) => {
      const share = baseShare + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      owed[m.id] += share;
      if (!monthData.fixed.payerId || monthData.fixed.payerId === 'split_self' || !memberMap[monthData.fixed.payerId]) {
        paid[m.id] += share;
      }
    });

    if (monthData.fixed.payerId && monthData.fixed.payerId !== 'split_self' && memberMap[monthData.fixed.payerId]) {
      paid[monthData.fixed.payerId] += fixedCalc.total;
    }
  }

  // 2. Shared expenses
  let sharedTotal = 0;
  const categoryTotals = {
    fixed_rent: fixedCalc.rent,
    fixed_utility: fixedCalc.utilitiesTotal,
    food: 0,
    household: 0,
    utilities: 0,
    fun: 0,
    other: 0,
  };

  for (const exp of expenses) {
    const amt = parseVND(exp.amount);
    if (amt <= 0) continue;
    sharedTotal += amt;
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

  // 3. Recorded settlements
  for (const s of settlements) {
    const amt = parseVND(s.amount);
    if (amt <= 0) continue;
    if (paid[s.fromId] !== undefined) paid[s.fromId] += amt;
    if (owed[s.toId] !== undefined) owed[s.toId] += amt;
  }

  // 4. Balances & debt simplification
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

  const grandTotal = fixedCalc.total + sharedTotal;

  return {
    fixedCalc,
    sharedTotal,
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
  const fixed = monthData.fixed || defaultFixedBill(state.members.length);
  const lines = [];

  lines.push(`🏠 TỔNG KẾT TIỀN TRỌ ${formatMonthLabel(monthKey).toUpperCase()}`);
  lines.push(`📍 ${state.roomName || 'Phòng trọ'}`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━`);

  if (fin.fixedCalc.total > 0) {
    lines.push(`📌 1. TIỀN PHÒNG & ĐIỆN NƯỚC: ${formatVND(fin.fixedCalc.total)}`);
    if (fin.fixedCalc.rent > 0) lines.push(`   • Tiền phòng: ${formatVND(fin.fixedCalc.rent)}`);
    if (fin.fixedCalc.elecTotal > 0) {
      lines.push(`   • Điện: ${fixed.elecOld} → ${fixed.elecNew} (${fin.fixedCalc.elecUsage} kWh × ${formatVND(fixed.elecRate)}) = ${formatVND(fin.fixedCalc.elecTotal)}`);
    }
    if (fin.fixedCalc.waterTotal > 0) {
      if (fixed.waterMode === 'meter') {
        lines.push(`   • Nước: ${fixed.waterOld} → ${fixed.waterNew} (${fin.fixedCalc.waterUsage} m³) = ${formatVND(fin.fixedCalc.waterTotal)}`);
      } else {
        lines.push(`   • Nước (${fixed.waterPersonCount} người): ${formatVND(fin.fixedCalc.waterTotal)}`);
      }
    }
    if (fin.fixedCalc.wifi > 0) lines.push(`   • Wi-Fi: ${formatVND(fin.fixedCalc.wifi)}`);
    if (fin.fixedCalc.trash > 0) lines.push(`   • Rác/VS: ${formatVND(fin.fixedCalc.trash)}`);
    if (fin.fixedCalc.parking > 0) lines.push(`   • Gửi xe/Khác: ${formatVND(fin.fixedCalc.parking)}`);
    lines.push(`   👉 Chia đều cố định: ${formatVND(fin.fixedCalc.perPerson)} / người`);
    lines.push('');
  }

  lines.push(`🛒 2. CHI TIÊU CHUNG (${fin.expensesCount} khoản): ${formatVND(fin.sharedTotal)}`);
  const exps = monthData.expenses || [];
  exps.slice(0, 12).forEach((e) => {
    const payer = state.members.find((m) => m.id === e.payerId)?.name || '?';
    lines.push(`   • ${e.title}: ${formatVND(e.amount)} (${payer} trả)`);
  });
  if (exps.length > 12) {
    lines.push(`   • ... và ${exps.length - 12} khoản khác`);
  }
  lines.push('');

  lines.push(`💰 TỔNG CHI THÁNG NÀY: ${formatVND(fin.grandTotal)}`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`✅ CHỐT CHUYỂN KHOẢN:`);

  if (fin.transfers.length === 0) {
    lines.push(`🎉 Mọi người đã cân bằng, không ai nợ ai!`);
  } else {
    fin.transfers.forEach((t) => {
      lines.push(`👉 ${t.from.name} chuyển cho ${t.to.name}: ${formatVND(t.amount)}`);
    });
  }

  return lines.join('\n');
}

export function encodeStateToHash(state) {
  const json = JSON.stringify(state);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeStateFromHash(encoded) {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
}

export function createDemoState(monthKey) {
  const m1 = { id: 'm_1', name: 'Minh (Tôi)', color: '#0f766e' };
  const m2 = { id: 'm_2', name: 'Nam', color: '#2563eb' };
  const [y, m] = monthKey.split('-');
  const d = (day) => `${y}-${m}-${String(day).padStart(2, '0')}`;

  return {
    roomName: 'Phòng 302 — Trọ Minh & Nam',
    members: [m1, m2],
    months: {
      [monthKey]: {
        fixed: {
          includeInSettlement: true,
          payerId: 'm_1',
          rent: 3500000,
          elecOld: 1240,
          elecNew: 1365,
          elecRate: 3800,
          waterMode: 'per_person',
          waterPerPersonRate: 100000,
          waterPersonCount: 2,
          waterOld: '',
          waterNew: '',
          waterMeterRate: 20000,
          wifi: 100000,
          trash: 30000,
          parking: 100000,
          note: '2 xe máy, Minh chuyển khoản chủ trọ',
        },
        expenses: [
          {
            id: uid('exp'),
            title: 'Đi chợ mua thịt, rau, trứng tuần 1',
            amount: 285000,
            date: d(4),
            category: 'food',
            payerId: 'm_2',
            splitType: 'equal',
            participants: ['m_1', 'm_2'],
            note: 'Bách Hóa Xanh',
          },
          {
            id: uid('exp'),
            title: 'Mua nước giặt + nước rửa chén + giấy vệ sinh',
            amount: 190000,
            date: d(8),
            category: 'household',
            payerId: 'm_1',
            splitType: 'equal',
            participants: ['m_1', 'm_2'],
            note: '',
          },
          {
            id: uid('exp'),
            title: 'Đổi bình nước uống 20L (2 bình)',
            amount: 40000,
            date: d(12),
            category: 'utilities',
            payerId: 'm_2',
            splitType: 'equal',
            participants: ['m_1', 'm_2'],
            note: '',
          },
          {
            id: uid('exp'),
            title: 'Ăn lẩu cuối tuần tại phòng',
            amount: 340000,
            date: d(16),
            category: 'fun',
            payerId: 'm_2',
            splitType: 'equal',
            participants: ['m_1', 'm_2'],
            note: 'Nước lẩu + bò mỹ + nấm',
          },
          {
            id: uid('exp'),
            title: 'Mua gạo ST25 5kg & dầu ăn',
            amount: 215000,
            date: d(19),
            category: 'food',
            payerId: 'm_1',
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
