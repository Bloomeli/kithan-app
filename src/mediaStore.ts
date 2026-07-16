/**
 * Local IndexedDB persistence for photo/video blobs (session-scoped).
 * Capture/processing and upload targets live in mediaProcess / mediaUpload / mediaService.
 */

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
    request.onerror = () => reject(request.error ?? new Error("IndexedDB konnte nicht geöffnet werden."));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB-Anfrage fehlgeschlagen."));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB-Transaktion fehlgeschlagen."));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB-Transaktion abgebrochen."));
  });
}

export function createMediaId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `media-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveMedia(record: MediaRecord): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const request = tx.objectStore(STORE_NAME).put(record);
    await Promise.all([requestToPromise(request), transactionDone(tx)]);
  } catch (error) {
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
    throw error instanceof Error ? error : new Error("IndexedDB-Schreiben fehlgeschlagen.");
  } finally {
    db.close();
  }
}

export async function getMediaForOwner(sessionKey: string, ownerKey: string): Promise<MediaRecord[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const index = tx.objectStore(STORE_NAME).index("bySessionOwner");
    const rows = await requestToPromise(index.getAll(IDBKeyRange.only([sessionKey, ownerKey])));
    await transactionDone(tx);
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  } finally {
    db.close();
  }
}

export async function deleteMedia(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

export async function deleteMediaForOwner(sessionKey: string, ownerKey: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("bySessionOwner");
    const rows = await requestToPromise(index.getAll(IDBKeyRange.only([sessionKey, ownerKey])));
    for (const row of rows) {
      store.delete(row.id);
    }
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

export async function deleteMediaForSession(sessionKey: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("bySession");
    const rows = await requestToPromise(index.getAll(sessionKey));
    for (const row of rows) {
      store.delete(row.id);
    }
    await transactionDone(tx);
  } finally {
    db.close();
  }
}
