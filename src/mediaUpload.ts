/**
 * Swappable upload adapters. Active target comes from MEDIA_CONFIG.uploadTarget.
 * Server credentials never live here — only client-safe calls (Vercel Blob
 * client upload + our own serverless endpoints).
 */

import { MEDIA_CONFIG, type MediaUploadTargetConfig, type UploadTargetKind } from "./mediaConfig";
import type { MediaRecord } from "./mediaStore";
import { uploadViaBlobAndFtps } from "./blobFtpsUpload";

export interface MediaUploadResult {
  remotePath?: string;
}

export interface MediaUploadHooks {
  /**
   * Retry-ohne-Re-Upload: wird unmittelbar nach einem frisch erfolgreichen
   * Blob-Upload aufgerufen (noch vor dem FTPS-Schritt), damit der Aufrufer
   * die Blob-URL persistieren kann — siehe blobFtpsUpload.ts.
   */
  onBlobUploaded?: (info: { blobUrl: string; remoteFilename: string }) => void | Promise<void>;
  /** Optionaler FTPS-Unterordner, z.B. "2026/Schlüssel/Übergabe". */
  remoteSubdir?: string;
}

export interface MediaUploadAdapter {
  readonly kind: UploadTargetKind;
  /**
   * Push one stored media record to the configured remote.
   * local-only: no-op. blob-ftps: direct browser upload to Vercel Blob,
   * then server-side FTPS transfer to the company server.
   */
  upload(record: MediaRecord, hooks?: MediaUploadHooks): Promise<MediaUploadResult>;
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

class BlobFtpsUploadAdapter implements MediaUploadAdapter {
  readonly kind = "blob-ftps" as const;

  async upload(record: MediaRecord, hooks?: MediaUploadHooks): Promise<MediaUploadResult> {
    const result = await uploadViaBlobAndFtps({
      kind: record.kind,
      ownerKey: record.ownerKey,
      mediaId: record.id,
      mimeType: record.mimeType || record.blob.type || "application/octet-stream",
      blob: record.blob,
      // Schritt 2 (Foto-Benennung): lesbarer, bereits beim Erfassen berechneter
      // Dateiname (z.B. "Flur 01.jpg") statt des generischen Fallback-Namens.
      // Ältere Datensätze ohne dieses Feld laufen unverändert wie bisher.
      filename: record.friendlyFilename || undefined,
      remoteSubdir: hooks?.remoteSubdir ?? remoteSubdirForSchluesselRecord(record),
      // Retry-ohne-Re-Upload: falls ein früherer Versuch den Blob-Upload
      // bereits erfolgreich abgeschlossen hatte (siehe pendingBlobUrl in
      // mediaStore.ts), wird hier direkt bei der FTPS-Übertragung angesetzt.
      existingBlobUrl: record.pendingBlobUrl || undefined,
      existingRemoteFilename: record.pendingRemoteFilename || undefined,
      onBlobUploaded: hooks?.onBlobUploaded,
    });

    if (!result.ok) {
      throw new Error(result.error || "Server-Upload fehlgeschlagen.");
    }

    return { remotePath: result.remotePath };
  }
}

/** Nur Schlüssel: Fotos in denselben Vorgangsordner wie das PDF. Garage/Privat/Gewerbe unverändert. */
function remoteSubdirForSchluesselRecord(record: MediaRecord): string | undefined {
  if (record.objektart !== "schluessel") {
    return undefined;
  }
  const jahr = new Date().getFullYear();
  const protokollart = record.protokollart === "ruecknahme" ? "Rücknahme" : "Übergabe";
  return `${jahr}/Schlüssel/${protokollart}`;
}

export function createUploadAdapter(
  config: MediaUploadTargetConfig = MEDIA_CONFIG.uploadTarget
): MediaUploadAdapter {
  switch (config.kind) {
    case "local-only":
      return new LocalOnlyUploadAdapter();
    case "http":
      return new HttpUploadAdapter(config);
    case "blob-ftps":
      return new BlobFtpsUploadAdapter();
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
