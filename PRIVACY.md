# Data & Privacy

**Short version: your business data never leaves your device. The only thing we track is your license.**

friendly-123 is local-first by design. Products, sales, customers, inventory, rack photos, commissions — everything about your business lives in your browser's local storage, on your device, and nowhere else. There is no backend that stores it. The only things that leave the device are listed below.

## The one exception: license activation

To sell licenses and let paying customers unlock the full app, we run a small Cloudflare Worker that tracks *instances*, not *businesses*. Your commercial license is valid for **5 years** from activation. When you activate (PIN 789) or log in, your device sends:

- `instanceId` — a random ID generated on your device, not tied to anything else
- Your name, email, and license code — only if you chose to enter them during activation, for account recovery
- Your WhatsApp number — only if you chose to add it, so we can reach you directly instead of only by email
- Activation status (full / minimal / blocked)

That's the complete list. Nothing about your products, sales, customers, or inventory is ever included in this ping, at any point, under any feature.

## Error and health signals (since October 2026)

To catch problems before you do, the app sends error reports to Sentry and usage-flow signals to PostHog. They contain only: the app version, which section was open, a fixed error code (for example "photo did not open"), the file and line of a code error, and whether the money totals add up (yes/no). Error messages are cleaned before sending: quoted text, numbers, e-mails and license codes are removed. The device is identified by a random id that is not linked to your license. No products, sales, customers, amounts, names, PINs or licenses are ever sent. The code is in `docs/canarios.js`.

## Verify it yourself

This isn't a claim you have to trust — check it:

- **Open DevTools → Network tab** while using the app. Every request the app makes is visible. You'll see calls to `/api/*` (your own browser, intercepted locally by `mock-backend.js` — nothing leaves your device) and occasional calls to the Cloudflare Worker's `/checkin` endpoint at activation/login. Nothing else.
- **Read the worker's source directly**: [`cloudflare-worker/worker.js`](./cloudflare-worker/worker.js) in this repo is the exact code deployed — no build step, no minification hiding anything.
- **Read the client code**: `docs/*.js` is plain, unminified JavaScript. There is no bundler step between what's in this repo and what runs in your browser.

## Why this matters to us

This isn't a legal disclaimer — it's the product's actual design. If you're evaluating friendly-123 for a business where "where does my data go" is a real question (and it should be), the answer is: nowhere, by construction, and you don't have to take our word for it.
