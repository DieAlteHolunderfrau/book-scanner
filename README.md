# Buchscanner für Obsidian – Version 2

Die Metadatensuche verwendet jetzt zuerst Open Library ohne API-Key. Optional kann unter „Google-Books-Fallback“ ein Google Books API-Key lokal im Browser hinterlegt werden.

## Fehlerbehebung nach dem Update

Die erste Version hatte einen Cache-First-Service-Worker. Dadurch kann das Telefon trotz neuer Dateien noch die alte App anzeigen.

1. Neue Dateien vollständig auf GitHub hochladen und committen.
2. Die Seite im Browser einmal neu laden.
3. Falls weiterhin die alte Fehlermeldung erscheint: installierte Web-App löschen und neu installieren oder Website-Daten/Cache für die Pages-Adresse löschen.

Die neue Version zeigt bei fehlgeschlagenen Abrufen den tatsächlichen Dienst und HTTP-Status an.

## Datenquellen

- Open Library: `https://openlibrary.org/isbn/{ISBN}.json`
- Google Books optional: `https://www.googleapis.com/books/v1/volumes?q=isbn:{ISBN}&key={API_KEY}`


## Genres und Schlagwörter

Die ISBN-Abfrage liefert eine konkrete Ausgabe. Für Genres und Themen ruft die App zusätzlich das verknüpfte Open-Library-Werk ab und liest dessen `subjects`. Daraus werden vorsichtige, editierbare Genre-Vorschläge erzeugt. Die vollständigen Open-Library-Schlagwörter werden separat als `subjects` gespeichert, weil sie nicht nur Genres, sondern auch Themen, Orte und Zielgruppen enthalten können.
