"use client";

import { Fragment, useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { useClerk, useUser } from "@clerk/nextjs";
import {
  ArrowDownIcon, ArrowUpIcon, BriefcaseIcon, CompassIcon, CopyIcon, FileTextIcon, HeadsetIcon, LogOutIcon, MenuIcon,
  MessageCircleIcon, PanelRightIcon, RotateCcwIcon, SearchIcon, ShieldCheckIcon, SquareIcon, SquarePenIcon, ThumbsDownIcon,
  ThumbsUpIcon, UserIcon, XIcon,
} from "lucide-react";
import { agentApi, type Answer, type Message, type RoutesBlock, type Source, type ThreadId, type ThreadSummary, type Track } from "@/lib/agent-api";
import { answerView, type Piece } from "@/lib/answer-view";
import { RouteCards } from "./RouteCards";
import { GroupList, Thinking, ThinkLines, prefersReducedMotion, useIsMac, useMedia } from "@/components/chat/parts";

/*
 * The live chat uses authenticated Convex requests and reactive progress. Checked final text reveals word by
 * word; model drafts never reach the browser. Sources and ownership come from the server.
 */

const TRACKS: { k: Track; label: string; icon: typeof UserIcon; note: string }[] = [
  { k: "personal", label: "For me", icon: UserIcon, note: "Products for individuals: accounts, cards, loans, savings." },
];

const STARTERS: Record<Track, { prompt: string; title: string; hint: string; search: string }[]> = {
  personal: [
    { prompt: "How do Raiffeisen term deposits work, and what conditions should I check?", title: "How term deposits work", hint: "Conditions and product documents", search: "depozit la termen conditii" },
    { prompt: "What documents do I need for a Raiffeisen personal loan?", title: "Prepare for a personal loan", hint: "The documents to check before applying", search: "credit nevoi personale acte" },
    { prompt: "What is the difference between a debit card and a credit card?", title: "Understand your cards", hint: "How debit and credit cards differ", search: "card debit card credit diferente" },
    { prompt: "Compare the documents needed for a Raiffeisen Flexicredit personal loan and a BCR George personal loan.", title: "Compare loan documents", hint: "Raiffeisen and BCR requirements", search: "Raiffeisen BCR credit documente" },
  ],
  business: [
    { prompt: "What is the maximum overdraft my company can get?", title: "Overdraft for my company", hint: "Limits and conditions", search: "linie de credit overdraft IMM" },
    { prompt: "What does a business current account cost per month?", title: "Business account costs", hint: "Packages and monthly fees", search: "pachet cont curent IMM" },
    { prompt: "How can my SRL finance new equipment?", title: "Financing equipment", hint: "Investment loans and leasing", search: "credit investitii IMM" },
    { prompt: "What documents does my company need to open an account?", title: "Opening a business account", hint: "What to prepare", search: "deschidere cont firma acte" },
  ],
};

const DAY = 86_400_000;
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
  // Safe to retry after a reload: the backend atomically starts each request at most once.
  useEffect(() => {
    const queued = messages?.find(m => m.role === "assistant" && m.status === "streaming");
    if (queued) void runAction({ messageId: queued._id }).catch(() => {});
  }, [messages, runAction]);

  const [track, setTrack] = useState<Track>("personal");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<{ text: string; base: number } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [drawer, setDrawerState] = useState<"side" | "ctx" | null>(null);
  const [ctxClosed, setCtxClosed] = useState(false);
  const [liveMsg, setLiveMsg] = useState("");
  const [votes, setVotes] = useState<Record<string, "up" | "down">>({});

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
  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setSendError(null);
    setPending({ text: question, base: list.length });
    setInput("");
    stick.current = true;
    try {
      const r = await sendMutation({ question, track: activeTrack, ...(threadId ? { threadId } : {}) });
      if (!threadId) { announced.current = null; setThreadId(r.threadId); }
      void runAction({ messageId: r.messageId }).catch(() => {
        setSendError("The reply was interrupted. Stop it and try again.");
      });
    } catch {
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
  const appClass = ["app", drawer === "side" && "side-open", drawer === "ctx" && "ctx-open", ctxClosed && "ctx-closed"].filter(Boolean).join(" ");

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
              <button type="button" className="btn btn-ghost btn-sm advisor" id="advisor-btn" aria-label="Talk to an advisor" disabled={busy}
                onClick={() => void send("How can I book a meeting with a Raiffeisen advisor?")}>
                <HeadsetIcon /><span className="advisor-lbl">Talk to an advisor</span>
              </button>
              <button type="button" className="icon-btn" id="toggle-ctx" aria-controls="ctx" aria-expanded={ctxOpen}
                aria-label={ctxOpen ? "Hide context panel" : "Show context panel"}
                onClick={(e) => { if (narrowCtx) openDrawer("ctx", e.currentTarget); else setCtxClosed((x) => !x); }}>
                <PanelRightIcon />
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
                : <AssistantMessage key={m._id} m={m} onGrow={follow} vote={votes[m._id]}
                    onFollowUp={(prompt) => void send(prompt)}
                    onVote={(v) => {
                      setVotes((x) => ({ ...x, [m._id]: v }));
                      announce(v === "up" ? "Thanks for the feedback." : "Thanks. This helps Raiffy improve.");
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

            <section className="empty enter" id="empty" hidden={!empty} aria-labelledby="greet">
              <div className="bloom" aria-hidden="true" />
              <div className="empty-head">
                <span className="ava-raiffy" aria-hidden="true"><CompassIcon /></span>
                <h2 id="greet">{greetingFor(hour)}{user?.firstName ? `, ${user.firstName}` : ""}</h2>
                <p>Explore accounts, cards, loans and savings using dated public bank sources. Exact prices and personalized offers aren’t available in this preview.</p>
              </div>
              <div className="track-pick" role="group" aria-label="Who is this for?">
                {TRACKS.map((t) => (
                  <button key={t.k} type="button" aria-pressed={track === t.k} onClick={() => setTrack(t.k)}><t.icon />{t.label}</button>
                ))}
              </div>
              <div className="starters">
                {STARTERS[track].map((s) => (
                  <button key={s.prompt} type="button" className="starter" onClick={() => { void send(s.prompt); inputEl.current?.focus(); }}>
                    <span className="mini" aria-hidden="true"><span className="mini-frag">
                    <span className="mini-line sel"><span><SearchIcon className="mini-ic" />{s.search}</span><span className="mono">Bank sources</span></span>
                    </span></span>
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
            <button type="button" className="icon-btn ctx-close" id="close-ctx" ref={closeCtxBtn} aria-label="Close context panel" onClick={closeDrawers}><XIcon /></button>
          </div>
          <div className="ctx-body">
            <section className="ctx-sec">
              <h3>Answering for</h3>
              <ul className="perms">
                {TRACKS.filter((t) => t.k === activeTrack).map((t) => (
                  <li key={t.k} className="perm"><span className="ic"><t.icon /></span><div><b>{t.label}</b><small>{t.note}</small></div></li>
                ))}
              </ul>
              <p className="perm-note">{thread ? "A conversation keeps its profile, so personal and business products never mix. Start a new chat to switch." : "Pick who the question is for before you ask."}</p>
            </section>
            <section className="ctx-sec">
              <h3>Sources in this chat</h3>
              <ul className="srcs" id="srcs">
                {sources.map((s) => (
                  <li key={s.url} className="src-item">
                    <FileTextIcon />
                    <div><a href={s.url} target="_blank" rel="noreferrer"><b>{s.title}</b></a><small>{new URL(s.url).hostname} · collected {dateOf(Date.parse(s.collectedOn))}</small></div>
                  </li>
                ))}
              </ul>
              <p className="empty-note" hidden={sources.length > 0}>Every number Raiffy gives you will show its source here.</p>
            </section>
            <section className="ctx-sec">
              <div className="promise"><ShieldCheckIcon /><span>Raiffy uses dated public sources from Raiffeisen, ING and BCR. It cannot access your accounts, move money or approve credit.</span></div>
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
  onRetry: () => void; retryDisabled: boolean; onFollowUp: (prompt: string) => void;
};

function AssistantMessage({ m, onGrow, vote, onVote, onCopy, onRetry, retryDisabled, onFollowUp }: AssistantProps) {
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

        {m.status !== "streaming" && m.status !== "failed" && m.status !== "stopped" && (
          <div className={arrivedLive ? "gfoot enter" : "gfoot"}>
            {m.answer?.sources.map((s, i) => (
              <a key={s.id} className="src" href={s.url} target="_blank" rel="noreferrer" title={s.title}>
                <span className="src-n">{i + 1}</span><span className="src-t">{s.title}</span>
              </a>
            ))}
            {m.answer?.ui?.actions.map(a => <button key={a.prompt} className="qbtn" disabled={retryDisabled} onClick={() => onFollowUp(a.prompt)}>{a.label}</button>)}
            <div className="acts">
              <button type="button" className="icon-btn" aria-label="Copy answer" onClick={onCopy}><CopyIcon /></button>
              <button type="button" className="icon-btn" aria-pressed={vote === "up"} aria-label="Helpful" onClick={() => onVote("up")}><ThumbsUpIcon /></button>
              <button type="button" className="icon-btn" aria-pressed={vote === "down"} aria-label="Not helpful" onClick={() => onVote("down")}><ThumbsDownIcon /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type TextPiece = Extract<Piece, { kind: "text" }>;

/** The revealed part of one text piece, with its bold runs. */
function Revealed({ piece, shown }: { piece: TextPiece; shown: number }) {
  let left = Math.max(0, Math.min(shown, piece.to) - piece.from);
  return piece.runs.map((run, i) => {
    const part = run.text.slice(0, left);
    left -= part.length;
    if (!part) return null;
    return run.bold ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>;
  });
}

/**
 * The final answer with its citations: each cited sentence ends in the number of its source chip below. A routes
 * block replaces the answer's route list with cards, shown when the reveal reaches it.
 */
function AnswerText({ answer, animate, onGrow }: { answer: Answer; animate: boolean; onGrow: () => void }) {
  const number = new Map(answer.sources.map((s, i) => [s.id, i + 1]));
  const byId = new Map(answer.sources.map((s) => [s.id, s]));
  const segments = answer.segments.length ? answer.segments : [{ text: answer.text, sourceIds: [] }];
  const routes = answer.ui?.blocks?.find((b): b is RoutesBlock => b.type === "routes");
  const view = answerView(segments, routes);
  const text = view.pieces.map((p) => (p.kind === "text" ? p.runs.map((r) => r.text).join("") : "")).join("");
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
  const cite = (id: string) => {
    const s = byId.get(id);
    if (!s) return null;
    return (
      <a key={id} className="cite" href={s.url} target="_blank" rel="noreferrer" aria-label={`Source ${number.get(id)}: ${s.title}`} title={s.title}>
        {number.get(id)}
      </a>
    );
  };
  // Text before the cards, the cards, then the text after them. The caret sits in the paragraph being revealed.
  const groups: Piece[][] = [[]];
  for (const piece of view.pieces) {
    if (piece.kind === "routes") groups.push([piece], []);
    else groups[groups.length - 1]!.push(piece);
  }
  const starts = groups.map((g) => (g[0]?.kind === "text" ? g[0].from : -1));
  const caretGroup = starts.reduce((at, start, g) => (start !== -1 && (start < shown || at === -1) ? g : at), -1);
  return (
    <>
      {groups.map((group, g) => {
        const first = group[0];
        if (!first) return null;
        if (first.kind === "routes") return routes && shown >= first.at ? <RouteCards key={g} routes={routes.routes} cite={cite} enter={reveal} /> : null;
        if (g !== caretGroup && first.from >= shown) return null;
        return (
          <p key={g} className="answer">
            {group.map((p, i) => p.kind === "text" && (
              <Fragment key={i}><Revealed piece={p} shown={shown} />{shown >= p.to ? p.sourceIds.map(cite) : null}</Fragment>
            ))}
            {g === caretGroup && shown < text.length && <span className="caret" aria-hidden="true" />}
          </p>
        );
      })}
    </>
  );
}
