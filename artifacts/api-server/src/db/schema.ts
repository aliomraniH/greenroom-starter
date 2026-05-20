import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role", {
    enum: ["booker", "gm", "production", "box_office"],
  }).notNull(),
  venueId: text("venue_id").notNull(),
});

export const venues = sqliteTable("venues", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  capacity: integer("capacity").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
});

export const agencies = sqliteTable("agencies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  agencyId: text("agency_id").references(() => agencies.id),
  email: text("email").notNull(),
  phone: text("phone"),
  preferencesNotes: text("preferences_notes"),
});

export const artists = sqliteTable("artists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  agentId: text("agent_id").references(() => agents.id),
  managerEmail: text("manager_email"),
  genre: text("genre"),
  priorShowCount: integer("prior_show_count").notNull().default(0),
});

export const shows = sqliteTable("shows", {
  id: text("id").primaryKey(),
  venueId: text("venue_id").notNull().references(() => venues.id),
  artistId: text("artist_id").notNull().references(() => artists.id),
  date: text("date").notNull(),
  status: text("status", {
    enum: ["booked", "advanced", "day_of", "settled", "closed"],
  }).notNull().default("booked"),
  doorsTime: text("doors_time"),
  setTime: text("set_time"),
  openerArtistId: text("opener_artist_id").references(() => artists.id),
  roomConfig: text("room_config", { enum: ["standing", "seated", "mixed"] })
    .notNull().default("standing"),
  internalNotes: text("internal_notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const deals = sqliteTable("deals", {
  id: text("id").primaryKey(),
  showId: text("show_id").notNull().unique().references(() => shows.id),
  dealType: text("deal_type", {
    enum: ["flat", "percentage_of_gross", "percentage_of_net", "vs", "door"],
  }).notNull(),
  guaranteeAmount: real("guarantee_amount"),
  percentage: real("percentage"),
  percentageBasis: text("percentage_basis", { enum: ["gross", "net"] }),
  expenseCap: real("expense_cap"),
  hospitalityCap: real("hospitality_cap"),
  bonusesJson: text("bonuses_json"),
  dealNotesFreetext: text("deal_notes_freetext"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const ticketSales = sqliteTable("ticket_sales", {
  id: text("id").primaryKey(),
  showId: text("show_id").notNull().references(() => shows.id),
  qty: integer("qty").notNull(),
  gross: real("gross").notNull(),
  fees: real("fees").notNull(),
  capturedAt: integer("captured_at", { mode: "timestamp" }).notNull(),
});

export const comps = sqliteTable("comps", {
  id: text("id").primaryKey(),
  showId: text("show_id").notNull().references(() => shows.id),
  category: text("category", {
    enum: ["artist_gl", "label", "press", "venue_staff", "sponsor", "promo", "other"],
  }).notNull(),
  count: integer("count").notNull(),
  faceValue: real("face_value").notNull(),
  countsTowardGross: integer("counts_toward_gross", { mode: "boolean" })
    .notNull().default(false),
  notes: text("notes"),
});

export const expenses = sqliteTable("expenses", {
  id: text("id").primaryKey(),
  showId: text("show_id").notNull().references(() => shows.id),
  category: text("category", {
    enum: ["production", "sound", "lights", "hospitality", "marketing", "backline", "security", "other"],
  }).notNull(),
  amount: real("amount").notNull(),
  description: text("description"),
  approved: integer("approved", { mode: "boolean" }).notNull().default(true),
  absorbedByVenue: integer("absorbed_by_venue", { mode: "boolean" })
    .notNull().default(false),
  enteredByUserId: text("entered_by_user_id").references(() => users.id),
  enteredAt: integer("entered_at", { mode: "timestamp" }).notNull(),
});

export const settlements = sqliteTable("settlements", {
  id: text("id").primaryKey(),
  showId: text("show_id").notNull().unique().references(() => shows.id),
  status: text("status", {
    enum: ["draft", "submitted", "in_review", "signed", "disputed", "revised", "finalized", "paid", "voided"],
  }).notNull().default("draft"),
  draftedAt: integer("drafted_at", { mode: "timestamp" }),
  submittedAt: integer("submitted_at", { mode: "timestamp" }),
  reviewStartedAt: integer("review_started_at", { mode: "timestamp" }),
  signedAt: integer("signed_at", { mode: "timestamp" }),
  disputedAt: integer("disputed_at", { mode: "timestamp" }),
  revisedAt: integer("revised_at", { mode: "timestamp" }),
  finalizedAt: integer("finalized_at", { mode: "timestamp" }),
  paidAt: integer("paid_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  completedByUserId: text("completed_by_user_id").references(() => users.id),
  grossBoxOffice: real("gross_box_office"),
  netBoxOffice: real("net_box_office"),
  totalExpenses: real("total_expenses"),
  totalToArtist: real("total_to_artist"),
  calculationJson: text("calculation_json"),
  recoupsJson: text("recoups_json"),
  signoffText: text("signoff_text"),
  notes: text("notes"),
  positiveSummary: text("positive_summary"),
  negativeSummary: text("negative_summary"),
});

export const switchSuggestions = sqliteTable("switch_suggestions", {
  id: text("id").primaryKey(),
  showId: text("show_id").notNull().unique().references(() => shows.id),
  dealId: text("deal_id").notNull().references(() => deals.id),
  suggestedAt: integer("suggested_at", { mode: "timestamp" }).notNull(),
  dealTypeFrom: text("deal_type_from", {
    enum: ["flat", "percentage_of_gross", "percentage_of_net", "vs", "door"],
  }).notNull(),
  shape: text("shape", { enum: ["flat", "door_hybrid"] }).notNull(),
  suggestedFlat: real("suggested_flat"),
  doorFloor: real("door_floor"),
  doorSplitPct: real("door_split_pct"),
  doorExpenseCap: real("door_expense_cap"),
  confidenceTier: text("confidence_tier", { enum: ["A", "B", "C", "D"] }).notNull(),
  bandLow: real("band_low"),
  bandHigh: real("band_high"),
  sampleSize: integer("sample_size").notNull(),
  // Artist familiarity — count of prior shows by THIS artist at THIS venue
  // before the suggested show's date. Tracked separately from
  // confidenceTier so the UI can render the two as distinct chips:
  // confidenceTier answers "how well does cell data back this number?" and
  // artistShowsAtVenue answers "how well do we know this artist's
  // settlement behavior?". Nullable for rows persisted before the column
  // was added.
  artistShowsAtVenue: integer("artist_shows_at_venue"),
  basis: text("basis").notNull(),
  status: text("status", { enum: ["suggested", "accepted", "declined"] })
    .notNull().default("suggested"),
  decidedAt: integer("decided_at", { mode: "timestamp" }),
  // Provenance of suggestedFlat / projection:
  //   sgp_engine               — Smart Guaranteed Price 7-step calc
  //   guarantee_amount         — DEPRECATED. Legacy rows that mirrored the
  //                              contract guarantee back as the suggested
  //                              flat for vs/pn $1–5K when SGP was low
  //                              confidence. Removed May 2026 because it
  //                              mixed agreement data into a module that's
  //                              meant to be pure history + projection.
  //                              New rows use `insufficient_confidence`.
  //   insufficient_confidence  — SGP returned tier C/D or couldn't compute.
  //                              No suggested flat is emitted; the UI shows
  //                              a "not enough data" message instead.
  //   cell_mean                — historical avg payout from comparable cell
  //   door_hybrid_calc         — door hybrid projection from cell stats
  //   door_dead_pool           — door deal where avail ≤ floor (artist gets floor)
  //   suppressed               — cell has too little data (e.g. door $15K+, n=1)
  source: text("source", {
    enum: [
      "sgp_engine",
      "guarantee_amount",
      "insufficient_confidence",
      "cell_mean",
      "door_hybrid_calc",
      "door_dead_pool",
      "suppressed",
    ],
  }),
  bandWidth: real("band_width"),
});

export const guaranteeSuggestions = sqliteTable("guarantee_suggestions", {
  id: text("id").primaryKey(),
  showId: text("show_id").notNull().unique().references(() => shows.id),
  dealId: text("deal_id").notNull().references(() => deals.id),
  generatedAt: integer("generated_at", { mode: "timestamp" }).notNull(),
  agentGuarantee: real("agent_guarantee"),
  suggestedPrice: real("suggested_price").notNull(),
  delta: real("delta").notNull(),
  expectedGross: real("expected_gross").notNull(),
  expectedGrossSource: text("expected_gross_source").notNull(),
  ticketingFees: real("ticketing_fees").notNull(),
  netAfterFees: real("net_after_fees").notNull(),
  expenseEstimate: real("expense_estimate").notNull(),
  expenseSource: text("expense_source").notNull(),
  expenseCap: real("expense_cap"),
  netBase: real("net_base").notNull(),
  percentagePayout: real("percentage_payout").notNull(),
  winner: text("winner", { enum: ["guarantee", "percentage", "tie"] }).notNull(),
  winnerMargin: real("winner_margin").notNull(),
  breakevenGross: real("breakeven_gross").notNull(),
  artistShowCount: integer("artist_show_count").notNull(),
  agentShowCount: integer("agent_show_count").notNull(),
  confidenceTier: text("confidence_tier", { enum: ["A", "B", "C", "D"] }).notNull(),
  insuranceTier: integer("insurance_tier").notNull(),
  basis: text("basis").notNull(),
  auditJson: text("audit_json").notNull(),
  // Persisted projected venue net under each deal structure so Reports /
  // Deal Analysis / Insights can read the same number the show-detail
  // panel renders, without re-deriving the math in every consumer. Stored
  // nullable so an `ALTER ADD COLUMN` against legacy rows is a no-op until
  // a regeneration runs (`generateAndPersistGuarantee` always writes both).
  projectedVenueNetSgp: real("projected_venue_net_sgp"),
  projectedVenueNetCurrent: real("projected_venue_net_current"),
});

export type User = typeof users.$inferSelect;
export type Venue = typeof venues.$inferSelect;
export type Agency = typeof agencies.$inferSelect;
export type Agent = typeof agents.$inferSelect;
export type Artist = typeof artists.$inferSelect;
export type Show = typeof shows.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type TicketSale = typeof ticketSales.$inferSelect;
export type Comp = typeof comps.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;

export type Recoup = {
  id: string;
  category: "marketing" | "hospitality_overage" | "production_overage" | "prior_advance" | "damages" | "other";
  label: string;
  amount: number;
  status: "agreed" | "disputed" | "withdrawn";
};
