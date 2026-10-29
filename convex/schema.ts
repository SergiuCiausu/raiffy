import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { BANKS, type ScopeField, scopeFlagsSchema, SECTION_TYPES } from "../lib/rag/schemas";
import { memoryKind, memoryScopeFields } from "./memoryValidators";
import { roleSchema } from "../lib/auth/roles";
import { TERM_KINDS, TERM_UNITS } from "../lib/catalog/schemas";
import { PRODUCT_KINDS } from "../lib/catalog/products";
import { COMMISSION_KEYS } from "../lib/plan/schemas";
import { ABOUT_LABELS, AFTER, FEEDBACK_REASONS, SENTIMENT_LABELS } from "../lib/analytics/sentiment";
import { DATA_SOURCES, INTENTS } from "../lib/analytics/schemas";
import { HANDOFF_REASONS } from "../lib/agent/handoff";
import { ANSWER_CHECK_STATUSES } from "../lib/review/answerCheck";


/** Vector size of OpenAI text-embedding-3-small, the model the chunks and questions are embedded with. */
export const EMBEDDING_DIMENSIONS = 1536;

const track = v.union(v.literal("personal"), v.literal("business"));
export const role = v.union(...roleSchema.options.map((name) => v.literal(name)));
export const replyValidator = v.union(
  v.object({ kind: v.literal("choose"), inquiry: v.string() }),
  v.object({ kind: v.literal("inputs"), values: v.record(v.string(), v.union(v.string(), v.number(), v.array(v.string()))) }),
  v.object({ kind: v.literal("skip_inputs") }),
);

const sectionType = v.union(...SECTION_TYPES.map((type) => v.literal(type)));
const bank = v.union(...BANKS.map((name) => v.literal(name)));
/** One boolean per (track, public collection): see `scopeField` in lib/rag/schemas.ts. */
const SCOPE_FIELDS = Object.keys(scopeFlagsSchema.shape) as ScopeField[];
const scopeFlags = Object.fromEntries(SCOPE_FIELDS.map((field) => [field, v.boolean()])) as Record<ScopeField, ReturnType<typeof v.boolean>>;

/** Mirrors `termValueSchema` in lib/catalog/schemas.ts. */
const termValue = v.union(
  v.object({ type: v.literal("exact"), amount: v.number() }),
  v.object({ type: v.literal("range"), min: v.number(), max: v.number() }),
  v.object({ type: v.literal("from"), min: v.number() }),
  v.object({ type: v.literal("up_to"), max: v.number() }),
  v.object({ type: v.literal("text"), text: v.string() }),
  v.object({ type: v.literal("unavailable"), reason: v.string() }),
);
/** Mirrors `termSnapshotSchema` in lib/catalog/changes.ts: the part of a term a console change replaces. */
const termSnapshot = v.object({ value: termValue, quote: v.string(), url: v.string(), reviewBy: v.string() });

/** Mirrors `termRecordSchema` in lib/catalog/schemas.ts. */
export const termRecordFields = {
  termId: v.string(),
  productId: v.string(),
  product: v.string(),
  bank,
  track,
  kind: v.union(...TERM_KINDS.map((k) => v.literal(k))),
  label: v.string(),
  value: termValue,
  unit: v.union(...TERM_UNITS.map((u) => v.literal(u))),
  frequency: v.optional(v.union(v.literal("once"), v.literal("monthly"), v.literal("yearly"))),
  conditions: v.array(v.string()),
  comparability: v.object({
    category: v.string(),
    termMonths: v.optional(v.number()),
    currency: v.optional(v.union(v.literal("RON"), v.literal("EUR"))),
    insuranceIncluded: v.optional(v.boolean()),
    rateType: v.optional(v.union(v.literal("fixed"), v.literal("variable"), v.literal("campaign"), v.literal("promo"))),
  }),
  quote: v.string(),
  provenance: v.object({
    bank,
    url: v.string(),
    chunkId: v.optional(v.string()),
    collectedAt: v.string(),
    effectiveFrom: v.optional(v.string()),
    reviewBy: v.string(),
    status: v.union(v.literal("fresh"), v.literal("stale")),
  }),
  verification: v.object({ quoteFound: v.boolean(), reviewedBy: v.optional(v.string()), reviewedAt: v.optional(v.string()) }),
};

export default defineSchema({
  conversations: defineTable({ ...memoryScopeFields, createdAt: v.number(), expiresAt: v.number() })
    .index("by_scope", ["ownerKey", "track", "organizationKey"])
    .index("by_expiry", ["expiresAt"]),
  messages: defineTable({
    ...memoryScopeFields, conversationId: v.id("conversations"), role: v.literal("customer"),
    maskedText: v.string(), memoryEligible: v.boolean(), createdAt: v.number(), expiresAt: v.number(),
  }).index("by_conversation", ["conversationId"]).index("by_expiry", ["expiresAt"]),
  memoryProposals: defineTable({
    ...memoryScopeFields, status: v.union(v.literal("pending"), v.literal("confirmed")),
    operation: v.union(v.literal("remember"), v.literal("update")), kind: memoryKind, text: v.string(),
    customerQuote: v.string(), sourceMessageId: v.id("messages"), replacesMemoryId: v.optional(v.id("userMemories")),
    replacesUpdatedAt: v.optional(v.number()), memoryId: v.optional(v.id("userMemories")),
    createdAt: v.number(), expiresAt: v.number(), confirmedAt: v.optional(v.number()),
  }).index("by_scope_status", ["ownerKey", "track", "organizationKey", "status"])
    .index("by_source", ["sourceMessageId"]).index("by_memory", ["memoryId"]).index("by_replacement", ["replacesMemoryId"])
    .index("by_expiry", ["expiresAt"]),
  userMemories: defineTable({
    ...memoryScopeFields, kind: memoryKind, text: v.string(), sourceMessageId: v.id("messages"),
    consentEventId: v.id("memoryProposals"), status: v.literal("active"),
    statedAt: v.number(), updatedAt: v.number(), expiresAt: v.number(),
  }).index("by_scope_status", ["ownerKey", "track", "organizationKey", "status"])
    .index("by_expiry", ["expiresAt"]),
  ragChunks: defineTable({
    chunkId: v.string(),
    bank,
    text: v.string(),
    searchText: v.string(),
    /** Filled by `embeddings:embedPending` after import; chunks without it are not in the vector index yet. */
    embedding: v.optional(v.array(v.float64())),
    embeddingModel: v.optional(v.string()),
    embedded: v.boolean(),
    ...scopeFlags,
    sourceType: v.union(v.literal("product_page"), v.literal("pdf")),
    sectionType,
    url: v.string(),
    scrapedAt: v.string(),
    pageType: v.optional(v.string()),
    segment: v.optional(v.string()),
    product: v.optional(v.string()),
    productId: v.optional(v.string()),
    category: v.optional(v.string()),
    heading: v.optional(v.string()),
    docType: v.optional(v.string()),
    title: v.optional(v.string()),
    pageStart: v.optional(v.number()),
    pageEnd: v.optional(v.number()),
    linkedProducts: v.optional(v.array(v.string())),
    currencies: v.optional(v.array(v.string())),
  })
    .index("by_chunkId", ["chunkId"])
    .index("by_embedded", ["embedded"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: EMBEDDING_DIMENSIONS,
      filterFields: SCOPE_FIELDS,
    })
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: SCOPE_FIELDS,
    }),

  /** The structured catalog: exact rates, fees and limits with their quote and source. Built by `pnpm catalog:build-import`. */
  productTerms: defineTable(termRecordFields)
    .index("by_termId", ["termId"])
    .index("by_track_product", ["track", "productId"]),

  /** The product list, one row per product page: names, kinds, links. Mirrors `productRecordSchema` in lib/catalog/products.ts. Built by `pnpm catalog:build-products`. */
  products: defineTable({
    productId: v.string(),
    bank,
    product: v.string(),
    kind: v.union(...PRODUCT_KINDS.map((k) => v.literal(k))),
    category: v.optional(v.string()),
    segment: v.optional(v.string()),
    url: v.string(),
    collectedAt: v.string(),
    summary: v.string(),
    guide: v.boolean(),
    ...scopeFlags,
  }).index("by_productId", ["productId"]).index("by_bank_kind", ["bank", "kind"]).index("by_url", ["url"]),

  /** Which catalog record fills which part of a product's plan. Mirrors `planTemplateSchema` in lib/plan/build.ts. Admins set it. */
  planTemplates: defineTable({
    track,
    productId: v.string(),
    rateTermId: v.string(),
    /** The product publishes a rate range and the bank sets each customer's rate within it (lib/plan/build.ts). */
    rateRange: v.optional(v.boolean()),
    commissions: v.array(v.object({
      key: v.union(...COMMISSION_KEYS.map((key) => v.literal(key))),
      termId: v.optional(v.string()),
      use: v.union(v.literal("upfront"), v.literal("monthly"), v.literal("if_used")),
    })),
    amountLimitTermId: v.optional(v.string()),
    termLimitTermId: v.optional(v.string()),
    debtShareCeilingTermId: v.optional(v.string()),
    updatedBy: v.string(),
    updatedAt: v.number(),
  }).index("by_track_product", ["track", "productId"]),

  /**
   * Plan summaries, one row per version: a change is a new version, never an edit in place. Scoped like the thread
   * they came from. `plan` is validated by `planSummarySchema` (lib/plan/schemas.ts) on every write and read.
   */
  planSummaries: defineTable({
    planId: v.string(),
    version: v.number(),
    threadId: v.id("ragThreads"),
    track,
    ownerKey: v.string(),
    organizationKey: v.union(v.null(), v.string()),
    plan: v.any(),
    createdAt: v.number(),
    /** The answer whose simulation the customer turned into this version ("Build my plan"), when it came from one. */
    messageId: v.optional(v.id("ragMessages")),
  }).index("by_thread_version", ["threadId", "version"]).index("by_plan_version", ["planId", "version"]).index("by_owner", ["ownerKey", "createdAt"]),

  /**
   * Chat sentiment for the Console (lib/analytics/sentiment.ts): Jev's labels for each customer message and the thumbs
   * on answers. Labels and pseudonymous keys only, never message text; they expire with the messages they came from.
   */
  sentimentEvents: defineTable({
    at: v.string(),
    conversationKey: v.string(),
    customerKey: v.string(),
    track,
    entry: v.union(v.literal("web"), v.literal("smartMobile")),
    inquiry: v.string(),
    sentiment: v.union(...SENTIMENT_LABELS.map((x) => v.literal(x))),
    about: v.union(...ABOUT_LABELS.map((x) => v.literal(x))),
    confidence: v.number(),
    after: v.union(...AFTER.map((x) => v.literal(x))),
    expiresAt: v.number(),
  }).index("by_at", ["at"]).index("by_expires", ["expiresAt"]),
  answerFeedback: defineTable({
    at: v.string(),
    conversationKey: v.string(),
    customerKey: v.string(),
    track,
    entry: v.union(v.literal("web"), v.literal("smartMobile")),
    answerKey: v.string(),
    vote: v.union(v.literal("up"), v.literal("down")),
    reason: v.optional(v.union(...FEEDBACK_REASONS.map((x) => v.literal(x)))),
    expiresAt: v.number(),
  }).index("by_at", ["at"]).index("by_expires", ["expiresAt"]),
  /**
   * One row per delivered answer, for the Console's Analytics page (lib/analytics AnswerTrace). Pseudonymous keys,
   * the intent, which kinds of account data the tools read and how the answer went; never message text or figures.
   */
  answerTraces: defineTable({
    at: v.string(),
    conversationKey: v.string(),
    customerKey: v.string(),
    track,
    entry: v.union(v.literal("web"), v.literal("smartMobile")),
    intent: v.union(...INTENTS.map((x) => v.literal(x))),
    dataUsed: v.array(v.union(...DATA_SOURCES.map((x) => v.literal(x)))),
    evaluatorLoops: v.number(),
    fallback: v.boolean(),
    escalated: v.boolean(),
    staleBlocked: v.boolean(),
    expiresAt: v.number(),
  }).index("by_at", ["at"]).index("by_expires", ["expiresAt"]),

  /** A bookable operator's hours (lib/booking/schemas.ts Availability, validated on write). Slots are computed from it. */
  operatorAvailability: defineTable({
    operatorId: v.string(),
    name: v.string(),
    title: v.string(),
    active: v.boolean(),
    availability: v.any(),
    updatedBy: v.string(),
    updatedAt: v.number(),
  }).index("by_operator", ["operatorId"]).index("by_active", ["active"]),

  /** A call with an operator, booked by the customer from the chat. Start is wall-clock time in `timeZone`. */
  bookings: defineTable({
    bookingId: v.string(),
    operatorId: v.string(),
    operatorName: v.string(),
    operatorTitle: v.string(),
    ownerKey: v.string(),
    /** Pseudonymous reference and first name with initial: all the operator's calendar shows of the customer. */
    customerRef: v.string(),
    customerName: v.string(),
    threadId: v.optional(v.id("ragThreads")),
    start: v.string(),
    minutes: v.number(),
    timeZone: v.string(),
    channel: v.union(v.literal("video"), v.literal("phone")),
    topic: v.string(),
    planId: v.optional(v.string()),
    sharePlan: v.boolean(),
    status: v.union(v.literal("booked"), v.literal("done"), v.literal("no_show"), v.literal("cancelled")),
    bookedAt: v.number(),
    confirmedAt: v.union(v.null(), v.number()),
    outcomeAt: v.union(v.null(), v.number()),
    cancelledBy: v.optional(v.union(v.literal("customer"), v.literal("operator"), v.literal("not_confirmed"))),
    cancelReason: v.optional(v.string()),
    cancelledAt: v.optional(v.number()),
    /** Demo: a public Jitsi room, shown only inside the join window. */
    meetingUrl: v.optional(v.string()),
    source: v.literal("chat"),
    /** The e-mails about this booking and what became of each (convex/bookingEmails.ts). At most one per kind and recipient. */
    emails: v.optional(v.array(v.object({
      kind: v.literal("booked"),
      to: v.union(v.literal("customer"), v.literal("operator")),
      outcome: v.union(v.literal("sent"), v.literal("test"), v.literal("skipped")),
      reason: v.optional(v.string()),
      emailId: v.optional(v.string()),
      at: v.number(),
    }))),
  }).index("by_booking_id", ["bookingId"]).index("by_operator_start", ["operatorId", "start"])
    .index("by_owner", ["ownerKey"]).index("by_status_start", ["status", "start"]),

  /** Each time a customer tries to book, refused or not, for the attempt limit (lib/booking/rules.ts attemptAllowed). Pruned as it's read. */
  bookingAttempts: defineTable({
    ownerKey: v.string(),
    at: v.number(),
  }).index("by_owner_at", ["ownerKey", "at"]),

  bookingEvents: defineTable({
    bookingId: v.string(),
    kind: v.union(v.literal("booked"), v.literal("confirmed"), v.literal("cancelled"), v.literal("released"), v.literal("done"), v.literal("no_show")),
    actor: v.union(v.literal("customer"), v.literal("operator"), v.literal("system")),
    at: v.number(),
  }).index("by_booking", ["bookingId", "at"]),

  /** A conversation is bound to one track for its whole life, so personal and business data never mix. */
  ragThreads: defineTable({
    track,
    title: v.string(),
    /** Optional only for legacy schema migration; authorization rejects unowned records. */
    ownerKey: v.optional(v.string()),
    organizationKey: v.optional(v.union(v.null(), v.string())),
    /** Routing state: pattern, the customer's stated inputs and any pending question. Validated by `conversationStateSchema`. */
    agentState: v.optional(v.any()),
  }).index("by_owner_scope", ["ownerKey", "track", "organizationKey"]),

  ragMessages: defineTable({
    threadId: v.id("ragThreads"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    /** The validated RagAnswer (sources, checks, searches) for assistant messages. */
    answer: v.optional(v.any()),
    status: v.optional(v.union(v.literal("streaming"), v.literal("done"), v.literal("stopped"), v.literal("failed"))),
    requestMessageId: v.optional(v.id("ragMessages")),
    startedAt: v.optional(v.number()),
    steps: v.optional(v.array(v.object({ query: v.string(), focus: v.string(), results: v.optional(v.number()) }))),
    error: v.optional(v.string()),
    /** A tapped choice, a submitted inputs form or "skip" on a user message. Checked against what Raiffy offered. */
    reply: v.optional(replyValidator),
    /** The paperclip: the chosen sample customer's statement, never a real file (convex/accounts.ts). */
    attachment: v.optional(v.literal("sample_statement")),
  }).index("by_thread", ["threadId"]),
  /** Answer cards a customer pinned to the Context panel (lib/agent/chat-pins.ts). Owner-scoped like their threads. */
  chatPins: defineTable({
    ownerKey: v.string(),
    track,
    organizationKey: v.union(v.null(), v.string()),
    threadId: v.id("ragThreads"),
    messageId: v.id("ragMessages"),
    kind: v.string(),
    title: v.string(),
    meta: v.string(),
    createdAt: v.number(),
  }).index("by_owner_scope", ["ownerKey", "track", "organizationKey", "createdAt"]).index("by_message", ["messageId"]),
  /**
   * "What Raiffy can see": which sample persona stands in for the customer's account in the POC, and the switches.
   * Everything starts off. Real account connections replace the persona later; the switches stay.
   */
  accountAccess: defineTable({
    ownerKey: v.string(),
    persona: v.union(v.string(), v.null()),
    account: v.boolean(),
    savings: v.boolean(),
    /** Card details (limits, fees). Rows without `transactions` predate the six switches: there `cards` meant card spending. */
    cards: v.boolean(),
    transactions: v.optional(v.boolean()),
    offers: v.optional(v.boolean()),
    loans: v.optional(v.boolean()),
    /** The sample customer an admin assigned this tester (audited); "Reset sample data" returns to it. */
    assignedPersona: v.optional(v.union(v.string(), v.null())),
    assignedBy: v.optional(v.string()),
    assignedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerKey"]),

  /**
   * Negotiation (docs/shared/pricing.md): every outcome, including "not needed", for the win-rate KPI. `internal` holds
   * band details for reviewers and reporting only; it never reaches the model or the customer. Sample pricing in the POC.
   */
  counterOfferLogs: defineTable({
    ownerKey: v.string(),
    threadId: v.optional(v.id("ragThreads")),
    productId: v.string(),
    segment: v.string(),
    amount: v.number(),
    months: v.number(),
    competitor: v.object({ id: v.string(), bank: v.string(), source: v.string(), totalPayable: v.number() }),
    ourListTotal: v.number(),
    ourTotal: v.number(),
    resolution: v.union(v.literal("not_needed"), v.literal("band"), v.literal("escalate"), v.literal("evidence_needed"), v.literal("affordability")),
    offer: v.optional(v.object({ levers: v.array(v.string()), rateBps: v.number(), upfrontFee: v.number(), monthlyFee: v.number(), totalPayable: v.number(),
      validUntil: v.string(), approvedBy: v.optional(v.string()), level: v.optional(v.string()) })),
    internal: v.object({ bandId: v.union(v.string(), v.null()), level: v.union(v.string(), v.null()), neededCutBps: v.union(v.number(), v.null()) }),
    review: v.optional(v.union(v.literal("requested"), v.literal("approved"), v.literal("declined"))),
    outcome: v.union(v.literal("pending"), v.literal("accepted"), v.literal("declined"), v.literal("expired")),
    reasonLost: v.optional(v.union(v.literal("price"), v.literal("conditions"), v.literal("speed"), v.literal("other"))),
    createdAt: v.number(),
    closedAt: v.optional(v.number()),
  }).index("by_owner", ["ownerKey", "createdAt"]).index("by_created", ["createdAt"]),

  /** Escalated negotiations waiting for a person, at the lowest level that can approve the gap. */
  reviewCases: defineTable({
    logId: v.id("counterOfferLogs"),
    ownerKey: v.string(),
    productId: v.string(),
    level: v.string(),
    status: v.union(v.literal("open"), v.literal("approved"), v.literal("declined")),
    decidedBy: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
    note: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_status", ["status", "createdAt"]).index("by_log", ["logId"]),

  /** Prices a specialist approved for one customer; they override list pricing until they expire. */
  personalOffers: defineTable({
    ownerKey: v.string(),
    caseId: v.id("reviewCases"),
    productId: v.string(),
    rateBps: v.number(),
    upfrontFee: v.number(),
    monthlyFee: v.number(),
    amount: v.number(),
    months: v.number(),
    issuedBy: v.object({ name: v.string(), role: v.string() }),
    validUntil: v.string(),
    createdAt: v.number(),
  }).index("by_owner", ["ownerKey", "productId"]),

  agentRateLimits: defineTable({ ownerKey: v.string(), windowStart: v.number(), requests: v.number() })
    .index("by_owner", ["ownerKey"]),

  /** Mirror of Clerk users, upserted on first authenticated use. For listing and audit only: authorization reads the JWT. */
  users: defineTable({
    clerkUserId: v.string(),
    tokenIdentifier: v.string(),
    role,
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
  }).index("by_clerk_user", ["clerkUserId"]).index("by_token", ["tokenIdentifier"]).index("by_role", ["role"]),

  /** Append-only record of privileged actions: role changes now, approvals and publishes as the console arrives. */
  auditLog: defineTable({
    actorUserId: v.string(),
    actorRole: role,
    action: v.string(),
    targetUserId: v.optional(v.string()),
    details: v.optional(v.record(v.string(), v.string())),
    note: v.optional(v.string()),
    at: v.number(),
  }).index("by_at", ["at"]).index("by_target", ["targetUserId", "at"]),
  /** Adviser requests the customer sent from an answer, with the screened messages they agreed to share. */
  handoffRequests: defineTable({
    ownerKey: v.string(),
    track,
    organizationKey: v.union(v.null(), v.string()),
    threadId: v.id("ragThreads"),
    messageId: v.id("ragMessages"),
    reason: v.union(...HANDOFF_REASONS.map((reason) => v.literal(reason))),
    reference: v.string(),
    summary: v.array(v.string()),
    status: v.literal("requested"),
    createdAt: v.number(),
  }).index("by_message", ["messageId"]).index("by_owner", ["ownerKey", "createdAt"]),
  /**
   * Answers the customer flagged for a specialist (lib/review/answerCheck.ts). `snapshot` is what the specialist sees,
   * masked and taken when the customer sent it, so later changes to the chat don't change the case.
   */
  /**
   * A customer asks a specialist to check one version of their plan (convex/planChecks.ts). The decision is also
   * written into that version's `plan.verification`, which the chat card shows and the next version carries over.
   */
  planChecks: defineTable({
    reference: v.string(),
    planId: v.string(),
    version: v.number(),
    threadId: v.id("ragThreads"),
    ownerKey: v.string(),
    track,
    organizationKey: v.union(v.null(), v.string()),
    /** corrected: confirmed with a note for the customer; the figures are never edited. */
    status: v.union(v.literal("open"), v.literal("confirmed"), v.literal("corrected"), v.literal("returned")),
    /** The customer's note for the specialist, screened. */
    note: v.union(v.null(), v.string()),
    createdAt: v.number(),
    decidedBy: v.optional(v.object({ name: v.string(), role: v.string() })),
    decidedAt: v.optional(v.number()),
    /** Shown to the customer: the specialist's note on a confirmation, or why it was sent back. */
    customerNote: v.optional(v.string()),
    /** Why a correction was needed, for the team (a future eval case). Never shown to the customer. */
    reason: v.optional(v.string()),
    /** What happened to each e-mail (convex/planCheckEmails.ts): sent, sent to Resend's test inbox, or skipped and why. Never the address. */
    emails: v.optional(v.array(v.object({
      kind: v.union(v.literal("received"), v.literal("decided")),
      outcome: v.union(v.literal("sent"), v.literal("test"), v.literal("skipped")),
      reason: v.optional(v.string()),
      emailId: v.optional(v.string()),
      at: v.number(),
    }))),
  }).index("by_plan", ["planId", "version"]).index("by_status", ["status", "createdAt"]).index("by_created", ["createdAt"])
    .index("by_owner", ["ownerKey", "createdAt"]),

  answerChecks: defineTable({
    ownerKey: v.string(),
    track,
    organizationKey: v.union(v.null(), v.string()),
    threadId: v.id("ragThreads"),
    messageId: v.id("ragMessages"),
    reference: v.string(),
    snapshot: v.object({
      questions: v.array(v.string()),
      paragraphs: v.array(v.string()),
      sources: v.array(v.object({ title: v.string(), url: v.string(), collectedOn: v.string() })),
      inquiry: v.union(v.null(), v.string()),
      handler: v.union(v.null(), v.string()),
      ungroundedNumbers: v.number(),
      note: v.union(v.null(), v.string()),
    }),
    status: v.union(...ANSWER_CHECK_STATUSES.map((s) => v.literal(s))),
    /** The specialist as the customer sees them; the audit log holds the Clerk user. */
    decidedBy: v.optional(v.object({ name: v.string(), role: v.string() })),
    decidedAt: v.optional(v.number()),
    /** Shown to the customer: the correction or the reason it was sent back. */
    customerNote: v.optional(v.string()),
    /** True on every check since e-mails began (they aren't optional). Absent on older checks: those get no e-mail. */
    emailOptIn: v.optional(v.boolean()),
    /** What happened to each e-mail: sent, sent to Resend's test inbox, or skipped and why. Never the address. */
    emails: v.optional(v.array(v.object({
      kind: v.union(v.literal("received"), v.literal("decided")),
      outcome: v.union(v.literal("sent"), v.literal("test"), v.literal("skipped")),
      reason: v.optional(v.string()),
      emailId: v.optional(v.string()),
      at: v.number(),
    }))),
    createdAt: v.number(),
  }).index("by_message", ["messageId"]).index("by_thread", ["threadId"]).index("by_status", ["status", "createdAt"])
    .index("by_owner", ["ownerKey", "createdAt"]).index("by_created", ["createdAt"]),
  /** Regulatory parameters for indicative checks, each with its source; imported from catalog/regulatory-limits.jsonl. */
  /**
   * Console changes to catalog values (convex/catalogChanges.ts, raiffy-spec/docs/shared/console.md → Change lifecycle).
   * `before` is the term as it was when the change was proposed, so a rollback can restore it.
   */
  catalogChanges: defineTable({
    changeId: v.string(),
    termId: v.string(), productId: v.string(), product: v.string(), label: v.string(), unit: v.string(), track,
    kind: v.union(v.literal("edit"), v.literal("confirm"), v.literal("rollback")),
    before: termSnapshot, after: termSnapshot,
    note: v.string(),
    status: v.union(v.literal("pending"), v.literal("published"), v.literal("rejected"), v.literal("rolledBack")),
    proposedBy: v.string(), proposedByRole: role, proposedAt: v.number(),
    decidedBy: v.optional(v.string()), decidedAt: v.optional(v.number()), decisionNote: v.optional(v.string()),
    rollbackOf: v.optional(v.string()),
  })
    .index("by_changeId", ["changeId"])
    .index("by_status", ["status", "proposedAt"])
    .index("by_term", ["termId", "proposedAt"])
    .index("by_product", ["productId", "proposedAt"]),

  regulatoryLimits: defineTable({
    key: v.string(),
    value: v.number(),
    sourceLabel: v.string(),
    sourceUrl: v.string(),
    validFrom: v.string(),
    status: v.union(v.literal("pending_review"), v.literal("approved")),
  }).index("by_key", ["key"]),
});
