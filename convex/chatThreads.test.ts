import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = {
  "./_generated/server.js": () => import("./_generated/server"),
  "./chatThreads.ts": () => import("./chatThreads"),
};
const api = anyApi;
const identity = (subject: string) => ({ subject, issuer: "https://clerk.test", tokenIdentifier: `https://clerk.test|${subject}` });
const ana = identity("ana");
const SIM = { type: "simulation", title: "Repayment simulation", product: "Credit de nevoi personale", ratePercent: 5.55, source: "https://bank.ro/loan" };

async function chat(blocks: unknown[] = [SIM]) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const threadId = await ctx.db.insert("ragThreads", { track: "personal", title: "I want to buy a used car", ownerKey: ana.tokenIdentifier, organizationKey: null });
    const question = await ctx.db.insert("ragMessages", { threadId, role: "user", text: "Which loan?" });
    const answer = await ctx.db.insert("ragMessages", { threadId, role: "assistant", text: "…", status: "done", answer: { ui: { blocks, actions: [] } } });
    return { threadId, question, answer };
  });
  return { t, ...ids, as: t.withIdentity(ana), other: t.withIdentity(identity("eve")) };
}
const pinArgs = (messageId: Id<"ragMessages">) => ({ messageId, kind: "simulation", title: "Repayment simulation", meta: "Credit de nevoi personale" });

describe("chat names", () => {
  it("lets the owner rename a chat to one trimmed line", async () => {
    const { t, as, threadId } = await chat();
    expect(await as.mutation(api.chatThreads.rename, { threadId, title: "  Car loan \n plan " })).toEqual({ title: "Car loan plan" });
    expect((await t.run((ctx) => ctx.db.get(threadId)))?.title).toBe("Car loan plan");
    await expect(as.mutation(api.chatThreads.rename, { threadId, title: "   " })).rejects.toThrow("title_invalid");
  });

  it("refuses anyone else, and anyone signed out", async () => {
    const { t, other, threadId } = await chat();
    await expect(other.mutation(api.chatThreads.rename, { threadId, title: "Mine now" })).rejects.toThrow("conversation_unavailable");
    await expect(t.mutation(api.chatThreads.rename, { threadId, title: "Mine now" })).rejects.toThrow("authentication_required");
  });
});

describe("pins", () => {
  it("pins a card once, lists it for its owner only, and unpins it", async () => {
    const { as, other, answer, threadId } = await chat();
    const first = await as.mutation(api.chatThreads.pin, pinArgs(answer));
    expect(await as.mutation(api.chatThreads.pin, pinArgs(answer))).toEqual(first);
    expect(await as.query(api.chatThreads.listPins, { track: "personal" })).toMatchObject([{ threadId, messageId: answer, kind: "simulation", title: "Repayment simulation" }]);
    expect(await other.query(api.chatThreads.listPins, { track: "personal" })).toEqual([]);
    await expect(other.mutation(api.chatThreads.unpin, { pinId: first.id })).rejects.toThrow("pin_unavailable");
    expect(await as.mutation(api.chatThreads.unpin, { pinId: first.id })).toEqual({ removed: true });
    expect(await as.query(api.chatThreads.listPins, { track: "personal" })).toEqual([]);
  });

  it("pins only a card the answer really carries, and never someone else's answer", async () => {
    const { as, other, answer, question } = await chat([{ type: "callout", state: "ready", text: "x", sourceIds: [] }]);
    await expect(as.mutation(api.chatThreads.pin, pinArgs(answer))).rejects.toThrow("pin_unavailable");
    await expect(as.mutation(api.chatThreads.pin, { ...pinArgs(question), kind: "simulation" })).rejects.toThrow("pin_unavailable");
    const withCard = await chat();
    await expect(withCard.other.mutation(api.chatThreads.pin, pinArgs(withCard.answer))).rejects.toThrow("conversation_unavailable");
    await expect(other.mutation(api.chatThreads.pin, { ...pinArgs(answer), kind: "memory" })).rejects.toThrow();
  });

  it("leaves out pins whose chat is gone", async () => {
    const { t, as, answer, threadId } = await chat();
    await as.mutation(api.chatThreads.pin, pinArgs(answer));
    await t.run((ctx) => ctx.db.delete(threadId));
    expect(await as.query(api.chatThreads.listPins, { track: "personal" })).toEqual([]);
  });
});
