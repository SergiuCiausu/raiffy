"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useClerk } from "@clerk/nextjs";
import { CHAT_HREF } from "@/lib/staff-nav";
import { ArrowLeftIcon, ChevronRightIcon, CompassIcon, LogOutIcon, MenuIcon } from "lucide-react";

/*
 * The staff shell shared by admin.html and console.html: sidebar with logo, page nav, and a footer with the exit to the chat and the signed-in person,
 * a top bar with breadcrumbs, and one scrolling page. Under 860px the sidebar is a drawer: the rest is inert,
 * Escape and the scrim close it, and focus returns to the menu button. Styles come from the generated page CSS.
 */

export type Crumb = { label: string; href?: string };
export type Me = { name: string; title: string; initials: string };

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

export function StaffShell({ logoHref, nav, me, crumbs, top, children }: {
  logoHref: string; nav: ReactNode; me: Me; crumbs: Crumb[]; top?: ReactNode; children: ReactNode;
}) {
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLButtonElement>(null);
  const close = (refocus: boolean) => { setOpen(false); if (refocus) menu.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(true); };
    const wide = window.matchMedia("(min-width: 860px)");
    const onWide = () => { if (wide.matches) close(false); };
    document.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => { document.removeEventListener("keydown", onKey); wide.removeEventListener("change", onWide); };
  }, [open]);

  return (
    <>
      <a className="skip" href="#content">Skip to content</a>
      <div className={open ? "app side-open" : "app"}>
        <aside className="side" aria-label="Console navigation" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) close(false); }}>
          <div className="side-top">
            <Link className="logo" href={logoHref}><span className="logo-mark"><CompassIcon aria-hidden="true" /></span>Raiffy <small>Console</small></Link>
          </div>
          <nav className="nav" aria-label="Console pages">{nav}</nav>
          <div className="me">
            <Link className="btn btn-ghost btn-sm back-chat" href={CHAT_HREF}><ArrowLeftIcon aria-hidden="true" />Back to chat</Link>
            <div className="me-row">
              <span className="ava" aria-hidden="true">{me.initials}</span>
              <div><b>{me.name}</b><small>{me.title}</small></div>
              <button type="button" className="icon-btn" aria-label="Sign out" onClick={() => void signOut({ redirectUrl: "/sign-in" })}><LogOutIcon aria-hidden="true" /></button>
            </div>
          </div>
        </aside>

        <div className="main" inert={open}>
          <header className="top">
            <button ref={menu} type="button" className="icon-btn menu" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(true)}><MenuIcon aria-hidden="true" /></button>
            <nav className="crumbs" aria-label="Breadcrumb">
              {crumbs.map((c, i) => (
                <span key={c.label} style={{ display: "contents" }}>
                  {i > 0 && <ChevronRightIcon aria-hidden="true" />}
                  {c.href ? <Link href={c.href}>{c.label}</Link> : <b aria-current="page">{c.label}</b>}
                </span>
              ))}
            </nav>
            {top && <div className="top-actions">{top}</div>}
          </header>
          <div className="scroll">
            <main className="page" id="content" tabIndex={-1}>{children}</main>
          </div>
        </div>
      </div>
      <div className="scrim" hidden={!open} onClick={() => close(true)} />
    </>
  );
}
