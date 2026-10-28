import { ConvexError } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { requireMemoryPersistence, resolveMemoryScope, type MemoryEnvironment } from "../lib/agent/memory-store";

export function memoryEnvironment(): MemoryEnvironment {
  return {
    cloudUrl: process.env.CONVEX_CLOUD_URL, siteUrl: process.env.CONVEX_SITE_URL,
    demoDeploymentUrl: process.env.RAIFFY_DEMO_DEPLOYMENT_URL,
    demoIdentityEnabled: process.env.RAIFFY_DEMO_IDENTITY_ENABLED === "true",
    demoPersistenceEnabled: process.env.RAIFFY_MEMORY_DEMO_PERSISTENCE_ENABLED === "true",
  };
}

export async function requireMemoryScope(ctx: Pick<QueryCtx, "auth">, track: "personal" | "business", write = false) {
  const identity = await ctx.auth.getUserIdentity();
  try {
    const scope = resolveMemoryScope({
      identity: identity ? { tokenIdentifier: identity.tokenIdentifier, organizationKey: typeof identity.org_id === "string" ? identity.org_id : null } : null,
      track, environment: memoryEnvironment(),
    });
    if (write) requireMemoryPersistence(scope, memoryEnvironment());
    return scope;
  } catch (error) {
    throw new ConvexError(error instanceof Error ? error.message : "memory_access_denied");
  }
}
