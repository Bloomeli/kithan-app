/**
 * Lokale, persistente Vorgangsnummern — vergeben beim Anlegen eines neuen
 * Vorgangs (nicht erst beim Upload). Format: "2026-0001".
 *
 * Acht getrennte Jahreszähler:
 *   privat/gewerbe/garage/schluessel × uebergabe/ruecknahme
 *
 * Speicherung: localStorage (überlebt App-/Browser-Neustart und Reload).
 * Idempotenz: dieselbe vorgangId erhält immer dieselbe Nummer.
 *
 * requestVorgangsnummer() bleibt für den optionalen Server-Zähler erhalten,
 * wird für die Anzeige/Dateinamen aber nicht mehr verwendet.
 */

export interface VorgangsnummerResult {
  ok: boolean;
  vorgangsnummer?: string;
  jahr?: number;
  error?: string;
}

export interface LocalVorgangsnummer {
  /** z.B. "2026-0001" */
  display: string;
  /** z.B. "0001" */
  nummer: string;
  jahr: number;
}

interface AssignedEntry {
  display: string;
  nummer: string;
  jahr: number;
  objektart: string;
  protokollart: string;
}

const COUNTERS_KEY = "kithan_vorgangsnummer_counters_v1";
const ASSIGNED_KEY = "kithan_vorgangsnummer_assigned_v1";
const MAX_VALUE = 9999;

function currentJahr(): number {
  return new Date().getFullYear();
}

function counterSlotKey(objektart: string, protokollart: string, jahr: number): string {
  return `${objektart}_${protokollart}_${jahr}`;
}

function formatNummer(value: number): string {
  return String(value).padStart(4, "0");
}

function loadCounters(): Record<string, number> {
  try {
    const raw = localStorage.getItem(COUNTERS_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function saveCounters(counters: Record<string, number>): void {
  localStorage.setItem(COUNTERS_KEY, JSON.stringify(counters));
}

function loadAssigned(): Record<string, AssignedEntry> {
  try {
    const raw = localStorage.getItem(ASSIGNED_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, Partial<AssignedEntry>>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const result: Record<string, AssignedEntry> = {};
    for (const [vorgangId, entry] of Object.entries(parsed)) {
      if (
        entry &&
        typeof entry.display === "string" &&
        typeof entry.nummer === "string" &&
        typeof entry.jahr === "number" &&
        typeof entry.objektart === "string" &&
        typeof entry.protokollart === "string"
      ) {
        result[vorgangId] = {
          display: entry.display,
          nummer: entry.nummer,
          jahr: entry.jahr,
          objektart: entry.objektart,
          protokollart: entry.protokollart,
        };
      }
    }
    return result;
  } catch {
    return {};
  }
}

function saveAssigned(assigned: Record<string, AssignedEntry>): void {
  localStorage.setItem(ASSIGNED_KEY, JSON.stringify(assigned));
}

export function jahrFromVorgangsnummer(display: string): number {
  const match = /^(\d{4})-/.exec(display.trim());
  if (match) {
    return Number(match[1]);
  }
  return currentJahr();
}

/**
 * Liefert die bereits vergebene Nummer dieser Vorgangs-ID oder vergibt die
 * nächste freie Nummer des passenden Jahreszählers. Dieselbe vorgangId wird
 * nie ein zweites Mal hochgezählt.
 */
export function getOrAllocateVorgangsnummer(
  vorgangId: string,
  objektart: string,
  protokollart: string
): LocalVorgangsnummer {
  const id = vorgangId.trim();
  if (!id) {
    throw new Error("vorgangId fehlt — Vorgangsnummer kann nicht vergeben werden.");
  }

  const assigned = loadAssigned();
  const existing = assigned[id];
  if (existing) {
    return { display: existing.display, nummer: existing.nummer, jahr: existing.jahr };
  }

  const jahr = currentJahr();
  const slot = counterSlotKey(objektart, protokollart, jahr);
  const counters = loadCounters();

  let maxFromAssigned = 0;
  for (const entry of Object.values(assigned)) {
    if (entry.objektart === objektart && entry.protokollart === protokollart && entry.jahr === jahr) {
      const n = Number.parseInt(entry.nummer, 10);
      if (Number.isFinite(n) && n > maxFromAssigned) {
        maxFromAssigned = n;
      }
    }
  }

  const stored = counters[slot] ?? 0;
  const next = Math.max(stored, maxFromAssigned) + 1;
  if (next > MAX_VALUE) {
    throw new Error(
      `Maximale Vorgangsnummer (${MAX_VALUE}) für ${objektart}/${protokollart} im Jahr ${jahr} erreicht.`
    );
  }

  const nummer = formatNummer(next);
  const display = `${jahr}-${nummer}`;
  counters[slot] = next;
  assigned[id] = { display, nummer, jahr, objektart, protokollart };
  saveCounters(counters);
  saveAssigned(assigned);
  console.log(
    `[vorgangsnummer] lokal vergeben: ${display} (${objektart}/${protokollart}, vorgangId=${id})`
  );
  return { display, nummer, jahr };
}

export async function requestVorgangsnummer(
  vorgangId: string,
  objektart: "schluessel" | "gewerbe" | "privat" | "garage"
): Promise<VorgangsnummerResult> {
  try {
    const response = await fetch("/api/vorgangsnummer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vorgangId, objektart }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      vorgangsnummer?: string;
      jahr?: number;
      error?: string;
    };
    if (!response.ok || !data.ok || !data.vorgangsnummer || !data.jahr) {
      const error = data.error || `HTTP ${response.status}`;
      console.warn(`[vorgangsnummer] Vergabe fehlgeschlagen: ${error}`);
      return { ok: false, error };
    }
    console.log(`[vorgangsnummer] Vergeben: ${data.vorgangsnummer} (Jahr ${data.jahr})`);
    return { ok: true, vorgangsnummer: data.vorgangsnummer, jahr: data.jahr };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[vorgangsnummer] Anfrage fehlgeschlagen (evtl. offline): ${message}`);
    return { ok: false, error: message };
  }
}
