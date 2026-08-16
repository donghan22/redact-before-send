// Shared, bundle-inlined constants. No runtime imports across worlds.

export const EXTENSION_NAME = "Privacy Guard Rails";

// Hosts the protector is allowed to run on. Keep in sync with manifest matches.
export const SUPPORTED_HOSTS = [
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "chat.deepseek.com",
  "gemini.google.com",
];

// Re-injected events carry this symbol-ish marker so our own capture-phase
// interceptor can recognise and release them (avoids infinite loop).
export const SAFE_FLAG = "__pgr_safe__";
export const SAFE_FILE_PROP = "__pgr_redacted__";

// How long we are willing to wait, in ms, for OCR+detection during a hot path
// before we give up and show a "still analyzing / force" state. OCR itself runs
// async in a worker, so this bounds the *interaction* stall, not blocking.
export const ANALYSIS_TIMEOUT_MS = 15_000;

// Fallback behaviour if no OCR engine is ready (assets missing).
export const FALLBACK_MODE = "prompt"; // "prompt" | "pass" | "block"

export const STORAGE_KEYS = {
  settings: "pgr.settings",
};
