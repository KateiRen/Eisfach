# Datenbankstruktur und Feldreferenz

[Zur Übersicht](../README.md) · [Inventar und Geräte einrichten](./einrichtung.md)

Verbindliche Definition ist [supabase/schema.sql](../supabase/schema.sql).
Sie initialisiert eine frische Supabase-Datenbank in einer Transaktion und ist
nicht zum erneuten Ausführen auf bestehenden Tabellen vorgesehen.
Die folgenden zwölf Tabellen liegen im Schema `public`; zusätzlich wird ein
privater Supabase-Storage-Bucket verwendet.

## Konventionen

- `PK`: Primärschlüssel; `FK`: Fremdschlüssel.
- **NULL: nein** bedeutet Pflichtfeld in der Datenbank. Ein Default erlaubt,
  das Feld beim Einfügen wegzulassen; er ersetzt kein ausdrücklich gesendetes `NULL`.
- UUID-Primärschlüssel erhalten normalerweise `gen_random_uuid()` als Default.
  Import und Anwendung können explizite stabile IDs setzen.
- `timestamptz` speichert einen Zeitpunkt mit Zeitzonenbezug; die Oberfläche
  formatiert ihn lokal. Default `now()` ist serverseitig.
- `integer` ist eine vorzeichenbehaftete 32-Bit-Zahl. Nichtnegative Werte reichen
  daher bis 2147483647.
- Textfelder ohne explizite Längenprüfung haben keine zusätzliche anwendungsbezogene
  SQL-Längengrenze. Formulare oder Edge Functions können strengere Grenzen setzen.
- `updated_at` wird bei Updates durch Trigger auf `now()` gesetzt und für
  optimistische Konfliktprüfung verwendet. `created_at` hat einen Insert-Default;
  die Spalte ist nicht allein dadurch unveränderlich.

## Beziehungen

```text
inventories
  ├── device_registrations
  ├── join_tokens
  ├── inventory_sorting             0..1 Konfiguration je Inventar
  ├── audit_log
  ├── items
  │     ├── order_entries          Bestellliste, ein Eintrag pro Produkt
  │     ├── item_images            Metadaten → private Storage-Datei
  │     └── stock_entries ─────┐
  └── storage_locations      │
        ├── stock_entries ◄──┘
        └── storage_compartments
              └── stock_entries  optionales Fach derselben Position

registration_rate_limits            intern, keine FK-Beziehung
```

Zusammengesetzte Fremdschlüssel stellen sicher, dass Position, Produkt, Ort
und Fach zum selben Inventar gehören und das Fach dem gewählten Ort zugeordnet ist.
Kategorie, Produktnummer und QR-Code sind keine eigenen Tabellen und nicht eindeutig.

## 1. `inventories` – gemeinsames Inventar

| Feld | Typ | NULL | Default | Bedeutung / Prüfung |
| --- | --- | --- | --- | --- |
| `id` | uuid | nein | `gen_random_uuid()` | PK; gemeinsame Inventar-ID |
| `name` | text | nein | keiner | Anzeigename; getrimmt 1–200 Zeichen |
| `description` | text | nein | `''` | Beschreibung, maximal 4000 Zeichen |
| `created_at` | timestamptz | nein | `now()` | Anlagezeitpunkt |

Anlage erfolgt über `setup_inventory`, nicht durch direkte Inserts des Browsers.
Der Browser darf das eigene Inventar lesen, aber nicht direkt ändern/löschen.
Die Einrichtung begrenzt Name auf 100 und Beschreibung auf 1000 Zeichen.

## 2. `device_registrations` – Gerätezugänge

| Feld | Typ | NULL | Default | Bedeutung / Prüfung |
| --- | --- | --- | --- | --- |
| `id` | uuid | nein | `gen_random_uuid()` | PK der Registrierung; nicht gleich `device_id` |
| `inventory_id` | uuid | nein | keiner | FK auf `inventories.id`, `ON DELETE CASCADE` |
| `device_id` | text | nein | `gen_random_uuid()::text` | Global eindeutig; öffentliche Gerätekennung für Request-Header |
| `device_token_hash` | bytea | nein | keiner | SHA-256-Hash des Gerätegeheimnisses; exakt 32 Bytes |
| `device_name` | text | nein | keiner | Gerätename; getrimmt 1–200 Zeichen |
| `revoked` | boolean | nein | `false` | `true` sperrt weitere Geräteauthentifizierung |
| `created_at` | timestamptz | nein | `now()` | Registrierungszeitpunkt |
| `last_seen_at` | timestamptz | nein | `now()` | Zuletzt mit `touch_device()` gemeldete Aktivität |

Zusätzlicher Index auf `inventory_id`; `device_id` besitzt einen Unique-Index.
Das Gerätegeheimnis besteht bei Anlage aus 32 Zufallsbytes als 64-stelligem
Hex-Text und wird nur einmal an den Browser zurückgegeben.
`current_inventory_id()` erwartet einen 64 Zeichen langen Token und eine
Gerätekennung mit 1–128 Zeichen.

Der Browser kann nur freigegebene Spalten lesen, ausschließlich `device_name`
direkt aktualisieren und Registrierungen im eigenen Inventar löschen.
Der Hash ist für `anon`/`authenticated` nicht lesbar. Widerruf erfolgt über
die Edge Function und privilegierte SQL-Funktion.

## 3. `join_tokens` – einmalige Verbindungscodes

| Feld | Typ | NULL | Default | Bedeutung / Prüfung |
| --- | --- | --- | --- | --- |
| `id` | uuid | nein | `gen_random_uuid()` | PK des Codes |
| `inventory_id` | uuid | nein | keiner | FK auf `inventories.id`, `ON DELETE CASCADE` |
| `token_hash` | bytea | nein | keiner | Global eindeutiger SHA-256-Hash; exakt 32 Bytes |
| `expires_at` | timestamptz | nein | keiner | Ablaufzeitpunkt |
| `max_uses` | integer | nein | `1` | Maximale Registrierungen, größer als 0 |
| `uses` | integer | nein | `0` | Verbrauch, zwischen 0 und `max_uses` |
| `revoked` | boolean | nein | `false` | Gesperrt oder vollständig verbraucht |
| `created_at` | timestamptz | nein | `now()` | Erzeugungszeitpunkt |

Zusätzlicher Index auf `inventory_id`. Kein direkter Browserzugriff.
`issue_join_token()` erzeugt zwölf zufällige Zeichen aus
`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, formatiert als `XXXX-XXXX-XXXX`,
setzt 15 Minuten Laufzeit und eine Verwendung. `register_device()` prüft und
verbraucht den Code atomar unter Zeilensperre; beim letzten Verbrauch wird
`revoked = true`. Abgelaufene Codes werden dadurch nicht automatisch gelöscht.

## 4. `items` – Produktdefinitionen

| Feld | Typ | NULL | Default | Bedeutung / Prüfung |
| --- | --- | --- | --- | --- |
| `id` | uuid | nein | `gen_random_uuid()` | PK des Produkts |
| `inventory_id` | uuid | nein | keiner | FK auf `inventories.id`, `ON DELETE CASCADE` |
| `name` | text | nein | keiner | Produktname; getrimmt 1–200 Zeichen |
| `product_number` | text | nein | `''` | Optionale Produktnummer; maximal 100 Zeichen; führende Nullen bleiben erhalten |
| `product_url` | text | ja | keiner | Optionale Produktseite; SQL verlangt HTTP-/HTTPS-Präfix ohne Leerraum; die App prüft eine vollständige URL ohne Zugangsdaten |
| `parts` | text | ja | keiner | Optionaler Teile-Text, z. B. „6–8“ oder „2 Beutel“ |
| `favorite` | boolean | ja | keiner | Optionaler Favorit-Status: `true`, `false` oder nicht angegeben (`NULL`) |
| `usage_count` | integer | nein | `0` | Nutzungscounter, nichtnegativ; darf durch Updates nicht kleiner werden |
| `rating` | integer | ja | keiner | Optionale Bewertung, einschließlich 0 und 5 |
| `weight_grams` | numeric(12,3) | ja | keiner | Gewicht einer Packung in Gramm, 0 ≤ Wert < 1000000000 |
| `price` | numeric(10,2) | ja | keiner | Euro pro Packung, 0 ≤ Wert < 100000000; NULL unbekannt, 0 kostenlos |
| `description` | text | nein | `''` | Produktbeschreibung |
| `category` | text | nein | `''` | Freie Kategorie; leer entspricht „Ohne Kategorie“ |
| `preparation_minutes` | integer | ja | keiner | Zubereitungszeit, nichtnegativ; `NULL` unbekannt, 0 zulässig |
| `thawing_minutes` | integer | ja | keiner | Auftauzeit in Minuten, nichtnegativ; Anzeige über 60 Minuten als Stunden und Restminuten |
| `qr_code` | text | ja | keiner | Gespeicherter Produkt-QR-Inhalt; neue UI-Produkte erhalten `eisfach:item:<id>` |
| `notes` | text | nein | `''` | Notizen, unabhängig vom eigenen Teile-Feld |
| `created_at` | timestamptz | nein | `now()` | Anlagezeitpunkt |
| `updated_at` | timestamptz | nein | `now()` | Änderungsstand; Trigger bei jedem Update |

Zusätzlich eindeutig: `(inventory_id, id)` für inventargebundene
Fremdschlüssel. Index auf `inventory_id`.
Es gibt keine Unique-Regel für Name, Produktnummer oder QR-Code.
Die Datenbank kann numerische Eingaben auf drei Nachkommastellen runden;
die App validiert beim Bearbeiten/Import vorab höchstens drei.
Gewicht und Zeiten sind vom tatsächlichen Bestand unabhängig.
Teile sind bewusst Text und keine numerische Stückzahl.
Der Nutzungscounter ist nicht die Bestandsmenge: `create_stock_position()`
erhöht ihn um 1 pro neu angelegter Position, einschließlich Menge 0.
Ein stabiler Request-/Positionsschlüssel verhindert doppelte Erhöhungen
bei Wiederholung. Die Funktion sperrt das Produkt für konkurrierende
Erfassungen und führt Insert und Increment in derselben Transaktion aus.
Bei Integer-Überlauf wird auch die neue Position zurückgerollt.
Direkte Bestandsinserts (Import), Umlagerung, Bearbeitung und Löschung verändern
den Zähler nicht. Der Trigger `items_usage_count` verhindert Zählerreduktionen.
Neue importierte Produkte dürfen ihren gesicherten Zähler als Initialwert erhalten;
bestehende Produkte werden beim Import nicht überschrieben.

Für eine bestehende Datenbank auf dem vorherigen Stand ergänzt
[update_item_metadata.sql](../supabase/update_item_metadata.sql) diese Felder
und Funktionen. `parts` wird aus passenden `Teile:`-Notizzeilen übernommen,
Notizen bleiben erhalten; Zähler beginnen bei 0. Das Update gehört nicht zur
Initialisierung einer neuen Datenbank.

Der Packungspreis wird unabhängig von Bestand und Bestellmenge gepflegt.
Die App akzeptiert höchstens zwei Nachkommastellen (Punkt oder Komma);
PostgreSQL kann direkte numerische Eingaben auf zwei Stellen runden.
Bestehende Installationen auf dem Stand des Metadaten-Updates ergänzen Preis
und Bestellliste einmalig mit
[update_product_orders.sql](../supabase/update_product_orders.sql).

### `order_entries` – gemeinsame Bestellliste

| Feld | Typ | NULL | Default | Bedeutung / Prüfung |
| --- | --- | --- | --- | --- |
| `id` | uuid | nein | `gen_random_uuid()` | PK; stabile ID für Export/Import |
| `inventory_id` | uuid | nein | keiner | FK auf `inventories.id`, `ON DELETE CASCADE` |
| `item_id` | uuid | nein | keiner | Zusammengesetzter FK mit `inventory_id` auf `items`, `ON DELETE CASCADE` |
| `quantity` | integer | nein | `1` | Positive ganze Bestellmenge, maximal 2147483647 |
| `created_at` | timestamptz | nein | `now()` | Anlagezeitpunkt |
| `updated_at` | timestamptz | nein | `now()` | Änderungsstand für optimistische Konfliktprüfung |

`(inventory_id, item_id)` ist eindeutig. `reorder_product()` legt den Eintrag
an oder erhöht atomar um 1, ohne Bestand oder Nutzungscounter zu verändern.
Ein Überlauf bricht die Änderung ab. Jeder Aufruf ist ein zusätzlicher
Bestellwunsch, kein idempotenter Retry. Die App wiederholt ihn nicht automatisch.
Die Bestellliste speichert keine historischen Preise, sondern zeigt den
aktuellen Produktpreis. Eintragslöschung verändert weder Produkt noch Bestand.

`receive_order()` lagert eine positive Teilmenge bis zur offenen Bestellmenge
in einer Transaktion ein: `create_stock_position()` erzeugt die Position und
erhöht den Nutzungscounter; danach wird die Bestellmenge reduziert oder der
vollständig eingelagerte Eintrag gelöscht. Ein veralteter Änderungsstand,
ungültiger Lagerort oder Zählerüberlauf bricht die gesamte Transaktion ab.
Wiederholungen mit derselben Positions-ID und unveränderten Positionsdaten
erzeugen weder eine zweite Position noch einen zweiten Bestellabzug.
Bestehende Datenbanken ergänzen die Funktion einmalig mit
[update_order_receiving.sql](../supabase/update_order_receiving.sql).

## 5. `storage_locations` – definierte Lagerorte

| Feld | Typ | NULL | Default | Bedeutung / Prüfung |
| --- | --- | --- | --- | --- |
| `id` | uuid | nein | `gen_random_uuid()` | PK des Ortes |
| `inventory_id` | uuid | nein | keiner | FK auf `inventories.id`, `ON DELETE CASCADE` |
| `name` | text | nein | keiner | Getrimmt 1–200 Zeichen, innerhalb des Inventars eindeutig |
| `updated_at` | timestamptz | nein | `now()` | Änderungsstand; Update-Trigger |

Unique-Regeln: `(inventory_id, id)` und `(inventory_id, name)`.
Orte werden über IDs referenziert; Umbenennen ändert keine Bestandszuordnung.
Namenseindeutigkeit folgt dem normalen PostgreSQL-Textvergleich, nicht
einer zusätzlichen Groß-/Kleinschreibungsnormalisierung.

## 6. `storage_compartments` – Fächer eines Ortes

| Feld | Typ | NULL | Default | Bedeutung / Prüfung |
| --- | --- | --- | --- | --- |
| `id` | uuid | nein | `gen_random_uuid()` | PK des Fachs |
| `inventory_id` | uuid | nein | keiner | Inventarzuordnung über den zusammengesetzten Orts-FK |
| `location_id` | uuid | nein | keiner | Zusammen mit `inventory_id` FK auf `storage_locations(inventory_id, id)`, `ON DELETE CASCADE` |
| `name` | text | nein | keiner | Getrimmt 1–200 Zeichen, innerhalb des Ortes eindeutig |
| `updated_at` | timestamptz | nein | `now()` | Änderungsstand; Update-Trigger |

Unique-Regeln: `(inventory_id, location_id, id)` und `(location_id, name)`.
„Ohne Fach“ ist kein Datensatz, sondern `stock_entries.compartment_id IS NULL`.

## 7. `stock_entries` – einzelne Bestandspositionen

| Feld | Typ | NULL | Default | Bedeutung / Prüfung |
| --- | --- | --- | --- | --- |
| `id` | uuid | nein | `gen_random_uuid()` | PK der Position |
| `inventory_id` | uuid | nein | keiner | FK auf `inventories.id`, `ON DELETE CASCADE` |
| `item_id` | uuid | nein | keiner | Zusammen mit `inventory_id` FK auf `items(inventory_id, id)`, `ON DELETE CASCADE` |
| `location_id` | uuid | nein | keiner | Zusammen mit `inventory_id` FK auf `storage_locations(inventory_id, id)` |
| `compartment_id` | uuid | ja | keiner | Optional; zusammen mit Inventar und Ort FK auf `storage_compartments(inventory_id, location_id, id)` |
| `quantity` | integer | nein | `1` | Nichtnegative Stückzahl der Position; maximal 2147483647 |
| `created_at` | timestamptz | nein | `now()` | Anlagezeitpunkt |
| `updated_at` | timestamptz | nein | `now()` | Änderungsstand; Update-Trigger |

Indizes auf `item_id`, `inventory_id` und `(location_id, compartment_id)`.
Keine Unique-Regel für Produkt/Ort/Fach: Mehrere Positionen sind ausdrücklich
erlaubt. Menge 0 bleibt gespeichert, erscheint aber nicht in der Bestandsansicht.
Das Gewicht gehört ausschließlich zum Produkt; hier gibt es keine Gewichtsspalte.
Löschen einer Position löscht nicht das Produkt.

Orts-/Fach-FKs verwenden die Standardaktion `NO ACTION`: Belegte Ziele können
nicht einfach gelöscht werden. Die App verwendet dafür
`delete_storage_location()` mit einem Ersatzort/-fach.

## 8. `item_images` – Bildmetadaten

| Feld | Typ | NULL | Default | Bedeutung / Prüfung |
| --- | --- | --- | --- | --- |
| `id` | uuid | nein | `gen_random_uuid()` | PK des Bildeintrags; unabhängig von der Datei-UUID |
| `item_id` | uuid | nein | keiner | FK auf `items.id`, `ON DELETE CASCADE` |
| `path` | text | nein | keiner | Eindeutiger relativer Storage-Pfad: `<inventar-id>/<produkt-id>/<datei-uuid>.webp` |
| `caption` | text | nein | `''` | Bildbeschriftung; manueller Upload nutzt höchstens 200 Zeichen des Dateinamens |
| `sort_order` | integer | nein | `0` | Reihenfolge; in SQL auch negative Werte zulässig |
| `created_at` | timestamptz | nein | `now()` | Anlagezeitpunkt |

Index auf `item_id`. Keine eigene Inventarspalte: Produkt und Pfad bestimmen
die Zuordnung. RLS verlangt passende Produkt-ID im Pfad und ein berechtigtes
Gerät des Inventars. Die Edge Function validiert zusätzlich das genaue
UUID-/WebP-Pfadformat.

Die UI sortiert nach `sort_order`, `created_at`, `id`; die erste Datei dient als
Listenvorschau. Metadaten und Datei sind nicht dieselbe Ressource.
Das Löschen eines Produkts kaskadiert SQL-Metadaten, löscht aber für sich allein
keine Storage-Dateien. Die App löscht daher zuerst die Dateien über `imageStorage`.

## 9. `inventory_sorting` – gemeinsame Anzeige-Reihenfolge

| Feld | Typ | NULL | Default | Bedeutung / Prüfung |
| --- | --- | --- | --- | --- |
| `inventory_id` | uuid | nein | keiner | PK und FK auf `inventories.id`, `ON DELETE CASCADE`; maximal eine Zeile pro Inventar |
| `categories` | text[] | nein | `'{}'` | Reihenfolge der Kategorienamen; `''` steht für „Ohne Kategorie“ |
| `locations` | uuid[] | nein | `'{}'` | Reihenfolge der Orts-IDs |
| `compartments` | uuid[] | nein | `'{}'` | Fach-IDs; die UI wendet ihre Reihenfolge innerhalb des jeweiligen Ortes an |
| `updated_at` | timestamptz | nein | `now()` | Änderungsstand; Update-Trigger |

Arrays dürfen höchstens eindimensional sein und keine `NULL`-Elemente enthalten.
Es gibt keine FK-Prüfung einzelner Arrayelemente und keine SQL-Prüfung auf
Duplikate. Fehlende Zeile/leere Arrays bedeuten Standardsortierung.
Die UI ignoriert nicht mehr vorhandene Einträge und hängt neue alphabetisch an.
Die Konfiguration wird nicht im JSON-/ZIP-Datenaustausch übertragen.

## 10. `audit_log` – Änderungsprotokoll

| Feld | Typ | NULL | Default | Bedeutung / Prüfung |
| --- | --- | --- | --- | --- |
| `id` | uuid | nein | `gen_random_uuid()` | PK des Ereignisses |
| `inventory_id` | uuid | nein | keiner | FK auf `inventories.id`, `ON DELETE CASCADE` |
| `action` | text | nein | keiner | Durch Trigger gesetzter Aktionsname |
| `item_id` | uuid | ja | keiner | Produktbezug; bewusst **kein FK**, damit gelöschte Produkt-IDs erhalten bleiben |
| `created_at` | timestamptz | nein | `now()` | Ereigniszeitpunkt |

Index auf `(inventory_id, created_at DESC)`. Browser dürfen nur lesen.
Aufgezeichnet werden `inventory.insert`, `item.insert/update/delete`,
`stock.insert/update/delete`, `image.insert/update/delete` und
`device.insert/update/delete`. Reine `last_seen_at`-Aktualisierungen werden
nicht protokolliert. Kaskadierte Bildlöschungen können bereits durch die
Produktlöschung abgedeckt sein.

Kein vollständiger Änderungsverlauf mit Vorher-/Nachher-Werten oder Akteur-ID.
Orts-, Fach-, Sortierungs- und Join-Code-Änderungen besitzen keine eigenen
Audit-Trigger; Umlagerungen erzeugen jedoch Stock-Update-Ereignisse.

## 11. `registration_rate_limits` – interne Registrierungsbegrenzung

| Feld | Typ | NULL | Default | Bedeutung / Prüfung |
| --- | --- | --- | --- | --- |
| `key` | text | nein | keiner | PK; `client:<hash>` oder `inventory:<uuid>` |
| `window_start` | timestamptz | nein | keiner | Beginn des gezählten Minutenfensters |
| `attempts` | integer | nein | keiner | Anzahl verbuchter Versuche |

Kein direkter Browserzugriff und keine FK-Beziehung.
`consume_registration_attempt()` zählt in einer eigenen Transaktion, damit
ein ungültiger Join-Code den Verbrauch nicht zurückrollt.
Die Implementierung begrenzt auf 30 Versuche je Client und 60 je Inventar
pro Minute; nach Überschreiten des Clientlimits wird dessen Inventarzähler
für diesen Versuch nicht weiter erhöht. Zähler werden intern bei 1000000
gedeckelt. Einträge älter als eine Stunde werden bei neuen Versuchen entfernt.
Die konkreten Begrenzungen sind Funktionslogik, keine Feld-Constraints.

## Zugriffsrechte und RLS

RLS ist auf allen zwölf Tabellen aktiviert.
Die Browserrollen `anon` und `authenticated` haben dieselben hier beschriebenen
Geräterechte. Es werden keine Supabase-Auth-Benutzer benötigt.

| Tabelle | Browserrechte zusätzlich zur inventargebundenen RLS-Prüfung |
| --- | --- |
| `inventories` | SELECT |
| `device_registrations` | SELECT nur `id`, `inventory_id`, `device_id`, `device_name`, `revoked`, `created_at`, `last_seen_at`; UPDATE nur `device_name`; DELETE |
| `items`, `stock_entries`, `order_entries`, `storage_locations`, `storage_compartments`, `item_images` | SELECT, INSERT, UPDATE, DELETE |
| `inventory_sorting` | SELECT, INSERT, UPDATE; kein DELETE |
| `audit_log` | SELECT |
| `join_tokens`, `registration_rate_limits` | Keine direkten Rechte |

`service_role` hat vollständige Tabellenrechte und wird ausschließlich
serverseitig verwendet. Standardmäßig wird EXECUTE für künftig erstellte
Funktionen im Schema `public` von PUBLIC entzogen; Freigaben erfolgen explizit.

Die Browser-Requests enthalten `x-inventory-id`, `x-device-id` und
`x-device-token`. `current_inventory_id()` prüft diese Header gegen die aktive
Registrierung und den SHA-256-Hash. Fehlerhafte/fehlende Zugangsdaten ergeben
`NULL`, sodass die inventargebundenen Policies keinen Zugriff freigeben.

## SQL-Funktionen und Trigger

| Funktion | Aufrufer / Ergebnis | Aufgabe |
| --- | --- | --- |
| `current_inventory_id()` | Browserrollen; uuid oder NULL | Aktives Gerät aus Request-Headern prüfen |
| `touch_device()` | Browserrollen; void | Berechtigtes Gerät prüfen und `last_seen_at` aktualisieren |
| `create_stock_position(p_id uuid, p_item_id uuid, p_location_id uuid, p_compartment_id uuid, p_quantity integer)` | Browserrollen; Bestandsposition als SETOF | Idempotente Positionserfassung und atomare Erhöhung von `usage_count`; arbeitet mit den bestehenden RLS-Rechten, nicht als SECURITY DEFINER |
| `preserve_item_usage_count()` | Nur Trigger | Verhindert eine Reduktion von `items.usage_count` |
| `reorder_product(p_item_id uuid)` | Browserrollen; Bestelleintrag als SETOF | Inventargebundenes atomares Anlegen/Erhöhen der Bestellmenge; Invoker-Rechte und RLS |
| `can_access_inventory_image(p_path text)` | Browserrollen/Policies; boolean | Inventar und Produktzuordnung eines Bildpfads prüfen |
| `delete_storage_location(p_location_id uuid, p_compartment_id uuid, p_updated_at timestamptz, p_target_location_id uuid, p_target_compartment_id uuid)` | Browserrollen; integer | Ort oder Fach versionsgeprüft löschen; betroffene Positionen atomar verschieben, Anzahl zurückgeben |
| `setup_inventory(p_name text, p_description text, p_device_name text)` | Nur service_role; Inventar-ID, Geräte-ID, Gerätegeheimnis | Inventar und erstes Gerät atomar anlegen |
| `register_device(p_inventory_id uuid, p_join_token text, p_device_name text)` | Nur service_role; Inventar-ID, Geräte-ID, Gerätegeheimnis | Einmalcode verbrauchen und neues Gerät anlegen |
| `lock_active_device(p_inventory_id uuid, p_device_id text, p_device_token text)` | Nur service_role; void | Aktiven Aufrufer unter Zeilensperre erneut prüfen |
| `issue_join_token(p_inventory_id uuid, p_caller_device_id text, p_caller_device_token text)` | Nur service_role; Join-Code und Ablaufzeit | Code ausstellen |
| `revoke_device(p_inventory_id uuid, p_device_id text, p_caller_device_id text, p_caller_device_token text)` | Nur service_role; void | Gerätezugriff nach erneuter Aufruferprüfung widerrufen |
| `consume_registration_attempt(p_inventory_id uuid, p_client_key text)` | Nur service_role; boolean | Rate-Limit-Verbrauch buchen und Freigabe zurückgeben |
| `set_item_updated_at()` | Nur Trigger | `updated_at` für Produkte, Positionen, Bestelleinträge, Orte, Fächer und Sortierung setzen |
| `audit_change()` | Nur Trigger | Inventar-, Produkt-, Bild- und Geräteereignisse schreiben |
| `audit_stock_change()` | Nur Trigger | Bestandsereignisse schreiben |

Bei `delete_storage_location()` bedeutet `p_compartment_id = NULL`, dass der
gesamte Ort gelöscht wird. Ohne Bestände kann der Ersatzort `NULL` sein;
mit Beständen ist ein gültiger Ersatz erforderlich. Die Funktion sperrt Orte
inventarweit in definierter Reihenfolge und führt Verschieben und Löschen
in derselben Transaktion aus.

Die Edge-Endpunkte verbinden Browser und privilegierte Funktionen:

| Endpunkt | Zugang | SQL-/Storage-Aufgabe |
| --- | --- | --- |
| `createInventory` | Öffentlich | `setup_inventory` |
| `registerDevice` | Öffentlich, begrenzt | `consume_registration_attempt`, dann `register_device` |
| `createJoinToken` | Aktives Gerät | `issue_join_token` |
| `revokeDevice` | Aktives Gerät | `revoke_device` |
| `imageStorage` | Aktives Gerät und passendes Produkt | WebP hochladen, signieren oder löschen |

## Storage und Löschverhalten

Der Supabase-Bucket `inventory-images` wird in `storage.buckets` als **privat**
angelegt. Dateien werden von Supabase in `storage.objects` verwaltet; diese
Supabase-Systemtabellen werden nicht als eigene App-Tabellen neu definiert.
Eine restriktive Policy sperrt direkten Zugriff der Browserrollen auf diesen
Bucket, auch wenn weitere permissive Policies existieren.

Bildoperationen laufen über die Edge Function mit Geräte- und Produktprüfung.
Dateipfad: `<inventar-uuid>/<produkt-uuid>/<datei-uuid>.webp`.
Komprimierte Dateien dürfen maximal 5 MB groß sein. Signierte URLs gelten
120 Sekunden und sind währenddessen vertrauliche Bearer-Links.

Das Löschen eines Inventars kaskadiert SQL-Daten einschließlich Geräte, Codes,
Produkte, Positionen, Bildmetadaten, Orte/Fächer, Sortierung und Auditzeilen.
Storage-Dateien und interne Rate-Limit-Schlüssel werden dadurch nicht automatisch
entfernt. Eine Inventarlöschung ist nicht als normale UI-Aktion implementiert;
administrative Löschungen müssen Storage und Aufbewahrung separat berücksichtigen.

## Lokale Daten sind keine Datenbanktabellen

Der Browser hält Geräteverbindung, optionale Offline-Lesekopie und Akzentfarben
in separaten `localStorage`-Schlüsseln. Diese Daten gehören nicht zum SQL-Schema.
Details und Auswirkungen des lokalen Trennens stehen in der
[Einrichtungsanleitung](./einrichtung.md#4-was-der-browser-speichert).
Die Offline-Kopie ist keine vollständige Datenbanksicherung und enthält keine Bilder.
