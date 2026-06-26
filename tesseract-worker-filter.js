const originalWarn = console.warn.bind(console);
const originalError = console.error.bind(console);

function isKnownTesseractParameterWarning(value) {
  return typeof value === "string"
    && /Parameter not found: (language_model_|segsearch_|classify_|assume_|chop_|allow_blob_)/.test(value);
}

console.warn = (...args) => {
  if (!args.some(isKnownTesseractParameterWarning)) {
    originalWarn(...args);
  }
};

console.error = (...args) => {
  if (!args.some(isKnownTesseractParameterWarning)) {
    originalError(...args);
  }
};

importScripts("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js");
