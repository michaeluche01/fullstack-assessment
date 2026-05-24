# AI Usage Notes

> Copy this file to `AI_NOTES.md` and fill it in. Submission is required.

## 1. Tools used

List the AI tools / models / IDEs you used during the assessment.

- e.g. ChatGPT (GPT-4), Cursor with Claude, GitHub Copilot, Claude Code, etc.

## 2. Prompt journal

Paste 3 to 5 of the most useful prompts you wrote during this assessment.

For each prompt include:

- The verbatim prompt
- A brief note on what the model produced
- What you kept, what you rejected, and why

### Prompt 1
"Show me the current broken code in ordersService.js side by side with your 
proposed fix for the stock oversell race condition. Explain exactly why the fix 
is safe and what trade-offs remain, then write a test for it."

Produced a full side-by-side analysis, three-file fix, and a concurrent 
Promise.all test. Kept: the FOR UPDATE addition, the stock >= $2 guard, the 
withTransaction wrapping, and the test structure. Rejected: initial cleanup path 
in afterAll which had an FK ordering bug — rewrote it manually.

### Prompt 2

...

## 3. AI got it wrong

Describe at least one concrete case where AI gave a plausible-looking but
incorrect, insecure, or unsafe answer. Quote the offending output and explain
how you detected it and what you did instead.

```
<paste the incorrect output>
```

What was wrong with it. How you found out. What you replaced it with.

## 4. Validation strategy

How did you verify AI-generated code?

- Tests written
- Manual reasoning / code review
- Documentation you cross-referenced
- Local runs / curl / manual UI testing
- Anything else

- Ran `npm test` after each backend fix to confirm behaviour before and after
- Verified B1 fix with a concurrent `Promise.all` test sending 5 simultaneous 
  order requests against stock of 1 — confirmed exactly 1 success and 4 × 409
- Manual environment debugging required before tests could run: local PostgreSQL 
  installation (v18) on Windows was occupying port 5432, blocking Docker's 
  container. Resolved by terminating the local process. Also identified that 
  dotenv@17 is actually dotenvx and intercepts require("dotenv").config() — 
  worked around by hardcoding connection parameters in postgres.js for the 
  assessment environment.

## 5. What you did NOT delegate

Decisions you made yourself rather than asking the model. Especially around:

- Money handling
- Authentication / authorization
- Concurrency and locking
- Rendering untrusted input

Briefly explain why you did not trust AI for these.
