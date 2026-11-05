import {
  getEmbeddedAlphaMap,
  getVeoWatermarkCandidates,
  processVideo,
  type ProcessedVideo,
  type WatermarkInfo,
} from './vendor/index.js';

/**
 * Browser-only helpers around the vendored reverse-alpha-blending engine:
 * check that the browser can encode video, find the Flow watermark in a few
 * sampled frames, then clean every frame locally.
 */

export const MAX_FILE_BYTES = 500 * 1024 * 1024;

// Correlation between the alpha map and the pixels under it, after the
// background's slope is removed. Real Flow exports score 0.45 or more (bright
// snow is the hardest case); spots without the mark stay below about 0.3.
const MIN_WATERMARK_SCORE = 0.35;
const SAMPLE_POINTS = [0.1, 0.3, 0.5, 0.7, 0.9];

export type Detection =
  | {
      status: 'found';
      width: number;
      height: number;
      duration: number;
      score: number;
      info: WatermarkInfo;
    }
  | {
      status: 'not_found' | 'unsupported_resolution';
      width: number;
      height: number;
      duration: number;
      score: number;
    };

export function supportsLocalProcessing() {
  return (
    typeof window !== 'undefined' &&
    'VideoEncoder' in window &&
    'VideoDecoder' in window &&
    typeof OffscreenCanvas !== 'undefined'
  );
}

function loadVideo(url: string) {
  return new Promise<HTMLVideoElement>((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.onloadeddata = () => resolve(video);
    video.onerror = () => reject(new Error('This file could not be opened.'));
    video.src = url;
  });
}

function seek(video: HTMLVideoElement, time: number) {
  return new Promise<void>((resolve) => {
    video.onseeked = () => resolve();
    video.currentTime = time;
  });
}

/**
 * Pearson correlation of alpha against pixel brightness, over all samples.
 * Each sample is the mark's box plus a margin; a plane fitted to the pixels
 * the mark does not touch is subtracted first, so a bright or sloping
 * background does not hide the mark.
 */
function correlation(
  alpha: Float32Array,
  size: number,
  margin: number,
  samples: Uint8ClampedArray[]
) {
  const box = size + 2 * margin;
  const padded = new Float32Array(box * box);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      padded[(y + margin) * box + x + margin] = alpha[y * size + x];
    }
  }
  let meanA = 0;
  for (const a of padded) meanA += a;
  meanA /= padded.length;

  let sumAL = 0;
  let sumAA = 0;
  let sumLL = 0;
  const lum = new Float32Array(box * box);
  for (const pixels of samples) {
    // Least-squares plane l = c0 + c1·x + c2·y over the background pixels.
    const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const r = [0, 0, 0];
    for (let y = 0; y < box; y++) {
      for (let x = 0; x < box; x++) {
        const i = y * box + x;
        const l =
          0.299 * pixels[i * 4] +
          0.587 * pixels[i * 4 + 1] +
          0.114 * pixels[i * 4 + 2];
        lum[i] = l;
        if (padded[i] >= 0.005) continue;
        const v = [1, x, y];
        for (let u = 0; u < 3; u++) {
          r[u] += v[u] * l;
          for (let k = 0; k < 3; k++) m[u * 3 + k] += v[u] * v[k];
        }
      }
    }
    const det =
      m[0] * (m[4] * m[8] - m[5] * m[7]) -
      m[1] * (m[3] * m[8] - m[5] * m[6]) +
      m[2] * (m[3] * m[7] - m[4] * m[6]);
    if (!det) continue;
    const inv = [
      m[4] * m[8] - m[5] * m[7],
      m[2] * m[7] - m[1] * m[8],
      m[1] * m[5] - m[2] * m[4],
      m[5] * m[6] - m[3] * m[8],
      m[0] * m[8] - m[2] * m[6],
      m[2] * m[3] - m[0] * m[5],
      m[3] * m[7] - m[4] * m[6],
      m[1] * m[6] - m[0] * m[7],
      m[0] * m[4] - m[1] * m[3],
    ].map((value) => value / det);
    const c = [0, 1, 2].map(
      (u) => inv[u * 3] * r[0] + inv[u * 3 + 1] * r[1] + inv[u * 3 + 2] * r[2]
    );
    for (let y = 0; y < box; y++) {
      for (let x = 0; x < box; x++) {
        const i = y * box + x;
        const e = lum[i] - (c[0] + c[1] * x + c[2] * y);
        const d = padded[i] - meanA;
        sumAL += d * e;
        sumAA += d * d;
        sumLL += e * e;
      }
    }
  }
  if (sumAA <= 0 || sumLL <= 0) return 0;
  return sumAL / Math.sqrt(sumAA * sumLL);
}

export async function detectWatermark(file: File): Promise<Detection> {
  const url = URL.createObjectURL(file);
  try {
    const video = await loadVideo(url);
    const width = video.videoWidth;
    const height = video.videoHeight;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const candidates = getVeoWatermarkCandidates(width, height, 'diamond');
    const alpha = candidates[0]
      ? getEmbeddedAlphaMap(candidates[0].alphaMapKey)
      : null;
    if (!candidates.length || !alpha) {
      return {
        status: 'unsupported_resolution',
        width,
        height,
        duration,
        score: 0,
      };
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas is not available in this browser.');

    const size = candidates[0].position.width;
    const margin = Math.round(size / 6);
    const samples: Uint8ClampedArray[][] = candidates.map(() => []);
    for (const point of SAMPLE_POINTS) {
      await seek(video, duration * point);
      ctx.drawImage(video, 0, 0, width, height);
      candidates.forEach((candidate, index) => {
        const { x, y } = candidate.position;
        samples[index].push(
          ctx.getImageData(
            x - margin,
            y - margin,
            size + 2 * margin,
            size + 2 * margin
          ).data
        );
      });
    }
    let best = 0;
    let score = -1;
    candidates.forEach((_, index) => {
      const value = correlation(alpha.data, size, margin, samples[index]);
      if (value > score) {
        score = value;
        best = index;
      }
    });
    return score >= MIN_WATERMARK_SCORE
      ? { status: 'found', width, height, duration, score, info: candidates[best] }
      : { status: 'not_found', width, height, duration, score };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Re-encode a little above the source bitrate so quality stays close to the
// original without the file ballooning.
function targetBitrate(file: File, duration: number) {
  if (!duration) return 8_000_000;
  const source = (file.size * 8) / duration;
  return Math.round(Math.min(16_000_000, Math.max(2_000_000, source * 1.3)));
}

export function removeFlowWatermark(
  file: File,
  duration: number,
  info: WatermarkInfo,
  onProgress: (fraction: number) => void
): Promise<ProcessedVideo> {
  return processVideo(file, {
    videoProfile: 'diamond',
    position: info.position,
    bitrate: targetBitrate(file, duration),
    onProgress: (current, total) => onProgress(total ? current / total : 0),
  });
}
