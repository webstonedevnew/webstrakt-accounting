/* ============================================================
   Webstrakt · Revenue & Cost Tracker
   Self-contained app: state + recurrence expansion + charts.
   ============================================================ */

const STORE_KEY = 'webstrakt_tracker_v1';

const DEFAULT_SETTINGS = {
  currency: 'EUR',
  theme: 'dark',
  period: 'month',     // summary period: week | month | year | all
  granularity: 'monthly', // time-series: weekly | monthly
  range: 12,           // number of buckets shown in time-series
};

const CATEGORY_SUGGESTIONS = {
  revenue: ['Project', 'Retainer', 'Maintenance', 'Hosting', 'Consulting', 'Design', 'Other'],
  cost: ['Hosting', 'Domains', 'Software / SaaS', 'Contractors', 'Marketing', 'Equipment', 'Office', 'Taxes', 'Fees', 'Other'],
};

const PALETTE = ['#818cf8', '#38bdf8', '#34d399', '#fbbf24', '#fb7185', '#a78bfa', '#2dd4bf', '#f472b6', '#60a5fa', '#facc15', '#4ade80', '#f97316'];

let state = { entries: [], settings: { ...DEFAULT_SETTINGS } };
let charts = {};

/* ---------- persistence ---------- */
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      state.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
    }
  } catch (e) { console.warn('Failed to load state', e); }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { console.warn('Failed to save state', e); }
}

/* ---------- date helpers (local, no TZ surprises) ---------- */
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function toISODate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function addWeeks(d, n) { return addDays(d, n * 7); }
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function addMonths(d, n) {
  const day = d.getDate();
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1);
  r.setDate(Math.min(day, daysInMonth(r.getFullYear(), r.getMonth())));
  return r;
}
function addYears(d, n) { return addMonths(d, n * 12); }
function startOfWeek(d) { const r = new Date(d); const off = (r.getDay() + 6) % 7; r.setDate(r.getDate() - off); r.setHours(0, 0, 0, 0); return r; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function startOfYear(d) { return new Date(d.getFullYear(), 0, 1); }
function endOfYear(d) { return new Date(d.getFullYear(), 11, 31); }
function today0() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtMonthLabel(d) { return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`; }
function fmtWeekLabel(d) { return `${MONTHS[d.getMonth()]} ${d.getDate()}`; }

/* ---------- money ---------- */
function fmtMoney(n) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency, maximumFractionDigits: 2 }).format(n || 0);
}
function fmtMoney0(n) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency, maximumFractionDigits: 0 }).format(n || 0);
}
function fmtCompact(n) {
  const sym = (0).toLocaleString(undefined, { style: 'currency', currency: state.settings.currency }).replace(/[\d.,\s]/g, '');
  return sym + new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/* ---------- recurrence expansion ---------- */
// Returns array of Date occurrences of `entry` within [winStart, winEnd].
function occurrences(entry, winStart, winEnd) {
  const out = [];
  const start = parseDate(entry.date);
  const hardEnd = entry.endDate ? parseDate(entry.endDate) : null;
  const limit = hardEnd && hardEnd < winEnd ? hardEnd : winEnd;

  if (entry.recurrence === 'once') {
    if (start >= winStart && start <= winEnd) out.push(start);
    return out;
  }
  const MAX = 20000;
  for (let i = 0; i < MAX; i++) {
    let cur;
    if (entry.recurrence === 'weekly') cur = addWeeks(start, i);
    else if (entry.recurrence === 'monthly') cur = addMonths(start, i);
    else if (entry.recurrence === 'yearly') cur = addYears(start, i);
    else break;
    if (cur > limit) break;
    if (cur >= winStart) out.push(cur);
  }
  return out;
}

/* ---------- aggregation ---------- */
function periodWindow(period) {
  const t = today0();
  if (period === 'week') return [startOfWeek(t), addDays(startOfWeek(t), 6)];
  if (period === 'month') return [startOfMonth(t), endOfMonth(t)];
  if (period === 'year') return [startOfYear(t), endOfYear(t)];
  // all-time: earliest entry start → today
  let earliest = t;
  for (const e of state.entries) { const d = parseDate(e.date); if (d < earliest) earliest = d; }
  return [earliest, t];
}

function periodTotals(period) {
  const [s, e] = periodWindow(period);
  let revenue = 0, cost = 0;
  for (const en of state.entries) {
    const occ = occurrences(en, s, e);
    const sum = occ.length * en.amount;
    if (en.kind === 'revenue') revenue += sum; else cost += sum;
  }
  return { revenue, cost, net: revenue - cost };
}

function categoryBreakdown(kind, period) {
  const [s, e] = periodWindow(period);
  const map = {};
  for (const en of state.entries) {
    if (en.kind !== kind) continue;
    const occ = occurrences(en, s, e);
    if (!occ.length) continue;
    const key = (en.category || '').trim() || 'Uncategorized';
    map[key] = (map[key] || 0) + occ.length * en.amount;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

// Monthly-equivalent of active recurring entries (MRR / recurring burn).
function recurringMonthly(kind) {
  const t = today0();
  let total = 0;
  for (const en of state.entries) {
    if (en.kind !== kind || en.recurrence === 'once') continue;
    const start = parseDate(en.date);
    const end = en.endDate ? parseDate(en.endDate) : null;
    if (start > t) continue;
    if (end && end < t) continue;
    if (en.recurrence === 'weekly') total += en.amount * 52 / 12;
    else if (en.recurrence === 'monthly') total += en.amount;
    else if (en.recurrence === 'yearly') total += en.amount / 12;
  }
  return total;
}

function buildSeries() {
  const gran = state.settings.granularity;
  const count = state.settings.range;
  const t = today0();
  const buckets = [];
  if (gran === 'monthly') {
    const cm = startOfMonth(t);
    for (let k = count - 1; k >= 0; k--) {
      const s = addMonths(cm, -k);
      buckets.push({ start: s, end: endOfMonth(s), label: fmtMonthLabel(s) });
    }
  } else {
    const cw = startOfWeek(t);
    for (let k = count - 1; k >= 0; k--) {
      const s = addWeeks(cw, -k);
      buckets.push({ start: s, end: addDays(s, 6), label: fmtWeekLabel(s) });
    }
  }
  const winStart = buckets[0].start, winEnd = buckets[buckets.length - 1].end;
  const rev = new Array(buckets.length).fill(0);
  const cost = new Array(buckets.length).fill(0);

  const findBucket = (date) => {
    for (let i = 0; i < buckets.length; i++) if (date >= buckets[i].start && date <= buckets[i].end) return i;
    return -1;
  };
  for (const en of state.entries) {
    for (const d of occurrences(en, winStart, winEnd)) {
      const idx = findBucket(d);
      if (idx < 0) continue;
      if (en.kind === 'revenue') rev[idx] += en.amount; else cost[idx] += en.amount;
    }
  }
  const net = rev.map((r, i) => r - cost[i]);
  let run = 0; const cum = net.map(n => (run += n));
  return { labels: buckets.map(b => b.label), rev, cost, net, cum };
}

/* ---------- chart theme ---------- */
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function chartTheme() {
  return {
    text: cssVar('--text-muted'),
    grid: cssVar('--grid'),
    rev: cssVar('--rev'),
    cost: cssVar('--cost'),
    accent: cssVar('--accent'),
    accent2: cssVar('--accent-2'),
    surface: cssVar('--surface'),
    border: cssVar('--border-strong'),
  };
}
function destroyChart(key) { if (charts[key]) { charts[key].destroy(); delete charts[key]; } }

/* ---------- rendering: summary ---------- */
function renderSummary() {
  const p = state.settings.period;
  const cur = periodTotals(p);

  setText('sumRevenue', fmtMoney(cur.revenue));
  setText('sumCost', fmtMoney(cur.cost));
  const netEl = document.getElementById('sumNet');
  netEl.textContent = fmtMoney(cur.net);
  netEl.className = 'card-value ' + (cur.net >= 0 ? 'value-pos' : 'value-neg');

  const margin = cur.revenue > 0 ? (cur.net / cur.revenue) * 100 : 0;
  const marEl = document.getElementById('sumMargin');
  marEl.textContent = cur.revenue > 0 ? margin.toFixed(1) + '%' : '—';
  marEl.className = 'card-value ' + (margin >= 0 ? 'value-pos' : 'value-neg');

  const mrr = recurringMonthly('revenue');
  const burn = recurringMonthly('cost');
  setText('sumMrr', fmtMoney(mrr));
  setText('sumBurn', fmtMoney(burn));

  const periodLabel = { week: 'this week', month: 'this month', year: 'this year', all: 'all time' }[p];
  setText('sumRevenueFoot', periodLabel);
  setText('sumCostFoot', periodLabel);
  setText('sumNetFoot', `${cur.net >= 0 ? 'profit' : 'loss'} · ${periodLabel}`);
  setText('sumMarginFoot', periodLabel);

  const recurNet = mrr - burn;
  const mrrFoot = document.getElementById('sumMrrFoot');
  mrrFoot.innerHTML = `net recurring <span class="${recurNet >= 0 ? 'up' : 'down'}">${fmtMoney0(recurNet)}/mo</span>`;
  setText('sumBurnFoot', `${fmtMoney0(burn * 12)}/yr`);
}

/* ---------- rendering: charts ---------- */
function renderSeriesChart() {
  destroyChart('series');
  const ctx = document.getElementById('seriesChart');
  if (!ctx || typeof Chart === 'undefined') return;
  const th = chartTheme();
  const s = buildSeries();

  charts.series = new Chart(ctx, {
    data: {
      labels: s.labels,
      datasets: [
        { type: 'bar', label: 'Revenue', data: s.rev, backgroundColor: th.rev, borderRadius: 5, maxBarThickness: 26, order: 2 },
        { type: 'bar', label: 'Costs', data: s.cost, backgroundColor: th.cost, borderRadius: 5, maxBarThickness: 26, order: 2 },
        { type: 'line', label: 'Net', data: s.net, borderColor: th.accent, backgroundColor: th.accent,
          borderWidth: 2.5, tension: 0.35, pointRadius: 2, pointHoverRadius: 5, order: 1 },
      ],
    },
    options: baseOptions(th, true),
  });
}

function renderCumChart() {
  destroyChart('cum');
  const ctx = document.getElementById('cumChart');
  if (!ctx || typeof Chart === 'undefined') return;
  const th = chartTheme();
  const s = buildSeries();
  const grad = ctx.getContext('2d').createLinearGradient(0, 0, 0, 260);
  grad.addColorStop(0, hexA(th.accent2, 0.35));
  grad.addColorStop(1, hexA(th.accent2, 0.0));

  charts.cum = new Chart(ctx, {
    type: 'line',
    data: {
      labels: s.labels,
      datasets: [{
        label: 'Cumulative net', data: s.cum,
        borderColor: th.accent2, backgroundColor: grad, fill: true,
        borderWidth: 2.5, tension: 0.35, pointRadius: 0, pointHoverRadius: 5,
      }],
    },
    options: baseOptions(th, false),
  });
}

function renderDoughnut(key, canvasId, breakdown, noteId) {
  destroyChart(key);
  const ctx = document.getElementById(canvasId);
  if (!ctx || typeof Chart === 'undefined') return;
  const th = chartTheme();
  const note = document.getElementById(noteId);

  if (!breakdown.length) {
    if (note) note.textContent = 'No data for this period';
    return;
  }
  const total = breakdown.reduce((a, [, v]) => a + v, 0);
  if (note) note.textContent = fmtMoney0(total) + ' total';

  charts[key] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: breakdown.map(b => b[0]),
      datasets: [{
        data: breakdown.map(b => b[1]),
        backgroundColor: breakdown.map((_, i) => PALETTE[i % PALETTE.length]),
        borderColor: th.surface, borderWidth: 2, hoverOffset: 6,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { position: 'right', labels: { color: th.text, boxWidth: 10, boxHeight: 10, usePointStyle: true, padding: 12, font: { family: 'Inter', size: 12 } } },
        tooltip: tooltipCfg(th, (v) => `${fmtMoney(v)} · ${((v / total) * 100).toFixed(1)}%`),
      },
    },
  });
}

function baseOptions(th, stacked) {
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: stacked, position: 'top', align: 'end',
        labels: { color: th.text, boxWidth: 10, boxHeight: 10, usePointStyle: true, padding: 14, font: { family: 'Inter', size: 12 } } },
      tooltip: tooltipCfg(th, (v) => fmtMoney(v)),
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: th.text, font: { family: 'Inter', size: 11 }, maxRotation: 0, autoSkipPadding: 12 } },
      y: { grid: { color: th.grid }, border: { display: false },
        ticks: { color: th.text, font: { family: 'Inter', size: 11 }, callback: (v) => fmtCompact(v) } },
    },
  };
}
function tooltipCfg(th, fmt) {
  return {
    backgroundColor: th.surface, titleColor: th.text, bodyColor: th.text,
    borderColor: th.border, borderWidth: 1, padding: 11, cornerRadius: 10, usePointStyle: true,
    titleFont: { family: 'Inter', weight: '600' }, bodyFont: { family: 'Inter' },
    callbacks: { label: (c) => `  ${c.dataset.label ? c.dataset.label + ': ' : ''}${fmt(c.parsed.y ?? c.parsed)}` },
  };
}

function renderCharts() {
  renderSeriesChart();
  renderCumChart();
  renderDoughnut('cost', 'costChart', categoryBreakdown('cost', state.settings.period), 'costBreakNote');
  renderDoughnut('rev', 'revChart', categoryBreakdown('revenue', state.settings.period), 'revBreakNote');
}

/* ---------- rendering: table ---------- */
const RECUR_LABEL = { once: 'One-time', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
function renderTable() {
  const body = document.getElementById('entriesBody');
  const empty = document.getElementById('emptyState');
  const q = (document.getElementById('search').value || '').toLowerCase().trim();
  const kf = document.getElementById('kindFilter').value;

  let rows = state.entries.slice();
  if (kf !== 'all') rows = rows.filter(e => e.kind === kf);
  if (q) rows = rows.filter(e =>
    (e.description || '').toLowerCase().includes(q) ||
    (e.category || '').toLowerCase().includes(q) ||
    (e.client || '').toLowerCase().includes(q));
  rows.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));

  setText('entryCount', String(state.entries.length));
  body.innerHTML = '';

  if (!state.entries.length) { empty.hidden = false; return; }
  empty.hidden = true;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center;padding:28px;">No entries match your filters.</td></tr>`;
    return;
  }

  for (const e of rows) {
    const tr = document.createElement('tr');
    const sign = e.kind === 'revenue' ? '+' : '−';
    const amtClass = e.kind === 'revenue' ? 'value-pos' : 'value-neg';
    tr.innerHTML = `
      <td><div class="desc-cell"><span class="kind-dot ${e.kind}"></span>${esc(e.description)}</div></td>
      <td>${e.category ? `<span class="tag">${esc(e.category)}</span>` : '<span class="muted">—</span>'}</td>
      <td>${e.client ? esc(e.client) : '<span class="muted">—</span>'}</td>
      <td><span class="tag">${RECUR_LABEL[e.recurrence] || e.recurrence}</span></td>
      <td class="muted">${fmtDateNice(e.date)}${e.endDate ? ` → ${fmtDateNice(e.endDate)}` : ''}</td>
      <td class="num amount-cell ${amtClass}">${sign}${fmtMoney(e.amount)}</td>
      <td class="actions-col"><div class="row-actions">
        <button class="row-btn" data-edit="${e.id}" title="Edit">Edit</button>
        <button class="row-btn del" data-del="${e.id}" title="Delete">Delete</button>
      </div></td>`;
    body.appendChild(tr);
  }
}
function fmtDateNice(s) { const d = parseDate(s); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; }

/* ---------- render all ---------- */
function renderAll() { renderSummary(); renderCharts(); renderTable(); }

/* ---------- modal / form ---------- */
const modal = document.getElementById('modal');
function openModal(entry) {
  const f = document.getElementById('entryForm');
  f.reset();
  document.getElementById('modalTitle').textContent = entry ? 'Edit entry' : 'Add entry';
  document.getElementById('deleteBtn').hidden = !entry;
  document.getElementById('entryId').value = entry ? entry.id : '';

  if (entry) {
    f.querySelector(`input[name="kind"][value="${entry.kind}"]`).checked = true;
    f.description.value = entry.description || '';
    f.amount.value = entry.amount;
    f.recurrence.value = entry.recurrence;
    f.category.value = entry.category || '';
    f.client.value = entry.client || '';
    f.date.value = entry.date;
    f.endDate.value = entry.endDate || '';
  } else {
    f.date.value = toISODate(today0());
  }
  syncCatList();
  syncEndField();
  modal.hidden = false;
  setTimeout(() => f.description.focus(), 30);
}
function closeModal() { modal.hidden = true; }

function syncCatList() {
  const kind = document.querySelector('input[name="kind"]:checked').value;
  const list = document.getElementById('catList');
  list.innerHTML = CATEGORY_SUGGESTIONS[kind].map(c => `<option value="${c}"></option>`).join('');
}
function syncEndField() {
  const rec = document.getElementById('f-recurrence').value;
  document.getElementById('endField').style.visibility = rec === 'once' ? 'hidden' : 'visible';
}

function submitForm(ev) {
  ev.preventDefault();
  const f = ev.target;
  const id = document.getElementById('entryId').value;
  const amount = parseFloat(f.amount.value);
  if (!(amount >= 0)) { toast('Enter a valid amount'); return; }

  const data = {
    kind: f.querySelector('input[name="kind"]:checked').value,
    description: f.description.value.trim() || 'Untitled',
    amount,
    recurrence: f.recurrence.value,
    category: f.category.value.trim(),
    client: f.client.value.trim(),
    date: f.date.value,
    endDate: (f.recurrence.value !== 'once' && f.endDate.value) ? f.endDate.value : null,
  };
  if (!data.date) { toast('Pick a start date'); return; }

  if (id) {
    const i = state.entries.findIndex(e => e.id === id);
    if (i >= 0) state.entries[i] = { ...state.entries[i], ...data };
    toast('Entry updated');
  } else {
    state.entries.push({ id: uid(), createdAt: Date.now(), ...data });
    toast('Entry added');
  }
  save(); renderAll(); closeModal();
}

function deleteEntry(id) {
  const e = state.entries.find(x => x.id === id);
  if (!e) return;
  if (!confirm(`Delete "${e.description}"? This cannot be undone.`)) return;
  state.entries = state.entries.filter(x => x.id !== id);
  save(); renderAll(); closeModal();
  toast('Entry deleted');
}

/* ---------- import / export ---------- */
function exportJSON() {
  download(`webstrakt-data-${toISODate(today0())}.json`, JSON.stringify(state, null, 2), 'application/json');
  toast('Exported JSON');
}
function exportCSV() {
  const head = ['type', 'description', 'amount', 'recurrence', 'category', 'client', 'start', 'end'];
  const lines = [head.join(',')];
  for (const e of state.entries) {
    lines.push([e.kind, e.description, e.amount, e.recurrence, e.category || '', e.client || '', e.date, e.endDate || '']
      .map(csvCell).join(','));
  }
  download(`webstrakt-entries-${toISODate(today0())}.csv`, lines.join('\n'), 'text/csv');
  toast('Exported CSV');
}
function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const entries = Array.isArray(parsed) ? parsed : parsed.entries;
      if (!Array.isArray(entries)) throw new Error('No entries array');
      if (!confirm(`Import ${entries.length} entries? This replaces your current data.`)) return;
      state.entries = entries.map(e => ({ id: e.id || uid(), createdAt: e.createdAt || Date.now(), ...e }));
      if (parsed.settings) state.settings = { ...state.settings, ...parsed.settings };
      save(); applyTheme(); syncControls(); renderAll();
      toast('Data imported');
    } catch (err) { toast('Import failed: ' + err.message); }
  };
  reader.readAsText(file);
}

/* ---------- sample data ---------- */
function loadSample() {
  if (state.entries.length && !confirm('Replace current data with sample data?')) return;
  const t = today0();
  const iso = (d) => toISODate(d);
  const monthsAgo = (n) => iso(addMonths(startOfMonth(t), -n));
  state.entries = [
    mk('revenue', 'Acme Co. — monthly retainer', 2500, 'monthly', 'Retainer', 'Acme Co.', monthsAgo(8)),
    mk('revenue', 'Northwind site — maintenance', 450, 'monthly', 'Maintenance', 'Northwind', monthsAgo(6)),
    mk('revenue', 'Riverside hosting plan', 39, 'monthly', 'Hosting', 'Riverside', monthsAgo(10)),
    mk('revenue', 'Brightwave e-commerce build', 8800, 'once', 'Project', 'Brightwave', monthsAgo(3)),
    mk('revenue', 'Lumen landing page', 2200, 'once', 'Project', 'Lumen', monthsAgo(1)),
    mk('revenue', 'Quarterly SEO consulting', 1800, 'yearly', 'Consulting', 'Acme Co.', monthsAgo(5)),
    mk('cost', 'Vercel Pro', 20, 'monthly', 'Hosting', 'Vercel', monthsAgo(11)),
    mk('cost', 'Figma seats', 45, 'monthly', 'Software / SaaS', 'Figma', monthsAgo(11)),
    mk('cost', 'Adobe Creative Cloud', 60, 'monthly', 'Software / SaaS', 'Adobe', monthsAgo(11)),
    mk('cost', 'Domain renewals', 180, 'yearly', 'Domains', 'Namecheap', monthsAgo(7)),
    mk('cost', 'Freelance designer — Brightwave', 1600, 'once', 'Contractors', 'J. Rivera', monthsAgo(3)),
    mk('cost', 'Google Ads', 300, 'monthly', 'Marketing', 'Google', monthsAgo(4)),
    mk('cost', 'New laptop', 2100, 'once', 'Equipment', 'Apple', monthsAgo(6)),
    mk('cost', 'Accounting software', 25, 'monthly', 'Software / SaaS', 'QuickBooks', monthsAgo(9)),
  ];
  save(); renderAll();
  toast('Sample data loaded');
}
function mk(kind, description, amount, recurrence, category, client, date) {
  return { id: uid(), createdAt: Date.now(), kind, description, amount, recurrence, category, client, date, endDate: null };
}

/* ---------- theme & controls sync ---------- */
function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.settings.theme);
  document.querySelector('.theme-icon').textContent = state.settings.theme === 'dark' ? '◐' : '◑';
}
function buildRangeOptions() {
  const sel = document.getElementById('rangeSel');
  const opts = state.settings.granularity === 'monthly'
    ? [{ v: 6, l: 'Last 6 months' }, { v: 12, l: 'Last 12 months' }, { v: 24, l: 'Last 24 months' }]
    : [{ v: 8, l: 'Last 8 weeks' }, { v: 13, l: 'Last 13 weeks' }, { v: 26, l: 'Last 26 weeks' }, { v: 52, l: 'Last 52 weeks' }];
  if (!opts.find(o => o.v === state.settings.range)) state.settings.range = opts[1].v;
  sel.innerHTML = opts.map(o => `<option value="${o.v}">${o.l}</option>`).join('');
  sel.value = state.settings.range;
}
function syncControls() {
  document.getElementById('currency').value = state.settings.currency;
  document.querySelectorAll('#periodSeg .seg').forEach(b => b.classList.toggle('active', b.dataset.period === state.settings.period));
  document.querySelectorAll('#granSeg .seg').forEach(b => b.classList.toggle('active', b.dataset.gran === state.settings.granularity));
  buildRangeOptions();
}

/* ---------- helpers ---------- */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function csvCell(v) { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function hexA(hex, a) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let toastTimer;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- events ---------- */
function wireEvents() {
  // global click delegation for [data-action] + table buttons + menu
  document.addEventListener('click', (e) => {
    const act = e.target.closest('[data-action]');
    if (act) {
      const a = act.dataset.action;
      if (a === 'add') openModal(null);
      else if (a === 'sample') loadSample();
      else if (a === 'export-json') exportJSON();
      else if (a === 'export-csv') exportCSV();
      else if (a === 'import-json') document.getElementById('importFile').click();
      else if (a === 'clear') { if (confirm('Delete ALL data? This cannot be undone.')) { state.entries = []; save(); renderAll(); toast('All data cleared'); } }
      closeMenu();
    }
    const ed = e.target.closest('[data-edit]');
    if (ed) openModal(state.entries.find(x => x.id === ed.dataset.edit));
    const del = e.target.closest('[data-del]');
    if (del) deleteEntry(del.dataset.del);

    // close menu when clicking outside
    if (!e.target.closest('.menu-wrap')) closeMenu();
  });

  // segmented: period
  document.getElementById('periodSeg').addEventListener('click', (e) => {
    const b = e.target.closest('.seg'); if (!b) return;
    state.settings.period = b.dataset.period; save(); syncControls(); renderSummary();
    renderDoughnut('cost', 'costChart', categoryBreakdown('cost', state.settings.period), 'costBreakNote');
    renderDoughnut('rev', 'revChart', categoryBreakdown('revenue', state.settings.period), 'revBreakNote');
  });
  // segmented: granularity
  document.getElementById('granSeg').addEventListener('click', (e) => {
    const b = e.target.closest('.seg'); if (!b) return;
    state.settings.granularity = b.dataset.gran; buildRangeOptions(); save(); syncControls();
    renderSeriesChart(); renderCumChart();
  });
  document.getElementById('rangeSel').addEventListener('change', (e) => {
    state.settings.range = parseInt(e.target.value, 10); save(); renderSeriesChart(); renderCumChart();
  });

  document.getElementById('currency').addEventListener('change', (e) => {
    state.settings.currency = e.target.value; save(); renderAll();
  });
  document.getElementById('themeToggle').addEventListener('click', () => {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    save(); applyTheme(); renderCharts();
  });
  document.getElementById('menuBtn').addEventListener('click', (e) => {
    e.stopPropagation(); const m = document.getElementById('menu'); m.hidden = !m.hidden;
  });

  document.getElementById('search').addEventListener('input', renderTable);
  document.getElementById('kindFilter').addEventListener('change', renderTable);

  // modal
  document.getElementById('entryForm').addEventListener('submit', submitForm);
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('deleteBtn').addEventListener('click', () => deleteEntry(document.getElementById('entryId').value));
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.querySelectorAll('input[name="kind"]').forEach(r => r.addEventListener('change', syncCatList));
  document.getElementById('f-recurrence').addEventListener('change', syncEndField);
  document.getElementById('importFile').addEventListener('change', (e) => { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ''; });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); closeMenu(); }
    if (e.key === 'n' && !modal.hidden === false && !isTyping(e)) { /* noop */ }
  });
}
function closeMenu() { const m = document.getElementById('menu'); if (m) m.hidden = true; }
function isTyping(e) { const t = e.target.tagName; return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT'; }

/* ---------- boot ---------- */
function init() {
  load();
  applyTheme();
  syncControls();
  wireEvents();
  renderAll();
}
document.addEventListener('DOMContentLoaded', init);
