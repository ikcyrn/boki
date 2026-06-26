const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { DocumentProcessorServiceClient } = require("@google-cloud/documentai").v1;

loadEnvFile(path.join(__dirname, ".env"));

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const projectId = process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.GOOGLE_CLOUD_LOCATION;
const processorId = process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID;
const client = new DocumentProcessorServiceClient({
  apiEndpoint: location ? `${location}-documentai.googleapis.com` : undefined,
});

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/receipt/scan") {
      await handleReceiptScan(request, response);
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      await serveStaticFile(request, response);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Internal server error" });
  }
});

server.listen(port, host, () => {
  console.log(`Receipt app running at http://${host}:${port}`);
  if (projectId && location && processorId) {
    console.log(`Document AI processor: projects/${projectId}/locations/${location}/processors/${processorId}`);
    console.log(`Document AI endpoint: ${location}-documentai.googleapis.com`);
  }
});

async function handleReceiptScan(request, response) {
  if (!projectId || !location || !processorId) {
    sendJson(response, 500, {
      error: "Missing Google Document AI environment variables.",
      required: [
        "GOOGLE_CLOUD_PROJECT",
        "GOOGLE_CLOUD_LOCATION",
        "GOOGLE_DOCUMENT_AI_PROCESSOR_ID",
      ],
    });
    return;
  }

  const contentType = request.headers["content-type"] || "";
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1]
    || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) {
    sendJson(response, 400, { error: "Expected multipart/form-data upload." });
    return;
  }

  const body = await readRequestBody(request, 12 * 1024 * 1024);
  const parts = parseMultipartFormData(body, boundary);
  const imagePart = parts.find((part) => part.name === "receipt" || part.name === "image");
  if (!imagePart || !imagePart.data.length) {
    sendJson(response, 400, { error: "Missing receipt image." });
    return;
  }

  const mimeType = imagePart.contentType || detectImageMimeType(imagePart.data);
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(mimeType)) {
    sendJson(response, 400, { error: "Unsupported image type.", mimeType });
    return;
  }

  let text;
  try {
    text = await runDocumentOcr(imagePart.data, mimeType);
  } catch (error) {
    sendGoogleDocumentAiError(response, error);
    return;
  }
  sendJson(response, 200, {
    text,
    parsed: parseReceiptText(text),
  });
}

async function runDocumentOcr(imageBuffer, mimeType) {
  const name = client.processorPath(projectId, location, processorId);
  const [result] = await client.processDocument({
    name,
    rawDocument: {
      content: imageBuffer.toString("base64"),
      mimeType,
    },
  });
  return result.document?.text || "";
}

function sendGoogleDocumentAiError(response, error) {
  console.error(error);
  if (error.code === 12 && /404/.test(error.details || "")) {
    sendJson(response, 502, {
      error: "Google Document AI processor was not found.",
      detail: "Check GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION, and GOOGLE_DOCUMENT_AI_PROCESSOR_ID. The location must match the processor region.",
      processor: `projects/${projectId}/locations/${location}/processors/${processorId}`,
      endpoint: `${location}-documentai.googleapis.com`,
    });
    return;
  }

  sendJson(response, 502, {
    error: "Google Document AI request failed.",
    detail: error.details || error.message || "Unknown Document AI error.",
    code: error.code || null,
  });
}

async function serveStaticFile(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const requestedPath = decodeURIComponent(url.pathname);
  const relativePath = requestedPath === "/" ? "index.html" : requestedPath.replace(/^\/+/, "");
  const resolvedPath = path.resolve(__dirname, relativePath);

  if (!resolvedPath.startsWith(__dirname + path.sep) && resolvedPath !== path.join(__dirname, "index.html")) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  let stat;
  try {
    stat = await fs.promises.stat(resolvedPath);
  } catch {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  if (!stat.isFile()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": mimeTypes[extension] || "application/octet-stream",
    "Content-Length": stat.size,
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  fs.createReadStream(resolvedPath).pipe(response);
}

function parseMultipartFormData(buffer, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let cursor = buffer.indexOf(delimiter);

  while (cursor !== -1) {
    const nextCursor = buffer.indexOf(delimiter, cursor + delimiter.length);
    if (nextCursor === -1) {
      break;
    }

    let part = buffer.subarray(cursor + delimiter.length, nextCursor);
    if (part.subarray(0, 2).equals(Buffer.from("\r\n"))) {
      part = part.subarray(2);
    }
    if (part.subarray(0, 2).equals(Buffer.from("--"))) {
      break;
    }

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd !== -1) {
      const headerText = part.subarray(0, headerEnd).toString("utf8");
      let data = part.subarray(headerEnd + 4);
      if (data.subarray(data.length - 2).equals(Buffer.from("\r\n"))) {
        data = data.subarray(0, data.length - 2);
      }
      const disposition = headerText.match(/content-disposition:\s*([^\r\n]+)/i)?.[1] || "";
      const name = disposition.match(/name="([^"]+)"/)?.[1] || "";
      const filename = disposition.match(/filename="([^"]*)"/)?.[1] || "";
      const contentType = headerText.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || "";
      parts.push({ name, filename, contentType, data });
    }

    cursor = nextCursor;
  }

  return parts;
}

function readRequestBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Upload too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function detectImageMimeType(buffer) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return "image/jpeg";
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return "application/octet-stream";
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) {
      continue;
    }
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function parseReceiptText(text) {
  const normalized = normalizeReceiptText(text);
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  return {
    date: parseDate(normalized),
    store: parseStore(lines),
    amount: parseAmount(normalized),
    category: guessCategory(normalized),
    needsReview: !parseDate(normalized) || !parseStore(lines) || !parseAmount(normalized),
  };
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

function amountAfterLabel(line, label) {
  const labelMatch = line.match(label);
  const target = labelMatch ? line.slice(labelMatch.index + labelMatch[0].length) : line;
  const amounts = amountsFromLine(target);
  if (amounts.length) {
    return amounts[0];
  }
  const fallbackAmounts = amountsFromLine(line);
  return fallbackAmounts.length ? fallbackAmounts[fallbackAmounts.length - 1] : "";
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

function formatDateParts(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
