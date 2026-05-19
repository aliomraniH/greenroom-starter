import { Activity, AlertTriangle, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
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

export function AccountHealthWidget() {
  const state = useApiData(() => api.calibration(), []);
  if (state.status !== "ready") return null;
  const c = state.data;
  const h = c.accountHealth;

  const maturityTone =
    h.maturityStage >= 3
      ? { ring: "ring-emerald-200/60", bg: "bg-emerald-50/40", fg: "text-emerald-700" }
      : h.maturityStage === 2
      ? { ring: "ring-sky-200/60", bg: "bg-sky-50/40", fg: "text-sky-700" }
      : { ring: "ring-amber-200/60", bg: "bg-amber-50/40", fg: "text-amber-700" };

  const noCapTone =
    h.upcomingWithoutCapsCount === 0
      ? { ring: "ring-emerald-200/60", bg: "bg-emerald-50/40", fg: "text-emerald-700" }
      : h.upcomingWithoutCapsCount >= 5
      ? { ring: "ring-rose-200/60", bg: "bg-rose-50/40", fg: "text-rose-700" }
      : { ring: "ring-amber-200/60", bg: "bg-amber-50/40", fg: "text-amber-700" };

  const driftTone =
    h.driftedCategories.length === 0
      ? { ring: "ring-emerald-200/60", bg: "bg-emerald-50/40", fg: "text-emerald-700" }
      : { ring: "ring-rose-200/60", bg: "bg-rose-50/40", fg: "text-rose-700" };

  return (
    <div className="grid grid-cols-3 gap-3 mb-8">
      <div className={`rounded-md ring-1 ${maturityTone.ring} ${maturityTone.bg} p-4`}>
        <div className={`flex items-center gap-1.5 eyebrow text-[10px] ${maturityTone.fg} mb-1.5`}>
          <Activity className="h-3 w-3" />
          Calibration maturity
        </div>
        <div className="text-[22px] font-display text-ink-900">Stage {h.maturityStage}</div>
        <div className="text-[10.5px] text-ink-500 mt-1.5 leading-snug">
          {c.maturity.label}. {h.settledN} settled shows on file.
        </div>
      </div>
      <div className={`rounded-md ring-1 ${noCapTone.ring} ${noCapTone.bg} p-4`}>
        <div className={`flex items-center gap-1.5 eyebrow text-[10px] ${noCapTone.fg} mb-1.5`}>
          <AlertTriangle className="h-3 w-3" />
          Upcoming without caps
        </div>
        <div className="text-[22px] font-display text-ink-900">
          {h.upcomingWithoutCapsCount}
        </div>
        <div className="text-[10.5px] text-ink-500 mt-1.5 leading-snug">
          of {h.upcomingCount} upcoming non-flat deals are missing an expense
          cap. Improve Deal proposes audit-derived defaults.
        </div>
      </div>
      <div className={`rounded-md ring-1 ${driftTone.ring} ${driftTone.bg} p-4`}>
        <div className={`flex items-center gap-1.5 eyebrow text-[10px] ${driftTone.fg} mb-1.5`}>
          <TrendingUp className="h-3 w-3" />
          Categories drifting (3mo vs 12mo)
        </div>
        <div className="text-[22px] font-display text-ink-900">
          {h.driftedCategories.length}
        </div>
        <div className="text-[10.5px] text-ink-500 mt-1.5 leading-snug">
          {h.driftedCategories.length === 0
            ? "All categories within ±10% of their 12-mo P75."
            : h.driftedCategories
                .slice(0, 3)
                .map(
                  (d) =>
                    `${CATEGORY_LABELS[d.category] ?? d.category} ${d.drift > 0 ? "+" : ""}${Math.round(d.drift * 100)}%`,
                )
                .join(" · ")}
        </div>
      </div>
    </div>
  );
}
