/**
 * Media facade: process capture → local IndexedDB.
 * Upload goes through the swappable adapter in mediaUpload.ts (local-only today).
 */

import { createMediaId, saveMedia, type MediaKind, type MediaRecord } from "./mediaStore";
import { processCapturedMedia } from "./mediaProcess";
import { mediaUploadAdapter } from "./mediaUpload";

export interface CaptureMediaInput {
  sessionKey: string;
  ownerKey: string;
  kind: MediaKind;
  file: Blob;
}

/**
 * Process (resize photo / keep video) and persist locally.
 * Does not upload yet — call `syncMediaRecord` later when a remote target is ready.
 */
export async function captureAndStoreMedia(input: CaptureMediaInput): Promise<MediaRecord> {
  const processed = await processCapturedMedia(input.kind, input.file);
  const record: MediaRecord = {
    id: createMediaId(),
    sessionKey: input.sessionKey,
    ownerKey: input.ownerKey,
    kind: processed.kind,
    mimeType: processed.mimeType,
    blob: processed.blob,
    createdAt: Date.now(),
  };
  await saveMedia(record);
  return record;
}

/** Future sync entry point — currently no-op for local-only adapter. */
export async function syncMediaRecord(record: MediaRecord): Promise<void> {
  await mediaUploadAdapter.upload(record);
}
