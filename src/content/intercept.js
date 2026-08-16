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

export function installInterception(settings, onImage) {
  document.addEventListener("paste", (e) => onPaste(e, settings, onImage), true);
  document.addEventListener("drop", (e) => onDrop(e, settings, onImage), true);
  document.addEventListener("change", (e) => onChange(e, settings, onImage), true);
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

// ---- paste ----------------------------------------------------------------

async function onPaste(e, settings, onImage) {
  if (isSafe(e) || !(e.clipboardData && e.clipboardData.files)) return;
  const file = firstImage(e.clipboardData.files);
  if (!file) return;
  e.preventDefault();
  e.stopPropagation();
  await runPipeline(e, file, "paste", null, onImage);
}

// ---- drop -----------------------------------------------------------------

async function onDrop(e, settings, onImage) {
  if (isSafe(e) || !(e.dataTransfer && e.dataTransfer.files)) return;
  const file = firstImage(e.dataTransfer.files);
  if (!file) return;
  e.preventDefault();
  e.stopPropagation();
  await runPipeline(e, file, "drop", null, onImage);
}

// ---- <input type=file> change ----------------------------------------------

async function onChange(e, settings, onImage) {
  // Only HTMLInputElement file inputs.
  if (!(e.target instanceof HTMLInputElement)) return;
  if (e.target.type !== "file") return;
  if (isSafe(e)) return; // our own re-dispatch → release to the page

  const file = firstImage(e.target.files);
  if (!file) return;
  e.preventDefault();
  e.stopPropagation();
  await runPipeline(e, file, "change", e.target, onImage);
}

/**
 * Prevent native flow, run detection/redaction, then commit via reinjection.
 * `onImage` → { action: "pass" | "replace" | "block", blob? }
 */
async function runPipeline(originalEvent, file, kind, input, onImage) {
  try {
    const decision = await onImage({ file, kind, input, event: originalEvent });
    if (!decision || decision.action === "block") {
      console.log("[PGR] pipeline: blocked/cancelled, not reinjecting");
      return; // user cancelled
    }
    const outFile =
      decision.action === "replace" && decision.blob
        ? new File([decision.blob], baseName(file.name), { type: "image/png" })
        : file;
    reinject(originalEvent, kind, input, outFile);
  } catch (err) {
    // Never silently swallow an upload: if analysis blew up, pass the original
    // through so the user isn't stuck.
    console.warn("[PGR] pipeline error, passing original through", err);
    reinject(originalEvent, kind, input, file);
  }
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
    const ev = new Event("change", { bubbles: true, cancelable: true });
    markSafe(ev);
    const dispatched = input.dispatchEvent(ev);
    console.log(`[PGR] reinject via input.files+change dispatched=${dispatched} isTrusted=${ev.isTrusted}`);
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
