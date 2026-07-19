/**
 * Swappable upload adapters. Active target comes from MEDIA_CONFIG.uploadTarget.
 * NAS credentials never live here — only the same-origin Vercel proxy endpoint.
 */

import { MEDIA_CONFIG, type MediaUploadTargetConfig, type UploadTargetKind } from "./mediaConfig";
import type { MediaRecord } from "./mediaStore";

export interface MediaUploadResult {
  remotePath?: string;
}

export interface MediaUploadAdapter {
  readonly kind: UploadTargetKind;
  /**
   * Push one stored media record to the configured remote.
   * local-only: no-op. NAS: POST bytes to the serverless WebDAV proxy.
   */
  upload(record: MediaRecord): Promise<MediaUploadResult>;
  /** Optional batch helper for a later sync step. */
  uploadMany?(records: MediaRecord[]): Promise<MediaUploadResult[]>;
}

class LocalOnlyUploadAdapter implements MediaUploadAdapter {
  readonly kind = "local-only" as const;

  async upload(record: MediaRecord): Promise<MediaUploadResult> {
    void record;
    return {};
  }
}

class HttpUploadAdapter implements MediaUploadAdapter {
  readonly kind = "http" as const;

  constructor(private readonly config: MediaUploadTargetConfig) {}

  async upload(record: MediaRecord): Promise<MediaUploadResult> {
    void record;
    throw new Error(
      `HTTP-Upload ist noch nicht implementiert (endpoint: ${this.config.endpoint ?? "—"}).`
    );
  }
}

class NasUploadAdapter implements MediaUploadAdapter {
  readonly kind = "nas" as const;

  constructor(private readonly config: MediaUploadTargetConfig) {}

  async upload(record: MediaRecord): Promise<MediaUploadResult> {
    const endpoint = this.config.endpoint?.trim();
    if (!endpoint) {
      throw new Error("NAS-Upload-Endpoint ist nicht konfiguriert.");
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": record.mimeType || record.blob.type || "application/octet-stream",
        "X-Kithan-Media-Id": record.id,
        "X-Kithan-Kind": record.kind,
        "X-Kithan-Owner": record.ownerKey,
        "X-Kithan-Session": record.sessionKey,
      },
      body: record.blob,
    });

    let payload: { ok?: boolean; error?: string; remotePath?: string } = {};
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      // non-JSON error body
    }

    if (!response.ok || payload.ok === false) {
      const message =
        payload.error?.trim() ||
        `NAS-Upload fehlgeschlagen (HTTP ${response.status}).`;
      throw new Error(message);
    }

    return { remotePath: payload.remotePath };
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
