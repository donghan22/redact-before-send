// Review dialog shown after detection. Shadow DOM keeps page CSS out and grows
// its own scoped styles. Resolves with the user's choice:
//   "redact" → apply mosaic then upload
//   "ignore" → force upload original
//   "cancel" → block the upload
//
// Zones are drawn as absolutely-positioned overlays over a scaled image, so the
// highlighted boxes stay pixel-aligned regardless of the preview size.

let activeInstance = null;

export function showReviewOverlay({ objectUrl, dimensions, zones, language }) {
  if (activeInstance) activeInstance.close(); // only one at a time
  const ov = new Overlay(objectUrl, dimensions, zones, language);
  activeInstance = ov;
  return ov.promise.then((v) => {
    activeInstance = null;
    return v;
  });
}

export function showRedactionPreview({ objectUrl, dimensions, language }) {
  if (activeInstance) activeInstance.close();
  const ov = new EditOverlay(objectUrl, dimensions, language);
  activeInstance = ov;
  return ov.promise.then((value) => {
    activeInstance = null;
    return value;
  });
}

class Overlay {
  constructor(objectUrl, { width, height }, zones, language) {
    this.resolveAction = () => {};
    this.promise = new Promise((res) => (this.resolveAction = res));
    this.host = document.createElement("div");
    const root = this.host.attachShadow({ mode: "open" });
    root.innerHTML = template;
    const copy = localize(root, language, "review", zones.length);
    document.documentElement.appendChild(this.host);

    // --- populate static bits ---
    const img = root.querySelector("img.pg-preview");
    img.src = objectUrl || "";
    img.style.aspectRatio = `${width} / ${height}`;

    this.zoneLayer = root.querySelector(".pg-zones");
    this.imgW = width;
    this.imgH = height;
    for (const z of zones) {
      const el = document.createElement("div");
      el.className = "pg-zone";
      const label = localizeZone(z.label, copy);
      el.title = `${label} (${Math.round(z.confidence * 100)}%)`;
      el.textContent = label;
      this.positionZone(el, z);
      this.zoneLayer.appendChild(el);
    }

    root.querySelector(".pg-redact").addEventListener("click", () => this.finish("redact"));
    root.querySelector(".pg-ignore").addEventListener("click", () => this.finish("ignore"));
    root.querySelector(".pg-cancel").addEventListener("click", () => this.finish("cancel"));
    root.querySelector(".pg-close").addEventListener("click", () => this.finish("cancel"));
  }

  positionZone(el, z) {
    el.style.left = `${(z.x / this.imgW) * 100}%`;
    el.style.top = `${(z.y / this.imgH) * 100}%`;
    el.style.width = `${(z.w / this.imgW) * 100}%`;
    el.style.height = `${(z.h / this.imgH) * 100}%`;
  }

  finish(action) {
    this.close();
    this.resolveAction(action);
  }

  close() {
    this.host?.remove();
  }
}

class EditOverlay {
  constructor(objectUrl, { width, height }, language) {
    this.resolveAction = () => {};
    this.promise = new Promise((resolve) => (this.resolveAction = resolve));
    this.zones = [];
    this.host = document.createElement("div");
    const root = this.host.attachShadow({ mode: "open" });
    root.innerHTML = template;
    localize(root, language, "edit", 0);
    document.documentElement.appendChild(this.host);
    root.querySelector(".pg-redact").hidden = true;
    root.querySelector(".pg-ignore").hidden = true;
    root.querySelector(".pg-upload").hidden = false;
    root.querySelector(".pg-undo").hidden = false;

    const img = root.querySelector("img.pg-preview");
    img.src = objectUrl;
    img.style.aspectRatio = `${width} / ${height}`;
    this.frame = root.querySelector(".pg-frame");
    this.frame.classList.add("pg-editing");
    this.zoneLayer = root.querySelector(".pg-zones");
    this.imgW = width;
    this.imgH = height;
    this.installDrawing();

    root.querySelector(".pg-upload").addEventListener("click", () => this.finish("upload"));
    root.querySelector(".pg-undo").addEventListener("click", () => this.undo());
    root.querySelector(".pg-cancel").addEventListener("click", () => this.finish("cancel"));
    root.querySelector(".pg-close").addEventListener("click", () => this.finish("cancel"));
  }

  installDrawing() {
    let start = null;
    let box = null;
    const point = (event) => {
      const rect = this.frame.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
        y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
        rect,
      };
    };
    const draw = (from, to) => {
      const x = Math.min(from.x, to.x);
      const y = Math.min(from.y, to.y);
      box.style.left = `${(x / to.rect.width) * 100}%`;
      box.style.top = `${(y / to.rect.height) * 100}%`;
      box.style.width = `${(Math.abs(to.x - from.x) / to.rect.width) * 100}%`;
      box.style.height = `${(Math.abs(to.y - from.y) / to.rect.height) * 100}%`;
    };

    this.frame.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.frame.setPointerCapture(event.pointerId);
      start = point(event);
      box = document.createElement("div");
      box.className = "pg-zone pg-manual";
      this.zoneLayer.appendChild(box);
      draw(start, start);
    });
    this.frame.addEventListener("pointermove", (event) => {
      if (!start) return;
      draw(start, point(event));
    });
    this.frame.addEventListener("pointerup", (event) => {
      if (!start) return;
      const end = point(event);
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const w = Math.abs(end.x - start.x);
      const h = Math.abs(end.y - start.y);
      if (w >= 4 && h >= 4) {
        this.zones.push({
          x: (x / end.rect.width) * this.imgW,
          y: (y / end.rect.height) * this.imgH,
          w: (w / end.rect.width) * this.imgW,
          h: (h / end.rect.height) * this.imgH,
          element: box,
        });
      } else {
        box.remove();
      }
      start = null;
      box = null;
    });
  }

  undo() {
    this.zones.pop()?.element.remove();
  }

  finish(action) {
    const zones = this.zones.map(({ element, ...zone }) => zone);
    this.close();
    this.resolveAction({ action, zones });
  }

  close() {
    this.host?.remove();
  }
}

const OVERLAY_COPY = {
  "zh-CN": {
    eyebrow: "上传前安全检查",
    sensitiveBadge: "发现风险",
    reviewTitle: "检测到可能泄露隐私的内容",
    reviewSub: "已标出 {count} 个可能敏感的区域。建议先检查并脱敏，再决定是否上传。",
    reviewPreviewLabel: "原图预览",
    reviewPreviewMeta: "{count} 处待确认",
    reviewWarning: "上传原图会保留已检测到的敏感内容。",
    redact: "自动脱敏并预览",
    ignore: "忽略并上传原图",
    previewBadge: "脱敏预览",
    previewTitle: "确认脱敏后的图片",
    previewSub: "自动检测区域已完成遮挡。如有遗漏，可直接在图片上拖动添加遮挡区域。",
    editPreviewLabel: "脱敏结果",
    editPreviewMeta: "拖动可补充遮挡",
    editWarning: "上传前请确认所有敏感内容均已正确遮挡。",
    upload: "上传此版本",
    undo: "撤销上一区域",
    cancel: "取消",
    close: "关闭",
    imageAlt: "待确认的图片",
    note: "本地处理：图片、OCR 文字和检测结果不会发送到外部服务。",
    keywordLabel: "关键词",
    zoneLabels: {
      "OpenAI API Key": "OpenAI API 密钥",
      "Anthropic API Key": "Anthropic API 密钥",
      "AWS Access Key": "AWS 访问密钥",
      "Google API Key": "Google API 密钥",
      "GitHub Token": "GitHub Token",
      "JWT Token": "JWT Token",
      "PEM / SSH Private Key": "PEM / SSH 私钥",
      "OAuth / Access Token": "OAuth / 访问令牌",
      "Session Cookie": "会话 Cookie",
      "Database Connection String": "数据库连接串",
      "Chinese ID Number": "中国身份证号码",
      "CN Mobile Number": "中国手机号码",
      "Email Address": "电子邮箱",
      "Passport Number": "护照号码",
      "US Social Security Number": "美国社会安全号码",
      IBAN: "IBAN 国际银行账号",
      "Chinese Unified Social Credit Code": "统一社会信用代码",
      "Tax Identification Number": "税务识别号",
      "Bank Account Number": "银行账号",
      "Ethereum Address": "Ethereum 地址",
      "Bitcoin Address": "Bitcoin 地址",
      "Bank Card Number": "银行卡号",
      "Named Secret / Password": "命名密钥 / 密码",
    },
  },
  en: {
    eyebrow: "PRE-UPLOAD SAFETY CHECK",
    sensitiveBadge: "RISK DETECTED",
    reviewTitle: "This image may expose private information",
    reviewSub: "We highlighted {count} potentially sensitive area(s). Review and redact them before uploading.",
    reviewPreviewLabel: "Original image preview",
    reviewPreviewMeta: "{count} to review",
    reviewWarning: "Uploading the original will keep all detected sensitive content visible.",
    redact: "Auto-Redact & Review",
    ignore: "Ignore & Upload Original",
    previewBadge: "REDACTION PREVIEW",
    previewTitle: "Review the redacted image",
    previewSub: "Detected areas are now redacted. Drag over the image to cover anything else we may have missed.",
    editPreviewLabel: "Redacted result",
    editPreviewMeta: "Drag to redact more",
    editWarning: "Confirm that all sensitive content is fully covered before uploading.",
    upload: "Upload This Version",
    undo: "Undo Last Area",
    cancel: "Cancel",
    close: "Close",
    imageAlt: "image to review",
    note: "Local processing: the image, OCR text, and detection results are never sent to an external service.",
    keywordLabel: "Keyword",
    zoneLabels: {},
  },
};

function localize(root, language, mode, count) {
  const locale = language === "en" ? "en" : "zh-CN";
  const copy = OVERLAY_COPY[locale];
  const card = root.querySelector(".pg-card");
  card.lang = locale;
  card.classList.toggle("pg-edit-mode", mode === "edit");
  root.querySelector(".pg-eyebrow").textContent = copy.eyebrow;
  root.querySelector(".pg-badge").textContent = mode === "edit" ? copy.previewBadge : copy.sensitiveBadge;
  root.querySelector(".pg-title").textContent = mode === "edit" ? copy.previewTitle : copy.reviewTitle;
  root.querySelector(".pg-sub").textContent = formatCopy(mode === "edit" ? copy.previewSub : copy.reviewSub, count);
  root.querySelector(".pg-preview-label").textContent = mode === "edit" ? copy.editPreviewLabel : copy.reviewPreviewLabel;
  root.querySelector(".pg-preview-meta").textContent = formatCopy(
    mode === "edit" ? copy.editPreviewMeta : copy.reviewPreviewMeta,
    count,
  );
  root.querySelector(".pg-warning").textContent = mode === "edit" ? copy.editWarning : copy.reviewWarning;
  root.querySelector(".pg-redact").textContent = copy.redact;
  root.querySelector(".pg-ignore").textContent = copy.ignore;
  root.querySelector(".pg-upload").textContent = copy.upload;
  root.querySelector(".pg-undo").textContent = copy.undo;
  root.querySelector(".pg-cancel").textContent = copy.cancel;
  root.querySelector(".pg-close").setAttribute("aria-label", copy.close);
  root.querySelector(".pg-preview").alt = copy.imageAlt;
  root.querySelector(".pg-note-text").textContent = copy.note;
  return copy;
}

function formatCopy(value, count) {
  return value.replaceAll("{count}", String(count));
}

function localizeZone(label, copy) {
  if (label.startsWith("Keyword: ")) return `${copy.keywordLabel}: ${label.slice(9)}`;
  return copy.zoneLabels[label] || label;
}

const template = `
<style>
  * { box-sizing: border-box; }
  .pg-backdrop {
    position: fixed; inset: 0; z-index: 2147483647;
    padding: 20px;
    background: rgba(10,18,32,.68); backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .pg-card {
    --pg-surface: #fff;
    --pg-subtle: #f6f8fb;
    --pg-line: #e4e8ef;
    --pg-text: #172033;
    --pg-muted: #687386;
    --pg-risk: #c7372f;
    --pg-risk-dark: #a62923;
    --pg-risk-soft: #fff0ee;
    --pg-safe: #147d45;
    --pg-safe-soft: #eaf8f0;
    width: min(620px, 94vw); max-height: 90vh; overflow: auto;
    border: 1px solid rgba(255,255,255,.16); border-radius: 20px;
    background: var(--pg-surface); color: var(--pg-text);
    box-shadow: 0 28px 80px rgba(0,0,0,.42);
  }
  .pg-head {
    position: relative; display: flex; align-items: center; gap: 13px;
    padding: 20px 22px 17px; border-bottom: 1px solid var(--pg-line);
    background: linear-gradient(135deg, var(--pg-risk-soft), var(--pg-surface) 62%);
  }
  .pg-edit-mode .pg-head {
    background: linear-gradient(135deg, var(--pg-safe-soft), var(--pg-surface) 62%);
  }
  .pg-status-icon {
    display: grid; place-items: center; flex: 0 0 auto; width: 42px; height: 42px;
    border-radius: 12px; background: var(--pg-risk); color: #fff;
    box-shadow: 0 7px 18px rgba(199,55,47,.24);
  }
  .pg-status-icon svg { width: 23px; height: 23px; }
  .pg-edit-mode .pg-status-icon {
    background: var(--pg-safe); box-shadow: 0 7px 18px rgba(20,125,69,.22);
  }
  .pg-heading { min-width: 0; flex: 1; }
  .pg-topline { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .pg-badge {
    padding: 3px 7px; border: 1px solid rgba(199,55,47,.2); border-radius: 999px;
    background: var(--pg-risk-soft); color: var(--pg-risk);
    font-size: 10px; font-weight: 800; letter-spacing: .35px;
  }
  .pg-edit-mode .pg-badge {
    border-color: rgba(20,125,69,.2); background: var(--pg-safe-soft); color: var(--pg-safe);
  }
  .pg-eyebrow { color: var(--pg-muted); font-size: 10px; font-weight: 650; letter-spacing: .25px; }
  .pg-title { margin: 0; font-size: 18px; font-weight: 750; line-height: 1.25; }
  .pg-close {
    display: grid; place-items: center; flex: 0 0 auto; width: 30px; height: 30px;
    padding: 0; border: 1px solid var(--pg-line); border-radius: 50%;
    background: var(--pg-surface); color: var(--pg-muted);
    cursor: pointer; font-size: 14px; line-height: 1;
  }
  .pg-close:hover { background: var(--pg-subtle); color: var(--pg-text); }
  .pg-content { padding: 17px 22px 20px; }
  .pg-sub { margin: 0 0 14px; color: var(--pg-muted); font-size: 13px; line-height: 1.55; }
  .pg-preview-shell {
    overflow: hidden; border: 1px solid var(--pg-line); border-radius: 13px;
    background: var(--pg-subtle);
  }
  .pg-preview-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    min-height: 38px; padding: 8px 11px; border-bottom: 1px solid var(--pg-line);
  }
  .pg-preview-label { font-size: 11.5px; font-weight: 700; }
  .pg-preview-meta {
    padding: 3px 7px; border-radius: 999px; background: var(--pg-risk-soft);
    color: var(--pg-risk); font-size: 10px; font-weight: 700;
  }
  .pg-edit-mode .pg-preview-meta { background: var(--pg-safe-soft); color: var(--pg-safe); }
  .pg-frame {
    position: relative; overflow: hidden; background:
      linear-gradient(45deg, #eef1f5 25%, transparent 25%),
      linear-gradient(-45deg, #eef1f5 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #eef1f5 75%),
      linear-gradient(-45deg, transparent 75%, #eef1f5 75%);
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
    background-size: 16px 16px;
  }
  .pg-editing { cursor: crosshair; touch-action: none; user-select: none; }
  .pg-preview { display: block; width: 100%; height: auto; object-fit: contain; }
  .pg-zones { position: absolute; inset: 0; pointer-events: none; }
  .pg-zone {
    position: absolute; box-sizing: border-box;
    border: 2px solid #ef4444; border-radius: 5px;
    background: rgba(239,68,68,.18); color: #fff;
    box-shadow: 0 0 0 1px rgba(255,255,255,.7), 0 2px 8px rgba(0,0,0,.2);
    font-size: 10px; font-weight: 700; line-height: 1; padding: 3px; overflow: hidden;
    text-shadow: 0 1px 2px rgba(0,0,0,.8);
    display: flex; align-items: flex-start;
    white-space: nowrap; text-overflow: clip;
  }
  .pg-manual {
    border-style: dashed; border-color: #fff; background: rgba(17,24,39,.72);
  }
  .pg-warning {
    position: relative; margin: 12px 0 13px; padding-left: 22px;
    color: #8b5b13; font-size: 11.5px; line-height: 1.45;
  }
  .pg-warning::before {
    content: "!"; position: absolute; left: 0; top: 0;
    display: grid; place-items: center; width: 16px; height: 16px;
    border-radius: 50%; background: #f5a623; color: #fff;
    font-size: 10px; font-weight: 900;
  }
  .pg-edit-mode .pg-warning { color: var(--pg-safe); }
  .pg-edit-mode .pg-warning::before { content: "✓"; background: var(--pg-safe); }
  .pg-actions { display: grid; grid-template-columns: 1.35fr 1fr auto; gap: 9px; }
  .pg-btn {
    min-height: 42px; padding: 10px 13px; border-radius: 10px;
    border: 1px solid transparent; font-size: 13px; font-weight: 700; cursor: pointer;
  }
  .pg-redact { background: var(--pg-risk); color: #fff; box-shadow: 0 5px 14px rgba(199,55,47,.2); }
  .pg-redact:hover { background: var(--pg-risk-dark); }
  .pg-upload { background: var(--pg-safe); color: #fff; box-shadow: 0 5px 14px rgba(20,125,69,.2); }
  .pg-upload:hover { background: #0f6537; }
  .pg-ignore, .pg-undo { background: var(--pg-surface); border-color: var(--pg-line); color: var(--pg-text); }
  .pg-ignore:hover, .pg-undo:hover { background: var(--pg-subtle); }
  .pg-cancel { min-width: 76px; background: transparent; border-color: transparent; color: var(--pg-muted); }
  .pg-cancel:hover { background: var(--pg-subtle); color: var(--pg-text); }
  .pg-note {
    display: flex; align-items: flex-start; gap: 7px; margin: 13px 0 0;
    padding: 9px 10px; border-radius: 9px; background: #eef5ff;
    color: #3f5f89; font-size: 10.5px; line-height: 1.45;
  }
  .pg-note svg { flex: 0 0 auto; width: 14px; height: 14px; margin-top: 1px; }
  @media (max-width: 520px) {
    .pg-backdrop { padding: 10px; }
    .pg-head { padding: 17px 16px 14px; }
    .pg-content { padding: 14px 16px 16px; }
    .pg-actions { grid-template-columns: 1fr; }
    .pg-cancel { min-height: 34px; }
  }
  @media (prefers-color-scheme: dark) {
    .pg-card {
      --pg-surface: #1b2433; --pg-subtle: #222e40; --pg-line: #344055;
      --pg-text: #f3f6fb; --pg-muted: #a8b2c2; --pg-risk: #ef6a62;
      --pg-risk-dark: #dc5148; --pg-risk-soft: #422827;
      --pg-safe: #52c982; --pg-safe-soft: #1d3c2d;
    }
    .pg-frame {
      background-color: #131b28;
      background-image:
        linear-gradient(45deg, #1d2736 25%, transparent 25%),
        linear-gradient(-45deg, #1d2736 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #1d2736 75%),
        linear-gradient(-45deg, transparent 75%, #1d2736 75%);
    }
    .pg-warning { color: #e9b966; }
    .pg-note { background: #1d3049; color: #abc8ee; }
  }
</style>
<div class="pg-backdrop">
  <div class="pg-card">
    <div class="pg-head">
      <div class="pg-status-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 3 5 6v5c0 4.5 2.8 7.8 7 10 4.2-2.2 7-5.5 7-10V6l-7-3Z"/>
          <path d="M12 8v5"/><path d="M12 16h.01"/>
        </svg>
      </div>
      <div class="pg-heading">
        <div class="pg-topline">
          <span class="pg-badge">RISK DETECTED</span>
          <span class="pg-eyebrow">PRE-UPLOAD SAFETY CHECK</span>
        </div>
        <h2 class="pg-title">This image may expose private information</h2>
      </div>
      <button class="pg-close" aria-label="Close">✕</button>
    </div>
    <div class="pg-content">
      <p class="pg-sub">Detected sensitive areas are highlighted below.</p>
      <div class="pg-preview-shell">
        <div class="pg-preview-bar">
          <span class="pg-preview-label">Original image preview</span>
          <span class="pg-preview-meta">1 to review</span>
        </div>
        <div class="pg-frame">
          <img class="pg-preview" alt="image to review" />
          <div class="pg-zones"></div>
        </div>
      </div>
      <p class="pg-warning">Uploading the original will keep detected content visible.</p>
      <div class="pg-actions">
        <button class="pg-btn pg-redact">Auto-Redact &amp; Review</button>
        <button class="pg-btn pg-ignore">Ignore &amp; Upload Original</button>
        <button class="pg-btn pg-upload" hidden>Upload This Version</button>
        <button class="pg-btn pg-undo" hidden>Undo Last Area</button>
        <button class="pg-btn pg-cancel">Cancel</button>
      </div>
      <p class="pg-note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>
        </svg>
        <span class="pg-note-text">Local processing: no image or OCR data leaves this device.</span>
      </p>
    </div>
  </div>
</div>
`;
