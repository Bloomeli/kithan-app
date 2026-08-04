/**
 * TEMPORÄRE Diagnose-Route — NICHT Teil des normalen Upload-Flows.
 *
 * Simuliert exakt den Client-Upload-Ablauf (Token holen → PUT zu Vercel Blob),
 * aber komplett serverseitig (Node → Vercel), also ohne jede Browser-CORS-
 * Beschränkung. Damit können wir die ECHTE Antwort (HTTP-Status + vollständiger
 * Response-Body) lesen, die der Browser wegen des fehlenden
 * Access-Control-Allow-Origin-Headers bei einer Fehlerantwort verschluckt.
 *
 * Aufruf einfach per Browser-URL: /api/debug-blob-put
 * (optional ?contentType=image/jpeg&pathname=photo/xyz.jpg)
 *
 * Nach Abschluss der Diagnose bitte wieder löschen.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { getBlobReadWriteToken } from "../shared/blobEnv";

export const config = {
  maxDuration: 30,
};

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  const pathname =
    (typeof req.query.pathname === "string" && req.query.pathname) ||
    `debug/blob-put-test-${Date.now()}.jpg`;
  const contentType =
    (typeof req.query.contentType === "string" && req.query.contentType) || "image/jpeg";

  const steps: Record<string, unknown> = { pathname, contentType };

  try {
    const clientToken = await generateClientTokenFromReadWriteToken({
      token: getBlobReadWriteToken(),
      pathname,
      allowedContentTypes: ["image/*", "video/*", "application/pdf"],
      maximumSizeInBytes: 500 * 1024 * 1024,
      addRandomSuffix: true,
      validUntil: Date.now() + 10 * 60 * 1000,
    });
    steps.clientTokenPrefix = clientToken.slice(0, 40) + "…";
    steps.storeIdFromToken = clientToken.split("_")[3];

    const params = new URLSearchParams({ pathname });
    const putUrl = `https://vercel.com/api/blob/?${params.toString()}`;
    const testBody = Buffer.from("kithan-debug-test-bytes");

    const putResponse = await fetch(putUrl, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${clientToken}`,
        "x-vercel-blob-store-id": clientToken.split("_")[3] ?? "",
        "x-api-version": "11",
        "x-vercel-blob-access": "public",
        "x-content-type": contentType,
        "x-api-blob-request-id": `debug:${Date.now()}`,
        "x-api-blob-request-attempt": "0",
      },
      body: new Uint8Array(testBody),
    });

    const putBodyText = await putResponse.text();
    steps.putHttpStatus = putResponse.status;
    steps.putHttpStatusText = putResponse.statusText;
    steps.putResponseHeaders = Object.fromEntries(putResponse.headers.entries());
    steps.putResponseBody = putBodyText;

    console.log("[debug-blob-put] result:", JSON.stringify(steps, null, 2));
    res.status(200).json({ ok: putResponse.ok, steps });
  } catch (error) {
    steps.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error;
    console.error("[debug-blob-put] failed:", steps);
    res.status(500).json({ ok: false, steps });
  }
}
