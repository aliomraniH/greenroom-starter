import type { ShowListRow, ShowDetail, ArtistRow, ArtistProfile, Reports, DealAnalysis, AttentionItem, InsightsPayload, SwitchSavingsPayload, SwitchProjectedGridPayload, LlmStatus, SaveLlmSettingsInput, SwitchSuggestion, GuaranteeSuggestion, GuaranteeBacktestPayload, SgpFlatRepricingPayload, DealImprovementsPayload, ImprovementKind, CalibrationPayload, ShowMeterPayload, AskScope, AskResult, ArtistExpenseProfile, ExpenseFrictionPayload } from "./types";

const BASE = `${import.meta.env.BASE_URL}api`;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (res.status === 404) throw new Error("not_found");
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  shows: () => get<ShowListRow[]>("/shows"),
  show: (id: string) => get<ShowDetail>(`/shows/${encodeURIComponent(id)}`),
  artists: () => get<ArtistRow[]>("/artists"),
  artist: (id: string) => get<ArtistProfile>(`/artists/${encodeURIComponent(id)}`),
  reports: () => get<Reports>("/reports"),
  dealAnalysis: () => get<DealAnalysis>("/deal-analysis"),
  needsAttention: () => get<AttentionItem[]>("/needs-attention"),
  insights: () => get<InsightsPayload>("/insights"),
  switchSavings: (months = 3, topN = 10) =>
    get<SwitchSavingsPayload>(`/insights/switch-savings?months=${months}&topN=${topN}`),
  switchProjectedGrid: (months = 6) => get<SwitchProjectedGridPayload>(`/insights/switch-projected-grid?months=${months}`),
  guaranteeBacktest: (months = 12, topN = 10) => get<GuaranteeBacktestPayload>(`/insights/guarantee-backtest?months=${months}&topN=${topN}`),
  sgpFlatRepricing: (months = 12, topN = 10, bucket = "$1–5K", splitPct = 0.85) =>
    get<SgpFlatRepricingPayload>(
      `/insights/sgp-flat-repricing?months=${months}&topN=${topN}&bucket=${encodeURIComponent(bucket)}&splitPct=${splitPct}`,
    ),
  showExport: (id: string) => get<unknown>(`/shows/${encodeURIComponent(id)}/export`),
  llmSettings: () => get<LlmStatus>("/settings/llm"),
  saveLlmSettings: async (input: SaveLlmSettingsInput): Promise<LlmStatus> => {
    const res = await fetch(`${BASE}/settings/llm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`API error ${res.status}: ${txt}`);
    }
    return res.json() as Promise<LlmStatus>;
  },
  generateSwitch: async (id: string, opts: { force?: boolean } = {}): Promise<SwitchSuggestion> => {
    const qs = opts.force ? "?force=1" : "";
    const res = await fetch(`${BASE}/shows/${encodeURIComponent(id)}/switch/generate${qs}`, { method: "POST" });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `API error ${res.status}`);
    }
    return res.json() as Promise<SwitchSuggestion>;
  },
  acceptSwitch: async (id: string): Promise<SwitchSuggestion> => {
    const res = await fetch(`${BASE}/shows/${encodeURIComponent(id)}/switch/accept`, { method: "POST" });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json() as Promise<SwitchSuggestion>;
  },
  declineSwitch: async (id: string): Promise<SwitchSuggestion> => {
    const res = await fetch(`${BASE}/shows/${encodeURIComponent(id)}/switch/decline`, { method: "POST" });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json() as Promise<SwitchSuggestion>;
  },
  generateGuarantee: async (id: string): Promise<GuaranteeSuggestion> => {
    const res = await fetch(`${BASE}/shows/${encodeURIComponent(id)}/guarantee/generate`, { method: "POST" });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `API error ${res.status}`);
    }
    return res.json() as Promise<GuaranteeSuggestion>;
  },
  dealImprovements: (id: string) =>
    get<DealImprovementsPayload>(`/shows/${encodeURIComponent(id)}/deal/improvements`),
  applyDealImprovements: async (
    id: string,
    items: { kind: ImprovementKind; value?: number }[],
  ): Promise<{ ok: true; appliedKinds: ImprovementKind[]; dealId: string }> => {
    const res = await fetch(`${BASE}/shows/${encodeURIComponent(id)}/deal/apply-improvements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `API error ${res.status}`);
    }
    return res.json() as Promise<{ ok: true; appliedKinds: ImprovementKind[]; dealId: string }>;
  },
  calibration: () => get<CalibrationPayload>("/calibration"),
  expenseFriction: () => get<ExpenseFrictionPayload>("/insights/expense-friction"),
  artistExpenseProfile: (id: string) =>
    get<ArtistExpenseProfile>(`/artists/${encodeURIComponent(id)}/expense-profile`),
  showMeter: (id: string) => get<ShowMeterPayload>(`/shows/${encodeURIComponent(id)}/meter`),
  aiAsk: async (input: { scope: AskScope; id?: string; question: string }): Promise<AskResult> => {
    const res = await fetch(`${BASE}/ai/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `API error ${res.status}`);
    }
    return res.json() as Promise<AskResult>;
  },
  applyGuaranteeToDeal: async (
    id: string,
    guaranteeAmount: number,
    setDealTypeFlat = false,
  ): Promise<{ ok: true; dealId: string; guaranteeAmount: number; dealType: string }> => {
    const res = await fetch(`${BASE}/shows/${encodeURIComponent(id)}/deal/apply-guarantee`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guaranteeAmount, setDealTypeFlat }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `API error ${res.status}`);
    }
    return res.json() as Promise<{ ok: true; dealId: string; guaranteeAmount: number; dealType: string }>;
  },
};
