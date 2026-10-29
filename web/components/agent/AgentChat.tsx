"use client";

import { Fragment, useCallback, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { useClerk, useUser } from "@clerk/nextjs";
import {
  ArrowDownIcon, ArrowUpIcon, BriefcaseIcon, CompassIcon, CopyIcon, FileTextIcon, HeadsetIcon, ListChecksIcon, ListIcon, ListOrderedIcon, LogOutIcon, MenuIcon,
  MessageCircleIcon, PanelRightCloseIcon, PanelRightOpenIcon, RotateCcwIcon, SearchIcon, ShieldCheckIcon, SquareIcon, SquarePenIcon, ThumbsDownIcon,
  ThumbsUpIcon, UserIcon, XIcon,
} from "lucide-react";
import { agentApi, memoryApi, isWebSource, type Answer, type MemoryBlock, type InputField, type Message, type Reply, type Source, type ThreadId, type ThreadSummary, type Track, type UiAction, type UiBlock, VOTE_REASONS, type VoteReason } from "@/lib/agent-api";
import { errorInfo, logChatError } from "@/lib/chat-log";
import { AnswerCards } from "@/components/agent/AnswerCards";
import { AccessPanel } from "@/components/agent/AccessPanel";
import { BookingCard } from "@/components/booking/BookingCard";
import { SpendingCard, categoryLabel, isSpending } from "@/components/agent/SpendingCard";
import { OfferCard, isOffer } from "@/components/agent/OfferCard";
import { CompareTable, isCompare } from "@/components/agent/CompareTable";
import { StarterVignette, type StarterVignetteKind } from "@/components/agent/StarterVignettes";
import { listTitle, parseAnswer, segmentCites, splitItem, withoutShown, type Block, type Line, type List, type Run } from "@/lib/markup";
import { MemoryPanel, MemoryProposals } from "./Memory";
import { AdviserHandoff } from "./Handoff";
import { GroupList, Thinking, ThinkLines, prefersReducedMotion, useIsMac, useMedia } from "@/components/chat/parts";

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

export function AgentChat() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const threads = useQuery(agentApi.listThreads, {});
  const [threadId, setThreadId] = useState<ThreadId | null>(null);
  const messages = useQuery(agentApi.listMessages, threadId ? { threadId } : "skip");
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
  const [pending, setPending] = useState<{ text: string; base: number } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [drawer, setDrawerState] = useState<"side" | "ctx" | null>(null);
  const [ctxClosed, setCtxClosedState] = useState(false);
  // Off until the saved choice is applied, so a closed panel doesn't animate shut on load
  const [ctxAnimate, setCtxAnimate] = useState(false);
  const [liveMsg, setLiveMsg] = useState("");
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
  async function send(text: string, reply?: Reply) {
    const question = text.trim();
    if (!question || busy) return;
    setSendError(null);
    setPending({ text: question, base: list.length });
    setInput("");
    stick.current = true;
    try {
      const r = await sendMutation({ question, track: activeTrack, ...(threadId ? { threadId } : {}), ...(reply && threadId ? { reply } : {}) });
      if (!threadId) { announced.current = null; setThreadId(r.threadId); }
      startedHere.current.add(r.messageId);
      void runAction({ messageId: r.messageId }).catch((error: unknown) => {
        logChatError("agent:run failed", { threadId: r.threadId, messageId: r.messageId, ...errorInfo(error) });
        setSendError("The reply was interrupted. Stop it and try again.");
      });
    } catch (error) {
      logChatError("agent:send failed", { threadId, hasReply: !!reply, ...errorInfo(error) });
      setPending(null);
      setInput(question);
      setSendError("Your question didn't reach Raiffy. Check your connection and try again.");
    }
  }
  function stop() { if (streaming) void stopMutation({ messageId: streaming._id }); }

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); }
  }

  function openThread(id: ThreadId | null) {
    setThreadId(id);
    setPending(null);
    setSendError(null);
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
    const o = opener.current;
    // After the commit: until then the page behind the drawer is still inert and can't take focus
    if (was && o instanceof HTMLElement) window.setTimeout(() => { if (document.contains(o)) o.focus(); }, 0);
  }
  const ctxOpen = narrowCtx ? drawer === "ctx" : !ctxClosed;

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
  const appClass = ["app", drawer === "side" && "side-open", drawer === "ctx" && "ctx-open", ctxClosed && "ctx-closed", !ctxAnimate && "no-anim"].filter(Boolean).join(" ");
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
              <div id="title-box"><h1 id="title">{thread?.title ?? "New chat"}</h1><span className="meta" id="meta">{meta}</span></div>
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

          <div className="scroll" id="scroll" ref={scroller} onScroll={() => {
            const s = scroller.current!;
            stick.current = s.scrollHeight - s.scrollTop - s.clientHeight < 80;
            if (stick.current) jumpBtn.current!.hidden = true;
          }}>
            <div className="thread" id="thread" role="log" aria-label="Conversation with Raiffy" hidden={empty}>
              {list.map((m, i) => (m.role === "user"
                ? <UserBubble key={m._id} text={m.text} />
                : <AssistantMessage key={m._id} m={m} threadId={threadId} onGrow={follow} vote={votes[m._id]} why={whys[m._id]} track={activeTrack} memory={memoryView}
                    onFollowUp={(prompt, reply) => void send(prompt, reply)}
                    latest={i === list.length - 1}
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
                    retryDisabled={busy} />))}
              {showPending && (
                <>
                  <UserBubble text={pending.text} enter />
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
            <form className="composer" id="composer" onSubmit={(e) => { e.preventDefault(); if (streaming) stop(); else void send(input); }}>
              <label className="sr-only" htmlFor="input">Message Raiffy</label>
              <textarea id="input" ref={inputEl} rows={1} enterKeyHint="send" value={input} maxLength={2000}
                placeholder={threadId ? "Ask a follow-up" : activeTrack === "business" ? "Ask about a product for your business…" : "Ask about an account, a card, a loan, your savings…"}
                onChange={(e) => setInput(e.target.value)} onKeyDown={onComposerKey} />
              <div className="comp-row">
                <span className="track-note">{TRACKS.find((t) => t.k === activeTrack)?.label ?? "Business profile"}</span>
                <button type="submit" className={streaming ? "btn btn-dark send is-stop" : "btn btn-dark send"} id="send"
                  aria-label={streaming ? "Stop reply" : "Send message"} disabled={!streaming && (showPending || !input.trim())}>
                  <span className="i-send"><ArrowUpIcon /></span><span className="i-stop"><SquareIcon /></span>
                </button>
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
              <h3>Sources in this chat</h3>
              <ul className="srcs" id="srcs">
                {sources.map((s) => (
                  <li key={s.url} className="src-item">
                    <FileTextIcon />
                    {isWebSource(s.url)
                      ? <div><a href={s.url} target="_blank" rel="noreferrer"><b>{s.title}</b></a><small>{new URL(s.url).hostname} · collected {dateOf(Date.parse(s.collectedOn))}</small></div>
                      : <div><b>{s.title}</b><small>Sample data in this preview</small></div>}
                  </li>
                ))}
              </ul>
              <p className="empty-note" hidden={sources.length > 0}>Every number Raiffy gives you will show its source here.</p>
            </section>
            {activeTrack === "personal" && <MemoryPanel track={activeTrack} memories={memoryState?.memories} />}
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

function UserBubble({ text, enter }: { text: string; enter?: boolean }) {
  return <div className={enter ? "msg msg-user enter" : "msg msg-user"}><div className="bubble">{text}</div></div>;
}

type AssistantProps = {
  m: Message; onGrow: () => void; vote?: "up" | "down"; onVote: (v: "up" | "down") => void; onCopy: () => void;
  why?: VoteReason; onWhy: (reason: VoteReason) => void;
  onRetry: () => void; retryDisabled: boolean; onFollowUp: (prompt: string, reply?: Reply) => void; latest: boolean;
  threadId: ThreadId | null;
  track: Track; memory?: { pendingIds: ReadonlySet<string>; savedTexts: ReadonlySet<string> };
};

/** Pressing a reply: a follow-up is plain text; a choice or "skip" also tells the server which offer was taken. */
function replyFor(a: UiAction): Reply | undefined {
  return a.kind === "choose" ? { kind: "choose", inquiry: a.inquiry } : a.kind === "skip_inputs" ? { kind: "skip_inputs" } : undefined;
}

function AssistantMessage({ m, threadId, onGrow, vote, onVote, why, onWhy, onCopy, onRetry, retryDisabled, onFollowUp, latest, track, memory }: AssistantProps) {
  const memoryBlock = m.answer?.ui?.blocks?.find((b): b is MemoryBlock => b.type === "memory");
  const handoff = m.answer?.ui?.actions.find((a) => a.kind === "handoff");
  const steps = m.answer?.searches ?? m.steps ?? [];
  const streaming = m.status === "streaming";
  // Sources and actions rise in only for a reply this tab watched arrive, not for history being reopened
  const [arrivedLive] = useState(streaming);

  return (
    <div className={streaming ? "msg msg-raiffy enter" : "msg msg-raiffy"} aria-busy={streaming}>
      <span className="ava-raiffy" aria-hidden="true"><CompassIcon /></span>
      <div className="raiffy-body">
        {streaming
          ? <div className="think think-live"><ol className="think-lines" aria-label="Raiffy is working"><ThinkLines lines={["Classifying your banking inquiry…", ...stepLines(steps)]} live /></ol></div>
          : steps.length > 0 && <Thinking lines={stepLines(steps)} />}

        <div className="raiffy-text">
          {!streaming && (m.answer ? <AnswerText answer={m.answer} animate={arrivedLive} onGrow={onGrow} /> : m.text && <p className="answer">{m.text}</p>)}
          {!streaming && memoryBlock && <MemoryProposals block={memoryBlock} track={track} pendingIds={memory?.pendingIds} savedTexts={memory?.savedTexts} />}
          {!streaming && handoff && <AdviserHandoff messageId={m._id} label={handoff.label} reason={handoff.reason} />}
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

        {!streaming && m.answer?.ui?.blocks && (
          <AnswerCards blocks={m.answer.ui.blocks} sources={m.answer.sources} onAsk={(text) => onFollowUp(text)} />
        )}

        {!streaming && m.answer?.ui?.blocks?.filter(isSpending).map((b) => (
          <div className="answer-cards" key={b.sourceUrl}>
            <SpendingCard block={b} cite={(url) => { const i = m.answer!.sources.findIndex((s) => s.url === url); return i < 0 ? null : <span className="cite" title={m.answer!.sources[i]!.title}>{i + 1}</span>; }} />
          </div>
        ))}

        {!streaming && m.answer?.ui?.blocks?.filter(isOffer).map((b) => (
          <div className="answer-cards" key={b.logId ?? b.sourceUrl}>
            <OfferCard block={b} latest={latest} cite={(url) => { const i = m.answer!.sources.findIndex((s) => s.url === url); return i < 0 ? null : <span className="cite" title={m.answer!.sources[i]!.title}>{i + 1}</span>; }} />
          </div>
        ))}

        {!streaming && m.answer?.ui?.blocks?.filter(isCompare).map((b) => <CompareTable key={b.title} block={b} sources={m.answer!.sources} />)}

        {!streaming && m.answer?.ui?.blocks?.map((b, i) => b.type === "inputs_request" &&
          <InputsCard key={i} fields={b.fields} active={latest && !retryDisabled}
            onSubmit={(text, values) => onFollowUp(text, { kind: "inputs", values })} />)}

        {m.status !== "streaming" && m.status !== "failed" && m.status !== "stopped" && (
          <div className={arrivedLive ? "gfoot enter" : "gfoot"}>
            {m.answer?.sources.map((s, i) => (
              isWebSource(s.url)
                ? <a key={s.id} className="src" href={s.url} target="_blank" rel="noreferrer" title={s.title}>
                  <span className="src-n">{i + 1}</span><span className="src-t">{s.title}</span>
                </a>
                : <span key={s.id} className="src local" title={s.title}><span className="src-n">{i + 1}</span><span className="src-t">{s.title}</span></span>
            ))}
            {m.answer?.ui?.actions.map(a => a.kind !== "handoff" && <button key={a.prompt} className="qbtn" disabled={retryDisabled || (a.kind !== "followup" && !latest)}
              onClick={() => onFollowUp(a.prompt, replyFor(a))}>{a.label}</button>)}
            <div className="acts">
              <button type="button" className="icon-btn" aria-label="Copy answer" onClick={onCopy}><CopyIcon /></button>
              <button type="button" className="icon-btn" aria-pressed={vote === "up"} aria-label="Helpful" onClick={() => onVote("up")}><ThumbsUpIcon /></button>
              <button type="button" className="icon-btn" aria-pressed={vote === "down"} aria-label="Not helpful" onClick={() => onVote("down")}><ThumbsDownIcon /></button>
            </div>
          </div>
        )}
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

function AnswerText({ answer, animate, onGrow }: { answer: Answer; animate: boolean; onGrow: () => void }) {
  const number = new Map(answer.sources.map((s, i) => [s.id, i + 1]));
  const byId = new Map(answer.sources.map((s) => [s.id, s]));
  const parsed = useMemo(() => {
    const segments = answer.segments.length ? answer.segments : [{ text: answer.text, sourceIds: [] }];
    return parseAnswer(segments.map((s) => s.text).join(""), segmentCites(segments));
  }, [answer]);
  const text = parsed.plain;
  // List items an answer card already shows (by name or label) aren't repeated in the text.
  const blocks = useMemo(() => withoutShown(parsed.blocks, cardNames(answer.ui?.blocks ?? [])), [parsed, answer]);
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
  return (
    <div className="answer">
      {blocks.map((b, i) => {
        if (b.kind === "list") return isCard(b) ? card(b, i) : <Fragment key={i}>{list(b)}</Fragment>;
        if (isCard(blocks[i + 1]) && listTitle(b)) return null; // shown as the card's title
        return b.lines.some(started) ? <p key={i}>{lines(b.lines)}</p> : null;
      })}
    </div>
  );
}
