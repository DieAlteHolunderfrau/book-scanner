const els = {
  vault: document.querySelector("#vault"),
  folder: document.querySelector("#folder"),
  googleApiKey: document.querySelector("#google-api-key"),
  manualIsbn: document.querySelector("#manual-isbn"),
  lookupButton: document.querySelector("#lookup-button"),
  cameraVideo: document.querySelector("#camera-video"),
  autoScanState: document.querySelector("#auto-scan-state"),
  recognitionButton: document.querySelector("#recognition-button"),
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
  firstPublicationYear: document.querySelector("#first-publication-year"),
  language: document.querySelector("#language"),
  openLibraryWorkId: document.querySelector("#openlibrary-work-id"),
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
let mediaStream = null;
let videoTrack = null;
let imageCapture = null;
let nativeBarcodeDetector = null;
let nativeBarcodeDetectorPromise = null;
let ocrWorker = null;
let ocrInProgress = false;
let scannerRunning = false;
let scannerStarting = null;
let recognitionRunning = false;
let recognitionRunId = 0;
let torchOn = false;
let zoomTimer = null;

const RECOGNITION_ATTEMPTS = 5;
const RECOGNITION_INTERVAL_MS = 1000;
const BATCH_STORAGE_KEY = "bookScanner.batch.v12";
const LEGACY_BATCH_STORAGE_KEYS = [
  "bookScanner.batch.v11",
  "bookScanner.batch.v10",
  "bookScanner.batch.v9",
  "bookScanner.batch.v8",
  "bookScanner.batch.v7",
  "bookScanner.batch.v6",
  "bookScanner.batch.v5",
  "bookScanner.batch.v4",
];

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
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

function isbn10To13(isbn10) {
  const compact = normalizeIsbn(isbn10);
  if (!isbn10CheckDigitValid(compact)) return "";
  const body = `978${compact.slice(0, 9)}`;
  const sum = [...body].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0
  );
  return `${body}${(10 - (sum % 10)) % 10}`;
}

function isbn13To10(isbn13) {
  const compact = normalizeIsbn(isbn13);
  if (!isbn13CheckDigitValid(compact) || !compact.startsWith("978")) return "";
  const body = compact.slice(3, 12);
  const sum = [...body].reduce(
    (total, digit, index) => total + Number(digit) * (10 - index),
    0
  );
  const checkValue = (11 - (sum % 11)) % 11;
  const checkDigit = checkValue === 10 ? "X" : String(checkValue);
  return `${body}${checkDigit}`;
}

function isBookIsbn(isbn) {
  const compact = normalizeIsbn(isbn);
  if (isbn10CheckDigitValid(compact)) return true;
  return /^\d{13}$/.test(compact) &&
    (compact.startsWith("978") || compact.startsWith("979")) &&
    isbn13CheckDigitValid(compact);
}

function isbnForms(value) {
  const primary = normalizeIsbn(value);
  let isbn10 = "";
  let isbn13 = "";

  if (isbn10CheckDigitValid(primary)) {
    isbn10 = primary;
    isbn13 = isbn10To13(primary);
  } else if (/^\d{13}$/.test(primary) && isbn13CheckDigitValid(primary)) {
    isbn13 = primary;
    isbn10 = isbn13To10(primary);
  }

  const candidates = [...new Set([primary, isbn10, isbn13].filter(Boolean))];
  return { primary, isbn10, isbn13, candidates };
}

function isbnEquivalent(left, right) {
  const leftForms = isbnForms(left).candidates;
  const rightSet = new Set(isbnForms(right).candidates);
  return leftForms.some((candidate) => rightSet.has(candidate));
}

function barcodeFormatName(decodedResult) {
  return String(
    decodedResult?.format ??
    decodedResult?.result?.format?.formatName ??
    decodedResult?.result?.format?.toString?.() ??
    decodedResult?.decodedResult?.format ??
    decodedResult?.codeResult?.format ??
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

function normalizePublicationYear(value) {
  const match = String(value ?? "").match(/\b(\d{3,4})\b/);
  if (!match) return "";
  const year = Number(match[1]);
  const currentYear = new Date().getFullYear();
  return year >= 100 && year <= currentYear ? String(year) : "";
}

function normalizeWorkId(value) {
  const match = String(value ?? "").match(/(OL\d+W)/i);
  return match ? match[1].toUpperCase() : "";
}

function normalizeComparableText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("de")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getFormData() {
  return {
    vault: els.vault.value.trim(),
    folder: els.folder.value.trim().replace(/^\/+|\/+$/g, ""),
    title: els.title.value.trim(),
    authors: splitAuthors(els.authors.value),
    isbn: normalizeIsbn(els.isbn.value),
    firstPublicationYear: normalizePublicationYear(els.firstPublicationYear.value),
    language: els.language.value.trim(),
    openLibraryWorkId: els.openLibraryWorkId.value.trim(),
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

  const forms = isbnForms(book.isbn);

  lines.push(
    `first_publication_year: ${book.firstPublicationYear || "null"}`,
    `source_isbn: ${yamlString(forms.primary)}`,
    `openlibrary_work_id: ${yamlString(book.openLibraryWorkId || "")}`,
    `cover_url: ${yamlString(book.coverUrl)}`,
    `ownership: ${book.ownership}`,
    `reading_status: ${book.readingStatus}`,
    `added: ${book.added || todayIso()}`,
    `metadata_source: ${book.metadataSource || "manual"}`,
    "---",
    "",
    "# Notizen",
    "",
    "# Zitate",
    "",
    "# Eindruck",
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

function openLibraryWorkKey(edition) {
  const workKey = Array.isArray(edition?.works) ? edition.works[0]?.key : "";
  return String(workKey).startsWith("/works/") ? String(workKey) : "";
}

async function resolveOpenLibraryWork(edition) {
  const workKey = openLibraryWorkKey(edition);
  if (!workKey) return null;
  try {
    return await fetchJson(`https://openlibrary.org${workKey}.json`, "Open Library Werk");
  } catch (error) {
    console.warn(error);
    return null;
  }
}

async function searchOpenLibraryWork(title, authors = [], preferredWorkId = "") {
  if (!title) return null;

  const params = new URLSearchParams({
    title,
    fields: "key,title,author_name,first_publish_year,subject,cover_i",
    limit: "8",
  });
  if (authors[0]) params.set("author", authors[0]);

  try {
    const data = await fetchJson(
      `https://openlibrary.org/search.json?${params.toString()}`,
      "Open Library Werksuche"
    );
    const docs = Array.isArray(data?.docs) ? data.docs : [];
    if (!docs.length) return null;

    const normalizedTitle = normalizeComparableText(title);
    const normalizedAuthor = normalizeComparableText(authors[0] ?? "");
    const preferredId = normalizeWorkId(preferredWorkId);

    const scored = docs.map((doc, index) => {
      const docId = normalizeWorkId(doc.key);
      const docTitle = normalizeComparableText(doc.title);
      const docAuthors = Array.isArray(doc.author_name) ? doc.author_name : [];
      const authorMatch = !normalizedAuthor || docAuthors.some(
        (name) => normalizeComparableText(name) === normalizedAuthor
      );
      let score = 0;
      if (preferredId && docId === preferredId) score += 100;
      if (docTitle === normalizedTitle) score += 20;
      else if (docTitle.includes(normalizedTitle) || normalizedTitle.includes(docTitle)) score += 8;
      if (authorMatch) score += 10;
      score -= index * 0.01;
      return { doc, score };
    }).sort((left, right) => right.score - left.score);

    const best = scored[0];
    if (!best || best.score < 10) return null;
    return best.doc;
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
      const key = author?.key ?? author?.author?.key;
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
  const workKey = openLibraryWorkKey(edition);
  const work = await resolveOpenLibraryWork(edition);
  const authorRefs = Array.isArray(edition.authors) && edition.authors.length
    ? edition.authors
    : work?.authors;
  const authors = await resolveOpenLibraryAuthors(authorRefs);
  const workId = normalizeWorkId(workKey);
  const directFirstPublicationYear = normalizePublicationYear(work?.first_publish_date);
  const needsWorkSearch =
    !directFirstPublicationYear ||
    !workId ||
    !Array.isArray(work?.subjects) ||
    work.subjects.length === 0;
  const searchWork = needsWorkSearch
    ? await searchOpenLibraryWork(work?.title ?? edition.title ?? "", authors, workId)
    : null;

  const coverIds = [
    ...(Array.isArray(edition.covers) ? edition.covers : []),
    ...(Array.isArray(work?.covers) ? work.covers : []),
  ];
  const coverId = coverIds.find((id) => Number(id) > 0);
  const subjects = normalizeSubjects([
    ...(Array.isArray(work?.subjects) ? work.subjects : []),
    ...(Array.isArray(searchWork?.subject) ? searchWork.subject : []),
    ...(Array.isArray(edition.subjects) ? edition.subjects : []),
  ]);
  const firstPublicationYear =
    directFirstPublicationYear ||
    normalizePublicationYear(searchWork?.first_publish_year);

  return {
    title: work?.title ?? edition.title ?? searchWork?.title ?? "",
    authors,
    firstPublicationYear,
    language: languageCodes(edition.languages),
    openLibraryWorkId: workId || normalizeWorkId(searchWork?.key),
    coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : "",
    genres: inferGenres(subjects),
    subjects,
    source: "open-library",
  };
}

function selectBestGoogleVolume(items, isbn) {
  return items.find((item) =>
    (item.volumeInfo?.industryIdentifiers ?? [])
      .some((entry) => isbnEquivalent(entry.identifier, isbn))
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
  const authors = Array.isArray(info.authors) ? info.authors : [];
  const openLibraryWork = await searchOpenLibraryWork(info.title ?? "", authors);
  const subjects = normalizeSubjects(openLibraryWork?.subject ?? []);
  const googleCategories = Array.isArray(info.categories) ? info.categories : [];

  return {
    title: openLibraryWork?.title ?? info.title ?? "",
    authors,
    firstPublicationYear: normalizePublicationYear(openLibraryWork?.first_publish_year),
    language: info.language ?? "",
    openLibraryWorkId: normalizeWorkId(openLibraryWork?.key),
    coverUrl: String(imageLinks.thumbnail ?? imageLinks.smallThumbnail ?? "")
      .replace(/^http:\/\//i, "https://"),
    genres: uniqueStrings([...googleCategories, ...inferGenres(subjects)]),
    subjects,
    source: openLibraryWork ? "google-books+open-library-work" : "google-books",
  };
}

function applyBookData(isbn, book) {
  els.isbn.value = isbn;
  els.title.value = book?.title ?? "";
  els.authors.value = Array.isArray(book?.authors) ? book.authors.join("; ") : "";
  els.firstPublicationYear.value = normalizePublicationYear(book?.firstPublicationYear ?? "");
  els.openLibraryWorkId.value = book?.openLibraryWorkId ?? "";
  els.coverUrl.value = book?.coverUrl ?? "";
  els.genres.value = Array.isArray(book?.genres) ? book.genres.join("; ") : "";
  els.subjects.value = Array.isArray(book?.subjects) ? book.subjects.join("; ") : "";
  currentMetadataSource = book?.source ?? "manual";
  reviewInProgress = true;
  els.resultCard.classList.remove("hidden");
  updatePreview();
  updateRecognitionControls();
}

async function lookupBook(rawIsbn) {
  const forms = isbnForms(rawIsbn);
  const isbn = forms.primary;

  if (!isBookIsbn(isbn)) {
    setStatus("Bitte eine gültige ISBN-10 oder ISBN-13 eines Buches eingeben.", "error");
    return;
  }
  const duplicate = batch.find((book) => isbnEquivalent(book.isbn, isbn) && book.id !== editingBatchId);
  if (duplicate) {
    setStatus(`ISBN ${isbn} befindet sich bereits im Stapel.`, "error");
    renderBatch();
    els.queueCard.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (lookupInProgress) return;

  lookupInProgress = true;
  els.lookupButton.disabled = true;
  updateRecognitionControls();
  setStatus(`Suche ISBN ${isbn} zuerst bei Open Library …`);

  const errors = [];
  const candidates = forms.candidates;

  try {
    for (const candidate of candidates) {
      try {
        const openLibraryBook = await lookupOpenLibrary(candidate);
        applyBookData(isbn, openLibraryBook);
        els.resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
        const fallbackNote = candidate === isbn ? "" : ` (über äquivalente ISBN ${candidate})`;
        setStatus(`Treffer für ISBN ${isbn} über Open Library geladen${fallbackNote}.`, "success");
        return;
      } catch (error) {
        errors.push(`Open Library ${candidate}: ${error.message}`);
        console.warn(error);
      }
    }

    const apiKey = els.googleApiKey.value.trim();
    if (apiKey) {
      setStatus("Open Library hatte keinen nutzbaren Treffer. Versuche Google Books …");
      for (const candidate of candidates) {
        try {
          const googleBook = await lookupGoogleBooks(candidate, apiKey);
          if (googleBook) {
            applyBookData(isbn, googleBook);
            els.resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
            const fallbackNote = candidate === isbn ? "" : ` (über äquivalente ISBN ${candidate})`;
            setStatus(`Treffer für ISBN ${isbn} über Google Books geladen${fallbackNote}.`, "success");
            return;
          }
          errors.push(`Google Books ${candidate}: kein Treffer`);
        } catch (error) {
          errors.push(`Google Books ${candidate}: ${error.message}`);
          console.warn(error);
        }
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
    updateRecognitionControls();
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
  return `${titlePart}.md`;
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
          <small>${escapeHtml(book.isbn)}${book.firstPublicationYear ? ` · zuerst ${escapeHtml(book.firstPublicationYear)}` : ""}${book.genres?.length ? ` · ${escapeHtml(book.genres.join(", "))}` : ""}</small>
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
  els.firstPublicationYear.value = "";
  els.language.value = "";
  els.openLibraryWorkId.value = "";
  els.coverUrl.value = "";
  els.genres.value = "";
  els.subjects.value = "";
  els.coverPreview.removeAttribute("src");
  els.coverPreview.hidden = true;
  els.resultCard.classList.add("hidden");
  els.batchButton.textContent = "Zum Stapel hinzufügen & weiter";
  reviewInProgress = false;
  updatePreview();
  updateRecognitionControls();
  ensureScannerReady();
}

function addCurrentBookToBatch() {
  const book = getFormData();
  if (!book.title || !isBookIsbn(book.isbn)) {
    setStatus("Titel und gültige ISBN müssen vorhanden sein.", "error");
    return;
  }

  const duplicate = batch.find((entry) => isbnEquivalent(entry.isbn, book.isbn) && entry.id !== editingBatchId);
  if (duplicate) {
    setStatus(`ISBN ${book.isbn} befindet sich bereits im Stapel.`, "error");
    return;
  }

  const duplicateWork = book.openLibraryWorkId
    ? batch.find((entry) =>
        normalizeWorkId(entry.openLibraryWorkId) === normalizeWorkId(book.openLibraryWorkId) &&
        entry.id !== editingBatchId
      )
    : null;
  if (duplicateWork) {
    setStatus(`Das Werk „${book.title}“ befindet sich bereits im Stapel.`, "error");
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
  document.querySelector("#camera-video").scrollIntoView({ behavior: "smooth", block: "start" });
}

function editBatchBook(id) {
  const book = batch.find((entry) => entry.id === id);
  if (!book) return;
  editingBatchId = id;
  currentMetadataSource = book.metadataSource || "manual";
  applyBookData(book.isbn, {
    title: book.title,
    authors: book.authors,
    firstPublicationYear: book.firstPublicationYear,
    openLibraryWorkId: book.openLibraryWorkId,
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

function openBookInObsidian(book, markExported = false, clearCurrent = false) {
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
  if (clearCurrent) resetFormForNextScan();
  // Externe App öffnen: Kamera vorher sofort freigeben, damit keine alte Sitzung sie blockiert.
  releaseCameraTracks();
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
  openBookInObsidian(book, false, true);
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
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

function setAutoScanState(message) {
  if (els.autoScanState) els.autoScanState.textContent = message;
}

function formatZoom(value) {
  return `${Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}×`;
}

function gtinCheckDigitValid(value) {
  const digits = digitsOnly(value);
  if (![8, 12, 13].includes(digits.length)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let index = body.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    sum += Number(body[index]) * (position % 2 === 0 ? 3 : 1);
  }
  return Number(digits.at(-1)) === (10 - (sum % 10)) % 10;
}

function validDecodedBarcode(value) {
  const classification = classifyBarcode(value);
  if (classification.type === "isbn") return true;
  if (classification.type === "retail") return gtinCheckDigitValid(classification.barcode);
  return false;
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

const OCR_DIGIT_ALTERNATIVES = Object.freeze({
  O: ["0"],
  Q: ["0"],
  D: ["0"],
  I: ["1"],
  L: ["1"],
  "|": ["1"],
  "!": ["1"],
  Z: ["2"],
  A: ["4"],
  S: ["5"],
  G: ["6"],
  B: ["6", "8"],
  T: ["7"],
});

function ocrSymbolAlternatives(char, position, targetLength) {
  if (/\d/.test(char)) return [char];
  if (char === "X" && targetLength === 10 && position === 9) return ["X"];
  return OCR_DIGIT_ALTERNATIVES[char] ?? [];
}

function ocrSymbolStream(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[—–−]/g, "-")
    .split("")
    .filter((char) => /\d/.test(char) || char === "X" || char in OCR_DIGIT_ALTERNATIVES)
    .join("");
}

function expandOcrWindow(windowText, targetLength, maxVariants = 256) {
  let variants = [""];
  for (let index = 0; index < windowText.length; index += 1) {
    const alternatives = ocrSymbolAlternatives(windowText[index], index, targetLength);
    if (!alternatives.length) return [];
    const next = [];
    for (const prefix of variants) {
      for (const alternative of alternatives) {
        next.push(prefix + alternative);
        if (next.length >= maxVariants) break;
      }
      if (next.length >= maxVariants) break;
    }
    variants = next;
  }
  return variants;
}

function validIsbnFromOcrCandidate(candidate) {
  const stream = ocrSymbolStream(candidate);
  const targetLengths = [10, 13];

  for (const targetLength of targetLengths) {
    if (stream.length < targetLength) continue;
    for (let start = 0; start <= stream.length - targetLength; start += 1) {
      const windowText = stream.slice(start, start + targetLength);
      for (const variant of expandOcrWindow(windowText, targetLength)) {
        if (targetLength === 10 && isbn10CheckDigitValid(variant)) return variant;
        if (targetLength === 13 && isBookIsbn(variant)) return variant;
      }
    }
  }
  return "";
}

function extractIsbnFromText(text) {
  const cleaned = String(text ?? "").replace(/[—–−]/g, "-");
  const candidates = [];

  // Tesseract verwechselt bei älteren ISBN-Schriften besonders häufig 6 mit b/B.
  // Deshalb wird nach dem ISBN-Label bewusst ein breiter alphanumerischer Bereich erfasst.
  const isbnRegex = /ISBN(?:-1[03])?\s*[:#]?\s*([A-Z0-9|!][A-Z0-9|!\s-]{8,32})/gi;
  for (const match of cleaned.matchAll(isbnRegex)) candidates.push(match[1]);

  // Fallback, falls Tesseract das Wort ISBN selbst nicht sicher gelesen hat.
  for (const line of cleaned.split(/\r?\n/)) {
    const runs = line.match(/[0-9OQDIL|!ZASGBTX][0-9A-Z|!\s-]{8,32}/gi) ?? [];
    candidates.push(...runs);
  }

  for (const candidate of candidates) {
    const isbn = validIsbnFromOcrCandidate(candidate);
    if (isbn) return isbn;
  }
  return "";
}

function disposeCanvas(canvas) {
  if (!(canvas instanceof HTMLCanvasElement)) return;
  try {
    const context = canvas.getContext("2d");
    context?.clearRect(0, 0, canvas.width, canvas.height);
  } catch (_) {
    // Das Zurücksetzen der Dimensionen gibt den Bildpuffer trotzdem frei.
  }
  canvas.width = 1;
  canvas.height = 1;
  canvas.remove?.();
}

function currentVideoFrame() {
  const video = els.cameraVideo;
  if (!video || !video.videoWidth || !video.videoHeight || video.readyState < 2) return null;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(video, 0, 0);
  return canvas;
}

async function imageSourceToCanvas(source) {
  if (source instanceof HTMLCanvasElement) return source;
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close?.();
  }
}

async function captureFrameCanvas({ preferPhoto = false } = {}) {
  if (videoTrack && globalThis.ImageCapture) {
    try {
      if (!imageCapture) imageCapture = new ImageCapture(videoTrack);
      if (preferPhoto && typeof imageCapture.takePhoto === "function") {
        const photo = await imageCapture.takePhoto();
        return await imageSourceToCanvas(photo);
      }
      if (typeof imageCapture.grabFrame === "function") {
        const bitmap = await imageCapture.grabFrame();
        try {
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext("2d", { willReadFrequently: true }).drawImage(bitmap, 0, 0);
          return canvas;
        } finally {
          bitmap.close?.();
        }
      }
    } catch (error) {
      console.warn("ImageCapture nicht nutzbar; verwende Videoframe:", error);
    }
  }
  return currentVideoFrame();
}

function makeCanvasVariant(source, spec = {}, contrast = false, targetWidth = 1700) {
  const sx = Math.max(0, Math.round((spec.x ?? 0) * source.width));
  const sy = Math.max(0, Math.round((spec.y ?? 0) * source.height));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round((spec.w ?? 1) * source.width)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round((spec.h ?? 1) * source.height)));
  const scale = Math.min(2.4, Math.max(1, targetWidth / sw));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  if (contrast) {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    for (let index = 0; index < data.length; index += 4) {
      const gray = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
      const adjusted = Math.max(0, Math.min(255, (gray - 128) * 1.7 + 128));
      data[index] = data[index + 1] = data[index + 2] = adjusted;
    }
    ctx.putImageData(image, 0, 0);
  }
  return canvas;
}

function canvasToBlob(canvas, type = "image/jpeg", quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Temporäres Bild konnte nicht erzeugt werden."));
    }, type, quality);
  });
}

async function getNativeBarcodeDetector() {
  if (nativeBarcodeDetectorPromise) return nativeBarcodeDetectorPromise;
  nativeBarcodeDetectorPromise = (async () => {
    if (!globalThis.BarcodeDetector) return null;
    try {
      const wanted = ["ean_13", "ean_8", "upc_a", "upc_e"];
      const supported = typeof BarcodeDetector.getSupportedFormats === "function"
        ? await BarcodeDetector.getSupportedFormats()
        : wanted;
      const formats = wanted.filter((format) => supported.includes(format));
      if (!formats.length) return null;
      nativeBarcodeDetector = new BarcodeDetector({ formats });
      return nativeBarcodeDetector;
    } catch (error) {
      console.warn("Native BarcodeDetector-API nicht nutzbar:", error);
      return null;
    }
  })();
  return nativeBarcodeDetectorPromise;
}

async function detectBarcodeNative(canvas) {
  const detector = await getNativeBarcodeDetector();
  if (!detector) return null;
  try {
    const results = await detector.detect(canvas);
    const match = results.find((result) => validDecodedBarcode(result.rawValue));
    return match ? {
      decodedText: match.rawValue,
      decodedResult: { format: match.format || "BarcodeDetector" },
    } : null;
  } catch (error) {
    console.warn("Native Barcode-Erkennung fehlgeschlagen:", error);
    return null;
  }
}

function decodeQuagga(url, { locate = true, size = 1700, patchSize = "small" } = {}) {
  if (!globalThis.Quagga) return Promise.resolve(null);
  return new Promise((resolve) => {
    Quagga.decodeSingle({
      src: url,
      numOfWorkers: 0,
      locate,
      inputStream: {
        size,
        singleChannel: false,
      },
      locator: {
        halfSample: false,
        patchSize,
      },
      decoder: {
        readers: ["ean_reader", "upc_reader", "ean_8_reader", "upc_e_reader"],
        multiple: false,
      },
    }, (result) => {
      const value = result?.codeResult?.code ?? "";
      if (!value || !validDecodedBarcode(value)) {
        resolve(null);
        return;
      }
      resolve({
        decodedText: value,
        decodedResult: {
          format: result.codeResult.format || "Quagga2",
          codeResult: result.codeResult,
        },
      });
    });
  });
}

async function detectBarcodeQuagga(canvas, options = {}) {
  if (!globalThis.Quagga) return null;
  let url = "";
  try {
    const blob = await canvasToBlob(canvas);
    url = URL.createObjectURL(blob);
    return await decodeQuagga(url, options);
  } catch (error) {
    console.warn("Quagga2-Bildprüfung fehlgeschlagen:", error);
    return null;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

async function scanBarcodeFromCanvas(sourceCanvas) {
  const nativeResult = await detectBarcodeNative(sourceCanvas);
  if (nativeResult) return nativeResult;

  const variants = [
    {
      spec: { x: 0.04, y: 0.28, w: 0.92, h: 0.44 },
      contrast: false,
      options: { locate: false, size: 1800, patchSize: "small" },
    },
    {
      spec: { x: 0.04, y: 0.28, w: 0.92, h: 0.44 },
      contrast: true,
      options: { locate: false, size: 1800, patchSize: "small" },
    },
    {
      spec: { x: 0, y: 0.12, w: 1, h: 0.76 },
      contrast: false,
      options: { locate: true, size: 1800, patchSize: "x-small" },
    },
  ];

  for (const variant of variants) {
    const canvas = makeCanvasVariant(sourceCanvas, variant.spec, variant.contrast, 1800);
    try {
      const result = await detectBarcodeQuagga(canvas, variant.options);
      if (result) return result;
    } finally {
      disposeCanvas(canvas);
    }
  }
  return null;
}

async function recognizeIsbnFromImage(source) {
  if (!source || ocrInProgress) return "";
  ocrInProgress = true;
  els.ocrButton.disabled = true;
  els.ocrButton.classList.add("busy");
  let ownCanvas = false;
  let canvas = null;
  try {
    setStatus("OCR wird geladen; beim ersten Mal kann das etwas dauern …");
    const worker = await getOcrWorker();
    canvas = source instanceof HTMLCanvasElement ? source : await imageSourceToCanvas(source);
    ownCanvas = canvas !== source;

    const passes = [
      {
        label: "Gesamtbild",
        spec: { x: 0.02, y: 0.06, w: 0.96, h: 0.88 },
        contrast: true,
        targetWidth: 2000,
        pageSegMode: "6",
      },
      {
        label: "mittlerer Bereich",
        spec: { x: 0.02, y: 0.28, w: 0.96, h: 0.50 },
        contrast: false,
        targetWidth: 2200,
        pageSegMode: "11",
      },
      {
        label: "unterer Bereich",
        spec: { x: 0.02, y: 0.48, w: 0.96, h: 0.46 },
        contrast: true,
        targetWidth: 2200,
        pageSegMode: "6",
      },
    ];

    for (let index = 0; index < passes.length; index += 1) {
      const pass = passes[index];
      let ocrCanvas = null;
      try {
        setStatus(`Gedruckte ISBN wird gelesen (${index + 1}/${passes.length}: ${pass.label}) …`);
        await worker.setParameters({ tessedit_pageseg_mode: pass.pageSegMode });
        ocrCanvas = makeCanvasVariant(
          canvas,
          pass.spec,
          pass.contrast,
          pass.targetWidth
        );
        const result = await worker.recognize(ocrCanvas);
        const isbn = extractIsbnFromText(result?.data?.text ?? "");
        if (isbn) return isbn;
      } finally {
        disposeCanvas(ocrCanvas);
      }
    }

    return "";
  } catch (error) {
    console.warn("OCR fehlgeschlagen:", error);
    setStatus(`ISBN-Texterkennung fehlgeschlagen: ${error.message || error}`, "error");
    return "";
  } finally {
    if (ownCanvas) disposeCanvas(canvas);
    ocrInProgress = false;
    els.ocrButton.classList.remove("busy");
    updateRecognitionControls();
  }
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function updateRecognitionControls() {
  const unavailable = !scannerRunning || recognitionRunning || reviewInProgress || lookupInProgress || ocrInProgress;
  els.recognitionButton.disabled = unavailable;
  els.recognitionButton.textContent = recognitionRunning ? "Erkennung läuft …" : "Erkennung starten";
  els.lookupButton.disabled = lookupInProgress || recognitionRunning || ocrInProgress;
  els.ocrButton.disabled = unavailable;
  els.photoInput.disabled = recognitionRunning || reviewInProgress || lookupInProgress || ocrInProgress;
}

function finishRecognition(message = "Bereit – Erkennung manuell starten.", kind = "") {
  recognitionRunning = false;
  setAutoScanState(message);
  updateRecognitionControls();
  if (kind) setStatus(message, kind);
}

function cancelRecognition(message = "Erkennung abgebrochen.") {
  recognitionRunId += 1;
  recognitionRunning = false;
  setAutoScanState(message);
  updateRecognitionControls();
}

async function waitForAttemptSlot(startedAt, attemptIndex, runId) {
  const target = startedAt + attemptIndex * RECOGNITION_INTERVAL_MS;
  const remaining = target - performance.now();
  if (remaining > 0) await wait(remaining);
  return runId === recognitionRunId;
}

async function lookupRecognizedIsbn(isbn, sourceLabel = "Texterkennung") {
  if (!isBookIsbn(isbn)) return false;
  recognitionRunning = false;
  updateRecognitionControls();
  setAutoScanState("Buch erkannt – Metadaten werden geladen.");
  if (navigator.vibrate) navigator.vibrate([40, 35, 40]);
  els.manualIsbn.value = isbn;
  setStatus(`${sourceLabel}: ISBN ${isbn} erkannt. Metadaten werden geladen …`, "success");
  await lookupBook(isbn);
  updateRecognitionControls();
  return true;
}

async function handleDecodedBarcode(decodedText, decodedResult = null, sourceImage = null) {
  if (reviewInProgress || lookupInProgress || ocrInProgress) return false;

  const classification = classifyBarcode(decodedText, decodedResult);
  const dedupeKey = `${classification.type}:${classification.isbn || classification.barcode}`;
  if (dedupeKey === lastScanned) return false;
  lastScanned = dedupeKey;
  window.setTimeout(() => { lastScanned = ""; }, 3000);

  if (classification.type === "isbn") {
    if (navigator.vibrate) navigator.vibrate(45);
    disposeCanvas(sourceImage);
    await lookupRecognizedIsbn(classification.isbn, "Barcode");
    return true;
  }

  if (classification.type === "retail") {
    setStatus(`Handelsbarcode ${classification.barcode} erkannt. Suche nach einer gedruckten ISBN …`);
    const isbn = sourceImage ? await recognizeIsbnFromImage(sourceImage) : "";
    if (isbn) {
      disposeCanvas(sourceImage);
      await lookupRecognizedIsbn(isbn, "ISBN-Text");
      return true;
    }
    setStatus(`Handelsbarcode ${classification.barcode} erkannt, aber keine gedruckte ISBN gefunden.`, "error");
    return false;
  }

  setStatus(`Barcode ${decodedText} erkannt, aber nicht als ISBN eingeordnet.`, "error");
  return false;
}

async function startRecognitionRun() {
  if (recognitionRunning || reviewInProgress || lookupInProgress || ocrInProgress) return;
  if (!scannerRunning) {
    await startScanner();
    if (!scannerRunning) return;
  }

  recognitionRunning = true;
  const runId = ++recognitionRunId;
  const startedAt = performance.now();
  let lastRetailBarcode = "";
  updateRecognitionControls();
  setAutoScanState(`Barcodeprüfung 1/${RECOGNITION_ATTEMPTS}`);
  setStatus("Erkennung gestartet. Halte den Barcode möglichst frontal in den Rahmen …");

  try {
    for (let attempt = 1; attempt <= RECOGNITION_ATTEMPTS; attempt += 1) {
      if (!(await waitForAttemptSlot(startedAt, attempt - 1, runId))) return;

      setAutoScanState(`Barcodeprüfung ${attempt}/${RECOGNITION_ATTEMPTS}`);
      setStatus(`Barcodeprüfung ${attempt}/${RECOGNITION_ATTEMPTS} …`);
      let frame = null;
      try {
        frame = await captureFrameCanvas();
        if (!frame) {
          setStatus(`Kein stabiles Kamerabild bei Versuch ${attempt}/${RECOGNITION_ATTEMPTS}.`);
          continue;
        }

        const decoded = await scanBarcodeFromCanvas(frame);
        if (runId !== recognitionRunId) return;
        if (!decoded) continue;

        const classification = classifyBarcode(decoded.decodedText, decoded.decodedResult);
        if (classification.type === "isbn") {
          const isbn = classification.isbn;
          disposeCanvas(frame);
          frame = null;
          await lookupRecognizedIsbn(isbn, "Barcode");
          return;
        }

        if (classification.type === "retail") {
          lastRetailBarcode = classification.barcode;
          setStatus(`Handelsbarcode ${classification.barcode} erkannt; kein ISBN-Barcode. Weitere Versuche laufen …`);
        }
      } finally {
        disposeCanvas(frame);
      }
    }

    if (runId !== recognitionRunId) return;
    setAutoScanState("Kein ISBN-Barcode – ISBN-Text wird gelesen");
    setStatus(lastRetailBarcode
      ? `Nur Handelsbarcode ${lastRetailBarcode} erkannt. Die gedruckte ISBN wird jetzt gelesen …`
      : "Kein ISBN-Barcode erkannt. Die gedruckte ISBN wird jetzt gelesen …");

    let ocrFrame = null;
    try {
      ocrFrame = await captureFrameCanvas({ preferPhoto: true });
      if (!ocrFrame) {
        finishRecognition("Kein Kamerabild für OCR verfügbar.");
        setStatus("Kein Kamerabild für die ISBN-Texterkennung verfügbar.", "error");
        return;
      }
      const isbn = await recognizeIsbnFromImage(ocrFrame);
      disposeCanvas(ocrFrame);
      ocrFrame = null;
      if (runId !== recognitionRunId) return;
      if (isbn) {
        await lookupRecognizedIsbn(isbn, "ISBN-Text");
        return;
      }
    } finally {
      disposeCanvas(ocrFrame);
    }

    finishRecognition("Kein Treffer – erneut starten oder ISBN manuell eingeben.");
    setStatus("Weder ISBN-Barcode noch gültige gedruckte ISBN erkannt. Richte Barcode und ISBN-Zeile frontal aus und starte erneut.", "error");
  } catch (error) {
    console.warn("Manueller Erkennungslauf fehlgeschlagen:", error);
    if (runId === recognitionRunId) {
      finishRecognition("Erkennung fehlgeschlagen.");
      setStatus(`Erkennung fehlgeschlagen: ${error.message || error}`, "error");
    }
  } finally {
    if (runId === recognitionRunId && !reviewInProgress && !lookupInProgress && recognitionRunning) {
      finishRecognition();
    }
  }
}

async function scanPrintedIsbnFromCamera() {
  if (ocrInProgress || lookupInProgress || reviewInProgress || recognitionRunning) return;
  recognitionRunning = true;
  const runId = ++recognitionRunId;
  updateRecognitionControls();
  setAutoScanState("ISBN-Texterkennung läuft");
  let frame = null;
  try {
    frame = await captureFrameCanvas({ preferPhoto: true });
    if (!frame) {
      finishRecognition("Bereit – Erkennung manuell starten.");
      setStatus("Kein Kamerabild verfügbar. Nutze stattdessen „Foto scannen“.", "error");
      return;
    }
    const isbn = await recognizeIsbnFromImage(frame);
    disposeCanvas(frame);
    frame = null;
    if (runId !== recognitionRunId) return;
    if (isbn) await lookupRecognizedIsbn(isbn);
    else {
      finishRecognition("Kein ISBN-Text erkannt.");
      setStatus("Keine gültige gedruckte ISBN erkannt. Halte ISBN-Zeile und Barcode näher ins Bild oder nutze die manuelle Eingabe.", "error");
    }
  } finally {
    disposeCanvas(frame);
    if (runId === recognitionRunId && !reviewInProgress && !lookupInProgress && recognitionRunning) finishRecognition();
  }
}

async function applyCameraEnhancements() {
  if (!videoTrack) return;
  const capabilities = typeof videoTrack.getCapabilities === "function" ? videoTrack.getCapabilities() : {};
  const settings = typeof videoTrack.getSettings === "function" ? videoTrack.getSettings() : {};

  if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes("continuous")) {
    try {
      await videoTrack.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
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

  els.torchButton.classList.toggle("hidden", capabilities.torch !== true);
  const width = settings.width ? `${settings.width}×${settings.height ?? "?"}` : "";
  setStatus(`Kamera aktiv${width ? ` (${width})` : ""}. Erkennung kann manuell gestartet werden.`, "success");
  setAutoScanState("Bereit – Erkennung manuell starten.");
  updateRecognitionControls();
  updateCameraButton();
}

function updateCameraButton() {
  if (!els.cameraRestartButton) return;
  els.cameraRestartButton.textContent = scannerRunning ? "Kamera neu starten" : "Kamera starten";
  els.cameraRestartButton.disabled = Boolean(scannerStarting);
}

function releaseCameraTracks() {
  for (const track of mediaStream?.getTracks?.() ?? []) {
    try { track.stop(); } catch (_) { /* Track ist bereits beendet. */ }
  }
  mediaStream = null;
  videoTrack = null;
  imageCapture = null;
  if (els.cameraVideo) {
    try { els.cameraVideo.pause(); } catch (_) { /* unkritisch */ }
    els.cameraVideo.srcObject = null;
  }
  scannerRunning = false;
  recognitionRunning = false;
  torchOn = false;
  els.torchButton.textContent = "Licht einschalten";
  els.torchButton.classList.add("hidden");
  els.zoomPanel.classList.add("hidden");
  updateRecognitionControls();
  updateCameraButton();
}

function cameraErrorMessage(error) {
  const name = String(error?.name ?? "");
  const message = String(error?.message ?? error ?? "Unbekannter Fehler");
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Kamerazugriff wurde nicht erlaubt. Erlaube der Website die Kamera in den Browser- oder Website-Einstellungen.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Es wurde keine nutzbare Kamera gefunden.";
  }
  if (name === "NotReadableError" || /starting videoinput failed|could not start video|camera.*busy/i.test(message)) {
    return "Die Kamera ist noch durch eine andere App, einen anderen Browser-Tab oder eine ältere Buchscanner-Sitzung belegt. Schließe diese Kameraansicht vollständig und tippe danach erneut auf „Kamera starten“.";
  }
  if (name === "OverconstrainedError") {
    return "Die angeforderten Kameraeinstellungen werden nicht unterstützt. Der Standardmodus ist ebenfalls fehlgeschlagen.";
  }
  return `Kamera konnte nicht gestartet werden (${name || "Fehler"}): ${message}`;
}

async function requestCameraStream() {
  const attempts = [
    {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 24, max: 30 },
      },
    },
    { audio: false, video: { facingMode: { ideal: "environment" } } },
    { audio: false, video: true },
  ];

  let lastError = null;
  for (let index = 0; index < attempts.length; index += 1) {
    try {
      return await navigator.mediaDevices.getUserMedia(attempts[index]);
    } catch (error) {
      lastError = error;
      console.warn(`Kameraversuch ${index + 1}/${attempts.length} fehlgeschlagen:`, error);
      if (["NotAllowedError", "SecurityError", "NotFoundError", "DevicesNotFoundError"].includes(error?.name)) {
        throw error;
      }
      if (index < attempts.length - 1) await wait(index === 0 ? 450 : 750);
    }
  }
  throw lastError ?? new Error("Kein Kamerastream verfügbar.");
}

async function startScanner() {
  if (!scannerAvailable()) {
    setStatus("Dieser Browser stellt keinen Kamerazugriff bereit.", "error");
    return;
  }
  if (scannerRunning) {
    resumeScanner();
    return;
  }
  if (scannerStarting) return scannerStarting;

  scannerStarting = (async () => {
    cancelRecognition("Kamera wird vorbereitet …");
    releaseCameraTracks();
    updateCameraButton();
    setStatus("Rückkamera wird vorbereitet …");
    setAutoScanState("Kamera wird gestartet …");

    // Einige mobile Browser geben die Hardware erst mit kurzer Verzögerung frei.
    await wait(350);
    mediaStream = await requestCameraStream();
    videoTrack = mediaStream.getVideoTracks()[0] ?? null;
    if (!videoTrack) throw new Error("Der Kamerastream enthält keine Videospur.");

    imageCapture = null;
    els.cameraVideo.srcObject = mediaStream;
    await els.cameraVideo.play();
    scannerRunning = true;
    recognitionRunning = false;
    torchOn = false;

    videoTrack.addEventListener("ended", () => {
      if (!scannerRunning) return;
      releaseCameraTracks();
      setAutoScanState("Kamera wurde beendet.");
      setStatus("Die Kamera wurde vom Browser oder Betriebssystem beendet. Tippe auf „Kamera starten“.", "error");
    }, { once: true });

    await applyCameraEnhancements();
  })();

  updateCameraButton();
  try {
    await scannerStarting;
  } catch (error) {
    console.error(error);
    releaseCameraTracks();
    setAutoScanState("Kamera nicht aktiv");
    setStatus(cameraErrorMessage(error), "error");
  } finally {
    scannerStarting = null;
    updateCameraButton();
  }
}

async function stopScanner({ message = "Kamera gestoppt", quiet = false } = {}) {
  cancelRecognition(message);
  releaseCameraTracks();
  if (!quiet) {
    setAutoScanState(message);
    setStatus("Kamera ist ausgeschaltet. Tippe auf „Kamera starten“, wenn du weiter scannen möchtest.");
  }
}

function resumeScanner() {
  if (reviewInProgress || lookupInProgress) {
    updateRecognitionControls();
    return;
  }
  if (!scannerRunning) {
    setAutoScanState("Kamera ist aus.");
    setStatus("Tippe auf „Kamera starten“, um die Vorschau zu öffnen.");
    updateRecognitionControls();
    updateCameraButton();
    return;
  }
  recognitionRunning = false;
  setAutoScanState("Bereit – Erkennung manuell starten.");
  setStatus("Bereit. Richte das Buch aus und tippe auf „Erkennung starten“.", "success");
  updateRecognitionControls();
  updateCameraButton();
}

function ensureScannerReady() {
  window.setTimeout(() => resumeScanner(), 80);
}

async function restartScanner() {
  if (scannerStarting) return;
  if (!scannerRunning) {
    await startScanner();
    return;
  }
  els.cameraRestartButton.disabled = true;
  setStatus("Kamera wird neu gestartet und fokussiert …");
  await stopScanner({ message: "Kamera wird neu gestartet …", quiet: true });
  await wait(500);
  await startScanner();
  updateCameraButton();
}

async function toggleTorch() {
  if (!videoTrack) return;
  const next = !torchOn;
  try {
    await videoTrack.applyConstraints({ advanced: [{ torch: next }] });
    torchOn = next;
    els.torchButton.textContent = torchOn ? "Licht ausschalten" : "Licht einschalten";
  } catch (error) {
    console.warn(error);
    setStatus("Das Kameralicht lässt sich in diesem Browser nicht steuern.", "error");
  }
}

async function applyZoom(value) {
  if (!videoTrack) return;
  const zoom = Number(value);
  els.zoomValue.textContent = formatZoom(zoom);
  try {
    await videoTrack.applyConstraints({ advanced: [{ zoom }] });
  } catch (error) {
    console.warn("Zoom konnte nicht gesetzt werden:", error);
  }
}

async function scanPhoto(file) {
  if (!file || recognitionRunning || reviewInProgress || lookupInProgress || ocrInProgress) return;
  recognitionRunning = true;
  const runId = ++recognitionRunId;
  updateRecognitionControls();
  setAutoScanState("Foto wird ausgewertet");
  els.photoInput.disabled = true;
  setStatus("Foto wird auf Barcode und gedruckte ISBN geprüft …");
  let sourceCanvas = null;

  try {
    sourceCanvas = await imageSourceToCanvas(file);
    const decoded = await scanBarcodeFromCanvas(sourceCanvas);
    if (decoded) {
      const classification = classifyBarcode(decoded.decodedText, decoded.decodedResult);
      if (classification.type === "isbn") {
        disposeCanvas(sourceCanvas);
        sourceCanvas = null;
      }
      await handleDecodedBarcode(decoded.decodedText, decoded.decodedResult, sourceCanvas);
      return;
    }

    const isbn = await recognizeIsbnFromImage(sourceCanvas);
    disposeCanvas(sourceCanvas);
    sourceCanvas = null;
    if (isbn) {
      await lookupRecognizedIsbn(isbn, "Foto-OCR");
      return;
    }

    setStatus("Weder ISBN-Barcode noch gültige gedruckte ISBN erkannt. Fotografiere Barcode und ISBN-Zeile möglichst nah, frontal und scharf.", "error");
  } catch (error) {
    console.warn(error);
    setStatus(`Foto konnte nicht ausgewertet werden: ${error.message || error}`, "error");
  } finally {
    disposeCanvas(sourceCanvas);
    sourceCanvas = null;
    // Dadurch wird auch der ausgewählte File-Verweis sofort freigegeben.
    els.photoInput.value = "";
    els.photoInput.disabled = false;
    if (runId === recognitionRunId && !reviewInProgress && !lookupInProgress) finishRecognition();
  }
}

els.lookupButton.addEventListener("click", () => lookupBook(els.manualIsbn.value));
els.recognitionButton.addEventListener("click", startRecognitionRun);
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
  document.querySelector("#camera-video").scrollIntoView({ behavior: "smooth", block: "start" });
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

window.addEventListener("pagehide", () => {
  releaseCameraTracks();
});

window.addEventListener("beforeunload", () => {
  releaseCameraTracks();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    releaseCameraTracks();
  } else if (!reviewInProgress && !lookupInProgress) {
    setAutoScanState("Kamera ist aus.");
    setStatus("Die Kamera wurde beim Verlassen der App freigegeben. Tippe zum Weiterarbeiten auf „Kamera starten“.");
    updateCameraButton();
  }
});

loadSettings();
loadBatch();
renderBatch();
updatePreview();
setAutoScanState("Kamera ist aus.");
setStatus("Tippe auf „Kamera starten“, um die Vorschau zu öffnen.");
updateRecognitionControls();
updateCameraButton();

const isLocalDevelopment =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";

if ("serviceWorker" in navigator && !isLocalDevelopment) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(console.warn);
  });
} else if ("serviceWorker" in navigator && isLocalDevelopment) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .catch(console.warn);
}
