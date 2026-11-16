# Eisfach ❄

Eine mobile Progressive Web App zur gemeinsamen Verwaltung von Tiefkühlware.
Produktkatalog und Bestand sind getrennt: Ein Produkt bleibt erhalten, auch wenn
keine Packung mehr eingelagert ist. Mehrere Geräte können dasselbe Inventar nutzen,
ohne Benutzerkonten anzulegen.

Die Oberfläche besteht aus statischem HTML, CSS und JavaScript ohne Framework
oder Build-Schritt. GitHub Pages stellt die App bereit; Supabase übernimmt
Datenbank, Geräteprüfung, private Bilder und serverseitige Funktionen.

## Dokumentation

- [Inventar erstellen und Geräte hinzufügen](./docs/einrichtung.md)
- [Datenbankstruktur und vollständige Feldreferenz](./docs/datenbank.md)
- [Aktuelles SQL-Schema](./supabase/schema.sql)

## Aktuelle Funktionen

### Produktliste

- Produkte mit Name, Produktnummer, Beschreibung, Kategorie, Notizen,
  Packungsgewicht, Zubereitungszeit und optionaler Auftauzeit verwalten.
- Produktnummern sind Text: Führende Nullen bleiben erhalten; gleiche Nummern
  bei mehreren Produkten sind erlaubt.
- Das Gewicht beschreibt **eine Packung**, nicht das Gesamtgewicht einer Position.
  Zeiten werden in Minuten gespeichert; unbekannte Werte sind leer, 0 ist zulässig.
  Die Anzeige **Vorbereitungszeit** entspricht dem Feld für die Auftauzeit.
- Kategorien erscheinen als Gruppen mit der Anzahl gefundener Produkte.
  Eine Button-Leiste filtert jeweils eine Kategorie; erneutes Anklicken oder
  **Alle Kategorien** hebt die Auswahl auf.
- Textsuche nach Produktangaben und zugeordneten Lagerorten.
  **Nur mit Bestand** zeigt Produkte mit mindestens einer positiven Stückzahl.
- Die normale Ansicht zeigt das erste Produktbild, Produktnummer, Teile,
  Packungsgewicht, summierten Bestand sowie **Bearbeiten** und **Einlagern**.
  Teile werden aus der Notizzeile `Teile:` gelesen.
- **Kompakte Ansicht** zeigt nur Name und Textaktionen, ohne Bildvorschauen.
- Der Produkteditor verwaltet Bilder und bietet eine **Google Suche** aus
  Produktnummer und Name. Bilder lassen sich als Datei oder direkte HTTP-/HTTPS-URL
  hinzufügen. URL-Abrufe benötigen eine CORS-Freigabe der Bildquelle.
- Produktlöschung entfernt auch zugehörige Positionen und Bilder.

### Bestand

Die Bestandsansicht zeigt ausschließlich Positionen mit Stückzahl größer als 0,
gruppiert nach Produktkategorie und Produktname. Mehrere Positionen desselben
Produkts sind erlaubt, auch am gleichen Ort. Die Anzahl in der Kategorieüberschrift
zählt Produkte, nicht Positionen.

Jede Karte zeigt erstes Produktbild, Name, Zeiten, Gewicht pro Packung und Ort/Fach.
Ein Klick auf den Namen öffnet den Positionsdialog mit:

- Produktname als Überschrift, Produktnummer als kleinem Untertitel;
- größerem Bild, Beschreibung, Zubereitungszeit, Vorbereitungszeit und Gewicht;
- aktueller Stückzahl der Position, bearbeitbar mit Minus/Plus;
- **Umlagern**: Ort und optionales Fach wählen, dann die gesamte gespeicherte
  Position sofort verschieben, ohne ihre Stückzahl zu ändern;
- **Weiteren Bestand erfassen**: zusätzliche positive Stückzahl sowie Ort/Fach
  wählen und sofort als neue Position speichern;
- **Position entfernen**, **Speichern** und **Schließen**.

Umlagern und zusätzliche Erfassung haben eigene Bestätigungsdialoge.
Eine ungespeicherte Stückzahländerung im Hauptdialog bleibt dabei erhalten.
**Speichern** übernimmt diese Mengenänderung; **Schließen** verwirft den Entwurf,
macht bereits bestätigte Aktionen aber nicht rückgängig.
Beim Entfernen einer Position bleibt das Produkt im Katalog.
Veraltete Bearbeitungen werden über den Änderungszeitpunkt erkannt.

Über **Einlagern** in der Produktliste lassen sich neue Positionen erfassen.
Eine Produktnummerneingabe filtert die Produktauswahl nach Teiltreffern.
**Neues Produkt anlegen** öffnet den Produkteditor und kehrt nach dem Speichern
mit dem neuen Produkt zurück; Ort, Fach und Stückzahl bleiben erhalten.
Der Toolbar-Button **Produkt anlegen** steht nur in der Produktliste.

### Einstellungen

**Bestand** und **Produktliste** sind direkt im Header und im Menü erreichbar.
Unter **Menü → Einstellungen** stehen:

| Bereich | Funktion |
| --- | --- |
| Geräte | Geräte auflisten, umbenennen, deaktivieren, löschen, verbinden oder lokal trennen |
| Orte und Fächer | Lagerorte und zugehörige optionale Fächer verwalten |
| Sortierung | Reihenfolge von Kategorien, Orten und Fächern inventarweit festlegen |
| Aussehen | Hauptakzentfarbe und optionale zweite Farbe für Links/Hervorhebungen |
| Export/Import | JSON-Sicherung ohne Bilder oder ZIP-Sicherung inklusive Bilder |

Beim Löschen belegter Orte/Fächer muss ein Ersatzort mit optionalem Fach gewählt
werden. Umlagerung und Löschung erfolgen gemeinsam in einer Datenbanktransaktion.
Umbenennen ändert keine Zuordnungen.

Die Sortierung wird mit **Nach oben**/**Nach unten** bearbeitet und gemeinsam
gespeichert. Andere Geräte übernehmen sie beim nächsten Laden. Neue Einträge
folgen alphabetisch hinter den gespeicherten; **Ohne Fach** bleibt die erste
Fachauswahl. **Ohne Kategorie** ist als Gruppe verschiebbar.

Farben gelten dagegen nur im aktuellen Browserprofil. Sie sind offline verfügbar
und werden erst mit **Speichern** dauerhaft übernommen. Die Vorschau und
**Standardfarben** erlauben eine Kontrolle vor dem Speichern. Beschriftungen
werden kontrastreich angepasst. Personen im selben Browserprofil teilen dieselbe
Farbeinstellung.

## Sicherung und Datenaustausch

Unter **Einstellungen → Export/Import**:

| Format | Inhalt | Grenze |
| --- | --- | --- |
| JSON | Produkte, alle Bestandspositionen einschließlich Menge 0, Orte und Fächer | 10 MB |
| ZIP: **Export inklusive Bilder** | Dieselben Daten und alle WebP-Bilder einschließlich Beschriftung, Reihenfolge und Produktzuordnung | 100 MB, höchstens 1999 Bilder |

Nicht enthalten sind Gerätezugänge, Join-Codes, Auditprotokoll, persönliche
Anzeigeeinstellungen und inventarweite Sortierung. Sicherungen können vertrauliche
Produkttexte und Fotos enthalten: geschützt aufbewahren.

ZIP enthält `inventory.json` und `images/<bild-id>.webp`. Vorhandene WebP-Dateien
werden unverändert übernommen, ohne erneute Bildkomprimierung.
ZIP verwendet STORE; es wird keine externe ZIP-Bibliothek benötigt.
Pro Bild gelten maximal 5 MB, für das JSON im ZIP maximal 10 MB.
Es werden echte Bilddateien gesichert, keine kurzlebigen Downloadlinks.
Ein fehlgeschlagener Bilddownload bricht den Export ab.

### Import

1. JSON oder eine **unveränderte Eisfach-ZIP-Sicherung** auswählen.
2. Die App prüft Format, Werte, doppelte IDs und Produkt-/Orts-/Fachverweise.
   Bei ZIP werden zusätzlich Archivstruktur, CRC-Prüfsummen, WebP-Köpfe und
   Bildzuordnung geprüft. Andere, verschlüsselte, ZIP64- oder nachträglich
   neu komprimierte Archive werden nicht unterstützt.
3. Angezeigte Anzahlen prüfen und **Daten in dieses Inventar übernehmen** bestätigen.
4. **Importieren** startet die Ergänzung. Zuerst werden Daten, danach Bilder importiert.
5. Anschließend Produktliste und Bestand neu laden und prüfen.

Vorhandene Daten werden nicht geändert oder gelöscht; Mengen werden nicht addiert.
Produkte und Positionen werden anhand ihrer IDs erkannt, nicht anhand gleicher
Namen oder Produktnummern. Gleich benannte Orte und Fächer desselben Ortes
werden wiederverwendet. Für ein anderes Zielinventar werden IDs deterministisch
umgesetzt. Wiederholungen derselben Sicherung erzeugen deshalb keine Duplikate
der bereits importierten Datensätze und Bilder.

Export und Import benötigen Internet. Währenddessen auf allen Geräten Änderungen
pausieren. Beides ist **keine atomare Datenbanksicherung oder Gesamttransaktion**.
Bei Fehlern bleiben bereits ergänzte Daten und hochgeladene Bilder erhalten;
Anzahlen und Fehler werden gemeldet. Dieselbe Datei kann erneut importiert werden,
um fortzufahren. Nach einem erfolgreichen Upload mit fehlgeschlagener Bildzuordnung
prüft die Wiederholung den vorhandenen Dateiinhalt und ergänzt die Zuordnung.
Nicht fortgesetzte Uploads können verwaiste Dateien hinterlassen.
Für die vollständige Betriebssicherung Datenbank und Storage separat sichern.

## Technische Einrichtung

### 1. Supabase bereitstellen

1. Neues Supabase-Projekt erstellen.
2. Im SQL Editor die vollständige [schema.sql](./supabase/schema.sql) **einmalig
   als postgres auf einer frischen Datenbank** ausführen. Sie enthält alle
   aktuellen Tabellen, Rechte, RLS-Policies, Funktionen, Trigger und den privaten
   Bucket `inventory-images`.
3. Mit der Supabase CLI die Edge Functions veröffentlichen:

   ```powershell
   supabase login
   supabase link --project-ref DEINE_PROJEKT_REFERENZ
   supabase functions deploy createInventory
   supabase functions deploy createJoinToken
   supabase functions deploy registerDevice
   supabase functions deploy revokeDevice
   supabase functions deploy imageStorage
   ```

4. In [js/config.js](./js/config.js) Projekt-URL und öffentlichen **anon-Key**
   konfigurieren. Niemals einen Service-Role- oder Secret-Key im Frontend ablegen.
5. Im Dashboard prüfen, dass `inventory-images` nicht öffentlich ist.

Die Edge Functions nutzen `SUPABASE_URL`, `SUPABASE_ANON_KEY` und
`SUPABASE_SERVICE_ROLE_KEY` aus ihrer Supabase-Umgebung.
[config.toml](./supabase/config.toml) deaktiviert die JWT-Prüfung am Functions-Gateway,
weil die App keine Supabase-Auth-Konten verwendet. Geschützte Endpunkte prüfen
selbst die Geräteberechtigung. `createInventory` und `registerDevice` sind
öffentliche Einstiegspunkte.

Das Repository führt ausschließlich das vollständige aktuelle Schema.
**Nicht erneut über eine bestehende Datenbank ausführen:** Es ist kein
Wiederherstellungs- oder Aktualisierungsskript. Die Entfernung alter SQL-Dateien
ändert keine bereits betriebene Datenbank; die Git-Historie bleibt erhalten.
Änderungen an bestehenden Installationen vorab separat planen und sichern.

### 2. Oberfläche bereitstellen

Für GitHub Pages unter **Settings → Pages → Build and deployment**:

1. **Deploy from a branch** wählen.
2. Veröffentlichungsbranch und **/(root)** auswählen.
3. App unter `https://DEIN-NAME.github.io/Eisfach/` mit HTTPS öffnen.

[.nojekyll](./.nojekyll) mit veröffentlichen. Relative URLs unterstützen den
Repository-Unterpfad; ein Build, SPA-Rewrite oder eigener Anwendungsserver ist
nicht erforderlich. SQL- und Edge-Quelldateien enthalten keine benötigten
privaten Konfigurationswerte.

### 3. Inventar und Geräte verbinden

Auf dem ersten Gerät **Inventar und erstes Gerät anlegen** verwenden.
Weitere Geräte über den einmaligen Join-Code eines aktiven Geräts registrieren.
Die [Schritt-für-Schritt-Anleitung](./docs/einrichtung.md) erklärt beide Abläufe,
ihre Grenzen und das sichere Trennen von Geräten.

## Ladeverhalten, PWA und Offline

- Nach der Geräteberechtigungsprüfung werden Produkte, Positionen, Orte, Fächer
  und Sortierung geladen. Inventarname und Geräteaktivitätsmeldung laufen parallel.
- **Produkte werden abgerufen** bleibt bis zum Abschluss der Datenanfragen sichtbar.
- Die Karten erscheinen zuerst mit Textdaten und Bildplatzhaltern. Nach der ersten
  Darstellung starten Bildanfragen für sichtbare Karten; beim Scrollen folgen weitere.
  Ohne IntersectionObserver werden nach der ersten Darstellung alle Listenvorschauen
  vorbereitet. Die Bilder verwenden zusätzlich Lazy Loading.
- Neue Bilder werden im Browser auf höchstens 1600 Pixel Kantenlänge verkleinert
  und als WebP komprimiert. Eingabedateien bzw. URL-Downloads dürfen maximal 25 MB,
  komprimierte Uploads maximal 5 MB groß sein. Separate Miniaturdateien gibt es nicht.
- Private Bild-URLs sind 120 Sekunden gültig und werden nur kurzzeitig im
  Arbeitsspeicher wiederverwendet. Offline erscheinen Bildhinweise statt Fotos.
- Der Service Worker hält die App-Hülle vor, **keine privaten API-Antworten oder Bilder**.
  Eine separate lokale Lesekopie enthält die zuletzt geladenen Produkte, Positionen,
  Orte, Fächer und Sortierung. Sie ist optional und kein Backup.
- Offline ist ausschließlich Lesen möglich. Es gibt keine Schreibwarteschlange,
  automatische Konfliktzusammenführung oder Live-Synchronisation; nach Änderungen
  auf anderen Geräten bzw. bei wiederhergestellter Verbindung neu laden.
- Die App kann je nach Browser über **App installieren / Zum Home-Bildschirm**
  installiert werden. Kamera und Service Worker benötigen HTTPS oder localhost.

Bei Releases die Cache-Version in [service-worker.js](./service-worker.js) erhöhen.
Alle App-Tabs schließen und neu öffnen, damit ein wartender Service Worker
aktiviert wird. Bei veralteter Oberfläche Service Worker und App-Cache gezielt
über die Entwicklerwerkzeuge entfernen, **nicht unbedacht den gesamten
Website-Speicher löschen**: Darin liegt die Geräteverbindung.
Eine atomare Aktualisierung aller offenen Tabs ist derzeit nicht implementiert.

## Architektur und Projektstruktur

| Pfad | Aufgabe |
| --- | --- |
| [index.html](./index.html), [setup.html](./setup.html) | Einstieg, Inventaranlage und Geräteverbindung |
| [app.html](./app.html) | Bestand und Produktliste (`#stock`, `#catalog`) |
| [devices.html](./devices.html), [freezer.html](./freezer.html) | Geräte sowie Orte und Fächer |
| [sorting.html](./sorting.html), [appearance.html](./appearance.html), [transfer.html](./transfer.html) | Sortierung, Farben und Datenaustausch |
| [js/app.js](./js/app.js) | Navigation, Seitenstart und Geräteprüfung |
| [js/inventory.js](./js/inventory.js) | Produktkatalog, Positionen und Dialoge |
| [js/supabase.js](./js/supabase.js), [js/auth.js](./js/auth.js) | API-Client, lokale Verbindung und Lesekopie |
| [js/setup.js](./js/setup.js), [js/devices.js](./js/devices.js) | Inventaranlage, Kopplung und Geräteverwaltung |
| [js/locations.js](./js/locations.js), [js/freezer.js](./js/freezer.js) | Orts-/Fachauswahl und Verwaltung |
| [js/ordering.js](./js/ordering.js), [js/sorting.js](./js/sorting.js) | Gemeinsame Anzeige-Reihenfolge |
| [js/storage.js](./js/storage.js) | Bildkomprimierung, Upload, signierte URLs und Wiederherstellung |
| [js/transfer.js](./js/transfer.js), [js/zip.js](./js/zip.js) | Validierter JSON-/ZIP-Austausch |
| [js/appearance.js](./js/appearance.js), [css/app.css](./css/app.css) | Lokale Farben und responsive Darstellung |
| [js/scanner.js](./js/scanner.js), [assets/vendor/](./assets/vendor/) | QR-Scan und -Erzeugung, Bibliotheken mit Lizenzen |
| [manifest.json](./manifest.json), [service-worker.js](./service-worker.js) | Installation und App-Hüllen-Cache |
| [supabase/schema.sql](./supabase/schema.sql) | Vollständige aktuelle Datenbankdefinition |
| [supabase/functions/](./supabase/functions/), [supabase/config.toml](./supabase/config.toml) | Edge-Endpunkte und Konfiguration |
| [tests/](./tests/), [supabase/tests/](./supabase/tests/) | Node-Tests und SQL-Regressionsprüfungen |
| [docs/](./docs/) | Einrichtungsanleitung und Datenbankreferenz |

### Zugriff und Grenzen

Jeder geschützte Aufruf nutzt den öffentlichen anon-Key sowie
`x-inventory-id`, `x-device-id` und `x-device-token`.
Die RLS-Funktion `current_inventory_id()` prüft die aktive Registrierung samt
Token-Hash. Inventar-ID und anon-Key allein erlauben keinen Datenzugriff.
Alle aktiven Geräte sind gleichberechtigt; es gibt keine Benutzerkonten oder Rollen.

Gerätegeheimnisse liegen im lokalen Browserprofil, serverseitig nur als SHA-256-Hash.
`localStorage` schützt nicht vor XSS oder Personen mit Zugriff auf das Profil.
Keine fremden Skripte einbinden und HTTPS nutzen. Deaktivieren beendet den
Onlinezugriff, löscht aber keine bereits heruntergeladenen Daten auf dem Gerät.
Bereits signierte Bildlinks bleiben bis zu ihrem Ablauf verwendbar.

Die öffentliche Inventaranlage benötigt für breiten Betrieb zusätzlichen
Missbrauchsschutz, Quotas, Monitoring und Backups. CORS ist kein Missbrauchsschutz.
Registrierungsversuche sind auf 30 je Client und 60 je Inventar pro Minute begrenzt;
die Zuordnung setzt vertrauenswürdige Gateway-Forwarding-Header voraus.
Produkte und Bilduploads bilden keine gemeinsame Transaktion. Bei Teilfehlern
bereits gespeicherte Daten bzw. Bilder vor erneutem manuellen Upload prüfen.

## Entwicklung und Prüfung

Mit vorhandenem Python lokal starten:

```powershell
python -m http.server 8000
```

`http://localhost:8000` statt direkt einer Datei öffnen. Es ist kein `npm install`
oder Build erforderlich. Die Node-Tests benötigen ein aktuelles Node.js:

```powershell
node --test tests
```

Sie prüfen unter anderem Filter, Sortierung, Datenvalidierung, Bildverarbeitung,
verzögertes Laden, Wiederholungen und JSON-/ZIP-Austausch.
SQL-Tests nur als postgres auf einer **separaten Testdatenbank** ausführen, die
mit dem aktuellen Schema eingerichtet wurde:

```powershell
psql "$env:TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase\tests\product_stock.sql
psql "$env:TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase\tests\storage_locations.sql
psql "$env:TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase\tests\inventory_sorting.sql
```

Die SQL-Tests verwerfen ihre Testdaten per `ROLLBACK`. Für eine Freigabe zusätzlich
in einem separaten Supabase-Projekt prüfen:

- Inventaranlage und zweites Gerät, einmaliger sowie abgelaufener Join-Code.
- Gleichzeitige Registrierung: Derselbe Code darf nur einmal erfolgreich sein.
- Trennung zwischen zwei Inventaren, fehlende/falsche Tokens und Gerätewiderruf.
- Produkt mit Bildern an mehreren Orten, Umlagern, zusätzlicher Bestand und Löschung.
- Ortslöschung mit Ersatz, parallele Änderungen und Konfliktmeldungen.
- JSON-/ZIP-Export und -Import, Wiederholung und Fortsetzen nach Teilfehlern.
- Offline-Lesen, gesperrte Änderungen, Kamera, Installation und App-Aktualisierung.
