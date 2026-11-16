# Inventar erstellen und Geräte hinzufügen

[Zur Übersicht](../README.md) · [Datenbankreferenz](./datenbank.md)

## Voraussetzungen

- Die App ist mit dem aktuellen Schema und den fünf Edge Functions auf Supabase
  eingerichtet; siehe [technische Einrichtung](../README.md#technische-einrichtung).
- Die App ist im Browser über HTTPS oder lokal über localhost erreichbar.
- Für Anlage, Registrierung und Änderungen ist Internet erforderlich.

Ein „Gerät“ ist in Eisfach eine Registrierung **in einem Browserprofil**.
Ein anderer Browser, privater Modus oder ein anderes Profil benötigt eine eigene
Verbindung. Es gibt keine Anmeldung per E-Mail und kein Benutzerpasswort.
Pro Browserprofil speichert die App genau eine aktive Inventarverbindung.

## 1. Neues Inventar mit dem ersten Gerät erstellen

1. Die App öffnen. Ohne gespeicherte Verbindung erscheint
   [Einrichtung](../setup.html) mit **Neues Inventar** und **Inventar verbinden**.
2. Unter **Inventar einrichten** ausfüllen:

   | Eingabe | Bedeutung | Grenze im Formular |
   | --- | --- | --- |
   | Inventarname | Gemeinsamer Name, z. B. „Unser Eisfach“ | Pflicht, 100 Zeichen |
   | Beschreibung | Optionale Beschreibung des Inventars | 1000 Zeichen |
   | Name dieses Geräts | Wiedererkennbarer Name, z. B. „Küchen-Tablet“ | Pflicht, 100 Zeichen |

3. **Inventar und erstes Gerät anlegen** wählen.
4. Der Server legt Inventar und erste Geräteregistrierung in einer Transaktion an.
   Der Browser speichert die zurückgegebene Verbindung und öffnet **Bestand**.
5. Unter **Menü → Einstellungen → Orte und Fächer** mindestens einen Ort anlegen,
   optional Fächer ergänzen.
6. Zur **Produktliste** wechseln, Produkte anlegen und über **Einlagern**
   Ort, optionales Fach und Stückzahl erfassen.

Das erste Gerät ist sofort voll berechtigt und benötigt keinen Join-Code.
Die Datenbank erlaubt teilweise größere Textlängen als das Formular;
die exakten Feldgrenzen stehen in der [Datenbankreferenz](./datenbank.md).

**Schon mit einem Inventar verbunden?** Die Einrichtungsseite leitet dann zur
App weiter. Vor einem Inventarwechsel zunächst sicherstellen, dass ein anderes
aktives Gerät den bisherigen Zugriff behält. Danach unter **Einstellungen →
Geräte → Dieses Gerät lokal trennen** die lokale Verbindung entfernen.

## 2. Weiteres Gerät hinzufügen

### Auf einem bereits verbundenen Gerät

1. **Menü → Einstellungen → Geräte** öffnen.
2. **Neues Gerät verbinden** wählen.
3. Die App zeigt einen QR-Code, einen Join-Code und die Inventar-ID.
4. Den Code nur mit einer vertrauenswürdigen Person bzw. dem gewünschten Gerät
   teilen: Die Registrierung gewährt vollständigen Inventarzugriff.

Der Code ist **15 Minuten gültig und einmal verwendbar**. Nach erfolgreicher
Registrierung oder Ablauf ist für das nächste Gerät ein neuer Code nötig.
**Code ausblenden** versteckt nur die lokale Anzeige; es widerruft den Code
nicht serverseitig vor Ablauf.

### Auf dem neuen Gerät

1. Dieselbe App-Adresse im gewünschten Browserprofil öffnen.
2. **Inventar verbinden** wählen, **nicht** ein zweites Inventar anlegen.
3. **QR-Code scannen** wählen und die Kamera erlauben. Der Scan übernimmt
   Inventar-ID und Join-Code; er verbindet noch nicht automatisch.
4. Alternativ Inventar-ID und Join-Code manuell eingeben.
5. Unter **Name dieses Geräts** einen eigenen Namen eintragen.
6. **Gerät verbinden** wählen. Nach erfolgreicher Registrierung wird die
   lokale Verbindung gespeichert und der gemeinsame Bestand geöffnet.
7. Auf dem bisherigen Gerät die Geräteübersicht neu laden und den neuen
   Gerätenamen prüfen.

Der QR-Code enthält ausschließlich:

```json
{
  "inventoryId": "UUID-des-Inventars",
  "joinToken": "ABCD-EFGH-JKLM"
}
```

Die Datenbank normalisiert den Join-Code auf Großbuchstaben ohne Bindestriche,
prüft Hash, Ablauf und Verbrauch unter Zeilensperre und registriert dann das
Gerät. Zwei gleichzeitige Verwendungen desselben Codes können nicht beide
erfolgreich sein. Das neue Gerät erhält ein eigenes Gerätegeheimnis; der
Join-Code wird nicht als dauerhafte Verbindung gespeichert.

### Wenn die Verbindung nicht gelingt

- **Code abgelaufen oder bereits verwendet:** Auf einem aktiven Gerät einen
  neuen Code erzeugen.
- **QR-Scan nicht möglich:** HTTPS, Kamerafreigabe und Kamera prüfen oder Daten
  manuell eingeben. Ein QR-Code allein ersetzt nicht den Klick auf **Gerät verbinden**.
- **Zu viele Versuche:** Kurz warten; es gelten serverseitige Minutenlimits.
- **Keine dauerhafte Verbindung:** Speicherung im Browser erlauben. Privater
  Modus oder das Löschen von Website-Daten kann die Verbindung entfernen.
- **Antwort beim Anlegen/Verbinden verloren:** Nicht von einem vollständigen
  Rollback ausgehen. Der Server kann den Vorgang bereits abgeschlossen haben,
  obwohl der Browser die Verbindung nicht gespeichert hat. Ein verbrauchter
  Join-Code muss durch einen neuen ersetzt werden; bei einer verlorenen ersten
  Inventarverbindung ist administrative Unterstützung nötig.

## 3. Geräte verwalten und Zugriff beenden

Alle aktiven Geräte sind gleichberechtigt. Die Geräteübersicht zeigt Name,
Registrierungszeitpunkt, letzte gemeldete Aktivität und Status.

| Aktion | Wirkung |
| --- | --- |
| Umbenennen | Ändert den Gerätenamen; aktuell maximal 100 Zeichen im Dialog |
| Deaktivieren | Widerruft den Onlinezugriff; Registrierung bleibt als deaktiviert sichtbar |
| Löschen | Entfernt die Registrierung dauerhaft |
| Dieses Gerät lokal trennen | Entfernt Verbindung und Offline-Kopie nur in diesem Browser; Registrierung bleibt aktiv |

Deaktivierung und Löschung des eigenen Geräts führen zurück zur Einrichtung.
Zum erneuten Verbinden ist ein neuer Join-Code erforderlich. Es gibt keinen
Button zum Reaktivieren einer deaktivierten Registrierung.

**Das letzte aktive Gerät nicht ohne Ersatz deaktivieren, löschen oder lokal
trennen.** Inventar-ID und Produkt-QR-Code erlauben keine Wiederherstellung.
Es gibt keinen Benutzeraccount, Passwort-Reset oder eingebauten Recovery-Code.
Eine Wiederherstellung ohne aktives Gerät benötigt einen Projektadministrator;
das Gerätegeheimnis ist serverseitig nicht im Klartext abrufbar.

## 4. Was der Browser speichert

| Schlüssel | Inhalt | Verhalten beim lokalen Trennen |
| --- | --- | --- |
| `eisfach.connection` | Inventar-ID, Geräte-ID und Gerätegeheimnis | Wird entfernt |
| `eisfach.inventory` | Versionierte Offline-Lesekopie mit Produkten, Positionen, Orten, Fächern und Sortierung | Wird entfernt |
| `eisfach.appearance` | Persönliche Akzentfarben | Bleibt erhalten |

Das Gerätegeheimnis wird bei Anlage/Registrierung einmal zurückgegeben.
Die Datenbank speichert nur den Hash. Die lokale Verbindung ist daher
vertraulich: nicht kopieren, veröffentlichen oder als Bildschirmfoto weitergeben.
JSON-/ZIP-Sicherungen enthalten sie absichtlich nicht.

Ein widerrufenes Gerät kann keine neuen Daten mehr online laden.
Bereits lokal vorhandene Daten lassen sich nicht aus der Ferne löschen;
signierte Bildlinks bleiben bis zu ihrem Ablauf nach maximal 120 Sekunden nutzbar.
