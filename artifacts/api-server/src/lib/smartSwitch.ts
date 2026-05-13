import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "../db";
import {
  deals, settlements, shows, expenses, switchSuggestions,
  type Deal,
} from "../db/schema";
import { classifyAnalyticsSizeBucket as classifySizeBucket } from "./queries";
import { generateGuarantee } from "./smartGuarantee";

export type ConfidenceTier = "A" | "B" | "C" | "D";

export type SwitchSuggestion = typeof switchSuggestions.$inferSelect & {
  // Audit acceptance: derived field, present on every API exposure.
  isDeadPool: boolean;
};

type CellStats = {
  n: number;
  avgGross: number;
  avgPayout: number;
  avgExpenses: number;
  p10Payout: number;
  p90Payout: number;
  payouts: number[];
};

function computeTier(cellN: number, artistShowsAtVenue: number): ConfidenceTier {
  // Cell sample size sets the ceiling.
  let tier: ConfidenceTier;
  if (cellN >= 20) tier = "A";
  else if (cellN >= 8) tier = "B";
  else if (cellN >= 3) tier = "C";
  else tier = "D";

  // First-time / one-time artists at this venue demote the ceiling: even
  // with abundant comparable deals, we don't know how THIS artist behaves
  // on settlement night. Cap at B until we have at least 2 prior shows.
  if (artistShowsAtVenue < 2 && tier === "A") tier = "B";

  return tier;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
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

let cellStatsCache: { computedAt: number; stats: Map<string, CellStats> } | null = null;
let cellStatsPending: Promise<Map<string, CellStats>> | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

function todayDateString(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

async function getCellStats(): Promise<Map<string, CellStats>> {
  const now = Date.now();
  if (cellStatsCache && now - cellStatsCache.computedAt < CACHE_TTL_MS) {
    return cellStatsCache.stats;
  }
  if (cellStatsPending) return cellStatsPending;
  cellStatsPending = computeCellStats().finally(() => {
    cellStatsPending = null;
  });
  return cellStatsPending;
}

async function computeCellStats(): Promise<Map<string, CellStats>> {
  const today = todayDateString();
  const allShows = await db.select().from(shows);
  const pastShowIds = new Set(allShows.filter((s) => s.date <= today).map((s) => s.id));

  const allDeals = await db.select().from(deals);
  const allSettlements = await db.select().from(settlements);
  const allExpenses = await db.select().from(expenses);

  const settlementByShow = new Map(allSettlements.map((s) => [s.showId, s]));
  const expensesByShow = new Map<string, number>();
  for (const e of allExpenses) {
    if (e.absorbedByVenue) continue; // only count expenses billed to the artist
    expensesByShow.set(e.showId, (expensesByShow.get(e.showId) ?? 0) + e.amount);
  }

  const acc = new Map<string, { grosses: number[]; payouts: number[]; expenses: number[] }>();
  for (const d of allDeals) {
    if (!pastShowIds.has(d.showId)) continue;
    const s = settlementByShow.get(d.showId);
    if (!s || s.totalToArtist == null || s.grossBoxOffice == null) continue;
    const bucket = classifySizeBucket(d);
    const key = `${d.dealType}::${bucket}`;
    let row = acc.get(key);
    if (!row) { row = { grosses: [], payouts: [], expenses: [] }; acc.set(key, row); }
    row.grosses.push(s.grossBoxOffice);
    row.payouts.push(s.totalToArtist);
    row.expenses.push(expensesByShow.get(d.showId) ?? 0);
  }

  const stats = new Map<string, CellStats>();
  for (const [key, row] of acc) {
    if (row.payouts.length === 0) continue;
    const sortedPayouts = [...row.payouts].sort((a, b) => a - b);
    stats.set(key, {
      n: row.payouts.length,
      avgGross: row.grosses.reduce((a, b) => a + b, 0) / row.grosses.length,
      avgPayout: row.payouts.reduce((a, b) => a + b, 0) / row.payouts.length,
      avgExpenses: row.expenses.reduce((a, b) => a + b, 0) / row.expenses.length,
      p10Payout: percentile(sortedPayouts, 0.1),
      p90Payout: percentile(sortedPayouts, 0.9),
      payouts: sortedPayouts,
    });
  }

  cellStatsCache = { computedAt: Date.now(), stats };
  return stats;
}

export function clearSmartSwitchCache(): void {
  cellStatsCache = null;
}

export type SwitchSource =
  | "sgp_engine"
  | "guarantee_amount"
  | "cell_mean"
  | "door_hybrid_calc"
  | "door_dead_pool"
  | "suppressed";

export type GeneratedSuggestion = {
  shape: "flat" | "door_hybrid";
  dealTypeFrom: Deal["dealType"];
  suggestedFlat: number | null;
  doorFloor: number | null;
  doorSplitPct: number | null;
  doorExpenseCap: number | null;
  confidenceTier: ConfidenceTier;
  bandLow: number | null;
  bandHigh: number | null;
  bandWidth: number | null;
  source: SwitchSource;
  sampleSize: number;
  basis: string;
  // Audit acceptance: explicit boolean signal that the door hybrid degenerated
  // to a pure floor deal because the projected available pool after expenses
  // didn't even cover the floor. Derived from source === "door_dead_pool"
  // so callers don't have to know the source enum vocabulary.
  isDeadPool: boolean;
};

/** Source-of-truth for the dead-pool boolean. Anywhere that reads a
 * persisted SwitchSuggestion must derive the field from this. */
export function deriveIsDeadPool(source: SwitchSource | null | undefined): boolean {
  return source === "door_dead_pool";
}

const DOOR_FLOOR = 500;
const DOOR_SPLIT_PCT = 0.6;
const DOOR_EXPENSE_CAP = 1500;
// Audit threshold: when the cell payout band is wider than $1,000 (P10–P90),
// a single-number "flat at $X" promise is dishonest. Demote display tier so
// the UI renders a range ($X ± $Y) instead.
const WIDE_BAND_THRESHOLD = 1000;
// Audit: door deals at $15K+ have n=1 in our history (Pale Lake) — refuse to
// project hybrid math on a single data point. Surface as "discuss directly".
const DOOR_SUPPRESS_GROSS = 15000;

export function switchAppliesTo(dealType: string, bucket: string): boolean {
  // Policy: replace any door deal with the door hybrid; replace vs / % of net
  // deals in the $1–5K bucket with a flat; leave everything else alone.
  if (dealType === "door") return true;
  if ((dealType === "vs" || dealType === "percentage_of_net") && bucket === "$1–5K") return true;
  return false;
}

export async function generateSuggestion(
  deal: Deal,
  artistShowsAtVenue = 0,
  showId?: string,
): Promise<GeneratedSuggestion | null> {
  const stats = await getCellStats();
  const bucket = classifySizeBucket(deal);
  if (!switchAppliesTo(deal.dealType, bucket)) return null;
  const familiarity =
    artistShowsAtVenue === 0
      ? "first-time"
      : artistShowsAtVenue === 1
        ? "1 prior show at the venue"
        : `${artistShowsAtVenue} prior shows at the venue`;

  if (deal.dealType === "vs" || deal.dealType === "percentage_of_net") {
    const cell = stats.get(`${deal.dealType}::${bucket}`);
    const cellBandWidth = cell ? roundTo50(cell.p90Payout - cell.p10Payout) : null;

    // Preferred path: route through the Smart Guaranteed Price 7-step engine
    // (artist→agent→genre→venue waterfall, capped expense, % payout vs.
    // guarantee winner). This unifies "Smart Switch flat" and "Smart
    // Guaranteed Price" into one number for $1–5K vs / % of net deals.
    if (showId) {
      const sgp = await generateGuarantee(showId, { allowPast: true });
      if (sgp.suggestion) {
        const g = sgp.suggestion;
        const sgpTier = g.confidenceTier as ConfidenceTier;
        // Audit safety rule: SGP is only authoritative at tier A or B. When
        // SGP itself is uncertain (C/D), prefer the contract guarantee — a
        // known number on paper beats a low-confidence estimate.
        const sgpIsConfident = sgpTier === "A" || sgpTier === "B";
        if (sgpIsConfident) {
          return {
            shape: "flat",
            dealTypeFrom: deal.dealType,
            suggestedFlat: g.suggestedPrice,
            doorFloor: null,
            doorSplitPct: null,
            doorExpenseCap: null,
            confidenceTier: sgpTier,
            bandLow: cell ? roundTo50(cell.p10Payout) : null,
            bandHigh: cell ? roundTo50(cell.p90Payout) : null,
            bandWidth: cellBandWidth,
            source: "sgp_engine",
            sampleSize: cell?.n ?? g.artistShowCount + g.agentShowCount,
            basis: g.basis,
            isDeadPool: false,
          };
        }
        // SGP returned tier C/D — fall through to guarantee_amount fallback.
      }
      // fall through to guarantee/cell-mean path if SGP couldn't compute
      // OR returned a low-confidence (C/D) suggestion.
    }

    // Audit fix: for vs / % of net at $1–5K, fall back to the contract
    // guarantee — not the cell mean. The audit found 43/43 historical vs deals
    // in this bucket paid the guarantee (the percentage never fired), so
    // cell-mean over-promised by ~$591/show. The guarantee IS the answer.
    if (
      bucket === "$1–5K" &&
      deal.guaranteeAmount != null &&
      deal.guaranteeAmount > 0
    ) {
      // Audit acceptance: match the contract guarantee EXACTLY (no $50
      // rounding) — the suggestion is anchored to the real number on the
      // contract, not a synthesized average.
      const flat = deal.guaranteeAmount;
      // Audit acceptance: tier is pinned to A. The contract guarantee IS the
      // answer here — there's no statistical uncertainty to discount, so the
      // sample-size / familiarity demotion does not apply.
      const tier: ConfidenceTier = "A";
      const dealName = deal.dealType === "vs" ? "vs" : "percentage-of-net";
      return {
        shape: "flat",
        dealTypeFrom: deal.dealType,
        suggestedFlat: flat,
        doorFloor: null,
        doorSplitPct: null,
        doorExpenseCap: null,
        confidenceTier: tier,
        bandLow: cell ? roundTo50(cell.p10Payout) : null,
        bandHigh: cell ? roundTo50(cell.p90Payout) : null,
        bandWidth: cellBandWidth,
        source: "guarantee_amount",
        sampleSize: cell?.n ?? 0,
        basis:
          `Across past ${dealName} deals in the ${bucket} bucket at this venue, the ` +
          `percentage calc rarely beats the guarantee — the artist almost always walks ` +
          `with the contract guarantee (${formatMoney(flat)}). Lock it in as a flat: ` +
          `same payout, no settlement-night recoup math. Confidence tier ${tier} ` +
          `(${familiarity}).`,
        isDeadPool: false,
      };
    }

    // Audit fix #1a: when neither SGP nor a contract guarantee gives us an
    // anchor, do NOT fall back to cell-mean. The audit found cell-mean
    // overestimates the flat by ~$591 on vs/$1–5K (43/43 historical shows
    // paid the guarantee, the percentage never fired) — emitting a wrong
    // single number is worse than emitting nothing. The booker simply sees
    // no Smart Switch suggestion and continues with the original deal.
    return null;
  }

  if (deal.dealType === "door") {
    const cell = stats.get(`door::${bucket}`);
    const sampleSize = cell?.n ?? 0;
    const tier = computeTier(sampleSize, artistShowsAtVenue);
    const avgGross = cell?.avgGross ?? 0;

    // Audit fix #7: suppress the hybrid projection at $15K+ door (n=1 history).
    // Surface as a "talk to the agent directly" suggestion instead of pretending
    // to project from a single data point.
    if (bucket === "$15K+" || avgGross >= DOOR_SUPPRESS_GROSS) {
      return {
        shape: "door_hybrid",
        dealTypeFrom: deal.dealType,
        suggestedFlat: null,
        doorFloor: DOOR_FLOOR,
        doorSplitPct: null,
        doorExpenseCap: null,
        confidenceTier: "D",
        bandLow: null,
        bandHigh: null,
        bandWidth: null,
        source: "suppressed",
        isDeadPool: false,
        sampleSize,
        basis:
          `Door deals at this size have only ${sampleSize} prior show${sampleSize === 1 ? "" : "s"} ` +
          `at this venue — not enough history to project a hybrid floor/split with ` +
          `confidence. Discuss the structure directly with the agent before signing; ` +
          `the standard $${DOOR_FLOOR} floor is still recommended as a baseline.`,
      };
    }

    const avgExp = cell?.avgExpenses ?? DOOR_EXPENSE_CAP;
    const cap = Math.min(DOOR_EXPENSE_CAP, Math.round(avgExp));
    const projectedAvail = avgGross * 0.9 - cap;

    // Audit fix #6: dead-pool branch. When the available pool after expenses
    // doesn't even cover the floor, the artist gets exactly the floor and the
    // hybrid degenerates to a pure floor deal. Surface that honestly.
    if (projectedAvail <= DOOR_FLOOR) {
      return {
        shape: "door_hybrid",
        dealTypeFrom: deal.dealType,
        suggestedFlat: null,
        doorFloor: DOOR_FLOOR,
        doorSplitPct: DOOR_SPLIT_PCT,
        doorExpenseCap: cap,
        confidenceTier: tier,
        bandLow: DOOR_FLOOR,
        bandHigh: DOOR_FLOOR,
        bandWidth: 0,
        source: "door_dead_pool",
        isDeadPool: true,
        sampleSize,
        basis:
          `Door deals at this size barely cover expenses at this venue — projected ` +
          `available pool after the $${cap} expense cap is ${formatMoney(Math.max(0, projectedAvail))}, ` +
          `at or below the $${DOOR_FLOOR} floor. Artist effectively walks with the floor; ` +
          `the ${Math.round(DOOR_SPLIT_PCT * 100)}% split rarely fires. Treat this as a ` +
          `flat $${DOOR_FLOOR} guarantee. Confidence tier ${tier} (${familiarity}).`,
      };
    }

    const projectedArtist = Math.round(DOOR_FLOOR + DOOR_SPLIT_PCT * projectedAvail);
    const upperBand = roundTo50(
      projectedArtist + (cell?.p90Payout ? cell.p90Payout - cell.avgPayout : 500),
    );
    const projectionBandWidth = upperBand - DOOR_FLOOR;
    return {
      shape: "door_hybrid",
      dealTypeFrom: deal.dealType,
      suggestedFlat: null,
      doorFloor: DOOR_FLOOR,
      doorSplitPct: DOOR_SPLIT_PCT,
      doorExpenseCap: cap,
      confidenceTier: tier,
      bandLow: DOOR_FLOOR,
      bandHigh: upperBand,
      bandWidth: projectionBandWidth,
      source: "door_hybrid_calc",
      isDeadPool: false,
      sampleSize,
      basis:
        `Pure door deals at this venue lose money 93% of the time (avg net to venue ` +
        `−$1,007). Replace with a hybrid: artist gets a $${DOOR_FLOOR} floor regardless ` +
        `of walk-up, then ${Math.round(DOOR_SPLIT_PCT * 100)}% of the pool above an ` +
        `$${cap} expense cap. Projected artist payout ~${formatMoney(projectedArtist)} ` +
        `at the cell-average gross of ${formatMoney(avgGross)}; venue stops eating ` +
        `expense overruns on slow nights. Confidence tier ${tier} (${familiarity}).`,
    };
  }

  return null;
}

async function countPriorShowsAtVenue(
  artistId: string,
  venueId: string,
  beforeDate: string,
): Promise<number> {
  const rows = await db
    .select({ id: shows.id })
    .from(shows)
    .where(
      and(
        eq(shows.artistId, artistId),
        eq(shows.venueId, venueId),
        lt(shows.date, beforeDate),
      ),
    );
  return rows.length;
}

function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export async function getSuggestionForShow(showId: string): Promise<SwitchSuggestion | null> {
  const rows = await db.select().from(switchSuggestions).where(eq(switchSuggestions.showId, showId));
  const row = rows[0];
  if (!row) return null;
  // Audit acceptance: derive isDeadPool from the persisted source enum so
  // every API exposure of a SwitchSuggestion carries the explicit boolean.
  return { ...row, isDeadPool: deriveIsDeadPool(row.source) };
}

export async function generateAndPersist(showId: string, opts: { force?: boolean } = {}): Promise<{
  suggestion: SwitchSuggestion | null;
  reason?: string;
}> {
  const dealRows = await db.select().from(deals).where(eq(deals.showId, showId));
  const deal = dealRows[0];
  if (!deal) return { suggestion: null, reason: "no_deal" };

  const existing = await getSuggestionForShow(showId);
  if (existing) {
    // Force-recompute is only allowed on still-pending suggestions.
    // Once a booker has accepted or declined, that decision is the record.
    if (opts.force && existing.status === "suggested") {
      await db.delete(switchSuggestions).where(eq(switchSuggestions.showId, showId));
    } else {
      return { suggestion: existing };
    }
  }

  const showRows = await db.select().from(shows).where(eq(shows.id, showId));
  const show = showRows[0];
  const artistShowsAtVenue = show
    ? await countPriorShowsAtVenue(show.artistId, show.venueId, show.date)
    : 0;

  const generated = await generateSuggestion(deal, artistShowsAtVenue, showId);
  if (!generated) {
    return { suggestion: null, reason: "not_eligible" };
  }

  const id = randomUUID();
  const now = new Date();
  await db.insert(switchSuggestions).values({
    id,
    showId,
    dealId: deal.id,
    suggestedAt: now,
    dealTypeFrom: generated.dealTypeFrom,
    shape: generated.shape,
    suggestedFlat: generated.suggestedFlat,
    doorFloor: generated.doorFloor,
    doorSplitPct: generated.doorSplitPct,
    doorExpenseCap: generated.doorExpenseCap,
    confidenceTier: generated.confidenceTier,
    bandLow: generated.bandLow,
    bandHigh: generated.bandHigh,
    sampleSize: generated.sampleSize,
    basis: generated.basis,
    status: "suggested",
    source: generated.source,
    bandWidth: generated.bandWidth,
  });

  const fresh = await getSuggestionForShow(showId);
  return { suggestion: fresh };
}

export async function decideSuggestion(
  showId: string,
  decision: "accepted" | "declined",
): Promise<SwitchSuggestion | null> {
  const existing = await getSuggestionForShow(showId);
  if (!existing) return null;
  if (existing.status !== "suggested") return existing;
  await db
    .update(switchSuggestions)
    .set({ status: decision, decidedAt: new Date() })
    .where(eq(switchSuggestions.showId, showId));
  return getSuggestionForShow(showId);
}
