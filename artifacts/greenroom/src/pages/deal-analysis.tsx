import { Link, useLocation } from "wouter";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney, formatMoneyCompact } from "@/lib/format";
import { useApiData, LoadingState } from "@/hooks/useApiData";
import { CalibrationSection } from "@/components/calibration-section";
import { AiPrompt } from "@/components/ai-prompt";
import type { DealAnalysis, AttentionKind } from "@/lib/types";

const DEAL_ANALYSIS_PROMPTS = [
  "Which deal-type × size cell is bleeding the most money — and why?",
  "Where are disputes concentrated, and what's driving them?",
  "Which deal types are running over their expense baselines most often?",
  "Are flat deals or Vs deals more profitable for us this year?",
  "Which repeat artists deserve better terms, and which need tighter caps?",
  "What's the realized payout gap between our biggest and smallest shows?",
];

const COMPLEXITY_META: Record<
  "simple" | "medium" | "complex",
  { label: string; blurb: string; bar: string; ring: string; bg: string; fg: string; hover: string }
> = {
  simple: {
    label: "Simple",
    blurb: "Flat with no caps or bonuses.",
    bar: "bg-brand-700/90",
    ring: "ring-brand-200/60",
    bg: "bg-brand-50/30",
    fg: "text-brand-800",
    hover: "hover:bg-brand-50/60 hover:ring-brand-300",
  },
  medium: {
    label: "Medium",
    blurb: "% of gross, or has expense / hospitality caps.",
    bar: "bg-sky-500/90",
    ring: "ring-sky-200/60",
    bg: "bg-sky-50/30",
    fg: "text-sky-800",
    hover: "hover:bg-sky-50/60 hover:ring-sky-300",
  },
  complex: {
    label: "Complex",
    blurb: "Vs / door / % of net, or has bonuses.",
    bar: "bg-amber-500/90",
    ring: "ring-amber-200/60",
    bg: "bg-amber-50/30",
    fg: "text-amber-800",
    hover: "hover:bg-amber-50/60 hover:ring-amber-300",
  },
};

const DEAL_LABELS: Record<string, string> = {
  flat: "Flat",
  percentage_of_gross: "% of gross",
  percentage_of_net: "% of net",
  vs: "Vs deal",
  door: "Door deal",
};

const RECOUP_LABELS: Record<string, string> = {
  marketing: "Marketing",
  hospitality_overage: "Hospitality overage",
  production_overage: "Production overage",
  prior_advance: "Prior advance",
  damages: "Damages",
  other: "Other",
};

const EXPENSE_LABELS: Record<string, string> = {
  production: "Production",
  sound: "Sound",
  lights: "Lights",
  hospitality: "Hospitality",
  marketing: "Marketing",
  backline: "Backline",
  security: "Security",
  other: "Other",
};

function showsHref(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") sp.set(k, v);
  }
  const qs = sp.toString();
  return `/shows${qs ? `?${qs}` : ""}`;
}

export default function DealAnalysisPage() {
  const state = useApiData(() => api.dealAnalysis(), []);

  if (state.status === "loading") return <LoadingState label="Loading deal analysis..." />;
  if (state.status === "error") return <LoadingState label={`Error: ${state.error.message}`} />;

  const d = state.data;

  return (
    <div className="px-12 py-10 max-w-7xl">
      <div className="mb-14">
        <div className="eyebrow mb-3">Deal anatomy · Last 24 months</div>
        <h1
          className="font-display text-[48px] font-medium text-ink-900 leading-[1.05]"
          style={{ letterSpacing: "-0.02em", fontOpticalSizing: "auto" }}
        >
          Deal Analysis
        </h1>
        <p className="text-[14px] text-ink-500 mt-3 max-w-xl leading-relaxed">
          {d.totalDeals} past deals at The Crescent, broken down by what they
          cost the venue to handle and what they returned. Click any row or bar
          to see the shows behind it.
        </p>
      </div>

      <AiPrompt
        scope="account"
        variant="prominent"
        title="Dig into the deal analysis"
        subtitle="Ask follow-up questions about any pattern you see below — grounded in the same 24-month deal data."
        placeholder="Ask about a deal type, size bucket, dispute pattern…"
        suggestions={DEAL_ANALYSIS_PROMPTS}
      />

      <ComplexitySection data={d} />
      <SizeSection data={d} />
      <ProfitabilitySection data={d} />
      <DisputesSection data={d} />
      <RepeatArtistsSection data={d} />
      <CostsSection data={d} />
      <CalibrationSection variant="analysis" />
      <RevenueSection data={d} />
    </div>
  );
}

function DisputesSection({ data }: { data: DealAnalysis }) {
  const db = data.disputeBreakdown;
  if (!db) return null;
  const cellByKey = new Map(db.cells.map((c) => [`${c.dealType}|${c.bucket}`, c]));
  const activeBuckets = db.buckets.filter((b) => db.cells.some((c) => c.bucket === b));
  const activeTypes = db.dealTypes.filter((dt) => db.cells.some((c) => c.dealType === dt));
  const totalDisputed = db.cells.reduce((a, c) => a + (c.disputed ?? 0), 0);
  const totalDisputedAmount = db.cells.reduce(
    (a, c) => a + (c.disputedAmount ?? 0),
    0,
  );
  const totalDisputedPayout = db.cells.reduce(
    (a, c) => a + (c.totalDisputedPayout ?? 0),
    0,
  );

  return (
    <section className="mb-14">
      <div className="mb-5">
        <div className="eyebrow text-[10px] text-ink-500 mb-1.5">
          Disputes · by deal type × deal size
        </div>
        <h2
          className="font-display text-[26px] font-medium text-ink-900 leading-[1.1]"
          style={{ letterSpacing: "-0.015em" }}
        >
          What artists pushed back on
        </h2>
        <p className="text-[13px] text-ink-500 mt-2 max-w-2xl leading-relaxed">
          {totalDisputed} past settlements ended with a disputed status or at
          least one contested recoup line, with{" "}
          {formatMoneyCompact(totalDisputedAmount)} of recoup value under
          contention and {formatMoneyCompact(totalDisputedPayout)} of artist
          payout flowing through those nights. Per cell: number of disputes,
          total payout across all disputed shows, average payout on the ones
          that ended in payment, total disputed dollars, and the top recoup
          categories driving the friction.
        </p>
      </div>
      <Card>
        <CardContent>
          {db.cells.length === 0 ? (
            <div className="text-[13px] text-ink-500 py-6 text-center">
              No disputed settlements in the past 24 months.
            </div>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left border-b border-ink-100/80">
                  <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold">
                    Deal type
                  </th>
                  {activeBuckets.map((b) => (
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
                {activeTypes.map((dt) => (
                  <tr key={dt} className="align-top">
                    <td className="py-3 pr-3">
                      <span className="text-ink-900 font-medium">
                        {DEAL_LABELS[dt] ?? dt}
                      </span>
                    </td>
                    {activeBuckets.map((b) => {
                      const cell = cellByKey.get(`${dt}|${b}`);
                      if (!cell) {
                        return (
                          <td
                            key={b}
                            className="py-3 px-2 text-center text-ink-300 font-mono tabular text-[11px]"
                          >
                            —
                          </td>
                        );
                      }
                      return (
                        <td key={b} className="py-3 px-2 align-top">
                          <div className="flex flex-col items-center gap-1">
                            <div className="flex items-baseline gap-1.5">
                              <span className="font-mono tabular text-[14px] text-ink-800 font-semibold">
                                {cell.disputed}
                              </span>
                              <span className="text-[10px] text-ink-400 uppercase tracking-[0.06em]">
                                disp
                              </span>
                            </div>
                            <div
                              className="text-[11px] font-mono tabular text-ink-600"
                              title={`Sum of totalToArtist across all ${cell.disputed} disputed show${cell.disputed === 1 ? "" : "s"} in this cell`}
                            >
                              total payout {formatMoneyCompact(cell.totalDisputedPayout ?? 0)}
                            </div>
                            <div
                              className="text-[11px] font-mono tabular text-ink-500"
                              title={`Mean totalToArtist across the ${cell.paidDisputedCount ?? 0} disputed show${(cell.paidDisputedCount ?? 0) === 1 ? "" : "s"} that ended with a paid settlement`}
                            >
                              avg paid {formatMoneyCompact(cell.avgDisputedPayout)}
                              {(cell.paidDisputedCount ?? 0) < cell.disputed && (
                                <span className="text-ink-400">
                                  {" "}
                                  ({cell.paidDisputedCount ?? 0}/{cell.disputed})
                                </span>
                              )}
                            </div>
                            <div
                              className="text-[11px] font-mono tabular text-rose-700"
                              title={`${(cell.disputedAmount ?? 0).toLocaleString("en-US", {style:"currency", currency:"USD"})} of recoup value disputed`}
                            >
                              {formatMoneyCompact(cell.disputedAmount ?? 0)} disputed
                            </div>
                            {cell.topTopics.length > 0 && (
                              <div className="flex flex-wrap justify-center gap-1 mt-1 max-w-[140px]">
                                {cell.topTopics.map((t) => (
                                  <span
                                    key={t.topic}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-ink-100/70 text-[10px] text-ink-700"
                                    title={`${t.count} disputed/withdrawn line${t.count === 1 ? "" : "s"}`}
                                  >
                                    {RECOUP_LABELS[t.topic] ?? t.topic}
                                    <span className="text-ink-400 font-mono tabular">
                                      {t.count}
                                    </span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-4 pt-3 border-t border-ink-100/60 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-ink-400">
            <span>
              <strong className="text-ink-600">disp</strong> = settlements ended
              disputed or had a contested recoup line
            </span>
            <span>
              <strong className="text-ink-600">total payout</strong> = sum of
              artist payout across all disputed shows in the cell
            </span>
            <span>
              <strong className="text-ink-600">avg paid</strong> = mean payout
              across only the disputed shows that ended with a paid settlement
            </span>
            <span>
              <strong className="text-ink-600">disputed</strong> = total dollar
              value of contested recoup lines in the cell
            </span>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function RepeatArtistsSection({ data }: { data: DealAnalysis }) {
  const rad = data.repeatArtistDisputes;
  if (!rad || rad.artists.length === 0) return null;

  const activeDealTypes = rad.dealTypes.filter((dt) =>
    rad.artists.some((a) => a.cells.some((c) => c.dealType === dt)),
  );
  const activeBuckets = rad.buckets.filter((b) =>
    rad.artists.some((a) => a.cells.some((c) => c.bucket === b)),
  );

  const totalShows = rad.artists.reduce((s, a) => s + a.totalShows, 0);
  const totalDisputes = rad.artists.reduce((s, a) => s + a.totalDisputes, 0);

  const colTotals = new Map<string, { shows: number; disputed: number }>();
  for (const a of rad.artists) {
    for (const c of a.cells) {
      const key = `${c.dealType}|${c.bucket}`;
      const prev = colTotals.get(key) ?? { shows: 0, disputed: 0 };
      prev.shows += c.shows;
      prev.disputed += c.disputed;
      colTotals.set(key, prev);
    }
  }
  const grandShows = Array.from(colTotals.values()).reduce(
    (s, v) => s + v.shows,
    0,
  );
  const grandDisputed = Array.from(colTotals.values()).reduce(
    (s, v) => s + v.disputed,
    0,
  );

  function cellBg(disputed: number, shows: number): string {
    if (shows === 0) return "bg-transparent";
    if (disputed === 0) return "bg-brand-50/60";
    const rate = disputed / shows;
    if (rate >= 0.75) return "bg-rose-300/85";
    if (rate >= 0.5) return "bg-rose-200/80";
    if (rate >= 0.25) return "bg-rose-100/80";
    return "bg-amber-100/80";
  }
  function cellFg(disputed: number, shows: number): string {
    if (shows === 0) return "text-ink-300";
    if (disputed === 0) return "text-brand-700";
    const rate = disputed / shows;
    if (rate >= 0.5) return "text-rose-900";
    return "text-rose-800";
  }

  return (
    <section className="mb-14">
      <div className="mb-5">
        <div className="eyebrow text-[10px] text-ink-500 mb-1.5">
          Repeat artists · friction across deal types &amp; buckets
        </div>
        <h2
          className="font-display text-[26px] font-medium text-ink-900 leading-[1.1]"
          style={{ letterSpacing: "-0.015em" }}
        >
          Who comes back, and where the friction lands
        </h2>
        <p className="text-[13px] text-ink-500 mt-2 max-w-2xl leading-relaxed">
          {rad.artists.length} artists have played The Crescent at least twice
          and ended at least one of those nights in dispute —{" "}
          {totalDisputes} disputed settlement{totalDisputes === 1 ? "" : "s"}{" "}
          across {totalShows} shows. Each row shows where that artist&rsquo;s
          friction concentrated by deal type and guarantee bucket. Color
          tracks <span className="text-rose-700">dispute rate</span> in the
          cell; the small number is{" "}
          <span className="font-mono tabular">disputed/shows</span>. Click an
          artist&rsquo;s name to open their profile.
        </p>
      </div>

      <Card>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="text-[12px] w-full">
              <thead>
                <tr className="border-b border-ink-100/80">
                  <th className="py-2 pr-3 text-left eyebrow text-[10px] text-ink-400 font-semibold sticky left-0 bg-white z-10 min-w-[200px]">
                    Artist
                  </th>
                  <th className="py-2 px-2 text-left eyebrow text-[10px] text-ink-400 font-semibold">
                    Shows
                  </th>
                  <th className="py-2 px-2 text-left eyebrow text-[10px] text-ink-400 font-semibold">
                    Disp.
                  </th>
                  {activeDealTypes.flatMap((dt) =>
                    activeBuckets.map((b) => (
                      <th
                        key={`${dt}|${b}`}
                        className="py-2 px-1 text-center eyebrow text-[9px] text-ink-400 font-semibold"
                        title={`${DEAL_LABELS[dt] ?? dt} · ${b}`}
                      >
                        <div className="leading-[1.15] whitespace-nowrap">
                          <div>{DEAL_LABELS[dt] ?? dt}</div>
                          <div className="text-ink-300 font-mono tabular text-[9px] normal-case tracking-normal">
                            {b}
                          </div>
                        </div>
                      </th>
                    )),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100/60">
                {rad.artists.map((a) => {
                  const cellByKey = new Map(
                    a.cells.map((c) => [`${c.dealType}|${c.bucket}`, c]),
                  );
                  const topDealType = a.dealTypeMix[0];
                  return (
                    <tr key={a.artistId} className="align-middle">
                      <td className="py-2.5 pr-3 sticky left-0 bg-white z-10">
                        <Link
                          href={`/artists/${a.artistId}`}
                          className="text-ink-900 font-medium hover:text-brand-700 hover:underline"
                        >
                          {a.artistName}
                        </Link>
                        {topDealType && (
                          <div className="text-[10px] text-ink-400 mt-0.5">
                            mostly {DEAL_LABELS[topDealType.dealType] ?? topDealType.dealType}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-[12px] font-mono tabular text-ink-700">
                        {a.totalShows}
                      </td>
                      <td className="py-2.5 px-2 text-[12px] font-mono tabular text-rose-700 font-semibold">
                        {a.totalDisputes}
                      </td>
                      {activeDealTypes.flatMap((dt) =>
                        activeBuckets.map((b) => {
                          const c = cellByKey.get(`${dt}|${b}`);
                          if (!c || c.shows === 0) {
                            return (
                              <td
                                key={`${dt}|${b}`}
                                className="py-2 px-1 text-center text-ink-200 font-mono tabular text-[10px]"
                              >
                                ·
                              </td>
                            );
                          }
                          const title = [
                            `${DEAL_LABELS[dt] ?? dt} · ${b}`,
                            `${c.disputed} disputed of ${c.shows} show${c.shows === 1 ? "" : "s"}`,
                            c.disputedAmount > 0
                              ? `${formatMoneyCompact(c.disputedAmount)} contested`
                              : null,
                            c.topTopic ? `top topic: ${RECOUP_LABELS[c.topTopic] ?? c.topTopic}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ");
                          return (
                            <td key={`${dt}|${b}`} className="py-1 px-0.5">
                              <Link
                                href={showsHref({
                                  artistId: a.artistId,
                                  dealType: dt,
                                  size: b,
                                })}
                                className={`block rounded text-center font-mono tabular text-[10.5px] leading-[1.4] px-1 py-1 ${cellBg(c.disputed, c.shows)} ${cellFg(c.disputed, c.shows)} hover:ring-1 hover:ring-ink-300`}
                                title={title}
                              >
                                {c.disputed}/{c.shows}
                              </Link>
                            </td>
                          );
                        }),
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink-200 bg-ink-50/60">
                  <td className="py-2 pr-3 sticky left-0 bg-ink-50/60 z-10 text-[11px] eyebrow text-ink-600 font-semibold">
                    Column total
                  </td>
                  <td className="py-2 px-2 text-[12px] font-mono tabular text-ink-800 font-semibold">
                    {grandShows}
                  </td>
                  <td className="py-2 px-2 text-[12px] font-mono tabular text-rose-800 font-semibold">
                    {grandDisputed}
                  </td>
                  {activeDealTypes.flatMap((dt) =>
                    activeBuckets.map((b) => {
                      const t = colTotals.get(`${dt}|${b}`);
                      if (!t || t.shows === 0) {
                        return (
                          <td
                            key={`tot-${dt}|${b}`}
                            className="py-2 px-1 text-center text-ink-200 font-mono tabular text-[10px]"
                          >
                            ·
                          </td>
                        );
                      }
                      const rate = t.disputed / t.shows;
                      const pctOfAllShows =
                        grandShows > 0 ? (t.shows / grandShows) * 100 : 0;
                      const title = [
                        `${DEAL_LABELS[dt] ?? dt} · ${b}`,
                        `${t.disputed} disputed of ${t.shows} shows (${(rate * 100).toFixed(0)}% dispute rate)`,
                        `${pctOfAllShows.toFixed(0)}% of the repeat-artist corpus`,
                      ].join(" · ");
                      return (
                        <td
                          key={`tot-${dt}|${b}`}
                          className="py-1.5 px-1 text-center"
                          title={title}
                        >
                          <div className="font-mono tabular text-[11px] text-ink-900 font-semibold leading-tight">
                            {t.disputed}/{t.shows}
                          </div>
                          <div className="font-mono tabular text-[9.5px] text-rose-700 leading-tight">
                            {(rate * 100).toFixed(0)}%
                          </div>
                          <div className="font-mono tabular text-[9px] text-ink-400 leading-tight">
                            {pctOfAllShows.toFixed(0)}% vol
                          </div>
                        </td>
                      );
                    }),
                  )}
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-4 pt-3 border-t border-ink-100/60 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-ink-500">
            <span className="text-ink-600 font-semibold">Cell color:</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-brand-50/60 inline-block" />
              0 disputes
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-amber-100/80 inline-block" />
              &lt; 25%
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-rose-100/80 inline-block" />
              25–50%
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-rose-200/80 inline-block" />
              50–75%
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-rose-300/85 inline-block" />
              &ge; 75%
            </span>
            <span className="ml-auto text-ink-400">
              Top 24 by total disputes · sorted desc
            </span>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function ProfitabilitySection({ data }: { data: DealAnalysis }) {
  const { profitable, unprofitable } = data.byProfitability;
  const total = profitable.count + unprofitable.count;
  const unprofitablePct = total > 0 ? (unprofitable.count / total) * 100 : 0;

  return (
    <section className="mb-16">
      <SectionHeader
        title="By profitability"
        subtitle="A show is unprofitable when net to venue (gross − to artist − total expenses) is negative. Disputes cluster on the unprofitable side — the question is by how much."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="rounded-xl border border-ink-200/60 bg-brand-50/30 p-5 ring-1 ring-inset ring-brand-200/60">
          <div className="eyebrow text-[10px] mb-2 text-brand-800">Profitable shows</div>
          <div className="flex items-baseline gap-2">
            <div
              className="text-[40px] font-mono tabular font-bold text-ink-900 leading-none"
              style={{ letterSpacing: "-0.02em" }}
            >
              {profitable.count}
            </div>
            <div className="text-[12px] font-mono tabular text-ink-500">
              {(100 - unprofitablePct).toFixed(0)}%
            </div>
          </div>
          <p className="text-[12px] text-ink-600 mt-2 leading-relaxed">
            Net to venue ≥ $0 after deal payout and expenses.
          </p>
          <div className="mt-4 pt-4 border-t border-ink-200/40 space-y-2">
            <Row label="Disputed" value={`${profitable.disputed} of ${profitable.count}`} />
            <Row label="Dispute rate" value={`${(profitable.disputeRate * 100).toFixed(1)}%`} />
          </div>
        </div>
        <div className="rounded-xl border border-ink-200/60 bg-rose-50/30 p-5 ring-1 ring-inset ring-rose-200/60">
          <div className="eyebrow text-[10px] mb-2 text-rose-800">Unprofitable shows</div>
          <div className="flex items-baseline gap-2">
            <div
              className="text-[40px] font-mono tabular font-bold text-ink-900 leading-none"
              style={{ letterSpacing: "-0.02em" }}
            >
              {unprofitable.count}
            </div>
            <div className="text-[12px] font-mono tabular text-ink-500">
              {unprofitablePct.toFixed(0)}%
            </div>
          </div>
          <p className="text-[12px] text-ink-600 mt-2 leading-relaxed">
            Net to venue {"<"} $0. The venue lost money on the show.
          </p>
          <div className="mt-4 pt-4 border-t border-ink-200/40 space-y-2">
            <Row label="Disputed" value={`${unprofitable.disputed} of ${unprofitable.count}`} />
            <Row
              label="Dispute rate"
              value={`${(unprofitable.disputeRate * 100).toFixed(1)}%`}
            />
            {profitable.disputeRate > 0 && unprofitable.disputeRate > profitable.disputeRate && (
              <div className="text-[10px] text-rose-700 mt-1">
                {(unprofitable.disputeRate / profitable.disputeRate).toFixed(1)}× the dispute rate of profitable shows
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h2
        className="font-display text-[24px] font-medium text-ink-900"
        style={{ letterSpacing: "-0.02em" }}
      >
        {title}
      </h2>
      {subtitle && (
        <p className="text-[13px] text-ink-500 mt-1.5 max-w-2xl leading-relaxed">
          {subtitle}
        </p>
      )}
    </div>
  );
}

function ComplexitySection({ data }: { data: DealAnalysis }) {
  return (
    <section className="mb-16">
      <SectionHeader
        title="By complexity"
        subtitle="A structural read of the deal shape — simple flats settle in one click, % deals need cap math, and vs / door / % of net deals fall to the spreadsheet. The in-tool / spreadsheet split per bucket shows where the wizard already covers vs. where bookers still leave the tool."
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {data.byComplexity.map((c) => {
          const meta = COMPLEXITY_META[c.bucket];
          const inToolPct = c.count > 0 ? (c.inToolCount / c.count) * 100 : 0;
          return (
            <Link
              key={c.bucket}
              href={showsHref({ complexity: c.bucket })}
              className={`block relative rounded-xl border border-ink-200/60 ${meta.bg} p-5 ring-1 ring-inset ${meta.ring} ${meta.hover} transition-all cursor-pointer`}
              title={`Show ${c.count} ${meta.label.toLowerCase()} deals`}
            >
              <div className={`eyebrow text-[10px] mb-2 ${meta.fg}`}>
                {meta.label}
              </div>
              <div className="flex items-baseline gap-2">
                <div
                  className="text-[40px] font-mono tabular font-bold text-ink-900 leading-none"
                  style={{ letterSpacing: "-0.02em" }}
                >
                  {c.count}
                </div>
                <div className="text-[12px] font-mono tabular text-ink-500">
                  {(c.pct * 100).toFixed(0)}%
                </div>
              </div>
              <p className="text-[12px] text-ink-600 mt-2 leading-relaxed">
                {meta.blurb}
              </p>
              <div className="mt-4 pt-4 border-t border-ink-200/40 space-y-2">
                <Row
                  label="Avg payout"
                  value={c.avgPayout > 0 ? formatMoneyCompact(c.avgPayout) : "—"}
                />
                <Row label="Settled in tool" value={`${c.inToolCount} of ${c.count}`} />
                <div className="h-1.5 rounded-full bg-ink-100 overflow-hidden">
                  <div
                    className="h-full bg-brand-700"
                    style={{ width: `${inToolPct}%` }}
                  />
                </div>
                <div className="text-[10px] text-ink-400">
                  {inToolPct.toFixed(0)}% in tool ·{" "}
                  {(100 - inToolPct).toFixed(0)}% spreadsheet
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function SizeSection({ data }: { data: DealAnalysis }) {
  const [, setLocation] = useLocation();
  const maxCount = Math.max(...data.bySize.map((b) => b.count), 1);
  return (
    <section className="mb-16">
      <SectionHeader
        title="By deal size"
        subtitle="Bucketed by guarantee. The high end is where disputes actually move money."
      />
      <Card>
        <CardContent>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left border-b border-ink-100/80">
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold">
                  Bucket
                </th>
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold">
                  Volume
                </th>
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                  Avg gross
                </th>
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                  Avg to artist
                </th>
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                  Losing money
                </th>
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                  Dispute rate
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100/60">
              {data.bySize.map((b) => {
                const barWidth = (b.count / maxCount) * 100;
                const alarming = b.disputeRate >= 0.1;
                const disabled = b.count === 0;
                const baseClass =
                  "table-row align-middle transition-colors cursor-pointer hover:bg-brand-50/40";
                const inner = (
                  <>
                    <td className="py-3 font-medium text-ink-900">{b.bucket}</td>
                    <td className="py-3 pr-6">
                      <div className="flex items-center gap-2 max-w-xs">
                        <div
                          className="h-5 rounded-[3px] bg-ink-300/80 group-hover:bg-brand-600 flex items-center min-w-[24px] transition-colors"
                          style={{ width: `${Math.max(barWidth, 3)}%` }}
                        >
                          <span className="text-[10px] font-mono tabular font-medium text-white px-1.5">
                            {b.count}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono tabular text-ink-400">
                          {(b.pct * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3 text-right font-mono tabular">
                      {b.avgGross > 0 ? formatMoneyCompact(b.avgGross) : "—"}
                    </td>
                    <td className="py-3 text-right font-mono tabular">
                      {b.avgToArtist > 0 ? formatMoneyCompact(b.avgToArtist) : "—"}
                    </td>
                    <td className="py-3 text-right font-mono tabular text-ink-600">
                      {b.profitN > 0 ? (
                        <>
                          <span className={b.losingMoneyCount > 0 ? "text-rose-700 font-semibold" : ""}>
                            {b.losingMoneyCount}
                          </span>
                          <span className="text-ink-400"> / {b.profitN}</span>
                          {b.losingMoneyCount > 0 && (
                            <span className="text-[10px] text-rose-700 ml-1">
                              ({((b.losingMoneyCount / b.profitN) * 100).toFixed(0)}%)
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </td>
                    <td
                      className={`py-3 text-right font-mono tabular ${
                        alarming ? "text-rose-700 font-semibold" : "text-ink-600"
                      }`}
                    >
                      {(b.disputeRate * 100).toFixed(1)}%
                    </td>
                  </>
                );
                if (disabled) {
                  return (
                    <tr key={b.bucket} className="opacity-60">
                      {inner}
                    </tr>
                  );
                }
                const params = new URLSearchParams({ size: b.bucket });
                if (alarming) params.set("disputed", "1");
                const target = `/shows?${params.toString()}`;
                return (
                  <tr
                    key={b.bucket}
                    onClick={() => setLocation(target)}
                    className={`group ${baseClass}`}
                    title={
                      alarming
                        ? `Show ${b.count} disputed ${b.bucket} deals`
                        : `Show ${b.count} ${b.bucket} deals`
                    }
                  >
                    {inner}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </section>
  );
}

function CostsSection({ data }: { data: DealAnalysis }) {
  const { costs } = data;
  const expenseEntries = Object.entries(costs.expensesByCategory).sort(
    ([, a], [, b]) => b - a,
  );
  const recoupEntries = Object.entries(costs.recoupsByCategory).sort(
    ([, a], [, b]) => b.amount - a.amount,
  );
  const maxExpense = Math.max(...expenseEntries.map(([, v]) => v), 1);
  const maxRecoup = Math.max(...recoupEntries.map(([, v]) => v.amount), 1);

  return (
    <section className="mb-16">
      <SectionHeader
        title="Costs"
        subtitle="What the venue actually spends and recoups against the artist's share. Recoups are the most frequent dispute trigger."
      />
      <div className="flex items-baseline gap-10 pb-5 mb-6 border-b border-ink-200/60">
        <Stat label="Total expenses" value={formatMoneyCompact(costs.totalExpenses)} mono />
        <Stat label="Total recouped" value={formatMoneyCompact(costs.totalRecoups)} mono />
        <Stat
          label="Disputed recoup value"
          value={formatMoney(costs.disputedRecoupValue)}
          mono
          alarming={costs.disputedRecoupValue > 0}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card>
          <CardContent>
            <div className="eyebrow text-[10px] text-ink-500 mb-4">
              Expenses by category
            </div>
            {expenseEntries.length === 0 ? (
              <div className="text-[13px] text-ink-400">No expenses recorded.</div>
            ) : (
              <div className="space-y-1">
                {expenseEntries.map(([cat, amount]) => {
                  const pct = (amount / maxExpense) * 100;
                  return (
                    <Link
                      key={cat}
                      href={showsHref({ expense: cat })}
                      className="group flex items-center gap-3 px-2 py-1 -mx-2 rounded-md hover:bg-brand-50/50 transition-colors cursor-pointer"
                      title={`Shows with ${EXPENSE_LABELS[cat] ?? cat} expenses`}
                    >
                      <div className="w-28 text-right">
                        <span className="text-[12px] text-ink-700 group-hover:text-brand-800">
                          {EXPENSE_LABELS[cat] ?? cat}
                        </span>
                      </div>
                      <div className="flex-1 flex items-center gap-2">
                        <div
                          className="h-6 rounded-[3px] bg-ink-300/80 group-hover:bg-brand-600 flex items-center min-w-[24px] transition-colors"
                          style={{ width: `${Math.max(pct, 3)}%` }}
                        />
                        <span className="text-[11px] font-mono tabular text-ink-600 whitespace-nowrap">
                          {formatMoneyCompact(amount)}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="eyebrow text-[10px] text-rose-700 mb-4">
              Recoups by category · disputed value highlighted
            </div>
            {recoupEntries.length === 0 ? (
              <div className="text-[13px] text-ink-400">No recoups recorded.</div>
            ) : (
              <div className="space-y-1">
                {recoupEntries.map(([cat, v]) => {
                  const pct = (v.amount / maxRecoup) * 100;
                  const disputedPct =
                    v.amount > 0 ? (v.disputedAmount / v.amount) * 100 : 0;
                  const isDisputed = v.disputedAmount > 0;
                  return (
                    <Link
                      key={cat}
                      href={showsHref({
                        recoup: cat,
                        ...(isDisputed ? { recoupDisputed: "1" } : {}),
                      })}
                      className="group flex items-center gap-3 px-2 py-1 -mx-2 rounded-md hover:bg-rose-50/50 transition-colors cursor-pointer"
                      title={
                        isDisputed
                          ? `Shows with disputed ${RECOUP_LABELS[cat] ?? cat} recoups`
                          : `Shows with ${RECOUP_LABELS[cat] ?? cat} recoups`
                      }
                    >
                      <div className="w-32 text-right">
                        <span className="text-[12px] text-ink-700 group-hover:text-rose-800">
                          {RECOUP_LABELS[cat] ?? cat}
                        </span>
                      </div>
                      <div className="flex-1 flex items-center gap-2">
                        <div
                          className="h-6 rounded-[3px] bg-ink-300/70 relative flex items-center min-w-[24px] overflow-hidden"
                          style={{ width: `${Math.max(pct, 3)}%` }}
                        >
                          {disputedPct > 0 && (
                            <div
                              className="h-full bg-rose-500/90"
                              style={{ width: `${disputedPct}%` }}
                            />
                          )}
                        </div>
                        <span className="text-[11px] font-mono tabular text-ink-600 whitespace-nowrap">
                          {formatMoneyCompact(v.amount)}
                        </span>
                        {v.disputedAmount > 0 && (
                          <span className="text-[10px] font-mono tabular text-rose-700 whitespace-nowrap">
                            ({formatMoneyCompact(v.disputedAmount)} disputed)
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function RevenueSection({ data }: { data: DealAnalysis }) {
  const [, setLocation] = useLocation();
  const { revenue } = data;
  const dealTypes = Object.keys(revenue.byDealType).sort(
    (a, b) => revenue.byDealType[b].gross - revenue.byDealType[a].gross,
  );
  const maxMonthGross = Math.max(...revenue.months.map((m) => m.gross), 1);

  return (
    <section className="mb-10">
      <SectionHeader
        title="Revenue"
        subtitle="Gross box office, net to venue (gross minus what goes to the artist and to expenses), and total to artist — by deal type and by month."
      />
      <Card className="mb-5">
        <CardContent>
          <div className="eyebrow text-[10px] text-ink-500 mb-4">
            By deal type
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left border-b border-ink-100/80">
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold">
                  Deal type
                </th>
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                  Shows
                </th>
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                  Gross
                </th>
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                  To artist
                </th>
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                  Net to venue
                </th>
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold pl-4">
                  Trend (gross / month)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100/60">
              {dealTypes.map((t) => {
                const r = revenue.byDealType[t];
                const supported = t === "flat" || t === "percentage_of_gross";
                const monthGross = revenue.months.map((m) => m.byType[t] ?? 0);
                const peak = Math.max(...monthGross, 1);
                return (
                  <tr
                    key={t}
                    onClick={() => setLocation(`/shows?dealType=${encodeURIComponent(t)}`)}
                    className="group cursor-pointer hover:bg-brand-50/40 transition-colors"
                    title={`Show ${r.count} ${DEAL_LABELS[t] ?? t} deals`}
                  >
                    <td className="py-2.5">
                      <span className="text-ink-900 font-medium group-hover:text-brand-800 transition-colors">
                        {DEAL_LABELS[t] ?? t}
                      </span>
                      {!supported && (
                        <span className="ml-2 text-[9px] text-amber-700 uppercase tracking-[0.08em] font-semibold">
                          unsupported
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-right font-mono tabular text-ink-600">
                      {r.count}
                    </td>
                    <td className="py-2.5 text-right font-mono tabular">
                      {formatMoneyCompact(r.gross)}
                    </td>
                    <td className="py-2.5 text-right font-mono tabular text-ink-600">
                      {formatMoneyCompact(r.toArtist)}
                    </td>
                    <td className="py-2.5 text-right font-mono tabular text-brand-800 font-semibold">
                      {formatMoneyCompact(r.netToVenue)}
                    </td>
                    <td className="py-2.5 pl-4">
                      <div className="flex items-end gap-[2px] h-7">
                        {monthGross.map((g, i) => (
                          <div
                            key={i}
                            className={`w-[3px] rounded-[1px] ${
                              supported ? "bg-brand-600/70" : "bg-amber-500/70"
                            }`}
                            style={{ height: `${(g / peak) * 100}%`, minHeight: g > 0 ? "2px" : "1px" }}
                          />
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <CrossTabCard data={data} />

      <Card>
        <CardContent>
          <div className="eyebrow text-[10px] text-ink-500 mb-4">
            By month · last 24
          </div>
          <div className="flex items-end gap-[3px] h-32">
            {revenue.months.map((m) => {
              const h = (m.gross / maxMonthGross) * 100;
              return (
                <div
                  key={m.month}
                  className="flex-1 flex flex-col items-center gap-1 group"
                  title={`${m.label}: ${formatMoney(m.gross)} gross · ${formatMoney(m.netToVenue)} net to venue`}
                >
                  <div className="flex-1 flex items-end w-full">
                    <div
                      className="w-full rounded-t-[2px] bg-brand-600/80 group-hover:bg-brand-700 transition-colors"
                      style={{ height: `${Math.max(h, 1)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-[3px] mt-1.5">
            {revenue.months.map((m, i) => (
              <div
                key={m.month}
                className="flex-1 text-center text-[8.5px] font-mono tabular text-ink-400"
              >
                {i % 3 === 0 ? m.label : ""}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

const ATTENTION_KIND_ORDER: AttentionKind[] = [
  "stale_disputed",
  "disputed_recoups_but_signed",
  "show_settled_no_settlement",
  "notes_say_closed_but_status_open",
  "expense_overrun",
];
const ATTENTION_KIND_SHORT: Record<AttentionKind, string> = {
  stale_disputed: "stale dispute",
  disputed_recoups_but_signed: "disputed recoup",
  show_settled_no_settlement: "missing settlement",
  notes_say_closed_but_status_open: "notes vs status",
  expense_overrun: "expense overrun",
};

function CrossTabCard({ data }: { data: DealAnalysis }) {
  const [, setLocation] = useLocation();
  const ct = data.revenue.crossTabBySizeAndType;
  const cellByKey = new Map(ct.cells.map((c) => [`${c.dealType}|${c.bucket}`, c]));

  const activeBuckets = ct.buckets.filter((b) =>
    ct.cells.some((c) => c.bucket === b),
  );

  return (
    <Card className="mb-5">
      <CardContent>
        <div className="flex items-baseline justify-between mb-4">
          <div className="eyebrow text-[10px] text-ink-500">
            Deal type × deal size · losing money / disputed / needs attention
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
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left border-b border-ink-100/80">
              <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold">
                Deal type
              </th>
              {activeBuckets.map((b) => (
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
            {ct.dealTypes.map((dt) => {
              const supported = dt === "flat" || dt === "percentage_of_gross";
              return (
                <tr key={dt} className="align-middle">
                  <td className="py-2.5 pr-3">
                    <span className="text-ink-900 font-medium">
                      {DEAL_LABELS[dt] ?? dt}
                    </span>
                    {!supported && (
                      <span className="ml-2 text-[9px] text-amber-700 uppercase tracking-[0.08em] font-semibold">
                        unsupported
                      </span>
                    )}
                  </td>
                  {activeBuckets.map((b) => {
                    const cell = cellByKey.get(`${dt}|${b}`);
                    if (!cell) {
                      return (
                        <td
                          key={b}
                          className="py-2.5 px-2 text-center text-ink-300 font-mono tabular text-[11px]"
                        >
                          —
                        </td>
                      );
                    }
                    const losingHot = cell.losingMoneyRate >= 0.5;
                    const disputeHot = cell.disputeRate >= 0.1;
                    const attentionHot = cell.attentionRate >= 0.1;
                    const params = new URLSearchParams({
                      dealType: dt,
                      size: b,
                    });
                    const kindBreakdown = ATTENTION_KIND_ORDER
                      .map((k) => {
                        const n = cell.attentionByKind[k] ?? 0;
                        return n > 0 ? `${ATTENTION_KIND_SHORT[k]}: ${n}` : null;
                      })
                      .filter(Boolean)
                      .join(", ");
                    const attentionTitle = cell.attentionCount > 0
                      ? `${cell.attentionCount}/${cell.count} flagged (${kindBreakdown})`
                      : "No attention flags";
                    return (
                      <td
                        key={b}
                        onClick={() => setLocation(`/shows?${params.toString()}`)}
                        className="py-2 px-2 cursor-pointer hover:bg-brand-50/40 transition-colors"
                        title={`${cell.count} ${DEAL_LABELS[dt] ?? dt} deals in ${b} · ${cell.losingMoneyCount}/${cell.profitN} losing money · ${cell.disputed}/${cell.settledN} disputed · ${attentionTitle}`}
                      >
                        <div className="text-center">
                          <div className="text-[10px] font-mono tabular text-ink-400 mb-0.5">
                            n={cell.count}
                          </div>
                          <div className="flex items-center justify-center gap-1.5">
                            <span
                              className={`font-mono tabular text-[12px] ${
                                losingHot ? "text-rose-700 font-semibold" : "text-ink-700"
                              }`}
                              title="Losing money rate"
                            >
                              {cell.profitN > 0
                                ? `${(cell.losingMoneyRate * 100).toFixed(0)}%`
                                : "—"}
                            </span>
                            <span className="text-ink-300">·</span>
                            <span
                              className={`font-mono tabular text-[12px] ${
                                disputeHot ? "text-amber-700 font-semibold" : "text-ink-500"
                              }`}
                              title="Dispute rate"
                            >
                              {cell.settledN > 0
                                ? `${(cell.disputeRate * 100).toFixed(0)}%`
                                : "—"}
                            </span>
                            <span className="text-ink-300">·</span>
                            <span
                              className={`font-mono tabular text-[12px] ${
                                attentionHot ? "text-violet-700 font-semibold" : "text-ink-500"
                              }`}
                              title={attentionTitle}
                            >
                              {`${(cell.attentionRate * 100).toFixed(0)}%`}
                            </span>
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-[11px] text-ink-400 mt-3 leading-relaxed">
          Each cell shows count of deals (n=), then losing-money rate ·
          dispute rate · needs-attention rate. Thresholds: ≥50% losing
          money (red), ≥10% disputed (amber), ≥10% needs attention
          (violet). Hover for the kind breakdown; click to see the shows.
        </p>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between text-[12px]">
      <span className="text-ink-500">{label}</span>
      <span className="font-mono tabular text-ink-800 font-medium">{value}</span>
    </div>
  );
}

function Stat({
  label, value, mono = false, alarming = false,
}: {
  label: string; value: string; mono?: boolean; alarming?: boolean;
}) {
  return (
    <div>
      <div className={`eyebrow text-[10px] ${alarming ? "text-rose-700" : "text-ink-400"}`}>
        {label}
      </div>
      <div
        className={`text-[28px] font-medium mt-1 leading-none ${
          alarming ? "text-rose-700" : "text-ink-900"
        } ${mono ? "font-mono tabular !font-semibold" : "font-display"}`}
        style={!mono ? { letterSpacing: "-0.02em" } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
