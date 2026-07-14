// Kithan App – Anwendungslogik (Prototyp)
// Ablauf: Objektart wählen -> Protokollart wählen -> Formular (Kopfdaten + Räume)

type Objektart = "gewerbe" | "privat" | "garage";
type Protokollart = "uebergabe" | "abnahme";

interface RaumConfig {
  id: string;
  label: string;
}

const RAEUME: Record<Objektart, RaumConfig[]> = {
  privat: [
    { id: "flur", label: "Flur" },
    { id: "kueche", label: "Küche" },
    { id: "bad-wc", label: "Bad/WC" },
    { id: "wohnzimmer", label: "Wohnzimmer" },
    { id: "balkon", label: "Balkon" },
    { id: "schlafzimmer", label: "Schlafzimmer" },
    { id: "kinderzimmer", label: "Kinderzimmer" },
    { id: "keller", label: "Keller" },
    { id: "weitere-raeume-1", label: "Weitere Räume 1" },
    { id: "weitere-raeume-2", label: "Weitere Räume 2" },
  ],
  gewerbe: [
    { id: "flur", label: "Flur" },
    { id: "kueche", label: "Küche" },
    { id: "bad-wc", label: "Bad/WC" },
    { id: "buero", label: "Büro" },
    { id: "balkon", label: "Balkon" },
    { id: "keller", label: "Keller" },
    { id: "weitere-raeume-1", label: "Weitere Räume 1" },
    { id: "weitere-raeume-2", label: "Weitere Räume 2" },
  ],
  garage: [{ id: "garage-stellplatz", label: "Garage/Stellplatz" }],
};

const OBJEKTART_LABELS: Record<Objektart, string> = {
  gewerbe: "Gewerbe",
  privat: "Privat",
  garage: "Garage",
};

const STORAGE_KEYS = {
  objektart: "kithan_objektart",
  protokollart: "kithan_protokollart",
} as const;

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
  return value === "gewerbe" || value === "privat" || value === "garage";
}

function isProtokollart(value: string | null): value is Protokollart {
  return value === "uebergabe" || value === "abnahme";
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
const viewFormular = requireElement<HTMLDivElement>("view-formular");
const gewaehlteObjektartHeading = requireElement<HTMLHeadingElement>("gewaehlte-objektart");
const roomsContainer = requireElement<HTMLDivElement>("rooms-container");
const metersContainer = requireElement<HTMLDivElement>("meters-container");
const btnZurueck = requireElement<HTMLButtonElement>("btn-zurueck");
const btnNeustart = requireElement<HTMLButtonElement>("btn-neustart");

function showOnly(view: HTMLElement): void {
  for (const v of [viewObjektart, viewProtokollart, viewFormular]) {
    v.classList.toggle("hidden", v !== view);
  }
}

function renderRooms(objektart: Objektart): void {
  roomsContainer.innerHTML = "";

  RAEUME[objektart].forEach((raum, index) => {
    const card = document.createElement("div");
    card.className = "raum-karte";

    const heading = document.createElement("h4");
    heading.textContent = `${index + 1}. ${raum.label}`;
    card.appendChild(heading);

    const okGroup = document.createElement("div");
    okGroup.className = "radio-group";
    okGroup.style.marginBottom = "10px";

    const okCheckbox = document.createElement("input");
    okCheckbox.type = "checkbox";
    okCheckbox.id = `${raum.id}-ok`;

    const okLabel = document.createElement("label");
    okLabel.htmlFor = okCheckbox.id;
    okLabel.textContent = "In Ordnung (ja)";

    okGroup.appendChild(okCheckbox);
    okGroup.appendChild(okLabel);
    card.appendChild(okGroup);

    card.appendChild(
      createTextareaGroup(`${raum.id}-maengel`, "Festgestellte Mängel:", "Mängel hier eintragen...")
    );
    card.appendChild(
      createTextareaGroup(`${raum.id}-bemerkungen`, "Bemerkungen:", "Sonstige Notizen...")
    );

    roomsContainer.appendChild(card);
  });
}

function createTextareaGroup(id: string, labelText: string, placeholder: string): HTMLDivElement {
  const group = document.createElement("div");
  group.className = "input-group";

  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = labelText;

  const textarea = document.createElement("textarea");
  textarea.id = id;
  textarea.rows = 2;
  textarea.placeholder = placeholder;

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
    })
  );

  const grid = document.createElement("div");
  grid.className = "field-grid-2";
  grid.appendChild(
    createTextField(`${entry.id}-ht`, "HT – Hochtarif:", entry.htReading, "decimal", (value) => {
      entry.htReading = value;
    })
  );
  grid.appendChild(
    createTextField(`${entry.id}-nt`, "NT – Niedertarif:", entry.ntReading, "decimal", (value) => {
      entry.ntReading = value;
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
    })
  );
  grid.appendChild(
    createTextField(`${entry.id}-stand`, "Zählerstand:", entry.reading, "decimal", (value) => {
      entry.reading = value;
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
    renderStandardMeterSection(config, container);
  });
  container.appendChild(addButton);
}

function renderMeterSections(objektart: Objektart): void {
  metersContainer.innerHTML = "";

  if (objektart === "garage") {
    return;
  }

  meterState = createInitialMeterState();

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

function goToProtokollartView(objektart: Objektart): void {
  localStorage.setItem(STORAGE_KEYS.objektart, objektart);
  gewaehlteObjektartHeading.textContent = `Gewählt: ${OBJEKTART_LABELS[objektart]}`;
  showOnly(viewProtokollart);
}

function goToFormularView(protokollart: Protokollart): void {
  const objektart = localStorage.getItem(STORAGE_KEYS.objektart);
  if (!isObjektart(objektart)) {
    resetToObjektartView();
    return;
  }
  localStorage.setItem(STORAGE_KEYS.protokollart, protokollart);
  renderRooms(objektart);
  renderMeterSections(objektart);
  showOnly(viewFormular);
}

function resetToObjektartView(): void {
  localStorage.removeItem(STORAGE_KEYS.objektart);
  localStorage.removeItem(STORAGE_KEYS.protokollart);
  roomsContainer.innerHTML = "";
  metersContainer.innerHTML = "";
  showOnly(viewObjektart);
}

function restoreSelection(): void {
  const storedObjektart = localStorage.getItem(STORAGE_KEYS.objektart);
  const storedProtokollart = localStorage.getItem(STORAGE_KEYS.protokollart);

  if (isObjektart(storedObjektart) && isProtokollart(storedProtokollart)) {
    renderRooms(storedObjektart);
    renderMeterSections(storedObjektart);
    showOnly(viewFormular);
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

  btnZurueck.addEventListener("click", () => {
    resetToObjektartView();
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
