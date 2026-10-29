"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, useClerk, useSignIn, useSignUp, useUser } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { ArrowLeftIcon, CircleAlertIcon, CompassIcon, MailCheckIcon, MailIcon, UserCheckIcon } from "lucide-react";
import { AuthBrand } from "@/components/generated/AuthBrand";
import { recordSignUpConsents } from "@/app/sign-up/actions";
import { destination, goTo, withDestination } from "@/components/auth/navigate";
import { logChatWarning } from "@/lib/chat-log";

/*
 * Sign in / create account, ported from login.html and backed by Clerk's custom flows.
 * Order (spec): Raiffeisen SSO (placeholder, does nothing), Google, Apple, email magic link.
 * Sign-up consents travel in unsafeMetadata and are copied to publicMetadata by a server action once signed in.
 */

type Flow = "login" | "signup";
type View = "login" | "link-sent" | "signup" | "signup-done";
type Field = "login-email" | "su-name" | "su-email" | "su-terms";

const FLOW_OF: Record<View, Flow> = { login: "login", "link-sent": "login", signup: "signup", "signup-done": "signup" };
const PATH: Record<Flow, string> = { login: "/sign-in", signup: "/sign-up" };
const TITLE: Record<Flow, string> = { login: "Sign in · Raiffy", signup: "Create account · Raiffy" };
const SSO_CALLBACK = "/sso-callback";
const VERIFY_URL = "/verify-email";

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const emailRule = (v: string) => (!v ? "Enter your email address." : !isEmail(v) ? "Enter an email like name@example.ro." : "");

type Values = { "login-email": string; "su-name": string; "su-email": string; "su-terms": boolean; marketing: boolean };
const EMPTY: Values = { "login-email": "", "su-name": "", "su-email": "", "su-terms": false, marketing: false };

function rule(field: Field, v: Values): string {
  switch (field) {
    case "login-email": case "su-email": return emailRule(v[field].trim());
    case "su-name": return v["su-name"].trim().length < 3 ? "Enter your full name, as it appears on your ID." : "";
    case "su-terms": return v["su-terms"] ? "" : "Accept the terms and privacy notice to continue.";
  }
}
const FORM_FIELDS: Record<Flow, Field[]> = { login: ["login-email"], signup: ["su-name", "su-email", "su-terms"] };

/* Clerk reports which parameter failed; map it onto our fields */
const FIELD_OF_PARAM: Record<Flow, Record<string, Field>> = {
  login: { identifier: "login-email", email_address: "login-email" },
  signup: { email_address: "su-email", first_name: "su-name", last_name: "su-name" },
};

const GoogleMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" /></svg>
);
const AppleMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" /></svg>
);

const PROVIDERS = [
  { name: "Google", strategy: "oauth_google", mark: <GoogleMark /> },
  { name: "Apple", strategy: "oauth_apple", mark: <AppleMark /> },
] as const;

export function AuthScreen({ initialFlow }: { initialFlow: Flow }) {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();

  const [view, setViewState] = useState<View>(initialFlow);
  const [moved, setMoved] = useState(false); // the first view doesn't animate in
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<Record<Flow, string>>({ login: "", signup: "" });
  const [submitted, setSubmitted] = useState<Record<Flow, boolean>>({ login: false, signup: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [live, setLive] = useState("");
  const [sentTo, setSentTo] = useState({ login: "", signup: "" });

  const flow = FLOW_OF[view];
  const focusNext = useRef<{ kind: "h1" } | { kind: "tab"; flow: Flow } | { kind: "field"; field: Field } | null>(null);
  const tabRefs = useRef<Partial<Record<Flow, HTMLButtonElement | null>>>({});
  const fieldRefs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const waiting = useRef<Record<Flow, boolean>>({ login: false, signup: false });

  /*
   * Arriving already signed in: say so and let the visitor continue or sign out, instead of bouncing them to /chat.
   * A silent bounce hid the session and could loop with /chat when Convex rejects it. Finishing a sign-in on this page
   * still continues on its own (finalize navigates), so the panel is skipped while that happens.
   */
  const [finishing, setFinishing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const alreadySignedIn = isLoaded && !!isSignedIn && !finishing;
  const shown: View | null = alreadySignedIn ? null : view;
  useEffect(() => {
    if (alreadySignedIn) logChatWarning("already signed in: offering continue or sign out", { continueTo: destination() }, "auth");
  }, [alreadySignedIn]);

  async function signOutHere() {
    setLeaving(true);
    // Stay on this page, signed out, ready to sign in or create another account
    await signOut({ redirectUrl: window.location.pathname + window.location.search });
  }

  function announce(msg: string) { setLive(""); window.setTimeout(() => setLive(msg), 50); }

  function setView(name: View, focus: "h1" | "tab" | null = null) {
    if (name !== view) { setViewState(name); setMoved(true); }
    const f = FLOW_OF[name];
    // Same page, new URL: keeps the segmented control's slide and the form state, unlike a route change
    if (name === "login" || name === "signup") window.history.replaceState(null, "", PATH[f] + window.location.search);
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

  // Advisor summaries are on for every account (no checkbox); marketing stays a separate opt-in
  const consents = () => ({ terms: true, share: true, marketing: values.marketing, submittedAt: new Date().toISOString() });
  const failForm = (f: Flow, msg: string) => { setFormError((e) => ({ ...e, [f]: msg })); announce(msg); };

  /* Clerk's field errors land on our fields; anything else shows above the button */
  function showClerkError(f: Flow, error: unknown) {
    const first = isClerkAPIResponseError(error) ? error.errors[0] : undefined;
    const msg = first?.longMessage ?? first?.message ?? (error instanceof Error ? error.message : "Something went wrong. Try again.");
    const field = FIELD_OF_PARAM[f][first?.meta?.paramName ?? ""];
    if (!field) return failForm(f, msg);
    setErrors((e) => ({ ...e, [field]: msg }));
    focusNext.current = { kind: "field", field };
    announce(msg);
  }

  const toDestination = async ({ decorateUrl }: { decorateUrl: (url: string) => string }) => {
    await recordSignUpConsents();
    goTo(router, decorateUrl(destination()));
  };

  // Polls until the link is opened, on this device or another one, then signs this tab in
  async function waitForLink(f: Flow) {
    if (waiting.current[f]) return;
    waiting.current[f] = true;
    const { error } = f === "login" ? await signIn.emailLink.waitForVerification() : await signUp.verifications.waitForEmailLinkVerification();
    waiting.current[f] = false;
    const status = (f === "login" ? signIn.emailLink.verification : signUp.verifications.emailLinkVerification)?.status;
    const complete = (f === "login" ? signIn.status : signUp.status) === "complete";
    if (!error && status === "verified" && complete) {
      setFinishing(true);
      await (f === "login" ? signIn : signUp).finalize({ navigate: toDestination });
      return;
    }
    setView(f, "h1");
    failForm(f, status === "expired" ? "That link expired. Send a new one."
      : status === "verified" ? "Your account needs another sign-in step that Raiffy doesn’t support yet."
      : "We couldn’t confirm your email. Try again.");
  }

  async function sendLink(f: Flow) {
    const verificationUrl = `${window.location.origin}${withDestination(VERIFY_URL)}`;
    return f === "login"
      ? signIn.emailLink.sendLink({ emailAddress: values["login-email"].trim(), verificationUrl })
      : signUp.verifications.sendEmailLink({ verificationUrl });
  }

  async function submit(e: FormEvent, f: Flow) {
    e.preventDefault();
    setSubmitted((s) => ({ ...s, [f]: true }));
    setFormError((x) => ({ ...x, [f]: "" }));
    const bad = FORM_FIELDS[f].filter((field) => !check(field));
    if (bad.length) {
      focusNext.current = { kind: "field", field: bad[0]! };
      announce(bad.length === 1 ? "One field needs attention." : `${bad.length} fields need attention.`);
      return;
    }
    if (!isLoaded) return;
    setBusy(`${f}-submit`);
    if (f === "signup") {
      const [firstName, ...rest] = values["su-name"].trim().split(/\s+/);
      const created = await signUp.create({
        emailAddress: values["su-email"].trim(), firstName, lastName: rest.join(" ") || undefined,
        legalAccepted: true, unsafeMetadata: { consents: consents() },
      });
      if (created.error) { setBusy(null); return showClerkError(f, created.error); }
      if (signUp.missingFields.length) {
        // The Clerk app asks for more than this form collects (e.g. a password): fix it in the dashboard
        console.error("Clerk sign-up is missing fields:", signUp.missingFields);
        setBusy(null);
        return failForm(f, "Sign-up isn’t available right now. Please try again later.");
      }
    }
    const sent = await sendLink(f);
    setBusy(null);
    if (sent.error) return showClerkError(f, sent.error);
    setSentTo((s) => ({ ...s, [f]: values[f === "login" ? "login-email" : "su-email"].trim() }));
    setCooldown(30);
    setView(f === "login" ? "link-sent" : "signup-done", "h1");
    void waitForLink(f);
  }

  async function resend() {
    setCooldown(30);
    const { error } = await sendLink(flow);
    if (error) showClerkError(flow, error); else announce("Email sent again.");
  }

  /* Google and Apple. Signing up needs the terms first. */
  async function provider(name: string, strategy: (typeof PROVIDERS)[number]["strategy"]) {
    if (busy || !isLoaded) return;
    const f = flow;
    setFormError((x) => ({ ...x, [f]: "" }));
    if (f === "signup" && !check("su-terms")) {
      focusNext.current = { kind: "field", field: "su-terms" };
      announce("Accept the terms and privacy notice to continue.");
      return;
    }
    setBusy(`${view}-${name}`);
    const redirect = { strategy, redirectUrl: destination(), redirectCallbackUrl: withDestination(SSO_CALLBACK) };
    const { error } = f === "login"
      ? await signIn.sso(redirect)
      : await signUp.sso({ ...redirect, legalAccepted: true, unsafeMetadata: { consents: consents() } });
    // On success the browser is already leaving for the provider
    if (error) { setBusy(null); showClerkError(f, error); }
  }

  function differentEmail(f: Flow) {
    const field = f === "login" ? "login-email" : "su-email";
    setValues((v) => ({ ...v, [field]: "" }));
    setView(f);
    focusNext.current = { kind: "field", field };
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
  const formErr = (f: Flow) => (
    <p className="err" role="alert" hidden={!formError[f]}><CircleAlertIcon /><span>{formError[f]}</span></p>
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
        {PROVIDERS.map((p) => (
          <button key={p.name} type="button" className={btnClass("btn btn-ghost", `${view}-${p.name}`)} {...btnBusy(`${view}-${p.name}`)} onClick={() => provider(p.name, p.strategy)}>
            <span className="lbl">{p.mark}{p.name}</span><span className="spin" aria-hidden="true" />
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
              {/* ── Already signed in ── */}
              <section className="view" data-view="signed-in" hidden={!alreadySignedIn}>
                <div className="done">
                  <span className="orb" aria-hidden="true"><UserCheckIcon /></span>
                  <div className="vh">
                    <h1 tabIndex={-1}>You’re already signed in</h1>
                    <p className="text-sm">{user?.primaryEmailAddress
                      ? <>You’re signed in as <b>{user.primaryEmailAddress.emailAddress}</b>.</>
                      : "This browser already has a Raiffy session."}{" "}
                      {initialFlow === "signup" ? "Sign out first to create a different account." : "Sign out first to use a different account."}</p>
                  </div>
                  <button type="button" className="btn btn-dark" disabled={leaving} onClick={() => goTo(router, destination())}>Continue to Raiffy</button>
                  <button type="button" className="btn btn-ghost" disabled={leaving} aria-busy={leaving || undefined} onClick={() => void signOutHere()}>
                    {leaving ? "Signing out…" : "Sign out"}
                  </button>
                </div>
              </section>

              <div className="seg" role="tablist" aria-label="Sign in or create an account" hidden={shown !== "login" && shown !== "signup"}>
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
              <section className={viewClass} data-view="login" id="view-login" role="tabpanel" aria-labelledby="tab-login" hidden={shown !== "login"}>
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
                  {formErr("login")}
                  <button className={btnClass("btn btn-dark", "login-submit")} type="submit" {...btnBusy("login-submit")}>
                    <span className="lbl">Email me a sign-in link</span><span className="spin" aria-hidden="true" />
                  </button>
                </form>
                <p className="switch">New to Raiffy? <button type="button" className="link" onClick={() => setView("signup", "tab")}>Create an account</button></p>
              </section>

              <section className={viewClass} data-view="link-sent" hidden={shown !== "link-sent"}>
                <div className="done">
                  <span className="orb" aria-hidden="true"><MailIcon /></span>
                  <div className="vh">
                    <h1 tabIndex={-1}>Check your inbox</h1>
                    <p className="text-sm">We sent a sign-in link to <b>{sentTo.login}</b>. Open it to continue. This page continues on its own.</p>
                  </div>
                  <button type="button" className="btn btn-ghost resend" disabled={cooldown > 0} onClick={resend}>{resendLabel("Resend link")}</button>
                  <p className="switch"><button type="button" className="link" onClick={() => differentEmail("login")}>Use a different email</button></p>
                </div>
              </section>

              {/* ── Create account ── */}
              <section className={viewClass} data-view="signup" id="view-signup" role="tabpanel" aria-labelledby="tab-signup" hidden={shown !== "signup"}>
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
                    {/* Marketing consent: separate, unticked, optional, never a condition of access */}
                    <label className="check">
                      <input type="checkbox" name="marketing" checked={values.marketing} onChange={(e) => update("marketing", e.target.checked)} />
                      <span><b>I’d like to receive personalised offers from Raiffeisen</b><small>Optional, and never needed to use Raiffy. You can change this anytime. <Link href="/#safeguards">What this means</Link></small></span>
                    </label>
                  </div>
                  {/* Clerk bot protection mounts its challenge here when needed */}
                  <div id="clerk-captcha" />
                  {formErr("signup")}
                  <button className={btnClass("btn btn-dark", "signup-submit")} type="submit" {...btnBusy("signup-submit")}>
                    <span className="lbl">Create account</span><span className="spin" aria-hidden="true" />
                  </button>
                </form>
                <p className="switch">Already have an account? <button type="button" className="link" onClick={() => setView("login", "tab")}>Sign in</button></p>
              </section>

              <section className={viewClass} data-view="signup-done" hidden={shown !== "signup-done"}>
                <div className="done">
                  <span className="orb" aria-hidden="true"><MailCheckIcon /></span>
                  <div className="vh">
                    <h1 tabIndex={-1}>Check your email</h1>
                    <p className="text-sm">We sent a confirmation link to <b>{sentTo.signup}</b>. Open it to finish. This page continues on its own.</p>
                  </div>
                  <button type="button" className="btn btn-ghost resend" disabled={cooldown > 0} onClick={resend}>{resendLabel("Resend email")}</button>
                  <p className="switch"><button type="button" className="link" onClick={() => differentEmail("signup")}>Use a different email</button></p>
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
