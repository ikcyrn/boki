const storageKey = "receipt-book-expenses-v1";

const elements = {
  monthSelect: document.querySelector("#month-select"),
  startDate: document.querySelector("#start-date"),
  endDate: document.querySelector("#end-date"),
  applyRange: document.querySelector("#apply-range"),
  periodLabel: document.querySelector("#period-label"),
  summaryTotal: document.querySelector("#summary-total"),
  summaryCount: document.querySelector("#summary-count"),
  categoryList: document.querySelector("#category-list"),
  calendarGrid: document.querySelector("#calendar-grid"),
  summaryItemList: document.querySelector("#summary-item-list"),
};

const expenses = readExpenses();
const today = new Date();
let activeStart = "";
let activeEnd = "";
let pendingCalendarStart = "";

elements.monthSelect.value = toMonthInput(today);
setMonthRange(elements.monthSelect.value);

elements.monthSelect.addEventListener("change", () => {
  setMonthRange(elements.monthSelect.value);
});

elements.applyRange.addEventListener("click", () => {
  const start = elements.startDate.value;
  const end = elements.endDate.value;
  if (!start || !end) {
    return;
  }
  activeStart = start <= end ? start : end;
  activeEnd = start <= end ? end : start;
  pendingCalendarStart = "";
  renderSummary();
});

function setMonthRange(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  activeStart = `${monthValue}-01`;
  activeEnd = toInputDate(new Date(year, month, 0));
  elements.startDate.value = activeStart;
  elements.endDate.value = activeEnd;
  pendingCalendarStart = "";
  renderSummary();
}

function renderSummary() {
  const filtered = expenses
    .filter((expense) => expense.date >= activeStart && expense.date <= activeEnd)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const total = filtered.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

  elements.periodLabel.textContent = `${formatDisplayDate(activeStart)} - ${formatDisplayDate(activeEnd)}`;
  elements.summaryTotal.textContent = formatYen(total);
  elements.summaryCount.textContent = `${filtered.length}件`;

  renderCategories(filtered, total);
  renderCalendar();
  renderItems(filtered);
}

function renderCategories(items, total) {
  elements.categoryList.innerHTML = "";
  if (items.length === 0) {
    elements.categoryList.append(createEmptyState("この期間の支出はありません"));
    return;
  }

  const grouped = new Map();
  items.forEach((expense) => {
    const category = expense.category || "その他";
    grouped.set(category, (grouped.get(category) || 0) + Number(expense.amount || 0));
  });

  [...grouped.entries()]
    .sort(([, a], [, b]) => b - a)
    .forEach(([category, amount]) => {
      const row = document.createElement("div");
      row.className = "category-row";
      const percent = total > 0 ? Math.round((amount / total) * 100) : 0;
      row.innerHTML = `
        <div class="category-row-top">
          <div>
            <strong></strong>
            <small></small>
          </div>
          <span></span>
        </div>
        <div class="category-bar"><span></span></div>
      `;
      row.querySelector("strong").textContent = category;
      row.querySelector("small").textContent = `${percent}%`;
      row.querySelector(".category-row-top span").textContent = formatYen(amount);
      row.querySelector(".category-bar span").style.width = `${percent}%`;
      elements.categoryList.append(row);
    });
}

function renderCalendar() {
  elements.calendarGrid.innerHTML = "";
  const monthValue = elements.monthSelect.value || activeStart.slice(0, 7);
  const [year, month] = monthValue.split("-").map(Number);
  const firstDate = new Date(year, month - 1, 1);
  const lastDate = new Date(year, month, 0);
  const spendingByDate = new Map();

  expenses.forEach((expense) => {
    if (expense.date.slice(0, 7) !== monthValue) {
      return;
    }
    spendingByDate.set(expense.date, (spendingByDate.get(expense.date) || 0) + Number(expense.amount || 0));
  });

  ["日", "月", "火", "水", "木", "金", "土"].forEach((label) => {
    const cell = document.createElement("div");
    cell.className = "calendar-weekday";
    cell.textContent = label;
    elements.calendarGrid.append(cell);
  });

  for (let index = 0; index < firstDate.getDay(); index += 1) {
    const blank = document.createElement("div");
    blank.className = "calendar-day is-blank";
    elements.calendarGrid.append(blank);
  }

  for (let day = 1; day <= lastDate.getDate(); day += 1) {
    const date = `${monthValue}-${String(day).padStart(2, "0")}`;
    const amount = spendingByDate.get(date) || 0;
    const button = document.createElement("button");
    button.className = "calendar-day";
    if (date >= activeStart && date <= activeEnd) {
      button.classList.add("is-selected");
    }
    if (amount > 0) {
      button.classList.add("has-spending");
    }
    button.type = "button";
    button.innerHTML = `<span></span><small></small>`;
    button.querySelector("span").textContent = String(day);
    button.querySelector("small").textContent = amount > 0 ? compactYen(amount) : "";
    button.addEventListener("click", () => selectCalendarDate(date));
    elements.calendarGrid.append(button);
  }
}

function renderItems(items) {
  elements.summaryItemList.innerHTML = "";
  if (items.length === 0) {
    elements.summaryItemList.append(createEmptyState("明細はありません"));
    return;
  }

  items.forEach((expense) => {
    const row = document.createElement("div");
    row.className = "summary-item";
    row.innerHTML = `
      <div class="summary-item-main">
        <strong></strong>
        <span></span>
      </div>
      <div class="summary-item-right">
        <span></span>
      </div>
    `;
    row.querySelector("strong").textContent = expense.store || "未入力";
    row.querySelector(".summary-item-main span").textContent = `${formatDisplayDate(expense.date)} / ${expense.category || "その他"}`;
    row.querySelector(".summary-item-right span").textContent = formatYen(Number(expense.amount || 0));
    elements.summaryItemList.append(row);
  });
}

function selectCalendarDate(date) {
  if (!pendingCalendarStart) {
    activeStart = date;
    activeEnd = date;
    pendingCalendarStart = date;
  } else if (date < pendingCalendarStart) {
    activeStart = date;
    activeEnd = pendingCalendarStart;
    pendingCalendarStart = "";
  } else {
    activeStart = pendingCalendarStart;
    activeEnd = date;
    pendingCalendarStart = "";
  }
  elements.startDate.value = activeStart;
  elements.endDate.value = activeEnd;
  renderSummary();
}

function createEmptyState(text) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = text;
  return empty;
}

function readExpenses() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toMonthInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function toInputDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDisplayDate(date) {
  if (!date) {
    return "";
  }
  const [year, month, day] = date.split("-");
  return `${year}/${month}/${day}`;
}

function formatYen(value) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}

function compactYen(value) {
  if (value >= 10000) {
    return `${Math.round(value / 1000) / 10}万`;
  }
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}
