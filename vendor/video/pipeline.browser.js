/**
 * Browser-only video pipeline (WebCodecs — no ffmpeg.wasm).
 */

import { WebCodecsDecoder } from './videoDecoder.webcodecs.js';
import { WebCodecsEncoder } from './videoEncoder.webcodecs.js';
import { createFrameProcessor } from '../core/frameProcessor.js';

/**
 * @typedef {Object} ProcessOptions
 * @property {(current: number, total: number) => void} [onProgress]
 * @property {number} [bitrate]
 * @property {'diamond'|'legacy'} [videoProfile]
 * @property {{ x: number, y: number }} [position] - flowwatermarkremover: detected mark position
 */

/**
 * Process a video file to remove Veo watermarks in the browser.
 *
 * @param {File|Blob} input
 * @param {ProcessOptions} options
 * @returns {Promise<Blob>}
 */
export async function processVideo(input, options = {}) {
  const { bitrate, onProgress, videoProfile = 'diamond', position } = options;

  const decoder = new WebCodecsDecoder();
  const videoInfo = await decoder.open(input);

  const processor = createFrameProcessor(videoInfo.width, videoInfo.height, { videoProfile, position });

  const audioData = await decoder.extractAudio();

  const encoder = new WebCodecsEncoder();
  await encoder.init({
    width: videoInfo.width,
    height: videoInfo.height,
    fps: videoInfo.fps,
    bitrate: bitrate || 5_000_000,
    codec: videoInfo.codec,
    audio: audioData
      ? {
          codec: audioData.codec,
          sampleRate: audioData.sampleRate,
          numberOfChannels: audioData.numberOfChannels,
        }
      : undefined,
  });

  if (audioData) {
    await encoder.setAudioTrack(audioData);
  }

  let frameIndex = 0;
  let processedFrames = 0;
  let skippedFrames = 0;
  let skipReason = null;
  const totalFrames = videoInfo.frameCount || 0;

  for await (const frame of decoder.decodeFrames()) {
    const frameResult = processor.process(frame.imageData);
    if (frameResult.processed) {
      processedFrames++;
    } else {
      skippedFrames++;
      skipReason = skipReason || frameResult.reason || 'not_processed';
    }
    await encoder.encodeFrame(frame.imageData, frame.timestamp);

    frameIndex++;
    if (onProgress && totalFrames > 0) {
      onProgress(frameIndex, totalFrames);
    }
  }

  await decoder.close();
  const output = await encoder.finalize();
  output.videoProfile = processor.profile;
  output.processedFrames = processedFrames;
  output.skippedFrames = skippedFrames;
  output.skipped = processedFrames === 0;
  output.reason = processedFrames === 0 ? skipReason : null;
  return output;
}
