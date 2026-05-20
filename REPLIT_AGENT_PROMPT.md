# Greenroom — Replit Agent Handoff Prompt

## What This Project Is

**Greenroom** is a music-venue booking management app. Venues use it to manage shows, deals, settlements, and ticket sales. The core business problem is that different deal structures (flat guarantee, vs deal, percentage-of-net, door deal, percentage-of-gross) all settle differently, and disputes arise when the contract was ambiguous or when expense deductions weren't capped.

The app has three workspaces:
- `artifacts/api-server/` — Hono-based REST API, SQLite via Drizzle ORM, TypeScript
- `artifacts/greenroom/` — Vite + React frontend
- `artifacts/mockup-sandbox/` — design mockup previewer

Use `pnpm` (not npm). Run tests from `artifacts/api-server/` with `pnpm test`.

---

## The Two Reference Reports

Everything in the backend logic should match the findings in these two audit documents:

### Report 1 — Greenroom SGP Decision Report
The **Smart Guaranteed Price (SGP)** engine audited against 3 years of historical settlements. Key findings:
- **7-step waterfall algorithm**: (1) expected gross from artist→agent→genre→venue signal hierarchy, (2) subtract 10% ticketing fees, (3) net after fees, (4) subtract capped expense estimate (P75 historical billed expenses), (5) net base, (6) percentage payout = net base × deal percentage, (7) `suggestedPrice = max(guarantee, pct_payout)` rounded to nearest $50.
- **Confidence tiers A/B/C/D**: A = artist ≥3 shows at venue + margin >$200; B = artist ≥1 OR agent ≥3; C = agent ≥1 OR genre data; D = no signal.
- **Expense caps per bucket** (P75 of historical billed expenses, non-absorbed only):
  - `$0–1K` → ~$800, `$1–5K` → ~$1,500, `$5–15K` → ~$1,750, `$15K+` → ~$2,500, `Uncapped %` → ~$1,750
- **Smart Switch**: Replaces deal structure for eligible cells. Door deals → Door Hybrid. vs/$1–5K and %net/$1–5K → flat (via SGP if tier A/B, else `insufficient_confidence`).
- **Door Hybrid formula**: `pool = gross × 0.90 − min(expenses, cap)` then `artist = $500 floor + 60% × pool`. Cap = $1,500. Dead pool condition: when `pool ≤ $500`, the split never fires and artist walks with exactly the floor.
- **Smart Hybrid ($5–10K)**: `artist = floor + 50% × max(0, pct_payout − floor)` with ceiling at `SGP_flat × 1.15`. **This is intentionally OUT OF SCOPE for this version.** Do not implement it. It is described in the report for reference only.
- **70% dispute reduction model**: Switching from a variable deal to a fixed structure reduces disputes by 70% and attention-minutes by 70%.
- **Numerical example — Glass Bottle (SGP, vs deal, $1–5K)**:
  - 280 tickets × $15 = $4,200 gross → $3,780 net after fees → subtract $1,500 expense cap → $2,280 base → × 85% = $1,938 pct payout → max($2,000 guarantee, $1,938) → **$2,000 flat** (rounded to nearest $50)
- **Numerical example — Pale Lake (Door Hybrid, $15K+)**:
  - $19,296 gross → pool = $19,296 × 0.9 − $1,500 = $15,866 → artist = $500 + 0.6 × $15,866 = **$10,020**

### Report 2 — Greenroom Settlement Redesign (May 2026)
Defines the settlement UI and workflow redesign. Key claims:
- Billed expense P75 across all buckets is ~$1,750 overall.
- Hospitality runs flat ~$300/show regardless of deal size; recommended cap = $400.
- The Pale Lake Pale Hybrid payout of $10,020 is the ground-truth check number for the door hybrid formula.
- 87.2% of vs deals in the $1–5K bucket have the percentage payout fire above the guarantee (116/133 shows). This drives the "Smart Switch to flat" recommendation being meaningful.
- vs deals at $1–5K: 44% dispute rate. Door deals: 41% dispute rate. Flat deals: 6% dispute rate. The 70% reduction model is conservative relative to these numbers.

---

## What the Code Review Found

A full audit of the codebase against these reports revealed the following:

### Issue 1 — Two conflicting hardcoded expense cap tables (FIXED in commit `0c2d41d`)
`smartGuarantee.ts` had:
```
"$0–1K": 800, "$1–5K": 1500, "$5–15K": 3500, "$15K+": 7500
```
`dealImprovements.ts` had:
```
"$0–1K": 1700, "$1–5K": 1850, "$5–15K": 1750, "$15K+": 1650
```
These disagreed with each other (e.g. $5–15K was $3,500 vs $1,750) and were going stale. The $5–15K cap of $3,500 in SGP was the worst offender — it would never bind, providing zero expense protection.

### Issue 2 — smartSwitch.ts door hybrid used hardcoded cap not wired to live data (FIXED in commit `ab3e485`)
`smartSwitch.ts` had `const DOOR_EXPENSE_CAP = 1500` as a module-level constant. It never read from `expenseCaps.ts`. This meant the door hybrid projection could drift from the rest of the system after real expense data settled.

### Issue 3 — Two errors in Report 1's door hybrid formula text (report errors, NOT code bugs)
Report 1 states the expense cap as $1,774 in one place. The code and Report 2 both use $1,500. The $10,020 Pale Lake payout only works with $1,500: `$500 + 0.6 × ($19,296 × 0.9 − $1,500) = $10,020` ✓. With $1,774: artist = $9,555 ✗. The code is correct.

Report 1 also writes the door hybrid formula as `artist = $500 + 60% × max(0, avail − $500)`, which subtracts the floor twice. The correct formula (matching the code and producing $10,020) is `artist = floor + 60% × pool` where `pool = gross × 0.9 − cap`. These are report typos, not code bugs.

### Pre-existing test failures (NOT caused by the commits above — need to be fixed)
Two test files have failures introduced by earlier commits and never cleaned up:

**`src/lib/queries.extra.test.ts` — 4 failures**
Root cause: `SQLITE_ERROR: no such column: artist_shows_at_venue`
The tests create the `switch_suggestions` table schema in-memory and are missing the `artist_shows_at_venue` column that was added to the schema in a later migration. The test's `CREATE TABLE` statement needs to include this column.

**`src/lib/switchSavings.test.ts` — 4 failures**
Root cause: The `insufficient_confidence` guard added in commit `316841b` skips any suggestion where `shape === "flat" && suggestedFlat === null`. The test seeds a vs deal but the mock suggestion it inserts has `suggestedFlat = null` (or the suggestion is missing entirely), so `getSwitchSavings` returns zero items instead of one. The test fixtures need to seed a suggestion row with a concrete `suggestedFlat` number and `source = "sgp_engine"` or `"cell_mean"` so the savings calculation has a real counterfactual to work with.

---

## What the Two Commits Did

### Commit `0c2d41d` — "Data-driven expense caps (replace stale hardcoded tables)"
**Author: Replit Agent**

Created `artifacts/api-server/src/lib/expenseCaps.ts` — a new module that:
- Queries the live database for all past shows' non-absorbed billed expenses
- Groups them by analytics size bucket (`classifyAnalyticsSizeBucket`)
- Computes P75 per bucket, rounded to nearest $50
- Caches the result for 5 minutes with a generation token to avoid stale-write races on `clearExpenseCapsCache()`
- Fallback chain: bucket P75 (if ≥5 samples) → venue-wide P75 → $1,750 cold-start constant
- Exports `getExpenseCaps()`, `getExpenseCapForBucket(bucket)`, `clearExpenseCapsCache()`

Updated `smartGuarantee.ts` and `dealImprovements.ts` to import from this module instead of using their old hardcoded tables. Both now use `classifyAnalyticsSizeBucket` (the analytics-canonical classifier, not the local `classifySizeBucket`) so their cap lookups match the keys that `expenseCaps.ts` derived under.

### Commit `ab3e485` — "Wire smartSwitch door hybrid cap to live expenseCaps data"
**Author: Claude Code**

In `artifacts/api-server/src/lib/smartSwitch.ts`:
- Removed `const DOOR_EXPENSE_CAP = 1500` module-level constant
- Added `import { getExpenseCapForBucket } from "./expenseCaps"`
- Door hybrid projection now calls `const expCapCeiling = await getExpenseCapForBucket(bucket)` and uses it in `const cap = Math.min(expCapCeiling, Math.round(avgExp))`

This means all three modules — `smartGuarantee`, `dealImprovements`, `smartSwitch` — now read from the same live data-driven source. If the door-bucket P75 changes as new shows settle, every projection updates within 5 minutes with no code change needed.

`switchSavings.ts` line 243 (`const cap = generated.doorExpenseCap ?? 1500`) was intentionally left unchanged — it reads the persisted value from the DB row that `smartSwitch.ts` writes, so new rows will carry the correct live cap. The `?? 1500` is a valid historical fallback for rows written before the `doorExpenseCap` column existed.

---

## What the Replit Agent Should Do Now

### Priority 1 — Fix the two pre-existing test failures

**Fix `src/lib/queries.extra.test.ts`**

The tests construct an in-memory SQLite database and run `CREATE TABLE switch_suggestions (...)`. Find that CREATE TABLE statement and add the missing column:
```sql
artist_shows_at_venue INTEGER NOT NULL DEFAULT 0
```
Run the tests after to confirm all 4 failures in this file turn green.

**Fix `src/lib/switchSavings.test.ts`**

The 4 failing tests all share the same root: `getSwitchSavings` filters out suggestions where `suggestedFlat IS NULL`, but the test fixture seeds a vs deal's switch suggestion with no `suggestedFlat` (or the suggestion isn't seeded at all). 

For each failing test:
1. Find where it seeds the `switch_suggestions` row (or where it's missing)
2. Ensure the seeded suggestion has: `shape = "flat"`, `suggestedFlat = <a concrete number>`, `source = "sgp_engine"` or `"cell_mean"` (any source that isn't `"insufficient_confidence"`)
3. Confirm the `totalToArtist` on the settlement row is also seeded so `moneySaved = actualPayout − counterfactual` is nonzero

Run `pnpm test` from `artifacts/api-server/` after each fix. Target: **0 failing tests**.

### Priority 2 — Verify the SGP numerical examples pass end-to-end

After the tests are green, run a quick sanity check on the two report examples using the live seed data or a unit test:

1. **Glass Bottle** (vs deal, $1–5K, 280 tickets × $15, 85%, guarantee $2,000): SGP should return `suggestedPrice = 2000` and `confidenceTier` of A or B.
2. **Pale Lake** (door deal, $15K+, gross $19,296, cap $1,500): door hybrid should return `doorExpenseCap = 1500`, `bandLow = 500`, `doorFloor = 500`, `doorSplitPct = 0.6`, and projected artist payout ≈ $10,020.

If either example doesn't produce the expected output from the API routes, trace through `smartGuarantee.ts` / `smartSwitch.ts` to find the divergence.

### Priority 3 — Fix the `dealMath.ts` gap (frontend, low urgency)

`artifacts/greenroom/src/lib/dealMath.ts` only supports `flat` and `percentage_of_gross` in the in-app settlement calculator. `vs`, `percentage_of_net`, and `door` return `{ supported: false }`. These deal types represent the majority of dispute-risk deals. Adding support for them would complete the settlement tool. This is a lower priority but is the most visible missing feature from a user perspective.

The formula logic for vs and percentage_of_net is:
```
net = gross − fees
pool = net − min(expenses, expenseCap)   // expenseCap from deal.expenseCap if set
pct_payout = pool × deal.percentage
artist = max(deal.guaranteeAmount, pct_payout)
```
For door:
```
pool = max(0, gross × 0.9 − min(expenses, deal.expenseCap ?? 1500))
artist = max(deal.doorFloor ?? 0, (deal.doorFloor ?? 0) + (deal.doorSplitPct ?? 0.6) × pool)
```

---

## Key Constants and Invariants to Preserve

| Constant | Value | Location | Meaning |
|---|---|---|---|
| `DOOR_FLOOR` | $500 | `smartSwitch.ts` | Guaranteed floor for any door hybrid |
| `DOOR_SPLIT_PCT` | 0.60 | `smartSwitch.ts` | Artist's share of the pool above expenses |
| `DOOR_SUPPRESS_GROSS` | $15,000 | `smartSwitch.ts` | Suppress projection above this gross (n=1 history) |
| `HOSPITALITY_CAP_DEFAULT` | $400 | `dealImprovements.ts` | Flat across all buckets per audit |
| `COLD_START_FALLBACK` | $1,750 | `expenseCaps.ts` | Used only when DB has zero expense records |
| `MIN_BUCKET_SAMPLES` | 5 | `expenseCaps.ts` | Below this, fall back to venue-wide P75 |
| `CAPS_TTL_MS` | 5 min | `expenseCaps.ts` | Cache lifetime for live expense cap data |
| `SWITCH_DISPUTE_REDUCTION` | 0.70 | `switchSavings.ts` | Modeled dispute reduction from switching structure |
| `WIDE_BAND_THRESHOLD` | $1,000 | `smartSwitch.ts` | P10–P90 spread above which UI shows a range, not a point |

Do not change these values without a corresponding update to the reference reports.

---

## Do Not Implement

- **Smart Hybrid ($5–10K floor + 50% upside)**: Described in Report 1 but intentionally deferred. The formula is `artist = floor + 50% × max(0, pct_payout − floor)` with ceiling at `SGP_flat × 1.15`. Do not add this until the user explicitly asks for it.
- **convert_to_flat improvement kind**: In `dealImprovements.ts`, this kind is intentionally omitted — flat conversion is owned by Smart Switch, which has tighter scoping rules.
