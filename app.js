const els = {
  vault: document.querySelector("#vault"),
  folder: document.querySelector("#folder"),
  manualIsbn: document.querySelector("#manual-isbn"),
  lookupButton: document.querySelector("#lookup-button"),
  status: document.querySelector("#status"),
  resultCard: document.querySelector("#result-card"),
  title: document.querySelector("#title"),
  authors: document.querySelector("#authors"),
  isbn: document.querySelector("#isbn"),
  publisher: document.querySelector("#publisher"),
  publishedDate: document.querySelector("#published-date"),
  pages: document.querySelector("#pages"),
  language: document.querySelector("#language"),
  coverUrl: document.querySelector("#cover-url"),
  coverPreview: document.querySelector("#cover-preview"),
  ownership: document.querySelector("#ownership"),
  readingStatus: document.querySelector("#reading-status"),
  obsidianButton: document.querySelector("#obsidian-button"),
  copyButton: document.querySelector("#copy-button"),
  markdownPreview: document.querySelector("#markdown-preview"),
};

let lastScanned = "";
let lookupInProgress = false;

function setStatus(message, kind = "") {
  els.status.textContent = message;
  els.status.className = `status ${kind}`.trim();
}

function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeIsbn(value) {
  const digits = digitsOnly(value);
  return digits.length === 10 ? isbn10To13(digits) : digits;
}

function isbn10To13(isbn10) {
  if (!/^\d{9}[\dXx]$/.test(isbn10)) return isbn10;
  const body = `978${isbn10.slice(0, 9)}`;
  const sum = [...body].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0
  );
  return `${body}${(10 - (sum % 10)) % 10}`;
}

function isBookIsbn(isbn) {
  return /^\d{13}$/.test(isbn) && (isbn.startsWith("978") || isbn.startsWith("979"));
}

function splitAuthors(value) {
  return String(value ?? "").split(";").map((name) => name.trim()).filter(Boolean);
}

function yamlString(value) {
  return `"${String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, " ")}"`;
}

function safeFilename(value) {
  return String(value ?? "")
    .replace(/[\\/:*?"<>|#\^\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function getFormData() {
  return {
    vault: els.vault.value.trim(),
    folder: els.folder.value.trim().replace(/^\/+|\/+$/g, ""),
    title: els.title.value.trim(),
    authors: splitAuthors(els.authors.value),
    isbn: normalizeIsbn(els.isbn.value),
    publisher: els.publisher.value.trim(),
    publishedDate: els.publishedDate.value.trim(),
    pages: digitsOnly(els.pages.value),
    language: els.language.value.trim(),
    coverUrl: els.coverUrl.value.trim().replace(/^http:\/\//i, "https://"),
    ownership: els.ownership.value,
    readingStatus: els.readingStatus.value,
  };
}

function buildMarkdown() {
  const book = getFormData();
  const lines = ["---", "type: book", `title: ${yamlString(book.title)}`, "authors:"];

  if (book.authors.length) {
    for (const author of book.authors) {
      lines.push(`  - ${yamlString(`[[${author}]]`)}`);
    }
  } else {
    lines.push("  -");
  }

  lines.push(
    `isbn_13: ${yamlString(book.isbn)}`,
    `publisher: ${yamlString(book.publisher)}`,
    `publication_date: ${yamlString(book.publishedDate)}`,
    `pages: ${book.pages || "null"}`,
    `language: ${yamlString(book.language)}`,
    `cover_url: ${yamlString(book.coverUrl)}`,
    `ownership: ${book.ownership}`,
    `reading_status: ${book.readingStatus}`,
    `added: ${todayIso()}`,
    "metadata_source: google-books",
    "---",
    "",
    `# ${book.title}`,
    "",
    "## Leseverlauf",
    "",
    "## Notizen",
    "",
    "## Zitate",
    "",
    "## Eindruck",
    ""
  );

  return lines.join("\n");
}

function updatePreview() {
  els.markdownPreview.textContent = buildMarkdown();
  const cover = els.coverUrl.value.trim().replace(/^http:\/\//i, "https://");
  if (cover) {
    els.coverPreview.src = cover;
    els.coverPreview.hidden = false;
    els.coverPreview.alt = `Cover von ${els.title.value.trim() || "dem Buch"}`;
  } else {
    els.coverPreview.removeAttribute("src");
    els.coverPreview.hidden = true;
    els.coverPreview.alt = "";
  }
}

function selectBestVolume(items, isbn) {
  return items.find((item) =>
    (item.volumeInfo?.industryIdentifiers ?? [])
      .some((entry) => digitsOnly(entry.identifier) === isbn)
  ) ?? items[0];
}

async function lookupBook(rawIsbn) {
  const isbn = normalizeIsbn(rawIsbn);

  if (!isBookIsbn(isbn)) {
    setStatus("Bitte eine gültige ISBN-10 oder ISBN-13 eines Buches eingeben.", "error");
    return;
  }
  if (lookupInProgress) return;

  lookupInProgress = true;
  els.lookupButton.disabled = true;
  setStatus(`Suche nach ISBN ${isbn} …`);

  try {
    const endpoint =
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}` +
      "&maxResults=5&printType=books";
    const response = await fetch(endpoint);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (!Array.isArray(data.items) || data.items.length === 0) {
      els.isbn.value = isbn;
      els.resultCard.classList.remove("hidden");
      updatePreview();
      setStatus("Kein Treffer. Die ISBN wurde übernommen; ergänze die Felder manuell.", "error");
      return;
    }

    const info = selectBestVolume(data.items, isbn).volumeInfo ?? {};
    const imageLinks = info.imageLinks ?? {};

    els.isbn.value = isbn;
    els.title.value = info.title ?? "";
    els.authors.value = Array.isArray(info.authors) ? info.authors.join("; ") : "";
    els.publisher.value = info.publisher ?? "";
    els.publishedDate.value = info.publishedDate ?? "";
    els.pages.value = info.pageCount ?? "";
    els.language.value = info.language ?? "";
    els.coverUrl.value = String(imageLinks.thumbnail ?? imageLinks.smallThumbnail ?? "")
      .replace(/^http:\/\//i, "https://");

    els.resultCard.classList.remove("hidden");
    updatePreview();
    els.resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
    setStatus(`Treffer für ISBN ${isbn} geladen.`, "success");
  } catch (error) {
    console.error(error);
    els.isbn.value = isbn;
    els.resultCard.classList.remove("hidden");
    updatePreview();
    setStatus(
      "Die Metadatensuche ist fehlgeschlagen. Prüfe die Verbindung oder trage das Buch manuell ein.",
      "error"
    );
  } finally {
    lookupInProgress = false;
    els.lookupButton.disabled = false;
  }
}

function saveSettings() {
  localStorage.setItem("bookScanner.vault", els.vault.value.trim());
  localStorage.setItem("bookScanner.folder", els.folder.value.trim());
}

function loadSettings() {
  els.vault.value = localStorage.getItem("bookScanner.vault") ?? "";
  els.folder.value = localStorage.getItem("bookScanner.folder") ?? "Bücher";
}

function openInObsidian() {
  const book = getFormData();

  if (!book.vault) {
    setStatus("Trage zuerst den exakten Namen deines Obsidian-Vaults ein.", "error");
    els.vault.focus();
    return;
  }
  if (!book.title || !book.isbn) {
    setStatus("Titel und ISBN müssen vorhanden sein.", "error");
    return;
  }

  saveSettings();

  const titlePart = safeFilename(book.title) || "Unbenanntes Buch";
  const authorPart = book.authors[0] ? ` - ${safeFilename(book.authors[0])}` : "";
  const filename = `${book.isbn} - ${titlePart}${authorPart}`;
  const file = book.folder ? `${book.folder}/${filename}` : filename;
  const markdown = buildMarkdown();

  const uri =
    `obsidian://new?vault=${encodeURIComponent(book.vault)}` +
    `&file=${encodeURIComponent(file)}` +
    `&content=${encodeURIComponent(markdown)}`;

  window.location.href = uri;
}

async function copyMarkdown() {
  try {
    await navigator.clipboard.writeText(buildMarkdown());
    setStatus("Markdown wurde in die Zwischenablage kopiert.", "success");
  } catch (error) {
    console.error(error);
    setStatus("Kopieren war nicht möglich. Kopiere den Text aus der Vorschau manuell.", "error");
  }
}

function startScanner() {
  if (typeof Html5QrcodeScanner === "undefined") {
    setStatus("Scanner-Bibliothek nicht geladen. Prüfe die Verbindung und lade neu.", "error");
    return;
  }

  const scanner = new Html5QrcodeScanner(
    "reader",
    {
      fps: 10,
      qrbox: (width, height) => ({
        width: Math.min(Math.floor(width * 0.88), 430),
        height: Math.min(Math.floor(height * 0.34), 150),
      }),
      formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13],
      rememberLastUsedCamera: true,
      showTorchButtonIfSupported: true,
      aspectRatio: 1.777778,
    },
    false
  );

  scanner.render(
    (decodedText) => {
      const isbn = normalizeIsbn(decodedText);
      if (isbn === lastScanned) return;
      lastScanned = isbn;
      window.setTimeout(() => { lastScanned = ""; }, 3500);

      if (!isBookIsbn(isbn)) {
        setStatus(`Barcode ${decodedText} erkannt, aber nicht als ISBN-13 eingeordnet.`, "error");
        return;
      }

      els.manualIsbn.value = isbn;
      lookupBook(isbn);
    },
    () => {}
  );
}

els.lookupButton.addEventListener("click", () => lookupBook(els.manualIsbn.value));
els.manualIsbn.addEventListener("keydown", (event) => {
  if (event.key === "Enter") lookupBook(els.manualIsbn.value);
});
els.obsidianButton.addEventListener("click", openInObsidian);
els.copyButton.addEventListener("click", copyMarkdown);
els.vault.addEventListener("change", saveSettings);
els.folder.addEventListener("change", saveSettings);

for (const input of els.resultCard.querySelectorAll("input, select")) {
  input.addEventListener("input", updatePreview);
  input.addEventListener("change", updatePreview);
}

loadSettings();
updatePreview();
startScanner();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(console.warn);
  });
}
