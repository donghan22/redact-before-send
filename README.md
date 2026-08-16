# 🛡️ Privacy Guard Rails

**Zero-data-leak guard for AI chat screen-shots.** Detects and auto-redacts sensitive
information (API keys, Chinese ID numbers, mobile numbers, emails, crypto addresses,
company-confidential keywords) in images **before** they are uploaded to ChatGPT,
Claude.ai, DeepSeek, or Gemini.

100% local. Nothing — not the image, not the OCR output, not the detection result —
ever leaves your device. It works with the network **off**.

> ⚠️ Why this exists: accidentally pasting a screenshot containing an `sk-...` key,
> an ID card, or a bank number into ChatGPT is one of the safest ways to leak secrets —
> many companies have banned chat tools over exactly this. This extension is the
> interceptor that catches it before the click.

---

## ✨ What it does

1. **Intercepts** image entry at the moment you paste / drag / attach it (capture-phase
   listener, before the site's own handler runs).
2. **OCR + rules**: the image is relayed to a `chrome.offscreen` document (see
   "Why an offscreen document" below) where Tesseract.js runs entirely locally and
   checks the text against ~15 patterns — including checksum-validated CN ID and
   Luhn-validated bank cards, so it **doesn't over-flag** every random number.
3. **Highlights** the risky zones on a review dialog.
4. **One-click auto-redact**: mosaics the sensitive pixels via Canvas and uploads the
   *safe* image instead — the sender never leaks.

```
paste / drop / attach image (content script, host page's execution context)
   │  (capture-phase, preventDefault)
   ▼
chrome.runtime.sendMessage ──▶ background service worker ──▶ offscreen document
                                                                   │
                                                            OCR (Tesseract.js Worker)
                                                                   │
   regex + keywords ──▶ zones with pixel boxes  ◀──────────────────┘
   │                                                  │
   │  no risk → pass through                          │  risk → review dialog
   │                                                  ├─ Cancel (block)
   │                                                  ├─ Ignore & upload
   │                                                  └─ Auto-redact ──▶ Canvas mosaic ──▶ re-inject safe image
```

### Why an offscreen document?

The content script runs inside the **host page's** execution context, which means
any `Worker` it constructs is bound by *that page's* Content-Security-Policy. Some AI
platforms declare a `worker-src` that has no `blob:` (Gemini does this), which silently
blocks Worker construction — no error a user would notice, the OCR path just breaks.
`chrome.offscreen` documents run under the **extension's own** CSP instead, so OCR
lives there and is unaffected by whatever CSP any given AI site ships. The relay path
is: content script → background service worker (owns the offscreen doc's lifecycle) →
offscreen document (runs the Tesseract.js Worker) → result flows back the same way.

---

## 📦 What's in the box

| Piece | File | Notes |
|---|---|---|
| Manifest (MV3) | `manifest.json` | **Permissions: `storage`, `offscreen`**. No host permissions, no network calls. |
| Content script | `src/content/content.js` + `intercept.js`, `overlay.js` | Capture listeners, shadow-DOM dialog, zone rendering. Relays images to the offscreen doc for OCR — never spawns a Worker itself. |
| Background service worker | `src/background/background.js` | Owns the offscreen document's lifecycle (`chrome.offscreen.createDocument`), relays OCR requests to it. |
| Offscreen OCR | `src/offscreen/offscreen.js` (+ `offscreen.html`) | Runs Tesseract.js (via its own Worker) under the extension's CSP. Downscales, offline core+lang, returns bboxes in original pixels. |
| Detection rules | `src/shared/sensitive.js` | Regex + CN-ID checksum + Luhn + boundary heuristics + keyword list. |
| Redaction | `src/engine/redact.js` | Pixel-mosaic via Canvas, pure local. |
| Options popup | `src/popup/*` | Strictness, languages, per-site toggles, extra keywords. |

---

## 🚀 Install from source

```bash
npm run setup        # install deps + fetch offline OCR assets + build
```

Then load in Chrome/Edge:

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Toggle **Developer mode**.
3. **Load unpacked** → select this folder (`pri_image/`).
4. Open chatgpt.com / claude.ai / deepseek / gemini and paste a screenshot that contains
   something like `sk-proj-...` — the dialog appears.

> The `setup` downloads ~30 MB of OCR language data **once** (English + Simplified
> Chinese) and caches it locally. After that the extension is fully offline-capable —
> a fresh download is never needed at runtime.

### Demo / trust video idea
Disconnect your Wi-Fi (or toggle Network Off), drag in a screenshot with an API key,
watch it get detected and redacted. Record that — it's your best proof of
zero-data-leak.

---

## 🔒 Privacy & permissions

- **One permission: `storage`** (saved settings). That's the entire trust surface.
- Content scripts are granted only on `chatgpt.com`, `chat.openai.com`, `claude.ai`,
  `chat.deepseek.com`, `gemini.google.com`.
- **No outbound network requests.** OCR core, worker glue, and language data are all
  bundled locally under `assets/tesseract/`. Verify for yourself:
  `assets/tesseract/*` are the only model files, and the code never calls `fetch()` on a
  remote URL.
- OCR runs off the main thread (a Worker) so the page never freezes.

---

## 🧪 Verification

```bash
npm run test:scan   # rule-engine unit tests (paste/drop/change interception is browser-only)
npm run test:ocr    # headless OCR smoke test on a sample image
```

```text
$ npm run test:scan
PASS  OpenAI key
PASS  CN phone split across words
PASS  CN ID with valid checksum
PASS  Email Address
PASS  Keyword: confidential
PASS  Date must NOT match      ← no false positive
PASS  Long random digits must NOT match
7/7 passed

$ npm run test:ocr leak.png
OCR took 186ms
  high OpenAI API Key @ (251,11 649x38)
  high CN Mobile Number @ (145,72 237x30)
```

---

## ⚠️ Known limits (be aware before relying on it)

1. **`event.isTrusted`** — re-injected (synthetic) paste/drop events are not "trusted".
   Most platforms accept them; some ignore them. The **file-attach path**
   (assigning `input.files` + firing `change`) is reliable on all of them, but "paste
   a screenshot" interception depends on each site tolerating an untrusted paste.
   This is the single most important assumption to verify per site.
2. **OCR accuracy** — a noisy/low-res screenshot can misread a digit. When in doubt
   the images aren't *silently* leaked: you always see the review dialog with the
   highlighted zone and can Cancel or Ignore.
3. **No visual object detection yet** — we detect *text* PII, not faces / credit-card
   shapes (that's roadmap M4). A card number in an image *without* readable digits is
   not yet flagged.
4. **`run_at` document_start interception** — set for earliest capture; if a site
   re-renders its composer (SPA), a fesh-but-stable listener remains attached on
   `document`.
5. **First OCR call per browser session is slower** — the background service worker
   spins up the offscreen document and Tesseract.js warms up lazily. Subsequent
   calls reuse the same offscreen document and cached Tesseract worker.

---

## 🗺️ Roadmap

- [x] M1 — interception + OCR + regex detection + review dialog
- [x] M2 — canvas auto-redact + re-injection
- [x] M3 — multi-platform (chatgpt / claude / deepseek / gemini) + offline assets
- [ ] M4 — enterprise policies (central JSON config), visual object recourse,
      per-platform `isTrusted` hardening, demo-GIF + published story

---

*Built with `tesseract.js` and `esbuild`. Not affiliated with OpenAI, Anthropic,
DeepSeek, or Google.*