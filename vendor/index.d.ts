// Types for the vendored MIT watermark engine (plain JS).
export type AlphaMap = { data: Float32Array; width: number; height: number; source?: string };
export type WatermarkInfo = {
  profile: 'diamond' | 'legacy';
  alphaMapKey: string;
  position: { x: number; y: number; width: number; height: number };
};
export type ProcessedVideo = Blob & {
  videoProfile?: string | null;
  processedFrames?: number;
  skippedFrames?: number;
  skipped?: boolean;
  reason?: string | null;
};
export function getVeoWatermarkInfo(width: number, height: number, profile?: string): WatermarkInfo | null;
export function getVeoWatermarkCandidates(width: number, height: number, profile?: string): WatermarkInfo[];
export function getEmbeddedAlphaMap(key: string): AlphaMap | null;
export function processVideo(
  input: Blob,
  options?: { onProgress?: (current: number, total: number) => void; bitrate?: number; videoProfile?: 'diamond' | 'legacy'; position?: { x: number; y: number } }
): Promise<ProcessedVideo>;
