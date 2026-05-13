/**
 * Regression test for bug: vsPercentageFiredStats scanned all vs deals
 * instead of only the $1–5K guarantee bucket (the cell where the
 * guarantee-amount fallback is active in Smart Switch).
 */
import { beforeEach, describe, expect, it } from "vitest";

process.env.DATABASE_URL = "file::memory:";

const { client, db } = await import("../db");
const schema = await import("../db/schema");
const { getSwitchSavings } = await import("./switchSavings");
const { clearSmartSwitchCache } = await import("./smartSwitch");
const { clearGuaranteeCache } = await import("./smartGuarantee");

const CREATE_TABLES_SQL = `
CREATE TABLE agencies (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
CREATE TABLE agents (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, agency_id TEXT,
  email TEXT NOT NULL, phone TEXT, preferences_notes TEXT
);
CREATE TABLE artists (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, agent_id TEXT,
  manager_email TEXT, genre TEXT, prior_show_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE venues (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, capacity INTEGER NOT NULL,
  city TEXT NOT NULL, state TEXT NOT NULL
);
CREATE TABLE shows (
  id TEXT PRIMARY KEY NOT NULL, venue_id TEXT NOT NULL, artist_id TEXT NOT NULL,
  date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'booked',
  doors_time TEXT, set_time TEXT, opener_artist_id TEXT,
  room_config TEXT NOT NULL DEFAULT 'standing', internal_notes TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE deals (
  id TEXT PRIMARY KEY NOT NULL, show_id TEXT NOT NULL UNIQUE,
  deal_type TEXT NOT NULL, guarantee_amount REAL, percentage REAL,
  percentage_basis TEXT, expense_cap REAL, hospitality_cap REAL,
  bonuses_json TEXT, deal_notes_freetext TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE settlements (
  id TEXT PRIMARY KEY NOT NULL, show_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  drafted_at INTEGER, submitted_at INTEGER, review_started_at INTEGER,
  signed_at INTEGER, disputed_at INTEGER, revised_at INTEGER,
  finalized_at INTEGER, paid_at INTEGER, completed_at INTEGER,
  completed_by_user_id TEXT,
  gross_box_office REAL, net_box_office REAL, total_expenses REAL,
  total_to_artist REAL, calculation_json TEXT, recoups_json TEXT,
  signoff_text TEXT, notes TEXT, positive_summary TEXT, negative_summary TEXT
);
CREATE TABLE expenses (
  id TEXT PRIMARY KEY NOT NULL, show_id TEXT NOT NULL, category TEXT NOT NULL,
  amount REAL NOT NULL, description TEXT,
  approved INTEGER NOT NULL DEFAULT 1, absorbed_by_venue INTEGER NOT NULL DEFAULT 0,
  entered_by_user_id TEXT, entered_at INTEGER NOT NULL
);
CREATE TABLE switch_suggestions (
  id TEXT PRIMARY KEY, show_id TEXT NOT NULL UNIQUE, deal_id TEXT NOT NULL,
  generated_at INTEGER NOT NULL, deal_type_from TEXT NOT NULL, shape TEXT NOT NULL,
  suggested_flat REAL, door_floor REAL, door_split_pct REAL, door_expense_cap REAL,
  confidence_tier TEXT NOT NULL, band_low REAL, band_high REAL, band_width REAL,
  source TEXT, sample_size INTEGER NOT NULL, basis TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'suggested', decided_at INTEGER
);
CREATE TABLE guarantee_suggestions (
  id TEXT PRIMARY KEY, show_id TEXT NOT NULL UNIQUE, deal_id TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  agent_guarantee REAL, suggested_price REAL NOT NULL, delta REAL NOT NULL,
  expected_gross REAL NOT NULL, expected_gross_source TEXT NOT NULL,
  ticketing_fees REAL NOT NULL, net_after_fees REAL NOT NULL,
  expense_estimate REAL NOT NULL, expense_source TEXT NOT NULL, expense_cap REAL,
  net_base REAL NOT NULL, percentage_payout REAL NOT NULL,
  winner TEXT NOT NULL, winner_margin REAL NOT NULL, breakeven_gross REAL NOT NULL,
  artist_show_count INTEGER NOT NULL, agent_show_count INTEGER NOT NULL,
  confidence_tier TEXT NOT NULL, insurance_tier INTEGER NOT NULL,
  basis TEXT NOT NULL, audit_json TEXT NOT NULL
);
`;

const TABLES = [
  "switch_suggestions", "guarantee_suggestions", "expenses", "settlements",
  "deals", "shows", "artists", "agents", "agencies", "venues",
];

const VENUE_ID = "v1";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

let counter = 0;

async function seedArtist(id: string) {
  await db.insert(schema.artists).values({ id, name: id });
}

async function seedVsShow(opts: {
  artistId: string;
  daysBack: number;
  guarantee: number;
  payout: number;
  gross: number;
}) {
  counter++;
  const showId = `s${counter}`;
  await db.insert(schema.shows).values({
    id: showId, venueId: VENUE_ID, artistId: opts.artistId,
    date: isoDate(daysFromNow(-opts.daysBack)),
    status: "settled", roomConfig: "standing", createdAt: new Date(),
  });
  await db.insert(schema.deals).values({
    id: `d${counter}`, showId, dealType: "vs",
    guaranteeAmount: opts.guarantee,
    percentage: 0.80,
    createdAt: new Date(),
  });
  await db.insert(schema.settlements).values({
    id: `set${counter}`, showId, status: "signed",
    grossBoxOffice: opts.gross, totalToArtist: opts.payout,
  });
  return showId;
}

beforeEach(async () => {
  for (const t of TABLES) await client.execute(`DROP TABLE IF EXISTS ${t}`);
  for (const stmt of CREATE_TABLES_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await client.execute(stmt);
  }
  clearSmartSwitchCache();
  clearGuaranteeCache();
  counter = 0;
  await db.insert(schema.venues).values({
    id: VENUE_ID, name: "The Greenroom", capacity: 500, city: "Austin", state: "TX",
  });
});

describe("getSwitchSavings — vsPercentageFiredStats scoped to $1–5K bucket", () => {
  it("excludes vs deals outside the $1–5K bucket from the fire-rate scan", async () => {
    // $5–15K deal (guarantee $8000): pct fires (payout > guarantee)
    // Should NOT appear in vsPercentageFiredStats since it is not in $1–5K.
    await seedArtist("a1");
    await seedVsShow({ artistId: "a1", daysBack: 30, guarantee: 8000, payout: 9000, gross: 15000 });

    // $1–5K deal (guarantee $2000): guarantee wins (payout ≤ guarantee)
    await seedArtist("a2");
    await seedVsShow({ artistId: "a2", daysBack: 25, guarantee: 2000, payout: 1800, gross: 5000 });

    const out = await getSwitchSavings({ months: 6, topN: 10 });
    const stats = out.vsPercentageFiredStats;

    // Only the $1–5K deal should be scanned
    expect(stats.vsDealsScanned).toBe(1);
    // That deal had payout(1800) ≤ guarantee(2000)+1 → percentage never fired
    expect(stats.vsPercentageFired).toBe(0);
    expect(stats.vsPercentageNeverFired).toBe(1);
    expect(stats.vsPercentageNeverFiredRate).toBe(1);
  });

  it("counts a $1–5K vs deal as fired when payout exceeds guarantee by more than $1", async () => {
    await seedArtist("a3");
    // payout $3500 > guarantee $2000 + $1 → fired
    await seedVsShow({ artistId: "a3", daysBack: 20, guarantee: 2000, payout: 3500, gross: 8000 });

    const out = await getSwitchSavings({ months: 6, topN: 10 });
    const stats = out.vsPercentageFiredStats;

    expect(stats.vsDealsScanned).toBe(1);
    expect(stats.vsPercentageFired).toBe(1);
    expect(stats.vsPercentageNeverFired).toBe(0);
    expect(stats.vsPercentageNeverFiredRate).toBe(0);
  });

  it("does not scan vs deals whose guarantee is exactly at a bucket boundary ($1000 or $5000)", async () => {
    await seedArtist("a4");
    await seedArtist("a5");
    // guarantee == 999 ($0–1K bucket — below $1–5K): should be excluded
    await seedVsShow({ artistId: "a4", daysBack: 15, guarantee: 999, payout: 800, gross: 3000 });
    // guarantee == 5000 ($5–15K bucket): should be excluded
    await seedVsShow({ artistId: "a5", daysBack: 15, guarantee: 5000, payout: 4000, gross: 10000 });

    const out = await getSwitchSavings({ months: 6, topN: 10 });
    expect(out.vsPercentageFiredStats.vsDealsScanned).toBe(0);
  });
});
