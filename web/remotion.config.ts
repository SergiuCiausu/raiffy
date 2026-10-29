import path from "node:path";
import { Config } from "@remotion/cli/config";

// Remotion bundles with its own webpack, so it needs the app's "@/" import alias.
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: { ...config.resolve, alias: { ...(config.resolve?.alias ?? {}), "@": path.resolve(process.cwd()) } },
}));
