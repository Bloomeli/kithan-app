/**
 * Offline-Startfähigkeit für die PWA.
 * Cacht die Kern-Dateien (HTML, CSS, JS-Bundle, Icons) beim ersten Besuch.
 * Strategie: online → Netzwerk laden + Cache aktualisieren; offline → aus Cache laden.
 *
 * Betrifft NUR das Starten/Laden der App selbst. Formular-Logik, PDF-Export
 * und E-Mail-Versand laufen unverändert weiter. API-Aufrufe (/api/...) und
 * der Firmenserver-Upload werden bewusst NICHT gecacht — die bleiben wie
 * vorgesehen von einer Internetverbindung abhängig.
 */

// Bump this string on future deploys to force clients to refresh the cache.
const CACHE_VERSION = "v2";
const CACHE_NAME = `kithan-app-${CACHE_VERSION}`;

const CORE_ASSETS = ["/", "/index.html", "/style.css", "/icons/icon-180.png"];

/**
 * The Vite build hashes JS/CSS bundle filenames (e.g. /assets/index-abc123.js),
 * so they can't be hardcoded here. Instead, read the current index.html and
 * cache whatever /assets/* and /icons/* files it actually references.
 */
async function precacheCoreAssets(cache) {
  await cache.addAll(CORE_ASSETS).catch(() => {
    // Best-effort — the runtime fetch handler below will still cache assets
    // opportunistically as they're requested during normal use.
  });

  try {
    const response = await fetch("/index.html", { cache: "no-store" });
    const html = await response.text();
    const referenced = Array.from(html.matchAll(/(?:src|href)="(\/[^"]+)"/g)).map((match) => match[1]);
    const assetUrls = referenced.filter(
      (url) => url.startsWith("/assets/") || url.startsWith("/icons/")
    );

    await Promise.all(
      assetUrls.map((url) =>
        fetch(url)
          .then((res) => (res.ok ? cache.put(url, res) : null))
          .catch(() => null)
      )
    );
  } catch {
    // Offline during install or index.html unreachable — nothing more to do here.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => precacheCoreAssets(cache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    // Cross-origin (e.g. Resend) and our own serverless endpoints stay network-only.
    return;
  }

  const isNavigation = request.mode === "navigate";

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) {
          return cached;
        }
        if (isNavigation) {
          const fallback = await caches.match("/index.html");
          if (fallback) {
            return fallback;
          }
        }
        return Response.error();
      })
  );
});
