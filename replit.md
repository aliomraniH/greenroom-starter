# Greenroom

A booker-facing dashboard for a small live-music venue. Tracks shows, deals,
and settlements; flags follow-ups; and surfaces qualitative friction patterns
across past deals using an LLM enrichment pipeline.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/greenroom run dev` — run the web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks/Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (libsql/sqlite file is used for the Greenroom artifact's own data at `artifacts/api-server/data/greenroom.db`)
- Optional env (LLM fallback if no key is saved in Settings):
  `AI_INTEGRATIONS_ANTHROPIC_API_KEY`, `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`,
  `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5, libsql/sqlite + Drizzle ORM, esbuild (CJS bundle)
- Frontend: Vite + React + wouter + Tailwind v4 + shadcn/ui + Recharts
- Validation: Zod (`zod/v4`), `drizzle-zod`; codegen via Orval
- LLM: provider-agnostic helper in `artifacts/api-server/src/lib/llm.ts`
  wrapping Anthropic + OpenAI SDKs. Active provider/model/key are read from
  the `settings` k/v table at call time, with env vars as fallback.

## Tabs (sidebar)

One-line summaries; full calculation details live in the source modules
listed below (`lib/queries.ts`, `lib/insights.ts`, etc.).

1. **Shows** (`/shows`) — past show list with detail page + Settle wizard.
2. **Artists** (`/artists`) — roster with show counts, top deal type,
   review-tone topics from LLM summaries, and attention badges.
3. **Reports** (`/reports`) — top-line KPIs: deal-type mix, in-app-tool
   usage rate, dispute rate, totals (gross / to-artists / recoups /
   comps).
4. **Deal Analysis** (`/deal-analysis`) — quantitative breakdown by
   complexity, size bucket, profitability, costs, and a deal-type × size
   cross-tab with dispute/losing-money/attention rates per cell.
5. **Needs Attention** (`/needs-attention`) — rule-based worklist of past
   shows whose data smells off (missing settlement, notes-vs-status
   mismatch, disputed-but-signed recoups, stale disputes).
6. **Insights** (`/insights`) — qualitative companion to Deal Analysis,
   plus several action panels:
   - **SGP backtest** — past non-flat deals re-scored with the 7-step SGP.
   - **SGP flat repricing** — past flat $1–5K deals re-quoted as vs/85%.
   - **Smart Switch could have helped** — counterfactual deal-type switches.
   - Cell grid of dominant friction kind + top-5 LLM-clustered complaint
     themes per `dealType × sizeBucket` cell.
7. **Settings** (`/settings`) — choose LLM provider (Anthropic / OpenAI),
   save API keys (never echoed back), pick model. Saving clears the
   insights cache.

## Where things live

- **DB schema** — `artifacts/api-server/src/db/schema.ts`. Idempotent
  runtime migrations in `db/index.ts` (`ensureColumn` /
  `CREATE TABLE IF NOT EXISTS`).
- **Calculations** —
  - `lib/queries.ts` (shows, artists, reports, deal-analysis,
    needs-attention)
  - `lib/insights.ts` (per-settlement enrichment + per-cell clustering)
  - `lib/smartGuarantee.ts` (7-step SGP engine + flat-simulation opt)
  - `lib/guaranteeBacktest.ts`, `lib/sgpFlatRepricing.ts` (per-deal
    backtests against historical data)
  - `lib/switchSavings.ts` (Smart Switch counterfactual)
  - `lib/showExport.ts` (per-show JSON export with LLM summary)
- **LLM helper** — `lib/llm.ts`. Single source of truth for which
  provider/key/model is used. All new LLM call sites must go through it.
- **HTTP routes** — `routes/greenroom.ts`.
- **Frontend pages** — `artifacts/greenroom/src/pages/{shows, show-detail,
  settle, artists, reports, deal-analysis, needs-attention, insights,
  settings}.tsx`.
- **API client + types** — `artifacts/greenroom/src/lib/{api,types}.ts`.
- **Portable seed snapshot** — `artifacts/api-server/data/seeds/`. JSON
  exports + a byte-for-byte copy of the live `greenroom.db`. Refresh with
  `pnpm --filter @workspace/api-server exec tsx scripts/exportSeedsSnapshot.ts`.

## API surface (under `/api`)

Read endpoints: `/shows`, `/shows/:id`, `/shows/:id/export`, `/artists`,
`/reports`, `/deal-analysis`, `/needs-attention`, `/insights`,
`/insights/guarantee-backtest`, `/insights/sgp-flat-repricing`,
`/insights/switch-savings`, `/insights/switch-projected-grid`,
`/settings/llm`.
Write endpoints: `POST /insights/enrich` (run enrichment pass),
`POST /settings/llm` (upsert provider/key/model — clears insights cache).

## Architecture decisions

- **No drizzle-kit for the Greenroom DB.** The artifact's data is a local
  libsql file, not the workspace Postgres, so schema changes are applied at
  boot time via small `ensureColumn` helpers in `db/index.ts`. Keeps the
  artifact self-contained.
- **All LLM access goes through one helper.** `lib/llm.ts` is the only
  module that imports the Anthropic/OpenAI SDKs. Lets the Settings tab
  swap providers globally with one save.
- **Settings keys are write-only across the API.** GET/POST responses
  contain only `{configured, source, model}` per provider — raw key
  material never reaches the client.
- **Insights uses a deterministic priority for ties.** `KIND_PRIORITY`
  fixes topKind ordering so the cluster prompt and cached payload are
  reproducible.
- **Insights is cached in-module with a race-safe pending promise.**
  Invalidated only by server restart, Settings save, or explicit
  `clearInsightsCache()`.
- **Smart Switch owns flat conversion; Improve Deal is caps-only.** The
  Apr 2026 audit showed flat-conversion is only data-safe in cells Smart
  Switch already covers. Improve Deal therefore emits only structural-cap
  suggestions (expense cap, hospitality cap) with audit-derived P75-flat
  defaults.
- **SGP flat-repricing never persists.** The `simulateFlatAsVsPercent` opt
  on `generateGuarantee` is a read-only simulation; the backtest module
  calls `generateGuarantee` only, never `generateAndPersistGuarantee`.

## Design documents

PDFs + HTML sources in `exports/`:

| File | What it is |
|---|---|
| `greenroom-settlement-final.{pdf,html}` | **Settlement Redesign · Final memo** (May 2026). Case-study deliverable for the Applied AI PM assignment. |
| `greenroom-settlement-redesign-v2.{pdf,html}` | **Settlement Redesign · v2.1.** Three-phase argument; every figure sourced from the live API. |
| `greenroom-supporting-document.{pdf,html}` | **Supporting Document.** Engineering companion mapping every tab/endpoint/lib to the claims in the redesign report. |
| `greenroom-insurance-pricing.{pdf,html}` | **Insurance Products 1 & 2 · Pricing brief.** Per-show expected-cost derivation + full 12-mo SGP backtest pricing table. |

Re-export a PDF with `python3 -c "from weasyprint import HTML; HTML('exports/<name>.html').write_pdf('exports/<name>.pdf')"`.

`code-review/` is a self-contained snapshot of the live dataset + schema
guide written for an external code-review agent. Regenerate with
`pnpm --filter @workspace/api-server exec tsx scripts/exportCodeReviewBundle.ts`.

## Gotchas

- **The API server bundles via esbuild.** After backend edits, restart the
  `artifacts/api-server: API Server` workflow — HMR does not apply.
- **Insights coverage depends on enrichment.** Themes only appear for cells
  whose flagged deals already have a `negativeSummary`. If the page looks
  empty, hit `POST /api/insights/enrich` and reload.
- **Saving Settings invalidates the insights cache.** Expect a delay on the
  first `GET /api/insights` after a save while the clusterer re-runs.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
