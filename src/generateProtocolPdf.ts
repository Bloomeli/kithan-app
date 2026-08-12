import { jsPDF } from "jspdf";
import { photoBelongsToSection, sequenceLetter } from "./mediaBinding";

export interface ProtocolPdfRoom {
  label: string;
  ok: boolean;
  ausstattung: string;
  maengel: string;
  bemerkungen: string;
  ownerKey?: string;
}

export interface ProtocolPdfElectricityMeter {
  meterNumber: string;
  htReading: string;
  ntReading: string;
  notes: string;
  ownerKey?: string;
}

export interface ProtocolPdfStandardMeter {
  title: string;
  meterNumber: string;
  reading: string;
  location?: string;
  notes: string;
  ownerKey?: string;
}

export interface ProtocolPdfKeyLine {
  anzahl: string;
  anlagennummer: string;
  ziel: string;
}

export interface ProtocolPdfInput {
  objektartLabel: string;
  protokollartLabel: string;
  keyVerb: string;
  mietername: string;
  wohnungEinheit: string;
  wohnungsnummerLage: string;
  besichtigungsdatum: string;
  maengelStatus: string;
  rooms: ProtocolPdfRoom[];
  electricityMeters: ProtocolPdfElectricityMeter[];
  standardMeters: ProtocolPdfStandardMeter[];
  bemerkungenSonstiges: string;
  keyLines: ProtocolPdfKeyLine[];
  signatureDatum: string;
  vermieterSignaturePng: string | null;
  vermieterDruckbuchstaben: string;
  mieterSignaturePng: string | null;
  mieterDruckbuchstaben: string;
  zeugeName: string;
  zeugeAnschrift: string;
  zeugeSignaturePng: string | null;
}

export interface SchluesselPdfEntry {
  anzahl: string;
  schluesselnummer: string;
}

export interface SchluesselPdfInput {
  protokollartLabel: string;
  mietername: string;
  wohnungEinheit: string;
  wohnungsnummerLage: string;
  besichtigungsdatum: string;
  bemerkungen: string;
  entries: SchluesselPdfEntry[];
  signatureDatum: string;
  vermieterSignaturePng: string | null;
  vermieterDruckbuchstaben: string;
  mieterSignaturePng: string | null;
  mieterDruckbuchstaben: string;
  zeugeName: string;
  zeugeAnschrift: string;
  zeugeSignaturePng: string | null;
}

const MARGIN = 16;
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINE_HEIGHT = 5.5;
const SECTION_GAP = 4;
const CAPTION_LINE_HEIGHT = 6;
const BLOCK_GAP = 5;

// Firmen-PDF-Fotolayout (Schritt 6 des Architekturplans):
// Querformat: bis zu 2 Fotos übereinander pro Seite -> Boxhöhe so gewählt,
// dass 2x(Box + Bildunterschrift + Abstand) sicher auf eine A4-Seite passt.
const COMPANY_PHOTO_LANDSCAPE_BOX_H = 110;
// Hochformat: immer nur 1 Foto pro eigener Seite, möglichst groß.
const COMPANY_PHOTO_PORTRAIT_BOX_H = 250;
// Zielauflösung fürs Firmen-PDF: bewusst deutlich unter der Kamera-
// Originalauflösung (bzw. auch unter der beim Sofort-Upload gespeicherten
// ~2000px-Version), aber hoch genug, dass Schäden/Zählerstände/Räume beim
// A4-Ausdruck weiterhin klar erkennbar bleiben.
const COMPANY_PHOTO_TARGET_DPI = 200;
const COMPANY_PHOTO_MAX_LONG_SIDE_PX = 1700;
const COMPANY_PHOTO_JPEG_QUALITY = 0.82;

function formatDateDe(isoDate: string): string {
  if (!isoDate) {
    return "—";
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match) {
    return `${match[3]}.${match[2]}.${match[1]}`;
  }
  return isoDate;
}

function textOrDash(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "—";
}

function buildFilename(input: ProtocolPdfInput): string {
  const datePart = input.signatureDatum || input.besichtigungsdatum || "ohne-datum";
  const safe = `${input.objektartLabel}_${input.protokollartLabel}_${datePart}`
    .replace(/[^\w\-äöüÄÖÜß]+/g, "_")
    .replace(/_+/g, "_");
  return `Protokoll_${safe}.pdf`;
}

function buildSchluesselFilename(input: SchluesselPdfInput): string {
  const datePart = input.signatureDatum || "ohne-datum";
  const safe = `Schluessel_${input.protokollartLabel}_${datePart}`
    .replace(/[^\w\-äöüÄÖÜß]+/g, "_")
    .replace(/_+/g, "_");
  return `Protokoll_${safe}.pdf`;
}

class PdfWriter {
  private readonly doc: jsPDF;
  private y = MARGIN;

  constructor() {
    this.doc = new jsPDF({ unit: "mm", format: "a4" });
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(11);
  }

  getDocument(): jsPDF {
    return this.doc;
  }

  ensureSpace(neededMm: number): void {
    if (this.y + neededMm > PAGE_HEIGHT - MARGIN) {
      this.doc.addPage();
      this.y = MARGIN;
    }
  }

  addTitle(text: string): void {
    this.ensureSpace(14);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(16);
    this.doc.text(text, MARGIN, this.y);
    this.y += 10;
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(11);
  }

  addSection(title: string): void {
    this.ensureSpace(12);
    this.y += SECTION_GAP;
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(13);
    this.doc.text(title, MARGIN, this.y);
    this.y += 7;
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(11);
  }

  addSubsection(title: string): void {
    this.ensureSpace(10);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(11);
    this.doc.text(title, MARGIN, this.y);
    this.y += 6;
    this.doc.setFont("helvetica", "normal");
  }

  addLine(label: string, value: string): void {
    this.addWrapped(`${label}: ${textOrDash(value)}`);
  }

  addWrapped(text: string): void {
    const lines = this.doc.splitTextToSize(text, CONTENT_WIDTH) as string[];
    for (const line of lines) {
      this.ensureSpace(LINE_HEIGHT);
      this.doc.text(line, MARGIN, this.y);
      this.y += LINE_HEIGHT;
    }
  }

  addBlank(mm = 3): void {
    this.y += mm;
  }

  addSignatureBody(dataUrl: string | null): void {
    if (!dataUrl) {
      this.addWrapped("(keine Unterschrift)");
      this.addBlank(2);
      return;
    }

    const imgWidth = CONTENT_WIDTH;
    const imgHeight = 28;
    this.ensureSpace(imgHeight + 8);
    this.doc.addImage(dataUrl, "PNG", MARGIN, this.y, imgWidth, imgHeight);
    this.y += imgHeight + 6;
  }

  /** True wenn die aktuelle Seite noch komplett leer ist (nichts seit dem letzten addPage geschrieben). */
  isAtPageTop(): boolean {
    return this.y <= MARGIN + 0.01;
  }

  /** Erzwingt eine neue, leere Seite — außer die aktuelle ist ohnehin schon leer. */
  forceNewPage(): void {
    if (!this.isAtPageTop()) {
      this.doc.addPage();
      this.y = MARGIN;
    }
  }

  /**
   * Dezente horizontale Trennlinie über die volle Inhaltsbreite, um im
   * Firmen-PDF benachbarte Raum-/Bereichsblöcke (z.B. "Flur" vs. "Küche")
   * optisch klarer voneinander abzugrenzen. Rein visuell — fügt keinen Text
   * hinzu und ändert an keiner Stelle Reihenfolge oder Inhalt.
   */
  addDivider(): void {
    this.ensureSpace(8);
    this.y += 2;
    this.doc.setDrawColor(200, 200, 200);
    this.doc.setLineWidth(0.2);
    this.doc.line(MARGIN, this.y, MARGIN + CONTENT_WIDTH, this.y);
    this.doc.setDrawColor(0, 0, 0);
    this.y += 4;
  }

  /** Zentriertes Bild (z.B. Foto fürs Firmen-PDF) mit optionaler Bildunterschrift darunter. */
  addImageBlock(dataUrl: string, format: "JPEG" | "PNG", widthMm: number, heightMm: number, caption?: string): void {
    const captionSpace = caption ? CAPTION_LINE_HEIGHT : 0;
    this.ensureSpace(heightMm + captionSpace + BLOCK_GAP);
    const x = MARGIN + (CONTENT_WIDTH - widthMm) / 2;
    this.doc.addImage(dataUrl, format, x, this.y, widthMm, heightMm);
    this.y += heightMm + 3;
    if (caption) {
      this.doc.setFont("helvetica", "italic");
      this.doc.setFontSize(9);
      this.doc.text(caption, MARGIN, this.y);
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(11);
      this.y += CAPTION_LINE_HEIGHT;
    }
    this.y += BLOCK_GAP - 3;
  }
}

function writeSignatureSection(
  writer: PdfWriter,
  data: {
    signatureDatum: string;
    vermieterSignaturePng: string | null;
    vermieterDruckbuchstaben: string;
    mieterSignaturePng: string | null;
    mieterDruckbuchstaben: string;
    zeugeName: string;
    zeugeAnschrift: string;
    zeugeSignaturePng: string | null;
  },
  recipientLabel = "Mieter"
): void {
  writer.addSection("Unterschriften");
  writer.addLine("Datum", formatDateDe(data.signatureDatum));

  writer.addSubsection("Vermieter");
  writer.addLine("Name in Druckbuchstaben", data.vermieterDruckbuchstaben);
  writer.addSignatureBody(data.vermieterSignaturePng);

  writer.addSubsection(recipientLabel);
  writer.addLine("Name in Druckbuchstaben", data.mieterDruckbuchstaben);
  writer.addSignatureBody(data.mieterSignaturePng);

  writer.addSubsection("Zeuge(n)");
  writer.addLine("Name", data.zeugeName);
  writer.addLine("Anschrift", data.zeugeAnschrift);
  writer.addSignatureBody(data.zeugeSignaturePng);
}

export interface ProtocolPdfBytes {
  filename: string;
  /** Raw base64 PDF payload (no data: prefix). */
  base64: string;
}

/**
 * TEMPORÄRE DIAGNOSE (PDF-Ungültig-Fehler auf dem Firmenserver): loggt direkt
 * nach der PDF-Erzeugung, ob der base64-dekodierte Anfang tatsächlich mit
 * "%PDF-" beginnt (Kontrollpunkt 1 von 4, siehe auch blobFtpsUpload.ts und
 * api/ftps-transfer.ts). Rein lesend — verändert weder base64 noch das PDF.
 * Nach Abschluss der Fehlersuche wieder entfernbar.
 */
function debugLogPdfHeader(label: string, base64: string): void {
  try {
    // 20 base64-Zeichen (Vielfaches von 4, keine Padding-Probleme) ergeben
    // 15 dekodierte Bytes — genug für "%PDF-1.x" plus etwas Puffer.
    const chunk = base64.slice(0, 20);
    const decoded = atob(chunk);
    const printable = decoded
      .split("")
      .map((ch) => {
        const code = ch.charCodeAt(0);
        return code >= 0x20 && code <= 0x7e ? ch : `\\x${code.toString(16).padStart(2, "0")}`;
      })
      .join("");
    console.log(
      `[pdf-diag] 1/4 nach PDF-Erzeugung (${label}): base64Length=${base64.length} headerBytes="${printable}" startsWithPdfHeader=${decoded.startsWith("%PDF-")}`
    );
  } catch (error) {
    console.warn(`[pdf-diag] 1/4 nach PDF-Erzeugung (${label}): Header-Check fehlgeschlagen`, error);
  }
}

export interface ProtocolPdfBoundPhoto {
  blob: Blob;
  protocolId: string;
  room: string;
  ownerKey: string;
  sequence: number;
}

export interface ProtocolPdfCompanyRoom {
  label: string;
  ownerKey: string;
  /** Fotos dieses Felds in Capture-Sequenz. Videos gehören NICHT hierher. */
  photos: ProtocolPdfBoundPhoto[];
}

/**
 * Dekodiert einen Foto-Blob über ein <img>-Element und zeichnet ihn auf ein
 * frisches Canvas. Moderne Browser (inkl. Safari/iOS) wenden dabei
 * automatisch die EXIF-Orientation an ("image-orientation: from-image" ist
 * seit einigen Jahren Standardverhalten bei <img>) — das Canvas enthält
 * damit bereits korrekt gedrehte Pixel, egal ob hochkant oder quer
 * aufgenommen wurde, und egal ob das Original noch ein rohes EXIF-Tag trägt
 * (Fallback-Pfad in mediaProcess.ts) oder bereits selbst über Canvas
 * verarbeitet wurde (Normalfall, dort bereits orientierungsfrei). Es wird
 * nirgends manuell um 90° gedreht.
 */
async function loadPhotoCanvasAutoOriented(blob: Blob): Promise<HTMLCanvasElement> {
  // Safari/WebKit: IndexedDB-Blobs nach geschlossener Transaktion oft nicht
  // mehr dekodierbar — Bytes zuerst ablösen (gleiche Idee wie loadMediaForUpload).
  const rawType = (blob.type || "").toLowerCase();
  const mimeType = rawType.startsWith("image/") ? rawType : "image/jpeg";
  let buffer: ArrayBuffer;
  try {
    buffer = await blob.arrayBuffer();
  } catch (error) {
    throw new Error(
      `Foto-Bytes nicht lesbar (type=${blob.type || "(leer)"}, size=${blob.size}): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (!buffer.byteLength) {
    throw new Error(`Foto-Blob ist leer (type=${blob.type || "(leer)"}).`);
  }
  const safeBlob = new Blob([buffer.slice(0)], { type: mimeType });

  // Bevorzugt createImageBitmap (robuster bei MIME/Safari), sonst <img>.
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(safeBlob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        bitmap.close();
        throw new Error("2D-Kontext für PDF-Fotoverarbeitung nicht verfügbar.");
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      if (canvas.width < 1 || canvas.height < 1) {
        throw new Error("Ungültige Bildabmessungen.");
      }
      return canvas;
    } catch {
      // Fallback auf Image-Element unten.
    }
  }

  const url = URL.createObjectURL(safeBlob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () =>
        reject(
          new Error(`Foto konnte nicht dekodiert werden (mime=${mimeType}, bytes=${buffer.byteLength}).`)
        );
      el.src = url;
    });
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (width < 1 || height < 1) {
      throw new Error("Ungültige Bildabmessungen.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D-Kontext für PDF-Fotoverarbeitung nicht verfügbar.");
    }
    ctx.drawImage(image, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Verkleinert (nie vergrößert) ein Canvas auf eine maximale lange Seite, Seitenverhältnis bleibt erhalten. */
function downscaleCanvas(canvas: HTMLCanvasElement, maxLongSidePx: number): HTMLCanvasElement {
  const longSide = Math.max(canvas.width, canvas.height);
  if (longSide <= maxLongSidePx) {
    return canvas;
  }
  const scale = maxLongSidePx / longSide;
  const targetW = Math.max(1, Math.round(canvas.width * scale));
  const targetH = Math.max(1, Math.round(canvas.height * scale));
  const out = document.createElement("canvas");
  out.width = targetW;
  out.height = targetH;
  const ctx = out.getContext("2d");
  if (!ctx) {
    throw new Error("2D-Kontext für PDF-Fotoverarbeitung nicht verfügbar.");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, targetW, targetH);
  return out;
}

/**
 * Bettet ein einzelnes Foto ein: Ausrichtung (Quer-/Hochformat) bestimmt die
 * Zielbox, danach wird proportional verkleinert (nie verzerrt), separat für
 * das PDF neu komprimiert (siehe COMPANY_PHOTO_*-Konstanten) und platziert.
 * Verändert ausschließlich eine Im-Speicher-Kopie — der übergebene Original-
 * Blob (und damit die separat gespeicherte Originaldatei) bleibt unberührt.
 */
async function addSinglePhotoToPdf(writer: PdfWriter, blob: Blob, caption: string): Promise<void> {
  const canvas = await loadPhotoCanvasAutoOriented(blob);
  const isLandscape = canvas.width >= canvas.height;
  const boxH = isLandscape ? COMPANY_PHOTO_LANDSCAPE_BOX_H : COMPANY_PHOTO_PORTRAIT_BOX_H;

  const aspect = canvas.width / canvas.height;
  let drawW = CONTENT_WIDTH;
  let drawH = drawW / aspect;
  if (drawH > boxH) {
    drawH = boxH;
    drawW = drawH * aspect;
  }

  const targetLongSidePx = Math.min(
    COMPANY_PHOTO_MAX_LONG_SIDE_PX,
    Math.round((Math.max(drawW, drawH) / 25.4) * COMPANY_PHOTO_TARGET_DPI)
  );
  const resized = downscaleCanvas(canvas, targetLongSidePx);
  const dataUrl = resized.toDataURL("image/jpeg", COMPANY_PHOTO_JPEG_QUALITY);

  if (isLandscape) {
    // Bis zu 2 pro Seite: nur umbrechen, wenn der verbleibende Platz nicht reicht.
    writer.ensureSpace(drawH + CAPTION_LINE_HEIGHT + BLOCK_GAP);
  } else {
    // Hochformat: nie mit einem zweiten Hochformatfoto oder viel anderem Inhalt teilen.
    writer.forceNewPage();
  }
  writer.addImageBlock(dataUrl, "JPEG", drawW, drawH, caption);
}

/** Ein zugeordnetes Foto konnte nicht in die Firmen-PDF eingebettet werden. */
export class CompanyPhotoEmbedError extends Error {
  readonly caption: string;

  constructor(caption: string) {
    super(`${caption} konnte nicht eingebettet werden – bitte erneut versuchen`);
    this.name = "CompanyPhotoEmbedError";
    this.caption = caption;
  }
}

async function addBoundPhotosToPdf(
  writer: PdfWriter,
  photos: ProtocolPdfBoundPhoto[],
  currentProtocolId: string,
  sectionOwnerKey: string,
  sectionLabel: string
): Promise<void> {
  const eligible = photos.filter((photo) =>
    photoBelongsToSection(
      {
        sessionKey: photo.protocolId,
        protocolId: photo.protocolId,
        ownerKey: photo.ownerKey,
        room: photo.room,
      },
      currentProtocolId,
      sectionOwnerKey,
      sectionLabel
    )
  );
  for (let i = 0; i < eligible.length; i += 1) {
    const photo = eligible[i];
    const captionRoom = (photo.room || sectionLabel).replace(/\//g, "-");
    const caption = `${captionRoom}_${sequenceLetter(i + 1)}`;
    try {
      await addSinglePhotoToPdf(writer, photo.blob, caption);
    } catch (error) {
      console.error(`[generateProtocolPdf] Firmen-PDF: Foto konnte nicht eingebettet werden (${caption}):`, error);
      throw new CompanyPhotoEmbedError(caption);
    }
  }
}

/**
 * Schreibt den Text-Teil des Protokolls. Die Firmen-Version kann je Abschnitt
 * die bereits beim Aufnehmen gebundenen Fotos direkt danach einbetten
 * (kein Sammelblock am Ende). Die Mieter-Version übergibt keine Fotos.
 */
async function writeProtocolBody(
  writer: PdfWriter,
  input: ProtocolPdfInput,
  options?: {
    addRoomDividers?: boolean;
    currentProtocolId?: string;
    photosByOwnerKey?: Map<string, ProtocolPdfBoundPhoto[]>;
  }
): Promise<void> {
  const addRoomDividers = options?.addRoomDividers ?? false;
  const currentProtocolId = options?.currentProtocolId ?? "";
  const photosByOwnerKey = options?.photosByOwnerKey;

  const embedFor = async (ownerKey: string | undefined, sectionLabel: string): Promise<void> => {
    if (!photosByOwnerKey || !currentProtocolId || !ownerKey) {
      return;
    }
    const photos = photosByOwnerKey.get(ownerKey);
    if (!photos?.length) {
      return;
    }
    await addBoundPhotosToPdf(writer, photos, currentProtocolId, ownerKey, sectionLabel);
  };

  writer.addTitle(`Protokoll ${input.protokollartLabel} – ${input.objektartLabel}`);
  writer.addLine("Objektart", input.objektartLabel);
  writer.addLine("Protokollart", input.protokollartLabel);

  writer.addSection("Kopfdaten");
  writer.addLine("Name der/des Mieter(s)", input.mietername);
  writer.addLine("Wohnung/Einheit", input.wohnungEinheit);
  if (input.wohnungsnummerLage) {
    writer.addLine("Wohnungsnummer / Lage", input.wohnungsnummerLage);
  }
  writer.addLine("Datum", formatDateDe(input.besichtigungsdatum));
  writer.addLine("Mängelstatus", input.maengelStatus);

  writer.addSection("Zustand der Räume");
  if (input.rooms.length === 0) {
    writer.addWrapped("Keine Raumdaten erfasst.");
  } else {
    for (let roomIndex = 0; roomIndex < input.rooms.length; roomIndex += 1) {
      const room = input.rooms[roomIndex];
      if (addRoomDividers && roomIndex > 0) {
        writer.addDivider();
      }
      writer.addSubsection(room.label);
      writer.addLine("In Ordnung", room.ok ? "ja" : "nein");
      writer.addLine("Ausstattung", room.ausstattung);
      writer.addLine("Festgestellte Mängel", room.maengel);
      writer.addLine("Bemerkungen", room.bemerkungen);
      await embedFor(room.ownerKey, room.label);
      writer.addBlank(2);
    }
  }

  writer.addSection("Zählerstände");
  if (input.electricityMeters.length === 0 && input.standardMeters.length === 0) {
    writer.addWrapped("Keine Zählerstände erfasst.");
  } else {
    for (let index = 0; index < input.electricityMeters.length; index += 1) {
      const meter = input.electricityMeters[index];
      const sectionLabel = `Stromzähler ${String(index + 1).padStart(2, "0")}`;
      writer.addSubsection(sectionLabel);
      writer.addLine("Zählernummer", meter.meterNumber);
      writer.addLine("HT", meter.htReading);
      writer.addLine("NT", meter.ntReading);
      writer.addLine("Bemerkungen", meter.notes);
      await embedFor(meter.ownerKey, sectionLabel);
      writer.addBlank(2);
    }
    const standardMeterIndexByTitle = new Map<string, number>();
    for (const meter of input.standardMeters) {
      const nextIndex = (standardMeterIndexByTitle.get(meter.title) ?? 0) + 1;
      standardMeterIndexByTitle.set(meter.title, nextIndex);
      const sectionLabel = `${meter.title} ${String(nextIndex).padStart(2, "0")}`;
      writer.addSubsection(sectionLabel);
      if (meter.location !== undefined) {
        writer.addLine("Bezeichnung/Standort", meter.location);
      }
      writer.addLine("Zählernummer", meter.meterNumber);
      writer.addLine("Zählerstand", meter.reading);
      writer.addLine("Bemerkungen", meter.notes);
      await embedFor(meter.ownerKey, sectionLabel);
      writer.addBlank(2);
    }
  }

  writer.addSection("Abschluss");
  writer.addLine("Bemerkungen/Sonstiges", input.bemerkungenSonstiges);

  writer.addSection("Schlüsselübergabe");
  if (input.keyLines.length === 0) {
    writer.addWrapped("Keine Schlüsselangaben erfasst.");
  } else {
    input.keyLines.forEach((line) => {
      writer.addWrapped(
        `Es wurden ${textOrDash(line.anzahl)} Schlüssel mit der Anlagennummer ${textOrDash(line.anlagennummer)} für ${textOrDash(line.ziel)} ${input.keyVerb}.`
      );
      writer.addBlank(1);
    });
  }

  writeSignatureSection(writer, input);
}

export async function generateAndDownloadProtocolPdf(input: ProtocolPdfInput): Promise<ProtocolPdfBytes> {
  const writer = new PdfWriter();
  await writeProtocolBody(writer, input);

  const filename = buildFilename(input);
  const doc = writer.getDocument();
  const dataUri = doc.output("datauristring") as string;
  const comma = dataUri.indexOf(",");
  const base64 = comma >= 0 ? dataUri.slice(comma + 1) : dataUri;
  debugLogPdfHeader(`Mieter-PDF ${filename}`, base64);
  // Deliberately NOT calling doc.save(filename) here: on an iOS/iPadOS
  // "Zum Home-Bildschirm"-PWA (standalone display mode, no browser tabs),
  // jsPDF's save() opens the generated PDF in Safari's built-in full-screen
  // PDF viewer INSIDE the single app WebView — effectively replacing/
  // suspending the running app page. Since finishProtocolAsPdf() immediately
  // continues with the network upload (Blob token request + FTPS transfer)
  // right after this function returns, that suspension was cutting the
  // upload off mid-request (observed as a misleading "access control
  // checks"/CORS error on the token fetch). The PDF only needs to exist as
  // base64 in memory here — for the FTPS upload and the tenant email
  // attachment, both of which use the return value below, not a local file.
  return { filename, base64 };
}

/**
 * Firmen-Version: identischer Text wie die Mieter-Version, Fotos aber direkt
 * unter dem jeweiligen Raum/Zähler — nur mit passender protocolId + Raum.
 */
export async function generateCompanyProtocolPdf(
  input: ProtocolPdfInput,
  photoRooms: ProtocolPdfCompanyRoom[],
  currentProtocolId: string
): Promise<ProtocolPdfBytes> {
  const photosByOwnerKey = new Map<string, ProtocolPdfBoundPhoto[]>();
  for (const section of photoRooms) {
    if (!section.ownerKey) {
      continue;
    }
    photosByOwnerKey.set(section.ownerKey, section.photos);
  }
  const writer = new PdfWriter();
  await writeProtocolBody(writer, input, {
    addRoomDividers: true,
    currentProtocolId,
    photosByOwnerKey,
  });

  const filename = `Firma_${buildFilename(input)}`;
  const doc = writer.getDocument();
  const dataUri = doc.output("datauristring") as string;
  const comma = dataUri.indexOf(",");
  const base64 = comma >= 0 ? dataUri.slice(comma + 1) : dataUri;
  debugLogPdfHeader(`Firmen-PDF ${filename}`, base64);
  return { filename, base64 };
}

export function generateAndDownloadSchluesselPdf(input: SchluesselPdfInput): { filename: string; base64: string } {
  const writer = new PdfWriter();

  writer.addTitle(`Protokoll ${input.protokollartLabel} – Schlüssel`);
  writer.addLine("Protokollart", input.protokollartLabel);

  writer.addSection("Kopfdaten");
  writer.addLine("Name des Empfängers", input.mietername);
  writer.addLine("Wohnung/Einheit", input.wohnungEinheit);
  if (input.wohnungsnummerLage) {
    writer.addLine("Wohnungsnummer / Lage", input.wohnungsnummerLage);
  }
  writer.addLine("Datum", formatDateDe(input.besichtigungsdatum));

  writer.addSection("Schlüssel");
  if (input.entries.length === 0) {
    writer.addWrapped("Keine Schlüsselangaben erfasst.");
  } else {
    input.entries.forEach((entry, index) => {
      writer.addSubsection(`Schlüssel ${index + 1}`);
      writer.addLine("Anzahl der Schlüssel", entry.anzahl);
      writer.addLine("Schlüsselnummer", entry.schluesselnummer);
      writer.addBlank(2);
    });
  }

  writer.addSection("Sonstiges/Bemerkungen");
  writer.addWrapped(textOrDash(input.bemerkungen));

  writeSignatureSection(writer, input, "Schlüsselempfänger");

  const filename = buildSchluesselFilename(input);
  const doc = writer.getDocument();
  const dataUri = doc.output("datauristring") as string;
  const comma = dataUri.indexOf(",");
  const base64 = comma >= 0 ? dataUri.slice(comma + 1) : dataUri;
  debugLogPdfHeader(`Schlüssel-PDF ${filename}`, base64);
  // Bewusst KEIN doc.save(filename) — siehe identische Begründung bei
  // generateAndDownloadProtocolPdf oben: öffnet auf iOS/iPadOS-PWA Safaris
  // Vollbild-PDF-Vorschau und unterbricht dadurch den direkt danach
  // startenden Server-Upload. Das PDF existiert nur noch als Base64 im
  // Speicher, für den FTPS-Upload und den Mieter-E-Mail-Versand.
  return { filename, base64 };
}

/**
 * Schlüssel-Firmen-PDF: gleicher Text wie generateAndDownloadSchluesselPdf,
 * zusätzlich die dem Vorgang zugeordneten Fotos (Schlüssel 01, 02, …).
 * Schlägt die Einbettung eines Fotos fehl, wird CompanyPhotoEmbedError geworfen.
 */
export async function generateCompanySchluesselPdf(
  input: SchluesselPdfInput,
  photos: ProtocolPdfBoundPhoto[],
  currentProtocolId: string
): Promise<ProtocolPdfBytes> {
  const writer = new PdfWriter();

  writer.addTitle(`Protokoll ${input.protokollartLabel} – Schlüssel`);
  writer.addLine("Protokollart", input.protokollartLabel);

  writer.addSection("Kopfdaten");
  writer.addLine("Name des Empfängers", input.mietername);
  writer.addLine("Wohnung/Einheit", input.wohnungEinheit);
  if (input.wohnungsnummerLage) {
    writer.addLine("Wohnungsnummer / Lage", input.wohnungsnummerLage);
  }
  writer.addLine("Datum", formatDateDe(input.besichtigungsdatum));

  writer.addSection("Schlüssel");
  if (input.entries.length === 0) {
    writer.addWrapped("Keine Schlüsselangaben erfasst.");
  } else {
    input.entries.forEach((entry, index) => {
      writer.addSubsection(`Schlüssel ${index + 1}`);
      writer.addLine("Anzahl der Schlüssel", entry.anzahl);
      writer.addLine("Schlüsselnummer", entry.schluesselnummer);
      writer.addBlank(2);
    });
  }

  const eligible = photos.filter((photo) =>
    photoBelongsToSection(
      {
        sessionKey: photo.protocolId,
        protocolId: photo.protocolId,
        ownerKey: photo.ownerKey,
        room: photo.room,
      },
      currentProtocolId,
      "schluessel",
      "Schlüssel"
    )
  );
  for (let i = 0; i < eligible.length; i += 1) {
    const photo = eligible[i];
    const caption = `Schlüssel ${String(i + 1).padStart(2, "0")}`;
    try {
      await addSinglePhotoToPdf(writer, photo.blob, caption);
    } catch (error) {
      console.error(`[generateProtocolPdf] Schlüssel-PDF: Foto konnte nicht eingebettet werden (${caption}):`, error);
      throw new CompanyPhotoEmbedError(caption);
    }
  }

  writer.addSection("Sonstiges/Bemerkungen");
  writer.addWrapped(textOrDash(input.bemerkungen));

  writeSignatureSection(writer, input, "Schlüsselempfänger");

  const filename = `Firma_${buildSchluesselFilename(input)}`;
  const doc = writer.getDocument();
  const dataUri = doc.output("datauristring") as string;
  const comma = dataUri.indexOf(",");
  const base64 = comma >= 0 ? dataUri.slice(comma + 1) : dataUri;
  debugLogPdfHeader(`Schlüssel-Firmen-PDF ${filename}`, base64);
  return { filename, base64 };
}
