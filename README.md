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
├── css/app.css                Mobile-First-Layout
├── js/
│   ├── config.js              Öffentliche Supabase-Konfiguration
│   ├── supabase.js            REST-/Edge-Client mit Geräte-Headern
│   ├── auth.js                Verbindung und Offline-Lesekopie
│   ├── storage.js             WebP-Komprimierung und private Bilder
│   ├── setup.js               Einrichtungsassistent
│   ├── scanner.js             QR-Erzeugung und Kamerascan
│   ├── inventory.js           Artikel, Suche, Filter und Mengen
│   ├── devices.js             Geräte und einmalige Join-Codes
│   └── app.js                 Seitenstart
├── assets/                    App-Icon und lokale QR-Bibliotheken mit Lizenzen
├── manifest.json
├── service-worker.js
├── supabase/
│   ├── schema.sql             Tabellen, Rechte, RLS, RPCs und Storage
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
`item_images` und `audit_log` sowie eine interne Tabelle für Registrierungslimits.
Anstelle von Klartextfeldern `token` und `device_token` werden absichtlich
`token_hash` und `device_token_hash` gespeichert. IDs sind UUIDs; Zeitstempel werden serverseitig geführt.
Mengen sind nichtnegative Ganzzahlen. Artikel haben einen stabilen QR-Code.

Der Browser speichert ausschließlich die dauerhafte Geräteverbindung als

```json
{ "inventoryId": "...", "deviceId": "...", "deviceToken": "..." }
```

unter `eisfach.connection` in `localStorage`. Die Funktionen `saveConnection()`,
`loadConnection()` und `clearConnection()` befinden sich in `js/auth.js`.
Zusätzlich wird unter `eisfach.inventory` eine Offline-Lesekopie der Artikelliste
gespeichert. `clearConnection()` entfernt beide Einträge.

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
2. Artikel anlegen, Kategorien und Lagerorte frei vergeben, Mengen ändern,
   suchen, bearbeiten und löschen. Unter **Bilder & QR** sind Bilder und der
   Artikel-QR sichtbar. QR-Codes lassen sich mit der Druckfunktion des Browsers ausgeben.
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
Die zuletzt erfolgreich geladene Artikelliste ist offline lesbar. Es gibt keine
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

- [ ] Inventar anlegen; Artikel mit Bild anlegen, suchen, bearbeiten und löschen.
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