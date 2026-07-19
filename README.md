# Buchscanner für Obsidian – v11

## ISBN-10 bleibt ISBN-10

Eine erkannte oder manuell eingegebene ISBN wird nicht mehr zwangsweise in ISBN-13 umgewandelt.

Beispiel:

- erkannt/eingegeben: `0451160916`
- erster Open-Library-Aufruf: `/isbn/0451160916.json`
- nur falls dort kein Treffer kommt, wird zusätzlich die äquivalente ISBN-13 `9780451160911` als Fallback versucht.

Das gleiche gilt umgekehrt für eine ISBN-13 mit `978`-Präfix: Sie bleibt primär erhalten; die berechenbare ISBN-10 wird nur als Such-Fallback verwendet.

## OCR

Die OCR gibt eine gültige zehnstellige ISBN jetzt direkt zurück. Sie wird vor der Metadatensuche nicht mehr in ISBN-13 umgewandelt. Typische Zeichenverwechslungen werden weiterhin über die Prüfziffer aufgelöst.

## Obsidian-Frontmatter

Die ursprüngliche ISBN und beide verfügbaren Formen werden getrennt gespeichert:

```yaml
isbn: "0451160916"
isbn_10: "0451160916"
isbn_13: "9780451160911"
```

Bei einer ISBN-13 mit `979` kann in der Regel keine ISBN-10 abgeleitet werden; `isbn_10` bleibt dann leer.

## Dubletten

ISBN-10 und die äquivalente ISBN-13 gelten im Stapel als dasselbe Buch. Dadurch kann dieselbe Ausgabe nicht einmal als ISBN-10 und ein zweites Mal als ISBN-13 hinzugefügt werden.

## Erkennungslauf

1. Kamera manuell starten.
2. **Erkennung starten** drücken.
3. Fünf Barcodeversuche im Abstand von etwa einer Sekunde.
4. Danach einmalige ISBN-Texterkennung.
5. Nach Erfolg oder Misserfolg vollständiger Stopp.

## Veröffentlichung

Alle Dateien in das GitHub-Pages-Repository übernehmen und die Seite einmal mit `?v=11` öffnen. Falls noch die alte Version erscheint, die installierte PWA und die Website-Daten entfernen und anschließend neu installieren.
