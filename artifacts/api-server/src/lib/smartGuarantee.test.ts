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
  signoff_text TEXT, notes TEXT,
  positive_summary TEXT, negative_summary TEXT
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

async function createTables() {
  for (const stmt of CREATE_TABLES_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await client.execute(stmt);
  }
}

async function dropTables() {
  for (const t of TABLES) await client.execute(`DROP TABLE IF EXISTS ${t}`);
}

const VENUE_ID = "v1";
const VENUE_ID_2 = "v2";
const ARTIST_ID = "headliner";
const AGENT_ID = "agent1";

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

type DealOverrides = Partial<typeof schema.deals.$inferInsert>;
type SettlementOverrides = Partial<typeof schema.settlements.$inferInsert>;

async function addPastShow(opts: {
  daysBack: number;
  artistId?: string;
  venueId?: string;
  deal?: DealOverrides;
  settlement?: SettlementOverrides | null;
  expenseTotal?: number | null;
}): Promise<string> {
  counter += 1;
  const id = `past-${counter}`;
  const date = daysFromNow(-opts.daysBack);
  await db.insert(schema.shows).values({
    id, venueId: opts.venueId ?? VENUE_ID, artistId: opts.artistId ?? ARTIST_ID,
    date: isoDate(date), status: "settled", roomConfig: "standing", createdAt: date,
  });
  await db.insert(schema.deals).values({
    id: `d-${id}`, showId: id, dealType: "flat", createdAt: date,
    ...opts.deal,
  });
  if (opts.settlement !== undefined && opts.settlement !== null) {
    await db.insert(schema.settlements).values({
      id: `st-${id}`, showId: id, status: "signed",
      ...opts.settlement,
    });
  }
  if (opts.expenseTotal != null) {
    await db.insert(schema.expenses).values({
      id: `e-${id}`, showId: id, category: "production",
      amount: opts.expenseTotal, enteredAt: date,
    });
  }
  return id;
}

async function addUpcomingShow(opts: {
  daysAhead?: number;
  artistId?: string;
  venueId?: string;
  deal: DealOverrides & { dealType: NonNullable<DealOverrides["dealType"]> };
}): Promise<string> {
  counter += 1;
  const id = `up-${counter}`;
  const date = daysFromNow(opts.daysAhead ?? 14);
  await db.insert(schema.shows).values({
    id, venueId: opts.venueId ?? VENUE_ID, artistId: opts.artistId ?? ARTIST_ID,
    date: isoDate(date), status: "booked", roomConfig: "standing", createdAt: date,
  });
  await db.insert(schema.deals).values({
    id: `d-${id}`, showId: id, createdAt: date,
    ...opts.deal,
  });
  return id;
}

async function seedBaseline() {
  await db.insert(schema.venues).values([
    { id: VENUE_ID, name: "Crescent", capacity: 650, city: "Nashville", state: "TN" },
    { id: VENUE_ID_2, name: "Other", capacity: 400, city: "Memphis", state: "TN" },
  ]);
  await db.insert(schema.agents).values({
    id: AGENT_ID, name: "Agent A", email: "a@a.com",
  });
  await db.insert(schema.artists).values({
    id: ARTIST_ID, name: "Headliner", agentId: AGENT_ID, genre: "indie", priorShowCount: 0,
  });
}

beforeAll(async () => {
  await dropTables();
  await createTables();
});

beforeEach(async () => {
  for (const t of TABLES) await client.execute(`DELETE FROM ${t}`);
  counter = 0;
  clearGuaranteeCache();
  await seedBaseline();
});

describe("generateGuarantee – early returns", () => {
  it("returns null with reason for missing show", async () => {
    const r = await generateGuarantee("nope");
    expect(r.suggestion).toBeNull();
    expect(r.reason).toBe("no_show");
  });

  it("returns null for shows already in the past", async () => {
    counter += 1;
    const id = `past-${counter}`;
    const d = daysFromNow(-5);
    await db.insert(schema.shows).values({
      id, venueId: VENUE_ID, artistId: ARTIST_ID, date: isoDate(d),
      status: "booked", roomConfig: "standing", createdAt: d,
    });
    await db.insert(schema.deals).values({
      id: `d-${id}`, showId: id, dealType: "vs", guaranteeAmount: 1000,
      percentage: 0.85, createdAt: d,
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion).toBeNull();
    expect(r.reason).toBe("show_already_past");
  });

  it("returns null with reason for missing deal", async () => {
    counter += 1;
    const id = `up-${counter}`;
    const d = daysFromNow(14);
    await db.insert(schema.shows).values({
      id, venueId: VENUE_ID, artistId: ARTIST_ID, date: isoDate(d),
      status: "booked", roomConfig: "standing", createdAt: d,
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion).toBeNull();
    expect(r.reason).toBe("no_deal");
  });

  it("skips flat deals (no recommendation needed)", async () => {
    const id = await addUpcomingShow({
      deal: { dealType: "flat", guaranteeAmount: 2500 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion).toBeNull();
    expect(r.reason).toBe("flat_deal_no_recommendation");
  });
});

describe("Step 1 – expected gross waterfall", () => {
  it("uses artist_at_venue when ≥1 prior show at same venue", async () => {
    await addPastShow({
      daysBack: 30,
      settlement: { status: "signed", grossBoxOffice: 12000, totalToArtist: 6000 },
    });
    await addPastShow({
      daysBack: 60, venueId: VENUE_ID_2,
      settlement: { status: "signed", grossBoxOffice: 99999, totalToArtist: 50000 },
    });
    const id = await addUpcomingShow({
      deal: { dealType: "vs", guaranteeAmount: 1000, percentage: 0.85 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.expectedGrossSource).toBe("artist_at_venue");
    expect(r.suggestion?.expectedGross).toBe(12000);
  });

  it("falls back to artist_anywhere when no prior at this venue", async () => {
    await addPastShow({
      daysBack: 30, venueId: VENUE_ID_2,
      settlement: { status: "signed", grossBoxOffice: 8000, totalToArtist: 4000 },
    });
    await addPastShow({
      daysBack: 90, venueId: VENUE_ID_2,
      settlement: { status: "signed", grossBoxOffice: 10000, totalToArtist: 5000 },
    });
    const id = await addUpcomingShow({
      deal: { dealType: "vs", guaranteeAmount: 1000, percentage: 0.85 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.expectedGrossSource).toBe("artist_anywhere");
    expect(r.suggestion?.expectedGross).toBe(9000);
  });

  it("falls back to agent_history when artist has no prior shows but agent has ≥3", async () => {
    for (let i = 0; i < 3; i += 1) {
      await db.insert(schema.artists).values({
        id: `roster-${i}`, name: `Roster ${i}`, agentId: AGENT_ID, priorShowCount: 0,
      });
      await addPastShow({
        daysBack: 30 + i, artistId: `roster-${i}`,
        settlement: { status: "signed", grossBoxOffice: 6000 + i * 1000, totalToArtist: 3000 },
      });
    }
    const id = await addUpcomingShow({
      deal: { dealType: "vs", guaranteeAmount: 1000, percentage: 0.85 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.expectedGrossSource).toBe("agent_history");
    expect(r.suggestion?.expectedGross).toBe(7000); // mean of 6000, 7000, 8000
  });

  it("falls back to cell_mean (≥3 in same dealType+bucket) with no agent/artist signal", async () => {
    await db.insert(schema.artists).values({
      id: "stranger", name: "Stranger", agentId: null, priorShowCount: 0,
    });
    for (let i = 0; i < 3; i += 1) {
      await db.insert(schema.artists).values({
        id: `cm-${i}`, name: `CM ${i}`, agentId: null, priorShowCount: 0,
      });
      await addPastShow({
        daysBack: 30 + i, artistId: `cm-${i}`,
        deal: { dealType: "vs", guaranteeAmount: 2000, percentage: 0.85 },
        settlement: { status: "signed", grossBoxOffice: 5000 + i * 100, totalToArtist: 2500 },
      });
    }
    const id = await addUpcomingShow({
      artistId: "stranger",
      deal: { dealType: "vs", guaranteeAmount: 2000, percentage: 0.85 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.expectedGrossSource).toBe("cell_mean");
    expect(r.suggestion?.expectedGross).toBeCloseTo(5100, 6);
  });

  it("falls back to venue_mean when no other signal", async () => {
    await db.insert(schema.artists).values({
      id: "stranger", name: "Stranger", agentId: null, priorShowCount: 0,
    });
    await db.insert(schema.artists).values({
      id: "other", name: "Other", agentId: null, priorShowCount: 0,
    });
    // One past show by an unrelated artist with a different dealType
    await addPastShow({
      daysBack: 30, artistId: "other",
      deal: { dealType: "flat", guaranteeAmount: 2000 },
      settlement: { status: "signed", grossBoxOffice: 4000, totalToArtist: 2000 },
    });
    const id = await addUpcomingShow({
      artistId: "stranger",
      deal: { dealType: "vs", guaranteeAmount: 1000, percentage: 0.85 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.expectedGrossSource).toBe("venue_mean");
    expect(r.suggestion?.expectedGross).toBe(4000);
  });

  it("falls back to capacity_proxy when there is no historical data at all", async () => {
    await db.insert(schema.artists).values({
      id: "stranger", name: "Stranger", agentId: null, priorShowCount: 0,
    });
    const id = await addUpcomingShow({
      artistId: "stranger",
      deal: { dealType: "vs", guaranteeAmount: 1000, percentage: 0.85 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.expectedGrossSource).toBe("capacity_proxy");
    // 650 capacity * 0.6 load * $30 ticket
    expect(r.suggestion?.expectedGross).toBe(11700);
  });
});

describe("Step 4 – expense waterfall and cap behavior", () => {
  it("uses artist_history_2plus when ≥2 prior at same venue", async () => {
    await addPastShow({
      daysBack: 30,
      settlement: { status: "signed", grossBoxOffice: 10000, totalToArtist: 5000 },
      expenseTotal: 800,
    });
    await addPastShow({
      daysBack: 60,
      settlement: { status: "signed", grossBoxOffice: 10000, totalToArtist: 5000 },
      expenseTotal: 1200,
    });
    const id = await addUpcomingShow({
      deal: { dealType: "vs", guaranteeAmount: 1000, percentage: 0.85 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.expenseSource).toBe("artist_history_2plus");
    expect(r.suggestion?.expenseEstimate).toBe(1000); // mean of 800, 1200
  });

  it("uses artist_history_1 when exactly 1 prior at same venue", async () => {
    await addPastShow({
      daysBack: 30,
      settlement: { status: "signed", grossBoxOffice: 10000, totalToArtist: 5000 },
      expenseTotal: 700,
    });
    const id = await addUpcomingShow({
      deal: { dealType: "vs", guaranteeAmount: 1000, percentage: 0.85 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.expenseSource).toBe("artist_history_1");
    expect(r.suggestion?.expenseEstimate).toBe(700);
  });

  it("uses genre_p75 when ≥3 prior shows in same genre and no artist/agent signal", async () => {
    await db.insert(schema.artists).values({
      id: "stranger", name: "Stranger", agentId: null, genre: "indie", priorShowCount: 0,
    });
    // 3 indie shows (same genre as the stranger), all by unrelated artists with no agent.
    const expenses = [500, 1000, 1500];
    for (let i = 0; i < expenses.length; i += 1) {
      await db.insert(schema.artists).values({
        id: `g-${i}`, name: `G ${i}`, agentId: null, genre: "indie", priorShowCount: 0,
      });
      await addPastShow({
        daysBack: 30 + i, artistId: `g-${i}`,
        settlement: { status: "signed", grossBoxOffice: 5000, totalToArtist: 2500 },
        expenseTotal: expenses[i],
      });
    }
    const id = await addUpcomingShow({
      artistId: "stranger",
      deal: { dealType: "vs", guaranteeAmount: 1000, percentage: 0.85 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.expenseSource).toBe("genre_p75");
    // p75 of [500,1000,1500] = 1250
    expect(r.suggestion?.expenseEstimate).toBe(1250);
  });

  it("clamps the expense estimate to the smaller of deal cap and bucket default", async () => {
    // Artist history says expenses run at $5,000.
    await addPastShow({
      daysBack: 30,
      settlement: { status: "signed", grossBoxOffice: 10000, totalToArtist: 5000 },
      expenseTotal: 5000,
    });
    await addPastShow({
      daysBack: 60,
      settlement: { status: "signed", grossBoxOffice: 10000, totalToArtist: 5000 },
      expenseTotal: 5000,
    });
    // Deal cap is 1200; default bucket cap for $1–5K is 1500. Min = 1200.
    const id = await addUpcomingShow({
      deal: {
        dealType: "vs", guaranteeAmount: 2000, percentage: 0.85, expenseCap: 1200,
      },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.expenseCap).toBe(1200);
    expect(r.suggestion?.expenseEstimate).toBe(1200);
  });

  it("uses the bucket default cap when no deal cap is set", async () => {
    await addPastShow({
      daysBack: 30,
      settlement: { status: "signed", grossBoxOffice: 10000, totalToArtist: 5000 },
      expenseTotal: 9999,
    });
    await addPastShow({
      daysBack: 60,
      settlement: { status: "signed", grossBoxOffice: 10000, totalToArtist: 5000 },
      expenseTotal: 9999,
    });
    // $5–15K bucket → default cap 3500.
    const id = await addUpcomingShow({
      deal: { dealType: "vs", guaranteeAmount: 8000, percentage: 0.85 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.expenseCap).toBe(3500);
    expect(r.suggestion?.expenseEstimate).toBe(3500);
  });
});

describe("Step 6 – percentage payout basis", () => {
  it("door deals with no percentage default to a 70% split of net base", async () => {
    // Provide artist_at_venue history so expectedGross is deterministic.
    await addPastShow({
      daysBack: 30,
      settlement: { status: "signed", grossBoxOffice: 10000, totalToArtist: 5000 },
      expenseTotal: 1000,
    });
    const id = await addUpcomingShow({
      deal: { dealType: "door", guaranteeAmount: 0, percentage: 0 },
    });
    const r = await generateGuarantee(id)!;
    const s = r.suggestion!;
    // expectedGross 10000 → fees 1000 → netAfterFees 9000 → expense 1000 (artist_history_1, capped at 1500)
    // → netBase 8000 → percentagePayout = 0.7 * 8000 = 5600.
    expect(s.expectedGross).toBe(10000);
    expect(s.netAfterFees).toBe(9000);
    expect(s.expenseEstimate).toBe(1000);
    expect(s.netBase).toBe(8000);
    expect(s.percentagePayout).toBeCloseTo(5600, 6);
  });

  it("percentage_of_gross uses expectedGross as the basis", async () => {
    await addPastShow({
      daysBack: 30,
      settlement: { status: "signed", grossBoxOffice: 10000, totalToArtist: 5000 },
      expenseTotal: 1000,
    });
    const id = await addUpcomingShow({
      deal: { dealType: "percentage_of_gross", guaranteeAmount: 1000, percentage: 0.5 },
    });
    const r = await generateGuarantee(id);
    // 0.5 * 10000 = 5000.
    expect(r.suggestion?.percentagePayout).toBeCloseTo(5000, 6);
  });
});

describe("Step 7 – winner selection and $50 rounding", () => {
  it("picks the guarantee when guarantee > projected payout", async () => {
    await addPastShow({
      daysBack: 30,
      settlement: { status: "signed", grossBoxOffice: 4000, totalToArtist: 2000 },
      expenseTotal: 500,
    });
    const id = await addUpcomingShow({
      // Projected: 0.5 * 4000 = 2000; guarantee 5000 wins.
      deal: { dealType: "percentage_of_gross", guaranteeAmount: 5000, percentage: 0.5 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.winner).toBe("guarantee");
    expect(r.suggestion?.suggestedPrice).toBe(5000);
    expect(r.suggestion?.delta).toBe(0); // 5000 - 5000
  });

  it("picks the percentage when projected payout > guarantee and rounds to nearest $50", async () => {
    await addPastShow({
      daysBack: 30,
      settlement: { status: "signed", grossBoxOffice: 10000, totalToArtist: 5000 },
      expenseTotal: 500,
    });
    const id = await addUpcomingShow({
      // Projected: 0.5 * 10000 = 5000; guarantee 1000.
      deal: { dealType: "percentage_of_gross", guaranteeAmount: 1000, percentage: 0.5 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.winner).toBe("percentage");
    expect(r.suggestion?.suggestedPrice).toBe(5000);
    expect(r.suggestion?.suggestedPrice! % 50).toBe(0);
  });

  it("rounds the winning value to the nearest $50", async () => {
    await addPastShow({
      daysBack: 30,
      settlement: { status: "signed", grossBoxOffice: 4234, totalToArtist: 2000 },
      expenseTotal: 300,
    });
    const id = await addUpcomingShow({
      // Projected: 1.0 * 4234 = 4234. Round to 4250.
      deal: { dealType: "percentage_of_gross", guaranteeAmount: 1000, percentage: 1.0 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.suggestedPrice).toBe(4250);
  });

  it("treats projected payouts within $1 of the guarantee as a tie", async () => {
    await addPastShow({
      daysBack: 30,
      settlement: { status: "signed", grossBoxOffice: 4000, totalToArtist: 2000 },
      expenseTotal: 500,
    });
    const id = await addUpcomingShow({
      // Projected: 0.5 * 4000 = 2000; guarantee 2000 → tie.
      deal: { dealType: "percentage_of_gross", guaranteeAmount: 2000, percentage: 0.5 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.winner).toBe("tie");
  });
});

describe("Confidence tier assignment", () => {
  it("returns A when artist has ≥3 priors AND winner margin > 200", async () => {
    for (let i = 0; i < 3; i += 1) {
      await addPastShow({
        daysBack: 30 + i,
        settlement: { status: "signed", grossBoxOffice: 10000, totalToArtist: 5000 },
        expenseTotal: 500,
      });
    }
    const id = await addUpcomingShow({
      // Projected 0.5*10000 = 5000; guarantee 1000 → margin 4000 > 200.
      deal: { dealType: "percentage_of_gross", guaranteeAmount: 1000, percentage: 0.5 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.artistShowCount).toBe(3);
    expect(r.suggestion?.confidenceTier).toBe("A");
  });

  it("returns B when artist has 1–2 priors", async () => {
    await addPastShow({
      daysBack: 30,
      settlement: { status: "signed", grossBoxOffice: 10000, totalToArtist: 5000 },
      expenseTotal: 500,
    });
    const id = await addUpcomingShow({
      deal: { dealType: "percentage_of_gross", guaranteeAmount: 1000, percentage: 0.5 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.confidenceTier).toBe("B");
  });

  it("returns C when only the agent has at least 1 prior show", async () => {
    await db.insert(schema.artists).values({
      id: "stranger", name: "Stranger", agentId: AGENT_ID, genre: null, priorShowCount: 0,
    });
    await db.insert(schema.artists).values({
      id: "roster1", name: "R1", agentId: AGENT_ID, genre: null, priorShowCount: 0,
    });
    await addPastShow({
      daysBack: 30, artistId: "roster1",
      settlement: { status: "signed", grossBoxOffice: 9000, totalToArtist: 4500 },
      expenseTotal: 500,
    });
    const id = await addUpcomingShow({
      artistId: "stranger",
      deal: { dealType: "percentage_of_gross", guaranteeAmount: 1000, percentage: 0.5 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.artistShowCount).toBe(0);
    expect(r.suggestion?.agentShowCount).toBe(1);
    expect(r.suggestion?.confidenceTier).toBe("C");
  });

  it("returns D when there is no artist, agent, or genre signal", async () => {
    await db.insert(schema.artists).values({
      id: "ghost", name: "Ghost", agentId: null, genre: null, priorShowCount: 0,
    });
    const id = await addUpcomingShow({
      artistId: "ghost",
      deal: { dealType: "percentage_of_gross", guaranteeAmount: 1000, percentage: 0.5 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.confidenceTier).toBe("D");
  });
});

describe("Insurance tier assignment", () => {
  it("forces tier 4 for door deals regardless of confidence", async () => {
    for (let i = 0; i < 3; i += 1) {
      await addPastShow({
        daysBack: 30 + i,
        settlement: { status: "signed", grossBoxOffice: 10000, totalToArtist: 5000 },
        expenseTotal: 500,
      });
    }
    const id = await addUpcomingShow({
      deal: { dealType: "door", guaranteeAmount: 0, percentage: 0 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.confidenceTier).toBe("A");
    expect(r.suggestion?.insuranceTier).toBe(4);
  });

  it("forces tier 4 when confidence is D", async () => {
    await db.insert(schema.artists).values({
      id: "ghost", name: "Ghost", agentId: null, genre: null, priorShowCount: 0,
    });
    const id = await addUpcomingShow({
      artistId: "ghost",
      deal: { dealType: "vs", guaranteeAmount: 1000, percentage: 0.85 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.confidenceTier).toBe("D");
    expect(r.suggestion?.insuranceTier).toBe(4);
  });

  it("returns tier 3 when the price is within $500 of breakeven", async () => {
    // Build an A-tier setup, then craft a near-breakeven percentage payout.
    for (let i = 0; i < 3; i += 1) {
      await addPastShow({
        daysBack: 30 + i,
        settlement: { status: "signed", grossBoxOffice: 5000, totalToArtist: 2500 },
        expenseTotal: 500,
      });
    }
    // Expected gross = 5000, fees 500, expense 500 (capped),
    // net base = 4000, payout = 0.95 * 4000 = 3800.
    // cushion = 5000 * 0.9 - 500 - 3800 = 200 < 500 → tier 3.
    const id = await addUpcomingShow({
      deal: { dealType: "percentage_of_net", guaranteeAmount: 1000, percentage: 0.95 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.confidenceTier).toBe("A");
    expect(r.suggestion?.insuranceTier).toBe(3);
  });

  it("returns tier 1 for tier-A confidence with comfortable cushion (>=$1,500)", async () => {
    for (let i = 0; i < 3; i += 1) {
      await addPastShow({
        daysBack: 30 + i,
        settlement: { status: "signed", grossBoxOffice: 10000, totalToArtist: 5000 },
        expenseTotal: 500,
      });
    }
    // payout = 0.5 * 10000 = 5000; cushion = 9000 - 500 - 5000 = 3500 ≥ 1500 → tier 1.
    const id = await addUpcomingShow({
      deal: { dealType: "percentage_of_gross", guaranteeAmount: 1000, percentage: 0.5 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.confidenceTier).toBe("A");
    expect(r.suggestion?.insuranceTier).toBe(1);
  });

  it("returns tier 2 for tier-A confidence with thin cushion ($500–$1,499)", async () => {
    for (let i = 0; i < 3; i += 1) {
      await addPastShow({
        daysBack: 30 + i,
        settlement: { status: "signed", grossBoxOffice: 5000, totalToArtist: 2500 },
        expenseTotal: 500,
      });
    }
    // Expected gross 5000, fees 500, expense 500 (capped),
    // net base 4000, payout = 0.85 * 4000 = 3400.
    // cushion = 5000 * 0.9 - 500 - 3400 = 600 → 500 ≤ cushion < 1500 → tier 2.
    const id = await addUpcomingShow({
      deal: { dealType: "percentage_of_net", guaranteeAmount: 1000, percentage: 0.85 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion?.confidenceTier).toBe("A");
    expect(r.suggestion?.insuranceTier).toBe(2);
  });
});

describe("Audit + breakeven sanity", () => {
  it("emits a parseable audit JSON capturing each step's inputs and outputs", async () => {
    await addPastShow({
      daysBack: 30,
      settlement: { status: "signed", grossBoxOffice: 10000, totalToArtist: 5000 },
      expenseTotal: 800,
    });
    const id = await addUpcomingShow({
      deal: { dealType: "vs", guaranteeAmount: 2000, percentage: 0.85, expenseCap: 1000 },
    });
    const r = await generateGuarantee(id);
    expect(r.suggestion).not.toBeNull();
    const audit = JSON.parse(r.suggestion!.auditJson);
    expect(audit.step1_expectedGross.source).toBe("artist_at_venue");
    expect(audit.step2_ticketingFees.rate).toBe(0.1);
    expect(audit.step3_netAfterFees).toBe(9000);
    expect(audit.step4_expense.effectiveCap).toBe(1000);
    expect(audit.step4_expense.cappedValue).toBe(800);
    expect(audit.step5_netBase).toBe(8200);
    expect(audit.step6_percentagePayout.basis).toBe(8200);
    expect(audit.step7_winner.suggestedPrice).toBe(r.suggestion!.suggestedPrice);
  });

  it("computes breakeven as (price + expense) / (1 - feeRate)", async () => {
    await addPastShow({
      daysBack: 30,
      settlement: { status: "signed", grossBoxOffice: 10000, totalToArtist: 5000 },
      expenseTotal: 1000,
    });
    const id = await addUpcomingShow({
      deal: { dealType: "vs", guaranteeAmount: 5000, percentage: 0.85 },
    });
    const r = await generateGuarantee(id);
    const s = r.suggestion!;
    expect(s.breakevenGross).toBeCloseTo(
      (s.suggestedPrice + s.expenseEstimate) / 0.9,
      6,
    );
  });
});
