import {
  DATA_SOURCES,
  analyticsFilterSchema,
  type AnalyticsFilter,
  type AnalyticsSummary,
  type AnswerTrace,
  type OutcomeEvent,
} from "./schemas";

/**
 * Aggregates answer traces and outcome events into the console's Analytics page.
 * Pure: records in, numbers out. Any count below `filter.minCount` comes back as null, and so does
 * any rate or average built on a suppressed denominator.
 */

type Base = Pick<AnswerTrace, "at" | "track" | "entry">;
type Of<K extends OutcomeEvent["kind"]> = Extract<OutcomeEvent, { kind: K }>;

const day = (iso: string) => iso.slice(0, 10);

function inFilter(r: Base, f: AnalyticsFilter): boolean {
  const d = day(r.at);
  return d >= f.from && d <= f.to && (!f.track || r.track === f.track) && (!f.entry || r.entry === f.entry);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Inclusive list of ISO dates from `from` to `to`. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

function groupCount<T>(items: T[], key: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return m;
}

export function summarize(answers: AnswerTrace[], events: OutcomeEvent[], filterInput: AnalyticsFilter): AnalyticsSummary {
  const f = analyticsFilterSchema.parse(filterInput);
  const k = f.minCount;
  const n = (x: number) => (x < k ? null : x);
  const share = (part: number, whole: number) => (whole < k ? null : whole === 0 ? null : part / whole);

  const A = answers.filter((a) => inFilter(a, f));
  const E = events.filter((e) => inFilter(e, f));
  const of = <K extends OutcomeEvent["kind"]>(kind: K) => E.filter((e): e is Of<K> => e.kind === kind);

  const conversations = new Set(A.map((a) => a.conversationKey));
  const withData = A.filter((a) => a.dataUsed.length > 0).length;

  // Daily volume is a time series, so it is suppressed per day rather than per filter.
  const byDay = new Map<string, { answers: number; conversations: Set<string> }>();
  for (const a of A) {
    const d = byDay.get(day(a.at)) ?? { answers: 0, conversations: new Set<string>() };
    d.answers++;
    d.conversations.add(a.conversationKey);
    byDay.set(day(a.at), d);
  }
  const daily = datesBetween(f.from, f.to).map((date) => {
    const d = byDay.get(date);
    const answers = d?.answers ?? 0;
    const convs = d?.conversations.size ?? 0;
    return { date, answers: answers < k ? 0 : answers, conversations: convs < k ? 0 : convs };
  });

  const intent = groupCount(A, (a) => a.intent);
  const checks = of("affordabilityCheck");
  const reminders = of("reminder");
  const reminderFunnel = (which: Of<"reminder">["reminder"]) => {
    const r = reminders.filter((x) => x.reminder === which);
    return {
      sent: n(r.filter((x) => x.stage === "sent").length),
      opened: n(r.filter((x) => x.stage === "opened").length),
      acted: n(r.filter((x) => x.stage === "acted").length),
    };
  };

  const offers = of("offer");
  const offerStage = (s: Of<"offer">["stage"]) => offers.filter((o) => o.stage === s);
  const shown = offerStage("shown");
  const applied = offerStage("applied");
  const offerProducts = [...new Set(offers.map((o) => o.productId))].sort();

  const fees = of("feeExplained");
  const feeTop = [...groupCount(fees, (x) => x.feeLine + "\u0000" + x.productId)]
    .map(([key, c]) => {
      const [feeLine, productId] = key.split("\u0000") as [string, string];
      return { feeLine, productId, count: n(c) };
    })
    .filter((x) => x.count !== null)
    .sort((a, b) => b.count! - a.count!)
    .slice(0, 5);

  const elig = of("eligibilityLimit");
  const apps = of("application");
  const digital = apps.filter((x) => x.channel === "digital").length;
  const branch = apps.filter((x) => x.channel === "branch");
  const contracts = of("contract");
  const contractCount = (s: Of<"contract">["status"]) => n(contracts.filter((c) => c.status === s).length);

  const saved = of("moneySaved");
  const savedByCustomer = new Map<string, number>();
  for (const s of saved) savedByCustomer.set(s.customerKey, (savedByCustomer.get(s.customerKey) ?? 0) + s.lei);
  const savedCustomers = savedByCustomer.size;
  const savedTotal = saved.reduce((t, s) => t + s.lei, 0);
  const savedOk = savedCustomers >= k;

  return {
    kpis: {
      conversations: n(conversations.size),
      answers: n(A.length),
      accountDataShare: share(withData, A.length),
      offerTakeUp: share(applied.length, shown.length),
      digitalShare: share(digital, apps.length),
      moneySavedLei: savedOk ? savedTotal : null,
    },
    daily,
    dataUsage: DATA_SOURCES.map((source) => {
      const c = A.filter((a) => a.dataUsed.includes(source)).length;
      return { source, answers: n(c), share: c < k ? null : share(c, A.length) };
    }),
    affordability: {
      checks: n(checks.length),
      withoutAsking: n(checks.filter((c) => !c.askedCustomer).length),
      limitsChanged: n(checks.filter((c) => c.limitsChangedResult).length),
      refinancing: n(intent.get("refinancing") ?? 0),
      earlyRepayment: n(intent.get("earlyRepayment") ?? 0),
      cashNeed: n(intent.get("cashNeed") ?? 0),
      fixedRateReminder: reminderFunnel("fixedRateEnding"),
    },
    pricing: {
      qualifyShown: n(of("qualifyShown").length),
      hiddenCostCaught: n(of("hiddenCostCaught").length),
      feeExplanations: n(fees.length),
    },
    offers: {
      funnel: { shown: n(shown.length), opened: n(offerStage("opened").length), applied: n(applied.length) },
      expired: n(offerStage("expired").length),
      avgRateGapPts: shown.length < k ? null : shown.reduce((t, o) => t + o.rateGapPts, 0) / shown.length,
      bankSourcedShare: share(offers.filter((o) => o.source === "bank").length, offers.length),
      byProduct: offerProducts.map((productId) => ({
        productId,
        shown: n(shown.filter((o) => o.productId === productId).length),
        applied: n(applied.filter((o) => o.productId === productId).length),
      })),
    },
    savings: {
      goalsCreated: n(of("depositGoal").filter((g) => g.stage === "created").length),
      progressShown: n(of("depositGoal").filter((g) => g.stage === "progressShown").length),
      maturityReminder: reminderFunnel("depositMaturity"),
    },
    fees: {
      questions: n(fees.length),
      resolvedShare: share(fees.filter((x) => x.resolved).length, fees.length),
      top: feeTop,
    },
    eligibility: {
      maxAgeAtEnd: n(elig.filter((e) => e.reason === "maxAgeAtEnd").length),
      residency: n(elig.filter((e) => e.reason === "residency").length),
      byProduct: [...groupCount(elig, (e) => e.productId)]
        .map(([productId, c]) => ({ productId, count: n(c) }))
        .filter((x) => x.count !== null)
        .sort((a, b) => b.count! - a.count!),
    },
    channel: {
      digital: n(digital),
      branch: n(branch.length),
      branchReasons: (["idNotVerified", "documents", "customerChoice"] as const).map((reason) => ({
        reason,
        count: n(branch.filter((b) => b.branchReason === reason).length),
      })),
    },
    contracts: {
      funnel: { applied: contractCount("applied"), signed: contractCount("signed"), withdrawn: contractCount("withdrawn"), repaid: contractCount("repaid") },
      raiffeisenOnlyDefaults: n(of("raiffeisenOnlyDefault").length),
      moneySaved: {
        totalLei: savedOk ? savedTotal : null,
        medianLei: savedOk ? median([...savedByCustomer.values()]) : null,
        customers: n(savedCustomers),
      },
    },
    quality: {
      firstPassShare: share(A.filter((a) => a.evaluatorLoops === 0).length, A.length),
      fallbacks: n(A.filter((a) => a.fallback).length),
      escalations: n(A.filter((a) => a.escalated).length),
      staleBlocks: n(A.filter((a) => a.staleBlocked).length),
    },
  };
}
