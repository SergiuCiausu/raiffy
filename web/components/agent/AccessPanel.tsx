"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeftRightIcon, CreditCardIcon, FileBadgeIcon, LandmarkIcon, PiggyBankIcon, WalletIcon, type LucideIcon } from "lucide-react";
import { accountsApi, type AccessSwitch } from "@/lib/agent-api";

/*
 * "What Raiffy can see" (chat.html's context panel). In the preview the account is a sample persona the customer
 * picks; nothing is a real account, and the panel says so. Everything starts off, and without a sample account the
 * switches stay off. Changes apply from the next question.
 */

/* The six switches Smart Mobile shows (lib/bank/schemas.ts SWITCHES), in its order */
const SWITCHES: { key: AccessSwitch; icon: LucideIcon; label: string; detail: string }[] = [
  { key: "account", icon: WalletIcon, label: "Accounts and overdraft", detail: "Balances, limits and interest" },
  { key: "transactions", icon: ArrowLeftRightIcon, label: "Transactions", detail: "What you paid and received" },
  { key: "savings", icon: PiggyBankIcon, label: "Savings and deposits", detail: "Balances, rates and maturity dates" },
  { key: "offers", icon: FileBadgeIcon, label: "Pre-approved offers", detail: "Offers the bank made you" },
  { key: "loans", icon: LandmarkIcon, label: "Loans", detail: "Balances, rates and repayment schedules" },
  { key: "cards", icon: CreditCardIcon, label: "Cards", detail: "Limits and fees; numbers stay masked" },
];

export function AccessPanel() {
  const access = useQuery(accountsApi.getAccess, {});
  const setAccess = useMutation(accountsApi.setAccess);
  const resetSample = useMutation(accountsApi.resetSample);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  if (!access) return null;

  const save = async (patch: Parameters<typeof setAccess>[0], message: string) => {
    setFailed(false);
    try { await setAccess(patch); setNote(message); }
    catch { setFailed(true); }
  };
  const persona = access.personas.find(p => p.id === access.persona);
  const assigned = access.personas.find(p => p.id === access.assigned);
  const reset = async () => {
    setFailed(false);
    try { await resetSample({}); setNote(assigned ? `Back to ${assigned.label}, with everything switched off.` : "Reset. Everything is switched off."); }
    catch { setFailed(true); }
  };

  return (
    <section className="ctx-sec access" aria-labelledby="access-title">
      <h3 id="access-title">What Raiffy can see</h3>
      <p>Raiffy only uses what’s switched on here. Changes apply to your next question.</p>
      <label className="access-pick">
        <span>Sample account <span className="pill">Preview</span></span>
        <select value={access.persona ?? ""} onChange={e => {
          const id = e.target.value || null;
          void save({ persona: id }, id ? "Sample account chosen. Switch on what Raiffy may read." : "No sample account. Raiffy won’t read any account data.");
        }}>
          <option value="">None</option>
          {access.personas.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <small>{persona ? persona.summary : "Real accounts aren’t connected in this preview. Pick a sample customer to try account questions."}
          {assigned && ` Your admin assigned ${assigned.label}.`}</small>
      </label>
      {(access.persona || access.assigned) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void reset()}>Reset sample data</button>}
      <ul className="perms">
        {SWITCHES.map(({ key, icon: Icon, label, detail }) => (
          <li className="perm" key={key}>
            <span className="ic" aria-hidden="true"><Icon /></span>
            <div><b id={`perm-${key}`}>{label}</b><small>{detail}</small></div>
            <button type="button" className="switch" role="switch" aria-checked={access[key]} aria-labelledby={`perm-${key}`}
              disabled={!access.persona}
              onClick={() => void save({ [key]: !access[key] }, access[key]
                ? `Raiffy will stop using your ${label.toLowerCase()} from your next question.`
                : `Raiffy can use your ${label.toLowerCase()} from your next question.`)} />
          </li>
        ))}
      </ul>
      {(note || failed) && <p className="perm-note" role="status">{failed ? "That didn’t save. Try again." : note}</p>}
    </section>
  );
}
