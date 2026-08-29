// Shared, bundle-inlined constants. No runtime imports across worlds.

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

export const STORAGE_KEYS = {
  settings: "pgr.settings",
};
