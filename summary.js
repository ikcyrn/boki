const storageKey = "receipt-book-expenses-v1";

const elements = {
  periodSelect: document.querySelector("#period-select"),
  customRange: document.querySelector("#custom-range"),
  startDate: document.querySelector("#start-date"),
  endDate: document.querySelector("#end-date"),
  applyRange: document.querySelector("#apply-range"),
  periodLabel: document.querySelector("#period-label"),
  summaryTotal: document.querySelector("#summary-total"),
  summaryCount: document.querySelector("#summary-count"),
  dailyAverage: document.querySelector("#daily-average"),
  maxDay: document.querySelector("#max-day"),
  categoryList: document.querySelector("#category-list"),
  calendarGrid: document.querySelector("#calendar-grid"),
  itemsLabel: document.querySelector("#items-label"),
  clearDayFilter: document.querySelector("#clear-day-filter"),
  summaryItemList: document.querySelector("#summary-item-list"),
};

const expenses = readExpenses();
const today = new Date();
let activeStart = "";
let activeEnd = "";
let visibleMonth = toMonthInput(today);
let selectedDay = "";

setPresetRange("this-month");

elements.periodSelect.addEventListener("change", () => {
  selectedDay = "";
  elements.customRange.hidden = elements.periodSelect.value !== "custom";
  setPresetRange(elements.periodSelect.value);
});

elements.applyRange.addEventListener("click", () => {
  const start = elements.startDate.value;
  const end = elements.endDate.value;
  if (!start || !end) {
    return;
  }
  activeStart = start <= end ? start : end;
  activeEnd = start <= end ? end : start;
  visibleMonth = activeEnd.slice(0, 7);
  selectedDay = "";
  renderSummary();
});

elements.clearDayFilter.addEventListener("click", () => {
  selectedDay = "";
  renderSummary();
});

function setPresetRange(value) {
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (value === "this-month") {
    activeStart = toInputDate(new Date(current.getFullYear(), current.getMonth(), 1));
    activeEnd = toInputDate(new Date(current.getFullYear(), current.getMonth() + 1, 0));
  } else if (value === "last-month") {
    activeStart = toInputDate(new Date(current.getFullYear(), current.getMonth() - 1, 1));
    activeEnd = toInputDate(new Date(current.getFullYear(), current.getMonth(), 0));
  } else if (value === "last-7") {
    activeStart = toInputDate(addDays(current, -6));
    activeEnd = toInputDate(current);
  } else if (value === "last-30") {
    activeStart = toInputDate(addDays(current, -29));
    activeEnd = toInputDate(current);
  } else if (value === "custom") {
    activeStart = elements.startDate.value || toInputDate(new Date(current.getFullYear(), current.getMonth(), 1));
    activeEnd = elements.endDate.value || toInputDate(current);
  }

  elements.startDate.value = activeStart;
  elements.endDate.value = activeEnd;
  visibleMonth = activeStart.slice(0, 7);
  renderSummary();
}

function renderSummary() {
  const periodItems = filterByRange(activeStart, activeEnd);
  const visibleItems = selectedDay ? filterByRange(selectedDay, selectedDay) : periodItems;
  const total = periodItems.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

  elements.periodLabel.textContent = `${formatDisplayDate(activeStart)} - ${formatDisplayDate(activeEnd)}`;
  elements.summaryTotal.textContent = formatYen(total);
  elements.summaryCount.textContent = `${periodItems.length}件`;
  elements.dailyAverage.textContent = formatYen(Math.round(total / Math.max(1, getInclusiveDayCount(activeStart, activeEnd))));
  elements.maxDay.textContent = formatMaxDay(periodItems);

  renderCategories(periodItems, total);
  renderCalendar();
  renderItems(visibleItems);
}

function filterByRange(start, end) {
  return expenses
    .filter((expense) => expense.date >= start && expense.date <= end)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""));
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
  const [year, month] = visibleMonth.split("-").map(Number);
  const firstDate = new Date(year, month - 1, 1);
  const lastDate = new Date(year, month, 0);
  const spendingByDate = new Map();

  expenses.forEach((expense) => {
    if (expense.date.slice(0, 7) !== visibleMonth) {
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
    const date = `${visibleMonth}-${String(day).padStart(2, "0")}`;
    const amount = spendingByDate.get(date) || 0;
    const button = document.createElement("button");
    button.className = "calendar-day";
    if (date >= activeStart && date <= activeEnd) {
      button.classList.add("is-selected");
    }
    if (date === selectedDay) {
      button.classList.add("is-focused");
    }
    if (amount > 0) {
      button.classList.add("has-spending");
    }
    button.type = "button";
    button.innerHTML = `<span></span><small></small>`;
    button.querySelector("span").textContent = String(day);
    button.querySelector("small").textContent = amount > 0 ? compactYen(amount) : "";
    button.addEventListener("click", () => inspectDay(date));
    elements.calendarGrid.append(button);
  }
}

function renderItems(items) {
  elements.summaryItemList.innerHTML = "";
  elements.clearDayFilter.hidden = !selectedDay;
  elements.itemsLabel.textContent = selectedDay
    ? `${formatDisplayDate(selectedDay)} の明細です。`
    : "選択期間内の登録済み支出です。";

  if (items.length === 0) {
    elements.summaryItemList.append(createEmptyState("明細はありません"));
    return;
  }

  groupByDate(items).forEach(([date, dateItems]) => {
    const group = document.createElement("article");
    group.className = "summary-date-group";
    const subtotal = dateItems.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    group.innerHTML = `
      <div class="summary-date-heading">
        <strong></strong>
        <span></span>
      </div>
      <div class="summary-date-items"></div>
    `;
    group.querySelector("strong").textContent = formatDisplayDate(date);
    group.querySelector("span").textContent = formatYen(subtotal);

    const list = group.querySelector(".summary-date-items");
    dateItems.forEach((expense) => {
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
      row.querySelector(".summary-item-main span").textContent = expense.category || "その他";
      row.querySelector(".summary-item-right span").textContent = formatYen(Number(expense.amount || 0));
      list.append(row);
    });

    elements.summaryItemList.append(group);
  });
}

function inspectDay(date) {
  if (date < activeStart || date > activeEnd) {
    return;
  }
  selectedDay = selectedDay === date ? "" : date;
  renderSummary();
}

function groupByDate(items) {
  const grouped = new Map();
  items.forEach((expense) => {
    if (!grouped.has(expense.date)) {
      grouped.set(expense.date, []);
    }
    grouped.get(expense.date).push(expense);
  });
  return [...grouped.entries()].sort(([a], [b]) => b.localeCompare(a));
}

function formatMaxDay(items) {
  if (items.length === 0) {
    return "-";
  }

  const grouped = new Map();
  items.forEach((expense) => {
    grouped.set(expense.date, (grouped.get(expense.date) || 0) + Number(expense.amount || 0));
  });
  const [date, amount] = [...grouped.entries()].sort(([, a], [, b]) => b - a)[0];
  return `${formatDisplayDate(date)} ${compactYen(amount)}`;
}

function getInclusiveDayCount(start, end) {
  const startDate = parseInputDate(start);
  const endDate = parseInputDate(end);
  return Math.round((endDate - startDate) / 86400000) + 1;
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

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function parseInputDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
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
