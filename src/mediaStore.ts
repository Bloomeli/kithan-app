/**
 * Local IndexedDB persistence for photo/video (session-scoped).
 * Safari/WebKit: never store live File handles; prefer detached Blob, fall back to ArrayBuffer.
 */

import {
  logStorageEstimate,
  mediaDiagError,
  mediaDiagLog,
  normalizeError,
  type MediaDiagContext,
} from "./mediaDiagnostics";

export type MediaKind = "photo" | "video";

/** Server-Upload lifecycle — local IndexedDB always keeps the blob regardless of status. */
export type MediaUploadStatus = "pending" | "uploading" | "uploaded" | "failed";

/** In-memory / API shape — always exposes a Blob for UI. */
export interface MediaRecord {
  id: string;
  sessionKey: string;
  ownerKey: string;
  kind: MediaKind;
  mimeType: string;
  blob: Blob;
  createdAt: number;
  /** Which IndexedDB payload mode succeeded (set after save). */
  storageMode?: "blob" | "arraybuffer";
  uploadStatus?: MediaUploadStatus;
  uploadError?: string;
  remotePath?: string;
  /**
   * Blob-URL eines bereits erfolgreich zu Vercel Blob hochgeladenen, aber
   * noch nicht per FTPS bestätigten Uploads. Ermöglicht einem späteren Retry
   * (nach FTPS-Fehlschlag), direkt bei der FTPS-Übertragung anzusetzen, ohne
   * die Datei erneut vom Gerät zu Vercel Blob hochladen zu müssen. Wird nach
   * erfolgreichem Abschluss wieder geleert.
   */
  pendingBlobUrl?: string;
  /** Der bei diesem Blob-Upload verwendete Ziel-Dateiname (siehe pendingBlobUrl). */
  pendingRemoteFilename?: string;
  /**
   * Lesbare Bezeichnung des Formularbereichs (Raum oder Zähler), dem dieses
   * Foto/Video zugeordnet wurde — z.B. "Flur", "Stromzähler 1". Wird bereits
   * BEIM Erfassen gesetzt (siehe captureAndStoreMedia in mediaService.ts),
   * nicht erst später abgeleitet.
   */
  ownerLabel?: string;
  /** Fortlaufende Nummer INNERHALB dieses Bereichs + Medientyps (1-basiert), z.B. 1, 2, 3 — für "Flur 01", "Flur 02". */
  ownerSequence?: number;
  /** Fertig berechneter, lesbarer Ziel-Dateiname (z.B. "Flur 01.jpg") — wird beim Server-Upload verwendet, falls gesetzt. */
  friendlyFilename?: string;
}

/**
 * Plain object written to IndexedDB — only serializable fields.
 * No File, URL, DOM, class instance, or stream.
 */
interface StoredMediaRecord {
  id: string;
  sessionKey: string;
  ownerKey: string;
  kind: MediaKind;
  mimeType: string;
  createdAt: number;
  storageMode: "blob" | "arraybuffer";
  /** Detached Blob (mode blob). */
  blob?: Blob;
  /** Raw bytes (mode arraybuffer) — WebKit fallback when Blob put fails. */
  data?: ArrayBuffer;
  uploadStatus?: MediaUploadStatus;
  uploadError?: string;
  remotePath?: string;
  pendingBlobUrl?: string;
  pendingRemoteFilename?: string;
  ownerLabel?: string;
  ownerSequence?: number;
  friendlyFilename?: string;
}

const DB_NAME = "kithan-media";
const DB_VERSION = 1;
const STORE_NAME = "media";
const SELFTEST_ID_PREFIX = "__kithan_media_selftest_";

/** Safari often fails the first IndexedDB open after load; retry before surfacing errors. */
const READY_MAX_ATTEMPTS = 3;
const READY_RETRY_DELAY_MS = 280;

let mediaDbReady = false;
let mediaDbReadyInFlight: Promise<void> | null = null;
let selfTestPromise: Promise<void> | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("bySessionOwner", ["sessionKey", "ownerKey"], { unique: false });
        store.createIndex("bySession", "sessionKey", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB konnte nicht geöffnet werden."));
    request.onblocked = () =>
      reject(new Error("IndexedDB open blocked (andere Tab/Version?)."));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB-Anfrage fehlgeschlagen."));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("IndexedDB-Transaktion fehlgeschlagen."));
    tx.onabort = () =>
      reject(tx.error ?? new Error("IndexedDB-Transaktion abgebrochen."));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorDetail(error: unknown, tx?: IDBTransaction | null): Record<string, unknown> {
  const err = normalizeError(error);
  return {
    errorName: err.name,
    errorMessage: err.message,
    errorStack: err.stack ?? "(none)",
    transactionErrorName: tx?.error?.name ?? null,
    transactionErrorMessage: tx?.error?.message ?? null,
    dbName: DB_NAME,
    dbVersion: DB_VERSION,
    storeName: STORE_NAME,
  };
}

/** Lightweight open + no-op read to verify IndexedDB is usable. */
async function probeMediaDb(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).count();
    await Promise.all([requestToPromise(request), transactionDone(tx)]);
  } finally {
    db.close();
  }
}

/**
 * Ensure media IndexedDB can open (Safari first-attempt workaround).
 * Retries silently; only throws after all attempts fail.
 */
export async function ensureMediaDbReady(ctx?: MediaDiagContext): Promise<void> {
  if (mediaDbReady) {
    if (ctx) {
      mediaDiagLog(ctx, "idb-ready", { cached: true });
    }
    return;
  }
  if (!mediaDbReadyInFlight) {
    mediaDbReadyInFlight = (async () => {
      let lastError: unknown;
      for (let attempt = 1; attempt <= READY_MAX_ATTEMPTS; attempt += 1) {
        try {
          await probeMediaDb();
          mediaDbReady = true;
          return;
        } catch (error) {
          lastError = error;
          console.warn(
            `IndexedDB readiness check failed (attempt ${attempt}/${READY_MAX_ATTEMPTS})`,
            error
          );
          if (attempt < READY_MAX_ATTEMPTS) {
            await delay(READY_RETRY_DELAY_MS);
          }
        }
      }
      throw lastError instanceof Error ? lastError : new Error("IndexedDB nicht bereit.");
    })().finally(() => {
      mediaDbReadyInFlight = null;
    });
  }
  try {
    await mediaDbReadyInFlight;
    if (ctx) {
      mediaDiagLog(ctx, "idb-ready", { cached: false });
    }
  } catch (error) {
    if (ctx) {
      mediaDiagError(ctx, "idb-ready", error);
    }
    throw error;
  }
}

export function createMediaId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `media-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Detach bytes from File/Blob before any IDB transaction. */
async function detachBytes(
  file: Blob,
  mimeType: string
): Promise<{ buffer: ArrayBuffer; safeBlob: Blob; mimeType: string }> {
  const type = mimeType || file.type || "application/octet-stream";
  const buffer = await file.arrayBuffer();
  // New Blob from a copy of the buffer — not the original File/camera handle.
  const safeBlob = new Blob([buffer.slice(0)], { type });
  return { buffer: buffer.slice(0), safeBlob, mimeType: type };
}

function uploadFieldsFromStored(stored: StoredMediaRecord): Pick<
  MediaRecord,
  | "uploadStatus"
  | "uploadError"
  | "remotePath"
  | "pendingBlobUrl"
  | "pendingRemoteFilename"
  | "ownerLabel"
  | "ownerSequence"
  | "friendlyFilename"
> {
  return {
    uploadStatus: stored.uploadStatus,
    uploadError: stored.uploadError,
    remotePath: stored.remotePath,
    pendingBlobUrl: stored.pendingBlobUrl,
    pendingRemoteFilename: stored.pendingRemoteFilename,
    ownerLabel: stored.ownerLabel,
    ownerSequence: stored.ownerSequence,
    friendlyFilename: stored.friendlyFilename,
  };
}

function storedToMediaRecord(raw: StoredMediaRecord | MediaRecord): MediaRecord {
  const stored = raw as StoredMediaRecord;
  const mimeType = stored.mimeType || "application/octet-stream";

  if (stored.storageMode === "arraybuffer" && stored.data) {
    return {
      id: stored.id,
      sessionKey: stored.sessionKey,
      ownerKey: stored.ownerKey,
      kind: stored.kind,
      mimeType,
      blob: new Blob([stored.data], { type: mimeType }),
      createdAt: stored.createdAt,
      storageMode: "arraybuffer",
      ...uploadFieldsFromStored(stored),
    };
  }

  // Legacy rows: only `blob` field, or mode blob.
  const blob =
    stored.blob ??
    ((raw as MediaRecord).blob instanceof Blob ? (raw as MediaRecord).blob : null);
  if (!blob) {
    throw new Error(`Media-Eintrag ${stored.id} hat keine nutzbaren Daten.`);
  }
  return {
    id: stored.id,
    sessionKey: stored.sessionKey,
    ownerKey: stored.ownerKey,
    kind: stored.kind,
    mimeType: mimeType || blob.type || "application/octet-stream",
    blob,
    createdAt: stored.createdAt,
    storageMode: stored.storageMode ?? "blob",
    ...uploadFieldsFromStored(stored),
  };
}

/** Put one plain object; transaction opened only after value is ready. */
async function putStoredRecord(value: StoredMediaRecord): Promise<void> {
  const db = await openDb();
  let tx: IDBTransaction | null = null;
  try {
    tx = db.transaction(STORE_NAME, "readwrite");
    const request = tx.objectStore(STORE_NAME).put(value);
    await Promise.all([requestToPromise(request), transactionDone(tx)]);
  } catch (error) {
    const detail = errorDetail(error, tx);
    const enriched = new Error(
      `${normalizeError(error).message} | tx=${String(detail.transactionErrorName)}:${String(detail.transactionErrorMessage)} | key=${value.id} | mode=${value.storageMode}`
    );
    enriched.name = normalizeError(error).name || "UnknownError";
    throw enriched;
  } finally {
    db.close();
  }
}

/**
 * Persist media: detached Blob first, ArrayBuffer fallback (Safari UnknownError workaround).
 */
export async function saveMedia(
  record: MediaRecord,
  ctx?: MediaDiagContext
): Promise<MediaRecord> {
  await ensureMediaDbReady(ctx);
  if (ctx) {
    await logStorageEstimate(ctx);
  }

  // --- All async conversion BEFORE any write transaction ---
  let detached: { buffer: ArrayBuffer; safeBlob: Blob; mimeType: string };
  try {
    if (ctx) {
      mediaDiagLog(ctx, "idb-clone-blob", {
        inType: record.blob.type || "(empty)",
        inSize: record.blob.size,
        mimeType: record.mimeType,
        fileCtor: record.blob.constructor?.name ?? "(unknown)",
        isFile: typeof File !== "undefined" && record.blob instanceof File,
      });
    }
    detached = await detachBytes(record.blob, record.mimeType);
    if (ctx) {
      mediaDiagLog(ctx, "idb-clone-blob", {
        outType: detached.safeBlob.type || "(empty)",
        outSize: detached.safeBlob.size,
        bufferByteLength: detached.buffer.byteLength,
      });
    }
  } catch (error) {
    if (ctx) {
      mediaDiagError(ctx, "idb-clone-blob", error);
    }
    throw error instanceof Error
      ? error
      : new Error("Datei konnte nicht für IndexedDB vorbereitet werden.");
  }

  const baseMeta = {
    id: record.id,
    sessionKey: record.sessionKey,
    ownerKey: record.ownerKey,
    kind: record.kind,
    mimeType: detached.mimeType,
    createdAt: record.createdAt,
    uploadStatus: record.uploadStatus ?? ("pending" as MediaUploadStatus),
    uploadError: record.uploadError,
    remotePath: record.remotePath,
    pendingBlobUrl: record.pendingBlobUrl,
    pendingRemoteFilename: record.pendingRemoteFilename,
    ownerLabel: record.ownerLabel,
    ownerSequence: record.ownerSequence,
    friendlyFilename: record.friendlyFilename,
  };

  // Attempt 1: detached Blob + plain metadata only
  const blobRecord: StoredMediaRecord = {
    ...baseMeta,
    storageMode: "blob",
    blob: detached.safeBlob,
  };

  if (ctx) {
    mediaDiagLog(ctx, "idb-put-start", {
      attempt: 1,
      mode: "blob",
      key: blobRecord.id,
      mimeType: blobRecord.mimeType,
      blobSize: detached.safeBlob.size,
      blobType: detached.safeBlob.type || "(empty)",
      dbName: DB_NAME,
      dbVersion: DB_VERSION,
      storeName: STORE_NAME,
    });
  }

  try {
    await putStoredRecord(blobRecord);
    if (ctx) {
      mediaDiagLog(ctx, "idb-put-done", { attempt: 1, mode: "blob", key: record.id });
      await logStorageEstimate(ctx);
    }
    return {
      ...record,
      mimeType: detached.mimeType,
      blob: detached.safeBlob,
      storageMode: "blob",
      uploadStatus: baseMeta.uploadStatus,
      uploadError: baseMeta.uploadError,
      remotePath: baseMeta.remotePath,
    };
  } catch (blobError) {
    if (ctx) {
      mediaDiagLog(ctx, "idb-put-start", {
        attempt: 1,
        mode: "blob",
        failed: true,
        ...errorDetail(blobError),
        key: record.id,
        fileSize: record.blob.size,
        fileType: record.blob.type || "(empty)",
        blobSize: detached.safeBlob.size,
        blobType: detached.safeBlob.type || "(empty)",
      });
      console.warn(
        `[media-diag ${ctx.diagnosisId}] Blob put failed, trying ArrayBuffer fallback`,
        blobError
      );
    }
  }

  // Attempt 2: ArrayBuffer payload (avoids WebKit "preparing Blob/File data" UnknownError)
  const bufferRecord: StoredMediaRecord = {
    ...baseMeta,
    storageMode: "arraybuffer",
    data: detached.buffer,
  };

  if (ctx) {
    mediaDiagLog(ctx, "idb-put-start", {
      attempt: 2,
      mode: "arraybuffer",
      key: bufferRecord.id,
      mimeType: bufferRecord.mimeType,
      byteLength: detached.buffer.byteLength,
      dbName: DB_NAME,
      dbVersion: DB_VERSION,
      storeName: STORE_NAME,
    });
  }

  try {
    await putStoredRecord(bufferRecord);
    if (ctx) {
      mediaDiagLog(ctx, "idb-put-done", {
        attempt: 2,
        mode: "arraybuffer",
        key: record.id,
        note: "ArrayBuffer fallback succeeded",
      });
      await logStorageEstimate(ctx);
    }
    return {
      ...record,
      mimeType: detached.mimeType,
      blob: new Blob([detached.buffer], { type: detached.mimeType }),
      storageMode: "arraybuffer",
      uploadStatus: baseMeta.uploadStatus,
      uploadError: baseMeta.uploadError,
      remotePath: baseMeta.remotePath,
    };
  } catch (bufferError) {
    if (ctx) {
      mediaDiagError(ctx, "idb-put-start", bufferError);
      mediaDiagLog(ctx, "idb-put-start", {
        attempt: 2,
        mode: "arraybuffer",
        failed: true,
        ...errorDetail(bufferError),
        key: record.id,
      });
      await logStorageEstimate(ctx);
    }
    const name =
      bufferError && typeof bufferError === "object" && "name" in bufferError
        ? String((bufferError as { name: string }).name)
        : "";
    if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
      const quotaError = new Error(
        "QuotaExceededError: IndexedDB-Speicherlimit erreicht."
      );
      quotaError.name = "QuotaExceededError";
      throw quotaError;
    }
    throw bufferError instanceof Error
      ? bufferError
      : new Error("IndexedDB-Schreiben fehlgeschlagen (Blob und ArrayBuffer).");
  }
}

export async function getMediaById(id: string): Promise<MediaRecord | null> {
  await ensureMediaDbReady();
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(id);
    const [row] = await Promise.all([
      requestToPromise(request as IDBRequest<StoredMediaRecord | undefined>),
      transactionDone(tx),
    ]);
    if (!row || String(row.id).startsWith(SELFTEST_ID_PREFIX)) {
      return null;
    }
    return storedToMediaRecord(row);
  } finally {
    db.close();
  }
}

/**
 * Fresh read + detach bytes into a new Blob safe for fetch()/IDB writes.
 * Never reuses a live IDB Blob handle across closed transactions.
 */
export async function loadMediaForUpload(id: string): Promise<MediaRecord | null> {
  const record = await getMediaById(id);
  if (!record) {
    return null;
  }
  const detached = await detachBytes(record.blob, record.mimeType);
  return {
    ...record,
    mimeType: detached.mimeType,
    blob: detached.safeBlob,
  };
}

async function payloadFromStored(
  existing: StoredMediaRecord
): Promise<{ buffer: ArrayBuffer; safeBlob: Blob; mimeType: string }> {
  const mimeType = existing.mimeType || "application/octet-stream";
  if (existing.storageMode === "arraybuffer" && existing.data) {
    const buffer = existing.data.slice(0);
    return {
      buffer,
      safeBlob: new Blob([buffer.slice(0)], { type: mimeType }),
      mimeType,
    };
  }
  const blob = existing.blob;
  if (!blob) {
    throw new Error(`Media-Eintrag ${existing.id} hat keine nutzbaren Daten.`);
  }
  // Detach before any write — WebKit fails when re-putting a Blob just read from IDB.
  return detachBytes(blob, mimeType);
}

/**
 * Update upload metadata. Re-writes media bytes only after detaching them
 * (Blob put, then ArrayBuffer fallback) so Safari does not hit
 * "Error preparing Blob/File data to be stored".
 */
export async function updateMediaUploadState(
  id: string,
  state: {
    uploadStatus: MediaUploadStatus;
    uploadError?: string;
    remotePath?: string;
    /**
     * Omit to leave the existing value untouched (e.g. while still
     * "uploading" or on failure — keeps a prior successful Blob upload
     * retryable without a fresh Blob PUT). Pass "" to explicitly clear it
     * (e.g. once the whole transfer finally succeeded).
     */
    pendingBlobUrl?: string;
    pendingRemoteFilename?: string;
  }
): Promise<MediaRecord | null> {
  await ensureMediaDbReady();

  const db = await openDb();
  let existing: StoredMediaRecord | undefined;
  try {
    const readTx = db.transaction(STORE_NAME, "readonly");
    const request = readTx.objectStore(STORE_NAME).get(id);
    const [row] = await Promise.all([
      requestToPromise(request as IDBRequest<StoredMediaRecord | undefined>),
      transactionDone(readTx),
    ]);
    existing = row;
  } finally {
    db.close();
  }

  if (!existing) {
    return null;
  }

  // Finish all async conversion before opening a write transaction.
  const detached = await payloadFromStored(existing);
  const baseMeta = {
    id: existing.id,
    sessionKey: existing.sessionKey,
    ownerKey: existing.ownerKey,
    kind: existing.kind,
    mimeType: detached.mimeType,
    createdAt: existing.createdAt,
    uploadStatus: state.uploadStatus,
    uploadError: state.uploadError ?? "",
    remotePath: state.remotePath ?? existing.remotePath,
    pendingBlobUrl: state.pendingBlobUrl !== undefined ? state.pendingBlobUrl : existing.pendingBlobUrl,
    pendingRemoteFilename:
      state.pendingRemoteFilename !== undefined
        ? state.pendingRemoteFilename
        : existing.pendingRemoteFilename,
    // Diese Funktion ändert nie die Bereichszuordnung/Benennung — unverändert übernehmen.
    ownerLabel: existing.ownerLabel,
    ownerSequence: existing.ownerSequence,
    friendlyFilename: existing.friendlyFilename,
  };

  const blobRecord: StoredMediaRecord = {
    ...baseMeta,
    storageMode: "blob",
    blob: detached.safeBlob,
  };

  try {
    await putStoredRecord(blobRecord);
    return storedToMediaRecord(blobRecord);
  } catch (blobError) {
    console.warn(
      `[media-store] upload-state Blob put failed for ${id}, trying ArrayBuffer`,
      blobError
    );
  }

  const bufferRecord: StoredMediaRecord = {
    ...baseMeta,
    storageMode: "arraybuffer",
    data: detached.buffer,
  };
  await putStoredRecord(bufferRecord);
  return storedToMediaRecord(bufferRecord);
}

export async function getMediaForOwner(sessionKey: string, ownerKey: string): Promise<MediaRecord[]> {
  await ensureMediaDbReady();
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const index = tx.objectStore(STORE_NAME).index("bySessionOwner");
    const request = index.getAll(IDBKeyRange.only([sessionKey, ownerKey]));
    const [rows] = await Promise.all([
      requestToPromise(request as IDBRequest<StoredMediaRecord[]>),
      transactionDone(tx),
    ]);
    return rows
      .filter((row) => !String(row.id).startsWith(SELFTEST_ID_PREFIX))
      .map((row) => storedToMediaRecord(row))
      .sort((a, b) => a.createdAt - b.createdAt);
  } finally {
    db.close();
  }
}

export async function getMediaForSession(sessionKey: string): Promise<MediaRecord[]> {
  await ensureMediaDbReady();
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const index = tx.objectStore(STORE_NAME).index("bySession");
    const request = index.getAll(sessionKey);
    const [rows] = await Promise.all([
      requestToPromise(request as IDBRequest<StoredMediaRecord[]>),
      transactionDone(tx),
    ]);
    return rows
      .filter((row) => !String(row.id).startsWith(SELFTEST_ID_PREFIX))
      .map((row) => storedToMediaRecord(row))
      .sort((a, b) => a.createdAt - b.createdAt);
  } finally {
    db.close();
  }
}

export async function deleteMedia(id: string): Promise<void> {
  await ensureMediaDbReady();
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const request = tx.objectStore(STORE_NAME).delete(id);
    await Promise.all([requestToPromise(request), transactionDone(tx)]);
  } finally {
    db.close();
  }
}

export async function deleteMediaForOwner(sessionKey: string, ownerKey: string): Promise<void> {
  await ensureMediaDbReady();
  const db = await openDb();
  try {
    const readTx = db.transaction(STORE_NAME, "readonly");
    const index = readTx.objectStore(STORE_NAME).index("bySessionOwner");
    const readReq = index.getAll(IDBKeyRange.only([sessionKey, ownerKey]));
    const [rows] = await Promise.all([
      requestToPromise(readReq as IDBRequest<StoredMediaRecord[]>),
      transactionDone(readTx),
    ]);

    if (rows.length === 0) {
      return;
    }

    const writeTx = db.transaction(STORE_NAME, "readwrite");
    const store = writeTx.objectStore(STORE_NAME);
    for (const row of rows) {
      store.delete(row.id);
    }
    await transactionDone(writeTx);
  } finally {
    db.close();
  }
}

export async function deleteMediaForSession(sessionKey: string): Promise<void> {
  await ensureMediaDbReady();
  const db = await openDb();
  try {
    const readTx = db.transaction(STORE_NAME, "readonly");
    const index = readTx.objectStore(STORE_NAME).index("bySession");
    const readReq = index.getAll(sessionKey);
    const [rows] = await Promise.all([
      requestToPromise(readReq as IDBRequest<StoredMediaRecord[]>),
      transactionDone(readTx),
    ]);

    if (rows.length === 0) {
      return;
    }

    const writeTx = db.transaction(STORE_NAME, "readwrite");
    const store = writeTx.objectStore(STORE_NAME);
    for (const row of rows) {
      store.delete(row.id);
    }
    await transactionDone(writeTx);
  } finally {
    db.close();
  }
}

/**
 * Startup self-test: write + delete a tiny Blob, fall back to ArrayBuffer.
 * Runs once per page load; failures are logged, not thrown to the UI.
 */
export async function runMediaDbSelfTest(): Promise<void> {
  if (selfTestPromise) {
    return selfTestPromise;
  }
  selfTestPromise = (async () => {
    const testId = `${SELFTEST_ID_PREFIX}${Date.now()}`;
    console.info(`[media-selftest] start db=${DB_NAME} v${DB_VERSION} store=${STORE_NAME}`);
    try {
      await ensureMediaDbReady();
      const bytes = new Uint8Array([0x4b, 0x49, 0x54, 0x48, 0x41, 0x4e]); // "KITHAN"
      const buffer = bytes.buffer.slice(0);
      const safeBlob = new Blob([buffer], { type: "application/octet-stream" });

      let mode: "blob" | "arraybuffer" = "blob";
      try {
        await putStoredRecord({
          id: testId,
          sessionKey: "__selftest__",
          ownerKey: "__selftest__",
          kind: "photo",
          mimeType: "application/octet-stream",
          createdAt: Date.now(),
          storageMode: "blob",
          blob: safeBlob,
        });
      } catch (blobError) {
        console.warn("[media-selftest] Blob put failed, trying ArrayBuffer", blobError);
        mode = "arraybuffer";
        await putStoredRecord({
          id: testId,
          sessionKey: "__selftest__",
          ownerKey: "__selftest__",
          kind: "photo",
          mimeType: "application/octet-stream",
          createdAt: Date.now(),
          storageMode: "arraybuffer",
          data: buffer,
        });
      }

      await deleteMedia(testId);
      console.info(`[media-selftest] OK (storageMode=${mode})`);
    } catch (error) {
      console.error("[media-selftest] FAILED", errorDetail(error));
    }
  })();
  return selfTestPromise;
}
