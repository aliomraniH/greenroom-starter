import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Sparkles, Shield, ChevronRight, ArrowUpRight, Clock, DollarSign, Calculator, ShieldCheck, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { useApiData, LoadingState } from "@/hooks/useApiData";
import { CalibrationSection } from "@/components/calibration-section";
import type { InsightsCell, AttentionKind, SwitchSavingsItem, SwitchProjectedCell, GuaranteeBacktestItem, SgpFlatRepricingItem, ExpenseFrictionCell } from "@/lib/types";

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

function ExpenseFrictionSection() {
  const state = useApiData(() => api.expenseFriction(), []);
  if (state.status === "loading") return null;
  if (state.status === "error") return null;
  const cells = state.data.cells;
  if (cells.length === 0) return null;
  return (
    <Card className="mb-8">
      <CardContent>
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <div className="eyebrow text-[10px] text-ink-500 mb-1">
              Expense friction by cell
            </div>
            <h3 className="text-[14px] font-semibold text-ink-900">
              Where expenses run hot vs the venue baseline
            </h3>
          </div>
          <div className="text-[10px] text-ink-400">
            cells with n ≥ 5 · themes filtered to expense / hospitality
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {cells.map((c) => (
            <ExpenseFrictionCellCard key={`${c.dealType}|${c.bucket}`} cell={c} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ExpenseFrictionCellCard({ cell }: { cell: ExpenseFrictionCell }) {
  const drift = cell.topCategoryDrift;
  const driftTone =
    drift == null
      ? "text-ink-500"
      : drift > 0.15
      ? "text-rose-700"
      : drift < -0.15
      ? "text-emerald-700"
      : "text-ink-600";
  return (
    <div className="rounded-md ring-1 ring-ink-200/60 bg-white p-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="text-[12px] font-medium text-ink-900">
          {DEAL_LABELS[cell.dealType] ?? cell.dealType}{" "}
          <span className="text-ink-400">·</span> {cell.bucket}
        </div>
        <div className="text-[10px] text-ink-400">n={cell.n}</div>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <div className="text-[10px] eyebrow text-ink-400">Mean exp / gross</div>
          <div className="text-[16px] font-mono tabular text-ink-900">
            {cell.expensePctMean == null ? "—" : `${Math.round(cell.expensePctMean * 100)}%`}
          </div>
        </div>
        <div>
          <div className="text-[10px] eyebrow text-ink-400">P75 exp / gross</div>
          <div className="text-[16px] font-mono tabular text-ink-900">
            {cell.expensePctP75 == null ? "—" : `${Math.round(cell.expensePctP75 * 100)}%`}
          </div>
        </div>
      </div>
      {cell.topCategory && drift != null && (
        <div className="text-[11.5px] text-ink-600 mb-2">
          Top drift:{" "}
          <span className="text-ink-900">
            {CATEGORY_LABELS[cell.topCategory] ?? cell.topCategory}
          </span>{" "}
          <span className={`font-mono tabular ${driftTone}`}>
            {drift > 0 ? "+" : ""}{Math.round(drift * 100)}%
          </span>{" "}
          <span className="text-ink-400">
            (cell ${cell.topCategoryCellMean?.toLocaleString() ?? "—"} vs venue $
            {cell.topCategoryVenueMean?.toLocaleString() ?? "—"})
          </span>
        </div>
      )}
      {cell.themes.length > 0 ? (
        <div className="border-t border-ink-100 pt-2 mt-2">
          <div className="text-[10px] eyebrow text-ink-400 mb-1.5">
            Recurring complaint themes
          </div>
          <div className="flex flex-wrap gap-1">
            {cell.themes.map((t, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 text-[10.5px] bg-violet-50 ring-1 ring-violet-200/60 text-violet-700 rounded-sm px-1.5 py-[1px]"
              >
                <Sparkles className="h-2.5 w-2.5" />
                {t.theme}
                <span className="font-mono tabular text-violet-500">×{t.count}</span>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-[10.5px] text-ink-400 italic border-t border-ink-100 pt-2 mt-2">
          No expense / hospitality themes clustered for this cell yet.
        </div>
      )}
    </div>
  );
}

const DEAL_LABELS: Record<string, string> = {
  flat: "Flat",
  percentage_of_gross: "% of gross",
  percentage_of_net: "% of net",
  vs: "Vs deal",
  door: "Door deal",
};

const KIND_LABEL: Record<AttentionKind, string> = {
  stale_disputed: "Stale dispute",
  disputed_recoups_but_signed: "Disputed recoup",
  show_settled_no_settlement: "Missing settlement",
  notes_say_closed_but_status_open: "Notes vs status",
  expense_overrun: "Expense overrun",
};

const KIND_TONE: Record<AttentionKind, { bg: string; fg: string; ring: string }> = {
  stale_disputed: { bg: "bg-sky-50", fg: "text-sky-700", ring: "ring-sky-200" },
  disputed_recoups_but_signed: { bg: "bg-rose-50", fg: "text-rose-700", ring: "ring-rose-200" },
  show_settled_no_settlement: { bg: "bg-amber-50", fg: "text-amber-700", ring: "ring-amber-200" },
  notes_say_closed_but_status_open: { bg: "bg-amber-50", fg: "text-amber-700", ring: "ring-amber-200" },
  expense_overrun: { bg: "bg-amber-50", fg: "text-amber-700", ring: "ring-amber-200" },
};

export default function InsightsPage() {
  const state = useApiData(() => api.insights(), []);

  if (state.status === "loading")
    return (
      <section className="px-12 py-10 max-w-[1280px]">
        <div className="eyebrow text-[10px] text-brand-700 mb-2">
          Deal anatomy · qualitative
        </div>
        <h1 className="text-4xl font-serif text-ink-900 mb-2 tracking-tight">Insights</h1>
        <p className="text-[14px] text-ink-600 max-w-2xl mb-6 leading-relaxed">
          Same Deal type × deal size grid as Deal Analysis, but each cell names the dominant
          friction kind for those deals and clusters the actual recurring complaints behind it.
        </p>
        <GuaranteeBacktestSection />
        <SwitchSavingsSection />
        <SgpFlatRepricingSection />
        <BeforeAfterCrossTabSection />
        <SwitchProjectedGridSection />
        <LoadingState label="Clustering complaint themes... this can take a minute on first load." />
      </section>
    );
  if (state.status === "error")
    return <LoadingState label={`Error: ${state.error.message}`} />;

  const data = state.data;
  const activeBuckets = data.buckets.filter((b) =>
    data.cells.some((c) => c.bucket === b),
  );
  const cellByKey = new Map(
    data.cells.map((c) => [`${c.dealType}|${c.bucket}`, c]),
  );

  const coverage = data.enrichmentCoverage;
  const coveragePct = coverage.total > 0
    ? Math.round((coverage.withSummary / coverage.total) * 100)
    : 0;

  return (
    <section className="px-12 py-10 max-w-[1280px]">
      <div className="eyebrow text-[10px] text-brand-700 mb-2">
        Deal anatomy · qualitative
      </div>
      <h1 className="text-4xl font-serif text-ink-900 mb-2 tracking-tight">
        Insights
      </h1>
      <p className="text-[14px] text-ink-600 max-w-2xl mb-1 leading-relaxed">
        Same Deal type × deal size grid as Deal Analysis, but each cell
        names the dominant friction kind for those deals and clusters the
        actual recurring complaints behind it.
      </p>
      <p className="text-[12px] text-ink-400 mb-6">
        Per-deal positive/negative summaries from <span className="font-mono tabular">{coverage.withSummary}</span> of{" "}
        <span className="font-mono tabular">{coverage.total}</span> settlements ({coveragePct}%) — call{" "}
        <code className="text-[11px] bg-ink-50 px-1 py-0.5 rounded">POST /api/insights/enrich</code>{" "}
        to extend coverage.
      </p>

      <TakeActionPanel />

      <ExpenseFrictionSection />

      <CalibrationSection variant="insights" />

      <GuaranteeBacktestSection />
      <SwitchSavingsSection />
      <SgpFlatRepricingSection />
      <BeforeAfterCrossTabSection />
      <SwitchProjectedGridSection />

      <Card>
        <CardContent>
          <div className="flex items-baseline justify-between mb-5">
            <div className="eyebrow text-[10px] text-ink-500">
              Top friction kind · top 5 complaint themes
            </div>
            <div className="text-[10px] text-ink-400 flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-violet-500" />
              themes clustered by Anthropic
            </div>
          </div>

          <table className="w-full text-[12px] border-separate border-spacing-y-2">
            <thead>
              <tr className="text-left">
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold pr-3 align-bottom">
                  Deal type
                </th>
                {activeBuckets.map((b) => (
                  <th
                    key={b}
                    className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-left align-bottom"
                  >
                    {b}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.dealTypes.map((dt) => (
                <tr key={dt} className="align-top">
                  <td className="py-2 pr-3 align-top w-[110px]">
                    <div className="text-ink-900 font-medium text-[12px] leading-tight pt-2">
                      {DEAL_LABELS[dt] ?? dt}
                    </div>
                  </td>
                  {activeBuckets.map((b) => (
                    <td key={b} className="px-1.5 align-top">
                      <CellBox cell={cellByKey.get(`${dt}|${b}`) ?? null} dt={dt} bucket={b} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </section>
  );
}

function TakeActionPanel() {
  return (
    <Card className="mb-6">
      <CardContent>
        <div className="flex items-baseline justify-between mb-1">
          <div className="flex items-center gap-2">
            <ArrowUpRight className="h-4 w-4 text-brand-700" />
            <h2 className="text-[15px] font-semibold text-ink-900">
              Take action on upcoming deals
            </h2>
          </div>
          <span className="eyebrow text-[10px] text-ink-400">jump to a focused worklist</span>
        </div>
        <p className="text-[12px] text-ink-500 mb-4 leading-relaxed">
          Everything below shows what these two engines would have done historically. To act
          on the same opportunity for upcoming shows, jump to one of the two filtered
          worklists — each opens Shows narrowed to deals where exactly that action applies.
          Caps-only structural improvements appear inline on each individual show's deal
          panel rather than as a separate worklist.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <ActionLinkCard
            href="/shows?action=switch"
            tone="brand"
            icon={<Shield className="h-3.5 w-3.5" />}
            title="Smart Switch"
            blurb="Upcoming vs / % of net deals in $1–5K. Smart Switch proposes a clean flat (or door-hybrid) at the same expected payout."
            cta="Open Smart Switch worklist"
          />
          <ActionLinkCard
            href="/shows?action=switch_door"
            tone="brand"
            icon={<Shield className="h-3.5 w-3.5" />}
            title="Smart Switch — Door"
            blurb="Upcoming door deals. Smart Switch proposes a door-hybrid (floor + capped split) so settlement night isn't a recoup argument."
            cta="Open door worklist"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ActionLinkCard({
  href, tone, icon, title, blurb, cta,
}: {
  href: string;
  tone: "emerald" | "brand";
  icon: React.ReactNode;
  title: string;
  blurb: string;
  cta: string;
}) {
  const ring = tone === "emerald"
    ? "ring-emerald-200/60 bg-emerald-50/40 hover:bg-emerald-50/70"
    : "ring-brand-200/60 bg-brand-50/40 hover:bg-brand-50/70";
  const accent = tone === "emerald" ? "text-emerald-700" : "text-brand-700";
  return (
    <Link
      href={href}
      className={`group rounded-md ring-1 p-3 transition-colors flex flex-col ${ring}`}
    >
      <div className={`flex items-center gap-1.5 eyebrow text-[10px] mb-1 ${accent}`}>
        {icon}
        {title}
      </div>
      <p className="text-[11.5px] text-ink-600 leading-relaxed mb-3 flex-1">{blurb}</p>
      <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${accent} group-hover:underline underline-offset-2`}>
        {cta}
        <ArrowUpRight className="h-3 w-3" />
      </span>
    </Link>
  );
}

function fmtMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(Math.round(n));
  if (v >= 1000) return `${sign}$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K`;
  return `${sign}$${v.toLocaleString()}`;
}

function fmtMinutes(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const TIER_TONE: Record<string, string> = {
  A: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  B: "bg-sky-50 text-sky-700 ring-sky-200",
  C: "bg-amber-50 text-amber-700 ring-amber-200",
  D: "bg-ink-50 text-ink-600 ring-ink-200",
};

const SHAPE_LABEL: Record<string, string> = {
  flat: "Flat",
  door_hybrid: "Door hybrid",
};

const DEAL_TYPE_LABEL: Record<string, string> = {
  vs: "Vs",
  percentage_of_net: "% of net",
  door: "Door",
};

const SAVINGS_WINDOW_OPTIONS: { label: string; months: number }[] = [
  { label: "3 mo", months: 3 },
  { label: "6 mo", months: 6 },
  { label: "12 mo", months: 12 },
  { label: "All", months: 600 },
];
const SAVINGS_TOPN_OPTIONS = [10, 25, 50];

function SwitchSavingsSection() {
  const [months, setMonths] = useState(3);
  const [topN, setTopN] = useState(10);
  const state = useApiData(() => api.switchSavings(months, topN), [months, topN]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [explainerOpen, setExplainerOpen] = useState(false);

  if (state.status === "loading")
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="text-[12px] text-ink-400">Loading Smart Switch savings…</div>
        </CardContent>
      </Card>
    );
  if (state.status === "error")
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="text-[12px] text-rose-600">
            Couldn't load savings: {state.error.message}
          </div>
        </CardContent>
      </Card>
    );

  const data = state.data;
  if (data.items.length === 0) {
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="flex items-center gap-2 mb-1">
            <Shield className="h-4 w-4 text-brand-700" />
            <span className="eyebrow text-[10px] text-ink-500">
              Smart Switch · last {data.windowMonths} months
            </span>
          </div>
          <div className="text-[13px] text-ink-500">
            No vs / % of net / door deals settled in the last {data.windowMonths} months — nothing
            for Smart Switch to compare against.
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalDollars = data.totalMoneySavedToVenue;
  const totalMins = data.totalMinutesSaved;

  return (
    <Card className="mb-6">
      <CardContent>
        <div className="flex items-baseline justify-between mb-1">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-brand-700" />
            <h2 className="text-[15px] font-semibold text-ink-900">
              Smart Switch could have helped
            </h2>
            <span className="eyebrow text-[10px] text-ink-400">
              · last {data.windowMonths === 600 ? "all time" : `${data.windowMonths} months`}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1" role="group" aria-label="Time window">
              {SAVINGS_WINDOW_OPTIONS.map((opt) => (
                <button
                  key={opt.months}
                  type="button"
                  onClick={() => setMonths(opt.months)}
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono ring-1 transition-colors ${
                    months === opt.months
                      ? "bg-brand-50 text-brand-700 ring-brand-200"
                      : "bg-white text-ink-500 ring-ink-200 hover:bg-ink-50"
                  }`}
                  aria-pressed={months === opt.months}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1" role="group" aria-label="Rows shown">
              {SAVINGS_TOPN_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setTopN(n)}
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono ring-1 transition-colors ${
                    topN === n
                      ? "bg-brand-50 text-brand-700 ring-brand-200"
                      : "bg-white text-ink-500 ring-ink-200 hover:bg-ink-50"
                  }`}
                  aria-pressed={topN === n}
                >
                  Top {n}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-ink-400 font-mono tabular">
              {data.items.length} of {data.totalCandidates}
            </div>
          </div>
        </div>
        <p className="text-[12px] text-ink-500 mb-4 leading-relaxed">
          Past settled <span className="font-mono">vs / % of net / door</span> deals re-scored
          against the Smart Switch counterfactual. Money is venue payout delta; time is a
          back-of-the-envelope estimate from recoups + sign-off thread length.
        </p>

        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="rounded-md ring-1 ring-emerald-200/60 bg-emerald-50/40 p-3">
            <div className="flex items-center gap-1.5 eyebrow text-[10px] text-emerald-700 mb-1">
              <DollarSign className="h-3 w-3" />
              Money saved
            </div>
            <div className="text-[22px] font-serif text-ink-900 tabular">
              {fmtMoney(totalDollars)}
            </div>
            <div className="text-[10px] text-ink-400">
              cumulative venue-side payout reduction across all {data.totalCandidates} candidate deals
            </div>
          </div>
          <div className="rounded-md ring-1 ring-sky-200/60 bg-sky-50/40 p-3">
            <div className="flex items-center gap-1.5 eyebrow text-[10px] text-sky-700 mb-1">
              <Clock className="h-3 w-3" />
              Time saved
            </div>
            <div className="text-[22px] font-serif text-ink-900 tabular">
              {fmtMinutes(totalMins)}
            </div>
            <div className="text-[10px] text-ink-400">
              fewer minutes on settlement-night arithmetic across all {data.totalCandidates} deals
            </div>
          </div>
          <div
            className="rounded-md ring-1 ring-amber-200/60 bg-amber-50/40 p-3"
            title="Scoped to settled vs deals with a guarantee in $1–5K (the bucket Smart Switch covers): how often the percentage clause out-paid the guarantee. ‘Never fired’ = artist was paid the guarantee floor and the % upside produced nothing extra."
          >
            <div className="flex items-center gap-1.5 eyebrow text-[10px] text-amber-700 mb-1">
              <Shield className="h-3 w-3" />
              Vs % clause never fired ($1–5K)
            </div>
            <div className="text-[22px] font-serif text-ink-900 tabular">
              {data.vsPercentageFiredStats && data.vsPercentageFiredStats.vsDealsScanned > 0
                ? `${(data.vsPercentageFiredStats.vsPercentageNeverFiredRate * 100).toFixed(1)}%`
                : "—"}
            </div>
            <div className="text-[10px] text-ink-400">
              {data.vsPercentageFiredStats
                ? `${data.vsPercentageFiredStats.vsPercentageNeverFired} of ${data.vsPercentageFiredStats.vsDealsScanned} settled vs $1–5K deals · avg guarantee-win $${data.vsPercentageFiredStats.avgGuaranteeWin.toLocaleString()}`
                : "data unavailable"}
            </div>
          </div>
        </div>

        <SavingsExplainer
          open={explainerOpen}
          onToggle={() => setExplainerOpen((v) => !v)}
          example={data.items[0] ?? null}
          totalMoney={totalDollars}
          totalMinutes={totalMins}
          itemCount={data.items.length}
        />

        <ul className="space-y-1.5">
          {data.items.map((it) => (
            <SavingsRow
              key={it.showId}
              item={it}
              expanded={expandedId === it.showId}
              onToggle={() =>
                setExpandedId(expandedId === it.showId ? null : it.showId)
              }
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function SavingsExplainer({
  open,
  onToggle,
  example,
  totalMoney,
  totalMinutes,
  itemCount,
}: {
  open: boolean;
  onToggle: () => void;
  example: SwitchSavingsItem | null;
  totalMoney: number;
  totalMinutes: number;
  itemCount: number;
}) {
  return (
    <div className="mb-5 rounded-md ring-1 ring-ink-200/60 bg-ink-50/40">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-ink-100/50 rounded-md transition-colors"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 text-ink-400 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <Calculator className="h-3.5 w-3.5 text-brand-700 shrink-0" />
        <span className="text-[12px] text-ink-700 font-medium">
          If Smart Switch + Improve Deal had been used — where do these numbers come from?
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 text-[11.5px] text-ink-700 leading-relaxed">
          <div>
            <div className="eyebrow text-[10px] text-ink-500 mb-1">Money saved · per row</div>
            <div className="font-mono tabular text-[11px] bg-white rounded ring-1 ring-ink-200/60 px-2 py-1.5 inline-block">
              moneySaved = actualPaidToArtist − counterfactualSwitchPayout
            </div>
            <div className="mt-1.5 text-ink-600">
              <span className="font-semibold text-ink-900">Smart Switch is the only engine
              driving this number.</span> For each past-dated, settled{" "}
              <span className="font-mono">vs / % of net / door</span> deal in the window, we re-run
              the Smart Switch engine against the original deal terms and replace the variable
              payout with its output:
              <ul className="list-disc pl-5 mt-1 space-y-0.5">
                <li>
                  <span className="font-mono">flat</span> shape →{" "}
                  <span className="font-mono">suggestedFlat</span>
                </li>
                <li>
                  <span className="font-mono">door_hybrid</span> shape →{" "}
                  <span className="font-mono">floor + split × max(0, 0.9·gross − cap)</span>{" "}
                  (floor / split / cap all come from the Smart Switch suggestion, not the
                  original deal)
                </li>
              </ul>
            </div>
          </div>

          <div>
            <div className="eyebrow text-[10px] text-ink-500 mb-1">Where Improve Deal fits in</div>
            <div className="text-ink-600">
              <span className="font-semibold text-ink-900">Improve Deal</span> only emits structural
              caps (expense cap, hospitality cap), and the savings counterfactual above never
              consumes those caps — so Improve Deal doesn't move this dollar number directly. Its
              effect lives in <span className="font-semibold">Time saved</span>: a pre-agreed cap
              eliminates most of the recoup arithmetic and the sign-off back-and-forth that the
              time estimate is built from.
            </div>
          </div>

          <div>
            <div className="eyebrow text-[10px] text-ink-500 mb-1">Time saved · formula</div>
            <div className="font-mono tabular text-[11px] bg-white rounded ring-1 ring-ink-200/60 px-2 py-1.5 inline-block whitespace-pre-wrap">
              {`minutesSaved =
  (30 baseline
   + 25·disputedRecoups
   + 5·(notesParagraphs + signoffParagraphs)
   + 60·formalDispute)
  − (10 flat | 15 hybrid)`}
            </div>
            <div className="mt-1.5 text-ink-600">
              Verbose notes / sign-off threads and disputed recoup lines are proxies for the
              negotiation that a pre-agreed Smart Switch deal wouldn't have triggered. Both note
              and sign-off paragraph counts are summed before the 5-min multiplier.
            </div>
          </div>

          {example && (
            <div className="rounded-md ring-1 ring-emerald-200/60 bg-emerald-50/40 p-3">
              <div className="eyebrow text-[10px] text-emerald-700 mb-1">
                Worked example · top row ({example.artistName ?? "—"} · {example.date})
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono tabular">
                <div className="text-ink-500">Actual payout</div>
                <div className="text-right text-ink-900">{fmtMoney(example.actualToArtist)}</div>
                <div className="text-ink-500">
                  Counterfactual ({SHAPE_LABEL[example.switchShape]?.toLowerCase() ?? example.switchShape})
                </div>
                <div className="text-right text-ink-900">{fmtMoney(example.counterfactualToArtist)}</div>
                <div className="text-emerald-700 font-semibold border-t border-emerald-200/60 pt-0.5">
                  Money saved
                </div>
                <div className="text-right text-emerald-700 font-semibold border-t border-emerald-200/60 pt-0.5">
                  {example.moneySavedToVenue >= 0 ? "+" : ""}
                  {fmtMoney(example.moneySavedToVenue)}
                </div>
                <div className="text-ink-500 pt-1">Settlement-night minutes (actual)</div>
                <div className="text-right text-ink-900 pt-1">
                  {example.estimatedMinutesSpent} min
                </div>
                <div className="text-ink-500">Under Smart Switch</div>
                <div className="text-right text-ink-900">
                  {example.estimatedMinutesUnderSwitch} min
                </div>
                <div className="text-sky-700 font-semibold border-t border-sky-200/60 pt-0.5">
                  Time saved
                </div>
                <div className="text-right text-sky-700 font-semibold border-t border-sky-200/60 pt-0.5">
                  {fmtMinutes(example.minutesSaved)}
                </div>
              </div>
              <div className="mt-2 text-[11px] text-ink-600 leading-relaxed">
                {example.breakdown.moneyRationale}
              </div>
            </div>
          )}

          <div className="text-[11px] text-ink-500 border-t border-ink-200/60 pt-2.5">
            Headline tiles roll up <span className="font-semibold">every</span> candidate deal in
            the window — not just the top {itemCount} rows shown below: cumulative money saved is{" "}
            <span className="font-mono tabular text-ink-700">{fmtMoney(totalMoney)}</span>, time
            saved is{" "}
            <span className="font-mono tabular text-ink-700">{fmtMinutes(totalMinutes)}</span>.
            The list below is sorted by money saved desc and truncated to Top-N for readability.
            Adjust the time-window and Top-N controls above to expand the window. Only past-dated,
            settled rows are eligible — future-dated proposals (NEW DEMO upcoming shows) never enter
            the calc.
          </div>
        </div>
      )}
    </div>
  );
}

function SavingsRow({
  item,
  expanded,
  onToggle,
}: {
  item: SwitchSavingsItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const tierClass = TIER_TONE[item.confidenceTier] ?? TIER_TONE.D;
  const moneyPositive = item.moneySavedToVenue > 0;
  return (
    <li className="rounded-md ring-1 ring-ink-200/60 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-ink-50/60 rounded-md transition-colors"
        aria-expanded={expanded}
      >
        <ChevronRight
          className={`h-3.5 w-3.5 text-ink-400 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-ink-900 truncate">
              {item.artistName ?? "—"}
            </span>
            <span className="text-[10px] font-mono tabular text-ink-400">{item.date}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink-50 text-ink-600 ring-1 ring-ink-200">
              {DEAL_TYPE_LABEL[item.dealType] ?? item.dealType} → {SHAPE_LABEL[item.switchShape]}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono ring-1 ${tierClass}`}
              title="Confidence tier"
            >
              Tier {item.confidenceTier}
            </span>
            {item.hadDispute && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 ring-1 ring-rose-200">
                disputed
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <div
              className={`text-[13px] font-mono tabular font-semibold ${moneyPositive ? "text-emerald-700" : "text-ink-500"}`}
            >
              {moneyPositive ? "+" : ""}
              {fmtMoney(item.moneySavedToVenue)}
            </div>
            <div className="text-[9px] text-ink-400 uppercase tracking-[0.06em]">money</div>
          </div>
          <div className="text-right">
            <div className="text-[13px] font-mono tabular font-semibold text-sky-700">
              {fmtMinutes(item.minutesSaved)}
            </div>
            <div className="text-[9px] text-ink-400 uppercase tracking-[0.06em]">time</div>
          </div>
        </div>
      </button>

      {expanded && <SavingsBreakdown item={item} />}
    </li>
  );
}

function SavingsBreakdown({ item }: { item: SwitchSavingsItem }) {
  const a = item.breakdown.actual;
  const c = item.breakdown.counterfactual;
  return (
    <div className="border-t border-ink-200/50 px-3 py-3 bg-ink-50/30 rounded-b-md text-[12px] leading-relaxed space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded ring-1 ring-ink-200/60 bg-white p-2.5">
          <div className="eyebrow text-[10px] text-ink-500 mb-1.5">What actually happened</div>
          <div className="font-mono tabular text-[11px] text-ink-700 space-y-0.5">
            <div className="flex justify-between">
              <span>Gross box office</span>
              <span>${a.gross.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Expenses</span>
              <span>${a.expenses.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Recoups ({a.recoupLines.length})</span>
              <span>${a.recoupTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between font-semibold text-ink-900 pt-1 border-t border-ink-200/60 mt-1">
              <span>Paid to artist</span>
              <span>${a.payout.toLocaleString()}</span>
            </div>
            <div className="text-[10px] text-ink-400 pt-1">
              Settlement status: <span className="font-medium">{a.settlementStatus}</span>
            </div>
          </div>
          {a.recoupLines.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {a.recoupLines.slice(0, 4).map((rl, i) => (
                <li
                  key={i}
                  className="text-[10.5px] flex justify-between gap-2 truncate"
                  title={rl.label}
                >
                  <span
                    className={`truncate ${rl.status === "disputed" ? "text-rose-700" : "text-ink-500"}`}
                  >
                    {rl.status === "disputed" ? "✗ " : "· "}
                    {rl.label}
                  </span>
                  <span className="font-mono tabular text-ink-500 shrink-0">
                    ${rl.amount.toLocaleString()}
                  </span>
                </li>
              ))}
              {a.recoupLines.length > 4 && (
                <li className="text-[10px] text-ink-400 italic">
                  +{a.recoupLines.length - 4} more
                </li>
              )}
            </ul>
          )}
        </div>
        <div className="rounded ring-1 ring-brand-200 bg-brand-50/30 p-2.5">
          <div className="eyebrow text-[10px] text-brand-700 mb-1.5">
            Smart Switch counterfactual
          </div>
          <div className="font-mono tabular text-[11px] text-ink-700 space-y-0.5">
            <div className="flex justify-between">
              <span>Shape</span>
              <span>{SHAPE_LABEL[c.shape]}</span>
            </div>
            {c.shape === "flat" ? (
              <div className="flex justify-between">
                <span>Suggested flat</span>
                <span>${(c.flat ?? 0).toLocaleString()}</span>
              </div>
            ) : (
              <>
                <div className="flex justify-between">
                  <span>Floor</span>
                  <span>${(c.doorFloor ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Split above cap</span>
                  <span>{Math.round((c.doorSplitPct ?? 0) * 100)}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Expense cap</span>
                  <span>${(c.doorExpenseCap ?? 0).toLocaleString()}</span>
                </div>
              </>
            )}
            <div className="flex justify-between font-semibold text-ink-900 pt-1 border-t border-brand-200/60 mt-1">
              <span>Projected payout</span>
              <span>${c.projectedPayout.toLocaleString()}</span>
            </div>
          </div>
          <div className="text-[10.5px] text-ink-600 mt-2 leading-snug">{c.basis}</div>
        </div>
      </div>

      <div className="rounded ring-1 ring-ink-200/60 bg-white p-2.5">
        <div className="eyebrow text-[10px] text-ink-500 mb-1">Why money</div>
        <div className="text-[11.5px] text-ink-700">{item.breakdown.moneyRationale}</div>
      </div>

      <div className="rounded ring-1 ring-ink-200/60 bg-white p-2.5">
        <div className="eyebrow text-[10px] text-ink-500 mb-1">Why time</div>
        <div className="text-[11.5px] text-ink-700">{item.breakdown.timeSavedRationale}</div>
        <div className="mt-1.5 text-[10.5px] text-ink-500 font-mono tabular">
          ~{item.estimatedMinutesSpent} min actual → ~{item.estimatedMinutesUnderSwitch} min under
          Smart Switch = <span className="text-sky-700 font-semibold">{fmtMinutes(item.minutesSaved)}</span> saved
        </div>
      </div>

      <div className="text-right">
        <Link
          href={`/shows/${item.showId}`}
          className="inline-flex items-center gap-1 text-[11px] text-brand-700 hover:text-brand-800 font-medium"
        >
          Open show <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

const PROJ_DEAL_LABEL: Record<string, string> = {
  vs: "Vs",
  percentage_of_net: "% of net",
  door: "Door",
  flat: "Flat",
  percentage_of_gross: "% of gross",
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function deltaPts(actual: number, projected: number): number {
  return Math.round((actual - projected) * 100);
}

function BeforeAfterCrossTabSection() {
  const state = useApiData(() => api.switchProjectedGrid(600), []);
  const [, setLocation] = useLocation();

  if (state.status === "loading")
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="text-[12px] text-ink-400">Loading before/after cross-tab…</div>
        </CardContent>
      </Card>
    );
  if (state.status === "error")
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="text-[12px] text-rose-600">
            Couldn't load before/after cross-tab: {state.error.message}
          </div>
        </CardContent>
      </Card>
    );

  const data = state.data;
  if (data.cells.length === 0) {
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="flex items-center gap-2 mb-1">
            <Shield className="h-4 w-4 text-brand-700" />
            <span className="eyebrow text-[10px] text-ink-500">
              Before vs after · all deals
            </span>
          </div>
          <div className="text-[13px] text-ink-500">
            No deals in this window — nothing to compare.
          </div>
        </CardContent>
      </Card>
    );
  }

  const cellByKey = new Map(
    data.cells.map((c) => [`${c.dealType}|${c.bucket}`, c]),
  );
  const activeBuckets = data.buckets.filter((b) =>
    data.cells.some((c) => c.bucket === b && c.count > 0),
  );

  return (
    <Card className="mb-6">
      <CardContent>
        <div className="flex items-baseline justify-between mb-1">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-brand-700" />
            <h2 className="text-[15px] font-semibold text-ink-900">
              Performance — actual vs Smart Switch + Improve Deal projection
            </h2>
            <span className="eyebrow text-[10px] text-ink-400">
              · all {data.totalCandidates} deals
            </span>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-ink-400">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm bg-rose-500/80" />
              losing money
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm bg-amber-500/80" />
              disputed
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm bg-violet-500/80" />
              needs attention
            </span>
          </div>
        </div>
        <p className="text-[12px] text-ink-500 mb-5 leading-relaxed">
          The same Deal type × deal size grid as Deal Analysis, shown twice:{" "}
          <strong className="text-ink-700">Before</strong> = what actually settled.{" "}
          <strong className="text-ink-700">After</strong> = the same nights, recomputed under whichever
          engine applies. Door (any size) and vs / % of net in $1–5K get a{" "}
          <strong className="text-brand-700">Smart Switch</strong> counterfactual (flat or door-hybrid).
          vs / % of net outside $1–5K and % of gross are{" "}
          <strong className="text-emerald-700">Improve Deal</strong> territory — the engine would have
          redrafted caps or proposed a flat at proposal time, but we don't backtest payouts on
          already-signed deals, so the "after" cell mirrors actual. Flat deals have no engine and
          are left untouched.
        </p>

        <BeforeAfterGrid
          variant="actual"
          dealTypes={data.dealTypes}
          buckets={activeBuckets}
          cellByKey={cellByKey}
          onCellClick={(dt, b) => {
            const params = new URLSearchParams({ dealType: dt, size: b });
            setLocation(`/shows?${params.toString()}`);
          }}
        />

        <div className="my-4 flex items-center gap-3">
          <div className="h-px bg-ink-200/60 flex-1" />
          <span className="eyebrow text-[10px] text-brand-700 font-semibold">
            ↓ recomputed under Smart Switch + SGP
          </span>
          <div className="h-px bg-ink-200/60 flex-1" />
        </div>

        <BeforeAfterGrid
          variant="projected"
          dealTypes={data.dealTypes}
          buckets={activeBuckets}
          cellByKey={cellByKey}
          onCellClick={(dt, b) => {
            const params = new URLSearchParams({ dealType: dt, size: b });
            setLocation(`/shows?${params.toString()}`);
          }}
        />

        <div className="grid grid-cols-4 gap-3 mt-5">
          <BAStatCard
            label="Loss-making nights avoided"
            value={String(data.totalLosingMoneyAvoided)}
            tone={data.totalLosingMoneyAvoided >= 0 ? "emerald" : "rose"}
          />
          <BAStatCard
            label="Disputes avoided"
            value={String(data.totalDisputesAvoided)}
            tone="emerald"
          />
          <BAStatCard
            label="Attention items avoided"
            value={String(data.totalAttentionAvoided)}
            tone="emerald"
          />
          <BAStatCard
            label="Money kept by venue"
            value={fmtMoney(data.totalMoneySavedToVenue)}
            tone={data.totalMoneySavedToVenue >= 0 ? "emerald" : "rose"}
          />
        </div>

        <p className="text-[11px] text-ink-400 mt-3 leading-relaxed">
          Each cell shows count of deals (n=), then losing-money rate · dispute rate ·
          needs-attention rate. Thresholds: ≥50% losing money (red), ≥10% disputed (amber), ≥10%
          needs attention (violet). Projected disputes/attention assumed to drop to 0 for switched
          deals (pre-agreed terms eliminate recoup arithmetic). Click a cell to see the underlying
          shows.
        </p>
      </CardContent>
    </Card>
  );
}

function BeforeAfterGrid({
  variant,
  dealTypes,
  buckets,
  cellByKey,
  onCellClick,
}: {
  variant: "actual" | "projected";
  dealTypes: string[];
  buckets: string[];
  cellByKey: Map<string, SwitchProjectedCell>;
  onCellClick: (dt: string, b: string) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <span
          className={`eyebrow text-[10px] font-semibold ${
            variant === "actual" ? "text-ink-600" : "text-brand-700"
          }`}
        >
          {variant === "actual" ? "Before · actual settlements" : "After · under Smart Switch + SGP"}
        </span>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left border-b border-ink-100/80">
            <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold w-[110px]">
              Deal type
            </th>
            {buckets.map((b) => (
              <th
                key={b}
                className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-center"
              >
                {b}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100/60">
          {dealTypes.map((dt) => (
            <tr key={dt} className="align-middle">
              <td className="py-2.5 pr-3">
                <span className="text-ink-900 font-medium">
                  {DEAL_LABELS[dt] ?? dt}
                </span>
              </td>
              {buckets.map((b) => {
                const cell = cellByKey.get(`${dt}|${b}`);
                if (!cell || cell.count === 0) {
                  return (
                    <td
                      key={b}
                      className="py-2.5 px-2 text-center text-ink-300 font-mono tabular text-[11px]"
                    >
                      —
                    </td>
                  );
                }
                const losingRate =
                  variant === "actual" ? cell.actualLosingRate : cell.projectedLosingRate;
                const disputeRate =
                  variant === "actual" ? cell.actualDisputeRate : cell.projectedDisputeRate;
                const attentionRate =
                  variant === "actual"
                    ? cell.actualAttentionRate
                    : cell.projectedAttentionRate;
                const losingN =
                  variant === "actual" ? cell.actualLosingMoney : cell.projectedLosingMoney;
                const disputeN =
                  variant === "actual" ? cell.actualDisputed : cell.projectedDisputed;
                const attentionN =
                  variant === "actual" ? cell.actualAttention : cell.projectedAttention;

                const losingHot = losingRate >= 0.5;
                const disputeHot = disputeRate >= 0.1;
                const attentionHot = attentionRate >= 0.1;

                const muted = variant === "projected" && !cell.switchApplies;

                const title = `${cell.count} deals · ${losingN} losing money · ${disputeN} disputed · ${attentionN} needs attention${
                  variant === "projected" && !cell.switchApplies
                    ? cell.dealType === "flat"
                      ? " (flat deal — no engine applies, projection = actual)"
                      : " (Improve Deal territory — would redraft at proposal time; not backtested on signed deals)"
                    : ""
                }`;
                return (
                  <td
                    key={b}
                    onClick={() => onCellClick(dt, b)}
                    className={`py-2 px-2 cursor-pointer transition-colors ${
                      muted ? "bg-ink-50/30 hover:bg-ink-50/60" : "hover:bg-brand-50/40"
                    }`}
                    title={title}
                  >
                    <div className="text-center">
                      <div className="text-[10px] font-mono tabular text-ink-400 mb-0.5">
                        n={cell.count}
                      </div>
                      <div className="flex items-center justify-center gap-1.5">
                        <span
                          className={`font-mono tabular text-[12px] ${
                            losingHot ? "text-rose-700 font-semibold" : "text-ink-700"
                          } ${muted ? "opacity-50" : ""}`}
                          title="Losing money rate"
                        >
                          {`${(losingRate * 100).toFixed(0)}%`}
                        </span>
                        <span className="text-ink-300">·</span>
                        <span
                          className={`font-mono tabular text-[12px] ${
                            disputeHot ? "text-amber-700 font-semibold" : "text-ink-500"
                          } ${muted ? "opacity-50" : ""}`}
                          title="Dispute rate"
                        >
                          {`${(disputeRate * 100).toFixed(0)}%`}
                        </span>
                        <span className="text-ink-300">·</span>
                        <span
                          className={`font-mono tabular text-[12px] ${
                            attentionHot ? "text-violet-700 font-semibold" : "text-ink-500"
                          } ${muted ? "opacity-50" : ""}`}
                          title="Needs-attention rate"
                        >
                          {`${(attentionRate * 100).toFixed(0)}%`}
                        </span>
                      </div>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BAStatCard({ label, value, tone }: { label: string; value: string; tone: "emerald" | "rose" }) {
  const ring = tone === "emerald" ? "ring-emerald-200/60 bg-emerald-50/40" : "ring-rose-200/60 bg-rose-50/40";
  const eyeb = tone === "emerald" ? "text-emerald-700" : "text-rose-700";
  return (
    <div className={`rounded-md ring-1 p-3 ${ring}`}>
      <div className={`eyebrow text-[10px] mb-1 ${eyeb}`}>{label}</div>
      <div className="text-[18px] font-serif text-ink-900 tabular">{value}</div>
    </div>
  );
}

function SwitchProjectedGridSection() {
  const state = useApiData(() => api.switchProjectedGrid(12), []);
  const [explainerOpen, setExplainerOpen] = useState(false);

  if (state.status === "loading")
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="text-[12px] text-ink-400">Loading projected grid…</div>
        </CardContent>
      </Card>
    );
  if (state.status === "error")
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="text-[12px] text-rose-600">
            Couldn't load projected grid: {state.error.message}
          </div>
        </CardContent>
      </Card>
    );

  const data = state.data;
  if (data.cells.length === 0) {
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="flex items-center gap-2 mb-1">
            <Shield className="h-4 w-4 text-brand-700" />
            <span className="eyebrow text-[10px] text-ink-500">
              Projected grid · last {data.windowMonths} months
            </span>
          </div>
          <div className="text-[13px] text-ink-500">
            No non-flat deals settled in this window — nothing to project.
          </div>
        </CardContent>
      </Card>
    );
  }

  const cellByKey = new Map(
    data.cells.map((c) => [`${c.dealType}|${c.bucket}`, c]),
  );

  return (
    <Card className="mb-6">
      <CardContent>
        <div className="flex items-baseline justify-between mb-1">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-brand-700" />
            <h2 className="text-[15px] font-semibold text-ink-900">
              If Smart Switch + Improve Deal had been used
            </h2>
            <span className="eyebrow text-[10px] text-ink-400">
              · last {data.windowMonths} months · projected grid
            </span>
          </div>
          <div className="text-[11px] text-ink-400 font-mono tabular">
            {data.totalDealsModelled} of {data.totalCandidates} deals modelled
          </div>
        </div>
        <p className="text-[12px] text-ink-500 mb-3 leading-relaxed">
          The Deal Analysis cross-tab, recomputed with each Smart-Switch-eligible settled deal
          (door any size, or vs / % of net in $1–5K) replaced by its Switch counterfactual.{" "}
          <span className="font-mono">losing</span> re-derived from the projected payout;{" "}
          <span className="font-mono">disputed</span> and <span className="font-mono">attention</span>{" "}
          assumed to drop to 0 (pre-agreed terms eliminate recoup arithmetic, which is what every
          settlement-flow attention kind in this app traces back to). vs / % of net outside $1–5K
          and % of gross are Improve Deal territory and shown muted — Improve Deal would redraft
          caps or propose a flat at proposal time, but isn't backtested on already-signed deals here.
        </p>

        <ProjectedExplainer
          open={explainerOpen}
          onToggle={() => setExplainerOpen((v) => !v)}
          data={data}
        />

        <div className="grid grid-cols-4 gap-3 mb-5">
          <ProjStatCard label="Money saved" value={fmtMoney(data.totalMoneySavedToVenue)} tone="emerald" />
          <ProjStatCard label="Loss-making nights avoided" value={String(data.totalLosingMoneyAvoided)} tone="emerald" />
          <ProjStatCard label="Disputes avoided" value={String(data.totalDisputesAvoided)} tone="emerald" />
          <ProjStatCard label="Attention items avoided" value={String(data.totalAttentionAvoided)} tone="emerald" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[11px] border-separate border-spacing-y-1.5">
            <thead>
              <tr className="text-left">
                <th className="py-1.5 eyebrow text-[10px] text-ink-400 font-semibold pr-3 align-bottom w-[110px]">
                  Deal type
                </th>
                {data.buckets.map((b) => (
                  <th
                    key={b}
                    className="py-1.5 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-left align-bottom"
                  >
                    {b}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.dealTypes.map((dt) => (
                <tr key={dt} className="align-top">
                  <td className="py-1.5 pr-3 align-top">
                    <div className="text-ink-900 font-medium text-[12px] leading-tight pt-2">
                      {PROJ_DEAL_LABEL[dt] ?? dt}
                    </div>
                  </td>
                  {data.buckets.map((b) => (
                    <td key={b} className="px-1 align-top">
                      <ProjCellBox cell={cellByKey.get(`${dt}|${b}`) ?? null} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectedExplainer({
  open,
  onToggle,
  data,
}: {
  open: boolean;
  onToggle: () => void;
  data: {
    windowMonths: number;
    totalDealsModelled: number;
    totalCandidates: number;
    totalMoneySavedToVenue: number;
    totalLosingMoneyAvoided: number;
    totalDisputesAvoided: number;
    totalAttentionAvoided: number;
    cells: SwitchProjectedCell[];
  };
}) {
  // Pick the cell with the largest money saved as the worked example
  const topCell = [...data.cells]
    .filter((c) => c.switchApplies && c.count > 0)
    .sort((a, b) => b.moneySavedToVenue - a.moneySavedToVenue)[0] ?? null;

  return (
    <div className="mb-5 rounded-md ring-1 ring-ink-200/60 bg-ink-50/40">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-ink-100/50 rounded-md transition-colors"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 text-ink-400 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <Calculator className="h-3.5 w-3.5 text-brand-700 shrink-0" />
        <span className="text-[12px] text-ink-700 font-medium">
          How are these projected numbers computed?
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 text-[11.5px] text-ink-700 leading-relaxed">
          <div>
            <div className="eyebrow text-[10px] text-ink-500 mb-1">Eligibility</div>
            <div className="text-ink-600">
              For each past-dated, settled deal in the window, we classify it into a{" "}
              <span className="font-mono">deal type × size bucket</span> cell. Smart Switch
              <span className="font-semibold"> applies</span> only to{" "}
              <span className="font-mono">door</span> (any size) and{" "}
              <span className="font-mono">vs / % of net</span> in the <span className="font-mono">$1–5K</span>{" "}
              bucket. Other cells (<span className="font-mono">vs / % of net</span> outside that
              bucket, <span className="font-mono">% of gross</span>, <span className="font-mono">flat</span>)
              are rendered muted as Improve Deal territory — caps suggestions aren't backtested
              against already-signed deals here.
            </div>
          </div>

          <div>
            <div className="eyebrow text-[10px] text-ink-500 mb-1">Money saved · per cell</div>
            <div className="font-mono tabular text-[11px] bg-white rounded ring-1 ring-ink-200/60 px-2 py-1.5 inline-block whitespace-pre-wrap">
              {`moneySavedToVenue = switchApplies
  ? Σ actualPayout − Σ projectedPayout      // over deals in the cell
  : 0                                       // muted cells contribute nothing`}
            </div>
            <div className="mt-1.5 text-ink-600">
              <span className="font-semibold text-ink-900">Smart Switch is the only engine
              moving this number.</span> Each deal's <span className="font-mono">projectedPayout</span>{" "}
              comes from re-running the Smart Switch engine and replacing the variable payout:
              <ul className="list-disc pl-5 mt-1 space-y-0.5">
                <li>
                  <span className="font-mono">flat</span> shape →{" "}
                  <span className="font-mono">suggestedFlat = roundTo50(cell.avgPayout)</span>{" "}
                  (mean <span className="font-mono">totalToArtist</span> across the historical cell;
                  needs <span className="font-mono">cell.n ≥ 3</span>)
                </li>
                <li>
                  <span className="font-mono">door_hybrid</span> shape →{" "}
                  <span className="font-mono">$500 floor + 60% × max(0, gross·0.9 − cap)</span>{" "}
                  with <span className="font-mono">cap = min($1,500, avg cell expenses)</span>
                </li>
              </ul>
            </div>
          </div>

          <div>
            <div className="eyebrow text-[10px] text-ink-500 mb-1">Loss-making nights avoided</div>
            <div className="font-mono tabular text-[11px] bg-white rounded ring-1 ring-ink-200/60 px-2 py-1.5 inline-block whitespace-pre-wrap">
              {`actualLosing      = count( gross − actualPayout − actualExpenses < 0 )
projectedLosing   = count( gross − projectedPayout − actualExpenses < 0 )
nightsAvoided     = actualLosing − projectedLosing`}
            </div>
            <div className="mt-1.5 text-ink-600">
              Same actual expense lines on both sides of the comparison — only the payout
              changes. So a "night avoided" means the Smart Switch payout would have been low
              enough to keep the venue's net positive on a deal that actually went red.
            </div>
          </div>

          <div>
            <div className="eyebrow text-[10px] text-ink-500 mb-1">
              Disputes & attention items avoided
            </div>
            <div className="font-mono tabular text-[11px] bg-white rounded ring-1 ring-ink-200/60 px-2 py-1.5 inline-block whitespace-pre-wrap">
              {`projectedDisputed  = switchApplies ? 0 : actualDisputed
projectedAttention = switchApplies ? 0 : actualAttention
disputesAvoided    = actualDisputed  − projectedDisputed
attentionAvoided   = actualAttention − projectedAttention`}
            </div>
            <div className="mt-1.5 text-ink-600">
              Modelling assumption: pre-agreed Smart Switch terms eliminate the recoup arithmetic,
              and every settlement-flow attention kind in this app traces back to recoup or
              status-vs-notes friction — so we project both rates to <span className="font-mono">0</span>{" "}
              for switched cells. Muted cells inherit their actual numbers unchanged.
            </div>
          </div>

          <div>
            <div className="eyebrow text-[10px] text-ink-500 mb-1">Where Improve Deal fits in</div>
            <div className="text-ink-600">
              <span className="font-semibold text-ink-900">Improve Deal</span> only emits structural
              caps (expense / hospitality), so it doesn't show up in the projected dollar number
              above — caps land at proposal time, before a signed deal exists to backtest. The
              muted cells in the grid are exactly the cells where Improve Deal would have stepped
              in instead of Smart Switch; their projected numbers equal their actuals because we
              don't simulate cap-driven expense reductions on already-settled shows.
            </div>
          </div>

          {topCell && (
            <div className="rounded-md ring-1 ring-emerald-200/60 bg-emerald-50/40 p-3">
              <div className="eyebrow text-[10px] text-emerald-700 mb-1">
                Worked example · biggest-savings cell ({PROJ_DEAL_LABEL[topCell.dealType] ?? topCell.dealType} · {topCell.bucket})
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono tabular">
                <div className="text-ink-500">Deals in cell</div>
                <div className="text-right text-ink-900">{topCell.count}</div>
                <div className="text-ink-500">Σ actual payout</div>
                <div className="text-right text-ink-900">{fmtMoney(topCell.actualPayoutSum)}</div>
                <div className="text-ink-500">Σ projected payout</div>
                <div className="text-right text-ink-900">{fmtMoney(topCell.projectedPayoutSum)}</div>
                <div className="text-emerald-700 font-semibold border-t border-emerald-200/60 pt-0.5">
                  Money saved
                </div>
                <div className="text-right text-emerald-700 font-semibold border-t border-emerald-200/60 pt-0.5">
                  {topCell.moneySavedToVenue >= 0 ? "+" : ""}
                  {fmtMoney(topCell.moneySavedToVenue)}
                </div>
                <div className="text-ink-500 pt-1">Loss-making nights (actual → projected)</div>
                <div className="text-right text-ink-900 pt-1">
                  {topCell.actualLosingMoney} → {topCell.projectedLosingMoney}
                </div>
                <div className="text-ink-500">Disputed (actual → projected)</div>
                <div className="text-right text-ink-900">
                  {topCell.actualDisputed} → {topCell.projectedDisputed}
                </div>
                <div className="text-ink-500">Attention items (actual → projected)</div>
                <div className="text-right text-ink-900">
                  {topCell.actualAttention} → {topCell.projectedAttention}
                </div>
              </div>
            </div>
          )}

          <div className="text-[11px] text-ink-500 border-t border-ink-200/60 pt-2.5">
            Headline tiles roll up every cell in the grid: money saved is{" "}
            <span className="font-mono tabular text-ink-700">
              {fmtMoney(data.totalMoneySavedToVenue)}
            </span>
            , loss-making nights avoided{" "}
            <span className="font-mono tabular text-ink-700">
              {data.totalLosingMoneyAvoided}
            </span>
            , disputes avoided{" "}
            <span className="font-mono tabular text-ink-700">{data.totalDisputesAvoided}</span>,
            attention avoided{" "}
            <span className="font-mono tabular text-ink-700">{data.totalAttentionAvoided}</span>.
            Modelled <span className="font-mono">{data.totalDealsModelled}</span> of{" "}
            <span className="font-mono">{data.totalCandidates}</span> settled deals in the last{" "}
            {data.windowMonths} months — future-dated NEW DEMO proposals never enter the calc.
          </div>
        </div>
      )}
    </div>
  );
}

function ProjStatCard({ label, value, tone }: { label: string; value: string; tone: "emerald" | "sky" }) {
  const ring = tone === "emerald" ? "ring-emerald-200/60 bg-emerald-50/40" : "ring-sky-200/60 bg-sky-50/40";
  const eyeb = tone === "emerald" ? "text-emerald-700" : "text-sky-700";
  return (
    <div className={`rounded-md ring-1 p-3 ${ring}`}>
      <div className={`eyebrow text-[10px] mb-1 ${eyeb}`}>{label}</div>
      <div className="text-[18px] font-serif text-ink-900 tabular">{value}</div>
    </div>
  );
}

function ProjCellBox({ cell }: { cell: SwitchProjectedCell | null }) {
  if (!cell || cell.count === 0) {
    return (
      <div className="rounded-md ring-1 ring-ink-200/40 p-2 text-[10px] text-ink-300 bg-ink-50/30">
        no deals
      </div>
    );
  }
  const moneyPositive = cell.moneySavedToVenue > 0;
  const moneyNegative = cell.moneySavedToVenue < 0;
  const muted = !cell.switchApplies;
  return (
    <div
      className={`rounded-md ring-1 p-2 ${muted ? "ring-ink-200/40 bg-ink-50/30" : "ring-ink-200/60 bg-white"}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-mono tabular text-ink-500">n={cell.count}</span>
        {muted ? (
          <span
            className="text-[9px] eyebrow text-ink-400"
            title={
              cell.dealType === "flat"
                ? "Flat deal — no engine applies"
                : "Improve Deal territory — would redraft caps or propose a flat at proposal time; not backtested on signed deals"
            }
          >
            {cell.dealType === "flat" ? "no engine" : "Improve Deal"}
          </span>
        ) : (
          <span
            className={`text-[10px] font-mono tabular font-semibold ${
              moneyPositive ? "text-emerald-700" : moneyNegative ? "text-rose-700" : "text-ink-400"
            }`}
          >
            {moneyPositive ? "+" : ""}
            {fmtMoney(cell.moneySavedToVenue)}
          </span>
        )}
      </div>
      <ProjMetricRow
        label="losing"
        actualPct={cell.actualLosingRate}
        projectedPct={cell.projectedLosingRate}
        actualN={cell.actualLosingMoney}
        projectedN={cell.projectedLosingMoney}
        muted={muted}
      />
      <ProjMetricRow
        label="disputed"
        actualPct={cell.actualDisputeRate}
        projectedPct={cell.projectedDisputeRate}
        actualN={cell.actualDisputed}
        projectedN={cell.projectedDisputed}
        muted={muted}
      />
      <ProjMetricRow
        label="attention"
        actualPct={cell.actualAttentionRate}
        projectedPct={cell.projectedAttentionRate}
        actualN={cell.actualAttention}
        projectedN={cell.projectedAttention}
        muted={muted}
      />
    </div>
  );
}

function ProjMetricRow({
  label,
  actualPct,
  projectedPct,
  actualN,
  projectedN,
  muted,
}: {
  label: string;
  actualPct: number;
  projectedPct: number;
  actualN: number;
  projectedN: number;
  muted: boolean;
}) {
  const dPts = deltaPts(actualPct, projectedPct);
  const noChange = dPts === 0;
  const better = dPts > 0;
  const arrow = noChange ? "·" : better ? "▼" : "▲";
  const deltaTone = muted || noChange
    ? "text-ink-300"
    : better
      ? "text-emerald-700"
      : "text-rose-700";
  const afterTone = muted || noChange
    ? "text-ink-500"
    : better
      ? "text-emerald-700"
      : "text-rose-700";

  return (
    <div className="grid grid-cols-[52px_1fr_1fr_44px] gap-1 items-baseline text-[10px] font-mono tabular leading-tight py-[3px] border-t border-ink-100/60 first:border-t-0">
      <span className="text-ink-400 col-span-1">{label}</span>
      <span className="text-ink-500" title="before">
        <span className="text-ink-300 mr-0.5">b</span>
        {pct(actualPct)}
        <span className="text-ink-300"> ({actualN})</span>
      </span>
      <span className={afterTone} title="after">
        <span className="text-ink-300 mr-0.5">a</span>
        {pct(projectedPct)}
        <span className="text-ink-300"> ({projectedN})</span>
      </span>
      <span className={`text-right font-semibold ${deltaTone}`}>
        {arrow}
        {!noChange && ` ${Math.abs(dPts)}pt`}
      </span>
    </div>
  );
}

function CellBox({
  cell,
  dt,
  bucket,
}: {
  cell: InsightsCell | null;
  dt: string;
  bucket: string;
}) {
  const [, setLocation] = useLocation();
  if (!cell) {
    return (
      <div className="h-full min-h-[140px] flex items-center justify-center text-ink-300 text-[10px] font-mono">
        —
      </div>
    );
  }
  const tone = cell.topKind ? KIND_TONE[cell.topKind] : null;
  const params = new URLSearchParams({ dealType: dt, size: bucket });

  return (
    <div className="rounded-md ring-1 ring-ink-200/50 bg-white p-2.5 min-h-[140px] flex flex-col gap-2">
      <div className="flex items-center justify-between text-[10px] font-mono tabular text-ink-400">
        <span>n={cell.count}</span>
        <span
          className="cursor-pointer hover:text-brand-700 underline-offset-2 hover:underline"
          onClick={() => setLocation(`/shows?${params.toString()}`)}
        >
          {cell.attentionCount} flagged
        </span>
      </div>

      {cell.topKind && tone ? (
        <div
          className={`px-2 py-1 rounded ${tone.bg} ${tone.fg} ring-1 ${tone.ring} text-[10.5px] font-medium leading-tight flex items-center justify-between`}
        >
          <span>{KIND_LABEL[cell.topKind]}</span>
          <span className="font-mono tabular ml-1.5">{cell.topKindCount}</span>
        </div>
      ) : (
        <div className="px-2 py-1 rounded bg-ink-50 text-ink-400 text-[10.5px] italic">
          no flags
        </div>
      )}

      <div className="flex flex-col gap-1">
        {cell.bubbles.length === 0 ? (
          <div className="text-[10px] text-ink-400 italic leading-tight">
            {cell.topKind && cell.topKindCount > 0
              ? cell.sampleSize === 0
                ? "no enriched summaries yet"
                : "no themes extracted"
              : "no complaints to cluster"}
          </div>
        ) : (
          cell.bubbles.map((b, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-1 text-[10.5px] leading-tight"
              title={b.theme}
            >
              <span className="text-ink-700 truncate">{b.theme}</span>
              <span className="font-mono tabular text-ink-400 shrink-0">
                ×{b.count}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const DIRECTION_TONE: Record<string, { bg: string; fg: string; ring: string; chip: string }> = {
  money_protected: {
    bg: "bg-emerald-50/40",
    fg: "text-emerald-700",
    ring: "ring-emerald-200",
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  money_overpaid: {
    bg: "bg-rose-50/40",
    fg: "text-rose-700",
    ring: "ring-rose-200",
    chip: "bg-rose-50 text-rose-700 ring-rose-200",
  },
  even: {
    bg: "bg-ink-50/40",
    fg: "text-ink-600",
    ring: "ring-ink-200",
    chip: "bg-ink-50 text-ink-600 ring-ink-200",
  },
};

const SOURCE_LABEL: Record<string, string> = {
  artist_at_venue: "this artist at this venue",
  artist_anywhere: "this artist (any venue)",
  agent_history: "agent's roster",
  cell_mean: "deal-type × size cell",
  venue_mean: "venue average",
  capacity_proxy: "capacity proxy",
  artist_history_2plus: "artist 2+ prior",
  artist_history_1: "artist 1 prior",
  genre_p75: "genre p75",
};

function srcLabel(s: string): string {
  return SOURCE_LABEL[s] ?? s.replace(/_/g, " ");
}

function GuaranteeBacktestSection() {
  const state = useApiData(() => api.guaranteeBacktest(12, 10), []);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (state.status === "loading")
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="text-[12px] text-ink-400">Loading SGP backtest…</div>
        </CardContent>
      </Card>
    );
  if (state.status === "error")
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="text-[12px] text-rose-600">
            Couldn't load SGP backtest: {state.error.message}
          </div>
        </CardContent>
      </Card>
    );

  const data = state.data;
  if (data.totalScored === 0) {
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="flex items-center gap-2 mb-1">
            <Calculator className="h-4 w-4 text-brand-700" />
            <span className="eyebrow text-[10px] text-ink-500">
              Smart Guaranteed Price · last {data.windowMonths} months
            </span>
          </div>
          <div className="text-[13px] text-ink-500">
            No settled non-flat deals in the last {data.windowMonths} months — nothing to backtest
            SGP against.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      <CardContent>
        <div className="flex items-baseline justify-between mb-1">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-brand-700" />
            <h2 className="text-[15px] font-semibold text-ink-900">
              Smart Guaranteed Price · backtest
            </h2>
            <span className="eyebrow text-[10px] text-ink-400">
              · last {data.windowMonths} months
            </span>
          </div>
          <div className="text-[11px] text-ink-400 font-mono tabular">
            {data.items.length} of {data.totalScored} scored deals shown
          </div>
        </div>
        <p className="text-[12px] text-ink-500 mb-4 leading-relaxed">
          Past settled <span className="font-mono">vs / % of net / door / % of gross</span> deals
          re-scored with the 7-step SGP using only data available before each show. The SGP
          suggested price is compared to what the artist was actually paid; rows are sorted by
          the largest divergence so the worst guarantee mismatches surface first.
        </p>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="rounded-md ring-1 ring-emerald-200/60 bg-emerald-50/40 p-3">
            <div className="flex items-center gap-1.5 eyebrow text-[10px] text-emerald-700 mb-1">
              <ShieldCheck className="h-3 w-3" />
              Money protected
            </div>
            <div className="text-[22px] font-serif text-ink-900 tabular">
              {fmtMoney(data.moneyProtected)}
            </div>
            <div className="text-[10px] text-ink-400">
              actual payouts above SGP — venue would have saved
            </div>
          </div>
          <div className="rounded-md ring-1 ring-rose-200/60 bg-rose-50/40 p-3">
            <div className="flex items-center gap-1.5 eyebrow text-[10px] text-rose-700 mb-1">
              <AlertTriangle className="h-3 w-3" />
              Money overpaid (under SGP)
            </div>
            <div className="text-[22px] font-serif text-ink-900 tabular">
              {fmtMoney(data.moneyOverpaid)}
            </div>
            <div className="text-[10px] text-ink-400">
              SGP above actual — venue would have offered more
            </div>
          </div>
          <div className="rounded-md ring-1 ring-ink-200/60 bg-white p-3">
            <div className="eyebrow text-[10px] text-ink-500 mb-1">Net delta</div>
            <div
              className={`text-[22px] font-serif tabular ${
                data.netDelta > 0
                  ? "text-emerald-700"
                  : data.netDelta < 0
                    ? "text-rose-700"
                    : "text-ink-700"
              }`}
            >
              {data.netDelta >= 0 ? "+" : "−"}
              {fmtMoney(Math.abs(data.netDelta))}
            </div>
            <div className="text-[10px] text-ink-400">
              protected − overpaid across {data.totalScored} deals
            </div>
          </div>
        </div>

        {data.gapCoverage && (
        <div
          className="rounded-md ring-1 ring-amber-200/60 bg-amber-50/40 p-3 mb-5"
          title="Distribution of |SGP − actual| across all scored deals. Each bar is the share of deals that would have fit fully inside an insurance cap of $T."
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 eyebrow text-[10px] text-amber-700">
              <Calculator className="h-3 w-3" />
              Suggestion-gap coverage · |SGP − paid| ≤ $T
            </div>
            <div className="text-[10px] font-mono tabular text-ink-500">
              median ${data.gapCoverage.medianAbsDelta.toLocaleString()} · p75 $
              {data.gapCoverage.p75AbsDelta.toLocaleString()} · p90 $
              {data.gapCoverage.p90AbsDelta.toLocaleString()}
            </div>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {data.gapCoverage.buckets.map((b) => (
              <div
                key={b.threshold}
                className="rounded ring-1 ring-amber-200/40 bg-white p-2 text-center"
              >
                <div className="text-[9px] font-mono tabular text-ink-500">
                  ≤ ${b.threshold.toLocaleString()}
                </div>
                <div className="text-[16px] font-serif text-ink-900 tabular leading-tight">
                  {(b.rate * 100).toFixed(1)}%
                </div>
                <div className="text-[9px] text-ink-400 font-mono tabular">
                  {b.count}/{data.gapCoverage.totalScored}
                </div>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-ink-500 mt-2 leading-relaxed">
            Used for Phase-3 Product 2 cap sizing: a $400 cap would have covered{" "}
            <span className="font-mono tabular text-ink-700">
              {(
                (data.gapCoverage.buckets.find((b) => b.threshold === 400)?.rate ?? 0) *
                100
              ).toFixed(1)}
              %
            </span>{" "}
            of historical SGP-vs-actual gaps in full.
          </div>
        </div>
        )}

        <ul className="space-y-1.5">
          {data.items.map((it) => (
            <BacktestRow
              key={it.showId}
              item={it}
              expanded={expandedId === it.showId}
              onToggle={() =>
                setExpandedId(expandedId === it.showId ? null : it.showId)
              }
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function BacktestRow({
  item,
  expanded,
  onToggle,
}: {
  item: GuaranteeBacktestItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const tierClass = TIER_TONE[item.confidenceTier] ?? TIER_TONE.D;
  const dirTone = DIRECTION_TONE[item.direction];
  const sgpVsActual = item.deltaSgpVsActual;
  const sgpVsAgent = item.deltaSgpVsAgent;
  return (
    <li className="rounded-md ring-1 ring-ink-200/60 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-ink-50/60 rounded-md transition-colors"
        aria-expanded={expanded}
      >
        <ChevronRight
          className={`h-3.5 w-3.5 text-ink-400 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium text-ink-900 truncate">
              {item.artistName ?? "—"}
            </span>
            <span className="text-[10px] font-mono tabular text-ink-400">{item.date}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink-50 text-ink-600 ring-1 ring-ink-200">
              {DEAL_LABELS[item.dealType] ?? item.dealType}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono ring-1 ${tierClass}`}
              title="Confidence tier"
            >
              Tier {item.confidenceTier}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded ring-1 ${dirTone.chip}`}
            >
              {item.direction === "money_protected"
                ? "would have protected"
                : item.direction === "money_overpaid"
                  ? "would have overpaid"
                  : "even"}
            </span>
          </div>
          <div className="mt-1 grid grid-cols-3 gap-3 text-[10.5px] font-mono tabular text-ink-500">
            <span>
              <span className="text-ink-400">agent</span>{" "}
              ${item.agentGuarantee.toLocaleString()}
            </span>
            <span>
              <span className="text-ink-400">SGP</span>{" "}
              ${item.sgpSuggestedPrice.toLocaleString()}
              <span className={`ml-1 ${sgpVsAgent === 0 ? "text-ink-400" : sgpVsAgent > 0 ? "text-rose-600" : "text-emerald-700"}`}>
                ({sgpVsAgent >= 0 ? "+" : "−"}${Math.abs(sgpVsAgent).toLocaleString()} vs agent)
              </span>
            </span>
            <span>
              <span className="text-ink-400">paid</span>{" "}
              ${item.actualToArtist.toLocaleString()}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div
            className={`text-[13px] font-mono tabular font-semibold ${dirTone.fg}`}
          >
            {sgpVsActual >= 0 ? "+" : "−"}
            {fmtMoney(Math.abs(sgpVsActual))}
          </div>
          <div className="text-[9px] text-ink-400 uppercase tracking-[0.06em]">
            SGP − paid
          </div>
        </div>
      </button>

      {expanded && <BacktestBreakdown item={item} />}
    </li>
  );
}

function BacktestBreakdown({ item }: { item: GuaranteeBacktestItem }) {
  const s = item.steps;
  const rows: { n: number; label: string; value: string; aside?: string }[] = [
    {
      n: 1,
      label: "Expected gross",
      value: `$${Math.round(s.step1_expectedGross.value).toLocaleString()}`,
      aside: `${srcLabel(s.step1_expectedGross.source)} · n=${s.step1_expectedGross.sampleSize}`,
    },
    {
      n: 2,
      label: "Ticketing fees",
      value: `$${Math.round(s.step2_ticketingFees.value).toLocaleString()}`,
      aside: `@ ${Math.round(s.step2_ticketingFees.rate * 100)}% of gross`,
    },
    {
      n: 3,
      label: "Net after fees",
      value: `$${Math.round(s.step3_netAfterFees).toLocaleString()}`,
      aside: "step 1 − step 2",
    },
    {
      n: 4,
      label: "Capped expense",
      value: `$${Math.round(s.step4_expense.cappedValue).toLocaleString()}`,
      aside: `raw $${Math.round(s.step4_expense.raw).toLocaleString()} (${srcLabel(s.step4_expense.source)}) · cap $${Math.round(s.step4_expense.effectiveCap).toLocaleString()}`,
    },
    {
      n: 5,
      label: "Net base",
      value: `$${Math.round(s.step5_netBase).toLocaleString()}`,
      aside: "max(0, step 3 − step 4)",
    },
    {
      n: 6,
      label: "Percentage payout",
      value: `$${Math.round(s.step6_percentagePayout.value).toLocaleString()}`,
      aside: `${Math.round(s.step6_percentagePayout.pct * 100)}% × $${Math.round(s.step6_percentagePayout.basis).toLocaleString()}`,
    },
    {
      n: 7,
      label: "Suggested price",
      value: `$${Math.round(s.step7_winner.suggestedPrice).toLocaleString()}`,
      aside: `winner: ${s.step7_winner.winner} · breakeven $${Math.round(s.step7_winner.breakevenGross).toLocaleString()}`,
    },
  ];
  return (
    <div className="border-t border-ink-200/50 px-3 py-3 bg-ink-50/30 rounded-b-md text-[12px] leading-relaxed space-y-3">
      <div className="rounded ring-1 ring-ink-200/60 bg-white p-2.5">
        <div className="eyebrow text-[10px] text-ink-500 mb-2">7-step SGP against historical data</div>
        <ol className="space-y-1">
          {rows.map((r) => (
            <li
              key={r.n}
              className="grid grid-cols-[20px_120px_1fr_auto] gap-2 items-baseline text-[11px] font-mono tabular border-t border-ink-100/70 pt-1 first:border-t-0 first:pt-0"
            >
              <span className="text-ink-400">{r.n}.</span>
              <span className="text-ink-600">{r.label}</span>
              <span className="text-ink-400 text-[10.5px] truncate" title={r.aside ?? ""}>
                {r.aside}
              </span>
              <span className="text-ink-900 font-semibold text-right">{r.value}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded ring-1 ring-ink-200/60 bg-white p-2.5">
          <div className="eyebrow text-[10px] text-ink-500 mb-1">Agent guarantee</div>
          <div className="text-[15px] font-mono tabular text-ink-900">
            ${item.agentGuarantee.toLocaleString()}
          </div>
        </div>
        <div className="rounded ring-1 ring-brand-200 bg-brand-50/30 p-2.5">
          <div className="eyebrow text-[10px] text-brand-700 mb-1">SGP suggested price</div>
          <div className="text-[15px] font-mono tabular text-ink-900">
            ${item.sgpSuggestedPrice.toLocaleString()}
          </div>
          <div className="text-[10px] text-ink-500 mt-0.5">
            {item.deltaSgpVsAgent === 0
              ? "matches the agent's guarantee"
              : item.deltaSgpVsAgent > 0
                ? `$${item.deltaSgpVsAgent.toLocaleString()} above the agent's guarantee`
                : `$${Math.abs(item.deltaSgpVsAgent).toLocaleString()} below the agent's guarantee`}
          </div>
        </div>
        <div className="rounded ring-1 ring-ink-200/60 bg-white p-2.5">
          <div className="eyebrow text-[10px] text-ink-500 mb-1">Actually paid to artist</div>
          <div className="text-[15px] font-mono tabular text-ink-900">
            ${item.actualToArtist.toLocaleString()}
          </div>
          <div className="text-[10px] text-ink-500 mt-0.5">
            on ${item.grossBoxOffice.toLocaleString()} gross
          </div>
        </div>
      </div>

      <div className="rounded ring-1 ring-ink-200/60 bg-white p-2.5">
        <div className="eyebrow text-[10px] text-ink-500 mb-1">Basis</div>
        <div className="text-[11.5px] text-ink-700">{item.basis}</div>
      </div>

      <div className="text-right">
        <Link
          href={`/shows/${item.showId}`}
          className="inline-flex items-center gap-1 text-[11px] text-brand-700 hover:text-brand-800 font-medium"
        >
          Open show <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

function SgpFlatRepricingSection() {
  const state = useApiData(() => api.sgpFlatRepricing(12, 10, "$1–5K", 0.85), []);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (state.status === "loading")
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="text-[12px] text-ink-400">
            Loading SGP flat-repricing simulation…
          </div>
        </CardContent>
      </Card>
    );
  if (state.status === "error")
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="text-[12px] text-rose-600">
            Couldn't load SGP flat-repricing: {state.error.message}
          </div>
        </CardContent>
      </Card>
    );

  const data = state.data;
  const splitLabel = `${Math.round(data.simulatedSplitPct * 100)}%`;

  if (data.totalScored === 0) {
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="flex items-center gap-2 mb-1">
            <Calculator className="h-4 w-4 text-brand-700" />
            <span className="eyebrow text-[10px] text-ink-500">
              Smart Guaranteed Price · flat repricing · last {data.windowMonths} months
            </span>
          </div>
          <div className="text-[13px] text-ink-500">
            No settled flat {data.bucket} deals in the last {data.windowMonths} months —
            nothing to re-price.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      <CardContent>
        <div className="flex items-baseline justify-between mb-1">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-brand-700" />
            <h2 className="text-[15px] font-semibold text-ink-900">
              Smart Guaranteed Price · flat repricing
            </h2>
            <span className="eyebrow text-[10px] text-ink-400">
              · flat {data.bucket} · vs/{splitLabel} equivalent · last {data.windowMonths} months
            </span>
          </div>
          <div className="text-[11px] text-ink-400 font-mono tabular">
            {data.items.length} of {data.totalScored} scored deals shown
          </div>
        </div>
        <p className="text-[12px] text-ink-500 mb-4 leading-relaxed">
          Past settled <span className="font-mono">flat</span> deals in the {data.bucket}{" "}
          bucket re-quoted as if they had been offered through SGP at the venue's
          typical vs/{splitLabel} structure, using only data available before each show.
          The SGP "fair flat" is compared to the flat the venue actually agreed; rows
          are sorted by the largest divergence so the worst over- and under-prices
          surface first.
        </p>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="rounded-md ring-1 ring-emerald-200/60 bg-emerald-50/40 p-3">
            <div className="flex items-center gap-1.5 eyebrow text-[10px] text-emerald-700 mb-1">
              <ShieldCheck className="h-3 w-3" />
              Would have offered less
            </div>
            <div className="text-[22px] font-serif text-ink-900 tabular">
              {fmtMoney(data.moneyOverpaid)}
            </div>
            <div className="text-[10px] text-ink-400">
              actual flat above SGP fair flat — venue would have saved
            </div>
          </div>
          <div className="rounded-md ring-1 ring-rose-200/60 bg-rose-50/40 p-3">
            <div className="flex items-center gap-1.5 eyebrow text-[10px] text-rose-700 mb-1">
              <AlertTriangle className="h-3 w-3" />
              Would have offered more
            </div>
            <div className="text-[22px] font-serif text-ink-900 tabular">
              {fmtMoney(data.moneyUnderpriced)}
            </div>
            <div className="text-[10px] text-ink-400">
              SGP fair flat above actual — flats came in under fair value
            </div>
          </div>
          <div className="rounded-md ring-1 ring-ink-200/60 bg-white p-3">
            <div className="eyebrow text-[10px] text-ink-500 mb-1">Net delta</div>
            <div
              className={`text-[22px] font-serif tabular ${
                data.netDelta > 0
                  ? "text-emerald-700"
                  : data.netDelta < 0
                    ? "text-rose-700"
                    : "text-ink-700"
              }`}
            >
              {data.netDelta >= 0 ? "+" : "−"}
              {fmtMoney(Math.abs(data.netDelta))}
            </div>
            <div className="text-[10px] text-ink-400">
              offered-less − offered-more across {data.totalScored} flats
            </div>
          </div>
        </div>

        {data.gapCoverage && (
          <div
            className="rounded-md ring-1 ring-amber-200/60 bg-amber-50/40 p-3 mb-5"
            title="Distribution of |SGP fair flat − actual flat| across all scored flats."
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 eyebrow text-[10px] text-amber-700">
                <Calculator className="h-3 w-3" />
                Repricing-gap coverage · |SGP − flat| ≤ $T
              </div>
              <div className="text-[10px] font-mono tabular text-ink-500">
                median ${data.gapCoverage.medianAbsDelta.toLocaleString()} · p75 $
                {data.gapCoverage.p75AbsDelta.toLocaleString()} · p90 $
                {data.gapCoverage.p90AbsDelta.toLocaleString()}
              </div>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {data.gapCoverage.buckets.map((b) => (
                <div
                  key={b.threshold}
                  className="rounded ring-1 ring-amber-200/40 bg-white p-2 text-center"
                >
                  <div className="text-[9px] font-mono tabular text-ink-500">
                    ≤ ${b.threshold.toLocaleString()}
                  </div>
                  <div className="text-[16px] font-serif text-ink-900 tabular leading-tight">
                    {(b.rate * 100).toFixed(1)}%
                  </div>
                  <div className="text-[9px] text-ink-400 font-mono tabular">
                    {b.count}/{data.gapCoverage.totalScored}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[10px] text-ink-500 mt-2 leading-relaxed">
              Share of historical flats where the SGP fair flat lands within $T of
              what was actually agreed — i.e. the gap a Phase-3 cap would have to
              cover to keep the offer in the venue's comfort zone.
            </div>
          </div>
        )}

        <ul className="space-y-1.5">
          {data.items.map((it) => (
            <FlatRepricingRow
              key={it.showId}
              item={it}
              expanded={expandedId === it.showId}
              onToggle={() =>
                setExpandedId(expandedId === it.showId ? null : it.showId)
              }
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const FLAT_DIRECTION_TONE: Record<
  SgpFlatRepricingItem["direction"],
  { chip: string; fg: string }
> = {
  would_have_offered_less: {
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    fg: "text-emerald-700",
  },
  would_have_offered_more: {
    chip: "bg-rose-50 text-rose-700 ring-rose-200",
    fg: "text-rose-700",
  },
  even: {
    chip: "bg-ink-50 text-ink-600 ring-ink-200",
    fg: "text-ink-700",
  },
};

function FlatRepricingRow({
  item,
  expanded,
  onToggle,
}: {
  item: SgpFlatRepricingItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const tierClass = TIER_TONE[item.confidenceTier] ?? TIER_TONE.D;
  const dirTone = FLAT_DIRECTION_TONE[item.direction];
  const delta = item.deltaSgpVsActual;
  return (
    <li className="rounded-md ring-1 ring-ink-200/60 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-ink-50/60 rounded-md transition-colors"
        aria-expanded={expanded}
      >
        <ChevronRight
          className={`h-3.5 w-3.5 text-ink-400 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium text-ink-900 truncate">
              {item.artistName ?? "—"}
            </span>
            <span className="text-[10px] font-mono tabular text-ink-400">
              {item.date}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink-50 text-ink-600 ring-1 ring-ink-200">
              Flat {item.bucket}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono ring-1 ${tierClass}`}
              title="Confidence tier"
            >
              Tier {item.confidenceTier}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded ring-1 ${dirTone.chip}`}
            >
              {item.direction === "would_have_offered_less"
                ? "would have offered less"
                : item.direction === "would_have_offered_more"
                  ? "would have offered more"
                  : "even"}
            </span>
          </div>
          <div className="mt-1 grid grid-cols-3 gap-3 text-[10.5px] font-mono tabular text-ink-500">
            <span>
              <span className="text-ink-400">actual flat</span>{" "}
              ${item.actualFlat.toLocaleString()}
            </span>
            <span>
              <span className="text-ink-400">SGP fair flat</span>{" "}
              ${item.sgpFairFlat.toLocaleString()}
              <span className="ml-1 text-ink-400">
                @ vs/{Math.round(item.simulatedSplitPct * 100)}%
              </span>
            </span>
            <span>
              <span className="text-ink-400">paid</span>{" "}
              ${item.actualToArtist.toLocaleString()}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div
            className={`text-[13px] font-mono tabular font-semibold ${dirTone.fg}`}
          >
            {delta >= 0 ? "+" : "−"}
            {fmtMoney(Math.abs(delta))}
          </div>
          <div className="text-[9px] text-ink-400 uppercase tracking-[0.06em]">
            SGP − flat
          </div>
        </div>
      </button>

      {expanded && <FlatRepricingBreakdown item={item} />}
    </li>
  );
}

function FlatRepricingBreakdown({ item }: { item: SgpFlatRepricingItem }) {
  const s = item.steps;
  const rows: { n: number; label: string; value: string; aside?: string }[] = [
    {
      n: 1,
      label: "Expected gross",
      value: `$${Math.round(s.step1_expectedGross.value).toLocaleString()}`,
      aside: `${srcLabel(s.step1_expectedGross.source)} · n=${s.step1_expectedGross.sampleSize}`,
    },
    {
      n: 2,
      label: "Ticketing fees",
      value: `$${Math.round(s.step2_ticketingFees.value).toLocaleString()}`,
      aside: `@ ${Math.round(s.step2_ticketingFees.rate * 100)}% of gross`,
    },
    {
      n: 3,
      label: "Net after fees",
      value: `$${Math.round(s.step3_netAfterFees).toLocaleString()}`,
      aside: "step 1 − step 2",
    },
    {
      n: 4,
      label: "Capped expense",
      value: `$${Math.round(s.step4_expense.cappedValue).toLocaleString()}`,
      aside: `raw $${Math.round(s.step4_expense.raw).toLocaleString()} (${srcLabel(s.step4_expense.source)}) · cap $${Math.round(s.step4_expense.effectiveCap).toLocaleString()}`,
    },
    {
      n: 5,
      label: "Net base",
      value: `$${Math.round(s.step5_netBase).toLocaleString()}`,
      aside: "max(0, step 3 − step 4)",
    },
    {
      n: 6,
      label: `Vs/${Math.round(item.simulatedSplitPct * 100)}% payout`,
      value: `$${Math.round(s.step6_percentagePayout.value).toLocaleString()}`,
      aside: `${Math.round(s.step6_percentagePayout.pct * 100)}% × $${Math.round(s.step6_percentagePayout.basis).toLocaleString()}`,
    },
    {
      n: 7,
      label: "SGP fair flat",
      value: `$${Math.round(s.step7_winner.suggestedPrice).toLocaleString()}`,
      aside: `rounded to nearest $50 · breakeven $${Math.round(s.step7_winner.breakevenGross).toLocaleString()}`,
    },
  ];
  return (
    <div className="border-t border-ink-200/50 px-3 py-3 bg-ink-50/30 rounded-b-md text-[12px] leading-relaxed space-y-3">
      <div className="rounded ring-1 ring-ink-200/60 bg-white p-2.5">
        <div className="eyebrow text-[10px] text-ink-500 mb-2">
          7-step SGP re-cast as vs/{Math.round(item.simulatedSplitPct * 100)}%
        </div>
        <ol className="space-y-1">
          {rows.map((r) => (
            <li
              key={r.n}
              className="grid grid-cols-[20px_140px_1fr_auto] gap-2 items-baseline text-[11px] font-mono tabular border-t border-ink-100/70 pt-1 first:border-t-0 first:pt-0"
            >
              <span className="text-ink-400">{r.n}.</span>
              <span className="text-ink-600">{r.label}</span>
              <span
                className="text-ink-400 text-[10.5px] truncate"
                title={r.aside ?? ""}
              >
                {r.aside}
              </span>
              <span className="text-ink-900 font-semibold text-right">
                {r.value}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded ring-1 ring-ink-200/60 bg-white p-2.5">
          <div className="eyebrow text-[10px] text-ink-500 mb-1">Actual flat agreed</div>
          <div className="text-[15px] font-mono tabular text-ink-900">
            ${item.actualFlat.toLocaleString()}
          </div>
        </div>
        <div className="rounded ring-1 ring-brand-200 bg-brand-50/30 p-2.5">
          <div className="eyebrow text-[10px] text-brand-700 mb-1">
            SGP fair flat (vs/{Math.round(item.simulatedSplitPct * 100)}%)
          </div>
          <div className="text-[15px] font-mono tabular text-ink-900">
            ${item.sgpFairFlat.toLocaleString()}
          </div>
          <div className="text-[10px] text-ink-500 mt-0.5">
            {item.deltaSgpVsActual === 0
              ? "matches the agreed flat"
              : item.deltaSgpVsActual > 0
                ? `$${item.deltaSgpVsActual.toLocaleString()} above the agreed flat`
                : `$${Math.abs(item.deltaSgpVsActual).toLocaleString()} below the agreed flat`}
          </div>
        </div>
        <div className="rounded ring-1 ring-ink-200/60 bg-white p-2.5">
          <div className="eyebrow text-[10px] text-ink-500 mb-1">Actually paid to artist</div>
          <div className="text-[15px] font-mono tabular text-ink-900">
            ${item.actualToArtist.toLocaleString()}
          </div>
          <div className="text-[10px] text-ink-500 mt-0.5">
            on ${item.grossBoxOffice.toLocaleString()} gross
          </div>
        </div>
      </div>

      <div className="rounded ring-1 ring-ink-200/60 bg-white p-2.5">
        <div className="eyebrow text-[10px] text-ink-500 mb-1">Basis</div>
        <div className="text-[11.5px] text-ink-700">{item.basis}</div>
      </div>

      <div className="text-right">
        <Link
          href={`/shows/${item.showId}`}
          className="inline-flex items-center gap-1 text-[11px] text-brand-700 hover:text-brand-800 font-medium"
        >
          Open show <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
