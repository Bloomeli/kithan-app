/**
 * Media quality and upload-target configuration.
 * Swap `uploadTarget` later for NAS/cloud without changing card/UI code.
 */

export type UploadTargetKind = "local-only" | "http" | "nas";

export interface MediaUploadTargetConfig {
  kind: UploadTargetKind;
  /** Base URL / share path — meaning depends on `kind` (exact protocol TBD). */
  endpoint?: string;
  /** Free-form adapter options (auth headers, share name, etc.). */
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
    kind: "local-only",
  },
};
