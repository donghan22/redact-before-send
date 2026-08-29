import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { OCR_ASSETS, assetPath, verifyOcrAssets } from "./ocr-assets.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (manifest.version !== packageJson.version) {
  throw new Error(`Version mismatch: manifest ${manifest.version}, package ${packageJson.version}`);
}

verifyOcrAssets(root);
const distFiles = ["background.js", "content.js", "offscreen.html", "offscreen.js", "page-intercept.js", "popup.html", "popup.js"];
for (const file of distFiles) {
  if (!existsSync(join(root, "dist", file))) throw new Error(`Missing dist/${file}. Run npm run build.`);
}

const releaseDir = join(root, "release");
const zipPath = join(releaseDir, `privacy-guard-rails-v${manifest.version}.zip`);
const staging = mkdtempSync(join(tmpdir(), "privacy-guard-rails-"));
mkdirSync(join(staging, "assets", "tesseract"), { recursive: true });
mkdirSync(join(staging, "dist"));
cpSync(join(root, "manifest.json"), join(staging, "manifest.json"));
for (const file of distFiles) cpSync(join(root, "dist", file), join(staging, "dist", file));
for (const asset of OCR_ASSETS) cpSync(assetPath(asset, root), join(staging, "assets", "tesseract", asset.name));
for (const icon of ["icon16.png", "icon48.png", "icon128.png"]) {
  cpSync(join(root, "assets", icon), join(staging, "assets", icon));
}

mkdirSync(releaseDir, { recursive: true });
rmSync(zipPath, { force: true });
try {
  const result = spawnSync("zip", ["-Xqr", zipPath, "."], { cwd: staging, stdio: "inherit" });
  if (result.error) throw new Error(`zip is required to package the extension: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`zip exited with status ${result.status}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}

console.log(`created ${basename(zipPath)} (${(statSync(zipPath).size / 1_000_000).toFixed(1)} MB)`);
