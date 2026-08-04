/**
 * Vercel-Blob-Client-Upload-Handshake: autorisiert den direkten Browser-Upload
 * (Foto/Video/PDF) zu Vercel Blob, sodass große Dateien nicht durch das
 * 4,5-MB-Limit von Vercel Serverless Functions laufen müssen.
 *
 * Benötigt BLOB_READ_WRITE_TOKEN als Vercel-Umgebungsvariable (wird beim
 * Verbinden eines Blob-Stores mit dem Projekt automatisch angelegt).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export const config = {
  maxDuration: 30,
};

const ALLOWED_CONTENT_TYPES = ["image/*", "video/*", "application/pdf"];
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB safety ceiling

// @vercel/blob defaults the client token's validUntil to just 30 seconds
// from now (see generateClientTokenFromReadWriteToken in @vercel/blob's own
// client.js). On a slow mobile connection, uploading a photo/video can easily
// take longer than that — the token then expires mid-upload, vercel.com/api/blob
// rejects the PUT with HTTP 400, and (confirmed via @vercel/blob source +
// https://github.com/vercel/storage/issues/456 and /issues/812) that specific
// error response is NOT sent with an Access-Control-Allow-Origin header, so
// the browser reports it as an opaque CORS failure instead of "Token expired".
// Set generously above our own client-side upload timeout (5 minutes) so the
// token never expires before our own timeout would already have failed it.
const TOKEN_VALID_MS = 10 * 60 * 1000;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as HandleUploadBody;

    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        console.log("[blob-upload-token] token issued for", pathname);
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
          validUntil: Date.now() + TOKEN_VALID_MS,
        };
      },
      onUploadCompleted: async ({ blob }) => {
        // Vercel calls this asynchronously (server-to-server) once the direct
        // browser upload lands in Blob storage — independent of the client's
        // own upload()/fetch() calls, purely for diagnosis in Vercel logs.
        console.log("[blob-upload-token] upload completed:", blob.url);
      },
    });

    res.status(200).json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload-Token konnte nicht erzeugt werden.";
    console.error("[blob-upload-token]", message);
    res.status(400).json({ error: message });
  }
}
