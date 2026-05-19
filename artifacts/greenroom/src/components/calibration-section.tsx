import { Activity, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { useApiData } from "@/hooks/useApiData";
import type {
  BucketDrift,
  CategoryCalibration,
  CellBaseline,
  ExpenseCategory,
  GenreBaseline,
} from "@/lib/types";

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

const DEAL_TYPE_LABELS: Record<string, string> = {
  flat: "Flat",
  percentage_of_gross: "% gross",
  percentage_of_net: "% net",
  vs: "vs",
  door: "Door",
};

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtPct(n: number | null | undefined, digits = 0): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function confidenceChip(c: string, n: number) {
  const cls =
    c === "high"
      ? "bg-emerald-50 text-emerald-700"
      : c === "med"
      ? "bg-amber-50 text-amber-700"
      : c === "low"
      ? "bg-orange-50 text-orange-700"
      : "bg-ink-50 text-ink-500";
  return (
    <span className={`text-[9.5px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-[0.06em] ${cls}`}>
      {c} · n={n}
    </span>
  );
}

export function CalibrationSection({ variant }: { variant: "analysis" | "insights" }) {
  const state = useApiData(() => api.calibration(), []);
  if (state.status !== "ready") return null;
  const c = state.data;

  const categoryRows = Object.values(c.perCategory) as CategoryCalibration[];

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
          Self-calibrated against {c.maturity.settledN} settled shows · {c.maturity.label}.
          Rolling 12-mo ticketing fee rate{" "}
          <span className="font-mono tabular text-ink-900">{fmtPct(c.feeRateRolling12mo.rate, 1)}</span>
          {" "}({c.feeRateRolling12mo.source === "venue_computed" ? `venue-computed · n=${c.feeRateRolling12mo.n}` : "industry default"}).
        </p>
      </div>

      <PerCategoryCard rows={categoryRows} maturityLabel={c.maturity.label} />

      <BucketDriftCard rows={c.bucketDrift} />

      <HospitalityWatchCard watch={c.hospitalityWatch} />

      <GenreBaselinesCard rows={c.genreBaselines} />

      <DisputeBaselineCard
        cells={c.cellBaselines}
        overallRate={c.disputeRateBaseline.overall}
        overallN={c.disputeRateBaseline.n}
      />
    </section>
  );
}

function PerCategoryCard({
  rows,
  maturityLabel,
}: {
  rows: CategoryCalibration[];
  maturityLabel: string;
}) {
  return (
    <Card className="mb-5">
      <CardContent>
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-brand-700" />
          <h3 className="text-[14px] font-semibold text-ink-900">Per-category baselines</h3>
          <span className="text-[10.5px] text-ink-400">{maturityLabel}</span>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left border-b border-ink-100/80">
              <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold">Category</th>
              <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">P50</th>
              <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">P75 (cap)</th>
              <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">Mean</th>
              <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">3mo drift</th>
              <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100/60">
            {rows.map((r) => {
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
                  <td className="py-2.5 pr-3 text-ink-900 font-medium">{CATEGORY_LABELS[r.category]}</td>
                  <td className="py-2.5 px-2 font-mono tabular text-right text-ink-700">{fmtMoney(r.p50)}</td>
                  <td className="py-2.5 px-2 font-mono tabular text-right text-ink-900 font-semibold">{fmtMoney(r.value)}</td>
                  <td className="py-2.5 px-2 font-mono tabular text-right text-ink-600">{fmtMoney(r.mean)}</td>
                  <td className={`py-2.5 px-2 font-mono tabular text-right ${driftCls}`}>
                    {drift == null ? "—" : `${drift > 0 ? "+" : ""}${Math.round(drift * 100)}%`}
                  </td>
                  <td className="py-2.5 px-2">
                    {r.source === "venue_computed" ? (
                      <span className="text-[10.5px] text-emerald-700">venue · n={r.n}</span>
                    ) : (
                      <span className="text-[10.5px] text-amber-700">audit default</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function BucketDriftCard({ rows }: { rows: BucketDrift[] }) {
  const populated = rows.filter((r) => r.p75 != null);
  if (populated.length === 0) return null;
  const flagged = populated.filter((r) => r.flagged);
  return (
    <Card className="mb-5">
      <CardContent>
        <div className="flex items-center gap-2 mb-3">
          {flagged.length > 0 ? (
            <TrendingUp className="h-4 w-4 text-rose-600" />
          ) : (
            <Activity className="h-4 w-4 text-brand-700" />
          )}
          <h3 className="text-[14px] font-semibold text-ink-900">Bucket P75 drift</h3>
          <span className="text-[10.5px] text-ink-400">rolling 3-mo vs 12-mo per deal-size bucket</span>
        </div>
        {flagged.length > 0 && (
          <div className="text-[11.5px] text-rose-700 mb-3">
            {flagged.length} bucket{flagged.length === 1 ? "" : "s"} drifting &gt; +10% — recent
            shows are running hotter than the annual baseline.
          </div>
        )}
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left border-b border-ink-100/80">
              <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold">Bucket</th>
              <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">12-mo P75</th>
              <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">3-mo P75</th>
              <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">Drift</th>
              <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">n</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100/60">
            {populated.map((r) => {
              const drift = r.drift;
              const driftCls =
                drift == null
                  ? "text-ink-300"
                  : drift > 0.1
                  ? "text-rose-700 font-semibold"
                  : drift > 0
                  ? "text-amber-700"
                  : "text-emerald-700";
              return (
                <tr key={r.bucket} className="hover:bg-ink-50/40">
                  <td className="py-2.5 pr-3 text-ink-900 font-medium">{r.bucket}</td>
                  <td className="py-2.5 px-2 font-mono tabular text-right text-ink-700">{fmtMoney(r.p75)}</td>
                  <td className="py-2.5 px-2 font-mono tabular text-right text-ink-700">{fmtMoney(r.p75Last3mo)}</td>
                  <td className={`py-2.5 px-2 font-mono tabular text-right ${driftCls}`}>
                    {drift == null ? "—" : `${drift > 0 ? "+" : ""}${Math.round(drift * 100)}%`}
                  </td>
                  <td className="py-2.5 px-2 font-mono tabular text-right text-ink-500">
                    {r.n}
                    <span className="text-ink-400"> · 3mo {r.n3mo}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function HospitalityWatchCard({
  watch,
}: {
  watch: import("@/lib/types").HospitalityWatch;
}) {
  if (watch.p75 == null && watch.n === 0) return null;
  const Icon = watch.flagged ? TrendingUp : TrendingDown;
  const iconTone = watch.flagged ? "text-rose-600" : "text-emerald-600";
  return (
    <Card className="mb-5">
      <CardContent>
        <div className="flex items-center gap-2 mb-2">
          <Icon className={`h-4 w-4 ${iconTone}`} />
          <h3 className="text-[14px] font-semibold text-ink-900">Hospitality watch</h3>
        </div>
        <p className="text-[12.5px] text-ink-600 leading-relaxed">
          Hospitality cap (P75 across {watch.n} settled shows):{" "}
          <span className="font-mono tabular text-ink-900">{fmtMoney(watch.p75)}</span>.
          {watch.underCapPct != null && (
            <>
              {" "}
              <span className="font-mono tabular text-ink-900">{fmtPct(watch.underCapPct)}</span>{" "}
              of nights came in under cap.
            </>
          )}
          {" "}Last 3 months tracking{" "}
          <span className="font-mono tabular text-ink-900">{fmtMoney(watch.p75Last3mo)}</span>
          {" "}(
          {watch.drift != null
            ? `${watch.drift > 0 ? "+" : ""}${Math.round(watch.drift * 100)}%`
            : "—"}
          ).{" "}
          {watch.flagged
            ? "Drift outside ±10% — review caps before settling more shows."
            : "Within the ±10% watch band — caps are healthy."}
        </p>
        {watch.recentBreaches.length > 0 && (
          <div className="mt-3">
            <div className="text-[10px] eyebrow text-ink-400 mb-1.5">
              Recent shows that breached the cap
            </div>
            <ul className="text-[11.5px] text-ink-700 space-y-1">
              {watch.recentBreaches.map((b) => (
                <li key={b.showId} className="flex items-baseline gap-2">
                  <span className="font-mono tabular text-ink-500 w-[90px]">{b.date}</span>
                  <span className="font-mono tabular text-rose-700">+{fmtMoney(b.overBy)}</span>
                  <span className="text-ink-500">
                    over cap (total {fmtMoney(b.amount)})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GenreBaselinesCard({ rows }: { rows: GenreBaseline[] }) {
  if (rows.length === 0) return null;
  return (
    <Card className="mb-5">
      <CardContent>
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-brand-700" />
          <h3 className="text-[14px] font-semibold text-ink-900">Genre baselines</h3>
          <span className="text-[10.5px] text-ink-400">expense profile by artist genre</span>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left border-b border-ink-100/80">
              <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold">Genre</th>
              <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">Shows</th>
              <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">Mean total</th>
              <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">P75 total</th>
              <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">Mean hospitality</th>
              <th className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold">Confidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100/60">
            {rows.slice(0, 12).map((g) => {
              const conf = g.n >= 16 ? "high" : g.n >= 8 ? "med" : "low";
              return (
                <tr key={g.genre} className="hover:bg-ink-50/40">
                  <td className="py-2.5 pr-3 text-ink-900 font-medium capitalize">{g.genre}</td>
                  <td className="py-2.5 px-2 font-mono tabular text-right text-ink-600">{g.n}</td>
                  <td className="py-2.5 px-2 font-mono tabular text-right text-ink-700">{fmtMoney(g.meanExpenses)}</td>
                  <td className="py-2.5 px-2 font-mono tabular text-right text-ink-900 font-semibold">{fmtMoney(g.p75Expenses)}</td>
                  <td className="py-2.5 px-2 font-mono tabular text-right text-ink-600">{fmtMoney(g.meanHospitality)}</td>
                  <td className="py-2.5 px-2">{confidenceChip(conf, g.n)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function DisputeBaselineCard({
  cells,
  overallRate,
  overallN,
}: {
  cells: CellBaseline[];
  overallRate: number;
  overallN: number;
}) {
  const dealTypes = Array.from(new Set(cells.map((c) => c.dealType)));
  const buckets = Array.from(new Set(cells.map((c) => c.bucket)));
  const cellMap = new Map(cells.map((c) => [`${c.dealType}|${c.bucket}`, c]));
  if (cells.length === 0) return null;
  return (
    <Card className="mb-5">
      <CardContent>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <h3 className="text-[14px] font-semibold text-ink-900">
            Dispute baseline · deal-type × bucket
          </h3>
          <span className="text-[10.5px] text-ink-400">
            venue baseline {fmtPct(overallRate, 1)} ({overallN} settled) · cell vs baseline
          </span>
        </div>
        <p className="text-[11.5px] text-ink-500 mb-3 leading-relaxed">
          Each cell shows observed dispute rate, with delta vs the venue baseline. Cells with
          n &lt; 5 fall back to the venue baseline rather than guessing from too few rows.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="text-left border-b border-ink-100/80">
                <th className="py-2 pr-3 eyebrow text-[10px] text-ink-400 font-semibold">
                  Deal type
                </th>
                {buckets.map((b) => (
                  <th
                    key={b}
                    className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-right"
                  >
                    {b}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100/60">
              {dealTypes.map((dt) => (
                <tr key={dt} className="hover:bg-ink-50/40">
                  <td className="py-2.5 pr-3 text-ink-900 font-medium">
                    {DEAL_TYPE_LABELS[dt] ?? dt}
                  </td>
                  {buckets.map((b) => {
                    const cell = cellMap.get(`${dt}|${b}`);
                    if (!cell) {
                      return (
                        <td key={b} className="py-2.5 px-2 text-right text-ink-300">
                          —
                        </td>
                      );
                    }
                    const observed = cell.disputeRate.value ?? 0;
                    const delta = observed - overallRate;
                    const tone =
                      cell.disputeRate.source === "audit_default"
                        ? "text-ink-400"
                        : delta > 0.05
                        ? "text-rose-700 font-semibold"
                        : delta < -0.05
                        ? "text-emerald-700"
                        : "text-ink-700";
                    return (
                      <td key={b} className="py-2.5 px-2 text-right">
                        <div className={`font-mono tabular ${tone}`}>
                          {cell.disputeRate.source === "audit_default"
                            ? "baseline"
                            : fmtPct(observed, 0)}
                        </div>
                        <div className="text-[9.5px] text-ink-400">
                          n={cell.n}
                          {cell.disputeRate.source === "venue_computed" && delta !== 0 && (
                            <span className={`ml-1 ${delta > 0 ? "text-rose-600" : "text-emerald-700"}`}>
                              {delta > 0 ? "+" : ""}
                              {Math.round(delta * 100)}pp
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
