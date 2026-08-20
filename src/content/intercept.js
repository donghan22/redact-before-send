// Event interception + re-injection.
//
// We bind on document in the CAPTURE phase so we run before the page's own
// handlers. When an image file enters via paste / drop / <input type=file>
// change we stopPropagation+preventDefault, hand the File to the orchestrator
// (`onImage`), and after it resolves we re-dispatch a *safe* equivalent event.
//
// Re-dispatched (synthetic) events are untrusted (`isTrusted === false`). Some
// sites reject those; the file-input path (assigning `input.files` then firing
// 'change') is the most reliable, which is why we route every flow through it
// when a backing <input> exists. See README "Known limits".

import { SAFE_FLAG } from "../shared/constants.js";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"];
const PROCESSING_INPUTS = new WeakSet();
const PAGE_CHANNEL = "pgr-file-picker-v1";

export function installInterception(getSettings, onImage) {
  document.addEventListener("paste", (e) => onPaste(e, getSettings, onImage), true);
  document.addEventListener("drop", (e) => onDrop(e, getSettings, onImage), true);
  document.addEventListener("input", (e) => onChange(e, getSettings, onImage), true);
  document.addEventListener("change", (e) => onChange(e, getSettings, onImage), true);
  watchFileInputs(getSettings, onImage);
  installPageBridge(onImage);
  return () =>
    window.postMessage({ channel: PAGE_CHANNEL, action: "configure", enabled: isEnabled(getSettings) }, "*");
}

function isSafe(e) {
  return !!(e && e[SAFE_FLAG]);
}
function markSafe(e) {
  try {
    e[SAFE_FLAG] = true;
  } catch {}
}

function firstImage(list) {
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (IMAGE_TYPES.includes(f.type) || /^image\//.test(f.type)) return f;
  }
  return null;
}

function isEnabled(getSettings) {
  return !!getSettings()?.enabled;
}

function blockOriginalUpload(e) {
  e.preventDefault();
  // ChatGPT also delegates file-input changes from document. stopPropagation()
  // leaves listeners on this same node running, so the original file escapes.
  e.stopImmediatePropagation();
}

// ---- paste ----------------------------------------------------------------

async function onPaste(e, getSettings, onImage) {
  if (!isEnabled(getSettings) || isSafe(e) || !(e.clipboardData && e.clipboardData.files)) return;
  const file = firstImage(e.clipboardData.files);
  if (!file) return;
  blockOriginalUpload(e);
  await runPipeline(e, file, "paste", null, onImage);
}

// ---- drop -----------------------------------------------------------------

async function onDrop(e, getSettings, onImage) {
  if (!isEnabled(getSettings) || isSafe(e) || !(e.dataTransfer && e.dataTransfer.files)) return;
  const file = firstImage(e.dataTransfer.files);
  if (!file) return;
  blockOriginalUpload(e);
  await runPipeline(e, file, "drop", null, onImage);
}

// ---- <input type=file> change ----------------------------------------------

async function onChange(e, getSettings, onImage) {
  // Synthetic events are our reinjection (including MAIN-world picker flow).
  if (!isEnabled(getSettings) || isSafe(e) || !e.isTrusted) return;
  const input = fileInputFromEvent(e);
  if (!input) return;

  // Native file selection emits input followed immediately by change. The
  // first event owns the async pipeline; suppress the second original event.
  if (PROCESSING_INPUTS.has(input)) {
    blockOriginalUpload(e);
    return;
  }

  const file = firstImage(input.files);
  if (!file) return;
  blockOriginalUpload(e);
  PROCESSING_INPUTS.add(input);
  try {
    await runPipeline(e, file, "change", input, onImage);
  } finally {
    PROCESSING_INPUTS.delete(input);
  }
}

function fileInputFromEvent(e) {
  for (const node of e.composedPath?.() || [e.target]) {
    if (node?.nodeName === "INPUT" && node.type === "file") return node;
  }
  return null;
}

// A file input inside a Shadow DOM can emit a non-composed change event, which
// never reaches document. Bind directly to every reachable input as well.
function watchFileInputs(getSettings, onImage) {
  const roots = new WeakSet();
  const inputs = new WeakSet();

  const bind = (input) => {
    if (inputs.has(input) || input.type !== "file") return;
    inputs.add(input);
    input.addEventListener("input", (e) => onChange(e, getSettings, onImage), true);
    input.addEventListener("change", (e) => onChange(e, getSettings, onImage), true);
  };

  const scan = (root) => {
    if (roots.has(root)) return;
    roots.add(root);
    if (root.nodeName === "INPUT") bind(root);
    root.querySelectorAll?.("input[type='file']").forEach(bind);
    root.querySelectorAll?.("*").forEach((el) => {
      if (el.shadowRoot) scan(el.shadowRoot);
    });
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.nodeName === "INPUT") bind(node);
          node.querySelectorAll?.("input[type='file']").forEach(bind);
          if (node.shadowRoot) scan(node.shadowRoot);
          node.querySelectorAll?.("*").forEach((el) => {
            if (el.shadowRoot) scan(el.shadowRoot);
          });
        }
      }
    }).observe(root, { childList: true, subtree: true });
  };

  scan(document);
}

/**
 * Prevent native flow, run detection/redaction, then commit via reinjection.
 * `onImage` → { action: "pass" | "replace" | "block", blob? }
 */
async function runPipeline(originalEvent, file, kind, input, onImage) {
  const outFile = await processImage(originalEvent, file, kind, input, onImage);
  if (outFile) reinject(originalEvent, kind, input, outFile);
}

async function processImage(originalEvent, file, kind, input, onImage) {
  try {
    const decision = await onImage({ file, kind, input, event: originalEvent });
    if (!decision || decision.action === "block") {
      console.log("[PGR] pipeline: blocked/cancelled, not reinjecting");
      return null;
    }
    return (
      decision.action === "replace" && decision.blob
        ? new File([decision.blob], baseName(file.name), { type: "image/png" })
        : file
    );
  } catch (err) {
    // Never silently swallow an upload: if analysis blew up, pass the original
    // through so the user isn't stuck.
    console.warn("[PGR] pipeline error, passing original through", err);
    return file;
  }
}

function installPageBridge(onImage) {
  window.addEventListener("message", async (event) => {
    const message = event.data;
    if (event.source !== window || message?.channel !== PAGE_CHANNEL || message.action !== "selected") return;
    const file = await processImage(null, message.file, "change", null, onImage);
    window.postMessage({ channel: PAGE_CHANNEL, action: "processed", requestId: message.requestId, file }, "*");
  });
}

// ---- re-injection ----------------------------------------------------------

/**
 * Re-dispatch a safe event carrying `file`, bypassing our own interceptor via
 * SAFE_FLAG. `kind` matches the original trigger. Returns void.
 */
function reinject(originalEvent, kind, input, file) {
  console.log(`[PGR] reinjecting via "${kind}", file size=${file.size}B`);
  const dt = new DataTransfer();
  dt.items.add(file);

  if (kind === "change" && input) {
    input.files = dt.files;
    for (const type of ["input", "change"]) {
      const ev = new Event(type, { bubbles: true, cancelable: true, composed: true });
      markSafe(ev);
      const dispatched = input.dispatchEvent(ev);
      console.log(`[PGR] reinject via input.files+${type} dispatched=${dispatched} isTrusted=${ev.isTrusted}`);
    }
    return;
  }

  const target = originalEvent ? originalEvent.target : findComposer(input);
  if (!target) {
    console.warn("[PGR] no reinjection target", kind);
    return;
  }

  if (kind === "paste") {
    const ev = new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });
    markSafe(ev);
    const dispatched = target.dispatchEvent(ev);
    console.log(`[PGR] reinject via synthetic paste on`, target, `dispatched=${dispatched} isTrusted=${ev.isTrusted}`);
  } else if (kind === "drop") {
    const ev = new DragEvent("drop", {
      dataTransfer: dt,
      bubbles: true,
      cancelable: true,
      clientX: originalEvent?.clientX ?? 0,
      clientY: originalEvent?.clientY ?? 0,
    });
    markSafe(ev);
    const dispatched = target.dispatchEvent(ev);
    console.log(`[PGR] reinject via synthetic drop on`, target, `dispatched=${dispatched} isTrusted=${ev.isTrusted}`);
  }
}

// Best-effort composer selector for non-input triggers.
function findComposer() {
  return (
    document.querySelector("#prompt-textarea") ||
    document.querySelector("[contenteditable='true']") ||
    document.querySelector("textarea")
  );
}

function baseName(name) {
  return (name || "image").replace(/\.[^.]+$/, "") + ".png";
}
