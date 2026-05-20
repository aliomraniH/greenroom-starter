import { useMemo } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, AlertTriangle, ThumbsUp, ThumbsDown, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { formatMoney, formatMoneyCompact, formatShowDate, relativeShowDate } from "@/lib/format";
import { useApiData, LoadingState } from "@/hooks/useApiData";
import { AiPrompt } from "@/components/ai-prompt";
import { ArtistExpenseProfileCard } from "@/components/artist-expense-profile";
import type { ArtistProfile, ArtistProfileShow, AttentionItem } from "@/lib/types";

const DEAL_LABELS: Record<string, string> = {
  flat: "Flat",
  percentage_of_gross: "% gross",
  percentage_of_net: "% net",
  vs: "Vs deal",
  door: "Door",
};

const ATTENTION_LABELS: Record<string, string> = {
  notes_say_closed_but_status_open: "Notes say closed, status open",
  show_settled_no_settlement: "Settled show, no settlement row",
  disputed_recoups_but_signed: "Disputed recoups despite signoff",
  stale_disputed: "Stale dispute",
};

export default function ArtistDetailPage() {
  const [, params] = useRoute("/artists/:id");
  const id = params?.id ?? "";
  const state = useApiData(() => api.artist(id), [id]);

  if (state.status === "loading") return <LoadingState label="Loading artist..." />;
  if (state.status === "error") {
    const isNotFound = state.error.message === "not_found";
    return (
      <div className="px-12 py-10 max-w-7xl">
        <BackLink />
        <div className="mt-8 text-ink-500 text-[14px]">
          {isNotFound ? "Artist not found." : `Error: ${state.error.message}`}
        </div>
      </div>
    );
  }

  return <Profile data={state.data} />;
}

function BackLink() {
  return (
    <Link
      href="/artists"
      className="inline-flex items-center gap-1.5 text-[12px] text-ink-500 hover:text-ink-900 transition-colors"
    >
      <ArrowLeft className="h-3 w-3" />
      All artists
    </Link>
  );
}

function Profile({ data }: { data: ArtistProfile }) {
  const { artist, agent, agency, shows, summaries, attentionItems, stats } = data;
  const upcoming = useMemo(() => shows.filter((s) => s.tense === "upcoming"), [shows]);
  const past = useMemo(() => shows.filter((s) => s.tense !== "upcoming"), [shows]);
  const attentionByShow = useMemo(() => {
    const m = new Map<string, AttentionItem[]>();
    for (const a of attentionItems) {
      const arr = m.get(a.showId) ?? [];
      arr.push(a);
      m.set(a.showId, arr);
    }
    return m;
  }, [attentionItems]);

  return (
    <div className="px-12 py-10 max-w-7xl">
      <BackLink />

      <div className="mt-6 mb-10">
        <div className="eyebrow mb-3">{artist.genre ?? "Artist"}</div>
        <h1
          className="font-display text-[52px] font-medium text-ink-900 leading-[1.02]"
          style={{ letterSpacing: "-0.025em", fontOpticalSizing: "auto" }}
        >
          {artist.name}
        </h1>
        <div className="text-[14px] text-ink-500 mt-3 leading-relaxed">
          {agent ? (
            <>
              Booked through <span className="text-ink-900">{agent.name}</span>
              {agency && <> · {agency.name}</>}
            </>
          ) : (
            <span className="text-ink-400">No agent on file.</span>
          )}
          {stats.firstShowDate && (
            <>
              {" · "}First played {formatShowDate(stats.firstShowDate)}
              {stats.lastShowDate && stats.lastShowDate !== stats.firstShowDate && (
                <> · last played {formatShowDate(stats.lastShowDate)}</>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-px bg-ink-200/40 rounded-xl overflow-hidden mb-12">
        <StatCard label="Total shows" value={String(stats.totalShows)} />
        <StatCard label="Settled" value={String(stats.settledCount)} />
        <StatCard
          label="Disputes"
          value={String(stats.disputedCount)}
          accent={stats.disputedCount > 0 ? "rose" : undefined}
        />
        <StatCard label="Paid to artist" value={formatMoneyCompact(stats.totalPaidToArtist)} mono />
      </div>

      <div className="mb-10">
        <AiPrompt scope="artist" id={artist.id} variant="inline" title={`Ask about ${artist.name}`} />
      </div>

      <ArtistExpenseProfileCard artistId={artist.id} />

      {stats.dealTypes.length > 0 && (
        <section className="mb-12">
          <SectionTitle>Deal mix</SectionTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {stats.dealTypes.map((d) => (
              <span
                key={d.dealType}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white text-ink-700 text-[11px] ring-1 ring-ink-200/70"
              >
                {DEAL_LABELS[d.dealType] ?? d.dealType}
                <span className="font-mono tabular text-ink-400">{d.count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {attentionItems.length > 0 && (
        <section className="mb-12">
          <SectionTitle accent="amber">
            Needs attention{" "}
            <span className="text-ink-300 font-sans text-[14px] font-normal">
              ({attentionItems.length})
            </span>
          </SectionTitle>
          <div className="space-y-2">
            {attentionItems.map((a, i) => (
              <Link
                key={`${a.showId}-${a.kind}-${i}`}
                href={`/shows/${a.showId}`}
                className="group flex items-start gap-3 p-4 rounded-lg bg-white border border-amber-200/70 hover:border-amber-300 transition-colors"
              >
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-[2px]" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-medium text-ink-900">
                    {ATTENTION_LABELS[a.kind] ?? a.kind}
                  </div>
                  <div className="text-[12px] text-ink-600 mt-0.5">{a.detail}</div>
                  {a.evidence && (
                    <div className="text-[11.5px] text-ink-500 mt-1 italic">"{a.evidence}"</div>
                  )}
                  <div className="text-[10.5px] font-mono tabular text-ink-400 mt-1.5">
                    {formatShowDate(a.date)}
                  </div>
                </div>
                <ExternalLink className="h-3 w-3 text-ink-300 group-hover:text-ink-600 shrink-0 mt-1" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {summaries.length > 0 && (
        <section className="mb-12">
          <SectionTitle>
            Settlement summaries{" "}
            <span className="text-ink-300 font-sans text-[14px] font-normal">
              ({summaries.length})
            </span>
          </SectionTitle>
          <div className="space-y-3">
            {summaries.map((s) => (
              <Link
                key={s.showId}
                href={`/shows/${s.showId}`}
                className="group block p-4 rounded-lg bg-white border border-ink-200/60 hover:border-ink-300 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-mono tabular text-ink-500">
                    {formatShowDate(s.date)}
                  </div>
                  <ExternalLink className="h-3 w-3 text-ink-300 group-hover:text-ink-600" />
                </div>
                <div className="space-y-2">
                  {s.positive && (
                    <div className="flex items-start gap-2 text-[12.5px] leading-snug">
                      <ThumbsUp className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-[2px]" />
                      <span className="text-ink-700">{s.positive}</span>
                    </div>
                  )}
                  {s.negative && (
                    <div className="flex items-start gap-2 text-[12.5px] leading-snug">
                      <ThumbsDown className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-[2px]" />
                      <span className="text-ink-700">{s.negative}</span>
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <ShowsSection title="Upcoming" rows={upcoming} attentionByShow={attentionByShow} />
      )}
      {past.length > 0 && (
        <ShowsSection title="Past shows" rows={past} attentionByShow={attentionByShow} />
      )}
    </div>
  );
}

function SectionTitle({
  children,
  accent,
}: {
  children: React.ReactNode;
  accent?: "amber" | "rose";
}) {
  const color =
    accent === "amber" ? "text-amber-800" : accent === "rose" ? "text-rose-800" : "text-ink-900";
  return (
    <h2
      className={`font-display text-[20px] font-medium mb-4 ${color}`}
      style={{ letterSpacing: "-0.02em" }}
    >
      {children}
    </h2>
  );
}

function ShowsSection({
  title,
  rows,
  attentionByShow,
}: {
  title: string;
  rows: ArtistProfileShow[];
  attentionByShow: Map<string, AttentionItem[]>;
}) {
  return (
    <section className="mb-12">
      <SectionTitle>
        {title}{" "}
        <span className="text-ink-300 font-sans text-[14px] font-normal">({rows.length})</span>
      </SectionTitle>
      <div className="rounded-xl border border-ink-200/60 bg-white overflow-hidden">
        {rows.map((r, i) => (
          <ShowItem
            key={r.show.id}
            row={r}
            attention={attentionByShow.get(r.show.id) ?? []}
            isLast={i === rows.length - 1}
          />
        ))}
      </div>
    </section>
  );
}

function ShowItem({
  row,
  attention,
  isLast,
}: {
  row: ArtistProfileShow;
  attention: AttentionItem[];
  isLast: boolean;
}) {
  const { show, deal, settlement, tense, isUnsupportedDeal, isDisputed } = row;
  const settlementBadge = settlement?.status
    ? settlement.status.charAt(0).toUpperCase() + settlement.status.slice(1).replace(/_/g, " ")
    : null;

  return (
    <Link
      href={`/shows/${show.id}`}
      className={`group flex items-center gap-4 px-5 py-4 hover:bg-ink-50/50 transition-colors ${
        isLast ? "" : "border-b border-ink-100/80"
      }`}
    >
      <div className="w-[110px] shrink-0">
        <div className="text-[12.5px] font-medium text-ink-900">{formatShowDate(show.date)}</div>
        <div className="text-[10.5px] text-ink-400 mt-0.5">{relativeShowDate(show.date)}</div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {deal && (
            <span className="px-1.5 py-0.5 rounded bg-ink-50 text-ink-700 text-[10.5px] ring-1 ring-ink-200/70">
              {DEAL_LABELS[deal.dealType] ?? deal.dealType}
            </span>
          )}
          {deal?.guaranteeAmount != null && deal.guaranteeAmount > 0 && (
            <span className="text-[11px] font-mono tabular text-ink-500">
              {formatMoney(deal.guaranteeAmount)}
            </span>
          )}
          {tense === "upcoming" && (
            <span className="px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 text-[10.5px] ring-1 ring-brand-200/70">
              Upcoming
            </span>
          )}
          {isUnsupportedDeal && (
            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[10.5px] ring-1 ring-amber-200/70">
              Unsupported
            </span>
          )}
          {isDisputed && (
            <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-800 text-[10.5px] ring-1 ring-rose-200/70">
              Disputed
            </span>
          )}
          {settlementBadge && (
            <span className="text-[10.5px] text-ink-500">{settlementBadge}</span>
          )}
          {attention.length > 0 && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] ring-1 ring-amber-200"
              title={`${attention.length} attention flag${attention.length === 1 ? "" : "s"}`}
            >
              <AlertTriangle className="h-2.5 w-2.5" />
              <span className="font-mono tabular">{attention.length}</span>
            </span>
          )}
        </div>
      </div>

      <div className="text-right shrink-0">
        {settlement?.totalToArtist != null ? (
          <>
            <div className="text-[13px] font-mono tabular font-medium text-ink-900">
              {formatMoneyCompact(settlement.totalToArtist)}
            </div>
            <div className="text-[10px] uppercase tracking-[0.06em] text-ink-400 mt-0.5">
              to artist
            </div>
          </>
        ) : (
          <div className="text-[11px] text-ink-300">—</div>
        )}
      </div>

      <ExternalLink className="h-3.5 w-3.5 text-ink-300 group-hover:text-ink-600 shrink-0" />
    </Link>
  );
}

function StatCard({
  label,
  value,
  mono = false,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: "rose";
}) {
  const color = accent === "rose" ? "text-rose-700" : "text-ink-900";
  return (
    <div className="bg-white px-6 py-5">
      <div
        className={`text-[32px] font-medium leading-none ${color} ${
          mono ? "font-mono tabular !font-semibold" : "font-display"
        }`}
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
