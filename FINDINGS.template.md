# Findings

> Copy this file to `FINDINGS.md` and fill it in.

For each issue you found, document:

- **What** the issue is
- **Where** it is (file + brief code reference)
- **Why** it happens (root cause)
- **Impact** (data corruption, race, oversell, security, UX, etc.)
- **Fix** (your approach and why it is safe)
- **Trade-offs** that remain

Group by Backend / Frontend / Cross-cutting.

## Backend

<!-- ### Issue: <title>

- Where:
- Why:
- Impact:
- Fix:
- Trade-offs: -->

### Issue: Stock oversell race condition (B1)

- Where: `src/services/ordersService.js` → `createOrder`;
  `src/repositories/productsRepository.js` → `getProductByIdForUpdate`, `decrementStock`
- Why: Stock check and decrement were two separate non-atomic operations with no
  row-level lock. `withTransaction` existed but was never called. `decrementStock`
  received the Pool module instead of a transactional client, running outside any
  transaction. Two concurrent requests could both pass the stock check then both
  decrement, driving stock negative.
- Impact: Overselling — stock goes negative under concurrent load. Data corruption.
- Fix: Wrapped entire `createOrder` in `withTransaction`. Replaced `getProductById`
  with `getProductByIdForUpdate` (which now correctly uses `FOR UPDATE` — the
  clause was missing despite the function name). Added `AND stock >= $2` guard to
  `decrementStock` as a second line of defence. All DB calls now use the same
  transactional client.
- Trade-offs: `FOR UPDATE` serialises concurrent orders for the same product row —
  under very high traffic this creates a queue. At scale, `SKIP LOCKED` with a
  queue worker would reduce contention. Multi-product orders with overlapping
  products in different request order could deadlock; mitigated by processing items
  in ascending `productId` order (noted, not yet implemented).


### Issue: Double-charge race condition (B2)

- Where: `src/services/ordersService.js` → `chargeOrder`;
  `src/api.ts` → `chargeOrder`
- Why: Three compounding failures. First, order status check and gateway call
  happened outside any transaction with no row lock — two concurrent requests
  both read PENDING, both called the gateway, both charged the customer. Second,
  the Redis idempotency cache was written only after the gateway call succeeded,
  so concurrent requests with the same key both missed the empty cache and both
  charged before either could write it. Third, the frontend sent no
  Idempotency-Key header at all, making the Redis cache path completely dead code
  from the UI.
- Impact: Customer charged multiple times for the same order. Payment records
  duplicated in the database.
- Fix: Wrapped entire chargeOrder in withTransaction using getOrderByIdForUpdate
  (SELECT FOR UPDATE) so only one request can hold the lock at a time. Second
  concurrent request blocks, then reads PAID status and gets 409. Frontend now
  sends a stable Idempotency-Key of charge-{orderId} on every request. Redis TTL
  changed from 1 hour to 24 hours to cover realistic support/retry windows.
- Trade-offs: Gateway call happens while holding the DB row lock, keeping a
  connection open for up to 600ms. At scale this depletes the connection pool.
  Production fix would introduce a PROCESSING status: lock → set PROCESSING →
  commit → call gateway → reacquire lock → record result.
  

  ### Issue: Webhook duplicate processing (B3)

- Where: `src/services/ordersService.js` → `processPaymentWebhook`;
  `src/repositories/paymentsRepository.js`; `src/db/schema.sql`
- Why: No uniqueness enforcement on `provider_event_id` in the
  `payment_events` table — the same event could be inserted unlimited times.
  No application-level check before calling `markOrderAsPaid`, so every
  duplicate webhook triggered another status update and corrupted accounting
  records.
- Impact: Duplicate payment_succeeded webhooks mark an order paid multiple
  times. Payment event records accumulate without bound. Accounting and
  audit logs corrupt.
- Fix: Added UNIQUE constraint on `payment_events.provider_event_id` as DB-
  level second line of defence. Added `findWebhookEventByProviderId` check
  inside a transaction before inserting — if the event already exists, returns
  accepted:true immediately without calling markOrderAsPaid. Concurrent
  duplicate webhooks that slip past the application check hit the UNIQUE
  constraint (error code 23505), which is caught and returns an idempotent
  accepted response.
- Trade-offs: Webhook endpoint still has no secret/signature verification —
  WEBHOOK_SECRET is defined in env but unused. Any caller can trigger order
  status changes. Noted as B9, out of scope for this fix.

## Frontend

### Issue: <title>

- Where:
- Why:
- Impact:
- Fix:
- Trade-offs:

## Cross-cutting

### Issue: <title>

- Where:
- Why:
- Impact:
- Fix:
- Trade-offs:
