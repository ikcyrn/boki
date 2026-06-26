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
let lastScanSignature = "";

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
  elements.scanStatus.textContent = "読み取り中...";
  elements.readButton.disabled = true;

  const detectedText = await detectTextFromImage();
  const fallbackText = detectedText || buildFallbackTextFromFileName(currentImageName);
  elements.ocrText.value = fallbackText;
  const parsed = applyParsedText(fallbackText);
  const recorded = autoRecordParsedExpense(parsed, fallbackText);

  elements.scanStatus.textContent = recorded
    ? "読み取り完了。支出を自動登録しました。"
    : detectedText
      ? "読み取り完了。金額が不明なため、内容を確認して登録してください。"
      : "端末のOCRが使えないため、画像名から候補を入力しました。本文欄に文字を貼ると再抽出できます。";
  elements.readButton.disabled = false;
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

async function detectTextFromImage() {
  const file = elements.fileInput.files?.[0];
  if (!file || !("TextDetector" in window)) {
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

function applyParsedText(text) {
  const parsed = parseReceiptText(text);
  if (parsed.date) {
    elements.date.value = parsed.date;
  }
  if (parsed.store) {
    elements.store.value = parsed.store;
  }
  if (parsed.amount) {
    elements.amount.value = parsed.amount;
  }
  elements.category.value = guessCategory(parsed.store || text);
  return parsed;
}

function autoRecordParsedExpense(parsed, sourceText) {
  const date = parsed.date || elements.date.value;
  const store = parsed.store || "レシート";
  const amount = Number(parsed.amount);
  if (!date || !Number.isFinite(amount) || amount <= 0) {
    return false;
  }

  const signature = `${date}|${store}|${amount}|${sourceText.slice(0, 120)}`;
  if (signature === lastScanSignature) {
    return false;
  }

  lastScanSignature = signature;
  expenses = [{
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    date,
    store,
    amount,
    category: guessCategory(`${store}\n${sourceText}`),
    createdAt: new Date().toISOString(),
  }, ...expenses];
  writeExpenses(expenses);
  renderExpenses();
  return true;
}

function parseReceiptText(text) {
  const normalized = text
    .replace(/[，]/g, ",")
    .replace(/[￥]/g, "¥")
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  return {
    date: parseDate(normalized),
    store: parseStore(lines),
    amount: parseAmount(normalized),
  };
}

function parseDate(text) {
  const japaneseDate = text.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (japaneseDate) {
    return formatDateParts(japaneseDate[1], japaneseDate[2], japaneseDate[3]);
  }

  const slashDate = text.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  if (slashDate) {
    return formatDateParts(slashDate[1], slashDate[2], slashDate[3]);
  }

  const shortDate = text.match(/(\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  if (shortDate) {
    return formatDateParts(`20${shortDate[1]}`, shortDate[2], shortDate[3]);
  }

  return "";
}

function parseStore(lines) {
  const ignored = /領収|レシート|登録番号|電話|tel|合計|小計|税|対象|現計|釣銭|お預り/i;
  const line = lines.find((item) => item.length >= 2 && !ignored.test(item) && !/\d{4}[年./-]/.test(item));
  return line ? line.slice(0, 40) : "";
}

function parseAmount(text) {
  const candidates = [];
  const totalLinePattern = /(合計|総合計|お買上計|税込|現計)[^\d¥]*(?:¥)?\s*([0-9][0-9,]*)/g;
  let match = totalLinePattern.exec(text);
  while (match) {
    candidates.push(Number(match[2].replace(/,/g, "")));
    match = totalLinePattern.exec(text);
  }

  if (candidates.length === 0) {
    const amountPattern = /(?:¥|円\s*)\s*([0-9][0-9,]*)|([0-9][0-9,]*)\s*円/g;
    match = amountPattern.exec(text);
    while (match) {
      candidates.push(Number((match[1] || match[2]).replace(/,/g, "")));
      match = amountPattern.exec(text);
    }
  }

  return candidates.length ? Math.max(...candidates) : "";
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
