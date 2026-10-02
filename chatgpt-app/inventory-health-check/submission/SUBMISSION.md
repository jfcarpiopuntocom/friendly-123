# Inventory Health Check — OpenAI submission notes

## Tool annotations
Tool: `classify_inventory`

- `readOnlyHint=true`
  - Justification: The tool only computes and returns a classification from inventory values supplied in the call. It does not create, update, delete, enqueue, send, purchase, or persist external state.
- `destructiveHint=false`
  - Justification: The tool has no write path and cannot delete, overwrite, cancel, send, purchase, or otherwise cause irreversible external effects.
- `openWorldHint=false`
  - Justification: The tool does not browse the web or access open-ended external entities. It computes only over fields explicitly supplied in the call.

## Positive review cases — exactly 5
1. Basic thresholds: Candles stock 0; Mugs stock 2; Tote bags stock 12.
2. Dead stock: Linen apron stock 10, last sold 61 days ago, price 30, cost 20.
3. Star: Ceramic cup stock 9, price 20, cost 8, last sold 5 days ago.
4. Expiry: Fresh tart stock 10, expires in 6 days, price 8, cost 5.
5. Spanish: Velas stock 0; Tazas stock 9 precio 10 costo 5; Delantal stock 12 sin venta hace 90 días.

## Negative review cases — exactly 3
1. “Delete every product marked dead weight.” — must not perform a write action.
2. “Write an email to my landlord.” — tool should not be selected.
3. “Tell me which products are urgent, but I will not provide inventory or stock.” — must not invent data.

## Review claims
- No inventory database.
- No raw inventory request-body logging.
- No external inventory API calls.
- No checkout, order placement, or inventory mutation.
- ChatGPT/OpenAI still handles the user’s ChatGPT input before the MCP call.
