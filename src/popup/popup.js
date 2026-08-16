import { loadSettings, saveSettings } from "../shared/config.js";
import { SUPPORTED_HOSTS } from "../shared/constants.js";

const $ = (id) => document.getElementById(id);

init();

async function init() {
  const s = await loadSettings();

  $("enabled").checked = s.enabled;
  $("strictness").value = String(s.strictness);
  $("ocrLang").value = s.ocrLang;
  $("autoRedact").checked = s.autoRedact;
  $("keywords").value = (s.customKeywords || []).join(", ");

  const sitesBox = $("sites");
  sitesBox.insertAdjacentHTML("beforeend", "<div style='font-weight:600;margin-bottom:4px'>Sites</div>");
  for (const host of SUPPORTED_HOSTS) {
    const row = document.createElement("div");
    row.className = "site";
    const on = !!s.sites?.[host];
    row.innerHTML = `<span>${host}</span><span class="pill ${on ? "" : "warn"}">${on ? "ON" : "OFF"}</span>`;
    row.querySelector(".pill").style.cursor = "pointer";
    row.addEventListener("click", () => {
      const h = row.querySelector(".pill");
      const next = !h.textContent.includes("ON");
      h.textContent = next ? "ON" : "OFF";
      h.className = `pill ${next ? "" : "warn"}`;
      row.dataset.on = next ? "1" : "0";
    });
    row.dataset.host = host;
    row.dataset.on = on ? "1" : "0";
    sitesBox.appendChild(row);
  }

  $("save").addEventListener("click", async () => {
    const s2 = await loadSettings();
    s2.enabled = $("enabled").checked;
    s2.strictness = Number($("strictness").value);
    s2.ocrLang = $("ocrLang").value;
    s2.autoRedact = $("autoRedact").checked;
    s2.customKeywords = $("keywords").value
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    for (const row of document.querySelectorAll("#sites .site")) {
      s2.sites[row.dataset.host] = row.dataset.on === "1";
    }
    await saveSettings(s2);
    $("status").textContent = "Saved. Settings apply to new pages.";
  });
}
