/**
 * Local IndexedDB persistence for photo/video blobs (session-scoped).
 * Capture/processing and upload targets live in mediaProcess / mediaUpload / mediaService.
 */

import {
  mediaDiagError,
  mediaDiagLog,
  type MediaDiagContext,
} from "./mediaDiagnostics";

export type MediaKind = "photo" | "video";

export interface MediaRecord {
  id: string;
  sessionKey: string;
  ownerKey: string;
  kind: MediaKind;
  mimeType: string;
  blob: Blob;
  createdAt: number;
}

const DB_NAME = "kithan-media";
const DB_VERSION = 1;
const STORE_NAME = "media";

/** Safari often fails the first IndexedDB open after load; retry before surfacing errors. */
const READY_MAX_ATTEMPTS = 3;
const READY_RETRY_DELAY_MS = 280;

let mediaDbReady = false;
let mediaDbReadyInFlight: Promise<void> | null = null;

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

/** Lightweight open + no-op read to verify IndexedDB is usable. */
async function probeMediaDb(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).count();
    // Wait only for transaction completion (request is part of same tx).
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

/** Copy bytes into a plain Blob before IDB put (Safari structured-clone safe). */
async function cloneBlobForStorage(file: Blob, mimeType: string): Promise<Blob> {
  const buffer = await file.arrayBuffer();
  return new Blob([buffer], { type: mimeType || file.type || "application/octet-stream" });
}

/**
 * Persist a media record. Blob is cloned to plain ArrayBuffer-backed Blob
 * BEFORE opening the IDB transaction (Safari-safe; no await mid-transaction).
 */
export async function saveMedia(
  record: MediaRecord,
  ctx?: MediaDiagContext
): Promise<void> {
  await ensureMediaDbReady(ctx);

  let blobToStore: Blob;
  try {
    if (ctx) {
      mediaDiagLog(ctx, "idb-clone-blob", {
        inType: record.blob.type || "(empty)",
        inSize: record.blob.size,
        mimeType: record.mimeType,
      });
    }
    blobToStore = await cloneBlobForStorage(record.blob, record.mimeType);
    if (ctx) {
      mediaDiagLog(ctx, "idb-clone-blob", {
        outType: blobToStore.type || "(empty)",
        outSize: blobToStore.size,
      });
    }
  } catch (error) {
    if (ctx) {
      mediaDiagError(ctx, "idb-clone-blob", error);
    }
    // Last resort: try storing the original blob reference.
    blobToStore = record.blob;
  }

  const storable: MediaRecord = {
    id: record.id,
    sessionKey: record.sessionKey,
    ownerKey: record.ownerKey,
    kind: record.kind,
    mimeType: record.mimeType || blobToStore.type || "application/octet-stream",
    blob: blobToStore,
    createdAt: record.createdAt,
  };

  const db = await openDb();
  try {
    if (ctx) {
      mediaDiagLog(ctx, "idb-put-start", {
        id: storable.id,
        mimeType: storable.mimeType,
        blobSize: storable.blob.size,
        blobType: storable.blob.type || "(empty)",
      });
    }

    // Open transaction, issue put, then await completion — no other awaits in between.
    const tx = db.transaction(STORE_NAME, "readwrite");
    const request = tx.objectStore(STORE_NAME).put(storable);
    await Promise.all([requestToPromise(request), transactionDone(tx)]);

    if (ctx) {
      mediaDiagLog(ctx, "idb-put-done", { id: storable.id });
    }
  } catch (error) {
    if (ctx) {
      mediaDiagError(ctx, "idb-put-start", error);
    }
    const name =
      error && typeof error === "object" && "name" in error
        ? String((error as { name: string }).name)
        : "";
    if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
      const quotaError = new Error(
        "QuotaExceededError: IndexedDB-Speicherlimit erreicht."
      );
      quotaError.name = "QuotaExceededError";
      throw quotaError;
    }
    if (name === "DataCloneError") {
      const cloneError = new Error(
        "DataCloneError: Blob/File konnte nicht in IndexedDB geklont werden."
      );
      cloneError.name = "DataCloneError";
      throw cloneError;
    }
    throw error instanceof Error ? error : new Error("IndexedDB-Schreiben fehlgeschlagen.");
  } finally {
    db.close();
  }
}

export async function getMediaForOwner(sessionKey: string, ownerKey: string): Promise<MediaRecord[]> {
  await ensureMediaDbReady();
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const index = tx.objectStore(STORE_NAME).index("bySessionOwner");
    const request = index.getAll(IDBKeyRange.only([sessionKey, ownerKey]));
    const [rows] = await Promise.all([requestToPromise(request), transactionDone(tx)]);
    return rows.sort((a, b) => a.createdAt - b.createdAt);
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
    // Read IDs in one transaction, delete in a second — never await between ops in same tx.
    const readTx = db.transaction(STORE_NAME, "readonly");
    const index = readTx.objectStore(STORE_NAME).index("bySessionOwner");
    const readReq = index.getAll(IDBKeyRange.only([sessionKey, ownerKey]));
    const [rows] = await Promise.all([requestToPromise(readReq), transactionDone(readTx)]);

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
    const [rows] = await Promise.all([requestToPromise(readReq), transactionDone(readTx)]);

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
