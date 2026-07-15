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
  besichtigungsdatum: string;
  maengelStatus: string;
  rooms: ProtocolPdfRoom[];
  electricityMeters: ProtocolPdfElectricityMeter[];
  standardMeters: ProtocolPdfStandardMeter[];
  bemerkungenSonstiges: string;
  keyLines: ProtocolPdfKeyLine[];
  signatureDatum: string;
  vermieterSignaturePng: string | null;
  mieterSignaturePng: string | null;
  zeugeName: string;
  zeugeAnschrift: string;
}

const MARGIN = 16;
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINE_HEIGHT = 5.5;
const SECTION_GAP = 4;

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

  addSignatureImage(label: string, dataUrl: string | null): void {
    this.addSubsection(label);
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
}

export function generateAndDownloadProtocolPdf(input: ProtocolPdfInput): void {
  const writer = new PdfWriter();

  writer.addTitle(`Protokoll ${input.protokollartLabel} – ${input.objektartLabel}`);
  writer.addLine("Objektart", input.objektartLabel);
  writer.addLine("Protokollart", input.protokollartLabel);

  writer.addSection("Kopfdaten");
  writer.addLine("Name der/des Mieter(s)", input.mietername);
  writer.addLine("Wohnung/Einheit", input.wohnungEinheit);
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

  writer.addSection("Unterschriften");
  writer.addLine("Datum", formatDateDe(input.signatureDatum));
  writer.addSignatureImage("Vermieter", input.vermieterSignaturePng);
  writer.addSignatureImage("Mieter", input.mieterSignaturePng);
  writer.addSubsection("Zeuge(n)");
  writer.addLine("Name", input.zeugeName);
  writer.addLine("Anschrift", input.zeugeAnschrift);

  writer.getDocument().save(buildFilename(input));
}
