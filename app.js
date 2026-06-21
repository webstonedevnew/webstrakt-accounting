/* ============================================================
   Webstrakt · Agency Finances
   Self-contained app: entries + clients, recurrence expansion,
   per-client profitability, and charts. No build step.
   ============================================================ */

const STORE_KEY = 'webstrakt_tracker_v2';
const OLD_KEYS = ['webstrakt_tracker_v1'];

const DEFAULT_SETTINGS = {
  currency: 'EUR',
  theme: 'dark',
  view: 'dashboard',        // dashboard | clients
  period: 'month',          // week | month | year | all
  granularity: 'monthly',   // weekly | monthly
  range: 12,
  revMode: 'category',      // revenue breakdown: category | client
  clientStatus: 'all',
  clientSort: 'revenue',
};

const CATEGORY_SUGGESTIONS = {
  revenue: ['Website project', 'Retainer', 'Maintenance & support', 'Hosting', 'E-commerce', 'SEO / marketing', 'Consulting', 'Design', 'Other'],
  cost: ['Hosting & servers', 'Domains', 'SaaS & tools', 'Subcontractors', 'Software licenses', 'Marketing / ads', 'Equipment', 'Office', 'Banking fees', 'Taxes', 'Other'],
};

const PALETTE = ['#818cf8', '#38bdf8', '#34d399', '#fbbf24', '#fb7185', '#a78bfa', '#2dd4bf', '#f472b6', '#60a5fa', '#facc15', '#4ade80', '#f97316'];
const STATUS_LABEL = { active: 'Active', lead: 'Lead', past: 'Past' };

let state = { entries: [], customers: [], settings: { ...DEFAULT_SETTINGS } };
let charts = {};

/* ---------- persistence ---------- */
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      state.customers = Array.isArray(parsed.customers) ? parsed.customers : [];
      state.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
    }
    OLD_KEYS.forEach(k => localStorage.removeItem(k)); // drop pre-v2 test data
  } catch (e) { console.warn('Failed to load state', e); }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { console.warn('Failed to save state', e); }
}

/* ---------- date helpers (local, no TZ surprises) ---------- */
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function toISODate(d) { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function addWeeks(d, n) { return addDays(d, n * 7); }
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function addMonths(d, n) { const day = d.getDate(); const r = new Date(d.getFullYear(), d.getMonth() + n, 1); r.setDate(Math.min(day, daysInMonth(r.getFullYear(), r.getMonth()))); return r; }
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
function fmtDateNice(s) { const d = parseDate(s); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; }

/* ---------- money ---------- */
function fmtMoney(n) { return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency, maximumFractionDigits: 2 }).format(n || 0); }
function fmtMoney0(n) { return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency, maximumFractionDigits: 0 }).format(n || 0); }
function fmtCompact(n) {
  const sym = (0).toLocaleString(undefined, { style: 'currency', currency: state.settings.currency }).replace(/[\d.,\s]/g, '');
  return sym + new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/* ---------- clients ---------- */
function getCustomer(id) { return state.customers.find(c => c.id === id) || null; }
function customerName(id) { const c = getCustomer(id); return c ? c.name : null; }
function nextColor() {
  const used = new Set(state.customers.map(c => c.color));
  return PALETTE.find(c => !used.has(c)) || PALETTE[state.customers.length % PALETTE.length];
}
// Resolve a typed client name to an id, creating the client if new. Empty => null (overhead).
function resolveCustomer(nameRaw) {
  const name = (nameRaw || '').trim();
  if (!name) return null;
  let c = state.customers.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!c) {
    c = { id: uid(), name, status: 'active', since: toISODate(today0()), notes: '', color: nextColor() };
    state.customers.push(c);
  }
  return c.id;
}
function entriesForCustomer(id) { return state.entries.filter(e => e.customerId === id); }

/* ---------- recurrence expansion ---------- */
function occurrences(entry, winStart, winEnd) {
  const out = [];
  if (entry.status === 'paused') return out; // parked: excluded from all totals
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

// Monthly-equivalent of one active recurring entry (0 if once / paused / inactive today).
function monthlyEq(e) {
  if (e.recurrence === 'once' || e.status === 'paused') return 0;
  const t = today0();
  const s = parseDate(e.date);
  const end = e.endDate ? parseDate(e.endDate) : null;
  if (s > t || (end && end < t)) return 0;
  if (e.recurrence === 'weekly') return e.amount * 52 / 12;
  if (e.recurrence === 'monthly') return e.amount;
  if (e.recurrence === 'yearly') return e.amount / 12;
  return 0;
}

/* ---------- aggregation ---------- */
function periodWindow(period) {
  const t = today0();
  if (period === 'week') return [startOfWeek(t), addDays(startOfWeek(t), 6)];
  if (period === 'month') return [startOfMonth(t), endOfMonth(t)];
  if (period === 'year') return [startOfYear(t), endOfYear(t)];
  return [earliestDate(), t]; // all-time: realized to today
}
function earliestDate() {
  const t = today0(); let earliest = t;
  for (const e of state.entries) { const d = parseDate(e.date); if (d < earliest) earliest = d; }
  return earliest;
}
function totalsFor(entries, s, e) {
  let revenue = 0, cost = 0;
  for (const en of entries) {
    const sum = occurrences(en, s, e).length * en.amount;
    if (en.kind === 'revenue') revenue += sum; else cost += sum;
  }
  return { revenue, cost, net: revenue - cost };
}
function periodTotals(period) { const [s, e] = periodWindow(period); return totalsFor(state.entries, s, e); }

function categoryBreakdown(kind, period) {
  const [s, e] = periodWindow(period);
  const map = {};
  for (const en of state.entries) {
    if (en.kind !== kind) continue;
    const n = occurrences(en, s, e).length * en.amount;
    if (!n) continue;
    const key = (en.category || '').trim() || 'Uncategorized';
    map[key] = (map[key] || 0) + n;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}
function clientBreakdown(kind, period) {
  const [s, e] = periodWindow(period);
  const map = {};
  for (const en of state.entries) {
    if (en.kind !== kind) continue;
    const n = occurrences(en, s, e).length * en.amount;
    if (!n) continue;
    const key = customerName(en.customerId) || 'Agency / overhead';
    map[key] = (map[key] || 0) + n;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function recurringMonthly(kind) {
  let v = 0;
  for (const e of state.entries) if (e.kind === kind) v += monthlyEq(e);
  return v;
}
function recurringMonthlyForEntries(entries, kind) {
  let v = 0;
  for (const e of entries) if (e.kind === kind) v += monthlyEq(e);
  return v;
}

function buildSeries() {
  const gran = state.settings.granularity;
  const count = state.settings.range;
  const t = today0();
  const buckets = [];
  if (gran === 'monthly') {
    const cm = startOfMonth(t);
    for (let k = count - 1; k >= 0; k--) { const s = addMonths(cm, -k); buckets.push({ start: s, end: endOfMonth(s), label: fmtMonthLabel(s) }); }
  } else {
    const cw = startOfWeek(t);
    for (let k = count - 1; k >= 0; k--) { const s = addWeeks(cw, -k); buckets.push({ start: s, end: addDays(s, 6), label: fmtWeekLabel(s) }); }
  }
  return bucketize(state.entries, buckets);
}
function bucketize(entries, buckets) {
  const winStart = buckets[0].start, winEnd = buckets[buckets.length - 1].end;
  const rev = new Array(buckets.length).fill(0);
  const cost = new Array(buckets.length).fill(0);
  const findBucket = (date) => { for (let i = 0; i < buckets.length; i++) if (date >= buckets[i].start && date <= buckets[i].end) return i; return -1; };
  for (const en of entries) {
    for (const d of occurrences(en, winStart, winEnd)) {
      const idx = findBucket(d); if (idx < 0) continue;
      if (en.kind === 'revenue') rev[idx] += en.amount; else cost[idx] += en.amount;
    }
  }
  const net = rev.map((r, i) => r - cost[i]);
  let run = 0; const cum = net.map(n => (run += n));
  return { labels: buckets.map(b => b.label), rev, cost, net, cum };
}
function last12Months(entries) {
  const t = today0(); const cm = startOfMonth(t); const buckets = [];
  for (let k = 11; k >= 0; k--) { const s = addMonths(cm, -k); buckets.push({ start: s, end: endOfMonth(s), label: fmtMonthLabel(s) }); }
  return bucketize(entries, buckets);
}

function customerStats(id) {
  const es = entriesForCustomer(id);
  const t = totalsFor(es, earliestDate(), today0());
  return {
    ...t,
    mrr: recurringMonthlyForEntries(es, 'revenue'),
    recurringCost: recurringMonthlyForEntries(es, 'cost'),
    count: es.length,
    margin: t.revenue > 0 ? (t.net / t.revenue) * 100 : 0,
  };
}

/* ---------- chart theme ---------- */
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function chartTheme() {
  return { text: cssVar('--text-muted'), grid: cssVar('--grid'), rev: cssVar('--rev'), cost: cssVar('--cost'), accent: cssVar('--accent'), accent2: cssVar('--accent-2'), surface: cssVar('--surface'), border: cssVar('--border-strong') };
}
function destroyChart(key) { if (charts[key]) { charts[key].destroy(); delete charts[key]; } }

function baseOptions(th, legend) {
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: legend, position: 'top', align: 'end', labels: { color: th.text, boxWidth: 10, boxHeight: 10, usePointStyle: true, padding: 14, font: { family: 'Inter', size: 12 } } },
      tooltip: tooltipCfg(th, (v) => fmtMoney(v)),
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: th.text, font: { family: 'Inter', size: 11 }, maxRotation: 0, autoSkipPadding: 12 } },
      y: { grid: { color: th.grid }, border: { display: false }, ticks: { color: th.text, font: { family: 'Inter', size: 11 }, callback: (v) => fmtCompact(v) } },
    },
  };
}
function tooltipCfg(th, fmt) {
  return {
    backgroundColor: th.surface, titleColor: th.text, bodyColor: th.text, borderColor: th.border, borderWidth: 1,
    padding: 11, cornerRadius: 10, usePointStyle: true, titleFont: { family: 'Inter', weight: '600' }, bodyFont: { family: 'Inter' },
    callbacks: { label: (c) => `  ${c.dataset.label ? c.dataset.label + ': ' : ''}${fmt(c.parsed.y ?? c.parsed)}` },
  };
}
function revCostDatasets(th, s) {
  return [
    { type: 'bar', label: 'Revenue', data: s.rev, backgroundColor: th.rev, borderRadius: 5, maxBarThickness: 26, order: 2 },
    { type: 'bar', label: 'Costs', data: s.cost, backgroundColor: th.cost, borderRadius: 5, maxBarThickness: 26, order: 2 },
    { type: 'line', label: 'Net', data: s.net, borderColor: th.accent, backgroundColor: th.accent, borderWidth: 2.5, tension: 0.35, pointRadius: 2, pointHoverRadius: 5, order: 1 },
  ];
}

/* ---------- rendering: dashboard summary ---------- */
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
  document.getElementById('sumMrrFoot').innerHTML = `net recurring <span class="${recurNet >= 0 ? 'up' : 'down'}">${fmtMoney0(recurNet)}/mo</span>`;
  setText('sumBurnFoot', `${fmtMoney0(burn * 12)}/yr`);
}

/* ---------- rendering: charts ---------- */
function renderSeriesChart() {
  destroyChart('series');
  const ctx = document.getElementById('seriesChart');
  if (!ctx || typeof Chart === 'undefined') return;
  const th = chartTheme();
  charts.series = new Chart(ctx, { data: { labels: buildSeries().labels, datasets: revCostDatasets(th, buildSeries()) }, options: baseOptions(th, true) });
}
function renderCumChart() {
  destroyChart('cum');
  const ctx = document.getElementById('cumChart');
  if (!ctx || typeof Chart === 'undefined') return;
  const th = chartTheme();
  const s = buildSeries();
  const grad = ctx.getContext('2d').createLinearGradient(0, 0, 0, 260);
  grad.addColorStop(0, hexA(th.accent2, 0.35)); grad.addColorStop(1, hexA(th.accent2, 0));
  charts.cum = new Chart(ctx, {
    type: 'line',
    data: { labels: s.labels, datasets: [{ label: 'Cumulative net', data: s.cum, borderColor: th.accent2, backgroundColor: grad, fill: true, borderWidth: 2.5, tension: 0.35, pointRadius: 0, pointHoverRadius: 5 }] },
    options: baseOptions(th, false),
  });
}
function renderDoughnut(key, canvasId, breakdown, noteId) {
  destroyChart(key);
  const ctx = document.getElementById(canvasId);
  if (!ctx || typeof Chart === 'undefined') return;
  const th = chartTheme();
  const note = document.getElementById(noteId);
  if (!breakdown.length) { if (note) note.textContent = 'No data for this period'; return; }
  const total = breakdown.reduce((a, [, v]) => a + v, 0);
  if (note) note.textContent = fmtMoney0(total) + ' total';
  charts[key] = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: breakdown.map(b => b[0]), datasets: [{ data: breakdown.map(b => b[1]), backgroundColor: breakdown.map((_, i) => PALETTE[i % PALETTE.length]), borderColor: th.surface, borderWidth: 2, hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { position: 'right', labels: { color: th.text, boxWidth: 10, boxHeight: 10, usePointStyle: true, padding: 12, font: { family: 'Inter', size: 12 } } },
        tooltip: tooltipCfg(th, (v) => `${fmtMoney(v)} · ${((v / total) * 100).toFixed(1)}%`),
      },
    },
  });
}
function renderRevBreakdown() {
  const mode = state.settings.revMode;
  const data = mode === 'client' ? clientBreakdown('revenue', state.settings.period) : categoryBreakdown('revenue', state.settings.period);
  renderDoughnut('rev', 'revChart', data, 'revBreakNote');
}
function renderCharts() {
  renderSeriesChart();
  renderCumChart();
  renderDoughnut('cost', 'costChart', categoryBreakdown('cost', state.settings.period), 'costBreakNote');
  renderRevBreakdown();
}

/* ---------- rendering: entries table ---------- */
const RECUR_LABEL = { once: 'One-time', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
function entryRowHTML(e, opts = {}) {
  const sign = e.kind === 'revenue' ? '+' : '−';
  const amtClass = e.kind === 'revenue' ? 'value-pos' : 'value-neg';
  const recurring = e.recurrence !== 'once';
  const paused = recurring && e.status === 'paused';
  const recCell = `<span class="tag">${RECUR_LABEL[e.recurrence] || e.recurrence}</span>` + (paused ? ' <span class="tag paused">Paused</span>' : '');
  let dateCell = fmtDateNice(e.date);
  if (e.endDate) dateCell += ` → ${fmtDateNice(e.endDate)}`;
  else if (recurring) dateCell += ' · ongoing';
  const cName = customerName(e.customerId);
  const clientCell = cName ? `<span class="client-link" data-customer="${e.customerId}">${esc(cName)}</span>` : '<span class="muted">Overhead</span>';
  const rowClass = paused ? ' class="paused-row"' : '';
  if (opts.compact) {
    return `<tr${rowClass}>
      <td><div class="desc-cell"><span class="kind-dot ${e.kind}"></span>${esc(e.description)}</div></td>
      <td>${recCell}</td>
      <td class="muted">${dateCell}</td>
      <td class="num amount-cell ${amtClass}">${sign}${fmtMoney(e.amount)}</td>
      <td class="actions-col"><div class="row-actions"><button class="row-btn" data-edit="${e.id}">Edit</button></div></td>
    </tr>`;
  }
  return `<tr${rowClass}>
    <td><div class="desc-cell"><span class="kind-dot ${e.kind}"></span>${esc(e.description)}</div></td>
    <td>${e.category ? `<span class="tag">${esc(e.category)}</span>` : '<span class="muted">—</span>'}</td>
    <td>${clientCell}</td>
    <td>${recCell}</td>
    <td class="muted">${dateCell}</td>
    <td class="num amount-cell ${amtClass}">${sign}${fmtMoney(e.amount)}</td>
    <td class="actions-col"><div class="row-actions">
      <button class="row-btn" data-edit="${e.id}" title="Edit">Edit</button>
      <button class="row-btn del" data-del="${e.id}" title="Delete">Delete</button>
    </div></td>`;
}
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
    (customerName(e.customerId) || '').toLowerCase().includes(q));
  rows.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));

  setText('entryCount', String(state.entries.length));
  body.innerHTML = '';
  if (!state.entries.length) { empty.hidden = false; return; }
  empty.hidden = true;
  if (!rows.length) { body.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center;padding:28px;">No entries match your filters.</td></tr>`; return; }
  body.innerHTML = rows.map(e => entryRowHTML(e)).join('');
}

/* ---------- rendering: clients ---------- */
function renderClients() {
  const all = state.customers.slice();
  // summary
  const active = all.filter(c => c.status === 'active').length;
  let totalRev = 0, totalMrr = 0;
  const statsById = {};
  for (const c of all) { const st = customerStats(c.id); statsById[c.id] = st; totalRev += st.revenue; totalMrr += st.mrr; }
  setText('cliActive', String(active));
  setText('cliActiveFoot', `${all.length} total`);
  setText('cliRevenue', fmtMoney0(totalRev));
  setText('cliMrr', fmtMoney0(totalMrr));
  setText('cliAvg', all.length ? fmtMoney0(totalRev / all.length) : fmtMoney0(0));

  // filter + sort
  const filter = state.settings.clientStatus;
  let list = all.filter(c => filter === 'all' || c.status === filter);
  const sort = state.settings.clientSort;
  list.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'recent') return (b.since || '').localeCompare(a.since || '');
    if (sort === 'net') return statsById[b.id].net - statsById[a.id].net;
    if (sort === 'mrr') return statsById[b.id].mrr - statsById[a.id].mrr;
    return statsById[b.id].revenue - statsById[a.id].revenue;
  });

  const grid = document.getElementById('clientGrid');
  const emptyEl = document.getElementById('clientEmpty');
  if (!all.length) { grid.innerHTML = ''; emptyEl.hidden = false; return; }
  emptyEl.hidden = true;
  grid.innerHTML = list.map(c => {
    const st = statsById[c.id];
    const netClass = st.net >= 0 ? 'value-pos' : 'value-neg';
    return `<button class="client-card" data-open-client="${c.id}" style="--c:${c.color}">
      <div class="client-card-head">
        <span class="client-dot"></span>
        <span class="client-name">${esc(c.name)}</span>
        <span class="status-badge ${c.status}">${STATUS_LABEL[c.status] || c.status}</span>
      </div>
      <div class="client-card-sub">${c.since ? 'since ' + fmtDateNice(c.since) : ''}${c.since ? ' · ' : ''}${st.count} ${st.count === 1 ? 'entry' : 'entries'}</div>
      <div class="client-card-stats">
        <div><span class="cs-label">Revenue</span><span class="cs-val value-pos">${fmtMoney0(st.revenue)}</span></div>
        <div><span class="cs-label">Cost</span><span class="cs-val value-neg">${fmtMoney0(st.cost)}</span></div>
        <div><span class="cs-label">Net</span><span class="cs-val ${netClass}">${fmtMoney0(st.net)}</span></div>
        <div><span class="cs-label">MRR</span><span class="cs-val">${fmtMoney0(st.mrr)}</span></div>
      </div>
    </button>`;
  }).join('');
}

/* ---------- client detail ---------- */
let detailCustomerId = null;
function openClientDetail(id) {
  const c = getCustomer(id); if (!c) return;
  detailCustomerId = id;
  const st = customerStats(id);
  document.getElementById('detailDot').style.background = c.color;
  setText('detailName', c.name);
  const badge = document.getElementById('detailStatus');
  badge.textContent = STATUS_LABEL[c.status] || c.status;
  badge.className = 'status-badge ' + c.status;

  const meta = document.getElementById('detailMeta');
  const bits = [];
  if (c.since) bits.push(`Client since ${fmtDateNice(c.since)}`);
  if (c.notes) bits.push(esc(c.notes));
  meta.innerHTML = bits.length ? bits.map(b => `<span>${b}</span>`).join('') : '';

  const netClass = st.net >= 0 ? 'value-pos' : 'value-neg';
  document.getElementById('detailStats').innerHTML = `
    ${stat('Revenue', fmtMoney0(st.revenue), 'value-pos')}
    ${stat('Cost', fmtMoney0(st.cost), 'value-neg')}
    ${stat('Net', fmtMoney0(st.net), netClass)}
    ${stat('Margin', st.revenue > 0 ? st.margin.toFixed(0) + '%' : '—', netClass)}
    ${stat('MRR', fmtMoney0(st.mrr), '')}
    ${stat('Recurring cost', fmtMoney0(st.recurringCost) + '/mo', '')}`;

  const es = entriesForCustomer(id).slice().sort((a, b) => b.date.localeCompare(a.date));
  setText('detailEntryCount', String(es.length));
  document.getElementById('detailEntries').innerHTML = es.length
    ? es.map(e => entryRowHTML(e, { compact: true })).join('')
    : `<tr><td class="muted" style="padding:18px;text-align:center;">No entries yet for this client.</td></tr>`;

  document.getElementById('detailModal').hidden = false;
  renderDetailChart(id);
}
function stat(label, value, cls) { return `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value ${cls || ''}">${value}</div></div>`; }
function renderDetailChart(id) {
  destroyChart('detail');
  const ctx = document.getElementById('detailChart');
  if (!ctx || typeof Chart === 'undefined') return;
  const th = chartTheme();
  const s = last12Months(entriesForCustomer(id));
  charts.detail = new Chart(ctx, { data: { labels: s.labels, datasets: revCostDatasets(th, s) }, options: baseOptions(th, true) });
}
function closeDetail() { document.getElementById('detailModal').hidden = true; destroyChart('detail'); detailCustomerId = null; }

/* ---------- entry modal ---------- */
const modal = document.getElementById('modal');
function openModal(entry, preset) {
  const f = document.getElementById('entryForm');
  f.reset();
  document.getElementById('modalTitle').textContent = entry ? 'Edit entry' : 'Add entry';
  document.getElementById('deleteBtn').hidden = !entry;
  document.getElementById('entryId').value = entry ? entry.id : '';
  syncClientList();

  if (entry) {
    f.querySelector(`input[name="kind"][value="${entry.kind}"]`).checked = true;
    f.description.value = entry.description || '';
    f.amount.value = entry.amount;
    f.recurrence.value = entry.recurrence;
    f.category.value = entry.category || '';
    f.client.value = customerName(entry.customerId) || '';
    f.date.value = entry.date;
    f.endDate.value = entry.endDate || '';
    f.status.value = entry.status === 'paused' ? 'paused' : (entry.endDate ? 'ends' : 'ongoing');
  } else {
    f.date.value = toISODate(today0());
    f.status.value = 'ongoing';
    if (preset) {
      if (preset.kind) f.querySelector(`input[name="kind"][value="${preset.kind}"]`).checked = true;
      if (preset.client) f.client.value = preset.client;
    }
  }
  syncCatList();
  syncRecurrenceUI();
  if (detailCustomerId) document.getElementById('detailModal').hidden = true; // tuck detail behind
  modal.hidden = false;
  setTimeout(() => f.description.focus(), 30);
}
function closeModal() { modal.hidden = true; if (detailCustomerId) openClientDetail(detailCustomerId); }
function syncClientList() { document.getElementById('clientList').innerHTML = state.customers.map(c => `<option value="${esc(c.name)}"></option>`).join(''); }
function syncCatList() {
  const kind = document.querySelector('input[name="kind"]:checked').value;
  document.getElementById('catList').innerHTML = CATEGORY_SUGGESTIONS[kind].map(c => `<option value="${c}"></option>`).join('');
}
function syncRecurrenceUI() {
  const rec = document.getElementById('f-recurrence').value;
  const status = document.getElementById('f-status').value;
  document.getElementById('statusField').style.display = rec === 'once' ? 'none' : '';
  document.getElementById('endField').hidden = rec === 'once' || status !== 'ends';
}
function submitForm(ev) {
  ev.preventDefault();
  const f = ev.target;
  const id = document.getElementById('entryId').value;
  const amount = parseFloat(f.amount.value);
  if (!(amount >= 0)) { toast('Enter a valid amount'); return; }

  const recurrence = f.recurrence.value;
  let status = 'active', endDate = null;
  if (recurrence !== 'once') {
    const mode = f.status.value;
    if (mode === 'paused') status = 'paused';
    else if (mode === 'ends') { if (!f.endDate.value) { toast('Pick an end date'); return; } endDate = f.endDate.value; }
  }
  if (!f.date.value) { toast('Pick a start date'); return; }

  const customerId = resolveCustomer(f.client.value);
  const data = {
    kind: f.querySelector('input[name="kind"]:checked').value,
    description: f.description.value.trim() || 'Untitled',
    amount, recurrence,
    category: f.category.value.trim(),
    customerId,
    date: f.date.value, endDate, status,
  };

  if (id) {
    const i = state.entries.findIndex(e => e.id === id);
    if (i >= 0) state.entries[i] = { ...state.entries[i], ...data };
    toast('Entry updated');
  } else {
    state.entries.push({ id: uid(), createdAt: Date.now(), ...data });
    toast('Entry added');
  }
  save(); renderAll(); closeModal(); // closeModal restores detail view if it was open
}
function deleteEntry(id) {
  const e = state.entries.find(x => x.id === id); if (!e) return;
  if (!confirm(`Delete "${e.description}"? This cannot be undone.`)) return;
  state.entries = state.entries.filter(x => x.id !== id);
  save(); renderAll(); closeModal();
  toast('Entry deleted');
}

/* ---------- client modal ---------- */
function openClientModal(customer) {
  const f = document.getElementById('clientForm');
  f.reset();
  document.getElementById('clientModalTitle').textContent = customer ? 'Edit client' : 'Add client';
  document.getElementById('clientDeleteBtn').hidden = !customer;
  document.getElementById('clientId').value = customer ? customer.id : '';
  const color = customer ? customer.color : nextColor();
  document.getElementById('clientColor').value = color;
  if (customer) {
    f.name.value = customer.name;
    f.status.value = customer.status || 'active';
    f.since.value = customer.since || '';
    f.notes.value = customer.notes || '';
  } else {
    f.status.value = 'active';
    f.since.value = toISODate(today0());
  }
  renderSwatches(color);
  if (detailCustomerId) document.getElementById('detailModal').hidden = true; // tuck detail behind
  document.getElementById('clientModal').hidden = false;
  setTimeout(() => f.name.focus(), 30);
}
function closeClientModal() { document.getElementById('clientModal').hidden = true; if (detailCustomerId) openClientDetail(detailCustomerId); }
function renderSwatches(selected) {
  document.getElementById('clientSwatches').innerHTML = PALETTE.map(c =>
    `<button type="button" class="swatch${c === selected ? ' selected' : ''}" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
}
function submitClient(ev) {
  ev.preventDefault();
  const f = ev.target;
  const id = document.getElementById('clientId').value;
  const name = f.name.value.trim();
  if (!name) { toast('Enter a client name'); return; }
  const data = { name, status: f.status.value, since: f.since.value || null, notes: f.notes.value.trim(), color: document.getElementById('clientColor').value };
  if (id) {
    const i = state.customers.findIndex(c => c.id === id);
    if (i >= 0) state.customers[i] = { ...state.customers[i], ...data };
    toast('Client updated');
  } else {
    state.customers.push({ id: uid(), ...data });
    toast('Client added');
  }
  save(); renderAll(); closeClientModal(); // closeClientModal restores detail view if it was open
}
function deleteClient(id) {
  const c = getCustomer(id); if (!c) return;
  const n = entriesForCustomer(id).length;
  const msg = n ? `Delete "${c.name}"? Their ${n} ${n === 1 ? 'entry' : 'entries'} will become unattributed (agency overhead), not deleted.` : `Delete "${c.name}"?`;
  if (!confirm(msg)) return;
  state.entries.forEach(e => { if (e.customerId === id) e.customerId = null; });
  state.customers = state.customers.filter(x => x.id !== id);
  save(); closeDetail(); closeClientModal(); renderAll(); // closeDetail first so the modal doesn't reopen
  toast('Client deleted');
}

/* ---------- import / export ---------- */
function exportJSON() { download(`webstrakt-data-${toISODate(today0())}.json`, JSON.stringify(state, null, 2), 'application/json'); toast('Exported JSON'); }
function exportCSV() {
  const head = ['type', 'description', 'amount', 'recurrence', 'category', 'client', 'status', 'start', 'end'];
  const lines = [head.join(',')];
  for (const e of state.entries) {
    lines.push([e.kind, e.description, e.amount, e.recurrence, e.category || '', customerName(e.customerId) || '', e.status || 'active', e.date, e.endDate || ''].map(csvCell).join(','));
  }
  download(`webstrakt-entries-${toISODate(today0())}.csv`, lines.join('\n'), 'text/csv'); toast('Exported CSV');
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
      state.customers = Array.isArray(parsed.customers) ? parsed.customers : [];
      if (parsed.settings) state.settings = { ...state.settings, ...parsed.settings };
      save(); applyTheme(); syncControls(); renderAll();
      toast('Data imported');
    } catch (err) { toast('Import failed: ' + err.message); }
  };
  reader.readAsText(file);
}

/* ---------- sample data ---------- */
function loadSample() {
  if ((state.entries.length || state.customers.length) && !confirm('Replace current data with sample data?')) return;
  const base = startOfMonth(today0());
  const ago = (n) => toISODate(addMonths(base, -n));
  const C = (name, status, sinceN, notes, color) => ({ id: uid(), name, status, since: ago(sinceN), notes, color });

  const acme = C('Acme Co.', 'active', 10, 'Monthly retainer + hosting. Main contact: Dana.', PALETTE[0]);
  const north = C('Northwind', 'active', 7, 'Maintenance & support plan.', PALETTE[1]);
  const bright = C('Brightwave', 'active', 4, 'E-commerce build, now on support.', PALETTE[2]);
  const lumen = C('Lumen Studio', 'past', 2, 'One-off landing page.', PALETTE[4]);
  const harbor = C('Harbor & Co.', 'lead', 1, 'Proposal sent for a rebuild.', PALETTE[3]);
  state.customers = [acme, north, bright, lumen, harbor];

  const E = (kind, description, amount, recurrence, category, custId, startN, opt = {}) =>
    ({ id: uid(), createdAt: Date.now(), kind, description, amount, recurrence, category, customerId: custId, date: ago(startN), endDate: opt.end != null ? ago(opt.end) : null, status: opt.status || 'active' });

  state.entries = [
    // Revenue — clients
    E('revenue', 'Acme — monthly retainer', 2500, 'monthly', 'Retainer', acme.id, 10),
    E('revenue', 'Acme — managed hosting', 49, 'monthly', 'Hosting', acme.id, 10),
    E('revenue', 'Northwind — support plan', 600, 'monthly', 'Maintenance & support', north.id, 7),
    E('revenue', 'Brightwave — e-commerce build', 9200, 'once', 'E-commerce', bright.id, 4),
    E('revenue', 'Brightwave — support plan', 350, 'monthly', 'Maintenance & support', bright.id, 3),
    E('revenue', 'Lumen — landing page', 2400, 'once', 'Website project', lumen.id, 2),
    E('revenue', 'Acme — annual SEO audit', 1800, 'yearly', 'SEO / marketing', acme.id, 6),
    // Costs — client-attributed
    E('cost', 'Brightwave — freelance designer', 1700, 'once', 'Subcontractors', bright.id, 4),
    E('cost', 'Acme — premium plugin licenses', 120, 'yearly', 'Software licenses', acme.id, 6),
    // Costs — agency overhead (no client)
    E('cost', 'Vercel Pro', 20, 'monthly', 'Hosting & servers', null, 11),
    E('cost', 'Figma', 45, 'monthly', 'SaaS & tools', null, 11),
    E('cost', 'Adobe Creative Cloud', 60, 'monthly', 'SaaS & tools', null, 11),
    E('cost', 'GitHub Team', 16, 'monthly', 'SaaS & tools', null, 9),
    E('cost', 'Domain portfolio renewals', 220, 'yearly', 'Domains', null, 7),
    E('cost', 'Google Ads', 300, 'monthly', 'Marketing / ads', null, 5),
    E('cost', 'MacBook Pro', 2400, 'once', 'Equipment', null, 6),
    E('cost', 'Old SEO tool (cancelled)', 99, 'monthly', 'SaaS & tools', null, 9, { end: 3 }),
  ];
  save(); renderAll(); toast('Sample data loaded');
}

/* ---------- theme & controls ---------- */
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
  document.querySelectorAll('#revModeSeg .seg').forEach(b => b.classList.toggle('active', b.dataset.revmode === state.settings.revMode));
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.view === state.settings.view));
  document.getElementById('clientStatusFilter').value = state.settings.clientStatus;
  document.getElementById('clientSort').value = state.settings.clientSort;
  buildRangeOptions();
}
function setView(v) {
  state.settings.view = v; save();
  document.getElementById('view-dashboard').hidden = v !== 'dashboard';
  document.getElementById('view-clients').hidden = v !== 'clients';
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  if (v === 'dashboard') renderCharts(); else renderClients();
}

/* ---------- render all ---------- */
function renderAll() {
  renderSummary();
  renderTable();
  renderClients();
  if (state.settings.view === 'dashboard') renderCharts();
}

/* ---------- helpers ---------- */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function csvCell(v) { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function hexA(hex, a) { hex = hex.replace('#', ''); if (hex.length === 3) hex = hex.split('').map(c => c + c).join(''); const n = parseInt(hex, 16); return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; }
function download(name, content, type) {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let toastTimer;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
function closeMenu() { const m = document.getElementById('menu'); if (m) m.hidden = true; }

/* ---------- events ---------- */
function wireEvents() {
  document.addEventListener('click', (e) => {
    const act = e.target.closest('[data-action]');
    if (act) {
      const a = act.dataset.action;
      if (a === 'add') openModal(null);
      else if (a === 'add-client') openClientModal(null);
      else if (a === 'sample') loadSample();
      else if (a === 'export-json') exportJSON();
      else if (a === 'export-csv') exportCSV();
      else if (a === 'import-json') document.getElementById('importFile').click();
      else if (a === 'clear') { if (confirm('Delete ALL data (entries and clients)? This cannot be undone.')) { state.entries = []; state.customers = []; save(); renderAll(); toast('All data cleared'); } }
      closeMenu();
    }
    const navTab = e.target.closest('.nav-tab'); if (navTab) setView(navTab.dataset.view);
    const ed = e.target.closest('[data-edit]'); if (ed) openModal(state.entries.find(x => x.id === ed.dataset.edit));
    const del = e.target.closest('[data-del]'); if (del) deleteEntry(del.dataset.del);
    const oc = e.target.closest('[data-open-client]'); if (oc) openClientDetail(oc.dataset.openClient);
    const cl = e.target.closest('.client-link'); if (cl) openClientDetail(cl.dataset.customer);
    const sw = e.target.closest('.swatch'); if (sw) { document.getElementById('clientColor').value = sw.dataset.color; renderSwatches(sw.dataset.color); }
    if (!e.target.closest('.menu-wrap')) closeMenu();
  });

  document.getElementById('periodSeg').addEventListener('click', (e) => {
    const b = e.target.closest('.seg'); if (!b) return;
    state.settings.period = b.dataset.period; save(); syncControls(); renderSummary();
    renderDoughnut('cost', 'costChart', categoryBreakdown('cost', state.settings.period), 'costBreakNote');
    renderRevBreakdown();
  });
  document.getElementById('granSeg').addEventListener('click', (e) => {
    const b = e.target.closest('.seg'); if (!b) return;
    state.settings.granularity = b.dataset.gran; buildRangeOptions(); save(); syncControls(); renderSeriesChart(); renderCumChart();
  });
  document.getElementById('revModeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('.seg'); if (!b) return;
    state.settings.revMode = b.dataset.revmode; save(); syncControls(); renderRevBreakdown();
  });
  document.getElementById('rangeSel').addEventListener('change', (e) => { state.settings.range = parseInt(e.target.value, 10); save(); renderSeriesChart(); renderCumChart(); });
  document.getElementById('clientStatusFilter').addEventListener('change', (e) => { state.settings.clientStatus = e.target.value; save(); renderClients(); });
  document.getElementById('clientSort').addEventListener('change', (e) => { state.settings.clientSort = e.target.value; save(); renderClients(); });

  document.getElementById('currency').addEventListener('change', (e) => { state.settings.currency = e.target.value; save(); renderAll(); if (detailCustomerId) openClientDetail(detailCustomerId); });
  document.getElementById('themeToggle').addEventListener('click', () => { state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark'; save(); applyTheme(); renderCharts(); if (detailCustomerId) renderDetailChart(detailCustomerId); });
  document.getElementById('menuBtn').addEventListener('click', (e) => { e.stopPropagation(); const m = document.getElementById('menu'); m.hidden = !m.hidden; });

  document.getElementById('search').addEventListener('input', renderTable);
  document.getElementById('kindFilter').addEventListener('change', renderTable);

  // entry modal
  document.getElementById('entryForm').addEventListener('submit', submitForm);
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('deleteBtn').addEventListener('click', () => deleteEntry(document.getElementById('entryId').value));
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.querySelectorAll('input[name="kind"]').forEach(r => r.addEventListener('change', syncCatList));
  document.getElementById('f-recurrence').addEventListener('change', syncRecurrenceUI);
  document.getElementById('f-status').addEventListener('change', syncRecurrenceUI);
  document.getElementById('importFile').addEventListener('change', (e) => { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ''; });

  // client modal
  document.getElementById('clientForm').addEventListener('submit', submitClient);
  document.getElementById('clientCancelBtn').addEventListener('click', closeClientModal);
  document.getElementById('clientModalClose').addEventListener('click', closeClientModal);
  document.getElementById('clientDeleteBtn').addEventListener('click', () => deleteClient(document.getElementById('clientId').value));
  document.getElementById('clientModal').addEventListener('click', (e) => { if (e.target.id === 'clientModal') closeClientModal(); });

  // detail modal
  document.getElementById('detailClose').addEventListener('click', closeDetail);
  document.getElementById('detailModal').addEventListener('click', (e) => { if (e.target.id === 'detailModal') closeDetail(); });
  document.getElementById('detailEditBtn').addEventListener('click', () => { const c = getCustomer(detailCustomerId); if (c) openClientModal(c); });
  document.getElementById('detailAddEntryBtn').addEventListener('click', () => { const c = getCustomer(detailCustomerId); if (c) openModal(null, { kind: 'revenue', client: c.name }); });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('modal').hidden) closeModal();
    else if (!document.getElementById('clientModal').hidden) closeClientModal();
    else if (!document.getElementById('detailModal').hidden) closeDetail();
    else closeMenu();
  });
}

/* ---------- boot ---------- */
function init() {
  load();
  applyTheme();
  syncControls();
  wireEvents();
  setView(state.settings.view);
  renderAll();
}
document.addEventListener('DOMContentLoaded', init);
