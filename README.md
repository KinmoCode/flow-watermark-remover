# Flow Watermark Remover — Browser WebCodecs Engine & Calibration Notes

Client-side **reverse alpha blending** pipeline used by **[flowwatermarkremover.com](https://flowwatermarkremover.com)** to remove the semi-transparent Gemini diamond overlay from original **Google Flow** and **Veo** MP4 exports directly in the browser (Chrome / Edge WebCodecs), with zero video upload.

> Independent open-source utility (MIT). Not affiliated with, endorsed by, or connected to Google.

## Live Browser Tool & Verification

- **Web App (2 free videos/day, no sign-up):** [flowwatermarkremover.com](https://flowwatermarkremover.com)
- **Motion Video Before/After Samples:** [/examples](https://flowwatermarkremover.com/examples)
- **Google Flow Diamond Size & Margin Measurements:** [/google-flow-watermark-size](https://flowwatermarkremover.com/google-flow-watermark-size)
- **How to Turn Off the Watermark for New Flow Generations:** [/turn-off-google-flow-watermark](https://flowwatermarkremover.com/turn-off-google-flow-watermark)
- **Step-by-Step Removal Guide for Downloaded Clips:** [/how-to-remove-google-flow-watermark](https://flowwatermarkremover.com/how-to-remove-google-flow-watermark)
- **How to Verify Zero Network Upload in DevTools:** [/about](https://flowwatermarkremover.com/about)

## Empirical Google Flow Diamond Calibration (November 2026)

Unlike AI inpainting tools that blur or hallucinate corner pixels, reverse alpha blending inverts the exact compositing equation `pixel_out = (1 - alpha) * pixel_src + alpha * logo` frame by frame:

1. **Diamond dimensions (`short_side / 15`):**
   - `1920×1080` and `1080×1920` exports: **72 × 72 px**
   - `1280×720` and `720×1280` exports: **48 × 48 px** (scaled from the calibrated 96px alpha map with a gain around `0.96`)
2. **Two edge-offset positions in the wild:**
   - **November 2026 Flow exports:** inset by **2×** the mark width from the right and bottom edges (`144 px` at 1080p, `96 px` at 720p).
   - **Earlier Flow / Veo exports:** inset by **1.5×** the mark width from the right and bottom edges (`108 px` at 1080p, `72 px` at 720p).
3. **Background-plane correlation check (`engine.ts`):**
   - Samples 5 timestamps (`10%`, `30%`, `50%`, `70%`, `90%`), fits a least-squares luminance plane `l = c0 + c1*x + c2*y` over surrounding unmasked pixels, and computes Pearson correlation against the alpha template (`score >= 0.35` confirms an uncropped original Flow export before decoding the full video).

## Limitations

- Works only on **original MP4 downloads** from Google Flow or Veo (`1080p` or `720p`, landscape or portrait). Screen-recorded, cropped, or re-encoded social media copies shift the overlay and fail the compatibility check.
- On very dark 1080p backgrounds, 8-bit H.264 quantization can leave a faint corner outline when zoomed in.

## Credits & License

MIT License. Built upon the reverse-alpha-blending research in [allenk/VeoWatermarkRemover](https://github.com/allenk/VeoWatermarkRemover) and `gemini-veo-watermark-remover` (MIT). See [`LICENSE`](./LICENSE).
