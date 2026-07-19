/**
 * Media facade: process capture → local IndexedDB → optional NAS upload via proxy.
 * Local save always wins: upload failure never deletes IndexedDB media.
 */

import {
  createMediaId,
  getMediaById,
  saveMedia,
  updateMediaUploadState,
  type MediaKind,
  type MediaRecord,
} from "./mediaStore";
import { processCapturedMedia } from "./mediaProcess";
import { MEDIA_CONFIG } from "./mediaConfig";
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

export interface CaptureMediaResult {
  record: MediaRecord;
  /** False when local save succeeded but NAS upload failed or was skipped. */
  uploadOk: boolean;
  uploadError?: string;
}

function uploadEnabled(): boolean {
  return MEDIA_CONFIG.uploadTarget.kind !== "local-only";
}

/**
 * Upload a record that is already safely in IndexedDB.
 * Updates uploadStatus in IDB; does not remove local media on failure.
 */
export async function uploadMediaRecord(record: MediaRecord): Promise<MediaRecord> {
  if (!uploadEnabled()) {
    const skipped = await updateMediaUploadState(record.id, {
      uploadStatus: "uploaded",
      uploadError: "",
    });
    return skipped ?? { ...record, uploadStatus: "uploaded", uploadError: "" };
  }

  await updateMediaUploadState(record.id, {
    uploadStatus: "uploading",
    uploadError: "",
  });

  try {
    const result = await mediaUploadAdapter.upload(record);
    const updated = await updateMediaUploadState(record.id, {
      uploadStatus: "uploaded",
      uploadError: "",
      remotePath: result.remotePath,
    });
    return (
      updated ?? {
        ...record,
        uploadStatus: "uploaded",
        uploadError: "",
        remotePath: result.remotePath,
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "NAS-Upload fehlgeschlagen.";
    const failed = await updateMediaUploadState(record.id, {
      uploadStatus: "failed",
      uploadError: message,
    });
    const next =
      failed ?? {
        ...record,
        uploadStatus: "failed" as const,
        uploadError: message,
      };
    throw Object.assign(new Error(message), { record: next });
  }
}

/**
 * Process (resize photo when possible / keep video) and persist locally,
 * then attempt NAS upload. Capture succeeds even if upload fails.
 */
export async function captureAndStoreMedia(input: CaptureMediaInput): Promise<CaptureMediaResult> {
  const ctx = createMediaDiagContext(input.kind, input.file);
  mediaDiagLog(ctx, "capture-received", {
    sessionKey: input.sessionKey,
    ownerKey: input.ownerKey,
  });
  await logStorageEstimate(ctx);

  let saved: MediaRecord;
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
      uploadStatus: "pending",
    };
    saved = await saveMedia(record, ctx);
    await logStorageEstimate(ctx);
    mediaDiagLog(ctx, "idb-put-done", {
      storageMode: saved.storageMode ?? "(unknown)",
      id: saved.id,
    });
  } catch (error) {
    mediaDiagError(ctx, "error", error);
    throw new MediaCaptureError(ctx, error);
  }

  if (!uploadEnabled()) {
    return { record: saved, uploadOk: true };
  }

  try {
    const uploaded = await uploadMediaRecord(saved);
    return { record: uploaded, uploadOk: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "NAS-Upload fehlgeschlagen.";
    console.warn(`[media-upload ${ctx.diagnosisId}]`, message, error);
    const failed =
      (error && typeof error === "object" && "record" in error
        ? (error as { record: MediaRecord }).record
        : null) ??
      (await getMediaById(saved.id)) ?? {
        ...saved,
        uploadStatus: "failed" as const,
        uploadError: message,
      };
    return { record: failed, uploadOk: false, uploadError: message };
  }
}

/** Alias kept for callers that only need the upload step. */
export async function syncMediaRecord(record: MediaRecord): Promise<MediaRecord> {
  return uploadMediaRecord(record);
}
