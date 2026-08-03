/**
 * Media facade: process capture → local IndexedDB → optional server upload (Vercel Blob + FTPS).
 * Local save always wins: upload failure never deletes IndexedDB media.
 */

import {
  createMediaId,
  loadMediaForUpload,
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
}

function uploadEnabled(): boolean {
  return MEDIA_CONFIG.uploadTarget.kind !== "local-only";
}

/**
 * Upload a record that is already safely in IndexedDB.
 * Always re-reads + detaches bytes before status writes and the upload call.
 */
export async function uploadMediaRecord(recordOrId: MediaRecord | string): Promise<MediaRecord> {
  const id = typeof recordOrId === "string" ? recordOrId : recordOrId.id;

  // Fresh IDB read + detached Blob for upload body (never reuse a closed-tx handle).
  const forUpload = await loadMediaForUpload(id);
  if (!forUpload) {
    throw new Error("Medium für Upload nicht in IndexedDB gefunden.");
  }

  if (!uploadEnabled()) {
    const skipped = await updateMediaUploadState(id, {
      uploadStatus: "uploaded",
      uploadError: "",
    });
    return skipped ?? { ...forUpload, uploadStatus: "uploaded", uploadError: "" };
  }

  await updateMediaUploadState(id, {
    uploadStatus: "uploading",
    uploadError: "",
  });

  // Re-load after status write so the fetch body is a freshly detached Blob.
  const uploadBody = (await loadMediaForUpload(id)) ?? forUpload;

  try {
    const result = await mediaUploadAdapter.upload(uploadBody);
    const updated = await updateMediaUploadState(id, {
      uploadStatus: "uploaded",
      uploadError: "",
      remotePath: result.remotePath,
    });
    console.log(`[uploadMediaRecord] OK id=${id} kind=${uploadBody.kind} remotePath=${result.remotePath ?? "(none)"}`);
    return (
      updated ?? {
        ...uploadBody,
        uploadStatus: "uploaded",
        uploadError: "",
        remotePath: result.remotePath,
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Server-Upload fehlgeschlagen.";
    // This is the exact spot where a failed upload turns into the
    // employee-facing "Server momentan nicht erreichbar" message — log the
    // real, technical reason here so it can be inspected (e.g. via Safari
    // Web Inspector) even though the UI intentionally shows a simplified text.
    console.error("[uploadMediaRecord] FAILED — this is why 'Server momentan nicht erreichbar' is shown:", {
      mediaId: id,
      kind: uploadBody.kind,
      mimeType: uploadBody.mimeType,
      blobSize: uploadBody.blob.size,
      uploadTargetKind: MEDIA_CONFIG.uploadTarget.kind,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: message,
      errorStack: error instanceof Error ? error.stack : undefined,
      rawError: error,
    });
    const failed = await updateMediaUploadState(id, {
      uploadStatus: "failed",
      uploadError: message,
    });
    const next =
      failed ?? {
        ...uploadBody,
        uploadStatus: "failed" as const,
        uploadError: message,
      };
    throw Object.assign(new Error(message), { record: next });
  }
}

/**
 * Process (resize photo when possible / keep video) and persist locally.
 * Resolves as soon as the local IndexedDB save succeeds — deliberately does
 * NOT wait for the (potentially slow, multi-hop) server upload, so the UI
 * can show the new thumbnail immediately. Callers trigger the upload
 * separately via `uploadMediaRecord` (fire-and-forget, same as the manual
 * "Erneut hochladen" retry path) and refresh the UI once it settles.
 */
export async function captureAndStoreMedia(input: CaptureMediaInput): Promise<CaptureMediaResult> {
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
      uploadStatus: "pending",
    };
    const saved = await saveMedia(record, ctx);
    await logStorageEstimate(ctx);
    mediaDiagLog(ctx, "idb-put-done", {
      storageMode: saved.storageMode ?? "(unknown)",
      id: saved.id,
    });
    return { record: saved };
  } catch (error) {
    mediaDiagError(ctx, "error", error);
    throw new MediaCaptureError(ctx, error);
  }
}

/** Alias kept for callers that only need the upload step. */
export async function syncMediaRecord(record: MediaRecord): Promise<MediaRecord> {
  return uploadMediaRecord(record.id);
}
