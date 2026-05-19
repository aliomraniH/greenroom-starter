import { eq } from "drizzle-orm";
import { db, migrationsReady } from "../db";
import { settlements, deals, shows } from "../db/schema";
import {
  parseRecoups,
  getNeedsAttention,
  classifyAnalyticsSizeBucket as classifySizeBucket,
  type AttentionKind,
} from "./queries";
import { logger } from "./logger";
import { llmGenerateJson, llmIsConfigured } from "./llm";

const SIZE_ORDER = ["$0–1K", "$1–5K", "$5–15K", "$15K+", "Uncapped %"];

const KIND_PRIORITY: AttentionKind[] = [
  "stale_disputed",
  "disputed_recoups_but_signed",
  "show_settled_no_settlement",
  "notes_say_closed_but_status_open",
];

type EnrichOutcome = {
  totalCandidates: number;
  enriched: number;
  skippedExisting: number;
  failed: number;
};

function buildSummaryPrompt(payload: unknown): string {
  return `You are an analyst summarizing one live-music settlement. Read the structured data and freetext notes, then return STRICT JSON (no markdown fences) matching:

{
  "positive": string,   // 1-2 sentence recap of what went well for the venue (clean settlement, met guarantee, strong sell-through, smooth recoups). Use "" if nothing positive stands out.
  "negative": string    // 1-2 sentence recap of what went wrong or caused friction (disputes, missing data, undocumented side-deals, expense overruns, recoup pushback, late payment, contract ambiguity). Use "" if nothing negative stands out.
}

Be concrete. Reference specific dollar amounts, recoup categories, or behaviours when present. If the show was clean and uneventful, "positive" can describe that and "negative" can be "".

DATA:
${JSON.stringify(payload, null, 2)}
`;
}

async function summarizeOne(payload: unknown): Promise<{ positive: string; negative: string } | null> {
  const parsed = await llmGenerateJson<{ positive?: string; negative?: string }>({
    prompt: buildSummaryPrompt(payload),
  });
  return {
    positive: typeof parsed.positive === "string" ? parsed.positive : "",
    negative: typeof parsed.negative === "string" ? parsed.negative : "",
  };
}

export async function enrichSettlements(opts: { force?: boolean } = {}): Promise<EnrichOutcome> {
  await migrationsReady;
  const out: EnrichOutcome = { totalCandidates: 0, enriched: 0, skippedExisting: 0, failed: 0 };
  if (!(await llmIsConfigured())) return out;

  const allSettlements = await db.select().from(settlements);
  const allDeals = await db.select().from(deals);
  const allShows = await db.select().from(shows);
  const dealByShowId = new Map(allDeals.map((d) => [d.showId, d]));
  const showById = new Map(allShows.map((s) => [s.id, s]));

  const candidates = allSettlements.filter((s) => {
    const recoups = parseRecoups(s.recoupsJson);
    const hasNotes = !!(s.notes && s.notes.trim()) || !!(s.signoffText && s.signoffText.trim());
    const hasDisputed = recoups.some((r) => r?.status === "disputed");
    return hasNotes || hasDisputed || s.status === "disputed";
  });
  out.totalCandidates = candidates.length;

  const todo = candidates.filter((s) => {
    if (!opts.force && (s.positiveSummary != null || s.negativeSummary != null)) {
      out.skippedExisting++;
      return false;
    }
    return true;
  });

  const CONCURRENCY = 8;
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= todo.length) return;
      const s = todo[i];
      const deal = dealByShowId.get(s.showId);
      const show = showById.get(s.showId);
      const recoups = parseRecoups(s.recoupsJson);
      const payload = {
        show: show ? { id: show.id, date: show.date, status: show.status, internalNotes: show.internalNotes } : null,
        deal: deal
          ? {
              dealType: deal.dealType,
              guaranteeAmount: deal.guaranteeAmount,
              percentage: deal.percentage,
              percentageBasis: deal.percentageBasis,
              expenseCap: deal.expenseCap,
              hospitalityCap: deal.hospitalityCap,
              dealNotesFreetext: deal.dealNotesFreetext,
            }
          : null,
        settlement: {
          status: s.status,
          grossBoxOffice: s.grossBoxOffice,
          totalToArtist: s.totalToArtist,
          totalExpenses: s.totalExpenses,
          notes: s.notes,
          signoffText: s.signoffText,
        },
        recoups,
      };
      try {
        const result = await summarizeOne(payload);
        if (!result) { out.failed++; continue; }
        await db
          .update(settlements)
          .set({ positiveSummary: result.positive, negativeSummary: result.negative })
          .where(eq(settlements.id, s.id));
        // Settlement-row write path: invalidate calibration cache so the
        // next calibration read reflects the new positive/negative summary
        // and any downstream baseline shifts.
        try {
          const calib = await import("./calibration");
          calib.clearCalibrationCache();
        } catch { /* noop */ }
        out.enriched++;
      } catch (err) {
        out.failed++;
        logger.warn({ err: err instanceof Error ? err.message : String(err), showId: s.showId }, "enrich settlement failed");
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return out;
}

export type ComplaintBubble = { theme: string; count: number };

export type InsightsCell = {
  dealType: string;
  bucket: string;
  count: number;
  attentionCount: number;
  topKind: AttentionKind | null;
  topKindCount: number;
  byKind: Record<AttentionKind, number>;
  bubbles: ComplaintBubble[];
  sampleSize: number;
  llmError: string | null;
};

export type InsightsPayload = {
  generatedAt: string;
  enrichmentCoverage: { withSummary: number; total: number };
  dealTypes: string[];
  buckets: string[];
  cells: InsightsCell[];
};

async function clusterComplaints(
  cellLabel: string,
  kind: AttentionKind,
  summaries: string[],
): Promise<{ bubbles: ComplaintBubble[]; error: string | null }> {
  if (summaries.length === 0) return { bubbles: [], error: null };
  if (!(await llmIsConfigured())) return { bubbles: [], error: "llm_not_configured" };
  const prompt = `You are clustering complaint themes from settlement summaries.

Context: these are ${summaries.length} negative-experience summaries from past deals in cell "${cellLabel}" that were flagged "${kind}".

Group similar complaints into AT MOST 5 themes. Return STRICT JSON (no markdown fences):

{ "bubbles": [ { "theme": string, "count": number } ] }

Each "theme" must be a concise 2-6 word phrase describing one recurring kind of friction (e.g. "undocumented production overage", "stale recoup never resolved", "manager renegotiated after settlement"). "count" = how many of the input summaries fall into that theme. Themes ordered by count desc.

INPUT SUMMARIES:
${summaries.map((s, i) => `[${i + 1}] ${s}`).join("\n")}
`;
  try {
    const parsed = await llmGenerateJson<{ bubbles?: ComplaintBubble[] }>({ prompt });
    const bubbles = (parsed.bubbles ?? [])
      .filter((b): b is ComplaintBubble => !!b && typeof b.theme === "string" && typeof b.count === "number")
      .slice(0, 5);
    return { bubbles, error: null };
  } catch (err) {
    return { bubbles: [], error: err instanceof Error ? err.message : String(err) };
  }
}

let cached: InsightsPayload | null = null;
let pending: Promise<InsightsPayload> | null = null;

export async function getInsights(opts: { force?: boolean } = {}): Promise<InsightsPayload> {
  if (!opts.force && cached) return cached;
  if (pending) return pending;
  const run = (async () => {
    await migrationsReady;
    const allSettlements = await db.select().from(settlements);
    const allDeals = await db.select().from(deals);
    const allShows = await db.select().from(shows);
    const summaryByShowId = new Map<string, string>();
    let withSummary = 0;
    for (const s of allSettlements) {
      if (s.negativeSummary && s.negativeSummary.trim()) {
        summaryByShowId.set(s.showId, s.negativeSummary.trim());
        withSummary++;
      }
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const pastShowIds = new Set(allShows.filter((s) => s.date <= todayStr).map((s) => s.id));
    const pastDeals = allDeals.filter((d) => pastShowIds.has(d.showId));

    const attention = await getNeedsAttention();
    const attentionByShowId = new Map<string, AttentionKind[]>();
    for (const a of attention) {
      const list = attentionByShowId.get(a.showId) ?? [];
      list.push(a.kind);
      attentionByShowId.set(a.showId, list);
    }

    type Acc = {
      count: number;
      attentionShowIds: string[];
      byKind: Record<AttentionKind, number>;
      kindToShowIds: Record<AttentionKind, string[]>;
    };
    const emptyByKind = (): Record<AttentionKind, number> => ({
      notes_say_closed_but_status_open: 0,
      show_settled_no_settlement: 0,
      disputed_recoups_but_signed: 0,
      stale_disputed: 0,
      expense_overrun: 0,
    });
    const emptyKindToIds = (): Record<AttentionKind, string[]> => ({
      notes_say_closed_but_status_open: [],
      show_settled_no_settlement: [],
      disputed_recoups_but_signed: [],
      stale_disputed: [],
      expense_overrun: [],
    });
    const grid = new Map<string, Acc>();
    const dealTypesSeen = new Set<string>();
    const key = (dt: string, b: string) => `${dt}|${b}`;

    for (const d of pastDeals) {
      const bucket = classifySizeBucket(d);
      dealTypesSeen.add(d.dealType);
      let acc = grid.get(key(d.dealType, bucket));
      if (!acc) {
        acc = { count: 0, attentionShowIds: [], byKind: emptyByKind(), kindToShowIds: emptyKindToIds() };
        grid.set(key(d.dealType, bucket), acc);
      }
      acc.count++;
      const kinds = attentionByShowId.get(d.showId);
      if (kinds && kinds.length > 0) {
        acc.attentionShowIds.push(d.showId);
        const seen = new Set<AttentionKind>();
        for (const k of kinds) {
          if (seen.has(k)) continue;
          seen.add(k);
          acc.byKind[k]++;
          acc.kindToShowIds[k].push(d.showId);
        }
      }
    }

    const cells: InsightsCell[] = [];
    for (const dt of Array.from(dealTypesSeen).sort()) {
      for (const b of SIZE_ORDER) {
        const acc = grid.get(key(dt, b));
        if (!acc || acc.count === 0) continue;

        let topKind: AttentionKind | null = null;
        let topKindCount = 0;
        for (const k of KIND_PRIORITY) {
          if (acc.byKind[k] > topKindCount) {
            topKindCount = acc.byKind[k];
            topKind = k;
          }
        }

        let bubbles: ComplaintBubble[] = [];
        let llmError: string | null = null;
        let sampleSize = 0;
        if (topKind && topKindCount > 0) {
          const ids = acc.kindToShowIds[topKind];
          const summaries = ids
            .map((id) => summaryByShowId.get(id))
            .filter((s): s is string => !!s && s.length > 0);
          sampleSize = summaries.length;
          if (summaries.length > 0) {
            const r = await clusterComplaints(`${dt} × ${b}`, topKind, summaries);
            bubbles = r.bubbles;
            llmError = r.error;
          }
        }

        cells.push({
          dealType: dt,
          bucket: b,
          count: acc.count,
          attentionCount: acc.attentionShowIds.length,
          topKind,
          topKindCount,
          byKind: acc.byKind,
          bubbles,
          sampleSize,
          llmError,
        });
      }
    }

    const payload: InsightsPayload = {
      generatedAt: new Date().toISOString(),
      enrichmentCoverage: { withSummary, total: allSettlements.length },
      dealTypes: Array.from(dealTypesSeen).sort(),
      buckets: SIZE_ORDER,
      cells,
    };
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

export function clearInsightsCache() {
  cached = null;
}
