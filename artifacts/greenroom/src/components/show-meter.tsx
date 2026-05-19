import { Activity } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { useApiData } from "@/hooks/useApiData";
import type { AlertLevel, ShowMeterCell, ShowMeterPayload } from "@/lib/types";

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

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

function confidenceLabel(c: string): string {
  return c === "high" ? "high confidence" : c === "med" ? "medium confidence" : c === "low" ? "low confidence" : "no calibration";
}

export function ShowMeter({ showId }: { showId: string }) {
  const state = useApiData(() => api.showMeter(showId), [showId]);
  if (state.status !== "ready") return null;
  const m = state.data;
  if (m.cells.length === 0 && m.totalLive === 0 && m.currentGross === 0) return null;

  const totalTone = ALERT_TONE[m.totalAlertLevel];

  return (
    <Card className="md:col-span-3 mb-2">
      <CardContent>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-brand-700" />
            <h3 className="text-[14px] font-semibold text-ink-900">Expense meter (live)</h3>
            <span className="text-[10.5px] text-ink-400">
              vs venue-calibrated caps for {m.bucket}
              {m.dealType ? ` · ${m.dealType}` : ""}
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
          <div className="text-[10.5px] text-ink-500 mt-1.5 flex items-center gap-2 flex-wrap">
            <span>
              Cap source: {m.totalCapSource === "deal_expense_cap" ? "deal contract cap" : m.totalCapSource === "venue_computed" ? "venue-computed P75" : m.totalCapSource === "audit_default" ? "industry audit default" : "—"}
            </span>
            <span className="text-ink-400">· {confidenceLabel(m.totalCapConfidence)}</span>
          </div>
        </div>

        <Markers m={m} />

        <HospitalitySummary m={m} />

        <div className="text-[10px] eyebrow text-ink-400 mb-2 mt-4">Per category</div>
        <div className="grid grid-cols-2 gap-2.5">
          {m.cells.map((c) => (
            <MeterRow key={c.category} cell={c} />
          ))}
        </div>

        <div className="text-[10.5px] text-ink-400 mt-3">
          Venue maturity stage {m.maturity.stage} · n={m.maturity.settledN} settled shows
          {m.maturity.stage < 3 && (
            <span className="ml-1 text-amber-700">· still calibrating — treat thresholds as provisional</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Markers({ m }: { m: ShowMeterPayload }) {
  const { markers, currentGross } = m;
  return (
    <div className="grid grid-cols-4 gap-px bg-ink-200/40 rounded-md overflow-hidden mb-4">
      <Stat
        label="Artist mean"
        value={fmtMoney(markers.artistMean)}
        sub={markers.artistMeanN > 0 ? `n=${markers.artistMeanN}` : "no history"}
      />
      <Stat
        label={`Genre P75${markers.genre ? ` · ${markers.genre}` : ""}`}
        value={fmtMoney(markers.genreP75)}
        sub={markers.genre ?? "no genre"}
      />
      <Stat
        label="Breakeven gross"
        value={fmtMoney(markers.breakevenGross)}
        sub={
          markers.breakevenSource === "venue_computed"
            ? "venue-computed"
            : markers.breakevenSource === "audit_default"
            ? "audit default"
            : "—"
        }
      />
      <Stat label="Current gross" value={fmtMoney(currentGross)} sub="ticket sales" />
    </div>
  );
}

function HospitalitySummary({ m }: { m: ShowMeterPayload }) {
  const h = m.hospitalitySummary;
  if (h.live === 0 && h.cap === 0) return null;
  const tone = ALERT_TONE[h.alertLevel];
  return (
    <div className={`rounded-md ring-1 ${tone.ring} ${tone.bg} px-3 py-2 mb-1`}>
      <div className="flex items-baseline justify-between">
        <div className="text-[11.5px] text-ink-800 font-medium">Hospitality</div>
        <div className={`text-[10.5px] font-mono tabular ${tone.text}`}>
          {fmtMoney(h.live)} / {fmtMoney(h.cap)} ({Math.round(h.pctOfCap * 100)}%)
        </div>
      </div>
      <Bar pct={h.pctOfCap} tone={tone.bar} />
      <div className="text-[10px] text-ink-500 mt-1">
        Venue P75 across hospitality: {fmtMoney(h.venueP75)}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-white px-3 py-2">
      <div className="text-[14px] font-mono tabular text-ink-900 leading-tight">{value}</div>
      <div className="text-[9.5px] font-medium text-ink-400 uppercase tracking-[0.06em] mt-1">
        {label}
      </div>
      <div className="text-[9.5px] text-ink-400 mt-0.5">{sub}</div>
    </div>
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
