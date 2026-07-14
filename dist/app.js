"use strict";
// Kithan App – Anwendungslogik (Prototyp)
// Ablauf: Objektart wählen -> Protokollart wählen -> Formular (Kopfdaten + Räume)
const RAEUME = {
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
const OBJEKTART_LABELS = {
    gewerbe: "Gewerbe",
    privat: "Privat",
    garage: "Garage",
};
const STORAGE_KEYS = {
    objektart: "kithan_objektart",
    protokollart: "kithan_protokollart",
};
const STANDARD_METER_SECTIONS = [
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
function generateId(prefix) {
    idCounter += 1;
    return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}
function createElectricityEntry() {
    return { id: generateId("strom"), meterNumber: "", htReading: "", ntReading: "", notes: "" };
}
function createStandardEntry(type, withLocation) {
    const entry = { id: generateId(type), meterNumber: "", reading: "", notes: "" };
    if (withLocation) {
        entry.location = "";
    }
    return entry;
}
function createInitialMeterState() {
    return {
        strom: [createElectricityEntry()],
        gas: [createStandardEntry("gas", false)],
        waermepumpe: [createStandardEntry("waermepumpe", false)],
        kaltwasser: [createStandardEntry("kaltwasser", true)],
        warmwasser: [createStandardEntry("warmwasser", true)],
    };
}
let meterState = createInitialMeterState();
function getStandardEntries(type) {
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
function setStandardEntries(type, entries) {
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
function isObjektart(value) {
    return value === "gewerbe" || value === "privat" || value === "garage";
}
function isProtokollart(value) {
    return value === "uebergabe" || value === "abnahme";
}
function requireElement(id) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Element mit id "${id}" wurde nicht gefunden.`);
    }
    return element;
}
const viewObjektart = requireElement("view-objektart");
const viewProtokollart = requireElement("view-protokollart");
const viewFormular = requireElement("view-formular");
const gewaehlteObjektartHeading = requireElement("gewaehlte-objektart");
const roomsContainer = requireElement("rooms-container");
const metersContainer = requireElement("meters-container");
const btnZurueck = requireElement("btn-zurueck");
const btnNeustart = requireElement("btn-neustart");
function showOnly(view) {
    for (const v of [viewObjektart, viewProtokollart, viewFormular]) {
        v.classList.toggle("hidden", v !== view);
    }
}
function renderRooms(objektart) {
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
        card.appendChild(createTextareaGroup(`${raum.id}-maengel`, "Festgestellte Mängel:", "Mängel hier eintragen..."));
        card.appendChild(createTextareaGroup(`${raum.id}-bemerkungen`, "Bemerkungen:", "Sonstige Notizen..."));
        roomsContainer.appendChild(card);
    });
}
function createTextareaGroup(id, labelText, placeholder) {
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
function createTextField(id, labelText, value, mode, onChange, placeholder = "") {
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
function createTextareaField(id, labelText, value, onChange, placeholder = "") {
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
function createRemoveButton(onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-remove";
    button.textContent = "Zähler entfernen";
    button.addEventListener("click", onClick);
    return button;
}
function createElectricityCard(entry, index, showRemove, onRemove) {
    const card = document.createElement("div");
    card.className = "raum-karte meter-karte";
    const heading = document.createElement("h4");
    heading.textContent = `Stromzähler ${index + 1}`;
    card.appendChild(heading);
    card.appendChild(createTextField(`${entry.id}-nummer`, "Zählernummer:", entry.meterNumber, "text", (value) => {
        entry.meterNumber = value;
    }));
    const grid = document.createElement("div");
    grid.className = "field-grid-2";
    grid.appendChild(createTextField(`${entry.id}-ht`, "HT – Hochtarif:", entry.htReading, "decimal", (value) => {
        entry.htReading = value;
    }));
    grid.appendChild(createTextField(`${entry.id}-nt`, "NT – Niedertarif:", entry.ntReading, "decimal", (value) => {
        entry.ntReading = value;
    }));
    card.appendChild(grid);
    card.appendChild(createTextareaField(`${entry.id}-bemerkungen`, "Bemerkungen (optional):", entry.notes, (value) => {
        entry.notes = value;
    }, "Sonstige Notizen..."));
    if (showRemove) {
        card.appendChild(createRemoveButton(onRemove));
    }
    return card;
}
function renderElectricitySection(container) {
    container.innerHTML = "";
    const heading = document.createElement("h4");
    heading.className = "meter-section-title";
    heading.textContent = "Stromzähler";
    container.appendChild(heading);
    const cardsWrapper = document.createElement("div");
    meterState.strom.forEach((entry, index) => {
        const showRemove = meterState.strom.length > 1;
        cardsWrapper.appendChild(createElectricityCard(entry, index, showRemove, () => {
            meterState.strom = meterState.strom.filter((e) => e.id !== entry.id);
            renderElectricitySection(container);
        }));
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
function createStandardMeterCard(config, entry, index, showRemove, onRemove) {
    var _a, _b;
    const card = document.createElement("div");
    card.className = "raum-karte meter-karte";
    const heading = document.createElement("h4");
    heading.textContent = `${config.title} ${index + 1}`;
    card.appendChild(heading);
    if (config.withLocation) {
        card.appendChild(createTextField(`${entry.id}-standort`, "Bezeichnung/Standort:", (_a = entry.location) !== null && _a !== void 0 ? _a : "", "text", (value) => {
            entry.location = value;
        }, (_b = config.locationPlaceholder) !== null && _b !== void 0 ? _b : ""));
    }
    const grid = document.createElement("div");
    grid.className = "field-grid-2";
    grid.appendChild(createTextField(`${entry.id}-nummer`, "Zählernummer:", entry.meterNumber, "text", (value) => {
        entry.meterNumber = value;
    }));
    grid.appendChild(createTextField(`${entry.id}-stand`, "Zählerstand:", entry.reading, "decimal", (value) => {
        entry.reading = value;
    }));
    card.appendChild(grid);
    card.appendChild(createTextareaField(`${entry.id}-bemerkungen`, "Bemerkungen (optional):", entry.notes, (value) => {
        entry.notes = value;
    }, "Sonstige Notizen..."));
    if (showRemove) {
        card.appendChild(createRemoveButton(onRemove));
    }
    return card;
}
function renderStandardMeterSection(config, container) {
    container.innerHTML = "";
    const heading = document.createElement("h4");
    heading.className = "meter-section-title";
    heading.textContent = config.title;
    container.appendChild(heading);
    const cardsWrapper = document.createElement("div");
    const entries = getStandardEntries(config.type);
    entries.forEach((entry, index) => {
        const showRemove = entries.length > 1;
        cardsWrapper.appendChild(createStandardMeterCard(config, entry, index, showRemove, () => {
            setStandardEntries(config.type, getStandardEntries(config.type).filter((e) => e.id !== entry.id));
            renderStandardMeterSection(config, container);
        }));
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
function renderMeterSections(objektart) {
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
function goToProtokollartView(objektart) {
    localStorage.setItem(STORAGE_KEYS.objektart, objektart);
    gewaehlteObjektartHeading.textContent = `Gewählt: ${OBJEKTART_LABELS[objektart]}`;
    showOnly(viewProtokollart);
}
function goToFormularView(protokollart) {
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
function resetToObjektartView() {
    localStorage.removeItem(STORAGE_KEYS.objektart);
    localStorage.removeItem(STORAGE_KEYS.protokollart);
    roomsContainer.innerHTML = "";
    metersContainer.innerHTML = "";
    showOnly(viewObjektart);
}
function restoreSelection() {
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
function initEventListeners() {
    const objektartButtons = viewObjektart.querySelectorAll("button[data-objektart]");
    objektartButtons.forEach((button) => {
        button.addEventListener("click", () => {
            var _a;
            const value = (_a = button.dataset.objektart) !== null && _a !== void 0 ? _a : null;
            if (isObjektart(value)) {
                goToProtokollartView(value);
            }
        });
    });
    const protokollartButtons = viewProtokollart.querySelectorAll("button[data-protokollart]");
    protokollartButtons.forEach((button) => {
        button.addEventListener("click", () => {
            var _a;
            const value = (_a = button.dataset.protokollart) !== null && _a !== void 0 ? _a : null;
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
function init() {
    initEventListeners();
    restoreSelection();
}
document.addEventListener("DOMContentLoaded", init);
