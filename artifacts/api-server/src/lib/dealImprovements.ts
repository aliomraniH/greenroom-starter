import { db } from "../db";
import {
  deals,
  shows,
  settlements,
  expenses,
  type Deal,
} from "../db/schema";
import { eq, lte } from "drizzle-orm";
import { classifyAnalyticsSizeBucket } from "./queries";
import { getExpenseCaps } from "./expenseCaps";

// Per-bucket expense caps are derived from live data via `expenseCaps.ts`
// (P75 of historical billed expenses per analytics bucket). The previous
// hardcoded table here would have drifted from reality every time a
// settlement was logged. Both this module and the SGP engine now read
// from the same source so they can never disagree.

// Audit also showed hospitality is flat ~$304/show across every bucket — the
// $50 spread between old bucket defaults wasn't supported by the data. Use
// one number with margin so a single contract field works for any deal.
const HOSPITALITY_CAP_DEFAULT = 400;

export type ImprovementKind =
  | "add_expense_cap"
  | "add_hospitality_cap";

export type ImprovementRiskFor = "booker" | "artist" | "both";

export interface DealImprovement {
  kind: ImprovementKind;
  title: string;
  rationale: string;
  currentValue: string;
  proposedValue: string;
  proposedNumber: number | null;
  protects: ImprovementRiskFor;
  simplifies: boolean;
}

export interface ImprovementsContextStats {
  bucket: string;
  dealType: string;
  comparableSettlements: number;
  comparableDisputes: number;
  disputeRate: number;
  medianExpenses: number | null;
  medianHospitalityOverage: number | null;
}

export interface DealImprovementsPayload {
  showId: string;
  dealId: string | null;
  improvements: DealImprovement[];
  context: ImprovementsContextStats;
}

// Re-use the analytics-canonical bucket function so this module stays in
// lock-step with the Deal Analysis grid and Smart Switch cell stats. A
// previous local copy of this function diverged on the zero-guarantee
// case (routing every percentage deal to "Uncapped %" regardless of deal
// type), which caused zero-guarantee vs/pn/door deals to be assigned to
// different cells in the improvements pipeline than they were in the
// analytics grid. Always use the canonical implementation in queries.ts.
const classifyBucket = classifyAnalyticsSizeBucket;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function todayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

async function loadComparables(deal: Deal, bucket: string) {
  const today = todayISO();
  const [allShows, allDeals, allSettlements, allExpenses] = await Promise.all([
    db.select().from(shows).where(lte(shows.date, today)),
    db.select().from(deals),
    db.select().from(settlements),
    db.select().from(expenses),
  ]);

  const dealByShow = new Map(allDeals.map((d) => [d.showId, d]));
  const expensesByShow = new Map<string, typeof allExpenses>();
  for (const e of allExpenses) {
    const arr = expensesByShow.get(e.showId) ?? [];
    arr.push(e);
    expensesByShow.set(e.showId, arr);
  }

  const matchingShowIds = new Set<string>();
  for (const s of allShows) {
    const d = dealByShow.get(s.id);
    if (!d) continue;
    if (d.dealType !== deal.dealType) continue;
    if (classifyBucket(d) !== bucket) continue;
    matchingShowIds.add(s.id);
  }

  let disputed = 0;
  let settledN = 0;
  for (const s of allSettlements) {
    if (!matchingShowIds.has(s.showId)) continue;
    settledN++;
    let isDisputed = s.status === "disputed";
    if (!isDisputed) {
      try {
        const recs = JSON.parse(s.recoupsJson ?? "[]") as Array<{ status?: string }>;
        if (recs.some((r) => r.status === "disputed")) isDisputed = true;
      } catch { /* noop */ }
    }
    if (isDisputed) disputed++;
  }

  const expenseTotalsPerShow: number[] = [];
  const hospOveragePerShow: number[] = [];
  for (const showId of matchingShowIds) {
    const exs = expensesByShow.get(showId) ?? [];
    const billed = exs.filter((e) => !e.absorbedByVenue);
    if (billed.length > 0) {
      expenseTotalsPerShow.push(billed.reduce((sum, e) => sum + e.amount, 0));
    }
    const hosp = billed.filter((e) => e.category === "hospitality");
    if (hosp.length > 0) {
      hospOveragePerShow.push(hosp.reduce((sum, e) => sum + e.amount, 0));
    }
  }

  return {
    comparableSettlements: settledN,
    comparableDisputes: disputed,
    disputeRate: settledN > 0 ? disputed / settledN : 0,
    medianExpenses: median(expenseTotalsPerShow),
    medianHospitalityOverage: median(hospOveragePerShow),
  };
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString()}`;
}

export async function getDealImprovements(showId: string): Promise<DealImprovementsPayload> {
  const [showRow] = await db.select().from(shows).where(eq(shows.id, showId));
  if (!showRow) throw new Error("show_not_found");
  const [dealRow] = await db.select().from(deals).where(eq(deals.showId, showId));
  if (!dealRow) {
    return {
      showId,
      dealId: null,
      improvements: [],
      context: {
        bucket: "—",
        dealType: "—",
        comparableSettlements: 0,
        comparableDisputes: 0,
        disputeRate: 0,
        medianExpenses: null,
        medianHospitalityOverage: null,
      },
    };
  }

  const bucket = classifyBucket(dealRow);
  const [ctx, caps] = await Promise.all([
    loadComparables(dealRow, bucket),
    getExpenseCaps(),
  ]);

  const improvements: DealImprovement[] = [];

  // 1) Add expense cap if missing — applies to vs / % of net / door (deals where expenses
  //    eat into the artist's percentage payout). Skip for flat & % of gross.
  if (
    dealRow.expenseCap == null &&
    (dealRow.dealType === "vs" || dealRow.dealType === "percentage_of_net" || dealRow.dealType === "door")
  ) {
    const proposed = caps.byBucket[bucket] ?? caps.venueP75 ?? 1750;
    improvements.push({
      kind: "add_expense_cap",
      title: `Add a ${fmtMoney(proposed)} expense cap`,
      rationale:
        `Covers 75% of past nights at this venue. A written cap stops settlement-time ` +
        `arguments about which line items count toward the artist's recoup.`,
      currentValue: "No cap",
      proposedValue: fmtMoney(proposed),
      proposedNumber: proposed,
      protects: "artist",
      simplifies: true,
    });
  }

  // 2) Add hospitality cap if missing — applies to any non-flat deal.
  if (dealRow.hospitalityCap == null && dealRow.dealType !== "flat") {
    improvements.push({
      kind: "add_hospitality_cap",
      title: `Add a ${fmtMoney(HOSPITALITY_CAP_DEFAULT)} hospitality cap`,
      rationale:
        `Covers 75% of past nights at this venue (hospitality runs flat ~$300/show ` +
        `regardless of deal size). Prevents night-of receipt arguments over a ` +
        `$200 deli platter.`,
      currentValue: "No cap",
      proposedValue: fmtMoney(HOSPITALITY_CAP_DEFAULT),
      proposedNumber: HOSPITALITY_CAP_DEFAULT,
      protects: "both",
      simplifies: true,
    });
  }

  // Note: convert_to_flat is intentionally NOT generated here. Flat conversion
  // is owned by Smart Switch, which is correctly scoped to vs/pn at $1–5K and
  // door (any size) — the only cells where a flat replacement is data-safe.

  return {
    showId,
    dealId: dealRow.id,
    improvements,
    context: {
      bucket,
      dealType: dealRow.dealType,
      comparableSettlements: ctx.comparableSettlements,
      comparableDisputes: ctx.comparableDisputes,
      disputeRate: ctx.disputeRate,
      medianExpenses: ctx.medianExpenses,
      medianHospitalityOverage: ctx.medianHospitalityOverage,
    },
  };
}

export interface ApplyImprovementItem {
  kind: ImprovementKind;
  value?: number;
}

export async function applyDealImprovements(
  showId: string,
  items: ApplyImprovementItem[],
): Promise<{ ok: true; appliedKinds: ImprovementKind[]; dealId: string }> {
  const [dealRow] = await db.select().from(deals).where(eq(deals.showId, showId));
  if (!dealRow) throw new Error("no_deal");

  const payload = await getDealImprovements(showId);
  const byKind = new Map(payload.improvements.map((i) => [i.kind, i]));

  const update: Partial<typeof deals.$inferInsert> = {};
  const applied: ImprovementKind[] = [];

  for (const item of items) {
    const kind = item.kind;
    const imp = byKind.get(kind);
    const value = (typeof item.value === "number" && Number.isFinite(item.value) && item.value >= 0)
      ? item.value
      : imp?.proposedNumber ?? null;
    if (value == null) continue;
    if (kind === "add_expense_cap") {
      update.expenseCap = value;
      applied.push(kind);
    } else if (kind === "add_hospitality_cap") {
      update.hospitalityCap = value;
      applied.push(kind);
    }
  }

  if (Object.keys(update).length === 0) {
    return { ok: true, appliedKinds: [], dealId: dealRow.id };
  }

  await db.update(deals).set(update).where(eq(deals.id, dealRow.id));
  return { ok: true, appliedKinds: applied, dealId: dealRow.id };
}

export const __TEST_CONSTANTS__ = {
  HOSPITALITY_CAP_DEFAULT,
};
