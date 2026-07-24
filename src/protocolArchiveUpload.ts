/**
 * Firmenserver-Übertragung: Fotos, Videos und Protokoll-PDF.
 * Unabhängig vom Mieter-E-Mail-Versand (Resend).
 * Bei Fehlern bleiben lokale Daten erhalten.
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
  photoUploaded: number;
  photoFailed: number;
  videoUploaded: number;
  videoFailed: number;
  pdfUploaded: boolean;
}

function remoteConfigured(): boolean {
  return MEDIA_CONFIG.uploadTarget.kind !== "local-only" && Boolean(MEDIA_CONFIG.uploadTarget.endpoint);
}

async function uploadPdfToServer(filename: string, pdfBase64: string): Promise<boolean> {
  const endpoint = MEDIA_CONFIG.uploadTarget.endpoint?.trim();
  if (!endpoint || !pdfBase64) {
    return false;
  }

  const binary = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf",
      "X-Kithan-Media-Id": `pdf-${Date.now()}`,
      "X-Kithan-Kind": "pdf",
      "X-Kithan-Owner": "protokoll",
      "X-Kithan-Filename": filename.replace(/[^\w.\-äöüÄÖÜß]+/g, "_").slice(0, 120),
    },
    body: binary,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error?.trim() || `PDF-Übertragung fehlgeschlagen (HTTP ${response.status}).`);
  }
  return true;
}

/**
 * Reihenfolge: Fotos → Videos → PDF.
 * ok = alles Erforderliche auf dem Firmenserver (PDF Pflicht; Fotos/Videos sofern vorhanden).
 */
export async function uploadProtocolArchive(
  input: ProtocolArchiveUploadInput
): Promise<ProtocolArchiveUploadResult> {
  const result: ProtocolArchiveUploadResult = {
    ok: false,
    photoUploaded: 0,
    photoFailed: 0,
    videoUploaded: 0,
    videoFailed: 0,
    pdfUploaded: false,
  };

  if (!remoteConfigured()) {
    return result;
  }

  const records = await getMediaForSession(input.sessionKey);
  const photos = records.filter((r) => r.kind === "photo");
  const videos = records.filter((r) => r.kind === "video");

  for (const record of photos) {
    try {
      await uploadMediaRecord(record.id);
      result.photoUploaded += 1;
    } catch (error) {
      result.photoFailed += 1;
      console.warn("[protocol-archive] photo failed", record.id, error);
    }
  }

  for (const record of videos) {
    try {
      await uploadMediaRecord(record.id);
      result.videoUploaded += 1;
    } catch (error) {
      result.videoFailed += 1;
      console.warn("[protocol-archive] video failed", record.id, error);
    }
  }

  try {
    result.pdfUploaded = await uploadPdfToServer(input.pdfFilename, input.pdfBase64);
  } catch (error) {
    result.pdfUploaded = false;
    console.warn("[protocol-archive] pdf failed", error);
  }

  result.ok =
    result.pdfUploaded &&
    result.photoFailed === 0 &&
    result.videoFailed === 0;

  return result;
}
