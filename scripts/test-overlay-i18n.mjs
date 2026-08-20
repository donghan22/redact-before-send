import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const overlay = readFileSync(new URL("../src/content/overlay.js", import.meta.url), "utf8");
const rules = readFileSync(new URL("../src/shared/sensitive.js", import.meta.url), "utf8");
const start = overlay.indexOf("const OVERLAY_COPY = ");
const end = overlay.indexOf("\n};", start) + 3;
const context = {};
vm.runInNewContext(overlay.slice(start, end).replace("const OVERLAY_COPY =", "globalThis.COPY ="), context);

assert.deepEqual(
  Object.keys(context.COPY.en).sort(),
  Object.keys(context.COPY["zh-CN"]).sort(),
  "Overlay dictionaries must have the same keys",
);

for (const [, label] of rules.matchAll(/\n\s+label: "([^"]+)"/g)) {
  assert.ok(context.COPY["zh-CN"].zoneLabels[label], `Missing Chinese zone label: ${label}`);
}

console.log("PASS  overlay i18n and sensitive-zone labels");
