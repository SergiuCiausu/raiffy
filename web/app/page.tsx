import type { Metadata } from "next";
import { LandingBody } from "@/components/generated/LandingBody";
import { LandingShell } from "@/components/landing/LandingShell";
import "@/styles/generated/landing.css";

export const metadata: Metadata = {
  title: "Raiffy · AI Assistant",
  description: "Concept landing page: Raiffy, an AI financial assistant for Raiffeisen Bank Romania customers.",
};

export default function LandingPage() {
  return (
    <LandingShell>
      <LandingBody />
    </LandingShell>
  );
}
