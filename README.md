# Buchscanner für Obsidian – v5

Die PWA scannt ISBN-Barcodes, lädt Metadaten und unterstützt jetzt einen Stapelmodus.

## Stapelmodus

1. Buch scannen und Metadaten prüfen.
2. **Zum Stapel hinzufügen & weiter** wählen.
3. Die Prüfansicht wird geleert und die Kamera ist für das nächste Buch bereit.
4. Der Stapel bleibt im lokalen Browser-Speicher erhalten – auch nach einem Neuladen.

## Export

- **Nächstes in Obsidian exportieren:** öffnet pro Klick eine neue Markdown-Notiz über `obsidian://new`. Mobile Browser blockieren automatische Serien externer App-Aufrufe, daher erfolgt dieser Export schrittweise.
- **Alle Markdown-Dateien als ZIP:** erzeugt ohne zusätzliche Bibliothek ein ZIP mit einer `.md`-Datei je Buch. Der konfigurierte Obsidian-Ordner ist im ZIP enthalten. Entpacke den Inhalt im Root deines Vaults.

## Weitere Funktionen

- Open Library als primäre Datenquelle
- optionaler Google-Books-Fallback mit API-Key
- Genre-Vorschläge aus Open-Library-Subjects
- Stapel bearbeiten, Einträge löschen, Exportstatus zurücksetzen
- ISBN-Dubletten innerhalb des aktuellen Stapels verhindern

## Veröffentlichung

Alle Dateien in dein GitHub-Pages-Repository kopieren und committen. Danach die Seite einmal mit `?v=4` aufrufen. Bei einer weiterhin alten Oberfläche die installierte Web-App entfernen, Website-Daten löschen und neu installieren.


## Scanner-Verbesserungen in v5

- Auswertung des gesamten Kamerabilds statt eines engen Scan-Ausschnitts
- bevorzugte Rückkamera mit idealerweise 1920×1080 Pixeln
- kontinuierlicher Autofokus, soweit der Browser ihn freigibt
- optionaler Zoom-Regler und Kameralicht bei unterstützten Geräten
- Kamera-Neustart zum erneuten Fokussieren
- Foto-Modus über die native Kamera als zuverlässiger Fallback
- die v4-Warteschlange wird beim ersten Start übernommen

Der sichtbare Rahmen ist nur eine Zielhilfe. Er beschneidet den Decoder nicht.
