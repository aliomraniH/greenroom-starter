/**
 * Idempotent: gives the 5 vs/pn $1–5K NEW DEMO shows a clean range of Smart
 * Switch confidence outcomes so the demo shows the full engine ladder, not
 * just the "guarantee_amount" fallback path.
 *
 * Smart Switch is *intentionally* A/B-only: per the Apr-2026 audit, only
 * tier A and B SGP reads are deemed data-safe enough to surface a "switch
 * to flat" recommendation. SGP tier C/D suggestions fall through to the
 * `guarantee_amount` fallback (or to "no suggestion") so the booker sees
 * the conservative read, not a confident-looking switch.
 *
 *   atlas_court    → Tier A         (Jordan Wells + 3 prior settled vs shows,
 *                                    each settled with a POSITIVE venue net
 *                                    — the backing history must demonstrate
 *                                    that the cell actually pays profitably
 *                                    at the recommended $2K guarantee, or
 *                                    the "Tier A high confidence" claim is
 *                                    self-defeating.)
 *   bramble_hollow → Tier B (agent) (Jordan Wells, no prior artist shows)
 *   cinder_path    → Tier B (artist)(no agent, 1 prior settled vs show
 *                                    with positive venue net)
 *   gilded_fern    → Tier D / "no switch" (no agent, no priors — SGP
 *                                    returns C via genre but Smart Switch
 *                                    falls through to guarantee_amount;
 *                                    proves the engine refuses to switch
 *                                    on thin samples)
 *   hollow_bay     → Tier D         (no agent, rare/unseen genre — full
 *                                    "don't switch" demo)
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx scripts/seedSgpRangeDemo.ts
 */
import { db } from "../src/db";
import { artists, shows, deals, settlements, switchSuggestions, guaranteeSuggestions } from "../src/db/schema";
import { eq, like, and, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { generateAndPersist } from "../src/lib/smartSwitch";
import { clearGuaranteeCache, generateAndPersistGuarantee } from "../src/lib/smartGuarantee";

const VENUE_ID = "venue_crescent";
const ESTABLISHED_AGENT = "agent_jordan_wells";
const RARE_GENRE = "Experimental Drone";

const HISTORY_TAG = "[SGP-DEMO-HIST]";

type Plan = {
  artistId: string;
  showId: string;
  setAgent: string | null;
  setGenre?: string;
  priorShows: number;
  priorDealLike: "vs" | "pn";
};

const PLANS: Plan[] = [
  // Tier A: artistShowCount >= 3 (and we keep Jordan Wells linked so the SGP
  // "agent_history" expense/gross sources also light up — gives the densest
  // possible audit blob for the demo).
  { artistId: "artist_newdemo_atlas_court",    showId: "show_newdemo_atlas_court",
    setAgent: ESTABLISHED_AGENT, priorShows: 3, priorDealLike: "vs" },

  // Second Tier A demo (added May 2026): bumped from 0 → 3 prior shows so
  // the "SGP beats current venue net" story has two high-confidence
  // exemplars instead of just one. Agent + 3 artist shows clears both the
  // artistShowCount ≥ 3 and winnerMargin > 200 thresholds in
  // computeConfidenceTier.
  { artistId: "artist_newdemo_bramble_hollow", showId: "show_newdemo_bramble_hollow",
    setAgent: ESTABLISHED_AGENT, priorShows: 3, priorDealLike: "vs" },

  // Tier B via artist: 1 prior settled show for the artist, no agent.
  { artistId: "artist_newdemo_cinder_path",    showId: "show_newdemo_cinder_path",
    setAgent: null,              priorShows: 1, priorDealLike: "vs" },

  // Tier C via genre: Folk has plenty of corpus history. No agent, no
  // prior artist shows — confidence tier falls to C, but SGP still has a
  // genre-anchored projection to surface (different copy from D).
  { artistId: "artist_newdemo_gilded_fern",    showId: "show_newdemo_gilded_fern",
    setAgent: null,              priorShows: 0, priorDealLike: "pn" },

  // Tier D: rare genre + no agent + no artist history. The "thin sample"
  // case Smart Switch is meant to refuse, kept for contrast.
  { artistId: "artist_newdemo_hollow_bay",     showId: "show_newdemo_hollow_bay",
    setAgent: null, setGenre: RARE_GENRE, priorShows: 0, priorDealLike: "pn" },
];

function isoDaysAgo(d: number): string {
  const t = new Date();
  t.setDate(t.getDate() - d);
  return t.toISOString().slice(0, 10);
}

async function clearOldHistory(): Promise<void> {
  // Drop any history shows we previously seeded with this tag so the script
  // is fully re-runnable.
  const old = await db.select({ id: shows.id }).from(shows)
    .where(like(shows.internalNotes, `${HISTORY_TAG}%`));
  if (old.length === 0) return;
  const ids = old.map((s) => s.id);
  await db.delete(switchSuggestions).where(inArray(switchSuggestions.showId, ids));
  await db.delete(guaranteeSuggestions).where(inArray(guaranteeSuggestions.showId, ids));
  await db.delete(settlements).where(inArray(settlements.showId, ids));
  await db.delete(deals).where(inArray(deals.showId, ids));
  await db.delete(shows).where(inArray(shows.id, ids));
  console.log(`  cleared ${ids.length} prior history rows`);
}

async function createHistoryShow(opts: {
  artistId: string;
  daysAgo: number;
  index: number;
  dealLike: "vs" | "pn";
}): Promise<void> {
  const date = isoDaysAgo(opts.daysAgo);
  const showId = `show_sgphist_${opts.artistId.replace("artist_newdemo_", "")}_${opts.index}`;
  const now = new Date();

  // vs $1–5K shape: $2,000 guarantee + 80% net, capped expenses.
  // pn $1–5K shape: $2,000 guarantee + 75% net.
  //
  // Guarantee + grossBoxOffice tuned so venue nets POSITIVELY on every
  // synthetic prior show. Earlier values (gross $3.2–3.7K with a $2.5K
  // guarantee on $1.7K expenses) forced venue net to −$500…−$1,000, which
  // made the Tier-A demo backing look like "high-confidence loses money."
  // Range here: gross $4.4K–$5.0K, $2K guarantee, expenses $1.7K
  // → venue net $700–$1,300 per show. Matches Atlas Court's $2,000 SGP
  // suggestion so the historical claim and the suggested flat are coherent.
  const guarantee = 2000;
  const percentage = opts.dealLike === "vs" ? 0.80 : 0.75;
  const dealType = opts.dealLike === "vs" ? "vs" as const : "percentage_of_net" as const;
  const grossBoxOffice = 4400 + opts.index * 300;   // ~4.4–5.0K
  const totalExpenses = 1700;
  const netBoxOffice = grossBoxOffice - totalExpenses;
  // settled payout: max(guarantee, percentage * net)
  const pctPayout = Math.round(percentage * netBoxOffice);
  const totalToArtist = Math.max(guarantee, pctPayout);

  await db.insert(shows).values({
    id: showId,
    venueId: VENUE_ID,
    artistId: opts.artistId,
    date,
    status: "settled",
    doorsTime: "19:30",
    setTime: "21:00",
    roomConfig: "standing",
    internalNotes: `${HISTORY_TAG} Synthetic prior show for SGP range demo`,
    createdAt: now,
  });

  const dealId = `deal_sgphist_${opts.artistId.replace("artist_newdemo_", "")}_${opts.index}`;
  await db.insert(deals).values({
    id: dealId,
    showId,
    dealType,
    guaranteeAmount: guarantee,
    percentage,
    percentageBasis: "net",
    expenseCap: 1850,
    hospitalityCap: null,
    bonusesJson: null,
    dealNotesFreetext: null,
    createdAt: now,
  });

  const signedAt = new Date(date + "T23:00:00Z");
  await db.insert(settlements).values({
    id: `set_sgphist_${opts.artistId.replace("artist_newdemo_", "")}_${opts.index}`,
    showId,
    status: "signed",
    draftedAt: signedAt,
    submittedAt: signedAt,
    signedAt,
    completedAt: signedAt,
    grossBoxOffice,
    netBoxOffice,
    totalExpenses,
    totalToArtist,
    calculationJson: null,
    recoupsJson: "[]",
    signoffText: "Signed off, paid in full.",
    notes: null,
  });
}

async function main() {
  console.log("Seeding SGP range demo...");
  await clearOldHistory();

  for (const p of PLANS) {
    // 1) Update artist's agent + genre + cached priorShowCount so the UI
    //    (artist profile, show detail) stays in sync with the synthetic
    //    history we're about to insert. SGP itself reads from the `shows`
    //    table, but this column is what the frontend reads.
    const update: Record<string, unknown> = {
      agentId: p.setAgent,
      priorShowCount: p.priorShows,
    };
    if (p.setGenre) update.genre = p.setGenre;
    await db.update(artists).set(update).where(eq(artists.id, p.artistId));

    // 2) Create N prior settled shows for the artist (well in the past so
    //    they don't pollute the upcoming list).
    for (let i = 0; i < p.priorShows; i++) {
      await createHistoryShow({
        artistId: p.artistId,
        daysAgo: 120 + i * 90,        // ~4, 7, 10 months ago
        index: i + 1,
        dealLike: p.priorDealLike,
      });
    }

    // 3) Invalidate BOTH persisted suggestions for this show so they
    //    regenerate against the new context. The Smart Switch row and the
    //    Smart Guaranteed Price row come from the same engine
    //    (`generateGuarantee`) but are written into two tables — wiping
    //    only one of them is what caused the "two different projections
    //    on the same deal" drift the team flagged in May-2026.
    await db.delete(switchSuggestions).where(eq(switchSuggestions.showId, p.showId));
    await db.delete(guaranteeSuggestions).where(eq(guaranteeSuggestions.showId, p.showId));

    console.log(
      `  ${p.artistId.padEnd(38)} agent=${p.setAgent ?? "—".padEnd(20)}` +
      ` priorShows=${p.priorShows} genre=${p.setGenre ?? "(unchanged)"}`,
    );
  }

  // 4) Bust the in-memory SGP context cache so generateAndPersist sees the
  //    new artist→agent links and synthetic past settlements.
  clearGuaranteeCache();

  // 5) Re-generate BOTH suggestions for each demo show. The SGP row is
  //    regenerated first so that Smart Switch — which reads from the SGP
  //    engine internally at tier A/B — has the freshest cached engine
  //    output to anchor on. Without this both-tables refresh the persisted
  //    SGP row stays stuck on whatever was computed at boot before any
  //    demo history existed.
  console.log("\nRegenerating Smart Guaranteed Price + Smart Switch:");
  for (const p of PLANS) {
    const sgp = await generateAndPersistGuarantee(p.showId);
    const { suggestion, reason } = await generateAndPersist(p.showId, { force: true });
    if (!suggestion) {
      console.log(`  ${p.showId.padEnd(34)} switch=(no suggestion: ${reason})  sgp=${sgp.suggestion?.confidenceTier ?? "—"}`);
      continue;
    }
    const flat = suggestion.suggestedFlat != null
      ? `$${suggestion.suggestedFlat.toLocaleString()}`
      : "(door hybrid)";
    const sgpFlat = sgp.suggestion?.suggestedPrice != null
      ? `$${sgp.suggestion.suggestedPrice.toLocaleString()}`
      : "—";
    console.log(
      `  ${p.showId.padEnd(34)} switch tier=${suggestion.confidenceTier}` +
      ` source=${suggestion.source.padEnd(18)} flat=${flat}` +
      `  ·  sgp tier=${sgp.suggestion?.confidenceTier ?? "—"} flat=${sgpFlat}` +
      `  n=${suggestion.sampleSize}`,
    );
  }
  console.log("\nDone.");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
