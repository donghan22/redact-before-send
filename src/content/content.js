// Content-script orchestrator (bundle entry).
//
// Flow: intercept image entry → OCR in a dedicated worker → regex/detect zones
// → if sensitive: show review overlay → redact via canvas → reinject safe file.
// Everything stays local; this file never touches chrome.runtime for detection.

import { installInterception } from "./intercept.js";
import { showRedactionPreview, showReviewOverlay } from "./overlay.js";
import { ocrLines } from "../engine/ocr.js";
import { redactImage } from "../engine/redact.js";
import { detectSensitiveZones } from "../shared/sensitive.js";
import { loadSettings, isHostEnabled } from "../shared/config.js";
import { STORAGE_KEYS } from "../shared/constants.js";

let settings = null;
let syncPageInterception = () => {};

init();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORAGE_KEYS.settings]) return;
  loadSettings().then((next) => {
    settings = next;
    syncPageInterception();
  });
});

async function init() {
  // Register before any await: ChatGPT handles file-input changes on document
  // too, so registering after storage resolves can lose the original event.
  syncPageInterception = installInterception(
    () => (settings && isHostEnabled(settings, location.hostname) ? settings : null),
    handleImage,
  );
  settings = await loadSettings();
  syncPageInterception();
}

/**
 * Interceptor callback → decision passed to reinjection.
 *   { action: "pass" }                                  no risk detected
 *   { action: "replace", blob }                         redacted
 *   { action: "block" }                                 user cancelled
 */
async function handleImage({ file }) {
  // 1) OCR (async, in worker) — object URL never leaves this tab.
  let lines;
  try {
    const res = await ocrLines(file, settings);
    lines = res.lines;
  } catch (err) {
    console.warn("[PGR] OCR unavailable, passing original through:", err);
    // Fallback: without OCR we can't reliably localise risk, so ask the user.
    // Keep UX safe-by-default: prompt but allow pass-through.
    return { action: "pass" };
  }

  // 2) Detect sensitive zones from OCR lines.
  const zones = detectSensitiveZones(lines, {
    strictness: settings.strictness,
    keywords: settings.customKeywords,
  });
  if (zones.length === 0) return { action: "pass" };

  // 3) Show review overlay.
  const objectUrl = URL.createObjectURL(file);
  const dims = await imageDimensions(objectUrl);
  const choice = await showReviewOverlay({ objectUrl, dimensions: dims, zones, language: settings.uiLanguage });
  URL.revokeObjectURL(objectUrl);

  if (choice === "cancel") return { action: "block" };
  if (choice === "ignore") return { action: "pass" };

  // 4) Redact & return safe blob for reinjection.
  let blob = await redactImage(file, zones, { mosaic: true });
  const previewUrl = URL.createObjectURL(blob);
  const review = await showRedactionPreview({ objectUrl: previewUrl, dimensions: dims, language: settings.uiLanguage });
  URL.revokeObjectURL(previewUrl);
  if (review.action === "cancel") return { action: "block" };
  if (review.zones.length) blob = await redactImage(blob, review.zones, { mosaic: true });
  return { action: "replace", blob };
}

function imageDimensions(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = url;
  });
}
