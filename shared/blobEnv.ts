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
 * Bewusst AUSSERHALB von api/ platziert (statt api/_blobEnv.ts): eine mit
 * Unterstrich beginnende Datei innerhalb von api/ wird von Vercel zwar nicht
 * selbst zu einer Funktion, führte hier aber dazu, dass jede Funktion, die
 * sie importierte, beim Aufruf mit FUNCTION_INVOCATION_FAILED abstürzte
 * (Bundling-Problem). Ein Ordner außerhalb von api/ ist der von Vercel
 * empfohlene, robuste Weg für gemeinsam genutzten Server-Code.
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
