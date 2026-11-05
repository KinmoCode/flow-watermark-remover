/**
 * Embedded alpha maps for video watermark removal.
 * Calibrated from GeminiWatermarkTool + VeoWatermarkRemover upstream captures.
 */

import { loadCalibratedAlphaMap } from './calibratedAlphaData.js'

const alphaMapRegistry = new Map()

const VIDEO_ALPHA_KEYS = []

// flowwatermarkremover: Flow exports carry the diamond at 72px (1080p) and
// 48px (720p); both maps are scaled from the calibrated 96px Gemini map.
const SCALED_ALPHA_KEYS = {
  'veo-diamond-1080p-landscape': { from: 'gemini-v2-96', size: 72 },
  'veo-diamond-1080p-portrait': { from: 'gemini-v2-96', size: 72 },
  'veo-diamond-720p-landscape': { from: 'gemini-v2-96', size: 48 },
  'veo-diamond-720p-portrait': { from: 'gemini-v2-96', size: 48 },
}

for (const key of VIDEO_ALPHA_KEYS) {
  const loaded = loadCalibratedAlphaMap(key)
  if (loaded) {
    alphaMapRegistry.set(key, loaded)
  }
}

/**
 * Bilinear resize helper (used when registering custom maps).
 */
export function resizeAlphaMap(source, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
    return new Float32Array(source)
  }

  const result = new Float32Array(targetWidth * targetHeight)
  const xScale = sourceWidth / targetWidth
  const yScale = sourceHeight / targetHeight

  for (let y = 0; y < targetHeight; y++) {
    const sourceY = (y + 0.5) * yScale - 0.5
    const sourceY0 = Math.floor(sourceY)
    const y0 = Math.max(0, sourceY0)
    const y1 = Math.min(sourceHeight - 1, y0 + 1)
    const yWeight = Math.max(0, Math.min(1, sourceY - sourceY0))

    for (let x = 0; x < targetWidth; x++) {
      const sourceX = (x + 0.5) * xScale - 0.5
      const sourceX0 = Math.floor(sourceX)
      const x0 = Math.max(0, sourceX0)
      const x1 = Math.min(sourceWidth - 1, x0 + 1)
      const xWeight = Math.max(0, Math.min(1, sourceX - sourceX0))

      const top =
        source[y0 * sourceWidth + x0] * (1 - xWeight) +
        source[y0 * sourceWidth + x1] * xWeight
      const bottom =
        source[y1 * sourceWidth + x0] * (1 - xWeight) +
        source[y1 * sourceWidth + x1] * xWeight

      result[y * targetWidth + x] = top * (1 - yWeight) + bottom * yWeight
    }
  }

  return result
}

// Fitted on real Flow exports: the scaled map is ~4% too strong inside.
const FLOW_ALPHA_GAIN = 0.96
// Pixels where the map changes faster than this per pixel form the 1–2px
// contour that reverse blending cannot restore exactly; they get smoothed.
const EDGE_GRADIENT = 0.15

/** Contour mask: steep parts of the normalized map, grown by one pixel. */
export function buildEdgeMask(data, width, height) {
  let max = 0
  for (const v of data) max = Math.max(max, v)
  const at = (x, y) => data[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))] / (max || 1)
  const steep = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = (at(x + 1, y) - at(x - 1, y)) / 2
      const gy = (at(x, y + 1) - at(x, y - 1)) / 2
      const v = at(x, y)
      // steep contour, or the faint fringe (incl. the four tips)
      if (Math.hypot(gx, gy) > EDGE_GRADIENT || (v > 0.03 && v < 0.3)) steep[y * width + x] = 1
    }
  }
  const mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      mask[i] = steep[i] ||
        (x > 0 && steep[i - 1]) || (x < width - 1 && steep[i + 1]) ||
        (y > 0 && steep[i - width]) || (y < height - 1 && steep[i + width]) ? 1 : 0
    }
  }
  return mask
}

for (const [key, { from, size }] of Object.entries(SCALED_ALPHA_KEYS)) {
  const source = alphaMapRegistry.get(from) || loadCalibratedAlphaMap(from)
  if (source) {
    const data = resizeAlphaMap(source.data, source.width, source.height, size, size)
    for (let i = 0; i < data.length; i++) data[i] *= FLOW_ALPHA_GAIN
    alphaMapRegistry.set(key, {
      data,
      width: size,
      height: size,
      edge: buildEdgeMask(data, size, size),
      source: `scaled:${from}`,
    })
  }
}

/**
 * @param {string} key
 * @returns {{ data: Float32Array, width: number, height: number, source?: string } | null}
 */
export function getEmbeddedAlphaMap(key) {
  return alphaMapRegistry.get(key) || loadCalibratedAlphaMap(key)
}

export function registerAlphaMap(key, data, width, height, source = 'custom') {
  alphaMapRegistry.set(key, { data, width, height, source })
}

export function listAlphaMapKeys() {
  return Array.from(alphaMapRegistry.keys())
}
