"use client";

import { useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { recordSignUpConsents } from "@/app/sign-up/actions";
import { destination } from "@/components/auth/navigate";

// The email link opens here. Works for sign-in and sign-up. Same browser: sign in and continue. Another device: the original tab continues.
export default function VerifyEmailPage() {
  const { loaded, handleEmailLinkVerification } = useClerk();
  const router = useRouter();
  const [state, setState] = useState<"verifying" | "elsewhere" | "failed">("verifying");
  const started = useRef(false);

  useEffect(() => {
    if (!loaded || started.current) return;
    started.current = true;
    handleEmailLinkVerification(
      { redirectUrlComplete: destination(), onVerifiedOnOtherDevice: () => setState("elsewhere") },
      async (to) => { await recordSignUpConsents(); router.push(to); },
    ).catch(() => setState("failed"));
  }, [loaded, handleEmailLinkVerification, router]);

  return (
    <main className="agent-setup">
      {state === "verifying" && <p>Confirming your email…</p>}
      {state === "elsewhere" && <><h1>Email confirmed</h1><p>Go back to the tab where you started. It continues on its own.</p></>}
      {state === "failed" && <><h1>This link didn’t work</h1><p>It may have expired or already been used.</p><Link href="/sign-in">Start again</Link></>}
    </main>
  );
}
