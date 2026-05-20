import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  shows, artists, agents, deals, settlements, expenses, venues,
  guaranteeSuggestions, type Deal, type Show, type Artist,
} from "../db/schema";
import { classifySizeBucket, classifyAnalyticsSizeBucket } from "./queries";
import { getExpenseCaps, clearExpenseCapsCache } from "./expenseCaps";

export type ConfidenceTier = "A" | "B" | "C" | "D";

export type GuaranteeSuggestion = typeof guaranteeSuggestions.$inferSelect;

export type ExpenseSource =
  | "artist_history_2plus"
  | "artist_history_1"
  | "agent_history"
  | "genre_p75"
  | "venue_mean";

export type ExpectedGrossSource =
  | "artist_at_venue"
  | "artist_anywhere"
  | "agent_history"
  | "cell_mean"
  | "venue_mean"
  | "capacity_proxy";

export type Winner = "guarantee" | "percentage" | "tie";

const TICKETING_FEE_RATE = 0.10;
const DEFAULT_DOOR_SPLIT = 0.70;
// Per-bucket expense ceiling is now derived from live data via
// `expenseCaps.ts` (P75 of historical billed expenses per analytics
// bucket). The previous hardcoded table here (e.g. $5–15K = $3,500)
// went stale relative to the actual ~$1,750 P75 the data shows, and
// disagreed with the parallel constant in dealImprovements.ts.
const CAPACITY_PROXY_TICKET_PRICE = 30;
const CAPACITY_PROXY_LOAD = 0.6;

type CtxRow = {
  showId: string;
  artistId: string;
  agentId: string | null;
  genre: string | null;
  date: string;
  venueId: string;
  dealType: Deal["dealType"];
  bucket: string;
  gross: number | null;
  expense: number | null;
};

type Ctx = {
  rows: CtxRow[];
  venueCapacity: number;
};

let ctxCache: { computedAt: number; ctx: Ctx } | null = null;
let ctxPending: Promise<Ctx> | null = null;
const CTX_TTL_MS = 5 * 60 * 1000;

export function clearGuaranteeCache(): void {
  ctxCache = null;
  clearExpenseCapsCache();
}

function todayDateString(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function roundTo50(n: number): number {
  return Math.round(n / 50) * 50;
}

function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

async function buildCtx(): Promise<Ctx> {
  const today = todayDateString();
  const [allShows, allDeals, allSettlements, allExpenses, allArtists, allVenues] =
    await Promise.all([
      db.select().from(shows),
      db.select().from(deals),
      db.select().from(settlements),
      db.select().from(expenses),
      db.select().from(artists),
      db.select().from(venues),
    ]);

  const dealByShow = new Map(allDeals.map((d) => [d.showId, d]));
  const settByShow = new Map(allSettlements.map((s) => [s.showId, s]));
  const expByShow = new Map<string, number>();
  for (const e of allExpenses) {
    if (e.absorbedByVenue) continue; // only count expenses billed to the artist
    expByShow.set(e.showId, (expByShow.get(e.showId) ?? 0) + e.amount);
  }
  const artistById = new Map(allArtists.map((a) => [a.id, a]));

  const rows: CtxRow[] = [];
  for (const s of allShows) {
    if (s.date > today) continue;
    const d = dealByShow.get(s.id);
    if (!d) continue;
    const settle = settByShow.get(s.id);
    const artist = artistById.get(s.artistId);
    rows.push({
      showId: s.id,
      artistId: s.artistId,
      agentId: artist?.agentId ?? null,
      genre: artist?.genre ?? null,
      date: s.date,
      venueId: s.venueId,
      dealType: d.dealType,
      bucket: classifySizeBucket(d),
      gross: settle?.grossBoxOffice ?? null,
      expense: expByShow.get(s.id) ?? settle?.totalExpenses ?? null,
    });
  }

  return {
    rows,
    venueCapacity: allVenues[0]?.capacity ?? 650,
  };
}

async function getCtx(): Promise<Ctx> {
  const now = Date.now();
  if (ctxCache && now - ctxCache.computedAt < CTX_TTL_MS) return ctxCache.ctx;
  if (ctxPending) return ctxPending;
  ctxPending = buildCtx()
    .then((ctx) => {
      ctxCache = { computedAt: Date.now(), ctx };
      return ctx;
    })
    .finally(() => {
      ctxPending = null;
    });
  return ctxPending;
}

function resolveExpectedGross(
  ctx: Ctx,
  show: { artistId: string; venueId: string; date: string },
  dealType: Deal["dealType"],
  bucket: string,
  agentId: string | null,
): { value: number; source: ExpectedGrossSource; sampleSize: number } {
  const artistAtVenue = ctx.rows.filter(
    (r) =>
      r.artistId === show.artistId &&
      r.venueId === show.venueId &&
      r.date < show.date &&
      r.gross != null,
  );
  if (artistAtVenue.length >= 1) {
    return {
      value: mean(artistAtVenue.map((r) => r.gross!)),
      source: "artist_at_venue",
      sampleSize: artistAtVenue.length,
    };
  }
  const artistAnywhere = ctx.rows.filter(
    (r) => r.artistId === show.artistId && r.date < show.date && r.gross != null,
  );
  if (artistAnywhere.length >= 1) {
    return {
      value: mean(artistAnywhere.map((r) => r.gross!)),
      source: "artist_anywhere",
      sampleSize: artistAnywhere.length,
    };
  }
  if (agentId) {
    const agentRoster = ctx.rows.filter(
      (r) => r.agentId === agentId && r.date < show.date && r.gross != null,
    );
    if (agentRoster.length >= 3) {
      return {
        value: mean(agentRoster.map((r) => r.gross!)),
        source: "agent_history",
        sampleSize: agentRoster.length,
      };
    }
  }
  const cell = ctx.rows.filter(
    (r) =>
      r.dealType === dealType &&
      r.bucket === bucket &&
      r.date < show.date &&
      r.gross != null,
  );
  if (cell.length >= 3) {
    return {
      value: mean(cell.map((r) => r.gross!)),
      source: "cell_mean",
      sampleSize: cell.length,
    };
  }
  const venueGrossRows = ctx.rows.filter(
    (r) => r.date < show.date && r.gross != null,
  );
  if (venueGrossRows.length > 0) {
    return {
      value: mean(venueGrossRows.map((r) => r.gross!)),
      source: "venue_mean",
      sampleSize: venueGrossRows.length,
    };
  }
  return {
    value: ctx.venueCapacity * CAPACITY_PROXY_LOAD * CAPACITY_PROXY_TICKET_PRICE,
    source: "capacity_proxy",
    sampleSize: 0,
  };
}

function resolveExpense(
  ctx: Ctx,
  show: { artistId: string; venueId: string; date: string },
  agentId: string | null,
  genre: string | null,
): { value: number; source: ExpenseSource; sampleSize: number } {
  const artistAtVenue = ctx.rows.filter(
    (r) =>
      r.artistId === show.artistId &&
      r.venueId === show.venueId &&
      r.date < show.date &&
      r.expense != null,
  );
  if (artistAtVenue.length >= 2) {
    return {
      value: mean(artistAtVenue.map((r) => r.expense!)),
      source: "artist_history_2plus",
      sampleSize: artistAtVenue.length,
    };
  }
  if (artistAtVenue.length === 1) {
    return {
      value: artistAtVenue[0].expense!,
      source: "artist_history_1",
      sampleSize: 1,
    };
  }
  if (agentId) {
    const agentRoster = ctx.rows.filter(
      (r) => r.agentId === agentId && r.date < show.date && r.expense != null,
    );
    if (agentRoster.length >= 3) {
      return {
        value: mean(agentRoster.map((r) => r.expense!)),
        source: "agent_history",
        sampleSize: agentRoster.length,
      };
    }
  }
  if (genre) {
    const genreRows = ctx.rows.filter(
      (r) => r.genre === genre && r.date < show.date && r.expense != null,
    );
    if (genreRows.length >= 3) {
      return {
        value: percentile(genreRows.map((r) => r.expense!), 0.75),
        source: "genre_p75",
        sampleSize: genreRows.length,
      };
    }
  }
  const venueExpenseRows = ctx.rows.filter(
    (r) => r.date < show.date && r.expense != null,
  );
  return {
    value: venueExpenseRows.length > 0
      ? mean(venueExpenseRows.map((r) => r.expense!))
      : 0,
    source: "venue_mean",
    sampleSize: venueExpenseRows.length,
  };
}

function computeConfidenceTier(
  artistShowCount: number,
  agentShowCount: number,
  winnerMargin: number,
  hasGenreData: boolean,
): ConfidenceTier {
  if (artistShowCount >= 3 && winnerMargin > 200) return "A";
  if (artistShowCount >= 1 || agentShowCount >= 3) return "B";
  if (agentShowCount >= 1 || hasGenreData) return "C";
  return "D";
}

export function computeInsuranceTier(
  dealType: Deal["dealType"],
  tier: ConfidenceTier,
  suggestedPrice: number,
  expectedGross: number,
  expenseEstimate: number,
): number {
  if (dealType === "door") return 4;
  if (tier === "D") return 4;
  // Near-breakeven: <$500 cushion between expected gross net of fees+expense and suggested price
  const cushion = expectedGross * (1 - TICKETING_FEE_RATE) - expenseEstimate - suggestedPrice;
  if (cushion < 500) return 3;
  if (tier === "C") return 3;
  // Tier 1 is the high-confidence, healthy-cushion case: non-door deal,
  // tier-A historical comparables, and ≥$1,500 of headroom between
  // expected gross-net-of-fees-and-expenses and the suggested price.
  if (tier === "A" && cushion >= 1500) return 1;
  return 2;
}

export type GeneratedGuarantee = Omit<
  GuaranteeSuggestion,
  "id" | "generatedAt"
>;

export async function generateGuarantee(
  showId: string,
  opts: {
    allowPast?: boolean;
    // Pre-loaded rows let callers (getSwitchSavings, getSwitchProjectedGrid)
    // batch-fetch shows/deals/artists once and avoid the 3 per-candidate
    // DB round-trips this function would otherwise issue.
    preloaded?: { show: Show; deal: Deal; artist: Artist | null };
    // When set and the deal is `flat`, bypass the flat-deal guard and
    // re-cast the math as if the deal were a vs split at this pct (e.g.
    // 0.85). Used by the SGP-flat-repricing backtest in `lib/sgpFlatRepricing.ts`
    // to ask "what would the engine have proposed at offer time for this
    // flat?". Caller is responsible for NOT persisting the result.
    simulateFlatAsVsPercent?: number;
  } = {},
): Promise<{ suggestion: GeneratedGuarantee | null; reason?: string }> {
  let show: Show | undefined;
  let deal: Deal | undefined;
  let artist: Artist | null;

  if (opts.preloaded) {
    show = opts.preloaded.show;
    deal = opts.preloaded.deal;
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
  const simulateFlat =
    deal.dealType === "flat" && opts.simulateFlatAsVsPercent != null;
  if (deal.dealType === "flat" && !simulateFlat) {
    return { suggestion: null, reason: "flat_deal_no_recommendation" };
  }
  const agentId = artist?.agentId ?? null;
  const genre = artist?.genre ?? null;

  const ctx = await getCtx();
  const bucket = classifySizeBucket(deal);

  // STEP 1: expected gross
  const expectedGrossInfo = resolveExpectedGross(ctx, show, deal.dealType, bucket, agentId);
  const expectedGross = expectedGrossInfo.value;

  // STEP 2: ticketing fees
  const ticketingFees = expectedGross * TICKETING_FEE_RATE;

  // STEP 3: net after fees
  const netAfterFees = expectedGross - ticketingFees;

  // STEP 4: capped expense
  // `expenseEstimate` is what we actually expect the venue to spend on
  // this show — P75 by genre/agent bucket, with an engine-side safety
  // ceiling (`defaultCap`) so adversarial / sparse seed data can't blow
  // it up. Crucially this is INDEPENDENT of the deal's `expenseCap`:
  // the deal cap is an artist-side construct (it limits what comes off
  // the top in the artist's net-base calc); it does NOT reduce what the
  // venue actually pays out. Clamping the venue's expense baseline by
  // the deal cap was the bug that collapsed projVenueNet_current onto
  // projVenueNet_sgp for tight-cap deals and made SGP look like a fake
  // winner. With this fix, `expenseEstimate` reflects venue actuals
  // and `artistDeductibleExpense` (below) reflects the artist-side cap.
  const expenseInfo = resolveExpense(ctx, show, agentId, genre);
  const dealExpenseCap = deal.expenseCap;
  const caps = await getExpenseCaps();
  // Use the analytics classifier for the cap lookup so the bucket key
  // matches how `expenseCaps.ts` *derived* its P75 distribution. Without
  // this, zero-guarantee vs/door/percentage_of_net deals would hit the
  // legacy `Uncapped %` key here while the cap module had filed their
  // siblings under `$0–1K`, re-introducing the cross-module disagreement
  // this refactor was meant to eliminate.
  const capBucket = classifyAnalyticsSizeBucket(deal);
  const defaultCap = caps.byBucket[capBucket] ?? caps.venueP75 ?? 1750;
  const expenseEstimate = Math.min(expenseInfo.value, defaultCap);
  // `effectiveCap` is retained for the persisted audit row — it now
  // means "engine safety ceiling actually applied", independent of the
  // deal cap. The deal cap is recorded separately via `dealExpenseCap`.
  const effectiveCap = defaultCap;

  // STEP 5: net base
  const netBase = Math.max(0, netAfterFees - expenseEstimate);

  // STEP 6: percentage payout
  // Defensive normalization: by convention `deals.percentage` is a fraction
  // (0.85 = 85%), but some legacy / seed rows stored whole-number percent
  // values (85). Anything > 1 is interpreted as already-in-percent and
  // divided by 100, so the SGP math doesn't blow up to ~$1M payouts.
  let pct = deal.percentage ?? 0;
  if (pct > 1) pct = pct / 100;
  let pctBasis: number;
  if (simulateFlat) {
    pct = opts.simulateFlatAsVsPercent!;
    pctBasis = netBase;
  } else if (deal.dealType === "percentage_of_gross") {
    pctBasis = expectedGross;
  } else if (deal.dealType === "door") {
    if (pct === 0) pct = DEFAULT_DOOR_SPLIT;
    pctBasis = netBase;
  } else {
    // vs, percentage_of_net
    pctBasis = netBase;
  }
  const percentagePayout = Math.max(0, pct * pctBasis);

  // STEP 7: winner & suggested price
  // For flat-simulation, the "winner" is always the percentage path: we're
  // asking "what would a fair vs-equivalent flat have been?", not picking
  // max(flat, percentage). The actual flat is recorded as `guarantee` so the
  // basis copy / audit still shows it for comparison.
  const guarantee = deal.guaranteeAmount ?? 0;
  const winner: Winner = simulateFlat
    ? "percentage"
    : Math.abs(guarantee - percentagePayout) < 1
      ? "tie"
      : guarantee > percentagePayout
        ? "guarantee"
        : "percentage";
  const winnerMargin = Math.abs(guarantee - percentagePayout);
  const winnerValue = simulateFlat
    ? percentagePayout
    : Math.max(guarantee, percentagePayout);
  const suggestedPrice = roundTo50(winnerValue);
  const breakevenGross =
    (suggestedPrice + expenseEstimate) / (1 - TICKETING_FEE_RATE);

  // Projected venue net under each deal structure. Both projections
  // subtract the same actual-expense baseline (`expenseEstimate`, the
  // venue's P75 forecast — see STEP 4) because the venue ALWAYS pays
  // its actuals regardless of what cap the agent negotiated. The two
  // numbers diverge through the ARTIST payout:
  //
  // - Current deal: artist's % comes off the cap-deflated net base
  //   (`artistDeductibleExpense = min(actuals, dealCap)`). A tight cap
  //   inflates the artist take above the fair number because the
  //   "expenses recouped" line in settlement is artificially small.
  // - SGP flat: artist gets a flat price derived from the unconstrained
  //   P75 net base — no cap dance, no overrun exposure for the venue.
  //
  // The dollar delta on tight-cap vs/%net deals is the venue's overrun
  // exposure. On loose-cap or no-cap deals the two converge (we surface
  // the qualitative SGP value in the UI tie copy).
  const artistDeductibleExpense = Math.min(
    expenseEstimate,
    deal.expenseCap ?? expenseEstimate,
  );
  const currentArtistNetBase = Math.max(0, netAfterFees - artistDeductibleExpense);
  let currentArtistPayout: number;
  switch (deal.dealType) {
    case "flat":
      currentArtistPayout = guarantee;
      break;
    case "vs":
      currentArtistPayout = Math.max(guarantee, pct * currentArtistNetBase);
      break;
    case "percentage_of_net":
      currentArtistPayout = pct * currentArtistNetBase;
      break;
    case "percentage_of_gross":
      currentArtistPayout = pct * expectedGross;
      break;
    case "door":
      // Door: artist = gross − min(actual_expenses, cap). Venue eats
      // fees + any overrun. Pre-show projection assumes actual ≈ est.
      currentArtistPayout = expectedGross - artistDeductibleExpense;
      break;
    default:
      currentArtistPayout = Math.max(guarantee, pct * currentArtistNetBase);
  }
  const projectedVenueNetSgp = netAfterFees - expenseEstimate - suggestedPrice;
  const projectedVenueNetCurrent =
    netAfterFees - expenseEstimate - currentArtistPayout;

  // Familiarity counts
  const artistShowCount = ctx.rows.filter(
    (r) => r.artistId === show.artistId && r.date < show.date,
  ).length;
  const agentShowCount = agentId
    ? ctx.rows.filter((r) => r.agentId === agentId && r.date < show.date).length
    : 0;
  const hasGenreData = !!genre &&
    ctx.rows.some((r) => r.genre === genre && r.date < show.date);

  const confidenceTier = computeConfidenceTier(
    artistShowCount,
    agentShowCount,
    winnerMargin,
    hasGenreData,
  );
  const insuranceTier = computeInsuranceTier(
    deal.dealType,
    confidenceTier,
    suggestedPrice,
    expectedGross,
    expenseEstimate,
  );

  const delta = suggestedPrice - guarantee;

  const familiarityCopy =
    artistShowCount >= 2
      ? `${artistShowCount} prior shows`
      : artistShowCount === 1
        ? "1 prior show"
        : agentShowCount > 0
          ? `agent has ${agentShowCount} other shows here`
          : "first-time artist + agent";

  const dealLabel = simulateFlat
    ? `flat (re-quoted as vs/${Math.round(pct * 100)}%)`
    : deal.dealType === "vs"
      ? "vs"
      : deal.dealType === "percentage_of_net"
        ? "% of net"
        : deal.dealType === "percentage_of_gross"
          ? "% of gross"
          : "door";

  const winnerCopy = simulateFlat
    ? `Fair vs-equivalent payout at ${Math.round(pct * 100)}% × net base = ${formatMoney(percentagePayout)} (actual flat agreed: ${formatMoney(guarantee)}, gap ${formatMoney(winnerMargin)})`
    : winner === "guarantee"
      ? `Guarantee ${formatMoney(guarantee)} beats the projected ${formatMoney(percentagePayout)} % payout by ${formatMoney(winnerMargin)}`
      : winner === "percentage"
        ? `Projected ${formatMoney(percentagePayout)} % payout exceeds the ${formatMoney(guarantee)} guarantee by ${formatMoney(winnerMargin)}`
        : `Guarantee and projected % payout are within $1`;

  const basis =
    `For this ${dealLabel} deal at the ${bucket} size, expected gross is ${formatMoney(expectedGross)} ` +
    `(${expectedGrossInfo.source.replace(/_/g, " ")}, n=${expectedGrossInfo.sampleSize}). ` +
    `Capped expense estimate ${formatMoney(expenseEstimate)} (${expenseInfo.source.replace(/_/g, " ")}, n=${expenseInfo.sampleSize}). ` +
    `${winnerCopy}, so Smart Guaranteed Price = ${formatMoney(suggestedPrice)} (rounded to nearest $50). ` +
    `Breakeven gross ${formatMoney(breakevenGross)}. Confidence ${confidenceTier} (${familiarityCopy}); insurance tier ${insuranceTier}.`;

  const audit = {
    inputs: {
      dealType: deal.dealType,
      bucket,
      guarantee,
      percentage: deal.percentage,
      dealExpenseCap,
    },
    step1_expectedGross: expectedGrossInfo,
    step2_ticketingFees: { rate: TICKETING_FEE_RATE, value: ticketingFees },
    step3_netAfterFees: netAfterFees,
    step4_expense: {
      raw: expenseInfo.value,
      source: expenseInfo.source,
      sampleSize: expenseInfo.sampleSize,
      defaultCap,
      dealExpenseCap,
      effectiveCap,
      cappedValue: expenseEstimate,
    },
    step5_netBase: netBase,
    step6_percentagePayout: { pct, basis: pctBasis, value: percentagePayout },
    step7_winner: { winner, winnerValue, suggestedPrice, breakevenGross },
    familiarity: { artistShowCount, agentShowCount, hasGenreData },
  };

  const suggestion: GeneratedGuarantee = {
    showId,
    dealId: deal.id,
    agentGuarantee: guarantee,
    suggestedPrice,
    delta,
    expectedGross,
    expectedGrossSource: expectedGrossInfo.source,
    ticketingFees,
    netAfterFees,
    expenseEstimate,
    expenseSource: expenseInfo.source,
    expenseCap: effectiveCap,
    netBase,
    percentagePayout,
    winner,
    winnerMargin,
    breakevenGross,
    artistShowCount,
    agentShowCount,
    confidenceTier,
    insuranceTier,
    basis,
    auditJson: JSON.stringify(audit),
    projectedVenueNetSgp,
    projectedVenueNetCurrent,
  };

  return { suggestion };
}

export async function getGuaranteeForShow(
  showId: string,
): Promise<GuaranteeSuggestion | null> {
  const rows = await db
    .select()
    .from(guaranteeSuggestions)
    .where(eq(guaranteeSuggestions.showId, showId));
  return rows[0] ?? null;
}

export type BackfillResult = {
  scanned: number;
  generated: number;
  recomputed: number;
  skipped: number;
  failed: number;
};

export async function backfillUpcomingGuarantees(
  opts: { forceAll?: boolean } = {},
): Promise<BackfillResult> {
  const today = todayDateString();
  const [allShows, allDeals, existing] = await Promise.all([
    db.select().from(shows),
    db.select().from(deals),
    db.select().from(guaranteeSuggestions),
  ]);
  const dealByShow = new Map(allDeals.map((d) => [d.showId, d]));
  const sugByShow = new Map(existing.map((g) => [g.showId, g]));

  // Refresh ctx cache so a fresh scan reflects any newly-added past data.
  clearGuaranteeCache();

  const candidates = allShows.filter(
    (s) =>
      s.date >= today &&
      (s.status === "booked" || s.status === "advanced"),
  );

  let generated = 0;
  let recomputed = 0;
  let skipped = 0;
  let failed = 0;

  for (const show of candidates) {
    const deal = dealByShow.get(show.id);
    if (!deal || deal.dealType === "flat") {
      skipped++;
      continue;
    }
    const existingSug = sugByShow.get(show.id);
    let needs = opts.forceAll || !existingSug;
    if (existingSug && !needs) {
      try {
        const audit = JSON.parse(existingSug.auditJson) as {
          inputs?: {
            dealType?: string;
            guarantee?: number | null;
            percentage?: number | null;
            dealExpenseCap?: number | null;
          };
        };
        const inp = audit.inputs ?? {};
        if (
          inp.dealType !== deal.dealType ||
          (inp.guarantee ?? 0) !== (deal.guaranteeAmount ?? 0) ||
          (inp.percentage ?? null) !== (deal.percentage ?? null) ||
          (inp.dealExpenseCap ?? null) !== (deal.expenseCap ?? null)
        ) {
          needs = true;
        }
      } catch {
        needs = true;
      }
    }
    if (!needs) {
      skipped++;
      continue;
    }
    try {
      const out = await generateAndPersistGuarantee(show.id);
      if (out.suggestion) {
        if (existingSug) recomputed++;
        else generated++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { scanned: candidates.length, generated, recomputed, skipped, failed };
}

export async function generateAndPersistGuarantee(
  showId: string,
): Promise<{ suggestion: GuaranteeSuggestion | null; reason?: string }> {
  const existing = await getGuaranteeForShow(showId);
  // Always recompute on demand: replace existing.
  const out = await generateGuarantee(showId);
  if (!out.suggestion) return { suggestion: null, reason: out.reason };

  const id = existing?.id ?? randomUUID();
  const generatedAt = new Date();
  if (existing) {
    await db
      .delete(guaranteeSuggestions)
      .where(eq(guaranteeSuggestions.showId, showId));
  }
  await db.insert(guaranteeSuggestions).values({
    id,
    generatedAt,
    ...out.suggestion,
  });
  const fresh = await getGuaranteeForShow(showId);
  return { suggestion: fresh };
}
