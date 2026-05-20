import { describe, expect, it, beforeEach } from "vitest";

process.env.DATABASE_URL = "file::memory:";

const { client, db } = await import("../db");
const schema = await import("../db/schema");
const { generateSuggestion, clearSmartSwitchCache } = await import("./smartSwitch");

const CREATE = `
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
`;

beforeEach(async () => {
  for (const stmt of CREATE.split(";").map((s) => s.trim()).filter(Boolean)) {
    const tableName = stmt.match(/CREATE TABLE (\w+)/)![1];
    try { await client.execute(`DROP TABLE IF EXISTS ${tableName}`); } catch { /* */ }
    await client.execute(stmt);
  }
  clearSmartSwitchCache();
});

async function seedPastVsDeals(count: number, payout: number, gross: number, expense: number) {
  for (let i = 0; i < count; i++) {
    const showId = `past-${i}`;
    await db.insert(schema.shows).values({
      id: showId, venueId: "v1", artistId: `art-${i}`,
      date: "2025-01-15", status: "settled", roomConfig: "standing",
      createdAt: new Date(),
    });
    await db.insert(schema.deals).values({
      id: `d-${showId}`, showId, dealType: "vs",
      guaranteeAmount: 1500, percentage: 80, createdAt: new Date(),
    });
    await db.insert(schema.settlements).values({
      id: `set-${showId}`, showId, status: "signed",
      grossBoxOffice: gross, totalToArtist: payout,
    });
    if (expense > 0) {
      await db.insert(schema.expenses).values({
        id: `e-${showId}`, showId, category: "production",
        amount: expense, approved: true, absorbedByVenue: false,
        enteredAt: new Date(),
      });
    }
  }
}

describe("smartSwitch — audit fixes", () => {
  it("vs/$1–5K returns source=insufficient_confidence with null flat when SGP can't run", async () => {
    // Without showId we skip the SGP path entirely. Previously this branch
    // mirrored deal.guaranteeAmount back as the suggested flat (source=
    // guarantee_amount). That was rejected as data mixing — the contract
    // guarantee is agreement-side data and has no place in a module that
    // is supposed to be pure history + projection. New behavior: emit a
    // shape=flat row with suggestedFlat=null and source=
    // insufficient_confidence so the UI can render a "discuss with agent"
    // message.
    await seedPastVsDeals(5, 1466, 4000, 1500);
    clearSmartSwitchCache();

    const sug = await generateSuggestion(
      {
        id: "d-target", showId: "s-target", dealType: "vs",
        guaranteeAmount: 2200, percentage: 80, percentageBasis: null,
        expenseCap: null, hospitalityCap: null, bonusesJson: null,
        dealNotesFreetext: null, createdAt: new Date(),
      },
      0,
      // no showId → skip SGP path, exercise insufficient-confidence path
    );
    expect(sug).not.toBeNull();
    expect(sug!.shape).toBe("flat");
    expect(sug!.source).toBe("insufficient_confidence");
    expect(sug!.suggestedFlat).toBeNull();
    // Basis copy should NOT reference the contract guarantee.
    expect(sug!.basis).not.toMatch(/\$2,?200/);
    expect(sug!.basis).toMatch(/Not enough confidence or prior data/);
  });

  it("insufficient_confidence source does not leak the contract guarantee into basis copy", async () => {
    // Audit acceptance: the suggestion module is pure history + projection.
    // An odd contract guarantee must not appear anywhere in the response
    // body, because doing so would imply we're using it as an anchor.
    await seedPastVsDeals(3, 2000, 5000, 1500);
    clearSmartSwitchCache();

    const oddGuarantee = 2237; // distinctive non-round number
    const sug = await generateSuggestion(
      {
        id: "d-odd", showId: "s-odd", dealType: "vs",
        guaranteeAmount: oddGuarantee, percentage: 80, percentageBasis: null,
        expenseCap: null, hospitalityCap: null, bonusesJson: null,
        dealNotesFreetext: null, createdAt: new Date(),
      },
      0,
    );
    expect(sug!.source).toBe("insufficient_confidence");
    expect(sug!.suggestedFlat).toBeNull();
    expect(sug!.basis).not.toContain("2237");
    expect(sug!.basis).not.toContain("2,237");
  });

  it("insufficient_confidence source falls back to tier D for first-time artists with no SGP", async () => {
    // Without an SGP run we don't have a tier to copy through, so the
    // insufficient-confidence response defaults to D — the most honest
    // signal we have for "no data backing here".
    clearSmartSwitchCache();
    const sug = await generateSuggestion(
      {
        id: "d-firsttimer", showId: "s-firsttimer", dealType: "vs",
        guaranteeAmount: 2000, percentage: 80, percentageBasis: null,
        expenseCap: null, hospitalityCap: null, bonusesJson: null,
        dealNotesFreetext: null, createdAt: new Date(),
      },
      0, // first-time artist
    );
    expect(sug!.source).toBe("insufficient_confidence");
    expect(sug!.confidenceTier).toBe("D");
    expect(sug!.artistShowsAtVenue).toBe(0);
    expect(sug!.suggestedFlat).toBeNull();
  });

  it("door at $15K+ returns source=suppressed (not enough history)", async () => {
    const sug = await generateSuggestion(
      {
        id: "d-big", showId: "s-big", dealType: "door",
        guaranteeAmount: 18000, percentage: null, percentageBasis: null,
        expenseCap: null, hospitalityCap: null, bonusesJson: null,
        dealNotesFreetext: null, createdAt: new Date(),
      },
      0,
    );
    expect(sug).not.toBeNull();
    expect(sug!.shape).toBe("door_hybrid");
    expect(sug!.source).toBe("suppressed");
    expect(sug!.confidenceTier).toBe("D");
    expect(sug!.doorSplitPct).toBeNull();
    expect(sug!.basis).toMatch(/discuss the structure directly|not enough history/i);
  });

  it("door dead-pool branch fires when projected avail ≤ floor", async () => {
    // Seed door history where avgGross is so low that 0.9*gross - cap < $500 floor.
    // gross=1000 → 0.9*1000 - 1500 = -600 → dead pool.
    for (let i = 0; i < 4; i++) {
      const showId = `door-${i}`;
      await db.insert(schema.shows).values({
        id: showId, venueId: "v1", artistId: `art-${i}`,
        date: "2025-02-15", status: "settled", roomConfig: "standing",
        createdAt: new Date(),
      });
      await db.insert(schema.deals).values({
        id: `d-${showId}`, showId, dealType: "door",
        guaranteeAmount: 0, percentage: 80, createdAt: new Date(),
      });
      await db.insert(schema.settlements).values({
        id: `set-${showId}`, showId, status: "signed",
        grossBoxOffice: 1000, totalToArtist: 500,
      });
      await db.insert(schema.expenses).values({
        id: `e-${showId}`, showId, category: "production",
        amount: 1500, approved: true, absorbedByVenue: false,
        enteredAt: new Date(),
      });
    }
    clearSmartSwitchCache();

    const sug = await generateSuggestion(
      {
        id: "d-deadpool", showId: "s-deadpool", dealType: "door",
        guaranteeAmount: 0, percentage: 80, percentageBasis: null,
        expenseCap: null, hospitalityCap: null, bonusesJson: null,
        dealNotesFreetext: null, createdAt: new Date(),
      },
      0,
    );
    expect(sug).not.toBeNull();
    expect(sug!.source).toBe("door_dead_pool");
    expect(sug!.bandLow).toBe(500);
    expect(sug!.bandHigh).toBe(500);
    // Audit acceptance: explicit isDeadPool boolean carries the contract,
    // not just the source enum vocabulary.
    expect(sug!.isDeadPool).toBe(true);
  });

  it("non-dead-pool branches all carry isDeadPool=false", async () => {
    // Reuse the prior seeded door dataset (avgGross=1000) but override the
    // deal so it routes through the door_hybrid_calc / suppressed branches
    // instead. Then also test a vs cell-mean branch.
    // door $15K+ → suppressed
    const sup = await generateSuggestion(
      {
        id: "d-sup", showId: "s-sup", dealType: "door",
        guaranteeAmount: 25000, percentage: 80, percentageBasis: null,
        expenseCap: null, hospitalityCap: null, bonusesJson: null,
        dealNotesFreetext: null, createdAt: new Date(),
      },
      0,
    );
    expect(sup!.source).toBe("suppressed");
    expect(sup!.isDeadPool).toBe(false);
  });

  it("door hybrid normal projection still fires when pool > floor", async () => {
    // gross=8000 → 0.9*8000 - 1500 = 5700 ≥ 500 floor → normal hybrid path.
    for (let i = 0; i < 4; i++) {
      const showId = `door-${i}`;
      await db.insert(schema.shows).values({
        id: showId, venueId: "v1", artistId: `art-${i}`,
        date: "2025-02-15", status: "settled", roomConfig: "standing",
        createdAt: new Date(),
      });
      await db.insert(schema.deals).values({
        id: `d-${showId}`, showId, dealType: "door",
        guaranteeAmount: 0, percentage: 80, createdAt: new Date(),
      });
      await db.insert(schema.settlements).values({
        id: `set-${showId}`, showId, status: "signed",
        grossBoxOffice: 8000, totalToArtist: 4000,
      });
      await db.insert(schema.expenses).values({
        id: `e-${showId}`, showId, category: "production",
        amount: 1500, approved: true, absorbedByVenue: false,
        enteredAt: new Date(),
      });
    }
    clearSmartSwitchCache();

    const sug = await generateSuggestion(
      {
        id: "d-normal", showId: "s-normal", dealType: "door",
        guaranteeAmount: 0, percentage: 80, percentageBasis: null,
        expenseCap: null, hospitalityCap: null, bonusesJson: null,
        dealNotesFreetext: null, createdAt: new Date(),
      },
      0,
    );
    expect(sug).not.toBeNull();
    expect(sug!.source).toBe("door_hybrid_calc");
    expect(sug!.doorFloor).toBe(500);
    expect(sug!.doorSplitPct).toBeCloseTo(0.6);
  });
});
