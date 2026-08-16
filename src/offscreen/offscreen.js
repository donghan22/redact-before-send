// Runs inside the extension's offscreen document — NOT a page/content-script
// context, so it is governed by *our own* manifest CSP, not by whatever CSP
// the AI chat site happens to declare (which varies per site and can block
// Worker construction outright, e.g. Gemini's `worker-src` has no `blob:`).
// This is why OCR lives here instead of in the content script's world.

import { createWorker } from "tesseract.js";

const LANG_CACHE = new Map(); // lang -> tesseract worker

async function getWorker(lang, corePath, langPath, workerPath) {
  let w = LANG_CACHE.get(lang);
  if (w) return w;
  w = await createWorker(lang, 1, {
    corePath,
    langPath,
    workerPath,
    // Default true: tesseract.js wraps workerPath in `importScripts(...)`
    // inside a blob: URL, meant for cross-origin CDN workerPaths. Here
    // workerPath is already same-origin (chrome-extension://<id>/...,
    // matching this offscreen document's own origin), and that extra blob
    // wrapper makes Chrome treat the nested importScripts() as cross-origin,
    // failing with "NetworkError: ... failed to load". Skip the wrapper.
    workerBlobURL: false,
    logger: () => {},
  });
  LANG_CACHE.set(lang, w);
  return w;
}

async function downscale(blob, maxSide) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  cv.getContext("2d", { willReadFrequently: true }).drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return { canvas: cv, scale };
}

async function recognize({ dataUrl, lang, maxSide, corePath, langPath, workerPath }) {
  const t0 = performance.now();
  const blob = await fetch(dataUrl).then((r) => r.blob());
  const { canvas, scale } = await downscale(blob, maxSide);
  const worker = await getWorker(lang, corePath, langPath, workerPath);
  const {
    data: { lines },
  } = await worker.recognize(canvas);

  const inv = 1 / scale; // downscaled canvas px → original image px
  const mapped = (lines || []).map((ln) => ({
    text: ln.text || "",
    bbox: {
      x: ln.bbox.x0 * inv,
      y: ln.bbox.y0 * inv,
      w: (ln.bbox.x1 - ln.bbox.x0) * inv,
      h: (ln.bbox.y1 - ln.bbox.y0) * inv,
    },
    words: (ln.words || []).map((wd) => ({
      text: wd.text || "",
      bbox: {
        x: wd.bbox.x0 * inv,
        y: wd.bbox.y0 * inv,
        w: (wd.bbox.x1 - wd.bbox.x0) * inv,
        h: (wd.bbox.y1 - wd.bbox.y0) * inv,
      },
    })),
  }));
  return { lines: mapped, ms: Math.round(performance.now() - t0) };
}

console.log("[PGR:offscreen] document loaded, listener registering");

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "pgr-offscreen-ping") {
    sendResponse({ ok: true });
    return;
  }
  if (msg?.type !== "pgr-ocr-exec") return false;
  console.log("[PGR:offscreen] OCR request received");
  recognize(msg)
    .then((res) => {
      console.log(`[PGR:offscreen] OCR done in ${res.ms}ms, ${res.lines.length} lines`);
      sendResponse({ ok: true, ...res });
    })
    .catch((err) => {
      console.error("[PGR:offscreen] OCR failed:", err);
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    });
  return true; // keep the message channel open for the async response
});
