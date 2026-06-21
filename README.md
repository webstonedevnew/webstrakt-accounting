# Webstrakt · Revenue & Cost Tracker

An elegant, zero-build revenue and cost tracker for a web development business.
Track one-time and recurring (weekly / monthly / yearly) revenue and costs, and see
everything visualised week-to-week and month-to-month.

![overview](https://img.shields.io/badge/build-none%20required-34d399) ![storage](https://img.shields.io/badge/storage-localStorage-818cf8)

## Features

- **Entries** — revenue or cost, with amount, category, client/source, and a recurrence of
  one-time, weekly, monthly, or yearly (plus an optional end date for recurring items).
- **Automatic expansion** — recurring entries are expanded across the timeline so weekly and
  monthly totals are always correct.
- **Overview cards** — revenue, costs, net profit, and margin for the selected period
  (this week / month / year / all time), plus **MRR** (monthly recurring revenue), recurring
  burn, and net recurring per month.
- **Charts**
  - Revenue vs. costs over time (weekly or monthly) with a net-profit line.
  - Cumulative net — your running cash position.
  - Cost breakdown and revenue breakdown doughnuts by category.
- **Searchable entries table** with inline edit / delete.
- **Dark & light themes**, currency selector, and JSON / CSV export plus JSON import for backup.
- **Local-first** — all data lives in your browser's `localStorage`. Nothing is sent anywhere.

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

Data is stored per-browser in `localStorage` under the key `webstrakt_tracker_v1`. Because it's
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
