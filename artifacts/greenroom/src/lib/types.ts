export type Status = "booked" | "advanced" | "day_of" | "settled" | "closed";

export type DealType = "flat" | "percentage_of_gross" | "percentage_of_net" | "vs" | "door";

export type SettlementStage =
  | "draft" | "submitted" | "in_review" | "signed" | "disputed"
  | "revised" | "finalized" | "paid" | "voided";

export interface Show {
  id: string;
  venueId: string;
  artistId: string;
  date: string;
  status: Status;
  doorsTime: string | null;
  setTime: string | null;
  openerArtistId: string | null;
  roomConfig: "standing" | "seated" | "mixed";
  internalNotes: string | null;
  createdAt: string;
}

export interface Artist {
  id: string;
  name: string;
  agentId: string | null;
  managerEmail: string | null;
  genre: string | null;
  priorShowCount: number;
}

export interface Agent {
  id: string;
  name: string;
  agencyId: string | null;
  email: string;
  phone: string | null;
  preferencesNotes: string | null;
}

export interface Agency {
  id: string;
  name: string;
}

export interface Venue {
  id: string;
  name: string;
  capacity: number;
  city: string;
  state: string;
}

export interface Deal {
  id: string;
  showId: string;
  dealType: DealType;
  guaranteeAmount: number | null;
  percentage: number | null;
  percentageBasis: "gross" | "net" | null;
  expenseCap: number | null;
  hospitalityCap: number | null;
  bonusesJson: string | null;
  dealNotesFreetext: string | null;
  createdAt: string;
}

export interface TicketSale {
  id: string;
  showId: string;
  qty: number;
  gross: number;
  fees: number;
  capturedAt: string;
}

export interface Comp {
  id: string;
  showId: string;
  category: "artist_gl" | "label" | "press" | "venue_staff" | "sponsor" | "promo" | "other";
  count: number;
  faceValue: number;
  countsTowardGross: boolean;
  notes: string | null;
}

export interface Expense {
  id: string;
  showId: string;
  category: "production" | "sound" | "lights" | "hospitality" | "marketing" | "backline" | "security" | "other";
  amount: number;
  description: string | null;
  approved: boolean;
  absorbedByVenue: boolean;
  enteredByUserId: string | null;
  enteredAt: string;
}

export interface Settlement {
  id: string;
  showId: string;
  status: SettlementStage;
  draftedAt: string | null;
  submittedAt: string | null;
  reviewStartedAt: string | null;
  signedAt: string | null;
  disputedAt: string | null;
  revisedAt: string | null;
  finalizedAt: string | null;
  paidAt: string | null;
  completedAt: string | null;
  completedByUserId: string | null;
  grossBoxOffice: number | null;
  netBoxOffice: number | null;
  totalExpenses: number | null;
  totalToArtist: number | null;
  calculationJson: string | null;
  recoupsJson: string | null;
  signoffText: string | null;
  notes: string | null;
}

export type Bonus =
  | { type: "gross_threshold"; label: string; threshold: number; amount: number; stacks?: boolean }
  | { type: "sellout"; label: string; amount: number }
  | { type: "attendance_threshold"; label: string; threshold: number; amount: number }
  | { type: "tier_ratchet"; label: string; tiers: { from: number; to: number | null; percentage: number }[] };

export type Recoup = {
  id: string;
  category: "marketing" | "hospitality_overage" | "production_overage" | "prior_advance" | "damages" | "other";
  label: string;
  amount: number;
  status: "agreed" | "disputed" | "withdrawn";
};

export type ShowTense = "past" | "upcoming";

export interface ShowListRow {
  show: Show;
  artist: Artist | null;
  agent: Agent | null;
  deal: Deal | null;
  settlement: Settlement | null;
  isUnsupportedDeal: boolean;
  isDisputed: boolean;
  tense: ShowTense;
  switchStatus: SwitchStatus | null;
  guaranteeSuggestion: { suggestedPrice: number; delta: number } | null;
  expenseCategories: string[];
  recoupCategories: string[];
  disputedRecoupCategories: string[];
}

export type SwitchStatus = "suggested" | "accepted" | "declined";
export type ConfidenceTier = "A" | "B" | "C" | "D";

export type SwitchSource =
  | "sgp_engine"
  | "guarantee_amount"
  | "cell_mean"
  | "door_hybrid_calc"
  | "door_dead_pool"
  | "suppressed";

export interface SwitchSuggestion {
  id: string;
  showId: string;
  dealId: string;
  suggestedAt: string;
  dealTypeFrom: DealType;
  shape: "flat" | "door_hybrid";
  suggestedFlat: number | null;
  doorFloor: number | null;
  doorSplitPct: number | null;
  doorExpenseCap: number | null;
  confidenceTier: ConfidenceTier;
  bandLow: number | null;
  bandHigh: number | null;
  sampleSize: number;
  basis: string;
  status: SwitchStatus;
  decidedAt: string | null;
  source: SwitchSource | null;
  bandWidth: number | null;
  // Audit acceptance: explicit boolean — true when this is a door-hybrid that
  // collapsed to a pure floor deal because projected available pool ≤ floor.
  // Derived server-side from `source === "door_dead_pool"`.
  isDeadPool: boolean;
  // Artist familiarity — count of prior shows by this artist at this venue
  // before the show date. Rendered as its own chip in the UI, separate
  // from confidenceTier. Nullable for legacy rows persisted before the
  // column existed.
  artistShowsAtVenue: number | null;
}

export interface GuaranteeSuggestion {
  id: string;
  showId: string;
  dealId: string;
  generatedAt: string;
  agentGuarantee: number | null;
  suggestedPrice: number;
  delta: number;
  expectedGross: number;
  expectedGrossSource: string;
  ticketingFees: number;
  netAfterFees: number;
  expenseEstimate: number;
  expenseSource: string;
  expenseCap: number | null;
  netBase: number;
  percentagePayout: number;
  winner: "guarantee" | "percentage" | "tie";
  winnerMargin: number;
  breakevenGross: number;
  artistShowCount: number;
  agentShowCount: number;
  confidenceTier: ConfidenceTier;
  insuranceTier: number;
  basis: string;
  auditJson: string;
}

export type ImprovementKind = "add_expense_cap" | "add_hospitality_cap";

export interface DealImprovement {
  kind: ImprovementKind;
  title: string;
  rationale: string;
  currentValue: string;
  proposedValue: string;
  proposedNumber: number | null;
  protects: "booker" | "artist" | "both";
  simplifies: boolean;
}

export interface DealImprovementsPayload {
  showId: string;
  dealId: string | null;
  improvements: DealImprovement[];
  context: {
    bucket: string;
    dealType: string;
    comparableSettlements: number;
    comparableDisputes: number;
    disputeRate: number;
    medianExpenses: number | null;
    medianHospitalityOverage: number | null;
  };
}

export interface ShowDetail {
  show: Show;
  artist: Artist | null;
  agent: Agent | null;
  agency: Agency | null;
  deal: Deal | null;
  settlement: Settlement | null;
  venue: Venue | null;
  ticketSales: TicketSale[];
  expenses: Expense[];
  comps: Comp[];
  recoups: Recoup[];
  switchSuggestion: SwitchSuggestion | null;
  guaranteeSuggestion: GuaranteeSuggestion | null;
  isUnsupportedDeal: boolean;
  isDisputed: boolean;
}

export type AttentionKind =
  | "notes_say_closed_but_status_open"
  | "show_settled_no_settlement"
  | "disputed_recoups_but_signed"
  | "stale_disputed";

export interface AttentionItem {
  kind: AttentionKind;
  showId: string;
  artistName: string | null;
  date: string;
  status: string;
  settlementStatus: string | null;
  detail: string;
  evidence?: string;
}

export type LlmProvider = "anthropic" | "openai";

export interface LlmProviderStatus {
  configured: boolean;
  source: "settings" | "env" | "none";
  model: string;
}

export interface LlmStatus {
  activeProvider: LlmProvider;
  activeModel: string;
  source: "settings" | "env" | "none";
  hasKey: boolean;
  providers: Record<LlmProvider, LlmProviderStatus>;
  models: Record<LlmProvider, string[]>;
}

export interface SaveLlmSettingsInput {
  provider?: LlmProvider;
  anthropicApiKey?: string | null;
  anthropicModel?: string;
  openaiApiKey?: string | null;
  openaiModel?: string;
}

export interface InsightsCell {
  dealType: string;
  bucket: string;
  count: number;
  attentionCount: number;
  topKind: AttentionKind | null;
  topKindCount: number;
  byKind: Record<AttentionKind, number>;
  bubbles: { theme: string; count: number }[];
  sampleSize: number;
  llmError: string | null;
}

export interface SwitchProjectedCell {
  dealType: "vs" | "percentage_of_net" | "door" | "flat" | "percentage_of_gross";
  bucket: string;
  switchApplies: boolean;
  count: number;
  actualLosingMoney: number;
  actualDisputed: number;
  actualAttention: number;
  actualLosingRate: number;
  actualDisputeRate: number;
  actualAttentionRate: number;
  projectedLosingMoney: number;
  projectedDisputed: number;
  projectedAttention: number;
  projectedLosingRate: number;
  projectedDisputeRate: number;
  projectedAttentionRate: number;
  actualPayoutSum: number;
  projectedPayoutSum: number;
  moneySavedToVenue: number;
}

export interface SwitchProjectedGridPayload {
  generatedAt: string;
  windowMonths: number;
  totalCandidates: number;
  totalDealsModelled: number;
  totalLosingMoneyAvoided: number;
  totalDisputesAvoided: number;
  totalAttentionAvoided: number;
  totalMoneySavedToVenue: number;
  dealTypes: SwitchProjectedCell["dealType"][];
  buckets: string[];
  cells: SwitchProjectedCell[];
}

export interface SwitchSavingsItem {
  showId: string;
  date: string;
  artistName: string | null;
  dealType: DealType;
  switchShape: "flat" | "door_hybrid";
  confidenceTier: ConfidenceTier;
  actualToArtist: number;
  counterfactualToArtist: number;
  moneySavedToVenue: number;
  estimatedMinutesSpent: number;
  estimatedMinutesUnderSwitch: number;
  minutesSaved: number;
  hadDispute: boolean;
  disputedRecoupCount: number;
  notesParagraphs: number;
  signoffParagraphs: number;
  totalRecoups: number;
  grossBoxOffice: number;
  totalExpenses: number;
  breakdown: {
    actual: {
      gross: number;
      expenses: number;
      recoupTotal: number;
      recoupLines: { label: string; amount: number; status: string }[];
      payout: number;
      settlementStatus: string;
    };
    counterfactual: {
      shape: "flat" | "door_hybrid";
      flat: number | null;
      doorFloor: number | null;
      doorSplitPct: number | null;
      doorExpenseCap: number | null;
      projectedPayout: number;
      basis: string;
    };
    timeSavedRationale: string;
    moneyRationale: string;
  };
}

export type GuaranteeBacktestDirection = "money_protected" | "money_overpaid" | "even";

export interface GuaranteeBacktestSteps {
  step1_expectedGross: { value: number; source: string; sampleSize: number };
  step2_ticketingFees: { rate: number; value: number };
  step3_netAfterFees: number;
  step4_expense: {
    raw: number;
    source: string;
    sampleSize: number;
    defaultCap: number;
    dealExpenseCap: number | null;
    effectiveCap: number;
    cappedValue: number;
  };
  step5_netBase: number;
  step6_percentagePayout: { pct: number; basis: number; value: number };
  step7_winner: {
    winner: "guarantee" | "percentage" | "tie";
    winnerValue: number;
    suggestedPrice: number;
    breakevenGross: number;
  };
}

export interface GuaranteeBacktestItem {
  showId: string;
  date: string;
  artistName: string | null;
  dealType: DealType;
  agentGuarantee: number;
  actualToArtist: number;
  grossBoxOffice: number;
  sgpSuggestedPrice: number;
  deltaSgpVsActual: number;
  deltaSgpVsAgent: number;
  absDeltaActual: number;
  direction: GuaranteeBacktestDirection;
  confidenceTier: ConfidenceTier;
  insuranceTier: number;
  basis: string;
  steps: GuaranteeBacktestSteps;
}

export interface GapCoverageBucket {
  threshold: number;
  count: number;
  rate: number;
}

export interface GapCoverage {
  totalScored: number;
  buckets: GapCoverageBucket[];
  medianAbsDelta: number;
  p75AbsDelta: number;
  p90AbsDelta: number;
}

export interface GuaranteeBacktestPayload {
  generatedAt: string;
  windowMonths: number;
  totalCandidates: number;
  totalScored: number;
  moneyProtected: number;
  moneyOverpaid: number;
  netDelta: number;
  items: GuaranteeBacktestItem[];
  gapCoverage: GapCoverage;
}

export interface VsPercentageFiredStats {
  vsDealsScanned: number;
  vsPercentageFired: number;
  vsPercentageNeverFired: number;
  vsPercentageNeverFiredRate: number;
  avgGuaranteeWin: number;
}

export interface SwitchSavingsPayload {
  generatedAt: string;
  windowMonths: number;
  totalCandidates: number;
  totalMoneySavedToVenue: number;
  totalMinutesSaved: number;
  items: SwitchSavingsItem[];
  vsPercentageFiredStats: VsPercentageFiredStats;
}

export type SgpFlatRepricingDirection =
  | "would_have_offered_less"
  | "would_have_offered_more"
  | "even";

export interface SgpFlatRepricingItem {
  showId: string;
  date: string;
  artistName: string | null;
  bucket: string;
  actualFlat: number;
  actualToArtist: number;
  grossBoxOffice: number;
  sgpFairFlat: number;
  deltaSgpVsActual: number;
  absDelta: number;
  direction: SgpFlatRepricingDirection;
  confidenceTier: ConfidenceTier;
  insuranceTier: number;
  simulatedSplitPct: number;
  basis: string;
  steps: GuaranteeBacktestSteps;
}

export interface SgpFlatRepricingPayload {
  generatedAt: string;
  windowMonths: number;
  simulatedSplitPct: number;
  bucket: string;
  totalCandidates: number;
  totalScored: number;
  moneyOverpaid: number;
  moneyUnderpriced: number;
  netDelta: number;
  items: SgpFlatRepricingItem[];
  gapCoverage: GapCoverage;
}

export interface InsightsPayload {
  generatedAt: string;
  enrichmentCoverage: { withSummary: number; total: number };
  dealTypes: string[];
  buckets: string[];
  cells: InsightsCell[];
}

export interface ArtistRow {
  artist: Artist;
  agent: Agent | null;
  agency: Agency | null;
  showCount: number;
  lastShowDate: string | null;
  topDealType: string | null;
  dealTypes: { dealType: string; count: number }[];
  topPositive: string | null;
  topNegative: string | null;
  attentionCount: number;
}

export interface ArtistProfileShow {
  show: Show;
  deal: Deal | null;
  settlement: Settlement | null;
  tense: "past" | "today" | "upcoming";
  isUnsupportedDeal: boolean;
  isDisputed: boolean;
  recoupCategories: string[];
  disputedRecoupCategories: string[];
}

export interface ArtistProfileSummary {
  date: string;
  showId: string;
  positive: string | null;
  negative: string | null;
}

export interface ArtistProfile {
  artist: Artist;
  agent: Agent | null;
  agency: Agency | null;
  shows: ArtistProfileShow[];
  summaries: ArtistProfileSummary[];
  attentionItems: AttentionItem[];
  stats: {
    totalShows: number;
    pastCount: number;
    upcomingCount: number;
    settledCount: number;
    disputedCount: number;
    totalPaidToArtist: number;
    totalGross: number;
    firstShowDate: string | null;
    lastShowDate: string | null;
    dealTypes: { dealType: string; count: number }[];
  };
}

export interface Reports {
  dealTypeCounts: Record<string, number>;
  totalDeals: number;
  inAppToolUsageRate: number;
  settlementStatus: Record<string, number>;
  totalSettlements: number;
  disputedRate: number;
  totalGross: number;
  totalToArtists: number;
  showCount: number;
  settledCount: number;
  dealsWithBonuses: number;
  totalRecoupValue: number;
  disputedRecoupValue: number;
  settlementsWithRecoups: number;
  totalCompTickets: number;
  totalCompFaceValue: number;
  compsByCategory: Record<string, number>;
}

export interface DealAnalysis {
  totalDeals: number;
  byComplexity: {
    bucket: "simple" | "medium" | "complex";
    count: number;
    pct: number;
    avgPayout: number;
    inToolCount: number;
    spreadsheetCount: number;
  }[];
  bySize: {
    bucket: string;
    count: number;
    pct: number;
    avgGross: number;
    avgToArtist: number;
    disputeRate: number;
    losingMoneyCount: number;
    profitN: number;
  }[];
  byProfitability: {
    profitable: { count: number; disputed: number; disputeRate: number };
    unprofitable: { count: number; disputed: number; disputeRate: number };
  };
  costs: {
    totalExpenses: number;
    expensesByCategory: Record<string, number>;
    totalRecoups: number;
    disputedRecoupValue: number;
    recoupsByCategory: Record<string, { amount: number; disputedAmount: number }>;
  };
  revenue: {
    byDealType: Record<
      string,
      { gross: number; netToVenue: number; toArtist: number; count: number }
    >;
    months: {
      month: string;
      label: string;
      gross: number;
      netToVenue: number;
      toArtist: number;
      byType: Record<string, number>;
    }[];
    crossTabBySizeAndType: {
      dealTypes: string[];
      buckets: string[];
      attentionKinds: AttentionKind[];
      cells: {
        dealType: string;
        bucket: string;
        count: number;
        settledN: number;
        profitN: number;
        losingMoneyCount: number;
        disputed: number;
        losingMoneyRate: number;
        disputeRate: number;
        attentionCount: number;
        attentionRate: number;
        attentionByKind: Record<AttentionKind, number>;
      }[];
    };
  };
  disputeBreakdown: {
    dealTypes: string[];
    buckets: string[];
    cells: {
      dealType: string;
      bucket: string;
      disputed: number;
      totalDisputedPayout: number;
      avgDisputedPayout: number;
      paidDisputedCount: number;
      disputedAmount: number;
      topTopics: { topic: string; count: number }[];
    }[];
  };
  repeatArtistDisputes: {
    dealTypes: string[];
    buckets: string[];
    artists: {
      artistId: string;
      artistName: string;
      totalShows: number;
      totalDisputes: number;
      dealTypeMix: { dealType: string; count: number }[];
      cells: {
        dealType: string;
        bucket: string;
        shows: number;
        disputed: number;
        disputedAmount: number;
        topTopic: string | null;
      }[];
    }[];
  };
}
