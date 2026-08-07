/**
 * Vergibt eine fortlaufende, vierstellige Vorgangsnummer (z.B. "0027"),
 * sobald ein Vorgang tatsächlich abgeschlossen und hochgeladen wird. Die
 * Nummer wird bewusst erst hier (server-seitig) und nicht schon beim Start
 * eines Vorgangs vergeben, damit abgebrochene/nie hochgeladene Vorgänge
 * keine "Lücken" in der Nummerierung verursachen.
 *
 * Kein technisches Kürzel (kein "UEB"/"ABN") mehr in der Nummer selbst —
 * Jahr, Objektart (Privat/Gewerbe/Garage/Schlüssel) und Vorgangsart
 * (Übergabe/Rücknahme) stecken bereits eindeutig in der Ordnerstruktur auf
 * dem Firmenserver (z.B. "2026/Privat/Übergabe/0027_Müller_WH07.pdf").
 *
 * Zähler-Umfang: EIN gemeinsamer Zähler pro Objektart+Kalenderjahr, geteilt
 * zwischen Übergabe UND Rücknahme (z.B. zählen die erste Privat-Übergabe und
 * die zweite Privat-Rücknahme des Jahres beide in dieselbe Reihe: 0001,
 * 0002, …). Am 1. Januar beginnt jede Objektart wieder bei 0001.
 *
 * Zähler-Speicherung: eine kleine JSON-Datei pro Objektart+Jahr in Vercel
 * Blob (kein zusätzlicher Dienst/keine Datenbank nötig). Für sicheres
 * Hochzählen bei mehreren gleichzeitigen Anfragen wird Vercel Blobs
 * "ifMatch" (optimistisches Concurrency-Control per ETag) verwendet:
 * Schlägt der Schreibversuch fehl, weil eine andere Anfrage zwischenzeitlich
 * geschrieben hat, wird mit frisch gelesenem Stand erneut versucht.
 *
 * Restrisiko (bewusst akzeptiert, siehe Absprache): Beim allerersten
 * Schreibversuch einer Zähler-Datei (also nur beim jeweils ersten Vorgang
 * einer Objektart in einem neuen Jahr) gibt es noch kein ETag, gegen das
 * geprüft werden könnte. Träfen zwei Anfragen exakt in diesem einen Moment
 * gleichzeitig ein, könnte theoretisch eine doppelte Nummer entstehen. Für
 * den tatsächlichen Nutzungsumfang (wenige Mitarbeiter, kein echtzeitgleiches
 * Abschließen im selben Sekundenbruchteil) ist das vernachlässigbar; eine
 * vollständige Absicherung würde einen zusätzlichen Dienst (z.B. Vercel KV)
 * erfordern, der laut Absprache bewusst vermieden werden soll.
 *
 * Idempotenz: Zusätzlich zum Zählerstand wird pro Zähler-Datei auch
 * vermerkt, welche Vorgangs-ID bereits welche Nummer erhalten hat. Fragt der
 * Client (z.B. nach einem Netzwerk-Retry) für dieselbe Vorgangs-ID erneut
 * an, wird die bereits vergebene Nummer zurückgegeben statt eine neue zu
 * verbrauchen.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { head, put, BlobNotFoundError, BlobPreconditionFailedError } from "@vercel/blob";

function getBlobReadWriteToken(): string {
  const token = process.env.PUBLIC_BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("Server-Konfiguration unvollstaendig (PUBLIC_BLOB_READ_WRITE_TOKEN fehlt).");
  }
  return token;
}

export const config = {
  maxDuration: 20,
};

// Muss exakt den Objektart-Werten aus src/app.ts (Objektart-Typ) entsprechen.
const VALID_OBJEKTARTEN = ["schluessel", "gewerbe", "privat", "garage"] as const;
type ObjektartValue = (typeof VALID_OBJEKTARTEN)[number];

interface CounterFile {
  value: number;
  assigned: Record<string, string>;
}

interface RequestBody {
  vorgangId?: string;
  objektart?: string;
}

const MAX_ATTEMPTS = 8;
const MAX_VALUE = 9999;

function isValidObjektart(value: string): value is ObjektartValue {
  return (VALID_OBJEKTARTEN as readonly string[]).includes(value);
}

function counterPathname(objektart: ObjektartValue, jahr: number): string {
  return `vorgangsnummern/counter-${objektart}-${jahr}.json`;
}

function formatVorgangsnummer(value: number): string {
  return String(value).padStart(4, "0");
}

async function readCounter(
  pathname: string,
  token: string
): Promise<{ counter: CounterFile; etag: string | undefined }> {
  try {
    const meta = await head(pathname, { token });
    const response = await fetch(meta.url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Zähler-Datei konnte nicht gelesen werden (HTTP ${response.status}).`);
    }
    const parsed = (await response.json()) as Partial<CounterFile>;
    return {
      counter: {
        value: typeof parsed.value === "number" && Number.isFinite(parsed.value) ? parsed.value : 0,
        assigned: parsed.assigned && typeof parsed.assigned === "object" ? parsed.assigned : {},
      },
      etag: meta.etag,
    };
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      return { counter: { value: 0, assigned: {} }, etag: undefined };
    }
    throw error;
  }
}

async function assignVorgangsnummer(
  vorgangId: string,
  objektart: ObjektartValue,
  token: string
): Promise<{ vorgangsnummer: string; jahr: number }> {
  const jahr = new Date().getUTCFullYear();
  const pathname = counterPathname(objektart, jahr);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { counter, etag } = await readCounter(pathname, token);

    const existing = counter.assigned[vorgangId];
    if (existing) {
      console.log(`[vorgangsnummer] bereits vergeben (idempotent): vorgangId=${vorgangId} -> ${existing}`);
      return { vorgangsnummer: existing, jahr };
    }

    const nextValue = counter.value + 1;
    if (nextValue > MAX_VALUE) {
      throw new Error(
        `Maximale Vorgangsnummer (${MAX_VALUE}) für ${objektart} im Jahr ${jahr} erreicht.`
      );
    }
    const vorgangsnummer = formatVorgangsnummer(nextValue);
    const updated: CounterFile = {
      value: nextValue,
      assigned: { ...counter.assigned, [vorgangId]: vorgangsnummer },
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
      console.log(
        `[vorgangsnummer] neu vergeben: vorgangId=${vorgangId} objektart=${objektart} -> ${vorgangsnummer} (Versuch ${
          attempt + 1
        })`
      );
      return { vorgangsnummer, jahr };
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) {
        console.log(
          `[vorgangsnummer] Konflikt beim Schreiben (Zähler wurde zwischenzeitlich geändert), erneuter Versuch (${
            attempt + 1
          }/${MAX_ATTEMPTS}) …`
        );
        continue;
      }
      throw error;
    }
  }

  throw new Error("Vorgangsnummer konnte nach mehreren Versuchen nicht sicher vergeben werden.");
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
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as RequestBody;
    const vorgangId = String(body.vorgangId ?? "").trim();
    const objektart = String(body.objektart ?? "").trim();

    if (!vorgangId) {
      res.status(400).json({ ok: false, error: "vorgangId fehlt." });
      return;
    }
    if (!isValidObjektart(objektart)) {
      res.status(400).json({
        ok: false,
        error: `objektart muss eines von ${VALID_OBJEKTARTEN.join(", ")} sein.`,
      });
      return;
    }

    const { vorgangsnummer, jahr } = await assignVorgangsnummer(vorgangId, objektart, getBlobReadWriteToken());
    res.status(200).json({ ok: true, vorgangsnummer, jahr });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vorgangsnummer konnte nicht vergeben werden.";
    console.error("[vorgangsnummer]", message);
    res.status(500).json({ ok: false, error: message });
  }
}
