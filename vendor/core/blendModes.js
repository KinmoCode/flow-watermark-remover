/**
 * Core reverse alpha blending algorithm.
 * Formula: original = (watermarked - α × 255) / (1 - α)
 */

const ALPHA_NOISE_FLOOR = 3 / 255;
const ALPHA_THRESHOLD = 0.002;
const MAX_ALPHA = 0.99;

/**
 * Remove watermark from an ImageData region using a pre-calibrated alpha map.
 *
 * @param {ImageData} imageData - The watermarked image data
 * @param {Float32Array} alphaMap - Alpha map (width × height float values 0-1)
 * @param {{ x: number, y: number, width: number, height: number }} position - Watermark region
 * @param {{ clampOutput?: boolean }} options
 * @returns {ImageData} Modified imageData (mutated in place and returned)
 */
export function removeWatermark(imageData, alphaMap, position, options = {}) {
  const { clampOutput = true } = options;
  const { data, width } = imageData;
  const { x: ox, y: oy, width: mw, height: mh } = position;

  for (let my = 0; my < mh; my++) {
    for (let mx = 0; mx < mw; mx++) {
      const alpha = alphaMap[my * mw + mx];

      // Skip pixels below noise floor
      if (alpha < ALPHA_THRESHOLD) continue;

      const effectiveAlpha = Math.min(alpha, MAX_ALPHA);
      const px = ox + mx;
      const py = oy + my;

      if (px < 0 || px >= width || py < 0 || py >= imageData.height) continue;

      const idx = (py * width + px) * 4;

      for (let c = 0; c < 3; c++) {
        const watermarked = data[idx + c];
        // Reverse alpha blend: original = (watermarked - alpha * 255) / (1 - alpha)
        let original = (watermarked - effectiveAlpha * 255) / (1 - effectiveAlpha);

        if (clampOutput) {
          original = Math.max(0, Math.min(255, Math.round(original)));
        }
        data[idx + c] = original;
      }
      // Alpha channel unchanged
    }
  }

  return imageData;
}

/**
 * flowwatermarkremover: fill the thin contour of the mark by diffusing the
 * surrounding (already restored) pixels into it. Only pixels in `edgeMask`
 * change, so detail elsewhere in the corner is untouched.
 *
 * @param {ImageData} imageData
 * @param {Uint8Array} edgeMask - width × height of the mark, 1 = contour
 * @param {{ x: number, y: number, width: number, height: number }} position
 * @param {number} [iterations]
 */
export function smoothEdge(imageData, edgeMask, position, iterations = 40) {
  const { data, width: fw, height: fh } = imageData;
  const { x: ox, y: oy, width: mw, height: mh } = position;
  // Work on the mark plus a 1px frame of fixed neighbours.
  const bw = mw + 2;
  const bh = mh + 2;
  const buf = new Float32Array(bw * bh * 3);
  const fixed = new Uint8Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const px = Math.min(fw - 1, Math.max(0, ox + bx - 1));
      const py = Math.min(fh - 1, Math.max(0, oy + by - 1));
      const src = (py * fw + px) * 4;
      const b = (by * bw + bx) * 3;
      buf[b] = data[src];
      buf[b + 1] = data[src + 1];
      buf[b + 2] = data[src + 2];
      const mx = bx - 1;
      const my = by - 1;
      const inMark = mx >= 0 && my >= 0 && mx < mw && my < mh;
      fixed[by * bw + bx] = inMark && edgeMask[my * mw + mx] ? 0 : 1;
    }
  }
  for (let it = 0; it < iterations; it++) {
    for (let by = 1; by < bh - 1; by++) {
      for (let bx = 1; bx < bw - 1; bx++) {
        const i = by * bw + bx;
        if (fixed[i]) continue;
        for (let c = 0; c < 3; c++) {
          buf[i * 3 + c] =
            (buf[(i - 1) * 3 + c] + buf[(i + 1) * 3 + c] +
              buf[(i - bw) * 3 + c] + buf[(i + bw) * 3 + c]) / 4;
        }
      }
    }
  }
  for (let my = 0; my < mh; my++) {
    for (let mx = 0; mx < mw; mx++) {
      if (!edgeMask[my * mw + mx]) continue;
      const px = ox + mx;
      const py = oy + my;
      if (px < 0 || px >= fw || py < 0 || py >= fh) continue;
      const dst = (py * fw + px) * 4;
      const b = ((my + 1) * bw + (mx + 1)) * 3;
      data[dst] = Math.round(buf[b]);
      data[dst + 1] = Math.round(buf[b + 1]);
      data[dst + 2] = Math.round(buf[b + 2]);
    }
  }
  return imageData;
}

/**
 * Apply a synthetic watermark to imageData (for testing/demo).
 */
export function applySyntheticWatermark(imageData, alphaMap, position) {
  const { data, width } = imageData;
  const { x: ox, y: oy, width: mw, height: mh } = position;

  for (let my = 0; my < mh; my++) {
    for (let mx = 0; mx < mw; mx++) {
      const alpha = alphaMap[my * mw + mx];
      if (alpha < ALPHA_NOISE_FLOOR) continue;

      const px = ox + mx;
      const py = oy + my;
      if (px < 0 || px >= width || py < 0 || py >= imageData.height) continue;

      const idx = (py * width + px) * 4;

      for (let c = 0; c < 3; c++) {
        // Forward alpha blend: result = original * (1 - alpha) + watermarkColor * alpha
        // Watermark color is white (255)
        data[idx + c] = Math.round(data[idx + c] * (1 - alpha) + 255 * alpha);
      }
    }
  }

  return imageData;
}

/**
 * Compute spatial correlation of a region to validate it contains a watermark.
 */
export function computeRegionSpatialCorrelation(imageData, position) {
  const { data, width } = imageData;
  const { x: ox, y: oy, width: mw, height: mh } = position;

  let sumDiff = 0;
  let count = 0;

  for (let my = 1; my < mh - 1; my++) {
    for (let mx = 1; mx < mw - 1; mx++) {
      const px = ox + mx;
      const py = oy + my;
      const idx = (py * width + px) * 4;
      const idxRight = (py * width + px + 1) * 4;
      const idxBelow = ((py + 1) * width + px) * 4;

      for (let c = 0; c < 3; c++) {
        sumDiff += Math.abs(data[idx + c] - data[idxRight + c]);
        sumDiff += Math.abs(data[idx + c] - data[idxBelow + c]);
      }
      count += 6;
    }
  }

  return count > 0 ? sumDiff / count : 0;
}
