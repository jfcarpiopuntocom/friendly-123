# Inventory Health Check (formerly Stock Semaphore)

Standalone ChatGPT MCP/plugin implementation aligned to the same official MCP SDK pattern used by the submitted Business Survival Score sibling.

## Runtime
- MCP: `/mcp` — Streamable HTTP
- Health: `/health`
- Domain challenge: `/.well-known/openai-apps-challenge`
- Public tool: `classify_inventory`
- UI resource: `ui://inventory-health-check/card.html`

## Data posture
- anonymous and stateless by default
- no database
- no inventory persistence
- no raw request-body logging
- no external inventory APIs
- no write actions

## Business logic
Mirrors the approved friendly-123 inventory state rules:
- red: out/urgent stock
- orange: low stock
- black: 45+ days without a sale when no more severe signal applies
- yellow: >=50% gross margin when no more severe signal applies
- green: healthy
- expiry can raise severity: <=3 days red; 4–7 days orange

## Languages
EN / ES / PT. The widget also has a visible local language switcher.

## Submission
See `submission/SUBMISSION.md` for the 5 positive / 3 negative review cases and annotation justifications.
