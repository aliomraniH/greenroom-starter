import { lte } from "drizzle-orm";
import { db } from "../db";
import { deals, shows, expenses } from "../db/schema";
import { classifyAnalyticsSizeBucket } from "./queries";

// Data-driven per-bucket expense caps. Replaces the two hardcoded
// DEFAULT_EXPENSE_CAP_BY_BUCKET tables that used to live in
// smartGuarantee.ts (engine ceiling) and dealImprovements.ts (deal
// suggestion). Those two tables disagreed (e.g. $1–5K = $1,500 vs.
// $1,850; $5–15K = $3,500 vs. $1,750) and went stale whenever the
// underlying expense data shifted.
//
// This module derives P75 of historical per-show billed expense totals,
// grouped by analytics size bucket, from the live database every
// CAPS_TTL_MS. Both SGP engine and Improve Deal read from the same
// source, so they can never disagree and they update as new shows are
// settled.

const KNOWN_BUCKETS = ["$0–1K", "$1–5K", "$5–15K", "$15K+", "Uncapped %"];
// Minimum sample count before a bucket's own P75 is trusted. Below this
// we fall back to the venue-wide P75 — still data-derived, just less
// specific.
const MIN_BUCKET_SAMPLES = 5;
// Absolute last-resort default used only when the database has zero
// non-absorbed billed expenses recorded (cold-start / empty DB). Set to
// the Apr 2026 audit's overall P75 ($1,750) so it's a reasonable starting
// point until real data is logged.
const COLD_START_FALLBACK = 1750;
const CAPS_TTL_MS = 5 * 60 * 1000;

export type ExpenseCapSource =
  | "live_data"          // every bucket had ≥ MIN_BUCKET_SAMPLES
  | "venue_p75_fallback" // at least one bucket fell back to venue-wide P75
  | "cold_start";        // DB has no expense data; using hardcoded fallback

export type ExpenseCaps = {
  byBucket: Record<string, number>;
  venueP75: number | null;
  sampleSizesByBucket: Record<string, number>;
  totalSamples: number;
  computedAt: number;
  source: ExpenseCapSource;
};

let cache: ExpenseCaps | null = null;
let pending: Promise<ExpenseCaps> | null = null;
// Generation token bumped on every clear. An in-flight compute() captures
// the generation at start; if it has changed by the time the result lands,
// the result is discarded instead of overwriting `cache` with stale data
// (e.g. a settlement was written between the start of compute and its
// resolution, and clear was called to acknowledge it).
let generation = 0;

export function clearExpenseCapsCache(): void {
  cache = null;
  pending = null;
  generation += 1;
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

function todayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

async function compute(): Promise<ExpenseCaps> {
  const today = todayISO();
  const [allShows, allDeals, allExpenses] = await Promise.all([
    db.select().from(shows).where(lte(shows.date, today)),
    db.select().from(deals),
    db.select().from(expenses),
  ]);

  const dealByShow = new Map(allDeals.map((d) => [d.showId, d]));
  // Sum non-absorbed billed expenses per show — the same notion of
  // "what the artist sees recouped" used by smartGuarantee's ctx and
  // by dealImprovements' loadComparables.
  const expByShow = new Map<string, number>();
  for (const e of allExpenses) {
    if (e.absorbedByVenue) continue;
    expByShow.set(e.showId, (expByShow.get(e.showId) ?? 0) + e.amount);
  }

  const expensesByBucket = new Map<string, number[]>();
  const allExpenseTotals: number[] = [];
  for (const s of allShows) {
    const d = dealByShow.get(s.id);
    if (!d) continue;
    const total = expByShow.get(s.id);
    if (total == null) continue;
    const bucket = classifyAnalyticsSizeBucket(d);
    if (!expensesByBucket.has(bucket)) expensesByBucket.set(bucket, []);
    expensesByBucket.get(bucket)!.push(total);
    allExpenseTotals.push(total);
  }

  const venueP75 = allExpenseTotals.length > 0
    ? roundTo50(percentile(allExpenseTotals, 0.75))
    : null;

  const sampleSizesByBucket: Record<string, number> = {};
  const byBucket: Record<string, number> = {};
  let usedVenueFallback = false;
  for (const bucket of KNOWN_BUCKETS) {
    const samples = expensesByBucket.get(bucket) ?? [];
    sampleSizesByBucket[bucket] = samples.length;
    if (samples.length >= MIN_BUCKET_SAMPLES) {
      byBucket[bucket] = roundTo50(percentile(samples, 0.75));
    } else if (venueP75 != null) {
      byBucket[bucket] = venueP75;
      usedVenueFallback = true;
    } else {
      byBucket[bucket] = COLD_START_FALLBACK;
    }
  }

  const source: ExpenseCapSource =
    venueP75 == null
      ? "cold_start"
      : usedVenueFallback
        ? "venue_p75_fallback"
        : "live_data";

  return {
    byBucket,
    venueP75,
    sampleSizesByBucket,
    totalSamples: allExpenseTotals.length,
    computedAt: Date.now(),
    source,
  };
}

export async function getExpenseCaps(): Promise<ExpenseCaps> {
  const now = Date.now();
  if (cache && now - cache.computedAt < CAPS_TTL_MS) return cache;
  if (pending) return pending;
  const startGen = generation;
  pending = compute()
    .then((c) => {
      // If `clearExpenseCapsCache` ran while we were computing, the
      // result we have in hand reflects pre-clear data and must not be
      // cached. Return it to the caller that triggered this compute,
      // but skip the assignment so the next call recomputes.
      if (generation === startGen) cache = c;
      return c;
    })
    .finally(() => {
      if (generation === startGen) pending = null;
    });
  return pending;
}

// Resolve a single bucket cap, with a same-payload fallback chain:
// bucket P75 → venue P75 → cold-start default. Callers that need the
// whole payload (e.g. for diagnostics) should use getExpenseCaps()
// directly.
export async function getExpenseCapForBucket(bucket: string): Promise<number> {
  const caps = await getExpenseCaps();
  return caps.byBucket[bucket] ?? caps.venueP75 ?? COLD_START_FALLBACK;
}

export const __TEST_CONSTANTS__ = {
  KNOWN_BUCKETS,
  MIN_BUCKET_SAMPLES,
  COLD_START_FALLBACK,
};
