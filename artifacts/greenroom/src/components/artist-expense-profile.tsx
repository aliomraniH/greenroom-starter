import { Activity } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { useApiData } from "@/hooks/useApiData";

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

export function ArtistExpenseProfileCard({ artistId }: { artistId: string }) {
  const state = useApiData(() => api.artistExpenseProfile(artistId), [artistId]);
  if (state.status !== "ready") return null;
  const p = state.data;
  if (p.settledShows === 0) return null;

  const vsPct = p.vsGenre.artistVsGenrePct;
  const vsTone =
    vsPct == null
      ? "text-ink-500"
      : Math.abs(vsPct) < 0.05
      ? "text-ink-600"
      : vsPct > 0
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
        <div className="grid grid-cols-4 gap-px bg-ink-200/40 rounded-md overflow-hidden">
          <Stat label="Mean total" value={fmtMoney(p.totalExpensesMean)} />
          <Stat label="P75 total" value={fmtMoney(p.totalExpensesP75)} />
          <Stat label="Mean hospitality" value={fmtMoney(p.hospitalityMean)} />
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
        {p.vsGenre.genre && (
          <div className="text-[12px] text-ink-600 mt-3 leading-relaxed">
            vs <span className="capitalize">{p.vsGenre.genre}</span> baseline of{" "}
            <span className="font-mono tabular text-ink-900">
              {fmtMoney(p.vsGenre.genreMeanExpenses)}
            </span>{" "}
            mean per show:{" "}
            <span className={`font-mono tabular ${vsTone}`}>
              {vsPct == null
                ? "—"
                : `${vsPct > 0 ? "+" : ""}${Math.round(vsPct * 100)}%`}
            </span>
            {vsPct != null && Math.abs(vsPct) >= 0.1 && (
              <>
                {" "}
                · {vsPct > 0
                  ? "running above peers — review caps before signing the next deal."
                  : "running below peers — caps don't need tightening."}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
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
      </div>
    </div>
  );
}
