const els = {
  vault: document.querySelector("#vault"),
  folder: document.querySelector("#folder"),
  googleApiKey: document.querySelector("#google-api-key"),
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
  genres: document.querySelector("#genres"),
  subjects: document.querySelector("#subjects"),
  ownership: document.querySelector("#ownership"),
  readingStatus: document.querySelector("#reading-status"),
  obsidianButton: document.querySelector("#obsidian-button"),
  copyButton: document.querySelector("#copy-button"),
  markdownPreview: document.querySelector("#markdown-preview"),
};

let lastScanned = "";
let lookupInProgress = false;
let currentMetadataSource = "manual";

function setStatus(message, kind = "") {
  els.status.textContent = message;
  els.status.className = `status ${kind}`.trim();
}

function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeIsbn(value) {
  const raw = String(value ?? "").trim();
  const compact = raw.replace(/[\s-]/g, "");
  if (/^\d{9}[\dXx]$/.test(compact)) return isbn10To13(compact);
  return digitsOnly(compact);
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

  appendYamlList(lines, "genres", book.genres);
  appendYamlList(lines, "subjects", book.subjects);

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
    `metadata_source: ${currentMetadataSource}`,
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
  els.resultCard.classList.remove("hidden");
  updatePreview();
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
els.googleApiKey.addEventListener("change", saveSettings);

for (const input of els.resultCard.querySelectorAll("input, select, textarea")) {
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
