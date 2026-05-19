import { Activity, TrendingUp, TrendingDown } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { useApiData } from "@/hooks/useApiData";
import type { CategoryCalibration, ExpenseCategory } from "@/lib/types";

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
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

export function CalibrationSection({ variant }: { variant: "analysis" | "insights" }) {
  const state = useApiData(() => api.calibration(), []);
  if (state.status !== "ready") return null;
  const c = state.data;

  const categoryRows = Object.values(c.perCategory) as CategoryCalibration[];
  const drifted = categoryRows.filter(
    (r) => r.p75Drift3moVs12mo != null && Math.abs(r.p75Drift3moVs12mo) >= 0.05,
  );
  const stableDrift = categoryRows.filter(
    (r) => r.p75Drift3moVs12mo != null && Math.abs(r.p75Drift3moVs12mo) < 0.05,
  );

  return (
    <section className="mb-14">
      <div className="mb-5">
        <div className="eyebrow text-[10px] text-ink-500 mb-1.5">
          {variant === "analysis"
            ? "Expense intelligence · venue-calibrated baselines"
            : "Expense intelligence · friction signal"}
        </div>
        <h2
          className="font-display text-[26px] font-medium text-ink-900 leading-[1.1]"
          style={{ letterSpacing: "-0.015em" }}
        >
          {variant === "analysis"
            ? "What expenses normally land at"
            : "Where expense pressure shows up"}
        </h2>
        <p className="text-[13px] text-ink-500 mt-2 max-w-2xl leading-relaxed">
          P75 of historical per-category spend across {c.maturity.settledN}{" "}
          settled shows, with a 3-month vs 12-month drift signal. Categories
          with n &lt; 16 fall back to industry audit defaults and are marked.
          Overall dispute rate baseline: {Math.round(c.disputeRateBaseline.overall * 1000) / 10}%
          ({c.disputeRateBaseline.nDisputed}/{c.disputeRateBaseline.n}).
        </p>
      </div>

      <Card className="mb-5">
        <CardContent>
          <div className="flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4 text-brand-700" />
            <h3 className="text-[14px] font-semibold text-ink-900">
              Per-category baselines
            </h3>
            <span className="text-[10.5px] text-ink-400">
              {c.maturity.label}
            </span>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left border-b border-ink-100/80">
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold">
                  Category
                </th>
                <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                  P50
                </th>
                <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                  P75 (cap)
                </th>
                <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                  Mean
                </th>
                <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                  3mo drift
                </th>
                <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold">
                  Source
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100/60">
              {categoryRows.map((r) => {
                const drift = r.p75Drift3moVs12mo;
                const driftCls =
                  drift == null
                    ? "text-ink-300"
                    : Math.abs(drift) < 0.05
                    ? "text-ink-500"
                    : drift > 0
                    ? "text-rose-700"
                    : "text-emerald-700";
                return (
                  <tr key={r.category} className="hover:bg-ink-50/40">
                    <td className="py-2.5 pr-3 text-ink-900 font-medium">
                      {CATEGORY_LABELS[r.category]}
                    </td>
                    <td className="py-2.5 px-2 font-mono tabular text-right text-ink-700">
                      {fmtMoney(r.p50)}
                    </td>
                    <td className="py-2.5 px-2 font-mono tabular text-right text-ink-900 font-semibold">
                      {fmtMoney(r.value)}
                    </td>
                    <td className="py-2.5 px-2 font-mono tabular text-right text-ink-600">
                      {fmtMoney(r.mean)}
                    </td>
                    <td className={`py-2.5 px-2 font-mono tabular text-right ${driftCls}`}>
                      {drift == null
                        ? "—"
                        : `${drift > 0 ? "+" : ""}${Math.round(drift * 100)}%`}
                    </td>
                    <td className="py-2.5 px-2">
                      {r.source === "venue_computed" ? (
                        <span className="text-[10.5px] text-emerald-700">
                          venue · n={r.n}
                        </span>
                      ) : (
                        <span className="text-[10.5px] text-amber-700">
                          audit default
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {c.hospitalityWatch.p75 != null && (
        <Card className="mb-5">
          <CardContent>
            <div className="flex items-center gap-2 mb-2">
              {c.hospitalityWatch.flagged ? (
                <TrendingUp className="h-4 w-4 text-rose-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-emerald-600" />
              )}
              <h3 className="text-[14px] font-semibold text-ink-900">
                Hospitality watch
              </h3>
            </div>
            <p className="text-[12.5px] text-ink-600 leading-relaxed">
              Hospitality P75 over {c.hospitalityWatch.n} settled shows is{" "}
              <span className="font-mono tabular text-ink-900">
                {fmtMoney(c.hospitalityWatch.p75)}
              </span>
              . Last 3 months tracking{" "}
              <span className="font-mono tabular text-ink-900">
                {fmtMoney(c.hospitalityWatch.p75Last3mo)}
              </span>{" "}
              (
              {c.hospitalityWatch.drift != null
                ? `${c.hospitalityWatch.drift > 0 ? "+" : ""}${Math.round(
                    c.hospitalityWatch.drift * 100,
                  )}%`
                : "—"}
              ).{" "}
              {c.hospitalityWatch.flagged
                ? "Drift above ±10% — review caps before settling more shows."
                : "Within the ±10% watch band — caps are healthy."}
            </p>
          </CardContent>
        </Card>
      )}

      {drifted.length > 0 && (
        <Card className="mb-5">
          <CardContent>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-rose-600" />
              <h3 className="text-[14px] font-semibold text-ink-900">
                Categories drifting (3mo vs 12mo)
              </h3>
            </div>
            <ul className="text-[12.5px] text-ink-700 space-y-1.5">
              {drifted.map((r) => (
                <li key={r.category} className="flex items-baseline gap-2">
                  <span className="font-medium text-ink-900 w-[110px]">
                    {CATEGORY_LABELS[r.category]}
                  </span>
                  <span className="font-mono tabular text-rose-700">
                    {(r.p75Drift3moVs12mo ?? 0) > 0 ? "+" : ""}
                    {Math.round((r.p75Drift3moVs12mo ?? 0) * 100)}%
                  </span>
                  <span className="text-ink-500 text-[11.5px]">
                    vs 12-mo P75 of {fmtMoney(r.p75)}
                  </span>
                </li>
              ))}
            </ul>
            {stableDrift.length > 0 && (
              <p className="text-[11px] text-ink-400 mt-3">
                {stableDrift.length} other categor
                {stableDrift.length === 1 ? "y" : "ies"} within ±5% of trend.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {c.genreBaselines.length > 0 && (
        <Card>
          <CardContent>
            <div className="flex items-center gap-2 mb-3">
              <Activity className="h-4 w-4 text-brand-700" />
              <h3 className="text-[14px] font-semibold text-ink-900">
                Genre baselines
              </h3>
              <span className="text-[10.5px] text-ink-400">
                expense profile by artist genre
              </span>
            </div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left border-b border-ink-100/80">
                  <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold">
                    Genre
                  </th>
                  <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                    Shows
                  </th>
                  <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                    Mean total
                  </th>
                  <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                    P75 total
                  </th>
                  <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                    Mean hospitality
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100/60">
                {c.genreBaselines.slice(0, 12).map((g) => (
                  <tr key={g.genre} className="hover:bg-ink-50/40">
                    <td className="py-2.5 pr-3 text-ink-900 font-medium capitalize">
                      {g.genre}
                    </td>
                    <td className="py-2.5 px-2 font-mono tabular text-right text-ink-600">
                      {g.n}
                    </td>
                    <td className="py-2.5 px-2 font-mono tabular text-right text-ink-700">
                      {fmtMoney(g.meanExpenses)}
                    </td>
                    <td className="py-2.5 px-2 font-mono tabular text-right text-ink-900 font-semibold">
                      {fmtMoney(g.p75Expenses)}
                    </td>
                    <td className="py-2.5 px-2 font-mono tabular text-right text-ink-600">
                      {fmtMoney(g.meanHospitality)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
