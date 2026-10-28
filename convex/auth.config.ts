import type { AuthConfig } from "convex/server";

// An unconfigured deployment accepts no browser identities. Never substitute an anonymous user.
export default {
  providers: process.env.CLERK_JWT_ISSUER_DOMAIN
    ? [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN, applicationID: "convex" }] : [],
} satisfies AuthConfig;
