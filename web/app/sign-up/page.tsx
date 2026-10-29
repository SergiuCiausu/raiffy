import type { Metadata } from "next";
import "@/styles/generated/auth.css";
import { AuthScreen } from "@/components/auth/AuthScreen";

export const metadata: Metadata = {
  title: "Create account · Raiffy",
  description: "Concept sign-up page for Raiffy, an AI financial assistant for Raiffeisen Bank Romania customers.",
};

export default function SignUpPage() {
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    ? <AuthScreen initialFlow="signup" />
    : <main className="agent-setup"><h1>Sign-up setup is incomplete</h1><p>Authentication must be configured before an account can be created.</p></main>;
}
