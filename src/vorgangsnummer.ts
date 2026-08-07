/**
 * Fordert beim Server eine fortlaufende, vierstellige Vorgangsnummer an
 * (z.B. "0027"), sobald ein Vorgang erfolgreich hochgeladen wurde (siehe
 * api/vorgangsnummer.ts). Rein informativ/optional — schlägt die Anfrage
 * fehl (z.B. offline), wird der Abschluss dadurch NICHT blockiert; das PDF
 * wird dann mit dem bisherigen Dateinamen im bisherigen Ordner abgelegt.
 */

export interface VorgangsnummerResult {
  ok: boolean;
  vorgangsnummer?: string;
  jahr?: number;
  error?: string;
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
