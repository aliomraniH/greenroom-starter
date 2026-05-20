import { db } from "../src/db";
import {
  artists, shows, deals, settlements, switchSuggestions,
  guaranteeSuggestions, venues,
} from "../src/db/schema";
import { eq, like, inArray } from "drizzle-orm";
import { generateAndPersist } from "../src/lib/smartSwitch";

const NEW_DEMO_TAG = "[NEW DEMO]";

type Spec = {
  artist: string;
  genre: string;
  daysOut: number;
  dealType: "vs" | "percentage_of_net" | "door" | "percentage_of_gross";
  guarantee: number | null;
  percentage: number | null;
  basis: "gross" | "net" | null;
  expectedGross: number;
  expenseCap: number | null;
  hospitalityCap: number | null;
  settleStatus: "draft" | "submitted" | "in_review";
};

const SPECS: Spec[] = [
  // vs $1-5K (Smart Switch eligible) — 3 shows.
  // Atlas Court + Bramble Hollow are the two tier-A "SGP beats current"
  // demos: their deal-expense caps are intentionally loose ($2,500) vs the
  // engine's tighter cell-P75 estimate (~$1,500), so the side-by-side
  // projected-venue-net tiles on show-detail show ~$600–$700 of structural
  // upside from switching to a flat. Bramble's priorShows is bumped to 3
  // in `seedSgpRangeDemo.ts` to lift it from Tier B to Tier A.
  { artist: "Atlas Court",        genre: "Indie Rock",  daysOut: 22, dealType: "vs", guarantee: 2000, percentage: 0.80, basis: "net", expectedGross: 5000, expenseCap: 800,  hospitalityCap: null, settleStatus: "draft" },
  { artist: "Bramble Hollow",     genre: "Folk",        daysOut: 31, dealType: "vs", guarantee: 2000, percentage: 0.90, basis: "net", expectedGross: 4700, expenseCap: 1000, hospitalityCap: 400,  settleStatus: "submitted" },
  { artist: "Cinder Path",        genre: "Garage Rock", daysOut: 45, dealType: "vs", guarantee: 4500, percentage: 0.85, basis: "net", expectedGross: 4800, expenseCap: null, hospitalityCap: null, settleStatus: "in_review" },
  // vs $5-15K (Improve Deal — caps only) — 2 shows
  { artist: "Driftline",          genre: "Indie Rock",  daysOut: 18, dealType: "vs", guarantee: 7000,  percentage: 0.80, basis: "net", expectedGross: 9500,  expenseCap: null, hospitalityCap: null, settleStatus: "draft" },
  { artist: "Echo Bramble",       genre: "Americana",   daysOut: 56, dealType: "vs", guarantee: 12000, percentage: 0.85, basis: "net", expectedGross: 14000, expenseCap: 1750, hospitalityCap: null, settleStatus: "submitted" },
  // vs $15K+ — 1 show
  { artist: "Foxglove Society",   genre: "Indie Rock",  daysOut: 71, dealType: "vs", guarantee: 18000, percentage: 0.85, basis: "net", expectedGross: 19500, expenseCap: null, hospitalityCap: null, settleStatus: "in_review" },
  // pn $1-5K (Smart Switch eligible) — 2 shows
  { artist: "Gilded Fern",        genre: "Folk",        daysOut: 27, dealType: "percentage_of_net", guarantee: 2500, percentage: 0.75, basis: "net", expectedGross: 3300, expenseCap: 1850, hospitalityCap: null, settleStatus: "draft" },
  { artist: "Hollow Bay",         genre: "Indie Pop",   daysOut: 38, dealType: "percentage_of_net", guarantee: 4000, percentage: 0.80, basis: "net", expectedGross: 4600, expenseCap: null, hospitalityCap: 400,  settleStatus: "submitted" },
  // pn uncapped (Improve Deal) — 2 shows
  { artist: "Iron Lattice",       genre: "Indie Rock",  daysOut: 14, dealType: "percentage_of_net", guarantee: null, percentage: 0.70, basis: "net", expectedGross: 6800, expenseCap: null, hospitalityCap: null, settleStatus: "in_review" },
  { artist: "Juniper Cove",       genre: "Americana",   daysOut: 49, dealType: "percentage_of_net", guarantee: null, percentage: 0.80, basis: "net", expectedGross: 8200, expenseCap: 1750, hospitalityCap: null, settleStatus: "draft" },
  // door (Smart Switch — door hybrid) — 3 shows across buckets
  { artist: "Kestrel Lane",       genre: "Garage Rock", daysOut: 12, dealType: "door", guarantee: null, percentage: null, basis: null, expectedGross: 800,  expenseCap: 1700, hospitalityCap: null, settleStatus: "submitted" },
  { artist: "Lantern Mile",       genre: "Punk",        daysOut: 33, dealType: "door", guarantee: null, percentage: null, basis: null, expectedGross: 3000, expenseCap: 1850, hospitalityCap: 400,  settleStatus: "in_review" },
  { artist: "Mast & Marrow",      genre: "Indie Rock",  daysOut: 60, dealType: "door", guarantee: null, percentage: null, basis: null, expectedGross: 9000, expenseCap: 1750, hospitalityCap: null, settleStatus: "draft" },
  // %gross uncapped (Improve Deal) — 2 shows
  { artist: "Nightingale Press",  genre: "Indie Pop",   daysOut: 25, dealType: "percentage_of_gross", guarantee: null, percentage: 0.85, basis: "gross", expectedGross: 5500, expenseCap: null, hospitalityCap: null, settleStatus: "submitted" },
  { artist: "Oakshade Theory",    genre: "Folk",        daysOut: 42, dealType: "percentage_of_gross", guarantee: null, percentage: 0.90, basis: "gross", expectedGross: 7200, expenseCap: 1750, hospitalityCap: 400,  settleStatus: "in_review" },
];

function dateString(daysOut: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toISOString().slice(0, 10);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

async function main() {
  const venue = await db.select().from(venues).limit(1);
  if (venue.length === 0) throw new Error("No venue found");
  const venueId = venue[0].id;

  // ---- Idempotent cleanup: remove anything previously seeded with this tag ----
  const oldArtists = await db.select({ id: artists.id }).from(artists).where(like(artists.name, `${NEW_DEMO_TAG}%`));
  if (oldArtists.length > 0) {
    const aIds = oldArtists.map((a) => a.id);
    const oldShows = await db.select({ id: shows.id }).from(shows).where(inArray(shows.artistId, aIds));
    const sIds = oldShows.map((s) => s.id);
    if (sIds.length > 0) {
      await db.delete(switchSuggestions).where(inArray(switchSuggestions.showId, sIds));
      // Must also wipe guarantee_suggestions: it FKs to deals.id, so the
      // deals delete below would FK-violate on any show that already had
      // an SGP suggestion persisted (same drift root cause that bit us in
      // seedSgpRangeDemo before we added the both-tables sweep).
      await db.delete(guaranteeSuggestions).where(inArray(guaranteeSuggestions.showId, sIds));
      await db.delete(settlements).where(inArray(settlements.showId, sIds));
      await db.delete(deals).where(inArray(deals.showId, sIds));
      await db.delete(shows).where(inArray(shows.id, sIds));
    }
    await db.delete(artists).where(inArray(artists.id, aIds));
    console.log(`Cleared ${oldArtists.length} prior NEW DEMO artists, ${sIds.length} shows.`);
  }

  // ---- Insert artists (one per spec — keeps each show's roster clean) ----
  const artistIds = new Map<string, string>();
  for (const spec of SPECS) {
    if (artistIds.has(spec.artist)) continue;
    const id = `artist_newdemo_${slug(spec.artist)}`;
    await db.insert(artists).values({
      id,
      name: `${NEW_DEMO_TAG} ${spec.artist}`,
      agentId: null,
      managerEmail: null,
      genre: spec.genre,
      priorShowCount: 0,
    });
    artistIds.set(spec.artist, id);
  }

  // ---- Insert shows + deals + settlements ----
  const now = new Date();
  let created = 0;
  for (const spec of SPECS) {
    const artistId = artistIds.get(spec.artist)!;
    const showId = `show_newdemo_${slug(spec.artist)}`;
    const dealId = `deal_newdemo_${slug(spec.artist)}`;
    const settlementId = `settlement_newdemo_${slug(spec.artist)}`;
    const date = dateString(spec.daysOut);

    await db.insert(shows).values({
      id: showId,
      venueId,
      artistId,
      date,
      status: "booked",
      doorsTime: "19:30",
      setTime: "21:00",
      openerArtistId: null,
      roomConfig: "standing",
      // Spec.expectedGross is the *agent's* projection from the proposal
      // packet, not the engine's. Label it explicitly so it doesn't read as
      // a competing source of truth against the SGP-computed expected gross
      // (which comes from artist history / agent history / cell stats).
      internalNotes: `${NEW_DEMO_TAG} Pre-show proposal in ${spec.settleStatus.replace("_", " ")} stage. Agent's projected gross $${spec.expectedGross.toLocaleString()}.`,
      createdAt: now,
    });

    await db.insert(deals).values({
      id: dealId,
      showId,
      dealType: spec.dealType,
      guaranteeAmount: spec.guarantee,
      percentage: spec.percentage,
      percentageBasis: spec.basis,
      expenseCap: spec.expenseCap,
      hospitalityCap: spec.hospitalityCap,
      bonusesJson: null,
      dealNotesFreetext: null,
      createdAt: now,
    });

    await db.insert(settlements).values({
      id: settlementId,
      showId,
      status: spec.settleStatus,
      draftedAt: now,
      submittedAt: spec.settleStatus !== "draft" ? now : null,
      reviewStartedAt: spec.settleStatus === "in_review" ? now : null,
      grossBoxOffice: null,
      netBoxOffice: null,
      totalExpenses: null,
      totalToArtist: null,
      calculationJson: null,
      recoupsJson: null,
      signoffText: null,
      notes: `${NEW_DEMO_TAG} Pre-show settlement placeholder for the proposal stage.`,
    });

    created++;
  }

  console.log(`Seeded ${created} NEW DEMO shows.`);

  // ---- Pre-generate Smart Switch suggestions ----
  let suggested = 0;
  for (const spec of SPECS) {
    const showId = `show_newdemo_${slug(spec.artist)}`;
    try {
      const out = await generateAndPersist(showId, { force: true });
      if (out.suggestion) {
        suggested++;
        console.log(`  ✓ ${spec.artist}: ${out.suggestion.shape} via ${out.suggestion.source ?? "?"} (tier ${out.suggestion.confidenceTier})`);
      } else {
        console.log(`  · ${spec.artist}: no Smart Switch suggestion (${out.reason}) — Improve Deal will surface inline`);
      }
    } catch (e) {
      console.log(`  ✗ ${spec.artist}: ${(e as Error).message}`);
    }
  }
  console.log(`Generated ${suggested} Smart Switch suggestions.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
