# Replit Agent Prompt — Greenroom API Server Bug Fixes

## Context

You are working inside the `artifacts/api-server/src/lib/` directory of the
Greenroom monorepo. A prior code-review session identified five issues; three
were already fixed. This prompt covers the **two remaining code bugs** and
**three maintenance items** that still need attention.

Do **not** touch anything outside `artifacts/api-server/src/lib/` and
`artifacts/api-server/src/lib/*.test.ts` unless a fix genuinely requires it.
After every change, run the full test suite (`npm test` inside
`artifacts/api-server`) and confirm it is green before moving on.

---

## Issues to Fix

---

### Fix 1 — `computeInsuranceTier` never emits tier 1  
**File:** `artifacts/api-server/src/lib/smartGuarantee.ts`  
**Severity:** LOW — undocumented gap, but tier 1 is referenced in the UI type
contract (`GuaranteeSuggestion.insuranceTier: number`) and in documentation.

**Current code (around line 311):**

```ts
function computeInsuranceTier(
  dealType: Deal["dealType"],
  tier: ConfidenceTier,
  suggestedPrice: number,
  expectedGross: number,
  expenseEstimate: number,
): number {
  if (dealType === "door") return 4;
  if (tier === "D") return 4;
  const cushion = expectedGross * (1 - TICKETING_FEE_RATE) - expenseEstimate - suggestedPrice;
  if (cushion < 500) return 3;
  if (tier === "C") return 3;
  return 2;           // <-- tier 1 is never reachable
}
```

**Problem:** The function can only return 2, 3, or 4. Tier 1 is meant to
signal the highest-confidence, best-cushion scenario but is never assigned.

**Required fix:** Add a tier-1 condition. The rule should be:
- Deal type is **not** `door`
- Confidence tier is **`A`**
- Cushion is **≥ $1,500** (i.e., expected gross net of ticketing fees and
  expenses exceeds the suggested price by at least $1,500)

Replace the final `return 2` with:

```ts
  if (tier === "A" && cushion >= 1500) return 1;
  return 2;
```

The full corrected function:

```ts
function computeInsuranceTier(
  dealType: Deal["dealType"],
  tier: ConfidenceTier,
  suggestedPrice: number,
  expectedGross: number,
  expenseEstimate: number,
): number {
  if (dealType === "door") return 4;
  if (tier === "D") return 4;
  const cushion = expectedGross * (1 - TICKETING_FEE_RATE) - expenseEstimate - suggestedPrice;
  if (cushion < 500) return 3;
  if (tier === "C") return 3;
  if (tier === "A" && cushion >= 1500) return 1;
  return 2;
}
```

---

### Fix 2 — N+1 DB queries inside `getSwitchSavings` and `getSwitchProjectedGrid`  
**File:** `artifacts/api-server/src/lib/smartGuarantee.ts` (primary),
`artifacts/api-server/src/lib/switchSavings.ts` (context)  
**Severity:** LOW–PERFORMANCE — ~3 extra DB round-trips per candidate, ~150
extra queries at 50 candidates per request.

**Root cause:** `generateGuarantee(showId)` (called per-candidate via
`generateSuggestion`) issues three individual `db.select()` queries inside
its body to fetch the show, deal, and artist rows for that `showId` (around
lines 336, 343, 350 of `smartGuarantee.ts`):

```ts
const showRows  = await db.select().from(shows).where(eq(shows.id, showId));
const dealRows  = await db.select().from(deals).where(eq(deals.showId, showId));
const artistRows = await db.select().from(artists).where(eq(artists.id, show.artistId));
```

`getSwitchSavings` and `getSwitchProjectedGrid` both already bulk-pre-fetch
data before their loops. The fix is to **pass the already-loaded rows** into
`generateGuarantee` rather than re-fetching them.

**Required changes:**

1. **Add an optional `preloaded` parameter to `generateGuarantee`:**

```ts
export async function generateGuarantee(
  showId: string,
  opts: {
    allowPast?: boolean;
    preloaded?: { show: Show; deal: Deal; artist: Artist | null };
  } = {},
): Promise<{ suggestion: GeneratedGuarantee | null; reason?: string }> {
  let show: Show | undefined;
  let deal: Deal | undefined;
  let artist: Artist | null;

  if (opts.preloaded) {
    show   = opts.preloaded.show;
    deal   = opts.preloaded.deal;
    artist = opts.preloaded.artist;
  } else {
    const showRows = await db.select().from(shows).where(eq(shows.id, showId));
    show = showRows[0];
    if (!show) return { suggestion: null, reason: "no_show" };

    const dealRows = await db.select().from(deals).where(eq(deals.showId, showId));
    deal = dealRows[0];
    if (!deal) return { suggestion: null, reason: "no_deal" };

    const artistRows = await db.select().from(artists).where(eq(artists.id, show.artistId));
    artist = artistRows[0] ?? null;
  }

  if (!show) return { suggestion: null, reason: "no_show" };
  if (!opts.allowPast && show.date < todayDateString()) {
    return { suggestion: null, reason: "show_already_past" };
  }
  if (!deal) return { suggestion: null, reason: "no_deal" };
  if (deal.dealType === "flat") {
    return { suggestion: null, reason: "flat_deal_no_recommendation" };
  }
  // ... rest of function unchanged
}
```

2. **Thread `preloaded` through `generateSuggestion` in `smartSwitch.ts`:**

`generateSuggestion` receives `deal` and `showId`. It already has the deal.
Add an optional `preloaded` field and pass it to `generateGuarantee`:

```ts
export async function generateSuggestion(
  deal: Deal,
  artistShowsAtVenue = 0,
  showId?: string,
  preloaded?: { show: Show; deal: Deal; artist: Artist | null },
): Promise<GeneratedSuggestion | null> {
  // ...
  if (showId) {
    const sgp = await generateGuarantee(showId, { allowPast: true, preloaded });
    // ...
  }
}
```

3. **Pass preloaded data from the loops in `switchSavings.ts`:**

In both the `getSwitchSavings` loop (line ~213) and the
`getSwitchProjectedGrid` loop (line ~450), pass the rows that are already
in scope:

```ts
// getSwitchSavings — r.show, r.deal are already available; artist lookup
// can be resolved from the bulk-fetched artist map (add one if not present):
const generated = await generateSuggestion(deal, artistN, show.id, {
  show: r.show,
  deal: r.deal!,
  artist: artistByShow.get(show.id) ?? null,
});
```

You will need to pre-fetch artists indexed by show (via `artistId`) in the
same `Promise.all` block that already loads expenses and the prior-show
index. Add:

```ts
const [allExpenses, priorIndex, allArtists] = await Promise.all([
  db.select().from(expenses),
  buildPriorShowIndex(),
  db.select().from(artists),
]);
const artistById = new Map(allArtists.map((a) => [a.id, a]));
```

Then inside the loop:

```ts
const artist = artistById.get(show.artistId) ?? null;
const generated = await generateSuggestion(deal, artistN, show.id, {
  show: r.show,
  deal: r.deal!,
  artist,
});
```

Apply the same pattern to the `getSwitchProjectedGrid` loop.

---

### Fix 3 — Remove duplicate comment block in `switchSavings.ts`  
**File:** `artifacts/api-server/src/lib/switchSavings.ts`  
**Severity:** COSMETIC — stale draft comment block left in production code.

Around line 315 there are **two consecutive comment blocks** describing the
`vsPercentageFiredStats` section. The first block (the broader one that says
"This is the strongest single Phase-2 evidence point") is an earlier draft.
The second block (scoped to the `$1–5K` bucket, explaining _why_ it is
scoped) is the correct, final version.

**Required fix:** Delete the first comment block entirely, keeping only the
scoped version that starts with:

```
// Vs-percentage-clause coverage: across every settled `vs` deal in the
// $1–5K bucket in the window, how many had the percentage clause
// out-pay the guarantee? Scoped to $1–5K because that is the only
// bucket where Smart Switch's guarantee-amount fallback applies...
```

---

## Verification Tests

After making the fixes above, add or extend the following test files. All
test files live in `artifacts/api-server/src/lib/`.

---

### Test A — `computeInsuranceTier` emits all four tiers  
**File:** `artifacts/api-server/src/lib/smartGuarantee.insuranceTier.test.ts`  
(new file)

```ts
import { describe, it, expect } from "vitest";

// computeInsuranceTier is not exported — test it via the public
// generateGuarantee return value by mocking ctx data, OR export the
// function for testing. Prefer exporting it as a named export with
// `export` keyword added in smartGuarantee.ts.
import { computeInsuranceTier } from "./smartGuarantee";

describe("computeInsuranceTier", () => {
  it("returns 4 for door deals regardless of tier", () => {
    expect(computeInsuranceTier("door", "A", 1000, 5000, 500)).toBe(4);
  });

  it("returns 4 for confidence tier D", () => {
    expect(computeInsuranceTier("vs", "D", 1000, 5000, 500)).toBe(4);
  });

  it("returns 3 when cushion < 500", () => {
    // cushion = 5000 * 0.9 - 500 - 4100 = 4500 - 500 - 4100 = -100
    expect(computeInsuranceTier("vs", "A", 4100, 5000, 500)).toBe(3);
  });

  it("returns 3 for confidence tier C even with good cushion", () => {
    // cushion = 5000 * 0.9 - 500 - 1000 = 3000 (>= 500, >= 1500)
    expect(computeInsuranceTier("vs", "C", 1000, 5000, 500)).toBe(3);
  });

  it("returns 2 for tier A with cushion between 500 and 1500", () => {
    // cushion = 5000 * 0.9 - 500 - 3000 = 4500 - 500 - 3000 = 1000
    expect(computeInsuranceTier("vs", "A", 3000, 5000, 500)).toBe(2);
  });

  it("returns 2 for tier B with large cushion", () => {
    // cushion = 10000 * 0.9 - 500 - 1000 = 7500 (>= 1500) but tier is B
    expect(computeInsuranceTier("vs", "B", 1000, 10000, 500)).toBe(2);
  });

  it("returns 1 for tier A with cushion >= 1500", () => {
    // cushion = 10000 * 0.9 - 500 - 1000 = 7500
    expect(computeInsuranceTier("vs", "A", 1000, 10000, 500)).toBe(1);
  });
});
```

> **Note:** To make `computeInsuranceTier` importable, add the `export`
> keyword to its declaration in `smartGuarantee.ts`. It is a pure function
> so exporting it carries no risk.

---

### Test B — `getSwitchSavings` does not issue per-candidate DB queries  
**File:** `artifacts/api-server/src/lib/switchSavings.n1.test.ts`  
(new file)

This test verifies the N+1 fix by spying on `db.select` and confirming the
call count does **not** grow linearly with candidate count.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as dbModule from "../db";
import { getSwitchSavings } from "./switchSavings";

describe("getSwitchSavings — no N+1 queries", () => {
  it("issues O(1) DB calls regardless of candidate count", async () => {
    const selectSpy = vi.spyOn(dbModule.db, "select");

    await getSwitchSavings({ months: 24, topN: 5 });

    // With the fix, db.select is called a fixed number of times in the
    // pre-fetch phase (shows, deals, settlements, expenses, artists,
    // prior-show index) — not once per candidate. The exact count may vary
    // by implementation; the important invariant is that it is bounded and
    // small (< 20), not proportional to candidate count.
    const callCount = selectSpy.mock.calls.length;
    expect(callCount).toBeLessThan(20);

    selectSpy.mockRestore();
  });
});
```

---

### Test C — `dealImprovements` bucket assignment matches analytics grid  
**File:** `artifacts/api-server/src/lib/dealImprovements.bucket.test.ts`  
(new file)

This is the regression guard for Fix #2 from the previous session (already
merged), ensuring the fixed behaviour doesn't regress.

```ts
import { describe, it, expect } from "vitest";
import { classifyAnalyticsSizeBucket } from "./queries";

describe("classifyAnalyticsSizeBucket — zero-guarantee vs deal", () => {
  it("routes a zero-guarantee vs deal to $0–1K, not Uncapped %", () => {
    const deal = {
      dealType: "vs" as const,
      guaranteeAmount: 0,
      percentage: 0.8,
      percentageOf: "gross" as const,
    };
    const bucket = classifyAnalyticsSizeBucket(deal as any);
    expect(bucket).toBe("$0–1K");
    expect(bucket).not.toBe("Uncapped %");
  });

  it("routes a null-guarantee vs deal to $0–1K, not Uncapped %", () => {
    const deal = {
      dealType: "vs" as const,
      guaranteeAmount: null,
      percentage: 0.8,
      percentageOf: "gross" as const,
    };
    const bucket = classifyAnalyticsSizeBucket(deal as any);
    expect(bucket).toBe("$0–1K");
    expect(bucket).not.toBe("Uncapped %");
  });

  it("routes a pure percentage_of_gross deal with no guarantee to Uncapped %", () => {
    const deal = {
      dealType: "percentage_of_gross" as const,
      guaranteeAmount: null,
      percentage: 0.85,
      percentageOf: "gross" as const,
    };
    const bucket = classifyAnalyticsSizeBucket(deal as any);
    expect(bucket).toBe("Uncapped %");
  });
});
```

---

## Acceptance Criteria

All of the following must be true before the task is considered done:

1. `npm test` inside `artifacts/api-server` exits **green** (all existing
   tests pass, all new tests pass).
2. `npx tsc --noEmit` inside `artifacts/api-server` exits **clean** (no type
   errors).
3. `computeInsuranceTier` is exported and the new
   `smartGuarantee.insuranceTier.test.ts` shows **7/7 passing**.
4. `switchSavings.n1.test.ts` passes — the spy reports fewer than 20
   `db.select` calls for a full `getSwitchSavings` run.
5. `dealImprovements.bucket.test.ts` passes — **3/3 passing**.
6. The duplicate comment block in `switchSavings.ts` is gone (only one
   `vsPercentageFiredStats` comment block remains).
7. No regressions in the existing 70 tests.
