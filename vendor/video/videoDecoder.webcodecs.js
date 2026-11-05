/**
 * WebCodecs-based video decoder (browser only).
 */

import { extractCodecDescription } from './codecDescription.js';
import { VideoDecoderBase } from './videoDecoder.base.js';

export class WebCodecsDecoder extends VideoDecoderBase {
  #videoInfo = null;
  #videoMp4 = null;
  #sourceBuffer = null;
  #frameIndex = 0;
  #audioData = null;

  async open(source) {
    if (typeof VideoDecoder === 'undefined') {
      throw new Error('WebCodecs API not available. Use Chrome 94+ or a fallback decoder.');
    }

    this.#sourceBuffer = await source.arrayBuffer();
    const { createFile } = await import('mp4box');

    const probeFile = createFile();
    const info = await new Promise((resolve, reject) => {
      probeFile.onReady = resolve;
      probeFile.onError = reject;
      this.#sourceBuffer.fileStart = 0;
      probeFile.appendBuffer(this.#sourceBuffer);
      probeFile.flush();
    });

    const videoTrack = info.videoTracks[0];
    if (!videoTrack) {
      throw new Error('No video track found');
    }

    this.#videoMp4 = createFile();
    await new Promise((resolve, reject) => {
      this.#videoMp4.onReady = resolve;
      this.#videoMp4.onError = reject;
      const buffer = this.#sourceBuffer.slice(0);
      buffer.fileStart = 0;
      this.#videoMp4.appendBuffer(buffer);
      this.#videoMp4.flush();
    });

    this.#videoInfo = {
      width: videoTrack.video.width,
      height: videoTrack.video.height,
      frameCount: videoTrack.nb_samples,
      duration: videoTrack.duration / videoTrack.timescale,
      fps: videoTrack.nb_samples / (videoTrack.duration / videoTrack.timescale),
      codec: videoTrack.codec,
      videoTrackId: videoTrack.id,
      description: extractCodecDescription(this.#videoMp4, videoTrack.id),
    };

    const audioTrack = info.audioTracks?.[0] ?? null;
    if (audioTrack) {
      this.#audioData = await this.#readTrackSamples(createFile, audioTrack);
    }

    return this.#videoInfo;
  }

  /**
   * @param {typeof import('mp4box').createFile} createFile
   * @param {object} track
   */
  async #readTrackSamples(createFile, track) {
    const mp4 = createFile();
    const samples = [];

    await new Promise((resolve, reject) => {
      mp4.onReady = () => {
        mp4.onSamples = (_trackId, _user, trackSamples) => {
          for (const sample of trackSamples) {
            samples.push({
              data: sample.data,
              timestamp: Math.round((sample.cts * 1_000_000) / sample.timescale),
              duration: Math.round((sample.duration * 1_000_000) / sample.timescale),
              type: sample.is_sync ? 'key' : 'delta',
            });
          }
        };
        mp4.setExtractionOptions(track.id);
        mp4.start();
        mp4.flush();
        queueMicrotask(resolve);
      };
      mp4.onError = reject;
      const buffer = this.#sourceBuffer.slice(0);
      buffer.fileStart = 0;
      mp4.appendBuffer(buffer);
      mp4.flush();
    });

    return {
      codec: 'aac',
      sampleRate: track.audio?.sample_rate ?? 48000,
      numberOfChannels: track.audio?.channel_count ?? 2,
      samples,
    };
  }

  async extractAudio() {
    return this.#audioData;
  }

  async *decodeFrames() {
    if (!this.#videoMp4 || !this.#videoInfo) {
      throw new Error('Call open() first');
    }

    const { width, height, videoTrackId, frameCount } = this.#videoInfo;
    const pendingFrames = [];
    let resolveNext = null;
    let done = false;
    let extractionDone = false;
    let flushed = false;
    let samplesSubmitted = 0;

    const decoder = new VideoDecoder({
      output: (frame) => {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(frame, 0, 0);
        const imageData = ctx.getImageData(0, 0, width, height);

        const decoded = {
          imageData,
          timestamp: frame.timestamp,
          frameIndex: this.#frameIndex++,
        };

        frame.close();

        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r(decoded);
        } else {
          pendingFrames.push(decoded);
        }
      },
      error: (e) => {
        console.error('Decoder error:', e);
        done = true;
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r(null);
        }
      },
    });

    decoder.configure({
      codec: this.#videoInfo.codec,
      codedWidth: width,
      codedHeight: height,
      description: this.#videoInfo.description,
    });

    this.#videoMp4.onSamples = (_trackId, _user, trackSamples) => {
      for (const sample of trackSamples) {
        const chunk = new EncodedVideoChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp: (sample.cts * 1_000_000) / sample.timescale,
          duration: (sample.duration * 1_000_000) / sample.timescale,
          data: sample.data,
        });
        decoder.decode(chunk);
        samplesSubmitted++;
      }

      if (samplesSubmitted >= frameCount) {
        extractionDone = true;
        if (resolveNext && pendingFrames.length === 0 && decoder.decodeQueueSize === 0) {
          const r = resolveNext;
          resolveNext = null;
          r(null);
        }
      }
    };

    this.#videoMp4.setExtractionOptions(videoTrackId);
    this.#videoMp4.start();

    while (!done) {
      if (pendingFrames.length > 0) {
        yield pendingFrames.shift();
        continue;
      }

      if (extractionDone && decoder.decodeQueueSize === 0) {
        if (!flushed) {
          await decoder.flush();
          flushed = true;
          if (pendingFrames.length > 0) {
            continue;
          }
        }
        done = true;
        break;
      }

      const frame = await new Promise((resolve) => {
        resolveNext = resolve;
      });
      if (frame) {
        yield frame;
      }
    }

    decoder.close();
  }

  async close() {
    this.#videoMp4 = null;
    this.#videoInfo = null;
    this.#audioData = null;
    this.#sourceBuffer = null;
    this.#frameIndex = 0;
  }
}
