import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const dbCandidates = [
  path.resolve(process.cwd(), "data", "greenroom.db"),
  path.resolve(process.cwd(), "artifacts", "api-server", "data", "greenroom.db"),
];
const dbPath = dbCandidates.find((p) => fs.existsSync(p)) ?? dbCandidates[0];
const envUrl = process.env.DATABASE_URL;
const dbUrl = envUrl && envUrl.startsWith("file:") ? envUrl : `file:${dbPath}`;

export const client = createClient({ url: dbUrl });
export const db = drizzle(client, { schema });

export type DB = typeof db;

async function ensureColumn(table: string, column: string, decl: string) {
  const exists = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    args: [table],
  });
  if (exists.rows.length === 0) return;
  const cols = await client.execute(`PRAGMA table_info(${table})`);
  const has = cols.rows.some((r) => (r as Record<string, unknown>).name === column);
  if (!has) {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

export const migrationsReady = (async () => {
  await ensureColumn("settlements", "positive_summary", "TEXT");
  await ensureColumn("settlements", "negative_summary", "TEXT");
  await client.execute(
    "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)",
  );
  await client.execute(`
    CREATE TABLE IF NOT EXISTS guarantee_suggestions (
      id TEXT PRIMARY KEY,
      show_id TEXT NOT NULL UNIQUE REFERENCES shows(id),
      deal_id TEXT NOT NULL REFERENCES deals(id),
      generated_at INTEGER NOT NULL,
      agent_guarantee REAL,
      suggested_price REAL NOT NULL,
      delta REAL NOT NULL,
      expected_gross REAL NOT NULL,
      expected_gross_source TEXT NOT NULL,
      ticketing_fees REAL NOT NULL,
      net_after_fees REAL NOT NULL,
      expense_estimate REAL NOT NULL,
      expense_source TEXT NOT NULL,
      expense_cap REAL,
      net_base REAL NOT NULL,
      percentage_payout REAL NOT NULL,
      winner TEXT NOT NULL,
      winner_margin REAL NOT NULL,
      breakeven_gross REAL NOT NULL,
      artist_show_count INTEGER NOT NULL,
      agent_show_count INTEGER NOT NULL,
      confidence_tier TEXT NOT NULL,
      insurance_tier INTEGER NOT NULL,
      basis TEXT NOT NULL,
      audit_json TEXT NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS switch_suggestions (
      id TEXT PRIMARY KEY,
      show_id TEXT NOT NULL UNIQUE REFERENCES shows(id),
      deal_id TEXT NOT NULL REFERENCES deals(id),
      suggested_at INTEGER NOT NULL,
      deal_type_from TEXT NOT NULL,
      shape TEXT NOT NULL,
      suggested_flat REAL,
      door_floor REAL,
      door_split_pct REAL,
      door_expense_cap REAL,
      confidence_tier TEXT NOT NULL,
      band_low REAL,
      band_high REAL,
      sample_size INTEGER NOT NULL,
      basis TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'suggested',
      decided_at INTEGER,
      source TEXT,
      band_width REAL
    )
  `);
  // Idempotent ALTERs for any pre-existing switch_suggestions table that
  // predates the source/band_width columns. Must run AFTER the CREATE so
  // ensureColumn can detect the table.
  await ensureColumn("switch_suggestions", "source", "TEXT");
  await ensureColumn("switch_suggestions", "band_width", "REAL");
  await ensureColumn("switch_suggestions", "artist_shows_at_venue", "INTEGER");
  // Projected venue net columns — see schema.ts comment. Nullable on
  // existing DBs; populated on the next `generateAndPersistGuarantee`.
  await ensureColumn("guarantee_suggestions", "projected_venue_net_sgp", "REAL");
  await ensureColumn("guarantee_suggestions", "projected_venue_net_current", "REAL");
})();
