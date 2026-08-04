/**
 * Zentrale Auflösung des Vercel-Blob-Tokens.
 *
 * Der ursprüngliche Blob-Store war als "privat" angelegt — das lässt sich bei
 * Vercel Blob NICHT nachträglich ändern (nur bei der Store-Erstellung
 * wählbar). Deshalb wurde ein NEUER, öffentlicher Store angelegt und mit
 * eigenem Environment-Variable-Prefix "PUBLIC_BLOB" verbunden, damit er nicht
 * mit den bereits belegten BLOB_*-Variablen des alten (privaten) Stores
 * kollidiert. Der alte Store bleibt unverändert bestehen, wird aber von
 * unserem Code nicht mehr verwendet.
 *
 * Alle drei Blob-Aufrufstellen (Token-Erzeugung, FTPS-Transfer-Cleanup,
 * Debug-Route) müssen denselben Token explizit übergeben, statt sich auf
 * die implizite BLOB_READ_WRITE_TOKEN-Standardsuche der SDK zu verlassen.
 */
export function getBlobReadWriteToken(): string {
  const token = process.env.PUBLIC_BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "Server-Konfiguration unvollständig (PUBLIC_BLOB_READ_WRITE_TOKEN fehlt — wurde der neue öffentliche Blob-Store mit dem Prefix \"PUBLIC_BLOB\" verbunden?)."
    );
  }
  return token;
}
