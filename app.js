const els = {
  vault: document.querySelector("#vault"),
  folder: document.querySelector("#folder"),
  googleApiKey: document.querySelector("#google-api-key"),
  manualIsbn: document.querySelector("#manual-isbn"),
  lookupButton: document.querySelector("#lookup-button"),
  cameraRestartButton: document.querySelector("#camera-restart-button"),
  torchButton: document.querySelector("#torch-button"),
  ocrButton: document.querySelector("#ocr-button"),
  photoInput: document.querySelector("#photo-input"),
  zoomPanel: document.querySelector("#zoom-panel"),
  zoomSlider: document.querySelector("#zoom-slider"),
  zoomValue: document.querySelector("#zoom-value"),
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
  genres: document.querySelector("#genres"),
  subjects: document.querySelector("#subjects"),
  ownership: document.querySelector("#ownership"),
  readingStatus: document.querySelector("#reading-status"),
  batchButton: document.querySelector("#batch-button"),
  obsidianButton: document.querySelector("#obsidian-button"),
  copyButton: document.querySelector("#copy-button"),
  markdownPreview: document.querySelector("#markdown-preview"),
  queueCard: document.querySelector("#queue-card"),
  queueCount: document.querySelector("#queue-count"),
  queueEmpty: document.querySelector("#queue-empty"),
  queueList: document.querySelector("#queue-list"),
  queueActions: document.querySelector("#queue-actions"),
  queueStatus: document.querySelector("#queue-status"),
  exportNextButton: document.querySelector("#export-next-button"),
  zipButton: document.querySelector("#zip-button"),
  resetExportButton: document.querySelector("#reset-export-button"),
  clearQueueButton: document.querySelector("#clear-queue-button"),
  scrollScannerButton: document.querySelector("#scroll-scanner-button"),
};

let lastScanned = "";
let lookupInProgress = false;
let reviewInProgress = false;
let currentMetadataSource = "manual";
let batch = [];
let editingBatchId = null;
let html5QrCode = null;
let offlineQrCode = null;
let ocrWorker = null;
let ocrInProgress = false;
let scannerRunning = false;
let scannerPaused = false;
let scannerStarting = null;
let torchOn = false;
let zoomTimer = null;

const BATCH_STORAGE_KEY = "bookScanner.batch.v6";
const LEGACY_BATCH_STORAGE_KEYS = ["bookScanner.batch.v5", "bookScanner.batch.v4"];

function setStatus(message, kind = "") {
  els.status.textContent = message;
  els.status.className = `status ${kind}`.trim();
}

function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function isbn10CheckDigitValid(isbn10) {
  const compact = String(isbn10 ?? "").toUpperCase();
  if (!/^\d{9}[\dX]$/.test(compact)) return false;
  const sum = [...compact].reduce((total, char, index) => {
    const value = char === "X" ? 10 : Number(char);
    return total + value * (10 - index);
  }, 0);
  return sum % 11 === 0;
}

function isbn13CheckDigitValid(isbn13) {
  const digits = String(isbn13 ?? "");
  if (!/^\d{13}$/.test(digits)) return false;
  const sum = [...digits.slice(0, 12)].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0
  );
  return Number(digits[12]) === (10 - (sum % 10)) % 10;
}

function normalizeIsbn(value) {
  const raw = String(value ?? "").trim();
  const compact = raw.replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{9}[\dX]$/.test(compact)) {
    return isbn10CheckDigitValid(compact) ? isbn10To13(compact) : compact;
  }
  return digitsOnly(compact);
}

function isbn10To13(isbn10) {
  const compact = String(isbn10 ?? "").toUpperCase();
  if (!isbn10CheckDigitValid(compact)) return compact;
  const body = `978${compact.slice(0, 9)}`;
  const sum = [...body].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0
  );
  return `${body}${(10 - (sum % 10)) % 10}`;
}

function isBookIsbn(isbn) {
  return /^\d{13}$/.test(isbn) &&
    (isbn.startsWith("978") || isbn.startsWith("979")) &&
    isbn13CheckDigitValid(isbn);
}

function barcodeFormatName(decodedResult) {
  return String(
    decodedResult?.result?.format?.formatName ??
    decodedResult?.result?.format?.toString?.() ??
    decodedResult?.decodedResult?.format ??
    ""
  );
}

function classifyBarcode(value, decodedResult = null) {
  const raw = String(value ?? "").trim();
  const digits = digitsOnly(raw);
  const format = barcodeFormatName(decodedResult);
  const normalized = normalizeIsbn(raw);

  if (isBookIsbn(normalized)) return { type: "isbn", isbn: normalized, format };
  if (digits.length === 13 && digits.startsWith("0")) {
    return { type: "retail", barcode: digits.slice(1), format: format || "UPC-A" };
  }
  if ([8, 12, 13].includes(digits.length)) {
    return { type: "retail", barcode: digits, format };
  }
  return { type: "unknown", barcode: raw, format };
}

function splitList(value) {
  return String(value ?? "")
    .split(/[;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitAuthors(value) {
  return splitList(value);
}

function uniqueStrings(values) {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = String(value ?? "").trim();
    const key = normalized.toLocaleLowerCase("de");
    if (!normalized || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function appendYamlList(lines, key, values) {
  lines.push(`${key}:`);
  if (values.length) {
    for (const value of values) lines.push(`  - ${yamlString(value)}`);
  } else {
    lines.push("  -");
  }
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
    genres: splitList(els.genres.value),
    subjects: splitList(els.subjects.value),
    ownership: els.ownership.value,
    readingStatus: els.readingStatus.value,
    metadataSource: currentMetadataSource,
    added: todayIso(),
  };
}

function buildMarkdown(book = getFormData()) {
  const lines = ["---", "type: book", `title: ${yamlString(book.title)}`, "authors:"];

  if (book.authors.length) {
    for (const author of book.authors) {
      lines.push(`  - ${yamlString(`[[${author}]]`)}`);
    }
  } else {
    lines.push("  -");
  }

  appendYamlList(lines, "genres", book.genres ?? []);
  appendYamlList(lines, "subjects", book.subjects ?? []);

  lines.push(
    `isbn_13: ${yamlString(book.isbn)}`,
    `publisher: ${yamlString(book.publisher)}`,
    `publication_date: ${yamlString(book.publishedDate)}`,
    `pages: ${book.pages || "null"}`,
    `language: ${yamlString(book.language)}`,
    `cover_url: ${yamlString(book.coverUrl)}`,
    `ownership: ${book.ownership}`,
    `reading_status: ${book.readingStatus}`,
    `added: ${book.added || todayIso()}`,
    `metadata_source: ${book.metadataSource || "manual"}`,
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
  els.markdownPreview.textContent = buildMarkdown(getFormData());
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

async function fetchJson(url, sourceName) {
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch (error) {
    throw new Error(`${sourceName}: Netzwerkfehler (${error.message || "fetch fehlgeschlagen"})`);
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.text();
      detail = body ? ` – ${body.slice(0, 160).replace(/\s+/g, " ")}` : "";
    } catch (_) {
      // Der HTTP-Status reicht für die Diagnose.
    }
    const error = new Error(`${sourceName}: HTTP ${response.status}${detail}`);
    error.status = response.status;
    throw error;
  }

  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${sourceName}: ungültige JSON-Antwort`);
  }
}

function languageCodes(languages) {
  if (!Array.isArray(languages)) return "";
  return languages
    .map((entry) => String(entry?.key ?? entry ?? "").split("/").filter(Boolean).pop())
    .filter(Boolean)
    .join(", ");
}


const GENRE_RULES = [
  ["Horror", /\b(horror|horror tales|horror fiction|ghost stories|supernatural fiction|weird fiction|grusel|schauerroman)\b/i],
  ["Science-Fiction", /\b(science fiction|sci-fi|space opera|cyberpunk|dystopi|time travel fiction|science-fiction)\b/i],
  ["Fantasy", /\b(fantasy|fantastic fiction|epic fantasy|urban fantasy|dark fantasy|high fantasy)\b/i],
  ["Krimi", /\b(mystery fiction|detective stories|detective and mystery|crime fiction|police procedural|murder mysteries|kriminalroman|detektiv)\b/i],
  ["Thriller", /\b(thrillers?|suspense fiction|psychological suspense)\b/i],
  ["Historischer Roman", /\b(historical fiction|historischer roman)\b/i],
  ["Liebesroman", /\b(romance fiction|love stories|romantic fiction|liebesroman)\b/i],
  ["Literarische Fiktion", /\b(literary fiction|literarische fiktion)\b/i],
  ["Jugendbuch", /\b(young adult fiction|young adult literature|jugendbuch|jugendliteratur)\b/i],
  ["Kinderbuch", /\b(children'?s fiction|children'?s stories|juvenile literature|kinderbuch|kinderliteratur)\b/i],
  ["Graphic Novel / Comic", /\b(graphic novels?|comic books?|comics|manga)\b/i],
  ["Lyrik", /\b(poetry|poems|lyrik|gedichte)\b/i],
  ["Drama", /\b(drama|plays|theaterstücke)\b/i],
  ["Biografie", /\b(biography|biographies|biografie|biographien)\b/i],
  ["Memoir / Autobiografie", /\b(memoir|memoirs|autobiography|autobiographies|autobiografie)\b/i],
  ["Essay", /\b(essays?|essayistik)\b/i],
  ["True Crime", /\b(true crime|criminal biography)\b/i],
  ["Geschichte", /\b(history|geschichte|historical studies)\b/i],
  ["Philosophie", /\b(philosophy|philosophie)\b/i],
  ["Psychologie", /\b(psychology|psychologie)\b/i],
  ["Politik", /\b(politics|political science|politik)\b/i],
  ["Reise", /\b(travel|travel writing|reiseberichte|reisen)\b/i],
  ["Wissenschaft", /\b(science|natural history|wissenschaft)\b/i],
];

function inferGenres(subjects) {
  const genres = [];
  for (const [genre, pattern] of GENRE_RULES) {
    if (subjects.some((subject) => pattern.test(subject))) genres.push(genre);
  }
  return genres;
}

function normalizeSubjects(subjects) {
  if (!Array.isArray(subjects)) return [];
  return uniqueStrings(
    subjects
      .map((subject) => typeof subject === "string" ? subject : subject?.name ?? "")
      .map((subject) => subject.trim())
      .filter(Boolean)
  ).slice(0, 40);
}

async function resolveOpenLibraryWork(edition) {
  const workKey = Array.isArray(edition?.works) ? edition.works[0]?.key : "";
  if (!workKey || !String(workKey).startsWith("/works/")) return null;
  try {
    return await fetchJson(`https://openlibrary.org${workKey}.json`, "Open Library Werk");
  } catch (error) {
    console.warn(error);
    return null;
  }
}

async function resolveOpenLibraryAuthors(authors) {
  if (!Array.isArray(authors) || authors.length === 0) return [];

  const names = await Promise.all(
    authors.slice(0, 8).map(async (author) => {
      if (author?.name) return author.name;
      const key = author?.key;
      if (!key || !String(key).startsWith("/authors/")) return "";
      try {
        const data = await fetchJson(`https://openlibrary.org${key}.json`, "Open Library Autor");
        return data.name ?? data.personal_name ?? "";
      } catch (error) {
        console.warn(error);
        return "";
      }
    })
  );

  return names.filter(Boolean);
}

async function lookupOpenLibrary(isbn) {
  const edition = await fetchJson(
    `https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`,
    "Open Library"
  );
  const [authors, work] = await Promise.all([
    resolveOpenLibraryAuthors(edition.authors),
    resolveOpenLibraryWork(edition),
  ]);
  const coverId = Array.isArray(edition.covers) ? edition.covers.find((id) => Number(id) > 0) : null;
  const subjects = normalizeSubjects([
    ...(Array.isArray(edition.subjects) ? edition.subjects : []),
    ...(Array.isArray(work?.subjects) ? work.subjects : []),
  ]);

  return {
    title: edition.title ?? work?.title ?? "",
    authors,
    publisher: Array.isArray(edition.publishers) ? edition.publishers[0] ?? "" : edition.publishers ?? "",
    publishedDate: edition.publish_date ?? work?.first_publish_date ?? "",
    pages: edition.number_of_pages ?? edition.pagination ?? "",
    language: languageCodes(edition.languages),
    coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : "",
    genres: inferGenres(subjects),
    subjects,
    source: "open-library",
  };
}

function selectBestGoogleVolume(items, isbn) {
  return items.find((item) =>
    (item.volumeInfo?.industryIdentifiers ?? [])
      .some((entry) => digitsOnly(entry.identifier) === isbn)
  ) ?? items[0];
}

async function lookupGoogleBooks(isbn, apiKey) {
  const endpoint =
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}` +
    `&maxResults=5&printType=books&key=${encodeURIComponent(apiKey)}`;
  const data = await fetchJson(endpoint, "Google Books");
  if (!Array.isArray(data.items) || data.items.length === 0) return null;

  const info = selectBestGoogleVolume(data.items, isbn).volumeInfo ?? {};
  const imageLinks = info.imageLinks ?? {};
  return {
    title: info.title ?? "",
    authors: Array.isArray(info.authors) ? info.authors : [],
    publisher: info.publisher ?? "",
    publishedDate: info.publishedDate ?? "",
    pages: info.pageCount ?? "",
    language: info.language ?? "",
    coverUrl: String(imageLinks.thumbnail ?? imageLinks.smallThumbnail ?? "")
      .replace(/^http:\/\//i, "https://"),
    genres: Array.isArray(info.categories) ? info.categories : [],
    subjects: [],
    source: "google-books",
  };
}

function applyBookData(isbn, book) {
  els.isbn.value = isbn;
  els.title.value = book?.title ?? "";
  els.authors.value = Array.isArray(book?.authors) ? book.authors.join("; ") : "";
  els.publisher.value = book?.publisher ?? "";
  els.publishedDate.value = book?.publishedDate ?? "";
  els.pages.value = digitsOnly(book?.pages ?? "");
  els.language.value = book?.language ?? "";
  els.coverUrl.value = book?.coverUrl ?? "";
  els.genres.value = Array.isArray(book?.genres) ? book.genres.join("; ") : "";
  els.subjects.value = Array.isArray(book?.subjects) ? book.subjects.join("; ") : "";
  currentMetadataSource = book?.source ?? "manual";
  reviewInProgress = true;
  els.resultCard.classList.remove("hidden");
  updatePreview();
}

async function lookupBook(rawIsbn) {
  const isbn = normalizeIsbn(rawIsbn);

  if (!isBookIsbn(isbn)) {
    setStatus("Bitte eine gültige ISBN-10 oder ISBN-13 eines Buches eingeben.", "error");
    return;
  }
  const duplicate = batch.find((book) => book.isbn === isbn && book.id !== editingBatchId);
  if (duplicate) {
    setStatus(`ISBN ${isbn} befindet sich bereits im Stapel.`, "error");
    renderBatch();
    els.queueCard.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (lookupInProgress) return;

  lookupInProgress = true;
  els.lookupButton.disabled = true;
  setStatus(`Suche ISBN ${isbn} zuerst bei Open Library …`);

  const errors = [];

  try {
    try {
      const openLibraryBook = await lookupOpenLibrary(isbn);
      applyBookData(isbn, openLibraryBook);
      els.resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
      setStatus(`Treffer für ISBN ${isbn} über Open Library geladen.`, "success");
      return;
    } catch (error) {
      errors.push(error.message);
      console.warn(error);
    }

    const apiKey = els.googleApiKey.value.trim();
    if (apiKey) {
      setStatus("Open Library hatte keinen nutzbaren Treffer. Versuche Google Books …");
      try {
        const googleBook = await lookupGoogleBooks(isbn, apiKey);
        if (googleBook) {
          applyBookData(isbn, googleBook);
          els.resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
          setStatus(`Treffer für ISBN ${isbn} über Google Books geladen.`, "success");
          return;
        }
        errors.push("Google Books: kein Treffer");
      } catch (error) {
        errors.push(error.message);
        console.warn(error);
      }
    } else {
      errors.push("Google Books nicht versucht: kein API-Key hinterlegt");
    }

    applyBookData(isbn, null);
    els.resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
    setStatus(`Keine Metadaten geladen. ${errors.join(" | ")}`, "error");
  } finally {
    lookupInProgress = false;
    els.lookupButton.disabled = false;
  }
}

function saveSettings() {
  localStorage.setItem("bookScanner.vault", els.vault.value.trim());
  localStorage.setItem("bookScanner.folder", els.folder.value.trim());
  localStorage.setItem("bookScanner.googleApiKey", els.googleApiKey.value.trim());
}

function loadSettings() {
  els.vault.value = localStorage.getItem("bookScanner.vault") ?? "";
  els.folder.value = localStorage.getItem("bookScanner.folder") ?? "Bücher";
  els.googleApiKey.value = localStorage.getItem("bookScanner.googleApiKey") ?? "";
}

function createId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadBatch() {
  try {
    let raw = localStorage.getItem(BATCH_STORAGE_KEY);
    if (!raw) {
      for (const legacyKey of LEGACY_BATCH_STORAGE_KEYS) {
        raw = localStorage.getItem(legacyKey);
        if (raw) break;
      }
    }
    const stored = JSON.parse(raw ?? "[]");
    batch = Array.isArray(stored) ? stored : [];
    if (batch.length) saveBatch();
  } catch (error) {
    console.warn("Stapel konnte nicht geladen werden:", error);
    batch = [];
  }
}

function saveBatch() {
  localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify(batch));
}

function setQueueStatus(message, kind = "") {
  els.queueStatus.textContent = message;
  els.queueStatus.className = `status ${kind}`.trim();
}

function bookFilename(book) {
  const titlePart = safeFilename(book.title) || "Unbenanntes Buch";
  const authorPart = book.authors?.[0] ? ` - ${safeFilename(book.authors[0])}` : "";
  return `${book.isbn} - ${titlePart}${authorPart}.md`;
}

function bookVaultPath(book) {
  const folder = els.folder.value.trim().replace(/^\/+|\/+$/g, "");
  const filename = bookFilename(book).replace(/\.md$/i, "");
  return folder ? `${folder}/${filename}` : filename;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderBatch() {
  els.queueCount.textContent = String(batch.length);
  els.queueEmpty.classList.toggle("hidden", batch.length > 0);
  els.queueActions.classList.toggle("hidden", batch.length === 0);

  const pending = batch.filter((book) => !book.exported).length;
  els.exportNextButton.textContent = pending
    ? `Nächstes in Obsidian exportieren (${pending} offen)`
    : "Alle als exportiert markiert";
  els.exportNextButton.disabled = pending === 0;

  els.queueList.innerHTML = batch.map((book, index) => {
    const author = book.authors?.join(", ") || "Autor unbekannt";
    const cover = book.coverUrl
      ? `<img src="${escapeHtml(book.coverUrl)}" alt="" loading="lazy">`
      : `<div class="queue-cover-placeholder" aria-hidden="true">${index + 1}</div>`;
    const badge = book.exported
      ? '<span class="status-badge exported">exportiert</span>'
      : '<span class="status-badge pending">offen</span>';
    return `
      <article class="queue-item" data-id="${escapeHtml(book.id)}">
        ${cover}
        <div class="queue-item-main">
          <div class="queue-title-row">
            <strong>${escapeHtml(book.title || "Unbenanntes Buch")}</strong>
            ${badge}
          </div>
          <p>${escapeHtml(author)}</p>
          <small>${escapeHtml(book.isbn)}${book.genres?.length ? ` · ${escapeHtml(book.genres.join(", "))}` : ""}</small>
        </div>
        <div class="queue-item-actions">
          <button type="button" data-action="edit">Bearbeiten</button>
          <button type="button" data-action="toggle-export">${book.exported ? "Erneut" : "Als erledigt"}</button>
          <button type="button" data-action="delete" class="danger">Löschen</button>
        </div>
      </article>`;
  }).join("");
}

function resetFormForNextScan() {
  editingBatchId = null;
  currentMetadataSource = "manual";
  els.manualIsbn.value = "";
  els.isbn.value = "";
  els.title.value = "";
  els.authors.value = "";
  els.publisher.value = "";
  els.publishedDate.value = "";
  els.pages.value = "";
  els.language.value = "";
  els.coverUrl.value = "";
  els.genres.value = "";
  els.subjects.value = "";
  els.coverPreview.removeAttribute("src");
  els.coverPreview.hidden = true;
  els.resultCard.classList.add("hidden");
  els.batchButton.textContent = "Zum Stapel hinzufügen & weiter";
  reviewInProgress = false;
  updatePreview();
  ensureScannerReady();
}

function addCurrentBookToBatch() {
  const book = getFormData();
  if (!book.title || !isBookIsbn(book.isbn)) {
    setStatus("Titel und gültige ISBN müssen vorhanden sein.", "error");
    return;
  }

  const duplicate = batch.find((entry) => entry.isbn === book.isbn && entry.id !== editingBatchId);
  if (duplicate) {
    setStatus(`ISBN ${book.isbn} befindet sich bereits im Stapel.`, "error");
    return;
  }

  if (editingBatchId) {
    const index = batch.findIndex((entry) => entry.id === editingBatchId);
    if (index >= 0) {
      batch[index] = { ...batch[index], ...book, id: editingBatchId };
      setQueueStatus(`„${book.title}“ wurde aktualisiert.`, "success");
    }
  } else {
    batch.push({ ...book, id: createId(), exported: false, queuedAt: new Date().toISOString() });
    setQueueStatus(`„${book.title}“ wurde zum Stapel hinzugefügt.`, "success");
  }

  saveBatch();
  renderBatch();
  resetFormForNextScan();
  setStatus(`${batch.length} Buch${batch.length === 1 ? "" : "er"} im Stapel. Bereit für den nächsten Scan.`, "success");
  document.querySelector("#reader").scrollIntoView({ behavior: "smooth", block: "start" });
}

function editBatchBook(id) {
  const book = batch.find((entry) => entry.id === id);
  if (!book) return;
  editingBatchId = id;
  currentMetadataSource = book.metadataSource || "manual";
  applyBookData(book.isbn, {
    title: book.title,
    authors: book.authors,
    publisher: book.publisher,
    publishedDate: book.publishedDate,
    pages: book.pages,
    language: book.language,
    coverUrl: book.coverUrl,
    genres: book.genres,
    subjects: book.subjects,
    source: book.metadataSource,
  });
  els.ownership.value = book.ownership || "owned";
  els.readingStatus.value = book.readingStatus || "unread";
  els.batchButton.textContent = "Änderungen speichern & weiter";
  updatePreview();
  els.resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function removeBatchBook(id) {
  const book = batch.find((entry) => entry.id === id);
  batch = batch.filter((entry) => entry.id !== id);
  saveBatch();
  renderBatch();
  setQueueStatus(book ? `„${book.title}“ wurde entfernt.` : "Eintrag wurde entfernt.");
}

function toggleExportStatus(id) {
  const book = batch.find((entry) => entry.id === id);
  if (!book) return;
  book.exported = !book.exported;
  saveBatch();
  renderBatch();
}

function buildObsidianUri(book) {
  const vault = els.vault.value.trim();
  if (!vault) throw new Error("Trage zuerst den exakten Namen deines Obsidian-Vaults ein.");
  const file = bookVaultPath(book);
  return `obsidian://new?vault=${encodeURIComponent(vault)}` +
    `&file=${encodeURIComponent(file)}` +
    `&content=${encodeURIComponent(buildMarkdown(book))}`;
}

function openBookInObsidian(book, markExported = false) {
  saveSettings();
  let uri;
  try {
    uri = buildObsidianUri(book);
  } catch (error) {
    setStatus(error.message, "error");
    els.vault.focus();
    return;
  }

  if (markExported) {
    book.exported = true;
    book.exportedAt = new Date().toISOString();
    saveBatch();
    renderBatch();
    setQueueStatus(`„${book.title}“ wird an Obsidian übergeben. Kehre danach für das nächste Buch zurück.`, "success");
  }
  window.location.href = uri;
}

function exportNextBook() {
  const next = batch.find((book) => !book.exported);
  if (!next) {
    setQueueStatus("Alle Bücher sind als exportiert markiert.", "success");
    return;
  }
  openBookInObsidian(next, true);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function makeZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const now = dosDateTime();

  const u16 = (view, pos, value) => view.setUint16(pos, value, true);
  const u32 = (view, pos, value) => view.setUint32(pos, value >>> 0, true);

  for (const file of files) {
    const name = encoder.encode(file.name.replace(/\\/g, "/"));
    const content = encoder.encode(file.content);
    const crc = crc32(content);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50);
    u16(lv, 4, 20);
    u16(lv, 6, 0x0800);
    u16(lv, 8, 0);
    u16(lv, 10, now.time);
    u16(lv, 12, now.date);
    u32(lv, 14, crc);
    u32(lv, 18, content.length);
    u32(lv, 22, content.length);
    u16(lv, 26, name.length);
    u16(lv, 28, 0);
    local.set(name, 30);
    localParts.push(local, content);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    u32(cv, 0, 0x02014b50);
    u16(cv, 4, 20);
    u16(cv, 6, 20);
    u16(cv, 8, 0x0800);
    u16(cv, 10, 0);
    u16(cv, 12, now.time);
    u16(cv, 14, now.date);
    u32(cv, 16, crc);
    u32(cv, 20, content.length);
    u32(cv, 24, content.length);
    u16(cv, 28, name.length);
    u16(cv, 30, 0);
    u16(cv, 32, 0);
    u16(cv, 34, 0);
    u16(cv, 36, 0);
    u32(cv, 38, 0);
    u32(cv, 42, offset);
    central.set(name, 46);
    centralParts.push(central);

    offset += local.length + content.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 4, 0);
  u16(ev, 6, 0);
  u16(ev, 8, files.length);
  u16(ev, 10, files.length);
  u32(ev, 12, centralSize);
  u32(ev, 16, offset);
  u16(ev, 20, 0);

  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}

function downloadBatchZip() {
  if (!batch.length) return;
  const folder = els.folder.value.trim().replace(/^\/+|\/+$/g, "");
  const files = batch.map((book) => ({
    name: `${folder ? `${folder}/` : ""}${bookFilename(book)}`,
    content: buildMarkdown(book),
  }));
  const blob = makeZip(files);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `obsidian-buecher-${todayIso()}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  setQueueStatus(`${batch.length} Markdown-Datei${batch.length === 1 ? "" : "en"} wurden als ZIP erstellt.`, "success");
}

function resetExportStatus() {
  for (const book of batch) {
    book.exported = false;
    delete book.exportedAt;
  }
  saveBatch();
  renderBatch();
  setQueueStatus("Der Exportstatus wurde für den gesamten Stapel zurückgesetzt.");
}

function clearBatch() {
  if (!batch.length) return;
  const confirmed = window.confirm(`Wirklich alle ${batch.length} Bücher aus dem Stapel entfernen?`);
  if (!confirmed) return;
  batch = [];
  editingBatchId = null;
  saveBatch();
  renderBatch();
  resetFormForNextScan();
  setQueueStatus("Der Stapel wurde geleert.");
}

function openInObsidian() {
  const book = getFormData();
  if (!book.title || !isBookIsbn(book.isbn)) {
    setStatus("Titel und gültige ISBN müssen vorhanden sein.", "error");
    return;
  }
  openBookInObsidian(book, false);
}

async function copyMarkdown() {
  try {
    await navigator.clipboard.writeText(buildMarkdown(getFormData()));
    setStatus("Markdown wurde in die Zwischenablage kopiert.", "success");
  } catch (error) {
    console.error(error);
    setStatus("Kopieren war nicht möglich. Kopiere den Text aus der Vorschau manuell.", "error");
  }
}

function scannerAvailable() {
  return typeof Html5Qrcode !== "undefined";
}

function supportedBarcodeFormats() {
  return [
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E,
    Html5QrcodeSupportedFormats.EAN_8,
  ];
}

function createScannerIfNeeded() {
  if (!scannerAvailable()) return;
  if (!html5QrCode) {
    html5QrCode = new Html5Qrcode("reader", {
      formatsToSupport: supportedBarcodeFormats(),
      useBarCodeDetectorIfSupported: true,
      verbose: false,
    });
  }
  if (!offlineQrCode) {
    offlineQrCode = new Html5Qrcode("offline-reader", {
      formatsToSupport: supportedBarcodeFormats(),
      useBarCodeDetectorIfSupported: true,
      verbose: false,
    });
  }
}

function formatZoom(value) {
  return `${Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}×`;
}

async function applyCameraEnhancements() {
  if (!scannerRunning || !html5QrCode) return;

  let capabilities = {};
  let settings = {};
  try {
    capabilities = html5QrCode.getRunningTrackCapabilities() ?? {};
    settings = html5QrCode.getRunningTrackSettings() ?? {};
  } catch (error) {
    console.warn("Kamerafähigkeiten nicht verfügbar:", error);
  }

  if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes("continuous")) {
    try {
      await html5QrCode.applyVideoConstraints({
        advanced: [{ focusMode: "continuous" }],
      });
    } catch (error) {
      console.warn("Kontinuierlicher Autofokus konnte nicht gesetzt werden:", error);
    }
  }

  if (capabilities.zoom && Number.isFinite(capabilities.zoom.min) && Number.isFinite(capabilities.zoom.max)) {
    const min = Number(capabilities.zoom.min);
    const max = Number(capabilities.zoom.max);
    const step = Number(capabilities.zoom.step) || 0.1;
    const current = Math.min(max, Math.max(min, Number(settings.zoom) || min));
    els.zoomSlider.min = String(min);
    els.zoomSlider.max = String(max);
    els.zoomSlider.step = String(step);
    els.zoomSlider.value = String(current);
    els.zoomValue.textContent = formatZoom(current);
    els.zoomPanel.classList.remove("hidden");
  } else {
    els.zoomPanel.classList.add("hidden");
  }

  if (capabilities.torch === true) {
    els.torchButton.classList.remove("hidden");
  } else {
    els.torchButton.classList.add("hidden");
  }

  const width = settings.width ? `${settings.width}×${settings.height ?? "?"}` : "";
  setStatus(`Kamera aktiv${width ? ` (${width})` : ""}. Barcode vollständig in den breiten Rahmen halten.`, "success");
}

function loadScriptOnce(src, globalName) {
  if (globalThis[globalName]) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-loader="${globalName}"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.loader = globalName;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`${globalName} konnte nicht geladen werden.`));
    document.head.appendChild(script);
  });
}

async function getOcrWorker() {
  if (ocrWorker) return ocrWorker;
  await loadScriptOnce("https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js", "Tesseract");
  ocrWorker = await Tesseract.createWorker("eng", undefined, {
    logger: (message) => {
      if (!ocrInProgress || message.status !== "recognizing text") return;
      const percent = Math.round((message.progress || 0) * 100);
      setStatus(`Gedruckte ISBN wird gelesen … ${percent}%`);
    },
  });
  await ocrWorker.setParameters({
    tessedit_char_whitelist: "ISBNisbn0123456789Xx-: ",
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: "6",
  });
  return ocrWorker;
}

function normalizeOcrCandidate(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[—–−]/g, "-")
    .replace(/O/g, "0")
    .replace(/[IL|]/g, "1")
    .replace(/[^0-9X]/g, "");
}

function extractIsbnFromText(text) {
  const cleaned = String(text ?? "").replace(/[—–−]/g, "-");
  const candidates = [];
  const isbnRegex = /ISBN(?:-1[03])?\s*[:#]?\s*([0-9OILXx|][0-9OILXx|\s-]{8,28})/gi;
  for (const match of cleaned.matchAll(isbnRegex)) candidates.push(match[1]);
  for (const match of cleaned.matchAll(/(?:^|\D)([0-9OILXx|][0-9OILXx|\s-]{8,22}[0-9Xx])(?:\D|$)/g)) {
    candidates.push(match[1]);
  }

  for (const candidate of candidates) {
    const compact = normalizeOcrCandidate(candidate);
    if (/^\d{9}[\dX]$/.test(compact) && isbn10CheckDigitValid(compact)) return isbn10To13(compact);
    if (/^\d{13}$/.test(compact) && isBookIsbn(compact)) return compact;
  }
  return "";
}

function currentVideoFrame() {
  const video = document.querySelector("#reader video");
  if (!video || !video.videoWidth || !video.videoHeight) return null;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(video, 0, 0);
  return canvas;
}

async function imageSourceToCanvas(source) {
  if (source instanceof HTMLCanvasElement) return source;
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return canvas;
}

function makeCanvasVariant(source, spec = {}, contrast = false) {
  const sx = Math.round((spec.x ?? 0) * source.width);
  const sy = Math.round((spec.y ?? 0) * source.height);
  const sw = Math.round((spec.w ?? 1) * source.width);
  const sh = Math.round((spec.h ?? 1) * source.height);
  const scale = Math.min(2.2, Math.max(1, 1500 / Math.max(sw, 1)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  if (contrast) {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const adjusted = Math.max(0, Math.min(255, (gray - 128) * 1.65 + 128));
      data[i] = data[i + 1] = data[i + 2] = adjusted;
    }
    ctx.putImageData(image, 0, 0);
  }
  return canvas;
}

function canvasToFile(canvas, name) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("Bildvariante konnte nicht erzeugt werden."));
      else resolve(new File([blob], name, { type: "image/png" }));
    }, "image/png");
  });
}

async function scanCanvasVariants(sourceCanvas) {
  createScannerIfNeeded();
  const variants = [
    [{ x: 0, y: 0, w: 1, h: 1 }, false],
    [{ x: 0, y: 0.18, w: 1, h: 0.58 }, false],
    [{ x: 0, y: 0, w: 1, h: 0.52 }, false],
    [{ x: 0, y: 0.48, w: 1, h: 0.52 }, false],
    [{ x: 0.03, y: 0.12, w: 0.94, h: 0.76 }, true],
    [{ x: 0, y: 0.18, w: 1, h: 0.58 }, true],
  ];

  for (let index = 0; index < variants.length; index += 1) {
    const [spec, contrast] = variants[index];
    setStatus(`Barcode wird geprüft … Durchlauf ${index + 1}/${variants.length}`);
    const canvas = makeCanvasVariant(sourceCanvas, spec, contrast);
    const file = await canvasToFile(canvas, `scan-${index}.png`);
    try {
      const result = await offlineQrCode.scanFileV2(file, false);
      return { decodedText: result?.decodedText ?? result, decodedResult: result };
    } catch (_) {
      // Nächsten Ausschnitt versuchen.
    }
  }
  return null;
}

async function recognizeIsbnFromImage(source) {
  if (!source || ocrInProgress) return "";
  ocrInProgress = true;
  els.ocrButton.disabled = true;
  els.ocrButton.classList.add("busy");
  try {
    setStatus("OCR wird geladen; beim ersten Mal kann das etwas dauern …");
    const worker = await getOcrWorker();
    const canvas = source instanceof HTMLCanvasElement ? source : await imageSourceToCanvas(source);
    const ocrCanvas = makeCanvasVariant(canvas, { x: 0, y: 0, w: 1, h: 1 }, true);
    const result = await worker.recognize(ocrCanvas);
    return extractIsbnFromText(result?.data?.text ?? "");
  } catch (error) {
    console.warn("OCR fehlgeschlagen:", error);
    setStatus(`ISBN-Texterkennung fehlgeschlagen: ${error.message || error}`, "error");
    return "";
  } finally {
    ocrInProgress = false;
    els.ocrButton.disabled = false;
    els.ocrButton.classList.remove("busy");
  }
}

async function lookupRecognizedIsbn(isbn, sourceLabel = "Texterkennung") {
  if (!isBookIsbn(isbn)) return false;
  if (navigator.vibrate) navigator.vibrate([40, 35, 40]);
  els.manualIsbn.value = isbn;
  setStatus(`${sourceLabel}: ISBN ${isbn} erkannt. Metadaten werden geladen …`, "success");
  await lookupBook(isbn);
  return true;
}

async function scanPrintedIsbnFromCamera() {
  if (ocrInProgress || lookupInProgress || reviewInProgress) return;
  let frame = currentVideoFrame();
  if (!frame) {
    setStatus("Kein Kamerabild verfügbar. Nutze stattdessen „Foto scannen“.", "error");
    return;
  }
  try {
    if (scannerRunning && !scannerPaused) {
      html5QrCode.pause(true);
      scannerPaused = true;
    }
  } catch (_) {}
  const isbn = await recognizeIsbnFromImage(frame);
  if (isbn) await lookupRecognizedIsbn(isbn);
  else {
    setStatus("Keine gültige gedruckte ISBN erkannt. Halte ISBN-Zeile und Barcode näher ins Bild oder nutze die manuelle Eingabe.", "error");
    resumeScanner();
  }
}

async function handleDecodedBarcode(decodedText, decodedResult = null, sourceImage = null) {
  if (reviewInProgress || lookupInProgress || ocrInProgress) return;

  const classification = classifyBarcode(decodedText, decodedResult);
  const dedupeKey = `${classification.type}:${classification.isbn || classification.barcode}`;
  if (dedupeKey === lastScanned) return;
  lastScanned = dedupeKey;
  window.setTimeout(() => { lastScanned = ""; }, 3000);

  if (classification.type === "isbn") {
    try {
      if (scannerRunning && !scannerPaused) {
        html5QrCode.pause(true);
        scannerPaused = true;
      }
    } catch (_) {}
    if (navigator.vibrate) navigator.vibrate(45);
    els.manualIsbn.value = classification.isbn;
    await lookupBook(classification.isbn);
    if (!reviewInProgress) resumeScanner();
    return;
  }

  if (classification.type === "retail") {
    try {
      if (scannerRunning && !scannerPaused) {
        html5QrCode.pause(true);
        scannerPaused = true;
      }
    } catch (_) {}
    setStatus(`Handelsbarcode ${classification.barcode} erkannt, aber keine ISBN. Die aufgedruckte ISBN wird gelesen …`);
    const image = sourceImage || currentVideoFrame();
    const isbn = image ? await recognizeIsbnFromImage(image) : "";
    if (isbn) {
      await lookupRecognizedIsbn(isbn, "ISBN-Text");
    } else {
      setStatus(`Handelsbarcode ${classification.barcode} erkannt. Keine gedruckte ISBN gefunden; nutze „ISBN-Text lesen“, „Foto scannen“ oder die manuelle Eingabe.`, "error");
      resumeScanner();
    }
    return;
  }

  setStatus(`Barcode ${decodedText} erkannt, aber nicht als ISBN oder unterstützter Handelsbarcode eingeordnet.`, "error");
}

async function startScanner() {
  if (!scannerAvailable()) {
    setStatus("Scanner-Bibliothek nicht geladen. Prüfe die Verbindung und lade neu.", "error");
    return;
  }
  if (scannerRunning) return;
  if (scannerStarting) return scannerStarting;

  createScannerIfNeeded();
  scannerStarting = (async () => {
    setStatus("Rückkamera und Autofokus werden vorbereitet …");
    const enhancedConfig = {
      fps: 15,
      disableFlip: true,
      qrbox: (viewWidth, viewHeight) => ({
        width: Math.max(260, Math.floor(viewWidth * 0.92)),
        height: Math.max(105, Math.min(Math.floor(viewHeight * 0.42), 220)),
      }),
      aspectRatio: 16 / 9,
      videoConstraints: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
    };

    try {
      await html5QrCode.start(
        { facingMode: "environment" },
        enhancedConfig,
        (decodedText, decodedResult) => { handleDecodedBarcode(decodedText, decodedResult); },
        () => {}
      );
    } catch (enhancedError) {
      console.warn("Erweiterte Kameraeinstellungen fehlgeschlagen, versuche Standardmodus:", enhancedError);
      try {
        await html5QrCode.start(
          { facingMode: "environment" },
          {
            fps: 12,
            disableFlip: true,
            qrbox: (viewWidth, viewHeight) => ({
              width: Math.max(260, Math.floor(viewWidth * 0.92)),
              height: Math.max(105, Math.min(Math.floor(viewHeight * 0.42), 220)),
            }),
          },
          (decodedText, decodedResult) => { handleDecodedBarcode(decodedText, decodedResult); },
          () => {}
        );
      } catch (fallbackError) {
        console.error(fallbackError);
        setStatus(`Kamera konnte nicht gestartet werden: ${fallbackError}`, "error");
        return;
      }
    }

    scannerRunning = true;
    scannerPaused = false;
    torchOn = false;
    els.torchButton.textContent = "Licht einschalten";
    await applyCameraEnhancements();
  })();

  try {
    await scannerStarting;
  } finally {
    scannerStarting = null;
  }
}

async function stopScanner() {
  if (!html5QrCode || !scannerRunning) return;
  try {
    await html5QrCode.stop();
  } catch (error) {
    console.warn("Scanner konnte nicht sauber gestoppt werden:", error);
  } finally {
    scannerRunning = false;
    scannerPaused = false;
    torchOn = false;
  }
}

function resumeScanner() {
  if (reviewInProgress || lookupInProgress) return;
  if (scannerRunning && scannerPaused) {
    try {
      html5QrCode.resume();
      scannerPaused = false;
      setStatus("Bereit für den nächsten Scan.", "success");
      return;
    } catch (error) {
      console.warn("Scanner konnte nicht fortgesetzt werden:", error);
    }
  }
  if (!scannerRunning) startScanner();
}

function ensureScannerReady() {
  window.setTimeout(() => resumeScanner(), 80);
}

async function restartScanner() {
  els.cameraRestartButton.disabled = true;
  setStatus("Kamera wird neu gestartet und fokussiert …");
  await stopScanner();
  try {
    if (html5QrCode) html5QrCode.clear();
  } catch (error) {
    console.warn(error);
  }
  html5QrCode = null;
  await startScanner();
  els.cameraRestartButton.disabled = false;
}

async function toggleTorch() {
  if (!scannerRunning || !html5QrCode) return;
  const next = !torchOn;
  try {
    await html5QrCode.applyVideoConstraints({ advanced: [{ torch: next }] });
    torchOn = next;
    els.torchButton.textContent = torchOn ? "Licht ausschalten" : "Licht einschalten";
  } catch (error) {
    console.warn(error);
    setStatus("Das Kameralicht lässt sich in diesem Browser nicht steuern.", "error");
  }
}

async function applyZoom(value) {
  if (!scannerRunning || !html5QrCode) return;
  const zoom = Number(value);
  els.zoomValue.textContent = formatZoom(zoom);
  try {
    await html5QrCode.applyVideoConstraints({ advanced: [{ zoom }] });
  } catch (error) {
    console.warn("Zoom konnte nicht gesetzt werden:", error);
  }
}

async function scanPhoto(file) {
  if (!file || !scannerAvailable()) return;
  els.photoInput.disabled = true;
  setStatus("Foto wird in mehreren Ausschnitten ausgewertet …");

  await stopScanner();
  createScannerIfNeeded();

  try {
    const sourceCanvas = await imageSourceToCanvas(file);
    const decoded = await scanCanvasVariants(sourceCanvas);
    if (decoded) {
      const classification = classifyBarcode(decoded.decodedText, decoded.decodedResult);
      if (classification.type === "isbn") {
        await handleDecodedBarcode(decoded.decodedText, decoded.decodedResult, sourceCanvas);
        return;
      }
      if (classification.type === "retail") {
        setStatus(`Handelsbarcode ${classification.barcode} erkannt. Suche gedruckte ISBN im Foto …`);
      }
    }

    const isbn = await recognizeIsbnFromImage(sourceCanvas);
    if (isbn) {
      await lookupRecognizedIsbn(isbn, "Foto-OCR");
      return;
    }

    setStatus("Weder ISBN-Barcode noch gültige gedruckte ISBN erkannt. Fotografiere Barcode und ISBN-Zeile möglichst nah, frontal und scharf.", "error");
  } catch (error) {
    console.warn(error);
    setStatus(`Foto konnte nicht ausgewertet werden: ${error.message || error}`, "error");
  } finally {
    els.photoInput.value = "";
    els.photoInput.disabled = false;
    if (!reviewInProgress) {
      try { await startScanner(); } catch (_) {}
    }
  }
}

els.lookupButton.addEventListener("click", () => lookupBook(els.manualIsbn.value));
els.cameraRestartButton.addEventListener("click", restartScanner);
els.torchButton.addEventListener("click", toggleTorch);
els.ocrButton.addEventListener("click", scanPrintedIsbnFromCamera);
els.photoInput.addEventListener("change", () => scanPhoto(els.photoInput.files?.[0]));
els.zoomSlider.addEventListener("input", () => {
  els.zoomValue.textContent = formatZoom(els.zoomSlider.value);
  window.clearTimeout(zoomTimer);
  zoomTimer = window.setTimeout(() => applyZoom(els.zoomSlider.value), 80);
});
els.manualIsbn.addEventListener("keydown", (event) => {
  if (event.key === "Enter") lookupBook(els.manualIsbn.value);
});
els.batchButton.addEventListener("click", addCurrentBookToBatch);
els.obsidianButton.addEventListener("click", openInObsidian);
els.copyButton.addEventListener("click", copyMarkdown);
els.exportNextButton.addEventListener("click", exportNextBook);
els.zipButton.addEventListener("click", downloadBatchZip);
els.resetExportButton.addEventListener("click", resetExportStatus);
els.clearQueueButton.addEventListener("click", clearBatch);
els.scrollScannerButton.addEventListener("click", () => {
  resetFormForNextScan();
  document.querySelector("#reader").scrollIntoView({ behavior: "smooth", block: "start" });
});
els.queueList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  const item = event.target.closest(".queue-item");
  if (!button || !item) return;
  const id = item.dataset.id;
  if (button.dataset.action === "edit") editBatchBook(id);
  if (button.dataset.action === "toggle-export") toggleExportStatus(id);
  if (button.dataset.action === "delete") removeBatchBook(id);
});
els.vault.addEventListener("change", saveSettings);
els.folder.addEventListener("change", saveSettings);
els.googleApiKey.addEventListener("change", saveSettings);

for (const input of els.resultCard.querySelectorAll("input, select, textarea")) {
  input.addEventListener("input", updatePreview);
  input.addEventListener("change", updatePreview);
}

loadSettings();
loadBatch();
renderBatch();
updatePreview();
startScanner();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(console.warn);
  });
}
