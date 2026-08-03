import { defineConfig } from "vite";

// Baked in at build time so the running app can show/log which build is
// actually loaded — needed to rule out stale Service-Worker/PWA caching
// when a deployed fix doesn't seem to take effect on a device.
const APP_BUILD = new Date().toISOString();

export default defineConfig({
  root: ".",
  publicDir: "public",
  define: {
    __APP_BUILD__: JSON.stringify(APP_BUILD),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    open: true,
  },
});
