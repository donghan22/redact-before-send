// Build all extension entry points into dist/ (self-contained bundles so MV3
// content scripts and workers need no static ESM resolution at runtime).
import { build } from "esbuild";
import { mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outdir = join(here, "dist");
mkdirSync(outdir, { recursive: true });

const common = {
  bundle: true,
  format: "iife",
  target: ["chrome110"],
  sourcemap: true,
  logLevel: "info",
  define: { "process.env.NODE_DEBUG": "false" },
};

const targets = [
  { entryPoints: ["src/content/content.js"], outfile: "dist/content.js", ...common },
  { entryPoints: ["src/offscreen/offscreen.js"], outfile: "dist/offscreen.js", ...common },
  { entryPoints: ["src/background/background.js"], outfile: "dist/background.js", ...common, format: "esm" },
  { entryPoints: ["src/popup/popup.js"], outfile: "dist/popup.js", ...common, format: "esm" },
];

// copy HTML files that reference their JS relatively
copyFileSync(join(here, "src/popup/popup.html"), join(outdir, "popup.html"));
copyFileSync(join(here, "src/offscreen/offscreen.html"), join(outdir, "offscreen.html"));

await Promise.all(targets.map((t) => build(t)));
console.log("✅ build complete → dist/");
