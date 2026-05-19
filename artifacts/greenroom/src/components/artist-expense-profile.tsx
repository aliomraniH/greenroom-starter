import { Activity, TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { useApiData } from "@/hooks/useApiData";
import { formatShowDate } from "@/lib/format";
import type { ArtistExpenseProfile, Confidence, ExpenseCategory } from "@/lib/types";

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

// Stable palette across charts so each category reads as the same color
// in the stacked bars and the peer-comparison bars.
const CATEGORY_COLORS: Record<string, string> = {
  hospitality: "#f97316",
  production: "#6366f1",
  sound: "#0ea5e9",
  lights: "#eab308",
  marketing: "#10b981",
  backline: "#a855f7",
  security: "#ef4444",
  other: "#94a3b8",
};

const CATEGORY_ORDER: ExpenseCategory[] = [
  "hospitality",
  "production",
  "sound",
  "lights",
  "marketing",
  "backline",
  "security",
  "other",
];

function fmtMoney(n: number | null): string {
  if (n == null) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtMoneyCompact(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
}

function ConfidenceChip({ confidence }: { confidence: Confidence }) {
  const tone =
    confidence === "high"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200/60"
      : confidence === "med"
      ? "bg-sky-50 text-sky-700 ring-sky-200/60"
      : confidence === "low"
      ? "bg-amber-50 text-amber-700 ring-amber-200/60"
      : "bg-ink-50 text-ink-500 ring-ink-200/60";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm ring-1 px-1.5 py-[1px] text-[10px] font-medium uppercase tracking-[0.05em] ${tone}`}
    >
      {confidence === "none" ? "low n" : `${confidence} conf.`}
    </span>
  );
}

export function ArtistExpenseProfileCard({ artistId }: { artistId: string }) {
  const state = useApiData(() => api.artistExpenseProfile(artistId), [artistId]);
  if (state.status !== "ready") return null;
  const p = state.data;
  if (p.settledShows === 0) return null;

  return (
    <Card className="mb-10">
      <CardContent>
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-4 w-4 text-brand-700" />
          <h3 className="text-[14px] font-semibold text-ink-900">
            Expense profile
          </h3>
          <span className="text-[10.5px] text-ink-400">
            {p.source === "venue_computed"
              ? `venue-computed · n=${p.settledShows}`
              : "low sample · interpret with caution"}
          </span>
        </div>

        <StatsRow profile={p} />
        <PeerLine profile={p} />

        {p.lastShows.length > 0 && (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <GrowthChart shows={p.lastShows} />
            <CategoryStackChart shows={p.lastShows} />
          </div>
        )}

        {p.categoryComparison.rows.length > 0 && (
          <PeerComparisonChart
            rows={p.categoryComparison.rows}
            peerLabel={p.categoryComparison.peerLabel}
            peerN={p.categoryComparison.peerN}
          />
        )}
      </CardContent>
    </Card>
  );
}

function StatsRow({ profile }: { profile: ArtistExpenseProfile }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-ink-200/40 rounded-md overflow-hidden">
      <Stat label="Weighted mean" value={fmtMoney(profile.totalExpensesWeightedMean)} hint="recency-decayed" />
      <Stat label="P75" value={fmtMoney(profile.totalExpensesP75)} />
      <Stat label="Max" value={fmtMoney(profile.totalExpensesMax)} />
      <Stat label="Stddev" value={fmtMoney(profile.totalExpensesStddev)} />
      <Stat
        label="Top category"
        value={
          profile.topCategory
            ? `${CATEGORY_LABELS[profile.topCategory.category] ?? profile.topCategory.category} · ${fmtMoney(profile.topCategory.mean)}`
            : "—"
        }
        mono={false}
      />
    </div>
  );
}

function PeerLine({ profile }: { profile: ArtistExpenseProfile }) {
  const p75Delta = profile.vsGenre.p75Delta;
  if (!profile.vsGenre.genre || profile.vsGenre.genreP75Expenses == null) {
    return null;
  }
  if (!profile.vsGenre.p75Confidence) {
    return (
      <div className="text-[11px] text-ink-400 mt-3 italic">
        P75 vs genre comparison requires ≥3 settled shows for this artist
        (currently {profile.settledShows}).
      </div>
    );
  }
  const p75Tone =
    p75Delta == null
      ? "text-ink-500"
      : Math.abs(p75Delta) < 0.05
      ? "text-ink-600"
      : p75Delta > 0
      ? "text-rose-700"
      : "text-emerald-700";
  return (
    <div className="text-[12px] text-ink-600 mt-3 leading-relaxed flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>
        P75 vs <span className="capitalize">{profile.vsGenre.genre}</span> baseline of{" "}
        <span className="font-mono tabular text-ink-900">
          {fmtMoney(profile.vsGenre.genreP75Expenses)}
        </span>
        :
      </span>
      <span className={`font-mono tabular ${p75Tone}`}>
        {p75Delta == null
          ? "—"
          : `${p75Delta > 0 ? "+" : ""}${Math.round(p75Delta * 100)}%`}
      </span>
      <ConfidenceChip confidence={profile.vsGenre.p75Confidence} />
      {p75Delta != null && Math.abs(p75Delta) >= 0.1 && (
        <span className="text-ink-500">
          {p75Delta > 0
            ? "· running above peers — review caps before signing the next deal."
            : "· running below peers — caps don't need tightening."}
        </span>
      )}
    </div>
  );
}

type LastShow = ArtistExpenseProfile["lastShows"][number];

function GrowthChart({ shows }: { shows: LastShow[] }) {
  const data = shows.map((s) => ({
    date: s.date,
    label: formatShowDate(s.date),
    total: s.total,
  }));
  const first = shows[0]?.total ?? 0;
  const last = shows[shows.length - 1]?.total ?? 0;
  const delta = first > 0 ? (last - first) / first : null;
  const trendTone =
    delta == null
      ? "text-ink-500"
      : Math.abs(delta) < 0.05
      ? "text-ink-600"
      : delta > 0
      ? "text-rose-700"
      : "text-emerald-700";
  const TrendIcon = delta == null || Math.abs(delta) < 0.05 ? Minus : delta > 0 ? TrendingUp : TrendingDown;

  return (
    <div className="rounded-md ring-1 ring-ink-200/60 bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] font-semibold text-ink-900">
          Spend trend · last {shows.length} {shows.length === 1 ? "show" : "shows"}
        </div>
        {delta != null && (
          <span className={`inline-flex items-center gap-1 text-[11px] font-mono tabular ${trendTone}`}>
            <TrendIcon className="h-3 w-3" />
            {`${delta > 0 ? "+" : ""}${Math.round(delta * 100)}%`}
          </span>
        )}
      </div>
      <div className="h-[160px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#64748b" }}
              tickLine={false}
              axisLine={{ stroke: "#e5e7eb" }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#64748b" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => fmtMoneyCompact(Number(v))}
              width={48}
            />
            <Tooltip
              formatter={(v: number) => [fmtMoney(v), "Total"]}
              contentStyle={{
                fontSize: 11,
                borderRadius: 6,
                border: "1px solid #e5e7eb",
                padding: "6px 8px",
              }}
            />
            <Line
              type="monotone"
              dataKey="total"
              stroke="#7c3aed"
              strokeWidth={2}
              dot={{ r: 3, fill: "#7c3aed" }}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function CategoryStackChart({ shows }: { shows: LastShow[] }) {
  // Build one row per show with each category as a key. Recharts stacks
  // by stackId, so any category that has a non-zero value across the
  // window will get its own segment.
  const data = shows.map((s) => {
    const row: Record<string, number | string> = {
      date: s.date,
      label: formatShowDate(s.date),
    };
    for (const cat of CATEGORY_ORDER) {
      row[cat] = s.byCategory[cat] ?? 0;
    }
    return row;
  });
  const activeCats = CATEGORY_ORDER.filter((cat) =>
    shows.some((s) => (s.byCategory[cat] ?? 0) > 0),
  );

  return (
    <div className="rounded-md ring-1 ring-ink-200/60 bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] font-semibold text-ink-900">
          Expenses by category · last {shows.length} {shows.length === 1 ? "show" : "shows"}
        </div>
      </div>
      <div className="h-[160px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#64748b" }}
              tickLine={false}
              axisLine={{ stroke: "#e5e7eb" }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#64748b" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => fmtMoneyCompact(Number(v))}
              width={48}
            />
            <Tooltip
              formatter={(v: number, name: string) => [fmtMoney(v), CATEGORY_LABELS[name] ?? name]}
              contentStyle={{
                fontSize: 11,
                borderRadius: 6,
                border: "1px solid #e5e7eb",
                padding: "6px 8px",
              }}
            />
            {activeCats.map((cat) => (
              <Bar
                key={cat}
                dataKey={cat}
                stackId="exp"
                fill={CATEGORY_COLORS[cat]}
                radius={[0, 0, 0, 0]}
                name={cat}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {activeCats.map((cat) => (
          <span key={cat} className="inline-flex items-center gap-1 text-[10px] text-ink-600">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: CATEGORY_COLORS[cat] }}
            />
            {CATEGORY_LABELS[cat]}
          </span>
        ))}
      </div>
    </div>
  );
}

function PeerComparisonChart({
  rows,
  peerLabel,
  peerN,
}: {
  rows: ArtistExpenseProfile["categoryComparison"]["rows"];
  peerLabel: string;
  peerN: number;
}) {
  // Filter to categories where at least one side has a value. Keep
  // peerMean as `null` (not 0) so the chart can omit the baseline bar
  // and the delta-coloring can be suppressed when there's no peer data.
  const data = rows
    .filter((r) => r.artistMean > 0 || (r.peerMean ?? 0) > 0)
    .map((r) => ({
      category: r.category,
      label: CATEGORY_LABELS[r.category] ?? r.category,
      artistMean: r.artistMean,
      peerMean: r.peerMean,
      delta:
        r.peerMean != null && r.peerMean > 0
          ? (r.artistMean - r.peerMean) / r.peerMean
          : null,
    }));
  if (data.length === 0) return null;

  return (
    <div className="mt-6 rounded-md ring-1 ring-ink-200/60 bg-white p-3">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-x-2 gap-y-1">
        <div className="text-[12px] font-semibold text-ink-900">
          Per-category spend vs {peerLabel.toLowerCase()}
        </div>
        <span className="text-[10.5px] text-ink-400">
          {peerLabel === "Venue average"
            ? "Venue average — fewer than 3 same-genre peers"
            : `${peerLabel}${peerN > 0 ? ` · n=${peerN}` : ""}`}
        </span>
      </div>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#64748b" }}
              tickLine={false}
              axisLine={{ stroke: "#e5e7eb" }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#64748b" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => fmtMoneyCompact(Number(v))}
              width={48}
            />
            <Tooltip
              formatter={(v, name) => [
                v == null ? "—" : fmtMoney(Number(v)),
                name === "artistMean" ? "This artist" : peerLabel,
              ]}
              labelFormatter={(label) => String(label)}
              contentStyle={{
                fontSize: 11,
                borderRadius: 6,
                border: "1px solid #e5e7eb",
                padding: "6px 8px",
              }}
            />
            <Legend
              verticalAlign="top"
              align="right"
              height={20}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, paddingBottom: 4 }}
              formatter={(value) => (value === "artistMean" ? "This artist" : peerLabel)}
            />
            <Bar dataKey="artistMean" fill="#7c3aed" radius={[3, 3, 0, 0]}>
              {data.map((entry, i) => (
                <Cell
                  key={i}
                  fill={
                    entry.delta != null && entry.delta > 0.15
                      ? "#dc2626"
                      : entry.delta != null && entry.delta < -0.15
                      ? "#059669"
                      : "#7c3aed"
                  }
                />
              ))}
            </Bar>
            <Bar dataKey="peerMean" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 text-[10.5px] text-ink-400">
        Purple bars turn red when this artist runs &gt;15% above peers, green when &gt;15% below.
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  mono = true,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-white px-4 py-3">
      <div
        className={`text-[18px] font-medium text-ink-900 leading-tight ${
          mono ? "font-mono tabular" : "font-display"
        }`}
      >
        {value}
      </div>
      <div className="text-[10px] font-medium text-ink-400 uppercase tracking-[0.06em] mt-1.5">
        {label}
        {hint && <span className="ml-1 normal-case text-ink-300">· {hint}</span>}
      </div>
    </div>
  );
}
