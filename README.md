# Webstrakt · Agency Finances

An elegant, zero-build revenue, cost and **client profitability** tracker for a web
development agency. Track one-time and recurring (weekly / monthly / yearly) revenue and
costs, attribute them to clients, and see everything visualised week-to-week and
month-to-month.

![overview](https://img.shields.io/badge/build-none%20required-34d399) ![storage](https://img.shields.io/badge/storage-localStorage-818cf8)

## Features

### Dashboard
- **Entries** — revenue or cost, with amount, agency-tuned category, client, and a recurrence
  of one-time, weekly, monthly, or yearly. Recurring items have a **Duration**: ongoing
  (until cancelled), ends-on-a-date, or paused.
- **Automatic expansion** — recurring entries are expanded across the timeline so weekly and
  monthly totals are always correct; paused entries are excluded everywhere.
- **Overview cards** — revenue, costs, net profit, and margin for the selected period
  (this week / month / year / all time), plus **MRR** (monthly recurring revenue), recurring
  burn, and net recurring per month.
- **Charts** — revenue vs. costs over time (weekly or monthly) with a net-profit line;
  cumulative net (cash position); cost breakdown; and revenue breakdown **by category or by
  client**.
- **Searchable entries table** with inline edit / delete.

### Clients
- **First-class clients** with name, status (active / lead / past), "client since" date,
  colour, and notes. Pick a client on any entry (type to search, or create on the fly);
  leave it blank for agency overhead.
- **Per-client cards** showing lifetime revenue, attributed cost, net contribution, and MRR,
  with status filter and sorting (top revenue / net / MRR / name / recent).
- **Client detail** — full stats, a 12-month revenue-vs-cost chart, and the client's entries,
  with a one-click "add entry for this client".

### Multi-currency
- Pick a **base (reporting) currency** in the top bar — all totals, charts, and client stats are
  shown in it.
- Each entry can be in **its own currency**. For a foreign-currency entry you record the
  **exchange rate on that entry's date**, and its base-currency value is **locked in** at that
  rate (the historical-cost approach real accounting software uses — old entries are never
  re-converted at today's rate).
- A **"Get rate"** button fetches the ECB reference rate for the entry's date from the free,
  key-less [Frankfurter](https://www.frankfurter.app/) API; you can always type the rate manually
  (works offline).
- Changing the base currency is an explicit, one-time conversion at a rate you supply — not a
  silent re-label.

### Everywhere
- **Dark & light themes** and JSON / CSV export plus JSON import for backup (CSV includes each
  entry's original amount, currency, rate, and base-currency value).
- **Local-first** — all data lives in your browser's `localStorage`. The only network call is the
  optional exchange-rate lookup.

## Run it

It's a static site — no build step, no dependencies to install.

```bash
# just open the file
open index.html

# …or serve it (any static server works), e.g. with Python:
python3 -m http.server 8080
# then visit http://localhost:8080
```

Click **Load sample data** (in the ⋯ menu, or the empty state) to populate realistic example
entries and see the charts come alive. **Clear all data** removes everything.

## Deploy on GitHub Pages

This repo is ready to host as-is:

1. Push to `main`.
2. In the GitHub repo → **Settings → Pages**, set **Source: Deploy from a branch**, branch
   `main`, folder `/ (root)`.
3. Your tracker will be live at `https://<org>.github.io/webstrakt-accounting/`.

## Data & backups

Data is stored per-browser in `localStorage` under the key `webstrakt_tracker_v2`. Because it's
local to one browser, **export to JSON regularly** (⋯ → Export data) to back up or move between
machines. Import replaces the current data set.

## Tech

- Plain HTML, CSS, and JavaScript (no framework, no build).
- [Chart.js](https://www.chartjs.org/) loaded from a CDN for the charts.
- [Inter](https://rsms.me/inter/) via Google Fonts.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup and layout |
| `styles.css` | Theme tokens, layout, and component styling |
| `app.js` | State, recurrence expansion, aggregation, charts, and interactions |
