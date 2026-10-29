"use client";

import { Fragment, useCallback, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAction, useMutation, useQueries, useQuery, type RequestForQueries } from "convex/react";
import { useClerk, useUser } from "@clerk/nextjs";
import {
  ArrowDownIcon, ArrowUpIcon, CalendarIcon, BadgePercentIcon, PaperclipIcon, BriefcaseIcon, CalculatorIcon, ChartColumnIcon, InfoIcon, PencilIcon, PinIcon, ScaleIcon, SignpostIcon, CompassIcon, CopyIcon, FileTextIcon, HeadsetIcon, ListChecksIcon, ListIcon, ListOrderedIcon, LogOutIcon, MenuIcon, MicIcon, Volume2Icon,
  MessageCircleIcon, PanelRightCloseIcon, PanelRightOpenIcon, RotateCcwIcon, SearchIcon, ShieldCheckIcon, SquareIcon, SquarePenIcon, ThumbsDownIcon,
  ThumbsUpIcon, UserCheckIcon, UserIcon, XIcon,
} from "lucide-react";
import { accountsApi, agentApi, answerCheckApi, memoryApi, isWebSource, type Attachment, type Answer, type AnswerCheck, type MemoryBlock, type InputField, type Message, type MessageId, type Reply, type Source, type ThreadId, type ThreadSummary, type Track, type UiBlock, VOTE_REASONS, type VoteReason } from "@/lib/agent-api";
import { errorInfo, logChatError } from "@/lib/chat-log";
import { AnswerCards, isAnswerCard } from "@/components/agent/AnswerCards";
import { AccessPanel } from "@/components/agent/AccessPanel";
import { PlanBuild, PlanForAnswer } from "@/components/agent/PlanCard";
import { BookingCard } from "@/components/booking/BookingCard";
import { SpendingCard, categoryLabel, isSpending } from "@/components/agent/SpendingCard";
import { OfferCard, isOffer } from "@/components/agent/OfferCard";
import { CompareTable, isCompare } from "@/components/agent/CompareTable";
import { StarterVignette, type StarterVignetteKind } from "@/components/agent/StarterVignettes";
import { listTitle, parseAnswer, segmentCites, splitItem, withoutShown, type Block, type Line, type List, type Run } from "@/lib/markup";
import { blockEnd, placeCards } from "@/lib/card-placement";
import { nextSuggestion, suggestionsFor } from "@/lib/suggestions";
import { chatApi, pinFor, type PinInput, type PinKind, type PinView } from "@/lib/chat-api";
import { MemoryPanel, MemoryProposals } from "./Memory";
import { SpecialistOffer } from "./Handoff";
import { AffordabilityCard, isAffordability } from "./AffordabilityCard";
import { AnswerCheckButton, AnswerCheckZone, canAskSpecialist } from "./AnswerCheck";
import { SpecialistChecks, type CheckRow } from "./SpecialistChecks";
import { YourCalls } from "@/components/booking/YourCalls";
import { YourPlans, type PlanRow } from "./YourPlans";
import { planCheckApi, type MyPlan } from "@/lib/plan-check-api";
import { GroupList, Thinking, ThinkLines, prefersReducedMotion, useIsMac, useMedia } from "@/components/chat/parts";
import { useVoice } from "@/components/chat/useVoice";
import { VoiceStatus } from "@/components/chat/VoiceStatus";
import { spokenAnswer, voiceReplyDecision } from "@/lib/voice-replies";

/*
 * The live chat uses authenticated Convex requests and reactive progress. Checked final text reveals word by
 * word; model drafts never reach the browser. Sources and ownership come from the server.
 */

const TRACKS: { k: Track; label: string; icon: typeof UserIcon; note: string }[] = [
  { k: "personal", label: "For me", icon: UserIcon, note: "Products for individuals: accounts, cards, loans, savings." },
];

const STARTERS: Record<Track, { prompt: string; title: string; hint: string; vignette: StarterVignetteKind }[]> = {
  personal: [
    { prompt: "How do Raiffeisen term deposits work, and what conditions should I check?", title: "How term deposits work", hint: "Conditions and product documents", vignette: "term" },
    { prompt: "What documents do I need for a Raiffeisen personal loan?", title: "Prepare for a personal loan", hint: "The documents to check before applying", vignette: "checklist" },
    { prompt: "What is the difference between a debit card and a credit card?", title: "Understand your cards", hint: "How debit and credit cards differ", vignette: "cards" },
    { prompt: "Compare the documents needed for a Raiffeisen Flexicredit personal loan and a BCR George personal loan.", title: "Compare loan documents", hint: "Raiffeisen and BCR requirements", vignette: "doctable" },
  ],
  business: [
    { prompt: "What is the maximum overdraft my company can get?", title: "Overdraft for my company", hint: "Limits and conditions", vignette: "limit" },
    { prompt: "What does a business current account cost per month?", title: "Business account costs", hint: "Packages and monthly fees", vignette: "tiers" },
    { prompt: "How can my SRL finance new equipment?", title: "Financing equipment", hint: "Investment loans and leasing", vignette: "routes" },
    { prompt: "What documents does my company need to open an account?", title: "Opening a business account", hint: "What to prepare", vignette: "docstack" },
  ],
};

const DAY = 86_400_000;
/** Where the wide-screen context panel choice is kept (per browser, a convenience only). */
const CTX_KEY = "raiffy.ctx";
const subscribeClock = (cb: () => void) => { const t = setInterval(cb, 60_000); return () => clearInterval(t); };
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const timeOf = (t: number) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(t);
const dayOf = (t: number) => new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(t);
const dateOf = (t: number) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(t);
const greetingFor = (h: number) => `${h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"}`;

/** The search steps as status lines: the query Raiffy ran, then how many results came back. */
const stepLines = (steps: { query: string; results?: number }[]) =>
  steps.map((s) => <>Searching bank sources: <b className="q">{s.query}</b>{s.results !== undefined && <> · {s.results} {s.results === 1 ? "result" : "results"}</>}</>);

/**
 * `view="checks"` is /chat/checks and `view="plans"` is /chat/plans: the same shell, with "Your specialist checks" or
 * "Your plans" in the thread's place (chat.html#checks, #plans).
 */
export function AgentChat({ view = "chat" }: { view?: "chat" | "checks" | "plans" | "calls" }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const params = useSearchParams();
  const threads = useQuery(agentApi.listThreads, {});
  // /chat?thread=<id> opens that conversation (from Your specialist checks or an e-mail). An id that isn't the customer's
  // comes back as an error value below and shows the "conversation unavailable" note.
  const [threadId, setThreadId] = useState<ThreadId | null>(() => view === "chat" ? params.get("thread") as ThreadId | null : null);
  useEffect(() => { if (view === "chat" && params.get("thread")) router.replace("/chat", { scroll: false }); }, [view, params, router]);
  // The customer's checks on both tracks: the sidebar count, and the list on /chat/checks. Business needs an
  // organization, so without one its query returns an error value and is left out.
  const mine = useQueries(useMemo((): RequestForQueries => ({
    personal: { query: answerCheckApi.mine, args: { track: "personal" } },
    business: { query: answerCheckApi.mine, args: { track: "business" } },
  }), []));
  const myChecks = useMemo((): CheckRow[] | undefined => {
    if (mine.personal === undefined) return undefined;
    const of = (rows: unknown, track: Track) => Array.isArray(rows) ? (rows as Omit<CheckRow, "track">[]).map((c) => ({ ...c, track })) : [];
    return [...of(mine.personal, "personal"), ...of(mine.business, "business")].sort((x, y) => y.createdAt - x.createdAt);
  }, [mine.personal, mine.business]);
  const openChecks = myChecks?.filter((c) => c.status === "open").length ?? 0;
  // The customer's plans on both tracks, the same way: the sidebar counts the ones not checked yet
  const plansMine = useQueries(useMemo((): RequestForQueries => ({
    personal: { query: planCheckApi.mine, args: { track: "personal" } },
    business: { query: planCheckApi.mine, args: { track: "business" } },
  }), []));
  const myPlans = useMemo((): PlanRow[] | undefined => {
    if (plansMine.personal === undefined) return undefined;
    const of = (rows: unknown, track: Track) => Array.isArray(rows) ? (rows as MyPlan[]).map((p) => ({ ...p, track })) : [];
    return [...of(plansMine.personal, "personal"), ...of(plansMine.business, "business")].sort((x, y) => y.createdAt - x.createdAt);
  }, [plansMine.personal, plansMine.business]);
  const uncheckedPlans = myPlans?.filter((p) => p.state === "unchecked" || p.state === "changed").length ?? 0;
  const titles = useMemo(() => new Map((threads ?? []).map((t) => [t._id as string, t.title])), [threads]);
  // useQueries returns a server error as a value instead of throwing it into the page's error boundary, so a
  // conversation deleted while open (another tab, a re-seed, retention) brings back an empty chat, not the error page.
  const results = useQueries(useMemo((): RequestForQueries => threadId ? {
    messages: { query: agentApi.listMessages, args: { threadId } },
    checks: { query: answerCheckApi.forThread, args: { threadId } },
  } : {}, [threadId]));
  const loaded = results.messages;
  // Answer checks by message. If they can't load, the "Ask a specialist" button stays hidden rather than failing on send.
  const checks = useMemo(() => Array.isArray(results.checks)
    ? new Map((results.checks as (AnswerCheck & { messageId: string })[]).map((c) => [c.messageId, c])) : null, [results.checks]);
  const gone = loaded instanceof Error;
  const messages = gone ? undefined : (loaded as Message[] | undefined);
  const [goneNote, setGoneNote] = useState<ThreadId | null>(null);
  if (gone && threadId) { setGoneNote(threadId); setThreadId(null); }
  useEffect(() => { if (goneNote) logChatError("conversation unavailable", { threadId: goneNote }); }, [goneNote]);
  const sendMutation = useMutation(agentApi.send);
  const runAction = useAction(agentApi.run);
  const stopMutation = useMutation(agentApi.stop);
  const startedHere = useRef(new Set<string>());
  // Safe to retry after a reload: the backend atomically starts each request at most once.
  useEffect(() => {
    const queued = messages?.find(m => m.role === "assistant" && m.status === "streaming");
    // Resumes a reply queued elsewhere (another tab, a reload). Replies this tab just sent are started by send().
    if (queued && !startedHere.current.has(queued._id)) void runAction({ messageId: queued._id }).catch(() => {});
  }, [messages, runAction]);

  // New chats are personal; the business track returns with Clerk Organizations (it needs an org_id)
  const track: Track = "personal";
  const [input, setInput] = useState("");
  const [voiceDraft, setVoiceDraft] = useState(false);
  const [pending, setPending] = useState<{ text: string; base: number; attachment?: Attachment } | null>(null);
  // The paperclip (chat.html #attach): the chosen sample customer's statement, attached to the next question
  const [attached, setAttached] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [drawer, setDrawerState] = useState<"side" | "ctx" | null>(null);
  const [ctxClosed, setCtxClosedState] = useState(false);
  // Off until the saved choice is applied, so a closed panel doesn't animate shut on load
  const [ctxAnimate, setCtxAnimate] = useState(false);
  const [liveMsg, setLiveMsg] = useState("");
  /** The source (by url) lit in "Sources in this chat" while its tag under an answer is hovered or focused. */
  const [litSource, setLitSource] = useState<string | null>(null);
  const [votes, setVotes] = useState<Record<string, "up" | "down">>({});
  const [whys, setWhys] = useState<Record<string, VoteReason>>({});
  const rateMutation = useMutation(agentApi.rate);
  /** The header's "Talk to a specialist" opens the booking card directly, without a message or a model call. */
  const [bookingOpen, setBookingOpen] = useState(false);

  const narrowCtx = useMedia("(max-width: 1199px)");
  const narrowSide = useMedia("(max-width: 859px)");
  const mac = useIsMac();
  const today = useSyncExternalStore(subscribeClock, startOfToday, () => 0);
  const hour = useSyncExternalStore(subscribeClock, () => new Date().getHours(), () => 18);

  const scroller = useRef<HTMLDivElement>(null);
  const jumpBtn = useRef<HTMLButtonElement>(null);
  const inputEl = useRef<HTMLTextAreaElement>(null);
  const searchEl = useRef<HTMLInputElement>(null);
  const sideEl = useRef<HTMLElement>(null);
  const closeCtxBtn = useRef<HTMLButtonElement>(null);
  const stick = useRef(true);
  const drawerRef = useRef(drawer);
  const opener = useRef<Element | null>(null);
  const prevThread = useRef(threadId);
  const announced = useRef<string | null>(null);

  const thread = threads?.find((t) => t._id === threadId);
  const activeTrack = thread?.track ?? track;
  // Renaming a chat and pinning answer cards to Context (convex/chatThreads.ts)
  const renameMutation = useMutation(chatApi.rename);
  const pinMutation = useMutation(chatApi.pin);
  const unpinMutation = useMutation(chatApi.unpin);
  const pins = useQuery(chatApi.listPins, { track: activeTrack });
  const pinByMessage = useMemo(() => new Map((pins ?? []).map((p) => [p.messageId as string, p])), [pins]);
  const [renaming, setRenaming] = useState(false);
  const renameBtn = useRef<HTMLButtonElement>(null);
  const access = useQuery(accountsApi.getAccess, activeTrack === "personal" ? {} : "skip");
  // Memory is personal for now: business memories need an organization scope the chat doesn't carry yet.
  const memoryState = useQuery(memoryApi.listMine, activeTrack === "personal" ? { track: activeTrack } : "skip");
  const memoryView = memoryState && {
    pendingIds: new Set(memoryState.proposals.map((p) => p.id)), savedTexts: new Set(memoryState.memories.map((m) => m.text)),
  };
  const list = messages ?? [];
  const showPending = pending !== null && list.length <= pending.base;
  const streaming = list.findLast((m) => m.role === "assistant" && m.status === "streaming");
  const busy = showPending || !!streaming;
  const empty = !threadId && !showPending;
  // Follow-ups for the latest finished answer sit above the composer, and Tab fills them (chat.html setChips).
  const suggestions = useMemo(() => busy ? [] : suggestionsFor(messages ?? []), [busy, messages]);
  const lastId = messages?.at(-1)?._id;
  // Which chip carries the Tab hint; it restarts at the first chip with each new answer.
  const [tab, setTab] = useState<{ for?: string; at: number }>({ at: 0 });
  const tabAt = tab.for === lastId ? tab.at : 0;
  const coarse = useMedia("(pointer: coarse)");

  const pendingVoice = useRef<{ token: symbol; messageId: string } | null>(null);
  const voice = useVoice((text, automatic) => {
    if (automatic) {
      if (busy) { cancelVoice(); return; }
      void send(text, undefined, undefined, true, true);
      return;
    }
    setInput(draft => draft.trim() ? `${draft.trimEnd()} ${text}` : text);
    setVoiceDraft(true);
    inputEl.current?.focus();
    announce("Dictation added to your draft. Review it before sending. Raiffy will read its reply aloud.");
  });
  const dictating = ["requesting", "listening", "transcribing"].includes(voice.phase);
  function cancelVoice() { pendingVoice.current = null; voice.cancel(); }

  const receiveVoiceReply = useEffectEvent(() => {
    const waiting = pendingVoice.current;
    if (!waiting) return;
    const decision = voiceReplyDecision(waiting.messageId, list);
    if (decision.kind === "wait") return;
    pendingVoice.current = null;
    if (decision.kind === "cancel") voice.cancelReply(waiting.token);
    else void voice.readReply(waiting.token, decision.messageId, decision.text);
  });
  useEffect(() => { receiveVoiceReply(); }, [messages]);

  function announce(msg: string) { setLiveMsg(""); window.setTimeout(() => setLiveMsg(msg), 60); }

  /* Keep the newest text in view while the customer is at the bottom; otherwise offer "Jump to latest" */
  const follow = useCallback(() => {
    const s = scroller.current, j = jumpBtn.current;
    if (!s || !j) return;
    if (stick.current) s.scrollTop = s.scrollHeight; else j.hidden = false;
  }, []);
  useLayoutEffect(() => {
    const s = scroller.current!, j = jumpBtn.current!;
    // The empty state reads from the top: greeting, who it's for, then the starters
    if (empty) { s.scrollTop = 0; j.hidden = true; prevThread.current = threadId; return; }
    if (prevThread.current !== threadId) {
      prevThread.current = threadId;
      stick.current = true; j.hidden = true;
      s.scrollTop = s.scrollHeight;
      return;
    }
    follow();
  }, [threadId, messages, showPending, follow, empty]);

  useLayoutEffect(() => {
    const el = inputEl.current!;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    // scrollHeight is rounded, so a box sized to it can overflow by a fraction of a pixel, and Windows then draws
    // scrollbar arrows beside one line of text. Scroll only once the text passes the cap.
    el.style.overflowY = el.scrollHeight > 200 ? "auto" : "hidden";
  }, [input]);

  useEffect(() => { document.title = (thread ? `${thread.title} · ` : "") + "Raiffy"; }, [thread]);

  // Log each failed answer once, including old ones when a thread opens, so a broken reply is traceable from the console
  const loggedFailures = useRef(new Set<string>());
  useEffect(() => {
    for (const m of messages ?? []) {
      if (m.role !== "assistant" || m.status !== "failed" || loggedFailures.current.has(m._id)) continue;
      loggedFailures.current.add(m._id);
      logChatError("answer failed", { threadId, messageId: m._id, reason: m.error ?? null });
    }
  }, [messages, threadId]);

  // Announce each finished answer once (the streaming text itself is hidden from screen readers, so they don't hear every word)
  useEffect(() => {
    const last = messages?.at(-1);
    if (!last || last.role !== "assistant" || last.status === "streaming" || announced.current === last._id) return;
    if (announced.current === null) { announced.current = last._id; return; } // opening a thread: nothing new to announce
    announced.current = last._id;
    const msg = last.status === "stopped" ? "Reply stopped." : last.status === "failed" ? last.error ?? "Raiffy couldn't answer." : `Raiffy replied: ${last.text}`;
    const t = window.setTimeout(() => announce(msg), 0);
    return () => clearTimeout(t);
  }, [messages]);

  /* ───────────── Sending ───────────── */
  async function send(text: string, reply?: Reply, attachment?: Attachment, readAloud = false, automatic = false) {
    const question = text.trim();
    if (!question || busy || (dictating && !automatic)) return;
    const voiceToken = readAloud ? voice.prepareReply() : undefined;
    if (!readAloud) cancelVoice();
    setVoiceDraft(false);
    setSendError(null);
    setGoneNote(null);
    setPending({ text: question, base: list.length, ...(attachment ? { attachment } : {}) });
    setInput("");
    setAttached(false);
    stick.current = true;
    try {
      const r = await sendMutation({ question, track: activeTrack, ...(threadId ? { threadId } : {}), ...(reply && threadId ? { reply } : {}), ...(attachment ? { attachment } : {}) });
      if (!threadId) { announced.current = null; setThreadId(r.threadId); }
      if (voiceToken) pendingVoice.current = { token: voiceToken, messageId: r.messageId };
      startedHere.current.add(r.messageId);
      void runAction({ messageId: r.messageId }).catch((error: unknown) => {
        if (pendingVoice.current?.messageId === r.messageId) cancelVoice();
        logChatError("agent:run failed", { threadId: r.threadId, messageId: r.messageId, ...errorInfo(error) });
        setSendError("The reply was interrupted. Stop it and try again.");
      });
    } catch (error) {
      if (voiceToken) voice.cancelReply(voiceToken);
      logChatError("agent:send failed", { threadId, hasReply: !!reply, ...errorInfo(error) });
      setPending(null);
      setInput(question);
      if (attachment) setAttached(true);
      setSendError("Your question didn't reach Raiffy. Check your connection and try again.");
    }
  }
  function stop() { cancelVoice(); if (streaming) void stopMutation({ messageId: streaming._id }); }

  /** Typed text that is a suggestion's prompt (filled with Tab) carries that suggestion's reply, as pressing its chip does. */
  function sendInput() { void send(input, suggestions.find((s) => s.prompt === input.trim())?.reply, attached ? "sample_statement" : undefined, voiceDraft); }

  /* Tab with an empty composer fills the first suggestion, Tab again the next one, and after the last one Tab moves
     focus as usual. Enter sends. */
  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Up arrow in an empty composer brings back the last question to edit (chat.html)
    if (e.key === "ArrowUp" && !input && !busy) {
      const last = list.findLast((m) => m.role === "user" && m.text);
      if (last) { e.preventDefault(); setInput(last.text); return; }
    }
    if (e.key === "Tab" && !e.shiftKey && !busy) {
      const n = nextSuggestion(suggestions, input);
      if (n !== null) {
        e.preventDefault();
        setInput(suggestions[n]!.prompt);
        setTab({ for: lastId, at: n + 1 });
        announce(`Suggestion: ${suggestions[n]!.prompt}. Press Enter to send.`);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendInput(); }
  }

  function openThread(id: ThreadId | null) {
    cancelVoice(); setVoiceDraft(false);
    if (view !== "chat") { router.push(id ? `/chat?thread=${id}` : "/chat"); return; }
    setThreadId(id);
    setRenaming(false);
    setPending(null);
    setSendError(null);
    setGoneNote(null);
    announced.current = null;
    if (narrowSide) closeDrawers();
    if (!id) inputEl.current?.focus();
  }

  /* ───────────── Drawers ───────────── */
  function setDrawer(v: typeof drawer) { drawerRef.current = v; setDrawerState(v); }
  function openDrawer(which: "side" | "ctx", from?: Element | null) {
    opener.current = from || document.activeElement;
    setDrawer(which);
    window.setTimeout(() => (which === "ctx" ? closeCtxBtn.current : sideEl.current?.querySelector<HTMLElement>("button, input"))?.focus(), 30);
  }
  function closeDrawers() {
    const was = drawerRef.current !== null;
    setDrawer(null);
    setLitSource(null);
    const o = opener.current;
    // After the commit: until then the page behind the drawer is still inert and can't take focus
    if (was && o instanceof HTMLElement) window.setTimeout(() => { if (document.contains(o)) o.focus(); }, 0);
  }
  const ctxOpen = narrowCtx ? drawer === "ctx" : !ctxClosed;

  /* Rename (chat.html #rename): Enter or leaving the field saves, Escape cancels, and focus returns to the pencil */
  function finishRename(title: string | null) {
    setRenaming(false);
    // After the pencil is back in the header
    window.setTimeout(() => renameBtn.current?.focus(), 30);
    if (!thread || title === null || !title.trim() || title.trim() === thread.title) return;
    renameMutation({ threadId: thread._id, title }).then(() => announce("Chat renamed."), () => announce("Couldn’t rename this chat. Try again."));
  }

  /* Pins (chat.html PIN_META): an answer's first card, kept in Context across chats until unpinned */
  function togglePin(messageId: MessageId, input: PinInput) {
    const pinned = pinByMessage.get(messageId);
    if (pinned) { void unpinMutation({ pinId: pinned.id }).then(() => announce("Unpinned."), () => announce("Couldn’t unpin this card.")); return; }
    pinMutation({ messageId, ...input }).then(() => announce("Pinned to context."), (error: unknown) =>
      announce(String(error).includes("pin_limit") ? "You can pin up to 50 cards. Unpin one first." : "Couldn’t pin this card."));
  }
  function openPin(p: PinView) {
    if (p.threadId !== threadId) { openThread(p.threadId); return; }
    if (narrowCtx) closeDrawers();
    document.getElementById(`m-${p.messageId}`)?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  /* The paperclip attaches the sample customer's statement; with none chosen yet, it shows where to choose one */
  function attach() {
    if (access === undefined) return;
    if (!access.persona) {
      if (narrowCtx) openDrawer("ctx"); else setCtxClosed(false);
      announce("Choose a sample customer under What Raiffy can see, then attach their statement.");
      return;
    }
    setAttached(true);
    inputEl.current?.focus();
    announce(`${statementName()} attached. It's sample data, not your account.`);
  }

  /* A source tag under an answer lights its row in "Sources in this chat" (chat.html lightSource), and an open panel
     scrolls to it, since the list often sits below the fold. Pressing a tag that has no page to open also shows the
     Context panel. */
  function lightSource(url: string | null, reveal = false) {
    setLitSource(url);
    if (!url || (!reveal && !ctxOpen)) return;
    if (reveal && narrowCtx) openDrawer("ctx");
    else if (reveal && ctxClosed) setCtxClosed(false);
    window.setTimeout(() => document.querySelector(`[data-src-item="${CSS.escape(url)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" }), 40);
  }

  /* Wide screens: the context panel opens or closes in place, and the choice is remembered on this device */
  function setCtxClosed(closed: boolean) {
    setCtxClosedState(closed);
    try { localStorage.setItem(CTX_KEY, closed ? "closed" : "open"); } catch { /* storage blocked: the choice lasts this visit */ }
  }
  function toggleCtx(from?: Element | null) {
    if (!narrowCtx) setCtxClosed(!ctxClosed);
    else if (drawerRef.current === "ctx") closeDrawers();
    else openDrawer("ctx", from);
  }
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(CTX_KEY); } catch { /* storage blocked */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the saved choice after hydration
    if (saved === "closed") setCtxClosedState(true);
    const f = requestAnimationFrame(() => requestAnimationFrame(() => setCtxAnimate(true)));
    return () => cancelAnimationFrame(f);
  }, []);

  const onResize = useEffectEvent(() => closeDrawers());
  useEffect(() => {
    const qs = [matchMedia("(max-width: 1199px)"), matchMedia("(max-width: 859px)")];
    const h = () => onResize();
    qs.forEach((q) => q.addEventListener("change", h));
    return () => qs.forEach((q) => q.removeEventListener("change", h));
  }, []);

  /* ───────────── Keyboard ───────────── */
  const onKey = useEffectEvent((e: globalThis.KeyboardEvent) => {
    const mod = mac ? e.metaKey : e.ctrlKey;
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (narrowSide) openDrawer("side");
      window.setTimeout(() => { searchEl.current?.focus(); searchEl.current?.select(); }, narrowSide ? 40 : 0);
    }
    if (mod && e.key === "\\") { e.preventDefault(); toggleCtx(); }
    const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName || "");
    if (!typing && !mod && !e.altKey && e.key.toLowerCase() === "n") { e.preventDefault(); openThread(null); }
    if (e.key === "Escape") {
      if (drawerRef.current) closeDrawers();
      else stop();
    }
  });
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => onKey(e);
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  /* ───────────── Derived ───────────── */
  const q = query.trim().toLowerCase();
  const visible = (threads ?? []).filter((t) => !q || t.title.toLowerCase().includes(q));
  const groups = [
    { label: "Today", items: visible.filter((t) => t._creationTime >= today) },
    { label: "This week", items: visible.filter((t) => t._creationTime < today && t._creationTime >= today - 6 * DAY) },
    { label: "Earlier", items: visible.filter((t) => t._creationTime < today - 6 * DAY) },
  ].filter((g) => g.items.length);
  const when = (t: ThreadSummary) => (t._creationTime >= today ? timeOf(t._creationTime) : t._creationTime >= today - 6 * DAY ? dayOf(t._creationTime) : dateOf(t._creationTime));

  const sources = uniqueSources(list);
  const meta = thread
    ? `${TRACKS.find((t) => t.k === thread.track)?.label ?? "Business profile"} · ${sources.length ? `${sources.length} ${sources.length === 1 ? "source" : "sources"}` : "no sources yet"}`
    : "New conversation";
  const appClass = ["app", view === "checks" && "view-checks", view === "plans" && "view-plans", view === "calls" && "view-calls", drawer === "side" && "side-open", drawer === "ctx" && "ctx-open", ctxClosed && "ctx-closed", !ctxAnimate && "no-anim"].filter(Boolean).join(" ");
  const ctxKbd = mac ? "⌘\\" : "Ctrl \\";

  return (
    <div className="pg-chat">
      <div className={appClass} id="app">

        {/* ═════════════ Sidebar ═════════════ */}
        <aside className="side" id="side" aria-label="Chats" ref={sideEl} inert={drawer === "ctx" && narrowSide}>
          <div className="side-top">
            <Link className="logo" href="/"><span className="logo-mark"><CompassIcon /></span>Raiffy</Link>
          </div>
          <button type="button" className="btn btn-ghost new" id="new-chat" onClick={() => openThread(null)}><SquarePenIcon />New chat<kbd>N</kbd></button>
          <label className="search">
            <SearchIcon />
            <span className="sr-only">Search chats</span>
            <input type="search" id="search" ref={searchEl} placeholder="Search chats" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
            <kbd id="kbd-k">{mac ? "⌘K" : "Ctrl K"}</kbd>
          </label>
          <Link className="conv checks-link" href="/chat/checks" aria-current={view === "checks"} onClick={() => { if (narrowSide) closeDrawers(); }}
            aria-label={`Your specialist checks${openChecks ? `, ${openChecks} waiting` : ""}`}>
            <UserCheckIcon /><span>Your specialist checks</span><small>{openChecks || ""}</small>
          </Link>
          <Link className="conv checks-link plans-link" href="/chat/plans" aria-current={view === "plans"} onClick={() => { if (narrowSide) closeDrawers(); }}
            aria-label={`Your plans${uncheckedPlans ? `, ${uncheckedPlans} not checked` : ""}`}>
            <FileTextIcon /><span>Your plans</span><small>{uncheckedPlans || ""}</small>
          </Link>
          <Link className="conv checks-link calls-link" href="/chat/calls" aria-current={view === "calls"} onClick={() => { if (narrowSide) closeDrawers(); }}>
            <CalendarIcon /><span>Your calls</span><small />
          </Link>
          <nav className="conv-list" id="conv-list" aria-label="Conversations" aria-busy={threads === undefined}>
            {groups.map((g) => (
              <GroupList key={g.label} label={g.label}>
                {g.items.map((t) => (
                  <button key={t._id} type="button" className="conv" aria-current={t._id === threadId} onClick={() => openThread(t._id)}>
                    {t.track === "business" ? <BriefcaseIcon /> : <MessageCircleIcon />}<span>{t.title}</span><small>{when(t)}</small>
                  </button>
                ))}
              </GroupList>
            ))}
            {threads && !groups.length && (
              q ? <p className="no-match">No chats match “<span>{q}</span>”.</p> : <p className="no-match">Your conversations will appear here.</p>
            )}
          </nav>
          <div className="me">
            <span className="ava" aria-hidden="true">{user?.firstName?.slice(0,1) ?? "R"}</span>
            <div><b>{user?.firstName ?? "Your account"}</b><small>Your private chat</small></div>
            <button className="icon-btn" onClick={() => void signOut({ redirectUrl: "/sign-in" })} aria-label="Sign out"><LogOutIcon /></button>
          </div>
        </aside>

        {/* ═════════════ Thread ═════════════ */}
        <div className="main" id="main" inert={drawer !== null}>
          <header className="top">
            <button type="button" className="icon-btn menu" id="open-side" aria-label="Open chats" aria-controls="side"
              aria-expanded={drawer === "side"} onClick={(e) => openDrawer("side", e.currentTarget)}><MenuIcon /></button>
            <div className="title-wrap">
              {renaming && thread && view === "chat"
                ? <RenameField key={thread._id} title={thread.title} onDone={finishRename} />
                : <div id="title-box">{view === "checks"
                  ? <><h1 id="title">Your specialist checks</h1><span className="meta" id="meta">Answers you sent to a person</span></>
                  : view === "plans" ? <><h1 id="title">Your plans</h1><span className="meta" id="meta">Plans you built in your chats</span></>
                  : view === "calls" ? <><h1 id="title">Your calls</h1><span className="meta" id="meta">Calls you booked with a specialist</span></>
                  : <><h1 id="title">{thread?.title ?? "New chat"}</h1><span className="meta" id="meta">{meta}</span></>}</div>}
              {thread && !renaming && view === "chat" && <button type="button" className="icon-btn rename" id="rename" ref={renameBtn} aria-label="Rename chat" onClick={() => setRenaming(true)}><PencilIcon /></button>}
            </div>
            <div className="top-actions">
              <button type="button" className="btn btn-ghost btn-sm advisor" id="advisor-btn" aria-label="Talk to a specialist"
                aria-expanded={bookingOpen} aria-controls="booking-panel" onClick={() => setBookingOpen((o) => !o)}>
                <HeadsetIcon /><span className="advisor-lbl">Talk to a specialist</span>
              </button>
              <button type="button" className="icon-btn" id="toggle-ctx" aria-controls="ctx" aria-expanded={ctxOpen}
                aria-label={ctxOpen ? "Hide context panel" : `Show context panel${sources.length ? `, ${sources.length} ${sources.length === 1 ? "source" : "sources"}` : ""}`}
                title={`${ctxOpen ? "Hide" : "Show"} context (${ctxKbd})`} onClick={(e) => toggleCtx(e.currentTarget)}>
                <PanelRightCloseIcon className="ic-hide" /><PanelRightOpenIcon className="ic-show" />
                <span className="ctx-count" aria-hidden="true">{sources.length || ""}</span>
              </button>
            </div>
          </header>

          {view === "checks" && <SpecialistChecks rows={myChecks} titles={titles} />}
          {view === "plans" && <YourPlans rows={myPlans} titles={titles} />}
          {view === "calls" && <YourCalls announce={announce} />}

          <div className="scroll" id="scroll" ref={scroller} onScroll={() => {
            const s = scroller.current!;
            stick.current = s.scrollHeight - s.scrollTop - s.clientHeight < 80;
            if (stick.current) jumpBtn.current!.hidden = true;
          }}>
            <div className="thread" id="thread" role="log" aria-label="Conversation with Raiffy" hidden={empty}>
              {list.map((m, i) => (m.role === "user"
                ? <UserBubble key={m._id} text={m.text} attachment={m.attachment} />
                : <AssistantMessage key={m._id} m={m} threadId={threadId} onGrow={follow} vote={votes[m._id]} why={whys[m._id]} track={activeTrack} memory={memoryView}
                    onFollowUp={(prompt, reply) => void send(prompt, reply)}
                    latest={i === list.length - 1} litSource={litSource} onLight={lightSource}
                    pinned={pinByMessage.has(m._id)} onPin={(input) => togglePin(m._id, input)}
                    checks={checks} announce={announce}
                    onVote={(v) => {
                      const off = votes[m._id] === v;
                      setVotes((x) => { const next = { ...x }; if (off) delete next[m._id]; else next[m._id] = v; return next; });
                      setWhys((x) => { const next = { ...x }; delete next[m._id]; return next; });
                      if (off) return;
                      void rateMutation({ messageId: m._id, vote: v }).catch(() => {});
                      announce(v === "up" ? "Thanks for the feedback." : "Thanks. This helps Raiffy improve.");
                    }}
                    onWhy={(reason) => {
                      setWhys((x) => ({ ...x, [m._id]: reason }));
                      // The latest vote on an answer counts, so the reason comes as the same thumbs down again.
                      void rateMutation({ messageId: m._id, vote: "down", reason }).catch(() => {});
                      announce("Thanks. Noted.");
                    }}
                    onCopy={() => { navigator.clipboard?.writeText(m.text).catch(() => {}); announce("Answer copied."); }}
                    onRetry={() => { const qn = list[i - 1]; if (qn?.role === "user") void send(qn.text); }}
                    retryDisabled={busy} reading={voice.messageId === m._id && ["preparing", "speaking"].includes(voice.phase)}
                    onRead={() => { if (voice.messageId === m._id && voice.active) cancelVoice(); else { pendingVoice.current = null; void voice.speak(m._id, spokenAnswer(m.answer?.text ?? m.text)); } }} />))}
              {showPending && (
                <>
                  <UserBubble text={pending.text} attachment={pending.attachment} enter />
                  <div className="msg msg-raiffy enter">
                    <span className="ava-raiffy" aria-hidden="true"><CompassIcon /></span>
                    <div className="raiffy-body">
                      <div className="think think-live"><ol className="think-lines" aria-label="Raiffy is working"><ThinkLines lines={["Classifying your banking inquiry…"]} live /></ol></div>
                    </div>
                  </div>
                </>
              )}
              {sendError && <p className="stopped send-error" role="alert">{sendError}</p>}
            </div>

            {bookingOpen && (
              <section className="thread booking-panel" id="booking-panel" aria-label="Talk to a specialist">
                <BookingCard threadId={threadId} />
                <button type="button" className="btn btn-ghost btn-sm booking-close" onClick={() => setBookingOpen(false)}>Close</button>
              </section>
            )}

            <section className="empty enter" id="empty" hidden={!empty} aria-labelledby="greet">
              <div className="bloom" aria-hidden="true" />
              <div className="empty-head">
                <span className="ava-raiffy" aria-hidden="true"><CompassIcon /></span>
                <h2 id="greet">{greetingFor(hour)}{user?.firstName ? `, ${user.firstName}` : ""}</h2>
                <p>Explore accounts, cards, loans and savings using dated public bank sources. Exact prices and personalized offers aren’t available in this preview.</p>
                {goneNote && <p className="stopped send-error" role="status">That conversation is no longer available. It may have been deleted in another tab.</p>}
              </div>
              <div className="starters">
                {STARTERS[track].map((s, i) => (
                  <button key={s.prompt} type="button" className="starter" onClick={() => { void send(s.prompt); inputEl.current?.focus(); }}>
                    <StarterVignette kind={s.vignette} index={i} active={empty} />
                    <b>{s.title}</b><span className="q">{s.hint}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="composer-wrap">
            <button type="button" className="jump" id="jump" ref={jumpBtn} hidden onClick={() => {
              const s = scroller.current!;
              s.scrollTo({ top: s.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
              jumpBtn.current!.hidden = true;
              inputEl.current?.focus();
            }}><ArrowDownIcon />Jump to latest</button>
            <div className="chips" id="chips" role="group" aria-label="Suggested questions" hidden={!suggestions.length}>
              {suggestions.map((s, i) => (
                <button key={s.prompt} type="button" className="chip" onClick={() => { void send(s.prompt, s.reply); inputEl.current?.focus(); }}>
                  {s.label}{i === tabAt && <kbd className="tab-kbd" aria-hidden="true">Tab</kbd>}
                </button>
              ))}
            </div>
            <VoiceStatus voice={{ ...voice, cancel: cancelVoice }} />
            <form className="composer" id="composer" onSubmit={(e) => { e.preventDefault(); if (streaming) stop(); else sendInput(); }}>
              <label className="sr-only" htmlFor="input">Message Raiffy</label>
              <textarea id="input" ref={inputEl} rows={1} enterKeyHint="send" value={input} maxLength={2000}
                placeholder={threadId ? (suggestions.length && !coarse ? "Ask a follow-up, or press Tab for a suggestion" : "Ask a follow-up") : activeTrack === "business" ? "Ask about a product for your business…" : "Ask about an account, a card, a loan, your savings…"}
                onChange={(e) => {
                  if (voice.handsFree) cancelVoice();
                  setInput(e.target.value);
                  if (!e.target.value.trim()) setVoiceDraft(false);
                  // Typing over a suggestion hides the Tab hint; clearing the box puts it back on the first chip
                  if (!suggestions.some((s) => s.prompt === e.target.value.trim())) setTab({ for: lastId, at: e.target.value ? -1 : 0 });
                }} onKeyDown={onComposerKey} />
              <div className="comp-row">
                {activeTrack === "personal" && !attached && <button type="button" className="icon-btn" id="attach" aria-label="Attach your statement" onClick={attach}><PaperclipIcon /></button>}
                {attached && (
                  <span className="file-chip" id="att">
                    <span className="ft"><FileTextIcon /></span><span className="fn">{statementName()}</span><small>Sample</small>
                    <button type="button" className="icon-btn x" aria-label="Remove attachment" onClick={() => { setAttached(false); inputEl.current?.focus(); announce("Statement removed."); }}><XIcon /></button>
                  </span>
                )}
                <span className="track-note">{TRACKS.find((t) => t.k === activeTrack)?.label ?? "Business profile"}</span>
                <div className="voice-composer-actions">
                  <button type="button" className="icon-btn voice-mic" id="voice-mic"
                    aria-label={voice.handsFree ? "End voice conversation" : voice.phase === "listening" ? "Finish dictation" : input.trim() ? "Dictate a message" : "Start voice conversation"}
                    aria-pressed={voice.handsFree || voice.phase === "listening"} title={input.trim() ? "Dictate in English" : "Hands-free conversation in English"}
                    disabled={!voice.handsFree && (busy || voice.phase === "requesting" || voice.phase === "transcribing")}
                    onClick={() => {
                      if (voice.handsFree) cancelVoice();
                      else if (voice.phase === "listening") voice.finishRecording();
                      else if (input.trim()) void voice.record();
                      else voice.startConversation();
                    }}>{voice.handsFree || voice.phase === "listening" ? <SquareIcon /> : <MicIcon />}</button>
                <button type="submit" className={streaming ? "btn btn-dark send is-stop" : "btn btn-dark send"} id="send"
                  aria-label={streaming ? "Stop reply" : voiceDraft ? "Send message and read reply aloud" : "Send message"} disabled={!streaming && (dictating || showPending || !input.trim())}>
                  <span className="i-send"><ArrowUpIcon /></span><span className="i-stop"><SquareIcon /></span>
                </button>
                </div>
              </div>
            </form>
            <p className="disclaimer">AI-generated from dated public bank sources. Information may have changed and isn’t a binding offer.</p>
          </div>
        </div>

        {/* ═════════════ Context panel ═════════════ */}
        <aside className="ctx" id="ctx" aria-labelledby="ctx-title" inert={drawer === "side"}>
          <div className="ctx-top">
            <h2 id="ctx-title">Context</h2>
            <div className="ctx-top-r">
              <kbd className="ctx-kbd">{ctxKbd}</kbd>
              <button type="button" className="icon-btn ctx-hide" aria-label="Hide context panel" title={`Hide context (${ctxKbd})`} aria-controls="ctx"
                onClick={() => { setCtxClosed(true); document.getElementById("toggle-ctx")?.focus(); }}><PanelRightCloseIcon /></button>
              <button type="button" className="icon-btn ctx-close" id="close-ctx" ref={closeCtxBtn} aria-label="Close context panel" onClick={closeDrawers}><XIcon /></button>
            </div>
          </div>
          <div className="ctx-body">
            {activeTrack === "personal" && <AccessPanel />}
            <section className="ctx-sec">
              <h3>Answering for</h3>
              <ul className="perms">
                {TRACKS.filter((t) => t.k === activeTrack).map((t) => (
                  <li key={t.k} className="perm"><span className="ic"><t.icon /></span><div><b>{t.label}</b><small>{t.note}</small></div></li>
                ))}
              </ul>
              <p className="perm-note">{thread ? "A conversation keeps its profile, so personal and business products never mix. Start a new chat to switch." : "This preview answers about products for individuals."}</p>
            </section>
            <section className="ctx-sec">
              <h3>Pinned</h3>
              {pins && pins.length > 0 && (
                <ul className="pins" id="pins">
                  {pins.map((p) => (
                    <li key={p.id} className="pin">
                      <span className="ic" aria-hidden="true"><PinKindIcon kind={p.kind} /></span>
                      <button type="button" className="pin-open" onClick={() => openPin(p)}>
                        <b>{p.title}</b><small>{p.meta}</small>
                      </button>
                      <button type="button" className="icon-btn" aria-label={`Unpin ${p.title}`}
                        onClick={() => void unpinMutation({ pinId: p.id }).then(() => announce("Unpinned."), () => announce("Couldn’t unpin this card."))}><XIcon /></button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="empty-note" hidden={!pins || pins.length > 0}>Pin a comparison or a simulation to keep it here.</p>
            </section>
            <section className="ctx-sec">
              <h3>Sources in this chat</h3>
              <ul className="srcs" id="srcs">
                {sources.map((s) => (
                  <li key={s.url} className={s.url === litSource ? "src-item lit" : "src-item"} data-src-item={s.url}>
                    <FileTextIcon />
                    {isWebSource(s.url)
                      ? <div><a href={s.url} target="_blank" rel="noreferrer"><b>{s.title}</b></a><small>{new URL(s.url).hostname} · collected {dateOf(Date.parse(s.collectedOn))}</small></div>
                      : <div><b>{s.title}</b><small>Sample data in this preview</small></div>}
                  </li>
                ))}
              </ul>
              <p className="empty-note" hidden={sources.length > 0}>Every number Raiffy gives you will show its source here.</p>
            </section>
            {activeTrack === "personal" && <MemoryPanel track={activeTrack} memories={memoryState?.memories} writesEnabled={memoryState?.writesEnabled} />}
            <section className="ctx-sec">
              <div className="promise"><ShieldCheckIcon /><span>Raiffy uses dated public sources from Raiffeisen, ING and BCR, and only the sample account data you switch on above. It cannot move money or approve credit.</span></div>
            </section>
          </div>
        </aside>
      </div>

      <div className="scrim" id="scrim" hidden={!drawer} onClick={closeDrawers} />
      <p className="sr-only" aria-live="polite" id="announce">{liveMsg}</p>
    </div>
  );
}

function uniqueSources(list: Message[]): Source[] {
  const seen = new Map<string, Source>();
  for (const m of list) for (const s of m.answer?.sources ?? []) if (!seen.has(s.url)) seen.set(s.url, s);
  return [...seen.values()];
}

function UserBubble({ text, attachment, enter }: { text: string; attachment?: Attachment; enter?: boolean }) {
  return (
    <div className={enter ? "msg msg-user enter" : "msg msg-user"}>
      <div className="bubble">{text}</div>
      {attachment && <span className="file-chip"><span className="ft"><FileTextIcon /></span><span className="fn">Statement</span><small>Sample</small></span>}
    </div>
  );
}

/** The statement the paperclip attaches: the sample customer's last complete month, which is what Raiffy reads. */
function statementName(now = new Date()) {
  const month = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `Statement, ${month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`;
}

type AssistantProps = {
  m: Message; onGrow: () => void; vote?: "up" | "down"; onVote: (v: "up" | "down") => void; onCopy: () => void;
  why?: VoteReason; onWhy: (reason: VoteReason) => void;
  onRetry: () => void; retryDisabled: boolean; onFollowUp: (prompt: string, reply?: Reply) => void; latest: boolean;
  threadId: ThreadId | null; reading: boolean; onRead: () => void;
  track: Track; memory?: { pendingIds: ReadonlySet<string>; savedTexts: ReadonlySet<string> };
  /** Answer checks in this conversation by message id; null while they can't be loaded. */
  checks: ReadonlyMap<string, AnswerCheck> | null; announce: (msg: string) => void;
  litSource: string | null; onLight: (url: string | null, reveal?: boolean) => void;
  pinned: boolean; onPin: (input: PinInput) => void;
};

function AssistantMessage({ m, threadId, onGrow, vote, onVote, why, onWhy, onCopy, onRetry, retryDisabled, onFollowUp, latest, track, memory, checks, announce, litSource, onLight, pinned, onPin, reading, onRead }: AssistantProps) {
  const memoryBlock = m.answer?.ui?.blocks?.find((b): b is MemoryBlock => b.type === "memory");
  const handoff = m.answer?.ui?.actions.find((a) => a.kind === "handoff");
  const steps = m.answer?.searches ?? m.steps ?? [];
  const streaming = m.status === "streaming";
  const [booking, setBooking] = useState(false);
  // Sources and actions rise in only for a reply this tab watched arrive, not for history being reopened
  const [arrivedLive] = useState(streaming);
  const root = useRef<HTMLDivElement>(null);
  const check = checks?.get(m._id);
  const [drafting, setDrafting] = useState(false);
  const canCheck = !!checks && !check && !drafting && canAskSpecialist(m.answer?.status);
  const sources = m.answer?.sources ?? [];
  const pinInput = useMemo(() => pinFor(m.answer?.ui?.blocks ?? []), [m.answer]);
  const cite = (url?: string) => { const i = sources.findIndex((s) => s.url === url); return i < 0 ? null : <span className="cite" title={sources[i]!.title}>{i + 1}</span>; };
  /** One content card; AnswerText places it in the answer after the paragraph that introduces it (lib/card-placement). */
  const renderCard = (b: UiBlock): ReactNode =>
    isAffordability(b) ? <AffordabilityCard block={b} />
    : isSpending(b) ? <div className="answer-cards"><SpendingCard block={b} cite={cite} /></div>
    : isOffer(b) ? <div className="answer-cards"><OfferCard block={b} latest={latest} cite={cite} /></div>
    : isCompare(b) ? <CompareTable block={b} sources={sources} />
    : b.type === "simulation" && threadId && !streaming
      ? <><AnswerCards blocks={[b]} sources={sources} onAsk={(text) => onFollowUp(text)} onBook={() => setBooking(true)}
          simulationFoot={(pick) => <PlanBuild messageId={m._id} threadId={threadId} pick={pick} announce={announce} />} />
        <PlanForAnswer messageId={m._id} threadId={threadId} /></>
    : <AnswerCards blocks={[b]} sources={sources} onAsk={(text) => onFollowUp(text)} onBook={() => setBooking(true)} />;

  return (
    <div ref={root} id={`m-${m._id}`} className={streaming ? "msg msg-raiffy enter" : "msg msg-raiffy"} aria-busy={streaming}>
      <span className="ava-raiffy" aria-hidden="true"><CompassIcon /></span>
      <div className="raiffy-body">
        {streaming
          ? <div className="think think-live"><ol className="think-lines" aria-label="Raiffy is working"><ThinkLines lines={["Classifying your banking inquiry…", ...stepLines(steps)]} live /></ol></div>
          : steps.length > 0 && <Thinking lines={stepLines(steps)} />}

        <div className="raiffy-text">
          {!streaming && (m.answer ? <AnswerText answer={m.answer} animate={arrivedLive} onGrow={onGrow} renderCard={renderCard} /> : m.text && <p className="answer">{m.text}</p>)}
          {!streaming && memoryBlock && <MemoryProposals block={memoryBlock} track={track} pendingIds={memory?.pendingIds} savedTexts={memory?.savedTexts} />}
          {!streaming && handoff && !booking && <SpecialistOffer threadId={threadId} label={handoff.label} />}
          {streaming && <p className="sr-only">Raiffy is answering…</p>}
          {m.status === "stopped" && <p className="stopped">You stopped this reply.</p>}
          {m.status === "failed" && (
            <p className="stopped failed">{m.error ?? "Raiffy couldn’t finish this answer."}{" "}
              <button type="button" className="retry" onClick={onRetry} disabled={retryDisabled}><RotateCcwIcon />Try again</button>
            </p>
          )}
          {m.answer?.status === "refused" && <p className="stopped">Raiffy can’t help with that one. Try asking about a Raiffeisen product.</p>}
          {m.answer && <p className="answer-notice">AI assistant · Indicative information. Source dates appear below.</p>}
        </div>

        {/* A request for a person gets the booking card; only the customer's click books */}
        {!streaming && m.answer?.routing?.handler === "human_contact" && <BookingCard threadId={threadId} />}

        {/* The handoff card's button opens the same booking card as the specialist button */}
        {!streaming && booking && <BookingCard threadId={threadId} />}

        {!streaming && m.answer?.ui?.blocks?.map((b, i) => b.type === "inputs_request" &&
          <InputsCard key={i} fields={b.fields} active={latest && !retryDisabled}
            onSubmit={(text, values) => onFollowUp(text, { kind: "inputs", values })} />)}

        {m.status !== "streaming" && m.status !== "failed" && m.status !== "stopped" && (
          <div className={arrivedLive ? "gfoot enter" : "gfoot"}>
            {m.answer?.sources.map((s, i) => {
              // Hover or focus lights the source in the Context panel; a web source still opens its page
              const light = { onMouseEnter: () => onLight(s.url), onMouseLeave: () => onLight(null), onFocus: () => onLight(s.url), onBlur: () => onLight(null) };
              const cls = s.url === litSource ? " lit" : "";
              const label = <><span className="src-n">{i + 1}</span><span className="src-t">{s.title}</span></>;
              return isWebSource(s.url)
                ? <a key={s.id} className={`src${cls}`} href={s.url} target="_blank" rel="noreferrer" title={s.title} {...light}>{label}</a>
                : <button key={s.id} type="button" className={`src local${cls}`} title={s.title} {...light} onClick={() => onLight(s.url, true)}>{label}</button>;
            })}
            {canCheck && <AnswerCheckButton onOpen={() => setDrafting(true)} />}
            <div className="acts">
              {pinInput && <button type="button" className="icon-btn" aria-pressed={pinned} aria-label="Pin to context" onClick={() => onPin(pinInput)}><PinIcon /></button>}
              <button type="button" className="icon-btn voice-read" aria-label={reading ? "Stop reading answer" : "Read answer aloud"}
                aria-pressed={reading} onClick={onRead} disabled={retryDisabled && !reading}>{reading ? <SquareIcon /> : <Volume2Icon />}</button>
              <button type="button" className="icon-btn" aria-label="Copy answer" onClick={onCopy}><CopyIcon /></button>
              <button type="button" className="icon-btn" aria-pressed={vote === "up"} aria-label="Helpful" onClick={() => onVote("up")}><ThumbsUpIcon /></button>
              <button type="button" className="icon-btn" aria-pressed={vote === "down"} aria-label="Not helpful" onClick={() => onVote("down")}><ThumbsDownIcon /></button>
            </div>
          </div>
        )}
        {!streaming && <AnswerCheckZone messageId={m._id} check={check} drafting={drafting} announce={announce}
          onClose={(sent) => {
            setDrafting(false);
            // Cancel returns focus to the button it came from
            if (!sent) requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[data-act="verify"]')?.focus());
          }} />}
        {vote === "down" && (
          <div className="vote-why" role="group" aria-label="What was wrong?">
            <span>What was wrong?</span>
            {VOTE_REASONS.map(([key, label]) => (
              <button key={key} type="button" className="vbtn" aria-pressed={why === key} onClick={() => onWhy(key)}>{label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const UNIT: Record<string, string> = { RON: "lei", months: "months", "%": "%" };
const groupDigits = (n: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(n);

/**
 * Only the missing required inputs, at most three. The customer can fill it in or answer in the composer; either way the
 * server validates the values against what it asked for. Only the newest card is active.
 */
function InputsCard({ fields, active, onSubmit }: { fields: InputField[]; active: boolean; onSubmit: (text: string, values: Record<string, string | number>) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const [missing, setMissing] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const disabled = !active || sent;
  const numberOf = (raw: string) => Number(raw.replace(/[\s.,](?=\d{3}\b)/g, "").replace(",", "."));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const out: Record<string, string | number> = {}; const parts: string[] = [];
    for (const f of fields) {
      const raw = (values[f.key] ?? "").trim();
      const n = numberOf(raw);
      const ok = f.kind === "choice" ? !!raw : raw !== "" && Number.isFinite(n) && n >= (f.min ?? 0) && n <= (f.max ?? Infinity);
      if (!ok) { setMissing(f.key); form.current?.querySelector<HTMLElement>(`[data-key="${f.key}"] input, [data-key="${f.key}"] button`)?.focus(); return; }
      out[f.key] = f.kind === "choice" ? raw : n;
      parts.push(`${f.label}: ${f.kind === "choice" ? f.options?.find(o => o.value === raw)?.label ?? raw : `${groupDigits(n)} ${UNIT[f.unit ?? ""] ?? ""}`.trim()}`);
    }
    setSent(true);
    onSubmit(parts.join(" · "), out);
  }

  return (
    <div className="gcard">
      <div className="gc-h"><span><ListChecksIcon aria-hidden="true" />A few details</span><span className="micro">{fields.length} {fields.length === 1 ? "question" : "questions"}</span></div>
      <form ref={form} className="gc-b inputs-form" noValidate onSubmit={submit} data-done={disabled ? "" : undefined}>
        {fields.map(f => f.kind === "choice"
          ? (
            <fieldset key={f.key} className="inp" data-key={f.key}>
              <legend>{f.label}</legend>
              <div className="inp-opts">
                {f.options?.map(o => (
                  <button key={o.value} type="button" aria-pressed={values[f.key] === o.value} disabled={disabled}
                    onClick={() => { setValues(v => ({ ...v, [f.key]: o.value })); setMissing(null); }}>{o.label}</button>
                ))}
              </div>
              {missing === f.key && <small role="alert">Choose one, or answer in your own words below.</small>}
            </fieldset>
          ) : (
            <div key={f.key} className="inp" data-key={f.key}>
              <label htmlFor={`inp-${f.key}`}>{f.label}</label>
              <div className="inp-box">
                <input id={`inp-${f.key}`} inputMode="decimal" autoComplete="off" disabled={disabled} value={values[f.key] ?? ""}
                  aria-invalid={missing === f.key || undefined} aria-describedby={f.hint || missing === f.key ? `inp-${f.key}-h` : undefined}
                  onChange={e => { setValues(v => ({ ...v, [f.key]: e.target.value })); setMissing(null); }} />
                <span>{UNIT[f.unit ?? ""]}</span>
              </div>
              {(f.hint || missing === f.key) && <small id={`inp-${f.key}-h`} role={missing === f.key ? "alert" : undefined}>
                {missing === f.key ? "Enter a number, or answer in your own words below." : f.hint}</small>}
            </div>
          ))}
        <div className="inputs-foot">
          <p>{sent ? "Sent." : "Or answer in your own words below."}</p>
          <button type="submit" className="btn btn-dark" disabled={disabled}>Continue</button>
        </div>
      </form>
    </div>
  );
}

/**
 * The final answer with its citations: each cited sentence ends in the number of its source chip below.
 * Text is parsed from Raiffy's Markdown subset (lib/markup.ts) into paragraphs, lists, bold and italic; the reveal
 * counts visible characters only, so markers never flash and a list item appears once its first word does.
 */
/** The names and labels an answer's cards show, which its text lists then leave out. */
function cardNames(blocks: UiBlock[]): string[] {
  return blocks.flatMap((b) => {
    switch (b.type) {
      case "keyFacts": return b.facts.map((f) => f.label);
      case "checklist": return b.items.map((it) => it.text);
      // The routes block reshaped from the answer text ("state" set) shows nothing the text doesn't.
      case "routes": return "state" in b ? [] : b.routes.map((r) => r.name);
      case "comparison": return b.options.map((o) => o.name);
      case "spending": return b.categories.map((c) => categoryLabel(c.category));
      case "offer": return [b.quote.unconditional.label, ...b.quote.conditional.map((l) => l.label)];
      case "compare_table": return b.table.products.map((p) => p.name);
      default: return [];
    }
  });
}

/** The answer's content cards, which sit inside the text; booking, inputs and memory cards stay below it. */
const isContentCard = (b: UiBlock) => isAnswerCard(b) || isAffordability(b) || isSpending(b) || isOffer(b) || isCompare(b);

function AnswerText({ answer, animate, onGrow, renderCard }: { answer: Answer; animate: boolean; onGrow: () => void; renderCard: (b: UiBlock) => ReactNode }) {
  const number = new Map(answer.sources.map((s, i) => [s.id, i + 1]));
  const byId = new Map(answer.sources.map((s) => [s.id, s]));
  const parsed = useMemo(() => {
    const segments = answer.segments.length ? answer.segments : [{ text: answer.text, sourceIds: [] }];
    return parseAnswer(segments.map((s) => s.text).join(""), segmentCites(segments));
  }, [answer]);
  const text = parsed.plain;
  // List items an answer card already shows (by name or label) aren't repeated in the text.
  const blocks = useMemo(() => withoutShown(parsed.blocks, cardNames(answer.ui?.blocks ?? [])), [parsed, answer]);
  // Content cards sit after the paragraph that introduces them and appear once it has typed out (lib/card-placement).
  const cards = useMemo(() => (answer.ui?.blocks ?? []).filter(isContentCard), [answer]);
  const placed = useMemo(() => placeCards(blocks, cards, answer.sources), [blocks, cards, answer]);
  const cardId = useId();
  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)");
  const reveal = animate && !reducedMotion;
  const [visible, setVisible] = useState(0);
  const shown = reveal ? visible : text.length;
  useEffect(() => {
    if (!reveal) return;
    const boundaries = [...text.matchAll(/\S+\s*/g)].map(m => m.index! + m[0].length);
    let word = 0;
    const timer = window.setInterval(() => {
      word++;
      setVisible(boundaries[Math.min(word, boundaries.length) - 1] ?? text.length);
      onGrow();
      if (word >= boundaries.length) window.clearInterval(timer);
    }, 25);
    return () => window.clearInterval(timer);
  }, [reveal, text, onGrow]);

  const cites = (ids: string[]) => ids.map((id) => {
    const s = byId.get(id);
    if (!s) return null;
    if (!isWebSource(s.url)) return <span key={id} className="cite" aria-label={`Source ${number.get(id)}: ${s.title}`} title={s.title}>{number.get(id)}</span>;
    return (
      <a key={id} className="cite" href={s.url} target="_blank" rel="noreferrer" aria-label={`Source ${number.get(id)}: ${s.title}`} title={s.title}>
        {number.get(id)}
      </a>
    );
  });
  const run = (r: Run) => {
    if (r.v >= shown) return null;
    const count = Math.min(r.text.length, shown - r.v);
    const parts: ReactNode[] = [];
    let at = 0;
    for (const c of r.cites) {
      if (c.pos > count) break;
      parts.push(r.text.slice(at, c.pos), <Fragment key={`c${c.pos}`}>{cites(c.ids)}</Fragment>);
      at = c.pos;
    }
    parts.push(r.text.slice(at, count));
    // The caret follows the last revealed character
    if (shown < text.length && r.v + count === shown) parts.push(<span key="caret" className="caret" aria-hidden="true" />);
    const inner = r.italic ? <em>{parts}</em> : <>{parts}</>;
    return <Fragment key={r.from}>{r.bold ? <strong>{inner}</strong> : inner}</Fragment>;
  };
  const started = (line: Line | undefined) => !!line?.length && line[0]!.v < shown;
  const lines = (ls: Line[]) => ls.filter(started).map((l, i) => <Fragment key={l[0]!.from}>{i > 0 && <br />}{l.map(run)}</Fragment>);
  const list = (l: List): ReactNode => {
    const items = l.items.filter((it) => started(it.lines[0]));
    if (!items.length) return null;
    const children = items.map((it) => <li key={it.lines[0]![0]!.from}>{lines(it.lines)}{it.sub && list(it.sub)}</li>);
    return l.ordered ? <ol start={l.start}>{children}</ol> : <ul>{children}</ul>;
  };
  // A list of 2+ items renders as a card, like the other answer components (DESIGN.md: answer list card).
  // A short "Conditions to check:" line right before it becomes the card's title.
  const isCard = (b: Block | undefined): b is List => b?.kind === "list" && b.items.length > 1;
  const fallbackTitle = answer.routing?.inquiry === "listing" ? "Overview" : "Key points";
  const card = (l: List, i: number): ReactNode => {
    const items = l.items.filter((it) => started(it.lines[0]));
    if (!items.length) return null;
    const head = listTitle(blocks[i - 1]);
    const id = `${cardId}-${i}`;
    const Icon = l.ordered ? ListOrderedIcon : ListIcon;
    const rows = items.map((it, k) => {
      const { label, body } = splitItem(it.lines);
      return (
        <li key={it.lines[0]![0]!.from}>
          {l.ordered && <span className="lc-n" aria-hidden="true">{l.start + k}</span>}
          <div className="lc-t">
            {label && <span className="lc-l">{label.map((r) => run({ ...r, bold: false }))}</span>}
            {body.some(started) && <span className="lc-d">{lines(body)}</span>}
            {it.sub && list(it.sub)}
          </div>
        </li>
      );
    });
    return (
      <div key={i} className={`gcard list-card${reveal ? " enter" : ""}`}>
        <div className="gc-h">
          <span id={id}><Icon aria-hidden="true" />{head?.title ?? fallbackTitle}</span>
          <span className="micro">{l.items.length} {l.ordered ? "steps" : "items"}</span>
        </div>
        {l.ordered
          ? <ol className="lc-rows" start={l.start} aria-labelledby={id}>{rows}</ol>
          : <ul className="lc-rows" aria-labelledby={id}>{rows}</ul>}
      </div>
    );
  };
  // A lead-in that becomes a list card's title is drawn inside that card, so its cards follow the list card.
  const anchor = (i: number) => i >= 0 && isCard(blocks[i + 1]) && listTitle(blocks[i]!) ? i + 1 : i;
  const slot = (i: number) => {
    const here = cards.filter((_, k) => anchor(placed[k]!) === i);
    if (!here.length || shown < (i < 0 ? text.length : blockEnd(blocks[i]!))) return null;
    return (
      <div key={`cards-${i}`} className={`card-slot${reveal ? " enter" : ""}`}>
        {here.map((b, k) => <Fragment key={k}>{renderCard(b)}</Fragment>)}
      </div>
    );
  };
  return (
    <div className="answer">
      {blocks.map((b, i) => {
        const body = b.kind === "list" ? (isCard(b) ? card(b, i) : <Fragment key={i}>{list(b)}</Fragment>)
          : isCard(blocks[i + 1]) && listTitle(b) ? null // shown as the card's title
          : b.lines.some(started) ? <p key={i}>{lines(b.lines)}</p> : null;
        return <Fragment key={i}>{body}{slot(i)}</Fragment>;
      })}
      {slot(-1)}
    </div>
  );
}

const PIN_ICONS: Record<PinKind, typeof PinIcon> = {
  comparison: ScaleIcon, compare_table: ScaleIcon, routes: SignpostIcon, keyFacts: InfoIcon, checklist: ListChecksIcon,
  simulation: CalculatorIcon, offer: BadgePercentIcon, spending: ChartColumnIcon, affordability: CalculatorIcon,
};
function PinKindIcon({ kind }: { kind: PinKind }) { const Icon = PIN_ICONS[kind] ?? PinIcon; return <Icon />; }

/** The chat name, edited in place of the title (chat.html .title-input). */
function RenameField({ title, onDone }: { title: string; onDone: (title: string | null) => void }) {
  const field = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (value: string | null) => { if (done.current) return; done.current = true; onDone(value); };
  useEffect(() => { field.current?.focus(); field.current?.select(); }, []);
  return (
    <input ref={field} className="title-input" defaultValue={title} aria-label="Chat name" maxLength={80}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); finish(e.currentTarget.value); }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); }
      }}
      onBlur={(e) => finish(e.currentTarget.value)} />
  );
}
