/**
 * Feste Foto-Zuordnung beim Aufnehmen: protocolId + Raum/Feld + Sequenz.
 * PDF-Einbettung darf diese Metadaten nur prüfen, nicht neu raten.
 */

export function sequenceLetter(n: number): string {
  if (!Number.isFinite(n) || n < 1) {
    return "A";
  }
  let result = "";
  let x = Math.floor(n);
  while (x > 0) {
    x -= 1;
    result = String.fromCharCode(65 + (x % 26)) + result;
    x = Math.floor(x / 26);
  }
  return result;
}

export interface MediaBindingFields {
  sessionKey: string;
  ownerKey: string;
  protocolId?: string;
  room?: string;
  ownerLabel?: string;
  ownerSequence?: number;
  kind?: string;
}

/**
 * Nur Fotos mit exakt derselben protocolId und demselben Feld (ownerKey)
 * dürfen in einen PDF-Abschnitt. Kein Fallback auf andere Vorgänge/Räume.
 */
export function photoBelongsToSection(
  photo: MediaBindingFields,
  currentProtocolId: string,
  sectionOwnerKey: string,
  sectionLabel: string
): boolean {
  const current = currentProtocolId.trim();
  const photoProtocolId = (photo.protocolId || "").trim();
  const photoSessionKey = (photo.sessionKey || "").trim();
  // Neue Aufnahmen haben protocolId. Alte Datensätze ohne protocolId nur dann,
  // wenn sessionKey exakt der aktuelle Vorgang ist — nie ein anderer Vorgang.
  const boundId = photoProtocolId || photoSessionKey;
  if (!current || !boundId || boundId !== current) {
    console.warn(
      `[media-binding] Foto ignoriert — protocolId passt nicht (foto=${boundId || "(leer)"} aktuell=${current} ownerKey=${photo.ownerKey})`
    );
    return false;
  }
  if (photo.ownerKey !== sectionOwnerKey) {
    console.warn(
      `[media-binding] Foto ignoriert — Feld/Raum passt nicht (foto.ownerKey=${photo.ownerKey} abschnitt=${sectionOwnerKey})`
    );
    return false;
  }
  const photoRoom = (photo.room || photo.ownerLabel || "").trim();
  const expectedRoom = sectionLabel.trim();
  if (photoRoom && expectedRoom && photoRoom !== expectedRoom) {
    console.warn(
      `[media-binding] Foto ignoriert — room passt nicht (foto.room=${photoRoom} abschnitt=${expectedRoom})`
    );
    return false;
  }
  return true;
}
