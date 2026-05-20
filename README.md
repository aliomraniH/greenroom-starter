# Greenroom

A booker-facing dashboard for **The Crescent**, a small live-music venue.
Greenroom tracks shows, deals, and settlements; flags follow-ups; and surfaces
qualitative friction patterns across past deals using an LLM enrichment
pipeline. On top of the read-only booking view it adds three pricing /
recommendation engines — **Smart Guaranteed Price**, **Smart Switch**, and
**Improve Deal** — and a long-form **Insights** tab that clusters recurring
complaints behind each cell of the deal-type × size grid.

This repo is a fork of
[`samay-cbh/greenroom-starter`](https://github.com/samay-cbh/greenroom-starter)
(a Next.js skeleton). Everything below the starter line — monorepo
restructure, recommendation engines, settlement wizard, Insights pipeline,
test suite, and design documents — was added on top.

> **In a hurry?** [`OVERVIEW.md`](./OVERVIEW.md) is the one-page version —
> the problem we're solving, what Greenroom does about it, and what
> success looks like. Read that first, then come back here for the
> feature-by-feature walkthrough.

## Quickstart

```bash
pnpm install
pnpm --filter @workspace/api-server run dev      # API server (port 8080 in dev)
pnpm --filter @workspace/greenroom run dev       # Web app (Vite, proxied)
pnpm --filter @workspace/mockup-sandbox run dev  # Component preview server

pnpm run typecheck                               # tsc -b across all packages
pnpm run build                                   # typecheck + build all
pnpm --filter @workspace/api-server test         # vitest suite (85 tests)
```

Required env:

- `DATABASE_URL` — Postgres connection string (workspace-level; the
  Greenroom artifact itself uses a local libsql/sqlite file at
  `artifacts/api-server/data/greenroom.db`).

Optional env (LLM fallback if no key is saved in the Settings tab):

- `AI_INTEGRATIONS_ANTHROPIC_API_KEY`, `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`
- `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5, esbuild bundle, libsql/sqlite + Drizzle ORM
- Frontend: Vite + React + wouter + Tailwind v4 + shadcn/ui + Recharts
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Tests: Vitest (fixture-based, no DB needed)
- LLM: provider-agnostic helper wrapping the Anthropic and OpenAI SDKs

## Monorepo layout

```
artifacts/
  api-server/        Express API + libsql DB + LLM helper + test suite
  greenroom/         Vite + React frontend (the booker dashboard)
  mockup-sandbox/    Isolated component-preview server (design workflow)
packages/
  api-spec/          OpenAPI source-of-truth + Orval-generated hooks
  db/                Shared Drizzle config / schemas
exports/             Design PDFs (settlement redesign, supporting doc,
                     insurance pricing brief) + their HTML sources
code-review/         Self-contained dataset snapshot + schema/purpose
                     guide for external code-review agents
```

## The seven tabs

The sidebar exposes seven pages. The short description of each:

1. **Shows** (`/shows`) — every past or current show with joined artist,
   agent, agency, deal, settlement, ticket sales, expenses, comps, recoups.
   Each show has a **Settle** wizard at `/shows/:id/settle`.
2. **Artists** (`/artists`) — roster grid with show count, last-show date,
   top deal type, review-tone topics extracted by the LLM, and an
   attention badge.
3. **Reports** (`/reports`) — top-level KPIs: deal-type counts, in-tool
   coverage rate, settlement-status distribution, dispute rate,
   total-gross / total-to-artists, comp ticket totals.
4. **Deal Analysis** (`/deal-analysis`) — the quantitative breakdown of
   deal complexity, size buckets, profitability, costs, and the
   `dealType × sizeBucket` cross-tab.
5. **Needs Attention** (`/needs-attention`) — worklist of past shows whose
   data smells off (settled-but-no-settlement, notes-vs-status mismatch,
   disputed recoups on closed settlements, stale disputes).
6. **Insights** (`/insights`) — the qualitative companion to Deal
   Analysis. Same grid, but each cell shows the dominant friction kind
   plus a top-5 cluster of recurring complaints. Powered by a
   per-settlement LLM enrichment pass + per-cell clustering.
7. **Settings** (`/settings`) — picks the active LLM provider/model and
   stores the API key persistently (write-only across the API).

`replit.md` in this repo has the long-form spec for each tab — every
formula, every classifier, every cache decision. Treat it as the
operations guide; this README is the entry point.

## New additions on top of the starter

This fork added the following on top of the upstream starter dataset:

### Recommendation engines (`artifacts/api-server/src/lib/`)

- **`smartGuarantee.ts`** — Smart Guaranteed Price (SGP) backtest engine.
  Given a `dealType × sizeBucket` cell, returns a recommended flat
  guarantee plus a confidence tier (A / B / C / D) and provenance
  (`sgp_engine` / `cell_mean` / `door_hybrid_calc` / `door_dead_pool` /
  `suppressed`). Tier `A → B` is demoted when the historical band is
  wider than $1,000 so the UI never overstates certainty.
- **`smartSwitch.ts`** — Smart Switch suggestions for upcoming shows.
  Currently covers `vs` / `pn` at `$1–5K` and `door` at any size, with a
  first-time-artist demotion (artist with no prior shows at the venue
  drops tier `A → B`).
- **`dealImprovements.ts`** — Improve Deal. Caps-only suggestions
  (expense cap, hospitality cap) with audit-derived P75-flat defaults.
  Bucket-scaling deliberately omitted since expenses are flat across
  gross levels at this venue.
- **`switchSavings.ts`** — counterfactual replay. For each past
  vs / pn / door deal in the last N months, computes the dollar money
  saved if Smart Switch had been accepted, time saved (from
  notes/signoff/recoup activity), and a structured breakdown.
- **`guaranteeBacktest.ts`** — 12-month rolling backtest harness that
  feeds the pricing tables in the insurance brief.

### Insights pipeline (`artifacts/api-server/src/lib/insights.ts`)

A three-stage LLM pipeline gated on `llmIsConfigured()`:

1. **Per-settlement enrichment** (`POST /api/insights/enrich`) — picks
   every settlement with notes / signoff / disputed status / disputed
   recoup, calls the active LLM, stores a 1–2 sentence
   `positiveSummary` + `negativeSummary` on the row. Concurrency 8.
   Idempotent unless `force: true`.
2. **Grid build** (`GET /api/insights`) — re-uses the same size-bucket
   classifier from Deal Analysis. Per cell: count, attention count,
   distinct-kind counts, dominant kind via deterministic
   `KIND_PRIORITY`.
3. **Complaint clustering** — for each cell with a dominant kind, calls
   the LLM once to cluster the gathered `negativeSummary` strings into
   AT MOST 5 themes (`{theme, count}`), ordered by count desc.

The full payload is cached in-module with a race-safe pending promise.
Invalidated only on a server restart, a Settings save, or an explicit
`clearInsightsCache()`.

### Settle wizard

`/shows/:id/settle` is a guided flow for `flat` and `percentage_of_gross`
deals. The cells covered by Smart Switch (`vs` / `pn` at $1–5K, `door`
at any size) get a "switch to flat / door-hybrid" suggestion *before*
entering the wizard, so bookers don't have to fall to a spreadsheet for
the supported shapes.

### Test suite (`artifacts/api-server/src/lib/*.test.ts`)

85 fixture-based tests across nine files. No DB or HTTP server is
required — every classifier and engine accepts plain row objects and
returns plain values. Highlights:

- `classifyComplexity.test.ts` — structural read of deal shape, plus
  a regression guard against the May-2026 "every deal looks complex"
  bug (deal-notes freetext no longer fires the classifier).
- `queries.test.ts` / `queries.extra.test.ts` — bucket classifiers and
  the audit-fixed `getReports.settledCount` (past shows with status in
  `{settled, closed}`, not every past show).
- `smartGuarantee.test.ts` / `smartGuarantee.absorbedByVenue.test.ts` —
  pricing math; the absorbed-by-venue branch must not double-count.
- `smartSwitch.test.ts` — provenance ladder, tier demotion, band-width
  guards.
- `switchSavings.test.ts` / `switchSavings.vsStats.test.ts` — replay
  math + the never-fired-vs-percentage histogram.
- `dealImprovements.test.ts` — caps-only behaviour.

Run with `pnpm --filter @workspace/api-server test`.

### Design documents (`exports/` and `docs/`)

The full design argument is split across seven layered PDFs plus two
short markdown notes. Read them in roughly this order:

| File | What it is |
|---|---|
| `exports/greenroom-project-overview.pdf` | **Project overview.** Problem framing, target outcome, success metric. The "why this exists" doc. Same ground covered by [`OVERVIEW.md`](./OVERVIEW.md) at the repo root. |
| `exports/greenroom-settlement-redesign-v2.pdf` | **Settlement Redesign · v2.1** (May 2026). Three-phase argument — simplify the deal types Smart Switch already covers, then layer Improve-Deal caps and insurance on top. Every figure sourced from the live API. |
| `exports/greenroom-settlement-final.pdf` | **Settlement Redesign · Final memo.** Case-study deliverable for the Applied AI PM assignment — condenses v2.1 into a recommendation-grade document. |
| `exports/greenroom-supporting-document.pdf` | **Supporting document.** Engineering + analytical companion: every tab, every API endpoint, every backend lib module, mapped to the claim it supplies in the redesign report. |
| `exports/greenroom-supporting-document-changes.{pdf,md}` | **Supporting document · changelog.** Tracks what changed between revisions of the supporting document, so reviewers can diff the argument without diffing PDFs. |
| `exports/greenroom-insurance-pricing.pdf` | **Insurance Products 1 & 2 · Pricing brief.** Per-show expected-cost derivation from `/api/reports` (Product 1) and a 12-mo SGP backtest (Product 2). Tier ladder, two-sided discount math, bundles, platform revenue model, sensitivity bands. |
| `exports/greenroom-sgp-vs-flat.pdf` | **SGP vs flat · backtest narrative.** Side-by-side: what Smart Guaranteed Price would have paid vs. the flat guarantees actually written, on 12 months of historical data. |
| `exports/greenroom-interview-prep.pdf` | **Interview prep.** Working notes for the case-study presentation — talking points, anticipated questions, and the data behind each answer. |
| `docs/smart-switch-vs-improve-deal.md` | Engine-boundary doc. Why Smart Switch owns full shape conversion while Improve Deal is caps-only, and which cells each covers. |
| `docs/settlement-redesign-supporting-data.md` | Raw figures and per-cell tables backing the settlement-redesign argument. |

HTML sources sit next to each PDF; re-export with WeasyPrint:

```bash
python3 -c "from weasyprint import HTML; HTML('exports/<name>.html').write_pdf('exports/<name>.pdf')"
```

### Code-review bundle (`code-review/`)

Self-contained snapshot of the live dataset (shows, artists, per-deal
extracted insights) plus a schema/purpose guide written for an external
code-review agent (Claude Code, etc.) so the prototype can be reviewed
without running the app. Regenerate with
`pnpm --filter @workspace/api-server exec tsx scripts/exportCodeReviewBundle.ts`.

### Portable seed snapshot (`artifacts/api-server/data/seeds/`)

JSON exports of every row added on top of the upstream starter dataset
(`artists.json`, `shows.json`, `deals.json`, `settlements.json`,
`switch_suggestions.json`, `guarantee_suggestions.json`) plus a
byte-for-byte copy of the live `greenroom.db`. Refresh after any
structural data change with
`pnpm --filter @workspace/api-server exec tsx scripts/exportSeedsSnapshot.ts`.

## Architecture decisions worth knowing

- **No drizzle-kit for the Greenroom DB.** The artifact's data is a
  local libsql file, not the workspace Postgres, so schema changes are
  applied at boot time via small `ensureColumn` / `CREATE TABLE IF NOT
  EXISTS` helpers in `db/index.ts`.
- **DB path resolves to whichever cwd the artifact was launched from.**
  The recent May-2026 deployment fix tries both `cwd/data/greenroom.db`
  and `cwd/artifacts/api-server/data/greenroom.db` and picks whichever
  exists. Works in dev (cwd inside the artifact), prod (cwd at workspace
  root), and any future configuration.
- **All LLM access goes through one helper.** `lib/llm.ts` is the only
  module that imports the Anthropic or OpenAI SDKs. Call sites only see
  `llmGenerateText` / `llmGenerateJson` / `llmIsConfigured`. The
  Settings tab can swap providers globally with a single save.
- **Settings keys are write-only across the API.** GET/POST responses
  contain only `{configured, source, model}` per provider — raw API
  keys are never shipped back to the client.
- **Smart Switch owns flat conversion; Improve Deal is caps-only.** The
  audit (Apr 2026) showed that "convert this %-deal to a flat" is only
  data-safe in the cells Smart Switch already covers. Improve Deal
  therefore emits only structural-cap suggestions.
- **Insights is cached in-module with a race-safe pending promise.** The
  first request computes; concurrent requests await the same promise;
  the cache is invalidated only by a server restart, a Settings save,
  or an explicit `clearInsightsCache()` call.
- **Deal complexity is a structural read, not a text read.** Complexity
  is `vs`/`door`/`pn` or has bonuses → complex; `%-of-gross` or any cap
  → medium; otherwise simple. Earlier versions treated *any* non-empty
  `dealNotesFreetext` as complex, which collapsed every deal into the
  complex bucket because every seed row has a one-line descriptor. The
  `classifyComplexity.test.ts` regression guard prevents that drift
  from returning.

## API surface (under `/api`)

- `GET /shows` — past show list with joined artist/agent/deal/settlement.
- `GET /shows/:id` — full show detail (also used by the Settle wizard).
- `GET /shows/:id/export` — JSON export with per-show LLM summary.
- `GET /artists` — artist roster with deal-type and review-topic enrichment.
- `GET /reports` — KPI bundle for the Reports tab.
- `GET /deal-analysis` — full Deal Analysis bundle (complexity / size /
  profitability / costs / revenue.byDealType / revenue.months /
  revenue.crossTabBySizeAndType).
- `GET /needs-attention` — flat list of attention items.
- `POST /insights/enrich` — run the per-settlement summary pass.
- `GET /insights` — cached cell grid with topKind + clustered themes.
- `GET /insights/switch-savings` — last-N-months replay of vs/pn/door
  deals showing what Smart Switch would have saved.
- `GET /settings/llm` — read-only LLM status (no key material).
- `POST /settings/llm` — upsert provider/key/model; clears insights cache.

## Pointers

- [`OVERVIEW.md`](./OVERVIEW.md) — one-page "what we're trying to
  achieve" doc. Start here if you've never seen the project before.
- `replit.md` — long-form agent README with every tab's formula and
  every architecture decision in detail.
- `exports/` — the design argument and the engineering companion (seven
  PDFs, listed under *Design documents* above).
- `docs/` — short markdown notes (engine boundaries, supporting data).
- `code-review/` — self-contained dataset + schema snapshot for offline
  review by an external agent.
- See the `pnpm-workspace` skill in `.local/skills/` for workspace
  structure, TypeScript setup, and package details.
