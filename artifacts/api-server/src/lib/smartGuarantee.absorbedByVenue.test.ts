/**
 * Regression test for bug: buildCtx included venue-absorbed expenses in the
 * SGP expense estimate. Only expenses billed to the artist (absorbedByVenue=false)
 * should count toward the expense waterfall.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.DATABASE_URL = "file::memory:";

const { client, db } = await import("../db");
const schema = await import("../db/schema");
const { generateGuarantee, clearGuaranteeCache } = await import("./smartGuarantee");

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
  "guarantee_suggestions", "expenses", "settlements", "deals",
  "shows", "artists", "agents", "agencies", "venues",
];

const VENUE_ID = "v1";
const ARTIST_ID = "art1";

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

beforeAll(async () => {
  for (const t of TABLES) await client.execute(`DROP TABLE IF EXISTS ${t}`);
  for (const stmt of CREATE_TABLES_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await client.execute(stmt);
  }
});

beforeEach(async () => {
  for (const t of TABLES) await client.execute(`DELETE FROM ${t}`);
  counter = 0;
  clearGuaranteeCache();

  await db.insert(schema.venues).values({
    id: VENUE_ID, name: "Crescent", capacity: 650, city: "Nashville", state: "TN",
  });
  await db.insert(schema.artists).values({
    id: ARTIST_ID, name: "Headliner", agentId: null, priorShowCount: 0,
  });
});

describe("SGP expense waterfall — absorbedByVenue filter", () => {
  it("excludes venue-absorbed expenses from the expense estimate", async () => {
    // Seed a past show with TWO expense rows:
    //   - $800 billed to the artist (absorbedByVenue=false)
    //   - $2000 absorbed by the venue (absorbedByVenue=true)
    // Only the $800 should feed the SGP expense waterfall.
    counter++;
    const pastId = `past-${counter}`;
    const pastDate = daysFromNow(-30);
    await db.insert(schema.shows).values({
      id: pastId, venueId: VENUE_ID, artistId: ARTIST_ID,
      date: isoDate(pastDate), status: "settled", roomConfig: "standing",
      createdAt: pastDate,
    });
    await db.insert(schema.deals).values({
      id: `d-${pastId}`, showId: pastId, dealType: "flat", createdAt: pastDate,
    });
    await db.insert(schema.settlements).values({
      id: `st-${pastId}`, showId: pastId, status: "signed",
      grossBoxOffice: 10000, totalToArtist: 5000,
    });
    // Billed expense
    await db.insert(schema.expenses).values({
      id: `e1-${pastId}`, showId: pastId, category: "production",
      amount: 800, absorbedByVenue: false, enteredAt: pastDate,
    });
    // Venue-absorbed expense — must NOT inflate the estimate
    await db.insert(schema.expenses).values({
      id: `e2-${pastId}`, showId: pastId, category: "sound",
      amount: 2000, absorbedByVenue: true, enteredAt: pastDate,
    });

    // Upcoming show for the same artist at the same venue
    counter++;
    const upId = `up-${counter}`;
    const upDate = daysFromNow(14);
    await db.insert(schema.shows).values({
      id: upId, venueId: VENUE_ID, artistId: ARTIST_ID,
      date: isoDate(upDate), status: "booked", roomConfig: "standing",
      createdAt: upDate,
    });
    await db.insert(schema.deals).values({
      id: `d-${upId}`, showId: upId, dealType: "vs",
      guaranteeAmount: 1000, percentage: 0.85, createdAt: upDate,
    });

    const r = await generateGuarantee(upId);
    expect(r.suggestion).not.toBeNull();
    // The expense source should be artist_history_1 (1 prior show at this venue)
    expect(r.suggestion!.expenseSource).toBe("artist_history_1");
    // The expense estimate must be $800 (billed only), NOT $2800 (all expenses)
    expect(r.suggestion!.expenseEstimate).toBe(800);
  });

  it("includes billed expenses normally when none are venue-absorbed", async () => {
    counter++;
    const pastId = `past-${counter}`;
    const pastDate = daysFromNow(-30);
    await db.insert(schema.shows).values({
      id: pastId, venueId: VENUE_ID, artistId: ARTIST_ID,
      date: isoDate(pastDate), status: "settled", roomConfig: "standing",
      createdAt: pastDate,
    });
    await db.insert(schema.deals).values({
      id: `d-${pastId}`, showId: pastId, dealType: "flat", createdAt: pastDate,
    });
    await db.insert(schema.settlements).values({
      id: `st-${pastId}`, showId: pastId, status: "signed",
      grossBoxOffice: 10000, totalToArtist: 5000,
    });
    await db.insert(schema.expenses).values({
      id: `e1-${pastId}`, showId: pastId, category: "production",
      amount: 1200, absorbedByVenue: false, enteredAt: pastDate,
    });

    counter++;
    const upId = `up-${counter}`;
    const upDate = daysFromNow(14);
    await db.insert(schema.shows).values({
      id: upId, venueId: VENUE_ID, artistId: ARTIST_ID,
      date: isoDate(upDate), status: "booked", roomConfig: "standing",
      createdAt: upDate,
    });
    await db.insert(schema.deals).values({
      id: `d-${upId}`, showId: upId, dealType: "vs",
      guaranteeAmount: 1000, percentage: 0.85, createdAt: upDate,
    });

    const r = await generateGuarantee(upId);
    expect(r.suggestion!.expenseEstimate).toBe(1200);
  });
});
