import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../db";
import { shows, artists, deals, settlements, type Deal } from "../db/schema";
import { generateGuarantee, type ConfidenceTier } from "./smartGuarantee";
import { classifySizeBucket } from "./queries";

export type FlatRepricingDirection =
  | "would_have_offered_less"
  | "would_have_offered_more"
  | "even";

export type FlatRepricingSteps = {
  step1_expectedGross: { value: number; source: string; sampleSize: number };
  step2_ticketingFees: { rate: number; value: number };
  step3_netAfterFees: number;
  step4_expense: {
    raw: number;
    source: string;
    sampleSize: number;
    defaultCap: number;
    dealExpenseCap: number | null;
    effectiveCap: number;
    cappedValue: number;
  };
  step5_netBase: number;
  step6_percentagePayout: { pct: number; basis: number; value: number };
  step7_winner: {
    winner: "guarantee" | "percentage" | "tie";
    winnerValue: number;
    suggestedPrice: number;
    breakevenGross: number;
  };
};

export type SgpFlatRepricingItem = {
  showId: string;
  date: string;
  artistName: string | null;
  bucket: string;
  actualFlat: number;
  actualToArtist: number;
  grossBoxOffice: number;
  sgpFairFlat: number;
  deltaSgpVsActual: number;
  absDelta: number;
  direction: FlatRepricingDirection;
  confidenceTier: ConfidenceTier;
  insuranceTier: number;
  simulatedSplitPct: number;
  basis: string;
  steps: FlatRepricingSteps;
};

export type GapCoverageBucket = {
  threshold: number;
  count: number;
  rate: number;
};

export type GapCoverage = {
  totalScored: number;
  buckets: GapCoverageBucket[];
  medianAbsDelta: number;
  p75AbsDelta: number;
  p90AbsDelta: number;
};

export type SgpFlatRepricingPayload = {
  generatedAt: string;
  windowMonths: number;
  simulatedSplitPct: number;
  bucket: string;
  totalCandidates: number;
  totalScored: number;
  // Money the venue would have NOT offered (actual flat above the fair vs-equivalent).
  moneyOverpaid: number;
  // Money the venue WOULD have offered more of (fair vs-equivalent above actual flat).
  moneyUnderpriced: number;
  // overpaid − underpriced. Positive ⇒ venue would have paid less in aggregate
  // had SGP been used at offer time on these flats.
  netDelta: number;
  items: SgpFlatRepricingItem[];
  gapCoverage: GapCoverage;
};

const SETTLED_STATUSES = new Set(["signed", "finalized", "paid", "disputed"]);

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

export async function getSgpFlatRepricing(
  opts: { months?: number; topN?: number; bucket?: string; splitPct?: number } = {},
): Promise<SgpFlatRepricingPayload> {
  const months = opts.months ?? 12;
  const topN = opts.topN ?? 10;
  const bucketFilter = opts.bucket ?? "$1–5K";
  const splitPct = opts.splitPct ?? 0.85;
  const today = todayDateString();
  const since = monthsAgoString(months);

  const rows = await db
    .select({
      show: shows,
      artist: artists,
      deal: deals,
      settlement: settlements,
    })
    .from(shows)
    .leftJoin(artists, eq(shows.artistId, artists.id))
    .leftJoin(deals, eq(deals.showId, shows.id))
    .leftJoin(settlements, eq(settlements.showId, shows.id))
    .where(and(gte(shows.date, since), lte(shows.date, today)));

  const candidates = rows.filter((r) => {
    if (!r.deal || !r.settlement) return false;
    if (r.settlement.totalToArtist == null) return false;
    if (!SETTLED_STATUSES.has(r.settlement.status)) return false;
    if (r.deal.dealType !== "flat") return false;
    return classifySizeBucket(r.deal as Deal) === bucketFilter;
  });

  const items: SgpFlatRepricingItem[] = [];
  for (const r of candidates) {
    const out = await generateGuarantee(r.show.id, {
      allowPast: true,
      simulateFlatAsVsPercent: splitPct,
    });
    if (!out.suggestion) continue;
    const s = out.suggestion;
    const audit = JSON.parse(s.auditJson) as FlatRepricingSteps;
    const actualToArtist = Math.round(r.settlement!.totalToArtist!);
    const actualFlat = Math.round(s.agentGuarantee ?? r.deal!.guaranteeAmount ?? 0);
    const sgp = Math.round(s.suggestedPrice);
    const deltaSgpVsActual = sgp - actualFlat;
    const absDelta = Math.abs(deltaSgpVsActual);
    const direction: FlatRepricingDirection =
      deltaSgpVsActual < 0
        ? "would_have_offered_less"
        : deltaSgpVsActual > 0
          ? "would_have_offered_more"
          : "even";

    items.push({
      showId: r.show.id,
      date: r.show.date,
      artistName: r.artist?.name ?? null,
      bucket: classifySizeBucket(r.deal as Deal),
      actualFlat,
      actualToArtist,
      grossBoxOffice: Math.round(r.settlement!.grossBoxOffice ?? 0),
      sgpFairFlat: sgp,
      deltaSgpVsActual,
      absDelta,
      direction,
      confidenceTier: s.confidenceTier,
      insuranceTier: s.insuranceTier,
      simulatedSplitPct: splitPct,
      basis: s.basis,
      steps: audit,
    });
  }

  let moneyOverpaid = 0;
  let moneyUnderpriced = 0;
  for (const it of items) {
    if (it.deltaSgpVsActual < 0) moneyOverpaid += -it.deltaSgpVsActual;
    else if (it.deltaSgpVsActual > 0) moneyUnderpriced += it.deltaSgpVsActual;
  }

  const GAP_THRESHOLDS = [100, 200, 400, 800, 1500];
  const sortedAbs = [...items.map((i) => i.absDelta)].sort((a, b) => a - b);
  const percentile = (p: number): number => {
    if (sortedAbs.length === 0) return 0;
    const idx = Math.min(
      sortedAbs.length - 1,
      Math.floor((p / 100) * sortedAbs.length),
    );
    return Math.round(sortedAbs[idx] ?? 0);
  };
  const gapBuckets: GapCoverageBucket[] = GAP_THRESHOLDS.map((threshold) => {
    const count = items.filter((i) => i.absDelta <= threshold).length;
    return {
      threshold,
      count,
      rate: items.length > 0 ? count / items.length : 0,
    };
  });
  const gapCoverage: GapCoverage = {
    totalScored: items.length,
    buckets: gapBuckets,
    medianAbsDelta: percentile(50),
    p75AbsDelta: percentile(75),
    p90AbsDelta: percentile(90),
  };

  items.sort((a, b) => b.absDelta - a.absDelta);
  const trimmed = items.slice(0, topN);

  return {
    generatedAt: new Date().toISOString(),
    windowMonths: months,
    simulatedSplitPct: splitPct,
    bucket: bucketFilter,
    totalCandidates: candidates.length,
    totalScored: items.length,
    moneyOverpaid: Math.round(moneyOverpaid),
    moneyUnderpriced: Math.round(moneyUnderpriced),
    netDelta: Math.round(moneyOverpaid - moneyUnderpriced),
    items: trimmed,
    gapCoverage,
  };
}
