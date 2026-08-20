// MV3 service worker.
//
// Two jobs:
//  1. Persist settings on install.
//  2. Own the offscreen document's lifecycle and relay OCR requests to it.
//     OCR must run in an offscreen document (see src/offscreen/offscreen.js)
//     rather than a content-script-spawned Worker, because content scripts
//     run inside the host page's execution context and are therefore bound
//     by *that page's* CSP — some sites (e.g. Gemini) declare `worker-src`
//     without `blob:`, which silently blocks Worker construction. Offscreen
//     documents are governed by the extension's own (permissive) CSP.
//
// This service worker itself is short-lived (MV3 kills it after ~30s idle),
// but that's fine here: it only proxies a message and returns — it never
// runs the OCR itself, so it never needs to stay alive through a long task.

import { DEFAULT_SETTINGS } from "../shared/config.js";
import { STORAGE_KEYS } from "../shared/constants.js";

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(STORAGE_KEYS.settings);
  if (!existing[STORAGE_KEYS.settings]) {
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: DEFAULT_SETTINGS });
  }
});

const OFFSCREEN_URL = "dist/offscreen.html";
let creatingOffscreen = null; // de-dupes concurrent createDocument calls

// chrome.offscreen.hasDocument() is undocumented/unsupported (an artifact of
// the experimental API that never shipped); the officially supported check
// is chrome.runtime.getContexts(). We still fall back to swallowing
// createDocument's "already exists" error in case getContexts is ever
// unavailable, so this stays robust either way.
async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    await waitUntilOffscreenReady();
    return;
  }
  if (creatingOffscreen) {
    await creatingOffscreen;
    await waitUntilOffscreenReady();
    return;
  }
  creatingOffscreen = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ["WORKERS"],
      justification: "Run local OCR (Tesseract.js) in a Worker to detect sensitive text in images before upload.",
    })
    .catch((err) => {
      // Another call won the race and created it first — not a real failure.
      if (!/already exists|single offscreen/i.test(String(err?.message))) throw err;
    });
  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
  await waitUntilOffscreenReady();
}

// createDocument() resolving only means the HTML has loaded — not that
// offscreen.js has finished parsing/executing and registered its
// onMessage listener. Sending the real "pgr-ocr-exec" message too early
// gets no listener on the other end, and chrome.runtime.sendMessage then
// rejects with "The message port closed before a response was received."
// Poll a lightweight ping until the listener answers (or give up).
async function waitUntilOffscreenReady(timeoutMs = 5000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await chrome.runtime.sendMessage({ type: "pgr-offscreen-ping" });
      if (res?.ok) return;
    } catch {
      // listener not registered yet — retry
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Offscreen document did not become ready in time");
}

// Keep OCR results on a Port instead of a long-lived sendMessage response.
// Chrome can close the latter while an MV3 service worker/offscreen document
// is starting, which leaves the content script with no response at all.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "pgr-ocr") return;
  port.onMessage.addListener((msg) => {
    if (msg?.type !== "pgr-ocr-run") return;
    (async () => {
      let result;
      try {
        await ensureOffscreenDocument();
        console.log("[PGR:background] offscreen ready, forwarding OCR request");
        result = await chrome.runtime.sendMessage({ ...msg, type: "pgr-ocr-exec" });
      } catch (err) {
        console.error("[PGR:background] OCR relay failed:", err);
        result = { ok: false, error: String((err && err.message) || err) };
      }
      try {
        port.postMessage({ requestId: msg.requestId, result });
      } catch {
        // The tab navigated away while OCR was running.
      }
    })();
  });
});
