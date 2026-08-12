/**
 * Lokale Ablage der fertigen Firmen-PDF je Vorgang (IndexedDB).
 * Getrennt von localStorage-Metadaten („Gespeicherte Protokolle“) und von
 * Foto-/Video-Medien — bewusst unabhängig von Vercel Blob / FTPS.
 */

const DB_NAME = "kithan-saved-protocol-pdfs";
const DB_VERSION = 1;
const STORE_NAME = "pdfs";

export interface SavedProtocolPdfPayload {
  vorgangId: string;
  filename: string;
  /** Raw base64 (ohne data:-Prefix). */
  base64: string;
}

interface StoredProtocolPdf {
  vorgangId: string;
  filename: string;
  mimeType: string;
  /** Safari-sicher: Bytes statt Blob-Handle. */
  data: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "vorgangId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB für Protokoll-PDFs konnte nicht geöffnet werden."));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB-Anfrage (Protokoll-PDF) fehlgeschlagen."));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB-Transaktion fehlgeschlagen."));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB-Transaktion abgebrochen."));
  });
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    let part = "";
    for (let j = 0; j < slice.length; j += 1) {
      part += String.fromCharCode(slice[j]);
    }
    binary += part;
  }
  return btoa(binary);
}

/** Speichert/überschreibt die fertige Firmen-PDF für diesen Vorgang. */
export async function saveSavedProtocolPdf(
  vorgangId: string,
  filename: string,
  base64: string
): Promise<void> {
  if (!vorgangId || !base64) {
    throw new Error("Protokoll-PDF kann ohne Vorgangs-ID oder Inhalt nicht gespeichert werden.");
  }
  const record: StoredProtocolPdf = {
    vorgangId,
    filename: filename || `Protokoll_${vorgangId}.pdf`,
    mimeType: "application/pdf",
    data: base64ToArrayBuffer(base64),
  };
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

export async function loadSavedProtocolPdf(vorgangId: string): Promise<SavedProtocolPdfPayload | null> {
  if (!vorgangId) {
    return null;
  }
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(vorgangId);
    const [row] = await Promise.all([
      requestToPromise(request as IDBRequest<StoredProtocolPdf | undefined>),
      transactionDone(tx),
    ]);
    if (!row?.data) {
      return null;
    }
    return {
      vorgangId: row.vorgangId,
      filename: row.filename || `Protokoll_${vorgangId}.pdf`,
      base64: arrayBufferToBase64(row.data),
    };
  } finally {
    db.close();
  }
}

export async function deleteSavedProtocolPdf(vorgangId: string): Promise<void> {
  if (!vorgangId) {
    return;
  }
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(vorgangId);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

/** Öffnet die lokal gespeicherte PDF offline (Blob-URL). */
export async function openSavedProtocolPdfInViewer(vorgangId: string): Promise<boolean> {
  const stored = await loadSavedProtocolPdf(vorgangId);
  if (!stored) {
    return false;
  }
  const binary = Uint8Array.from(atob(stored.base64), (c) => c.charCodeAt(0));
  const blob = new Blob([binary], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    const link = document.createElement("a");
    link.href = url;
    link.download = stored.filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

export type ShareSavedProtocolPdfResult =
  | "shared"
  | "downloaded"
  | "missing"
  | "cancelled"
  | "failed";

/**
 * Gibt die bereits lokal gespeicherte Firmen-PDF unverändert weiter
 * (kein erneutes Erzeugen/Komprimieren/Einbetten). Nutzt auf unterstützten
 * Geräten (iPhone/iPad Safari) das native Share-Sheet.
 */
export async function shareSavedProtocolPdf(vorgangId: string): Promise<ShareSavedProtocolPdfResult> {
  const stored = await loadSavedProtocolPdf(vorgangId);
  if (!stored?.base64) {
    return "missing";
  }

  const binary = Uint8Array.from(atob(stored.base64), (c) => c.charCodeAt(0));
  const file = new File([binary], stored.filename || `Protokoll_${vorgangId}.pdf`, {
    type: "application/pdf",
  });

  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
  };

  const shareData: ShareData = {
    files: [file],
    title: file.name,
  };

  const canShareFiles =
    typeof nav.share === "function" &&
    (typeof nav.canShare !== "function" || nav.canShare(shareData));

  if (canShareFiles) {
    try {
      await nav.share(shareData);
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "cancelled";
      }
      // Fallback: Download der gleichen Bytes.
    }
  }

  try {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return "downloaded";
  } catch {
    return "failed";
  }
}
