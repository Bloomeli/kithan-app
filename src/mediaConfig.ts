/**
 * Media quality and upload-target configuration.
 * Swap `uploadTarget` later without changing card/UI code.
 */

export type UploadTargetKind = "local-only" | "http" | "blob-ftps";

export interface MediaUploadTargetConfig {
  kind: UploadTargetKind;
  /** Browser-facing proxy endpoint (never the NAS URL or credentials). */
  endpoint?: string;
  /** Free-form adapter options (non-secret). */
  options?: Record<string, string>;
}

export interface MediaPhotoQualityConfig {
  /** Longer side target after capture (downscale if larger; never upscale). */
  targetLongSidePx: number;
  /** JPEG quality 0–1 — high enough to keep meter digits / damage readable. */
  jpegQuality: number;
}

export interface MediaVideoQualityConfig {
  /**
   * When false, store the device-captured video blob as-is (no re-encode).
   * Client-side re-encoding would risk losing detail needed for meter readings.
   */
  reencode: false;
}

export interface MediaConfig {
  photo: MediaPhotoQualityConfig;
  video: MediaVideoQualityConfig;
  uploadTarget: MediaUploadTargetConfig;
}

export const MEDIA_CONFIG: MediaConfig = {
  photo: {
    targetLongSidePx: 2000,
    jpegQuality: 0.88,
  },
  video: {
    reencode: false,
  },
  uploadTarget: {
    // Direkter Client-Upload zu Vercel Blob + serverseitige FTPS-Übertragung
    // (siehe src/blobFtpsUpload.ts, api/blob-upload-token.ts, api/ftps-transfer.ts).
    kind: "blob-ftps",
  },
};
