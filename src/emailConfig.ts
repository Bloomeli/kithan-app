/**
 * Client-side email sender allowlist (labels/ids only).
 * Real From addresses are resolved server-side in api/send-protocol-email.ts.
 * Never put RESEND_API_KEY here.
 */

export interface EmailSenderOption {
  id: string;
  label: string;
}

/**
 * Fixed Absender combinations (company + employee).
 * Placeholder list — final names/addresses to follow.
 */
export const EMAIL_SENDERS: EmailSenderOption[] = [
  { id: "kithan-gmbh-katrin", label: "Kithan GmbH + Katrin" },
  { id: "kithan-gmbh-sascha", label: "Kithan GmbH + Sascha" },
  { id: "kithan-grundstuecks-katrin", label: "Kithan Grundstücks- und Handels GmbH + Katrin" },
  { id: "kithan-grundstuecks-sascha", label: "Kithan Grundstücks- und Handels GmbH + Sascha" },
  { id: "kithan-leopoldstrasse-katrin", label: "Kithan Leopoldstraße GmbH + Katrin" },
  { id: "kithan-erlangen-sascha", label: "Kithan Erlangen GmbH + Sascha" },
  { id: "kita-projekt-koeln-katrin", label: "Kita Projekt Köln + Katrin" },
  { id: "kithan-koeln-hyazinthenweg-sascha", label: "Kithan Köln GmbH Hyazinthenweg + Sascha" },
];

export const EMAIL_SEND_ENDPOINT = "/api/send-protocol-email";

/** Placeholder copy — swap when final wording is ready. */
export const PROTOCOL_EMAIL_SUBJECT = "Übergabeprotokoll im Anhang";
export const PROTOCOL_EMAIL_BODY = "Übergabeprotokoll im Anhang";

export function isKnownEmailSenderId(id: string): boolean {
  return EMAIL_SENDERS.some((sender) => sender.id === id);
}
