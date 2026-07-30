/**
 * Send Mieter protocol PDF via Resend.
 * API key stays on the server (RESEND_API_KEY).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = {
  maxDuration: 60,
};

/** Fixed, non-editable Absender address — keep in sync with src/emailConfig.ts. */
const FIXED_SENDER_EMAIL = "info@kithan.de";

const PLACEHOLDER_SUBJECT = "Übergabeprotokoll im Anhang";
const PLACEHOLDER_BODY = "Übergabeprotokoll im Anhang";
const MAX_PDF_BASE64_CHARS = 6_000_000; // ~4.5 MB binary

interface SendBody {
  to?: string;
  filename?: string;
  pdfBase64?: string;
  subject?: string;
  text?: string;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function resolveFrom(): string {
  const email = process.env.RESEND_FROM_EMAIL?.trim() || FIXED_SENDER_EMAIL;
  return email;
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
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      res.status(500).json({ ok: false, error: "Server-Konfiguration unvollständig (RESEND_API_KEY)." });
      return;
    }

    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as SendBody;
    const to = String(body.to ?? "").trim().toLowerCase();
    const filename = String(body.filename ?? "Protokoll.pdf").trim() || "Protokoll.pdf";
    const pdfBase64 = String(body.pdfBase64 ?? "").replace(/\s+/g, "");
    const subject = String(body.subject ?? PLACEHOLDER_SUBJECT).trim() || PLACEHOLDER_SUBJECT;
    const text = String(body.text ?? PLACEHOLDER_BODY).trim() || PLACEHOLDER_BODY;

    if (!isValidEmail(to)) {
      res.status(400).json({ ok: false, error: "Ungültige Empfänger-E-Mail-Adresse." });
      return;
    }
    if (!pdfBase64 || pdfBase64.length > MAX_PDF_BASE64_CHARS) {
      res.status(400).json({ ok: false, error: "PDF-Anhang fehlt oder ist zu groß." });
      return;
    }

    const from = resolveFrom();
    const safeFilename = filename.replace(/[^\w.\-äöüÄÖÜß ()]+/g, "_").slice(0, 120);

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        attachments: [
          {
            filename: safeFilename.endsWith(".pdf") ? safeFilename : `${safeFilename}.pdf`,
            content: pdfBase64,
          },
        ],
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
      error?: string;
    };

    if (!response.ok) {
      const message =
        payload.message ||
        payload.error ||
        `E-Mail-Versand fehlgeschlagen (HTTP ${response.status}).`;
      console.error("[send-protocol-email] Resend error", response.status, message);
      res.status(502).json({ ok: false, error: message });
      return;
    }

    res.status(200).json({
      ok: true,
      id: payload.id ?? null,
    });
  } catch (error) {
    const statusCode =
      error && typeof error === "object" && "statusCode" in error
        ? Number((error as { statusCode: number }).statusCode)
        : 500;
    const message =
      error instanceof Error ? error.message : "Unbekannter Fehler beim E-Mail-Versand.";
    console.error("[send-protocol-email]", message);
    res.status(Number.isFinite(statusCode) ? statusCode : 500).json({
      ok: false,
      error: message,
    });
  }
}
