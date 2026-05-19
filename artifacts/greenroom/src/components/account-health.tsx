import { Link } from "wouter";
import { Activity, TrendingDown, TrendingUp, Gauge } from "lucide-react";
import { api } from "@/lib/api";
import { useApiData } from "@/hooks/useApiData";

function freshnessLabel(generatedAt: string): string {
  const t = Date.parse(generatedAt);
  if (!Number.isFinite(t)) return "just now";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function AccountHealthWidget() {
  const state = useApiData(() => api.calibration(), []);
  if (state.status !== "ready") return null;
  const c = state.data;
  const h = c.accountHealth;

  // Tile 1: maturity
  const maturityTone =
    h.maturityStage >= 3
      ? { ring: "ring-emerald-200/60", bg: "bg-emerald-50/40", fg: "text-emerald-700" }
      : h.maturityStage === 2
      ? { ring: "ring-sky-200/60", bg: "bg-sky-50/40", fg: "text-sky-700" }
      : { ring: "ring-amber-200/60", bg: "bg-amber-50/40", fg: "text-amber-700" };

  // Tile 2: this-month vs trailing-3-mo expense-%-of-gross delta
  const delta = h.expensePctOfGross.delta;
  const tm = h.expensePctOfGross.thisMonth;
  const t3 = h.expensePctOfGross.trailing3mo;
  const deltaTone =
    delta == null
      ? { ring: "ring-ink-200/60", bg: "bg-ink-50/40", fg: "text-ink-600" }
      : Math.abs(delta) < 0.02
      ? { ring: "ring-emerald-200/60", bg: "bg-emerald-50/40", fg: "text-emerald-700" }
      : delta > 0
      ? { ring: "ring-rose-200/60", bg: "bg-rose-50/40", fg: "text-rose-700" }
      : { ring: "ring-sky-200/60", bg: "bg-sky-50/40", fg: "text-sky-700" };
  const DeltaIcon =
    delta == null ? Gauge : delta > 0 ? TrendingUp : TrendingDown;

  // Tile 3: calibration freshness
  const calibTone =
    h.calibration.calibratedCount === h.calibration.totalCount
      ? { ring: "ring-emerald-200/60", bg: "bg-emerald-50/40", fg: "text-emerald-700" }
      : { ring: "ring-amber-200/60", bg: "bg-amber-50/40", fg: "text-amber-700" };

  return (
    <div className="grid grid-cols-3 gap-3 mb-8">
      {/* Tile 1 — Maturity → click-through to Deal Analysis baselines */}
      <Link
        href="/deal-analysis"
        className={`block rounded-md ring-1 ${maturityTone.ring} ${maturityTone.bg} p-4 hover:ring-2 transition-shadow`}
      >
        <div className={`flex items-center gap-1.5 eyebrow text-[10px] ${maturityTone.fg} mb-1.5`}>
          <Activity className="h-3 w-3" />
          Calibration maturity
        </div>
        <div className="text-[22px] font-display text-ink-900">Stage {h.maturityStage}</div>
        <div className="text-[10.5px] text-ink-500 mt-1.5 leading-snug">
          {c.maturity.label}. {h.settledN} settled shows on file.
        </div>
      </Link>

      {/* Tile 2 — Expense-%-of-gross delta → click-through to Insights expense friction */}
      <Link
        href="/insights"
        className={`block rounded-md ring-1 ${deltaTone.ring} ${deltaTone.bg} p-4 hover:ring-2 transition-shadow`}
      >
        <div className={`flex items-center gap-1.5 eyebrow text-[10px] ${deltaTone.fg} mb-1.5`}>
          <DeltaIcon className="h-3 w-3" />
          Expense % of gross · this month
        </div>
        <div className="text-[22px] font-display text-ink-900 tabular">
          {tm == null ? "—" : `${Math.round(tm * 100)}%`}
          {delta != null && (
            <span className={`ml-2 text-[14px] font-mono ${deltaTone.fg}`}>
              {delta > 0 ? "▲" : delta < 0 ? "▼" : "·"} {Math.abs(Math.round(delta * 100))} pts
            </span>
          )}
        </div>
        <div className="text-[10.5px] text-ink-500 mt-1.5 leading-snug">
          {t3 == null
            ? `Trailing 3-mo baseline not yet available (n=${h.expensePctOfGross.trailing3moN}).`
            : `vs ${Math.round(t3 * 100)}% trailing 3-mo (n=${h.expensePctOfGross.trailing3moN}).`}
        </div>
      </Link>

      {/* Tile 3 — Calibration freshness → click-through to Deal Analysis */}
      <Link
        href="/deal-analysis"
        className={`block rounded-md ring-1 ${calibTone.ring} ${calibTone.bg} p-4 hover:ring-2 transition-shadow`}
      >
        <div className={`flex items-center gap-1.5 eyebrow text-[10px] ${calibTone.fg} mb-1.5`}>
          <Gauge className="h-3 w-3" />
          Calibration freshness
        </div>
        <div className="text-[22px] font-display text-ink-900 tabular">
          {h.calibration.calibratedCount} of {h.calibration.totalCount} calibrated
        </div>
        <div className="text-[10.5px] text-ink-500 mt-1.5 leading-snug">
          refreshed {freshnessLabel(h.calibration.generatedAt)}
          {h.calibration.calibratedCount < h.calibration.totalCount && (
            <> · remaining categories use audit defaults.</>
          )}
        </div>
      </Link>
    </div>
  );
}
