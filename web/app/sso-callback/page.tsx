"use client";

import "@/styles/generated/auth.css";
import { HandleSSOCallback } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { recordSignUpConsents } from "@/app/sign-up/actions";
import { destination, goTo, withDestination } from "@/components/auth/navigate";

// Google and Apple return here for sign-in and sign-up; Clerk finishes (or transfers between the two) and we route on
export default function SSOCallbackPage() {
  const router = useRouter();
  return (
    <main className="agent-setup">
      <p>Finishing sign-in…</p>
      <HandleSSOCallback
        navigateToApp={async ({ decorateUrl }) => { await recordSignUpConsents(); goTo(router, decorateUrl(destination())); }}
        navigateToSignIn={() => router.push(withDestination("/sign-in"))}
        navigateToSignUp={() => router.push(withDestination("/sign-up"))}
      />
    </main>
  );
}
