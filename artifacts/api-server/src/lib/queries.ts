import { db } from "../db";
import {
  shows, artists, agents, agencies, deals, ticketSales, comps, expenses,
  settlements, venues, switchSuggestions, guaranteeSuggestions, type Recoup,
} from "../db/schema";
import { desc, asc, eq, sql, lte } from "drizzle-orm";

function todayDateString(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

const UNSUPPORTED_DEAL_TYPES = new Set(["percentage_of_net", "vs", "door"]);

export function parseRecoups(recoupsJson: string | null): Recoup[] {
  if (!recoupsJson) return [];
  try {
    const parsed = JSON.parse(recoupsJson);
    return Array.isArray(parsed) ? (parsed as Recoup[]) : [];
  } catch {
    return [];
  }
}

export function isUnsupportedDeal(
  deal: typeof deals.$inferSelect | null,
): boolean {
  return !!deal && UNSUPPORTED_DEAL_TYPES.has(deal.dealType);
}

export function isDisputedSettlement(
  settlement: typeof settlements.$inferSelect | null,
): boolean {
  if (!settlement) return false;
  if (settlement.status === "disputed") return true;
  return parseRecoups(settlement.recoupsJson).some(
    (r) => r?.status === "disputed",
  );
}

export async function getAllShows() {
  const today = todayDateString();
  const rows = await db
    .select({
      show: shows, artist: artists, agent: agents, deal: deals, settlement: settlements,
    })
    .from(shows)
    .leftJoin(artists, eq(shows.artistId, artists.id))
    .leftJoin(agents, eq(artists.agentId, agents.id))
    .leftJoin(deals, eq(deals.showId, shows.id))
    .leftJoin(settlements, eq(settlements.showId, shows.id))
    .orderBy(asc(shows.date));

  const allExpenses = await db.select().from(expenses);
  const expenseCategoriesByShowId = new Map<string, Set<string>>();
  for (const e of allExpenses) {
    if (!expenseCategoriesByShowId.has(e.showId)) {
      expenseCategoriesByShowId.set(e.showId, new Set());
    }
    expenseCategoriesByShowId.get(e.showId)!.add(e.category);
  }

  const allSuggestions = await db.select().from(switchSuggestions);
  const switchStatusByShowId = new Map<string, "suggested" | "accepted" | "declined">();
  for (const s of allSuggestions) switchStatusByShowId.set(s.showId, s.status);

  const allGuarantees = await db.select().from(guaranteeSuggestions);
  const guaranteeByShowId = new Map<string, { suggestedPrice: number; delta: number }>();
  for (const g of allGuarantees) {
    guaranteeByShowId.set(g.showId, { suggestedPrice: g.suggestedPrice, delta: g.delta });
  }

  return rows.map((r) => {
    const recoups = parseRecoups(r.settlement?.recoupsJson ?? null);
    return {
      ...r,
      isUnsupportedDeal: isUnsupportedDeal(r.deal),
      isDisputed: isDisputedSettlement(r.settlement),
      tense: (r.show.date > today ? "upcoming" : r.show.date === today ? "today" : "past") as "past" | "today" | "upcoming",
      switchStatus: switchStatusByShowId.get(r.show.id) ?? null,
      guaranteeSuggestion: guaranteeByShowId.get(r.show.id) ?? null,
      expenseCategories: Array.from(
        expenseCategoriesByShowId.get(r.show.id) ?? [],
      ),
      recoupCategories: Array.from(new Set(recoups.map((x) => x.category))),
      disputedRecoupCategories: Array.from(
        new Set(recoups.filter((x) => x.status === "disputed").map((x) => x.category)),
      ),
    };
  });
}

export async function getShowById(id: string) {
  const rows = await db
    .select({
      show: shows, artist: artists, agent: agents, agency: agencies,
      deal: deals, settlement: settlements, venue: venues,
    })
    .from(shows)
    .leftJoin(artists, eq(shows.artistId, artists.id))
    .leftJoin(agents, eq(artists.agentId, agents.id))
    .leftJoin(agencies, eq(agents.agencyId, agencies.id))
    .leftJoin(deals, eq(deals.showId, shows.id))
    .leftJoin(settlements, eq(settlements.showId, shows.id))
    .leftJoin(venues, eq(shows.venueId, venues.id))
    .where(eq(shows.id, id));

  if (rows.length === 0) return null;
  const row = rows[0];

  const [showTicketSales, showExpenses, showComps] = await Promise.all([
    db.select().from(ticketSales).where(eq(ticketSales.showId, id))
      .orderBy(desc(ticketSales.capturedAt)),
    db.select().from(expenses).where(eq(expenses.showId, id))
      .orderBy(asc(expenses.enteredAt)),
    db.select().from(comps).where(eq(comps.showId, id)),
  ]);

  const recoups = parseRecoups(row.settlement?.recoupsJson ?? null);

  const suggestionRows = await db
    .select()
    .from(switchSuggestions)
    .where(eq(switchSuggestions.showId, id));
  const rawSwitchSuggestion = suggestionRows[0] ?? null;
  // Audit acceptance: derive isDeadPool from the persisted source enum so
  // the public API contract always carries the explicit boolean.
  const switchSuggestion = rawSwitchSuggestion
    ? { ...rawSwitchSuggestion, isDeadPool: rawSwitchSuggestion.source === "door_dead_pool" }
    : null;

  const guaranteeRows = await db
    .select()
    .from(guaranteeSuggestions)
    .where(eq(guaranteeSuggestions.showId, id));
  const guaranteeSuggestion = guaranteeRows[0] ?? null;

  return {
    ...row,
    ticketSales: showTicketSales,
    expenses: showExpenses,
    comps: showComps,
    recoups,
    switchSuggestion,
    guaranteeSuggestion,
    isUnsupportedDeal: isUnsupportedDeal(row.deal),
    isDisputed: isDisputedSettlement(row.settlement),
  };
}

function firstSentence(text: string, maxLen = 90): string {
  const t = text.trim();
  if (!t) return "";
  const m = t.match(/^[^.!?\n]+[.!?]?/);
  const head = (m ? m[0] : t).trim();
  if (head.length <= maxLen) return head;
  return head.slice(0, maxLen - 1).trimEnd() + "…";
}

export async function getAllArtists() {
  const baseRows = await db
    .select({
      artist: artists, agent: agents, agency: agencies,
      showCount: sql<number>`count(${shows.id})`.as("show_count"),
      lastShowDate: sql<string | null>`max(${shows.date})`.as("last_show_date"),
    })
    .from(artists)
    .leftJoin(agents, eq(artists.agentId, agents.id))
    .leftJoin(agencies, eq(agents.agencyId, agencies.id))
    .leftJoin(shows, eq(shows.artistId, artists.id))
    .groupBy(artists.id, agents.id, agencies.id)
    .orderBy(desc(sql`count(${shows.id})`), asc(artists.name));

  const dealRows = await db
    .select({ artistId: shows.artistId, dealType: deals.dealType })
    .from(deals)
    .innerJoin(shows, eq(deals.showId, shows.id));

  const settlementRows = await db
    .select({
      artistId: shows.artistId,
      date: shows.date,
      pos: settlements.positiveSummary,
      neg: settlements.negativeSummary,
    })
    .from(settlements)
    .innerJoin(shows, eq(settlements.showId, shows.id));

  const attentionItems = await getNeedsAttention();
  const showToArtist = new Map<string, string>();
  const allShowsRows = await db.select({ id: shows.id, artistId: shows.artistId }).from(shows);
  for (const s of allShowsRows) showToArtist.set(s.id, s.artistId);

  const dealCounts = new Map<string, Map<string, number>>();
  for (const d of dealRows) {
    let m = dealCounts.get(d.artistId);
    if (!m) { m = new Map(); dealCounts.set(d.artistId, m); }
    m.set(d.dealType, (m.get(d.dealType) ?? 0) + 1);
  }

  type SumRow = { date: string; pos: string | null; neg: string | null };
  const summariesByArtist = new Map<string, SumRow[]>();
  for (const s of settlementRows) {
    let arr = summariesByArtist.get(s.artistId);
    if (!arr) { arr = []; summariesByArtist.set(s.artistId, arr); }
    arr.push({ date: s.date, pos: s.pos, neg: s.neg });
  }

  const attentionByArtist = new Map<string, number>();
  for (const a of attentionItems) {
    const aid = showToArtist.get(a.showId);
    if (!aid) continue;
    attentionByArtist.set(aid, (attentionByArtist.get(aid) ?? 0) + 1);
  }

  return baseRows.map((row) => {
    const aid = row.artist.id;
    const dm = dealCounts.get(aid);
    let topDealType: string | null = null;
    let topDealTypeCount = 0;
    if (dm) {
      for (const [dt, n] of dm) {
        if (n > topDealTypeCount) { topDealType = dt; topDealTypeCount = n; }
      }
    }
    const dealTypes = dm
      ? Array.from(dm.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([dt, count]) => ({ dealType: dt, count }))
      : [];

    const sums = (summariesByArtist.get(aid) ?? []).slice().sort((a, b) => b.date.localeCompare(a.date));
    let topPositive: string | null = null;
    let topNegative: string | null = null;
    for (const s of sums) {
      if (!topPositive && s.pos && s.pos.trim()) topPositive = firstSentence(s.pos);
      if (!topNegative && s.neg && s.neg.trim()) topNegative = firstSentence(s.neg);
      if (topPositive && topNegative) break;
    }

    return {
      ...row,
      topDealType,
      dealTypes,
      topPositive,
      topNegative,
      attentionCount: attentionByArtist.get(aid) ?? 0,
    };
  });
}

type ComplexityBucket = "simple" | "medium" | "complex";

function classifyComplexity(d: typeof deals.$inferSelect): ComplexityBucket {
  const hasBonuses = !!d.bonusesJson && d.bonusesJson !== "[]" && d.bonusesJson !== "null";
  const hasNotes = !!d.dealNotesFreetext && d.dealNotesFreetext.trim().length > 0;
  if (
    d.dealType === "vs" ||
    d.dealType === "door" ||
    d.dealType === "percentage_of_net" ||
    hasBonuses ||
    hasNotes
  ) {
    return "complex";
  }
  if (
    d.dealType === "percentage_of_gross" ||
    d.expenseCap != null ||
    d.hospitalityCap != null
  ) {
    return "medium";
  }
  return "simple";
}

export function classifySizeBucket(d: typeof deals.$inferSelect): string {
  if (d.guaranteeAmount == null || d.guaranteeAmount === 0) {
    if (d.percentage != null) return "Uncapped %";
    return "$0–1K";
  }
  const g = d.guaranteeAmount;
  if (g < 1000) return "$0–1K";
  if (g < 5000) return "$1–5K";
  if (g < 15000) return "$5–15K";
  return "$15K+";
}

/**
 * Audit fix #8: analytics-side bucket classifier.
 *
 * Identical to `classifySizeBucket` EXCEPT that "Uncapped %" is reserved
 * for `percentage_of_gross` deals (the only shape where uncapped percentage
 * is the literal contract structure). vs / percentage_of_net / door deals
 * with a $0 guarantee fall into the smallest gross-size bucket so they're
 * analyzed alongside their gross-size peers in the deal-analysis grid,
 * Smart Switch cell stats, Insights, and the savings rollups — instead of
 * being lumped onto the same "Uncapped %" line as percentage_of_gross deals.
 *
 * Smart Guaranteed Price (smartGuarantee.ts) intentionally keeps using the
 * shared `classifySizeBucket` above so its expense-estimate lookup table
 * (keyed by bucket) stays stable across this audit change.
 */
export function classifyAnalyticsSizeBucket(
  d: typeof deals.$inferSelect,
): string {
  if (d.guaranteeAmount == null || d.guaranteeAmount === 0) {
    if (d.percentage != null && d.dealType === "percentage_of_gross") {
      return "Uncapped %";
    }
    return "$0–1K";
  }
  const g = d.guaranteeAmount;
  if (g < 1000) return "$0–1K";
  if (g < 5000) return "$1–5K";
  if (g < 15000) return "$5–15K";
  return "$15K+";
}

const SIZE_ORDER = ["$0–1K", "$1–5K", "$5–15K", "$15K+", "Uncapped %"];

export async function getDealAnalysis() {
  const attentionItems = await getNeedsAttention();
  const attentionByShowId = new Map<string, Set<AttentionKind>>();
  for (const it of attentionItems) {
    let s = attentionByShowId.get(it.showId);
    if (!s) { s = new Set(); attentionByShowId.set(it.showId, s); }
    s.add(it.kind);
  }

  const today = todayDateString();
  const allShowsRows = await db.select().from(shows);
  const pastShowIds = new Set(
    allShowsRows.filter((s) => s.date <= today).map((s) => s.id),
  );
  const showDateById = new Map(allShowsRows.map((s) => [s.id, s.date]));

  const allDealsRows = await db.select().from(deals);
  const pastDeals = allDealsRows.filter((d) => pastShowIds.has(d.showId));
  const allSettlementsRows = await db.select().from(settlements);
  const pastSettlements = allSettlementsRows.filter((s) =>
    pastShowIds.has(s.showId),
  );
  const settlementByShowId = new Map(
    pastSettlements.map((s) => [s.showId, s]),
  );
  const allExpensesRows = await db.select().from(expenses);
  const pastExpenses = allExpensesRows.filter((e) => pastShowIds.has(e.showId));

  const expensesByShowIdAll: Map<string, number> = new Map();
  for (const e of pastExpenses) {
    expensesByShowIdAll.set(e.showId, (expensesByShowIdAll.get(e.showId) ?? 0) + e.amount);
  }

  const supportedTypes = new Set(["flat", "percentage_of_gross"]);
  const totalDeals = pastDeals.length;

  const complexityAcc: Record<
    ComplexityBucket,
    { count: number; payoutSum: number; payoutN: number; inTool: number; spreadsheet: number }
  > = {
    simple: { count: 0, payoutSum: 0, payoutN: 0, inTool: 0, spreadsheet: 0 },
    medium: { count: 0, payoutSum: 0, payoutN: 0, inTool: 0, spreadsheet: 0 },
    complex: { count: 0, payoutSum: 0, payoutN: 0, inTool: 0, spreadsheet: 0 },
  };

  const sizeAcc: Record<
    string,
    { count: number; grossSum: number; grossN: number; artistSum: number; artistN: number; disputed: number; settledN: number; losingMoney: number; profitN: number }
  > = {};
  for (const k of SIZE_ORDER) {
    sizeAcc[k] = { count: 0, grossSum: 0, grossN: 0, artistSum: 0, artistN: 0, disputed: 0, settledN: 0, losingMoney: 0, profitN: 0 };
  }

  const profitabilityAcc = {
    profitable: { count: 0, disputed: 0 },
    unprofitable: { count: 0, disputed: 0 },
  };

  const ATTENTION_KINDS: AttentionKind[] = [
    "notes_say_closed_but_status_open",
    "show_settled_no_settlement",
    "disputed_recoups_but_signed",
    "stale_disputed",
  ];
  type CrossCell = {
    count: number;
    settledN: number;
    profitN: number;
    losingMoney: number;
    disputed: number;
    attentionCount: number;
    attentionByKind: Record<AttentionKind, number>;
  };
  const emptyKindCounts = (): Record<AttentionKind, number> => ({
    notes_say_closed_but_status_open: 0,
    show_settled_no_settlement: 0,
    disputed_recoups_but_signed: 0,
    stale_disputed: 0,
  });
  const crossAcc: Map<string, Map<string, CrossCell>> = new Map();
  const dealTypesSeen = new Set<string>();
  function crossCell(dealType: string, bucket: string): CrossCell {
    let row = crossAcc.get(dealType);
    if (!row) { row = new Map(); crossAcc.set(dealType, row); }
    let cell = row.get(bucket);
    if (!cell) {
      cell = { count: 0, settledN: 0, profitN: 0, losingMoney: 0, disputed: 0, attentionCount: 0, attentionByKind: emptyKindCounts() };
      row.set(bucket, cell);
    }
    return cell;
  }

  for (const d of pastDeals) {
    const c = classifyComplexity(d);
    const s = settlementByShowId.get(d.showId);
    complexityAcc[c].count++;
    if (supportedTypes.has(d.dealType)) complexityAcc[c].inTool++;
    else complexityAcc[c].spreadsheet++;
    if (s?.totalToArtist != null) {
      complexityAcc[c].payoutSum += s.totalToArtist;
      complexityAcc[c].payoutN++;
    }

    const bucket = classifyAnalyticsSizeBucket(d);
    sizeAcc[bucket].count++;
    dealTypesSeen.add(d.dealType);
    const cc = crossCell(d.dealType, bucket);
    cc.count++;
    const kinds = attentionByShowId.get(d.showId);
    if (kinds && kinds.size > 0) {
      cc.attentionCount++;
      for (const k of kinds) cc.attentionByKind[k]++;
    }
    if (s) {
      sizeAcc[bucket].settledN++;
      const disputed = isDisputedSettlement(s);
      if (disputed) sizeAcc[bucket].disputed++;
      cc.settledN++;
      if (disputed) cc.disputed++;
      if (s.grossBoxOffice != null) {
        sizeAcc[bucket].grossSum += s.grossBoxOffice;
        sizeAcc[bucket].grossN++;
      }
      if (s.totalToArtist != null) {
        sizeAcc[bucket].artistSum += s.totalToArtist;
        sizeAcc[bucket].artistN++;
      }

      if (s.grossBoxOffice != null && s.totalToArtist != null) {
        const exp = expensesByShowIdAll.get(d.showId) ?? 0;
        const net = s.grossBoxOffice - s.totalToArtist - exp;
        sizeAcc[bucket].profitN++;
        if (net < 0) sizeAcc[bucket].losingMoney++;
        cc.profitN++;
        if (net < 0) cc.losingMoney++;

        if (net < 0) {
          profitabilityAcc.unprofitable.count++;
          if (disputed) profitabilityAcc.unprofitable.disputed++;
        } else {
          profitabilityAcc.profitable.count++;
          if (disputed) profitabilityAcc.profitable.disputed++;
        }
      }
    }
  }

  // Dispute breakdown — per (dealType × bucket) cell:
  //   - disputed: count of past settlements where the settlement was disputed
  //     OR had any disputed/withdrawn recoup line. (Withdrawn recoups are
  //     by definition former disputes that were retracted, so they belong in
  //     the lifecycle even though the seed dataset doesn't currently contain
  //     any.)
  //   - totalDisputedPayout: sum of totalToArtist across ALL disputed deals
  //     in the cell — i.e. how much money actually moved on the disputed
  //     shows in aggregate.
  //   - avgDisputedPayout: mean totalToArtist across the subset of disputed
  //     deals whose settlement actually closed with a payment (status
  //     signed | finalized | paid). Still-open disputes are excluded so
  //     the average reflects what was paid out, not what was claimed.
  //   - paidDisputedCount: # of disputed deals contributing to the avg
  //     (settlements that ended in a paid status). Surfaces the sample
  //     size behind the average for the tooltip.
  //   - disputedAmount: total dollar value of disputed recoup lines in the
  //     cell — the actual money under contention.
  //   - topTopics: top 3 recoup categories that appeared on a disputed or
  //     withdrawn line, ranked by occurrence count.
  const PAID_STATUSES = new Set(["signed", "finalized", "paid"]);
  type DisputeCell = {
    disputed: number;
    totalPayoutSum: number;
    paidPayoutSum: number;
    paidPayoutN: number;
    disputedAmount: number;
    topicCounts: Record<string, number>;
  };
  const disputeAcc: Map<string, Map<string, DisputeCell>> = new Map();
  function disputeCell(dealType: string, bucket: string): DisputeCell {
    let row = disputeAcc.get(dealType);
    if (!row) { row = new Map(); disputeAcc.set(dealType, row); }
    let cell = row.get(bucket);
    if (!cell) {
      cell = {
        disputed: 0,
        totalPayoutSum: 0,
        paidPayoutSum: 0,
        paidPayoutN: 0,
        disputedAmount: 0,
        topicCounts: {},
      };
      row.set(bucket, cell);
    }
    return cell;
  }
  for (const d of pastDeals) {
    const s = settlementByShowId.get(d.showId);
    if (!s) continue;
    const recoups = parseRecoups(s.recoupsJson);
    const hasDisputedRecoup = recoups.some((r) => r?.status === "disputed");
    const hasWithdrawnRecoup = recoups.some((r) => r?.status === "withdrawn");
    const isDisputed = s.status === "disputed" || hasDisputedRecoup || hasWithdrawnRecoup;
    if (!isDisputed) continue;
    const bucket = classifyAnalyticsSizeBucket(d);
    const cell = disputeCell(d.dealType, bucket);
    cell.disputed++;
    if (s.totalToArtist != null) {
      cell.totalPayoutSum += s.totalToArtist;
      if (PAID_STATUSES.has(s.status ?? "")) {
        cell.paidPayoutSum += s.totalToArtist;
        cell.paidPayoutN++;
      }
    }
    for (const r of recoups) {
      if (r?.status === "disputed" || r?.status === "withdrawn") {
        cell.topicCounts[r.category] = (cell.topicCounts[r.category] ?? 0) + 1;
        cell.disputedAmount += r.amount ?? 0;
      }
    }
  }

  const disputeBreakdown = {
    dealTypes: Array.from(dealTypesSeen).sort(),
    buckets: SIZE_ORDER,
    cells: [] as Array<{
      dealType: string; bucket: string;
      disputed: number;
      totalDisputedPayout: number;
      avgDisputedPayout: number;
      paidDisputedCount: number;
      disputedAmount: number;
      topTopics: { topic: string; count: number }[];
    }>,
  };
  for (const dealType of disputeBreakdown.dealTypes) {
    for (const bucket of SIZE_ORDER) {
      const c = disputeAcc.get(dealType)?.get(bucket);
      if (!c || c.disputed === 0) continue;
      const topTopics = Object.entries(c.topicCounts)
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
      disputeBreakdown.cells.push({
        dealType, bucket,
        disputed: c.disputed,
        totalDisputedPayout: c.totalPayoutSum,
        avgDisputedPayout: c.paidPayoutN > 0 ? c.paidPayoutSum / c.paidPayoutN : 0,
        paidDisputedCount: c.paidPayoutN,
        disputedAmount: c.disputedAmount,
        topTopics,
      });
    }
  }

  const crossTabBySizeAndType = {
    dealTypes: Array.from(dealTypesSeen).sort(),
    buckets: SIZE_ORDER,
    attentionKinds: ATTENTION_KINDS,
    cells: [] as Array<{
      dealType: string; bucket: string; count: number; settledN: number;
      profitN: number; losingMoneyCount: number; disputed: number;
      losingMoneyRate: number; disputeRate: number;
      attentionCount: number; attentionRate: number;
      attentionByKind: Record<AttentionKind, number>;
    }>,
  };
  for (const dealType of crossTabBySizeAndType.dealTypes) {
    for (const bucket of SIZE_ORDER) {
      const c = crossAcc.get(dealType)?.get(bucket);
      if (!c || c.count === 0) continue;
      crossTabBySizeAndType.cells.push({
        dealType, bucket,
        count: c.count, settledN: c.settledN,
        profitN: c.profitN, losingMoneyCount: c.losingMoney, disputed: c.disputed,
        losingMoneyRate: c.profitN > 0 ? c.losingMoney / c.profitN : 0,
        disputeRate: c.settledN > 0 ? c.disputed / c.settledN : 0,
        attentionCount: c.attentionCount,
        attentionRate: c.count > 0 ? c.attentionCount / c.count : 0,
        attentionByKind: c.attentionByKind,
      });
    }
  }

  const byComplexity = (Object.keys(complexityAcc) as ComplexityBucket[]).map((k) => {
    const a = complexityAcc[k];
    return {
      bucket: k,
      count: a.count,
      pct: totalDeals > 0 ? a.count / totalDeals : 0,
      avgPayout: a.payoutN > 0 ? a.payoutSum / a.payoutN : 0,
      inToolCount: a.inTool,
      spreadsheetCount: a.spreadsheet,
    };
  });

  const bySize = SIZE_ORDER.map((bucket) => {
    const a = sizeAcc[bucket];
    return {
      bucket,
      count: a.count,
      pct: totalDeals > 0 ? a.count / totalDeals : 0,
      avgGross: a.grossN > 0 ? a.grossSum / a.grossN : 0,
      avgToArtist: a.artistN > 0 ? a.artistSum / a.artistN : 0,
      disputeRate: a.settledN > 0 ? a.disputed / a.settledN : 0,
      losingMoneyCount: a.losingMoney,
      profitN: a.profitN,
    };
  });

  const byProfitability = {
    profitable: {
      count: profitabilityAcc.profitable.count,
      disputed: profitabilityAcc.profitable.disputed,
      disputeRate: profitabilityAcc.profitable.count > 0
        ? profitabilityAcc.profitable.disputed / profitabilityAcc.profitable.count : 0,
    },
    unprofitable: {
      count: profitabilityAcc.unprofitable.count,
      disputed: profitabilityAcc.unprofitable.disputed,
      disputeRate: profitabilityAcc.unprofitable.count > 0
        ? profitabilityAcc.unprofitable.disputed / profitabilityAcc.unprofitable.count : 0,
    },
  };

  // Costs
  const expensesByCategory: Record<string, number> = {};
  let totalExpenses = 0;
  for (const e of pastExpenses) {
    expensesByCategory[e.category] = (expensesByCategory[e.category] ?? 0) + e.amount;
    totalExpenses += e.amount;
  }

  const recoupsByCategory: Record<string, { amount: number; disputedAmount: number }> = {};
  let totalRecoups = 0;
  let disputedRecoupValue = 0;
  for (const s of pastSettlements) {
    for (const r of parseRecoups(s.recoupsJson)) {
      const slot = recoupsByCategory[r.category] ?? { amount: 0, disputedAmount: 0 };
      slot.amount += r.amount;
      if (r.status === "disputed") slot.disputedAmount += r.amount;
      recoupsByCategory[r.category] = slot;
      totalRecoups += r.amount;
      if (r.status === "disputed") disputedRecoupValue += r.amount;
    }
  }

  // Revenue by deal type
  const dealTypeByShowId = new Map(pastDeals.map((d) => [d.showId, d.dealType]));
  const expensesByShowId: Map<string, number> = new Map();
  for (const e of pastExpenses) {
    expensesByShowId.set(e.showId, (expensesByShowId.get(e.showId) ?? 0) + e.amount);
  }

  type RevAcc = { gross: number; netToVenue: number; toArtist: number; count: number };
  const byDealType: Record<string, RevAcc> = {};
  const monthAcc: Map<string, { gross: number; netToVenue: number; toArtist: number; byType: Record<string, number> }> = new Map();

  // last 24 months window
  const now = new Date();
  const horizon = new Date(now.getFullYear(), now.getMonth() - 23, 1);

  for (const s of pastSettlements) {
    const dealType = dealTypeByShowId.get(s.showId);
    if (!dealType) continue;
    const date = showDateById.get(s.showId);
    if (!date) continue;
    const showDate = new Date(date);
    if (showDate < horizon) continue;

    const gross = s.grossBoxOffice ?? 0;
    const toArtist = s.totalToArtist ?? 0;
    const exp = expensesByShowId.get(s.showId) ?? 0;
    const netToVenue = gross - toArtist - exp;

    if (!byDealType[dealType]) byDealType[dealType] = { gross: 0, netToVenue: 0, toArtist: 0, count: 0 };
    const dt = byDealType[dealType];
    dt.gross += gross;
    dt.netToVenue += netToVenue;
    dt.toArtist += toArtist;
    dt.count++;

    const monthKey = `${showDate.getFullYear()}-${String(showDate.getMonth() + 1).padStart(2, "0")}`;
    if (!monthAcc.has(monthKey)) {
      monthAcc.set(monthKey, { gross: 0, netToVenue: 0, toArtist: 0, byType: {} });
    }
    const m = monthAcc.get(monthKey)!;
    m.gross += gross;
    m.netToVenue += netToVenue;
    m.toArtist += toArtist;
    m.byType[dealType] = (m.byType[dealType] ?? 0) + gross;
  }

  // build full month list (last 24)
  const months: { month: string; label: string; gross: number; netToVenue: number; toArtist: number; byType: Record<string, number> }[] = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    const m = monthAcc.get(key) ?? { gross: 0, netToVenue: 0, toArtist: 0, byType: {} };
    months.push({ month: key, label, ...m });
  }

  return {
    totalDeals,
    byComplexity,
    bySize,
    byProfitability,
    costs: {
      totalExpenses,
      expensesByCategory,
      totalRecoups,
      disputedRecoupValue,
      recoupsByCategory,
    },
    revenue: {
      byDealType,
      months,
      crossTabBySizeAndType,
    },
    disputeBreakdown,
  };
}

const CLOSED_STATUSES = new Set(["signed", "finalized", "paid"]);
const CLOSED_KEYWORDS = /\b(closed out|settled up|fully settled|signed off|signed and paid|paid in full|paid out|finalized|finalised|wrapped up|squared away|all squared|case closed)\b/i;

export type AttentionKind =
  | "notes_say_closed_but_status_open"
  | "show_settled_no_settlement"
  | "disputed_recoups_but_signed"
  | "stale_disputed";

export type AttentionItem = {
  kind: AttentionKind;
  showId: string;
  artistName: string | null;
  date: string;
  status: string;
  settlementStatus: string | null;
  detail: string;
  evidence?: string;
};

export async function getNeedsAttention(): Promise<AttentionItem[]> {
  const today = todayDateString();
  const allShowsRows = await db
    .select({ show: shows, artist: artists, settlement: settlements })
    .from(shows)
    .leftJoin(artists, eq(shows.artistId, artists.id))
    .leftJoin(settlements, eq(settlements.showId, shows.id))
    .where(lte(shows.date, todayDateString()))
    .orderBy(desc(shows.date));

  const items: AttentionItem[] = [];
  const todayMs = new Date(today + "T00:00:00").getTime();
  const STALE_DAYS = 30;

  for (const r of allShowsRows) {
    const { show, artist, settlement } = r;
    const artistName = artist?.name ?? null;

    if ((show.status === "settled" || show.status === "closed") && !settlement) {
      items.push({
        kind: "show_settled_no_settlement",
        showId: show.id,
        artistName,
        date: show.date,
        status: show.status,
        settlementStatus: null,
        detail: `Show is marked ${show.status} but has no settlement row.`,
      });
      continue;
    }

    if (!settlement) continue;

    const sStatus = settlement.status;

    if (!CLOSED_STATUSES.has(sStatus)) {
      const noteText = [settlement.notes, settlement.signoffText]
        .filter((t): t is string => !!t)
        .join("\n");
      const match = noteText.match(CLOSED_KEYWORDS);
      if (match) {
        items.push({
          kind: "notes_say_closed_but_status_open",
          showId: show.id,
          artistName,
          date: show.date,
          status: show.status,
          settlementStatus: sStatus,
          detail: `Settlement notes mention "${match[0]}" but status is still ${sStatus}.`,
          evidence: noteText.length > 240 ? noteText.slice(0, 240) + "…" : noteText,
        });
      }
    }

    if (CLOSED_STATUSES.has(sStatus)) {
      const recoupsList = parseRecoups(settlement.recoupsJson);
      const disputed = recoupsList.filter((rc) => rc?.status === "disputed");
      if (disputed.length > 0) {
        items.push({
          kind: "disputed_recoups_but_signed",
          showId: show.id,
          artistName,
          date: show.date,
          status: show.status,
          settlementStatus: sStatus,
          detail: `${disputed.length} disputed recoup line${disputed.length === 1 ? "" : "s"} on a ${sStatus} settlement.`,
          evidence: disputed.map((d) => `${d.label} ($${d.amount})`).join(", "),
        });
      }
    }

    if (sStatus === "disputed" && settlement.disputedAt) {
      const ageMs = todayMs - settlement.disputedAt.getTime();
      const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
      if (ageDays >= STALE_DAYS) {
        items.push({
          kind: "stale_disputed",
          showId: show.id,
          artistName,
          date: show.date,
          status: show.status,
          settlementStatus: sStatus,
          detail: `Disputed for ${ageDays} days with no resolution.`,
        });
      }
    }
  }

  return items;
}

export async function getReports() {
  const today = todayDateString();
  const allShowsRows = await db.select().from(shows);
  const pastShowIds = new Set(
    allShowsRows.filter((s) => s.date <= today).map((s) => s.id),
  );
  const allDealsRows = await db.select().from(deals);
  const pastDeals = allDealsRows.filter((d) => pastShowIds.has(d.showId));
  const allSettlementsRows = await db.select().from(settlements);
  const pastSettlements = allSettlementsRows.filter((s) =>
    pastShowIds.has(s.showId),
  );
  const allCompsRows = await db.select().from(comps);
  const pastComps = allCompsRows.filter((c) => pastShowIds.has(c.showId));

  const dealTypeCounts: Record<string, number> = {};
  for (const d of pastDeals) {
    dealTypeCounts[d.dealType] = (dealTypeCounts[d.dealType] ?? 0) + 1;
  }

  const totalDeals = pastDeals.length;
  const supportedTypes = ["flat", "percentage_of_gross"];
  const supportedCount = pastDeals.filter((d) =>
    supportedTypes.includes(d.dealType),
  ).length;
  const inAppToolUsageRate = totalDeals > 0 ? supportedCount / totalDeals : 0;

  const settlementStatus: Record<string, number> = {};
  for (const s of pastSettlements) {
    settlementStatus[s.status] = (settlementStatus[s.status] ?? 0) + 1;
  }

  const totalSettlements = pastSettlements.length;
  const disputedRate = totalSettlements > 0
    ? (settlementStatus.disputed ?? 0) / totalSettlements : 0;

  const totalGross = pastSettlements.reduce(
    (sum, s) => sum + (s.grossBoxOffice ?? 0), 0);
  const totalToArtists = pastSettlements.reduce(
    (sum, s) => sum + (s.totalToArtist ?? 0), 0);

  const showCount = pastShowIds.size;
  const settledCount = allShowsRows.filter(
    (s) => s.date <= today && (s.status === "settled" || s.status === "closed"),
  ).length;
  const dealsWithBonuses = pastDeals.filter((d) => d.bonusesJson).length;

  let totalRecoupValue = 0;
  let disputedRecoupValue = 0;
  let settlementsWithRecoups = 0;
  for (const s of pastSettlements) {
    if (!s.recoupsJson) continue;
    try {
      const recoups = JSON.parse(s.recoupsJson) as Recoup[];
      if (!Array.isArray(recoups) || recoups.length === 0) continue;
      settlementsWithRecoups++;
      for (const r of recoups) {
        totalRecoupValue += r.amount;
        if (r.status === "disputed") disputedRecoupValue += r.amount;
      }
    } catch {}
  }

  const totalCompTickets = pastComps.reduce((s, c) => s + c.count, 0);
  const totalCompFaceValue = pastComps.reduce(
    (s, c) => s + c.count * c.faceValue, 0);
  const compsByCategory: Record<string, number> = {};
  for (const c of pastComps) {
    compsByCategory[c.category] = (compsByCategory[c.category] ?? 0) + c.count;
  }

  return {
    dealTypeCounts, totalDeals, inAppToolUsageRate,
    settlementStatus, totalSettlements, disputedRate,
    totalGross, totalToArtists, showCount, settledCount,
    dealsWithBonuses, totalRecoupValue, disputedRecoupValue,
    settlementsWithRecoups, totalCompTickets, totalCompFaceValue,
    compsByCategory,
  };
}
