/** Foto/Video capture controls for room and meter cards (local IndexedDB only). */

import { deleteMedia, getMediaForOwner, type MediaKind, type MediaRecord } from "./mediaStore";
import { captureAndStoreMedia } from "./mediaService";

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

function createThumbnailItem(
  record: MediaRecord,
  objectUrl: string,
  onRemove: () => void
): HTMLDivElement {
  const item = document.createElement("div");
  item.className = "media-thumb-item";

  if (record.kind === "photo") {
    const img = document.createElement("img");
    img.className = "media-thumb";
    img.src = objectUrl;
    img.alt = "Foto-Vorschau";
    item.appendChild(img);
  } else {
    const video = document.createElement("video");
    video.className = "media-thumb";
    video.src = objectUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    item.appendChild(video);

    const badge = document.createElement("span");
    badge.className = "media-thumb-badge";
    badge.textContent = "Video";
    item.appendChild(badge);
  }

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "media-thumb-remove";
  removeButton.setAttribute("aria-label", "Medium entfernen");
  removeButton.textContent = "×";
  removeButton.addEventListener("click", onRemove);
  item.appendChild(removeButton);

  return item;
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
      const url = URL.createObjectURL(record.blob);
      objectUrls.add(url);
      thumbs.appendChild(
        createThumbnailItem(record, url, async () => {
          try {
            await deleteMedia(record.id);
            await reload();
          } catch (error) {
            console.error(error);
          }
        })
      );
    }
  };

  const handleCapture = async (kind: MediaKind, file: File | undefined): Promise<void> => {
    if (!file) {
      return;
    }
    const sessionKey = getSessionKey();
    if (!sessionKey) {
      return;
    }

    try {
      await captureAndStoreMedia({ sessionKey, ownerKey, kind, file });
      await reload();
    } catch (error) {
      console.error(error);
    }
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

/** Meter card header: title + Foto/Video inline, thumbnails below. */
export function createMeterMediaHeader(
  title: string,
  getSessionKey: () => string | null,
  ownerKey: string
): { root: HTMLDivElement; media: CardMediaControls } {
  const block = document.createElement("div");
  block.className = "meter-media-header";

  const row = document.createElement("div");
  row.className = "meter-media-row";

  const heading = document.createElement("h4");
  heading.textContent = title;
  row.appendChild(heading);

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

  return { root: block, media: { root: block, reload } };
}
