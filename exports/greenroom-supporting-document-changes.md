# Supporting Document — Drift Report

**Generated:** 2026-05-14 (regenerated after the May 14 batch-fetch
optimization in `switchSavings.ts` — the OUTPUT of every endpoint is
unchanged, but the report was re-verified against the live API to
confirm that.)
**Source of truth:** Live API at this commit
**Audit target:** `exports/greenroom-supporting-document.{html,pdf}`

This document lists every cited figure in `greenroom-supporting-document` that
no longer matches the live Greenroom API, with the proposed replacement text
and the API call used to verify each number.

---

## TL;DR

- **Stable (no change needed):** core Reports KPIs, the cross-tab cell counts
  and dispute rates (`137 vs/$1–5K deals`, `12.4% vs disputes`, `3.8% flat
  disputes`), and LLM enrichment coverage.
- **Drifted (substantive update needed):** every figure derived from the
  Smart Switch projected-grid and the SGP backtest distribution. The doc
  was generated against an older snapshot where the SGP backtest scanned
  ~321 deals; the current 12-month window scans 156. Six figures need to
  change.

---

## Stable rows (verified, leave as-is)

| Doc claim                                       | Doc value     | Live value         | Notes |
|-------------------------------------------------|---------------|--------------------|---|
| Past settlements                                | 509           | 509                | ✓ |
| Disputed settlements                            | 22 (4.3%)     | 22 (4.32%)         | ✓ |
| Disputed-recoup value (avg)                     | $7,582 ($345) | $7,582 ($344.6)    | ✓ rounding only |
| LLM enrichment coverage                         | 237 / 558 (42%) | 237 / 558 (42%)  | ✓ |
| `vs · $1–5K` deal count                         | 137           | 137                | ✓ |
| `vs · $1–5K` dispute rate                       | 12.4%         | 12.41%             | ✓ |
| `flat · $1–5K` dispute rate                     | 3.8%          | 3.85%              | ✓ |

Endpoints used: `GET /api/reports`, `GET /api/deal-analysis`
(`revenue.crossTabBySizeAndType.cells`), `GET /api/insights`.

---

## Drifted rows (need to be updated in the doc)

### 1. Smart Switch projected savings · vs/$1–5K

- **Doc text:** "Switching the 137 vs/$1–5K deals to flat would have saved
  $23,024" (also rendered as `$22,774` in the supporting-numbers table).
- **Live value:** **$9,186** savings to venue across **34** switch-eligible
  vs/$1–5K deals.
- **Why it changed:** `switch-projected-grid` now applies stricter eligibility
  (must be settled + have all inputs available pre-show + Smart Switch must
  have a valid suggestion). Of the 137 vs/$1–5K cells in the analytics grid,
  only 34 now satisfy that bar. The cell-count of 137 in the cross-tab is
  unaffected because the analytics grid is unconditional.
- **Endpoint:** `GET /api/insights/switch-projected-grid`,
  `cells[dealType=vs, bucket=$1–5K]`.
- **Proposed replacement (table row):**
  > Smart Switch projected savings · vs/$1–5K · $9,186 across 34 switch-eligible deals
- **Proposed replacement (narrative line):**
  > Switching the 34 vs/$1–5K deals Smart Switch could have handled would
  > have saved $9,186 (venue side). The wider 137-deal cell is the
  > analytics base; the 34-deal slice is the actionable sub-set.

### 2. Door deals — largest savings cell

- **Doc text:** "Door deals are the single largest savings cell (~$50K via
  hybrid)."
- **Live value:** Door cells combined now save **$13,211** to the venue,
  concentrated in `door · $0–1K` (6 deals, $27,549 actual → $14,338
  projected = $13,211 saved).
- **Why it changed:** door deals shifted out of larger size buckets as the
  data window slid; only the $0–1K cell still has switch-applies coverage.
  The "$50K" figure is no longer reproducible from the live grid.
- **Endpoint:** `GET /api/insights/switch-projected-grid`, sum of
  `moneySavedToVenue` over `dealType="door"` cells.
- **Proposed replacement:**
  > Door deals remain the highest per-deal savings shape (avg ~$2,200
  > saved per converted door deal). The current 12-month window has 6
  > switch-eligible door deals concentrated in $0–1K, for $13,211 total
  > venue-side savings.

### 3. vs deals · percentage clause never fired

- **Doc text:** "11/64 (17.2%) of settled vs / $1–5K deals had the
  percentage clause never out-pay the guarantee."
- **Live value (default 3-month window):** **3/14 (21.4%)** never-fired.
- **Live value (24-month window, `?months=24`):** **17/133 (12.78%)**
  never-fired — matches the previous drift-report value.
- **Why it changed twice:**
  1. The `vsPercentageFiredStats` block is now scoped per-call to
     whatever window the caller asks for. The Insights tab now defaults
     to **3 months**, so the headline number on screen is the narrow
     window (3/14), not the wide one (17/133).
  2. Across the 24-month history, the scope was also widened from
     "$1–5K guarantee only" to "all settled vs deals," which is what
     produced the 17/133 figure cited in the previous version of this
     drift report.
- **Endpoint:** `GET /api/insights/switch-savings` (default 3 months),
  field `vsPercentageFiredStats`; pass `?months=24` for the historical
  figure.
- **Proposed replacement:**
  > In the last 3 months, 3 of 14 settled vs deals (21.4%) had the
  > percentage clause never out-pay the guarantee. Across the full
  > 24-month history, that rate is 17 / 133 (12.8%). Either way the
  > flat fallback is the right primary recommendation for the cell.
- **Knock-on edit:** the line "The percentage clause out-pays the
  guarantee in 86.7% of vs deals (avg = $0 when it doesn't)" should
  read **78.6%** (= 11/14) in the 3-month window or **87.2%**
  (= 116/133) in the 24-month window. The "$0 when it doesn't" half
  is still accurate (`avgGuaranteeWin = 0`) in both windows.

### 4. SGP gap distribution (median · p75 · p90)

- **Doc text:** "median $1,119 · p75 $1,939 · p90 $3,344"
- **Live value:** **median $870 · p75 $1,569 · p90 $2,575**.
- **Why it changed:** the SGP backtest is now scoped to the rolling
  12-month window (n=156). The doc's figures came from a wider window
  (n=321). The insurance pricing brief already supersedes these
  numbers explicitly — the supporting doc needs the same update.
- **Endpoint:** `GET /api/insights/guarantee-backtest`,
  `gapCoverage.{medianAbsDelta, p75AbsDelta, p90AbsDelta}`.
- **Proposed replacement:**
  > SGP gap distribution (median · p75 · p90) · $870 · $1,569 · $2,575
  > (12-month window, n=156)

### 5. SGP gap fully covered at $400

- **Doc text:** "25.2%"
- **Live value:** **29.5%** (46 of 156 deals fully covered at the
  $400 threshold).
- **Why it changed:** smaller, more recent window → tighter typical
  gaps → higher coverage rate at any given cap.
- **Endpoint:** `GET /api/insights/guarantee-backtest`,
  `gapCoverage.buckets[threshold=400].rate`.
- **Proposed replacement:**
  > SGP gap fully covered at $400 · 29.5%

### 6. SGP backtest size used by Product 2 cap sizing

- **Doc text:** implicit in the description block:
  "Now also reports `gapCoverage` (median $1,119 · p75 $1,939 · p90
  $3,344) used for Phase-3 Product 2 cap sizing."
- **Live value:** the inline (median · p75 · p90) values are the ones
  flagged in row 4 above. Also: explicit n is not in the doc; the
  insurance brief now cites n=156 — for consistency, add this to the
  supporting doc too.
- **Proposed replacement:**
  > Reports `gapCoverage` over the rolling 12-month window
  > (n=156, median $870 · p75 $1,569 · p90 $2,575); used for Phase-3
  > Product 2 cap sizing.

---

## Document-level recommendations

1. **Add a regeneration timestamp** at the top of the doc (the insurance
   brief already does this). Without it, future readers can't tell at a
   glance whether numbers match the live API.
2. **Add a "regenerated against live API at commit X" line** so the
   reader knows which snapshot the doc is bound to.
3. **Optional consolidation:** consider moving the SGP-backtest figures
   into a single block that's regenerated from one API call. As written,
   the median/p75/p90 numbers appear in two separate places (the
   description block for `guaranteeBacktest` and the supporting-numbers
   table), making them easy to drift out of sync — as in fact happened.

---

## Verification recipe

Anyone can reproduce this drift report with:

```bash
curl -s http://localhost:80/api/reports                            > /tmp/reports.json
curl -s http://localhost:80/api/deal-analysis                      > /tmp/da.json
curl -s http://localhost:80/api/insights                           > /tmp/ins.json
curl -s http://localhost:80/api/insights/guarantee-backtest        > /tmp/gb.json
curl -s http://localhost:80/api/insights/switch-savings            > /tmp/ss.json
curl -s http://localhost:80/api/insights/switch-projected-grid     > /tmp/spg.json
```

then cross-reference each row above against the relevant JSON field.

---

## Change count

- 7 stable rows (no edit needed).
- 6 drifted rows (substantive numeric updates).
- 1 supplementary line (`avgGuaranteeWin` complement: drift report
  previously said 86.7% → 87.2%; the current default (3-month) window
  is 78.6% (11/14), and the 24-month window is 87.2% (116/133)).
- 0 schema changes — only the numbers move.

## Re-verification log (May 14, 2026)

Re-ran the report against the live API after the N+1 batch-fetch fix
landed in `switchSavings.ts`. The optimization is purely structural
(pre-fetch artists once instead of per-candidate); it does not change
any output. Verified each row:

| Row | Status |
|---|---|
| 1. switch-grid vs/$1–5K savings ($9,186 / 34) | unchanged ✓ |
| 2. door total savings ($13,211 / 6 deals in $0–1K) | unchanged ✓ |
| 3. vsPercentageFiredStats | **drifted again** — see row 3 above. The endpoint is now window-scoped; the headline (3-month default) is 3/14 (21.4%), the 24-month historical is 17/133 (12.78%). |
| 4. SGP median $870 / p75 $1,569 / p90 $2,575 | unchanged ✓ |
| 5. SGP $400 coverage 29.5% (46/156) | unchanged ✓ |
| 6. SGP backtest n=156 | unchanged ✓ |

The only line that needs to change in the supporting doc since the
last regeneration of this drift report is row 3, and only because the
Insights tab now defaults to a 3-month window. Adding a window note to
the doc (or pinning the URL to `?months=24` when citing the historical
figure) is the durable fix.
