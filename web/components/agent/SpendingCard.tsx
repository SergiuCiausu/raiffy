"use client";

import type { ReactNode } from "react";
import { BanknoteIcon, ChartBarIcon, EuroIcon, PiggyBankIcon, RepeatIcon, WalletIcon, type LucideIcon } from "lucide-react";
import { lei } from "@/lib/format";
import type { AccessSwitch, SpendingBlock, UiBlock } from "@/lib/agent-api";
import { CardHead, Lead } from "./AnswerCards";

/*
 * The spending card (chat.html's spendingHTML): built by code from the account summary the answer cited, never by the
 * model. In the preview the account is a sample persona, and the card says so in its head and its note. Amounts
 * arrive in bani.
 */

export const isSpending = (b: UiBlock): b is SpendingBlock => b.type === "spending";

const CATEGORY: Record<string, string> = {
  groceries: "Groceries", housing: "Housing", utilities: "Utilities", transport: "Transport", dining: "Eating out", shopping: "Shopping",
  health: "Health", entertainment: "Entertainment", subscriptions: "Subscriptions", travel: "Travel", cash: "Cash withdrawals", fees: "Fees",
  debt: "Loan payments", savings: "Savings",
};
export const categoryLabel = (c: string) => CATEGORY[c] ?? c;

const b = (bani = 0) => lei(bani / 100);
const INSIGHT: Record<SpendingBlock["insights"][number]["kind"], (f: Record<string, number>) => [LucideIcon, string]> = {
  overdraftCost: f => [WalletIcon, `The overdraft cost ${b(f.interestLastMonth)} in interest, with ${b(f.used)} of ${b(f.limit)} in use.`],
  atmFees: f => [BanknoteIcon, `${f.count} withdrawals at other banks’ ATMs cost ${b(f.fees)} in fees.`],
  fxCardFees: f => [EuroIcon, `Paying in euros cost about ${b(f.fees)} in conversion, on ${b(f.spentInEuros)}.`],
  idleCash: f => [PiggyBankIcon, `About ${b(f.idle)} sits above your usual monthly spending.`],
  subscriptions: f => [RepeatIcon, `${f.count} card subscriptions, ${b(f.monthly)} a month. ${f.changed} started or changed price.`],
};
const NOT_USED: Record<AccessSwitch, string> = { account: "accounts", transactions: "transactions", savings: "savings and deposits", offers: "pre-approved offers", loans: "loans", cards: "cards" };

function change(x: SpendingBlock["categories"][number], months: number) {
  const before = months === 1 ? "the month before" : `the ${months} months before`;
  if (x.previous === x.amount) return `Same as ${before}`;
  if (!x.previous) return months === 1 ? "New this month" : "New in this period";
  return `${x.amount > x.previous ? "Up" : "Down"} from ${b(x.previous)}`;
}

export function SpendingCard({ block, cite }: { block: SpendingBlock; cite?: (url: string) => ReactNode }) {
  const from = new Date(`${block.period.from}T00:00:00Z`);
  const to = new Date(`${block.period.to}T00:00:00Z`);
  const month = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const period = block.period.months === 1 ? month(from) : `${month(from)} to ${month(to)}`;
  const top = block.categories[0]?.amount || 1;
  return (
    <div className="gcard spending-card">
      <CardHead icon={ChartBarIcon} title={`Where your money went · ${period}`} sub={block.period.months > 1 ? "Monthly averages" : undefined} meta="Sample data" />
      <div className="gc-b ac-b">
        {block.total !== undefined && (
          <Lead label="Card and regular spending" note={block.income !== undefined ? `Money in: ${b(block.income)}${block.period.months > 1 ? " a month" : ""}` : undefined}>
            {b(block.total)}{cite?.(block.sourceUrl)}
          </Lead>
        )}
        {block.categories.length > 0 && (
          <div className="stmt">
            {block.categories.map(x => (
              <div className="line" key={x.category}>
                <span>{categoryLabel(x.category)}<span className="dsc">{change(x, block.period.months)}</span>
                  <span className="share" aria-hidden="true"><i style={{ width: `${Math.round((x.amount / top) * 100)}%` }} /></span></span>
                <span className="amt">{b(x.amount)}</span>
              </div>
            ))}
          </div>
        )}
        {block.insights.length > 0 && (
          <div className="why">
            {block.insights.map(i => { const [Icon, text] = INSIGHT[i.kind](i.figures); return <div className="why-row tip" key={i.kind}><Icon aria-hidden="true" /><span>{text}</span></div>; })}
          </div>
        )}
        <p className="spend-note">
          From a sample account in this preview, not your own.
          {block.notUsed.length > 0 && ` Not used: ${block.notUsed.map(k => NOT_USED[k]).join(", ")} (switched off).`}
        </p>
      </div>
    </div>
  );
}
