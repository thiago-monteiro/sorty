/**
 * Frame capture for the camera UI.
 *
 * Contract:
 * - `captureFrame(video, maxEdge?)` returns a JPEG data URL of the current
 *   video frame, preserving its aspect ratio and scaling the longer edge down
 *   to `maxEdge` (default 960). It never upscales.
 * - Dimensions come from `video.videoWidth` / `video.videoHeight`, the frame
 *   the browser actually decoded. No rotation is invented: if the stream
 *   carries orientation metadata the caller can rotate deliberately.
 * - Throws an explicit error when the video has no frame yet or 2D canvas is
 *   unavailable. The parent owns the camera stream and its lifecycle.
 */

export const CAPTURE_MAX_EDGE = 960;
export const CAPTURE_JPEG_QUALITY = 0.85;

/** Fit intrinsic frame dimensions inside `maxEdge` without changing aspect. */
export function fitFrame(
  width: number,
  height: number,
  maxEdge = CAPTURE_MAX_EDGE,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Camera frame is not ready; wait for loadedmetadata.");
  }
  if (!Number.isFinite(maxEdge) || maxEdge < 1) {
    throw new Error("maxEdge must be a positive pixel count.");
  }
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Capture the current video frame as a JPEG data URL. */
export function captureFrame(
  video: HTMLVideoElement,
  maxEdge = CAPTURE_MAX_EDGE,
): string {
  if (!video || video.readyState < 2) {
    throw new Error("Camera frame is not ready; wait for loadeddata or playing.");
  }
  const size = fitFrame(video.videoWidth, video.videoHeight, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas is unavailable; cannot capture the camera frame.");
  }
  context.drawImage(video, 0, 0, size.width, size.height);
  return canvas.toDataURL("image/jpeg", CAPTURE_JPEG_QUALITY);
}
