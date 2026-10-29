import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { anyApi } from "convex/server";
import schema from "./schema";

const modules = {
  "./_generated/server.js": () => import("./_generated/server"),
  "./handoff.ts": () => import("./handoff"),
};
const identity = (subject: string) => ({ subject, issuer: "https://clerk.test", tokenIdentifier: `https://clerk.test|${subject}` });

async function conversation() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const threadId = await ctx.db.insert("ragThreads", { track: "personal", title: "Car loan", ownerKey: "https://clerk.test|alice", organizationKey: null });
    await ctx.db.insert("ragMessages", { threadId, role: "user", text: "Can I borrow 50,000 lei? My card is 4111 1111 1111 1111." });
    const messageId = await ctx.db.insert("ragMessages", { threadId, role: "assistant", text: "Here are your routes.", status: "done" });
    return { threadId, messageId };
  });
  return { t, ...ids };
}

describe("adviser handoff requests", () => {
  it("shows the customer what the adviser gets, then records one request per answer", async () => {
    const { t, messageId } = await conversation();
    const alice = t.withIdentity(identity("alice"));
    const before = await alice.query(anyApi.handoff.forMessage, { messageId });
    expect(before.request).toBeNull();
    expect(before.preview).toHaveLength(1);
    expect(before.preview[0]).not.toContain("4111 1111 1111 1111");

    const sent = await alice.mutation(anyApi.handoff.request, { messageId, reason: "customer_request" });
    expect(sent).toMatchObject({ status: "requested", reference: expect.stringMatching(/^RF-[2-9A-Z]{6}$/) });
    expect(await alice.mutation(anyApi.handoff.request, { messageId, reason: "customer_request" })).toEqual(sent);
    expect((await alice.query(anyApi.handoff.forMessage, { messageId })).request).toEqual(sent);
    const stored = await t.run((ctx) => ctx.db.query("handoffRequests").collect());
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ ownerKey: "https://clerk.test|alice", reason: "customer_request", summary: before.preview });
  });

  it("refuses anonymous callers and other customers", async () => {
    const { t, messageId } = await conversation();
    await expect(t.query(anyApi.handoff.forMessage, { messageId })).rejects.toThrow(/authentication_required/);
    await expect(t.withIdentity(identity("bob")).mutation(anyApi.handoff.request, { messageId, reason: "complaint" }))
      .rejects.toThrow(/conversation_unavailable/);
  });
});
