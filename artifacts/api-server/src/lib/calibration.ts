import { eq } from "drizzle-orm";
import { db, migrationsReady } from "../db";
import { shows, deals, settlements, expenses, artists } from "../db/schema";
import { classifyAnalyticsSizeBucket } from "./queries";

export type CalibrationSource = "venue_computed" | "audit_default" | "none";
export type Confidence = "high" | "med" | "low" | "none";

export type CalibratedValue = {
  value: number | null;
  source: CalibrationSource;
  confidence: Confidence;
  n: number;
};

export type AlertLevel = "ok" | "watch" | "alert";

export type MaturityStage = 1 | 2 | 3 | 4;

const MATURITY_T1_MIN = 16;
const MATURITY_T2_MIN = 51;
const MATURITY_T3_MIN = 151;

const CATEGORY_AUDIT_DEFAULTS: Record<string, number> = {
  hospitality: 400,
  production: 900,
  sound: 350,
  lights: 200,
  marketing: 250,
  backline: 150,
  security: 300,
  other: 250,
};

const EXPENSE_CAP_BY_BUCKET_DEFAULT: Record<string, number> = {
  "$0–1K": 1700,
  "$1–5K": 1850,
  "$5–15K": 1750,
  "$15K+": 1650,
  "Uncapped %": 1750,
};

export const CATEGORY_LIST = [
  "hospitality",
  "production",
  "sound",
  "lights",
  "marketing",
  "backline",
  "security",
  "other",
] as const;
export type ExpenseCategory = (typeof CATEGORY_LIST)[number];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoNMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function confidenceFor(n: number): Confidence {
  if (n >= MATURITY_T3_MIN) return "high";
  if (n >= MATURITY_T2_MIN) return "med";
  if (n >= MATURITY_T1_MIN) return "low";
  return "none";
}

function maturityStage(n: number): MaturityStage {
  if (n >= MATURITY_T3_MIN) return 4;
  if (n >= MATURITY_T2_MIN) return 3;
  if (n >= MATURITY_T1_MIN) return 2;
  return 1;
}

export type CategoryCalibration = CalibratedValue & {
  category: ExpenseCategory;
  p50: number | null;
  p75: number | null;
  mean: number | null;
  p75Drift3moVs12mo: number | null;
};

export type GenreBaseline = {
  genre: string;
  n: number;
  meanExpenses: number | null;
  p75Expenses: number | null;
  meanHospitality: number | null;
};

export type CalibrationPayload = {
  generatedAt: string;
  maturity: {
    settledN: number;
    stage: MaturityStage;
    label: string;
  };
  totalExpenseCapByBucket: Record<string, CalibratedValue>;
  perCategory: Record<ExpenseCategory, CategoryCalibration>;
  hospitalityWatch: {
    p75: number | null;
    p75Last3mo: number | null;
    drift: number | null;
    flagged: boolean;
    n: number;
  };
  genreBaselines: GenreBaseline[];
  disputeRateBaseline: {
    overall: number;
    n: number;
    nDisputed: number;
  };
};

let cached: CalibrationPayload | null = null;
let pending: Promise<CalibrationPayload> | null = null;

export function clearCalibrationCache() {
  cached = null;
}

async function computeCalibration(): Promise<CalibrationPayload> {
  await migrationsReady;
  const today = todayISO();
  const [allShows, allDeals, allSettlements, allExpenses, allArtists] = await Promise.all([
    db.select().from(shows),
    db.select().from(deals),
    db.select().from(settlements),
    db.select().from(expenses),
    db.select().from(artists),
  ]);

  const pastShowIds = new Set(allShows.filter((s) => s.date <= today).map((s) => s.id));
  const showDateById = new Map(allShows.map((s) => [s.id, s.date]));
  const artistByShowId = new Map<string, string | null>();
  for (const s of allShows) artistByShowId.set(s.id, s.artistId);
  const artistById = new Map(allArtists.map((a) => [a.id, a]));

  const settledShowIds = new Set(allSettlements.map((s) => s.showId).filter((id) => pastShowIds.has(id)));
  const settledN = settledShowIds.size;

  // Bucket expenses by show
  const expensesByShow = new Map<string, typeof allExpenses>();
  for (const e of allExpenses) {
    if (!settledShowIds.has(e.showId)) continue;
    if (e.absorbedByVenue) continue;
    const arr = expensesByShow.get(e.showId) ?? [];
    arr.push(e);
    expensesByShow.set(e.showId, arr);
  }

  // Total expenses per settled show
  const totalsPerShow: number[] = [];
  for (const showId of settledShowIds) {
    const exs = expensesByShow.get(showId) ?? [];
    if (exs.length === 0) continue;
    totalsPerShow.push(exs.reduce((sum, e) => sum + e.amount, 0));
  }

  // -------- Total expense cap by bucket --------
  const dealsByBucket = new Map<string, typeof allDeals>();
  for (const d of allDeals) {
    if (!settledShowIds.has(d.showId)) continue;
    const b = classifyAnalyticsSizeBucket(d);
    const arr = dealsByBucket.get(b) ?? [];
    arr.push(d);
    dealsByBucket.set(b, arr);
  }
  const totalExpenseCapByBucket: Record<string, CalibratedValue> = {};
  for (const bucket of Object.keys(EXPENSE_CAP_BY_BUCKET_DEFAULT)) {
    const bucketDeals = dealsByBucket.get(bucket) ?? [];
    const totals: number[] = [];
    for (const d of bucketDeals) {
      const t = expensesByShow.get(d.showId);
      if (!t || t.length === 0) continue;
      totals.push(t.reduce((s, e) => s + e.amount, 0));
    }
    if (totals.length >= MATURITY_T1_MIN) {
      totals.sort((a, b) => a - b);
      const p75 = quantile(totals, 0.75);
      totalExpenseCapByBucket[bucket] = {
        value: Math.round(p75 / 50) * 50,
        source: "venue_computed",
        confidence: confidenceFor(totals.length),
        n: totals.length,
      };
    } else {
      totalExpenseCapByBucket[bucket] = {
        value: EXPENSE_CAP_BY_BUCKET_DEFAULT[bucket],
        source: "audit_default",
        confidence: "none",
        n: totals.length,
      };
    }
  }

  // -------- Per-category calibration --------
  const perCategory = {} as Record<ExpenseCategory, CategoryCalibration>;
  const cutoff3mo = isoNMonthsAgo(3);
  for (const cat of CATEGORY_LIST) {
    const sumsAllShows: number[] = [];
    const sums3mo: number[] = [];
    for (const showId of settledShowIds) {
      const exs = expensesByShow.get(showId) ?? [];
      const catSum = exs.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0);
      if (catSum === 0 && !exs.some((e) => e.category === cat)) continue;
      sumsAllShows.push(catSum);
      const date = showDateById.get(showId);
      if (date && date >= cutoff3mo) sums3mo.push(catSum);
    }
    const n = sumsAllShows.length;
    if (n >= MATURITY_T1_MIN) {
      const sorted = [...sumsAllShows].sort((a, b) => a - b);
      const p50 = quantile(sorted, 0.5);
      const p75 = quantile(sorted, 0.75);
      const mean = sumsAllShows.reduce((s, v) => s + v, 0) / n;
      let drift: number | null = null;
      if (sums3mo.length >= 6) {
        const s3 = [...sums3mo].sort((a, b) => a - b);
        const p75_3 = quantile(s3, 0.75);
        drift = p75 > 0 ? (p75_3 - p75) / p75 : null;
      }
      perCategory[cat] = {
        category: cat,
        value: Math.round(p75 / 25) * 25,
        source: "venue_computed",
        confidence: confidenceFor(n),
        n,
        p50: Math.round(p50),
        p75: Math.round(p75),
        mean: Math.round(mean),
        p75Drift3moVs12mo: drift,
      };
    } else {
      perCategory[cat] = {
        category: cat,
        value: CATEGORY_AUDIT_DEFAULTS[cat] ?? 250,
        source: "audit_default",
        confidence: "none",
        n,
        p50: null,
        p75: null,
        mean: null,
        p75Drift3moVs12mo: null,
      };
    }
  }

  // -------- Hospitality watch --------
  const hospP75 = perCategory.hospitality.p75;
  const hospDrift = perCategory.hospitality.p75Drift3moVs12mo;
  const hospitalityWatch = {
    p75: hospP75,
    p75Last3mo:
      hospDrift != null && hospP75 != null ? Math.round(hospP75 * (1 + hospDrift)) : null,
    drift: hospDrift,
    flagged: hospDrift != null && Math.abs(hospDrift) >= 0.1,
    n: perCategory.hospitality.n,
  };

  // -------- Genre baselines --------
  const expensesByGenre = new Map<string, { totals: number[]; hosp: number[] }>();
  for (const showId of settledShowIds) {
    const artistId = artistByShowId.get(showId);
    if (!artistId) continue;
    const artist = artistById.get(artistId);
    if (!artist || !artist.genre) continue;
    const exs = expensesByShow.get(showId) ?? [];
    if (exs.length === 0) continue;
    const total = exs.reduce((s, e) => s + e.amount, 0);
    const hosp = exs.filter((e) => e.category === "hospitality").reduce((s, e) => s + e.amount, 0);
    let acc = expensesByGenre.get(artist.genre);
    if (!acc) {
      acc = { totals: [], hosp: [] };
      expensesByGenre.set(artist.genre, acc);
    }
    acc.totals.push(total);
    acc.hosp.push(hosp);
  }
  const genreBaselines: GenreBaseline[] = [];
  for (const [genre, acc] of expensesByGenre) {
    if (acc.totals.length < 3) continue;
    const sorted = [...acc.totals].sort((a, b) => a - b);
    const mean = acc.totals.reduce((s, v) => s + v, 0) / acc.totals.length;
    const p75 = quantile(sorted, 0.75);
    const meanHosp = acc.hosp.reduce((s, v) => s + v, 0) / acc.hosp.length;
    genreBaselines.push({
      genre,
      n: acc.totals.length,
      meanExpenses: Math.round(mean),
      p75Expenses: Math.round(p75),
      meanHospitality: Math.round(meanHosp),
    });
  }
  genreBaselines.sort((a, b) => b.n - a.n);

  // -------- Dispute rate baseline --------
  let nDisputed = 0;
  for (const s of allSettlements) {
    if (!settledShowIds.has(s.showId)) continue;
    let isDisputed = s.status === "disputed";
    if (!isDisputed) {
      try {
        const recs = JSON.parse(s.recoupsJson ?? "[]") as Array<{ status?: string }>;
        if (recs.some((r) => r.status === "disputed")) isDisputed = true;
      } catch {/* noop */}
    }
    if (isDisputed) nDisputed++;
  }

  return {
    generatedAt: new Date().toISOString(),
    maturity: {
      settledN,
      stage: maturityStage(settledN),
      label:
        settledN < MATURITY_T1_MIN
          ? "Bootstrapping — using industry audit defaults"
          : settledN < MATURITY_T2_MIN
          ? "Calibrating — early venue-computed baselines"
          : settledN < MATURITY_T3_MIN
          ? "Calibrated — stable venue-computed baselines"
          : "Mature — high-confidence venue-computed baselines",
    },
    totalExpenseCapByBucket,
    perCategory,
    hospitalityWatch,
    genreBaselines,
    disputeRateBaseline: {
      overall: settledN > 0 ? nDisputed / settledN : 0,
      n: settledN,
      nDisputed,
    },
  };
}

export async function getCalibration(opts: { force?: boolean } = {}): Promise<CalibrationPayload> {
  if (!opts.force && cached) return cached;
  if (pending) return pending;
  const run = (async () => {
    const payload = await computeCalibration();
    cached = payload;
    return payload;
  })();
  pending = run;
  try {
    return await run;
  } finally {
    if (pending === run) pending = null;
  }
}

// -------- Per-show live meter --------

export type ShowMeterCell = {
  category: ExpenseCategory;
  liveAmount: number;
  cap: number;
  capSource: "deal_total_cap_share" | "deal_hospitality_cap" | "venue_computed" | "audit_default";
  pctOfCap: number;
  alertLevel: AlertLevel;
  n: number;
  confidence: Confidence;
};

export type ShowMeterPayload = {
  showId: string;
  generatedAt: string;
  bucket: string;
  totalLive: number;
  totalCap: number;
  totalCapSource: CalibrationSource;
  totalPctOfCap: number;
  totalAlertLevel: AlertLevel;
  cells: ShowMeterCell[];
};

function classifyAlert(pct: number): AlertLevel {
  if (pct > 1.0) return "alert";
  if (pct >= 0.8) return "watch";
  return "ok";
}

export async function getShowMeter(showId: string): Promise<ShowMeterPayload | null> {
  await migrationsReady;
  const [showRow] = await db.select().from(shows).where(eq(shows.id, showId));
  if (!showRow) return null;
  const [dealRow] = await db.select().from(deals).where(eq(deals.showId, showId));
  const allExpenses = await db.select().from(expenses).where(eq(expenses.showId, showId));

  const calib = await getCalibration();
  const bucket = dealRow ? classifyAnalyticsSizeBucket(dealRow) : "$1–5K";

  const liveByCat = new Map<string, number>();
  for (const e of allExpenses) {
    if (e.absorbedByVenue) continue;
    liveByCat.set(e.category, (liveByCat.get(e.category) ?? 0) + e.amount);
  }

  // Total cap = deal expenseCap (if set) else calibrated bucket cap
  const dealTotalCap = dealRow?.expenseCap ?? null;
  const bucketCap = calib.totalExpenseCapByBucket[bucket];
  const totalCap = dealTotalCap ?? bucketCap?.value ?? 1750;
  const totalCapSource: CalibrationSource =
    dealTotalCap != null
      ? "venue_computed"
      : bucketCap?.source ?? "audit_default";

  const cells: ShowMeterCell[] = [];
  for (const cat of CATEGORY_LIST) {
    const live = liveByCat.get(cat) ?? 0;
    let cap: number;
    let capSource: ShowMeterCell["capSource"];
    let n = 0;
    let conf: Confidence = "none";
    if (cat === "hospitality" && dealRow?.hospitalityCap != null) {
      cap = dealRow.hospitalityCap;
      capSource = "deal_hospitality_cap";
      conf = "high";
    } else {
      const cc = calib.perCategory[cat];
      cap = cc.value ?? CATEGORY_AUDIT_DEFAULTS[cat] ?? 250;
      capSource = cc.source === "venue_computed" ? "venue_computed" : "audit_default";
      n = cc.n;
      conf = cc.confidence;
    }
    if (live === 0 && cap === 0) continue;
    const pct = cap > 0 ? live / cap : 0;
    cells.push({
      category: cat,
      liveAmount: live,
      cap,
      capSource,
      pctOfCap: pct,
      alertLevel: classifyAlert(pct),
      n,
      confidence: conf,
    });
  }

  const totalLive = Array.from(liveByCat.values()).reduce((s, v) => s + v, 0);
  const totalPct = totalCap > 0 ? totalLive / totalCap : 0;

  return {
    showId,
    generatedAt: new Date().toISOString(),
    bucket,
    totalLive,
    totalCap,
    totalCapSource,
    totalPctOfCap: totalPct,
    totalAlertLevel: classifyAlert(totalPct),
    cells: cells.sort((a, b) => b.pctOfCap - a.pctOfCap),
  };
}

// -------- Artist expense profile --------

export type ArtistExpenseProfile = {
  artistId: string;
  settledShows: number;
  totalExpensesMean: number | null;
  totalExpensesP75: number | null;
  hospitalityMean: number | null;
  hospitalityP75: number | null;
  topCategory: { category: ExpenseCategory; mean: number } | null;
  vsGenre: {
    genre: string | null;
    genreMeanExpenses: number | null;
    artistVsGenrePct: number | null;
  };
  source: "venue_computed" | "audit_default" | "none";
  confidence: Confidence;
};

export async function getArtistExpenseProfile(
  artistId: string,
): Promise<ArtistExpenseProfile | null> {
  await migrationsReady;
  const [artistRow] = await db.select().from(artists).where(eq(artists.id, artistId));
  if (!artistRow) return null;
  const today = todayISO();
  const [allShows, allExpenses] = await Promise.all([
    db.select().from(shows),
    db.select().from(expenses),
  ]);
  const settlementsRows = await db.select().from(settlements);
  const settledShowIds = new Set(
    settlementsRows.map((s) => s.showId).filter((id) => {
      const sh = allShows.find((x) => x.id === id);
      return sh && sh.date <= today;
    }),
  );
  const artistShowIds = new Set(
    allShows
      .filter((s) => s.artistId === artistId && settledShowIds.has(s.id))
      .map((s) => s.id),
  );
  const totals: number[] = [];
  const hosp: number[] = [];
  const catSums = new Map<ExpenseCategory, number>();
  let nWithExpenses = 0;
  for (const id of artistShowIds) {
    const ex = allExpenses.filter((e) => e.showId === id && !e.absorbedByVenue);
    if (ex.length === 0) continue;
    nWithExpenses++;
    totals.push(ex.reduce((s, e) => s + e.amount, 0));
    hosp.push(ex.filter((e) => e.category === "hospitality").reduce((s, e) => s + e.amount, 0));
    for (const e of ex) {
      catSums.set(
        e.category as ExpenseCategory,
        (catSums.get(e.category as ExpenseCategory) ?? 0) + e.amount,
      );
    }
  }
  const calib = await getCalibration();
  const genre = artistRow.genre ?? null;
  const gb = genre ? calib.genreBaselines.find((g) => g.genre === genre) ?? null : null;

  if (nWithExpenses === 0) {
    return {
      artistId,
      settledShows: artistShowIds.size,
      totalExpensesMean: null,
      totalExpensesP75: null,
      hospitalityMean: null,
      hospitalityP75: null,
      topCategory: null,
      vsGenre: {
        genre,
        genreMeanExpenses: gb?.meanExpenses ?? null,
        artistVsGenrePct: null,
      },
      source: "none",
      confidence: "none",
    };
  }

  const totalsSorted = [...totals].sort((a, b) => a - b);
  const hospSorted = [...hosp].sort((a, b) => a - b);
  const mean = totals.reduce((s, v) => s + v, 0) / totals.length;
  const p75 = quantile(totalsSorted, 0.75);
  const hospMean = hosp.reduce((s, v) => s + v, 0) / hosp.length;
  const hospP75Val = quantile(hospSorted, 0.75);
  let topCat: ArtistExpenseProfile["topCategory"] = null;
  for (const [cat, total] of catSums) {
    const avg = total / nWithExpenses;
    if (!topCat || avg > topCat.mean) topCat = { category: cat, mean: Math.round(avg) };
  }
  const venueComputed = nWithExpenses >= 3;
  const vsGenrePct =
    gb?.meanExpenses && gb.meanExpenses > 0
      ? (mean - gb.meanExpenses) / gb.meanExpenses
      : null;
  return {
    artistId,
    settledShows: artistShowIds.size,
    totalExpensesMean: Math.round(mean),
    totalExpensesP75: Math.round(p75),
    hospitalityMean: Math.round(hospMean),
    hospitalityP75: Math.round(hospP75Val),
    topCategory: topCat,
    vsGenre: {
      genre,
      genreMeanExpenses: gb?.meanExpenses ?? null,
      artistVsGenrePct: vsGenrePct,
    },
    source: venueComputed ? "venue_computed" : "audit_default",
    confidence: confidenceFor(nWithExpenses),
  };
}

// -------- Account-level health --------

export type AccountHealth = {
  upcomingCount: number;
  upcomingNoDealCount: number;
  upcomingWithoutCapsCount: number;
  driftedCategories: { category: ExpenseCategory; drift: number }[];
  hospitalityFlagged: boolean;
  maturityStage: MaturityStage;
  settledN: number;
};

export async function getAccountHealth(): Promise<AccountHealth> {
  await migrationsReady;
  const today = todayISO();
  const [allShows, allDeals] = await Promise.all([
    db.select().from(shows),
    db.select().from(deals),
  ]);
  const upcoming = allShows.filter((s) => s.date > today);
  const dealByShow = new Map(allDeals.map((d) => [d.showId, d]));
  let noDeal = 0;
  let noCap = 0;
  for (const s of upcoming) {
    const d = dealByShow.get(s.id);
    if (!d) {
      noDeal++;
      continue;
    }
    if (d.dealType !== "flat" && d.expenseCap == null) noCap++;
  }
  const calib = await getCalibration();
  const drifted = Object.values(calib.perCategory)
    .filter((c) => c.p75Drift3moVs12mo != null && Math.abs(c.p75Drift3moVs12mo) >= 0.1)
    .map((c) => ({ category: c.category, drift: c.p75Drift3moVs12mo as number }));
  return {
    upcomingCount: upcoming.length,
    upcomingNoDealCount: noDeal,
    upcomingWithoutCapsCount: noCap,
    driftedCategories: drifted,
    hospitalityFlagged: calib.hospitalityWatch.flagged,
    maturityStage: calib.maturity.stage,
    settledN: calib.maturity.settledN,
  };
}
