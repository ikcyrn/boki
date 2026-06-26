const storageKey = "receipt-book-expenses-v1";

const elements = {
  fileInput: document.querySelector("#receipt-image"),
  readButton: document.querySelector("#read-button"),
  scanStatus: document.querySelector("#scan-status"),
  form: document.querySelector("#expense-form"),
  date: document.querySelector("#expense-date"),
  store: document.querySelector("#expense-store"),
  amount: document.querySelector("#expense-amount"),
  category: document.querySelector("#expense-category"),
  ocrText: document.querySelector("#ocr-text"),
  clearForm: document.querySelector("#clear-form"),
  grandTotal: document.querySelector("#grand-total"),
  dateList: document.querySelector("#date-list"),
  dateGroupTemplate: document.querySelector("#date-group-template"),
  expenseTemplate: document.querySelector("#expense-template"),
};

let expenses = readExpenses();
let currentImageName = "";

elements.date.value = toInputDate(new Date());
renderExpenses();

elements.fileInput.addEventListener("change", () => {
  const file = elements.fileInput.files?.[0];
  if (!file) {
    return;
  }

  currentImageName = file.name;
  elements.readButton.disabled = false;
  elements.scanStatus.textContent = `${file.name} を受け付けました。読み取り開始を押してください。`;
});

elements.readButton.addEventListener("click", async () => {
  elements.scanStatus.textContent = "読み取り中... 初回は少し時間がかかります。";
  elements.readButton.disabled = true;

  const scanResult = await scanReceiptImage();
  const fallbackText = scanResult.text || buildFallbackTextFromFileName(currentImageName);
  elements.ocrText.value = fallbackText;
  applyParsedText(fallbackText, scanResult.parsed);

  elements.scanStatus.textContent = scanResult.text
      ? "読み取り完了。内容を確認して登録してください。"
      : "端末のOCRが使えないため、画像名から候補を入力しました。内容を確認してください。";
  elements.readButton.disabled = true;
});

elements.ocrText.addEventListener("input", () => {
  applyParsedText(elements.ocrText.value);
});

elements.clearForm.addEventListener("click", () => {
  elements.form.reset();
  elements.date.value = toInputDate(new Date());
  elements.ocrText.value = "";
});

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();

  const expense = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    date: elements.date.value,
    store: elements.store.value.trim(),
    amount: Number(elements.amount.value),
    category: elements.category.value,
    createdAt: new Date().toISOString(),
  };

  if (!expense.date || !expense.store || !Number.isFinite(expense.amount) || expense.amount <= 0) {
    elements.scanStatus.textContent = "日付・店名・金額を確認してください。";
    return;
  }

  expenses = [expense, ...expenses];
  writeExpenses(expenses);
  renderExpenses();
  elements.form.reset();
  elements.date.value = expense.date;
  elements.ocrText.value = "";
  elements.scanStatus.textContent = "登録しました。日付別一覧に反映済みです。";
});

async function scanReceiptImage() {
  const file = elements.fileInput.files?.[0];
  if (!file) {
    return { text: "", parsed: null, source: "none" };
  }

  const backendResult = await scanWithBackend(file);
  if (backendResult.text) {
    return backendResult;
  }
  if (backendResult.status === 501 || backendResult.status === 405) {
    elements.scanStatus.textContent = "Nodeバックエンドではなく静的サーバーが動いています。npm startで起動してください。";
  }

  const tesseractText = await detectWithTesseract(file);
  if (tesseractText) {
    return { text: tesseractText, parsed: null, source: "tesseract" };
  }

  const textDetectorText = await detectWithTextDetector(file);
  return { text: textDetectorText, parsed: null, source: "text-detector" };
}

async function scanWithBackend(file) {
  try {
    const formData = new FormData();
    formData.append("receipt", file);
    const response = await fetch("/api/receipt/scan", {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      return { text: "", parsed: null, source: "backend", status: response.status };
    }
    const result = await response.json();
    return {
      text: result.text || "",
      parsed: result.parsed || null,
      source: "backend",
      status: response.status,
    };
  } catch {
    return { text: "", parsed: null, source: "backend", status: 0 };
  }
}

async function detectWithTesseract(file) {
  if (!window.Tesseract) {
    return "";
  }

  let worker;
  try {
    const imageSources = await buildOcrImageSources(file);
    worker = await window.Tesseract.createWorker("jpn+eng", 1, {
      workerPath: "./tesseract-worker-filter.js",
      logger: (message) => {
        if (message.status === "recognizing text" && message.progress) {
          elements.scanStatus.textContent = `読み取り中... ${Math.round(message.progress * 100)}%`;
        }
      },
      errorHandler: (message) => {
        if (!isKnownTesseractParameterWarning(message)) {
          console.warn(message);
        }
      },
    });
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: "6",
    });

    let bestText = "";
    let bestScore = -1;
    for (const source of imageSources) {
      const result = await worker.recognize(source.image);
      const text = result.data.text.trim();
      const parsed = parseReceiptText(text);
      const score = scoreParsedReceipt(parsed, text) + source.bonus;
      if (score > bestScore) {
        bestText = text;
        bestScore = score;
      }
      if (parsed.date && parsed.store && parsed.amount) {
        break;
      }
    }
    return bestText;
  } catch {
    return "";
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        // The recognition result is more important than cleanup telemetry.
      }
    }
  }
}

function isKnownTesseractParameterWarning(message) {
  return typeof message === "string" && /Parameter not found: (language_model_|segsearch_|classify_|assume_|chop_|allow_blob_)/.test(message);
}

async function buildOcrImageSources(file) {
  let processed = null;
  try {
    processed = await preprocessReceiptImage(file);
  } catch {
    processed = null;
  }
  if (!processed) {
    return [{ image: file, bonus: 0 }];
  }
  return [
    { image: processed, bonus: 2 },
    { image: file, bonus: 0 },
  ];
}

async function preprocessReceiptImage(file) {
  const bitmap = await createImageBitmap(file);
  const maxWidth = 1800;
  const scale = Math.min(3, Math.max(1.5, maxWidth / bitmap.width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  let total = 0;
  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    total += gray;
  }
  const average = total / (data.length / 4);
  const threshold = Math.max(138, Math.min(188, average * 0.88));
  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    const contrasted = gray < threshold ? 0 : 255;
    data[index] = contrasted;
    data[index + 1] = contrasted;
    data[index + 2] = contrasted;
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

async function detectWithTextDetector(file) {
  if (!("TextDetector" in window)) {
    return "";
  }

  try {
    const bitmap = await createImageBitmap(file);
    const detector = new window.TextDetector();
    const results = await detector.detect(bitmap);
    return results.map((item) => item.rawValue).join("\n");
  } catch {
    return "";
  }
}

function applyParsedText(text, preferredParsed = null) {
  const localParsed = parseReceiptText(text);
  const backendParsed = normalizeParsedReceipt(preferredParsed);
  const parsed = backendParsed ? {
    date: backendParsed.date || localParsed.date,
    store: backendParsed.store || localParsed.store,
    amount: backendParsed.amount || localParsed.amount,
    category: backendParsed.category || localParsed.category,
    needsReview: backendParsed.needsReview || localParsed.needsReview,
  } : localParsed;
  if (parsed.date) {
    elements.date.value = parsed.date;
  }
  if (parsed.store) {
    elements.store.value = parsed.store;
  }
  if (parsed.amount) {
    elements.amount.value = parsed.amount;
  }
  elements.category.value = parsed.category || guessCategory(parsed.store || text);
  return parsed;
}

function normalizeParsedReceipt(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const amount = Number(parsed.amount);
  return {
    date: parsed.date || "",
    store: parsed.store || "",
    amount: Number.isFinite(amount) && amount > 0 ? amount : "",
    category: parsed.category || "",
    needsReview: Boolean(parsed.needsReview),
  };
}

function parseReceiptText(text) {
  const normalized = normalizeReceiptText(text);
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  return {
    date: parseDate(normalized),
    store: parseStore(lines),
    amount: parseAmount(normalized),
  };
}

function scoreParsedReceipt(parsed, text) {
  let score = 0;
  if (parsed.date) {
    score += 4;
  }
  if (parsed.store) {
    score += 3;
  }
  if (parsed.amount) {
    score += 5;
  }
  if (/合計|税込|お買上|現計|お支払/.test(text)) {
    score += 2;
  }
  if (/お預|預り|釣|ポイント|消費税/.test(text)) {
    score += 1;
  }
  return score;
}

function normalizeReceiptText(text) {
  return text
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")
    .replace(/[¥￥]/g, "¥")
    .replace(/[，、]/g, ",")
    .replace(/[−ー―]/g, "-")
    .replace(/[|]/g, "1")
    .replace(/([0-9])\s+([0-9])/g, "$1$2")
    .replace(/\s+(円|¥)/g, "$1")
    .replace(/(合)\s+(計)/g, "$1$2")
    .replace(/(小)\s+(計)/g, "$1$2")
    .replace(/(現)\s+(計)/g, "$1$2");
}

function parseDate(text) {
  const japaneseDate = text.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (japaneseDate) {
    return formatDateParts(japaneseDate[1], japaneseDate[2], japaneseDate[3]);
  }

  const eraDate = text.match(/(?:令和|R)\s*(\d{1,2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})/i);
  if (eraDate) {
    return formatDateParts(String(2018 + Number(eraDate[1])), eraDate[2], eraDate[3]);
  }

  const fullYearDate = text.match(/(20\d{2})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})/);
  if (fullYearDate) {
    return formatDateParts(fullYearDate[1], fullYearDate[2], fullYearDate[3]);
  }

  const shortDate = text.match(/\b(\d{2})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})\b/);
  if (shortDate) {
    const year = Number(shortDate[1]) >= 80 ? `19${shortDate[1]}` : `20${shortDate[1]}`;
    return formatDateParts(year, shortDate[2], shortDate[3]);
  }

  return "";
}

function parseStore(lines) {
  const chainLine = lines.find((item) => /セブン|ローソン|ファミリー|ファミマ|ミニストップ|イオン|西友|ライフ|マルエツ|まいばす|サミット|オーケー|成城石井|ドン.?キ|マツモトキヨシ|スギ薬局|ウエルシア|ツルハ|ココカラ|無印|ニトリ|ダイソー|キャンドゥ|スターバックス|ドトール|マクドナルド|吉野家|松屋|すき家/.test(item));
  if (chainLine) {
    return cleanStoreName(chainLine);
  }

  const ignored = /領収|レシート|登録番号|事業者|電話|tel|〒|住所|合計|小計|税|対象|現計|釣銭|釣り|お預|預り|クレジット|電子マネー|ポイント|明細|単価|数量|担当|責任者|毎度|ありがとう|http|www/i;
  const line = lines.find((item) => {
    const compact = item.replace(/\s/g, "");
    return compact.length >= 2
      && /[ぁ-んァ-ヶ一-龠A-Za-z]/.test(compact)
      && !ignored.test(compact)
      && !/\d{2,4}[年./-]\d{1,2}/.test(compact)
      && !/^[0-9,¥()\-\s]+$/.test(compact);
  });
  return line ? line.slice(0, 40) : "";
}

function cleanStoreName(line) {
  return line
    .replace(/領収書|レシート/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 40);
}

function parseAmount(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const priorityLabels = [
    /(?:税込|税こみ|内税)?\s*(?:総)?合計/,
    /お買上(?:げ)?計/,
    /お支払(?:い)?金額/,
    /請求金額/,
    /現計/,
    /合\s*計/,
  ];
  const excluded = /小計|税額|消費税|対象|預|釣|おつり|返金|ポイント|残高|割引|値引|クーポン|クレジット|電子マネー|交通系|WAON|nanaco|PayPay|楽天|d払い|au PAY/i;

  for (const label of priorityLabels) {
    for (let index = 0; index < lines.length; index += 1) {
      if (!label.test(lines[index])) {
        continue;
      }
      const joined = [lines[index], lines[index + 1], lines[index + 2]].filter(Boolean).join(" ");
      const amount = amountAfterLabel(joined, label);
      if (amount) {
        return amount;
      }
    }
  }

  const yenAmounts = lines
    .filter((line) => !excluded.test(line))
    .flatMap((line) => amountsFromLine(line))
    .filter((amount) => amount >= 10);

  if (yenAmounts.length) {
    return Math.max(...yenAmounts);
  }

  const numericTotal = text.match(/(?:合計|現計|税込)[^\d]{0,8}([0-9]{2,3}(?:,[0-9]{3})+|[0-9]{2,7})/);
  if (numericTotal) {
    return Number(numericTotal[1].replace(/,/g, ""));
  }

  return "";
}

function amountFromLine(line) {
  const amounts = amountsFromLine(line);
  return amounts.length ? amounts[amounts.length - 1] : "";
}

function amountAfterLabel(line, label) {
  const labelMatch = line.match(label);
  const target = labelMatch ? line.slice(labelMatch.index + labelMatch[0].length) : line;
  const amounts = amountsFromLine(target);
  if (amounts.length) {
    return amounts[0];
  }
  return amountFromLine(line);
}

function amountsFromLine(line) {
  const amounts = [];
  const amountPattern = /(?:¥\s*)?([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{2,7})\s*(?:円)?/g;
  let match = amountPattern.exec(line);
  while (match) {
    const amount = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(amount)) {
      amounts.push(amount);
    }
    match = amountPattern.exec(line);
  }
  return amounts;
}

function guessCategory(source) {
  const text = source.toLowerCase();
  if (/jr|電鉄|地下鉄|taxi|タクシー|交通|バス|pasmo|suica/.test(text)) {
    return "交通";
  }
  if (/薬|病院|クリニック|歯科|処方|ドラッグ/.test(text)) {
    return "医療";
  }
  if (/コンビニ|セブン|ローソン|ファミリーマート|スーパー|食品|弁当|カフェ|珈琲|coffee|restaurant|レストラン/.test(text)) {
    return "食費";
  }
  if (/無印|ニトリ|ダイソー|キャンドゥ|ホームセンター|日用品/.test(text)) {
    return "日用品";
  }
  if (/居酒屋|映画|カラオケ|チケット/.test(text)) {
    return "交際費";
  }
  if (/文具|郵便|コピー|印刷|出張|会議/.test(text)) {
    return "仕事";
  }
  return "その他";
}

function renderExpenses() {
  elements.dateList.innerHTML = "";
  const grouped = groupByDate(expenses);
  const grandTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  elements.grandTotal.textContent = formatYen(grandTotal);

  if (grouped.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "まだ登録がありません";
    elements.dateList.append(empty);
    return;
  }

  grouped.forEach(([date, items]) => {
    const group = elements.dateGroupTemplate.content.firstElementChild.cloneNode(true);
    const total = items.reduce((sum, expense) => sum + expense.amount, 0);
    group.querySelector(".date-label").textContent = formatDisplayDate(date);
    group.querySelector(".date-total").textContent = formatYen(total);

    const list = group.querySelector(".expense-list");
    items.forEach((expense) => {
      const row = elements.expenseTemplate.content.firstElementChild.cloneNode(true);
      row.querySelector(".expense-store").textContent = expense.store;
      row.querySelector(".expense-category").textContent = expense.category;
      row.querySelector(".expense-amount").textContent = formatYen(expense.amount);
      row.querySelector(".delete-button").addEventListener("click", () => deleteExpense(expense.id));
      list.append(row);
    });

    group.querySelector(".date-toggle").addEventListener("click", () => {
      list.hidden = !list.hidden;
    });
    elements.dateList.append(group);
  });
}

function deleteExpense(id) {
  expenses = expenses.filter((expense) => expense.id !== id);
  writeExpenses(expenses);
  renderExpenses();
}

function groupByDate(items) {
  const map = new Map();
  items.forEach((expense) => {
    if (!map.has(expense.date)) {
      map.set(expense.date, []);
    }
    map.get(expense.date).push(expense);
  });
  return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
}

function readExpenses() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeExpenses(nextExpenses) {
  localStorage.setItem(storageKey, JSON.stringify(nextExpenses));
}

function buildFallbackTextFromFileName(fileName) {
  const baseName = fileName.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
  return [
    baseName || "レシート",
    toInputDate(new Date()).replace(/-/g, "/"),
    "合計 ¥0",
  ].join("\n");
}

function formatDateParts(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function toInputDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDisplayDate(date) {
  const [year, month, day] = date.split("-");
  const weekday = new Intl.DateTimeFormat("ja-JP", { weekday: "short" }).format(new Date(date));
  return `${year}年${month}月${day}日(${weekday})`;
}

function formatYen(value) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}
