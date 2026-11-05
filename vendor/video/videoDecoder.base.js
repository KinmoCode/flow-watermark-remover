/**
 * Shared video decoder types and base class.
 */

/**
 * @typedef {Object} VideoInfo
 * @property {number} width
 * @property {number} height
 * @property {number} frameCount
 * @property {number} duration
 * @property {number} fps
 * @property {string} codec
 */

/**
 * @typedef {Object} DecodedFrame
 * @property {ImageData} imageData
 * @property {number} timestamp
 * @property {number} frameIndex
 */

export class VideoDecoderBase {
  async open(/* source */) {
    throw new Error('Not implemented');
  }

  async *decodeFrames() {
    throw new Error('Not implemented');
  }

  async extractAudio() {
    return null;
  }

  async close() {}
}
