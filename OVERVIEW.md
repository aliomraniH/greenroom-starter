# Greenroom · What We're Trying to Achieve

> A one-page read. The full feature guide lives in [`README.md`](./README.md);
> the design argument and engineering companion live in [`exports/`](./exports/).

## The problem

The Crescent is a 650-cap independent venue in Nashville. A single booker
runs the whole calendar: artist outreach, deal negotiation, settlement on
show night, dispute follow-up, and post-mortem analysis. The math at
settlement is fast — and when it's wrong, the venue eats the difference.

Across the past 24 months of historical data at this venue:

- **68% of deals** were complex shapes (`vs`, `door`, `% of net`, or carry
  bonuses) — the shapes most likely to produce settlement-night arithmetic
  bugs and post-show disputes.
- **91% of complex deals** were settled on a spreadsheet *outside* the
  booking tool, because the tool didn't cover the math.
- The dispute rate concentrates in specific `dealType × sizeBucket` cells.
  Most are recoverable with structural changes to the deal (caps, simpler
  shape) — not bigger guarantees.

## What Greenroom does

Greenroom is the booker-facing dashboard that turns that historical data
into structural recommendations for the next deal. It does five things:

1. **Surfaces what's actually happening.** Shows, Artists, Reports,
   Deal Analysis, and Needs Attention tabs — every past show with joined
   artist / agent / deal / settlement / expenses / recoups, plus the
   booker's worklist of follow-ups.
2. **Prices the next deal.** *Smart Guaranteed Price* turns the historical
   `dealType × sizeBucket` cell into a recommended flat guarantee with a
   confidence tier (A–D) and an audit-able provenance.
3. **Recommends a simpler deal shape.** *Smart Switch* identifies upcoming
   `vs`/`% of net`/`door` deals that — given this venue's data — would
   settle more cleanly as a flat or door-hybrid, and proposes the
   conversion before the deal is signed.
4. **Adds structural caps.** *Improve Deal* emits caps-only suggestions
   (expense cap, hospitality cap) with audit-derived P75-flat defaults,
   for the cells Smart Switch doesn't cover.
5. **Explains the friction.** The *Insights* tab clusters recurring
   complaint themes per cell using an LLM enrichment pass over settlement
   notes, so the booker can see *why* a cell disputes — not just that it
   does. An AI prompt box on Deal Analysis lets the booker dig further
   into the same data without leaving the page.

All five rest on the same calibration layer: every recommendation cites
its source (`venue P75 n=42`, `audit_default n=4`, …) and lowers its
confidence when the data is thin.

## What this repo demonstrates

This is the applied-AI portion of a PM case study. Beyond the working
prototype, the repo carries the **design argument** for why each piece
exists, in three layered documents:

| Layer | Document |
|---|---|
| **Why** — problem framing, target outcome, success metric | [`exports/greenroom-project-overview.pdf`](./exports/greenroom-project-overview.pdf) |
| **What** — three-phase redesign, every figure sourced from the live API | [`exports/greenroom-settlement-redesign-v2.pdf`](./exports/greenroom-settlement-redesign-v2.pdf) |
| **How** — engineering companion mapping every tab/endpoint/lib to a claim | [`exports/greenroom-supporting-document.pdf`](./exports/greenroom-supporting-document.pdf) |

Pricing for the Phase-3 insurance products lives in
[`exports/greenroom-insurance-pricing.pdf`](./exports/greenroom-insurance-pricing.pdf);
the SGP-vs-flat backtest narrative in
[`exports/greenroom-sgp-vs-flat.pdf`](./exports/greenroom-sgp-vs-flat.pdf);
the engine boundary between Smart Switch and Improve Deal in
[`docs/smart-switch-vs-improve-deal.md`](./docs/smart-switch-vs-improve-deal.md).

## What success looks like

A booker walks into Monday with:

- An attention-sorted worklist instead of an inbox of spreadsheets.
- A defensible counter-offer for every incoming agent guarantee, with
  the historical band that produced it.
- Pre-show structural changes (cap, shape switch) for the deals likely
  to dispute — not reactive firefighting on show night.
- A qualitative read of *why* each problem cell disputes, so the next
  deal in that cell can be written differently.

That's the unit of value Greenroom is built to ship.
