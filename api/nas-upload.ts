/**
 * Vercel serverless proxy: browser → this function → Synology WebDAV.
 * Credentials stay in Vercel env vars only (never returned to the client).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = {
  api: {
    bodyParser: false,
  },
  maxDuration: 60,
};

const TARGET_FOLDER = "Kithan Vermietung";
const MAX_BYTES = 4.5 * 1024 * 1024; // Vercel Hobby request body limit (~4.5 MB)

function getEnv(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    throw new Error(`Server-Konfiguration unvollständig (${name}).`);
  }
  return value;
}

function joinWebDavUrl(base: string, ...segments: string[]): string {
  const root = base.replace(/\/+$/, "");
  const path = segments
    .flatMap((segment) => segment.split("/").filter(Boolean))
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${root}/${path}`;
}

function extensionFor(mimeType: string, kind: string): string {
  const mime = mimeType.toLowerCase();
  if (mime.includes("jpeg") || mime.includes("jpg")) {
    return ".jpg";
  }
  if (mime.includes("png")) {
    return ".png";
  }
  if (mime.includes("webp")) {
    return ".webp";
  }
  if (mime.includes("heic") || mime.includes("heif")) {
    return ".heic";
  }
  if (mime.includes("mp4")) {
    return ".mp4";
  }
  if (mime.includes("quicktime") || mime.includes("mov")) {
    return ".mov";
  }
  if (mime.includes("webm")) {
    return ".webm";
  }
  return kind === "video" ? ".mp4" : ".jpg";
}

function sanitizeFileToken(value: string, fallback: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return cleaned.slice(0, 80) || fallback;
}

function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > MAX_BYTES) {
        reject(Object.assign(new Error("Datei zu groß für den Upload-Proxy (max. ca. 4,5 MB)."), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", (error) => reject(error));
  });
}

function basicAuthHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
}

async function ensureFolder(
  folderUrl: string,
  auth: string
): Promise<void> {
  const response = await fetch(folderUrl, {
    method: "MKCOL",
    headers: {
      Authorization: auth,
    },
  });
  // 201 created, 405/409 already exists — all acceptable
  if (response.ok || response.status === 405 || response.status === 409 || response.status === 301) {
    return;
  }
  // Some Synology setups return 403 for existing collections; try PUT anyway.
  if (response.status === 403) {
    return;
  }
  const text = await response.text().catch(() => "");
  throw Object.assign(
    new Error(`NAS-Ordner konnte nicht angelegt werden (HTTP ${response.status}).`),
    { statusCode: 502, detail: text.slice(0, 200) }
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const nasUrl = getEnv("NAS_WEBDAV_URL");
    const nasUser = getEnv("NAS_WEBDAV_USER");
    const nasPassword = getEnv("NAS_WEBDAV_PASSWORD");
    const auth = basicAuthHeader(nasUser, nasPassword);

    const mediaId = sanitizeFileToken(String(req.headers["x-kithan-media-id"] ?? ""), "media");
    const kindRaw = String(req.headers["x-kithan-kind"] ?? "photo").toLowerCase();
    const kind = kindRaw === "video" ? "video" : "photo";
    const ownerKey = sanitizeFileToken(String(req.headers["x-kithan-owner"] ?? ""), "owner");
    const mimeType = String(req.headers["content-type"] ?? "").split(";")[0].trim() ||
      (kind === "video" ? "video/mp4" : "image/jpeg");

    if (!mimeType.startsWith("image/") && !mimeType.startsWith("video/")) {
      res.status(400).json({ ok: false, error: "Nur Bild- oder Videodateien sind erlaubt." });
      return;
    }

    const body = await readRawBody(req);
    if (body.length === 0) {
      res.status(400).json({ ok: false, error: "Leerer Upload-Body." });
      return;
    }

    const ext = extensionFor(mimeType, kind);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${kind}-${ownerKey}-${mediaId}-${stamp}${ext}`;
    const folderUrl = joinWebDavUrl(nasUrl, TARGET_FOLDER);
    const fileUrl = joinWebDavUrl(nasUrl, TARGET_FOLDER, fileName);
    const remotePath = `${TARGET_FOLDER}/${fileName}`;

    await ensureFolder(folderUrl, auth);

    const putResponse = await fetch(fileUrl, {
      method: "PUT",
      headers: {
        Authorization: auth,
        "Content-Type": mimeType,
        "Content-Length": String(body.length),
      },
      body,
    });

    if (!putResponse.ok && putResponse.status !== 201 && putResponse.status !== 204) {
      const detail = await putResponse.text().catch(() => "");
      console.error("[nas-upload] WebDAV PUT failed", putResponse.status, detail.slice(0, 300));
      res.status(502).json({
        ok: false,
        error: `NAS-Upload fehlgeschlagen (HTTP ${putResponse.status}).`,
      });
      return;
    }

    res.status(200).json({
      ok: true,
      remotePath,
      bytes: body.length,
    });
  } catch (error) {
    const statusCode =
      error && typeof error === "object" && "statusCode" in error
        ? Number((error as { statusCode: number }).statusCode)
        : 500;
    const message =
      error instanceof Error ? error.message : "Unbekannter Serverfehler beim NAS-Upload.";
    // Never echo credentials or full env.
    console.error("[nas-upload]", message);
    res.status(Number.isFinite(statusCode) ? statusCode : 500).json({
      ok: false,
      error: message,
    });
  }
}
