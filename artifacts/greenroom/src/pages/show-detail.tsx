import { useState, useEffect } from "react";
import { Link, useParams } from "wouter";
import {
  ArrowLeft, FileSpreadsheet, AlertCircle, Clock, TrendingUp, FileJson, Loader2,
  Shield, Check, X, Sparkles, AlertTriangle,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription, Field,
} from "@/components/ui/card";
import { StatusBadge, DealTypeBadge, PlainBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parseBonuses } from "@/lib/dealMath";
import {
  formatMoney, formatMoneyCompact, formatShowDateFull, relativeShowDate,
} from "@/lib/format";
import type { Bonus, SwitchSuggestion, GuaranteeSuggestion, Deal, Settlement, DealImprovementsPayload, DealImprovement, ImprovementKind } from "@/lib/types";
import { Wrench } from "lucide-react";
import { useApiData, LoadingState } from "@/hooks/useApiData";
import { ShowMeter } from "@/components/show-meter";
import { AiPrompt } from "@/components/ai-prompt";
import NotFound from "./not-found";

const COMP_LABELS: Record<string, string> = {
  artist_gl: "Artist guest list",
  label: "Label / management",
  press: "Press",
  venue_staff: "Venue staff",
  sponsor: "Sponsor",
  promo: "Promo / radio",
  other: "Other",
};

function ExportJsonButton({ showId, artistName, date }: { showId: string; artistName: string; date: string }) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  async function handleClick() {
    setState("loading");
    setErr(null);
    try {
      const data = await api.showExport(showId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeName = artistName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      a.href = url;
      a.download = `greenroom-${date}-${safeName}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setState("idle");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to generate JSON");
      setState("error");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="ghost" size="sm" onClick={handleClick} disabled={state === "loading"}>
        {state === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileJson className="h-3.5 w-3.5" />}
        {state === "loading" ? "Generating…" : "Generate JSON"}
      </Button>
      {state === "error" && err && (
        <span className="text-[11px] text-rose-600">{err}</span>
      )}
    </div>
  );
}

export default function ShowDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const state = useApiData(() => api.show(id), [id, reloadKey]);

  if (state.status === "loading") return <LoadingState label="Loading show..." />;
  if (state.status === "error") {
    if (state.error.message === "not_found") return <NotFound />;
    return <LoadingState label={`Error: ${state.error.message}`} />;
  }

  const data = state.data;
  const { show, artist, agent, agency, deal, settlement, ticketSales, expenses, comps } = data;

  const grossSoFar = ticketSales.reduce((sum, t) => sum + t.gross, 0);
  const totalFees = ticketSales.reduce((sum, t) => sum + t.fees, 0);
  const totalTickets = ticketSales.reduce((sum, t) => sum + (t.qty ?? 0), 0);
  const totalExpenses = expenses
    .filter((e) => !e.absorbedByVenue)
    .reduce((sum, e) => sum + e.amount, 0);
  const absorbedTotal = expenses
    .filter((e) => e.absorbedByVenue)
    .reduce((sum, e) => sum + e.amount, 0);

  const totalCompCount = comps.reduce((s, c) => s + c.count, 0);
  const compsCountingTowardGross = comps
    .filter((c) => c.countsTowardGross)
    .reduce((s, c) => s + c.count, 0);

  const bonuses = deal ? parseBonuses(deal) : [];

  const isUnsupported = data.isUnsupportedDeal;
  const isDisputed = data.isDisputed;

  return (
    <div className="max-w-7xl">
      <div className={`px-12 pt-10 pb-14 ${isDisputed ? "bg-gradient-to-b from-rose-50/40 to-canvas" : "bg-gradient-to-b from-brand-50/30 to-canvas"}`}>
        <Link
          href="/shows"
          className="inline-flex items-center gap-1 text-[12px] text-ink-400 hover:text-ink-900 mb-8 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All shows
        </Link>

        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="flex items-center gap-1.5 mb-4">
              <StatusBadge status={show.status} />
              {deal && <DealTypeBadge type={deal.dealType} />}
              {isUnsupported && <PlainBadge variant="amber">Unsupported</PlainBadge>}
              {isDisputed && <PlainBadge variant="rose">Disputed</PlainBadge>}
              {bonuses.length > 0 && (
                <PlainBadge variant="brand">
                  {bonuses.length} bonus{bonuses.length === 1 ? "" : "es"}
                </PlainBadge>
              )}
            </div>
            <h1
              className="font-display text-[56px] font-medium text-ink-900 leading-[1.02]"
              style={{ letterSpacing: "-0.025em", fontOpticalSizing: "auto" }}
            >
              {artist?.name ?? "—"}
            </h1>
            <div className="text-[14px] text-ink-400 mt-3 flex items-center gap-2">
              <span className="text-ink-600 font-medium">{formatShowDateFull(show.date)}</span>
              <span className="text-ink-300">·</span>
              <span>{relativeShowDate(show.date)}</span>
              <span className="text-ink-200">·</span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                doors {show.doorsTime} · set {show.setTime}
              </span>
            </div>
          </div>
          <div className="mt-6 shrink-0 flex flex-col items-end gap-2">
            <Link href={`/shows/${show.id}/settle`}>
              <Button variant="brand" size="lg">
                <FileSpreadsheet className="h-4 w-4" />
                {settlement ? "View settlement" : "Settle show"}
              </Button>
            </Link>
            <ExportJsonButton showId={show.id} artistName={artist?.name ?? "show"} date={show.date} />
          </div>
        </div>

        <div className="flex items-baseline gap-10 mt-8 pt-5 border-t border-ink-200/40">
          <MiniStat label="Gross" value={formatMoneyCompact(grossSoFar)} />
          <MiniStat label="Tickets" value={String(totalTickets)} />
          <MiniStat label="Expenses" value={formatMoneyCompact(totalExpenses)} />
          {settlement?.totalToArtist != null && (
            <MiniStat label="To artist" value={formatMoneyCompact(settlement.totalToArtist)} accent />
          )}
        </div>
      </div>

      <div className="px-12 pb-12">
        {show.internalNotes?.startsWith("[NEW DEMO]") && (
          <div className="mb-3 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 text-[10px] font-semibold tracking-wide ring-1 ring-violet-200">
            NEW DEMO
          </div>
        )}
        {show.internalNotes && (
          <div className="mb-8 mt-1 rounded-lg bg-amber-50/50 ring-1 ring-amber-200/60 p-5 flex gap-3">
            <AlertCircle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
            <div>
              <div className="eyebrow text-[10px] text-amber-800 mb-1.5">
                Mariana&apos;s notes
              </div>
              <div className="text-[13px] text-ink-800 leading-relaxed">
                {show.internalNotes}
              </div>
            </div>
          </div>
        )}

        <div className="mb-5">
          <AiPrompt scope="show" id={show.id} variant="inline" title="Ask about this show" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-2">
          {deal && deal.dealType !== "flat" && switchEligibleClient(deal) && isActionableStage(settlement) && (
            <SmartSwitchPanel
              showId={show.id}
              deal={deal}
              settlement={settlement}
              initial={data.switchSuggestion}
              sgp={data.guaranteeSuggestion}
              onApplied={reload}
            />
          )}
          {deal && deal.dealType !== "flat" && !switchEligibleClient(deal) && isActionableStage(settlement) && (
            <SmartGuaranteedPricePanel
              showId={show.id}
              deal={deal}
              settlement={settlement}
              initial={data.guaranteeSuggestion}
            />
          )}
          {deal && deal.dealType !== "flat" && !switchEligibleClient(deal) && isActionableStage(settlement) && (
            <ImproveDealPanel
              showId={show.id}
              deal={deal}
              agentName={agent?.name ?? null}
              onApplied={reload}
            />
          )}

          <Card className="md:col-span-2">
            <CardHeader>
              <div>
                <CardTitle>Deal terms</CardTitle>
                <CardDescription>
                  What was negotiated. Mariana enters this from the email
                  thread with the agent.
                </CardDescription>
              </div>
              {deal && <DealTypeBadge type={deal.dealType} />}
            </CardHeader>
            <CardContent className="space-y-5">
              {deal ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <Field
                      label="Agent guarantee" mono
                      value={deal.guaranteeAmount != null ? formatMoney(deal.guaranteeAmount) : "—"}
                    />
                    <Field
                      label="Percentage" mono
                      value={deal.percentage != null
                        ? `${(deal.percentage * 100).toFixed(0)}% ${deal.percentageBasis ? `of ${deal.percentageBasis}` : ""}`
                        : "—"}
                    />
                    <Field
                      label="Expense cap" mono
                      value={deal.expenseCap != null ? formatMoney(deal.expenseCap) : "—"}
                    />
                    <Field
                      label="Hospitality cap" mono
                      value={deal.hospitalityCap != null ? formatMoney(deal.hospitalityCap) : "—"}
                    />
                  </div>

                  {bonuses.length > 0 && (
                    <div className="rounded-lg ring-1 ring-brand-200/50 bg-brand-50/20 p-4">
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <TrendingUp className="h-3.5 w-3.5 text-brand-700" />
                        <div className="eyebrow text-[10px] text-brand-800">
                          Bonuses & escalators (structured)
                        </div>
                      </div>
                      <ul className="space-y-2">
                        {bonuses.map((b, i) => (
                          <li key={i} className="text-[12.5px] text-ink-800 flex items-start gap-2">
                            <BonusBadge type={b.type} />
                            <span className="leading-relaxed">{b.label}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="text-[11px] text-ink-400 mt-3 leading-snug">
                        Stored in{" "}
                        <code className="font-mono text-[10px] bg-white/80 px-1 py-0.5 rounded ring-1 ring-ink-200/40">
                          bonuses_json
                        </code>
                        . The in-app tool only reads structured bonuses — anything
                        in the prose below is invisible to it.
                      </div>
                    </div>
                  )}

                  {deal.dealNotesFreetext && (
                    <div>
                      <div className="eyebrow text-[10px] text-ink-500 mb-2">
                        Deal notes (free text — what Mariana actually trusts)
                      </div>
                      <div className="text-[13px] text-ink-800 bg-canvas-soft rounded-lg p-4 ring-1 ring-ink-200/50 leading-relaxed font-[450]" style={{ fontStyle: "italic" }}>
                        {deal.dealNotesFreetext}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-[13px] text-ink-400">No deal entered yet.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Artist & agent</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Artist" value={artist?.name ?? "—"} />
              <Field
                label="Genre"
                value={<span className="capitalize">{artist?.genre ?? "—"}</span>}
              />
              <Field label="Prior shows here" value={String(artist?.priorShowCount ?? 0)} mono />
              <Field
                label="Agent"
                value={agent ? `${agent.name}${agency ? ` · ${agency.name}` : ""}` : "—"}
              />
              {agent?.preferencesNotes && (
                <div>
                  <div className="eyebrow text-[10px] text-ink-500 mb-2">Agent notes</div>
                  <div className="text-[12.5px] text-ink-800 bg-amber-50/50 ring-1 ring-amber-200/50 rounded-lg p-3 leading-relaxed">
                    {agent.preferencesNotes}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Box office</CardTitle>
              <CardDescription>From integrated ticketing.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div>
                  <div className="eyebrow text-[10px] text-ink-400">Gross</div>
                  <div className="text-[28px] font-mono tabular font-semibold text-ink-900 mt-1 leading-none">
                    {formatMoneyCompact(grossSoFar)}
                  </div>
                </div>
                {totalTickets > 0 ? (
                  <div className="text-[12px] text-ink-500 pt-4 border-t border-ink-100/80 leading-relaxed">
                    <span className="font-mono tabular font-medium text-ink-700">{totalTickets}</span>{" "}
                    tickets ·{" "}
                    <span className="font-mono tabular">{formatMoney(totalFees)}</span>{" "}
                    in fees
                    <div className="mt-1.5 text-ink-400">
                      Net{" "}
                      <span className="font-mono tabular text-ink-700">
                        {formatMoneyCompact(grossSoFar - totalFees)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-[12px] text-ink-400 pt-3 border-t border-ink-100/80">
                    No sales yet.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <div>
                <CardTitle>Comps</CardTitle>
                <CardDescription>
                  {totalCompCount} comp tickets across {comps.length}{" "}
                  categor{comps.length === 1 ? "y" : "ies"}.
                  {compsCountingTowardGross > 0 && (
                    <>
                      {" "}
                      <span className="text-amber-700 font-medium">
                        {compsCountingTowardGross} count toward gross.
                      </span>
                    </>
                  )}
                </CardDescription>
              </div>
              <PlainBadge variant="default">{totalCompCount} total</PlainBadge>
            </CardHeader>
            <CardContent>
              {comps.length === 0 ? (
                <div className="text-[13px] text-ink-400">
                  No comps recorded for this show.
                </div>
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left border-b border-ink-100/80">
                      <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold">Category</th>
                      <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">Count</th>
                      <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">Face value</th>
                      <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">Counts toward gross?</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100/60">
                    {comps.map((c) => (
                      <tr key={c.id}>
                        <td className="py-2.5">
                          {COMP_LABELS[c.category] ?? c.category}
                          {c.notes && <span className="text-ink-400 ml-1">· {c.notes}</span>}
                        </td>
                        <td className="py-2.5 text-right font-mono tabular">{c.count}</td>
                        <td className="py-2.5 text-right font-mono tabular text-ink-500">
                          {formatMoney(c.faceValue * c.count)}
                        </td>
                        <td className="py-2.5 text-right">
                          {c.countsTowardGross ? (
                            <span className="text-amber-700 font-medium">Yes</span>
                          ) : (
                            <span className="text-ink-400">No</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <div className="md:col-span-3 mb-1">
            <ShowMeter showId={show.id} />
          </div>

          <Card className="md:col-span-3">
            <CardHeader>
              <div>
                <CardTitle>Expenses</CardTitle>
                <CardDescription>Entered during the week, often incompletely.</CardDescription>
              </div>
              {absorbedTotal > 0 && (
                <PlainBadge variant="amber">{formatMoney(absorbedTotal)} absorbed</PlainBadge>
              )}
            </CardHeader>
            <CardContent>
              {expenses.length === 0 ? (
                <div className="text-[13px] text-ink-400">No expenses entered yet.</div>
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left border-b border-ink-100/80">
                      <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold">Category</th>
                      <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold">Description</th>
                      <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100/60">
                    {expenses.map((e) => (
                      <tr key={e.id}>
                        <td className="py-2.5 capitalize">
                          {e.category}
                          {e.absorbedByVenue && (
                            <PlainBadge variant="amber" className="ml-2">absorbed</PlainBadge>
                          )}
                        </td>
                        <td className="py-2.5 text-ink-500">{e.description ?? "—"}</td>
                        <td className="py-2.5 text-right font-mono tabular">{formatMoney(e.amount)}</td>
                      </tr>
                    ))}
                    <tr className="font-medium">
                      <td className="py-3" colSpan={2}>Total (passed through)</td>
                      <td className="py-3 text-right font-mono tabular">{formatMoney(totalExpenses)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  label, value, accent = false,
}: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="eyebrow text-[9px] text-ink-400">{label}</div>
      <div className={`text-[18px] font-mono tabular font-semibold mt-0.5 leading-none ${accent ? "text-brand-700" : "text-ink-900"}`}>
        {value}
      </div>
    </div>
  );
}

const TIER_LABEL: Record<"A" | "B" | "C" | "D", string> = {
  A: "Strong data backing",
  B: "Solid data backing",
  C: "Directional",
  D: "Thin sample",
};

function familiarityLabel(n: number | null): { label: string; tone: "neutral" | "warn" | "good" } {
  if (n == null) return { label: "Familiarity unknown", tone: "neutral" };
  if (n === 0) return { label: "First-time artist at venue", tone: "warn" };
  if (n === 1) return { label: "1 prior show at venue", tone: "neutral" };
  return { label: `${n} prior shows at venue`, tone: "good" };
}

const FAMILIARITY_COLOR: Record<"neutral" | "warn" | "good", string> = {
  neutral: "bg-ink-100 text-ink-700 ring-ink-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  good: "bg-emerald-50 text-emerald-800 ring-emerald-200",
};

const TIER_COLOR: Record<"A" | "B" | "C" | "D", string> = {
  A: "bg-emerald-50 text-emerald-800 ring-emerald-200/60",
  B: "bg-brand-50 text-brand-800 ring-brand-200/60",
  C: "bg-amber-50 text-amber-800 ring-amber-200/60",
  D: "bg-ink-100 text-ink-600 ring-ink-200/60",
};

function classifyBucketClient(deal: Deal): string {
  if (deal.guaranteeAmount == null || deal.guaranteeAmount === 0) {
    if (deal.percentage != null) return "Uncapped %";
    return "$0–1K";
  }
  const g = deal.guaranteeAmount;
  if (g < 1000) return "$0–1K";
  if (g < 5000) return "$1–5K";
  if (g < 15000) return "$5–15K";
  return "$15K+";
}

function isActionableStage(settlement: Settlement | null | undefined): boolean {
  // Smart Switch / Improve Deal / SGP suggestions are only meaningful while
  // the settlement is still being negotiated. Once it's signed/finalized/paid
  // (or there's no settlement row at all), the deal terms are locked and
  // surfacing a counterfactual would just confuse the booker.
  if (!settlement) return false;
  return settlement.status === "draft" || settlement.status === "submitted" || settlement.status === "in_review";
}

function switchEligibleClient(deal: Deal): boolean {
  const bucket = classifyBucketClient(deal);
  if (deal.dealType === "door") return true;
  if ((deal.dealType === "vs" || deal.dealType === "percentage_of_net") && bucket === "$1–5K") return true;
  return false;
}

const SWITCH_ERROR_MESSAGES: Record<string, string> = {
  no_deal: "This show doesn't have a deal attached, so there's nothing to recompute.",
  could_not_generate: "Couldn't compute a suggestion right now. Try again in a moment.",
};

function friendlySwitchError(raw: string): string {
  return SWITCH_ERROR_MESSAGES[raw] ?? raw;
}

function SmartSwitchPanel({
  showId, deal, settlement, initial, sgp, onApplied,
}: {
  showId: string;
  deal: Deal;
  settlement: Settlement | null;
  initial: SwitchSuggestion | null;
  // Same engine output as `initial.suggestedFlat` for tier A/B — passed
  // through so the card can show the math breakdown (expected gross,
  // capped expenses, breakeven, projected venue net) without rendering a
  // second card. Previously we rendered two cards reading two separately
  // persisted rows, which drifted whenever only one was regenerated and
  // looked like "two different projections on the same deal."
  sgp: GuaranteeSuggestion | null;
  onApplied: () => void;
}) {
  const [sug, setSug] = useState<SwitchSuggestion | null>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  async function call(fn: () => Promise<SwitchSuggestion>) {
    setBusy(true); setErr(null);
    try { setSug(await fn()); }
    catch (e) { setErr(friendlySwitchError(e instanceof Error ? e.message : "failed")); }
    finally { setBusy(false); }
  }

  const generate = () => call(() => api.generateSwitch(showId));
  const recompute = () => call(() => api.generateSwitch(showId, { force: true }));
  const accept = () => call(() => api.acceptSwitch(showId));
  const decline = () => call(() => api.declineSwitch(showId));

  async function applyToDeal(amount: number) {
    setBusy(true); setErr(null);
    try {
      await api.applyGuaranteeToDeal(showId, amount, true);
      setApplied(true);
      onApplied();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="md:col-span-3 ring-1 ring-brand-200/60 bg-gradient-to-br from-brand-50/30 to-canvas">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-brand-700" />
            Smart Switch
          </CardTitle>
          <CardDescription>
            {settlement
              ? <>Convert this <code className="font-mono text-[11px] bg-white/70 px-1 py-0.5 rounded ring-1 ring-ink-200/40">{deal.dealType}</code> deal into a structure the in-app settle wizard can close cleanly, using historical payouts from comparable shows.</>
              : <>This show hasn't happened yet. Use the suggestion as a <strong>negotiation lever</strong> the next time you're on the phone with the agent — historical payouts on comparable past <code className="font-mono text-[11px] bg-white/70 px-1 py-0.5 rounded ring-1 ring-ink-200/40">{deal.dealType}</code> deals at this venue, rounded into a clean flat or hybrid.</>
            }
          </CardDescription>
        </div>
        {sug && (
          <PlainBadge variant={sug.status === "accepted" ? "brand" : sug.status === "declined" ? "default" : "amber"}>
            {sug.status === "suggested" ? "Pending" : sug.status === "accepted" ? "Accepted" : "Declined"}
          </PlainBadge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!sug && (
          <div className="flex items-center justify-between gap-4">
            <div className="text-[13px] text-ink-600 leading-relaxed max-w-xl">
              {settlement
                ? <>Generate a suggestion based on every comparable past deal at this venue. Hindsight will compare it to what the show actually paid.</>
                : <>Generate a suggestion based on every comparable past deal at this venue. Accept to mark intent to push the agent toward this structure; decline to record why this deal stays as-is.</>
              }
            </div>
            <Button variant="brand" onClick={generate} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {busy ? "Computing…" : "Generate suggestion"}
            </Button>
          </div>
        )}

        {sug && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 space-y-3">
                {sug.shape === "flat" && sug.suggestedFlat != null && (() => {
                  const agentG = deal.guaranteeAmount ?? 0;
                  const delta = sug.suggestedFlat - agentG;
                  const gapAlert = !settlement && Math.abs(delta) > 150;
                  const gapDirection = delta > 0
                    ? "Smart price exceeds the agent's ask"
                    : "Agent's ask exceeds the Smart price";
                  return (
                    <div className="space-y-3">
                      <div className="eyebrow text-[10px] text-ink-500">Suggested structure — flat-equivalent (Smart Guaranteed Price)</div>
                      {settlement ? (
                        <div className="flex items-baseline gap-3 flex-wrap">
                          <span className="text-[40px] font-mono tabular font-semibold text-ink-900 leading-none">
                            {formatMoney(sug.suggestedFlat)}
                          </span>
                          {sug.source === "cell_mean" && sug.confidenceTier === "B" && sug.bandWidth != null && sug.bandWidth > 1000 ? (
                            <span className="text-[18px] font-mono tabular text-ink-500 leading-none">
                              ± {formatMoney(Math.round(sug.bandWidth / 2))}
                            </span>
                          ) : null}
                          <span className="text-[13px] text-ink-500">
                            {sug.source === "cell_mean" && sug.confidenceTier === "B" && sug.bandWidth != null && sug.bandWidth > 1000
                              ? "flat (range — historical band is wide)"
                              : "flat guarantee"}
                          </span>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-lg bg-white/60 ring-1 ring-ink-200/50 p-3">
                            <div className="eyebrow text-[10px] text-ink-500 mb-1">Agent guarantee</div>
                            <div className="text-[28px] font-mono tabular font-semibold text-ink-900 leading-none">
                              {formatMoney(agentG)}
                            </div>
                            <div className="text-[11px] text-ink-500 mt-2">As written in the deal terms</div>
                          </div>
                          <div className={`rounded-lg p-3 ring-1 ${gapAlert ? "bg-amber-50/60 ring-amber-300/60" : "bg-emerald-50/40 ring-emerald-200/60"}`}>
                            <div className="eyebrow text-[10px] text-ink-500 mb-1">Smart Guaranteed Price</div>
                            <div className="text-[28px] font-mono tabular font-semibold text-emerald-800 leading-none">
                              {formatMoney(sug.suggestedFlat)}
                              {sug.source === "cell_mean" && sug.confidenceTier === "B" && sug.bandWidth != null && sug.bandWidth > 1000 && (
                                <span className="text-[16px] font-mono tabular text-emerald-700/70 ml-1">
                                  ± {formatMoney(Math.round(sug.bandWidth / 2))}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-ink-500 mt-2">
                              {sug.source === "cell_mean" && sug.confidenceTier === "B" && sug.bandWidth != null && sug.bandWidth > 1000
                                ? "Cell-mean estimate · range shown because P10–P90 spread is wide"
                                : "7-step calc · rounded to $50"}
                            </div>
                          </div>
                        </div>
                      )}
                      {gapAlert && (
                        <div className="rounded-lg ring-1 ring-amber-300/70 bg-amber-50/70 p-3 flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
                          <div className="text-[12.5px] text-amber-900 leading-relaxed">
                            <strong>Gap of {formatMoney(Math.abs(delta))}</strong> — {gapDirection}.
                            {delta > 0
                              ? " Worth a counter-offer push toward the Smart price."
                              : " Consider declining or trimming the ask back toward the Smart price."}
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-2 flex-wrap text-[12px] text-ink-500">
                        {sug.source === "guarantee_amount" && (
                          <span className="inline-flex items-center px-1.5 py-px rounded text-[9px] font-mono uppercase tracking-wider bg-emerald-50 ring-1 ring-emerald-200/70 text-emerald-800">
                            = contract guarantee
                          </span>
                        )}
                        {sug.source === "cell_mean" && sug.confidenceTier === "B" && sug.bandWidth != null && sug.bandWidth > 1000 && (
                          <span className="inline-flex items-center px-1.5 py-px rounded text-[9px] font-mono uppercase tracking-wider bg-amber-50 ring-1 ring-amber-200/70 text-amber-800">
                            wide band · ±{formatMoney(Math.round(sug.bandWidth / 2))}
                          </span>
                        )}
                        {sug.bandLow != null && sug.bandHigh != null && (
                          <span>
                            Historical band <span className="font-mono tabular">{formatMoney(sug.bandLow)}</span> – <span className="font-mono tabular">{formatMoney(sug.bandHigh)}</span> (P10–P90)
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {sug.shape === "door_hybrid" && sug.source === "suppressed" && (
                  <div>
                    <div className="eyebrow text-[10px] text-ink-500 mb-1.5">Suggested structure</div>
                    <div className="text-[15px] text-ink-700 leading-snug">
                      Not enough comparable history to project a structure here.
                      Discuss the floor and split with the agent directly.
                    </div>
                  </div>
                )}

                {sug.shape === "flat" && sug.source === "insufficient_confidence" && (
                  <div>
                    <div className="eyebrow text-[10px] text-ink-500 mb-1.5">Suggested structure</div>
                    <div className="text-[15px] text-ink-700 leading-snug">
                      Not enough confidence or prior data to recommend a flat
                      here. Smart Switch intentionally does not mirror the
                      contract guarantee — that's an agreement-side number,
                      not a history-backed recommendation. Discuss the
                      structure directly with the agent.
                    </div>
                  </div>
                )}

                {sug.shape === "door_hybrid" && sug.source !== "suppressed" && (
                  <div>
                    <div className="eyebrow text-[10px] text-ink-500 mb-1.5">Suggested structure</div>
                    <div className="text-[20px] font-display font-medium text-ink-900 leading-tight">
                      <span className="font-mono tabular">{formatMoney(sug.doorFloor ?? 0)}</span> floor
                      {" + "}
                      <span className="font-mono tabular">{Math.round((sug.doorSplitPct ?? 0) * 100)}%</span> of pool above
                      {" "}
                      <span className="font-mono tabular">{formatMoney(sug.doorExpenseCap ?? 0)}</span> expense cap
                    </div>
                    {sug.bandHigh != null && (
                      <div className="text-[12px] text-ink-500 mt-2">
                        Projected artist payout <span className="font-mono tabular">~{formatMoney(sug.bandLow ?? 0)}</span> – <span className="font-mono tabular">{formatMoney(sug.bandHigh)}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* How we got there — math from the same SGP engine that
                    produced the suggested flat above. Only shown when the
                    Smart Switch suggestion is data-backed by SGP (sgp_engine
                    source at tier A/B) AND we have a fresh SGP row to read
                    from. At the conservative `guarantee_amount` fallback
                    the breakdown isn't meaningful (the flat just mirrors
                    the contract guarantee), so we hide it to avoid the
                    impression that a different number is being projected. */}
                {sug.source === "sgp_engine" && sug.suggestedFlat != null && sgp && (
                  <div className="pt-3 border-t border-ink-200/40 space-y-3">
                    <div className="eyebrow text-[10px] text-ink-500">
                      How we got there
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div className="rounded-lg bg-white/60 ring-1 ring-ink-200/50 p-2.5">
                        <div className="eyebrow text-[10px] text-ink-500 mb-1">Expected gross</div>
                        <div className="font-mono tabular text-[14px] text-ink-900">{formatMoney(sgp.expectedGross)}</div>
                      </div>
                      <div className="rounded-lg bg-white/60 ring-1 ring-ink-200/50 p-2.5">
                        <div className="eyebrow text-[10px] text-ink-500 mb-1">Capped expenses (SGP)</div>
                        <div className="font-mono tabular text-[14px] text-ink-900">{formatMoney(sgp.expenseEstimate)}</div>
                      </div>
                      <div className="rounded-lg bg-white/60 ring-1 ring-ink-200/50 p-2.5">
                        <div className="eyebrow text-[10px] text-ink-500 mb-1">Breakeven gross</div>
                        <div className="font-mono tabular text-[14px] text-ink-900">{formatMoney(sgp.breakevenGross)}</div>
                      </div>
                    </div>
                    {/* Side-by-side projected venue net — sourced from the
                        persisted `projectedVenueNet{Sgp,Current}` columns so
                        every consumer (this card, Reports, Deal Analysis,
                        Insights) reads from one truth. The flat for SGP is
                        re-anchored to `sug.suggestedFlat` only so the tile
                        agrees with the headline if the two persisted rows
                        haven't been regenerated against the exact same
                        context yet; the current-deal projection has no such
                        race and is read straight from the persisted value. */}
                    {(() => {
                      // Both projections follow the report's canonical
                      // formulas: venue net = net_after_fees − actual
                      // expenses (≈ expenseEstimate) − artist payout. The
                      // delta therefore comes from the artist payout only,
                      // which is the whole point — same gross, same
                      // expenses, just a different way of paying the
                      // artist. We anchor the SGP tile to the live
                      // suggested flat so it stays in sync if the
                      // headline number is re-rounded after persistence.
                      const flat = sug.suggestedFlat as number;
                      const projSgp = sgp.netAfterFees - sgp.expenseEstimate - flat;
                      // Skip rendering on legacy rows that pre-date the
                      // canonical-formula backfill — a silent SGP-equal
                      // fallback would mint a false tie.
                      if (sgp.projectedVenueNetCurrent == null) return null;
                      const projCurrent = sgp.projectedVenueNetCurrent;
                      const delta = projSgp - projCurrent;
                      const TIE_BAND = 50;
                      const sgpWins = delta >= TIE_BAND;
                      const currentWins = delta <= -TIE_BAND;
                      const tile = (label: string, val: number, isSgp: boolean, isWinner: boolean, sub: string) => {
                        const positive = val >= 0;
                        return (
                          <div
                            className={`rounded-lg p-3 ring-1 ${
                              isWinner
                                ? "bg-emerald-50/80 ring-emerald-300/80"
                                : positive
                                  ? "bg-white/70 ring-ink-200/60"
                                  : "bg-rose-50/70 ring-rose-200/70"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <div className="eyebrow text-[10px] text-ink-500">{label}</div>
                              {isWinner && (
                                <span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                                  Winner
                                </span>
                              )}
                            </div>
                            <div
                              className={`font-mono tabular text-[20px] font-semibold leading-none ${
                                isWinner
                                  ? "text-emerald-800"
                                  : positive
                                    ? "text-ink-800"
                                    : "text-rose-800"
                              }`}
                            >
                              {positive ? "" : "−"}{formatMoney(Math.abs(val))}
                            </div>
                            <div className="text-[10.5px] text-ink-500 mt-1.5 leading-tight">{sub}</div>
                          </div>
                        );
                      };
                      const pctLabel = `${Math.round((deal.percentage ?? 0) * 100)}%`;
                      const capPhrase = deal.expenseCap != null
                        ? `$${deal.expenseCap.toLocaleString()} cap`
                        : "no expense cap";
                      const currentSub =
                        deal.dealType === "flat"
                          ? `Deal as written: gross − fees − exp − $${(deal.guaranteeAmount ?? 0).toLocaleString()} guarantee`
                          : deal.dealType === "vs"
                            ? `Deal as written: max(guarantee, ${pctLabel} × net base; ${capPhrase})`
                            : deal.dealType === "percentage_of_net"
                              ? `Deal as written: ${pctLabel} × net base (${capPhrase})`
                              : deal.dealType === "percentage_of_gross"
                                ? `Deal as written: ${pctLabel} × gross (no expense deduct)`
                                : deal.expenseCap != null
                                  ? `Deal as written: gross − min(expenses, $${deal.expenseCap.toLocaleString()} cap); venue absorbs overrun`
                                  : `Deal as written: gross − expenses (no cap); venue absorbs fees`;
                      // Winner rationale is deal-type aware: cap/% story
                      // only applies to vs/%net; door+%gross use their own
                      // explanation; everything else falls back to a
                      // structural description without misattributing
                      // cause.
                      const tightCap = deal.expenseCap != null && deal.expenseCap < sgp.expenseEstimate;
                      const sgpWinCopy =
                        deal.dealType === "door"
                          ? `Switching from a pure door deal to the SGP flat captures an additional ${formatMoney(delta)} of venue net — door deals at this gross historically leave the venue eating fees and any expense overrun; the flat pays the artist a known number and stops there.`
                          : deal.dealType === "percentage_of_gross"
                            ? `Switching to the SGP flat captures an additional ${formatMoney(delta)} of venue net. A ${pctLabel}-of-gross structure pays the artist before any expense deduct; the SGP flat lets the venue recover its actuals first.`
                            : (deal.dealType === "vs" || deal.dealType === "percentage_of_net") && tightCap
                              ? `Switching to the SGP flat captures an additional ${formatMoney(delta)} of venue net. The current deal's tight $${deal.expenseCap!.toLocaleString()} expense cap forces the venue to absorb overrun on top of an inflated ${pctLabel} payout — the SGP flat pays the artist their fair number and stops there.`
                              : `Switching to the SGP flat captures an additional ${formatMoney(delta)} of venue net on the same expected gross.`;
                      return (
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 gap-3">
                            {tile("Projected venue net · current deal", projCurrent, false, currentWins, currentSub)}
                            {tile("Projected venue net · SGP flat", projSgp, true, sgpWins, `Flat artist payment of ${formatMoney(flat)} + same actual expenses`)}
                          </div>
                          <div className={`text-[11.5px] leading-tight ${sgpWins ? "text-emerald-700" : currentWins ? "text-rose-700" : "text-ink-600"}`}>
                            {sgpWins
                              ? sgpWinCopy
                              : currentWins
                                ? `Current deal projects ${formatMoney(-delta)} more venue net than the SGP flat on this gross — keeping the existing structure is the better call on these inputs.`
                                : `Same projected venue net on this gross — the SGP flat is dollar-neutral here but locks the artist payment in writing before the show, eliminating the recoup arithmetic and expense-line disputes that this venue's % deals historically generate.`}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                <div className="text-[13px] text-ink-700 leading-relaxed pt-3 border-t border-ink-200/40">
                  {sug.basis}
                </div>

                {settlement?.totalToArtist != null && sug.suggestedFlat != null && (
                  <div className="rounded-lg bg-white/60 ring-1 ring-ink-200/50 p-3 mt-2">
                    <div className="eyebrow text-[10px] text-ink-500 mb-1">Hindsight (this show actually settled)</div>
                    <div className="text-[12.5px] text-ink-700 leading-relaxed">
                      Suggested flat <span className="font-mono tabular font-medium">{formatMoney(sug.suggestedFlat)}</span> vs actual payout <span className="font-mono tabular font-medium">{formatMoney(settlement.totalToArtist)}</span>
                      {" — "}
                      {(() => {
                        const delta = sug.suggestedFlat - settlement.totalToArtist;
                        const sign = delta >= 0 ? "+" : "−";
                        return (
                          <span className={delta >= 0 ? "text-emerald-700" : "text-rose-700"}>
                            {sign}{formatMoney(Math.abs(delta))} {delta >= 0 ? "venue would have paid more" : "venue would have saved"}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <div className="eyebrow text-[10px] text-ink-500 mb-2">Confidence</div>
                  <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg ring-1 text-[12px] font-medium ${TIER_COLOR[sug.confidenceTier]}`}>
                    <span className="font-mono tabular text-[14px] font-bold">{sug.confidenceTier}</span>
                    <span>{TIER_LABEL[sug.confidenceTier]}</span>
                  </div>
                  <div className="text-[11px] text-ink-500 mt-2">
                    Based on <span className="font-mono tabular">{sug.sampleSize}</span> comparable past deal{sug.sampleSize === 1 ? "" : "s"} in this cell.
                  </div>
                </div>
                <div>
                  <div className="eyebrow text-[10px] text-ink-500 mb-2">Artist familiarity</div>
                  {(() => {
                    const f = familiarityLabel(sug.artistShowsAtVenue);
                    return (
                      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg ring-1 text-[12px] font-medium ${FAMILIARITY_COLOR[f.tone]}`}>
                        <span>{f.label}</span>
                      </div>
                    );
                  })()}
                  <div className="text-[11px] text-ink-500 mt-2">
                    Tracked separately — Confidence reflects cell-level data backing; Familiarity reflects how well we know <em>this</em> artist's settlement behavior at the venue.
                  </div>
                </div>

                {sug.status === "suggested" && (
                  <div className="flex flex-col gap-2 pt-2 border-t border-ink-200/40">
                    {!settlement && sug.shape === "flat" && sug.suggestedFlat != null && (
                      <Button
                        variant="brand"
                        onClick={() => applyToDeal(sug.suggestedFlat as number)}
                        disabled={busy || applied}
                        title="Overwrite the deal's guarantee field with the Smart price and convert this to a clean flat deal"
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        {applied ? "Applied to deal" : `Apply to deal — set $${sug.suggestedFlat.toLocaleString()} flat`}
                      </Button>
                    )}
                    <Button variant={!settlement && sug.shape === "flat" ? "ghost" : "brand"} onClick={accept} disabled={busy}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Accept suggestion
                    </Button>
                    <Button variant="ghost" onClick={decline} disabled={busy}>
                      <X className="h-3.5 w-3.5" />
                      Decline — keep as-is
                    </Button>
                    <button
                      type="button"
                      onClick={recompute}
                      disabled={busy}
                      className="text-[11px] text-ink-500 hover:text-brand-700 underline-offset-2 hover:underline inline-flex items-center gap-1 self-start mt-1 disabled:opacity-50"
                      title="Discard this suggestion and recompute against the latest pricing engine"
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      {busy ? "Recomputing…" : "Recompute with latest pricing"}
                    </button>
                  </div>
                )}
                {sug.status !== "suggested" && sug.decidedAt && (
                  <div className="flex flex-col gap-2 pt-2 border-t border-ink-200/40">
                    <div className="text-[11px] text-ink-500">
                      {sug.status === "accepted" ? "Accepted" : "Declined"} {new Date(sug.decidedAt).toLocaleDateString()}
                    </div>
                    {!settlement && sug.status === "accepted" && sug.shape === "flat" && sug.suggestedFlat != null && (
                      <Button
                        variant="brand"
                        onClick={() => applyToDeal(sug.suggestedFlat as number)}
                        disabled={busy || applied}
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        {applied ? "Applied to deal" : `Apply to deal — set $${sug.suggestedFlat.toLocaleString()} flat`}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {err && <div className="text-[12px] text-rose-600">{err}</div>}
          </>
        )}
      </CardContent>
    </Card>
  );
}



// Lean SGP-only panel for non-flat deals that fall outside the Smart Switch
// window (e.g. vs/%net deals outside the $1–5K bucket, where switching to a
// flat isn't supported but the SGP benchmark is still useful). Renders the
// same "How we got there" math + projected-venue-net tile as the Smart
// Switch card so the booker sees a single coherent set of numbers across
// both surfaces — they're both reading the same `generateGuarantee` engine,
// just at different deal sizes.
function SmartGuaranteedPricePanel({
  showId, deal, settlement, initial,
}: {
  showId: string;
  deal: Deal;
  settlement: Settlement | null;
  initial: GuaranteeSuggestion | null;
}) {
  const [sug, setSug] = useState<GuaranteeSuggestion | null>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bucket = classifyBucketClient(deal);

  async function generate() {
    setBusy(true); setErr(null);
    try { setSug(await api.generateGuarantee(showId)); }
    catch (e) { setErr(e instanceof Error ? e.message : "failed"); }
    finally { setBusy(false); }
  }

  const agentG = deal.guaranteeAmount ?? 0;

  return (
    <Card className="md:col-span-3 ring-1 ring-sky-200/60 bg-gradient-to-br from-sky-50/40 to-canvas">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-sky-700" />
            Smart Guaranteed Price
          </CardTitle>
          <CardDescription>
            {settlement
              ? <>Hindsight check: what flat number our 7-step engine would have recommended for this <code className="font-mono text-[11px] bg-white/70 px-1 py-0.5 rounded ring-1 ring-ink-200/40">{deal.dealType}</code> deal in the <code className="font-mono text-[11px] bg-white/70 px-1 py-0.5 rounded ring-1 ring-ink-200/40">{bucket}</code> bucket.</>
              : <>Reference number our 7-step engine would write for this <code className="font-mono text-[11px] bg-white/70 px-1 py-0.5 rounded ring-1 ring-ink-200/40">{deal.dealType}</code> deal. Use it as a benchmark when reading the agent's ask — to take action, see <strong>Improve the Deal</strong> below.</>
            }
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!sug && (
          <div className="flex items-center justify-between gap-4">
            <div className="text-[13px] text-ink-600 leading-relaxed max-w-xl">
              Run the 7-step engine: expected gross → ticketing fees → capped expense estimate → percentage payout vs guarantee → rounded suggested price.
            </div>
            <Button variant="ghost" onClick={generate} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {busy ? "Computing…" : "Generate suggestion"}
            </Button>
          </div>
        )}

        {sug && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-white/60 ring-1 ring-ink-200/50 p-3">
                  <div className="eyebrow text-[10px] text-ink-500 mb-1">Agent guarantee</div>
                  <div className="text-[28px] font-mono tabular font-semibold text-ink-900 leading-none">
                    {formatMoney(agentG)}
                  </div>
                  <div className="text-[11px] text-ink-500 mt-2">As written in the deal terms</div>
                </div>
                <div className="rounded-lg bg-white/60 ring-1 ring-sky-200/60 p-3">
                  <div className="eyebrow text-[10px] text-ink-500 mb-1">Smart Guaranteed Price</div>
                  <div className="text-[28px] font-mono tabular font-semibold text-sky-800 leading-none">
                    {formatMoney(sug.suggestedPrice)}
                  </div>
                  <div className="text-[11px] text-ink-500 mt-2">7-step calc · rounded to $50</div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
                <div className="rounded-lg bg-white/60 ring-1 ring-ink-200/50 p-2.5">
                  <div className="eyebrow text-[10px] text-ink-500 mb-1">Expected gross</div>
                  <div className="font-mono tabular text-[14px] text-ink-900">{formatMoney(sug.expectedGross)}</div>
                </div>
                <div className="rounded-lg bg-white/60 ring-1 ring-ink-200/50 p-2.5">
                  <div className="eyebrow text-[10px] text-ink-500 mb-1">Capped expenses (SGP)</div>
                  <div className="font-mono tabular text-[14px] text-ink-900">{formatMoney(sug.expenseEstimate)}</div>
                </div>
                <div className="rounded-lg bg-white/60 ring-1 ring-ink-200/50 p-2.5">
                  <div className="eyebrow text-[10px] text-ink-500 mb-1">Breakeven gross</div>
                  <div className="font-mono tabular text-[14px] text-ink-900">{formatMoney(sug.breakevenGross)}</div>
                </div>
              </div>
              {/* Side-by-side projected venue net — same persisted-column
                  pattern as the Smart Switch panel; this lean SGP-only
                  surface gets the same comparison so deals outside the
                  $1–5K switch window still show the structural delta. */}
              {(() => {
                // Identical canonical math to the Smart Switch panel
                // above — venue net = net_after_fees − actual expenses
                // (≈ expenseEstimate) − artist payout. Tie band of $50
                // keeps small rounding deltas from minting a "Winner"
                // badge; below the band we surface the qualitative SGP
                // value (no recoup arithmetic) instead.
                const projSgp = sug.netAfterFees - sug.expenseEstimate - sug.suggestedPrice;
                // Don't fall back to projSgp on legacy rows — that would
                // mint a silent tie and hide the fact that the row hasn't
                // been backfilled with the new canonical formula yet.
                if (sug.projectedVenueNetCurrent == null) return null;
                const projCurrent = sug.projectedVenueNetCurrent;
                const delta = projSgp - projCurrent;
                const TIE_BAND = 50;
                const sgpWins = delta >= TIE_BAND;
                const currentWins = delta <= -TIE_BAND;
                const tile = (label: string, val: number, isWinner: boolean, sub: string) => {
                  const positive = val >= 0;
                  return (
                    <div
                      className={`rounded-lg p-3 ring-1 ${
                        isWinner
                          ? "bg-emerald-50/80 ring-emerald-300/80"
                          : positive
                            ? "bg-white/70 ring-ink-200/60"
                            : "bg-rose-50/70 ring-rose-200/70"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="eyebrow text-[10px] text-ink-500">{label}</div>
                        {isWinner && (
                          <span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                            Winner
                          </span>
                        )}
                      </div>
                      <div
                        className={`font-mono tabular text-[20px] font-semibold leading-none ${
                          isWinner ? "text-emerald-800" : positive ? "text-ink-800" : "text-rose-800"
                        }`}
                      >
                        {positive ? "" : "−"}{formatMoney(Math.abs(val))}
                      </div>
                      <div className="text-[10.5px] text-ink-500 mt-1.5 leading-tight">{sub}</div>
                    </div>
                  );
                };
                const pctLabel = `${Math.round((deal.percentage ?? 0) * 100)}%`;
                const capPhrase = deal.expenseCap != null
                  ? `$${deal.expenseCap.toLocaleString()} cap`
                  : "no expense cap";
                const currentSub =
                  deal.dealType === "flat"
                    ? `Deal as written: gross − fees − exp − $${(deal.guaranteeAmount ?? 0).toLocaleString()} guarantee`
                    : deal.dealType === "vs"
                      ? `Deal as written: max(guarantee, ${pctLabel} × net base; ${capPhrase})`
                      : deal.dealType === "percentage_of_net"
                        ? `Deal as written: ${pctLabel} × net base (${capPhrase})`
                        : deal.dealType === "percentage_of_gross"
                          ? `Deal as written: ${pctLabel} × gross (no expense deduct)`
                          : deal.expenseCap != null
                            ? `Deal as written: gross − min(expenses, $${deal.expenseCap.toLocaleString()} cap); venue absorbs overrun`
                            : `Deal as written: gross − expenses (no cap); venue absorbs fees`;
                const tightCap = deal.expenseCap != null && deal.expenseCap < sug.expenseEstimate;
                const sgpWinCopy =
                  deal.dealType === "door"
                    ? `Switching from a pure door deal to the SGP flat captures an additional ${formatMoney(delta)} of venue net — door deals at this gross historically leave the venue eating fees and any expense overrun; the flat pays the artist a known number and stops there.`
                    : deal.dealType === "percentage_of_gross"
                      ? `Switching to the SGP flat captures an additional ${formatMoney(delta)} of venue net. A ${pctLabel}-of-gross structure pays the artist before any expense deduct; the SGP flat lets the venue recover its actuals first.`
                      : (deal.dealType === "vs" || deal.dealType === "percentage_of_net") && tightCap
                        ? `Switching to the SGP flat captures an additional ${formatMoney(delta)} of venue net. The current deal's tight $${deal.expenseCap!.toLocaleString()} expense cap forces the venue to absorb overrun on top of an inflated ${pctLabel} payout — the SGP flat pays the artist their fair number and stops there.`
                        : `Switching to the SGP flat captures an additional ${formatMoney(delta)} of venue net on the same expected gross.`;
                return (
                  <div className="space-y-2 pt-1">
                    <div className="grid grid-cols-2 gap-3">
                      {tile("Projected venue net · current deal", projCurrent, currentWins, currentSub)}
                      {tile("Projected venue net · SGP flat", projSgp, sgpWins, `Flat artist payment of ${formatMoney(sug.suggestedPrice)} + same actual expenses`)}
                    </div>
                    <div className={`text-[11.5px] leading-tight ${sgpWins ? "text-emerald-700" : currentWins ? "text-rose-700" : "text-ink-600"}`}>
                      {sgpWins
                        ? sgpWinCopy
                        : currentWins
                          ? `Current deal projects ${formatMoney(-delta)} more venue net than the SGP flat — keeping the existing structure is the better call on these inputs.`
                          : `Same projected venue net on this gross — the SGP flat is dollar-neutral here but locks the artist payment in writing before the show, eliminating the recoup arithmetic and expense-line disputes that this venue's % deals historically generate.`}
                    </div>
                  </div>
                );
              })()}

              <div className="text-[13px] text-ink-700 leading-relaxed pt-3 border-t border-ink-200/40">
                {sug.basis}
              </div>

              {settlement?.totalToArtist != null && (
                <div className="rounded-lg bg-white/60 ring-1 ring-ink-200/50 p-3 mt-2">
                  <div className="eyebrow text-[10px] text-ink-500 mb-1">Hindsight (this show actually settled)</div>
                  <div className="text-[12.5px] text-ink-700 leading-relaxed">
                    Suggested <span className="font-mono tabular font-medium">{formatMoney(sug.suggestedPrice)}</span> vs actual payout <span className="font-mono tabular font-medium">{formatMoney(settlement.totalToArtist)}</span>
                    {" — "}
                    {(() => {
                      const d = sug.suggestedPrice - settlement.totalToArtist;
                      const sign = d >= 0 ? "+" : "−";
                      return (
                        <span className={d >= 0 ? "text-emerald-700" : "text-rose-700"}>
                          {sign}{formatMoney(Math.abs(d))} {d >= 0 ? "venue would have paid more" : "venue would have saved"}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <div className="eyebrow text-[10px] text-ink-500 mb-2">Confidence</div>
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg ring-1 text-[12px] font-medium ${TIER_COLOR[sug.confidenceTier]}`}>
                  <span className="font-mono tabular text-[14px] font-bold">{sug.confidenceTier}</span>
                  <span>{TIER_LABEL[sug.confidenceTier]}</span>
                </div>
                <div className="text-[11px] text-ink-500 mt-2">
                  Reflects historical-data backing — winner margin and cell sample size.
                </div>
              </div>
            </div>
          </div>
        )}
        {err && <div className="text-[12px] text-rose-600">{err}</div>}
      </CardContent>
    </Card>
  );
}

function ImproveDealPanel({
  showId, deal, agentName, onApplied,
}: {
  showId: string;
  deal: Deal;
  agentName: string | null;
  onApplied: () => void;
}) {
  const [data, setData] = useState<DealImprovementsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<ImprovementKind | null>(null);
  const [edits, setEdits] = useState<Partial<Record<ImprovementKind, string>>>({});
  const [editing, setEditing] = useState<Set<ImprovementKind>>(new Set());
  const [lastApplied, setLastApplied] = useState<{ kind: ImprovementKind; value: number } | null>(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const res = await api.dealImprovements(showId);
      setData(res);
      const seed: Partial<Record<ImprovementKind, string>> = {};
      for (const i of res.improvements) {
        if (i.proposedNumber != null) seed[i.kind] = String(i.proposedNumber);
      }
      setEdits(seed);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [showId]);

  async function applyOne(kind: ImprovementKind) {
    setBusyKind(kind); setErr(null);
    const raw = edits[kind];
    const parsed = raw != null && raw !== "" ? Number(raw) : undefined;
    const value = typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
    try {
      const out = await api.applyDealImprovements(showId, [{ kind, value }]);
      if (out.appliedKinds.length > 0) {
        const fallback = data?.improvements.find((i) => i.kind === kind)?.proposedNumber ?? 0;
        setLastApplied({ kind, value: value ?? fallback });
      }
      const nextEditing = new Set(editing); nextEditing.delete(kind); setEditing(nextEditing);
      onApplied();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusyKind(null);
    }
  }

  function toggleEdit(kind: ImprovementKind) {
    const next = new Set(editing);
    if (next.has(kind)) next.delete(kind); else next.add(kind);
    setEditing(next);
  }

  const protectsLabel = (p: DealImprovement["protects"]) =>
    p === "booker" ? "Reduces venue risk"
      : p === "artist" ? "Reduces artist risk"
        : "Reduces risk for both sides";

  const kindLabel = (k: ImprovementKind) =>
    k === "add_expense_cap" ? "expense cap" : "hospitality cap";

  const recipient = agentName ? agentName : "the agent";

  return (
    <Card className="md:col-span-3 ring-1 ring-emerald-200/70 bg-gradient-to-br from-emerald-50/50 to-canvas">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-emerald-700" />
            Improve the Deal
          </CardTitle>
          <CardDescription>
            Concrete structural changes — drawn from comparable past shows at this venue — that
            make this <code className="font-mono text-[11px] bg-white/70 px-1 py-0.5 rounded ring-1 ring-ink-200/40">{deal.dealType.replace(/_/g, " ")}</code> deal
            simpler to close and lower-risk for both sides. Apply individually or tweak the
            number first, then resend the updated terms to {recipient}.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && (
          <div className="flex items-center gap-2 text-[12px] text-ink-500">
            <Loader2 className="h-3 w-3 animate-spin" /> Analyzing comparable past shows…
          </div>
        )}

        {!loading && data && (
          <>
            <div className="text-[12px] text-ink-500 leading-relaxed">
              Based on {data.context.comparableSettlements} past comparable settlement{data.context.comparableSettlements === 1 ? "" : "s"} at this venue
              {data.context.comparableSettlements > 0 && (
                <> · <span className="font-mono tabular">{Math.round(data.context.disputeRate * 100)}%</span> ended disputed</>
              )}
              {data.context.medianExpenses != null && (
                <> · median billable expenses <span className="font-mono tabular">{formatMoney(Math.round(data.context.medianExpenses))}</span></>
              )}
              .
            </div>

            {lastApplied && (
              <div className="rounded-lg bg-emerald-50 ring-1 ring-emerald-200/70 px-3 py-2 text-[12.5px] text-emerald-900 flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-700" />
                <span>
                  Updated terms ({kindLabel(lastApplied.kind)}
                  {lastApplied.value > 0 ? <> · <span className="font-mono tabular">{formatMoney(lastApplied.value)}</span></> : null}
                  ) sent to {recipient}.
                </span>
              </div>
            )}

            {data.improvements.length === 0 && (
              <p className="text-[12.5px] text-ink-500 italic">
                This deal already has both an expense cap and a hospitality cap —
                no structural improvements to suggest.
              </p>
            )}

            {data.improvements.length > 0 && (
              <div className="space-y-2.5">
                {data.improvements.map((imp) => {
                  const isEditing = editing.has(imp.kind);
                  const isBusy = busyKind === imp.kind;
                  const editable = imp.proposedNumber != null;
                  return (
                    <div
                      key={imp.kind}
                      className="rounded-lg p-3 ring-1 bg-white/60 ring-ink-200/50"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-[14px] font-medium text-ink-900">{imp.title}</div>
                            {imp.simplifies && (
                              <span className="inline-flex items-center px-1.5 py-px rounded text-[9px] font-mono uppercase tracking-wider bg-sky-50 ring-1 ring-sky-200/70 text-sky-800">
                                simpler close
                              </span>
                            )}
                            <span className={`inline-flex items-center px-1.5 py-px rounded text-[9px] font-mono uppercase tracking-wider ring-1 ${
                              imp.protects === "both" ? "bg-emerald-50 ring-emerald-200/70 text-emerald-800"
                                : imp.protects === "artist" ? "bg-amber-50 ring-amber-200/70 text-amber-800"
                                  : "bg-violet-50 ring-violet-200/70 text-violet-800"
                            }`}>
                              {protectsLabel(imp.protects)}
                            </span>
                          </div>
                          <div className="text-[12px] text-ink-500 mt-1 flex items-center gap-2 flex-wrap">
                            <span>Now: <span className="font-mono tabular text-ink-700">{imp.currentValue}</span></span>
                            <span className="text-ink-300">→</span>
                            {isEditing && editable ? (
                              <span className="inline-flex items-center gap-1">
                                <span className="text-ink-500">$</span>
                                <input
                                  type="number"
                                  min={0}
                                  step={50}
                                  value={edits[imp.kind] ?? ""}
                                  onChange={(e) =>
                                    setEdits((prev) => ({ ...prev, [imp.kind]: e.target.value }))
                                  }
                                  className="w-24 rounded border border-emerald-300 bg-white px-2 py-0.5 text-[12px] font-mono tabular text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                                />
                              </span>
                            ) : (
                              <span>Proposed: <span className="font-mono tabular text-emerald-800 font-medium">{imp.proposedValue}</span></span>
                            )}
                          </div>
                          <div className="text-[12.5px] text-ink-700 leading-relaxed mt-2">
                            {imp.rationale}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 pt-2 border-t border-ink-200/40 flex items-center justify-end gap-2">
                        {editable && (
                          <button
                            type="button"
                            onClick={() => toggleEdit(imp.kind)}
                            disabled={isBusy}
                            className="text-[11.5px] text-ink-500 hover:text-emerald-800 underline-offset-2 hover:underline disabled:opacity-50"
                          >
                            {isEditing ? "Cancel edit" : "Edit number"}
                          </button>
                        )}
                        <Button
                          variant="brand"
                          onClick={() => applyOne(imp.kind)}
                          disabled={isBusy || busyKind != null}
                          className="text-[12px] h-8 px-3"
                        >
                          {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          {isBusy ? "Applying…" : `Apply & resend to ${recipient}`}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
        {err && <div className="text-[12px] text-rose-600">{err}</div>}
      </CardContent>
    </Card>
  );
}

function BonusBadge({ type }: { type: Bonus["type"] }) {
  const labels: Record<Bonus["type"], string> = {
    gross_threshold: "gross",
    sellout: "sellout",
    attendance_threshold: "attend",
    tier_ratchet: "ratchet",
  };
  return (
    <span className="inline-flex shrink-0 items-center px-1.5 py-px rounded text-[9px] font-mono uppercase tracking-wider bg-white ring-1 ring-brand-200/50 text-brand-800">
      {labels[type]}
    </span>
  );
}
