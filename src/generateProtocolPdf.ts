import { jsPDF } from "jspdf";

export interface ProtocolPdfRoom {
  label: string;
  ok: boolean;
  ausstattung: string;
  maengel: string;
  bemerkungen: string;
}

export interface ProtocolPdfElectricityMeter {
  meterNumber: string;
  htReading: string;
  ntReading: string;
  notes: string;
}

export interface ProtocolPdfStandardMeter {
  title: string;
  meterNumber: string;
  reading: string;
  location?: string;
  notes: string;
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
  }
): void {
  writer.addSection("Unterschriften");
  writer.addLine("Datum", formatDateDe(data.signatureDatum));

  writer.addSubsection("Vermieter");
  writer.addLine("Name in Druckbuchstaben", data.vermieterDruckbuchstaben);
  writer.addSignatureBody(data.vermieterSignaturePng);

  writer.addSubsection("Mieter");
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

export interface ProtocolPdfCompanyRoom {
  label: string;
  /** Fotos dieses Raums in Aufnahme-Reihenfolge. Videos gehören NICHT hierher (siehe generateCompanyProtocolPdf). */
  photos: Blob[];
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
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Foto konnte nicht dekodiert werden."));
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

async function addCompanyPhotoSections(writer: PdfWriter, rooms: ProtocolPdfCompanyRoom[]): Promise<void> {
  const roomsWithPhotos = rooms.filter((room) => room.photos.length > 0);
  writer.addSection("Fotos");
  if (roomsWithPhotos.length === 0) {
    writer.addWrapped("Keine Fotos vorhanden.");
    return;
  }
  for (const room of roomsWithPhotos) {
    writer.addSubsection(room.label);
    for (let i = 0; i < room.photos.length; i += 1) {
      const caption = `${room.label} – Foto ${i + 1}`;
      try {
        await addSinglePhotoToPdf(writer, room.photos[i], caption);
      } catch (error) {
        // Ein einzelnes fehlerhaftes Foto (z.B. Decode-Problem) darf das
        // gesamte Firmen-PDF nicht zum Absturz bringen — stattdessen Platzhalter-
        // Text und weiter mit dem nächsten Foto.
        console.error(`[generateProtocolPdf] Firmen-PDF: Foto konnte nicht eingebettet werden (${caption}):`, error);
        writer.addWrapped(`(${caption}: konnte nicht eingebettet werden)`);
      }
    }
  }
}

/**
 * Schreibt den kompletten Text-Teil des Protokolls (Kopfdaten, Räume,
 * Zählerstände, Abschluss, Schlüsselübergabe, Unterschriften) auf den
 * übergebenen Writer. Gemeinsam genutzt von der Mieter-Version (nur Text,
 * siehe generateAndDownloadProtocolPdf) und der Firmen-Version (Text +
 * anschließend Fotos, siehe generateCompanyProtocolPdf) — beide Versionen
 * sollen hier textlich immer identisch bleiben.
 */
function writeProtocolBody(writer: PdfWriter, input: ProtocolPdfInput): void {
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
    input.rooms.forEach((room) => {
      writer.addSubsection(room.label);
      writer.addLine("In Ordnung", room.ok ? "ja" : "nein");
      writer.addLine("Ausstattung", room.ausstattung);
      writer.addLine("Festgestellte Mängel", room.maengel);
      writer.addLine("Bemerkungen", room.bemerkungen);
      writer.addBlank(2);
    });
  }

  writer.addSection("Zählerstände");
  if (input.electricityMeters.length === 0 && input.standardMeters.length === 0) {
    writer.addWrapped("Keine Zählerstände erfasst.");
  } else {
    input.electricityMeters.forEach((meter, index) => {
      writer.addSubsection(`Stromzähler ${index + 1}`);
      writer.addLine("Zählernummer", meter.meterNumber);
      writer.addLine("HT", meter.htReading);
      writer.addLine("NT", meter.ntReading);
      writer.addLine("Bemerkungen", meter.notes);
      writer.addBlank(2);
    });
    input.standardMeters.forEach((meter, index) => {
      writer.addSubsection(`${meter.title} ${index + 1}`);
      if (meter.location !== undefined) {
        writer.addLine("Bezeichnung/Standort", meter.location);
      }
      writer.addLine("Zählernummer", meter.meterNumber);
      writer.addLine("Zählerstand", meter.reading);
      writer.addLine("Bemerkungen", meter.notes);
      writer.addBlank(2);
    });
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

export function generateAndDownloadProtocolPdf(input: ProtocolPdfInput): ProtocolPdfBytes {
  const writer = new PdfWriter();
  writeProtocolBody(writer, input);

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
 * Firmen-Version des Protokolls: identischer Text-Teil wie die Mieter-
 * Version, anschließend die aufgenommenen Fotos (gruppiert nach Raum, mit
 * Bildunterschrift "<Raum> – Foto <n>"), gruppiert und ausgerichtet wie in
 * Schritt 6 festgelegt. Videos werden bewusst NIE eingebettet — sie bleiben
 * ausschließlich als separate Mediendateien auf dem Server (Schritt 5:
 * Vorgangs-/Dateinamenslogik). Diese Version geht an den Firmenserver, NICHT
 * per E-Mail an den Mieter (siehe generateAndDownloadProtocolPdf dafür).
 */
export async function generateCompanyProtocolPdf(
  input: ProtocolPdfInput,
  photoRooms: ProtocolPdfCompanyRoom[]
): Promise<ProtocolPdfBytes> {
  const writer = new PdfWriter();
  writeProtocolBody(writer, input);
  await addCompanyPhotoSections(writer, photoRooms);

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
  writer.addLine("Name des Mieters", input.mietername);
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

  writeSignatureSection(writer, input);

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
