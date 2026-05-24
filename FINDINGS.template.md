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
