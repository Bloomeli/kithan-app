// Kithan App – Anwendungslogik (Prototyp)
// Ablauf: Objektart wählen -> Protokollart wählen -> Formular (Kopfdaten + Räume)

import { SignaturePad } from "./signaturePad";
import {
  generateAndDownloadProtocolPdf,
  type ProtocolPdfInput,
  type ProtocolPdfKeyLine,
  type ProtocolPdfRoom,
  type ProtocolPdfStandardMeter,
} from "./generateProtocolPdf";

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
  mietername: string;
  gebaeudeAuswahl: string;
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

interface FormDraft {
  kopfdaten: KopfdatenDraft;
  rooms: Record<string, RoomDraft>;
  meters: MeterState | null;
  garageRooms: GarageRoomEntry[] | null;
  bueroRooms: BueroRoomEntry[] | null;
  weitereRaeume: WeitereRaumEntry[] | null;
  schluessel: SchluesselDraft | null;
  closing: ClosingDraft | null;
}

function formDraftKey(objektart: Objektart, protokollart: Protokollart): string {
  return `${FORM_DRAFT_PREFIX}${objektart}_${protokollart}`;
}

function emptyKopfdaten(): KopfdatenDraft {
  return {
    mietername: "",
    gebaeudeAuswahl: "",
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
    return {
      kopfdaten: { ...emptyKopfdaten(), ...(parsed.kopfdaten ?? {}) },
      rooms: normalizeRoomsMap(parsed.rooms ?? {}),
      meters: parsed.meters ?? null,
      garageRooms: parsed.garageRooms ?? null,
      bueroRooms: parsed.bueroRooms ?? null,
      weitereRaeume: parsed.weitereRaeume ?? null,
      schluessel: normalizeSchluesselDraft(parsed.schluessel),
      closing: normalizeClosingDraft(parsed.closing),
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
  keysToRemove.forEach((key) => localStorage.removeItem(key));
}

// --- Explizite Entwürfe (getrennt vom Session-Autosave) -----------------

interface NamedProtocolDraft {
  id: string;
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
  const select = document.getElementById("gebaeude-auswahl") as HTMLSelectElement | null;
  if (!select) {
    return value;
  }
  const option = Array.from(select.options).find((item) => item.value === value);
  return option?.textContent?.trim() || value;
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

  const now = new Date().toISOString();
  const named: NamedProtocolDraft = {
    id: generateId("named-draft"),
    createdAt: now,
    updatedAt: now,
    objektart: context.objektart,
    protokollart: context.protokollart,
    form: JSON.parse(JSON.stringify(form)) as FormDraft,
  };

  drafts.unshift(named);
  saveNamedDrafts(drafts);
  showDraftStatus("Entwurf gespeichert.");
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
    title: "Wärmepumpe",
    addButtonLabel: "+ Weiteren Wärmepumpenzähler hinzufügen",
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
let signatureDatum = "";
let zeugeName = "";
let zeugeAnschrift = "";

const MAX_SCHLUESSEL_ENTRIES = 2;
let weitereRaumState: WeitereRaumEntry[] = [];

const MAX_BUERO_ROOMS = 6;
const MAX_WEITERE_RAEUME = 4;

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
const labelBesichtigt = requireElement<HTMLLabelElement>("label-besichtigt");
const labelBesichtigungsdatum = requireElement<HTMLLabelElement>("label-besichtigungsdatum");
const headingRaeume = requireElement<HTMLHeadingElement>("heading-raeume");
const roomsContainer = requireElement<HTMLDivElement>("rooms-container");
const metersContainer = requireElement<HTMLDivElement>("meters-container");
const closingContainer = requireElement<HTMLDivElement>("closing-container");
const signatureContainer = requireElement<HTMLDivElement>("signature-container");
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

function createStaticRoomCard(raum: RaumConfig, number: number, roomDraft: RoomDraft): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "raum-karte";

  const heading = document.createElement("h4");
  heading.textContent = `${number}. ${raum.label}`;
  card.appendChild(heading);

  card.appendChild(
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

  const okGroup = document.createElement("div");
  okGroup.className = "radio-group room-ok-row";

  const okCheckbox = document.createElement("input");
  okCheckbox.type = "checkbox";
  okCheckbox.id = `${raum.id}-ok`;
  okCheckbox.checked = roomDraft.ok;
  okCheckbox.addEventListener("change", () => {
    updateCurrentFormDraft((current) => {
      const existing = normalizeRoomDraft(current.rooms[raum.id]);
      current.rooms[raum.id] = { ...existing, ok: okCheckbox.checked };
    });
  });

  const okLabel = document.createElement("label");
  okLabel.htmlFor = okCheckbox.id;
  okLabel.textContent = "In Ordnung (ja)";

  okGroup.appendChild(okCheckbox);
  okGroup.appendChild(okLabel);
  card.appendChild(okGroup);

  card.appendChild(
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
  card.appendChild(
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

function createWeitereRaumCard(
  entry: WeitereRaumEntry,
  index: number,
  showRemove: boolean,
  onRemove: () => void
): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "raum-karte";

  const heading = document.createElement("h4");
  heading.textContent = `Weitere Räume ${index + 1}`;
  card.appendChild(heading);

  card.appendChild(
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

  const okGroup = document.createElement("div");
  okGroup.className = "radio-group room-ok-row";

  const okCheckbox = document.createElement("input");
  okCheckbox.type = "checkbox";
  okCheckbox.id = `${entry.id}-ok`;
  okCheckbox.checked = entry.ok;
  okCheckbox.addEventListener("change", () => {
    entry.ok = okCheckbox.checked;
    persistWeitereRaeume();
  });

  const okLabel = document.createElement("label");
  okLabel.htmlFor = okCheckbox.id;
  okLabel.textContent = "In Ordnung (ja)";

  okGroup.appendChild(okCheckbox);
  okGroup.appendChild(okLabel);
  card.appendChild(okGroup);

  card.appendChild(
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
  card.appendChild(
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

  if (showRemove) {
    const removeButton = createRemoveButton(onRemove);
    removeButton.textContent = "Raum entfernen";
    card.appendChild(removeButton);
  }

  return card;
}

function appendWeitereRaeumeBlock(): void {
  const wrapper = document.createElement("div");
  wrapper.id = "weitere-raeume-block";

  weitereRaumState.forEach((entry, index) => {
    const showRemove = weitereRaumState.length > 1;
    wrapper.appendChild(
      createWeitereRaumCard(entry, index, showRemove, () => {
        weitereRaumState = weitereRaumState.filter((e) => e.id !== entry.id);
        persistWeitereRaeume();
        renderRooms("privat");
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
      renderRooms("privat");
    });
    wrapper.appendChild(addButton);
  }

  roomsContainer.appendChild(wrapper);
}

function renderPrivatRooms(draft: FormDraft): void {
  weitereRaumState = draft.weitereRaeume
    ? (JSON.parse(JSON.stringify(draft.weitereRaeume)) as WeitereRaumEntry[]).map(normalizeExpandableRoomEntry)
    : createInitialWeitereRaeume(draft);

  if (weitereRaumState.length > MAX_WEITERE_RAEUME) {
    weitereRaumState = weitereRaumState.slice(0, MAX_WEITERE_RAEUME);
  }

  if (!draft.weitereRaeume) {
    persistWeitereRaeume();
  }

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
  const card = document.createElement("div");
  card.className = "raum-karte";

  const heading = document.createElement("h4");
  heading.textContent = `Büro ${index + 1}`;
  card.appendChild(heading);

  card.appendChild(
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

  const okGroup = document.createElement("div");
  okGroup.className = "radio-group room-ok-row";

  const okCheckbox = document.createElement("input");
  okCheckbox.type = "checkbox";
  okCheckbox.id = `${entry.id}-ok`;
  okCheckbox.checked = entry.ok;
  okCheckbox.addEventListener("change", () => {
    entry.ok = okCheckbox.checked;
    persistBueroRooms();
  });

  const okLabel = document.createElement("label");
  okLabel.htmlFor = okCheckbox.id;
  okLabel.textContent = "In Ordnung (ja)";

  okGroup.appendChild(okCheckbox);
  okGroup.appendChild(okLabel);
  card.appendChild(okGroup);

  card.appendChild(
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
  card.appendChild(
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
    card.appendChild(removeButton);
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

  let number = 1;
  RAEUME.gewerbe.forEach((raum) => {
    roomsContainer.appendChild(createStaticRoomCard(raum, number, draft.rooms[raum.id] ?? emptyRoomDraft()));
    number += 1;
    if (raum.id === "bad-wc") {
      appendBueroRoomsBlock();
    }
  });
}

function createGarageRoomCard(
  entry: GarageRoomEntry,
  index: number,
  showRemove: boolean,
  onRemove: () => void
): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "raum-karte";

  const heading = document.createElement("h4");
  heading.textContent = `Garage ${index + 1}`;
  card.appendChild(heading);

  card.appendChild(
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

  const okGroup = document.createElement("div");
  okGroup.className = "radio-group room-ok-row";

  const okCheckbox = document.createElement("input");
  okCheckbox.type = "checkbox";
  okCheckbox.id = `${entry.id}-ok`;
  okCheckbox.checked = entry.ok;
  okCheckbox.addEventListener("change", () => {
    entry.ok = okCheckbox.checked;
    persistGarageRooms();
  });

  const okLabel = document.createElement("label");
  okLabel.htmlFor = okCheckbox.id;
  okLabel.textContent = "In Ordnung (ja)";

  okGroup.appendChild(okCheckbox);
  okGroup.appendChild(okLabel);
  card.appendChild(okGroup);

  card.appendChild(
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
  card.appendChild(
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
    card.appendChild(removeButton);
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

function createElectricityCard(
  entry: ElectricityMeterEntry,
  index: number,
  showRemove: boolean,
  onRemove: () => void
): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "raum-karte meter-karte";

  const heading = document.createElement("h4");
  heading.textContent = `Stromzähler ${index + 1}`;
  card.appendChild(heading);

  card.appendChild(
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
  card.appendChild(grid);

  card.appendChild(
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

  if (showRemove) {
    card.appendChild(createRemoveButton(onRemove));
  }

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
  const card = document.createElement("div");
  card.className = "raum-karte meter-karte";

  const heading = document.createElement("h4");
  heading.textContent = `${config.title} ${index + 1}`;
  card.appendChild(heading);

  if (config.withLocation) {
    card.appendChild(
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
  card.appendChild(grid);

  card.appendChild(
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

  if (showRemove) {
    card.appendChild(createRemoveButton(onRemove));
  }

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
  vermieterSignaturePad = null;
  mieterSignaturePad = null;
}

function resetSignatureUiState(): void {
  destroySignaturePads();
  signatureDatum = "";
  zeugeName = "";
  zeugeAnschrift = "";
  signatureContainer.innerHTML = "";
}

function createSignaturePadBlock(title: string, canvasId: string): {
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

function collectRoomsForPdf(objektart: "gewerbe" | "privat", form: FormDraft): ProtocolPdfRoom[] {
  const rooms: ProtocolPdfRoom[] = [];

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
        label: `Weitere Räume ${index + 1}`,
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

function buildProtocolPdfInput(
  objektart: "gewerbe" | "privat",
  protokollart: Protokollart,
  form: FormDraft
): ProtocolPdfInput {
  return {
    objektartLabel: OBJEKTART_LABELS[objektart],
    protokollartLabel: PROTOKOLLART_LABELS[protokollart],
    keyVerb: keyHandoverVerb(protokollart),
    mietername: form.kopfdaten.mietername,
    wohnungEinheit: getGebaeudeLabel(form.kopfdaten.gebaeudeAuswahl),
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
    vermieterSignaturePng: vermieterSignaturePad && !vermieterSignaturePad.isEmpty()
      ? vermieterSignaturePad.toDataURL("image/png")
      : null,
    mieterSignaturePng: mieterSignaturePad && !mieterSignaturePad.isEmpty()
      ? mieterSignaturePad.toDataURL("image/png")
      : null,
    zeugeName,
    zeugeAnschrift,
  };
}

function clearCurrentSessionDraft(): void {
  const context = getCurrentFormContext();
  if (!context) {
    return;
  }
  localStorage.removeItem(formDraftKey(context.objektart, context.protokollart));
}

function finishProtocolAsPdf(): void {
  const context = getCurrentFormContext();
  if (!context || (context.objektart !== "gewerbe" && context.objektart !== "privat")) {
    showDraftStatus("PDF-Export ist nur für Gewerbe/Privat verfügbar.", true);
    return;
  }

  const form = syncCurrentFormToSessionDraft();
  if (!form) {
    showDraftStatus("Formular konnte nicht gelesen werden.", true);
    return;
  }

  try {
    generateAndDownloadProtocolPdf(buildProtocolPdfInput(context.objektart, context.protokollart, form));
  } catch (error) {
    console.error(error);
    showDraftStatus("PDF konnte nicht erzeugt werden.", true);
    return;
  }

  clearCurrentSessionDraft();
  clearKopfdatenFields();
  resetSignatureUiState();
  roomsContainer.innerHTML = "";
  metersContainer.innerHTML = "";
  closingContainer.innerHTML = "";
  localStorage.removeItem(STORAGE_KEYS.objektart);
  localStorage.removeItem(STORAGE_KEYS.protokollart);
  setAppSubtitle(DEFAULT_SUBTITLE, false);
  showOnly(viewObjektart);
}

function renderSignatureSection(objektart: Objektart): void {
  resetSignatureUiState();

  if (objektart === "garage" || objektart === "schluessel") {
    return;
  }

  const heading = document.createElement("h3");
  heading.className = "section-title";
  heading.textContent = "Unterschriften";
  signatureContainer.appendChild(heading);

  const datumGroup = document.createElement("div");
  datumGroup.className = "input-group";
  const datumLabel = document.createElement("label");
  datumLabel.htmlFor = "signature-datum";
  datumLabel.textContent = "Datum";
  const datumInput = document.createElement("input");
  datumInput.type = "date";
  datumInput.id = "signature-datum";
  datumInput.value = signatureDatum;
  datumInput.addEventListener("change", () => {
    signatureDatum = datumInput.value;
  });
  datumInput.addEventListener("input", () => {
    signatureDatum = datumInput.value;
  });
  datumGroup.append(datumLabel, datumInput);
  signatureContainer.appendChild(datumGroup);

  const vermieter = createSignaturePadBlock("Vermieter", "signature-vermieter");
  signatureContainer.appendChild(vermieter.block);
  vermieterSignaturePad = new SignaturePad(vermieter.canvas);
  vermieter.clearButton.addEventListener("click", () => {
    vermieterSignaturePad?.clear();
  });

  const mieter = createSignaturePadBlock("Mieter", "signature-mieter");
  signatureContainer.appendChild(mieter.block);
  mieterSignaturePad = new SignaturePad(mieter.canvas);
  mieter.clearButton.addEventListener("click", () => {
    mieterSignaturePad?.clear();
  });

  const zeugenBlock = document.createElement("div");
  zeugenBlock.className = "signature-block";
  const zeugenHeading = document.createElement("h4");
  zeugenHeading.className = "signature-block-title";
  zeugenHeading.textContent = "Zeuge(n)";
  zeugenBlock.appendChild(zeugenHeading);

  const nameGroup = document.createElement("div");
  nameGroup.className = "input-group";
  const nameLabel = document.createElement("label");
  nameLabel.htmlFor = "zeuge-name";
  nameLabel.textContent = "Name";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.id = "zeuge-name";
  nameInput.placeholder = "Name des Zeugen";
  nameInput.value = zeugeName;
  nameInput.addEventListener("input", () => {
    zeugeName = nameInput.value;
  });
  nameGroup.append(nameLabel, nameInput);
  zeugenBlock.appendChild(nameGroup);

  const anschriftGroup = document.createElement("div");
  anschriftGroup.className = "input-group";
  const anschriftLabel = document.createElement("label");
  anschriftLabel.htmlFor = "zeuge-anschrift";
  anschriftLabel.textContent = "Anschrift";
  const anschriftInput = document.createElement("textarea");
  anschriftInput.id = "zeuge-anschrift";
  anschriftInput.rows = 3;
  anschriftInput.placeholder = "Anschrift des Zeugen";
  anschriftInput.value = zeugeAnschrift;
  anschriftInput.addEventListener("input", () => {
    zeugeAnschrift = anschriftInput.value;
  });
  anschriftGroup.append(anschriftLabel, anschriftInput);
  zeugenBlock.appendChild(anschriftGroup);
  signatureContainer.appendChild(zeugenBlock);

  const finishButton = document.createElement("button");
  finishButton.type = "button";
  finishButton.className = "main-btn btn-finish-pdf";
  finishButton.textContent = "Fertigstellen und als PDF speichern";
  finishButton.addEventListener("click", () => {
    finishProtocolAsPdf();
  });
  signatureContainer.appendChild(finishButton);
}

function goToProtokollartView(objektart: Objektart): void {
  localStorage.setItem(STORAGE_KEYS.objektart, objektart);
  gewaehlteObjektartHeading.textContent = `Gewählt: ${OBJEKTART_LABELS[objektart]}`;
  showOnly(viewProtokollart);
}

function restoreKopfdaten(draft: FormDraft): void {
  const mietername = requireElement<HTMLInputElement>("mietername");
  const gebaeude = requireElement<HTMLSelectElement>("gebaeude-auswahl");
  const datum = requireElement<HTMLInputElement>("besichtigungsdatum");
  const keine = requireElement<HTMLInputElement>("keine-maengel");
  const folgende = requireElement<HTMLInputElement>("folgende-maengel");

  mietername.value = draft.kopfdaten.mietername;
  gebaeude.value = draft.kopfdaten.gebaeudeAuswahl;
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
  const mietername = requireElement<HTMLInputElement>("mietername");
  const gebaeude = requireElement<HTMLSelectElement>("gebaeude-auswahl");
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
      mietername: mietername.value,
      gebaeudeAuswahl: gebaeude.value,
      besichtigungsdatum: datum.value,
      maengelStatus,
    };
  });
}

function initKopfdatenAutosave(): void {
  const mietername = requireElement<HTMLInputElement>("mietername");
  const gebaeude = requireElement<HTMLSelectElement>("gebaeude-auswahl");
  const datum = requireElement<HTMLInputElement>("besichtigungsdatum");
  const keine = requireElement<HTMLInputElement>("keine-maengel");
  const folgende = requireElement<HTMLInputElement>("folgende-maengel");

  mietername.addEventListener("input", persistKopfdatenFromDom);
  gebaeude.addEventListener("change", persistKopfdatenFromDom);
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

function showFormular(objektart: Objektart, protokollart: Protokollart): void {
  setAppSubtitle(PROTOKOLLART_LABELS[protokollart], true);
  const draft = loadFormDraft(objektart, protokollart);
  hideDraftStatus();

  if (objektart === "schluessel") {
    formStandard.classList.add("hidden");
    formSchluessel.classList.remove("hidden");
    resetSignatureUiState();
    restoreSchluessel(draft);
    if (!draft.schluessel) {
      persistSchluesselFromDom();
    }
    showOnly(viewFormular);
    return;
  }

  formSchluessel.classList.add("hidden");
  formStandard.classList.remove("hidden");
  applyFormLabels(objektart, protokollart);
  restoreKopfdaten(draft);
  renderRooms(objektart);
  renderMeterSections(objektart);
  renderClosingSection(objektart, protokollart);
  renderSignatureSection(objektart);
  showOnly(viewFormular);
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
  initEventListeners();
  restoreSelection();
}

document.addEventListener("DOMContentLoaded", init);
