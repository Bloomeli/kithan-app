// Kithan Vermietung – Anwendungslogik (Prototyp)
// Ablauf: Objektart wählen -> Protokollart wählen -> Formular (Kopfdaten + Räume)

import { SignaturePad } from "./signaturePad";
import { createCardMediaControls, createRoomOkMediaRow } from "./cardMedia";
import { deleteMediaForOwner, deleteMediaForSession, runMediaDbSelfTest } from "./mediaStore";
import {
  generateAndDownloadProtocolPdf,
  generateAndDownloadSchluesselPdf,
  type ProtocolPdfInput,
  type ProtocolPdfKeyLine,
  type ProtocolPdfRoom,
  type ProtocolPdfStandardMeter,
  type SchluesselPdfEntry,
  type SchluesselPdfInput,
} from "./generateProtocolPdf";
import { sendProtocolEmail } from "./sendProtocolEmail";
import { uploadProtocolArchive, type ProtocolArchiveUploadResult } from "./protocolArchiveUpload";
import { acquireUploadWakeLock, releaseUploadWakeLock } from "./wakeLock";

type Objektart = "schluessel" | "gewerbe" | "privat" | "garage";
type Protokollart = "uebergabe" | "ruecknahme";
type LegacyProtokollart = Protokollart | "abnahme";

interface RaumConfig {
  id: string;
  label: string;
}

const RAEUME: Record<Exclude<Objektart, "schluessel">, RaumConfig[]> = {
  privat: [
    { id: "flur", label: "Flur" },
    { id: "kueche", label: "Küche" },
    { id: "bad-wc", label: "Bad/WC" },
    { id: "buero", label: "Büro" },
    { id: "wohnzimmer", label: "Wohnzimmer" },
    { id: "balkon", label: "Balkon" },
    { id: "schlafzimmer", label: "Schlafzimmer" },
    { id: "kinderzimmer", label: "Kinderzimmer" },
    { id: "keller", label: "Keller" },
  ],
  gewerbe: [
    { id: "flur", label: "Flur" },
    { id: "kueche", label: "Küche" },
    { id: "bad-wc", label: "Bad/WC" },
    { id: "balkon", label: "Balkon" },
    { id: "keller", label: "Keller" },
  ],
  garage: [],
};

const OBJEKTART_LABELS: Record<Objektart, string> = {
  schluessel: "Schlüssel",
  gewerbe: "Gewerbe",
  privat: "Privat",
  garage: "Garage",
};

const PROTOKOLLART_LABELS: Record<Protokollart, string> = {
  uebergabe: "Übergabe",
  ruecknahme: "Rücknahme",
};

// Jedes Objekt behält sein bisheriges "label" (unverändert für Anzeige/PDF/Entwürfe),
// ergänzt um einzelne Adressfelder (strasse/hausnummer/plz/ort/zusatz) für die
// künftige strukturierte Vorgangs-Ordner-/Dateinamenbildung (siehe Implementierungsplan).
// "zusatz" ist der bisherige Klammerzusatz im Label (z.B. "Lager", "Duplex", "Kita") oder "".
const OBJEKTE = [
  {
    id: "adalbertstrasse-104",
    label: "Adalbertstraße 104, 80798 München",
    strasse: "Adalbertstraße",
    hausnummer: "104",
    plz: "80798",
    ort: "München",
    zusatz: "",
  },
  {
    id: "adelheidstr-24",
    label: "Adelheidstr. 24, 80798 München",
    strasse: "Adelheidstr.",
    hausnummer: "24",
    plz: "80798",
    ort: "München",
    zusatz: "",
  },
  {
    id: "elisabethstrasse-8",
    label: "Elisabethstraße 8, 80739 München",
    strasse: "Elisabethstraße",
    hausnummer: "8",
    plz: "80739",
    ort: "München",
    zusatz: "",
  },
  {
    id: "goethestr-3",
    label: "Goethestr. 3, 80336 München",
    strasse: "Goethestr.",
    hausnummer: "3",
    plz: "80336",
    ort: "München",
    zusatz: "",
  },
  {
    id: "guntherstr-15",
    label: "Guntherstr. 15, 80639 München",
    strasse: "Guntherstr.",
    hausnummer: "15",
    plz: "80639",
    ort: "München",
    zusatz: "",
  },
  {
    id: "herrnstrasse-44",
    label: "Herrnstraße 44, 80539 München",
    strasse: "Herrnstraße",
    hausnummer: "44",
    plz: "80539",
    ort: "München",
    zusatz: "",
  },
  {
    id: "herzogstrasse-5",
    label: "Herzogstraße 5 (Lager), 80331 München",
    strasse: "Herzogstraße",
    hausnummer: "5",
    plz: "80331",
    ort: "München",
    zusatz: "Lager",
  },
  {
    id: "ismaninger-str-17-19",
    label: "Ismaninger Str. 17-19 (Duplex), 81675 München",
    strasse: "Ismaninger Str.",
    hausnummer: "17-19",
    plz: "81675",
    ort: "München",
    zusatz: "Duplex",
  },
  {
    id: "maximiliansplatz-12a",
    label: "Maximiliansplatz 12a, 80333 München",
    strasse: "Maximiliansplatz",
    hausnummer: "12a",
    plz: "80333",
    ort: "München",
    zusatz: "",
  },
  {
    id: "steinstrasse-57",
    label: "Steinstraße 57, 81667 München",
    strasse: "Steinstraße",
    hausnummer: "57",
    plz: "81667",
    ort: "München",
    zusatz: "",
  },
  {
    id: "zenettistr-26",
    label: "Zenettistr. 26, 80337 München",
    strasse: "Zenettistr.",
    hausnummer: "26",
    plz: "80337",
    ort: "München",
    zusatz: "",
  },
  {
    id: "koenigsstrasse-8",
    label: "Königsstraße 8 (Lager Dach), 93047 Regensburg",
    strasse: "Königsstraße",
    hausnummer: "8",
    plz: "93047",
    ort: "Regensburg",
    zusatz: "Lager Dach",
  },
  {
    id: "despagstrasse-4-4a",
    label: "Despagstraße 4-4a, 85055 Ingolstadt",
    strasse: "Despagstraße",
    hausnummer: "4-4a",
    plz: "85055",
    ort: "Ingolstadt",
    zusatz: "",
  },
  {
    id: "spandauer-str-160b",
    label: "Spandauer Str. 160b, 14612 Falkensee",
    strasse: "Spandauer Str.",
    hausnummer: "160b",
    plz: "14612",
    ort: "Falkensee",
    zusatz: "",
  },
  {
    id: "spandauer-str-160c",
    label: "Spandauer Str. 160c, 14612 Falkensee",
    strasse: "Spandauer Str.",
    hausnummer: "160c",
    plz: "14612",
    ort: "Falkensee",
    zusatz: "",
  },
  {
    id: "berliner-str-35-55",
    label: "Berliner Str. 35-55, 14612 Falkensee",
    strasse: "Berliner Str.",
    hausnummer: "35-55",
    plz: "14612",
    ort: "Falkensee",
    zusatz: "",
  },
  {
    id: "aberstr-23",
    label: "Aberstr. 23, 81679 München",
    strasse: "Aberstr.",
    hausnummer: "23",
    plz: "81679",
    ort: "München",
    zusatz: "",
  },
  {
    id: "delpstr-4",
    label: "Delpstr. 4 (BüroVilla), 81679 München",
    strasse: "Delpstr.",
    hausnummer: "4",
    plz: "81679",
    ort: "München",
    zusatz: "BüroVilla",
  },
  {
    id: "georgenstrasse-3",
    label: "Georgenstraße 3, 80799 München",
    strasse: "Georgenstraße",
    hausnummer: "3",
    plz: "80799",
    ort: "München",
    zusatz: "",
  },
  {
    id: "georgenstrasse-3-rgb",
    label: "Georgenstraße 3 RGB, 80799 München",
    strasse: "Georgenstraße",
    hausnummer: "3",
    plz: "80799",
    ort: "München",
    zusatz: "RGB",
  },
  {
    id: "goethestrasse-8",
    label: "Goethestraße 8, 80336 München",
    strasse: "Goethestraße",
    hausnummer: "8",
    plz: "80336",
    ort: "München",
    zusatz: "",
  },
  {
    id: "seidlstrasse-8",
    label: "Seidlstraße 8, 80335 München",
    strasse: "Seidlstraße",
    hausnummer: "8",
    plz: "80335",
    ort: "München",
    zusatz: "",
  },
  {
    id: "kaufinger-strasse-17",
    label: "Kaufinger Straße 17 (Einzelhandel), 80331 München",
    strasse: "Kaufinger Straße",
    hausnummer: "17",
    plz: "80331",
    ort: "München",
    zusatz: "Einzelhandel",
  },
  {
    id: "leopoldstrasse-41",
    label: "Leopoldstraße 41, 80802 München",
    strasse: "Leopoldstraße",
    hausnummer: "41",
    plz: "80802",
    ort: "München",
    zusatz: "",
  },
  {
    id: "nuernberger-str-24-26",
    label: "Nürnberger Str. 24-26 (Außenstellplätze), 91052 Erlangen",
    strasse: "Nürnberger Str.",
    hausnummer: "24-26",
    plz: "91052",
    ort: "Erlangen",
    zusatz: "Außenstellplätze",
  },
  {
    id: "michael-vogel-str-1a",
    label: "Michael-Vogel-Str. 1a, 91052 Erlangen",
    strasse: "Michael-Vogel-Str.",
    hausnummer: "1a",
    plz: "91052",
    ort: "Erlangen",
    zusatz: "",
  },
  {
    id: "michael-vogel-str-1b",
    label: "Michael-Vogel-Str. 1b, 91052 Erlangen",
    strasse: "Michael-Vogel-Str.",
    hausnummer: "1b",
    plz: "91052",
    ort: "Erlangen",
    zusatz: "",
  },
  {
    id: "michael-vogel-str-1c",
    label: "Michael-Vogel-Str. 1c, 91052 Erlangen",
    strasse: "Michael-Vogel-Str.",
    hausnummer: "1c",
    plz: "91052",
    ort: "Erlangen",
    zusatz: "",
  },
  {
    id: "michael-vogel-str-1d",
    label: "Michael-Vogel-Str. 1d, 91052 Erlangen",
    strasse: "Michael-Vogel-Str.",
    hausnummer: "1d",
    plz: "91052",
    ort: "Erlangen",
    zusatz: "",
  },
  {
    id: "michael-vogel-str-1e",
    label: "Michael-Vogel-Str. 1e, 91052 Erlangen",
    strasse: "Michael-Vogel-Str.",
    hausnummer: "1e",
    plz: "91052",
    ort: "Erlangen",
    zusatz: "",
  },
  {
    id: "auf-dem-streitacker-32-34",
    label: "Auf dem Streitacker 32-34 (Kita), 51149 Köln",
    strasse: "Auf dem Streitacker",
    hausnummer: "32-34",
    plz: "51149",
    ort: "Köln",
    zusatz: "Kita",
  },
  {
    id: "hyazinthenweg-10-12",
    label: "Hyazinthenweg 10-12, 51069 Köln",
    strasse: "Hyazinthenweg",
    hausnummer: "10-12",
    plz: "51069",
    ort: "Köln",
    zusatz: "",
  },
] as const;

const DEFAULT_SUBTITLE = "Übergabe & Rücknahme Protokolle";

const STORAGE_KEYS = {
  objektart: "kithan_objektart",
  protokollart: "kithan_protokollart",
  namedDrafts: "kithan_named_drafts",
} as const;

const FORM_DRAFT_PREFIX = "kithan_form_";
const MAX_NAMED_DRAFTS = 20;

interface RoomDraft {
  ok: boolean;
  ausstattung: string;
  maengel: string;
  bemerkungen: string;
}

interface KopfdatenDraft {
  vermieter: string;
  mietername: string;
  gebaeudeAuswahl: string;
  /** Konkrete Wohnung/Einheit INNERHALB des unter gebaeudeAuswahl gewählten Gebäudes (z.B. "WHG 07", "EG links", "Büro 3"). Nur bei Privat/Gewerbe verpflichtend. */
  wohnungsnummerLage: string;
  besichtigungsdatum: string;
  maengelStatus: "" | "keine" | "folgende";
}

interface GarageRoomEntry {
  id: string;
  ok: boolean;
  ausstattung: string;
  maengel: string;
  bemerkungen: string;
}

interface BueroRoomEntry {
  id: string;
  ok: boolean;
  ausstattung: string;
  maengel: string;
  bemerkungen: string;
}

interface WeitereRaumEntry {
  id: string;
  ok: boolean;
  ausstattung: string;
  maengel: string;
  bemerkungen: string;
}

interface SchluesselEntry {
  anzahl: string;
  schluesselnummer: string;
}

interface SchluesselDraft {
  mietername: string;
  wohnungEinheit: string;
  bemerkungen: string;
  entries: SchluesselEntry[];
}

interface KeyHandoverLine {
  anzahl: string;
  anlagennummer: string;
}

interface KeyHandoverExtraLine extends KeyHandoverLine {
  id: string;
  ziel: string;
}

interface ClosingDraft {
  bemerkungenSonstiges: string;
  keysMieteinheit: KeyHandoverLine;
  keysGebaeude: KeyHandoverLine;
  keysBriefkasten: KeyHandoverLine;
  keysExtra: KeyHandoverExtraLine[];
}

/**
 * Unterschriften-Bereich (Datum, Namen in Druckbuchstaben, Unterschrift-PNGs,
 * Zeuge) — muss im Entwurf gespeichert werden, da der Mieter beim erneuten
 * Öffnen eines Entwurfs (z.B. nach Zwischenspeichern) möglicherweise nicht
 * mehr vor Ort ist, um erneut zu unterschreiben.
 */
interface SignaturesDraft {
  signatureDatum: string;
  vermieterDruckbuchstaben: string;
  vermieterSignaturePng: string | null;
  mieterDruckbuchstaben: string;
  mieterSignaturePng: string | null;
  zeugeName: string;
  zeugeAnschrift: string;
  zeugeSignaturePng: string | null;
}

interface FormDraft {
  kopfdaten: KopfdatenDraft;
  rooms: Record<string, RoomDraft>;
  meters: MeterState | null;
  garageRooms: GarageRoomEntry[] | null;
  bueroRooms: BueroRoomEntry[] | null;
  weitereRaeume: WeitereRaumEntry[] | null;
  schluessel: SchluesselDraft | null;
  closing: ClosingDraft | null;
  signatures: SignaturesDraft | null;
}

function formDraftKey(objektart: Objektart, protokollart: Protokollart): string {
  return `${FORM_DRAFT_PREFIX}${objektart}_${protokollart}`;
}

function emptyKopfdaten(): KopfdatenDraft {
  return {
    vermieter: "",
    mietername: "",
    gebaeudeAuswahl: "",
    wohnungsnummerLage: "",
    besichtigungsdatum: "",
    maengelStatus: "",
  };
}

function emptyRoomDraft(): RoomDraft {
  return { ok: false, ausstattung: "", maengel: "", bemerkungen: "" };
}

function normalizeRoomDraft(raw: Partial<RoomDraft> | undefined): RoomDraft {
  return {
    ok: raw?.ok ?? false,
    ausstattung: raw?.ausstattung ?? "",
    maengel: raw?.maengel ?? "",
    bemerkungen: raw?.bemerkungen ?? "",
  };
}

function normalizeRoomsMap(rooms: Record<string, Partial<RoomDraft>>): Record<string, RoomDraft> {
  const normalized: Record<string, RoomDraft> = {};
  for (const [id, room] of Object.entries(rooms)) {
    normalized[id] = normalizeRoomDraft(room);
  }
  return normalized;
}

function emptySchluesselEntry(): SchluesselEntry {
  return { anzahl: "", schluesselnummer: "" };
}

function emptySchluesselDraft(): SchluesselDraft {
  return {
    mietername: "",
    wohnungEinheit: "",
    bemerkungen: "",
    entries: [emptySchluesselEntry()],
  };
}

type LegacySchluesselDraft = Partial<SchluesselDraft> & {
  anzahl?: string;
  schluesselnummer?: string;
};

function normalizeSchluesselDraft(raw: LegacySchluesselDraft | null | undefined): SchluesselDraft | null {
  if (!raw) {
    return null;
  }

  let entries: SchluesselEntry[];
  if (Array.isArray(raw.entries) && raw.entries.length > 0) {
    entries = raw.entries.slice(0, 2).map((entry) => ({
      anzahl: entry.anzahl ?? "",
      schluesselnummer: entry.schluesselnummer ?? "",
    }));
  } else {
    entries = [
      {
        anzahl: raw.anzahl ?? "",
        schluesselnummer: raw.schluesselnummer ?? "",
      },
    ];
  }

  if (entries.length === 0) {
    entries = [emptySchluesselEntry()];
  }

  return {
    mietername: raw.mietername ?? "",
    wohnungEinheit: raw.wohnungEinheit ?? "",
    bemerkungen: raw.bemerkungen ?? "",
    entries,
  };
}

function emptyKeyHandoverLine(): KeyHandoverLine {
  return { anzahl: "", anlagennummer: "" };
}

function createKeyHandoverExtraLine(): KeyHandoverExtraLine {
  return { id: generateId("key-extra"), anzahl: "", anlagennummer: "", ziel: "" };
}

function emptyClosingDraft(): ClosingDraft {
  return {
    bemerkungenSonstiges: "",
    keysMieteinheit: emptyKeyHandoverLine(),
    keysGebaeude: emptyKeyHandoverLine(),
    keysBriefkasten: emptyKeyHandoverLine(),
    keysExtra: [createKeyHandoverExtraLine()],
  };
}

function normalizeKeyHandoverLine(raw: Partial<KeyHandoverLine> | undefined): KeyHandoverLine {
  return {
    anzahl: raw?.anzahl ?? "",
    anlagennummer: raw?.anlagennummer ?? "",
  };
}

function normalizeClosingDraft(raw: Partial<ClosingDraft> | null | undefined): ClosingDraft | null {
  if (!raw) {
    return null;
  }
  const extras = Array.isArray(raw.keysExtra)
    ? raw.keysExtra.map((entry) => ({
        id: entry.id || generateId("key-extra"),
        anzahl: entry.anzahl ?? "",
        anlagennummer: entry.anlagennummer ?? "",
        ziel: entry.ziel ?? "",
      }))
    : [];
  return {
    bemerkungenSonstiges: raw.bemerkungenSonstiges ?? "",
    keysMieteinheit: normalizeKeyHandoverLine(raw.keysMieteinheit),
    keysGebaeude: normalizeKeyHandoverLine(raw.keysGebaeude),
    keysBriefkasten: normalizeKeyHandoverLine(raw.keysBriefkasten),
    keysExtra: extras.length > 0 ? extras : [createKeyHandoverExtraLine()],
  };
}

function normalizeSignaturesDraft(raw: Partial<SignaturesDraft> | null | undefined): SignaturesDraft | null {
  if (!raw) {
    return null;
  }
  return {
    signatureDatum: raw.signatureDatum ?? "",
    vermieterDruckbuchstaben: raw.vermieterDruckbuchstaben ?? "",
    vermieterSignaturePng: raw.vermieterSignaturePng ?? null,
    mieterDruckbuchstaben: raw.mieterDruckbuchstaben ?? "",
    mieterSignaturePng: raw.mieterSignaturePng ?? null,
    zeugeName: raw.zeugeName ?? "",
    zeugeAnschrift: raw.zeugeAnschrift ?? "",
    zeugeSignaturePng: raw.zeugeSignaturePng ?? null,
  };
}

function emptyFormDraft(): FormDraft {
  return {
    kopfdaten: emptyKopfdaten(),
    rooms: {},
    meters: null,
    garageRooms: null,
    bueroRooms: null,
    weitereRaeume: null,
    schluessel: null,
    closing: null,
    signatures: null,
  };
}

function getCurrentFormContext(): { objektart: Objektart; protokollart: Protokollart } | null {
  const objektart = localStorage.getItem(STORAGE_KEYS.objektart);
  const protokollart = normalizeProtokollart(localStorage.getItem(STORAGE_KEYS.protokollart));
  if (!isObjektart(objektart) || !protokollart) {
    return null;
  }
  if (localStorage.getItem(STORAGE_KEYS.protokollart) === "abnahme") {
    localStorage.setItem(STORAGE_KEYS.protokollart, protokollart);
  }
  return { objektart, protokollart };
}

function loadFormDraft(objektart: Objektart, protokollart: Protokollart): FormDraft {
  const primaryKey = formDraftKey(objektart, protokollart);
  let raw = localStorage.getItem(primaryKey);

  if (!raw && protokollart === "ruecknahme") {
    const legacyKey = `${FORM_DRAFT_PREFIX}${objektart}_abnahme`;
    raw = localStorage.getItem(legacyKey);
    if (raw) {
      localStorage.setItem(primaryKey, raw);
      localStorage.removeItem(legacyKey);
    }
  }

  if (!raw) {
    return emptyFormDraft();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<FormDraft>;
    // Legacy-Migration: das frühere freie "Bemerkung"-Feld in den Kopfdaten
    // wurde in "Wohnungsnummer / Lage" umgewandelt (nie im PDF ausgegeben,
    // daher unkritisch) — bereits gespeicherte Alt-Entwürfe übernehmen ihren
    // bisherigen Bemerkungstext automatisch in das neue Pflichtfeld.
    const rawKopfdaten = (parsed.kopfdaten ?? {}) as Partial<KopfdatenDraft> & { bemerkung?: string };
    return {
      kopfdaten: {
        ...emptyKopfdaten(),
        ...rawKopfdaten,
        wohnungsnummerLage: rawKopfdaten.wohnungsnummerLage ?? rawKopfdaten.bemerkung ?? "",
      },
      rooms: normalizeRoomsMap(parsed.rooms ?? {}),
      meters: parsed.meters ?? null,
      garageRooms: parsed.garageRooms ?? null,
      bueroRooms: parsed.bueroRooms ?? null,
      weitereRaeume: parsed.weitereRaeume ?? null,
      schluessel: normalizeSchluesselDraft(parsed.schluessel),
      closing: normalizeClosingDraft(parsed.closing),
      signatures: normalizeSignaturesDraft(parsed.signatures),
    };
  } catch {
    return emptyFormDraft();
  }
}

function saveFormDraft(objektart: Objektart, protokollart: Protokollart, draft: FormDraft): void {
  localStorage.setItem(formDraftKey(objektart, protokollart), JSON.stringify(draft));
}

function updateCurrentFormDraft(mutator: (draft: FormDraft) => void): void {
  const context = getCurrentFormContext();
  if (!context) {
    return;
  }
  const draft = loadFormDraft(context.objektart, context.protokollart);
  mutator(draft);
  saveFormDraft(context.objektart, context.protokollart, draft);
}

function persistMeters(): void {
  updateCurrentFormDraft((draft) => {
    draft.meters = JSON.parse(JSON.stringify(meterState)) as MeterState;
  });
}

function persistClosing(): void {
  updateCurrentFormDraft((draft) => {
    draft.closing = JSON.parse(JSON.stringify(closingState)) as ClosingDraft;
  });
}

function clearAllFormDrafts(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(FORM_DRAFT_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => {
    localStorage.removeItem(key);
    void deleteMediaForSession(key).catch((error) => console.error(error));
  });
}

function getMediaSessionKey(): string | null {
  const context = getCurrentFormContext();
  if (!context) {
    return null;
  }
  return formDraftKey(context.objektart, context.protokollart);
}

async function removeOwnerMedia(ownerKey: string): Promise<void> {
  const sessionKey = getMediaSessionKey();
  if (!sessionKey) {
    return;
  }
  try {
    await deleteMediaForOwner(sessionKey, ownerKey);
  } catch (error) {
    console.error(error);
  }
}

// --- Explizite Entwürfe (getrennt vom Session-Autosave) -----------------

interface NamedProtocolDraft {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  objektart: Objektart;
  protokollart: Protokollart;
  form: FormDraft;
}

function loadNamedDrafts(): NamedProtocolDraft[] {
  const raw = localStorage.getItem(STORAGE_KEYS.namedDrafts);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as Array<NamedProtocolDraft & { protokollart: LegacyProtokollart }>;
    if (!Array.isArray(parsed)) {
      return [];
    }

    let changed = false;
    const drafts = parsed.flatMap((item) => {
      const rawProtokollart = item.protokollart as LegacyProtokollart;
      const protokollart = normalizeProtokollart(rawProtokollart);
      if (!protokollart || !isObjektart(item.objektart)) {
        return [];
      }
      if (rawProtokollart === "abnahme") {
        changed = true;
      }
      return [
        {
          ...item,
          name: typeof item.name === "string" ? item.name : "",
          objektart: item.objektart,
          protokollart,
        },
      ];
    });

    if (changed) {
      saveNamedDrafts(drafts);
    }
    return drafts;
  } catch {
    return [];
  }
}

function saveNamedDrafts(drafts: NamedProtocolDraft[]): void {
  localStorage.setItem(STORAGE_KEYS.namedDrafts, JSON.stringify(drafts));
}

function getGebaeudeLabel(value: string): string {
  if (!value) {
    return "";
  }
  const match = OBJEKTE.find((objekt) => objekt.id === value);
  if (match) {
    return match.label;
  }
  const select = document.getElementById("gebaeude-auswahl") as HTMLSelectElement | null;
  if (!select) {
    return value;
  }
  const option = Array.from(select.options).find((item) => item.value === value);
  return option?.textContent?.trim() || value;
}

function populateGebaeudeSelect(): void {
  const select = requireElement<HTMLSelectElement>("gebaeude-auswahl");
  const previousValue = select.value;

  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.disabled = true;
  placeholder.textContent = "Bitte Gebäude wählen...";
  select.appendChild(placeholder);

  OBJEKTE.forEach((objekt) => {
    const option = document.createElement("option");
    option.value = objekt.id;
    option.textContent = objekt.label;
    select.appendChild(option);
  });

  if (previousValue && OBJEKTE.some((objekt) => objekt.id === previousValue)) {
    select.value = previousValue;
  } else {
    placeholder.selected = true;
  }
}

function formatDraftTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getNamedDraftDisplayTitle(draft: NamedProtocolDraft): string {
  const customName = draft.name.trim();
  if (customName) {
    return customName;
  }

  if (draft.objektart === "schluessel") {
    const mieter = draft.form.schluessel?.mietername.trim() || "";
    if (mieter) {
      return `${mieter} – Schlüssel`;
    }
    return "Schlüssel";
  }

  const mieter = draft.form.kopfdaten.mietername.trim();
  const adresse = getGebaeudeLabel(draft.form.kopfdaten.gebaeudeAuswahl);
  if (mieter && adresse) {
    return `${mieter} – ${adresse}`;
  }
  if (mieter) {
    return mieter;
  }
  if (adresse) {
    return adresse;
  }
  return "Unbenannter Entwurf";
}

function syncCurrentFormToSessionDraft(): FormDraft | null {
  const context = getCurrentFormContext();
  if (!context) {
    return null;
  }

  if (context.objektart === "schluessel") {
    persistSchluesselFromDom();
  } else {
    persistKopfdatenFromDom();
    if (context.objektart === "garage") {
      persistGarageRooms();
    } else if (context.objektart === "gewerbe") {
      persistBueroRooms();
      persistWeitereRaeume();
      persistMeters();
      persistClosing();
    } else if (context.objektart === "privat") {
      persistWeitereRaeume();
      persistMeters();
      persistClosing();
    } else {
      persistMeters();
    }
  }
  // Sicherheitsnetz: Unterschriften/Datum/Druckbuchstaben werden zwar schon
  // bei jeder einzelnen Änderung gespeichert (siehe renderSignatureSection),
  // hier zusätzlich absichern, damit "Als Entwurf speichern"/"Abschließen"
  // garantiert den zuletzt gezeichneten Stand erfassen.
  persistSignaturesFromState();

  return loadFormDraft(context.objektart, context.protokollart);
}

function showDraftStatus(message: string, isError = false): void {
  draftStatus.classList.remove("hidden");
  draftStatus.classList.toggle("is-error", isError);
  draftStatus.textContent = message;
}

function hideDraftStatus(): void {
  draftStatus.classList.add("hidden");
  draftStatus.textContent = "";
  draftStatus.classList.remove("is-error");
}

/**
 * Simple blocking confirm dialog (custom-styled, since native confirm() can't
 * have custom button labels). Resolves true when the user picks confirmLabel,
 * false when the user picks cancelLabel.
 */
function showConfirmDialog(options: {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-dialog-overlay";

    const box = document.createElement("div");
    box.className = "confirm-dialog-box";

    const message = document.createElement("p");
    message.className = "confirm-dialog-message";
    message.textContent = options.message;
    box.appendChild(message);

    const actions = document.createElement("div");
    actions.className = "confirm-dialog-actions";

    const close = (result: boolean): void => {
      overlay.remove();
      resolve(result);
    };

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "main-btn confirm-dialog-cancel";
    cancelButton.textContent = options.cancelLabel;
    cancelButton.addEventListener("click", () => close(false));

    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = "main-btn confirm-dialog-confirm";
    confirmButton.textContent = options.confirmLabel;
    confirmButton.addEventListener("click", () => close(true));

    actions.appendChild(cancelButton);
    actions.appendChild(confirmButton);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

/**
 * Blocking "OK only" alert dialog (custom-styled) — used for hard validation
 * errors where there is no "proceed anyway" option, unlike showConfirmDialog.
 */
function showAlertDialog(message: string, okLabel = "Zurück zum Formular"): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-dialog-overlay";

    const box = document.createElement("div");
    box.className = "confirm-dialog-box";

    const messageEl = document.createElement("p");
    messageEl.className = "confirm-dialog-message";
    messageEl.textContent = message;
    box.appendChild(messageEl);

    const actions = document.createElement("div");
    actions.className = "confirm-dialog-actions";

    const okButton = document.createElement("button");
    okButton.type = "button";
    okButton.className = "main-btn confirm-dialog-cancel";
    okButton.textContent = okLabel;
    okButton.addEventListener("click", () => {
      overlay.remove();
      resolve();
    });

    actions.appendChild(okButton);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

function saveCurrentAsNamedDraft(): void {
  const context = getCurrentFormContext();
  if (!context) {
    showDraftStatus("Kein aktives Protokoll zum Speichern.", true);
    return;
  }

  const form = syncCurrentFormToSessionDraft();
  if (!form) {
    showDraftStatus("Formular konnte nicht gespeichert werden.", true);
    return;
  }

  const drafts = loadNamedDrafts();
  if (drafts.length >= MAX_NAMED_DRAFTS) {
    showDraftStatus(
      `Maximal ${MAX_NAMED_DRAFTS} Entwürfe möglich. Bitte einen bestehenden Entwurf löschen oder abschließen.`,
      true
    );
    return;
  }

  const enteredName = window.prompt("Name für diesen Entwurf (z.B. Sascha, Katrin):");
  if (enteredName === null) {
    return;
  }
  const name = enteredName.trim();
  if (!name) {
    showDraftStatus("Bitte einen Namen für den Entwurf eingeben.", true);
    return;
  }

  const now = new Date().toISOString();
  const named: NamedProtocolDraft = {
    id: generateId("named-draft"),
    name,
    createdAt: now,
    updatedAt: now,
    objektart: context.objektart,
    protokollart: context.protokollart,
    form: JSON.parse(JSON.stringify(form)) as FormDraft,
  };

  drafts.unshift(named);
  saveNamedDrafts(drafts);
  showDraftStatus(`Entwurf „${name}“ gespeichert.`);
}

function openNamedDraft(draftId: string): void {
  const draft = loadNamedDrafts().find((item) => item.id === draftId);
  if (!draft) {
    return;
  }

  saveFormDraft(draft.objektart, draft.protokollart, JSON.parse(JSON.stringify(draft.form)) as FormDraft);
  localStorage.setItem(STORAGE_KEYS.objektart, draft.objektart);
  localStorage.setItem(STORAGE_KEYS.protokollart, draft.protokollart);
  hideDraftStatus();
  showFormular(draft.objektart, draft.protokollart);
}

function deleteNamedDraft(draftId: string): void {
  const remaining = loadNamedDrafts().filter((item) => item.id !== draftId);
  saveNamedDrafts(remaining);
  renderNamedDraftsList();
}

function renderNamedDraftsList(): void {
  const drafts = loadNamedDrafts();
  entwuerfeList.innerHTML = "";

  if (drafts.length === 0) {
    entwuerfeEmpty.classList.remove("hidden");
    return;
  }

  entwuerfeEmpty.classList.add("hidden");

  drafts.forEach((draft) => {
    const card = document.createElement("div");
    card.className = "draft-card";

    const title = document.createElement("h3");
    title.className = "draft-card-title";
    title.textContent = getNamedDraftDisplayTitle(draft);
    card.appendChild(title);

    const meta = document.createElement("p");
    meta.className = "draft-card-meta";
    meta.textContent = `${OBJEKTART_LABELS[draft.objektart]} · ${PROTOKOLLART_LABELS[draft.protokollart]} · ${formatDraftTimestamp(draft.updatedAt)}`;
    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "draft-card-actions";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "main-btn";
    openButton.textContent = "Öffnen";
    openButton.addEventListener("click", () => {
      openNamedDraft(draft.id);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "main-btn btn-delete-draft";
    deleteButton.textContent = "Löschen";
    deleteButton.addEventListener("click", () => {
      deleteNamedDraft(draft.id);
    });

    actions.appendChild(openButton);
    actions.appendChild(deleteButton);
    card.appendChild(actions);
    entwuerfeList.appendChild(card);
  });
}

function goToEntwuerfeView(): void {
  setAppSubtitle(DEFAULT_SUBTITLE, false);
  renderNamedDraftsList();
  showOnly(viewEntwuerfe);
}

// --- Zählerstände: Datenmodell -------------------------------------------
// Reines, serialisierbares Datenmodell (keine DOM-Referenzen), damit es
// später unverändert in IndexedDB gespeichert und mit der Cloud
// synchronisiert werden kann.

type MeterType = "strom" | "gas" | "waermepumpe" | "kaltwasser" | "warmwasser";
type StandardMeterType = "gas" | "waermepumpe" | "kaltwasser" | "warmwasser";

interface BaseMeterEntry {
  id: string;
  meterNumber: string;
  notes: string;
}

interface ElectricityMeterEntry extends BaseMeterEntry {
  htReading: string;
  ntReading: string;
}

interface StandardMeterEntry extends BaseMeterEntry {
  reading: string;
  location?: string;
}

interface MeterState {
  strom: ElectricityMeterEntry[];
  gas: StandardMeterEntry[];
  waermepumpe: StandardMeterEntry[];
  kaltwasser: StandardMeterEntry[];
  warmwasser: StandardMeterEntry[];
}

interface StandardMeterSectionConfig {
  type: StandardMeterType;
  title: string;
  addButtonLabel: string;
  withLocation: boolean;
  locationPlaceholder?: string;
}

const STANDARD_METER_SECTIONS: StandardMeterSectionConfig[] = [
  {
    type: "gas",
    title: "Gaszähler",
    addButtonLabel: "+ Weiteren Gaszähler hinzufügen",
    withLocation: false,
  },
  {
    type: "waermepumpe",
    title: "WMZ",
    addButtonLabel: "+ Weiteren WMZ hinzufügen",
    withLocation: false,
  },
  {
    type: "kaltwasser",
    title: "Kaltwasser",
    addButtonLabel: "+ Weiteren Kaltwasserzähler hinzufügen",
    withLocation: true,
    locationPlaceholder: "z.B. Küche, Bad 1, Bad 2, Keller",
  },
  {
    type: "warmwasser",
    title: "Warmwasser",
    addButtonLabel: "+ Weiteren Warmwasserzähler hinzufügen",
    withLocation: true,
    locationPlaceholder: "z.B. Küche, Bad 1, Bad 2, Keller",
  },
];

let idCounter = 0;

function generateId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

function createElectricityEntry(): ElectricityMeterEntry {
  return { id: generateId("strom"), meterNumber: "", htReading: "", ntReading: "", notes: "" };
}

function createStandardEntry(type: MeterType, withLocation: boolean): StandardMeterEntry {
  const entry: StandardMeterEntry = { id: generateId(type), meterNumber: "", reading: "", notes: "" };
  if (withLocation) {
    entry.location = "";
  }
  return entry;
}

function createInitialMeterState(): MeterState {
  return {
    strom: [createElectricityEntry()],
    gas: [createStandardEntry("gas", false)],
    waermepumpe: [createStandardEntry("waermepumpe", false)],
    kaltwasser: [createStandardEntry("kaltwasser", true)],
    warmwasser: [createStandardEntry("warmwasser", true)],
  };
}

let meterState: MeterState = createInitialMeterState();
let garageRoomState: GarageRoomEntry[] = [];
let bueroRoomState: BueroRoomEntry[] = [];
let closingState: ClosingDraft = emptyClosingDraft();
let schluesselEntryState: SchluesselEntry[] = [emptySchluesselEntry()];
let vermieterSignaturePad: SignaturePad | null = null;
let mieterSignaturePad: SignaturePad | null = null;
let zeugeSignaturePad: SignaturePad | null = null;
let signatureDatum = "";
let vermieterDruckbuchstaben = "";
let mieterDruckbuchstaben = "";
let zeugeName = "";
let zeugeAnschrift = "";
/** Optional Mieter email send (after „abschließen“). */
let protocolEmailTo = "";
/** Mieter-PDF kept for the post-completion email step. */
let completionMieterPdf: { filename: string; base64: string } | null = null;

const MAX_SCHLUESSEL_ENTRIES = 2;
let weitereRaumState: WeitereRaumEntry[] = [];

const MAX_BUERO_ROOMS = 6;
const MAX_WEITERE_RAEUME = 5;

function createGarageRoomEntry(): GarageRoomEntry {
  return { id: generateId("garage-room"), ok: false, ausstattung: "", maengel: "", bemerkungen: "" };
}

function createInitialGarageRooms(): GarageRoomEntry[] {
  return [createGarageRoomEntry()];
}

function persistGarageRooms(): void {
  updateCurrentFormDraft((draft) => {
    draft.garageRooms = JSON.parse(JSON.stringify(garageRoomState)) as GarageRoomEntry[];
    draft.meters = null;
  });
}

function createBueroRoomEntry(): BueroRoomEntry {
  return { id: generateId("buero-room"), ok: false, ausstattung: "", maengel: "", bemerkungen: "" };
}

function createInitialBueroRooms(draft: FormDraft): BueroRoomEntry[] {
  if (draft.rooms.buero) {
    const legacy = normalizeRoomDraft(draft.rooms.buero);
    return [
      {
        id: generateId("buero-room"),
        ok: legacy.ok,
        ausstattung: legacy.ausstattung,
        maengel: legacy.maengel,
        bemerkungen: legacy.bemerkungen,
      },
    ];
  }
  return [createBueroRoomEntry()];
}

function persistBueroRooms(): void {
  updateCurrentFormDraft((draft) => {
    draft.bueroRooms = JSON.parse(JSON.stringify(bueroRoomState)) as BueroRoomEntry[];
  });
}

function createWeitereRaumEntry(): WeitereRaumEntry {
  return { id: generateId("weitere-raum"), ok: false, ausstattung: "", maengel: "", bemerkungen: "" };
}

function createInitialWeitereRaeume(draft: FormDraft): WeitereRaumEntry[] {
  const legacyIds = ["weitere-raeume-1", "weitere-raeume-2"] as const;
  const migrated: WeitereRaumEntry[] = [];
  for (const legacyId of legacyIds) {
    if (draft.rooms[legacyId]) {
      const legacy = normalizeRoomDraft(draft.rooms[legacyId]);
      migrated.push({
        id: generateId("weitere-raum"),
        ok: legacy.ok,
        ausstattung: legacy.ausstattung,
        maengel: legacy.maengel,
        bemerkungen: legacy.bemerkungen,
      });
    }
  }
  if (migrated.length > 0) {
    return migrated.slice(0, MAX_WEITERE_RAEUME);
  }
  return [createWeitereRaumEntry()];
}

function persistWeitereRaeume(): void {
  updateCurrentFormDraft((draft) => {
    draft.weitereRaeume = JSON.parse(JSON.stringify(weitereRaumState)) as WeitereRaumEntry[];
  });
}

function getStandardEntries(type: StandardMeterType): StandardMeterEntry[] {
  switch (type) {
    case "gas":
      return meterState.gas;
    case "waermepumpe":
      return meterState.waermepumpe;
    case "kaltwasser":
      return meterState.kaltwasser;
    case "warmwasser":
      return meterState.warmwasser;
  }
}

function setStandardEntries(type: StandardMeterType, entries: StandardMeterEntry[]): void {
  switch (type) {
    case "gas":
      meterState.gas = entries;
      break;
    case "waermepumpe":
      meterState.waermepumpe = entries;
      break;
    case "kaltwasser":
      meterState.kaltwasser = entries;
      break;
    case "warmwasser":
      meterState.warmwasser = entries;
      break;
  }
}

function isObjektart(value: string | null): value is Objektart {
  return value === "schluessel" || value === "gewerbe" || value === "privat" || value === "garage";
}

function isProtokollart(value: string | null): value is Protokollart {
  return value === "uebergabe" || value === "ruecknahme";
}

function normalizeProtokollart(value: string | null): Protokollart | null {
  if (value === "abnahme") {
    return "ruecknahme";
  }
  if (isProtokollart(value)) {
    return value;
  }
  return null;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Element mit id "${id}" wurde nicht gefunden.`);
  }
  return element as T;
}

const viewObjektart = requireElement<HTMLDivElement>("view-objektart");
const viewProtokollart = requireElement<HTMLDivElement>("view-protokollart");
const viewEntwuerfe = requireElement<HTMLDivElement>("view-entwuerfe");
const viewFormular = requireElement<HTMLDivElement>("view-formular");
const formStandard = requireElement<HTMLDivElement>("form-standard");
const formSchluessel = requireElement<HTMLDivElement>("form-schluessel");
const schluesselEntriesContainer = requireElement<HTMLDivElement>("schluessel-entries-container");
const gewaehlteObjektartHeading = requireElement<HTMLHeadingElement>("gewaehlte-objektart");
const appSubtitle = requireElement<HTMLParagraphElement>("app-subtitle");
const appTitle = requireElement<HTMLHeadingElement>("app-title");
const appBuildStamp = requireElement<HTMLParagraphElement>("app-build-stamp");

// Diagnostic only: makes it visible on-device which build is actually
// running, so stale Service-Worker/PWA caching can be ruled in or out
// without needing remote devtools access.
appBuildStamp.textContent = `Build: ${__APP_BUILD__}`;
console.log(`[kithan-app] Build: ${__APP_BUILD__}`);
const wohnungsnummerLageGroup = requireElement<HTMLDivElement>("wohnungsnummer-lage-group");
const labelBesichtigt = requireElement<HTMLLabelElement>("label-besichtigt");
const labelBesichtigungsdatum = requireElement<HTMLLabelElement>("label-besichtigungsdatum");
const headingRaeume = requireElement<HTMLHeadingElement>("heading-raeume");
const roomsContainer = requireElement<HTMLDivElement>("rooms-container");
const metersContainer = requireElement<HTMLDivElement>("meters-container");
const closingContainer = requireElement<HTMLDivElement>("closing-container");
const signatureContainer = requireElement<HTMLDivElement>("signature-container");
const schluesselSignatureContainer = requireElement<HTMLDivElement>("signature-container-schluessel");
const entwuerfeList = requireElement<HTMLDivElement>("entwuerfe-list");
const entwuerfeEmpty = requireElement<HTMLParagraphElement>("entwuerfe-empty");
const draftStatus = requireElement<HTMLParagraphElement>("draft-status");
const btnMeineEntwuerfe = requireElement<HTMLButtonElement>("btn-meine-entwuerfe");
const btnZurueckEntwuerfe = requireElement<HTMLButtonElement>("btn-zurueck-entwuerfe");
const btnEntwurfSpeichern = requireElement<HTMLButtonElement>("btn-entwurf-speichern");
const btnZurueck = requireElement<HTMLButtonElement>("btn-zurueck");
const btnZurueckFormular = requireElement<HTMLButtonElement>("btn-zurueck-formular");
const btnNeustart = requireElement<HTMLButtonElement>("btn-neustart");

function showOnly(view: HTMLElement): void {
  for (const v of [viewObjektart, viewProtokollart, viewEntwuerfe, viewFormular]) {
    v.classList.toggle("hidden", v !== view);
  }
}

function renderRooms(objektart: Objektart): void {
  roomsContainer.innerHTML = "";

  if (objektart === "schluessel") {
    return;
  }

  if (objektart === "garage") {
    renderGarageRooms();
    return;
  }

  const context = getCurrentFormContext();
  const draft = context ? loadFormDraft(context.objektart, context.protokollart) : emptyFormDraft();

  if (objektart === "gewerbe") {
    renderGewerbeRooms(draft);
    return;
  }

  renderPrivatRooms(draft);
}

function createCollapsibleRoomCard(
  title: string,
  extraClass = ""
): { card: HTMLDivElement; body: HTMLDivElement; collapse: () => void } {
  const card = document.createElement("div");
  card.className = extraClass ? `raum-karte ${extraClass}` : "raum-karte";

  const header = document.createElement("div");
  header.className = "raum-karte-header";

  const heading = document.createElement("h4");
  heading.textContent = title;
  header.appendChild(heading);

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "raum-karte-toggle";
  toggleButton.setAttribute("aria-label", `${title} ein-/ausblenden`);
  toggleButton.setAttribute("aria-expanded", "true");
  const chevron = document.createElement("span");
  chevron.className = "raum-karte-chevron";
  chevron.setAttribute("aria-hidden", "true");
  toggleButton.appendChild(chevron);
  header.appendChild(toggleButton);

  card.appendChild(header);

  const body = document.createElement("div");
  body.className = "raum-karte-body";
  card.appendChild(body);

  const toggle = (): void => {
    const collapsed = card.classList.toggle("is-collapsed");
    toggleButton.setAttribute("aria-expanded", String(!collapsed));
  };
  const collapse = (): void => {
    card.classList.add("is-collapsed");
    toggleButton.setAttribute("aria-expanded", "false");
  };
  toggleButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggle();
  });
  header.addEventListener("click", () => {
    toggle();
  });

  return { card, body, collapse };
}

function createStaticRoomCard(raum: RaumConfig, number: number, roomDraft: RoomDraft): HTMLDivElement {
  const { card, body } = createCollapsibleRoomCard(`${number}. ${raum.label}`);

  body.appendChild(
    createTextareaGroup(
      `${raum.id}-ausstattung`,
      "Ausstattung:",
      "Ausstattung hier eintragen...",
      roomDraft.ausstattung,
      (value) => {
        updateCurrentFormDraft((current) => {
          const existing = normalizeRoomDraft(current.rooms[raum.id]);
          current.rooms[raum.id] = { ...existing, ausstattung: value };
        });
      }
    )
  );

  const { row: okMediaRow } = createRoomOkMediaRow(
    `${raum.id}-ok`,
    roomDraft.ok,
    (checked) => {
      updateCurrentFormDraft((current) => {
        const existing = normalizeRoomDraft(current.rooms[raum.id]);
        current.rooms[raum.id] = { ...existing, ok: checked };
      });
    },
    getMediaSessionKey,
    raum.id
  );
  body.appendChild(okMediaRow);

  body.appendChild(
    createTextareaGroup(
      `${raum.id}-maengel`,
      "Festgestellte Mängel:",
      "Mängel hier eintragen...",
      roomDraft.maengel,
      (value) => {
        updateCurrentFormDraft((current) => {
          const existing = normalizeRoomDraft(current.rooms[raum.id]);
          current.rooms[raum.id] = { ...existing, maengel: value };
        });
      }
    )
  );
  body.appendChild(
    createTextareaGroup(
      `${raum.id}-bemerkungen`,
      "Bemerkungen:",
      "Sonstige Notizen...",
      roomDraft.bemerkungen,
      (value) => {
        updateCurrentFormDraft((current) => {
          const existing = normalizeRoomDraft(current.rooms[raum.id]);
          current.rooms[raum.id] = { ...existing, bemerkungen: value };
        });
      }
    )
  );

  return card;
}

function loadWeitereRaumState(draft: FormDraft): void {
  weitereRaumState = draft.weitereRaeume
    ? (JSON.parse(JSON.stringify(draft.weitereRaeume)) as WeitereRaumEntry[]).map(normalizeExpandableRoomEntry)
    : createInitialWeitereRaeume(draft);

  if (weitereRaumState.length > MAX_WEITERE_RAEUME) {
    weitereRaumState = weitereRaumState.slice(0, MAX_WEITERE_RAEUME);
  }

  if (!draft.weitereRaeume) {
    persistWeitereRaeume();
  }
}

function createWeitereRaumCard(
  entry: WeitereRaumEntry,
  index: number,
  showRemove: boolean,
  onRemove: () => void
): HTMLDivElement {
  const { card, body, collapse } = createCollapsibleRoomCard(`Weiterer Raum ${index + 1}`);

  collapse();

  body.appendChild(
    createTextareaGroup(
      `${entry.id}-ausstattung`,
      "Ausstattung:",
      "Ausstattung hier eintragen...",
      entry.ausstattung,
      (value) => {
        entry.ausstattung = value;
        persistWeitereRaeume();
      }
    )
  );

  const { row: okMediaRow } = createRoomOkMediaRow(
    `${entry.id}-ok`,
    entry.ok,
    (checked) => {
      entry.ok = checked;
      persistWeitereRaeume();
    },
    getMediaSessionKey,
    entry.id
  );
  body.appendChild(okMediaRow);

  body.appendChild(
    createTextareaGroup(
      `${entry.id}-maengel`,
      "Festgestellte Mängel:",
      "Mängel hier eintragen...",
      entry.maengel,
      (value) => {
        entry.maengel = value;
        persistWeitereRaeume();
      }
    )
  );
  body.appendChild(
    createTextareaGroup(
      `${entry.id}-bemerkungen`,
      "Bemerkungen:",
      "Sonstige Notizen...",
      entry.bemerkungen,
      (value) => {
        entry.bemerkungen = value;
        persistWeitereRaeume();
      }
    )
  );

  body.appendChild(createMeterFooter(showRemove, onRemove, collapse, "Raum entfernen"));

  return card;
}

function appendWeitereRaeumeBlock(): void {
  const wrapper = document.createElement("div");
  wrapper.id = "weitere-raeume-block";

  const rerender = (): void => {
    const context = getCurrentFormContext();
    if (context) {
      renderRooms(context.objektart);
    }
  };

  weitereRaumState.forEach((entry, index) => {
    const showRemove = weitereRaumState.length > 1;
    wrapper.appendChild(
      createWeitereRaumCard(entry, index, showRemove, () => {
        void removeOwnerMedia(entry.id);
        weitereRaumState = weitereRaumState.filter((e) => e.id !== entry.id);
        persistWeitereRaeume();
        rerender();
      })
    );
  });

  if (weitereRaumState.length < MAX_WEITERE_RAEUME) {
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "btn-add";
    addButton.textContent = "Weiteren Raum hinzufügen";
    addButton.addEventListener("click", () => {
      if (weitereRaumState.length >= MAX_WEITERE_RAEUME) {
        return;
      }
      weitereRaumState.push(createWeitereRaumEntry());
      persistWeitereRaeume();
      rerender();
    });
    wrapper.appendChild(addButton);
  }

  roomsContainer.appendChild(wrapper);
}

function renderPrivatRooms(draft: FormDraft): void {
  loadWeitereRaumState(draft);

  RAEUME.privat.forEach((raum, index) => {
    roomsContainer.appendChild(createStaticRoomCard(raum, index + 1, draft.rooms[raum.id] ?? emptyRoomDraft()));
  });
  appendWeitereRaeumeBlock();
}

function createBueroRoomCard(
  entry: BueroRoomEntry,
  index: number,
  showRemove: boolean,
  onRemove: () => void
): HTMLDivElement {
  const { card, body } = createCollapsibleRoomCard(`Büro ${index + 1}`);

  body.appendChild(
    createTextareaGroup(
      `${entry.id}-ausstattung`,
      "Ausstattung:",
      "Ausstattung hier eintragen...",
      entry.ausstattung,
      (value) => {
        entry.ausstattung = value;
        persistBueroRooms();
      }
    )
  );

  const { row: okMediaRow } = createRoomOkMediaRow(
    `${entry.id}-ok`,
    entry.ok,
    (checked) => {
      entry.ok = checked;
      persistBueroRooms();
    },
    getMediaSessionKey,
    entry.id
  );
  body.appendChild(okMediaRow);

  body.appendChild(
    createTextareaGroup(
      `${entry.id}-maengel`,
      "Festgestellte Mängel:",
      "Mängel hier eintragen...",
      entry.maengel,
      (value) => {
        entry.maengel = value;
        persistBueroRooms();
      }
    )
  );
  body.appendChild(
    createTextareaGroup(
      `${entry.id}-bemerkungen`,
      "Bemerkungen:",
      "Sonstige Notizen...",
      entry.bemerkungen,
      (value) => {
        entry.bemerkungen = value;
        persistBueroRooms();
      }
    )
  );

  if (showRemove) {
    const removeButton = createRemoveButton(onRemove);
    removeButton.textContent = "Büro entfernen";
    body.appendChild(removeButton);
  }

  return card;
}

function appendBueroRoomsBlock(): void {
  const wrapper = document.createElement("div");
  wrapper.id = "buero-rooms-block";

  bueroRoomState.forEach((entry, index) => {
    const showRemove = bueroRoomState.length > 1;
    wrapper.appendChild(
      createBueroRoomCard(entry, index, showRemove, () => {
        void removeOwnerMedia(entry.id);
        bueroRoomState = bueroRoomState.filter((e) => e.id !== entry.id);
        persistBueroRooms();
        renderRooms("gewerbe");
      })
    );
  });

  if (bueroRoomState.length < MAX_BUERO_ROOMS) {
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "btn-add";
    addButton.textContent = "Weiteres Büro hinzufügen";
    addButton.addEventListener("click", () => {
      if (bueroRoomState.length >= MAX_BUERO_ROOMS) {
        return;
      }
      bueroRoomState.push(createBueroRoomEntry());
      persistBueroRooms();
      renderRooms("gewerbe");
    });
    wrapper.appendChild(addButton);
  }

  roomsContainer.appendChild(wrapper);
}

function renderGewerbeRooms(draft: FormDraft): void {
  bueroRoomState = draft.bueroRooms
    ? (JSON.parse(JSON.stringify(draft.bueroRooms)) as BueroRoomEntry[]).map(normalizeExpandableRoomEntry)
    : createInitialBueroRooms(draft);

  if (bueroRoomState.length > MAX_BUERO_ROOMS) {
    bueroRoomState = bueroRoomState.slice(0, MAX_BUERO_ROOMS);
  }

  if (!draft.bueroRooms) {
    persistBueroRooms();
  }

  loadWeitereRaumState(draft);

  let number = 1;
  RAEUME.gewerbe.forEach((raum) => {
    roomsContainer.appendChild(createStaticRoomCard(raum, number, draft.rooms[raum.id] ?? emptyRoomDraft()));
    number += 1;
    if (raum.id === "bad-wc") {
      appendBueroRoomsBlock();
    }
  });
  appendWeitereRaeumeBlock();
}

function createGarageRoomCard(
  entry: GarageRoomEntry,
  index: number,
  showRemove: boolean,
  onRemove: () => void
): HTMLDivElement {
  const { card, body } = createCollapsibleRoomCard(`Garage ${index + 1}`);

  body.appendChild(
    createTextareaGroup(
      `${entry.id}-ausstattung`,
      "Ausstattung:",
      "Ausstattung hier eintragen...",
      entry.ausstattung,
      (value) => {
        entry.ausstattung = value;
        persistGarageRooms();
      }
    )
  );

  const { row: okMediaRow } = createRoomOkMediaRow(
    `${entry.id}-ok`,
    entry.ok,
    (checked) => {
      entry.ok = checked;
      persistGarageRooms();
    },
    getMediaSessionKey,
    entry.id
  );
  body.appendChild(okMediaRow);

  body.appendChild(
    createTextareaGroup(
      `${entry.id}-maengel`,
      "Festgestellte Mängel:",
      "Mängel hier eintragen...",
      entry.maengel,
      (value) => {
        entry.maengel = value;
        persistGarageRooms();
      }
    )
  );
  body.appendChild(
    createTextareaGroup(
      `${entry.id}-bemerkungen`,
      "Bemerkungen:",
      "Sonstige Notizen...",
      entry.bemerkungen,
      (value) => {
        entry.bemerkungen = value;
        persistGarageRooms();
      }
    )
  );

  if (showRemove) {
    const removeButton = createRemoveButton(onRemove);
    removeButton.textContent = "Garage entfernen";
    body.appendChild(removeButton);
  }

  return card;
}

function normalizeExpandableRoomEntry<T extends { ok: boolean; ausstattung?: string; maengel: string; bemerkungen: string; id: string }>(
  entry: T
): T & { ausstattung: string } {
  return {
    ...entry,
    ausstattung: entry.ausstattung ?? "",
  };
}

function renderGarageRooms(): void {
  roomsContainer.innerHTML = "";

  const context = getCurrentFormContext();
  const draft = context ? loadFormDraft(context.objektart, context.protokollart) : emptyFormDraft();
  garageRoomState = draft.garageRooms
    ? (JSON.parse(JSON.stringify(draft.garageRooms)) as GarageRoomEntry[]).map(normalizeExpandableRoomEntry)
    : createInitialGarageRooms();

  if (!draft.garageRooms) {
    persistGarageRooms();
  }

  garageRoomState.forEach((entry, index) => {
    const showRemove = garageRoomState.length > 1;
    roomsContainer.appendChild(
      createGarageRoomCard(entry, index, showRemove, () => {
        void removeOwnerMedia(entry.id);
        garageRoomState = garageRoomState.filter((e) => e.id !== entry.id);
        persistGarageRooms();
        renderGarageRooms();
      })
    );
  });

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "btn-add";
  addButton.textContent = "Weitere Garage hinzufügen";
  addButton.addEventListener("click", () => {
    garageRoomState.push(createGarageRoomEntry());
    persistGarageRooms();
    renderGarageRooms();
  });
  roomsContainer.appendChild(addButton);
}

function createTextareaGroup(
  id: string,
  labelText: string,
  placeholder: string,
  value = "",
  onChange?: (value: string) => void
): HTMLDivElement {
  const group = document.createElement("div");
  group.className = "input-group";

  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = labelText;

  const textarea = document.createElement("textarea");
  textarea.id = id;
  textarea.rows = 2;
  textarea.placeholder = placeholder;
  textarea.value = value;
  if (onChange) {
    textarea.addEventListener("input", () => {
      onChange(textarea.value);
    });
  }

  group.appendChild(label);
  group.appendChild(textarea);
  return group;
}

// --- Zählerstände: dynamische UI-Erzeugung --------------------------------

function createTextField(
  id: string,
  labelText: string,
  value: string,
  mode: "text" | "decimal",
  onChange: (value: string) => void,
  placeholder = ""
): HTMLDivElement {
  const group = document.createElement("div");
  group.className = "input-group";

  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = labelText;

  const input = document.createElement("input");
  input.type = "text";
  input.id = id;
  input.value = value;
  input.placeholder = placeholder;
  input.inputMode = mode === "decimal" ? "decimal" : "text";
  input.addEventListener("input", () => {
    onChange(input.value);
  });

  group.appendChild(label);
  group.appendChild(input);
  return group;
}

function createTextareaField(
  id: string,
  labelText: string,
  value: string,
  onChange: (value: string) => void,
  placeholder = ""
): HTMLDivElement {
  const group = document.createElement("div");
  group.className = "input-group";

  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = labelText;

  const textarea = document.createElement("textarea");
  textarea.id = id;
  textarea.rows = 2;
  textarea.placeholder = placeholder;
  textarea.value = value;
  textarea.addEventListener("input", () => {
    onChange(textarea.value);
  });

  group.appendChild(label);
  group.appendChild(textarea);
  return group;
}

function createRemoveButton(onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn-remove";
  button.textContent = "Zähler entfernen";
  button.addEventListener("click", onClick);
  return button;
}

function createMeterFooter(
  showRemove: boolean,
  onRemove: () => void,
  onConfirm: () => void,
  removeLabel = "Zähler entfernen"
): HTMLDivElement {
  const footer = document.createElement("div");
  footer.className = showRemove ? "meter-card-footer" : "meter-card-footer meter-card-footer--confirm-only";

  if (showRemove) {
    const removeButton = createRemoveButton(onRemove);
    removeButton.textContent = removeLabel;
    removeButton.classList.add("meter-footer-btn");
    footer.appendChild(removeButton);
  }

  const anlegenButton = document.createElement("button");
  anlegenButton.type = "button";
  anlegenButton.className = "btn-add meter-footer-btn meter-footer-anlegen";
  anlegenButton.textContent = "Anlegen";
  anlegenButton.addEventListener("click", onConfirm);
  footer.appendChild(anlegenButton);

  return footer;
}

function createElectricityCard(
  entry: ElectricityMeterEntry,
  index: number,
  showRemove: boolean,
  onRemove: () => void
): HTMLDivElement {
  const { card, body, collapse } = createCollapsibleRoomCard(`Stromzähler ${index + 1}`, "meter-karte");

  const media = createCardMediaControls(getMediaSessionKey, entry.id);
  media.root.classList.add("card-media--meter");
  body.appendChild(media.root);

  body.appendChild(
    createTextField(`${entry.id}-nummer`, "Zählernummer:", entry.meterNumber, "text", (value) => {
      entry.meterNumber = value;
      persistMeters();
    })
  );

  const grid = document.createElement("div");
  grid.className = "field-grid-2";
  grid.appendChild(
    createTextField(`${entry.id}-ht`, "HT – Hochtarif:", entry.htReading, "decimal", (value) => {
      entry.htReading = value;
      persistMeters();
    })
  );
  grid.appendChild(
    createTextField(`${entry.id}-nt`, "NT – Niedertarif:", entry.ntReading, "decimal", (value) => {
      entry.ntReading = value;
      persistMeters();
    })
  );
  body.appendChild(grid);

  body.appendChild(
    createTextareaField(
      `${entry.id}-bemerkungen`,
      "Bemerkungen (optional):",
      entry.notes,
      (value) => {
        entry.notes = value;
        persistMeters();
      },
      "Sonstige Notizen..."
    )
  );

  body.appendChild(createMeterFooter(showRemove, onRemove, collapse));

  return card;
}

function renderElectricitySection(container: HTMLElement): void {
  container.innerHTML = "";

  const heading = document.createElement("h4");
  heading.className = "meter-section-title";
  heading.textContent = "Stromzähler";
  container.appendChild(heading);

  const cardsWrapper = document.createElement("div");
  meterState.strom.forEach((entry, index) => {
    const showRemove = meterState.strom.length > 1;
    cardsWrapper.appendChild(
      createElectricityCard(entry, index, showRemove, () => {
        void removeOwnerMedia(entry.id);
        meterState.strom = meterState.strom.filter((e) => e.id !== entry.id);
        persistMeters();
        renderElectricitySection(container);
      })
    );
  });
  container.appendChild(cardsWrapper);

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "btn-add";
  addButton.textContent = "+ Weiteren Stromzähler hinzufügen";
  addButton.addEventListener("click", () => {
    meterState.strom.push(createElectricityEntry());
    persistMeters();
    renderElectricitySection(container);
  });
  container.appendChild(addButton);
}

function createStandardMeterCard(
  config: StandardMeterSectionConfig,
  entry: StandardMeterEntry,
  index: number,
  showRemove: boolean,
  onRemove: () => void
): HTMLDivElement {
  const { card, body, collapse } = createCollapsibleRoomCard(
    `${config.title} ${index + 1}`,
    "meter-karte"
  );

  const media = createCardMediaControls(getMediaSessionKey, entry.id);
  media.root.classList.add("card-media--meter");
  body.appendChild(media.root);

  if (config.type === "gas") {
    collapse();
  }

  if (config.withLocation) {
    body.appendChild(
      createTextField(
        `${entry.id}-standort`,
        "Bezeichnung/Standort:",
        entry.location ?? "",
        "text",
        (value) => {
          entry.location = value;
          persistMeters();
        },
        config.locationPlaceholder ?? ""
      )
    );
  }

  const grid = document.createElement("div");
  grid.className = "field-grid-2";
  grid.appendChild(
    createTextField(`${entry.id}-nummer`, "Zählernummer:", entry.meterNumber, "text", (value) => {
      entry.meterNumber = value;
      persistMeters();
    })
  );
  grid.appendChild(
    createTextField(`${entry.id}-stand`, "Zählerstand:", entry.reading, "decimal", (value) => {
      entry.reading = value;
      persistMeters();
    })
  );
  body.appendChild(grid);

  body.appendChild(
    createTextareaField(
      `${entry.id}-bemerkungen`,
      "Bemerkungen (optional):",
      entry.notes,
      (value) => {
        entry.notes = value;
        persistMeters();
      },
      "Sonstige Notizen..."
    )
  );

  body.appendChild(createMeterFooter(showRemove, onRemove, collapse));

  return card;
}

function renderStandardMeterSection(config: StandardMeterSectionConfig, container: HTMLElement): void {
  container.innerHTML = "";

  const heading = document.createElement("h4");
  heading.className = "meter-section-title";
  heading.textContent = config.title;
  container.appendChild(heading);

  const cardsWrapper = document.createElement("div");
  const entries = getStandardEntries(config.type);
  entries.forEach((entry, index) => {
    const showRemove = entries.length > 1;
    cardsWrapper.appendChild(
      createStandardMeterCard(config, entry, index, showRemove, () => {
        void removeOwnerMedia(entry.id);
        setStandardEntries(
          config.type,
          getStandardEntries(config.type).filter((e) => e.id !== entry.id)
        );
        persistMeters();
        renderStandardMeterSection(config, container);
      })
    );
  });
  container.appendChild(cardsWrapper);

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "btn-add";
  addButton.textContent = config.addButtonLabel;
  addButton.addEventListener("click", () => {
    getStandardEntries(config.type).push(createStandardEntry(config.type, config.withLocation));
    persistMeters();
    renderStandardMeterSection(config, container);
  });
  container.appendChild(addButton);
}

function renderMeterSections(objektart: Objektart): void {
  metersContainer.innerHTML = "";

  if (objektart === "garage" || objektart === "schluessel") {
    updateCurrentFormDraft((draft) => {
      draft.meters = null;
    });
    return;
  }

  const context = getCurrentFormContext();
  const draft = context ? loadFormDraft(context.objektart, context.protokollart) : emptyFormDraft();
  meterState = draft.meters ? (JSON.parse(JSON.stringify(draft.meters)) as MeterState) : createInitialMeterState();

  if (!draft.meters) {
    persistMeters();
  }

  const heading = document.createElement("h3");
  heading.className = "section-title";
  heading.textContent = "Zählerstände";
  metersContainer.appendChild(heading);

  const stromSection = document.createElement("section");
  stromSection.className = "meter-section";
  metersContainer.appendChild(stromSection);
  renderElectricitySection(stromSection);

  STANDARD_METER_SECTIONS.forEach((config) => {
    const sectionEl = document.createElement("section");
    sectionEl.className = "meter-section";
    metersContainer.appendChild(sectionEl);
    renderStandardMeterSection(config, sectionEl);
  });
}

function keyHandoverVerb(protokollart: Protokollart): string {
  return protokollart === "uebergabe" ? "übergeben" : "zurückgenommen";
}

function createAnzahlSelect(
  id: string,
  value: string,
  onChange: (value: string) => void
): HTMLSelectElement {
  const select = document.createElement("select");
  select.id = id;
  select.className = "key-handover-anzahl";
  select.setAttribute("aria-label", "Anzahl");

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.disabled = true;
  placeholder.textContent = "Anz.";
  if (!value) {
    placeholder.selected = true;
  }
  select.appendChild(placeholder);

  for (let n = 0; n <= 10; n += 1) {
    const option = document.createElement("option");
    option.value = String(n);
    option.textContent = String(n);
    if (value === String(n)) {
      option.selected = true;
    }
    select.appendChild(option);
  }

  select.addEventListener("change", () => {
    onChange(select.value);
  });

  return select;
}

function createAnlagennummerInput(
  id: string,
  value: string,
  onChange: (value: string) => void
): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.id = id;
  input.className = "key-handover-anlagennummer";
  input.placeholder = "Anlagennummer";
  input.setAttribute("aria-label", "Anlagennummer");
  input.value = value;
  input.addEventListener("input", () => {
    onChange(input.value);
  });
  return input;
}

function createFixedKeyHandoverLine(
  idPrefix: string,
  line: KeyHandoverLine,
  targetPhrase: string,
  verb: string
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "key-handover-line";

  const prefix = document.createElement("span");
  prefix.className = "key-handover-text";
  prefix.textContent = "Es wurden";

  const anzahl = createAnzahlSelect(`${idPrefix}-anzahl`, line.anzahl, (value) => {
    line.anzahl = value;
    persistClosing();
  });

  const mid = document.createElement("span");
  mid.className = "key-handover-text";
  mid.textContent = "Schlüssel mit der Anlagennummer";

  const anlagennummer = createAnlagennummerInput(`${idPrefix}-anlagennummer`, line.anlagennummer, (value) => {
    line.anlagennummer = value;
    persistClosing();
  });

  const suffix = document.createElement("span");
  suffix.className = "key-handover-text";
  suffix.textContent = `für ${targetPhrase} ${verb}.`;

  row.append(prefix, anzahl, mid, anlagennummer, suffix);
  return row;
}

function createExtraKeyHandoverLine(
  entry: KeyHandoverExtraLine,
  verb: string,
  showRemove: boolean,
  onRemove: () => void
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "key-handover-line key-handover-line-extra";

  const prefix = document.createElement("span");
  prefix.className = "key-handover-text";
  prefix.textContent = "Es wurden";

  const anzahl = createAnzahlSelect(`${entry.id}-anzahl`, entry.anzahl, (value) => {
    entry.anzahl = value;
    persistClosing();
  });

  const mid = document.createElement("span");
  mid.className = "key-handover-text";
  mid.textContent = "Schlüssel mit der Anlagennummer";

  const anlagennummer = createAnlagennummerInput(
    `${entry.id}-anlagennummer`,
    entry.anlagennummer,
    (value) => {
      entry.anlagennummer = value;
      persistClosing();
    }
  );

  const fuer = document.createElement("span");
  fuer.className = "key-handover-text";
  fuer.textContent = "für";

  const ziel = document.createElement("input");
  ziel.type = "text";
  ziel.id = `${entry.id}-ziel`;
  ziel.className = "key-handover-ziel";
  ziel.placeholder = "Ziel / Bezeichnung";
  ziel.setAttribute("aria-label", "Ziel");
  ziel.value = entry.ziel;
  ziel.addEventListener("input", () => {
    entry.ziel = ziel.value;
    persistClosing();
  });

  const suffix = document.createElement("span");
  suffix.className = "key-handover-text";
  suffix.textContent = `${verb}.`;

  row.append(prefix, anzahl, mid, anlagennummer, fuer, ziel, suffix);

  if (showRemove) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-remove";
    removeBtn.textContent = "Eintrag entfernen";
    removeBtn.addEventListener("click", onRemove);
    row.appendChild(removeBtn);
  }

  return row;
}

function renderClosingSection(objektart: Objektart, protokollart: Protokollart): void {
  closingContainer.innerHTML = "";

  if (objektart === "garage" || objektart === "schluessel") {
    closingState = emptyClosingDraft();
    updateCurrentFormDraft((draft) => {
      draft.closing = null;
    });
    return;
  }

  const draft = loadFormDraft(objektart, protokollart);
  closingState = draft.closing
    ? (JSON.parse(JSON.stringify(draft.closing)) as ClosingDraft)
    : emptyClosingDraft();

  if (!draft.closing) {
    persistClosing();
  }

  const verb = keyHandoverVerb(protokollart);

  closingContainer.appendChild(
    createTextareaGroup(
      "bemerkungen-sonstiges",
      "Bemerkungen/Sonstiges",
      "Weitere Hinweise oder Anmerkungen...",
      closingState.bemerkungenSonstiges,
      (value) => {
        closingState.bemerkungenSonstiges = value;
        persistClosing();
      }
    )
  );

  const keysHeading = document.createElement("h3");
  keysHeading.className = "section-title";
  keysHeading.textContent = "Schlüsselübergabe";
  closingContainer.appendChild(keysHeading);

  const fixedBlock = document.createElement("div");
  fixedBlock.className = "key-handover-block";
  fixedBlock.appendChild(
    createFixedKeyHandoverLine(
      "keys-mieteinheit",
      closingState.keysMieteinheit,
      "die Mieteinheit",
      verb
    )
  );
  fixedBlock.appendChild(
    createFixedKeyHandoverLine("keys-gebaeude", closingState.keysGebaeude, "das Gebäude", verb)
  );
  fixedBlock.appendChild(
    createFixedKeyHandoverLine(
      "keys-briefkasten",
      closingState.keysBriefkasten,
      "den Briefkasten",
      verb
    )
  );
  closingContainer.appendChild(fixedBlock);

  const extrasWrapper = document.createElement("div");
  extrasWrapper.className = "key-handover-extras";

  const renderExtras = (): void => {
    extrasWrapper.innerHTML = "";
    closingState.keysExtra.forEach((entry) => {
      const showRemove = closingState.keysExtra.length > 1;
      extrasWrapper.appendChild(
        createExtraKeyHandoverLine(entry, verb, showRemove, () => {
          closingState.keysExtra = closingState.keysExtra.filter((e) => e.id !== entry.id);
          persistClosing();
          renderExtras();
        })
      );
    });
  };

  renderExtras();
  closingContainer.appendChild(extrasWrapper);

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "btn-add";
  addButton.textContent = "Weiteren Schlüsseleintrag hinzufügen";
  addButton.addEventListener("click", () => {
    closingState.keysExtra.push(createKeyHandoverExtraLine());
    persistClosing();
    renderExtras();
  });
  closingContainer.appendChild(addButton);
}

function destroySignaturePads(): void {
  vermieterSignaturePad?.destroy();
  mieterSignaturePad?.destroy();
  zeugeSignaturePad?.destroy();
  vermieterSignaturePad = null;
  mieterSignaturePad = null;
  zeugeSignaturePad = null;
}

function resetSignatureUiState(): void {
  destroySignaturePads();
  signatureDatum = "";
  vermieterDruckbuchstaben = "";
  mieterDruckbuchstaben = "";
  zeugeName = "";
  zeugeAnschrift = "";
  protocolEmailTo = "";
  completionMieterPdf = null;
  signatureContainer.innerHTML = "";
  schluesselSignatureContainer.innerHTML = "";
}

function createSignaturePadBlock(
  title: string,
  canvasId: string,
  extraFieldBefore?: HTMLDivElement
): {
  block: HTMLDivElement;
  canvas: HTMLCanvasElement;
  clearButton: HTMLButtonElement;
} {
  const block = document.createElement("div");
  block.className = "signature-block";

  const heading = document.createElement("h4");
  heading.className = "signature-block-title";
  heading.textContent = title;
  block.appendChild(heading);

  if (extraFieldBefore) {
    block.appendChild(extraFieldBefore);
  }

  const wrap = document.createElement("div");
  wrap.className = "signature-pad-wrap";

  const canvas = document.createElement("canvas");
  canvas.id = canvasId;
  canvas.setAttribute("aria-label", `Unterschrift ${title}`);
  wrap.appendChild(canvas);
  block.appendChild(wrap);

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "btn-remove";
  clearButton.textContent = "Löschen";
  block.appendChild(clearButton);

  return { block, canvas, clearButton };
}

function maengelStatusLabel(status: KopfdatenDraft["maengelStatus"]): string {
  if (status === "keine") {
    return "keine Mängel festgestellt";
  }
  if (status === "folgende") {
    return "folgende Mängel festgestellt";
  }
  return "";
}

function collectRoomsForPdf(
  objektart: "gewerbe" | "privat" | "garage",
  form: FormDraft
): ProtocolPdfRoom[] {
  const rooms: ProtocolPdfRoom[] = [];

  if (objektart === "garage") {
    (form.garageRooms ?? []).forEach((entry, index) => {
      rooms.push({
        label: `Garage ${index + 1}`,
        ok: entry.ok,
        ausstattung: entry.ausstattung,
        maengel: entry.maengel,
        bemerkungen: entry.bemerkungen,
      });
    });
    return rooms;
  }

  if (objektart === "privat") {
    RAEUME.privat.forEach((raum) => {
      const room = form.rooms[raum.id] ?? emptyRoomDraft();
      rooms.push({
        label: raum.label,
        ok: room.ok,
        ausstattung: room.ausstattung,
        maengel: room.maengel,
        bemerkungen: room.bemerkungen,
      });
    });
    (form.weitereRaeume ?? []).forEach((entry, index) => {
      rooms.push({
        label: `Weiterer Raum ${index + 1}`,
        ok: entry.ok,
        ausstattung: entry.ausstattung,
        maengel: entry.maengel,
        bemerkungen: entry.bemerkungen,
      });
    });
    return rooms;
  }

  const gewerbeRooms = RAEUME.gewerbe;
  const beforeBuero = gewerbeRooms.slice(0, 3);
  const afterBuero = gewerbeRooms.slice(3);

  beforeBuero.forEach((raum) => {
    const room = form.rooms[raum.id] ?? emptyRoomDraft();
    rooms.push({
      label: raum.label,
      ok: room.ok,
      ausstattung: room.ausstattung,
      maengel: room.maengel,
      bemerkungen: room.bemerkungen,
    });
  });
  (form.bueroRooms ?? []).forEach((entry, index) => {
    rooms.push({
      label: `Büro ${index + 1}`,
      ok: entry.ok,
      ausstattung: entry.ausstattung,
      maengel: entry.maengel,
      bemerkungen: entry.bemerkungen,
    });
  });
  afterBuero.forEach((raum) => {
    const room = form.rooms[raum.id] ?? emptyRoomDraft();
    rooms.push({
      label: raum.label,
      ok: room.ok,
      ausstattung: room.ausstattung,
      maengel: room.maengel,
      bemerkungen: room.bemerkungen,
    });
  });
  (form.weitereRaeume ?? []).forEach((entry, index) => {
    rooms.push({
      label: `Weiterer Raum ${index + 1}`,
      ok: entry.ok,
      ausstattung: entry.ausstattung,
      maengel: entry.maengel,
      bemerkungen: entry.bemerkungen,
    });
  });

  return rooms;
}

function collectStandardMetersForPdf(form: FormDraft): ProtocolPdfStandardMeter[] {
  if (!form.meters) {
    return [];
  }
  const meters: ProtocolPdfStandardMeter[] = [];
  STANDARD_METER_SECTIONS.forEach((config) => {
    const entries = form.meters?.[config.type] ?? [];
    entries.forEach((entry) => {
      meters.push({
        title: config.title,
        meterNumber: entry.meterNumber,
        reading: entry.reading,
        location: config.withLocation ? (entry.location ?? "") : undefined,
        notes: entry.notes,
      });
    });
  });
  return meters;
}

function collectKeyLinesForPdf(closing: ClosingDraft | null): ProtocolPdfKeyLine[] {
  if (!closing) {
    return [];
  }
  const lines: ProtocolPdfKeyLine[] = [
    {
      anzahl: closing.keysMieteinheit.anzahl,
      anlagennummer: closing.keysMieteinheit.anlagennummer,
      ziel: "die Mieteinheit",
    },
    {
      anzahl: closing.keysGebaeude.anzahl,
      anlagennummer: closing.keysGebaeude.anlagennummer,
      ziel: "das Gebäude",
    },
    {
      anzahl: closing.keysBriefkasten.anzahl,
      anlagennummer: closing.keysBriefkasten.anlagennummer,
      ziel: "den Briefkasten",
    },
  ];
  closing.keysExtra.forEach((entry) => {
    lines.push({
      anzahl: entry.anzahl,
      anlagennummer: entry.anlagennummer,
      ziel: entry.ziel,
    });
  });
  return lines;
}

function currentVermieterSignaturePng(): string | null {
  return vermieterSignaturePad && !vermieterSignaturePad.isEmpty()
    ? vermieterSignaturePad.toDataURL("image/png")
    : null;
}

function currentMieterSignaturePng(): string | null {
  return mieterSignaturePad && !mieterSignaturePad.isEmpty()
    ? mieterSignaturePad.toDataURL("image/png")
    : null;
}

function currentZeugeSignaturePng(): string | null {
  return zeugeSignaturePad && !zeugeSignaturePad.isEmpty()
    ? zeugeSignaturePad.toDataURL("image/png")
    : null;
}

/**
 * Persists Datum, Druckbuchstaben-Namen und alle drei Unterschriften-PNGs
 * (Vermieter/Mieter/Zeuge) sofort in den aktuellen Formular-Entwurf, damit
 * beim erneuten Öffnen eines Entwurfs alle Abschlussdaten exakt wieder
 * erscheinen — der Mieter ist beim erneuten Öffnen ggf. nicht mehr vor Ort.
 */
function persistSignaturesFromState(): void {
  updateCurrentFormDraft((draft) => {
    draft.signatures = {
      signatureDatum,
      vermieterDruckbuchstaben,
      vermieterSignaturePng: currentVermieterSignaturePng(),
      mieterDruckbuchstaben,
      mieterSignaturePng: currentMieterSignaturePng(),
      zeugeName,
      zeugeAnschrift,
      zeugeSignaturePng: currentZeugeSignaturePng(),
    };
  });
}

function buildProtocolPdfInput(
  objektart: "gewerbe" | "privat" | "garage",
  protokollart: Protokollart,
  form: FormDraft
): ProtocolPdfInput {
  return {
    objektartLabel: OBJEKTART_LABELS[objektart],
    protokollartLabel: PROTOKOLLART_LABELS[protokollart],
    keyVerb: keyHandoverVerb(protokollart),
    mietername: form.kopfdaten.mietername,
    wohnungEinheit: getGebaeudeLabel(form.kopfdaten.gebaeudeAuswahl),
    wohnungsnummerLage: form.kopfdaten.wohnungsnummerLage,
    besichtigungsdatum: form.kopfdaten.besichtigungsdatum,
    maengelStatus: maengelStatusLabel(form.kopfdaten.maengelStatus),
    rooms: collectRoomsForPdf(objektart, form),
    electricityMeters: (form.meters?.strom ?? []).map((entry) => ({
      meterNumber: entry.meterNumber,
      htReading: entry.htReading,
      ntReading: entry.ntReading,
      notes: entry.notes,
    })),
    standardMeters: collectStandardMetersForPdf(form),
    bemerkungenSonstiges: form.closing?.bemerkungenSonstiges ?? "",
    keyLines: collectKeyLinesForPdf(form.closing),
    signatureDatum,
    vermieterSignaturePng: currentVermieterSignaturePng(),
    vermieterDruckbuchstaben,
    mieterSignaturePng: currentMieterSignaturePng(),
    mieterDruckbuchstaben,
    zeugeName,
    zeugeAnschrift,
    zeugeSignaturePng: currentZeugeSignaturePng(),
  };
}

function buildSchluesselPdfInput(protokollart: Protokollart, form: FormDraft): SchluesselPdfInput {
  const data = form.schluessel ?? emptySchluesselDraft();
  const entries: SchluesselPdfEntry[] = data.entries.map((entry) => ({
    anzahl: entry.anzahl,
    schluesselnummer: entry.schluesselnummer,
  }));

  return {
    protokollartLabel: PROTOKOLLART_LABELS[protokollart],
    mietername: data.mietername,
    wohnungEinheit: data.wohnungEinheit,
    bemerkungen: data.bemerkungen,
    entries,
    signatureDatum,
    vermieterSignaturePng: currentVermieterSignaturePng(),
    vermieterDruckbuchstaben,
    mieterSignaturePng: currentMieterSignaturePng(),
    mieterDruckbuchstaben,
    zeugeName,
    zeugeAnschrift,
    zeugeSignaturePng: currentZeugeSignaturePng(),
  };
}

function buildCompletionDraftName(form: FormDraft, protokollart: Protokollart): string {
  const mieter = form.kopfdaten.mietername.trim();
  const adresse = getGebaeudeLabel(form.kopfdaten.gebaeudeAuswahl).trim();
  const kind = PROTOKOLLART_LABELS[protokollart];
  const parts = [mieter, adresse, kind].filter(Boolean);
  return parts.length > 0 ? parts.join(" – ") : `Protokoll ${kind}`;
}

/**
 * Ensure the completed protocol stays in „Meine Entwürfe“ for resend/reupload.
 * Does not remove session data or media.
 */
function upsertCompletionNamedDraft(
  context: { objektart: Objektart; protokollart: Protokollart },
  form: FormDraft
): void {
  const drafts = loadNamedDrafts();
  const name = buildCompletionDraftName(form, context.protokollart);
  const now = new Date().toISOString();
  const formCopy = JSON.parse(JSON.stringify(form)) as FormDraft;

  const existingIndex = drafts.findIndex(
    (item) =>
      item.objektart === context.objektart &&
      item.protokollart === context.protokollart &&
      item.name === name
  );

  if (existingIndex >= 0) {
    drafts[existingIndex] = {
      ...drafts[existingIndex],
      name,
      updatedAt: now,
      form: formCopy,
    };
  } else {
    drafts.unshift({
      id: generateId("named-draft"),
      name,
      createdAt: now,
      updatedAt: now,
      objektart: context.objektart,
      protokollart: context.protokollart,
      form: formCopy,
    });
  }

  saveNamedDrafts(drafts.slice(0, MAX_NAMED_DRAFTS));
}

function completionKindLabel(protokollart: Protokollart): string {
  return protokollart === "uebergabe" ? "Übergabe" : "Rücknahme";
}

/** After abschließen: hide Kopfdaten/Räume/Unterschrift; keep only completion UI + footer buttons. */
function setProtocolFormBodyHidden(hidden: boolean): void {
  Array.from(formStandard.children).forEach((child) => {
    if (!(child instanceof HTMLElement)) {
      return;
    }
    if (child.id === "protocol-completion-top") {
      child.classList.remove("hidden");
      return;
    }
    child.classList.toggle("hidden", hidden);
  });
  // Status sits in the completion banner — do not also show draft-status above the buttons.
  if (hidden) {
    hideDraftStatus();
  }
}

function renderMieterEmailSection(parent: HTMLElement, mieterPdfOk: boolean): void {
  const emailBlock = document.createElement("div");
  emailBlock.className = "protocol-email-block";

  const emailHeading = document.createElement("h3");
  emailHeading.className = "section-title";
  emailHeading.textContent = "📧 Mieter-PDF per E-Mail";
  emailBlock.appendChild(emailHeading);

  emailBlock.appendChild(
    createTextField(
      "completion-email-to",
      "E-Mail des Mieters:",
      protocolEmailTo,
      "text",
      (value) => {
        protocolEmailTo = value;
      },
      "z.B. mieter@example.com"
    )
  );

  const emailStatus = document.createElement("p");
  emailStatus.className = "protocol-email-status hidden";
  emailStatus.setAttribute("role", "status");
  emailBlock.appendChild(emailStatus);

  const sendButton = document.createElement("button");
  sendButton.type = "button";
  sendButton.className = "main-btn btn-send-mieter-pdf";
  sendButton.textContent = "Mieter-PDF senden";
  sendButton.disabled = !mieterPdfOk || !completionMieterPdf;
  sendButton.addEventListener("click", () => {
    void (async () => {
      emailStatus.classList.add("hidden");
      emailStatus.classList.remove("is-error", "is-ok");

      if (!completionMieterPdf) {
        emailStatus.textContent = "Das PDF konnte nicht erstellt werden.";
        emailStatus.classList.add("is-error");
        emailStatus.classList.remove("hidden");
        return;
      }
      const to = protocolEmailTo.trim();
      if (!to) {
        emailStatus.textContent = "Bitte E-Mail-Adresse des Mieters eingeben.";
        emailStatus.classList.add("is-error");
        emailStatus.classList.remove("hidden");
        return;
      }

      sendButton.disabled = true;
      emailStatus.textContent = "E-Mail wird gesendet…";
      emailStatus.classList.remove("hidden");

      const result = await sendProtocolEmail({
        to,
        filename: completionMieterPdf.filename,
        pdfBase64: completionMieterPdf.base64,
      });

      sendButton.disabled = false;
      if (!result.ok) {
        emailStatus.textContent =
          result.error?.trim() ||
          "E-Mail konnte nicht gesendet werden. Bitte später erneut versuchen.";
        emailStatus.classList.add("is-error");
        return;
      }
      emailStatus.textContent = "✅ E-Mail wurde versendet.";
      emailStatus.classList.add("is-ok");
    })();
  });
  emailBlock.appendChild(sendButton);

  const hint = document.createElement("p");
  hint.className = "protocol-email-hint";
  hint.textContent = "Es wird nur das PDF versendet — keine Fotos oder Videos.";
  emailBlock.appendChild(hint);

  parent.appendChild(emailBlock);
}

/**
 * Banner + E-Mail-Bereich ganz oben im Formular (nach Abschluss aller Übertragungen).
 */
function renderCompletionTop(
  protokollart: Protokollart,
  archiveResult: ProtocolArchiveUploadResult | null,
  mieterPdfOk: boolean
): void {
  let top = document.getElementById("protocol-completion-top");
  if (!top) {
    top = document.createElement("div");
    top.id = "protocol-completion-top";
    formStandard.insertBefore(top, formStandard.firstChild);
  }
  top.innerHTML = "";

  const kind = completionKindLabel(protokollart);
  const banner = document.createElement("p");
  banner.className = "protocol-completion-banner";
  banner.setAttribute("role", "status");

  const archiveOk = archiveResult?.ok ?? false;

  if (archiveOk && mieterPdfOk) {
    banner.textContent = `✅ ${kind} erfolgreich abgeschlossen. PDF, Fotos und Videos wurden erfolgreich auf den Firmenserver übertragen.`;
  } else if (!mieterPdfOk) {
    // Lokale PDF-Erstellung ist bereits gescheitert — es fand noch gar kein
    // Netzwerk-Request statt (weder für Medien noch für das Protokoll-PDF).
    console.error(
      "[renderCompletionTop] PDF-Erstellung selbst ist fehlgeschlagen — kein Upload-Request wurde ausgelöst. Siehe [finishProtocolAsPdf] Log oben für die Fehlerdetails."
    );
    banner.classList.add("is-error");
    banner.textContent =
      "⚠ Das PDF konnte nicht erstellt werden. Die Daten wurden lokal gespeichert; bitte erneut versuchen.";
  } else {
    // Medien-Upload (Fotos/Videos, /api/blob-upload-token + /api/ftps-transfer
    // je Datei) und Protokoll-PDF-Upload (derselbe Weg, aber eigener Request
    // für die PDF-Datei) sind unabhängige Requests — hier getrennt ausweisen,
    // statt eines pauschalen "Server nicht erreichbar" für beides.
    const mediaFailedCount = (archiveResult?.photoFailed ?? 0) + (archiveResult?.videoFailed ?? 0);
    const mediaOk = mediaFailedCount === 0;
    const pdfOk = archiveResult?.pdfUploaded ?? false;

    console.error(
      `[renderCompletionTop] partial/failed archive upload — photoUploaded=${archiveResult?.photoUploaded} photoFailed=${archiveResult?.photoFailed} videoUploaded=${archiveResult?.videoUploaded} videoFailed=${archiveResult?.videoFailed} pdfUploaded=${archiveResult?.pdfUploaded}. See [protocol-archive]/[uploadMediaRecord]/[blob-ftps-upload] logs above for exact HTTP status/response per failed item.`
    );

    const lines: string[] = [];
    lines.push(
      mediaOk
        ? "✅ Medien (Fotos/Videos) erfolgreich hochgeladen."
        : `⚠ ${mediaFailedCount} Foto(s)/Video(s) konnten nicht zum Server übertragen werden und wurden lokal gespeichert.`
    );
    lines.push(
      pdfOk
        ? "✅ Protokoll-PDF erfolgreich auf den Firmenserver übertragen."
        : "⚠ Protokoll konnte nicht zum Server übertragen werden und wurde lokal gespeichert."
    );

    banner.classList.add("is-error");
    banner.textContent = lines.join("\n");
  }
  top.appendChild(banner);

  renderMieterEmailSection(top, mieterPdfOk);
  setProtocolFormBodyHidden(true);
  top.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function finishProtocolAsPdf(): Promise<void> {
  const context = getCurrentFormContext();
  if (
    !context ||
    (context.objektart !== "gewerbe" && context.objektart !== "privat" && context.objektart !== "garage")
  ) {
    showDraftStatus("Abschluss ist nur für Gewerbe/Privat/Garage verfügbar.", true);
    return;
  }

  const form = syncCurrentFormToSessionDraft();
  if (!form) {
    showDraftStatus("Formular konnte nicht gelesen werden.", true);
    return;
  }

  // Harte Pflichtfeld-Prüfung: Datum, Vermieter, Mietername, Wohnung/Einheit sowie
  // beide Unterschriften (Name in Druckbuchstaben + Unterschrift) und das Unterschriften-
  // Datum MÜSSEN ausgefüllt sein — kein "trotzdem abschließen" möglich, im Gegensatz zur
  // Wohnungsnummer/Lage-Prüfung weiter unten.
  const missingFields: { label: string; focus: () => void }[] = [];

  if (form.kopfdaten.besichtigungsdatum.trim() === "") {
    missingFields.push({
      label: "Datum",
      focus: () => requireElement<HTMLInputElement>("besichtigungsdatum").focus(),
    });
  }
  if (form.kopfdaten.vermieter.trim() === "") {
    missingFields.push({
      label: "Vermieter",
      focus: () => requireElement<HTMLSelectElement>("vermieter-auswahl").focus(),
    });
  }
  if (form.kopfdaten.mietername.trim() === "") {
    missingFields.push({
      label: "Name der/des Mieter(s)",
      focus: () => requireElement<HTMLInputElement>("mietername").focus(),
    });
  }
  if (form.kopfdaten.gebaeudeAuswahl.trim() === "") {
    missingFields.push({
      label: "Wohnung/Einheit",
      focus: () => requireElement<HTMLSelectElement>("gebaeude-auswahl").focus(),
    });
  }
  if (signatureDatum.trim() === "") {
    missingFields.push({
      label: "Datum (bei den Unterschriften)",
      focus: () => {
        const el = document.getElementById("standard-signature-datum");
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        (el as HTMLInputElement | null)?.focus();
      },
    });
  }
  if (vermieterDruckbuchstaben.trim() === "") {
    missingFields.push({
      label: "Name in Druckbuchstaben (Vermieter)",
      focus: () => {
        const el = document.getElementById("standard-vermieter-druckbuchstaben");
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        (el as HTMLInputElement | null)?.focus();
      },
    });
  }
  if (!vermieterSignaturePad || vermieterSignaturePad.isEmpty()) {
    missingFields.push({
      label: "Unterschrift Vermieter",
      focus: () => {
        document
          .getElementById("standard-signature-vermieter")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      },
    });
  }
  if (mieterDruckbuchstaben.trim() === "") {
    missingFields.push({
      label: "Name in Druckbuchstaben (Mieter)",
      focus: () => {
        const el = document.getElementById("standard-mieter-druckbuchstaben");
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        (el as HTMLInputElement | null)?.focus();
      },
    });
  }
  if (!mieterSignaturePad || mieterSignaturePad.isEmpty()) {
    missingFields.push({
      label: "Unterschrift Mieter",
      focus: () => {
        document
          .getElementById("standard-signature-mieter")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      },
    });
  }

  if (missingFields.length > 0) {
    await showAlertDialog(
      `Folgende Pflichtangaben fehlen noch und müssen ausgefüllt werden, bevor das Protokoll abgeschlossen werden kann:\n\n${missingFields
        .map((field) => `• ${field.label}`)
        .join("\n")}`,
      "Zurück zum Formular"
    );
    missingFields[0].focus();
    return;
  }

  // Wohnungsnummer/Lage ist nur bei Privat/Gewerbe verpflichtend (Garage hat keine
  // Wohnungen) — fehlt sie dort, warnen wir deutlich, blockieren den Abschluss aber nicht hart.
  if (context.objektart !== "garage" && form.kopfdaten.wohnungsnummerLage.trim() === "") {
    const proceedAnyway = await showConfirmDialog({
      message: "Die Wohnungsnummer/Lage wurde nicht ausgefüllt. Trotzdem abschließen?",
      cancelLabel: "Zurück",
      confirmLabel: "Trotzdem abschließen",
    });
    if (!proceedAnyway) {
      wohnungsnummerLageGroup.scrollIntoView({ behavior: "smooth", block: "center" });
      requireElement<HTMLInputElement>("wohnungsnummer-lage").focus();
      return;
    }
  }

  // Keep / refresh entry in „Meine Entwürfe“ — do not clear on abschließen.
  upsertCompletionNamedDraft(context, form);
  syncCurrentFormToSessionDraft();

  const finishButton = signatureContainer.querySelector(
    ".btn-finish-pdf"
  ) as HTMLButtonElement | null;
  if (finishButton) {
    finishButton.disabled = true;
  }

  const kind = completionKindLabel(context.protokollart);
  hideDraftStatus();
  let top = document.getElementById("protocol-completion-top");
  if (!top) {
    top = document.createElement("div");
    top.id = "protocol-completion-top";
    formStandard.insertBefore(top, formStandard.firstChild);
  }
  top.innerHTML = "";
  const waiting = document.createElement("p");
  waiting.className = "protocol-completion-banner";
  waiting.textContent = `${kind} wird abgeschlossen… PDF, Fotos und Videos werden übertragen. Bitte warten.`;
  top.appendChild(waiting);
  // Hide the filled-in form immediately — only waiting banner (+ later email) stays.
  setProtocolFormBodyHidden(true);
  top.scrollIntoView({ behavior: "smooth", block: "start" });

  let mieterPdfOk = false;
  console.log("[finishProtocolAsPdf] PDF generation started");
  try {
    completionMieterPdf = generateAndDownloadProtocolPdf(
      buildProtocolPdfInput(context.objektart, context.protokollart, form)
    );
    mieterPdfOk = true;
    console.log(
      `[finishProtocolAsPdf] PDF generated successfully (filename=${completionMieterPdf.filename}, base64Length=${completionMieterPdf.base64.length})`
    );
  } catch (error) {
    // This happens BEFORE any network request — if this throws, the archive
    // upload below is skipped entirely (no Blob/FTPS call at all). renderCompletionTop
    // shows a distinct "PDF konnte nicht erstellt werden" message for this case
    // (mieterPdfOk=false), not the generic upload-failure message.
    console.error(
      "[finishProtocolAsPdf] PDF generation FAILED — archive upload will be skipped entirely (no network request will be made):",
      {
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        rawError: error,
      }
    );
    completionMieterPdf = null;
    mieterPdfOk = false;
  }

  const sessionKey = formDraftKey(context.objektart, context.protokollart);
  let archiveResult: ProtocolArchiveUploadResult | null = null;
  if (mieterPdfOk && completionMieterPdf) {
    // Verhindert, dass der Bildschirm während der (potenziell mehrminütigen,
    // nacheinander laufenden) Foto-/Video-/PDF-Übertragung automatisch sperrt.
    // Ein Bildschirm-Sperren mitten im Upload kann iOS dazu bringen, die
    // Netzwerkverbindung zu unterbrechen — meist trifft das gerade die zuletzt
    // gestartete Übertragung (das PDF), während bereits abgeschlossene
    // Foto-/Video-Uploads unberührt bleiben. Siehe src/wakeLock.ts.
    await acquireUploadWakeLock();
    const uploadStartedAt = Date.now();
    try {
      archiveResult = await uploadProtocolArchive({
        sessionKey,
        pdfFilename: completionMieterPdf.filename,
        pdfBase64: completionMieterPdf.base64,
      });
      console.log(
        `[finishProtocolAsPdf] uploadProtocolArchive result (nach ${Math.round((Date.now() - uploadStartedAt) / 1000)}s):`,
        archiveResult
      );
    } catch (error) {
      console.error("[finishProtocolAsPdf] uploadProtocolArchive threw unexpectedly:", error);
      archiveResult = null;
    } finally {
      await releaseUploadWakeLock();
    }
  } else {
    console.warn(
      "[finishProtocolAsPdf] Skipping uploadProtocolArchive entirely — mieterPdfOk is false (see PDF generation error above)."
    );
  }

  // Only after all transfers finished: final message + email section (no form body).
  renderCompletionTop(context.protokollart, archiveResult, mieterPdfOk);
}

function clearCurrentSessionDraft(): void {
  const context = getCurrentFormContext();
  if (!context) {
    return;
  }
  const sessionKey = formDraftKey(context.objektart, context.protokollart);
  localStorage.removeItem(sessionKey);
  void deleteMediaForSession(sessionKey).catch((error) => console.error(error));
}

function finishSchluesselAsPdf(): void {
  const context = getCurrentFormContext();
  if (!context || context.objektart !== "schluessel") {
    showDraftStatus("PDF-Export ist nur für das Schlüssel-Formular verfügbar.", true);
    return;
  }

  persistSchluesselFromDom();
  const form = loadFormDraft(context.objektart, context.protokollart);

  try {
    generateAndDownloadSchluesselPdf(buildSchluesselPdfInput(context.protokollart, form));
  } catch (error) {
    console.error(error);
    showDraftStatus("PDF konnte nicht erzeugt werden.", true);
    return;
  }

  clearCurrentSessionDraft();
  clearKopfdatenFields();
  resetSignatureUiState();
  localStorage.removeItem(STORAGE_KEYS.objektart);
  localStorage.removeItem(STORAGE_KEYS.protokollart);
  setAppSubtitle(DEFAULT_SUBTITLE, false);
  setAppTitleVisible(true);
  showOnly(viewObjektart);
}

function renderSignatureSection(
  container: HTMLDivElement,
  idPrefix: string,
  onFinish: () => void | Promise<void>,
  options?: { finishLabel?: string }
): void {
  resetSignatureUiState();

  // Datum, Druckbuchstaben-Namen, Zeuge und Unterschriften aus dem Entwurf
  // wiederherstellen (statt sie leer zu lassen) — sonst gehen diese Angaben
  // beim Schließen und erneuten Öffnen eines Entwurfs verloren.
  const context = getCurrentFormContext();
  const saved = context ? loadFormDraft(context.objektart, context.protokollart).signatures : null;
  if (saved) {
    signatureDatum = saved.signatureDatum;
    vermieterDruckbuchstaben = saved.vermieterDruckbuchstaben;
    mieterDruckbuchstaben = saved.mieterDruckbuchstaben;
    zeugeName = saved.zeugeName;
    zeugeAnschrift = saved.zeugeAnschrift;
  }

  const heading = document.createElement("h3");
  heading.className = "section-title";
  heading.textContent = "Unterschriften";
  container.appendChild(heading);

  const datumGroup = document.createElement("div");
  datumGroup.className = "input-group";
  const datumLabel = document.createElement("label");
  datumLabel.htmlFor = `${idPrefix}-signature-datum`;
  datumLabel.textContent = "Datum";
  const datumInput = document.createElement("input");
  datumInput.type = "date";
  datumInput.id = `${idPrefix}-signature-datum`;
  datumInput.value = signatureDatum;
  const updateDatum = (): void => {
    signatureDatum = datumInput.value;
    persistSignaturesFromState();
  };
  datumInput.addEventListener("change", updateDatum);
  datumInput.addEventListener("input", updateDatum);
  datumGroup.append(datumLabel, datumInput);
  container.appendChild(datumGroup);

  const vermieterDruck = createTextField(
    `${idPrefix}-vermieter-druckbuchstaben`,
    "Name in Druckbuchstaben",
    vermieterDruckbuchstaben,
    "text",
    (value) => {
      vermieterDruckbuchstaben = value;
      persistSignaturesFromState();
    },
    "Name des Vermieters"
  );
  const vermieter = createSignaturePadBlock(
    "Vermieter",
    `${idPrefix}-signature-vermieter`,
    vermieterDruck
  );
  container.appendChild(vermieter.block);
  vermieterSignaturePad = new SignaturePad(vermieter.canvas);
  if (saved?.vermieterSignaturePng) {
    vermieterSignaturePad.loadFromDataURL(saved.vermieterSignaturePng);
  }
  const persistAfterVermieterStroke = (): void => persistSignaturesFromState();
  vermieter.canvas.addEventListener("pointerup", persistAfterVermieterStroke);
  vermieter.canvas.addEventListener("pointercancel", persistAfterVermieterStroke);
  vermieter.clearButton.addEventListener("click", () => {
    vermieterSignaturePad?.clear();
    persistSignaturesFromState();
  });

  const mieterDruck = createTextField(
    `${idPrefix}-mieter-druckbuchstaben`,
    "Name in Druckbuchstaben",
    mieterDruckbuchstaben,
    "text",
    (value) => {
      mieterDruckbuchstaben = value;
      persistSignaturesFromState();
    },
    "Name des Mieters"
  );
  const mieter = createSignaturePadBlock("Mieter", `${idPrefix}-signature-mieter`, mieterDruck);
  container.appendChild(mieter.block);
  mieterSignaturePad = new SignaturePad(mieter.canvas);
  if (saved?.mieterSignaturePng) {
    mieterSignaturePad.loadFromDataURL(saved.mieterSignaturePng);
  }
  const persistAfterMieterStroke = (): void => persistSignaturesFromState();
  mieter.canvas.addEventListener("pointerup", persistAfterMieterStroke);
  mieter.canvas.addEventListener("pointercancel", persistAfterMieterStroke);
  mieter.clearButton.addEventListener("click", () => {
    mieterSignaturePad?.clear();
    persistSignaturesFromState();
  });

  const zeugenBlock = document.createElement("div");
  zeugenBlock.className = "signature-block";
  const zeugenHeading = document.createElement("h4");
  zeugenHeading.className = "signature-block-title";
  zeugenHeading.textContent = "Zeuge(n)";
  zeugenBlock.appendChild(zeugenHeading);

  zeugenBlock.appendChild(
    createTextField(
      `${idPrefix}-zeuge-name`,
      "Name",
      zeugeName,
      "text",
      (value) => {
        zeugeName = value;
        persistSignaturesFromState();
      },
      "Name des Zeugen"
    )
  );

  const anschriftGroup = document.createElement("div");
  anschriftGroup.className = "input-group";
  const anschriftLabel = document.createElement("label");
  anschriftLabel.htmlFor = `${idPrefix}-zeuge-anschrift`;
  anschriftLabel.textContent = "Anschrift";
  const anschriftInput = document.createElement("textarea");
  anschriftInput.id = `${idPrefix}-zeuge-anschrift`;
  anschriftInput.rows = 3;
  anschriftInput.placeholder = "Anschrift des Zeugen";
  anschriftInput.value = zeugeAnschrift;
  anschriftInput.addEventListener("input", () => {
    zeugeAnschrift = anschriftInput.value;
    persistSignaturesFromState();
  });
  anschriftGroup.append(anschriftLabel, anschriftInput);
  zeugenBlock.appendChild(anschriftGroup);

  const zeuge = createSignaturePadBlock("Unterschrift", `${idPrefix}-signature-zeuge`);
  zeugenBlock.appendChild(zeuge.block);
  zeugeSignaturePad = new SignaturePad(zeuge.canvas);
  if (saved?.zeugeSignaturePng) {
    zeugeSignaturePad.loadFromDataURL(saved.zeugeSignaturePng);
  }
  const persistAfterZeugeStroke = (): void => persistSignaturesFromState();
  zeuge.canvas.addEventListener("pointerup", persistAfterZeugeStroke);
  zeuge.canvas.addEventListener("pointercancel", persistAfterZeugeStroke);
  zeuge.clearButton.addEventListener("click", () => {
    zeugeSignaturePad?.clear();
    persistSignaturesFromState();
  });

  container.appendChild(zeugenBlock);

  const finishButton = document.createElement("button");
  finishButton.type = "button";
  finishButton.className = "main-btn btn-finish-pdf";
  finishButton.textContent = options?.finishLabel ?? "Fertigstellen und als PDF speichern";
  finishButton.addEventListener("click", () => {
    void Promise.resolve(onFinish());
  });
  container.appendChild(finishButton);
}

function goToProtokollartView(objektart: Objektart): void {
  localStorage.setItem(STORAGE_KEYS.objektart, objektart);
  setAppTitleVisible(true);
  gewaehlteObjektartHeading.textContent = `Gewählt: ${OBJEKTART_LABELS[objektart]}`;
  showOnly(viewProtokollart);
}

function restoreKopfdaten(draft: FormDraft): void {
  const vermieter = requireElement<HTMLSelectElement>("vermieter-auswahl");
  const mietername = requireElement<HTMLInputElement>("mietername");
  const gebaeude = requireElement<HTMLSelectElement>("gebaeude-auswahl");
  const wohnungsnummerLage = requireElement<HTMLInputElement>("wohnungsnummer-lage");
  const datum = requireElement<HTMLInputElement>("besichtigungsdatum");
  const keine = requireElement<HTMLInputElement>("keine-maengel");
  const folgende = requireElement<HTMLInputElement>("folgende-maengel");

  vermieter.value = draft.kopfdaten.vermieter;
  mietername.value = draft.kopfdaten.mietername;
  gebaeude.value = draft.kopfdaten.gebaeudeAuswahl;
  wohnungsnummerLage.value = draft.kopfdaten.wohnungsnummerLage;
  datum.value = draft.kopfdaten.besichtigungsdatum;
  keine.checked = draft.kopfdaten.maengelStatus === "keine";
  folgende.checked = draft.kopfdaten.maengelStatus === "folgende";
}

function clearKopfdatenFields(): void {
  restoreKopfdaten(emptyFormDraft());
  clearSchluesselFields();
}

function persistSchluesselFromDom(): void {
  const mietername = requireElement<HTMLInputElement>("schluessel-mietername");
  const wohnung = requireElement<HTMLInputElement>("schluessel-wohnung");
  const bemerkungen = requireElement<HTMLTextAreaElement>("schluessel-bemerkungen");

  updateCurrentFormDraft((draft) => {
    draft.schluessel = {
      mietername: mietername.value,
      wohnungEinheit: wohnung.value,
      bemerkungen: bemerkungen.value,
      entries: JSON.parse(JSON.stringify(schluesselEntryState)) as SchluesselEntry[],
    };
    draft.meters = null;
  });
}

function createSchluesselAnzahlSelect(
  id: string,
  value: string,
  onChange: (value: string) => void
): HTMLDivElement {
  const group = document.createElement("div");
  group.className = "input-group";

  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = "Anzahl der Schlüssel:";

  const select = document.createElement("select");
  select.id = id;

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.disabled = true;
  placeholder.textContent = "Bitte Anzahl wählen...";
  if (!value) {
    placeholder.selected = true;
  }
  select.appendChild(placeholder);

  for (let n = 1; n <= 12; n += 1) {
    const option = document.createElement("option");
    option.value = String(n);
    option.textContent = String(n);
    if (value === String(n)) {
      option.selected = true;
    }
    select.appendChild(option);
  }

  select.addEventListener("change", () => {
    onChange(select.value);
  });

  group.append(label, select);
  return group;
}

function createSchluesselEntryCard(
  entry: SchluesselEntry,
  index: number,
  showRemove: boolean,
  onRemove: () => void
): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "schluessel-entry-card";

  if (schluesselEntryState.length > 1) {
    const heading = document.createElement("h4");
    heading.className = "schluessel-entry-title";
    heading.textContent = `Schlüssel ${index + 1}`;
    card.appendChild(heading);
  }

  card.appendChild(
    createSchluesselAnzahlSelect(`schluessel-anzahl-${index}`, entry.anzahl, (value) => {
      entry.anzahl = value;
      persistSchluesselFromDom();
    })
  );

  const nummerGroup = document.createElement("div");
  nummerGroup.className = "input-group";

  const nummerLabel = document.createElement("label");
  nummerLabel.htmlFor = `schluessel-nummer-${index}`;
  nummerLabel.textContent = "Schlüsselnummer:";

  const nummerInput = document.createElement("input");
  nummerInput.type = "text";
  nummerInput.id = `schluessel-nummer-${index}`;
  nummerInput.placeholder = "Buchstaben und Zahlen möglich";
  nummerInput.value = entry.schluesselnummer;
  nummerInput.addEventListener("input", () => {
    entry.schluesselnummer = nummerInput.value;
    persistSchluesselFromDom();
  });

  nummerGroup.append(nummerLabel, nummerInput);
  card.appendChild(nummerGroup);

  if (showRemove) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-remove";
    removeBtn.textContent = "Eintrag entfernen";
    removeBtn.addEventListener("click", onRemove);
    card.appendChild(removeBtn);
  }

  return card;
}

function renderSchluesselEntries(): void {
  schluesselEntriesContainer.innerHTML = "";

  schluesselEntryState.forEach((entry, index) => {
    const showRemove = schluesselEntryState.length > 1;
    schluesselEntriesContainer.appendChild(
      createSchluesselEntryCard(entry, index, showRemove, () => {
        schluesselEntryState = schluesselEntryState.filter((_, i) => i !== index);
        if (schluesselEntryState.length === 0) {
          schluesselEntryState = [emptySchluesselEntry()];
        }
        persistSchluesselFromDom();
        renderSchluesselEntries();
      })
    );
  });

  if (schluesselEntryState.length < MAX_SCHLUESSEL_ENTRIES) {
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "btn-add";
    addButton.textContent = "Weiteren Schlüssel hinzufügen";
    addButton.addEventListener("click", () => {
      if (schluesselEntryState.length >= MAX_SCHLUESSEL_ENTRIES) {
        return;
      }
      schluesselEntryState.push(emptySchluesselEntry());
      persistSchluesselFromDom();
      renderSchluesselEntries();
    });
    schluesselEntriesContainer.appendChild(addButton);
  }
}

function restoreSchluessel(draft: FormDraft): void {
  const data = draft.schluessel ?? emptySchluesselDraft();
  requireElement<HTMLInputElement>("schluessel-mietername").value = data.mietername;
  requireElement<HTMLInputElement>("schluessel-wohnung").value = data.wohnungEinheit;
  requireElement<HTMLTextAreaElement>("schluessel-bemerkungen").value = data.bemerkungen;
  schluesselEntryState = JSON.parse(JSON.stringify(data.entries)) as SchluesselEntry[];
  if (schluesselEntryState.length === 0) {
    schluesselEntryState = [emptySchluesselEntry()];
  }
  renderSchluesselEntries();
}

function clearSchluesselFields(): void {
  restoreSchluessel(emptyFormDraft());
}

function initSchluesselAutosave(): void {
  const mietername = requireElement<HTMLInputElement>("schluessel-mietername");
  const wohnung = requireElement<HTMLInputElement>("schluessel-wohnung");
  const bemerkungen = requireElement<HTMLTextAreaElement>("schluessel-bemerkungen");

  mietername.addEventListener("input", persistSchluesselFromDom);
  wohnung.addEventListener("input", persistSchluesselFromDom);
  bemerkungen.addEventListener("input", persistSchluesselFromDom);
}

function persistKopfdatenFromDom(): void {
  const vermieter = requireElement<HTMLSelectElement>("vermieter-auswahl");
  const mietername = requireElement<HTMLInputElement>("mietername");
  const gebaeude = requireElement<HTMLSelectElement>("gebaeude-auswahl");
  const wohnungsnummerLage = requireElement<HTMLInputElement>("wohnungsnummer-lage");
  const datum = requireElement<HTMLInputElement>("besichtigungsdatum");
  const keine = requireElement<HTMLInputElement>("keine-maengel");
  const folgende = requireElement<HTMLInputElement>("folgende-maengel");

  let maengelStatus: KopfdatenDraft["maengelStatus"] = "";
  if (keine.checked) {
    maengelStatus = "keine";
  } else if (folgende.checked) {
    maengelStatus = "folgende";
  }

  updateCurrentFormDraft((draft) => {
    draft.kopfdaten = {
      vermieter: vermieter.value,
      mietername: mietername.value,
      gebaeudeAuswahl: gebaeude.value,
      wohnungsnummerLage: wohnungsnummerLage.value,
      besichtigungsdatum: datum.value,
      maengelStatus,
    };
  });
}

function initKopfdatenAutosave(): void {
  const vermieter = requireElement<HTMLSelectElement>("vermieter-auswahl");
  const mietername = requireElement<HTMLInputElement>("mietername");
  const gebaeude = requireElement<HTMLSelectElement>("gebaeude-auswahl");
  const wohnungsnummerLage = requireElement<HTMLInputElement>("wohnungsnummer-lage");
  const datum = requireElement<HTMLInputElement>("besichtigungsdatum");
  const keine = requireElement<HTMLInputElement>("keine-maengel");
  const folgende = requireElement<HTMLInputElement>("folgende-maengel");

  vermieter.addEventListener("change", persistKopfdatenFromDom);
  mietername.addEventListener("input", persistKopfdatenFromDom);
  gebaeude.addEventListener("change", persistKopfdatenFromDom);
  wohnungsnummerLage.addEventListener("input", persistKopfdatenFromDom);
  datum.addEventListener("change", persistKopfdatenFromDom);
  datum.addEventListener("input", persistKopfdatenFromDom);
  keine.addEventListener("change", persistKopfdatenFromDom);
  folgende.addEventListener("change", persistKopfdatenFromDom);
}

function applyFormLabels(objektart: Objektart, protokollart: Protokollart): void {
  if (objektart === "schluessel") {
    return;
  }
  labelBesichtigt.textContent = "Wohnung/Einheit:";
  labelBesichtigungsdatum.textContent =
    protokollart === "uebergabe" ? "Datum der Übergabe" : "Datum der Rücknahme";
  headingRaeume.textContent = objektart === "garage" ? "Zustand der Garage" : "Zustand der Räume";
}

function setAppSubtitle(text: string, isProtokollart: boolean): void {
  appSubtitle.textContent = text;
  appSubtitle.classList.toggle("is-protokollart", isProtokollart);
}

function setAppTitleVisible(visible: boolean): void {
  appTitle.classList.toggle("hidden", !visible);
}

function protocolSubtitle(objektart: Objektart, protokollart: Protokollart): string {
  const label = PROTOKOLLART_LABELS[protokollart];
  if (objektart === "gewerbe" || objektart === "privat") {
    return `${label} (${OBJEKTART_LABELS[objektart]})`;
  }
  return label;
}

function showFormular(objektart: Objektart, protokollart: Protokollart): void {
  setAppSubtitle(protocolSubtitle(objektart, protokollart), true);
  setAppTitleVisible(false);
  const draft = loadFormDraft(objektart, protokollart);
  hideDraftStatus();

  if (objektart === "schluessel") {
    formStandard.classList.add("hidden");
    formSchluessel.classList.remove("hidden");
    // showOnly() BEFORE building the signature section: renderSignatureSection()
    // constructs signature <canvas> elements and restores saved signature
    // images onto them — while the view container is still hidden (display:
    // none), getBoundingClientRect() reads 0x0, which corrupts the canvas'
    // internal size bookkeeping and can wipe/blur a restored signature.
    // Nothing here depends on the view being hidden during construction
    // (everything below runs synchronously — the browser never paints the
    // "half-built" intermediate state either way).
    showOnly(viewFormular);
    restoreSchluessel(draft);
    if (!draft.schluessel) {
      persistSchluesselFromDom();
    }
    renderSignatureSection(schluesselSignatureContainer, "schluessel", finishSchluesselAsPdf);
    return;
  }

  formSchluessel.classList.add("hidden");
  formStandard.classList.remove("hidden");
  document.getElementById("protocol-completion-top")?.remove();
  setProtocolFormBodyHidden(false);
  // See comment above the schluessel branch — showOnly() must run before any
  // signature <canvas> is constructed/restored.
  showOnly(viewFormular);
  applyFormLabels(objektart, protokollart);
  restoreKopfdaten(draft);
  renderRooms(objektart);
  renderMeterSections(objektart);
  renderClosingSection(objektart, protokollart);
  renderSignatureSection(signatureContainer, "standard", finishProtocolAsPdf, {
    finishLabel:
      protokollart === "uebergabe" ? "Übergabe abschließen" : "Rücknahme abschließen",
  });
}

function goToFormularView(protokollart: Protokollart): void {
  const objektart = localStorage.getItem(STORAGE_KEYS.objektart);
  if (!isObjektart(objektart)) {
    goBackToObjektartView();
    return;
  }
  localStorage.setItem(STORAGE_KEYS.protokollart, protokollart);
  showFormular(objektart, protokollart);
}

function goBackToProtokollartView(): void {
  const objektart = localStorage.getItem(STORAGE_KEYS.objektart);
  if (!isObjektart(objektart)) {
    goBackToObjektartView();
    return;
  }

  localStorage.removeItem(STORAGE_KEYS.protokollart);
  setAppSubtitle(DEFAULT_SUBTITLE, false);
  setAppTitleVisible(true);
  gewaehlteObjektartHeading.textContent = `Gewählt: ${OBJEKTART_LABELS[objektart]}`;
  roomsContainer.innerHTML = "";
  metersContainer.innerHTML = "";
  closingContainer.innerHTML = "";
  resetSignatureUiState();
  showOnly(viewProtokollart);
}

function goBackToObjektartView(): void {
  localStorage.removeItem(STORAGE_KEYS.objektart);
  localStorage.removeItem(STORAGE_KEYS.protokollart);
  roomsContainer.innerHTML = "";
  metersContainer.innerHTML = "";
  closingContainer.innerHTML = "";
  resetSignatureUiState();
  setAppSubtitle(DEFAULT_SUBTITLE, false);
  setAppTitleVisible(true);
  showOnly(viewObjektart);
}

function resetToObjektartView(): void {
  clearAllFormDrafts();
  clearKopfdatenFields();
  goBackToObjektartView();
}

function restoreSelection(): void {
  const storedObjektart = localStorage.getItem(STORAGE_KEYS.objektart);
  const storedProtokollartRaw = localStorage.getItem(STORAGE_KEYS.protokollart);
  const storedProtokollart = normalizeProtokollart(storedProtokollartRaw);

  if (storedProtokollartRaw === "abnahme" && storedProtokollart) {
    localStorage.setItem(STORAGE_KEYS.protokollart, storedProtokollart);
  }

  if (isObjektart(storedObjektart) && storedProtokollart) {
    showFormular(storedObjektart, storedProtokollart);
    return;
  }

  if (isObjektart(storedObjektart)) {
    gewaehlteObjektartHeading.textContent = `Gewählt: ${OBJEKTART_LABELS[storedObjektart]}`;
    showOnly(viewProtokollart);
    return;
  }

  showOnly(viewObjektart);
}

function initEventListeners(): void {
  initKopfdatenAutosave();
  initSchluesselAutosave();

  const objektartButtons = viewObjektart.querySelectorAll<HTMLButtonElement>("button[data-objektart]");
  objektartButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.objektart ?? null;
      if (isObjektart(value)) {
        goToProtokollartView(value);
      }
    });
  });

  const protokollartButtons = viewProtokollart.querySelectorAll<HTMLButtonElement>("button[data-protokollart]");
  protokollartButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.protokollart ?? null;
      if (isProtokollart(value)) {
        goToFormularView(value);
      }
    });
  });

  btnMeineEntwuerfe.addEventListener("click", () => {
    goToEntwuerfeView();
  });

  btnZurueckEntwuerfe.addEventListener("click", () => {
    goBackToObjektartView();
  });

  btnEntwurfSpeichern.addEventListener("click", () => {
    saveCurrentAsNamedDraft();
  });

  btnZurueck.addEventListener("click", () => {
    goBackToObjektartView();
  });

  btnZurueckFormular.addEventListener("click", () => {
    goBackToProtokollartView();
  });

  btnNeustart.addEventListener("click", () => {
    resetToObjektartView();
  });
}

function init(): void {
  populateGebaeudeSelect();
  initEventListeners();
  restoreSelection();
  // Safari/WebKit: verify Blob/ArrayBuffer IDB write path early (log-only).
  void runMediaDbSelfTest();
}

document.addEventListener("DOMContentLoaded", init);
