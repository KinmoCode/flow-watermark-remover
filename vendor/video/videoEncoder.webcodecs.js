/**
 * WebCodecs + mp4-muxer encoder (browser).
 */

import { VideoEncoderBase } from './videoEncoder.base.js';

export class WebCodecsEncoder extends VideoEncoderBase {
  #muxer = null;
  #encoder = null;
  #frameCount = 0;
  #audioSamples = null;
  _target = null;

  async init(config) {
    if (typeof VideoEncoder === 'undefined') {
      throw new Error('WebCodecs API not available');
    }

    const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');

    const target = new ArrayBufferTarget();

    const muxerConfig = {
      target,
      video: {
        codec: 'avc',
        width: config.width,
        height: config.height,
      },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    };

    if (config.audio) {
      muxerConfig.audio = {
        codec: config.audio.codec || 'aac',
        numberOfChannels: config.audio.numberOfChannels || 2,
        sampleRate: config.audio.sampleRate || 48000,
      };
    }

    this.#muxer = new Muxer(muxerConfig);

    this.#encoder = new VideoEncoder({
      output: (chunk, meta) => {
        this.#muxer.addVideoChunk(chunk, meta);
      },
      error: (e) => {
        console.error('Encoder error:', e);
      },
    });

    this.#encoder.configure({
      codec: config.codec || 'avc1.42001f',
      width: config.width,
      height: config.height,
      bitrate: config.bitrate || 5_000_000,
      framerate: config.fps,
      avc: { format: 'avc' },
      colorSpace: {
        primaries: 'bt709',
        transfer: 'bt709',
        matrix: 'bt709',
        fullRange: false,
      },
    });

    this._target = target;
  }

  async encodeFrame(imageData, timestamp) {
    const frame = new VideoFrame(imageData.data.buffer, {
      format: 'RGBA',
      codedWidth: imageData.width,
      codedHeight: imageData.height,
      timestamp,
      colorSpace: {
        primaries: 'bt709',
        transfer: 'bt709',
        matrix: 'bt709',
        fullRange: true,
      },
    });

    const isKey = this.#frameCount % 30 === 0;
    this.#encoder.encode(frame, { keyFrame: isKey });
    frame.close();
    this.#frameCount++;
  }

  /**
   * Queue encoded audio samples for passthrough muxing after video finalize.
   * @param {{ codec?: string, sampleRate: number, numberOfChannels: number, samples: Array<{ data: Uint8Array, timestamp: number, duration: number, type: 'key'|'delta' }> }} audioData
   */
  async setAudioTrack(audioData) {
    this.#audioSamples = audioData;
  }

  async finalize() {
    await this.#encoder.flush();
    this.#encoder.close();

    if (this.#audioSamples?.samples?.length) {
      for (const sample of this.#audioSamples.samples) {
        this.#muxer.addAudioChunkRaw(
          sample.data,
          sample.type,
          sample.timestamp,
          sample.duration,
        );
      }
    }

    this.#muxer.finalize();
    return new Blob([this._target.buffer], { type: 'video/mp4' });
  }
}
