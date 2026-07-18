/**
 * Media facade: process capture → local IndexedDB.
 * Upload goes through the swappable adapter in mediaUpload.ts (local-only today).
 */

import { createMediaId, saveMedia, type MediaKind, type MediaRecord } from "./mediaStore";
import { processCapturedMedia } from "./mediaProcess";
import { mediaUploadAdapter } from "./mediaUpload";
import {
  createMediaDiagContext,
  logStorageEstimate,
  MediaCaptureError,
  mediaDiagError,
  mediaDiagLog,
} from "./mediaDiagnostics";

export interface CaptureMediaInput {
  sessionKey: string;
  ownerKey: string;
  kind: MediaKind;
  file: Blob;
}

/**
 * Process (resize photo when possible / keep video) and persist locally.
 * On Safari canvas failure, stores the original file instead of failing hard.
 */
export async function captureAndStoreMedia(input: CaptureMediaInput): Promise<MediaRecord> {
  const ctx = createMediaDiagContext(input.kind, input.file);
  mediaDiagLog(ctx, "capture-received", {
    sessionKey: input.sessionKey,
    ownerKey: input.ownerKey,
  });
  await logStorageEstimate(ctx);

  try {
    const processed = await processCapturedMedia(input.kind, input.file, ctx);
    const record: MediaRecord = {
      id: createMediaId(),
      sessionKey: input.sessionKey,
      ownerKey: input.ownerKey,
      kind: processed.kind,
      mimeType: processed.mimeType,
      blob: processed.blob,
      createdAt: Date.now(),
    };
    await saveMedia(record, ctx);
    await logStorageEstimate(ctx);
    return record;
  } catch (error) {
    mediaDiagError(ctx, "error", error);
    throw new MediaCaptureError(ctx, error);
  }
}

/** Future sync entry point — currently no-op for local-only adapter. */
export async function syncMediaRecord(record: MediaRecord): Promise<void> {
  await mediaUploadAdapter.upload(record);
}
