# AI Usage Notes

> Copy this file to `AI_NOTES.md` and fill it in. Submission is required.

## 1. Tools used

List the AI tools / models / IDEs you used during the assessment.

- e.g. ChatGPT (GPT-4), Cursor with Claude, GitHub Copilot, Claude Code, etc.

## 2. Prompt journal

### Prompt 1
"Show me the current broken code in ordersService.js side by side with your 
proposed fix for the stock oversell race condition. Explain exactly why the fix 
is safe and what trade-offs remain, then write a test for it."

Produced a full side-by-side analysis, three-file fix, and a concurrent 
Promise.all test. Kept: the FOR UPDATE addition, the stock >= $2 guard, the 
withTransaction wrapping, and the test structure. Rejected: initial cleanup path 
in afterAll which had an FK ordering bug — rewrote it manually.

### Prompt 2
"Show me the current broken chargeOrder code and propose a fix using SELECT FOR
UPDATE inside a transaction. Flag anything touching money or transaction logic
for my manual review."

Produced the withTransaction wrapping, the getOrderByIdForUpdate usage, and the
idempotency key frontend change. Kept all three changes after line-by-line review.
Personally verified the TTL reasoning (changed from 1h to 24h) and confirmed the
gateway-inside-transaction trade-off is acceptable for assessment scope.

### Prompt 3
"Propose a fix for webhook deduplication. Show the UNIQUE constraint migration,
the application-level check, and the concurrent race handling. Flag the DB
constraint decision for my review."

Produced the two-layer approach: application check plus UNIQUE constraint
catching the concurrent race via error code 23505. Kept both layers after
reviewing the PostgreSQL error code documentation to confirm 23505 is the
correct unique violation code. Wrote the migration as a separate SQL file
rather than modifying schema.sql directly, which is safer for an existing
deployment.

## 3. AI got it wrong

Describe at least one concrete case where AI gave a plausible-looking but
incorrect, insecure, or unsafe answer. Quote the offending output and explain
how you detected it and what you did instead.

```
<paste the incorrect output>
```

What was wrong with it. How you found out. What you replaced it with.

## 4. Validation strategy

- Ran `npm test` after each backend fix to confirm behaviour before and after
- Verified B1 fix with a concurrent `Promise.all` test sending 5 simultaneous 
  order requests against stock of 1 — confirmed exactly 1 success and 4 × 409
- Manual environment debugging required before tests could run: local PostgreSQL 
  installation (v18) on Windows was occupying port 5432, blocking Docker's 
  container. Resolved by terminating the local process. Also identified that 
  dotenv@17 is actually dotenvx and intercepts require("dotenv").config() — 
  worked around by hardcoding connection parameters in postgres.js for the 
  assessment environment.
- SQL injection fix validated with three attack payloads in the test    suite: OR 1=1 data leak, DROP TABLE, and a clean legitimate search to confirm functionality was preserved.

## 5. What you did NOT delegate

- **Auth middleware placement**: decided personally to use router.use() rather
  than per-route middleware. AI suggested per-route; I overrode this because
  router.use() protects all future routes automatically — per-route is fragile
  if a developer forgets the argument on a new route.
- **Token comparison**: noted personally that === is timing-attack vulnerable
  and documented it in FINDINGS.md. AI did not flag this unprompted.

Briefly explain why you did not trust AI for these.
