/**
 * Swappable upload adapters. Active target comes from MEDIA_CONFIG.uploadTarget.
 * Local-only for now; NAS/HTTP adapters can be plugged in without touching UI.
 */

import { MEDIA_CONFIG, type MediaUploadTargetConfig, type UploadTargetKind } from "./mediaConfig";
import type { MediaRecord } from "./mediaStore";

export interface MediaUploadAdapter {
  readonly kind: UploadTargetKind;
  /**
   * Push one stored media record to the configured remote.
   * local-only: no-op. Future NAS/cloud: implement transfer here.
   */
  upload(record: MediaRecord): Promise<void>;
  /** Optional batch helper for a later sync step. */
  uploadMany?(records: MediaRecord[]): Promise<void>;
}

class LocalOnlyUploadAdapter implements MediaUploadAdapter {
  readonly kind = "local-only" as const;

  async upload(record: MediaRecord): Promise<void> {
    void record;
    // Intentionally empty — media stays on-device until a remote target is configured.
  }
}

class HttpUploadAdapter implements MediaUploadAdapter {
  readonly kind = "http" as const;

  constructor(private readonly config: MediaUploadTargetConfig) {}

  async upload(record: MediaRecord): Promise<void> {
    void record;
    throw new Error(
      `HTTP-Upload ist noch nicht implementiert (endpoint: ${this.config.endpoint ?? "—"}).`
    );
  }
}

class NasUploadAdapter implements MediaUploadAdapter {
  readonly kind = "nas" as const;

  constructor(private readonly config: MediaUploadTargetConfig) {}

  async upload(record: MediaRecord): Promise<void> {
    void record;
    throw new Error(
      `NAS-Upload ist noch nicht implementiert (endpoint: ${this.config.endpoint ?? "—"}).`
    );
  }
}

export function createUploadAdapter(
  config: MediaUploadTargetConfig = MEDIA_CONFIG.uploadTarget
): MediaUploadAdapter {
  switch (config.kind) {
    case "local-only":
      return new LocalOnlyUploadAdapter();
    case "http":
      return new HttpUploadAdapter(config);
    case "nas":
      return new NasUploadAdapter(config);
    default: {
      const _exhaustive: never = config.kind;
      return _exhaustive;
    }
  }
}

/** Singleton used by the media service; recreate if config changes at runtime. */
export let mediaUploadAdapter: MediaUploadAdapter = createUploadAdapter();

export function setMediaUploadAdapter(adapter: MediaUploadAdapter): void {
  mediaUploadAdapter = adapter;
}

export function reloadMediaUploadAdapterFromConfig(): void {
  mediaUploadAdapter = createUploadAdapter(MEDIA_CONFIG.uploadTarget);
}
