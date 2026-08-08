/**
 * Täglicher Cleanup-Job: löscht Foto-/Video-/PDF-Dateien aus Vercel Blob,
 * die bereits VOR mindestens 5 Kalendertagen erfolgreich per FTPS auf den
 * Firmenserver übertragen wurden (siehe "Bestätigungsregister" in
 * api/ftps-transfer.ts). Bis dahin dienen sie als temporäre Sicherheitskopie.
 *
 * Wichtig — Sicherheitsprinzip: Eine Datei landet NUR dann in einer
 * Registerdatei (blob-cleanup/pending-*.json), wenn der Firmenserver-Transfer
 * bereits eindeutig bestätigt wurde. Fehlgeschlagene oder noch offene
 * Übertragungen tauchen dort nie auf und werden von diesem Job daher niemals
 * angefasst — unabhängig von ihrem Alter.
 *
 * Diese Funktion löscht ausschließlich Dateien in Vercel Blob (per
 * @vercel/blob "del()"). Sie hat keinerlei FTPS-/Firmenserver-Zugriff und
 * verändert dort nichts.
 *
 * Aufruf: als Vercel Cron Job (siehe vercel.json "crons", 1x täglich — das
 * ist das Maximum auf dem Hobby-Tarif; für die 5-Tage-Regel reicht
 * Tages-Genauigkeit völlig aus). Vercel ruft Cron-Endpunkte per GET auf.
 * Optionaler Schutz gegen fremden Aufruf: wenn die Umgebungsvariable
 * CRON_SECRET gesetzt ist, muss der Request den Header
 * "Authorization: Bearer <CRON_SECRET>" mitschicken (das setzt Vercel bei
 * eigenen Cron-Aufrufen automatisch). Ohne gesetzte Variable ist der
 * Endpunkt offen erreichbar — er kann dann höchstens bereits bestätigt
 * übertragene, mind. 5 Tage alte Dateien löschen, kein sicherheitskritischer
 * Vorgang, aber zur Vorsicht trotzdem empfohlen.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  del,
  head,
  list,
  put,
  BlobNotFoundError,
  BlobPreconditionFailedError,
} from "@vercel/blob";

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

const CLEANUP_REGISTRY_PREFIX = "blob-cleanup/pending-";
// 5 Kalendertage — bewusst als feste Millisekunden-Dauer ab dem exakten
// Bestätigungszeitpunkt gerechnet (nicht als grobe Kalendertag-Differenz),
// damit nie zu früh gelöscht wird. Vercel Hobby-Cron-Jobs laufen ohnehin nur
// mit Stunden-Genauigkeit (±59 Min.) — für eine 5-Tage-Regel unerheblich.
const RETENTION_MS = 5 * 24 * 60 * 60 * 1000;
const REGISTRY_WRITE_MAX_ATTEMPTS = 6;

interface CleanupRegistryEntry {
  blobUrl: string;
  kind: string;
  filename: string;
  confirmedAt: number;
}

interface CleanupRegistryFile {
  date: string;
  entries: CleanupRegistryEntry[];
}

interface ProcessResult {
  pathname: string;
  checked: number;
  deleted: number;
  keptNotYetDue: number;
  keptDueButFailed: number;
}

async function readRegistryFile(
  pathname: string,
  token: string
): Promise<{ file: CleanupRegistryFile; etag: string | undefined } | null> {
  try {
    const meta = await head(pathname, { token });
    const response = await fetch(meta.url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Registerdatei konnte nicht gelesen werden (HTTP ${response.status}).`);
    }
    const parsed = (await response.json()) as Partial<CleanupRegistryFile>;
    return {
      file: {
        date: typeof parsed.date === "string" ? parsed.date : pathname,
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      },
      etag: meta.etag,
    };
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      return null;
    }
    throw error;
  }
}

/**
 * Verarbeitet EINE Registerdatei: löscht alle fälligen (>= 5 Tage
 * bestätigten) Blobs, schreibt die Datei mit den verbleibenden (noch nicht
 * fälligen ODER beim Löschen fehlgeschlagenen) Einträgen zurück, oder löscht
 * die Registerdatei selbst, wenn nichts mehr übrig bleibt.
 */
async function processRegistryFile(pathname: string, token: string): Promise<ProcessResult> {
  const result: ProcessResult = {
    pathname,
    checked: 0,
    deleted: 0,
    keptNotYetDue: 0,
    keptDueButFailed: 0,
  };

  for (let attempt = 0; attempt < REGISTRY_WRITE_MAX_ATTEMPTS; attempt += 1) {
    const loaded = await readRegistryFile(pathname, token);
    if (!loaded) {
      // Datei existiert nicht (mehr) — evtl. bereits von einem parallelen
      // Lauf verarbeitet. Nichts zu tun.
      return result;
    }

    const { file, etag } = loaded;
    const now = Date.now();
    result.checked = file.entries.length;

    const due = file.entries.filter((entry) => now - entry.confirmedAt >= RETENTION_MS);
    const notDue = file.entries.filter((entry) => now - entry.confirmedAt < RETENTION_MS);
    result.keptNotYetDue = notDue.length;

    if (due.length === 0) {
      return result;
    }

    const stillPending: CleanupRegistryEntry[] = [];
    let deletedCount = 0;
    for (const entry of due) {
      try {
        await del(entry.blobUrl, { token });
        deletedCount += 1;
        console.log(
          `[cleanup-expired-blobs] deleted (5 Tage nach Bestätigung abgelaufen): kind=${entry.kind} filename=${entry.filename} url=${entry.blobUrl}`
        );
      } catch (error) {
        if (error instanceof BlobNotFoundError) {
          // Bereits weg (z.B. manuell entfernt) — zählt als erledigt.
          deletedCount += 1;
          continue;
        }
        console.warn(
          `[cleanup-expired-blobs] delete failed, will retry on next run: kind=${entry.kind} url=${entry.blobUrl}`,
          error
        );
        stillPending.push(entry);
      }
    }
    result.deleted = deletedCount;
    result.keptDueButFailed = stillPending.length;

    const remaining = [...notDue, ...stillPending];

    if (remaining.length === 0) {
      try {
        await del(pathname, { token });
      } catch (error) {
        // Registerdatei selbst konnte nicht gelöscht werden — harmlos,
        // enthält ohnehin keine noch offenen Einträge mehr.
        console.warn(`[cleanup-expired-blobs] could not delete empty registry file ${pathname}`, error);
      }
      return result;
    }

    try {
      await put(pathname, JSON.stringify({ date: file.date, entries: remaining }), {
        access: "public",
        allowOverwrite: true,
        addRandomSuffix: false,
        contentType: "application/json",
        token,
        ...(etag ? { ifMatch: etag } : {}),
      });
      return result;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) {
        // Registerdatei wurde zwischenzeitlich geändert (z.B. neue
        // Bestätigung kam gerade rein) — von vorn lesen und erneut versuchen.
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Registerdatei ${pathname} konnte nach mehreren Versuchen nicht aktualisiert werden.`);
}

async function listAllRegistryFiles(token: string): Promise<string[]> {
  const pathnames: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: CLEANUP_REGISTRY_PREFIX, token, cursor, limit: 1000 });
    for (const blob of page.blobs) {
      pathnames.push(blob.pathname);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return pathnames;
}

function isAuthorized(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    // Keine Absicherung konfiguriert — Endpunkt bewusst offen erreichbar
    // (siehe Datei-Kommentar oben), damit dies ohne zusätzliche
    // Umgebungsvariable sofort funktioniert.
    return true;
  }
  const header = req.headers.authorization;
  return header === `Bearer ${secret}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  try {
    const token = getBlobReadWriteToken();
    const registryPathnames = await listAllRegistryFiles(token);

    console.log(
      `[cleanup-expired-blobs] start: ${registryPathnames.length} Registerdatei(en) gefunden.`
    );

    const results: ProcessResult[] = [];
    for (const pathname of registryPathnames) {
      try {
        results.push(await processRegistryFile(pathname, token));
      } catch (error) {
        console.error(`[cleanup-expired-blobs] failed processing ${pathname}`, error);
      }
    }

    const totals = results.reduce(
      (acc, r) => ({
        checked: acc.checked + r.checked,
        deleted: acc.deleted + r.deleted,
        keptNotYetDue: acc.keptNotYetDue + r.keptNotYetDue,
        keptDueButFailed: acc.keptDueButFailed + r.keptDueButFailed,
      }),
      { checked: 0, deleted: 0, keptNotYetDue: 0, keptDueButFailed: 0 }
    );

    console.log(
      `[cleanup-expired-blobs] done: registryFiles=${registryPathnames.length} checked=${totals.checked} deleted=${totals.deleted} keptNotYetDue=${totals.keptNotYetDue} keptDueButFailed=${totals.keptDueButFailed}`
    );

    res.status(200).json({
      ok: true,
      registryFiles: registryPathnames.length,
      ...totals,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cleanup fehlgeschlagen.";
    console.error("[cleanup-expired-blobs]", message);
    res.status(500).json({ ok: false, error: message });
  }
}
