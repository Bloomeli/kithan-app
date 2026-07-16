/** Capture-time processing: resize/compress photos; keep video quality intact. */

import { MEDIA_CONFIG } from "./mediaConfig";
import type { MediaKind } from "./mediaStore";

export interface ProcessedMedia {
  blob: Blob;
  mimeType: string;
  kind: MediaKind;
}

function loadImageElement(source: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Bild konnte nicht geladen werden."));
    };
    image.src = url;
  });
}

async function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/jpeg", quality);
  });
  if (!blob) {
    throw new Error("JPEG-Kompression fehlgeschlagen.");
  }
  return blob;
}

/**
 * Normalize a photo so the longer side is at most ~2000px.
 * Smaller images are kept (no upscale). Output is high-quality JPEG.
 */
export async function processCapturedPhoto(file: Blob): Promise<ProcessedMedia> {
  const { targetLongSidePx, jpegQuality } = MEDIA_CONFIG.photo;
  const image = await loadImageElement(file);
  const srcW = image.naturalWidth || image.width;
  const srcH = image.naturalHeight || image.height;

  if (srcW < 1 || srcH < 1) {
    throw new Error("Ungültige Bildabmessungen.");
  }

  const longSide = Math.max(srcW, srcH);
  const scale = longSide > targetLongSidePx ? targetLongSidePx / longSide : 1;
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D-Kontext für Bildverarbeitung nicht verfügbar.");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);

  const blob = await canvasToJpegBlob(canvas, jpegQuality);
  // Re-wrap so IndexedDB stores plain bytes (avoids WebKit blank <img> previews).
  const stableBlob = new Blob([await blob.arrayBuffer()], { type: "image/jpeg" });
  return { blob: stableBlob, mimeType: "image/jpeg", kind: "photo" };
}

/**
 * Store video as captured — no client re-encode (preserves detail for meters/damage).
 */
export async function processCapturedVideo(file: Blob): Promise<ProcessedMedia> {
  // Do not re-encode: MEDIA_CONFIG.video.reencode is false so detail stays readable.
  const mimeType = file.type || "video/mp4";
  return { blob: file, mimeType, kind: "video" };
}

export async function processCapturedMedia(kind: MediaKind, file: Blob): Promise<ProcessedMedia> {
  if (kind === "photo") {
    return processCapturedPhoto(file);
  }
  return processCapturedVideo(file);
}
