/**
 * Shared video encoder types and base class.
 */

/**
 * @typedef {Object} EncoderConfig
 * @property {number} width
 * @property {number} height
 * @property {number} fps
 * @property {number} [bitrate]
 * @property {string} [codec]
 */

export class VideoEncoderBase {
  async init(/* config */) {
    throw new Error('Not implemented');
  }

  async encodeFrame(/* imageData, timestamp */) {
    throw new Error('Not implemented');
  }

  async setAudioTrack(/* audioData */) {
    throw new Error('Not implemented');
  }

  async finalize() {
    throw new Error('Not implemented');
  }
}
