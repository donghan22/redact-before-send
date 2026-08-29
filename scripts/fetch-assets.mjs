import { copyFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OCR_ASSETS, assetIsValid, assetPath, verifyOcrAssets } from "./ocr-assets.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "assets", "tesseract"), { recursive: true });

for (const asset of OCR_ASSETS.filter(({ source }) => source)) {
  copyFileSync(join(root, asset.source), assetPath(asset, root));
  console.log("copied", asset.name);
}

for (const asset of OCR_ASSETS.filter(({ url }) => url)) {
  if (assetIsValid(asset, root)) {
    console.log("verified, skip", asset.name);
    continue;
  }

  const output = assetPath(asset, root);
  const temporary = `${output}.download`;
  rmSync(temporary, { force: true });
  console.log("downloading", asset.url);
  try {
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error(`Failed to download ${asset.name}: HTTP ${response.status}`);
    writeFileSync(temporary, Buffer.from(await response.arrayBuffer()));
    renameSync(temporary, output);
  } finally {
    rmSync(temporary, { force: true });
  }
}

verifyOcrAssets(root);
console.log("OCR assets are ready for offline runtime");
