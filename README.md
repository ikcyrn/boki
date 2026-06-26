# レシート帳

Mobile-first static web app for people in Japan to scan receipts and record spending by date.

## Run

Create `.env` with your Document AI processor values:

```sh
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=us
GOOGLE_DOCUMENT_AI_PROCESSOR_ID=your-processor-id
```

Install dependencies and start the backend/static server:

```sh
npm install
npm start
```

Then open `http://127.0.0.1:4173`.

Do not use `python3 -m http.server` for OCR scanning. It can serve the page, but it cannot handle `POST /api/receipt/scan`.

For local Google authentication, either run:

```sh
gcloud auth application-default login
```

or set:

```sh
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

## Notes

- Receipt images can be selected from the camera or photo library.
- Japanese OCR uses Google Document AI Enterprise Document OCR through the local backend.
- Browser-side Tesseract.js and `TextDetector` remain as fallbacks when the backend is unavailable.
- A small local worker wrapper filters harmless Tesseract Japanese trained-data warnings from DevTools.
- Receipt images are enlarged and converted to high-contrast black and white before OCR. Best results come from flat, well-lit receipts with the whole receipt visible.
- If OCR is unavailable or inaccurate, paste receipt text into the 読み取り文字 field and it will be parsed again.
- Spending records are saved in browser `localStorage` and grouped automatically by receipt date.
