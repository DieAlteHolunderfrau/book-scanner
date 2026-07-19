# Buchscanner für Obsidian – v7

## Automatische Erkennung

- alle 2 Sekunden genau eine Barcodeprüfung
- nach zwei erfolglosen Barcodeprüfungen automatisch eine OCR-Prüfung
- native `BarcodeDetector`-API, wenn der Browser sie bereitstellt
- Quagga2 als EAN-/UPC-Fallback für einzelne Standbilder
- weiterhin manuelle ISBN-Texterkennung und Foto-Import
- Bulk-Warteschlange und Obsidian-/ZIP-Export aus v6 bleiben erhalten

## Temporäre Bilder und Speicher

Kameraaufnahmen werden nicht in `localStorage`, IndexedDB oder im Service-Worker-Cache gespeichert. Für jede Prüfung wird nur ein temporäres Canvas im Arbeitsspeicher erzeugt. Danach werden Canvas-Puffer geleert, Bild-Bitmaps geschlossen, Blob-URLs widerrufen und File-Input-Verweise zurückgesetzt. Dauerhaft gespeichert werden nur Einstellungen und Buchdatensätze des Stapels.

## Ablauf

1. Kamera starten.
2. Nach 2 Sekunden Barcodeprüfung 1/2.
3. Nach weiteren 2 Sekunden Barcodeprüfung 2/2.
4. Bleiben beide erfolglos, wird dasselbe zweite Standbild per OCR nach einer gedruckten ISBN durchsucht.
5. Danach beginnt der Zyklus erneut.
6. Sobald eine ISBN erkannt wurde, pausiert die Automatik bis das Buch geprüft und zum Stapel hinzugefügt wurde.

## Veröffentlichung

Den Inhalt dieses Ordners in das GitHub-Pages-Repository kopieren, committen und die Seite einmal mit `?v=7` öffnen. Bei alter Oberfläche die installierte PWA entfernen und die Website-Daten löschen.
