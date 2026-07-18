/** Step-by-step diagnostics for media capture/storage (esp. Safari / WebKit). */

export type MediaDiagStep =
  | "capture-received"
  | "process-start"
  | "process-photo-decode"
  | "process-photo-canvas"
  | "process-photo-toblob"
  | "process-photo-fallback-original"
  | "process-video"
  | "process-done"
  | "idb-ready"
  | "idb-clone-blob"
  | "idb-put-start"
  | "idb-put-done"
  | "storage-estimate"
  | "error";

export interface MediaDiagContext {
  diagnosisId: string;
  kind: "photo" | "video";
  fileName: string;
  fileType: string;
  fileSize: number;
  userAgent: string;
  platform: string;
  steps: string[];
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function createMediaDiagnosisId(): string {
  const t = new Date();
  const stamp = `${t.getHours().toString().padStart(2, "0")}${t.getMinutes().toString().padStart(2, "0")}${t.getSeconds().toString().padStart(2, "0")}`;
  return `MED-${stamp}-${shortId()}`;
}

export function createMediaDiagContext(
  kind: "photo" | "video",
  file: Blob,
  diagnosisId = createMediaDiagnosisId()
): MediaDiagContext {
  const asFile = file as File;
  return {
    diagnosisId,
    kind,
    fileName: typeof asFile.name === "string" ? asFile.name : "(blob)",
    fileType: file.type || "(empty)",
    fileSize: file.size,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "(n/a)",
    platform: typeof navigator !== "undefined" ? navigator.platform : "(n/a)",
    steps: [],
  };
}

export function mediaDiagLog(
  ctx: MediaDiagContext,
  step: MediaDiagStep,
  detail?: Record<string, unknown>
): void {
  const line = `[media-diag ${ctx.diagnosisId}] ${step}`;
  ctx.steps.push(step);
  if (detail) {
    console.info(line, {
      kind: ctx.kind,
      fileName: ctx.fileName,
      fileType: ctx.fileType,
      fileSize: ctx.fileSize,
      userAgent: ctx.userAgent,
      platform: ctx.platform,
      ...detail,
    });
  } else {
    console.info(line, {
      kind: ctx.kind,
      fileName: ctx.fileName,
      fileType: ctx.fileType,
      fileSize: ctx.fileSize,
    });
  }
}

export function mediaDiagError(ctx: MediaDiagContext, step: MediaDiagStep, error: unknown): void {
  const err = normalizeError(error);
  mediaDiagLog(ctx, "error", {
    failedStep: step,
    errorName: err.name,
    errorMessage: err.message,
    errorStack: err.stack ?? "(none)",
  });
  console.error(`[media-diag ${ctx.diagnosisId}] FAILED at ${step}`, err);
}

export function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === "string" ? error : "Unbekannter Fehler");
}

export async function logStorageEstimate(ctx: MediaDiagContext): Promise<void> {
  try {
    if (!navigator.storage?.estimate) {
      mediaDiagLog(ctx, "storage-estimate", { available: false });
      return;
    }
    const estimate = await navigator.storage.estimate();
    mediaDiagLog(ctx, "storage-estimate", {
      usage: estimate.usage ?? null,
      quota: estimate.quota ?? null,
      usageMb: estimate.usage != null ? Math.round(estimate.usage / 1048576) : null,
      quotaMb: estimate.quota != null ? Math.round(estimate.quota / 1048576) : null,
    });
  } catch (error) {
    mediaDiagLog(ctx, "storage-estimate", {
      failed: true,
      error: normalizeError(error).message,
    });
  }
}

/** User-visible technical summary (short enough for a phone screenshot). */
export function formatMediaDiagUserMessage(ctx: MediaDiagContext, error: unknown): string {
  const err = normalizeError(error);
  const lastStep = ctx.steps.filter((s) => s !== "error").pop() ?? "?";
  return [
    "Speichern fehlgeschlagen.",
    `Diagnose-ID: ${ctx.diagnosisId}`,
    `Fehler: ${err.name}`,
    `Meldung: ${err.message}`,
    `Datei: ${ctx.kind} | ${ctx.fileType} | ${Math.round(ctx.fileSize / 1024)} KB`,
    `Step: ${lastStep}`,
  ].join("\n");
}

export class MediaCaptureError extends Error {
  readonly diagnosisId: string;
  readonly technicalMessage: string;
  readonly userMessage: string;

  constructor(ctx: MediaDiagContext, cause: unknown) {
    const err = normalizeError(cause);
    const userMessage = formatMediaDiagUserMessage(ctx, err);
    super(userMessage);
    this.name = "MediaCaptureError";
    this.diagnosisId = ctx.diagnosisId;
    this.technicalMessage = `${err.name}: ${err.message}`;
    this.userMessage = userMessage;
  }
}
