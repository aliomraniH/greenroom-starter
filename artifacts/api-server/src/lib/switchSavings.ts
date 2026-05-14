import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../db";
import {
  shows, artists, deals, settlements, expenses, type Deal,
} from "../db/schema";
import {
  parseRecoups,
  classifyAnalyticsSizeBucket as classifySizeBucket,
  getNeedsAttention,
} from "./queries";
import { generateSuggestion, switchAppliesTo, type ConfidenceTier } from "./smartSwitch";

export type SavingsItem = {
  showId: string;
  date: string;
  artistName: string | null;
  dealType: Deal["dealType"];
  switchShape: "flat" | "door_hybrid";
  confidenceTier: ConfidenceTier;
  actualToArtist: number;
  counterfactualToArtist: number;
  moneySavedToVenue: number;
  estimatedMinutesSpent: number;
  estimatedMinutesUnderSwitch: number;
  minutesSaved: number;
  hadDispute: boolean;
  disputedRecoupCount: number;
  notesParagraphs: number;
  signoffParagraphs: number;
  totalRecoups: number;
  grossBoxOffice: number;
  totalExpenses: number;
  breakdown: {
    actual: {
      gross: number;
      expenses: number;
      recoupTotal: number;
      recoupLines: { label: string; amount: number; status: string }[];
      payout: number;
      settlementStatus: string;
    };
    counterfactual: {
      shape: "flat" | "door_hybrid";
      flat: number | null;
      doorFloor: number | null;
      doorSplitPct: number | null;
      doorExpenseCap: number | null;
      projectedPayout: number;
      basis: string;
    };
    timeSavedRationale: string;
    moneyRationale: string;
  };
};

export type ProjectedCell = {
  dealType: "vs" | "percentage_of_net" | "door" | "flat" | "percentage_of_gross";
  bucket: string;
  switchApplies: boolean;
  count: number;
  // Actual past-period stats
  actualLosingMoney: number;
  actualDisputed: number;
  actualAttention: number;
  actualLosingRate: number;
  actualDisputeRate: number;
  actualAttentionRate: number;
  // Projected (counterfactual) stats under Smart Switch
  projectedLosingMoney: number;
  projectedDisputed: number;
  projectedAttention: number;
  projectedLosingRate: number;
  projectedDisputeRate: number;
  projectedAttentionRate: number;
  // Money rollup for the cell
  actualPayoutSum: number;
  projectedPayoutSum: number;
  moneySavedToVenue: number;
};

export type ProjectedGridPayload = {
  generatedAt: string;
  windowMonths: number;
  totalCandidates: number;
  totalDealsModelled: number;
  totalLosingMoneyAvoided: number;
  totalDisputesAvoided: number;
  totalAttentionAvoided: number;
  totalMoneySavedToVenue: number;
  dealTypes: ProjectedCell["dealType"][];
  buckets: string[];
  cells: ProjectedCell[];
};

export type VsPercentageFiredStats = {
  vsDealsScanned: number;
  vsPercentageFired: number;
  vsPercentageNeverFired: number;
  vsPercentageNeverFiredRate: number;
  avgGuaranteeWin: number;
};

export type SavingsPayload = {
  generatedAt: string;
  windowMonths: number;
  totalCandidates: number;
  totalMoneySavedToVenue: number;
  totalMinutesSaved: number;
  items: SavingsItem[];
  vsPercentageFiredStats: VsPercentageFiredStats;
};

const MINUTES = {
  base: 30,            // baseline settlement-night work for any deal
  perDisputedRecoup: 25,
  perParagraph: 5,     // back-and-forth scaled by notes/signoff verbosity
  disputeStatusBonus: 60,
  switchFlat: 10,      // smart switch flat handshake
  switchDoor: 15,      // door hybrid: still need door count + cap arithmetic
};

function paragraphCount(text: string | null): number {
  if (!text) return 0;
  const blocks = text
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return blocks.length;
}

function todayDateString(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function monthsAgoString(months: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

const SETTLED_STATUSES = new Set(["signed", "finalized", "paid", "disputed"]);
const PROJECTED_DEAL_TYPES: ProjectedCell["dealType"][] = ["vs", "percentage_of_net", "door", "flat", "percentage_of_gross"];
const PROJECTED_BUCKETS = ["$0–1K", "$1–5K", "$5–15K", "$15K+", "Uncapped %"];

async function buildPriorShowIndex(): Promise<Map<string, string[]>> {
  // One pass over `shows`. Index by `${artistId}::${venueId}` → sorted ascending dates.
  const rows = await db.select().from(shows);
  const idx = new Map<string, string[]>();
  for (const s of rows) {
    const k = `${s.artistId}::${s.venueId}`;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k)!.push(s.date);
  }
  for (const arr of idx.values()) arr.sort();
  return idx;
}

function countPriorBefore(dates: string[] | undefined, beforeDate: string): number {
  if (!dates) return 0;
  // Binary search for the first date >= beforeDate.
  let lo = 0, hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (dates[mid] < beforeDate) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export async function getSwitchSavings(opts: { months?: number; topN?: number } = {}): Promise<SavingsPayload> {
  const months = opts.months ?? 3;
  const topN = opts.topN ?? 10;
  const today = todayDateString();
  const since = monthsAgoString(months);

  const rows = await db
    .select({ show: shows, artist: artists, deal: deals, settlement: settlements })
    .from(shows)
    .leftJoin(artists, eq(shows.artistId, artists.id))
    .leftJoin(deals, eq(deals.showId, shows.id))
    .leftJoin(settlements, eq(settlements.showId, shows.id))
    .where(and(gte(shows.date, since), lte(shows.date, today)));

  const candidates = rows.filter((r) => {
    if (!r.deal || !r.settlement) return false;
    if (r.settlement.totalToArtist == null || r.settlement.grossBoxOffice == null) return false;
    if (!SETTLED_STATUSES.has(r.settlement.status)) return false;
    return r.deal.dealType === "vs" || r.deal.dealType === "percentage_of_net" || r.deal.dealType === "door";
  });

  // Pre-fetch expenses + prior-show index + artist roster in parallel.
  // The artist roster is bulk-loaded once so the per-candidate
  // generateGuarantee call (via generateSuggestion) can be handed its
  // preloaded show/deal/artist instead of issuing 3 per-row DB queries.
  const [allExpenses, priorIndex, allArtists] = await Promise.all([
    db.select().from(expenses),
    buildPriorShowIndex(),
    db.select().from(artists),
  ]);
  const expByShow = new Map<string, number>();
  for (const e of allExpenses) {
    expByShow.set(e.showId, (expByShow.get(e.showId) ?? 0) + e.amount);
  }
  const artistById = new Map(allArtists.map((a) => [a.id, a]));

  const items: SavingsItem[] = [];
  for (const r of candidates) {
    const deal = r.deal!;
    const settlement = r.settlement!;
    const show = r.show;
    const artistN = countPriorBefore(
      priorIndex.get(`${show.artistId}::${show.venueId}`),
      show.date,
    );
    const generated = await generateSuggestion(deal, artistN, show.id, {
      show,
      deal,
      artist: artistById.get(show.artistId) ?? null,
    });
    if (!generated) continue;

    const actualPayout = settlement.totalToArtist!;
    const gross = settlement.grossBoxOffice!;
    const totalExp = expByShow.get(show.id) ?? settlement.totalExpenses ?? 0;
    const recoups = parseRecoups(settlement.recoupsJson);
    const recoupTotal = recoups.reduce((a, b) => a + (b.amount ?? 0), 0);
    const disputedRecoupCount = recoups.filter((x) => x.status === "disputed").length;
    const hadDispute = settlement.status === "disputed" || disputedRecoupCount > 0;

    let counterfactual: number;
    if (generated.shape === "flat") {
      counterfactual = generated.suggestedFlat ?? 0;
    } else {
      const cap = generated.doorExpenseCap ?? 1500;
      const pool = Math.max(0, gross * 0.9 - cap);
      counterfactual = Math.round((generated.doorFloor ?? 0) + (generated.doorSplitPct ?? 0) * pool);
    }

    const notesP = paragraphCount(settlement.notes);
    const signoffP = paragraphCount(settlement.signoffText);
    const minutesSpent =
      MINUTES.base +
      disputedRecoupCount * MINUTES.perDisputedRecoup +
      (notesP + signoffP) * MINUTES.perParagraph +
      (settlement.status === "disputed" ? MINUTES.disputeStatusBonus : 0);
    const minutesUnderSwitch =
      generated.shape === "flat" ? MINUTES.switchFlat : MINUTES.switchDoor;
    const minutesSaved = Math.max(0, minutesSpent - minutesUnderSwitch);

    const moneySaved = Math.round(actualPayout - counterfactual);

    const moneyRationale = `Venue actually paid the artist $${Math.round(actualPayout).toLocaleString()} after applying ${recoups.length} recoup line${recoups.length === 1 ? "" : "s"} (${disputedRecoupCount} disputed, total $${Math.round(recoupTotal).toLocaleString()}) against $${Math.round(gross).toLocaleString()} gross. Smart Switch ${generated.shape === "flat" ? `flat at $${(generated.suggestedFlat ?? 0).toLocaleString()}` : `hybrid ($${generated.doorFloor} floor + ${Math.round((generated.doorSplitPct ?? 0) * 100)}% above $${generated.doorExpenseCap})`} would have settled at $${counterfactual.toLocaleString()} — a ${moneySaved >= 0 ? "saving" : "premium"} of $${Math.abs(moneySaved).toLocaleString()} for the venue.`;

    const timeSavedRationale = `Estimated ~${minutesSpent} min of settlement-night work: ${MINUTES.base} min baseline + ${disputedRecoupCount} disputed recoup${disputedRecoupCount === 1 ? "" : "s"} × ${MINUTES.perDisputedRecoup} min + ${notesP + signoffP} paragraph${notesP + signoffP === 1 ? "" : "s"} of notes/sign-off thread × ${MINUTES.perParagraph} min${settlement.status === "disputed" ? ` + ${MINUTES.disputeStatusBonus} min for the formal dispute` : ""}. Smart Switch ${generated.shape === "flat" ? "flat" : "hybrid"} replaces this with a ~${minutesUnderSwitch}-min ${generated.shape === "flat" ? "handshake — no recoup arithmetic" : "door count and cap check"}.`;

    items.push({
      showId: show.id,
      date: show.date,
      artistName: r.artist?.name ?? null,
      dealType: deal.dealType,
      switchShape: generated.shape,
      confidenceTier: generated.confidenceTier,
      actualToArtist: Math.round(actualPayout),
      counterfactualToArtist: counterfactual,
      moneySavedToVenue: moneySaved,
      estimatedMinutesSpent: minutesSpent,
      estimatedMinutesUnderSwitch: minutesUnderSwitch,
      minutesSaved,
      hadDispute,
      disputedRecoupCount,
      notesParagraphs: notesP,
      signoffParagraphs: signoffP,
      totalRecoups: recoups.length,
      grossBoxOffice: Math.round(gross),
      totalExpenses: Math.round(totalExp),
      breakdown: {
        actual: {
          gross: Math.round(gross),
          expenses: Math.round(totalExp),
          recoupTotal: Math.round(recoupTotal),
          recoupLines: recoups.map((rc) => ({
            label: rc.label,
            amount: Math.round(rc.amount ?? 0),
            status: rc.status,
          })),
          payout: Math.round(actualPayout),
          settlementStatus: settlement.status,
        },
        counterfactual: {
          shape: generated.shape,
          flat: generated.suggestedFlat,
          doorFloor: generated.doorFloor,
          doorSplitPct: generated.doorSplitPct,
          doorExpenseCap: generated.doorExpenseCap,
          projectedPayout: counterfactual,
          basis: generated.basis,
        },
        timeSavedRationale,
        moneyRationale,
      },
    });
  }

  // Sort by money saved desc, then by time saved desc, keep top N for the
  // displayed list. The headline totals below intentionally sum across the
  // FULL `items` set (every candidate Smart Switch would apply to), not
  // `trimmed`, so totalCandidates / totalMoneySavedToVenue /
  // totalMinutesSaved stay on the same scope. The UI shows "X of N" next
  // to the list so the user can tell the list is truncated.
  items.sort((a, b) => b.moneySavedToVenue - a.moneySavedToVenue || b.minutesSaved - a.minutesSaved);
  const trimmed = items.slice(0, topN);

  const totalMoney = items.reduce((a, b) => a + b.moneySavedToVenue, 0);
  const totalMinutes = items.reduce((a, b) => a + b.minutesSaved, 0);

  // Vs-percentage-clause coverage: across every settled `vs` deal in the
  // $1–5K bucket in the window, how many had the percentage clause
  // out-pay the guarantee? Scoped to $1–5K because that is the only
  // bucket where Smart Switch's guarantee-amount fallback applies — the
  // audit finding of "percentage rarely fires" is specific to that cell,
  // not to vs deals at all guarantee sizes.
  let vsScanned = 0;
  let vsFired = 0;
  let vsGuaranteeWinSum = 0;
  for (const r of rows) {
    if (!r.deal || !r.settlement) continue;
    if (r.deal.dealType !== "vs") continue;
    if (r.settlement.totalToArtist == null) continue;
    if (!SETTLED_STATUSES.has(r.settlement.status)) continue;
    // Restrict to the $1–5K guarantee bucket (the cell where the
    // guarantee-amount fallback is active in Smart Switch).
    const guarantee = r.deal.guaranteeAmount ?? 0;
    if (guarantee < 1000 || guarantee >= 5000) continue;
    const paid = r.settlement.totalToArtist;
    vsScanned++;
    // Use a small tolerance ($1) to absorb rounding so a guarantee paid
    // exactly at the floor isn't mistakenly flagged as the percentage
    // "firing" by a sub-dollar amount.
    if (paid > guarantee + 1) {
      vsFired++;
    } else {
      vsGuaranteeWinSum += guarantee - paid;
    }
  }
  const vsNever = vsScanned - vsFired;
  const vsNeverRate = vsScanned > 0 ? vsNever / vsScanned : 0;
  const avgGuaranteeWin = vsNever > 0 ? Math.round(vsGuaranteeWinSum / vsNever) : 0;

  return {
    generatedAt: new Date().toISOString(),
    windowMonths: months,
    totalCandidates: items.length,
    totalMoneySavedToVenue: totalMoney,
    totalMinutesSaved: totalMinutes,
    items: trimmed,
    vsPercentageFiredStats: {
      vsDealsScanned: vsScanned,
      vsPercentageFired: vsFired,
      vsPercentageNeverFired: vsNever,
      vsPercentageNeverFiredRate: vsNeverRate,
      avgGuaranteeWin,
    },
  };
}

export async function getSwitchProjectedGrid(
  opts: { months?: number } = {},
): Promise<ProjectedGridPayload> {
  const months = opts.months ?? 6;
  const today = todayDateString();
  const since = monthsAgoString(months);

  const rows = await db
    .select({ show: shows, deal: deals, settlement: settlements })
    .from(shows)
    .leftJoin(deals, eq(deals.showId, shows.id))
    .leftJoin(settlements, eq(settlements.showId, shows.id))
    .where(and(gte(shows.date, since), lte(shows.date, today)));

  const candidates = rows.filter((r) => {
    if (!r.deal || !r.settlement) return false;
    if (r.settlement.totalToArtist == null || r.settlement.grossBoxOffice == null) return false;
    if (!SETTLED_STATUSES.has(r.settlement.status)) return false;
    return (PROJECTED_DEAL_TYPES as readonly string[]).includes(r.deal.dealType);
  });

  const [allExpenses, priorIndex, attention, allArtists] = await Promise.all([
    db.select().from(expenses),
    buildPriorShowIndex(),
    getNeedsAttention(),
    db.select().from(artists),
  ]);
  const expByShow = new Map<string, number>();
  for (const e of allExpenses) {
    expByShow.set(e.showId, (expByShow.get(e.showId) ?? 0) + e.amount);
  }
  const attentionByShow = new Set<string>();
  for (const a of attention) attentionByShow.add(a.showId);
  const artistById = new Map(allArtists.map((a) => [a.id, a]));

  type Acc = {
    count: number;
    actualLosingMoney: number;
    actualDisputed: number;
    actualAttention: number;
    projectedLosingMoney: number;
    actualPayoutSum: number;
    projectedPayoutSum: number;
  };
  const cellAcc = new Map<string, Acc>();
  const seenBuckets = new Set<string>();
  let totalDealsModelled = 0;

  for (const r of candidates) {
    const deal = r.deal!;
    const settlement = r.settlement!;
    const show = r.show;
    const bucket = classifySizeBucket(deal);
    seenBuckets.add(bucket);
    const key = `${deal.dealType}::${bucket}`;
    if (!cellAcc.has(key)) {
      cellAcc.set(key, {
        count: 0,
        actualLosingMoney: 0,
        actualDisputed: 0,
        actualAttention: 0,
        projectedLosingMoney: 0,
        actualPayoutSum: 0,
        projectedPayoutSum: 0,
      });
    }
    const acc = cellAcc.get(key)!;

    const gross = settlement.grossBoxOffice!;
    const actualPayout = settlement.totalToArtist!;
    const totalExp = expByShow.get(show.id) ?? settlement.totalExpenses ?? 0;
    const recoups = parseRecoups(settlement.recoupsJson);
    const isDisputed =
      settlement.status === "disputed" ||
      recoups.some((x) => x.status === "disputed");
    const hasAttention = attentionByShow.has(show.id);
    const actualNet = gross - actualPayout - totalExp;

    let projectedPayout = actualPayout; // default: no switch, payout unchanged
    if (switchAppliesTo(deal.dealType, bucket)) {
      const artistN = countPriorBefore(
        priorIndex.get(`${show.artistId}::${show.venueId}`),
        show.date,
      );
      const generated = await generateSuggestion(deal, artistN, show.id, {
        show,
        deal,
        artist: artistById.get(show.artistId) ?? null,
      });
      if (!generated) continue;
      if (generated.shape === "flat") {
        projectedPayout = generated.suggestedFlat ?? 0;
      } else {
        const cap = generated.doorExpenseCap ?? 1500;
        const pool = Math.max(0, gross * 0.9 - cap);
        projectedPayout = Math.round(
          (generated.doorFloor ?? 0) + (generated.doorSplitPct ?? 0) * pool,
        );
      }
    }
    const projectedNet = gross - projectedPayout - totalExp;

    acc.count++;
    if (actualNet < 0) acc.actualLosingMoney++;
    if (isDisputed) acc.actualDisputed++;
    if (hasAttention) acc.actualAttention++;
    if (projectedNet < 0) acc.projectedLosingMoney++;
    acc.actualPayoutSum += actualPayout;
    acc.projectedPayoutSum += projectedPayout;
    totalDealsModelled++;
  }

  // Smart Switch eliminates recoup-line arithmetic, which is the primary
  // driver of settlement disputes and follow-up attention items. However,
  // it cannot prevent every possible issue (e.g. show-status mismatches,
  // stale data entry errors). Model a 70% reduction rather than 100%
  // to reflect that residual operational edge cases remain.
  const SWITCH_DISPUTE_REDUCTION = 0.70;
  const SWITCH_ATTENTION_REDUCTION = 0.70;

  const cells: ProjectedCell[] = [];
  for (const dealType of PROJECTED_DEAL_TYPES) {
    for (const bucket of PROJECTED_BUCKETS) {
      const acc = cellAcc.get(`${dealType}::${bucket}`);
      if (!acc || acc.count === 0) continue;
      const switchApplies = switchAppliesTo(dealType, bucket);
      const projectedDisputed = switchApplies
        ? Math.round(acc.actualDisputed * (1 - SWITCH_DISPUTE_REDUCTION))
        : acc.actualDisputed;
      const projectedAttention = switchApplies
        ? Math.round(acc.actualAttention * (1 - SWITCH_ATTENTION_REDUCTION))
        : acc.actualAttention;
      cells.push({
        dealType,
        bucket,
        switchApplies,
        count: acc.count,
        actualLosingMoney: acc.actualLosingMoney,
        actualDisputed: acc.actualDisputed,
        actualAttention: acc.actualAttention,
        actualLosingRate: acc.actualLosingMoney / acc.count,
        actualDisputeRate: acc.actualDisputed / acc.count,
        actualAttentionRate: acc.actualAttention / acc.count,
        projectedLosingMoney: switchApplies ? acc.projectedLosingMoney : acc.actualLosingMoney,
        projectedDisputed,
        projectedAttention,
        projectedLosingRate: switchApplies
          ? acc.projectedLosingMoney / acc.count
          : acc.actualLosingMoney / acc.count,
        projectedDisputeRate: projectedDisputed / acc.count,
        projectedAttentionRate: projectedAttention / acc.count,
        actualPayoutSum: Math.round(acc.actualPayoutSum),
        projectedPayoutSum: Math.round(acc.projectedPayoutSum),
        moneySavedToVenue: switchApplies
          ? Math.round(acc.actualPayoutSum - acc.projectedPayoutSum)
          : 0,
      });
    }
  }

  const totalLosingAvoided = cells.reduce(
    (a, c) => a + (c.actualLosingMoney - c.projectedLosingMoney),
    0,
  );
  const totalDisputesAvoided = cells.reduce((a, c) => a + (c.actualDisputed - c.projectedDisputed), 0);
  const totalAttentionAvoided = cells.reduce((a, c) => a + (c.actualAttention - c.projectedAttention), 0);
  const totalMoneySaved = cells.reduce((a, c) => a + c.moneySavedToVenue, 0);

  // Buckets in canonical order, only those that appear
  const buckets = PROJECTED_BUCKETS.filter((b) => seenBuckets.has(b));

  return {
    generatedAt: new Date().toISOString(),
    windowMonths: months,
    totalCandidates: candidates.length,
    totalDealsModelled,
    totalLosingMoneyAvoided: totalLosingAvoided,
    totalDisputesAvoided,
    totalAttentionAvoided,
    totalMoneySavedToVenue: totalMoneySaved,
    dealTypes: PROJECTED_DEAL_TYPES,
    buckets,
    cells,
  };
}
