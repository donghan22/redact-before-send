import { loadSettings, saveSettings } from "../shared/config.js";
import { SUPPORTED_HOSTS } from "../shared/constants.js";

const $ = (id) => document.getElementById(id);
let language = "zh-CN";

const COPY = {
  "zh-CN": {
    title: "隐私图片防护",
    subtitle: "图片上传前，本地识别并遮挡敏感信息",
    localNote: "仅在本机处理 · 支持离线使用",
    protectionTitle: "启用上传保护",
    protectionOn: "保护已开启",
    protectionOff: "保护已暂停",
    detectionTitle: "检测设置",
    detectionHint: "平衡识别范围、准确率与处理速度",
    strictnessLabel: "检测强度",
    strictnessHint: "建议使用“平衡”",
    lenient: "宽松",
    balanced: "平衡（推荐）",
    strict: "严格",
    ocrLabel: "识别语言",
    ocrHint: "仅加载所选语言模型",
    english: "English",
    chinese: "简体中文",
    bilingual: "中英双语（推荐）",
    keywordsTitle: "自定义敏感词",
    keywordsHint: "公司名称、项目代号或内部文件标记",
    keywordsPlaceholder: "例如：Project-X, 董事会决议",
    keywordsNote: "多个词请使用逗号分隔，命中后将提示脱敏。",
    sitesTitle: "适用网站",
    sitesHint: "点击状态可以单独开启或关闭",
    siteOn: "已开启",
    siteOff: "已关闭",
    save: "保存设置",
    saving: "正在保存…",
    saved: "已保存，刷新已打开的聊天页面后生效",
    saveFailed: "保存失败，请重试",
    switchLanguage: "Switch to English",
  },
  en: {
    title: "Privacy Image Guard",
    subtitle: "Detect and redact sensitive text before upload",
    localNote: "Local processing · Works offline",
    protectionTitle: "Enable upload protection",
    protectionOn: "Protection is on",
    protectionOff: "Protection is paused",
    detectionTitle: "Detection settings",
    detectionHint: "Balance coverage, accuracy, and processing speed",
    strictnessLabel: "Detection level",
    strictnessHint: '"Balanced" is recommended',
    lenient: "Lenient",
    balanced: "Balanced (Recommended)",
    strict: "Strict",
    ocrLabel: "OCR languages",
    ocrHint: "Only selected language models are loaded",
    english: "English",
    chinese: "Simplified Chinese",
    bilingual: "English + Chinese (Recommended)",
    keywordsTitle: "Custom keywords",
    keywordsHint: "Company names, project codes, or internal labels",
    keywordsPlaceholder: "e.g. Project-X, Board resolution",
    keywordsNote: "Separate terms with commas. Matches will prompt redaction.",
    sitesTitle: "Supported sites",
    sitesHint: "Click a status to enable or disable it",
    siteOn: "On",
    siteOff: "Off",
    save: "Save settings",
    saving: "Saving…",
    saved: "Saved. Refresh open chat pages to apply.",
    saveFailed: "Could not save. Please try again.",
    switchLanguage: "切换为中文",
  },
};

const t = (key) => COPY[language][key];

init();

async function init() {
  const s = await loadSettings();
  language = s.uiLanguage === "en" ? "en" : "zh-CN";

  $("enabled").checked = s.enabled;
  $("strictness").value = String(s.strictness);
  $("ocrLang").value = s.ocrLang;
  $("keywords").value = (s.customKeywords || []).join(", ");
  $("enabled").addEventListener("change", renderProtectionState);

  const sitesBox = $("sites");
  sitesBox.insertAdjacentHTML(
    "beforeend",
    '<div class="section-head"><h2 class="section-title" data-i18n="sitesTitle">适用网站</h2><p class="section-hint" data-i18n="sitesHint">点击状态可以单独开启或关闭</p></div>',
  );
  for (const host of SUPPORTED_HOSTS) {
    const row = document.createElement("div");
    row.className = "site";
    const on = !!s.sites?.[host];
    row.innerHTML = `<span class="site-name">${host}</span><button type="button" class="pill ${on ? "" : "warn"}"></button>`;
    row.querySelector(".pill").addEventListener("click", (event) => {
      const next = row.dataset.on !== "1";
      row.dataset.on = next ? "1" : "0";
      renderSiteState(row);
    });
    row.dataset.host = host;
    row.dataset.on = on ? "1" : "0";
    sitesBox.appendChild(row);
  }

  $("languageToggle").addEventListener("click", async () => {
    language = language === "zh-CN" ? "en" : "zh-CN";
    applyLanguage();
    const latest = await loadSettings();
    latest.uiLanguage = language;
    await saveSettings(latest);
  });

  applyLanguage();

  $("save").addEventListener("click", async () => {
    const save = $("save");
    save.disabled = true;
    save.textContent = t("saving");
    try {
      const s2 = await loadSettings();
      s2.uiLanguage = language;
      s2.enabled = $("enabled").checked;
      s2.strictness = Number($("strictness").value);
      s2.ocrLang = $("ocrLang").value;
      s2.customKeywords = $("keywords").value
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      for (const row of document.querySelectorAll("#sites .site")) {
        s2.sites[row.dataset.host] = row.dataset.on === "1";
      }
      await saveSettings(s2);
      setStatus("saved");
    } catch {
      setStatus("saveFailed");
    } finally {
      save.disabled = false;
      save.textContent = t("save");
    }
  });
}

function applyLanguage() {
  document.documentElement.lang = language;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
  $("languageToggle").textContent = language === "zh-CN" ? "EN" : "中文";
  $("languageToggle").setAttribute("aria-label", t("switchLanguage"));
  $("languageToggle").title = t("switchLanguage");
  $("tf-switch").setAttribute("aria-label", t("protectionTitle"));
  renderProtectionState();
  document.querySelectorAll("#sites .site").forEach(renderSiteState);
  const statusKey = $("status").dataset.statusKey;
  if (statusKey) $("status").textContent = t(statusKey);
}

function renderProtectionState() {
  const enabled = $("enabled").checked;
  $("protectionCard").classList.toggle("is-off", !enabled);
  $("protectionState").textContent = t(enabled ? "protectionOn" : "protectionOff");
}

function renderSiteState(row) {
  const on = row.dataset.on === "1";
  const button = row.querySelector(".pill");
  button.textContent = t(on ? "siteOn" : "siteOff");
  button.className = `pill ${on ? "" : "warn"}`;
  button.setAttribute("aria-pressed", String(on));
}

function setStatus(key) {
  $("status").dataset.statusKey = key;
  $("status").textContent = t(key);
}
