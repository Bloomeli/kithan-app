/**
 * Screen Wake Lock während des Abschluss-Uploads (Foto/Video/PDF).
 *
 * iOS/Safari unterbricht Netzwerkverbindungen, sobald der Bildschirm
 * automatisch sperrt oder der Tab in den Hintergrund geht. Der Archiv-Upload
 * (uploadProtocolArchive) lädt Fotos, Videos und danach das PDF NACHEINANDER
 * hoch — bei mehreren/größeren Dateien kann das mehrere Minuten dauern. Sperrt
 * der Bildschirm währenddessen automatisch, bleiben bereits abgeschlossene
 * Übertragungen erfolgreich, aber die zu diesem Zeitpunkt noch laufende oder
 * als nächstes anstehende Übertragung (meist das PDF, da es zuletzt hochgeladen
 * wird) bricht kommentarlos ab bzw. läuft in den Timeout.
 *
 * Ein Wake Lock während der Upload-Phase verhindert genau das (best effort,
 * kein Fehler falls die API fehlt — Wake Lock wird erst ab iOS 16.4
 * unterstützt; auf älteren Geräten bleibt das Verhalten wie bisher).
 */

let activeWakeLock: WakeLockSentinel | null = null;

export async function acquireUploadWakeLock(): Promise<void> {
  try {
    if (!("wakeLock" in navigator)) {
      console.log("[wakeLock] Screen Wake Lock API nicht verfügbar (übersprungen).");
      return;
    }
    activeWakeLock = await navigator.wakeLock.request("screen");
    console.log("[wakeLock] Wake Lock für Upload-Phase aktiviert.");
    activeWakeLock.addEventListener("release", () => {
      console.log("[wakeLock] Wake Lock wurde freigegeben (z.B. Tab-Wechsel durch Nutzer).");
    });
  } catch (error) {
    // Not fatal — e.g. denied because the tab is not visible at request time.
    console.warn("[wakeLock] Wake Lock konnte nicht aktiviert werden (nicht kritisch).", error);
    activeWakeLock = null;
  }
}

export async function releaseUploadWakeLock(): Promise<void> {
  const lock = activeWakeLock;
  activeWakeLock = null;
  try {
    await lock?.release();
  } catch (error) {
    console.warn("[wakeLock] Fehler beim Freigeben des Wake Lock (nicht kritisch).", error);
  }
}
