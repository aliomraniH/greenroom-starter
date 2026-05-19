import { Activity } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { useApiData } from "@/hooks/useApiData";
import type { Confidence } from "@/lib/types";

const CATEGORY_LABELS: Record<string, string> = {
  hospitality: "Hospitality",
  production: "Production",
  sound: "Sound",
  lights: "Lights",
  marketing: "Marketing",
  backline: "Backline",
  security: "Security",
  other: "Other",
};

function fmtMoney(n: number | null): string {
  if (n == null) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

function ConfidenceChip({ confidence }: { confidence: Confidence }) {
  const tone =
    confidence === "high"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200/60"
      : confidence === "med"
      ? "bg-sky-50 text-sky-700 ring-sky-200/60"
      : confidence === "low"
      ? "bg-amber-50 text-amber-700 ring-amber-200/60"
      : "bg-ink-50 text-ink-500 ring-ink-200/60";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm ring-1 px-1.5 py-[1px] text-[10px] font-medium uppercase tracking-[0.05em] ${tone}`}
    >
      {confidence === "none" ? "low n" : `${confidence} conf.`}
    </span>
  );
}

export function ArtistExpenseProfileCard({ artistId }: { artistId: string }) {
  const state = useApiData(() => api.artistExpenseProfile(artistId), [artistId]);
  if (state.status !== "ready") return null;
  const p = state.data;
  if (p.settledShows === 0) return null;

  const p75Delta = p.vsGenre.p75Delta;
  const p75Tone =
    p75Delta == null
      ? "text-ink-500"
      : Math.abs(p75Delta) < 0.05
      ? "text-ink-600"
      : p75Delta > 0
      ? "text-rose-700"
      : "text-emerald-700";

  return (
    <Card className="mb-10">
      <CardContent>
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-brand-700" />
          <h3 className="text-[14px] font-semibold text-ink-900">
            Expense profile
          </h3>
          <span className="text-[10.5px] text-ink-400">
            {p.source === "venue_computed"
              ? `venue-computed · n=${p.settledShows}`
              : "low sample · interpret with caution"}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-px bg-ink-200/40 rounded-md overflow-hidden">
          <Stat label="Weighted mean" value={fmtMoney(p.totalExpensesWeightedMean)} hint="recency-decayed" />
          <Stat label="P75" value={fmtMoney(p.totalExpensesP75)} />
          <Stat label="Max" value={fmtMoney(p.totalExpensesMax)} />
          <Stat label="Stddev" value={fmtMoney(p.totalExpensesStddev)} />
          <Stat
            label="Top category"
            value={
              p.topCategory
                ? `${CATEGORY_LABELS[p.topCategory.category] ?? p.topCategory.category} · ${fmtMoney(p.topCategory.mean)}`
                : "—"
            }
            mono={false}
          />
        </div>

        {/* P75 vs venue genre P75 — only when artist has >=3 shows */}
        {p.vsGenre.genre && p.vsGenre.p75Confidence && p.vsGenre.genreP75Expenses != null && (
          <div className="text-[12px] text-ink-600 mt-3 leading-relaxed flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              P75 vs <span className="capitalize">{p.vsGenre.genre}</span> baseline of{" "}
              <span className="font-mono tabular text-ink-900">
                {fmtMoney(p.vsGenre.genreP75Expenses)}
              </span>
              :
            </span>
            <span className={`font-mono tabular ${p75Tone}`}>
              {p75Delta == null
                ? "—"
                : `${p75Delta > 0 ? "+" : ""}${Math.round(p75Delta * 100)}%`}
            </span>
            <ConfidenceChip confidence={p.vsGenre.p75Confidence} />
            {p75Delta != null && Math.abs(p75Delta) >= 0.1 && (
              <span className="text-ink-500">
                {p75Delta > 0
                  ? "· running above peers — review caps before signing the next deal."
                  : "· running below peers — caps don't need tightening."}
              </span>
            )}
          </div>
        )}
        {p.vsGenre.genre && !p.vsGenre.p75Confidence && (
          <div className="text-[11px] text-ink-400 mt-3 italic">
            P75 vs genre comparison requires ≥3 settled shows for this artist
            (currently {p.settledShows}).
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
  mono = true,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-white px-4 py-3">
      <div
        className={`text-[18px] font-medium text-ink-900 leading-tight ${
          mono ? "font-mono tabular" : "font-display"
        }`}
      >
        {value}
      </div>
      <div className="text-[10px] font-medium text-ink-400 uppercase tracking-[0.06em] mt-1.5">
        {label}
        {hint && <span className="ml-1 normal-case text-ink-300">· {hint}</span>}
      </div>
    </div>
  );
}
