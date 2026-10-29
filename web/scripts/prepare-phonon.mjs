import { cp, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Serve the worker and its Wasm modules unchanged; Next need not bundle Rust's loader.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const source = dirname(require.resolve("phonon-tts/package.json"));
const { version, files } = JSON.parse(await readFile(resolve(source, "package.json"), "utf8"));
const destination = resolve(root, "public/vendor/phonon-tts", version);
await mkdir(destination, { recursive: true });
for (const file of files) await cp(resolve(source, file), resolve(destination, file), { recursive: true });
