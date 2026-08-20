import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const js = readFileSync(new URL("../src/popup/popup.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../src/popup/popup.html", import.meta.url), "utf8");
const start = js.indexOf("const COPY = ");
const end = js.indexOf("\n};", start) + 3;
const context = {};
vm.runInNewContext(js.slice(start, end).replace("const COPY =", "globalThis.COPY ="), context);

const chineseKeys = Object.keys(context.COPY["zh-CN"]).sort();
const englishKeys = Object.keys(context.COPY.en).sort();
assert.deepEqual(englishKeys, chineseKeys, "Chinese and English dictionaries must have the same keys");

for (const match of html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) {
  assert.ok(context.COPY.en[match[1]], `Missing translation: ${match[1]}`);
}

console.log(`PASS  popup i18n (${chineseKeys.length} keys per language)`);
