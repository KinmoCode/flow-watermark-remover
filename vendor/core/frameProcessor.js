/**
 * Per-frame watermark processing orchestrator.
 * Combines veoConfig + alphaMap + blendModes to process a single frame.
 */

import { removeWatermark, smoothEdge } from './blendModes.js';
import { getVeoWatermarkInfo, normalizeVideoWatermarkProfile } from './veoConfig.js';
import { getEmbeddedAlphaMap } from './embeddedAlphaMaps.js';

/**
 * Process a single video frame to remove the configured video watermark.
 *
 * @param {ImageData} frameData - Frame pixel data
 * @param {{ width?: number, height?: number, videoProfile?: 'diamond'|'legacy' }} options
 * @returns {{ imageData: ImageData, processed: boolean, reason?: string, profile?: string|null, position?: object|null }}
 */
export function processFrame(frameData, options = {}) {
  const width = options.width || frameData.width;
  const height = options.height || frameData.height;
  const profile = normalizeVideoWatermarkProfile(options.videoProfile ?? options.profile);

  if (!profile) {
    return { imageData: frameData, processed: false, reason: 'unsupported_profile', profile: null };
  }

  const info = getVeoWatermarkInfo(width, height, profile);
  if (!info) {
    return { imageData: frameData, processed: false, reason: 'unsupported_resolution', profile };
  }

  const alphaMap = getEmbeddedAlphaMap(info.alphaMapKey);
  if (!alphaMap) {
    return { imageData: frameData, processed: false, reason: 'missing_alpha_map', profile };
  }

  removeWatermark(frameData, alphaMap.data, info.position);
  if (alphaMap.edge) smoothEdge(frameData, alphaMap.edge, info.position);
  return { imageData: frameData, processed: true, profile, position: info.position };
}

/**
 * Create a reusable frame processor for a specific video (caches config lookup).
 *
 * @param {number} frameWidth
 * @param {number} frameHeight
 * @param {{ videoProfile?: 'diamond'|'legacy', position?: { x: number, y: number } }} options
 * @returns {{ profile: string|null, position: object|null, process(frameData: ImageData): { imageData: ImageData, processed: boolean, reason?: string, profile?: string|null, position?: object|null } }}
 */
export function createFrameProcessor(frameWidth, frameHeight, options = {}) {
  const profile = normalizeVideoWatermarkProfile(options.videoProfile ?? options.profile);

  if (!profile) {
    return {
      profile: null,
      position: null,
      process(frameData) {
        return { imageData: frameData, processed: false, reason: 'unsupported_profile', profile: null };
      },
    };
  }

  const info = getVeoWatermarkInfo(frameWidth, frameHeight, profile);
  if (!info) {
    return {
      profile,
      position: null,
      process(frameData) {
        return { imageData: frameData, processed: false, reason: 'unsupported_resolution', profile };
      },
    };
  }

  const alphaMap = getEmbeddedAlphaMap(info.alphaMapKey);
  if (!alphaMap) {
    return {
      profile,
      position: info.position,
      process(frameData) {
        return { imageData: frameData, processed: false, reason: 'missing_alpha_map', profile };
      },
    };
  }

  // flowwatermarkremover: use the position detection found, when given.
  const position = options.position
    ? { ...info.position, x: options.position.x, y: options.position.y }
    : info.position;
  const mapData = alphaMap.data;
  const edgeMask = alphaMap.edge;

  return {
    profile,
    position,
    process(frameData) {
      removeWatermark(frameData, mapData, position);
      if (edgeMask) smoothEdge(frameData, edgeMask, position);
      return { imageData: frameData, processed: true, profile, position };
    },
  };
}
