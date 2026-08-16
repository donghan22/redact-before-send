// Fetch/copy the local (offline) OCR assets into assets/tesseract/.
//  - tesseract core (wasm + js wrapper): copied from local node_modules, no net.
//  - tesseract worker glue: copied from node_modules/tesseract.js/dist.
//  - language traineddata (eng, chi_sim): downloaded from a stable mirror.
//
// Run: npm run fetch-assets
//
// The traineddata download needs network ONCE during setup. After that the
// extension is fully offline. If you skip this, the extension still installs
// but OCR is unavailable and images pass through (see FALLBACK_MODE).

import { mkdirSync, copyFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dest = join(root, "assets", "tesseract");
mkdirSync(dest, { recursive: true });

const files = [
  // core (local — zero network)
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm", "tesseract-core-simd-lstm.wasm"],
  ["node_modules/tesseract.js/dist/worker.min.js", "tesseract-worker.js"],
];

for (const [src, out] of files) {
  const s = join(root, src);
  const d = join(dest, out);
  if (existsSync(s)) {
    copyFileSync(s, d);
    console.log("copied", out);
  } else {
    console.warn("MISSING (expected if deps not installed):", src);
  }
}

// traineddata — network (one-time)
const LANGS = ["eng", "chi_sim"];
const BASE = "https://tessdata.projectnaptha.com/4.0.0/"; // canonical stable mirror
for (const lang of LANGS) {
  const name = `${lang}.traineddata.gz`;
  const out = join(dest, name);
  if (existsSync(out) && statSync(out).size > 100_000) {
    console.log("exists, skip", name);
    continue;
  }
  const url = `${BASE}${name}`;
  console.log("downloading", url);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(out, buf);
    console.log("saved", name, (buf.length / 1e6).toFixed(1) + "MB");
  } catch (e) {
    console.error("FAILED", name, e.message);
  }
}

console.log("✅ assets staged under assets/tesseract/");
