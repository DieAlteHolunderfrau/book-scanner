# Buchscanner für Obsidian – v4

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
