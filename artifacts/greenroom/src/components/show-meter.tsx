import { Activity } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { useApiData } from "@/hooks/useApiData";
import type { AlertLevel, ShowMeterCell } from "@/lib/types";

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

const ALERT_TONE: Record<AlertLevel, { bar: string; text: string; bg: string; ring: string }> = {
  ok: { bar: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50/40", ring: "ring-emerald-200/60" },
  watch: { bar: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50/50", ring: "ring-amber-200/60" },
  alert: { bar: "bg-rose-500", text: "text-rose-700", bg: "bg-rose-50/50", ring: "ring-rose-200/60" },
};

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

export function ShowMeter({ showId }: { showId: string }) {
  const state = useApiData(() => api.showMeter(showId), [showId]);
  if (state.status !== "ready") return null;
  const m = state.data;
  if (m.cells.length === 0 && m.totalLive === 0) return null;

  const totalTone = ALERT_TONE[m.totalAlertLevel];

  return (
    <Card className="md:col-span-3 mb-2">
      <CardContent>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-brand-700" />
            <h3 className="text-[14px] font-semibold text-ink-900">Expense meter (live)</h3>
            <span className="text-[10.5px] text-ink-400">
              vs venue-calibrated caps for {m.bucket}
            </span>
          </div>
          <div className={`text-[11px] font-mono tabular ${totalTone.text}`}>
            {fmtMoney(m.totalLive)} / {fmtMoney(m.totalCap)} ({Math.round(m.totalPctOfCap * 100)}%)
          </div>
        </div>

        <div className={`mb-4 rounded-md ring-1 ${totalTone.ring} ${totalTone.bg} p-3`}>
          <div className="flex items-baseline justify-between mb-1.5">
            <div className="text-[11px] eyebrow text-ink-500">Total live expenses</div>
            <div className={`text-[10px] font-medium uppercase tracking-[0.06em] ${totalTone.text}`}>
              {m.totalAlertLevel}
            </div>
          </div>
          <Bar pct={m.totalPctOfCap} tone={totalTone.bar} />
          <div className="text-[10.5px] text-ink-500 mt-1.5">
            Cap source: {m.totalCapSource === "venue_computed" ? "venue-computed P75" : m.totalCapSource === "audit_default" ? "industry audit default" : "—"}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {m.cells.map((c) => (
            <MeterRow key={c.category} cell={c} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function MeterRow({ cell }: { cell: ShowMeterCell }) {
  const tone = ALERT_TONE[cell.alertLevel];
  const sourceLabel =
    cell.capSource === "deal_hospitality_cap"
      ? "deal cap"
      : cell.capSource === "venue_computed"
      ? `venue P75 (n=${cell.n})`
      : "audit default";
  return (
    <div className={`rounded-md ring-1 ${tone.ring} ${tone.bg} px-3 py-2`}>
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-[11.5px] text-ink-800 font-medium">
          {CATEGORY_LABELS[cell.category] ?? cell.category}
        </div>
        <div className={`text-[10.5px] font-mono tabular ${tone.text}`}>
          {fmtMoney(cell.liveAmount)} / {fmtMoney(cell.cap)}
        </div>
      </div>
      <Bar pct={cell.pctOfCap} tone={tone.bar} />
      <div className="text-[9.5px] text-ink-400 mt-1">{sourceLabel}</div>
    </div>
  );
}

function Bar({ pct, tone }: { pct: number; tone: string }) {
  const width = Math.min(100, Math.max(2, pct * 100));
  return (
    <div className="h-1.5 rounded-full bg-ink-100/60 overflow-hidden">
      <div className={`${tone} h-full transition-all`} style={{ width: `${width}%` }} />
    </div>
  );
}
