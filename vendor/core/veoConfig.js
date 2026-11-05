/**
 * Veo/Gemini video watermark position/size detection for known resolutions.
 */

/** @typedef {'diamond'|'legacy'} VideoWatermarkProfile */

/**
 * Legacy pre-Gemini-3.5 videos carry the "Veo" text watermark.
 * The short keys are kept for backwards compatibility with existing alpha maps.
 */
// flowwatermarkremover: legacy Veo text maps are not shipped (see
// calibratedAlphaData.js), so no legacy resolutions are listed.
const LEGACY_VEO_TEXT_CATALOG = {};

/**
 * Gemini 3.5+ videos carry the Gemini diamond logo. Upstream v0.5.0-demo
 * currently validates only 1080p landscape and portrait.
 */
// flowwatermarkremover: measured on real Flow exports (Nov 2026). The
// diamond is short-side / 15 px wide. Exports from November 2026 place it
// 2x its size from the right and bottom edges; earlier exports used 1.5x.
// The first gap is the default; detection picks whichever one matches.
const FLOW_DIAMOND_GAPS = [2, 1.5];

function diamondEntry(key, width, height, size) {
  const gap = FLOW_DIAMOND_GAPS[0] * size;
  return {
    key,
    profile: 'diamond',
    watermark: { width: size, height: size },
    position: { x: width - size - gap, y: height - size - gap },
  };
}

const GEMINI_DIAMOND_VIDEO_CATALOG = {
  '1920x1080': diamondEntry('veo-diamond-1080p-landscape', 1920, 1080, 72),
  '1080x1920': diamondEntry('veo-diamond-1080p-portrait', 1080, 1920, 72),
  '1280x720': diamondEntry('veo-diamond-720p-landscape', 1280, 720, 48),
  '720x1280': diamondEntry('veo-diamond-720p-portrait', 720, 1280, 48),
};

const VIDEO_WATERMARK_PROFILES = {
  diamond: GEMINI_DIAMOND_VIDEO_CATALOG,
  legacy: LEGACY_VEO_TEXT_CATALOG,
};

/**
 * Normalize profile aliases used by CLI and SDK options.
 * @param {string|{ videoProfile?: string, profile?: string }|undefined} profile
 * @returns {VideoWatermarkProfile|null}
 */
export function normalizeVideoWatermarkProfile(profile) {
  const value = typeof profile === 'object' && profile
    ? profile.videoProfile ?? profile.profile
    : profile;

  if (!value || value === 'diamond' || value === 'current' || value === 'v2' || value === 'gemini') {
    return 'diamond';
  }
  if (value === 'legacy' || value === 'veo' || value === 'text' || value === 'v1') {
    return 'legacy';
  }
  return null;
}

/**
 * Detect watermark config for a given video resolution and profile.
 * @param {number} width
 * @param {number} height
 * @param {string|{ videoProfile?: string, profile?: string }} [profile='diamond']
 * @returns {object|null} Config or null if resolution unknown
 */
export function detectVeoWatermarkConfig(width, height, profile = 'diamond') {
  const normalizedProfile = normalizeVideoWatermarkProfile(profile);
  if (!normalizedProfile) return null;

  const key = `${width}x${height}`;
  return VIDEO_WATERMARK_PROFILES[normalizedProfile][key] || null;
}

/**
 * Calculate watermark bounding box for a given resolution.
 * @param {number} width
 * @param {number} height
 * @param {string|{ videoProfile?: string, profile?: string }} [profile='diamond']
 * @returns {{ x: number, y: number, width: number, height: number }|null}
 */
export function calculateWatermarkPosition(width, height, profile = 'diamond') {
  const config = detectVeoWatermarkConfig(width, height, profile);
  if (!config) return null;

  return {
    x: config.position.x,
    y: config.position.y,
    width: config.watermark.width,
    height: config.watermark.height,
  };
}

/**
 * Get full watermark info including alpha map key.
 * @param {number} width
 * @param {number} height
 * @param {string|{ videoProfile?: string, profile?: string }} [profile='diamond']
 */
export function getVeoWatermarkInfo(width, height, profile = 'diamond') {
  const normalizedProfile = normalizeVideoWatermarkProfile(profile);
  if (!normalizedProfile) return null;

  const config = detectVeoWatermarkConfig(width, height, normalizedProfile);
  if (!config) return null;

  return {
    profile: normalizedProfile,
    alphaMapKey: config.key,
    position: {
      x: config.position.x,
      y: config.position.y,
      width: config.watermark.width,
      height: config.watermark.height,
    },
  };
}

/**
 * flowwatermarkremover: every position the diamond is known to use at this
 * size, default first.
 */
export function getVeoWatermarkCandidates(width, height, profile = 'diamond') {
  const info = getVeoWatermarkInfo(width, height, profile);
  if (!info || info.profile !== 'diamond') return info ? [info] : [];
  const size = info.position.width;
  return FLOW_DIAMOND_GAPS.map((gap) => ({
    ...info,
    position: {
      ...info.position,
      x: width - size - Math.round(gap * size),
      y: height - size - Math.round(gap * size),
    },
  }));
}

const VEO_WATERMARK_CATALOG = LEGACY_VEO_TEXT_CATALOG;

export {
  GEMINI_DIAMOND_VIDEO_CATALOG,
  LEGACY_VEO_TEXT_CATALOG,
  VIDEO_WATERMARK_PROFILES,
  VEO_WATERMARK_CATALOG,
};
