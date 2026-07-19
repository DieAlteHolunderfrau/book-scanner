# Buchscanner für Obsidian

Eine kleine Progressive Web App:

1. ISBN-Barcode mit der Handykamera scannen.
2. Metadaten über Google Books laden.
3. Felder prüfen oder korrigieren.
4. Eine Markdown-Notiz über `obsidian://new` im mobilen Obsidian-Vault anlegen.

## Veröffentlichung mit GitHub Pages

1. Neues GitHub-Repository anlegen, etwa `book-scanner`.
2. Den **Inhalt** dieses Ordners in das Repository hochladen.
3. Im Repository **Settings → Pages** öffnen.
4. Bei **Build and deployment** `Deploy from a branch` wählen.
5. Branch `main`, Ordner `/ (root)` wählen und speichern.
6. Die anschließend angezeigte Pages-Adresse auf dem Telefon öffnen.

Die Kamera benötigt HTTPS. GitHub Pages liefert HTTPS.

## Installation auf dem Telefon

### iPhone

Safari → Teilen → **Zum Home-Bildschirm** → **Als Web-App öffnen** aktivieren.

### Android

Chrome → Menü → **App installieren** oder **Zum Startbildschirm hinzufügen**.

Danach Kamera erlauben.

## Obsidian

- Obsidian auf dem Telefon installieren.
- Den synchronisierten Vault einmal öffnen.
- In der Scanner-App den Vault-Namen exakt eintragen.
- Zielordner festlegen, standardmäßig `Bücher`.

## Grenzen des Prototyps

- Er scannt den ISBN-Barcode, noch keine ganzen Buchrücken.
- `html5-qrcode` wird beim ersten Aufruf von cdnjs geladen.
- Google-Books-Daten können fehlen oder eine andere Ausgabe beschreiben.
- Es gibt noch keine Dublettenprüfung gegen den Vault.
- Cover werden als URL gespeichert.
