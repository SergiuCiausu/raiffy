import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    // The backend's pnpm-lock.yaml one folder up would otherwise make Next treat the repo root as a
    // monorepo root, which breaks module ids in dev ("Could not find the module … in the React Client Manifest")
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
