import { Link } from "wouter";
import { AlertTriangle, ArrowUpRight, Clock, FileSpreadsheet, FileWarning } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { PlainBadge } from "@/components/ui/badge";
import { useApiData, LoadingState } from "@/hooks/useApiData";
import { formatShowDate } from "@/lib/format";
import type { AttentionItem, AttentionKind } from "@/lib/types";

const KIND_META: Record<
  AttentionKind,
  { title: string; blurb: string; icon: typeof AlertTriangle; tone: "amber" | "rose" | "sky" }
> = {
  notes_say_closed_but_status_open: {
    title: "Notes say closed, status doesn't",
    blurb:
      "Settlement notes (or sign-off text) mention the show as closed/settled/paid, but the structured status is still open. Most often a settle-button-not-clicked situation.",
    icon: FileWarning,
    tone: "amber",
  },
  show_settled_no_settlement: {
    title: "Show settled, no settlement row",
    blurb:
      "The show itself is marked settled or closed, but no settlement record exists. Numbers can't be trusted on these shows until a settlement is captured.",
    icon: FileSpreadsheet,
    tone: "amber",
  },
  disputed_recoups_but_signed: {
    title: "Disputed recoups on a closed settlement",
    blurb:
      "Settlement is signed/finalized/paid, but at least one recoup line is still marked disputed. Either the dispute is unresolved, or the dispute flag was never cleared.",
    icon: AlertTriangle,
    tone: "rose",
  },
  stale_disputed: {
    title: "Stale disputed settlements",
    blurb:
      "Settlement has been in the disputed state for more than 30 days with no resolution. These tend to drift and never come back.",
    icon: Clock,
    tone: "sky",
  },
  expense_overrun: {
    title: "Expenses ran over cap",
    blurb:
      "Total expenses on a settled show exceeded the contract or venue P75 cap by 25% or more. Worth a look — usually hospitality, production, or marketing overruns.",
    icon: AlertTriangle,
    tone: "amber",
  },
};

const KIND_ORDER: AttentionKind[] = [
  "notes_say_closed_but_status_open",
  "disputed_recoups_but_signed",
  "show_settled_no_settlement",
  "stale_disputed",
  "expense_overrun",
];

export default function NeedsAttentionPage() {
  const state = useApiData(() => api.needsAttention(), []);

  if (state.status === "loading") return <LoadingState label="Scanning shows..." />;
  if (state.status === "error") return <LoadingState label={`Error: ${state.error.message}`} />;

  const items = state.data;
  const grouped: Record<AttentionKind, AttentionItem[]> = {
    notes_say_closed_but_status_open: [],
    show_settled_no_settlement: [],
    disputed_recoups_but_signed: [],
    stale_disputed: [],
    expense_overrun: [],
  };
  for (const it of items) grouped[it.kind].push(it);

  const total = items.length;

  return (
    <div className="px-12 py-10 max-w-7xl">
      <div className="mb-12">
        <div className="eyebrow mb-3">Cleanup queue</div>
        <h1
          className="font-display text-[48px] font-medium text-ink-900 leading-[1.05]"
          style={{ letterSpacing: "-0.02em", fontOpticalSizing: "auto" }}
        >
          Needs Attention
        </h1>
        <p className="text-[14px] text-ink-500 mt-3 max-w-2xl leading-relaxed">
          {total === 0
            ? "Nothing is mismatched right now. The structured data agrees with the freetext notes."
            : `${total} show${total === 1 ? "" : "s"} where the structured status and the freetext story don't agree, or where a settlement is stuck.`}
        </p>
      </div>

      {KIND_ORDER.map((kind) => {
        const list = grouped[kind];
        if (list.length === 0) return null;
        const meta = KIND_META[kind];
        const Icon = meta.icon;
        return (
          <section key={kind} className="mb-12">
            <div className="mb-4 flex items-baseline gap-3">
              <Icon className={`h-4 w-4 ${meta.tone === "rose" ? "text-rose-600" : meta.tone === "sky" ? "text-sky-600" : "text-amber-600"}`} />
              <h2
                className="font-display text-[22px] font-medium text-ink-900"
                style={{ letterSpacing: "-0.02em" }}
              >
                {meta.title}
              </h2>
              <span className="font-mono tabular text-[12px] text-ink-500">
                {list.length}
              </span>
            </div>
            <p className="text-[12.5px] text-ink-500 mb-4 max-w-2xl leading-relaxed">
              {meta.blurb}
            </p>
            <Card>
              <CardContent className="!p-0">
                <ul className="divide-y divide-ink-100/60">
                  {list.map((it) => (
                    <li key={`${it.kind}-${it.showId}`}>
                      <Link
                        href={`/shows/${it.showId}`}
                        className="group flex items-start gap-4 px-5 py-3.5 hover:bg-brand-50/40 transition-colors"
                      >
                        <div className="w-28 shrink-0">
                          <div className="text-[12px] font-medium text-ink-900">
                            {formatShowDate(it.date)}
                          </div>
                          <div className="text-[10px] text-ink-400 mt-0.5">
                            show · {it.status}
                            {it.settlementStatus && (
                              <> · settlement · {it.settlementStatus}</>
                            )}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[14px] font-medium text-ink-900 group-hover:text-brand-800 transition-colors truncate">
                              {it.artistName ?? "—"}
                            </span>
                            <PlainBadge variant={meta.tone}>
                              {KIND_LABEL[it.kind]}
                            </PlainBadge>
                          </div>
                          <div className="text-[12px] text-ink-600 mt-1 leading-relaxed">
                            {it.detail}
                          </div>
                          {it.evidence && (
                            <div className="text-[11px] text-ink-400 mt-1 italic line-clamp-2">
                              "{it.evidence}"
                            </div>
                          )}
                        </div>
                        <ArrowUpRight className="h-4 w-4 shrink-0 text-ink-300 group-hover:text-brand-700 transition-colors mt-1" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        );
      })}
    </div>
  );
}

const KIND_LABEL: Record<AttentionKind, string> = {
  notes_say_closed_but_status_open: "status mismatch",
  show_settled_no_settlement: "missing settlement",
  disputed_recoups_but_signed: "unresolved recoup",
  stale_disputed: "stale dispute",
  expense_overrun: "expense overrun",
};
