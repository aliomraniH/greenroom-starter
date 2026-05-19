import { api } from "@/lib/api";
import { formatMoneyCompact, formatShowDate, formatShowMonth, relativeShowDate } from "@/lib/format";
import { useApiData, LoadingState } from "@/hooks/useApiData";
import { classifyComplexity, classifySizeBucket } from "@/lib/dealClassify";
import { ShowsList, type ShowRow } from "./shows-list";
import { AttentionWidget } from "@/components/attention-widget";
import { AiPrompt } from "@/components/ai-prompt";

export default function ShowsPage() {
  const state = useApiData(() => api.shows(), []);

  if (state.status === "loading") return <LoadingState label="Loading shows..." />;
  if (state.status === "error") return <LoadingState label={`Error: ${state.error.message}`} />;

  const reversed = [...state.data].reverse();
  const upcomingCount = reversed.filter((r) => r.tense === "upcoming").length;
  const settledCount = reversed.filter((r) => r.settlement).length;
  const totalToArtists = reversed.reduce(
    (sum, r) => sum + (r.settlement?.totalToArtist ?? 0), 0);

  const serialized: ShowRow[] = reversed.map((r) => ({
    show: {
      id: r.show.id,
      status: r.show.status as "booked" | "advanced" | "day_of" | "settled" | "closed",
    },
    artist: r.artist ? { name: r.artist.name } : null,
    deal: r.deal ? {
      dealType: r.deal.dealType,
      guaranteeFormatted: r.deal.guaranteeAmount != null
        ? formatMoneyCompact(r.deal.guaranteeAmount) : null,
    } : null,
    settlement: r.settlement ? {
      totalFormatted: r.settlement.totalToArtist != null
        ? formatMoneyCompact(r.settlement.totalToArtist) : null,
      status: r.settlement.status,
    } : null,
    dateFormatted: formatShowDate(r.show.date),
    dateRelative: relativeShowDate(r.show.date),
    month: formatShowMonth(r.show.date),
    isUnsupported: r.isUnsupportedDeal,
    isDisputed: r.isDisputed,
    tense: r.tense,
    switchStatus: r.switchStatus ?? null,
    guaranteeSuggestion: r.guaranteeSuggestion ?? null,
    complexity: r.deal ? classifyComplexity(r.deal) : null,
    sizeBucket: r.deal ? classifySizeBucket(r.deal) : null,
    dealType: r.deal?.dealType ?? null,
    expenseCategories: r.expenseCategories ?? [],
    recoupCategories: r.recoupCategories ?? [],
    disputedRecoupCategories: r.disputedRecoupCategories ?? [],
  }));

  const disputedCount = serialized.filter((r) => r.isDisputed).length;

  return (
    <div className="px-12 py-10 max-w-7xl">
      <div className="mb-14">
        <div className="eyebrow mb-3">The Crescent · Nashville · 650 cap</div>
        <h1
          className="font-display text-[52px] font-medium text-ink-900 leading-[1.02]"
          style={{ letterSpacing: "-0.025em", fontOpticalSizing: "auto" }}
        >
          Shows
        </h1>
        <p className="text-[14px] text-ink-500 mt-3 max-w-lg leading-relaxed">
          Mariana&apos;s home view. {reversed.length} shows over 24 months.{" "}
          {settledCount} settled
          {disputedCount > 0 && (
            <>, <span className="text-rose-700">{disputedCount} disputed</span></>
          )}
          {upcomingCount > 0 && (
            <>, <span className="text-brand-700">{upcomingCount} upcoming</span></>
          )}
          .
        </p>
      </div>

      <div className="grid grid-cols-4 gap-px bg-ink-200/40 rounded-xl overflow-hidden mb-14">
        <StatCard label="Shows" value={String(reversed.length)} />
        <StatCard label="Upcoming" value={String(upcomingCount)} accent />
        <StatCard label="Settled" value={String(settledCount)} />
        <StatCard label="Paid to artists" value={formatMoneyCompact(totalToArtists)} mono />
      </div>

      <AttentionWidget />

      <AiPrompt scope="account" variant="prominent" title="Ask Greenroom about your venue" />

      <ShowsList rows={serialized} />
    </div>
  );
}

function StatCard({
  label, value, mono = false, accent = false,
}: {
  label: string; value: string; mono?: boolean; accent?: boolean;
}) {
  return (
    <div className="bg-white px-6 py-5">
      <div
        className={`text-[32px] font-medium leading-none ${
          accent ? "text-brand-700" : "text-ink-900"
        } ${mono ? "font-mono tabular !font-semibold" : "font-display"}`}
        style={!mono ? { letterSpacing: "-0.02em" } : undefined}
      >
        {value}
      </div>
      <div className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.08em] mt-2">
        {label}
      </div>
    </div>
  );
}
