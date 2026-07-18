/**
 * Capture-time processing for photo/video.
 * Safari-safe: prefer original File/Blob when canvas conversion fails.
 */

import { MEDIA_CONFIG } from "./mediaConfig";
import type { MediaKind } from "./mediaStore";
import {
  mediaDiagError,
  mediaDiagLog,
  type MediaDiagContext,
} from "./mediaDiagnostics";

export interface ProcessedMedia {
  blob: Blob;
  mimeType: string;
  kind: MediaKind;
  /** How the blob was produced — useful for diagnostics. */
  source: "canvas-jpeg" | "original-file";
}

function guessPhotoMime(file: Blob): string {
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("image/")) {
    return type;
  }
  const name = typeof (file as File).name === "string" ? (file as File).name.toLowerCase() : "";
  if (name.endsWith(".heic") || name.endsWith(".heif")) {
    return "image/heic";
  }
  if (name.endsWith(".png")) {
    return "image/png";
  }
  if (name.endsWith(".webp")) {
    return "image/webp";
  }
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  return type || "application/octet-stream";
}

function guessVideoMime(file: Blob): string {
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("video/")) {
    return type;
  }
  const name = typeof (file as File).name === "string" ? (file as File).name.toLowerCase() : "";
  if (name.endsWith(".mov") || name.endsWith(".qt")) {
    return "video/quicktime";
  }
  if (name.endsWith(".mp4") || name.endsWith(".m4v")) {
    return "video/mp4";
  }
  if (name.endsWith(".webm")) {
    return "video/webm";
  }
  return type || "video/mp4";
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
      reject(new Error("Bild konnte nicht geladen werden (decode/HEIC?)."));
    };
    image.src = url;
  });
}

async function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  // Prefer toBlob; fall back to dataURL→Blob if toBlob returns null (seen on some WebKit builds).
  const fromToBlob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((result) => resolve(result), "image/jpeg", quality);
    } catch {
      resolve(null);
    }
  });
  if (fromToBlob && fromToBlob.size > 0) {
    return fromToBlob;
  }

  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  if (!blob.size) {
    throw new Error("JPEG-Kompression fehlgeschlagen (toBlob/dataURL leer).");
  }
  return new Blob([await blob.arrayBuffer()], { type: "image/jpeg" });
}

async function processPhotoViaCanvas(
  file: Blob,
  ctx: MediaDiagContext
): Promise<ProcessedMedia> {
  const { targetLongSidePx, jpegQuality } = MEDIA_CONFIG.photo;

  mediaDiagLog(ctx, "process-photo-decode");
  const image = await loadImageElement(file);
  const srcW = image.naturalWidth || image.width;
  const srcH = image.naturalHeight || image.height;
  mediaDiagLog(ctx, "process-photo-decode", { srcW, srcH });

  if (srcW < 1 || srcH < 1) {
    throw new Error("Ungültige Bildabmessungen.");
  }

  const longSide = Math.max(srcW, srcH);
  const scale = longSide > targetLongSidePx ? targetLongSidePx / longSide : 1;
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  mediaDiagLog(ctx, "process-photo-canvas", { width, height, scale });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const canvasCtx = canvas.getContext("2d");
  if (!canvasCtx) {
    throw new Error("2D-Kontext für Bildverarbeitung nicht verfügbar.");
  }
  canvasCtx.imageSmoothingEnabled = true;
  canvasCtx.imageSmoothingQuality = "high";
  canvasCtx.drawImage(image, 0, 0, width, height);

  mediaDiagLog(ctx, "process-photo-toblob", { jpegQuality });
  const jpeg = await canvasToJpegBlob(canvas, jpegQuality);
  mediaDiagLog(ctx, "process-photo-toblob", {
    blobType: jpeg.type,
    blobSize: jpeg.size,
  });

  return {
    blob: jpeg,
    mimeType: "image/jpeg",
    kind: "photo",
    source: "canvas-jpeg",
  };
}

async function fallbackOriginalPhoto(
  file: Blob,
  ctx: MediaDiagContext,
  reason: unknown
): Promise<ProcessedMedia> {
  mediaDiagError(ctx, "process-photo-fallback-original", reason);
  mediaDiagLog(ctx, "process-photo-fallback-original", {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
  const mimeType = guessPhotoMime(file);
  // Keep original bytes — no canvas. Clone later in save path.
  return {
    blob: file,
    mimeType,
    kind: "photo",
    source: "original-file",
  };
}

/**
 * Normalize a photo (resize when possible). On Safari/canvas failure, keep original.
 */
export async function processCapturedPhoto(
  file: Blob,
  ctx: MediaDiagContext
): Promise<ProcessedMedia> {
  try {
    return await processPhotoViaCanvas(file, ctx);
  } catch (error) {
    return fallbackOriginalPhoto(file, ctx, error);
  }
}

/**
 * Store video as captured — no client re-encode.
 */
export async function processCapturedVideo(
  file: Blob,
  ctx: MediaDiagContext
): Promise<ProcessedMedia> {
  const mimeType = guessVideoMime(file);
  mediaDiagLog(ctx, "process-video", {
    blobType: file.type || "(empty)",
    guessedMime: mimeType,
    blobSize: file.size,
  });
  return {
    blob: file,
    mimeType,
    kind: "video",
    source: "original-file",
  };
}

export async function processCapturedMedia(
  kind: MediaKind,
  file: Blob,
  ctx: MediaDiagContext
): Promise<ProcessedMedia> {
  mediaDiagLog(ctx, "process-start", { kind });
  const processed =
    kind === "photo"
      ? await processCapturedPhoto(file, ctx)
      : await processCapturedVideo(file, ctx);
  mediaDiagLog(ctx, "process-done", {
    source: processed.source,
    mimeType: processed.mimeType,
    blobType: processed.blob.type || "(empty)",
    blobSize: processed.blob.size,
  });
  return processed;
}
