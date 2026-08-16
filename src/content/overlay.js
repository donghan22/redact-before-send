// Review dialog shown after detection. Shadow DOM keeps page CSS out and grows
// its own scoped styles. Resolves with the user's choice:
//   "redact" → apply mosaic then upload
//   "ignore" → force upload original
//   "cancel" → block the upload
//
// Zones are drawn as absolutely-positioned overlays over a scaled image, so the
// highlighted boxes stay pixel-aligned regardless of the preview size.

let activeInstance = null;

export function showReviewOverlay({ objectUrl, dimensions, zones }) {
  if (activeInstance) activeInstance.close(); // only one at a time
  const ov = new Overlay(objectUrl, dimensions, zones);
  activeInstance = ov;
  return ov.promise.then((v) => {
    activeInstance = null;
    return v;
  });
}

class Overlay {
  constructor(objectUrl, { width, height }, zones) {
    this.resolveAction = () => {};
    this.promise = new Promise((res) => (this.resolveAction = res));
    this.host = document.createElement("div");
    const root = this.host.attachShadow({ mode: "open" });
    root.innerHTML = template;
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
      el.title = `${z.label} (${Math.round(z.confidence * 100)}%)`;
      el.textContent = z.label;
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

const template = `
<style>
  .pg-backdrop {
    position: fixed; inset: 0; z-index: 2147483647;
    background: rgba(0,0,0,.55); backdrop-filter: blur(2px);
    display: flex; align-items: center; justify-content: center;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .pg-card {
    background: #fff; color: #111; border-radius: 16px;
    width: min(560px, 92vw); max-height: 88vh; overflow: auto;
    box-shadow: 0 24px 60px rgba(0,0,0,.4);
    padding: 20px 20px 18px;
  }
  .pg-head { display: flex; align-items: center; gap: 10px; }
  .pg-badge {
    background: #fdecea; color: #b3261e; font-weight: 700;
    border-radius: 8px; padding: 4px 8px; font-size: 12px; letter-spacing: .4px;
  }
  .pg-title { font-size: 17px; font-weight: 700; margin: 0; flex: 1; }
  .pg-close {
    border: 0; background: #eee; border-radius: 50%; width: 28px; height: 28px;
    cursor: pointer; font-size: 15px; line-height: 1;
  }
  .pg-sub { color: #555; font-size: 13px; margin: 8px 0 12px; }
  .pg-frame {
    position: relative; border: 1px solid #e2e2e2; border-radius: 12px;
    overflow: hidden; background: #f7f7f7; margin-bottom: 14px;
  }
  .pg-preview { display: block; width: 100%; height: auto; object-fit: contain; }
  .pg-zones { position: absolute; inset: 0; pointer-events: none; }
  .pg-zone {
    position: absolute; box-sizing: border-box;
    border: 2px solid #e5484d; border-radius: 4px;
    background: rgba(229,72,77,.14); color: #b3261e;
    font-size: 10px; line-height: 1; padding: 2px; overflow: hidden;
    display: flex; align-items: flex-start;
    white-space: nowrap; text-overflow: clip;
  }
  .pg-actions { display: flex; gap: 10px; flex-wrap: wrap; }
  .pg-btn {
    flex: 1; min-width: 130px; padding: 11px 12px; border-radius: 10px;
    border: 1px solid transparent; font-size: 14px; font-weight: 600; cursor: pointer;
  }
  .pg-redact { background: #b3261e; color: #fff; }
  .pg-redact:hover { background: #8f1813; }
  .pg-ignore { background: #fff; border-color: #ccc; color: #111; }
  .pg-ignore:hover { background: #f2f2f2; }
  .pg-cancel { background: #fff; border-color: #ccc; color: #666; }
  .pg-cancel:hover { background: #f2f2f2; }
  .pg-note { margin-top: 12px; font-size: 11.5px; color: #888; }
  @media (prefers-color-scheme: dark) {
    .pg-card { background: #1e1e1e; color: #eee; }
    .pg-sub { color: #bbb; }
    .pg-frame { background: #111; border-color: #333; }
    .pg-ignore, .pg-cancel { background: #2a2a2a; border-color: #444; color: #eee; }
    .pg-ignore:hover, .pg-cancel:hover { background: #3a3a3a; }
    .pg-close { background: #333; color: #eee; }
  }
</style>
<div class="pg-backdrop">
  <div class="pg-card">
    <div class="pg-head">
      <span class="pg-badge">SENSITIVE DETECTED</span>
      <h2 class="pg-title">Hold on — confidential info found</h2>
      <button class="pg-close" aria-label="Close">✕</button>
    </div>
    <p class="pg-sub">Detected sensitive areas are highlighted below. We process everything locally — nothing leaves this device.</p>
    <div class="pg-frame">
      <img class="pg-preview" alt="image to review" />
      <div class="pg-zones"></div>
    </div>
    <div class="pg-actions">
      <button class="pg-btn pg-redact">Auto-Redact &amp; Upload</button>
      <button class="pg-btn pg-ignore">Ignore &amp; Upload</button>
      <button class="pg-btn pg-cancel">Cancel</button>
    </div>
    <p class="pg-note">Runs 100% locally. No OCR output, image, or detection data is ever sent anywhere — even offline this works.</p>
  </div>
</div>
`;
