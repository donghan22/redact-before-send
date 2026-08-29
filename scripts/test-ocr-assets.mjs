import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OCR_ASSETS, assetIsValid, verifyOcrAssets } from "./ocr-assets.mjs";

verifyOcrAssets();
assert.equal(assetIsValid(OCR_ASSETS[0]), true);
assert.equal(assetIsValid({ ...OCR_ASSETS[0], sha256: "0".repeat(64) }), false);

const emptyRoot = mkdtempSync(join(tmpdir(), "privacy-guard-assets-test-"));
try {
  assert.throws(() => verifyOcrAssets(emptyRoot), /Missing or invalid OCR assets/);
} finally {
  rmSync(emptyRoot, { recursive: true, force: true });
}

console.log("PASS  OCR asset integrity and missing-file checks");
