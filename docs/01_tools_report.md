# 1. Technical Tools Report

For every tool: what it is used for, how it was tested **in real life** during this project, the result, and the verdict.
Items marked **☐ to confirm** must be tried by the team on their own devices before submission (the assignment asks for real-life testing).

## 1.1 Summary

| Area | Tool chosen | Alternatives looked at | Verdict |
|---|---|---|---|
| Backend | Python 3 standard library (`http.server`, `ThreadingMixIn`, `hmac`, `json`, `csv`) | Flask, FastAPI, Node/Express | ✅ Chosen – zero install, enough for 300 concurrent students |
| Public HTTPS for phones | **Cloudflare quick tunnel** (`cloudflared`) | Self-signed HTTPS on the LAN (`--https`), ngrok | ✅ Chosen – trusted certificate, any network |
| Self-signed HTTPS | OpenSSL + Python `ssl` (`--https`) | — | ⚠️ Kept as option C – **iPhone Safari blocks location** on it |
| QR generation | qrcode.js (bundled) | Google Charts API (deprecated), server-side PNG | ✅ Works offline |
| QR scanning | Native `BarcodeDetector` → fallback **jsQR** (bundled) | ZXing, html5-qrcode | ✅ Works on iOS Safari (jsQR) and Chrome (native) |
| Location | Browser **Geolocation API** + Haversine | IP geolocation, Bluetooth beacons | ✅ Accurate on phones; needs permission |
| Location fallback | Same-network check (client IP) | Wi-Fi SSID (not readable by browsers) | ✅ No permission needed |
| Head count | **face-api** (TensorFlow.js, SSD-MobileNet-v1) in the browser | Server OpenCV, MediaPipe, browser `FaceDetector` (experimental) | ✅ Chosen – no server dependency, photo stays private |
| Online spreadsheet | **Google Sheets `IMPORTDATA`** + CSV endpoint | Google Sheets API (OAuth), Excel Online | ✅ No account linking needed |
| UI styling | Tailwind CSS v4, **compiled locally** into `static/css/tailwind.css` (+ theme in `custom.css`) | Tailwind CDN (needs internet in class), Bootstrap, plain CSS | ✅ Styled even without internet; rebuilt with `tools/build_css.mjs` |
| Lecture video summary (LLM) | **Google Gemini API** – Files API + `generateContent` with a JSON schema (`GeminiClient`, standard library only) | OpenAI Whisper + GPT (two steps, audio only), self-hosted Whisper (slow on a laptop) | ✅ Chosen – one call watches video *and* audio, free tier, files up to 2 GB |
| Testing | `unittest`, custom HTTP load test, Playwright | pytest, Locust, Selenium | ✅ |
| AI-assisted coding | LLM coding assistant ("vibe coding") | — | ✅ used for implementation; design reviewed by the team |

## 1.2 Details and real-life results

### Python standard-library HTTP server
- **Test:** `tests/load_test.py` – 150 and 300 virtual students checking in at the same moment while the instructor polls.
- **Result:** 150 students → 483 requests in 0.65 s, **0 failures**, p95 check-in 248 ms. 300 students → 1,084 requests in 1.36 s, **0 failures**.
- **Finding:** Python's default listen backlog (5) refuses bursts → raised to 512. A phone that stops at a certificate warning could freeze the HTTPS server → TLS handshake moved into the request thread (verified fixed).

### Google Gemini (video summaries)
- **Test:** `tests/fake_gemini.py` emulates the API locally (upload, processing state, `generateContent`, a retired model returning 404); `TestGeminiVideoPipeline` and a browser run with a real 20-second MP4 go through the whole flow.
- **Result:** upload → *processing* → Hebrew summary with chapters in the UI; chapter click seeks the player; Q&A answers with a timestamp.
- **Findings:** Cloudflare's free tunnel rejects bodies over 100 MB and cuts responses after 100 s → the summary runs as a **background job** that the page polls, and long recordings are uploaded via `localhost`. Model names are retired over time → the client falls back to the next model on 404. Without a key the feature shows a labelled **demo mode** instead of pretending.

### Cloudflare quick tunnel (`python3 server.py --tunnel`)
- **Test:** laptop + real phones on different networks (Wi-Fi and mobile data).
- **Result:** ✅ public `https://….trycloudflare.com` link; trusted certificate; QR deep links work from the phone camera app. The link changes on every restart.

### Self-signed HTTPS (`--https`)
- **Test:** real iPhone on the same Wi-Fi.
- **Result:** ⚠️ page opens after accepting the warning, but **Safari refuses location**. Android Chrome works after *Advanced → Proceed*. → Recommended mode is the tunnel.

### Geolocation API (real iPhone)
- **Test:** real iPhone, `--tunnel` link.
- **Result:** at first every request failed with *permission denied*. Cause: the phone's settings (*Location Services → Safari Websites* / *Safari → Location*). After changing the setting it worked. The app now:
  - requests location directly inside the user's tap (Safari only prompts then);
  - keeps location as a separate step from the camera;
  - shows phone-specific steps and a standalone `/gps` test page;
  - offers the Wi-Fi check and instructor approval as fallbacks.

### QR: qrcode.js + jsQR / BarcodeDetector
- **Test:** projected QR scanned by phone cameras; automated test with a fake camera feeding the projected QR into Chrome.
- **Result:** ✅ decoded in < 1 s; 20-second rotation; old screenshots rejected after ~40 s.

### face-api (TensorFlow.js) – photo head count
- **Test so far:** tiling + duplicate-merging verified with a synthetic 36-face image (36/36). Model loading needs internet (jsDelivr CDN).
- **☐ to confirm:** run *📸 Photo count* on the lecturer's class photos (course Drive folder) and record detected vs real count here: `detected __ / real __`.

### Google Sheets IMPORTDATA
- **Test:** CSV endpoint validated (one row per student – 104 – correct columns, UTF-8 with BOM so Excel shows the Hebrew names).
- **Behaviour (Google docs):** import functions refresh about **every hour** while the sheet is open; re-entering the formula refreshes immediately.
- **☐ to confirm:** paste the formula with the tunnel link into a real Google Sheet.

### Playwright (development only)
- **Use:** browser end-to-end tests with fake camera / fake GPS / iPhone & Android user agents. Not needed to run the app.

## 1.3 Tools considered and rejected
| Tool | Why not |
|---|---|
| Native mobile app | Install friction; violates KISS |
| Bluetooth beacons | Extra hardware; browser support is poor (Web Bluetooth not on iOS) |
| Face recognition per student | Privacy (biometric personal data), out of scope |
| IP geolocation for the geofence | City-level accuracy, useless for a 500 m radius |
| Browser fingerprinting for the device lock | Identical phones on campus Wi-Fi collide → false rejections |
| WebSockets | Not in the standard library; polling with versions is enough |
