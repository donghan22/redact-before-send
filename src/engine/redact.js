// Canvas mosaic redaction — pure local, milliseconds. Runs in the content
// script world (has a canvas element). Given the original Blob + redact zones
// (in original-image pixels), returns a new redacted Blob safely readied for
// re-injection. Untainted: blobs from Object URLs never taint the canvas.

/**
 * @param {Blob} blob original image
 * @param {{x:number,y:number,w:number,h:number}[]} zones in original px
 * @param {{mosaic:boolean, blockColor?:string, quality?:number}} opts
 * @returns {Promise<Blob>}
 */
export async function redactImage(blob, zones, opts = {}) {
  const { mosaic = true, blockColor = "#000000", cell = 8 } = opts;
  const img = await createImageBitmap(blob);
  const cv = document.createElement("canvas");
  cv.width = img.width;
  cv.height = img.height;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  img.close();

  for (const z of zones) {
    if (mosaic) {
      drawMosaic(ctx, cv, z, cell);
    } else {
      ctx.fillStyle = blockColor;
      ctx.fillRect(z.x, z.y, z.w, z.h);
    }
  }

  return new Promise((resolve, reject) =>
    cv.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png"
    )
  );
}

// Classic pixel-mosaic: shrink the region as much as possible then scale it
// back up with smoothing disabled.
function drawMosaic(ctx, canvas, z, cellPx) {
  const zx = Math.max(0, Math.floor(z.x));
  const zy = Math.max(0, Math.floor(z.y));
  const zw = Math.max(1, Math.min(Math.floor(z.w), canvas.width - zx));
  const zh = Math.max(1, Math.min(Math.floor(z.h), canvas.height - zy));
  const src = ctx.getImageData(zx, zy, zw, zh);
  const cols = Math.max(1, Math.floor(zw / cellPx));
  const rows = Math.max(1, Math.floor(zh / cellPx));
  const tiny = new OffscreenCanvas(cols, rows);
  const tctx = tiny.getContext("2d");
  tctx.putImageData(src, 0, 0);
  const small = tctx.getImageData(0, 0, cols, rows).data;
  // Average each cell → build pixelated output.
  const out = ctx.createImageData(zw, zh);
  for (let py = 0; py < zh; py++) {
    const cy = Math.min(rows - 1, Math.floor((py / zh) * rows));
    for (let px = 0; px < zw; px++) {
      const cx = Math.min(cols - 1, Math.floor((px / zw) * cols));
      const s = (cy * cols + cx) * 4;
      const d = (py * zw + px) * 4;
      out.data[d] = small[s];
      out.data[d + 1] = small[s + 1];
      out.data[d + 2] = small[s + 2];
      out.data[d + 3] = small[s + 3];
    }
  }
  ctx.putImageData(out, zx, zy);
}
