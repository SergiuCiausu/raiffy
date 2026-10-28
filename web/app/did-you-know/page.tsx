import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SwipeNav } from "@/components/generated/SwipeNav";
import { SwipeApp } from "@/components/swipe/SwipeApp";
import { TOPICS } from "@/components/swipe/vignettes";
import { interleave, parseFacts } from "@/lib/facts";
import "@/styles/generated/swipe.css";

export const metadata: Metadata = {
  title: "Did you know · Raiffy",
  description: "Short, plain-language money facts from Raiffy, one card at a time.",
};

/* The cards come straight from the content team's markdown, read at build time. */
const FACTS_MD = join(process.cwd(), "..", "swipe-cards", "raiffy-150-did-you-know-finance-posts.md");

async function getFacts() {
  "use cache";
  cacheLife("max"); // changes only with a new build
  return parseFacts(await readFile(FACTS_MD, "utf8"));
}

export default async function DidYouKnowPage() {
  const parsed = await getFacts();
  const topics = parsed.map((t, i) => ({ ...t, ...(TOPICS[i] ?? { short: t.name, bloom: ["90%", "0%"] as [string, string], visual: { type: "dyk" as const } }) }));
  return (
    <div className="pg-swipe js" data-mode="daylight">
      <a className="sr-only" href="#deck">Skip to the cards</a>
      <SwipeNav />
      <main id="main" className="page">
        <div className="container split">
          <SwipeApp topics={topics} all={interleave(parsed)} />
        </div>
      </main>
    </div>
  );
}
