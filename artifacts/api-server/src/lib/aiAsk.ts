import { eq } from "drizzle-orm";
import { db, migrationsReady } from "../db";
import { shows, deals, settlements, expenses, artists, agents } from "../db/schema";
import { llmGenerateText, llmIsConfigured } from "./llm";
import {
  getCalibration,
  getShowMeter,
  getAccountHealth,
  getArtistExpenseProfile,
  type Confidence,
} from "./calibration";
import { getArtistProfile, getNeedsAttention } from "./queries";

export type AskScope = "account" | "show" | "artist";

export type AskInput = {
  scope: AskScope;
  id?: string;
  question: string;
};

export type AskResult = {
  answer: string;
  contextSummary: string;
  confidence: Confidence;
  scope: AskScope;
  id?: string;
  model?: string;
  warning?: string;
};

// Calibration-aware system primer. Encodes the response rules called out in
// the v2 spec: qualify low-confidence caps, note when venue maturity is below
// stage 3, and flag SGP accuracy drift above 15% before recommending a price.
const SYSTEM_PRIMER = `You are an expense-intelligence assistant for a single live-music venue (The Crescent · Nashville · 650 cap).
You analyze settlement data, deal terms, and live show expenses to give the booker concrete, source-cited answers.

Calibration-aware response rules:
- Lead with a one-sentence answer, then 2–4 short justification bullets.
- Cite every threshold with its calibration source: "venue P75 (n=42)" or
  "audit default — venue n=4". Never assert a cap as absolute without a source.
- If the venue maturity stage is below 3 (settled n < 51), append a one-line
  caveat: "Venue is still calibrating — treat figures as provisional."
- If a baseline you cite has source = "audit_default" or confidence = "none"
  or "low", explicitly say so and lower your confidence accordingly.
- If SGP accuracy drift for the relevant cell exceeds 15%, flag it before
  recommending a price: "SGP cell accuracy drift is X% — recommend a
  manual sanity check on this deal."
- Round dollar caps to nearest $50; round percentages to whole numbers.
- If the data does not support a confident answer, say so plainly. Never
  invent expense lines, deal terms, or settlement numbers.

Output FORMAT (strict, machine-parseable):
[ANSWER]
<your answer, plain prose>
[CONTEXT_SUMMARY]
<one sentence naming the calibration baselines and n's you cited>
[CONFIDENCE]
<one of: high | med | low | none>
`;

async function buildAccountContext(): Promise<{
  payload: unknown;
  summary: string;
}> {
  const [calib, health, attention] = await Promise.all([
    getCalibration(),
    getAccountHealth(),
    getNeedsAttention(),
  ]);
  await migrationsReady;
  const today = new Date().toISOString().slice(0, 10);
  const allShowsRows = await db.select().from(shows);
  const last30Cutoff = new Date();
  last30Cutoff.setDate(last30Cutoff.getDate() - 30);
  const last30Iso = last30Cutoff.toISOString().slice(0, 10);
  const last30Shows = allShowsRows
    .filter((s) => s.date <= today && s.date >= last30Iso)
    .map((s) => ({ id: s.id, date: s.date, artistId: s.artistId }));
  const settlementsRows = await db.select().from(settlements);
  const openSettlements = settlementsRows
    .filter((s) => ["draft", "submitted", "in_review", "disputed", "revised"].includes(s.status))
    .map((s) => ({ showId: s.showId, status: s.status }));
  const payload = {
    calibration: calib,
    accountHealth: health,
    last30DaysShows: last30Shows,
    openSettlements,
    needsAttention: attention.slice(0, 12),
  };
  const summary = `account-wide · maturity stage ${calib.maturity.stage} (n=${calib.maturity.settledN}) · ${last30Shows.length} shows in last 30d · ${openSettlements.length} open settlements · ${attention.length} attention items`;
  return { payload, summary };
}

async function buildShowContext(showId: string): Promise<{
  payload: unknown;
  summary: string;
}> {
  await migrationsReady;
  const [showRow] = await db.select().from(shows).where(eq(shows.id, showId));
  if (!showRow) throw new Error("show_not_found");
  const [dealRow] = await db.select().from(deals).where(eq(deals.showId, showId));
  const [settlementRow] = await db.select().from(settlements).where(eq(settlements.showId, showId));
  const exs = await db.select().from(expenses).where(eq(expenses.showId, showId));
  const artistRow = showRow.artistId
    ? (await db.select().from(artists).where(eq(artists.id, showRow.artistId)))[0]
    : null;
  const agentRow = artistRow?.agentId
    ? (await db.select().from(agents).where(eq(agents.id, artistRow.agentId)))[0]
    : null;
  const meter = await getShowMeter(showId);
  const calib = await getCalibration();
  const cellBaseline = meter?.dealType
    ? calib.cellBaselines.find(
        (c) => c.dealType === meter.dealType && c.bucket === meter.bucket,
      ) ?? null
    : null;
  const payload = {
    show: showRow,
    deal: dealRow ?? null,
    settlement: settlementRow ?? null,
    artist: artistRow ?? null,
    agent: agentRow ? { id: agentRow.id, name: agentRow.name } : null,
    expenses: exs,
    meter,
    cellBaseline,
    calibrationSummary: {
      maturity: calib.maturity,
      perCategory: calib.perCategory,
      hospitalityWatch: calib.hospitalityWatch,
      feeRateRolling12mo: calib.feeRateRolling12mo,
    },
  };
  const summary = `show ${showId} · ${meter?.bucket ?? "?"} · meter ${meter ? Math.round(meter.totalPctOfCap * 100) + "%" : "?"} of cap · cell baseline ${cellBaseline ? `n=${cellBaseline.n}` : "none"} · maturity stage ${calib.maturity.stage}`;
  return { payload, summary };
}

async function buildArtistContext(artistId: string): Promise<{
  payload: unknown;
  summary: string;
}> {
  const profile = await getArtistProfile(artistId);
  if (!profile) throw new Error("artist_not_found");
  const calib = await getCalibration();
  const expenseProfile = await getArtistExpenseProfile(artistId);
  const payload = {
    profile,
    expenseProfile,
    calibrationSummary: {
      maturity: calib.maturity,
      perCategory: calib.perCategory,
      genreBaselines: calib.genreBaselines,
      disputeRateBaseline: calib.disputeRateBaseline,
      hospitalityWatch: calib.hospitalityWatch,
    },
  };
  const summary = `artist ${artistId} · ${expenseProfile?.settledShows ?? 0} settled shows · expense source ${expenseProfile?.source ?? "none"} (n=${expenseProfile?.settledShows ?? 0}) · maturity stage ${calib.maturity.stage}`;
  return { payload, summary };
}

function parseAnswer(text: string, fallbackSummary: string): {
  answer: string;
  contextSummary: string;
  confidence: Confidence;
} {
  const answerMatch = text.match(/\[ANSWER\]([\s\S]*?)(?:\[CONTEXT_SUMMARY\]|\[CONFIDENCE\]|$)/);
  const ctxMatch = text.match(/\[CONTEXT_SUMMARY\]([\s\S]*?)(?:\[CONFIDENCE\]|$)/);
  const confMatch = text.match(/\[CONFIDENCE\]\s*([a-z]+)/i);
  const answer = (answerMatch?.[1] ?? text).trim();
  const ctx = (ctxMatch?.[1] ?? fallbackSummary).trim();
  const confRaw = (confMatch?.[1] ?? "").toLowerCase().trim();
  const confidence: Confidence =
    confRaw === "high" || confRaw === "med" || confRaw === "low" || confRaw === "none"
      ? (confRaw as Confidence)
      : "low";
  return { answer, contextSummary: ctx, confidence };
}

export async function answerAsk(input: AskInput): Promise<AskResult> {
  if (!(await llmIsConfigured())) {
    return {
      answer: "",
      contextSummary: "LLM not configured.",
      confidence: "none",
      scope: input.scope,
      id: input.id,
      warning: "LLM is not configured. Add an API key in Settings to ask questions.",
    };
  }
  let ctx: { payload: unknown; summary: string };
  if (input.scope === "account") {
    ctx = await buildAccountContext();
  } else if (input.scope === "show") {
    if (!input.id) throw new Error("show_id_required");
    ctx = await buildShowContext(input.id);
  } else {
    if (!input.id) throw new Error("artist_id_required");
    ctx = await buildArtistContext(input.id);
  }

  const prompt = `${SYSTEM_PRIMER}

CONTEXT (JSON):
${JSON.stringify(ctx.payload, null, 2)}

USER QUESTION (scope=${input.scope}${input.id ? `, id=${input.id}` : ""}):
${input.question}

Respond using the strict [ANSWER]/[CONTEXT_SUMMARY]/[CONFIDENCE] format above.`;

  const text = await llmGenerateText({ prompt, maxTokens: 1024 });
  const parsed = parseAnswer(text, ctx.summary);
  return {
    answer: parsed.answer,
    contextSummary: parsed.contextSummary,
    confidence: parsed.confidence,
    scope: input.scope,
    id: input.id,
  };
}
