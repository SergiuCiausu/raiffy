# Shared: Shared chats

A chat can be shared by link so several people can work through a decision together, for example a couple planning a mortgage or a family helping a parent refinance. Every message shows who wrote it, and prompts from different people are answered in parallel, one agent per prompt.

Applies to both tracks. Business chats follow the same rules, and company data stays scoped by business roles (`docs/business/hard-limits.md`).

## Members and limits

| Role | Can do | Counts toward the limit |
| --- | --- | --- |
| **Owner** | Everything: share, approve joins, set the data scope, remove people, delete the chat | Yes |
| **Member** | Read and prompt | Yes |
| **Viewer** | Read only, no prompts | No |

- **At most 5 prompting accounts per chat** (owner plus up to 4 members). Viewers don't count toward the 5. Their number is capped by a dated parameter in the console (`sharedChat.maxViewers`), not by this rule.
- Everyone must sign in (Clerk). A link never gives anonymous access.

## Sharing and joining

1. The owner opens **Share** in the chat header and chooses the **data scope** (below). A link is created: a random token with an expiry (default 7 days), which the owner can revoke at any time.
2. Someone opens the link and signs in. They see the chat's title and the owner's name only, and **request to join**.
3. **The owner approves each request**, as a member or a viewer, or declines it. Requests show in the chat header and as a notification. Nobody sees the conversation before approval.
4. When 5 prompting accounts are already in, the owner can still approve viewers. Approving another member shows "This chat already has 5 people who can ask questions".
5. The owner can change anyone's role, remove anyone, or revoke the link. Removing someone ends their access to the whole chat, past messages included.

## Data scope (chosen by the owner when sharing)

The share dialog has one choice, with plain wording and no default pre-ticked beyond the safer option:

| Option | Control | What it means |
| --- | --- | --- |
| **Each person's own data** (default) | Checkbox off: "Let members' questions use my account data" | Every answer uses **only the asker's own data**, under the asker's own "What Raiffy can see" switches. A member's prompt never reads the owner's account. |
| **Members can use my data** | Checkbox on | Members' prompts may also use the **owner's** data, within the owner's switches. Members' own data is still used only for their own prompts. |

Either way:

- The dialog states that everyone approved into the chat, viewers included, **will see the answers**, including any figures from account data. Sharing is the account holder's explicit consent to that.
- Every answer that uses personal data says whose: "Based on Ana's pre-approved offer".
- Each person's switches show separately in the context panel. The scope and every change to it are logged, and a change applies to new prompts only.
- CNP, IBAN and card numbers stay masked for everyone, as everywhere else (`docs/individuals/hard-limits.md`).
- This extends the hard limit "user-scoped data access" to shared chats: data is scoped to the asker, or to the owner when the owner has opted in, and never beyond that.

## Who wrote what

- Every message shows its author: name and an initials avatar. Avatars use ink and neutral tints, never per-person colors (`DESIGN.md` allows one accent only).
- Each Raiffy answer is linked to the prompt it answers and says so: "Answering Ana".
- A presence bar in the header shows who's in the chat, their role, and who's typing.
- Reactive Convex queries keep every participant's view in sync.

## Concurrent prompts: one agent per prompt

- **Every prompt starts its own pipeline run** (`docs/shared/pipeline.md`) as a separate Convex action, straight away. Prompts from different people run in parallel.
- **Snapshot:** each run reads the conversation state as it was when its prompt was sent, and writes its answer as a new message. Runs never overwrite each other's messages.
- **Shared state** (the current quote, slider values, goals) is versioned per key. A run updates a key only if it hasn't changed since its snapshot. If it has, the answer says so instead of mixing values: "Ana changed the amount to 10,000 lei while I was working, so these figures use 8,000 lei. Want them for 10,000?"
- **Ordering:**
  - One person's prompts run in order: their second waits for their first.
  - If the router finds a prompt depends on someone else's answer that's still running ("and over 24 months?"), it waits for that answer.
  - Otherwise, no waiting.
- **Limits:** at most one active run per prompting account, so at most 5 per chat, plus rate limits per account and per chat to control LLM cost. A prompt over the limit queues, with a "Waiting for your previous answer" state.
- **Streaming:** streamed text is persisted in Convex as it arrives, so everyone sees the same answer appear at the same time under the right prompt. Each run has its own thinking panel.
- **Stop:** only the asker or the owner can stop a run.
- **Follow-up suggestions** show to everyone under the answer they belong to. Tab fills your own composer only.

## How it touches the rest of the spec

| Area | In a shared chat |
| --- | --- |
| Pricing and counter-offers (`docs/shared/pricing.md`) | Priced on the profile whose data the answer uses. A joint loan uses both co-borrowers' profiles only after both agree in the chat. Counter-offers are addressed to that person. |
| Plan summaries (`docs/shared/plan-summary-handoff.md`) | Sent to the person who asked for them. Official applications are always made by the applicant themselves. |
| Specialist reviews (`docs/shared/console.md`) | Record who requested the review. The operator sees the member list, and access is logged as usual. |
| Hardship and crisis modes | Set per asker. A crisis detected in one person's prompt gets its fixed script for that person; other members don't see their crisis details beyond what's in the chat. |
| Retention and deletion | The owner deletes the chat for everyone. A person who leaves deletes nothing, but their data switches go with them, so future prompts can't use their data. |

## Data model (Convex)

```ts
type ChatMember = {
  chatId: string; userId: string;
  role: "owner" | "member" | "viewer";
  joinedAt: string; approvedBy: string;
};

type ShareLink = { chatId: string; token: string; expiresAt: string; revokedAt?: string; createdBy: string };

type JoinRequest = {
  chatId: string; userId: string; status: "pending" | "approved" | "declined";
  requestedAt: string; decidedAt?: string; grantedRole?: "member" | "viewer";
};

type ChatSettings = {
  chatId: string;
  dataScope: "own" | "ownerShared";   // the owner's choice when sharing
  dataScopeChangedAt: string;
};

type Run = {                           // one agent per prompt
  id: string; chatId: string; promptMessageId: string; authorId: string;
  snapshotVersion: number;             // conversation state version it read
  waitsFor?: string;                   // runId it depends on, if any
  dataSubjectId: string;               // whose data it may use
  status: "queued" | "running" | "done" | "stopped" | "failed";
};

// Messages gain: authorId, answersMessageId (for Raiffy answers), dataSubjectId
// Conversation state keys gain: version (per key)
```

## HTML prototype (`chat.html`)

- **Share dialog:** the data-scope checkbox with its consent text, the link with copy, expiry and revoke, and "2 of 5 can ask questions".
- **Join requests:** a pending request in the header, approved as a member or viewer.
- **Two people at once:** a simulated second member sends a prompt while yours is still answering, so two answers stream at once, each under its prompt, with authors and "Answering Ana".
- **The conflict moment:** the other member changes the amount mid-run, and the answer says so.
- **Context panel:** each person's switches, and whose data each answer used.
- Mock data in the shapes above, so it moves to Convex unchanged.

## Evals

| Check | Source |
| --- | --- |
| Every answer is linked to the right prompt and author, even when runs finish out of order | Concurrent prompts |
| With scope "own", a member's prompt never reads the owner's data | Data scope |
| With scope "ownerShared", a member's prompt uses the owner's data only within the owner's switches, and says whose data it used | Data scope |
| A sixth prompting account can't be approved; viewers can, and can't prompt | Members and limits |
| Nobody sees the conversation before the owner approves their join | Sharing and joining |
| A revoked or expired link fails; a removed person loses access to past messages | Sharing and joining |
| A version conflict on shared state is stated in the answer, never merged silently | Concurrent prompts |
| One person's prompts are answered in order; a prompt that depends on a running answer waits for it | Concurrent prompts |
| Only the asker or the owner can stop a run | Concurrent prompts |
| CNP, IBAN and card numbers stay masked for everyone in a shared chat | `docs/individuals/hard-limits.md` |
