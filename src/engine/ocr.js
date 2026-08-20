// OCR client — runs from the content script but the actual OCR executes in
// the extension's offscreen document (see src/offscreen/offscreen.js), not
// here. Content scripts are bound by the *host page's* CSP, and some AI
// platforms restrict `worker-src` in ways that block Worker construction
// outright; the offscreen document runs under the extension's own CSP
// instead. We relay through the background service worker because content
// scripts cannot message an offscreen document directly.
//
// chrome.runtime messaging is JSON-only (no raw Blob/ArrayBuffer), so the
// image is sent as a data: URL.

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

let port;
const pending = new Map();

function getPort() {
  if (port) return port;
  port = chrome.runtime.connect({ name: "pgr-ocr" });
  port.onMessage.addListener(({ requestId, result }) => {
    const request = pending.get(requestId);
    if (!request) return;
    pending.delete(requestId);
    request.resolve(result);
  });
  port.onDisconnect.addListener(() => {
    const error = new Error(chrome.runtime.lastError?.message || "OCR connection closed");
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    port = null;
  });
  return port;
}

function sendOcrRequest(message) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    try {
      getPort().postMessage({ ...message, requestId });
    } catch (err) {
      pending.delete(requestId);
      reject(err);
    }
  });
}

/**
 * OCR a Blob returning lines with bboxes in *original* image pixels.
 * @param {Blob} blob image file
 * @param {{ocrLang:string, ocrMaxSide:number}} settings
 */
export async function ocrLines(blob, settings) {
  const dataUrl = await blobToDataUrl(blob);
  const res = await sendOcrRequest({
    type: "pgr-ocr-run",
    dataUrl,
    lang: settings.ocrLang || "eng+chi_sim",
    maxSide: settings.ocrMaxSide || 1440,
    corePath: chrome.runtime.getURL("assets/tesseract/tesseract-core-simd-lstm.wasm.js"),
    langPath: chrome.runtime.getURL("assets/tesseract/"),
    workerPath: chrome.runtime.getURL("assets/tesseract/tesseract-worker.js"),
  });
  if (!res) throw new Error("No response from OCR relay (extension context may have reloaded)");
  if (!res.ok) throw new Error(res.error || "OCR failed");
  return { lines: res.lines, ms: res.ms };
}

// No-op: OCR runs in the offscreen document (owned by the background
// service worker), not a worker spawned by this content script. Kept so
// content.js doesn't need to change its pagehide cleanup call.
export function disposeOcr() {}
