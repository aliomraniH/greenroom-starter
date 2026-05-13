/**
 * Additional regression tests for bugs found in the code review:
 *   1. settledCount in getReports counted all past shows, not settled ones.
 *   2. tense="today" was missing — shows on today's date were classified "past".
 *
 * These tests use an in-memory SQLite DB (same pattern as the existing suites).
 */
import { describe, expect, it, beforeEach } from "vitest";

process.env.DATABASE_URL = "file::memory:";

const { client, db } = await import("../db");
const schema = await import("../db/schema");
const { getReports, getAllShows } = await import("./queries");

const CREATE = `
CREATE TABLE venues (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, capacity INTEGER NOT NULL,
  city TEXT NOT NULL, state TEXT NOT NULL
);
CREATE TABLE agencies (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
CREATE TABLE agents (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, agency_id TEXT,
  email TEXT NOT NULL, phone TEXT, preferences_notes TEXT
);
CREATE TABLE artists (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, agent_id TEXT,
  manager_email TEXT, genre TEXT, prior_show_count INTEGER NOT NULL DEFAULT 0
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
CREATE TABLE ticket_sales (
  id TEXT PRIMARY KEY NOT NULL, show_id TEXT NOT NULL, qty INTEGER NOT NULL,
  gross REAL NOT NULL, fees REAL NOT NULL, captured_at INTEGER NOT NULL
);
CREATE TABLE comps (
  id TEXT PRIMARY KEY NOT NULL, show_id TEXT NOT NULL, category TEXT NOT NULL,
  count INTEGER NOT NULL, face_value REAL NOT NULL,
  counts_toward_gross INTEGER NOT NULL DEFAULT 0, notes TEXT
);
CREATE TABLE switch_suggestions (
  id TEXT PRIMARY KEY, show_id TEXT NOT NULL UNIQUE, deal_id TEXT NOT NULL,
  suggested_at INTEGER NOT NULL, deal_type_from TEXT NOT NULL, shape TEXT NOT NULL,
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
  "guarantee_suggestions", "switch_suggestions", "comps", "ticket_sales",
  "expenses", "settlements", "deals", "shows", "artists", "agents",
  "agencies", "venues",
];

function todayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function daysAhead(n: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

let counter = 0;

beforeEach(async () => {
  for (const t of TABLES) {
    try { await client.execute(`DROP TABLE IF EXISTS ${t}`); } catch { /* */ }
  }
  for (const stmt of CREATE.split(";").map((s) => s.trim()).filter(Boolean)) {
    await client.execute(stmt);
  }
  counter = 0;
  await db.insert(schema.venues).values({
    id: "v1", name: "Greenroom", capacity: 500, city: "Austin", state: "TX",
  });
  await db.insert(schema.artists).values({
    id: "a1", name: "Test Artist", priorShowCount: 0,
  });
});

async function seedShow(opts: {
  date: string;
  status: typeof schema.shows.$inferInsert["status"];
  dealType?: "flat" | "vs";
  settlementStatus?: string;
}) {
  counter++;
  const sid = `s${counter}`;
  await db.insert(schema.shows).values({
    id: sid, venueId: "v1", artistId: "a1",
    date: opts.date, status: opts.status,
    roomConfig: "standing", createdAt: new Date(),
  });
  await db.insert(schema.deals).values({
    id: `d${counter}`, showId: sid,
    dealType: opts.dealType ?? "flat", guaranteeAmount: 1000,
    createdAt: new Date(),
  });
  if (opts.settlementStatus) {
    await db.insert(schema.settlements).values({
      id: `set${counter}`, showId: sid,
      status: opts.settlementStatus as typeof schema.settlements.$inferInsert["status"],
      grossBoxOffice: 5000, totalToArtist: 1000,
    });
  }
  return sid;
}

// ─────────────────────────────────────────────────────────────
// Bug #1: settledCount in getReports
// ─────────────────────────────────────────────────────────────
describe("getReports — settledCount", () => {
  it("counts only past shows with status settled or closed, not all past shows", async () => {
    // 2 settled past shows
    await seedShow({ date: daysAgo(10), status: "settled", settlementStatus: "paid" });
    await seedShow({ date: daysAgo(20), status: "settled", settlementStatus: "paid" });
    // 1 past show still in booked status (not settled)
    await seedShow({ date: daysAgo(5), status: "booked" });
    // 1 future upcoming show (should not be counted in either way)
    await seedShow({ date: daysAhead(10), status: "booked" });

    const r = await getReports();
    // showCount should include all past shows (3)
    expect(r.showCount).toBe(3);
    // settledCount should only include settled/closed (2), not the booked past one
    expect(r.settledCount).toBe(2);
    expect(r.settledCount).not.toBe(r.showCount);
  });

  it("includes closed shows in settledCount alongside settled shows", async () => {
    await seedShow({ date: daysAgo(5), status: "settled", settlementStatus: "paid" });
    await seedShow({ date: daysAgo(10), status: "closed", settlementStatus: "finalized" });
    await seedShow({ date: daysAgo(15), status: "advanced" }); // not settled

    const r = await getReports();
    expect(r.settledCount).toBe(2);
  });

  it("returns 0 for settledCount when no shows have settled or closed status", async () => {
    await seedShow({ date: daysAgo(5), status: "booked" });
    await seedShow({ date: daysAgo(10), status: "advanced" });

    const r = await getReports();
    expect(r.showCount).toBe(2);
    expect(r.settledCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Bug #2: "today" tense classification
// ─────────────────────────────────────────────────────────────
describe("getAllShows — tense classification", () => {
  it("classifies a show on today's date as 'today', not 'past'", async () => {
    await seedShow({ date: todayISO(), status: "day_of", settlementStatus: undefined });

    const shows = await getAllShows();
    const todayShow = shows.find((s) => s.show.date === todayISO());
    expect(todayShow).toBeDefined();
    expect(todayShow!.tense).toBe("today");
  });

  it("classifies past shows correctly as 'past'", async () => {
    await seedShow({ date: daysAgo(1), status: "settled", settlementStatus: "paid" });

    const shows = await getAllShows();
    expect(shows[0].tense).toBe("past");
  });

  it("classifies future shows correctly as 'upcoming'", async () => {
    await seedShow({ date: daysAhead(7), status: "booked" });

    const shows = await getAllShows();
    expect(shows[0].tense).toBe("upcoming");
  });

  it("all three tenses can coexist in a single result set", async () => {
    await seedShow({ date: daysAgo(5), status: "settled", settlementStatus: "paid" });
    await seedShow({ date: todayISO(), status: "day_of" });
    await seedShow({ date: daysAhead(7), status: "booked" });

    const shows = await getAllShows();
    const tenses = new Set(shows.map((s) => s.tense));
    expect(tenses).toContain("past");
    expect(tenses).toContain("today");
    expect(tenses).toContain("upcoming");
  });
});
