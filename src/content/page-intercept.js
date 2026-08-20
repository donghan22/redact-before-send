// Runs in the page's MAIN world. ChatGPT creates a detached file input for
// attachment picking, so an isolated-world MutationObserver cannot see it.

const CHANNEL = "pgr-file-picker-v1";
const pending = new Map();
const bound = new WeakSet();
const roots = new WeakSet();
const requestIds = new WeakMap();
const processedHandles = new WeakMap();
let enabled = false;
let nextId = 1;

console.log("[PGR:picker] MAIN-world script loaded (0.1.4)");

function firstImage(files) {
  return Array.from(files || []).find((file) => /^image\//.test(file.type));
}

function intercept(input, event) {
  if (!enabled || !event.isTrusted || input?.type !== "file") return;

  const existingId = requestIds.get(input);
  if (existingId) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  const file = firstImage(input.files);
  if (!file) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  const requestId = `${Date.now()}-${nextId++}`;
  requestIds.set(input, requestId);
  pending.set(requestId, { input });
  console.log(`[PGR:picker] intercepted attachment, size=${file.size}B type=${file.type}`);
  window.postMessage({ channel: CHANNEL, action: "selected", requestId, file }, "*");
}

function processPickedFile(file) {
  if (!enabled || !/^image\//.test(file?.type || "")) return Promise.resolve(file);

  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${nextId++}`;
    pending.set(requestId, { resolve, reject });
    console.log(`[PGR:picker] intercepted FileSystem attachment, size=${file.size}B type=${file.type}`);
    window.postMessage({ channel: CHANNEL, action: "selected", requestId, file }, "*");
  });
}

function bind(input) {
  if (bound.has(input) || input.type !== "file") return;
  bound.add(input);
  input.addEventListener("input", (event) => intercept(input, event), true);
  input.addEventListener("change", (event) => intercept(input, event), true);
}

function watchRoot(root) {
  if (roots.has(root)) return;
  roots.add(root);
  const capture = (event) => {
    const input = event.composedPath().find((node) => node?.nodeName === "INPUT" && node.type === "file");
    if (input) intercept(input, event);
  };
  root.addEventListener("input", capture, true);
  root.addEventListener("change", capture, true);
}

for (const method of ["click", "showPicker"]) {
  const original = HTMLInputElement.prototype[method];
  if (typeof original !== "function") continue;
  HTMLInputElement.prototype[method] = function (...args) {
    bind(this);
    return original.apply(this, args);
  };
}

// Some attachment pickers use the File System Access API and never emit a
// usable <input type=file> event. Intercept the file at the point where the
// page reads it, before ChatGPT can create an object URL or upload it.
const nativeGetFile = globalThis.FileSystemFileHandle?.prototype?.getFile;
if (typeof nativeGetFile === "function") {
  globalThis.FileSystemFileHandle.prototype.getFile = async function (...args) {
    const file = await nativeGetFile.apply(this, args);
    if (!enabled || !/^image\//.test(file?.type || "")) return file;

    const key = `${file.name}:${file.size}:${file.lastModified}`;
    const cached = processedHandles.get(this);
    if (cached?.key === key) return cached.promise;

    const promise = processPickedFile(file);
    processedHandles.set(this, { key, promise });
    try {
      return await promise;
    } catch (error) {
      processedHandles.delete(this);
      throw error;
    }
  };
}

const attachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (...args) {
  const root = attachShadow.apply(this, args);
  watchRoot(root);
  return root;
};
watchRoot(document);

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.channel !== CHANNEL) return;

  if (event.data.action === "configure") {
    enabled = !!event.data.enabled;
    if (enabled) console.log("[PGR:picker] MAIN-world interceptor enabled");
    return;
  }

  if (event.data.action !== "processed") return;
  const request = pending.get(event.data.requestId);
  if (!request) return;
  pending.delete(event.data.requestId);

  const file = event.data.file;
  if (request.resolve) {
    if (file) request.resolve(file);
    else request.reject(new DOMException("Image upload cancelled", "AbortError"));
    return;
  }

  const input = request.input;
  requestIds.delete(input);
  if (!file) {
    input.value = "";
    return;
  }

  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  for (const type of ["input", "change"]) {
    input.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, composed: true }));
  }
});
