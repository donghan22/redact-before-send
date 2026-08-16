// Headless smoke test of the OCR + detection pipeline (approximates what the
// worker does) using Node + tesseract.js. Run: node scripts/smoke-ocr.mjs <img>
import { readFile } from "node:fs/promises";
import { createWorker } from "tesseract.js";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/smoke-ocr.mjs <image>");
  process.exit(1);
}

const { detectSensitiveZones } = await import("../src/shared/sensitive.js");

const buf = await readFile(path); // Node tesseract takes a Buffer directly

// NOTE: no workerPath here — in Node tesseract uses its native node worker.
// The browser build (extension) passes workerPath = assets/tesseract/tesseract-worker.js.
const core = new URL("../node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", import.meta.url).pathname;
const lang = new URL("../assets/tesseract/", import.meta.url).pathname;
const worker = await createWorker("eng", 1, {
  corePath: core,
  langPath: lang,
  logger: () => {},
});

const t0 = performance.now();
const { data } = await worker.recognize(buf);
const ms = Math.round(performance.now() - t0);

const lines = (data.lines || []).map((ln) => ({
  text: ln.text,
  bbox: { x: ln.bbox.x0, y: ln.bbox.y0, w: ln.bbox.x1 - ln.bbox.x0, h: ln.bbox.y1 - ln.bbox.y0 },
  words: (ln.words || []).map((w) => ({
    text: w.text,
    bbox: { x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0 },
  })),
}));

console.log(`OCR took ${ms}ms, ${lines.length} lines`);
for (const l of lines) console.log("  OCR:", JSON.stringify(l.text));

const zones = detectSensitiveZones(lines, { strictness: 2 });
console.log(`\nDetected ${zones.length} zone(s):`);
for (const z of zones) console.log(`  ${z.severity} ${z.label} @ (${Math.round(z.x)},${Math.round(z.y)} ${Math.round(z.w)}x${Math.round(z.h)})`);
await worker.terminate();
