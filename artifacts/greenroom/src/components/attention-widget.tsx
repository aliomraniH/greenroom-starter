import { useMemo, useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { AlertTriangle, AlertCircle, ChevronRight, ChevronDown, MoreHorizontal, Check, Clock } from "lucide-react";
import { api } from "@/lib/api";
import { useApiData } from "@/hooks/useApiData";
import type { AttentionItem, AttentionKind } from "@/lib/types";
import { formatShowDate } from "@/lib/format";

const STORAGE_KEY = "greenroom.attention.state.v1";
const COLLAPSED_KEY = "greenroom.attention.collapsed.v1";
const TOP_N = 3;
const SNOOZE_DAYS = 7;

type ItemState = {
  // Epoch ms. dismissed = Infinity sentinel stored as -1; snoozedUntil = future epoch ms.
  dismissedAt?: number;
  snoozedUntil?: number;
};
type Stored = Record<string, ItemState>;

function loadStored(): Stored {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    return {};
  }
}

function saveStored(s: Stored) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota */
  }
}

function isHidden(state: ItemState | undefined, now: number): boolean {
  if (!state) return false;
  if (state.dismissedAt) return true;
  if (state.snoozedUntil && state.snoozedUntil > now) return true;
  return false;
}

const KIND_TITLE: Record<AttentionKind, string> = {
  stale_disputed: "Stale dispute — no resolution",
  disputed_recoups_but_signed: "Disputed recoups on a signed settlement",
  show_settled_no_settlement: "Settled show, no settlement row",
  notes_say_closed_but_status_open: "Notes say closed, status still open",
  expense_overrun: "Expenses ran over cap",
};

function severityTone(severity: AttentionItem["severity"]) {
  if (severity === "high") {
    return {
      ring: "ring-rose-200/70",
      bg: "bg-rose-50/40",
      dot: "bg-rose-500",
      icon: AlertCircle,
      iconColor: "text-rose-600",
      label: "Urgent",
    };
  }
  return {
    ring: "ring-amber-200/70",
    bg: "bg-amber-50/30",
    dot: "bg-amber-500",
    icon: AlertTriangle,
    iconColor: "text-amber-600",
    label: "Review",
  };
}

export function AttentionWidget() {
  const state = useApiData(() => api.needsAttention(), []);
  const [stored, setStored] = useState<Stored>(() => loadStored());
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  });
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setOpenMenuId(null);
    }
    if (openMenuId) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [openMenuId]);

  const now = Date.now();
  const items = state.status === "ready" ? state.data : [];

  const visible = useMemo(() => {
    return items.filter((it) => !isHidden(stored[it.id], now)).slice(0, TOP_N);
  }, [items, stored, now]);

  const totalActive = useMemo(
    () => items.filter((it) => !isHidden(stored[it.id], now)).length,
    [items, stored, now],
  );

  function update(id: string, patch: ItemState) {
    setStored((prev) => {
      const next = { ...prev, [id]: { ...prev[id], ...patch } };
      saveStored(next);
      return next;
    });
    setOpenMenuId(null);
  }

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  if (state.status !== "ready") return null;
  if (totalActive === 0) return null;

  return (
    <div className="mb-8 rounded-md ring-1 ring-ink-200/60 bg-white">
      <button
        type="button"
        onClick={toggleCollapsed}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-ink-50/40 transition-colors"
        aria-expanded={!collapsed}
      >
        <div className="flex items-center gap-2">
          {collapsed ? (
            <ChevronRight className="h-4 w-4 text-ink-500" />
          ) : (
            <ChevronDown className="h-4 w-4 text-ink-500" />
          )}
          <div className="eyebrow text-[10.5px] text-ink-700">Needs your attention</div>
          <div className="text-[11px] text-ink-500">
            · {totalActive} item{totalActive === 1 ? "" : "s"}
            {totalActive > TOP_N && <> · showing top {TOP_N}</>}
          </div>
        </div>
        <div className="text-[10.5px] text-ink-400">
          {collapsed ? "Show" : "Hide"}
        </div>
      </button>

      {!collapsed && (
        <div className="px-2 pb-2 pt-0">
          {visible.map((it) => {
            const tone = severityTone(it.severity);
            const Icon = tone.icon;
            const isMenuOpen = openMenuId === it.id;
            return (
              <div
                key={it.id}
                className={`mx-1 mb-1 rounded-md ring-1 ${tone.ring} ${tone.bg} px-3 py-2.5 last:mb-2`}
              >
                <div className="flex items-start gap-3">
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${tone.iconColor}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <div className="text-[12.5px] font-medium text-ink-900">
                        {KIND_TITLE[it.kind]}
                      </div>
                      <div className="text-[10.5px] text-ink-500">
                        {it.artistName ?? "—"} · {formatShowDate(it.date)}
                      </div>
                    </div>
                    <div className="text-[11.5px] text-ink-700 mt-0.5 leading-snug">
                      {it.detail}
                    </div>
                    {it.evidence && (
                      <div className="text-[10.5px] text-ink-500 mt-1 leading-snug italic line-clamp-2">
                        “{it.evidence}”
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Link
                      href={`/shows/${it.showId}`}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-ink-700 hover:bg-white hover:ring-1 hover:ring-ink-200/60 transition"
                    >
                      Open
                      <ChevronRight className="h-3 w-3" />
                    </Link>
                    <div className="relative" ref={isMenuOpen ? menuRef : null}>
                      <button
                        type="button"
                        onClick={() => setOpenMenuId(isMenuOpen ? null : it.id)}
                        className="p-1 rounded hover:bg-white hover:ring-1 hover:ring-ink-200/60 transition"
                        aria-label="Item actions"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5 text-ink-500" />
                      </button>
                      {isMenuOpen && (
                        <div className="absolute right-0 top-full mt-1 z-10 w-44 rounded-md ring-1 ring-ink-200/80 bg-white shadow-md py-1">
                          <button
                            type="button"
                            onClick={() => update(it.id, { dismissedAt: Date.now() })}
                            className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-[12px] text-ink-800 hover:bg-ink-50"
                          >
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                            Mark done
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              update(it.id, {
                                snoozedUntil:
                                  Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000,
                              })
                            }
                            className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-[12px] text-ink-800 hover:bg-ink-50"
                          >
                            <Clock className="h-3.5 w-3.5 text-sky-600" />
                            Snooze {SNOOZE_DAYS} days
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
