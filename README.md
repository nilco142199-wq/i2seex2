# 🎓 CS302 Interactive Classroom Suite (Ex2 Assignment)
> **Dual-Factor Student Attendance (Dynamic QR + 500 m GPS Geofence) & Class Video AI Summarization**
> Pure Python standard-library backend + vanilla JS frontend. **No `pip install`, no `npm install`.**

---

## 📋 Table of Contents
1. [Prerequisites & Installation](#-prerequisites--installation)
2. [How to Run](#-how-to-run)
3. [Testing Guide — Instructor Flow](#-testing-guide--instructor-flow)
4. [Testing Guide — Student Flow](#-testing-guide--student-flow)
5. [Testing on a Real Phone (HTTPS)](#-testing-on-a-real-phone-https)
6. [Troubleshooting Camera / GPS / QR](#-troubleshooting-camera--gps--qr)
7. [Automated Tests](#-automated-tests)
8. [System Overview & Architecture](#-system-overview--architecture)
9. [How the QR Flow Works](#-how-the-qr-flow-works)
10. [GPS Distance Calculation (Haversine)](#-gps-distance-calculation-haversine-formula)
11. [Class Video Upload & AI Summarization](#-class-video-upload--ai-summarization)
12. [Anti-Spoofing & Anti-Screenshot Security](#%EF%B8%8F-anti-spoofing--anti-screenshot-security)
13. [Project Structure](#-project-structure)
14. [REST API Reference](#-rest-api-reference)

---

## 🧰 Prerequisites & Installation

| Requirement | Why | Check |
|---|---|---|
| **Python 3.8+** | Runs the backend (standard library only) | `python3 --version` |
| **A modern browser** (Chrome, Edge, Safari, Firefox) | Camera + GPS APIs | — |
| **cloudflared** *(recommended for phone testing)* | Public HTTPS link for `--tunnel` | `brew install cloudflared` → `cloudflared --version` |
| **OpenSSL** *(only for `--https`)* | Generates the self-signed certificate automatically | `openssl version` (pre-installed on macOS & most Linux) |
| Internet *(optional)* | Tailwind CSS + fonts load from a CDN for styling. QR generation/scanning works offline (bundled in `static/js/vendor/`). | — |

**Installation:**

```bash
# 1. Get the code
git clone <your-repo-url>
cd "2nd assingment OOP"

# 2. Nothing else to install — there are no dependencies.
```

**Environment variables:** none are required.

---

## ▶️ How to Run

One command starts both the backend and the website (the Python server serves the pages too).
Pick the option that matches how you want to test:

| I want to test… | Command | Open |
|---|---|---|
| **A. Everything on one computer** (two browser tabs) | `python3 server.py` | `http://localhost:8000` |
| **B. With phones — easiest, works on any network** ⭐ | `python3 server.py --tunnel` | the `https://….trycloudflare.com` link it prints |
| **C. With phones on the same Wi-Fi** (no internet tool) | `python3 server.py --https --host 0.0.0.0` | the `https://192.168.x.x:8443` link it prints |

> ⚠️ **Never type `localhost` on a phone** — `localhost` means "this device", so the phone looks for the site on itself.
> ⚠️ **Phones need `https://`** — on plain `http://` they block the camera and GPS.

### Option A — one computer, two tabs

```bash
python3 server.py
```
- Tab 1 (instructor): <http://localhost:8000/?role=instructor>
- Tab 2 (student): <http://localhost:8000/?role=student>

`localhost` is allowed to use the camera/GPS, so the full flow (including the webcam scanner) works here.

### Option B — phones, via a public HTTPS link (recommended) ⭐

Works with the laptop and phones on **any** network (home Wi-Fi, university Wi-Fi, mobile data), with a real trusted certificate (no security warning).

1. Install the free Cloudflare tool **once**:
   ```bash
   brew install cloudflared                          # macOS (needs Homebrew: https://brew.sh)
   winget install --id Cloudflare.cloudflared        # Windows
   ```
2. Start:
   ```bash
   python3 server.py --tunnel
   ```
3. Wait ~10 seconds. The terminal prints:
   ```
   👨‍🏫 Instructor:  https://brave-test-words.trycloudflare.com/?role=instructor
   👨‍🎓 Student:     https://brave-test-words.trycloudflare.com/?role=student
   ```
4. Open the **Instructor** link on the instructor device (laptop or phone 1) and the **Student** link on phone 2 — or just scan the QR the instructor screen shows.

The link is new every time you restart. Keep the terminal open while testing.

### Option C — phones on the same Wi-Fi (self-signed HTTPS)

```bash
python3 server.py --https --host 0.0.0.0
```
The terminal prints the phone address, e.g. `📱 From a phone on the same Wi-Fi: https://192.168.1.23:8443/?role=student`.

- Use **`https://`** and port **`8443`** (not 8000).
- On first visit each device shows a certificate warning (expected, local certificate): Chrome/Android → *Advanced → Proceed*; iPhone → *Show Details → visit this website*.
- The instructor screen shows (under the QR) the exact address students must open, and the QR already points to it.
- If the phone can't load the page at all, the network is blocking device-to-device traffic (common on university/guest Wi-Fi) or the Mac firewall is blocking Python → use **Option B**, or connect the laptop to a phone hotspot.

### All server options

| Flag | Effect |
|---|---|
| *(none)* | http on `127.0.0.1:8000` |
| `--port 9000` | different port |
| `--host 0.0.0.0` | accept connections from other devices on the network |
| `--https` | HTTPS with an auto-generated self-signed certificate in `certs/` (default port 8443) |
| `--tunnel` | public HTTPS link via Cloudflare (needs `cloudflared`) |

Stop the server with **Ctrl + C**. If you see *"Address already in use"*, another copy is still running — close that terminal or use `--port`.

---

## 👨‍🏫 Testing Guide — Instructor Flow

1. Open <http://localhost:8000/?role=instructor> (or open <http://localhost:8000/> and click **"👨‍🏫 Instructor Mode"** on the landing screen).
2. Click the **📸 Automated Attendance** tab.
3. **Start the session:** the left card shows the session status.
   - If it says **■ Ended**, click **▶ Start Session**. (Starting resets the attendance list for a new class.)
   - While live, the card shows the status **● Live since HH:MM:SS**.
4. **Set the classroom location** (the centre of the 500 m circle) in *Classroom GPS Base Coordinates*:
   - **Default: Ariel University** (`32.104722, 35.209444`, centre of campus near the library) with a **500 m radius** — nothing to configure.
   - To use a different point: click **📍 Auto-Fetch My Current GPS Location**, choose a **Campus Preset**, or type latitude/longitude and click **Save Classroom GPS**. Choose the preset **Ariel University** to go back to the default. (Restarting the server also resets to Ariel University.)
5. **Show the QR code** to the students (projector / second screen). The card displays:
   - a **QR code** that rotates every 20 s (countdown badge `🔄 Rotates in: Xs`),
   - a large **6-character code** (e.g. `K7Q2MX`) that students can type if their camera fails.
   - Use **Dynamic (20s)** / **Static** to change rotation mode.
6. **Watch check-ins live:** the roster refreshes automatically every 5 seconds.
   - **✓ Verified Present** — name, time, distance from class, method.
   - **⏳ Not Checked In** — includes a *Mark Present* manual override.
   - **🚨 Flagged Breaches** — attempts rejected for being outside 500 m.
   - **📥 Export CSV** downloads the list.
7. Click **■ End Session** when class is over — from then on, students get *"No active session"*.

> Tip: the **↗ Open Student Mode** button opens a student tab next to the instructor tab.

---

## 👨‍🎓 Testing Guide — Student Flow

1. Open Student Mode in **another tab/window** (<http://localhost:8000/?role=student>) or on a phone (see next section).
   Each tab remembers its own role, so the instructor tab and student tab don't interfere.
2. **Pick your name** in the *"I am"* dropdown at the top of the card.
3. **Step 1 – Scan the QR code:**
   - Tap **📷 Start Camera & Scan QR** and allow camera access.
   - Point the camera at the instructor's QR code. When it's read you hear a beep, the camera closes and check-in starts automatically.
   - **Camera not working?** Type the **6-character code** shown under the QR into the text field (upper/lower case and dashes don't matter), or use **📁 Scan from photo**.
   - *Phone shortcut:* scanning the QR with the phone's normal camera app opens Student Mode with the code already filled in.
4. **Step 2 – Share your location:** after a scan the browser asks for location automatically (or tap **📍 Use my real location**). The card shows your distance from the classroom.
5. **Step 3 – Verify:** tap **✅ Verify & Check In** (automatic after a camera scan). You'll see one of:

| Result | Meaning |
|---|---|
| 🎉 **Attendance recorded!** | QR valid **and** you are within 500 m. The instructor's list updates within 5 s. |
| 📍 **Outside the 500 m classroom radius** | Valid code, but your GPS is too far away (logged as a breach). |
| ⌛ **Invalid or expired QR code** | The code is wrong or older than ~40 s. Scan the current code again. |
| ⏸️ **No active session** | The instructor hasn't started (or has ended) the session. |
| 🚫 / 📵 camera or location messages | Permission denied, no camera, camera in use, or page not on HTTPS — the message says how to fix it. |

### Testing without walking around (single computer)
Open **🧪 Testing tools** in the student card:
- **🟢 In class (~30 m)** / **🔴 At home (~900 m)** — simulate a location instead of using real GPS.
- **⚡ Fill current code** — fills the current code without a camera.
- **⚠️ Use expired code** — checks that old screenshots are rejected.

Suggested test run:
1. 🟢 In class + scan (or Fill current code) → **Verify** → *Attendance recorded*.
2. Choose another student, 🔴 At home + current code → **Verify** → *Outside the 500 m radius* (appears in the instructor's 🚨 Flagged Breaches).
3. ⚠️ Use expired code → **Verify** → *Invalid or expired QR code*.
4. Instructor clicks **■ End Session**, student verifies again → *No active session*.

---

## 📱 Testing on a Real Phone (HTTPS)

**Fastest path (2 phones, or laptop + phone):**

1. `brew install cloudflared` (once).
2. `python3 server.py --tunnel` and wait for the two links.
3. **Instructor device:** open the *Instructor* link → **📸 Automated Attendance** → **▶ Start Session** if needed. The classroom is already **Ariel University, 500 m radius** — students must physically be on campus within 500 m of `32.104722, 35.209444`.
4. **Student phone:** scan the QR on the instructor screen with the normal camera app (it opens Student Mode with the code filled in) — or open the *Student* link and tap **📷 Start Camera & Scan QR**.
5. Pick a name → allow **Camera** and **Location** → **✅ Verify & Check In**.
6. The instructor's **✓ Verified Present** list updates within 5 seconds.

Same-Wi-Fi alternative without installing anything: see [Option C](#option-c--phones-on-the-same-wi-fi-self-signed-https).

> 💡 **Testing from home?** Your real location is outside the 500 m Ariel University radius, so a real-GPS check-in will correctly be *rejected*. To see a successful check-in off-campus, open **🧪 Testing tools → 🟢 In class (~30 m)** in Student Mode (or temporarily set the classroom to your own location with **📍 Auto-Fetch**, then pick the **Ariel University** preset again).
>
> Indoor phone GPS can be off by 20–50 m, so a student at the edge of campus may be rejected.

---

## 🩺 Troubleshooting Camera / GPS / QR

| Symptom | Fix |
|---|---|
| Phone says the site can't be reached / nothing loads | Don't use `localhost` on a phone. Use `python3 server.py --tunnel` (works on any network), or with `--https --host 0.0.0.0` use the `https://192.168.x.x:8443` address and make sure both devices are on the same Wi-Fi. |
| "Address already in use" when starting | Another server is still running — close its terminal / Ctrl+C, or add `--port 8001`. |
| Scanning the QR opens `localhost` on the phone | Restart with `--tunnel` or `--https --host 0.0.0.0`; the QR then contains the phone-reachable address automatically. |
| "📵 Camera blocked: this page is opened over plain http" | Use `http://localhost:8000` on the same computer, or run with `--https` and open the `https://` address. |
| "🚫 Camera permission denied" | Click the 🔒 / ⓘ icon in the address bar → *Camera → Allow*, reload. On iPhone: *Settings → Safari → Camera → Allow*. On macOS also check *System Settings → Privacy & Security → Camera* for your browser. |
| "Camera is being used by another app" | Close Zoom/Teams/other tabs using the camera. |
| QR not detected | Increase screen brightness, hold the phone 20–40 cm from the screen, keep the whole code inside the frame. Or type the 6-character code. |
| "Invalid or expired QR code" | The code rotates every 20 s and is valid ~40 s. Scan the code currently shown. |
| "Location permission denied" | Allow location for the site (same 🔒 icon). On macOS: *System Settings → Privacy & Security → Location Services* for your browser. |
| Desktop GPS is inaccurate | Laptops locate via Wi-Fi and may be off by 100 m+. Use the 🧪 simulators for local testing. |
| Page looks unstyled | Tailwind CSS loads from the internet; functionality still works offline. |

---

## 🧪 Automated Tests

```bash
python3 -m unittest discover tests -v
```

Expected ending:
```
Ran 18 tests in 0.0XXs

OK
```

The tests cover the domain models, Haversine distance, QR rotation and the grace window, deep-link URLs and short codes, session start/end, the 500 m geofence, and the REST router.

---

## 🌟 System Overview & Architecture

The CS302 Interactive Classroom Suite is an end-to-end web application prototype built for university instruction. It addresses two critical operational challenges:
1. **Attendance Fraud & Friction**: Eliminates buddy-signing and remote screenshot-sharing by enforcing **Dual-Factor Geofenced Verification** (Dynamic rotating QR code + real-time GPS <= 500m).
2. **Lecture Review & Knowledge Extraction**: Enables instructors to upload video recordings of classes and leverages a multi-modal AI pipeline (Whisper ASR + Gemini LLM) to synthesize executive summaries, interactive timeline chapters, and actionable homework tasks.

```
+───────────────────────────────────────────────────────────────────────────────+
|                             INSTRUCTOR INTERFACE                              |
|  • Classroom Base GPS: Ariel University (32.104722, 35.209444), radius 500 m   |
|  • Displays Dynamic QR Code (HMAC-SHA256 Token rotates every 20s)             |
|  • Uploads Class Video Recording (.mp4, .webm, .mov) for Multi-Modal LLM      |
|  • Monitors Real-Time Stats: Present, Absent, & Flagged Geofence Breaches    |
+───────────────────────────────────────┬───────────────────────────────────────+
                                        │ Projector / Display
                                        ▼
+───────────────────────────────────────────────────────────────────────────────+
|                        STUDENT INTERFACE (MOBILE-OPTIMIZED)                   |
|  • Requests Device GPS Permission (navigator.geolocation.getCurrentPosition) |
|  • Calculates Live Haversine Distance (Live proximity preview: <= 500m)       |
|  • Scans Dynamic QR Code via WebRTC Camera Viewfinder / Photo Upload          |
|  • Submits Dual-Factor Payload: { student_id, qr_token, lat, lng }           |
+───────────────────────────────────────┬───────────────────────────────────────+
                                        │ POST /api/attendance/verify
                                        ▼
+───────────────────────────────────────────────────────────────────────────────+
|                       AUTHORITATIVE SERVER VERIFICATION                       |
|  [Condition 1]: session.validate_qr_token(token)                              |
|                 ↳ Validates time-window slot (Current or Current - 1 slot)    |
|                 ↳ Rejects stale/screenshot tokens older than 40s              |
|                                                                               |
|  [Condition 2]: haversine_distance(classroom_lat, classroom_lng, lat, lng)   |
|                 ↳ Distance <= 500.0 meters?                                   |
|                 ↳ IF > 500m: Logs attempt as "rejected_distance" & REJECTS    |
|                                                                               |
|  [Result]: IF BOTH PASS ➔ Student marked PRESENT with exact distance & time  |
|            IF EITHER FAILS ➔ Returns structured error + distance to student   |
+───────────────────────────────────────────────────────────────────────────────+
```

---

## 📷 How the QR Flow Works

1. **Generation (instructor):** the server signs the current 20-second time slot with HMAC-SHA256 → token `QR_<session>_<slot>_<sig>` plus a 6-character short code from the same slot.
   The page renders a QR (bundled `static/js/vendor/qrcode.min.js`) that contains a **deep link**: `https://<host>/?role=student&token=<token>`.
2. **Scanning (student):** `getUserMedia` opens the rear camera (falls back to any camera). Every 200 ms a frame is decoded with the native `BarcodeDetector` when the browser has one, otherwise with the bundled `jsQR` (works in every browser, including iOS Safari). The video element is `muted` + `playsinline` so iOS lets it play inline.
3. **Parsing:** `QREngine.extractToken()` accepts the deep-link URL, a raw token or a typed short code; the server normalises the same way.
4. **Verification:** the token plus the device's GPS coordinates go to `POST /api/attendance/verify`. The server checks: session open → token valid for the current or previous slot → distance ≤ 500 m.
5. **Live update:** the instructor's view polls every 5 s and the student appears under *Verified Present*.

---

## 📐 GPS Distance Calculation (Haversine Formula)

**Geofence:** centre = **Ariel University** `32.104722, 35.209444` (Wikipedia, campus centre / Hecht Library), radius = **500 m**.
These defaults live in one place — `ARIEL_UNIVERSITY_LAT`, `ARIEL_UNIVERSITY_LNG`, `DEFAULT_RADIUS_METERS` in [`app/models/session.py`](app/models/session.py) — and the server rejects any check-in more than 500 m from that point.
To change the radius, edit `DEFAULT_RADIUS_METERS = 500.0` in that file and restart the server — the UI picks up the new value automatically.

The great-circle geodesic distance between the student's device and the classroom coordinates is calculated using the **Haversine formula**:

$$\Delta\phi = \phi_2 - \phi_1, \quad \Delta\lambda = \lambda_2 - \lambda_1$$

$$a = \sin^2\left(\frac{\Delta\phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta\lambda}{2}\right)$$

$$c = 2 \cdot \operatorname{atan2}\left(\sqrt{a}, \sqrt{1-a}\right), \quad d = R \cdot c \quad (R = 6,371,000 \text{ m})$$

### Python Implementation ([`session.py`](app/models/session.py)):
```python
import math

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0  # Earth's radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(R * c, 2)
```

---

## 🎥 Class Video Upload & AI Summarization

The system features an automated **Class Video Upload & Multi-Modal AI Summarization Suite** ([`video_summary_service.py`](app/services/video_summary_service.py)):

### 1. Multi-Modal Ingestion Pipeline
1. **Video Ingestion**: Instructor uploads a class recording (`.mp4`, `.webm`, `.mov`, `.mkv`) via drag-and-drop or file picker.
2. **Audio Extraction & Whisper ASR**: Automatically transcribes speech into a timestamped, speaker-labeled transcript.
3. **Keyframe & Slide OCR**: Multi-modal vision analysis detects code snippets and presentation slides.
4. **Gemini LLM Chapter Indexing & Synthesis**:
   - **Executive Summary**: Comprehensive paragraph summarizing the core architectural discussions.
   - **Timeline Chapters**: Discrete clickable segments (*e.g., `00:00 - Introduction`, `14:20 - Observer Pattern UML`, `31:45 - Live Refactoring Demo`, `52:10 - Thread Safety & Memory Leaks`*).
   - **Key Takeaways**: Bulleted conceptual learnings.
   - **Action Items**: Concrete homework tasks with assignees and due dates.
5. **Interactive Video Q&A Assistant**: Students or instructors can type questions into the **"Ask AI About This Video"** box (*e.g., "When is the homework deadline?"*), and the AI returns an immediate response referencing the exact timestamp in the recording!

---

## 🛡️ Anti-Spoofing & Anti-Screenshot Security

### Why WhatsApp/Telegram Screenshot Forwarding Fails:
1. **Dynamic Time-Slotted Tokens**:
   The QR code generates a cryptographic HMAC signature pegged to discrete 20-second time slots:
   $$\text{Token} = \operatorname{HMAC-SHA256}(\text{Secret}, \text{SessionID} \mathbin{\Vert} \text{Slot})$$
2. **Short Validity Window**:
   The server only permits tokens belonging to the current slot (or immediate previous slot for network latency tolerance). If an in-class student screenshots the QR and forwards it over WhatsApp, by the time the remote student opens and submits the code, the token has **expired**.
3. **Mandatory Server Geofencing**:
   Even if an attacker receives the QR code within seconds, the server computes the Haversine distance from their device GPS. If the distance exceeds **500 meters**, check-in is unconditionally rejected.
4. **Short manual code follows the same rules**:
   The 6-character code printed under the QR (for students whose camera fails) is derived from the same HMAC time slot, so it expires exactly like the QR token.
5. **Audit Trail of Breaches**:
   Rejected attempts are permanently logged with the student's ID, coordinates, timestamp, and distance, surfacing directly on the instructor's dashboard under **"🚨 Flagged Breaches"**.

---

## 📁 Project Structure

```
2nd assingment OOP/
├── README.md                      # Complete system specification & architecture
├── server.py                      # Multi-threaded zero-dependency HTTP(S) server (--https, --host, --tunnel)
├── certs/                         # Auto-generated self-signed HTTPS certificate (git-ignored)
├── tests/
│   └── test_app.py                # 18 unit tests (models, QR codes, Ariel 500 m geofence, API)
├── app/
│   ├── models/                    # Encapsulated Domain Entities
│   │   ├── session.py             # ClassSession, CheckInAttempt, & Haversine formula
│   │   ├── video_summary.py       # VideoLecture & VideoChapter multi-modal models
│   │   ├── student.py             # Student state, distance & coordinates
│   │   ├── feedback.py            # Comments, categories, upvoting, & resolution
│   │   ├── poll.py                # Poll, options, & real-time tally calculations
│   │   ├── meeting_summary.py     # Lecture synthesis, action items, & transcripts
│   │   └── homework_review.py     # LLM code reviews, SOLID compliance, & design patterns
│   ├── repositories/
│   │   └── datastore.py           # Thread-safe In-Memory Repository with seed data
│   ├── services/                  # Business Logic Layer (Single Responsibility)
│   │   ├── attendance_service.py  # Dual-factor QR/GPS verification & audit logging
│   │   ├── video_summary_service.py# Video ingestion, Whisper ASR, & LLM chapter synthesis
│   │   ├── feedback_service.py    # Feedback stream & upvoting rules
│   │   ├── poll_service.py        # Poll creation, state toggling, & vote recording
│   │   ├── ml_summary_service.py  # Meeting transcript synthesis & dynamic regeneration
│   │   └── code_review_service.py # Homework evaluation & side-by-side repo comparison
│   └── handlers/
│       └── api_router.py          # Command / Front Controller REST API dispatcher
└── static/                        # Frontend Single-Page Application (SPA)
    ├── index.html                 # Modern Tailwind responsive dashboard
    ├── css/
    │   └── custom.css             # Laser sweep animation, reticle box, & glassmorphism
    └── js/
        ├── api.js                 # ApiClient (Facade Pattern)
        ├── state.js               # Reactive AppState (Observer) + role from ?role= URL
        ├── haversine.js           # Client-side Haversine geodesic distance calculator
        ├── qr_engine.js           # QR generation, camera decoding, token/short-code parsing
        ├── vendor/
        │   ├── qrcode.min.js      # Local David Shim standard QR Code generator
        │   └── jsQR.min.js        # Local universal pure-CPU QR Code scanner
        └── components/
            ├── attendance.js      # Attendance: Instructor view & Student view (separate)
            ├── summary.js         # Class Video Upload & AI Summarization Suite
            ├── comments.js        # Comments & Question feed UI component
            ├── poll.js            # Live Polls & Dynamic percentage bars UI
            ├── review.js          # Homework Deep Review & Side-by-side comparison UI
            └── app.js             # Root coordinator initializing all modules
```

---

## 📡 REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/session/active` | Active lecture session & base GPS coordinates |
| `GET` | `/api/server-info` | Address phones should use (`lan_origin`: LAN or tunnel URL) — used to build the QR |
| `GET` | `/api/session/qr` | Active QR token, 6-char `short_code`, `is_active`, countdown seconds |
| `POST` | `/api/session/start` | Instructor starts a session (resets the roster by default, `reset_roster`) |
| `POST` | `/api/session/end` | Instructor ends the session — further check-ins return `session_closed` |
| `POST` | `/api/session/location` | Sets classroom GPS coordinates (`lat`, `lng`, `name`) |
| `POST` | `/api/session/create` | Configures class session, radius (500m), and QR mode |
| `POST` | `/api/attendance/verify` | **Dual-Factor verification** (`student_id`, `qr_token`, `lat`, `lng`). `qr_token` may be the raw token, the QR deep-link URL or the 6-char short code. Failure `reason`: `invalid_qr`, `distance_exceeded`, `session_closed`, `student_not_found`, `missing_gps` |
| `GET` | `/api/attendance` | Returns student roster, present/absent counts, and breach logs |
| `GET` | `/api/attendance/stats` | Detailed statistics and audit trail of remote attempts |
| `POST` | `/api/video/upload` | **Uploads lecture recording & triggers multi-modal LLM synthesis** |
| `GET` | `/api/video/list` | Returns library of uploaded lecture videos and summaries |
| `GET` | `/api/video/detail?id=...` | Detailed summary, chapters, and transcript for a video |
| `POST` | `/api/video/qa` | **Interactive AI Q&A assistant for uploaded video** |
| `POST` | `/api/attendance/photo-scan` | Computer vision facial recognition simulation |
| `GET` | `/api/feedback` | Categorized student comments and questions |
| `POST` | `/api/feedback` | Submits new live/offline question |
| `GET` | `/api/poll` | Active poll & animated percentage results |
| `POST` | `/api/poll/vote` | Casts vote in active poll |
| `GET` | `/api/review` | Student assignment reviews & comparative metrics |
