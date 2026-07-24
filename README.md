# Buchscanner für Obsidian – v12

## Werkorientiertes Datenmodell

Die App verwendet die ISBN nur noch als technischen Einstieg in die Metadatensuche. Es wird weiterhin genau eine Obsidian-Notiz pro Buch/Werk erzeugt; separate Ausgabennotizen gibt es nicht.

Ausgabenspezifische Felder wurden aus Oberfläche und Markdown entfernt:

- Verlag
- Erscheinungsdatum der gescannten Ausgabe
- Seitenzahl

Erhalten bleiben praktisch relevante Angaben wie Lesesprache, Cover, Besitz und Lesestatus.

## Ersterscheinungsjahr

Bei Open-Library-Treffern folgt die App der ISBN-Ausgabe zum zugehörigen Werk. Das Feld `first_publish_date` des Werks wird auf ein Jahr reduziert. Fehlt es dort, versucht die App ergänzend die Open-Library-Werksuche und verwendet deren `first_publish_year`.

Das Ergebnis wird editierbar angezeigt und so gespeichert:

```yaml
first_publication_year: 1977
```

Google Books liefert kein eigenes Werkobjekt. Wird Google Books als Fallback verwendet, versucht die App deshalb zusätzlich, Titel und Autor in der Open-Library-Werksuche zuzuordnen. Nur bei einem ausreichend plausiblen Treffer werden Ersterscheinungsjahr und Werk-ID ergänzt.

## Obsidian-Frontmatter

Beispiel:

```yaml
---
type: book
title: "The Shining"
authors:
  - "[[Stephen King]]"
genres:
  - "Horror"
subjects:
  - "Haunted hotels"
first_publication_year: 1977
language_read: "eng"
source_isbn: "0451160916"
openlibrary_work_id: "OL45804W"
cover_url: "https://..."
ownership: owned
reading_status: unread
added: 2026-07-24
metadata_source: open-library
---
```

`source_isbn` bleibt in genau der Form erhalten, die gescannt oder manuell eingegeben wurde. Eine äquivalente ISBN-10 beziehungsweise ISBN-13 wird nur als Such-Fallback verwendet.

## Dateiname

Der Name der Markdown-Datei besteht nur noch aus dem Buchtitel:

```text
Bücher/The Shining.md
```

Ungültige Zeichen werden weiterhin entfernt. Bei zwei unterschiedlichen Werken mit exakt demselben Titel kann es dadurch zu einer Dateikollision kommen.

## Stapel und Dubletten

Die Stapelprüfung erkennt weiterhin äquivalente ISBN-10-/ISBN-13-Werte. Zusätzlich gilt dieselbe Open-Library-Werk-ID als bereits vorhandenes Werk, auch wenn eine andere Ausgabe mit einer anderen ISBN gescannt wurde. Ein vorhandener v11-Stapel wird automatisch übernommen.

## Erkennungslauf

1. Kamera manuell starten.
2. **Erkennung starten** drücken.
3. Fünf Barcodeversuche im Abstand von etwa einer Sekunde.
4. Danach einmalige ISBN-Texterkennung.
5. Nach Erfolg oder Misserfolg vollständiger Stopp.

## Veröffentlichung

Alle Dateien in das GitHub-Pages-Repository übernehmen und die Seite einmal mit `?v=12` öffnen. Falls noch die alte Version erscheint, die installierte PWA und die Website-Daten entfernen und anschließend neu installieren.
