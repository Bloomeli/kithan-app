/**
 * Holt eine zuvor per Vercel Blob hochgeladene Datei (Foto, Video oder PDF)
 * ab und überträgt sie per FTPS auf den Windows-Firmenserver.
 *
 * Bei Erfolg: Datei wird von Vercel Blob gelöscht (nur kurzer Zwischenstopp).
 * Bei Fehler: Datei bleibt bei Vercel Blob liegen, damit ein späterer
 * manueller Retry (Button „Erneut hochladen“) nichts verliert.
 *
 * Zugangsdaten ausschließlich über Vercel-Umgebungsvariablen:
 *   FTPS_HOST, FTPS_PORT, FTPS_USER, FTPS_PASSWORD, FTPS_REMOTE_DIR
 * Nie im Code oder an den Client zurückgeben.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Client } from "basic-ftp";
import { Readable } from "node:stream";
import { del } from "@vercel/blob";

function getBlobReadWriteToken(): string {
  const token = process.env.PUBLIC_BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("Server-Konfiguration unvollstaendig (PUBLIC_BLOB_READ_WRITE_TOKEN fehlt).");
  }
  return token;
}

export const config = {
  maxDuration: 60,
};

const DEFAULT_REMOTE_DIR = "/KithanVermietung";
const DEFAULT_PORT = 21;
const ALLOWED_BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

interface TransferBody {
  blobUrl?: string;
  filename?: string;
  kind?: string;
  /** Optionaler Unterordner-Pfad relativ zum Basisverzeichnis, z.B. "2026/Privat/Übergabe". */
  remoteSubdir?: string;
}

function getEnv(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    throw new Error(`Server-Konfiguration unvollständig (${name}).`);
  }
  return value;
}

function sanitizeFilename(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[^\w.\-äöüÄÖÜß ()]+/g, "_")
    .replace(/_+/g, "_")
    .trim();
  return cleaned.slice(0, 150) || fallback;
}

/**
 * Baut das vollständige Zielverzeichnis aus dem Basisverzeichnis + einem
 * optionalen, vom Client mitgegebenen Unterordner-Pfad (z.B.
 * "2026/Privat/Übergabe" für einen Vorgangs-Ordner). Jedes Pfadsegment wird
 * einzeln bereinigt (gleiche erlaubte Zeichen wie bei Dateinamen, siehe
 * sanitizeFilename) — kein "..", kein Verlassen des Basisverzeichnisses.
 */
function buildRemoteDir(baseDir: string, remoteSubdir: string | undefined): string {
  const base = baseDir.replace(/\/+$/, "");
  if (!remoteSubdir) {
    return base;
  }
  const segments = remoteSubdir
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    .map((segment) => sanitizeFilename(segment, ""))
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return base;
  }
  return `${base}/${segments.join("/")}`;
}

function isAllowedBlobUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.endsWith(ALLOWED_BLOB_HOST_SUFFIX);
  } catch {
    return false;
  }
}

async function uploadOverFtps(
  buffer: Buffer,
  remoteFileName: string,
  remoteSubdir: string | undefined
): Promise<string> {
  const host = getEnv("FTPS_HOST");
  const user = getEnv("FTPS_USER");
  const password = getEnv("FTPS_PASSWORD");
  const port = Number(process.env.FTPS_PORT?.trim() || DEFAULT_PORT);
  const baseRemoteDir = process.env.FTPS_REMOTE_DIR?.trim() || DEFAULT_REMOTE_DIR;
  const remoteDir = buildRemoteDir(baseRemoteDir, remoteSubdir);
  // Many on-prem Windows FTPS servers use a self-signed certificate; only
  // enforce strict verification when explicitly opted in via env var.
  const rejectUnauthorized = process.env.FTPS_REJECT_UNAUTHORIZED === "true";

  const client = new Client(30_000);
  try {
    await client.access({
      host,
      port,
      user,
      password,
      secure: true,
      secureOptions: { rejectUnauthorized },
    });
    await client.ensureDir(remoteDir);
    await client.uploadFrom(Readable.from(buffer), remoteFileName);
    return `${remoteDir.replace(/\/+$/, "")}/${remoteFileName}`;
  } finally {
    client.close();
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as TransferBody;
    const blobUrl = String(body.blobUrl ?? "").trim();
    const kind = String(body.kind ?? "file").trim() || "file";
    const filename = sanitizeFilename(String(body.filename ?? ""), `${kind}-${Date.now()}`);
    const remoteSubdir = typeof body.remoteSubdir === "string" ? body.remoteSubdir : undefined;

    if (!blobUrl || !isAllowedBlobUrl(blobUrl)) {
      res.status(400).json({ ok: false, error: "Ungültige oder fehlende Blob-URL." });
      return;
    }

    console.log(
      `[ftps-transfer] request received: kind=${kind} filename=${filename} remoteSubdir=${remoteSubdir ?? "(keiner)"}`
    );

    let buffer: Buffer;
    try {
      const blobResponse = await fetch(blobUrl);
      if (!blobResponse.ok) {
        throw new Error(`Datei konnte nicht von Vercel Blob geladen werden (HTTP ${blobResponse.status}).`);
      }
      buffer = Buffer.from(await blobResponse.arrayBuffer());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Blob-Datei nicht erreichbar.";
      console.error("[ftps-transfer] blob fetch failed", message);
      res.status(502).json({ ok: false, error: message });
      return;
    }

    let remotePath: string;
    try {
      remotePath = await uploadOverFtps(buffer, filename, remoteSubdir);
    } catch (error) {
      const message = error instanceof Error ? error.message : "FTPS-Übertragung fehlgeschlagen.";
      console.error("[ftps-transfer] FTPS upload failed", message);
      // File stays on Vercel Blob on purpose — manual retry can pick it up later.
      res.status(502).json({ ok: false, error: message });
      return;
    }

    try {
      await del(blobUrl, { token: getBlobReadWriteToken() });
    } catch (error) {
      // FTPS succeeded — cleanup failure is non-critical, just log it.
      console.warn("[ftps-transfer] blob cleanup failed after successful FTPS upload", error);
    }

    console.log(`[ftps-transfer] success: ${remotePath}`);
    res.status(200).json({ ok: true, remotePath });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler bei der FTPS-Übertragung.";
    console.error("[ftps-transfer]", message);
    res.status(500).json({ ok: false, error: message });
  }
}
