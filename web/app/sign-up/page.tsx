import type { Metadata } from "next";
import { AuthScreen } from "@/components/auth/AuthScreen";
import "@/styles/generated/auth.css";

export const metadata: Metadata = {
  title: "Create account · Raiffy",
  description: "Concept sign-up page for Raiffy, an AI financial assistant for Raiffeisen Bank Romania customers.",
};

export default function SignUpPage() {
  return <AuthScreen initialFlow="signup" />;
}
