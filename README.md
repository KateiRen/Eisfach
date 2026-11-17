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
  Der optionale **Preis pro Packung in Euro** erlaubt bis zu zwei Nachkommastellen
  (Komma oder Punkt); leer bedeutet unbekannt, 0 bedeutet kostenlos.
  Zusätzlich gibt es eine optionale Produktseiten-URL (HTTP/HTTPS), ein eigenes
  Textfeld **Teile**, eine **Favorit**-Checkbox und ein optionales ganzzahliges
  **Rating von 0 bis 5** als auswählbare, entsprechend eingefärbte Sterne.
  **0 Sterne** und **Keine Bewertung** bleiben getrennt auswählbar.
  Ein bisher nicht angegebener Favorit wird als nicht angehakt angezeigt und
  beim Speichern als Nein gespeichert.
- Produktnummern sind Text: Führende Nullen bleiben erhalten; gleiche Nummern
  bei mehreren Produkten sind erlaubt.
- Im Produktdialog öffnet **Suche bei bofrost** für rein numerische Produktnummern
  mit 3 bis 6 Stellen die bofrost-Suche. Bei 8 oder 13 Stellen öffnet
  **Suche nach EAN** die öffentliche Produktabfrage bei Open Food Facts.
  Beide öffnen einen neuen Tab; andere Produktnummern zeigen keinen Suchbutton.
- Das Gewicht beschreibt **eine Packung**, nicht das Gesamtgewicht einer Position.
  Zeiten werden in Minuten gespeichert; unbekannte Werte sind leer, 0 ist zulässig.
  Die **Auftauzeit** wird bis einschließlich 60 Minuten als Minutenwert angezeigt,
  darüber als Stunden mit Restminuten, z. B. 90 → `1 Std. 30 Min.` und
  120 → `2 Std.`. Die Eingabe bleibt in Minuten.
- Kategorien erscheinen als Gruppen mit der Anzahl gefundener Produkte.
  Eine Button-Leiste filtert jeweils eine Kategorie; erneutes Anklicken oder
  **Alle Kategorien** hebt die Auswahl auf.
- Textsuche nach Produktangaben und zugeordneten Lagerorten.
  **Nur mit Bestand** zeigt Produkte mit mindestens einer positiven Stückzahl.
- Die normale Ansicht zeigt das erste Produktbild, Produktnummer, Teile,
  Packungsgewicht, summierten Bestand sowie **Bearbeiten** und **Einlagern**.
  Produktseite, Favorit, Rating und Nutzungscounter sind ebenfalls sichtbar.
  Teile werden im eigenen Produktfeld gepflegt.
- **Kompakte Ansicht** zeigt Name, Packungspreis und Textaktionen, ohne Bildvorschauen.
- Der Produkteditor zeigt Kategorie direkt nach Produktnummer, Gewicht und Teile
  nebeneinander sowie Beschreibung vor Favorit und Rating.
  Bilder lassen sich als Dateien hinzufügen und werden ohne sichtbaren
  Dateinamen oder Titel unter dem Bild angezeigt.
- Produktlöschung entfernt auch zugehörige Positionen, Bestelleinträge und Bilder.

### Bestellliste

**Nachbestellen** steht nur im Produktkatalog bereit, auch in der kompakten Ansicht.
Jeder Klick setzt ein Stück zusätzlich auf die gemeinsame, inventargebundene
**Bestellliste** im Header/Menü. Pro Produkt gibt es genau einen Eintrag;
gleichzeitige Klicks verschiedener Geräte werden atomar addiert.
In der Bestellliste ändern **−/+** die Menge um ein Stück und speichern sofort.
**Minus bei 1 entfernt den Eintrag.** Die Ansicht ist immer eine kompakte Tabelle mit Produkt,
Menge, aktuellem Stückpreis und Gesamtpreis pro Position. Unter der
Gesamtpreis-Spalte steht das **Total** aller Positionen. Die Berechnung erfolgt
centgenau anhand der gespeicherten Mengen und wird nach jeder Änderung aktualisiert.
Fehlende Stückpreise werden als „—“ angezeigt und verhindern die Berechnung
des Totals, statt als 0 Euro einzugehen. Kostenlose Produkte mit Preis 0
werden dagegen regulär berücksichtigt. Auf schmalen Bildschirmen ist die
Tabelle seitlich scrollbar.
**Produkt aktualisieren** öffnet den vollständigen Produkteditor als Dialog
direkt über der Bestellliste, ohne Seitenwechsel. Speichern aktualisiert
Produktdaten, Preise und Total in der darunterliegenden Liste; Schließen
verwirft ungespeicherte Eingaben.
**Einlagern** öffnet die Bestandserfassung mit der offenen Bestellmenge als
Vorgabe. Ort/Fach auswählen und gegebenenfalls eine kleinere Teilmenge eingeben.
Speichern legt atomar eine Bestandsposition an und zieht die Menge von der
Bestellliste ab; bei vollständiger Einlagerung verschwindet der Eintrag.
Der Nutzungscounter steigt dabei wie bei jeder neuen Bestandsposition um 1.
Abbrechen verändert nichts. Reine Bestellmengenänderungen verändern den Bestand
und Nutzungscounter weiterhin nicht. Die Bestellliste benötigt Internet und lässt sich über
**Aktualisieren** neu laden. Bei unklarer Netzwerkantwort vor einem erneuten
Klick die Bestellliste prüfen, damit nicht versehentlich doppelt bestellt wird.

Der schreibgeschützte **Nutzungscounter** startet bei 0 und steigt um **1 pro
neu erfasster Position** über **Einlagern** oder **Weiteren Bestand erfassen**,
unabhängig von der Stückzahl (auch eine neue Position mit Menge 0 zählt).
Anlage und Zählererhöhung erfolgen atomar auf dem Server. Wiederholungen derselben
Anfrage mit derselben Positions-ID zählen nicht erneut. Mengenänderungen,
Umlagerungen, Positionslöschungen und Bestandsimporte erhöhen oder vermindern den
Zähler nicht. Die Datenbank verhindert ein Herabsetzen des bestehenden Zählers.

### Bestand

Die Bestandsansicht zeigt ausschließlich Positionen mit Stückzahl größer als 0,
gruppiert nach Produktkategorie und Produktname. Mehrere Positionen desselben
Produkts sind erlaubt, auch am gleichen Ort. Die Anzahl in der Kategorieüberschrift
zählt Produkte, nicht Positionen.

Jede Karte zeigt erstes Produktbild, Name, vorhandene Zeiten, Gewicht pro Packung und Ort/Fach.
Ein Klick auf den Namen öffnet den Positionsdialog mit:

- Produktname als Überschrift, Produktnummer als kleinem Untertitel;
- größerem Bild, Beschreibung, Zubereitungszeit, Auftauzeit und Gewicht;
- aktueller Stückzahl der Position, bearbeitbar mit Minus/Plus;
- **Umlagern**: Ort und optionales Fach wählen, dann die gesamte gespeicherte
  Position sofort verschieben, ohne ihre Stückzahl zu ändern;
- **Weiteren Bestand erfassen**: zusätzliche positive Stückzahl sowie Ort/Fach
  wählen und sofort als neue Position speichern;
- **Position entfernen**, **Speichern** und **Schließen**.

Fehlende Zubereitungs- und Auftauzeiten werden in Übersicht und Dialog samt
Beschriftung ausgeblendet. In den Übersichtskarten entfallen außerdem
Zubereitungszeit und Packungsgewicht bei 0; fehlendes Packungsgewicht wird dort
ebenfalls nicht angezeigt. Auftauzeit 0 und im Dialog Zubereitungszeit 0 bleiben
sichtbar. Im Dialog erscheinen Teile
nur mit Inhalt, Favorit nur bei Ja und Rating nur mit Bewertung (auch 0).
Der Nutzungscounter wird im Bestand nicht angezeigt. Bei genügend Platz stehen
Mengensteuerung, **Umlagern** und **Weiteren Bestand erfassen** nebeneinander;
auf schmalen Bildschirmen werden sie umgebrochen.

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

**Bestand**, **Produktliste** und **Bestellliste** sind direkt im Header und im Menü erreichbar.
Unter **Menü → Einstellungen** stehen:

| Bereich | Funktion |
| --- | --- |
| Geräte | Geräte auflisten, umbenennen, deaktivieren, löschen, verbinden oder lokal trennen |
| Orte und Fächer | Lagerorte und zugehörige optionale Fächer verwalten |
| Sortierung | Reihenfolge von Kategorien, Orten und Fächern inventarweit festlegen |
| Bulk-Edit | Gewicht, Teile, Beschreibung, Zubereitungszeit, Auftauzeit, Notizen und Produktseite (URL) tabellarisch bearbeiten, je 10 Artikel pro Seite |
| Aussehen | Hauptakzentfarbe und optionale zweite Farbe für Links/Hervorhebungen |
| Export/Import | JSON-Sicherung ohne Bilder oder ZIP-Sicherung inklusive Bilder |

Beim Löschen belegter Orte/Fächer muss ein Ersatzort mit optionalem Fach gewählt
werden. Umlagerung und Löschung erfolgen gemeinsam in einer Datenbanktransaktion.
Umbenennen ändert keine Zuordnungen.

**Bulk-Edit** lädt die Artikel seitenweise in alphabetischer Reihenfolge.
Name, Produktnummer und Nutzungscounter werden nur angezeigt.
Die Produktseite akzeptiert HTTP-/HTTPS-URLs ohne Zugangsdaten; ein leeres Feld entfernt die URL.
Die Ansicht nutzt die gesamte Bildschirmbreite mit größeren Eingabefeldern für
Beschreibung und Notizen. Die Tabelle ist bei Bedarf seitlich scrollbar.
**Änderungen dieser Seite speichern**
sendet nur die geänderten Felder der bearbeiteten Artikel; unveränderte Artikel
werden nicht geschrieben. Erfolgreiche Änderungen bleiben gespeichert, während
Fehler je Zeile erscheinen und die betroffenen Eingaben zur Korrektur oder
Wiederholung erhalten bleiben. Die Seite wird nicht als eine Datenbanktransaktion
gespeichert. Zwischenzeitliche Änderungen anderer Geräte werden über
`updated_at` erkannt und nicht überschrieben; bei einem Konflikt die eigenen
Eingaben sichern und die Seite neu laden.
Beim Seitenwechsel oder Neuladen der Artikeltabelle gibt es bei offenen Änderungen
eine Rückfrage; beim Verlassen der Browserseite greift die Browserwarnung.
Leere Gewichte und Zeiten bedeuten unbekannt, 0 bleibt ein eigener gültiger Wert.
Bestände, Bilder und Nutzungscounter werden nicht verändert.

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
| JSON | Produkte einschließlich Preisen, alle Bestandspositionen einschließlich Menge 0, Bestellliste, Orte und Fächer | 10 MB |
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
Die neuen Produktfelder und der Nutzungscounter sind in JSON und ZIP enthalten.
Packungspreise und Bestelleinträge sind ebenfalls enthalten. Alte Sicherungen
ohne diese Angaben erhalten leere Preise und eine leere Bestellliste.
Bereits auf der Bestellliste vorhandene Produkte werden beim Import übersprungen;
Bestellmengen werden weder addiert noch überschrieben.
Beim Import eines neuen Produkts wird dessen gesicherter Zähler übernommen;
Bestandspositionen aus dem Import erhöhen ihn nicht zusätzlich. Bestehende
Produkte und deren Zähler werden weiterhin übersprungen.
Alte Sicherungen ohne diese Felder bleiben lesbar: URL/Favorit/Rating sind leer,
der Zähler ist 0 und Teile werden einmalig aus einer vorhandenen `Teile:`-Notizzeile
in das neue Feld übernommen. Ein explizit leeres Teile-Feld bleibt leer.
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

Für bestehende Datenbanken auf dem vorherigen aktuellen Schema:
[update_item_metadata.sql](./supabase/update_item_metadata.sql) nach Sicherung
und bei pausierten Schreibzugriffen **einmalig** im SQL Editor ausführen,
anschließend die passende App-Version veröffentlichen und alle Tabs neu öffnen.
Das Update ergänzt Produktfelder, den monotonen Zähler und die atomare
`create_stock_position`-Funktion. Teile aus `Teile:`-Notizzeilen werden übernommen,
die Notizen bleiben erhalten. Bestehende Zähler starten bei 0; frühere
Einlagerungen werden nicht geschätzt. Neue Datenbanken verwenden ausschließlich
das vollständige Schema, nicht zusätzlich dieses Update.

Für Preis und Bestellliste anschließend
[update_product_orders.sql](./supabase/update_product_orders.sql) ebenfalls
nach Sicherung und bei pausierten Schreibzugriffen **einmalig** ausführen,
bevor die neue Oberfläche veröffentlicht wird. Voraussetzung ist der Stand
nach dem obigen Metadaten-Update. Bereits auf diesem Stand befindliche
Installationen benötigen nur dieses neue Update. Bestehende Produkte behalten
einen leeren Preis; die Bestellliste beginnt leer.

Für das direkte Einlagern aus der Bestellliste danach
[update_order_receiving.sql](./supabase/update_order_receiving.sql) einmalig
ausführen, bevor die zugehörige Oberfläche veröffentlicht wird. Es ergänzt die
atomare, versionsgeprüfte `receive_order`-Funktion. Frische Datenbanken benötigen
weiterhin nur das aktuelle vollständige Schema.

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
Im Browser und in der installierten PWA erscheint bei einer bereitstehenden Version
**Update verfügbar** mit **Jetzt aktualisieren**. Die App prüft beim Öffnen,
bei der Rückkehr in den Vordergrund und nach Wiederherstellung der Verbindung.
Zuerst offene Änderungen speichern: Nach Bestätigung wird der wartende Service
Worker aktiviert und das aktuelle Fenster neu geladen. Andere offene Fenster
zeigen ebenfalls den Hinweis, laden aber nicht ungefragt neu.
Ohne Klick wird die neue Version spätestens nach dem Schließen aller App-Fenster
und Eisfach-Tabs beim nächsten Öffnen verwendet. Die Geräteverbindung bleibt erhalten.
Beim erstmaligen Wechsel von einer älteren Version ohne Update-Hinweis müssen
noch einmal alle Eisfach-Fenster und Tabs geschlossen und neu geöffnet werden,
nachdem der Browser das Update heruntergeladen hat.
Bei veralteter Oberfläche Service Worker und App-Cache gezielt
über die Entwicklerwerkzeuge entfernen, **nicht unbedacht den gesamten
Website-Speicher löschen**: Darin liegt die Geräteverbindung.
Eine atomare Aktualisierung aller offenen Tabs ist weiterhin nicht implementiert.

## Architektur und Projektstruktur

| Pfad | Aufgabe |
| --- | --- |
| [index.html](./index.html), [setup.html](./setup.html) | Einstieg, Inventaranlage und Geräteverbindung |
| [app.html](./app.html) | Bestand und Produktliste (`#stock`, `#catalog`) |
| [orders.html](./orders.html), [js/orders.js](./js/orders.js) | Gemeinsame Bestellliste mit Mengenbearbeitung |
| [devices.html](./devices.html), [freezer.html](./freezer.html) | Geräte sowie Orte und Fächer |
| [sorting.html](./sorting.html), [appearance.html](./appearance.html), [transfer.html](./transfer.html) | Sortierung, Farben und Datenaustausch |
| [js/app.js](./js/app.js) | Navigation, Seitenstart und Geräteprüfung |
| [js/inventory.js](./js/inventory.js) | Produktkatalog, Positionen und Dialoge |
| [js/product.js](./js/product.js) | Gemeinsame Produktfeldvalidierung und Auftauzeitformat |
| [js/product-editor.js](./js/product-editor.js) | Gemeinsamer Produktdialog für Katalog und Bestellliste |
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
psql "$env:TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase\tests\item_metadata.sql
psql "$env:TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase\tests\product_orders.sql
psql "$env:TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase\tests\order_receiving.sql
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
