import { Router, type IRouter } from "express";
import { getAllShows, getShowById, getAllArtists, getArtistProfile, getReports, getDealAnalysis, getNeedsAttention } from "../lib/queries";
import { buildShowExport } from "../lib/showExport";
import { getInsights, enrichSettlements, clearInsightsCache } from "../lib/insights";
import { getCalibration, getShowMeter, getAccountHealth, getArtistExpenseProfile, getExpenseFrictionByCell, clearCalibrationCache } from "../lib/calibration";
import { answerAsk, type AskScope } from "../lib/aiAsk";
import { getLlmStatus, saveLlmSettings, type SaveLlmSettingsInput } from "../lib/llm";
import { generateAndPersist, decideSuggestion } from "../lib/smartSwitch";
import { generateAndPersistGuarantee, backfillUpcomingGuarantees } from "../lib/smartGuarantee";
import { getDealImprovements, applyDealImprovements, type ImprovementKind } from "../lib/dealImprovements";
import { db } from "../db";
import { deals, shows } from "../db/schema";
import { eq } from "drizzle-orm";
import { getSwitchSavings, getSwitchProjectedGrid } from "../lib/switchSavings";
import { getGuaranteeBacktest } from "../lib/guaranteeBacktest";
import { getSgpFlatRepricing } from "../lib/sgpFlatRepricing";

const router: IRouter = Router();

router.get("/shows/:id/export", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const data = await buildShowExport(raw);
    if (!data) {
      res.status(404).json({ error: "Show not found" });
      return;
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "export_failed" });
  }
});

router.get("/shows", async (_req, res): Promise<void> => {
  const rows = await getAllShows();
  res.json(rows);
});

router.get("/shows/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const data = await getShowById(raw);
  if (!data) {
    res.status(404).json({ error: "Show not found" });
    return;
  }
  res.json(data);
});

router.get("/artists", async (_req, res): Promise<void> => {
  const rows = await getAllArtists();
  res.json(rows);
});

router.get("/artists/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const data = await getArtistProfile(raw);
  if (!data) {
    res.status(404).json({ error: "Artist not found" });
    return;
  }
  res.json(data);
});

router.get("/reports", async (_req, res): Promise<void> => {
  const data = await getReports();
  res.json(data);
});

router.get("/deal-analysis", async (_req, res): Promise<void> => {
  const data = await getDealAnalysis();
  res.json(data);
});

router.get("/needs-attention", async (_req, res): Promise<void> => {
  const data = await getNeedsAttention();
  res.json(data);
});

router.post("/insights/enrich", async (req, res): Promise<void> => {
  try {
    const force = req.query.force === "1" || req.query.force === "true";
    const out = await enrichSettlements({ force });
    clearInsightsCache();
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "enrich_failed" });
  }
});

router.get("/insights/switch-projected-grid", async (req, res): Promise<void> => {
  try {
    const months = Number(req.query.months ?? 6) || 6;
    const data = await getSwitchProjectedGrid({ months });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "projected_grid_failed" });
  }
});

router.get("/insights/guarantee-backtest", async (req, res): Promise<void> => {
  try {
    const months = Number(req.query.months ?? 12) || 12;
    const topN = Number(req.query.topN ?? 10) || 10;
    const data = await getGuaranteeBacktest({ months, topN });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "guarantee_backtest_failed" });
  }
});

router.get("/insights/sgp-flat-repricing", async (req, res): Promise<void> => {
  try {
    const months = Number(req.query.months ?? 12) || 12;
    const topN = Number(req.query.topN ?? 10) || 10;
    const bucket =
      typeof req.query.bucket === "string" ? req.query.bucket : "$1–5K";
    let splitPct = Number(req.query.splitPct ?? 0.85) || 0.85;
    // Normalize: accept both 0.85 and 85 (whole-percent form). Clamp to (0, 1].
    if (splitPct > 1) splitPct = splitPct / 100;
    if (!(splitPct > 0 && splitPct <= 1)) splitPct = 0.85;
    const data = await getSgpFlatRepricing({ months, topN, bucket, splitPct });
    res.json(data);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "sgp_flat_repricing_failed",
    });
  }
});

router.get("/insights/switch-savings", async (req, res): Promise<void> => {
  try {
    const months = Number(req.query.months ?? 3) || 3;
    const topN = Number(req.query.topN ?? 10) || 10;
    const data = await getSwitchSavings({ months, topN });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "savings_failed" });
  }
});

router.get("/insights", async (_req, res): Promise<void> => {
  try {
    const data = await getInsights();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "insights_failed" });
  }
});

router.get("/insights/expense-friction", async (_req, res): Promise<void> => {
  try {
    const data = await getExpenseFrictionByCell();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "expense_friction_failed" });
  }
});

router.post("/guarantee/backfill", async (req, res): Promise<void> => {
  try {
    const forceAll = req.query.force === "1" || req.query.force === "true";
    const result = await backfillUpcomingGuarantees({ forceAll });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "backfill_failed" });
  }
});

router.post("/shows/:id/guarantee/generate", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const out = await generateAndPersistGuarantee(raw);
    if (!out.suggestion) {
      res.status(409).json({ error: out.reason ?? "could_not_generate" });
      return;
    }
    res.json(out.suggestion);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "generate_failed" });
  }
});

router.get("/shows/:id/deal/improvements", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    res.json(await getDealImprovements(raw));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "improvements_failed";
    if (msg === "show_not_found") { res.status(404).json({ error: msg }); return; }
    res.status(500).json({ error: msg });
  }
});

router.post("/shows/:id/deal/apply-improvements", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const body = (req.body ?? {}) as { items?: unknown; kinds?: unknown };
  const isKind = (k: unknown): k is ImprovementKind =>
    k === "add_expense_cap" || k === "add_hospitality_cap";
  let items: { kind: ImprovementKind; value?: number }[] = [];
  if (Array.isArray(body.items)) {
    items = body.items
      .filter((it): it is { kind: unknown; value?: unknown } => !!it && typeof it === "object")
      .filter((it) => isKind(it.kind))
      .map((it) => ({
        kind: it.kind as ImprovementKind,
        value: typeof it.value === "number" ? it.value : undefined,
      }));
  } else if (Array.isArray(body.kinds)) {
    items = body.kinds.filter(isKind).map((kind) => ({ kind }));
  }
  if (items.length === 0) {
    res.status(400).json({ error: "no_kinds_selected" });
    return;
  }
  try {
    const out = await applyDealImprovements(raw, items);
    clearCalibrationCache();
    res.json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "apply_failed";
    if (msg === "no_deal") { res.status(404).json({ error: msg }); return; }
    res.status(500).json({ error: msg });
  }
});

router.post("/shows/:id/deal/apply-guarantee", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const body = (req.body ?? {}) as { guaranteeAmount?: unknown; setDealTypeFlat?: unknown };
  const amt = typeof body.guaranteeAmount === "number" ? body.guaranteeAmount : Number(body.guaranteeAmount);
  if (!Number.isFinite(amt) || amt < 0) {
    res.status(400).json({ error: "invalid_guarantee" });
    return;
  }
  try {
    const [showRow] = await db.select().from(shows).where(eq(shows.id, raw));
    if (!showRow) { res.status(404).json({ error: "show_not_found" }); return; }
    const [dealRow] = await db.select().from(deals).where(eq(deals.showId, raw));
    if (!dealRow) { res.status(404).json({ error: "no_deal" }); return; }
    const update: Partial<typeof deals.$inferInsert> = { guaranteeAmount: amt };
    if (body.setDealTypeFlat === true) {
      update.dealType = "flat";
      update.percentage = null;
      update.percentageBasis = null;
    }
    await db.update(deals).set(update).where(eq(deals.id, dealRow.id));
    clearCalibrationCache();
    res.json({ ok: true, dealId: dealRow.id, guaranteeAmount: amt, dealType: update.dealType ?? dealRow.dealType });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "apply_failed" });
  }
});

router.post("/shows/:id/switch/generate", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const force = req.query.force === "1" || req.query.force === "true";
  try {
    const out = await generateAndPersist(raw, { force });
    if (!out.suggestion) {
      res.status(409).json({ error: out.reason ?? "could_not_generate" });
      return;
    }
    res.json(out.suggestion);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "generate_failed" });
  }
});

router.post("/shows/:id/switch/accept", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const out = await decideSuggestion(raw, "accepted");
    if (!out) { res.status(404).json({ error: "no_suggestion" }); return; }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "accept_failed" });
  }
});

router.post("/shows/:id/switch/decline", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const out = await decideSuggestion(raw, "declined");
    if (!out) { res.status(404).json({ error: "no_suggestion" }); return; }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "decline_failed" });
  }
});

router.get("/settings/llm", async (_req, res): Promise<void> => {
  try {
    res.json(await getLlmStatus());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "llm_status_failed" });
  }
});

router.post("/settings/llm", async (req, res): Promise<void> => {
  try {
    const body = (req.body ?? {}) as SaveLlmSettingsInput;
    await saveLlmSettings(body);
    clearInsightsCache();
    clearCalibrationCache();
    res.json(await getLlmStatus());
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "llm_save_failed" });
  }
});

router.get("/calibration", async (req, res): Promise<void> => {
  try {
    const force = req.query.force === "1" || req.query.force === "true";
    const data = await getCalibration({ force });
    const health = await getAccountHealth();
    res.json({ ...data, accountHealth: health });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "calibration_failed" });
  }
});

router.get("/shows/:id/meter", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const data = await getShowMeter(raw);
    if (!data) {
      res.status(404).json({ error: "show_not_found" });
      return;
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "meter_failed" });
  }
});

router.get("/artists/:id/expense-profile", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const data = await getArtistExpenseProfile(raw);
    if (!data) {
      res.status(404).json({ error: "artist_not_found" });
      return;
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "profile_failed" });
  }
});

router.post("/ai/ask", async (req, res): Promise<void> => {
  try {
    const body = (req.body ?? {}) as { scope?: unknown; id?: unknown; question?: unknown };
    const scope = body.scope;
    if (scope !== "account" && scope !== "show" && scope !== "artist") {
      res.status(400).json({ error: "invalid_scope" });
      return;
    }
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      res.status(400).json({ error: "empty_question" });
      return;
    }
    const id = typeof body.id === "string" ? body.id : undefined;
    if ((scope === "show" || scope === "artist") && !id) {
      res.status(400).json({ error: "id_required" });
      return;
    }
    const out = await answerAsk({ scope: scope as AskScope, id, question });
    res.json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ask_failed";
    if (msg === "show_not_found" || msg === "artist_not_found") {
      res.status(404).json({ error: msg });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

export default router;
