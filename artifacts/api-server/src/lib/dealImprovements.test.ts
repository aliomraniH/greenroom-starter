import { describe, expect, it, beforeEach } from "vitest";

process.env.DATABASE_URL = "file::memory:";

const { client, db } = await import("../db");
const schema = await import("../db/schema");
const dealImprovementsMod = await import("./dealImprovements");
const { getDealImprovements, __TEST_CONSTANTS__ } = dealImprovementsMod;
const { clearExpenseCapsCache } = await import("./expenseCaps");

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
    try { await client.execute(`DROP TABLE IF EXISTS ${stmt.match(/CREATE TABLE (\w+)/)![1]}`); } catch { /* */ }
    await client.execute(stmt);
  }
  clearExpenseCapsCache();
});

async function seedExpense(showId: string, amount: number) {
  await db.insert(schema.expenses).values({
    id: `e-${showId}-${amount}-${Math.random()}`,
    showId, category: "production", amount,
    approved: true, absorbedByVenue: false,
    enteredAt: new Date(),
  });
}

async function seedBucketWithExpenses(opts: {
  bucket: "$0–1K" | "$1–5K" | "$5–15K" | "$15K+";
  count: number;
  expensePerShow: number;
  prefix?: string;
}) {
  // Pick a guarantee that lands in the requested bucket.
  const guarantee = {
    "$0–1K":   500,
    "$1–5K":  2500,
    "$5–15K": 8000,
    "$15K+": 20000,
  }[opts.bucket];
  const prefix = opts.prefix ?? "seed";
  for (let i = 0; i < opts.count; i++) {
    const showId = `${prefix}-${opts.bucket}-${i}`;
    await db.insert(schema.shows).values({
      id: showId, venueId: "v1", artistId: `seedart-${i}`,
      date: "2025-06-15", status: "settled", roomConfig: "standing",
      createdAt: new Date(),
    });
    await db.insert(schema.deals).values({
      id: `d-${showId}`, showId, dealType: "vs",
      guaranteeAmount: guarantee, percentage: 0.8,
      createdAt: new Date(),
    });
    await seedExpense(showId, opts.expensePerShow);
  }
}

async function seedShow(opts: {
  showId: string;
  dealType: "vs" | "percentage_of_net" | "percentage_of_gross" | "door" | "flat";
  guaranteeAmount: number | null;
  expenseCap?: number | null;
  hospitalityCap?: number | null;
  percentage?: number | null;
}) {
  await db.insert(schema.shows).values({
    id: opts.showId, venueId: "v1", artistId: "a1",
    date: "2026-01-15", status: "settled", roomConfig: "standing",
    createdAt: new Date(),
  });
  await db.insert(schema.deals).values({
    id: `d-${opts.showId}`, showId: opts.showId,
    dealType: opts.dealType,
    guaranteeAmount: opts.guaranteeAmount,
    percentage: opts.percentage ?? null,
    expenseCap: opts.expenseCap ?? null,
    hospitalityCap: opts.hospitalityCap ?? null,
    createdAt: new Date(),
  });
}

describe("dealImprovements — audit fixes", () => {
  it("never returns convert_to_flat (Smart Switch owns flat conversion)", async () => {
    await seedShow({
      showId: "s1", dealType: "vs", guaranteeAmount: 2500,
      expenseCap: null, hospitalityCap: null,
    });
    const out = await getDealImprovements("s1");
    expect(out.improvements.find((i) => (i.kind as string) === "convert_to_flat")).toBeUndefined();
  });

  it("derives the expense-cap proposal from historical data (per-bucket P75)", async () => {
    // Seed $1–5K with a tight cluster around $1,800 (P75 ~= 1850) and
    // $5–15K with a higher cluster around $2,500 (P75 ~= 2550). If a
    // stale hardcoded table were still in use the proposed cap would
    // be a constant; here it should track the seeded distribution.
    await seedBucketWithExpenses({ bucket: "$1–5K", count: 8, expensePerShow: 1500 });
    await seedExpense("seed-$1–5K-0", 400); // bumps one show to $1,900
    await seedExpense("seed-$1–5K-1", 400); // bumps another to $1,900
    await seedBucketWithExpenses({ bucket: "$5–15K", count: 8, expensePerShow: 2500 });
    await seedExpense("seed-$5–15K-0", 500); // bumps one to $3,000

    await seedShow({ showId: "target-mid", dealType: "vs", guaranteeAmount: 2500 });
    const outMid = await getDealImprovements("target-mid");
    const capMid = outMid.improvements.find((i) => i.kind === "add_expense_cap");
    expect(capMid).toBeDefined();
    // $1–5K bucket P75 of [1500×6, 1900×2] = 1600, rounded to $50.
    expect(capMid!.proposedNumber).toBe(1600);

    await seedShow({ showId: "target-big", dealType: "vs", guaranteeAmount: 8000 });
    const outBig = await getDealImprovements("target-big");
    const capBig = outBig.improvements.find((i) => i.kind === "add_expense_cap");
    expect(capBig).toBeDefined();
    // $5–15K bucket P75 of [2500×7, 3000×1] = 2500, rounded to $50.
    expect(capBig!.proposedNumber).toBe(2500);

    // Different buckets must produce different proposals — the whole
    // point of moving off the disagreeing-constants design.
    expect(capMid!.proposedNumber).not.toBe(capBig!.proposedNumber);
  });

  it("re-reads the database between runs so updates to data shift the cap", async () => {
    // First pass: seed a low-expense $1–5K cluster, get a low cap.
    await seedBucketWithExpenses({ bucket: "$1–5K", count: 8, expensePerShow: 1000, prefix: "lo" });
    await seedShow({ showId: "before", dealType: "vs", guaranteeAmount: 2500 });
    const before = await getDealImprovements("before");
    const capBefore = before.improvements.find((i) => i.kind === "add_expense_cap")!;
    expect(capBefore.proposedNumber).toBe(1000);

    // Now log a wave of expensive shows. The cap should rise.
    await seedBucketWithExpenses({ bucket: "$1–5K", count: 8, expensePerShow: 2500, prefix: "hi" });
    // Bust the 5-min TTL cache so the next call recomputes from data.
    clearExpenseCapsCache();
    await seedShow({ showId: "after", dealType: "vs", guaranteeAmount: 2500 });
    const after = await getDealImprovements("after");
    const capAfter = after.improvements.find((i) => i.kind === "add_expense_cap")!;
    expect(capAfter.proposedNumber ?? 0).toBeGreaterThan(capBefore.proposedNumber ?? 0);
  });

  it("falls back to the cold-start default when the database has no expenses", async () => {
    // No expense rows seeded → expenseCaps returns the hardcoded
    // cold-start fallback. This guarantees the engine still emits a
    // safe number on a fresh deployment.
    await seedShow({ showId: "cold", dealType: "vs", guaranteeAmount: 2500 });
    const out = await getDealImprovements("cold");
    const cap = out.improvements.find((i) => i.kind === "add_expense_cap");
    expect(cap).toBeDefined();
    expect(cap!.proposedNumber).toBe(1750);
  });

  it("uses single $400 hospitality default for every bucket", async () => {
    expect(__TEST_CONSTANTS__.HOSPITALITY_CAP_DEFAULT).toBe(400);
    for (const [showId, g] of [["s4", 500], ["s5", 2500], ["s6", 8000], ["s7", 25000]] as const) {
      await seedShow({ showId, dealType: "vs", guaranteeAmount: g });
      const out = await getDealImprovements(showId);
      const hosp = out.improvements.find((i) => i.kind === "add_hospitality_cap");
      expect(hosp).toBeDefined();
      expect(hosp!.proposedNumber).toBe(400);
    }
  });

  it("skips expense-cap suggestion when deal already has one", async () => {
    await seedShow({
      showId: "s8", dealType: "vs", guaranteeAmount: 2500,
      expenseCap: 1500, hospitalityCap: 400,
    });
    const out = await getDealImprovements("s8");
    expect(out.improvements).toHaveLength(0);
  });

  it("skips both caps for flat deals (no expense/hospitality risk)", async () => {
    await seedShow({ showId: "s9", dealType: "flat", guaranteeAmount: 3000 });
    const out = await getDealImprovements("s9");
    expect(out.improvements).toHaveLength(0);
  });
});
