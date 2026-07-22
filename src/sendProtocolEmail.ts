/**
 * Browser helper: send protocol PDF through the Resend proxy (no API key here).
 */

import {
  EMAIL_SEND_ENDPOINT,
  PROTOCOL_EMAIL_BODY,
  PROTOCOL_EMAIL_SUBJECT,
  isKnownEmailSenderId,
} from "./emailConfig";

export interface SendProtocolEmailInput {
  senderId: string;
  to: string;
  filename: string;
  pdfBase64: string;
}

export interface SendProtocolEmailResult {
  ok: boolean;
  error?: string;
  id?: string | null;
}

export async function sendProtocolEmail(
  input: SendProtocolEmailInput
): Promise<SendProtocolEmailResult> {
  if (!isKnownEmailSenderId(input.senderId)) {
    return { ok: false, error: "Ungültiger Absender." };
  }
  const to = input.to.trim();
  if (!to) {
    return { ok: false, error: "Bitte Empfänger-E-Mail eingeben." };
  }

  try {
    const response = await fetch(EMAIL_SEND_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderId: input.senderId,
        to,
        filename: input.filename,
        pdfBase64: input.pdfBase64,
        subject: PROTOCOL_EMAIL_SUBJECT,
        text: PROTOCOL_EMAIL_BODY,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      id?: string | null;
    };

    if (!response.ok || payload.ok === false) {
      return {
        ok: false,
        error: payload.error?.trim() || `E-Mail-Versand fehlgeschlagen (HTTP ${response.status}).`,
      };
    }

    return { ok: true, id: payload.id ?? null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "E-Mail-Versand fehlgeschlagen.",
    };
  }
}
