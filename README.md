<p align="center">
  <img src="./assets/icon128.png" width="88" alt="Privacy Guard Rails logo" />
</p>

<h1 align="center">Privacy Guard Rails</h1>

<p align="center">
  Detect and redact sensitive text locally before an image enters an AI chat.<br />
  Local OCR · No cloud detection API · Offline after installation
</p>

<p align="center">
  <img alt="Chrome MV3" src="https://img.shields.io/badge/Chrome-MV3-2563eb?style=flat-square" />
  <img alt="Local OCR" src="https://img.shields.io/badge/OCR-Tesseract.js-15803d?style=flat-square" />
  <img alt="Languages" src="https://img.shields.io/badge/UI-中文%20%7C%20English-7c3aed?style=flat-square" />
</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> · <strong>English</strong>
</p>

Privacy Guard Rails is a Manifest V3 extension for ChatGPT, Claude, DeepSeek,
and Gemini. It intercepts pasted, dropped, or attached images, runs Tesseract
OCR locally, and checks the extracted text with formats, context, and checksums.

When a risk is found, the user can cancel, upload the original, or review an
automatically mosaicked copy and add more redactions manually.

> [!IMPORTANT]
> This is a pre-upload safety aid, not an enterprise DLP system. OCR and rules
> can miss information; read [Limitations](#limitations) before sensitive use.

## Features

- Local English and Simplified Chinese OCR; no image is sent to a detection API.
- Paste, drop, and attachment-button interception on four AI chat platforms.
- Bilingual popup, risk review, and redaction preview.
- Automatic mosaic plus manual draw and undo before upload.
- Rules for credentials, private keys, identity data, contact details, financial
  data, crypto addresses, and custom keywords.

Context-dependent values such as passport, tax, and bank-account numbers are
reported only when a nearby Chinese or English field label is present. Payment
cards, Chinese IDs, IBANs, and Chinese business credit codes use checksums.

## Detection Examples

These are real outputs from the current local OCR and rule engine at the default
detection level. Sources and licenses are listed in
[ATTRIBUTION.md](./docs/examples/ATTRIBUTION.md).

<table>
  <thead>
    <tr><th>Source image</th><th>Redaction result</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><img src="./docs/examples/china-id-original.jpg" width="420" alt="Chinese ID specimen before detection" /></td>
      <td><img src="./docs/examples/china-id-redacted.jpg" width="420" alt="Chinese ID number after mosaic redaction" /></td>
    </tr>
    <tr>
      <td><img src="./docs/examples/email-original.png" width="420" alt="Public business email before detection" /></td>
      <td><img src="./docs/examples/email-redacted.png" width="420" alt="Email address after mosaic redaction" /></td>
    </tr>
    <tr>
      <td><img src="./docs/examples/smtp-original.png" width="420" alt="SMTP documentation screenshot before detection" /></td>
      <td><img src="./docs/examples/smtp-redacted.png" width="420" alt="Example email addresses after mosaic redaction" /></td>
    </tr>
    <tr>
      <td><img src="./docs/examples/visa-original.png" width="420" alt="Visa test card before detection" /></td>
      <td><img src="./docs/examples/visa-redacted.png" width="420" alt="Visa test card number after mosaic redaction" /></td>
    </tr>
  </tbody>
</table>

Reproducible results: one checksum-valid Chinese ID, one email address, six
SMTP example addresses, and one Luhn-valid Visa test-card number.

## How It Works

~~~mermaid
flowchart LR
    A["Paste / Drop / Attach"] --> B["Intercept image"]
    B --> C["Local OCR"]
    C --> D["Rules + checksums"]
    D --> E{"Risk?"}
    E -- No --> F["Continue upload"]
    E -- Yes --> G["Review"]
    G --> H["Mosaic + manual edits"]
    H --> F
~~~

OCR runs in an extension offscreen document with bundled Tesseract WASM and
`eng` / `chi_sim` models. Images are scaled to a maximum side of 1440 px for
OCR, and detected coordinates are mapped back to the original image.

## Supported Websites

| Website | Domain | Paste | Drop | Attachment |
|---|---|:---:|:---:|:---:|
| ChatGPT | `chatgpt.com` | ✓ | ✓ | ✓ |
| Claude | `claude.ai` | ✓ | ✓ | ✓ |
| DeepSeek | `chat.deepseek.com` | ✓ | ✓ | ✓ |
| Gemini | `gemini.google.com` | ✓ | ✓ | ✓ |

Website upload implementations change. Re-test after major browser or site updates.

## Install

### Release package

1. Download and extract the latest ZIP from
   [GitHub Releases](https://github.com/donghan22/redact-before-send/releases).
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**, select **Load unpacked**, and choose the extracted
   folder containing `manifest.json`.

The release ZIP includes compiled code and all OCR runtime files.

### Build from source

~~~bash
git clone https://github.com/donghan22/redact-before-send.git
cd redact-before-send
npm run setup
~~~

Load the repository root as an unpacked extension. After source changes, run
`npm run build`, reload the extension, and refresh open chat tabs.

`npm run setup` installs dependencies, downloads about 36 MB of pinned OCR
assets, verifies their size and SHA-256 digest, and builds the extension.

## Verify and Package

~~~bash
npm test
npm run verify:assets
npm run test:ocr -- /path/to/image.jpg
npm run build
npm run package:extension
~~~

The ready-to-install archive is written to `release/`. CI runs the same asset,
test, build, and packaging checks.

## Project Structure

~~~text
assets/                 icons and generated Tesseract runtime assets
docs/                   README images and attribution
src/background/         offscreen lifecycle and OCR relay
src/content/            upload interception and in-page review UI
src/engine/             OCR client and canvas mosaic
src/offscreen/          Tesseract worker environment
src/popup/              bilingual extension settings
src/shared/             configuration, rules, and checksums
scripts/                asset, test, and release utilities
manifest.json           Chrome MV3 manifest
esbuild.mjs             extension bundler
~~~

## Release

Keep the version in `manifest.json`, `package.json`, and `package-lock.json`
identical, then push a matching tag:

~~~bash
git tag -a v0.1.4 -m "Privacy Guard Rails v0.1.4"
git push origin v0.1.4
~~~

The release workflow publishes `privacy-guard-rails-v<version>.zip`.

## Limitations

- OCR may miss blurred, rotated, reflective, low-contrast, or very small text.
- OCR failures currently fail open and allow the original image through.
- Only the first image in a multi-image selection is fully processed.
- Faces, signatures, fingerprints, portraits, license plates, QR codes, and
  barcodes are not detected reliably.
- Values split across lines and unsupported regional formats may be missed.
- Ignoring a warning uploads the original file with its original metadata.
- Website frontend changes can break interception or reinjection.

## License

[MIT](LICENSE)

Built with `tesseract.js` and `esbuild`.
