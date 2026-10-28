"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, CircleAlertIcon, CompassIcon, MailCheckIcon, MailIcon } from "lucide-react";
import { AuthBrand } from "@/components/generated/AuthBrand";

/*
 * Sign in / create account, ported from login.html. Front end only: validation, loading and success are
 * simulated and nothing is sent. Clerk replaces the simulated round trips when it's wired in.
 * Sign-in order (spec): Raiffeisen SSO (placeholder, does nothing), Google, Apple, email magic link.
 */

type Flow = "login" | "signup";
type View = "login" | "link-sent" | "login-done" | "signup" | "signup-done";
type Field = "login-email" | "su-name" | "su-email" | "su-terms";

const FLOW_OF: Record<View, Flow> = { login: "login", "link-sent": "login", "login-done": "login", signup: "signup", "signup-done": "signup" };
const PATH: Record<Flow, string> = { login: "/sign-in", signup: "/sign-up" };
const TITLE: Record<Flow, string> = { login: "Sign in · Raiffy", signup: "Create account · Raiffy" };

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const emailRule = (v: string) => (!v ? "Enter your email address." : !isEmail(v) ? "Enter an email like name@example.ro." : "");

type Values = { "login-email": string; "su-name": string; "su-email": string; "su-terms": boolean; share: boolean; marketing: boolean };
const EMPTY: Values = { "login-email": "", "su-name": "", "su-email": "", "su-terms": false, share: false, marketing: false };

function rule(field: Field, v: Values): string {
  switch (field) {
    case "login-email": case "su-email": return emailRule(v[field].trim());
    case "su-name": return v["su-name"].trim().length < 3 ? "Enter your full name, as it appears on your ID." : "";
    case "su-terms": return v["su-terms"] ? "" : "Accept the terms and privacy notice to continue.";
  }
}
const FORM_FIELDS: Record<Flow, Field[]> = { login: ["login-email"], signup: ["su-name", "su-email", "su-terms"] };

const GoogleMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" /></svg>
);
const AppleMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" /></svg>
);

export function AuthScreen({ initialFlow }: { initialFlow: Flow }) {
  const [view, setViewState] = useState<View>(initialFlow);
  const [moved, setMoved] = useState(false); // the first view doesn't animate in
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [submitted, setSubmitted] = useState<Record<Flow, boolean>>({ login: false, signup: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [live, setLive] = useState("");
  const [sentTo, setSentTo] = useState({ login: "", signup: "" });

  const flow = FLOW_OF[view];
  const focusNext = useRef<{ kind: "h1" } | { kind: "tab"; flow: Flow } | { kind: "field"; field: Field } | null>(null);
  const tabRefs = useRef<Partial<Record<Flow, HTMLButtonElement | null>>>({});
  const fieldRefs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };

  function announce(msg: string) { setLive(""); later(() => setLive(msg), 50); }

  function setView(name: View, focus: "h1" | "tab" | null = null) {
    if (name !== view) { setViewState(name); setMoved(true); }
    const f = FLOW_OF[name];
    // Same page, new URL: keeps the segmented control's slide and the form state, unlike a route change
    if (name === "login" || name === "signup") window.history.replaceState(null, "", PATH[f]);
    if (focus === "h1") focusNext.current = { kind: "h1" };
    if (focus === "tab") focusNext.current = { kind: "tab", flow: f };
  }

  useEffect(() => { document.title = TITLE[flow]; }, [flow]);

  // Move focus once the new view is rendered (it was hidden until now)
  useEffect(() => {
    const f = focusNext.current;
    focusNext.current = null;
    if (!f) return;
    if (f.kind === "h1") document.querySelector<HTMLElement>(`[data-view="${view}"] h1`)?.focus();
    if (f.kind === "tab") tabRefs.current[f.flow]?.focus();
    if (f.kind === "field") fieldRefs.current[f.field]?.focus();
  });

  /* Resend cooldown: 30 seconds, one timer for whichever confirmation view is showing */
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  function check(field: Field, v: Values = values) {
    const msg = rule(field, v);
    setErrors((e) => ({ ...e, [field]: msg }));
    return !msg;
  }
  function update<K extends keyof Values>(key: K, value: Values[K]) {
    const next = { ...values, [key]: value };
    setValues(next);
    // Re-check as the customer types only once a field has been marked invalid
    if (key in errors && errors[key as Field]) check(key as Field, next);
  }
  function onBlur(field: Field) {
    const v = values[field];
    if ((typeof v === "string" && v) || submitted[FLOW_OF[view]]) check(field);
  }

  function submit(e: FormEvent, f: Flow) {
    e.preventDefault();
    setSubmitted((s) => ({ ...s, [f]: true }));
    const bad = FORM_FIELDS[f].filter((field) => !check(field));
    if (bad.length) {
      focusNext.current = { kind: "field", field: bad[0]! };
      announce(bad.length === 1 ? "One field needs attention." : `${bad.length} fields need attention.`);
      return;
    }
    setBusy(`${f}-submit`);
    later(() => {
      setBusy(null);
      if (f === "login") { setSentTo((s) => ({ ...s, login: values["login-email"].trim() })); setView("link-sent", "h1"); }
      else { setSentTo((s) => ({ ...s, signup: values["su-email"].trim() })); setView("signup-done", "h1"); }
      setCooldown(30);
    }, 900);
  }

  /* Google and Apple: fake a short round trip, then land signed in. Signing up needs the terms first. */
  function provider(name: string) {
    if (busy) return;
    if (view === "signup" && !check("su-terms")) {
      focusNext.current = { kind: "field", field: "su-terms" };
      announce("Accept the terms and privacy notice to continue.");
      return;
    }
    setBusy(`${view}-${name}`);
    later(() => { setBusy(null); setView("login-done", "h1"); }, 900);
  }

  function go(to: View, reset = false) {
    if (reset) { setValues(EMPTY); setErrors({}); setSubmitted({ login: false, signup: false }); }
    setView(to, to === "login" || to === "signup" ? "tab" : "h1");
  }

  function onTabKey(e: KeyboardEvent, i: number) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setView((["login", "signup"] as const)[(i + 1) % 2], "tab");
  }

  const btnClass = (base: string, id: string) => (busy === id ? `${base} is-loading` : base);
  const btnBusy = (id: string) => ({ disabled: busy === id, "aria-busy": busy === id });
  const resendLabel = (label: string) => (cooldown > 0 ? `Resend in 0:${String(cooldown).padStart(2, "0")}` : label);

  const err = (field: Field) => (
    <p className="err" id={`${field}-err`} hidden={!errors[field]}><CircleAlertIcon /><span>{errors[field] || ""}</span></p>
  );
  const control = (field: Exclude<Field, "su-terms">, input: ReactNode) => (
    <div className={errors[field] ? "control is-invalid" : "control"}>{input}</div>
  );
  const textInput = (field: "login-email" | "su-name" | "su-email", props: Record<string, string>, describedBy: string) =>
    control(field, (
      <input id={field} ref={(el) => { fieldRefs.current[field] = el; }} value={values[field]}
        onChange={(e) => update(field, e.target.value)} onBlur={() => onBlur(field)}
        aria-invalid={errors[field] ? true : false} aria-describedby={describedBy} {...props} />
    ));

  const viewClass = moved ? "view enter" : "view";
  const providers = (verb: string) => (
    <div className="providers">
      {/* Raiffeisen SSO: placeholder only, intentionally does nothing yet */}
      <button type="button" className="btn btn-dark btn-sso" data-sso="">
        <span className="lbl"><span className="sso-mark" aria-hidden="true"><CompassIcon /></span>{verb} with Raiffeisen</span>
      </button>
      <div className="providers-2">
        {(["Google", "Apple"] as const).map((p) => (
          <button key={p} type="button" className={btnClass("btn btn-ghost", `${view}-${p}`)} {...btnBusy(`${view}-${p}`)} onClick={() => provider(p)}>
            <span className="lbl">{p === "Google" ? <GoogleMark /> : <AppleMark />}{p}</span><span className="spin" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="pg-auth" data-mode="daylight" data-flow={flow}>
      <a className="sr-only" href="#auth-card">Skip to the form</a>

      <div className="auth">
        <AuthBrand />

        <div className="panel">
          <div className="panel-top">
            <Link className="back" href="/"><ArrowLeftIcon />Back to Raiffy</Link>
          </div>

          <main className="panel-main">
            <div className="auth-card" id="auth-card">
              <div className="seg" role="tablist" aria-label="Sign in or create an account" hidden={view !== "login" && view !== "signup"}>
                <span className="seg-ind" aria-hidden="true" />
                {(["login", "signup"] as const).map((f, i) => (
                  <button key={f} type="button" role="tab" id={`tab-${f}`} ref={(el) => { tabRefs.current[f] = el; }}
                    aria-controls={`view-${f}`} aria-selected={flow === f} tabIndex={flow === f ? 0 : -1}
                    onClick={() => setView(f)} onKeyDown={(e) => onTabKey(e, i)}>
                    {f === "login" ? "Sign in" : "Create account"}
                  </button>
                ))}
              </div>

              {/* ── Sign in ── */}
              <section className={viewClass} data-view="login" id="view-login" role="tabpanel" aria-labelledby="tab-login" hidden={view !== "login"}>
                <div className="vh">
                  <h1 tabIndex={-1}>Welcome back</h1>
                  <p className="text-sm">Choose how you’d like to sign in.</p>
                </div>
                {providers("Continue")}
                <div className="or">or use your email</div>
                <form className="form" noValidate onSubmit={(e) => submit(e, "login")}>
                  <div className="field">
                    <label htmlFor="login-email">Email</label>
                    {textInput("login-email", { name: "email", type: "email", autoComplete: "email", autoCapitalize: "none", spellCheck: "false", placeholder: "you@example.ro" }, "login-email-hint login-email-err")}
                    <p className="hint" id="login-email-hint">We’ll email you a link that signs you in. No password needed.</p>
                    {err("login-email")}
                  </div>
                  <button className={btnClass("btn btn-dark", "login-submit")} type="submit" {...btnBusy("login-submit")}>
                    <span className="lbl">Email me a sign-in link</span><span className="spin" aria-hidden="true" />
                  </button>
                </form>
                <p className="switch">New to Raiffy? <button type="button" className="link" onClick={() => go("signup")}>Create an account</button></p>
              </section>

              <section className={viewClass} data-view="link-sent" hidden={view !== "link-sent"}>
                <div className="done">
                  <span className="orb" aria-hidden="true"><MailIcon /></span>
                  <div className="vh">
                    <h1 tabIndex={-1}>Check your inbox</h1>
                    <p className="text-sm">We sent a sign-in link to <b>{sentTo.login}</b>. It expires in 15 minutes.</p>
                  </div>
                  <button type="button" className="btn btn-ghost resend" disabled={cooldown > 0}
                    onClick={() => { announce("Email sent again."); setCooldown(30); }}>{resendLabel("Resend link")}</button>
                  <p className="switch"><button type="button" className="link" onClick={() => go("login")}>Use a different email</button></p>
                  <p className="hint">Concept page: no email was sent. <button type="button" className="link" onClick={() => go("login-done")}>Continue as if you opened it</button></p>
                </div>
              </section>

              <section className={viewClass} data-view="login-done" hidden={view !== "login-done"}>
                <div className="done">
                  <span className="orb" aria-hidden="true"><CheckIcon /></span>
                  <div className="vh">
                    <h1 tabIndex={-1}>You’re signed in</h1>
                    <p className="text-sm">Your saved comparisons are waiting. This concept page doesn’t send or store anything.</p>
                  </div>
                  <Link className="btn btn-dark" href="/chat"><span className="lbl">Open Raiffy</span><ArrowRightIcon /></Link>
                  <p className="switch"><button type="button" className="link" onClick={() => go("login", true)}>Sign out</button></p>
                </div>
              </section>

              {/* ── Create account ── */}
              <section className={viewClass} data-view="signup" id="view-signup" role="tabpanel" aria-labelledby="tab-signup" hidden={view !== "signup"}>
                <div className="vh">
                  <h1 tabIndex={-1}>Create your Raiffy account</h1>
                  <p className="text-sm">It takes a minute. You can compare and simulate before you share anything else.</p>
                </div>
                {providers("Sign up")}
                <div className="or">or use your email</div>
                <form className="form" noValidate onSubmit={(e) => submit(e, "signup")}>
                  <div className="field">
                    <label htmlFor="su-name">Full name</label>
                    {textInput("su-name", { name: "name", type: "text", autoComplete: "name", placeholder: "As it appears on your ID" }, "su-name-err")}
                    {err("su-name")}
                  </div>
                  <div className="field">
                    <label htmlFor="su-email">Email</label>
                    {textInput("su-email", { name: "email", type: "email", autoComplete: "email", autoCapitalize: "none", spellCheck: "false", placeholder: "you@example.ro" }, "su-email-err")}
                    {err("su-email")}
                  </div>
                  <div className="consents">
                    <label className={errors["su-terms"] ? "check is-invalid" : "check"}>
                      <input type="checkbox" id="su-terms" name="terms" ref={(el) => { fieldRefs.current["su-terms"] = el; }}
                        checked={values["su-terms"]} onChange={(e) => update("su-terms", e.target.checked)}
                        aria-invalid={errors["su-terms"] ? true : false} aria-describedby="su-terms-err" />
                      <span>I accept the <Link href="/#safeguards">terms</Link> and the <Link href="/#safeguards">privacy notice</Link>.</span>
                    </label>
                    {err("su-terms")}
                    <label className="check">
                      <input type="checkbox" name="share" checked={values.share} onChange={(e) => update("share", e.target.checked)} />
                      <span><b>Let Raiffy share summaries with my advisor</b><small>Only before a meeting you book. You can turn this off anytime.</small></span>
                    </label>
                    {/* Marketing consent: separate, unticked, optional, never a condition of access */}
                    <label className="check">
                      <input type="checkbox" name="marketing" checked={values.marketing} onChange={(e) => update("marketing", e.target.checked)} />
                      <span><b>I’d like to receive personalised offers from Raiffeisen</b><small>Optional, and never needed to use Raiffy. You can change this anytime. <Link href="/#safeguards">What this means</Link></small></span>
                    </label>
                  </div>
                  <button className={btnClass("btn btn-dark", "signup-submit")} type="submit" {...btnBusy("signup-submit")}>
                    <span className="lbl">Create account</span><span className="spin" aria-hidden="true" />
                  </button>
                </form>
                <p className="switch">Already have an account? <button type="button" className="link" onClick={() => go("login")}>Sign in</button></p>
              </section>

              <section className={viewClass} data-view="signup-done" hidden={view !== "signup-done"}>
                <div className="done">
                  <span className="orb" aria-hidden="true"><MailCheckIcon /></span>
                  <div className="vh">
                    <h1 tabIndex={-1}>Check your email</h1>
                    <p className="text-sm">We sent a confirmation link to <b>{sentTo.signup}</b>. It expires in 24 hours.</p>
                  </div>
                  <button type="button" className="btn btn-ghost resend" disabled={cooldown > 0}
                    onClick={() => { announce("Email sent again."); setCooldown(30); }}>{resendLabel("Resend email")}</button>
                  <p className="switch"><button type="button" className="link" onClick={() => go("signup")}>Use a different email</button></p>
                  <p className="hint">Concept page: no email was actually sent.</p>
                </div>
              </section>
            </div>
          </main>

          <footer className="panel-foot">
            <span>Raiffy concept · not an official Raiffeisen Bank product</span>
            <nav aria-label="Footer"><Link href="/#safeguards">Principles</Link><Link href="/#handoff">Talk to an advisor</Link></nav>
          </footer>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">{live}</p>
    </div>
  );
}
