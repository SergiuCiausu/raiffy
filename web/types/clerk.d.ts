// The session token carries publicMetadata.role (Clerk → Sessions → Customize session token)
export {};

declare global {
  interface CustomJwtSessionClaims {
    metadata?: { role?: string };
  }
}
