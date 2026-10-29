import { describe, expect, it } from "vitest";
import {
  DEMO_MEMORY_OWNER, isDemoMemoryEnvironment, memoryExpiry, memoryWritesAllowed, requireMemoryPersistence, resolveMemoryScope,
  sameMemoryScope, screenMemorySource, verifyMemoryEvidence, type MemoryEnvironment,
} from "./memory-store";

const environment: MemoryEnvironment = { cloudUrl: "https://demo-dev.eu-west-1.convex.cloud", siteUrl: "https://demo-dev.eu-west-1.convex.site", demoDeploymentUrl: "https://demo-dev.eu-west-1.convex.cloud", demoIdentityEnabled: true, demoPersistenceEnabled: true };
const scope = { ownerKey: DEMO_MEMORY_OWNER, track: "personal" as const, organizationKey: null };
const now = 1_000_000;
const text = "I am saving for a car over the next two years.";
const proposal = { operation: "remember", kind: "goal", text, customerQuote: text, sourceMessageId: "m1" };
const source = { maskedText: text, memoryEligible: true, createdAt: now - 100, expiresAt: now + 100_000 };

describe("memory identity and deployment guards", () => {
  it("requires identity by default and permits only the explicitly enabled pinned dev synthetic persona", () => {
    expect(resolveMemoryScope({ identity: null, track: "personal", environment })).toEqual(scope);
    expect(() => resolveMemoryScope({ identity: null, track: "personal", environment: { ...environment, demoIdentityEnabled: false } })).toThrow("authentication_required");
    expect(() => resolveMemoryScope({ identity: null, track: "business", environment })).toThrow("organization_required");
    expect(() => requireMemoryPersistence(scope, { ...environment, demoPersistenceEnabled: false })).toThrow("memory_persistence_disabled");
    expect(() => requireMemoryPersistence(scope, environment)).not.toThrow();
  });
  it.each(["https://real.convex.cloud", "http://localhost.attacker.test:3210", "http://127.0.0.1@attacker.test", "http://127.0.0.1:3210/path", "http://127.0.0.1:3210?dev=1", "not a URL"])("rejects demo persistence on %s", (cloudUrl) => {
    const cloud = { ...environment, cloudUrl };
    expect(isDemoMemoryEnvironment(cloud)).toBe(false);
    expect(() => resolveMemoryScope({ identity: null, track: "personal", environment: cloud })).toThrow("authentication_required");
    expect(() => requireMemoryPersistence(scope, cloud)).toThrow("memory_persistence_disabled");
  });
  it("also checks the site URL, rejects real-customer writes, and prefers authenticated ownership", () => {
    expect(isDemoMemoryEnvironment({ ...environment, siteUrl: "https://production.convex.site" })).toBe(false);
    expect(isDemoMemoryEnvironment({ ...environment, siteUrl: undefined })).toBe(false);
    expect(isDemoMemoryEnvironment({ ...environment, demoDeploymentUrl: undefined })).toBe(false);
    const identity = { tokenIdentifier: "issuer|user-a", organizationKey: "org-a" };
    expect(resolveMemoryScope({ identity, track: "personal", environment })).toEqual({ ...scope, ownerKey: identity.tokenIdentifier });
    const business = resolveMemoryScope({ identity, track: "business", environment });
    expect(business.organizationKey).toBe("org-a");
    expect(() => requireMemoryPersistence(business, environment)).toThrow("memory_persistence_disabled");
    expect(() => resolveMemoryScope({ identity: { ...identity, organizationKey: null }, track: "business", environment })).toThrow("organization_required");
    expect(sameMemoryScope(business, { ...business, organizationKey: "org-b" })).toBe(false);
    expect(sameMemoryScope(scope, { ...scope, ownerKey: "user-b" })).toBe(false);
  });
  it("lets signed-in customers write only where the owner enabled writes and pinned this deployment", () => {
    const customer = resolveMemoryScope({ identity: { tokenIdentifier: "issuer|ana", organizationKey: null }, track: "personal", environment });
    const local = { ...environment, cloudUrl: "http://127.0.0.1:3210", customerWritesEnabled: true, customerWritesDeploymentUrl: "http://127.0.0.1:3210" };
    expect(() => requireMemoryPersistence(customer, local)).not.toThrow();
    expect(() => requireMemoryPersistence(customer, { ...local, customerWritesEnabled: false })).toThrow("memory_persistence_disabled");
    expect(() => requireMemoryPersistence(customer, { ...local, cloudUrl: "https://production.convex.cloud" })).toThrow("memory_persistence_disabled");
    expect(() => requireMemoryPersistence(customer, { ...local, customerWritesDeploymentUrl: undefined })).toThrow("memory_persistence_disabled");
    expect(memoryWritesAllowed(customer, local)).toBe(true);
    expect(memoryWritesAllowed(customer, { ...local, customerWritesEnabled: false })).toBe(false);
  });

  it("rejects copied production flags, missing pins and spoofed or non-HTTPS deployment URLs", () => {
    expect(isDemoMemoryEnvironment(environment)).toBe(true);
    for (const cloudUrl of ["https://production.eu-west-1.convex.cloud", "http://127.0.0.1:3210", "https://demo-dev.eu-west-1.convex.cloud.attacker.test", "https://demo-dev.eu-west-1.convex.cloud?dev=1"]) {
      expect(isDemoMemoryEnvironment({ ...environment, cloudUrl })).toBe(false);
    }
    expect(isDemoMemoryEnvironment({ ...environment, cloudUrl: "http://demo-dev.convex.cloud", siteUrl: "http://demo-dev.convex.site", demoDeploymentUrl: "http://demo-dev.convex.cloud" })).toBe(false);
  });
});

describe("memory provenance, privacy and retention", () => {
  it.each([
    "My CNP is 1960101123456", "My IBAN is RO49 AAAA 1B31 0075 9384 0000", "4111 1111 1111 1111",
    "My password is hunter2", "My email is a@example.com", "Call me +40722123456",
    "I have diabetes", "I am Christian", "My wife earns 7500 lei", "Sotia mea are 7500 lei", "I have an account balance of 900 lei",
  ])("masks and excludes %s", (raw) => {
    const screened = screenMemorySource(raw);
    expect(screened.memoryEligible).toBe(false);
    expect(screened.maskedText).not.toContain(raw);
    expect(() => verifyMemoryEvidence({ proposal: { ...proposal, text: raw, customerQuote: raw }, source: { ...source, ...screened }, now })).toThrow("memory_source_ineligible");
  });
  it("keeps explicit financial claims and computes expiry from when the claim was stated", () => {
    expect(screenMemorySource("My net income is 7,500 lei per month.").memoryEligible).toBe(true);
    expect(memoryExpiry("stated_financial", now)).toBe(now + 90 * 86_400_000);
    expect(memoryExpiry("constraint", now)).toBe(now + 180 * 86_400_000);
    expect(memoryExpiry("goal", now)).toBe(now + 365 * 86_400_000);
    expect(memoryExpiry("preference", now)).toBe(now + 365 * 86_400_000);
    const checked = verifyMemoryEvidence({ proposal, source, now });
    expect(checked.expiresAt).toBe(memoryExpiry("goal", source.createdAt));
    expect(checked.proposalExpiresAt).toBe(source.expiresAt);
  });
  it("rejects invented quotes, inferred summaries, invalid replacements and ineligible sources", () => {
    expect(() => verifyMemoryEvidence({ proposal: { ...proposal, customerQuote: "I earn 10000" }, source, now })).toThrow("memory_quote_mismatch");
    expect(() => verifyMemoryEvidence({ proposal: { ...proposal, text: "The customer loves luxury cars." }, source, now })).toThrow("memory_quote_mismatch");
    expect(() => verifyMemoryEvidence({ proposal: { ...proposal, operation: "update" }, source, now })).toThrow("invalid_memory_replacement");
    expect(() => verifyMemoryEvidence({ proposal: { ...proposal, operation: "forget" }, source, now })).toThrow("use_customer_deletion_endpoint");
    for (const patch of [{ memoryEligible: false }, { expiresAt: now }, { createdAt: now + 1 }]) {
      expect(() => verifyMemoryEvidence({ proposal, source: { ...source, ...patch }, now })).toThrow("memory_source_ineligible");
    }
    expect(() => verifyMemoryEvidence({ proposal: { ...proposal, ownerKey: "someone-else" }, source, now })).toThrow();
  });
});
