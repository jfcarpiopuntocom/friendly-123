# friendly-123

**Your store, in color.**

Most small business software treats the owner like an accountant. Spreadsheets, grey dashboards, tables with dozens of columns — the kind of thing that makes you feel like you're doing homework instead of running a store.

friendly-123 is the opposite. Every product on your shelf has a color. Green means you're good. Gold means opportunity. Orange means act soon. Red means act now. Black means dead stock — time to move it. No training required. You see the colors, you know what to do.

That's the Simon system. It's the core idea this whole thing is built around.

---

## What it is

A serverless PWA — progressive web app — that runs entirely in the browser. No server to pay for. No monthly subscription. No account to create. Share a link, open it on any phone, and you have a working store dashboard.

It replaces the notebook. The whiteboard. The "let me check the back room" ritual. The WhatsApp message to the owner asking if something is low on stock.

---

## What it does

**Inventory with a heartbeat.** Every product carries a live status — calculated automatically from thresholds the owner sets once. The colors change as stock moves.

**Sell with one tap.** A product grid built for a counter, not a checkout flow. Tap the product, confirm, done.

**Consignment and partner shelves.** Track multiple partner locations, their sales targets, and commission scales. Settle with an itemized WhatsApp receipt the partner can reconcile on their end.

**Owner P&L.** Gross margin, operating costs prorated by real days in the month, inventory valuation. Honest math, not the kind that flatters you.

**Barcode scanning and QR labels.** Print a label for any product. Scan at the counter. The QR code links straight to the product's full record.

**Tamper-evident history.** Every stock movement is hash-chained. If someone tries to edit the log, it shows.

**Fully offline.** Service worker + local storage. The app works without connectivity and syncs when it reconnects.

**Bilingual (EN/ES).** Switch between English and Spanish. Every string, every label, every alert.

---

## Who it's for

Any owner running a small retail operation — a souvenir shop, a bookstore, a boutique, a vendor booth at a market — who wants to see what's happening in their store without opening a spreadsheet.

The sweet spot: stores with 1-5 employees, 50-500 SKUs, and at least one partner shelf or consignment arrangement.

---

## The mission

The notebook is not charming. It's a liability. It gets lost, it gets wet, it can't tell you your margin, and it definitely can't send a WhatsApp message to your supplier when you're running low.

We're replacing it — not with enterprise software that requires a consultant, but with something that fits in a browser tab and feels like it was made by someone who actually worked a counter.

If you're a developer who's ever watched a small business owner struggle with a tool that wasn't built for them, this is the project you've been looking for.

---

## Pricing

**$399 USD — one time, global price.** No subscription. No per-seat fees. Pay once, use forever. Buyers in developing countries qualify for a localized discount.

---

## Run it locally

```bash
npm install
npm start
```

Or serve the static demo directly (no Node required):

```bash
python -m http.server 8736 --directory docs
```

Then open `http://localhost:8736`.

---

## Architecture

The app is a single HTML file with vanilla JS — no frameworks, no build step required to read or modify it. The full source lives in `docs/`. The backend is a service worker + localStorage, with an optional Node/PocketBase layer for multi-device sync.

The demo runs entirely offline using `docs/mock-backend.js` as an in-browser API. The production version points to a real backend (`server.js` / PocketBase).

```
docs/
├── index.html          — the entire app
├── i18n.js             — all strings, EN + ES
├── mock-backend.js     — in-browser demo API
├── sw.js               — service worker (offline support)
├── auth-ui.js          — PIN gate and role switching
├── help-ui.js          — contextual help overlay
└── vista-perchas.js    — partner shelf view
```

---

## Contributing

The codebase is intentionally simple — no framework, no bundler required. If you want to contribute, read `docs/index.html` from the top. The architecture is linear and commented throughout.

Open an issue before opening a PR. The roadmap is opinionated.

---

## Data & Privacy

See [PRIVACY.md](./PRIVACY.md) — short version: your business data never leaves your device, the only thing we track is your license, and you can verify it yourself by reading the code.

---

## License

Proprietary. See `LICENSE`.
