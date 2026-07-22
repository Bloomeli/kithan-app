/**
 * Company server archive upload (PDF + session media).
 * Independent of Resend / Mieter-PDF email.
 *
 * FTPS batch for the PDF is not wired yet — media uses the existing
 * NAS/WebDAV upload adapter when configured. Failures never delete local data.
 */

import { getMediaForSession } from "./mediaStore";
import { MEDIA_CONFIG } from "./mediaConfig";
import { uploadMediaRecord } from "./mediaService";

export interface ProtocolArchiveUploadInput {
  sessionKey: string;
  pdfFilename: string;
  pdfBase64: string;
}

export interface ProtocolArchiveUploadResult {
  ok: boolean;
  /** Short status for the completion UI. */
  message: string;
  mediaUploaded: number;
  mediaFailed: number;
  mediaTotal: number;
  pdfUploaded: boolean;
}

/**
 * Attempt to push protocol assets to the company server.
 * Local IndexedDB / drafts are never cleared here.
 */
export async function uploadProtocolArchive(
  input: ProtocolArchiveUploadInput
): Promise<ProtocolArchiveUploadResult> {
  void input.pdfBase64;
  void input.pdfFilename;

  const mediaTotalRecords = await getMediaForSession(input.sessionKey);
  const mediaTotal = mediaTotalRecords.length;
  let mediaUploaded = 0;
  let mediaFailed = 0;

  const remoteConfigured = MEDIA_CONFIG.uploadTarget.kind !== "local-only";

  if (remoteConfigured && mediaTotal > 0) {
    for (const record of mediaTotalRecords) {
      try {
        await uploadMediaRecord(record.id);
        mediaUploaded += 1;
      } catch (error) {
        mediaFailed += 1;
        console.warn("[protocol-archive] media upload failed", record.id, error);
      }
    }
  }

  // PDF → FTPS: reserved for the company FTPS integration (not Resend).
  const pdfUploaded = false;

  if (!remoteConfigured) {
    return {
      ok: false,
      message:
        "Server-Upload (FTPS) noch nicht verfügbar — PDF und Medien bleiben lokal gespeichert.",
      mediaUploaded,
      mediaFailed,
      mediaTotal,
      pdfUploaded,
    };
  }

  if (mediaFailed > 0) {
    return {
      ok: false,
      message: `Medien-Upload teilweise fehlgeschlagen (${mediaUploaded}/${mediaTotal} ok). PDF-FTPS folgt später. Lokale Daten bleiben erhalten.`,
      mediaUploaded,
      mediaFailed,
      mediaTotal,
      pdfUploaded,
    };
  }

  if (mediaTotal === 0) {
    return {
      ok: false,
      message:
        "Keine Medien zum Hochladen. PDF-FTPS-Upload folgt später — Protokoll bleibt lokal gespeichert.",
      mediaUploaded,
      mediaFailed,
      mediaTotal,
      pdfUploaded,
    };
  }

  return {
    ok: true,
    message: `Medien auf Server geladen (${mediaUploaded}/${mediaTotal}). PDF-FTPS-Upload folgt später.`,
    mediaUploaded,
    mediaFailed,
    mediaTotal,
    pdfUploaded,
  };
}
