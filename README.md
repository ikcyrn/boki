# レシート帳

Mobile-first static web app for people in Japan to scan receipts and record spending by date.

## Run

Open `index.html` directly in a browser, or serve the directory with any static server.

```sh
python3 -m http.server 4173
```

Then open `http://127.0.0.1:4173`.

## Notes

- Receipt images can be selected from the camera or photo library.
- If the browser supports the experimental `TextDetector` API, detected receipt text is parsed automatically.
- If OCR is unavailable, paste receipt text into the 読み取り文字 field or use 見本入力.
- Spending records are saved in browser `localStorage` and grouped automatically by receipt date.
