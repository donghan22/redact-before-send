import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const root = join(here, "..");

export const OCR_ASSETS = [
  {
    name: "tesseract-core-simd-lstm.wasm.js",
    source: "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
    size: 3_938_657,
    sha256: "ce20eda9533cbed1e6c2b4276fbae1e0adc61b6754b5513084be601787b457cf",
  },
  {
    name: "tesseract-core-simd-lstm.wasm",
    source: "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm",
    size: 2_859_709,
    sha256: "66b601224a0c4a8977bc9d92dd39841189f9ca22cc4122fcd7208cdb0961eeef",
  },
  {
    name: "tesseract-worker.js",
    source: "node_modules/tesseract.js/dist/worker.min.js",
    size: 123_724,
    sha256: "aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc",
  },
  {
    name: "eng.traineddata.gz",
    url: "https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz",
    size: 10_923_060,
    sha256: "ed350f3752f81ee8f38769edc14d92d997dababe23b565c59879372cc46a2468",
  },
  {
    name: "chi_sim.traineddata.gz",
    url: "https://tessdata.projectnaptha.com/4.0.0/chi_sim.traineddata.gz",
    size: 20_159_757,
    sha256: "59388039851e4d1293d729c183fd8c1fa9bbbb959eed996e945024671e68c1d6",
  },
];

export function assetPath(asset, projectRoot = root) {
  return join(projectRoot, "assets", "tesseract", asset.name);
}

export function assetIsValid(asset, projectRoot = root) {
  const path = assetPath(asset, projectRoot);
  if (!existsSync(path) || statSync(path).size !== asset.size) return false;
  return createHash("sha256").update(readFileSync(path)).digest("hex") === asset.sha256;
}

export function verifyOcrAssets(projectRoot = root) {
  const invalid = OCR_ASSETS.filter((asset) => !assetIsValid(asset, projectRoot));
  if (invalid.length) {
    throw new Error(
      `Missing or invalid OCR assets: ${invalid.map((asset) => asset.name).join(", ")}. Run npm run fetch-assets.`,
    );
  }
  console.log(`verified ${OCR_ASSETS.length} OCR assets`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  verifyOcrAssets();
}
