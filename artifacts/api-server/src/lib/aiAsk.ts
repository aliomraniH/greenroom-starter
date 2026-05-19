import { eq } from "drizzle-orm";
import { db, migrationsReady } from "../db";
import { shows, deals, settlements, expenses, artists, agents } from "../db/schema";
import { llmGenerateText, llmIsConfigured } from "./llm";
import { getCalibration, getShowMeter, getAccountHealth } from "./calibration";
import { getArtistProfile } from "./queries";

export type AskScope = "account" | "show" | "artist";

export type AskInput = {
  scope: AskScope;
  id?: string;
  question: string;
};

export type AskResult = {
  answer: string;
  scope: AskScope;
  id?: string;
  model?: string;
  warning?: string;
};

const SYSTEM_PRIMER = `You are an expense-intelligence assistant for a single live-music venue (The Crescent · Nashville · 650 cap).
You analyze settlement data, deal terms, and live show expenses to give the booker concrete, source-cited answers.

Rules:
- Be concise. Lead with a one-sentence answer, then a short justification (2-4 bullets max).
- Cite which calibration baseline you used. When a baseline is from "audit_default" (n below 16), explicitly say it is the industry default, not venue-computed, and lower your confidence accordingly.
- Use dollar amounts; round to nearest $50 for caps.
- If the data does not support a confident answer, say so plainly.
- Never invent expense lines, deal terms, or settlement numbers that are not in the provided context.`;

async function buildAccountContext(): Promise<unknown> {
  const [calib, health] = await Promise.all([getCalibration(), getAccountHealth()]);
  return { calibration: calib, accountHealth: health };
}

async function buildShowContext(showId: string): Promise<unknown> {
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
  return {
    show: showRow,
    deal: dealRow ?? null,
    settlement: settlementRow ?? null,
    artist: artistRow ?? null,
    agent: agentRow ?? null,
    expenses: exs,
    meter,
    calibrationSummary: {
      maturity: calib.maturity,
      perCategory: calib.perCategory,
      hospitalityWatch: calib.hospitalityWatch,
    },
  };
}

async function buildArtistContext(artistId: string): Promise<unknown> {
  const profile = await getArtistProfile(artistId);
  if (!profile) throw new Error("artist_not_found");
  const calib = await getCalibration();
  return {
    profile,
    calibrationSummary: {
      maturity: calib.maturity,
      perCategory: calib.perCategory,
      genreBaselines: calib.genreBaselines,
      disputeRateBaseline: calib.disputeRateBaseline,
    },
  };
}

export async function answerAsk(input: AskInput): Promise<AskResult> {
  if (!(await llmIsConfigured())) {
    return {
      answer: "",
      scope: input.scope,
      id: input.id,
      warning: "LLM is not configured. Add an API key in Settings to ask questions.",
    };
  }
  let contextPayload: unknown;
  if (input.scope === "account") {
    contextPayload = await buildAccountContext();
  } else if (input.scope === "show") {
    if (!input.id) throw new Error("show_id_required");
    contextPayload = await buildShowContext(input.id);
  } else {
    if (!input.id) throw new Error("artist_id_required");
    contextPayload = await buildArtistContext(input.id);
  }

  const prompt = `${SYSTEM_PRIMER}

CONTEXT (JSON):
${JSON.stringify(contextPayload, null, 2)}

USER QUESTION (scope=${input.scope}${input.id ? `, id=${input.id}` : ""}):
${input.question}

Answer in plain prose. Cite calibration sources inline (e.g. "venue P75 n=42" or "audit default — venue n=4").`;

  const text = await llmGenerateText({ prompt, maxTokens: 1024 });
  return { answer: text.trim(), scope: input.scope, id: input.id };
}
