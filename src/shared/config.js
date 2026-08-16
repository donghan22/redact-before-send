// Runtime settings defaults + load/save into chrome.storage.
import { STORAGE_KEYS } from "./constants.js";

export const DEFAULT_SETTINGS = {
  enabled: true,
  // 1 = lenient … 3 = strict (see sensitive.js)
  strictness: 2,
  // Language(s) to load for OCR. chi_sim+eng needed for Chinese IDs.
  ocrLang: "eng+chi_sim",
  // Max side (px) for the image before OCR (downsampled for speed).
  ocrMaxSide: 1440,
  // Whether to also apply the "recognised text" proactively, or only warn.
  autoRedact: true,
  sites: {
    "chatgpt.com": true,
    "chat.openai.com": true,
    "claude.ai": true,
    "chat.deepseek.com": true,
    "gemini.google.com": true,
  },
  // Extra company-specific keywords (e.g. project code names).
  customKeywords: [],
  // Always-skip these once, no prompt (e.g. totally benign screenshots).
  quietMode: false,
};

export async function loadSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const saved = data[STORAGE_KEYS.settings];
  if (!saved) return { ...DEFAULT_SETTINGS };
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    sites: { ...DEFAULT_SETTINGS.sites, ...(saved.sites || {}) },
    customKeywords: Array.isArray(saved.customKeywords) ? saved.customKeywords : DEFAULT_SETTINGS.customKeywords,
  };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
}

export function isHostEnabled(settings, hostname) {
  return !!settings.sites?.[hostname];
}
