# Eisfach ❄

Eine mobile, statische Progressive Web App zur gemeinsamen Inventarisierung von
Tiefkühltruhen und Gefrierschränken – ohne Benutzerkonten, Framework oder Build-Schritt.
GitHub Pages liefert ausschließlich HTML, CSS und JavaScript aus. Datenbank,
Geräteprüfung, Bildspeicher und serverseitige Funktionen laufen ausschließlich bei Supabase.

## Projektstruktur

```text
/
├── index.html                 Einstieg und Weiterleitung
├── setup.html                 Neues Inventar / Gerät verbinden
├── app.html                   Inventar
├── devices.html               Geräteverwaltung
├── freezer.html               Orte und Fächer verwalten
├── appearance.html            Persönliche Akzentfarben
├── css/app.css                Mobile-First-Layout
├── js/
│   ├── config.js              Öffentliche Supabase-Konfiguration
│   ├── supabase.js            REST-/Edge-Client mit Geräte-Headern
│   ├── auth.js                Verbindung und Offline-Lesekopie
│   ├── storage.js             WebP-Komprimierung und private Bilder
│   ├── setup.js               Einrichtungsassistent
│   ├── scanner.js             QR-Erzeugung und Kamerascan
│   ├── inventory.js           Produktkatalog und Bestände je Lagerort
│   ├── devices.js             Geräte und einmalige Join-Codes
│   ├── appearance.js          Lokale Farbeinstellungen und Vorschau
│   └── app.js                 Seitenstart
├── assets/                    App-Icon und lokale QR-Bibliotheken mit Lizenzen
├── manifest.json
├── service-worker.js
├── supabase/
│   ├── schema.sql             Tabellen, Rechte, RLS, RPCs und Storage
│   ├── migrations/            SQL-Upgrades für bestehende Datenbanken
│   ├── config.toml
│   └── functions/             Edge Functions und gemeinsame Hilfsfunktionen
├── .nojekyll
└── README.md
```

## Supabase einrichten

1. Ein neues Supabase-Projekt erstellen. In dessen SQL Editor die vollständige
   Datei [`supabase/schema.sql`](./supabase/schema.sql) **einmalig** ausführen.
   Sie enthält das Schema, RLS-Policies, eingeschränkte Spaltenrechte, RPCs,
   Audit-Trigger und den privaten Bucket `inventory-images`.
2. Mit der Supabase CLI anmelden, im Projektverzeichnis das Projekt verknüpfen
   und die Edge Functions veröffentlichen:

   ```sh
   supabase login
   supabase link --project-ref DEINE_PROJEKT_REFERENZ
   supabase functions deploy createInventory
   supabase functions deploy createJoinToken
   supabase functions deploy registerDevice
   supabase functions deploy revokeDevice
   supabase functions deploy imageStorage
   ```

   Die Funktionen verwenden die automatisch bereitgestellten Umgebungsvariablen
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` und `SUPABASE_SERVICE_ROLE_KEY`.
   Die JWT-Prüfung am Functions-Gateway ist in `supabase/config.toml` deaktiviert:
   Geräte besitzen keine Supabase-Auth-Konten. Geschützte Funktionen prüfen
   stattdessen **selbst** die Gerätezugangsdaten gegen die Datenbank.
   `createInventory` und `registerDevice` sind absichtlich öffentlich erreichbar.
3. In `js/config.js` die Projekt-URL und den öffentlichen **anon**-Key eintragen:

   ```js
   export const SUPABASE_URL = 'https://DEIN-PROJEKT.supabase.co';
   export const SUPABASE_ANON_KEY = 'DEIN_OEFFENTLICHER_ANON_KEY';
   ```

   Diese Werte dürfen im Repository stehen. **Niemals** einen `service_role`-
   oder Secret-Key im Frontend, in GitHub Pages oder in Browser-Speichern ablegen.
   Der Service-Role-Key wird ausschließlich innerhalb der Edge Functions verwendet.
4. Im Supabase Dashboard prüfen, dass `inventory-images` **nicht öffentlich** ist.
   Datenbank und Storage nicht durch zusätzliche öffentliche Policies freigeben.

### Daten und Zugriffsmodell

Das Schema enthält `inventories`, `join_tokens`, `device_registrations`, `items`,
`stock_entries`, `storage_locations`, `storage_compartments`, `item_images` und
`audit_log` sowie eine interne Tabelle für Registrierungslimits.
Anstelle von Klartextfeldern `token` und `device_token` werden absichtlich
`token_hash` und `device_token_hash` gespeichert. IDs sind UUIDs; Zeitstempel werden serverseitig geführt.
Produkte haben einen stabilen QR-Code. Produktkatalog und tatsächlicher Bestand
sind getrennt:

| Tabelle / Feld | Bedeutung |
| --- | --- |
| `items` | Dauerhafte Produkte mit Name, Beschreibung, freier Kategorie und Notizen; unabhängig davon, ob etwas eingelagert ist |
| `items.preparation_minutes` | Zubereitungszeit in ganzen Minuten; leer (`NULL`) bedeutet unbekannt, 0 bedeutet keine Zubereitung |
| `items.thawing_minutes` | Optionale Auftauzeit in ganzen Minuten; leer (`NULL`) bedeutet unbekannt, 0 bedeutet kein Auftauen |
| `stock_entries.item_id` | Zugehöriges Produkt; ein Produkt kann beliebig viele Bestandspositionen haben |
| `storage_locations` | Definierte Orte je Inventar, beispielsweise „Kühlschrank“ oder „Keller“ |
| `storage_compartments` | Benannte Fächer eines Ortes, beispielsweise „Fach 1“ |
| `stock_entries.location_id` | Verpflichtender Verweis auf einen definierten Ort desselben Inventars |
| `stock_entries.compartment_id` | Optionales Fach des gewählten Ortes; `NULL` bedeutet „Ohne Fach“ |
| `stock_entries.quantity` | Nichtnegative ganzzahlige Stückzahl dieser Position |
| `stock_entries.weight_grams` | Gesamtgewicht dieser Position in Gramm mit bis zu drei Nachkommastellen; leer (`NULL`) bedeutet unbekannt |

Mehrere Positionen für dasselbe Produkt am selben Lagerort sind erlaubt, etwa
für unterschiedliche Portionen. Das Gewicht ist **nicht** das Stückgewicht und
wird bei einer Änderung der Stückzahl nicht automatisch hoch- oder heruntergerechnet.
Gewicht und Stückzahl werden beim Bearbeiten der Position unabhängig gepflegt.
Eine Position gilt als eingelagert, wenn Stückzahl oder Gewicht größer als 0 sind.
Eine Position mit Stückzahl 0 und unbekanntem oder 0 Gewicht erscheint nicht im
Bestand. Das Produkt bleibt im Katalog und lässt sich jederzeit erneut einlagern.

Bilder gehören weiterhin zum Produkt (`item_images.item_id`), nicht zur
Bestandsposition. Bestehende Produkt-IDs, Bilderpfade und QR-Codes bleiben gültig.
Ein zusammengesetzter Fremdschlüssel verhindert Bestandspositionen für Produkte
eines anderen Inventars. RLS beschränkt beide Tabellen auf aktive Geräte des
jeweiligen Inventars; Bestandsänderungen werden als `stock.insert`,
`stock.update` und `stock.delete` protokolliert.

### Bestehende Supabase-Datenbank aktualisieren

Für eine bestehende Installation **nicht** die komplette `schema.sql` erneut
ausführen. Sie ist ausschließlich für neue Projekte bestimmt.

1. Datenbank sichern und während der Umstellung keine Änderungen in der App vornehmen.
2. Die vollständige Datei
   [`supabase/migrations/202611150001_product_stock.sql`](./supabase/migrations/202611150001_product_stock.sql)
   im Supabase **SQL Editor einmalig** ausführen. Die Datei enthält eine Transaktion:
   Bei einem Fehler wird keine Teilmigration übernommen; gegebenenfalls `ROLLBACK;`
   ausführen, bevor der Fehler behoben und die Migration erneut gestartet wird.
3. Anschließend die unten beschriebene Ortsmigration ausführen und die zugehörige
   neue App-Version auf GitHub Pages veröffentlichen.
   Alte App-Versionen können nach der Migration nicht mehr Mengen und Lagerorte
   in `items` schreiben. Alle App-Tabs schließen und neu öffnen, damit der neue
   Service Worker aktiviert wird. Falls noch die alte Oberfläche erscheint,
   den Service Worker abmelden und den Website-Cache löschen; **nicht** die
   Geräteverbindung in `localStorage` löschen.
4. Produktkatalog und Bestände prüfen. Beide registrierten Geräte bleiben verbunden.

Die Migration behält jeden bisherigen Artikel als Produkt. Für jeden Artikel
mit Menge größer als 0 entsteht eine Bestandsposition mit der bisherigen Menge
und dem bisherigen Lagerort. Artikel mit Menge 0 bleiben ohne Bestand im Katalog.
Gewicht und beide Zeiten bleiben zunächst unbekannt; sie werden nicht geschätzt.
Die alten Spalten `items.quantity` und `items.location` werden anschließend entfernt.
Lagerorte aktiver Bestände dürfen höchstens 200 Zeichen enthalten; längere
Altdaten führen zu einem Fehler statt einer stillen Kürzung.
Die Migration verändert weder Gerätezugänge noch die Rechte von
`setup_inventory`: Eine zuvor per `REVOKE` gesperrte Inventaranlage bleibt gesperrt.
Die vorhandenen Edge Functions müssen für diese Umstellung nicht neu veröffentlicht werden.

#### Definierte Orte und Fächer

Wenn Produktkatalog und `stock_entries` bereits vorhanden sind, nur noch
[`supabase/migrations/202611150002_storage_locations.sql`](./supabase/migrations/202611150002_storage_locations.sql)
**einmalig** im Supabase SQL Editor ausführen. Nicht die erste Migration wiederholen.
Vorher sichern und Schreibzugriffe pausieren; danach sofort das passende Frontend
veröffentlichen und alle App-Tabs schließen und neu öffnen.

Die transaktionale Migration übernimmt jeden bisherigen nichtleeren Lagerortnamen
unverändert als Ort ohne Fach pro Inventar. Leere/Whitespace-Angaben werden dem
definierten Ort „Ohne Ortsangabe“ zugeordnet. Mengen, Gewichte, Produktbezüge und
Bestands-IDs bleiben erhalten. Die Freitextspalte `stock_entries.location` wird
durch Fremdschlüssel ersetzt; alte App-Versionen können danach keinen Bestand mehr
anlegen. Die alte Offline-Kopie wird wegen des geänderten Formats verworfen;
nach der Umstellung einmal online laden. Geräteverbindungen bleiben erhalten.
Bei Fehlern gegebenenfalls `ROLLBACK;` ausführen; keine Teilmigration übernehmen.

Der Browser speichert die dauerhafte Geräteverbindung als

```json
{ "inventoryId": "...", "deviceId": "...", "deviceToken": "..." }
```

unter `eisfach.connection` in `localStorage`. Die Funktionen `saveConnection()`,
`loadConnection()` und `clearConnection()` befinden sich in `js/auth.js`.
Zusätzlich wird unter `eisfach.inventory` eine versionierte Offline-Lesekopie von
Produktkatalog und Beständen gespeichert. Alte reine Artikellisten werden nicht
als neue Bestände interpretiert; nach dem Upgrade einmal online laden.
`clearConnection()` entfernt Verbindung und Offline-Kopie.
Persönliche Farbeinstellungen liegen separat unter `eisfach.appearance` und
bleiben beim Trennen einer Geräteverbindung erhalten.

Jeder geschützte REST-Aufruf enthält `apikey`, `x-inventory-id`, `x-device-id`
und `x-device-token`. RLS ermittelt über `current_inventory_id()` die aktive
Geräteregistrierung und deren Inventar. Eine Inventar-ID oder ein Join-Code allein
berechtigen **niemals** zum Lesen oder Ändern der Daten. Geräte- und Join-Tokens
werden in der Datenbank nur als Hash gespeichert; Token-Spalten sind für den
Browser nicht lesbar. Änderungen an Artikeln werden serverseitig protokolliert.

Die Edge Functions:

| Funktion | Aufgabe |
| --- | --- |
| `createInventory` | Inventar und erstes Gerät atomar anlegen, Gerätegeheimnis einmalig zurückgeben |
| `createJoinToken` | Aktives Gerät prüfen, kryptografischen Einmalcode für 15 Minuten erzeugen |
| `registerDevice` | Join-Code unter Zeilensperre validieren und verbrauchen, neues Gerät anlegen |
| `revokeDevice` | Aktives Gerät und Inventar prüfen, Zielgerät widerrufen |
| `imageStorage` | Geräte- und Artikelzugehörigkeit prüfen; private Bilder hochladen, signieren und löschen |

Die zusätzliche Bildfunktion vermeidet eine Abhängigkeit davon, ob die
Storage-API benutzerdefinierte HTTP-Header an Datenbank-Policies weiterreicht.
Direkter öffentlicher Storage-Zugriff bleibt gesperrt. Bilder liegen unter
`inventory-id/item-id/datei-uuid.webp`. Vor dem Upload komprimiert der Browser
sie auf WebP mit höchstens 1600 Pixeln Kantenlänge. Die Eingabedatei darf
höchstens 25 MB groß sein; die Edge Function begrenzt komprimierte Uploads auf 5 MB.
Signierte Bild-URLs sind kurzzeitig gültige
Bearer-Links und dürfen nicht weitergegeben werden.

## Lokal starten

Zum Beispiel mit einem vorhandenen Python:

```sh
python3 -m http.server 8000
```

`http://localhost:8000` öffnen, nicht direkt `file://…`. ES Modules, Kamera und
Service Worker benötigen einen Webserver; Kamera und Service Worker benötigen
außerhalb von localhost HTTPS. Es sind weder `npm install` noch Build-Tools erforderlich.

Die gezielten Tests für Bestandsfilter, Eingabewerte, Offline-Kopie und Akzentfarben benötigen
nur ein vorhandenes Node.js:

```sh
node --test tests/*.test.*
```

## GitHub Pages

1. Dateien einschließlich `.nojekyll` ins Repository übernehmen.
2. **Settings → Pages → Build and deployment → Deploy from a branch** wählen.
3. Den gewünschten Veröffentlichungsbranch und **/(root)** auswählen.
4. Unter `https://DEIN-NAME.github.io/Eisfach/` öffnen und HTTPS aktivieren.

Alle internen URLs, Manifest-Pfade und der Service-Worker-Scope sind relativ,
damit auch ein Repository-Unterverzeichnis funktioniert. Es wird kein eigener
Server und kein SPA-Rewrite benötigt. Für die App ist kein GitHub-Actions-Workflow nötig.
Die SQL- und Edge-Quelldateien dürfen öffentlich sein, enthalten aber keine Secrets.

## Benutzung

1. Ohne gespeicherte Verbindung öffnet die App `setup.html`. Inventarnamen und
   Gerätenamen eingeben. Das erste Gerät wird zusammen mit dem Inventar angelegt.
2. In der **Produktliste** Produkte mit Kategorie, Zubereitungszeit und optionaler
   Auftauzeit anlegen. Der Katalog ist nach Kategorien gruppiert; Kategorien und
   Produkte innerhalb jeder Kategorie sind alphabetisch sortiert. Produkte ohne
   Kategorie erscheinen am Ende unter **Ohne Kategorie**. Suche und Kategoriefilter
   schränken die Gruppen auf passende Produkte ein.
   Katalogkarten zeigen Name, Teile, Packungsgewicht und den aktuellen Bestand
   (summierte Stückzahl und Anzahl belegter Positionen) sowie kompakte Buttons
   **Bearbeiten** und **Einlagern**. Teile und Gewicht stammen aus den Notizzeilen
   `Teile:` und `Gewicht:`; fehlende Werte erscheinen als „—“. Es wird weder eine
   Einheit noch ein Gewicht aus dem aktuellen Bestand abgeleitet.
   Vorhandene Produktbilder stehen im Bearbeitungsdialog direkt über
   **Bilder hinzufügen** und können dort gelöscht werden.
   **Produkt löschen** steht bei gespeicherten Produkten links neben **Speichern**;
   der Bearbeitungsdialog enthält keinen Button **Bilder & QR**.
   Die Listenansichten bieten keinen Produkt-QR-Scan; der QR-Scan zum Verbinden
   weiterer Geräte bleibt verfügbar.
   Über **Einlagern** Bestandspositionen mit Lagerort, Stückzahl
   und optionalem Gesamtgewicht hinzufügen. Dasselbe Produkt kann gleichzeitig
   in mehreren Kühltruhen liegen. Die Ansicht **Bestand** zeigt nur eingelagerte
   Positionen, gruppiert nach Kategorie und darin alphabetisch nach Produktname.
   Jede Karte zeigt genau ein Vorschaubild (das erste Produktbild), Name,
   Zubereitungszeit, Vorbereitungszeit, Gesamtgewicht dieser Position und Ort/Fach.
   Die Vorbereitungszeit entspricht ausschließlich der gespeicherten Auftauzeit;
   ist sie unbekannt, bleibt die Angabe leer. Stückzahlen und weitere Angaben
   stehen im Positionsdialog, den ein Klick auf den Namen öffnet. Dort lässt sich
   die Position auch entfernen. Ohne Foto oder bei Bildladefehlern erscheint ein
   Hinweis statt eines Bildes. Private Vorschaubilder sind nur online verfügbar;
   signierte URLs werden ausschließlich kurzzeitig im Arbeitsspeicher gehalten.
   Beim Entfernen einer Position bleibt das Produkt erhalten;
   das endgültige Löschen eines Produkts entfernt dagegen auch dessen Bestände
   und Bilder. Produktbilder werden im Bearbeitungsdialog des Produktkatalogs
   verwaltet; die kompakte Bestandsansicht enthält keine Bilder-/QR-Aktionsbuttons.
3. Unter **Geräte → Neues Gerät verbinden** einen Join-Code erzeugen. Das neue
   Gerät wählt **Inventar verbinden**, scannt den QR-Code oder gibt Inventar-ID
   und Code manuell ein und vergibt seinen Gerätenamen.
4. Der QR-Code enthält nur:

   ```json
   { "inventoryId": "inventar-uuid", "joinToken": "ABCD-EFGH-JKLM" }
   ```

   Der Code ist maximal 15 Minuten und für genau eine Registrierung gültig.
   Anschließend wird nur noch das neue Gerätegeheimnis verwendet. Join-Codes
   werden nicht dauerhaft im Browser gespeichert.
5. Geräte können umbenannt, deaktiviert und gelöscht werden. Jedes aktive Gerät
   ist gleichberechtigt. Das letzte aktive Gerät nicht ohne Ersatz deaktivieren
   oder löschen: Es gibt absichtlich keine Hintertür über die Inventar-ID.
   Verlorene Zugänge können nur Projektadministratoren serverseitig wiederherstellen.

### Navigation

Das gemeinsame **Menü** bietet **Bestand**, **Produktliste** und **Einstellungen**.
Der Inventarname steht klein neben **Eisfach** in der Kopfzeile. Die große
Seitenüberschrift lautet je nach Ansicht **Bestand**, **Produktliste** oder
**Einstellungen**; unter Einstellungen bleibt der jeweilige Bereich als
Unterüberschrift sichtbar.
Unter **Einstellungen → Geräte** liegt die bisherige Geräteverwaltung.
Unter **Einstellungen → Aussehen** ist **Akzentfarbe** die erste Einstellung.
Die Hauptfarbe gestaltet Kopfzeile und Buttons; eine optionale zweite Akzentfarbe
gestaltet Links und Hervorhebungen. Beschriftungen und bei Bedarf die für Text
verwendete Farbvariante werden automatisch kontrastreich gewählt.
Änderungen erscheinen direkt als Vorschau und werden erst mit **Speichern**
dauerhaft übernommen. **Standardfarben** stellt die Vorschau zurück; anschließend
ebenfalls speichern. Die Einstellung gilt offline und auf allen Seiten, aber nur
im aktuellen Browserprofil, nicht inventarweit oder geräteübergreifend.
Da es keine Benutzerkonten gibt, teilen sich Personen im selben Browserprofil
auch die Farben. Zum Laden der neuen App-Version alle App-Tabs schließen und neu öffnen.
**Einstellungen → Gefrierschrank** zeigt die definierten Orte und ihre optionalen
Fächer. Beide lassen sich anlegen, umbenennen und löschen. Beim Löschen kann ein
Ersatzort mit optionalem Fach gewählt werden; bei vorhandenen Bestandspositionen
ist er verpflichtend. Beim Löschen eines Fachs kann auch dessen übergeordneter Ort
ohne Fach als Ersatz dienen. Die Umlagerung aller betroffenen Positionen und das
Löschen erfolgen in einer Datenbanktransaktion, ohne Mengen oder Gewichte zu ändern.
Belegte Orte/Fächer können nicht ohne Ersatz gelöscht werden. Beim Umbenennen
bleiben Zuordnungen über stabile IDs erhalten.

Die Bestandsverwaltung bietet ausschließlich Dropdowns für definierte Orte und
zugehörige Fächer; **Ohne Fach** ist bei jedem Ort möglich. Zuerst mindestens einen
Ort anlegen. Die Ortsverwaltung benötigt Internet; Bestände einschließlich Orts-
und Fachnamen sind nach erfolgreichem Laden weiterhin offline lesbar.
Bestand und Produktliste sind direkt über
`app.html#stock` bzw. `app.html#catalog` erreichbar; die Browsernavigation
wechselt ebenfalls zwischen diesen Ansichten.
In beiden Ansichten lassen sich Kategorien über eine Button-Leiste einzeln
aktivieren und deaktivieren. Mehrere aktive Kategorien werden gemeinsam angezeigt.
Ohne aktive Kategorie oder mit **Alle Kategorien** werden alle Kategorien
angezeigt. Die Auswahl bleibt beim Wechsel zwischen Bestand und Produktliste
erhalten und lässt sich mit der Suche kombinieren; sie wird nicht dauerhaft gespeichert.
In der Produktliste blendet der Filter **Nur mit Bestand** Produkte ohne positive
Stückzahl und ohne positives Gesamtgewicht aus. Er lässt sich mit Suche und
Kategorie kombinieren und funktioniert auch mit der Offline-Kopie. In der
Bestandsansicht sind ohnehin nur eingelagerte Positionen sichtbar.

### QR und PWA / Offline

`scanner.js` verwendet die native `BarcodeDetector`-API, falls QR unterstützt
wird, sonst `jsqr@1.4.0`. QR-Erzeugung verwendet `qrcode-generator@1.4.4`.
Die unveränderten, fest versionierten Browser-Distributionen liegen unter
`assets/vendor/` und werden lokal bei Bedarf geladen. `qrcode-generator` ist
MIT-lizenziert, `jsQR` Apache-2.0-lizenziert; die Lizenzhinweise liegen bei.
Der Service Worker speichert beide Bibliotheken bei der Installation.
Ohne Kamera können Join-Daten und Suchbegriffe manuell eingegeben werden.
Eine verweigerte Kamerafreigabe wird angezeigt; beim Schließen stoppt die Kamera.

Das Manifest und der Service Worker ermöglichen Installation über die
Browserfunktion **App installieren / Zum Home-Bildschirm** (browserabhängig).
Die App-Hülle wird vorab gecacht; private API-Antworten und Bilder **nicht**.
Der zuletzt erfolgreich geladene Produktkatalog und dessen Bestände sind offline lesbar. Es gibt keine
Offline-Schreibwarteschlange und keine automatische Konfliktzusammenführung.
Nach Wiederherstellung der Verbindung die Seite zum Aktualisieren neu laden.

Bei Releases `CACHE` in `service-worker.js` erhöhen, insbesondere nach Änderungen
an `config.js`. Alle App-Tabs schließen und neu öffnen, damit ein wartender
Service Worker aktiviert wird. Zur Entwicklung kann der Service Worker über
die Browser-Entwicklerwerkzeuge abgemeldet und der Website-Cache gelöscht werden.

## Sicherheit und Grenzen dieses Ausgangspunkts

- Geräte-Tokens gewähren Vollzugriff auf ihr Inventar. Nur auf vertrauenswürdigen
  Geräten verwenden, keine fremden Skripte einbinden und HTTPS erzwingen.
  `localStorage` schützt nicht vor XSS oder Personen mit Zugriff aufs Browserprofil.
- Ein widerrufenes Gerät verliert den Onlinezugriff. Bereits heruntergeladene Daten
  und Offline-Kopien lassen sich aus der Ferne nicht löschen. Bereits signierte
  Bild-URLs bleiben bis zum Ablauf (120 Sekunden) gültig.
- Öffentliche Inventaranlage ist für die Ersteinrichtung erforderlich. Vor einer
  breiten Veröffentlichung Supabase-Quotas, Monitoring und wirksames Rate-Limiting
  bzw. CAPTCHA für öffentliche Endpunkte einrichten; CORS ist kein Missbrauchsschutz.
  Für Registrierungsversuche besteht bereits ein datenbankgestütztes Limit pro
  Minute: 30 pro Client-IP und 60 pro Inventar. Die IP-Zuordnung setzt vom
  vertrauenswürdigen Gateway überschriebene Forwarding-Header voraus.
- Browserzeit und ausgeblendeter QR-Code sind keine Sicherheitsgrenzen:
  Gültigkeit und Verbrauch des Join-Codes prüft ausschließlich die Datenbank.
- Artikeländerungen und Bilduploads sind keine gemeinsame Transaktion. Bei einem
  fehlgeschlagenen Bildupload bleiben bereits gespeicherte Artikeldaten bestehen.
  Vor erneutem Upload die vorhandenen Bilder prüfen. Beim Löschen werden zuerst
  die Storage-Objekte entfernt, danach Metadaten und Artikel.
- Im leeren Repository war keine Testinfrastruktur vorhanden. Syntax und
  Browserabläufe können ohne Build geprüft werden. Für reale Freigaben zusätzlich
  die folgenden Integrationsprüfungen in einem separaten Supabase-Projekt ausführen.

### Integrations-Checkliste

Der SQL-Regressionscheck für Produktkatalog, mehrere Lagerorte, Gewicht, RLS
und Wieder-Einlagerung liegt unter `supabase/tests/product_stock.sql`.
Nur gegen eine **separate Testdatenbank** mit dem neuen Schema als `postgres`
ausführen, beispielsweise:

```sh
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/product_stock.sql
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/storage_locations.sql
```

Der Check legt seine Testdaten innerhalb einer Transaktion an und verwirft sie
anschließend mit `ROLLBACK`. Die Migration zusätzlich mit einer Kopie der
bisherigen Daten prüfen.

- [ ] Inventar anlegen; Artikel mit Bild anlegen, suchen, bearbeiten und löschen.
- [ ] Ein Produkt an zwei Lagerorten einlagern; Stückzahl und Gesamtgewicht
      unabhängig bearbeiten. Eine Position entfernen: das andere Lager bleibt erhalten.
- [ ] Orte und Fächer anlegen und umbenennen; Bestand mit und ohne Fach anlegen.
      Fach in seinen übergeordneten Ort umlagern und löschen; ganzen Ort mit
      Ersatzort/-fach löschen. Bestand, Mengen und Gewichte müssen erhalten bleiben.
- [ ] Ortsmigration mit freien und leeren Lagerorten prüfen; ursprüngliche Namen
      bleiben erhalten, leere Orte werden „Ohne Ortsangabe“. Alte Clients ablehnen.
- [ ] Alle Positionen entfernen: Produkt, Zeiten, Bilder und QR bleiben im Katalog.
      Dasselbe Produkt ohne Neuerfassung wieder einlagern.
- [ ] Migration mit positiven und Null-Mengen prüfen; bestehende Bilder, Geräte
      und eine zuvor gesperrte Inventaranlage müssen unverändert funktionieren.
- [ ] Ein zweites Gerät registrieren; denselben Join-Code erneut verwenden:
      muss abgewiesen werden. Auch abgelaufene Codes müssen scheitern.
- [ ] Ohne Token, mit falschem Token und mit Inventar-ID eines anderen Inventars
      REST- und Bildzugriffe versuchen: keine Daten und keine Schreibrechte.
- [ ] Geräte-Token-Spalten und Join-Token-Tabelle mit dem anon-Key abfragen:
      nicht lesbar. Anonyme RPC-Aufrufe zur privilegierten Anlage müssen scheitern.
- [ ] Gerät widerrufen: weiterer Daten- und Bildzugriff muss scheitern.
- [ ] Zwei parallele Registrierungen mit demselben Code: nur eine darf gelingen.
- [ ] Offline neu laden: App-Hülle und letzte Liste sichtbar, keine Schreiboperation möglich.
- [ ] Installation, Kamerafreigabe und WebP-Upload auf den Zielgeräten ausprobieren.

## Nächste Entwicklungsschritte

- [ ] Automatisierte RLS-, Storage- und Edge-Integrationstests mit zwei Inventaren.
- [ ] Ende-zu-Ende-Tests für Kopplung, Widerruf, Bildupload und Offline-Modus.
- [ ] Missbrauchsschutz, Quotas, Backups und Monitoring vor öffentlichem Betrieb.
- [ ] Geschützte Wiederherstellung und optional abgestufte Geräterollen.
- [ ] Ablaufdaten, Einfrierdatum, Mindestbestände und Inventarexport.
- [ ] Etiketten-/Druckansicht und barrierearme QR-Alternativen.
- [ ] Kontrollierte Offline-Schreibwarteschlange mit Konfliktauflösung.
- [ ] Bereinigung verwaister Bilder und abgelaufener Join-Token-Datensätze.
- [ ] Zusätzliche PNG-/Apple-Touch-Icons für ältere Installationsoberflächen.