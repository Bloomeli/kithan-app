/**
 * Holt eine zuvor per Vercel Blob hochgeladene Datei (Foto, Video oder PDF)
 * ab und überträgt sie per FTPS auf den Windows-Firmenserver.
 *
 * Bei Erfolg: Datei wird NICHT sofort von Vercel Blob gelöscht. Stattdessen
 * wird sie in ein kleines "Bestätigungsregister" eingetragen (eigene JSON-Datei
 * im selben, bereits bestehenden Blob-Store — siehe appendToCleanupRegistry
 * unten). Der tägliche Cron-Job (api/cleanup-expired-blobs.ts) löscht die
 * Datei automatisch erst 5 Kalendertage nach dieser Bestätigung — bis dahin
 * dient sie als temporäre Sicherheitskopie.
 * Bei Fehler: Datei bleibt bei Vercel Blob liegen, damit ein späterer
 * manueller Retry (Button „Erneut hochladen“) nichts verliert. Sie wird in
 * diesem Fall NICHT ins Bestätigungsregister eingetragen, kann also niemals
 * durch die 5-Tage-Regel automatisch gelöscht werden.
 *
 * Zugangsdaten ausschließlich über Vercel-Umgebungsvariablen:
 *   FTPS_HOST, FTPS_PORT, FTPS_USER, FTPS_PASSWORD, FTPS_REMOTE_DIR
 * Nie im Code oder an den Client zurückgeben.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Client } from "basic-ftp";
import { Readable } from "node:stream";
import { head, put, BlobNotFoundError, BlobPreconditionFailedError } from "@vercel/blob";

function getBlobReadWriteToken(): string {
  const token = process.env.PUBLIC_BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("Server-Konfiguration unvollstaendig (PUBLIC_BLOB_READ_WRITE_TOKEN fehlt).");
  }
  return token;
}

/**
 * Bestätigungsregister für die 5-Tage-Cleanup-Regel (siehe
 * api/cleanup-expired-blobs.ts). Eine kleine JSON-Datei pro Kalendertag
 * (UTC) im selben, bereits bestehenden Blob-Store — kein neuer Store, keine
 * neue Verbindung, kein manuell anzulegender Ordner nötig, das Programm legt
 * diese Dateien selbst an. Gleiche Technik wie schon bei
 * api/vorgangsnummer.ts (optimistisches Concurrency-Control per ETag/ifMatch),
 * da mehrere Foto-/Video-/PDF-Bestätigungen am selben Tag gleichzeitig
 * eintreffen können.
 */
const CLEANUP_REGISTRY_PREFIX = "blob-cleanup/pending-";
const CLEANUP_REGISTRY_MAX_ATTEMPTS = 6;

interface CleanupRegistryEntry {
  blobUrl: string;
  kind: string;
  filename: string;
  /** Epoch-Millisekunden — exakter Bestätigungszeitpunkt (FTPS-Erfolg). */
  confirmedAt: number;
}

interface CleanupRegistryFile {
  /** Kalendertag (UTC, YYYY-MM-DD) — nur informativ, dient der Dateibenennung. */
  date: string;
  entries: CleanupRegistryEntry[];
}

function cleanupRegistryPathnameForToday(): string {
  const dateStr = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
  return `${CLEANUP_REGISTRY_PREFIX}${dateStr}.json`;
}

/**
 * Trägt eine erfolgreich übertragene Datei ins Bestätigungsregister ein,
 * damit der tägliche Cleanup-Cron sie frühestens 5 Kalendertage später aus
 * Vercel Blob löschen darf. Schlägt diese Registrierung nach mehreren
 * Versuchen fehl, bleibt die Datei einfach unbegrenzt in Blob liegen (sicherer
 * Fehlerfall — kein Datenverlust, nur kein automatisches Aufräumen für genau
 * diese eine Datei).
 */
async function appendToCleanupRegistry(entry: CleanupRegistryEntry, token: string): Promise<void> {
  const pathname = cleanupRegistryPathnameForToday();

  for (let attempt = 0; attempt < CLEANUP_REGISTRY_MAX_ATTEMPTS; attempt += 1) {
    let existing: CleanupRegistryFile = { date: pathname, entries: [] };
    let etag: string | undefined;

    try {
      const meta = await head(pathname, { token });
      const response = await fetch(meta.url, { cache: "no-store" });
      if (response.ok) {
        const parsed = (await response.json()) as Partial<CleanupRegistryFile>;
        if (Array.isArray(parsed.entries)) {
          existing = { date: pathname, entries: parsed.entries };
        }
      }
      etag = meta.etag;
    } catch (error) {
      if (!(error instanceof BlobNotFoundError)) {
        throw error;
      }
      // Datei existiert noch nicht — erster Eintrag des Tages, kein ETag nötig.
    }

    const updated: CleanupRegistryFile = {
      date: pathname,
      entries: [...existing.entries, entry],
    };

    try {
      await put(pathname, JSON.stringify(updated), {
        access: "public",
        allowOverwrite: true,
        addRandomSuffix: false,
        contentType: "application/json",
        token,
        ...(etag ? { ifMatch: etag } : {}),
      });
      return;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) {
        continue; // Registerdatei wurde zwischenzeitlich von einer anderen Anfrage geändert — erneut versuchen.
      }
      throw error;
    }
  }

  throw new Error("Bestätigungsregister konnte nach mehreren Versuchen nicht aktualisiert werden.");
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

/**
 * TEMPORÄRE DIAGNOSE (PDF-Ungültig-Fehler auf dem Firmenserver): druckbare
 * Vorschau der ersten Bytes eines Buffers, um zu sehen, ob/wo der Inhalt
 * nicht mehr mit "%PDF-" beginnt (Kontrollpunkte 3 und 4 von 4, siehe
 * generateProtocolPdf.ts und blobFtpsUpload.ts für 1 und 2). Rein lesend
 * (subarray() erzeugt keine Kopie, verändert den Buffer nicht). Nach
 * Abschluss der Fehlersuche wieder entfernbar.
 */
function debugPreviewHeaderBytes(buffer: Buffer, length = 24): string {
  const slice = buffer.subarray(0, Math.min(length, buffer.length));
  let printable = "";
  for (const byte of slice) {
    printable += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : `\\x${byte.toString(16).padStart(2, "0")}`;
  }
  return printable;
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
    console.log(
      `[pdf-diag] 4/4 unmittelbar vor FTPS-Upload (${remoteFileName}): bytes=${buffer.length} ` +
        `headerBytes="${debugPreviewHeaderBytes(buffer)}" startsWithPdfHeader=${buffer.subarray(0, 5).toString("latin1") === "%PDF-"}`
    );
    await client.uploadFrom(Readable.from(buffer), remoteFileName);
    // TEMPORÄRE DIAGNOSE (Punkt 5 der Analyse-Anfrage): Größenvergleich
    // lokaler Buffer vs. vom Server per SIZE gemeldete Dateigröße direkt nach
    // dem Upload. Nicht jeder FTP-Server unterstützt SIZE — daher bewusst in
    // einem eigenen try/catch, damit ein nicht unterstütztes SIZE niemals den
    // eigentlichen (bereits erfolgreichen) Upload als Fehler erscheinen lässt.
    try {
      const remoteSize = await client.size(remoteFileName);
      console.log(
        `[pdf-diag] nach FTPS-Upload (${remoteFileName}): lokale Buffer-Länge=${buffer.length} ` +
          `vom Server gemeldete Größe (SIZE)=${remoteSize} match=${remoteSize === buffer.length}`
      );
    } catch (error) {
      console.warn(
        `[pdf-diag] SIZE-Befehl vom FTPS-Server nicht unterstützt oder fehlgeschlagen (${remoteFileName}) — kein Fehler, nur fehlende Zusatzdiagnose`,
        error
      );
    }
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
      console.log(
        `[pdf-diag] 3/4 direkt nach Abruf aus Vercel Blob (kind=${kind} filename=${filename}): ` +
          `contentType=${blobResponse.headers.get("content-type") ?? "(keiner)"} bytes=${buffer.length} ` +
          `headerBytes="${debugPreviewHeaderBytes(buffer)}" startsWithPdfHeader=${buffer.subarray(0, 5).toString("latin1") === "%PDF-"}`
      );
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
      await appendToCleanupRegistry(
        { blobUrl, kind, filename, confirmedAt: Date.now() },
        getBlobReadWriteToken()
      );
      console.log(
        `[ftps-transfer] blob confirmed for scheduled cleanup (5 Kalendertage ab jetzt): ${blobUrl}`
      );
    } catch (error) {
      // FTPS succeeded — registration failure is non-critical (file just stays
      // in Blob indefinitely instead of being auto-cleaned after 5 days; no
      // data loss, only a missed cleanup for this one file). Log clearly so
      // it can be noticed/investigated.
      console.warn(
        "[ftps-transfer] could not register blob for scheduled 5-day cleanup — file remains in Vercel Blob, no automatic deletion will happen for it",
        error
      );
    }

    console.log(`[ftps-transfer] success: ${remotePath}`);
    res.status(200).json({ ok: true, remotePath });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler bei der FTPS-Übertragung.";
    console.error("[ftps-transfer]", message);
    res.status(500).json({ ok: false, error: message });
  }
}
