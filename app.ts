// app.ts - Logik & Offline-Speicherung für die Kithan App

// Schritt 1: Objektart auswählen
function selectObjekt(objektArt: string): void {
    // 1. Im Local Storage speichern
    localStorage.setItem('kithan_aktuelle_objektart', objektArt);

    // 2. Ansicht 1 (Objektart) ausblenden
    document.getElementById('view-objektart')?.classList.add('hidden');

    // 3. Ansicht 2 (Protokollart) einblenden
    document.getElementById('view-protokollart')?.classList.remove('hidden');

    // 4. Dem Nutzer anzeigen, was er gerade gewählt hat (z.B. "Garage")
    const ueberschrift = document.getElementById('gewaehlte-objektart');
    if (ueberschrift) {
        ueberschrift.innerText = "Gewählt: " + objektArt;
    }
}

// Schritt 2: Protokollart auswählen und Formular öffnen
function selectProtokoll(protokollArt: string): void {
    // 1. Im Local Storage speichern
    localStorage.setItem('kithan_aktuelle_protokollart', protokollArt);
    
    // 2. Ansicht 2 (Protokollart) ausblenden
    document.getElementById('view-protokollart')?.classList.add('hidden');

    // 3. Ansicht 3 (Das Formular) einblenden
    document.getElementById('view-formular')?.classList.remove('hidden');
}

