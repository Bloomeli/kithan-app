/**
 * Firmenserver-Übertragung: Fotos, Videos und Protokoll-PDF.
 * Unabhängig vom Mieter-E-Mail-Versand (Resend).
 * Bei Fehlern bleiben lokale Daten erhalten.
 */

import { getMediaForSession } from "./mediaStore";
import { MEDIA_CONFIG } from "./mediaConfig";
import { uploadMediaRecord } from "./mediaService";
import { uploadViaBlobAndFtps } from "./blobFtpsUpload";

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
  return MEDIA_CONFIG.uploadTarget.kind !== "local-only";
}

async function uploadPdfToServer(filename: string, pdfBase64: string): Promise<boolean> {
  if (!pdfBase64) {
    return false;
  }

  const binary = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
  const blob = new Blob([binary], { type: "application/pdf" });

  const result = await uploadViaBlobAndFtps({
    kind: "pdf",
    ownerKey: "protokoll",
    mediaId: `pdf-${Date.now()}`,
    mimeType: "application/pdf",
    blob,
    filename: filename.replace(/[^\w.\-äöüÄÖÜß ()]+/g, "_").slice(0, 150),
  });

  if (!result.ok) {
    throw new Error(result.error || "PDF-Übertragung fehlgeschlagen.");
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

  const archiveStartedAt = Date.now();
  const elapsedSec = (): number => Math.round((Date.now() - archiveStartedAt) / 1000);

  const records = await getMediaForSession(input.sessionKey);
  const photos = records.filter((r) => r.kind === "photo");
  const videos = records.filter((r) => r.kind === "video");
  console.log(
    `[protocol-archive] start: ${photos.length} Foto(s), ${videos.length} Video(s) zu prüfen, danach PDF.`
  );

  // Fotos/Videos wurden bereits direkt nach der Aufnahme einzeln hochgeladen
  // (siehe cardMedia.ts). Ein bereits erfolgreich übertragenes Medium hier
  // erneut hochzuladen wäre unnötig (doppelte Bandbreite/Zeit) und könnte
  // einen zweiten, unabhängigen Fehlschlag erzeugen, obwohl das Foto/Video
  // beim Nutzer längst als "erfolgreich gesendet" angezeigt wurde — genau das
  // führte zu dem widersprüchlichen "Medien erfolgreich" + "Server nicht
  // erreichbar"-Bild. Nur tatsächlich noch offene/fehlgeschlagene Medien
  // werden hier (erneut) versucht.
  for (const record of photos) {
    if (record.uploadStatus === "uploaded") {
      result.photoUploaded += 1;
      continue;
    }
    try {
      await uploadMediaRecord(record.id);
      result.photoUploaded += 1;
    } catch (error) {
      result.photoFailed += 1;
      console.error("[protocol-archive] photo upload failed", {
        mediaId: record.id,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
        rawError: error,
      });
    }
  }

  for (const record of videos) {
    if (record.uploadStatus === "uploaded") {
      result.videoUploaded += 1;
      continue;
    }
    try {
      await uploadMediaRecord(record.id);
      result.videoUploaded += 1;
    } catch (error) {
      result.videoFailed += 1;
      console.error("[protocol-archive] video upload failed", {
        mediaId: record.id,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
        rawError: error,
      });
    }
  }

  // Diagnose-Hinweis: Läuft dieser Log-Eintrag erst nach mehreren Minuten
  // (siehe elapsedSinceStart), ist die wahrscheinlichste Ursache eines
  // anschließenden PDF-Fehlschlags ein zwischenzeitlich gesperrter Bildschirm
  // / in den Hintergrund gewechselter Tab (iOS unterbricht dann die
  // Netzwerkverbindung) — NICHT ein Problem mit dem PDF selbst. Ein
  // Screen-Wake-Lock während dieser Phase (siehe finishProtocolAsPdf in
  // app.ts) soll genau das verhindern.
  console.log(
    `[protocol-archive] Fotos/Videos fertig nach ${elapsedSec()}s (Fotos: ${result.photoUploaded} ok / ${result.photoFailed} fehlgeschlagen, Videos: ${result.videoUploaded} ok / ${result.videoFailed} fehlgeschlagen) — starte PDF-Upload …`
  );
  const pdfStartedAt = Date.now();
  try {
    result.pdfUploaded = await uploadPdfToServer(input.pdfFilename, input.pdfBase64);
    console.log(
      `[protocol-archive] PDF-Upload erfolgreich nach ${Math.round((Date.now() - pdfStartedAt) / 1000)}s (Gesamtdauer seit Start: ${elapsedSec()}s).`
    );
  } catch (error) {
    result.pdfUploaded = false;
    console.error("[protocol-archive] PDF (Protokoll) upload failed — this is a SEPARATE request/endpoint from the photo/video uploads above", {
      elapsedSinceArchiveStartSec: elapsedSec(),
      elapsedSincePdfStartSec: Math.round((Date.now() - pdfStartedAt) / 1000),
      documentVisibility: typeof document !== "undefined" ? document.visibilityState : "n/a",
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      rawError: error,
    });
  }

  result.ok =
    result.pdfUploaded &&
    result.photoFailed === 0 &&
    result.videoFailed === 0;

  return result;
}
