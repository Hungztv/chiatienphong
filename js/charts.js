import { CATEGORIES, formatVND, escapeHtml } from './utils.js';

export function renderCategoryDonut(container, categoryTotals, grandTotal) {
  if (!container) return;

  const entries = Object.entries(categoryTotals)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0 || grandTotal <= 0) {
    container.innerHTML = `<div class="empty-state">Chưa có dữ liệu chi tiêu trong tháng này để vẽ biểu đồ.</div>`;
    return;
  }

  const size = 176;
  const strokeWidth = 26;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const slices = entries.map(([key, value]) => {
    const meta = CATEGORIES[key] || CATEGORIES.other;
    const ratio = value / grandTotal;
    const dash = ratio * circumference;
    const slice = `
      <circle
        cx="${size / 2}"
        cy="${size / 2}"
        r="${radius}"
        fill="transparent"
        stroke="${meta.color}"
        stroke-width="${strokeWidth}"
        stroke-dasharray="${dash} ${circumference - dash}"
        stroke-dashoffset="${-offset}"
        transform="rotate(-90 ${size / 2} ${size / 2})"
      />
    `;
    offset += dash;
    return slice;
  });

  const legendItems = entries.map(([key, value]) => {
    const meta = CATEGORIES[key] || CATEGORIES.other;
    const pct = Math.round((value / grandTotal) * 100);
    return `
      <div class="legend-item">
        <div class="legend-left">
          <span class="legend-dot" style="background:${meta.color}"></span>
          <span>${meta.icon} ${escapeHtml(meta.label)}</span>
        </div>
        <span class="mono"><strong>${pct}%</strong> · ${formatVND(value)}</span>
      </div>
    `;
  });

  container.innerHTML = `
    <div class="donut-wrap">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-label="Biểu đồ cơ cấu chi tiêu">
        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="transparent" stroke="var(--border)" stroke-width="${strokeWidth}" />
        ${slices.join('')}
        <text x="50%" y="46%" text-anchor="middle" fill="var(--text-muted)" font-size="11" font-weight="600">TỔNG CHI</text>
        <text x="50%" y="58%" text-anchor="middle" fill="var(--text)" font-size="13" font-weight="700" font-family="var(--font-mono)">${formatShortVND(grandTotal)}</text>
      </svg>
      <div class="donut-legend">
        ${legendItems.join('')}
      </div>
    </div>
  `;
}

export function renderMemberBarChart(container, memberStats) {
  if (!container) return;

  const maxVal = Math.max(
    1,
    ...memberStats.map((s) => Math.max(s.paid, s.owed))
  );

  const hasData = memberStats.some((s) => s.paid > 0 || s.owed > 0);
  if (!hasData) {
    container.innerHTML = `<div class="empty-state">Thêm khoản chi hoặc hóa đơn để xem biểu đồ so sánh.</div>`;
    return;
  }

  const rows = memberStats.map((s) => {
    const paidPct = Math.round((s.paid / maxVal) * 100);
    const owedPct = Math.round((s.owed / maxVal) * 100);
    return `
      <div>
        <div class="bar-group-head">
          <span>${escapeHtml(s.member.name)}</span>
          <span class="mono muted">Ứng: ${formatVND(s.paid)} · Chịu: ${formatVND(s.owed)}</span>
        </div>
        <div class="bar-track" title="Đã ứng: ${formatVND(s.paid)}">
          <div class="bar-fill" style="width:${paidPct}%; background:${s.member.color}"></div>
        </div>
        <div class="bar-track" title="Phần phải chịu: ${formatVND(s.owed)}">
          <div class="bar-fill" style="width:${owedPct}%; background:var(--border-strong)"></div>
        </div>
      </div>
    `;
  });

  container.innerHTML = `
    <div class="bar-chart-list">
      ${rows.join('')}
      <div class="muted" style="font-size:0.78rem; margin-top:4px;">
        Thanh màu = Số tiền đã ứng trước &nbsp;|&nbsp; Thanh xám = Phần chi tiêu phải chịu
      </div>
    </div>
  `;
}

function formatShortVND(amount) {
  if (amount >= 1_000_000) {
    return (amount / 1_000_000).toFixed(2).replace(/\.00$/, '') + 'tr';
  }
  if (amount >= 1_000) {
    return Math.round(amount / 1_000) + 'k';
  }
  return amount + '₫';
}
