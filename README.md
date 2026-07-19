# Buchscanner für Obsidian – v6

## Neu in v6

- breiter dynamischer Live-Scanbereich für EAN-13
- zusätzliche Formate: UPC-A, UPC-E und EAN-8
- klare Unterscheidung zwischen ISBN-Barcode und reinem Handelsbarcode
- Foto-Scan in mehreren überlappenden Ausschnitten und mit Kontrastvariante
- OCR-Fallback über Tesseract.js für aufgedruckte ISBN-10/ISBN-13
- Schaltfläche **ISBN-Text lesen** für ältere US-Taschenbücher mit UPC statt ISBN-Barcode
- Prüfsummenvalidierung für ISBN-10 und ISBN-13

Bei einem UPC wie `071162007992` versucht die App nicht mehr, diesen als ISBN zu suchen. Stattdessen liest sie die daneben oder darüber gedruckte Angabe wie `ISBN 0-451-19671-6` per OCR und wandelt sie in ISBN-13 um.

## Veröffentlichung

Dateien in das GitHub-Pages-Repository kopieren, committen und die Seite einmal mit `?v=6` öffnen. Bei alter Oberfläche die installierte PWA entfernen und die Website-Daten löschen.
