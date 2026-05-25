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


### Issue: Admin routes completely unauthenticated (B4)

- Where: `src/routes/adminRoutes.js`; `src/config/env.js`
- Why: Both admin routes (POST /admin/products, PATCH /admin/products/:id) had
  no auth middleware. ADMIN_TOKEN was defined in env and read by env.js but
  never referenced in any route or middleware. Any unauthenticated caller could
  create or modify products.
- Impact: Full unauthenticated write access to product catalogue. Attacker can
  set any product price to zero, set stock to arbitrary values, or inject
  malicious HTML into product descriptions (compounding F1/XSS).
- Fix: Created src/middleware/requireAdmin.js which extracts the Bearer token
  from the Authorization header and compares it to ADMIN_TOKEN from env.
  Applied via router.use(requireAdmin) at the top of adminRoutes.js so all
  current and future routes in that file are automatically protected.
- Trade-offs: Token comparison uses === not crypto.timingSafeEqual — vulnerable
  to timing attacks in theory. Production would use timingSafeEqual. ADMIN_TOKEN
  defaults to "change-me" if env var is unset — any request with that value
  would succeed, so the env var must be set in production. Frontend still reads
  token from localStorage (F10) which is XSS-accessible — addressed in frontend
  fixes.


### Issue: SQL injection in listProducts (B5)

- Where: `src/repositories/productsRepository.js` → `listProducts`
- Why: The search query parameter `q` was interpolated directly into the SQL
  string using template literals: `WHERE name ILIKE '%${q}%'`. No parameterized
  query was used. Any value passed via ?q= was executed as raw SQL.
- Impact: Full SQL injection. An attacker could extract all data, drop tables,
  or execute arbitrary database commands via the public product search endpoint.
  No authentication required to exploit.
- Fix: Replaced string interpolation with a parameterized query using $1. The
  % wildcards are part of the parameter value, not the SQL string, so they
  cannot break out of the string context. pg library handles escaping safely.
- Trade-offs: None — parameterized queries are strictly safer and have no
  performance downside.


### Issue: totalAmount trusted from client (B6)

- Where: `src/services/ordersService.js` → `createOrder`
- Why: The totalAmount field from the request body was passed directly to the
  database via Number(totalAmount). The server already had all unit prices from
  the database inside enrichedItems but ignored them for the stored total.
- Impact: A client could send totalAmount: 0.01 for a $260 order and pay 1 cent.
  Complete price integrity bypass — no concurrency or auth required to exploit.
- Fix: Removed client-supplied totalAmount from the createOrder DB call entirely.
  Server now computes the total from enrichedItems using unit prices fetched from
  the database: sum of (unitPrice × quantity) for all items, rounded to 2 decimal
  places using Math.round(n * 100) / 100 to avoid floating point drift.
- Trade-offs: Client-supplied totalAmount is silently ignored rather than rejected
  with a 422. A production system might validate and error if they don't match,
  which helps detect buggy clients. For very large orders, floating point
  accumulation across many additions could still drift slightly — production fix
  is integer arithmetic (store prices in cents).

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
