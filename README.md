<p align="center">
  <img src="./assets/icon128.png" width="88" alt="Privacy Guard Rails logo" />
</p>

<h1 align="center">Privacy Guard Rails</h1>

<p align="center">
  Detect, review, and redact sensitive information locally before an image enters an AI chat.<br />
  Local OCR · No cloud detection API · Works offline
</p>

<p align="center">
  <img alt="Chrome MV3" src="https://img.shields.io/badge/Chrome-MV3-2563eb?style=flat-square" />
  <img alt="Local OCR" src="https://img.shields.io/badge/OCR-Tesseract.js-15803d?style=flat-square" />
  <img alt="Languages" src="https://img.shields.io/badge/UI-中文%20%7C%20English-7c3aed?style=flat-square" />
  <img alt="Tests" src="https://img.shields.io/badge/rule_tests-20%2F20-brightgreen?style=flat-square" />
</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> · <strong>English</strong>
</p>

---

Privacy Guard Rails is a Manifest V3 browser extension that intercepts images before
they are submitted to ChatGPT, Claude, DeepSeek, or Gemini. It extracts text with a
local Tesseract OCR worker, then uses checksums, regular expressions, and contextual
rules to locate potentially sensitive regions.

When a risk is found, the user can:

- cancel the upload;
- ignore the warning and upload the original;
- automatically mosaic detected regions and review the result;
- drag over any additional region in the preview before uploading the safe version.

> [!IMPORTANT]
> This extension is a pre-upload safety aid, not a complete enterprise DLP system.
> Read [Limitations](#limitations) before using it in a sensitive workflow. It must
> not be treated as a guarantee that every secret will be detected.

## Detection Preview

<p align="center">
  <img src="./docs/detection-examples.svg" width="900" alt="Synthetic API key, identity number, and IBAN detection and redaction examples" />
</p>

The illustration uses synthetic values only. It contains no real identity number,
bank account, or secret.

## Core Flow

~~~mermaid
flowchart LR
    A["Paste / Drop / Attach image"] --> B["Pre-upload interception"]
    B --> C["Local OCR<br/>English + Simplified Chinese"]
    C --> D["Rules, context, and checksums"]
    D --> E{"Risk found?"}
    E -- No --> F["Continue the original upload flow"]
    E -- Yes --> G["Bilingual review UI<br/>Highlight detected regions"]
    G --> H["Cancel"]
    G --> I["Ignore and upload original"]
    G --> J["Auto-redact and review"]
    J --> K["Add manual redactions"]
    K --> L["Upload safe version"]
~~~

## What It Detects

The current engine contains **22 structured rules**, dedicated PEM/SSH private-key
block handling, built-in keywords, and user-defined sensitive terms.

| Category | Current coverage | False-positive controls |
|---|---|---|
| API and cloud credentials | OpenAI, Anthropic, AWS, Google, GitHub, JWT | Vendor prefixes and length constraints |
| Authentication credentials | OAuth, access/refresh tokens, bearer tokens, session cookies | Field context and token formats |
| Private keys and databases | PEM, RSA, EC, DSA, OpenSSH private keys; database URLs | Redacts the complete key block from <code>BEGIN</code> through <code>END</code> |
| Identity and contact data | Chinese IDs, passports, US SSNs, Chinese phone numbers, email addresses | ID checksum, invalid SSN filtering, and field context |
| Business identifiers | Chinese unified social credit codes and tax identifiers | MOD 31-3 checksum or field context |
| Financial data | Payment cards, bank accounts, IBANs, BTC and ETH addresses | Luhn, IBAN MOD-97, and field context |
| Document keywords | Confidential, internal use, financial reports, and similar terms | Built-in and user-defined keyword lists |

Passport numbers, generic tax identifiers, and bank-account numbers do not have one
global format. They are detected only when OCR also finds a nearby label such as
<code>Passport No</code>, <code>Tax ID</code>, <code>Bank Account</code>,
<code>护照号码</code>, <code>税号</code>, or <code>银行账号</code>.

## Supported Websites

| Website | Domain | Paste | Drop | Attachment button |
|---|---|:---:|:---:|:---:|
| ChatGPT | <code>chatgpt.com</code> | ✓ | ✓ | ✓, including MAIN-world and File System paths |
| Claude | <code>claude.ai</code> | ✓ | ✓ | ✓ |
| DeepSeek | <code>chat.deepseek.com</code> | ✓ | ✓ | ✓ |
| Gemini | <code>gemini.google.com</code> | ✓ | ✓ | ✓ |

Web applications change continuously. Re-run end-to-end browser checks after a
browser or website update.

## Local Privacy Architecture

~~~mermaid
flowchart TB
    subgraph PAGE["AI chat page"]
      M["MAIN world<br/>Attachment-picker interception"]
      I["Isolated content script<br/>Orchestration + Shadow DOM UI"]
    end

    M <-->|"In-page bridge"| I
    I <-->|"chrome.runtime Port"| B["MV3 background service worker"]
    B <-->|"OCR request / result"| O["Offscreen document"]
    O --> W["Tesseract Worker<br/>WASM SIMD LSTM"]
    W --> O
    I --> R["Canvas mosaic<br/>Generate safe image"]
~~~

- OCR engine: <code>tesseract.js 5.1.1</code>.
- Bundled models: <code>assets/tesseract/eng.traineddata.gz</code> and
  <code>assets/tesseract/chi_sim.traineddata.gz</code>.
- Images are downscaled to a maximum side of <code>1440px</code> for OCR; detected
  coordinates are mapped back to original-image pixels.
- Runtime detection does not call a cloud OCR or external detection API.
- Extension permissions are <code>storage</code> and <code>offscreen</code>; content
  script access is limited to the supported AI-chat domains above.
- The extension actively reinjects an original or redacted image only after the user
  chooses to continue.

<code>npm run setup</code> downloads about 30 MB of English and Simplified Chinese
OCR model data during setup. Once stored in the repository, runtime OCR works
offline.

## Installation

~~~bash
git clone <your-repository-url>
cd pri_image
npm run setup
~~~

Then:

1. Open <code>chrome://extensions</code>; use <code>edge://extensions</code> in Edge.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the repository root.
5. Open a supported website and test paste, drop, and attachment upload with a
   synthetic image.

After editing the source:

~~~bash
npm run build
~~~

Select **Reload** on the extension management page. Reload open chat tabs as well so
the new content scripts are injected.

## Settings and Interaction

- The extension popup supports Chinese and English, and persists the UI language in
  local browser storage.
- Protection can be paused globally or enabled per website.
- OCR can load English, Simplified Chinese, or both.
- Users can configure detection level and organization-specific keywords.
- In-page risk review and redaction preview follow the popup language.
- After auto-redaction, users can draw additional regions, undo, and approve the
  final upload.

## Verification

~~~bash
npm run test:scan       # 20 positive and negative rule cases
npm run test:popup      # popup Chinese/English dictionary completeness
npm run test:overlay    # review UI translations and zone-label completeness
npm run test:ocr -- /path/to/test-image.jpg
npm run build
~~~

Current rule checks include:

~~~text
PASS  PEM private key block
PASS  OAuth access token
PASS  Session cookie
PASS  Database connection string
PASS  US SSN / invalid SSN
PASS  IBAN / invalid IBAN checksum
PASS  Chinese unified social credit code / invalid checksum
PASS  Date must NOT match
PASS  Long random digits must NOT match
...
20/20 passed
~~~

## Project Structure

~~~text
pri_image/
├── assets/tesseract/          # WASM, worker, eng / chi_sim OCR models
├── docs/                      # README visual assets
├── src/
│   ├── background/            # Offscreen lifecycle and OCR relay
│   ├── content/               # Interception, bilingual review UI, redaction preview
│   ├── engine/                # OCR client and Canvas mosaic
│   ├── offscreen/             # Tesseract Worker execution environment
│   ├── popup/                 # Bilingual extension settings
│   └── shared/                # Configuration, detection rules, checksums
├── scripts/                   # Model setup and runnable checks
├── manifest.json
└── esbuild.mjs
~~~

## Limitations

1. **OCR can miss or misread text.** Blur, rotation, glare, low contrast, complex
   backgrounds, and very small text reduce accuracy. Text that OCR misses never
   reaches the rule engine.
2. **The current error policy is fail-open.** If OCR initialization or execution
   fails, the original image is allowed through. This is not suitable as a mandatory
   compliance gateway.
3. **Only the first image in one selection is fully processed.** Multi-image uploads
   still need dedicated handling.
4. **The engine understands text, not visual objects.** Faces, signatures,
   fingerprints, license plates, document portraits, QR codes, and barcodes are not
   reliably detected.
5. **There is no cross-line semantic model.** Values split into words on one line can
   be reconstructed, but addresses, keys, or account numbers split across lines may
   be missed. PEM/SSH private-key blocks are a dedicated exception.
6. **Contextual rules have regional limits.** SSN currently means a US number.
   Passport, tax-ID, and bank-account rules depend on Chinese or English field
   labels and do not cover every country.
7. **Website upload implementations can change.** Updates involving
   <code>event.isTrusted</code>, Shadow DOM, the File System API, or other frontend
   behavior may affect reinjection and require real-browser regression testing.
8. **EXIF cleanup is not explicit yet.** Generated PNG redactions generally omit the
   source EXIF data, but choosing “ignore and upload original” preserves original
   metadata.

## Roadmap

- [x] Paste, drop, and attachment-button interception
- [x] Local English and Simplified Chinese OCR with sensitive-region coordinates
- [x] Automatic mosaic, result preview, and manual redaction
- [x] Chinese/English popup and in-page review interfaces
- [x] API credentials, private keys, identity, tax, and financial rules
- [ ] Multi-image processing
- [ ] Optional fail-closed policy
- [ ] Explicit EXIF metadata removal
- [ ] QR-code and barcode parsing
- [ ] Face, signature, and license-plate detection
- [ ] Demo GIF recorded from a real end-to-end browser flow

---

Built with <code>tesseract.js</code> and <code>esbuild</code>. Not affiliated with OpenAI,
Anthropic, DeepSeek, or Google.
