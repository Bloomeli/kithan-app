/**
 * Direkter Client-Upload zu Vercel Blob + serverseitige FTPS-Übertragung.
 *
 * Ablauf (für Foto, Video UND PDF gleichermaßen):
 * 1. Browser lädt die Datei direkt zu Vercel Blob hoch (umgeht das 4,5-MB-Limit
 *    von Vercel Serverless Functions — die Datei läuft dabei nicht durch unsere
 *    eigene API-Route).
 * 2. Anschließend ruft der Browser /api/ftps-transfer auf. Diese Funktion holt
 *    die Datei von Vercel Blob ab und lädt sie per FTPS auf den Firmenserver hoch.
 * 3. Bei Erfolg löscht /api/ftps-transfer die Datei wieder von Vercel Blob
 *    (dient nur als kurzer Zwischenstopp, kein Dauerspeicher).
 * 4. Schlägt die FTPS-Übertragung fehl, bleibt die Datei vorerst bei Vercel Blob
 *    liegen, damit ein späterer manueller Retry (Button „Erneut hochladen“)
 *    nichts verliert.
 */

import { upload } from "@vercel/blob/client";

export type BlobFtpsMediaKind = "photo" | "video" | "pdf";

export interface BlobFtpsUploadInput {
  kind: BlobFtpsMediaKind;
  ownerKey: string;
  mediaId: string;
  mimeType: string;
  blob: Blob;
  /** Explicit remote filename (used for the PDF, which already has a final name). */
  filename?: string;
}

export interface BlobFtpsUploadResult {
  ok: boolean;
  error?: string;
  remotePath?: string;
}

const BLOB_UPLOAD_TOKEN_ENDPOINT = "/api/blob-upload-token";
const FTPS_TRANSFER_ENDPOINT = "/api/ftps-transfer";

// Neither the direct browser→Vercel-Blob upload nor fetch() have a built-in
// timeout. Without one, a stalled mobile connection (e.g. the network drops
// or the tab is briefly suspended right after the camera hands control back)
// leaves the upload promise hanging forever — no success, no error, no retry
// button. These bounds guarantee the flow eventually fails visibly instead.
const BLOB_UPLOAD_TIMEOUT_MS = 5 * 60 * 1000; // generous for large videos on slow networks
const FTPS_TRANSFER_TIMEOUT_MS = 70 * 1000; // just above the function's own 60s maxDuration

function timeoutSignal(ms: number, message: string): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort(new Error(message));
    } catch {
      controller.abort();
    }
  }, ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function describeAbortError(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    // A DOMException "AbortError" without our custom reason (older engines
    // that ignore AbortController.abort(reason)) still needs a clear message.
    return error.name === "AbortError" && error.message !== fallback ? fallback : error.message;
  }
  return fallback;
}

function extensionFor(mimeType: string, kind: BlobFtpsMediaKind): string {
  const mime = mimeType.toLowerCase();
  if (mime.includes("pdf")) return ".pdf";
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("heic") || mime.includes("heif")) return ".heic";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("quicktime") || mime.includes("mov")) return ".mov";
  if (mime.includes("webm")) return ".webm";
  if (kind === "pdf") return ".pdf";
  return kind === "video" ? ".mp4" : ".jpg";
}

function buildRemoteFilename(input: BlobFtpsUploadInput, ext: string): string {
  if (input.filename?.trim()) {
    return input.filename.trim();
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${input.kind}-${input.ownerKey}-${input.mediaId}-${stamp}${ext}`;
}

/**
 * Uploads a single file (photo, video, or PDF) via Vercel Blob and triggers
 * the server-side FTPS transfer to the company server. Used by both the
 * media adapter (Foto/Video) and the protocol archive upload (PDF).
 */
export async function uploadViaBlobAndFtps(input: BlobFtpsUploadInput): Promise<BlobFtpsUploadResult> {
  const ext = extensionFor(input.mimeType, input.kind);
  const remoteFilename = buildRemoteFilename(input, ext);
  const blobPathname = `${input.kind}/${input.ownerKey}-${input.mediaId}${ext}`;

  console.log(`[blob-ftps-upload] step 1/2: blob upload start (${input.kind}, ${blobPathname})`);

  let blobResult;
  const blobTimeout = timeoutSignal(
    BLOB_UPLOAD_TIMEOUT_MS,
    "Blob-Upload abgebrochen (Zeitüberschreitung — Netzwerkverbindung unterbrochen?)."
  );
  try {
    blobResult = await upload(blobPathname, input.blob, {
      access: "public",
      handleUploadUrl: BLOB_UPLOAD_TOKEN_ENDPOINT,
      contentType: input.mimeType || undefined,
      abortSignal: blobTimeout.signal,
    });
  } catch (error) {
    console.error("[blob-ftps-upload] step 1/2: blob upload FAILED", {
      kind: input.kind,
      blobPathname,
      mimeType: input.mimeType,
      blobSize: input.blob.size,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      rawError: error,
    });
    return {
      ok: false,
      error: describeAbortError(error, "Blob-Upload fehlgeschlagen (Zeitüberschreitung)."),
    };
  } finally {
    blobTimeout.clear();
  }

  console.log(`[blob-ftps-upload] step 1/2: blob upload done → ${blobResult.url}`);
  console.log("[blob-ftps-upload] step 2/2: calling /api/ftps-transfer …");

  const ftpsTimeout = timeoutSignal(
    FTPS_TRANSFER_TIMEOUT_MS,
    "FTPS-Übertragung abgebrochen (Zeitüberschreitung — Server antwortet nicht)."
  );
  try {
    const response = await fetch(FTPS_TRANSFER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blobUrl: blobResult.url,
        filename: remoteFilename,
        kind: input.kind,
      }),
      signal: ftpsTimeout.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      remotePath?: string;
    };

    if (!response.ok || payload.ok === false) {
      console.error("[blob-ftps-upload] step 2/2: ftps-transfer FAILED", {
        kind: input.kind,
        httpStatus: response.status,
        httpStatusText: response.statusText,
        blobUrl: blobResult.url,
        responsePayload: payload,
      });
      return {
        ok: false,
        error: payload.error?.trim() || `FTPS-Übertragung fehlgeschlagen (HTTP ${response.status}).`,
      };
    }

    console.log(`[blob-ftps-upload] step 2/2: ftps-transfer done → ${payload.remotePath}`);
    return { ok: true, remotePath: payload.remotePath };
  } catch (error) {
    console.error("[blob-ftps-upload] step 2/2: ftps-transfer call threw (network error, timeout, or CORS)", {
      kind: input.kind,
      blobUrl: blobResult.url,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      rawError: error,
    });
    return {
      ok: false,
      error: describeAbortError(error, "FTPS-Übertragung fehlgeschlagen (Zeitüberschreitung)."),
    };
  } finally {
    ftpsTimeout.clear();
  }
}
