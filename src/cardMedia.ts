/** Foto/Video capture controls for room and meter cards (IndexedDB + Server-Upload). */

import { deleteMedia, getMediaForOwner, type MediaKind, type MediaRecord } from "./mediaStore";
import { captureAndStoreMedia, uploadMediaRecord } from "./mediaService";
import { MediaCaptureError } from "./mediaDiagnostics";

export interface CardMediaControls {
  root: HTMLDivElement;
  reload: () => Promise<void>;
}

function createCaptureInput(kind: MediaKind): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  input.className = "media-capture-input";
  input.accept = kind === "photo" ? "image/*" : "video/*";
  input.setAttribute("capture", "environment");
  input.hidden = true;
  return input;
}

function isVideoRecord(record: MediaRecord): boolean {
  return record.kind === "video" || record.mimeType.startsWith("video/");
}

/** Copy blob bytes with an explicit MIME type — fixes WebKit img+IndexedDB blank previews. */
async function rebuildBlob(blob: Blob, mimeType: string): Promise<Blob> {
  const type = mimeType || blob.type || "application/octet-stream";
  const buffer = await blob.arrayBuffer();
  return new Blob([buffer], { type });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Data-URL konnte nicht erzeugt werden."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader fehlgeschlagen."));
    reader.readAsDataURL(blob);
  });
}

/** Corner-bracket icon matching the usual video fullscreen control look. */
function createExpandIcon(): HTMLSpanElement {
  const icon = document.createElement("span");
  icon.className = "media-expand-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" focusable="false">' +
    '<path fill="currentColor" d="M3 9V3h6v2H5v4H3zm6 12H3v-6h2v4h4v2zm12-6v6h-6v-2h4v-4h2zm-6-12h6v6h-2V5h-4V3z"/>' +
    "</svg>";
  return icon;
}

/**
 * Photo expand/collapse — mirrors native video fullscreen corners via a lightbox
 * (Fullscreen API is unreliable for <img> on iOS).
 */
function createPhotoExpandControl(sourceImg: HTMLImageElement): HTMLButtonElement {
  const expandButton = document.createElement("button");
  expandButton.type = "button";
  expandButton.className = "media-thumb-expand";
  expandButton.setAttribute("aria-label", "Foto vergrößern");
  expandButton.setAttribute("aria-expanded", "false");
  expandButton.appendChild(createExpandIcon());

  let overlay: HTMLDivElement | null = null;

  const closeLightbox = (): void => {
    if (!overlay) {
      return;
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
    overlay.remove();
    overlay = null;
    expandButton.classList.remove("is-expanded");
    expandButton.setAttribute("aria-label", "Foto vergrößern");
    expandButton.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", onKeyDown);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      closeLightbox();
    }
  };

  const openLightbox = (): void => {
    if (overlay) {
      return;
    }

    overlay = document.createElement("div");
    overlay.className = "media-photo-lightbox";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Foto-Vollansicht");

    const bigImg = document.createElement("img");
    bigImg.className = "media-photo-lightbox-img";
    bigImg.src = sourceImg.currentSrc || sourceImg.src;
    bigImg.alt = sourceImg.alt || "Foto-Vorschau";

    const collapseButton = document.createElement("button");
    collapseButton.type = "button";
    collapseButton.className = "media-thumb-expand is-expanded media-photo-lightbox-toggle";
    collapseButton.setAttribute("aria-label", "Foto verkleinern");
    collapseButton.setAttribute("aria-expanded", "true");
    collapseButton.appendChild(createExpandIcon());
    collapseButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeLightbox();
    });

    overlay.append(bigImg, collapseButton);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeLightbox();
      }
    });

    document.body.appendChild(overlay);
    expandButton.classList.add("is-expanded");
    expandButton.setAttribute("aria-label", "Foto verkleinern");
    expandButton.setAttribute("aria-expanded", "true");
    document.addEventListener("keydown", onKeyDown);

    // Prefer real fullscreen where the browser allows it (desktop); overlay remains as base.
    const root = overlay;
    const req =
      root.requestFullscreen?.bind(root) ??
      (root as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen?.bind(
        root
      );
    if (req) {
      void Promise.resolve(req()).catch(() => {
        /* Overlay already visible — ignore fullscreen rejection (common on iOS). */
      });
    }
  };

  expandButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (overlay) {
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
      closeLightbox();
      return;
    }
    openLightbox();
  });

  return expandButton;
}

function createUploadStatusRow(
  record: MediaRecord,
  onRetry: () => void
): HTMLDivElement | null {
  const status = record.uploadStatus;
  if (!status || status === "pending") {
    return null;
  }

  const row = document.createElement("div");
  row.className = "media-upload-status";

  if (status === "uploading") {
    row.classList.add("is-uploading");
    row.textContent = "Wird auf den Server übertragen…";
    return row;
  }

  if (status === "uploaded") {
    row.classList.add("is-success");
    row.textContent = "✅ Medien erfolgreich hochgeladen.";
    return row;
  }

  if (status === "failed") {
    row.classList.add("is-error");
    const message = document.createElement("p");
    message.className = "media-upload-status-message";
    message.textContent =
      "⚠ Server momentan nicht erreichbar. Die Datei wurde lokal gespeichert und kann später erneut übertragen werden.";
    row.appendChild(message);

    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.className = "btn-media media-upload-retry";
    retryButton.textContent = "Erneut hochladen";
    retryButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onRetry();
    });
    row.appendChild(retryButton);
    return row;
  }

  return null;
}

async function createThumbnailItem(
  record: MediaRecord,
  onRemove: () => void,
  onRetryUpload: () => void,
  trackObjectUrl: (url: string) => void
): Promise<HTMLDivElement> {
  const wrap = document.createElement("div");
  wrap.className = "media-thumb-wrap";

  const item = document.createElement("div");
  item.className = "media-thumb-item";

  if (isVideoRecord(record)) {
    item.classList.add("media-thumb-item--video");

    const objectUrl = URL.createObjectURL(record.blob);
    trackObjectUrl(objectUrl);

    const video = document.createElement("video");
    video.className = "media-thumb media-thumb--video";
    video.src = objectUrl;
    video.controls = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.preload = "auto";
    video.setAttribute("aria-label", "Video-Vorschau");

    // Many mobile browsers leave a black frame until a seek/play;
    // nudge currentTime so a real poster frame appears.
    const paintFrame = (): void => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        return;
      }
      const target = Math.min(0.1, video.duration * 0.05);
      if (video.currentTime < target) {
        try {
          video.currentTime = target;
        } catch {
          // Ignore seek errors on codecs that don't allow it yet.
        }
      }
    };
    video.addEventListener("loadedmetadata", paintFrame);
    video.addEventListener("loadeddata", paintFrame);

    item.appendChild(video);

    const badge = document.createElement("span");
    badge.className = "media-thumb-badge";
    badge.textContent = "Video";
    item.appendChild(badge);
  } else {
    item.classList.add("media-thumb-item--photo");

    const mimeType = record.mimeType || record.blob.type || "image/jpeg";
    const freshBlob = await rebuildBlob(record.blob, mimeType);
    const objectUrl = URL.createObjectURL(freshBlob);
    trackObjectUrl(objectUrl);

    const img = document.createElement("img");
    img.className = "media-thumb media-thumb--photo";
    img.alt = "Foto-Vorschau";
    img.decoding = "async";
    img.src = objectUrl;

    // Fallback: some WebKit builds still fail on blob: URLs for IDB images.
    img.addEventListener("error", () => {
      void blobToDataUrl(freshBlob)
        .then((dataUrl) => {
          if (img.src !== dataUrl) {
            img.src = dataUrl;
          }
        })
        .catch((error) => console.error(error));
    }, { once: true });

    item.appendChild(img);
    item.appendChild(createPhotoExpandControl(img));
  }

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "media-thumb-remove";
  removeButton.setAttribute("aria-label", "Medium entfernen");
  removeButton.textContent = "×";
  removeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onRemove();
  });
  item.appendChild(removeButton);
  wrap.appendChild(item);

  const uploadStatus = createUploadStatusRow(record, onRetryUpload);
  if (uploadStatus) {
    wrap.appendChild(uploadStatus);
  }

  return wrap;
}

function bindMediaControls(
  ownerKey: string,
  getSessionKey: () => string | null,
  actions: HTMLDivElement,
  thumbs: HTMLDivElement,
  photoButton: HTMLButtonElement,
  videoButton: HTMLButtonElement,
  photoInput: HTMLInputElement,
  videoInput: HTMLInputElement
): () => Promise<void> {
  const errorEl = document.createElement("p");
  errorEl.className = "media-capture-error hidden";
  errorEl.setAttribute("role", "alert");
  if (thumbs.parentElement) {
    thumbs.parentElement.insertBefore(errorEl, thumbs);
  } else {
    actions.insertAdjacentElement("afterend", errorEl);
  }

  const showCaptureError = (error: unknown): void => {
    console.error(error);
    if (error instanceof MediaCaptureError) {
      errorEl.textContent = error.userMessage;
    } else {
      const name =
        error && typeof error === "object" && "name" in error
          ? String((error as { name: string }).name)
          : "Error";
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: string }).message)
          : String(error);
      const isQuota =
        name === "QuotaExceededError" ||
        name === "NS_ERROR_DOM_QUOTA_REACHED" ||
        /quota|speicherlimit|storage/i.test(`${name} ${message}`);
      errorEl.textContent = isQuota
        ? [
            "Speichern fehlgeschlagen – möglicherweise ist der Gerätespeicher voll.",
            "Bitte Speicherplatz freigeben und erneut versuchen.",
            `Fehler: ${name}`,
            `Meldung: ${message}`,
          ].join("\n")
        : ["Speichern fehlgeschlagen.", `Fehler: ${name}`, `Meldung: ${message}`].join("\n");
    }
    errorEl.classList.remove("hidden");
  };

  const showUploadError = (): void => {
    errorEl.textContent =
      "⚠ Server momentan nicht erreichbar. Die Datei wurde lokal gespeichert und kann später erneut übertragen werden.";
    errorEl.classList.remove("hidden");
  };

  const clearCaptureError = (): void => {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  };

  const objectUrls = new Set<string>();

  const revokeUrls = (): void => {
    for (const url of objectUrls) {
      URL.revokeObjectURL(url);
    }
    objectUrls.clear();
  };

  const reload = async (): Promise<void> => {
    const sessionKey = getSessionKey();
    revokeUrls();
    thumbs.innerHTML = "";
    if (!sessionKey) {
      return;
    }

    let records: MediaRecord[];
    try {
      records = await getMediaForOwner(sessionKey, ownerKey);
    } catch (error) {
      console.error(error);
      return;
    }

    for (const record of records) {
      try {
        const item = await createThumbnailItem(
          record,
          async () => {
            try {
              await deleteMedia(record.id);
              await reload();
            } catch (error) {
              console.error(error);
            }
          },
          () => {
            void (async () => {
              clearCaptureError();
              try {
                // uploadMediaRecord re-reads + detaches from IndexedDB itself.
                await uploadMediaRecord(record.id);
                clearCaptureError();
                await reload();
              } catch (error) {
                console.error(
                  `[cardMedia] manual retry failed for mediaId=${record.id} kind=${record.kind} — showing "Server momentan nicht erreichbar"`,
                  error
                );
                showUploadError();
                await reload();
              }
            })();
          },
          (url) => {
            objectUrls.add(url);
          }
        );
        thumbs.appendChild(item);
      } catch (error) {
        console.error(error);
      }
    }
  };

  const handleCapture = async (kind: MediaKind, file: File | undefined): Promise<void> => {
    if (!file) {
      return;
    }
    const sessionKey = getSessionKey();
    if (!sessionKey) {
      showCaptureError(new Error("Keine aktive Sitzung für Medienspeicherung."));
      return;
    }

    clearCaptureError();
    let mediaId: string;
    try {
      const result = await captureAndStoreMedia({ sessionKey, ownerKey, kind, file });
      mediaId = result.record.id;
    } catch (error) {
      showCaptureError(error);
      return;
    }

    // Show the new thumbnail right away — don't block on the (potentially
    // slow, multi-hop) server upload, which runs in the background below.
    await reload();

    void (async () => {
      try {
        await uploadMediaRecord(mediaId);
        clearCaptureError();
      } catch (error) {
        console.error(
          `[cardMedia] background upload after capture failed for mediaId=${mediaId} kind=${kind} — showing "Server momentan nicht erreichbar"`,
          error
        );
        showUploadError();
      } finally {
        await reload();
      }
    })();
  };

  photoButton.addEventListener("click", () => {
    photoInput.value = "";
    photoInput.click();
  });
  videoButton.addEventListener("click", () => {
    videoInput.value = "";
    videoInput.click();
  });

  photoInput.addEventListener("change", () => {
    void handleCapture("photo", photoInput.files?.[0]);
  });
  videoInput.addEventListener("change", () => {
    void handleCapture("video", videoInput.files?.[0]);
  });

  actions.append(photoInput, videoInput);
  void reload();
  return reload;
}

function createMediaActionButtons(): {
  actions: HTMLDivElement;
  photoButton: HTMLButtonElement;
  videoButton: HTMLButtonElement;
  photoInput: HTMLInputElement;
  videoInput: HTMLInputElement;
} {
  const actions = document.createElement("div");
  actions.className = "card-media-actions";

  const photoButton = document.createElement("button");
  photoButton.type = "button";
  photoButton.className = "btn-media";
  photoButton.textContent = "Foto";

  const videoButton = document.createElement("button");
  videoButton.type = "button";
  videoButton.className = "btn-media";
  videoButton.textContent = "Video";

  const photoInput = createCaptureInput("photo");
  const videoInput = createCaptureInput("video");

  actions.append(photoButton, videoButton);
  return { actions, photoButton, videoButton, photoInput, videoInput };
}

export function createCardMediaControls(
  getSessionKey: () => string | null,
  ownerKey: string
): CardMediaControls {
  const root = document.createElement("div");
  root.className = "card-media";

  const { actions, photoButton, videoButton, photoInput, videoInput } = createMediaActionButtons();
  const thumbs = document.createElement("div");
  thumbs.className = "media-thumb-list";

  root.append(actions, thumbs);

  const reload = bindMediaControls(
    ownerKey,
    getSessionKey,
    actions,
    thumbs,
    photoButton,
    videoButton,
    photoInput,
    videoInput
  );

  return { root, reload };
}

/** Block with "In Ordnung" + Foto/Video on one row, thumbnails below (rooms). */
export function createRoomOkMediaRow(
  checkboxId: string,
  checked: boolean,
  onOkChange: (checked: boolean) => void,
  getSessionKey: () => string | null,
  ownerKey: string
): { row: HTMLDivElement; media: CardMediaControls } {
  const block = document.createElement("div");
  block.className = "room-ok-media-block";

  const row = document.createElement("div");
  row.className = "room-ok-media-row";

  const okGroup = document.createElement("div");
  okGroup.className = "radio-group room-ok-row";

  const okCheckbox = document.createElement("input");
  okCheckbox.type = "checkbox";
  okCheckbox.id = checkboxId;
  okCheckbox.checked = checked;
  okCheckbox.addEventListener("change", () => {
    onOkChange(okCheckbox.checked);
  });

  const okLabel = document.createElement("label");
  okLabel.htmlFor = okCheckbox.id;
  okLabel.textContent = "In Ordnung (ja)";

  okGroup.append(okCheckbox, okLabel);
  row.appendChild(okGroup);

  const { actions, photoButton, videoButton, photoInput, videoInput } = createMediaActionButtons();
  row.appendChild(actions);

  const thumbs = document.createElement("div");
  thumbs.className = "media-thumb-list";

  block.append(row, thumbs);

  const reload = bindMediaControls(
    ownerKey,
    getSessionKey,
    actions,
    thumbs,
    photoButton,
    videoButton,
    photoInput,
    videoInput
  );

  return { row: block, media: { root: block, reload } };
}
