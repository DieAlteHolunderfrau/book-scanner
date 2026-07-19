# Buchscanner für Obsidian – v8

## Manueller Erkennungslauf

Die Kamera läuft nur als Vorschau. Es gibt keinen automatischen oder wiederkehrenden Scanzyklus mehr.

1. Buch und ISBN-Bereich in der Kameravorschau ausrichten.
2. **Erkennung starten** drücken.
3. Die App versucht bis zu fünfmal, ungefähr einmal pro Sekunde, einen ISBN-Barcode zu lesen.
4. Ein gültiger ISBN-Barcode beendet den Lauf sofort und lädt die Metadaten.
5. Reine Handelsbarcodes wie UPC-A werden registriert, gelten aber nicht als ISBN-Treffer.
6. Bleiben alle fünf Versuche ohne ISBN, wird ein frisches hochauflösendes Bild einmal per OCR auf eine gedruckte ISBN geprüft.
7. Nach Erfolg oder Misserfolg endet der Lauf vollständig. Der nächste Lauf beginnt ausschließlich durch einen erneuten Tastendruck.

## Nach einem Treffer

Nach der Prüfung kann das Buch entweder:

- direkt per Obsidian-URI in den Vault übertragen werden oder
- zum lokalen Stapel hinzugefügt werden.

Beide Wege setzen das Eingabeformular anschließend für das nächste Buch zurück. Danach kann der nächste Erkennungslauf manuell gestartet werden.

## Temporäre Bilder

Kameraaufnahmen werden nicht in `localStorage`, IndexedDB, dem Service-Worker-Cache oder dem Stapel gespeichert. Jeder Barcodeversuch verwendet ein frisches temporäres Canvas. Nach der Auswertung werden Canvas-Puffer geleert und auf 1 × 1 Pixel zurückgesetzt. Temporäre Blob-URLs werden unmittelbar widerrufen; importierte Fotoverweise werden nach der Auswertung entfernt. Dauerhaft gespeichert werden nur Einstellungen und Buchdatensätze des Stapels.

## Weitere Funktionen

- separate Schaltfläche **ISBN-Text lesen**
- Foto-Import als Fallback
- Open Library mit Werk-Schlagwörtern und Genre-Vorschlägen
- optionaler Google-Books-Fallback
- direkter Obsidian-Export
- Stapel, schrittweiser Obsidian-Export und ZIP-Export

## Veröffentlichung

Den Inhalt dieses Ordners in das GitHub-Pages-Repository kopieren und committen. Die Seite anschließend einmal mit `?v=8` öffnen. Bei alter Oberfläche die installierte PWA entfernen und die Website-Daten löschen.
