# friendly-123

**Your business, in color.** A serverless point-of-sale and inventory-control
web app for small business. Runs entirely in the browser — no server to host,
no monthly SaaS bill, no account required to start. Share the link, open it on
any phone, and you have a working store dashboard.

## What it does

- **Color-coded inventory (the Simon system)** — every product carries a status
  color the owner and staff read at a glance: green (healthy), gold
  (opportunity), orange (urgent), red (emergency), blue (accounting), black
  (dead stock). The colors are the action language, not decoration.
- **Sell without a cart** — one tap on a product grid records a sale. Built for
  a counter, not a checkout flow.
- **Consignment & partner commissions** — track partner shelves, meta targets,
  and settle commissions with an itemized WhatsApp receipt so the partner can
  reconcile exactly which sales the payment covers.
- **Owner P&L** — daily operating cost prorated over the real number of days in
  the current month, gross margin, and inventory valuation.
- **Barcode scanning, QR labels, and stock adjustments** with a standardized
  reason dropdown so the movement log stays clean.
- **Tamper-evident history** — the movement log is hash-chained so edits are
  visible.
- **Works offline** — service worker + local storage; the app is fully usable
  without connectivity.

## Pricing

**$399 USD — one-time, global price.** No subscription. Buyers in developing
countries qualify for a developing-country discount against this same global
list price using their developer/country ID.

## Run locally

```bash
npm install
npm start
```

Or serve the static app directly:

```bash
python -m http.server 8736 --directory docs
```

Then open `http://localhost:8736`.

## Source & build

The readable source lives in `src/`. The shipped, obfuscated app is built into
`docs/` (GitHub Pages root). See `build.js` for the pipeline (minify + mangle +
string encryption + anti-tamper hashing).

```bash
npm run build
```

## License

Proprietary. See `LICENSE`.
