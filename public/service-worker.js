/**
 * Offline-Startfähigkeit für die PWA.
 * Cacht die Kern-Dateien (HTML, CSS, JS-Bundle, Icons) beim ersten Besuch.
 * Strategie: online → Netzwerk laden + Cache aktualisieren; offline → aus Cache laden.
 *
 * Betrifft NUR das Starten/Laden der App selbst. Formular-Logik, PDF-Export
 * und E-Mail-Versand laufen unverändert weiter.
 *
 * NIEMALS gecacht / NIEMALS per Offline-Fallback beantwortet:
 *  - jede Nicht-GET-Anfrage (POST/PUT/DELETE/...) — das betrifft ALLE Uploads
 *    (Vercel-Blob-Client-Upload, /api/blob-upload-token, /api/ftps-transfer,
 *    /api/send-protocol-email).
 *  - alle /api/*-Routen, auch falls sie einmal per GET aufgerufen würden.
 *  - alle Cross-Origin-Anfragen, insbesondere *.public.blob.vercel-storage.com
 *    (der direkte Browser-Upload zu Vercel Blob läuft nie über diese Domain
 *    hier, aber der Origin-Check deckt es zusätzlich defensiv ab).
 * Diese Anfragen laufen immer direkt gegen das Netzwerk durch — siehe
 * `shouldBypassCache()` unten.
 */

// Bump this string on future deploys to force clients to purge the old cache
// and re-fetch everything fresh (App-Shell + Bundle).
const CACHE_VERSION = "v3";
const CACHE_NAME = `kithan-app-${CACHE_VERSION}`;
const SW_TAG = `[service-worker ${CACHE_VERSION}]`;

const CORE_ASSETS = ["/", "/index.html", "/style.css", "/icons/icon-180.png"];

/**
 * The Vite build hashes JS/CSS bundle filenames (e.g. /assets/index-abc123.js),
 * so they can't be hardcoded here. Instead, read the current index.html and
 * cache whatever /assets/* and /icons/* files it actually references.
 */
async function precacheCoreAssets(cache) {
  await cache.addAll(CORE_ASSETS).catch((error) => {
    // Best-effort — the runtime fetch handler below will still cache assets
    // opportunistically as they're requested during normal use.
    console.warn(`${SW_TAG} precache of CORE_ASSETS failed (non-fatal)`, error);
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
    console.log(`${SW_TAG} precached ${assetUrls.length} hashed asset(s) from index.html`);
  } catch (error) {
    // Offline during install or index.html unreachable — nothing more to do here.
    console.warn(`${SW_TAG} could not read index.html to discover hashed assets (non-fatal)`, error);
  }
}

self.addEventListener("install", (event) => {
  console.log(`${SW_TAG} installing…`);
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => precacheCoreAssets(cache))
      .then(() => {
        console.log(`${SW_TAG} install complete, calling skipWaiting()`);
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", (event) => {
  console.log(`${SW_TAG} activating…`);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        const stale = keys.filter((key) => key !== CACHE_NAME);
        if (stale.length > 0) {
          console.log(`${SW_TAG} deleting ${stale.length} stale cache(s):`, stale);
        }
        return Promise.all(stale.map((key) => caches.delete(key)));
      })
      .then(() => {
        console.log(`${SW_TAG} activate complete, calling clients.claim()`);
        return self.clients.claim();
      })
  );
});

/**
 * Single source of truth for "this request must never be answered from the
 * cache and must never fall back to an offline response". Keep this
 * defensive and explicit — a false negative here would mean an upload or
 * API call could silently get a stale/offline response.
 */
function shouldBypassCache(request, url) {
  if (request.method !== "GET") {
    // Every upload (Vercel Blob client upload, /api/blob-upload-token,
    // /api/ftps-transfer, /api/send-protocol-email) is a non-GET request.
    return true;
  }
  if (url.pathname.startsWith("/api/")) {
    return true;
  }
  if (url.origin !== self.location.origin) {
    // Cross-origin, e.g. *.public.blob.vercel-storage.com or Resend.
    return true;
  }
  return false;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (shouldBypassCache(request, url)) {
    // Deliberately do NOT call event.respondWith() here — the browser
    // handles the request exactly as if this Service Worker didn't exist,
    // going straight to the network with no cache/offline-fallback logic.
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
      .catch(async (error) => {
        console.warn(`${SW_TAG} network fetch failed, trying cache for`, url.pathname, error);
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
