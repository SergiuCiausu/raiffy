"use client";

import {
  useEffect, useEffectEvent, useLayoutEffect, useRef, useState,
  type FormEvent, type KeyboardEvent, type MouseEvent,
} from "react";
import Link from "next/link";
import {
  ArrowDownIcon, ArrowUpIcon, CalculatorIcon, CompassIcon, CopyIcon, CreditCardIcon, FileBadgeIcon,
  FileTextIcon, HeadsetIcon, LogOutIcon, MenuIcon, PanelRightIcon, PaperclipIcon, PencilIcon, PiggyBankIcon, PinIcon, SearchIcon,
  ShieldCheckIcon, SquareIcon, SquarePenIcon, ThumbsDownIcon, ThumbsUpIcon, WalletIcon, XIcon,
} from "lucide-react";
import { ChatStarters } from "@/components/generated/ChatStarters";
import { AnswerCard } from "./cards";
import { GroupList, Thinking, ThinkLines, useIsMac, useMedia } from "./parts";
import {
  FLOWS, GROUPS, INITIAL_PERMS, NEW_CHAT_ICON, PIN_META, SAVED_SIMS, SEED_CONVS, SEED_PINS, SOURCES, route,
  type Card, type Conv, type FlowKey, type PermKey, type Perms, type Pin, type RaiffyMsg, type SourceKey, type UserMsg,
} from "./data";

/*
 * The chat, ported from chat.html. A scripted demo engine thinks, streams word by word and attaches a card;
 * the real answers come from the LLM pipeline once it's wired in.
 */

const FILE = "Statement_Oct_2026.pdf";
const PLACEHOLDER = "Ask Raiffy about a loan, a fee, your savings…";
const PERMS: { k: PermKey; icon: typeof WalletIcon; name: string; meta: string }[] = [
  { k: "account", icon: WalletIcon, name: "Current account", meta: "••4821 · balance and statement" },
  { k: "offers", icon: FileBadgeIcon, name: "Pre-approved offers", meta: "Personal loan · 7.9% fixed" },
  { k: "savings", icon: PiggyBankIcon, name: "Savings and deposits", meta: "Savings account ••0937" },
  { k: "cards", icon: CreditCardIcon, name: "Card transactions", meta: "Last 12 months" },
];

type Live = { id: string; flow: FlowKey; phase: "think" | "text"; plan: string[]; thinking: string[]; paras: string[]; current: string | null };

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const greeting = () => {
  const h = new Date().getHours();
  return `${h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"}, Andrei`;
};
const chipsFor = (c: Conv, perms: Perms) => {
  const last = c.messages.filter((m): m is RaiffyMsg => m.role === "raiffy").at(-1);
  return last ? FLOWS[last.flow](perms).chips : [];
};
const noEnter = (cs: Conv[]) => cs.map((c) => ({ ...c, messages: c.messages.map((m) => (m.enter ? { ...m, enter: false } : m)) }));

export function ChatApp() {
  const [convs, setConvs] = useState<Conv[]>(SEED_CONVS);
  const [active, setActive] = useState("c1");
  const [pins, setPins] = useState<Pin[]>(SEED_PINS);
  const [perms, setPerms] = useState<Perms>(INITIAL_PERMS);
  const [permNote, setPermNote] = useState("");
  const [query, setQuery] = useState("");
  const [input, setInput] = useState("");
  const [attached, setAttached] = useState(false);
  const [chips, setChipList] = useState<string[]>(() => chipsFor(SEED_CONVS[0]!, INITIAL_PERMS));
  const [tabAt, setTabAt] = useState(0);
  const [live, setLive] = useState<Live | null>(null);
  const [lit, setLit] = useState<SourceKey | null>(null);
  const [drawer, setDrawerState] = useState<"side" | "ctx" | null>(null);
  const [ctxClosed, setCtxClosed] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [liveMsg, setLiveMsg] = useState("");
  const [greet, setGreet] = useState("Good evening, Andrei");

  const narrowCtx = useMedia("(max-width: 1199px)");
  const narrowSide = useMedia("(max-width: 859px)");
  const mac = useIsMac();

  const scroller = useRef<HTMLDivElement>(null);
  const jumpBtn = useRef<HTMLButtonElement>(null);
  const inputEl = useRef<HTMLTextAreaElement>(null);
  const searchEl = useRef<HTMLInputElement>(null);
  const sideEl = useRef<HTMLElement>(null);
  const closeCtxBtn = useRef<HTMLButtonElement>(null);
  const renameBtn = useRef<HTMLButtonElement>(null);
  const attachBtn = useRef<HTMLButtonElement>(null);
  const attXBtn = useRef<HTMLButtonElement>(null);
  const srcItems = useRef<Partial<Record<SourceKey, HTMLLIElement | null>>>({});
  const job = useRef<{ stop: () => void; timer: number } | null>(null);
  const stick = useRef(true);
  const permsRef = useRef(perms);
  const drawerRef = useRef(drawer);
  const opener = useRef<Element | null>(null);
  const uidN = useRef(0);
  const prevActive = useRef(active);

  const conv = convs.find((c) => c.id === active)!;
  const busy = live !== null;
  const empty = !conv.messages.length && !busy;
  const uid = (p: string) => `${p}${++uidN.current}`;
  const focusSoon = (get: () => HTMLElement | null | undefined, ms = 0) => window.setTimeout(() => get()?.focus(), ms);

  function announce(msg: string) { setLiveMsg(""); window.setTimeout(() => setLiveMsg(msg), 60); }
  function setChips(list: string[]) { setChipList(list); setTabAt(0); }
  const updateConv = (id: string, fn: (c: Conv) => Conv) => setConvs((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  const updateMsg = (msgId: string, fn: (m: RaiffyMsg) => RaiffyMsg) =>
    setConvs((cs) => cs.map((c) => ({ ...c, messages: c.messages.map((m) => (m.id === msgId && m.role === "raiffy" ? fn(m) : m)) })));

  useEffect(() => () => { if (job.current) clearTimeout(job.current.timer); }, []);
  useEffect(() => { document.title = (conv.messages.length ? `${conv.title} · ` : "") + "Raiffy"; }, [conv.title, conv.messages.length]);

  /* Keep the newest text in view while the customer is at the bottom; otherwise offer "Jump to latest" */
  useLayoutEffect(() => {
    const s = scroller.current!, j = jumpBtn.current!;
    if (prevActive.current !== active) {
      prevActive.current = active;
      stick.current = true; j.hidden = true;
      s.scrollTop = conv.messages.length ? s.scrollHeight : 0;
      return;
    }
    if (stick.current) s.scrollTop = s.scrollHeight; else j.hidden = false;
  }, [active, conv.messages.length, live]);

  useLayoutEffect(() => {
    const el = inputEl.current!;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  /* ───────────── Demo engine: think, stream, attach card ───────────── */
  function stream(convId: string, flow: FlowKey) {
    const plan = FLOWS[flow](permsRef.current);
    const id = uid("m");
    let i = 0, pi = 0, words: string[] = [], cur: string | null = null;
    const done: string[] = [];
    const ref = { stop: () => finish(true), timer: 0 };
    const wait = (fn: () => void, ms: number) => { ref.timer = window.setTimeout(fn, ms); };
    job.current = ref;
    setLive({ id, flow, phase: "think", plan: plan.thinking, thinking: [], paras: [], current: null });
    announce("Raiffy is thinking.");

    function think() {
      if (i < plan.thinking.length) {
        i++;
        const shown = plan.thinking.slice(0, i);
        setLive((l) => l && { ...l, thinking: shown });
        wait(think, reduced() ? 500 : 800);
      } else startText();
    }
    function startText() {
      setLive((l) => l && { ...l, phase: "text" });
      if (reduced()) { done.push(...plan.paras); finish(false); return; }
      nextPara();
    }
    function nextPara() {
      if (pi >= plan.paras.length) { finish(false); return; }
      words = plan.paras[pi]!.split(/(\s+)/);
      cur = "";
      setLive((l) => l && { ...l, current: "" });
      tick();
    }
    function tick() {
      if (!words.length) {
        done.push(cur!); pi++; cur = null;
        const paras = [...done];
        setLive((l) => l && { ...l, paras, current: null });
        wait(nextPara, 140);
        return;
      }
      let w = words.shift()!;
      if (/^\s+$/.test(w) && words.length) w += words.shift();
      cur += w;
      const text = cur;
      setLive((l) => l && { ...l, current: text });
      wait(tick, 24 + Math.random() * 34);
    }
    function finish(stopped: boolean) {
      clearTimeout(ref.timer);
      const gm: RaiffyMsg = {
        id, role: "raiffy", flow, thinking: plan.thinking.slice(0, i), paras: [...done],
        card: stopped ? null : plan.card, sources: stopped ? [] : plan.sources, stopped, enter: true,
      };
      if (stopped && cur && !done.includes(cur) && pi < plan.paras.length) gm.paras = [...done, `${cur}…`];
      updateConv(convId, (c) => ({ ...c, messages: [...c.messages, gm] }));
      setLive(null);
      job.current = null;
      setChips(stopped ? [] : plan.chips);
      announce(stopped ? "Reply stopped." : `Raiffy replied: ${plan.paras.join(" ")}`);
    }
    wait(think, 120);
  }

  function send(text: string, file: string | null) {
    const fresh = !conv.messages.length;
    const d = new Date();
    const um: UserMsg = { id: uid("m"), role: "user", text, file, enter: true };
    updateConv(active, (c) => ({
      ...c,
      ...(fresh && {
        title: text ? (text.length > 42 ? `${text.slice(0, 40).replace(/\s+\S*$/, "")}…` : text) : "Statement question",
        time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
      }),
      messages: [...c.messages, um],
    }));
    setChips([]);
    stick.current = true;
    stream(active, route(text, file));
  }
  function ask(text: string) {
    if (busy) return;
    send(text, null);
    inputEl.current?.focus();
  }
  function submit() {
    const text = input.trim();
    if (!text && !attached) return;
    const file = attached ? FILE : null;
    setInput(""); setAttached(false);
    send(text, file);
  }

  /* ───────────── Composer ───────────── */
  /* Follow-ups come pre-generated with each answer. Tab fills the composer with the marked one,
     Tab again moves to the next, and after the last one Tab moves focus as usual. Enter sends. */
  function onInput(v: string) {
    setInput(v);
    if (!chips.includes(v.trim())) setTabAt(v ? -1 : 0);
  }
  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Tab" && !e.shiftKey && !busy && chips.length) {
      const v = input.trim(), at = chips.indexOf(v);
      if (!v || (at >= 0 && at < chips.length - 1)) {
        e.preventDefault();
        const n = v ? at + 1 : 0;
        setInput(chips[n]!); setTabAt(n + 1);
        announce(`Suggestion: ${chips[n]}. Press Enter to send.`);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!busy) submit(); }
    if (e.key === "ArrowUp" && !input && !busy) {
      const last = conv.messages.filter((m): m is UserMsg => m.role === "user" && !!m.text).at(-1);
      if (last) { e.preventDefault(); setInput(last.text); }
    }
  }
  function onComposerSubmit(e: FormEvent) {
    e.preventDefault();
    if (job.current) job.current.stop(); else submit();
  }

  /* ───────────── Message actions ───────────── */
  function act(m: RaiffyMsg, a: "copy" | "up" | "down" | "pin") {
    if (a === "copy") {
      navigator.clipboard?.writeText(m.paras.join("\n\n")).catch(() => {});
      announce("Answer copied.");
    } else if (a === "up" || a === "down") {
      const on = m.vote !== a;
      updateMsg(m.id, (x) => ({ ...x, vote: on ? a : null }));
      if (on) announce(a === "up" ? "Thanks for the feedback." : "Thanks. This helps Raiffy improve.");
    } else if (m.pinned) {
      setPins((ps) => ps.filter((p) => p.id !== m.pinned));
      updateMsg(m.id, (x) => ({ ...x, pinned: null }));
      announce("Unpinned.");
    } else if (m.card) {
      const meta = PIN_META[m.card.type]!(m.card);
      const pin: Pin = { ...meta, id: uid("p"), conv: active };
      setPins((ps) => [pin, ...ps]);
      updateMsg(m.id, (x) => ({ ...x, pinned: pin.id }));
      announce("Pinned to context.");
    }
  }
  function unpin(id: string) {
    setPins((ps) => ps.filter((p) => p.id !== id));
    setConvs((cs) => cs.map((c) => ({ ...c, messages: c.messages.map((m) => (m.role === "raiffy" && m.pinned === id ? { ...m, pinned: null } : m)) })));
    announce("Unpinned.");
  }
  function showSource(k: SourceKey, from: HTMLElement) {
    setLit(k);
    srcItems.current[k]?.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
    if (narrowCtx) openDrawer("ctx", from);
  }

  /* ───────────── Sidebar ───────────── */
  function leave() {
    job.current?.stop();
    setConvs(noEnter);
    setRenaming(false);
  }
  function openConv(id: string) {
    leave();
    const target = convs.find((c) => c.id === id)!;
    setActive(id);
    setChips(chipsFor(target, permsRef.current));
    if (!target.messages.length) setGreet(greeting());
    if (narrowSide) closeDrawers();
  }
  function newChat() {
    if (job.current) job.current.stop();
    if (!conv.messages.length && !busy) { if (narrowSide) closeDrawers(); inputEl.current?.focus(); return; }
    leave();
    const c: Conv = { id: uid("chat-"), title: "New chat", group: "Today", time: "now", icon: NEW_CHAT_ICON, messages: [] };
    setConvs((cs) => [c, ...cs]);
    setActive(c.id);
    setChips([]);
    setGreet(greeting());
    if (narrowSide) closeDrawers();
    inputEl.current?.focus();
  }

  function togglePerm(k: PermKey, name: string) {
    const on = !perms[k];
    const next = { ...perms, [k]: on };
    permsRef.current = next;
    setPerms(next);
    const note = on ? `Raiffy can use your ${name.toLowerCase()} again from your next question.` : `Raiffy will stop using your ${name.toLowerCase()} from your next question.`;
    setPermNote(note);
    announce(note);
  }

  /* ───────────── Drawers ───────────── */
  function setDrawer(v: typeof drawer) { drawerRef.current = v; setDrawerState(v); }
  function openDrawer(which: "side" | "ctx", from?: Element | null) {
    opener.current = from || document.activeElement;
    setDrawer(which);
    focusSoon(() => (which === "ctx" ? closeCtxBtn.current : sideEl.current?.querySelector<HTMLElement>("button, input")), 30);
  }
  function closeDrawers() {
    const was = drawerRef.current !== null;
    setDrawer(null);
    setLit(null);
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
    if (!typing && !mod && !e.altKey && e.key.toLowerCase() === "n") { e.preventDefault(); newChat(); }
    if (e.key === "Escape") {
      if (drawerRef.current) closeDrawers();
      else job.current?.stop();
    }
  });
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => onKey(e);
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  /* ───────────── Derived ───────────── */
  const q = query.trim().toLowerCase();
  const matchQ = (t: string) => !q || t.toLowerCase().includes(q);
  const groups = GROUPS.map((g) => ({ g, items: convs.filter((c) => c.group === g && matchQ(c.title)) })).filter((x) => x.items.length);
  const savedSims = SAVED_SIMS.filter((s) => matchQ(s.title));
  const srcs = [...new Set(conv.messages.flatMap((m) => (m.role === "raiffy" ? m.sources : [])))];
  const meta = conv.messages.length
    ? `${conv.group === "Today" ? "Today, " : ""}${conv.time} · ${srcs.length ? `${srcs.length} ${srcs.length === 1 ? "source" : "sources"}` : "no sources yet"}`
    : "New conversation";
  const appClass = ["app", drawer === "side" && "side-open", drawer === "ctx" && "ctx-open", ctxClosed && "ctx-closed"].filter(Boolean).join(" ");

  const onStarter = (e: MouseEvent) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-prompt]");
    if (b?.dataset.prompt) ask(b.dataset.prompt);
  };

  return (
    <div className="pg-chat">
      <div className={appClass} id="app">

        {/* ═════════════ Sidebar ═════════════ */}
        <aside className="side" id="side" aria-label="Chats" ref={sideEl} inert={drawer === "ctx" && narrowSide}>
          <div className="side-top">
            <Link className="logo" href="/"><span className="logo-mark"><CompassIcon /></span>Raiffy</Link>
          </div>
          <button type="button" className="btn btn-ghost new" id="new-chat" onClick={newChat}><SquarePenIcon />New chat<kbd>N</kbd></button>
          <label className="search">
            <SearchIcon />
            <span className="sr-only">Search chats</span>
            <input type="search" id="search" ref={searchEl} placeholder="Search chats" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
            <kbd id="kbd-k">{mac ? "⌘K" : "Ctrl K"}</kbd>
          </label>
          <nav className="conv-list" id="conv-list" aria-label="Conversations">
            {groups.map(({ g, items }) => (
              <GroupList key={g} label={g}>
                {items.map((c) => (
                  <button key={c.id} type="button" className="conv" aria-current={c.id === active} onClick={() => openConv(c.id)}>
                    <c.icon /><span>{c.title}</span><small>{c.time}</small>
                  </button>
                ))}
              </GroupList>
            ))}
            {savedSims.length > 0 && (
              <GroupList label="Saved simulations">
                {savedSims.map((s) => (
                  <button key={s.title} type="button" className="conv" aria-current={false} onClick={() => openConv(s.conv)}>
                    <CalculatorIcon /><span>{s.title}</span>
                  </button>
                ))}
              </GroupList>
            )}
            {!groups.length && !savedSims.length && <p className="no-match">No chats match “<span>{q}</span>”.</p>}
          </nav>
          <div className="me">
            <span className="ava" aria-hidden="true">AP</span>
            <div><b>Andrei Popescu</b><small>Raiffeisen client</small></div>
            <Link className="icon-btn" href="/sign-in" aria-label="Sign out"><LogOutIcon /></Link>
          </div>
        </aside>

        {/* ═════════════ Thread ═════════════ */}
        <div className="main" id="main" inert={drawer !== null}>
          <header className="top">
            <button type="button" className="icon-btn menu" id="open-side" aria-label="Open chats" aria-controls="side"
              aria-expanded={drawer === "side"} onClick={(e) => openDrawer("side", e.currentTarget)}><MenuIcon /></button>
            <div className="title-wrap">
              {renaming && (
                <RenameInput title={conv.title} onClose={(value) => {
                  setRenaming(false);
                  if (value) updateConv(active, (c) => ({ ...c, title: value }));
                  focusSoon(() => renameBtn.current);
                }} />
              )}
              <div id="title-box" hidden={renaming}><h1 id="title">{conv.title}</h1><span className="meta" id="meta">{meta}</span></div>
              <button type="button" className="icon-btn rename" id="rename" ref={renameBtn} aria-label="Rename chat"
                hidden={!conv.messages.length || renaming} onClick={() => setRenaming(true)}><PencilIcon /></button>
            </div>
            <div className="top-actions">
              <button type="button" className="btn btn-ghost btn-sm advisor" id="advisor-btn" aria-label="Talk to an advisor"
                onClick={() => { if (!busy) send("Book an advisor meeting", null); }}>
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
              {conv.messages.map((m) => (m.role === "user"
                ? <UserMessage key={m.id} m={m} />
                : <RaiffyMessage key={m.id} m={m} lit={lit} setLit={setLit} onAct={act} onSource={showSource} onAsk={ask} announce={announce}
                    onCard={(card) => updateMsg(m.id, (x) => ({ ...x, card }))} />))}
              {live && <LiveMessage live={live} />}
            </div>
            <section className="empty enter" id="empty" hidden={!empty} aria-labelledby="greet" onClick={onStarter}>
              <div className="bloom" aria-hidden="true" />
              <div className="empty-head">
                <span className="ava-raiffy" aria-hidden="true"><CompassIcon /></span>
                <h2 id="greet">{greet}</h2>
                <p>Ask about loans, savings, fees or your next advisor meeting. Raiffy uses your own offers and puts every option side by side.</p>
              </div>
              <ChatStarters />
            </section>
          </div>

          <div className="composer-wrap">
            <button type="button" className="jump" id="jump" ref={jumpBtn} hidden onClick={() => {
              const s = scroller.current!;
              s.scrollTo({ top: s.scrollHeight, behavior: reduced() ? "auto" : "smooth" });
              jumpBtn.current!.hidden = true;
              inputEl.current?.focus();
            }}><ArrowDownIcon />Jump to latest</button>
            <div className="chips" id="chips" role="group" aria-label="Suggested questions" hidden={!chips.length}>
              {chips.map((t, i) => (
                <button key={t} type="button" className="chip" onClick={() => ask(t)}>
                  {t}{i === tabAt && <kbd className="tab-kbd" aria-hidden="true">Tab</kbd>}
                </button>
              ))}
            </div>
            <form className="composer" id="composer" onSubmit={onComposerSubmit}>
              <label className="sr-only" htmlFor="input">Message Raiffy</label>
              <textarea id="input" ref={inputEl} rows={1} enterKeyHint="send" value={input}
                placeholder={chips.length ? "Ask a follow-up, or press Tab for a suggestion" : PLACEHOLDER}
                onChange={(e) => onInput(e.target.value)} onKeyDown={onComposerKey} />
              <div className="comp-row">
                <button type="button" className="icon-btn" id="attach" ref={attachBtn} aria-label="Attach a statement or document"
                  hidden={attached} onClick={() => { setAttached(true); focusSoon(() => attXBtn.current); }}><PaperclipIcon /></button>
                <span className="file-chip" id="att" hidden={!attached}><span className="ft"><FileTextIcon /></span>{FILE} <small>184 KB</small>
                  <button type="button" className="icon-btn x" id="att-x" ref={attXBtn} aria-label="Remove attachment"
                    onClick={() => { setAttached(false); focusSoon(() => attachBtn.current); }}><XIcon /></button>
                </span>
                <button type="submit" className={busy ? "btn btn-dark send is-stop" : "btn btn-dark send"} id="send"
                  aria-label={busy ? "Stop reply" : "Send message"} disabled={!busy && !input.trim() && !attached}>
                  <span className="i-send"><ArrowUpIcon /></span><span className="i-stop"><SquareIcon /></span>
                </button>
              </div>
            </form>
            <p className="disclaimer">Raiffy recommends an option and shows why. The choice is always yours. Concept demo, figures are illustrative.</p>
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
              <h3>What Raiffy can see</h3>
              <p>Raiffy only uses what’s switched on here. Changes apply to your next question.</p>
              <ul className="perms">
                {PERMS.map(({ k, icon: Icon, name, meta: m }) => (
                  <li key={k} className="perm">
                    <span className="ic"><Icon /></span>
                    <div><b id={`pl-${k}`}>{name}</b><small>{m}</small></div>
                    <button type="button" className="switch" role="switch" aria-checked={perms[k]} aria-labelledby={`pl-${k}`} onClick={() => togglePerm(k, name)} />
                  </li>
                ))}
              </ul>
              <p className="perm-note" id="perm-note" hidden={!permNote}>{permNote}</p>
            </section>
            <section className="ctx-sec">
              <h3>Pinned</h3>
              <ul className="pins" id="pins">
                {pins.map((p) => (
                  <li key={p.id} className="pin">
                    <span className="ic"><p.icon /></span><div><b>{p.title}</b><small>{p.meta}</small></div>
                    <button type="button" className="icon-btn" aria-label={`Unpin ${p.title}`} onClick={() => unpin(p.id)}><XIcon /></button>
                  </li>
                ))}
              </ul>
              <p className="empty-note" hidden={pins.length > 0}>Pin a comparison or a simulation to keep it here.</p>
            </section>
            <section className="ctx-sec">
              <h3>Sources in this chat</h3>
              <ul className="srcs" id="srcs">
                {srcs.map((k) => {
                  const S = SOURCES[k];
                  return (
                    <li key={k} className={lit === k ? "src-item lit" : "src-item"} ref={(el) => { srcItems.current[k] = el; }}>
                      <S.icon /><div><b>{S.label}</b><small>{S.detail}</small></div>
                    </li>
                  );
                })}
              </ul>
              <p className="empty-note" hidden={srcs.length > 0}>Every number Raiffy gives you will show its source here.</p>
            </section>
            <section className="ctx-sec">
              <div className="promise"><ShieldCheckIcon /><span>Raiffy never moves money, applies for products or shares your data on its own. Anything like that needs your confirmation.</span></div>
            </section>
          </div>
        </aside>
      </div>

      <div className="scrim" id="scrim" hidden={!drawer} onClick={closeDrawers} />
      <p className="sr-only" aria-live="polite" id="announce">{liveMsg}</p>
    </div>
  );
}

function RenameInput({ title, onClose }: { title: string; onClose: (value: string | null) => void }) {
  const el = useRef<HTMLInputElement>(null);
  const closed = useRef(false);
  useEffect(() => { el.current?.focus(); el.current?.select(); }, []);
  const close = (save: boolean) => {
    if (closed.current) return;
    closed.current = true;
    onClose(save ? el.current!.value.trim() || null : null);
  };
  return (
    <input ref={el} className="title-input" defaultValue={title} aria-label="Chat name"
      onKeyDown={(e) => { if (e.key === "Enter") close(true); if (e.key === "Escape") { e.stopPropagation(); close(false); } }}
      onBlur={() => close(true)} />
  );
}

function UserMessage({ m }: { m: UserMsg }) {
  return (
    <div className={m.enter ? "msg msg-user enter" : "msg msg-user"}>
      {m.file && <span className="file-chip"><span className="ft"><FileTextIcon /></span>{m.file} <small>PDF</small></span>}
      {m.text && <div className="bubble">{m.text}</div>}
    </div>
  );
}

/** The reply while Raiffy works: the dimmed thinking panel, then words streaming in with a caret. */
function LiveMessage({ live }: { live: Live }) {
  return (
    <div className="msg msg-raiffy enter" data-flow={live.flow}>
      <span className="ava-raiffy" aria-hidden="true"><CompassIcon /></span>
      <div className="raiffy-body">
        {live.phase === "think"
          ? <div className="think think-live"><ol className="think-lines" aria-label="Raiffy is working"><ThinkLines lines={live.thinking} live /></ol></div>
          : <Thinking lines={live.plan} />}
        <div className="raiffy-text">
          {live.paras.map((p, i) => <p key={i}>{p}</p>)}
          {live.current !== null && <p>{live.current}<span className="caret" aria-hidden="true" /></p>}
        </div>
      </div>
    </div>
  );
}

type RaiffyProps = {
  m: RaiffyMsg; lit: SourceKey | null; setLit: (k: SourceKey | null) => void;
  onAct: (m: RaiffyMsg, a: "copy" | "up" | "down" | "pin") => void; onSource: (k: SourceKey, from: HTMLElement) => void;
  onAsk: (t: string) => void; announce: (msg: string) => void; onCard: (card: Card) => void;
};

function RaiffyMessage({ m, lit, setLit, onAct, onSource, onAsk, announce, onCard }: RaiffyProps) {
  return (
    <div className="msg msg-raiffy" data-flow={m.flow}>
      <span className="ava-raiffy" aria-hidden="true"><CompassIcon /></span>
      <div className="raiffy-body">
        {m.thinking.length > 0 && <Thinking lines={m.thinking} />}
        <div className="raiffy-text">
          {m.paras.map((p, i) => <p key={i}>{p}</p>)}
          {m.stopped && <p className="stopped">You stopped this reply.</p>}
        </div>
        {m.card && <AnswerCard card={m.card} enter={!!m.enter} onChange={onCard} onAsk={onAsk} announce={announce} />}
        {!m.stopped && (
          <div className={m.enter ? "gfoot enter" : "gfoot"}>
            {m.sources.map((k) => {
              const S = SOURCES[k];
              return (
                <button key={k} type="button" className={lit === k ? "src lit" : "src"} data-src={k}
                  onMouseEnter={() => setLit(k)} onMouseLeave={() => setLit(null)} onFocus={() => setLit(k)} onBlur={() => setLit(null)}
                  onClick={(e) => onSource(k, e.currentTarget)}>
                  <S.icon />{S.label}
                </button>
              );
            })}
            <div className="acts">
              <button type="button" className="icon-btn" aria-label="Copy answer" onClick={() => onAct(m, "copy")}><CopyIcon /></button>
              <button type="button" className="icon-btn" aria-pressed={m.vote === "up"} aria-label="Helpful" onClick={() => onAct(m, "up")}><ThumbsUpIcon /></button>
              <button type="button" className="icon-btn" aria-pressed={m.vote === "down"} aria-label="Not helpful" onClick={() => onAct(m, "down")}><ThumbsDownIcon /></button>
              {m.card && PIN_META[m.card.type] && (
                <button type="button" className="icon-btn" aria-pressed={!!m.pinned} aria-label="Pin to context" onClick={() => onAct(m, "pin")}><PinIcon /></button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
