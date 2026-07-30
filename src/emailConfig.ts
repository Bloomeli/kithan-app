/**
 * Client-side email config.
 * The actual From address is resolved server-side in api/send-protocol-email.ts.
 * Never put RESEND_API_KEY here.
 */

export const EMAIL_SEND_ENDPOINT = "/api/send-protocol-email";

/** Fixed, non-editable Absender address — no employee selection needed. */
export const FIXED_SENDER_EMAIL = "info@kithan.de";

/** Placeholder copy — swap when final wording is ready. */
export const PROTOCOL_EMAIL_SUBJECT = "Übergabeprotokoll im Anhang";
export const PROTOCOL_EMAIL_BODY = "Übergabeprotokoll im Anhang";
