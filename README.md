# 🎓 CS302 Interactive Classroom Suite (Ex2 Assignment)
> **Dual-Factor Student Attendance (Dynamic QR + 500 m GPS Geofence) & Class Video AI Summarization**
> Pure Python standard-library backend + vanilla JS frontend. **No `pip install`, no `npm install`.**

---

## 🎯 Problem Statement & Scope

### The problem
Teaching tools used in class today are scattered and not built for a live lecture: attendance is read out or signed on paper (slow) or done with a code that can be sent over WhatsApp (easy to fake); polls and questions need a separate site; recorded lectures and homework get little feedback. The course asks for **better, simpler and LLM-ready** tools that work **in this class**, from the students' own phones.

### Goal
One web application (no installation for students – KISS) that a lecturer starts with one command and uses during the lecture.

### Scope – features
| # | Feature (from the assignment) | In this project |
|---|---|---|
| 1 ⭐ | **Attendance** – automatic / as simple as possible; lecturer evaluates it (e.g. class photo + automatic count); online/offline spreadsheet | Rotating QR + 500 m GPS geofence (Ariel University) · one phone per student · Wi-Fi & instructor-approval fallbacks · live roster · **📸 photo head count** · **📥 CSV** + **🔗 live Google Sheets link** |
| 2 | Comments & suggestions, real time / offline | Live feed, categories, anonymous, upvote, resolve |
| 3 | On-the-spot (KISS) polls | Create in seconds, one vote per student, live results |
| 4 | ML summary of a class video (Zoom / Meet / Classroom) | **Real LLM (Google Gemini)** watches the recording → summary, clickable chapters, takeaways, action items, Q&A (demo mode without an API key) |
| 5 | Deep LLM homework review incl. comparison to other students | **Real LLM (Google Gemini)** reads the uploaded .zip / GitHub repo → requirements met/missing, SOLID, patterns, problems to fix – every finding cites a real file; **measured code similarity** between students + side-by-side comparison |

### Out of scope
Integration with Moodle / Zoom / Google Classroom · personal information (no ID numbers; the roster is the lecturer's class list – names only, in Hebrew; class photos are analysed in the browser and never uploaded) · user accounts / SSO · persistent database · paid LLM subscriptions (interfaces are ready).

### Requirements from the assignment and how they are met
| Requirement | How |
|---|---|
| Works in this class, real demo | `python3 server.py --tunnel` → public HTTPS link; tested with real phones; 150–300 simultaneous students load-tested |
| KISS smartphone web app | Students scan the projected QR → 3 steps on one screen; nothing to install |

---

## 📚 Design Documents

| # | Document | Assignment To-Do |
|---|---|---|
| 1 | [Technical tools report](docs/01_tools_report.md) | 3 |
| 2 | [Statement of Work (SoW)](docs/02_statement_of_work.md) | 4 |
| 3 | [Software Requirements Specification (SRS)](docs/03_SRS.md) | 5 |
| 4 | [Use cases & client stories](docs/04_use_cases.md) | 6 |
| 5 | [Main software components](docs/05_components.md) | 7 |
| 6 | [Class diagrams](docs/06_class_diagrams.md) | 8 |
| 7 | [Sequence diagrams](docs/07_sequence_diagrams.md) | 8 |
| 8 | [Testing strategy](docs/08_testing_strategy.md) | 9 |
| 9 | [Results & conclusion](docs/09_results_and_conclusion.md) | 12 |

Diagrams are written in Mermaid and render directly on GitHub.

---

## 📋 Table of Contents
0. [Problem Statement & Scope](#-problem-statement--scope) · [Design Documents](#-design-documents)
1. [Prerequisites & Installation](#-prerequisites--installation)
2. [How to Run](#-how-to-run)
3. [Testing Guide — Instructor Flow](#-testing-guide--instructor-flow)
4. [Testing Guide — Student Flow](#-testing-guide--student-flow)
5. [Testing on a Real Phone (HTTPS)](#-testing-on-a-real-phone-https)
6. [Troubleshooting Camera / GPS / QR](#-troubleshooting-camera--gps--qr)
7. [Automated Tests & Load Test](#-automated-tests)
8. [Scalability (100+ students)](#-scalability-100-students)
9. [System Overview & Architecture](#-system-overview--architecture)
10. [How the QR Flow Works](#-how-the-qr-flow-works)
11. [GPS Distance Calculation (Haversine)](#-gps-distance-calculation-haversine-formula)
12. [Class Video Upload & AI Summarization](#-class-video-upload--ai-summarization)
13. [Anti-Spoofing & Anti-Screenshot Security](#%EF%B8%8F-anti-spoofing--anti-screenshot-security)
14. [Project Structure](#-project-structure)
15. [REST API Reference](#-rest-api-reference)

---

## 🧰 Prerequisites & Installation

| Requirement | Why | Check |
|---|---|---|
| **Python 3.8+** | Runs the backend (standard library only) | `python3 --version` |
| **A modern browser** (Chrome, Edge, Safari, Firefox) | Camera + GPS APIs | — |
| **cloudflared** *(recommended for phone testing)* | Public HTTPS link for `--tunnel` | `brew install cloudflared` → `cloudflared --version` |
| **OpenSSL** *(only for `--https`)* | Generates the self-signed certificate automatically | `openssl version` (pre-installed on macOS & most Linux) |
| Internet *(optional)* | Only for the Rubik font, the head-count model and Gemini video summaries. Styling (`static/css/tailwind.css`) and QR generation/scanning (`static/js/vendor/`) are bundled and work offline. | — |

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
- ⚠️ **iPhone: location does not work in this mode** — Safari doesn't trust self-signed certificates, so it blocks location. For iPhones use **Option B (`--tunnel`)**. The app detects this and tells the student.
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
6. **Everyone starts as "Not Checked In"** (0 / 104) — the numbers only change from real check-ins (or your manual *Mark Present*).
7. **Watch check-ins live:** the roster refreshes automatically every 5 seconds. With 100+ students use the **🔍 Search name or ID** box above the list; the tables scroll with a fixed header.
   - **✓ Verified Present** — name, time, distance from class, method.
   - **⏳ Not Checked In** — includes a *Mark Present* manual override.
   - **🚨 Flagged Breaches** — attempts rejected for being outside 500 m.
   - **📥 Export CSV** downloads the list (offline spreadsheet).
   - **🔗 Live Sheet** shows a formula like `=IMPORTDATA("https://….trycloudflare.com/api/attendance/export.csv")`. Paste it into cell A1 of a new Google Sheet (or use Excel *Data → From Web*) to get an **online spreadsheet** that keeps updating (Google refreshes about every hour; re-enter the formula to refresh now). Needs the public `--tunnel` link.
   - **📸 Photo count** — take or upload a photo of the class. Faces are counted **in the browser** (the photo is not uploaded), drawn as numbered boxes, and compared with the number of check-ins (e.g. *47 in the photo vs 45 checked in → 2 did not check in*). Fix the count with − / + and **💾 Save**. The photo **never marks anyone present**. Needs internet the first time (the face-detection model is downloaded from jsDelivr).
8. **🙋 Approvals** — students whose phone refuses to share location (but who scanned the **current** QR) appear here. Approve only students you can see in the room.
9. **🚨 Flagged Breaches** also lists **SAME PHONE** attempts — a phone that already checked in one student trying to check in another.
10. Click **■ End Session** when class is over — from then on, students get *"No active session"*.

> Tip: the **↗ Open Student Mode** button opens a student tab next to the instructor tab.

---

## 👨‍🎓 Testing Guide — Student Flow

1. Open Student Mode in **another tab/window** (<http://localhost:8000/?role=student>) or on a phone (see next section).
   Each tab remembers its own role, so the instructor tab and student tab don't interfere.
2. **Pick your name** in the *"I am"* dropdown at the top of the card (the 104 students of the class, in Hebrew). Type part of your name or ID in **🔍 Find your name** to jump to it.
   **Not on the list?** (e.g. real classmates trying it during the presentation) open **"Not on the list? Add yourself"**, enter your student ID and full name, tap **Add** — you're selected automatically.
3. **Step 1 – Check your location** (separate from the QR – the camera is never open at the same time): tap **📍 Check my location** → **Allow** → the card shows your distance from Ariel University and ✓/✕ for the 500 m radius.
   **Phone blocks location?** Tap **📶 Check my location by Wi-Fi** (no permission needed, phone on the same Wi-Fi as the instructor) or **🙋 Ask the instructor to approve me**.
   Want to test location alone? Open **`/gps`** (e.g. `https://xxxx.trycloudflare.com/gps`) — a bare page with one button, no camera/QR. If it fails there, the phone's settings block location.
4. **Step 2 – Scan the QR code:**
   - Tap **📷 Start Camera & Scan QR** and allow camera access, point it at the instructor's QR code (beep = scanned).
   - **Camera not working?** Type the **6-character code** shown under the QR, or use **📁 Scan from photo**.
   - *Phone shortcut:* scanning the QR with the phone's normal camera app opens Student Mode with the code already filled in.
5. **Step 3 – Verify:** tap **✅ Verify & Check In** (automatic after a camera scan if your location is already checked). You'll see one of:

| Result | Meaning |
|---|---|
| 🎉 **Attendance recorded!** | QR valid **and** you are within 500 m. The instructor's list updates within 5 s. |
| 📍 **Outside the 500 m classroom radius** | Valid code, but your GPS is too far away (logged as a breach). |
| ⌛ **Invalid or expired QR code** | The code is wrong or older than ~40 s. Scan the current code again. |
| 📵 **This phone already checked in another student** | Each phone can check in **one** student per session (see below). |
| ⏸️ **No active session** | The instructor hasn't started (or has ended) the session. |
| 🚫 / 📵 camera or location messages | Permission denied, no camera, camera in use, or page not on HTTPS — the message says how to fix it. |

### Phone blocks location?
A blocked location is a decision of the phone (iOS/Android settings) — no website can override it. So the app offers two ways that need **no location permission**:
1. **📶 Check my location by Wi-Fi** — current QR code + the phone is on the **same network as the instructor's device** (same public IP, same LAN /24, or same IPv6 /64). Shown on the instructor screen as *QR Code + classroom Wi-Fi*.
2. **🙋 Ask the instructor to approve me** — appears in the instructor's **🙋 Approvals** tab.

The student also sees the exact settings steps for their phone, and *Technical details* with the browser's exact error.

### One phone = one student
A phone that checked in a student is locked to that student for the rest of the session (the name picker is disabled). Trying to check in a classmate — from the UI or by calling the API directly — is rejected and logged as **SAME PHONE**. The phone is identified by **two** independent ids (a server cookie + an id in the browser's localStorage), so clearing one of them is not enough. Starting a new session releases all phones.
*Limit:* a student with two phones, or who wipes all site data / uses a private window, gets a new identity; the rotating QR + GPS radius still require being in the class. Full proof would need university login (SSO).

### Suggested test run
1. On campus (within 500 m of Ariel University): scan → allow location → **Verify** → *Attendance recorded*.
2. Same phone, try another student → *This phone already checked in another student* (instructor sees **SAME PHONE**).
3. Phone with location blocked → **🙋 Ask the instructor to approve me** → instructor approves in **🙋 Approvals**.
4. Instructor clicks **■ End Session**, student verifies again → *No active session*.

The location rule itself is covered by one automated test: `TestLocation.test_distance_from_required_location`.

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

> 💡 **Testing from home?** Your real location is outside the 500 m Ariel University radius, so a real-GPS check-in will correctly be *rejected*. To see a successful check-in off-campus, temporarily set the classroom to your own location with **📍 Auto-Fetch** on the instructor screen (pick the **Ariel University** preset again afterwards), or use **🙋 instructor approval**.
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
| "🚫 Location access is blocked for this site" | The app shows the exact steps for your phone. In short: **iPhone** → Settings → Privacy & Security → Location Services **On** → *Safari Websites* → "While Using the App"; then in Safari **ᴀA → Website Settings → Location → Allow**. **Android** → Location on in quick settings; Chrome **🔒 → Permissions → Location → Allow** (and Settings → Apps → Chrome → Permissions → Location). Reload and tap **📍 Check my location**. |
| Location blocked right after scanning the QR with the phone camera | On Android, Google Lens often opens the link **inside the Google app**, which blocks location. Tap ⋮ → **Open in Chrome** (the app detects this and tells you). Using the **📷 Start Camera** button inside the site avoids this. |
| Desktop GPS is inaccurate | Laptops locate via Wi-Fi and may be off by 100 m+. Test check-in from a phone. |
| iPhone: "Location access is blocked" even after changing settings | 1) Use the **`--tunnel`** link — Safari blocks location on the self-signed `--https` link. 2) **Settings → Apps → Safari → Location** must be *Ask* or *Allow* (not *Deny*). 3) **Settings → Privacy & Security → Location Services → Safari Websites → While Using the App**. 4) In Safari **ᴀA → Website Settings → Location → Ask**. 5) Close the tab, reopen the link, tap **📍 Check my location** → **Allow**. Still blocked? Use **🙋 Ask the instructor to approve me** and send the *Technical details* text to the developer. |
| Page looks unstyled | Hard-refresh (Ctrl/Cmd+Shift+R). Styling is local (`static/css/tailwind.css`); if you added new Tailwind classes, rebuild it: `node tools/build_css.mjs . static/css/tailwind.css`. |

---

## 🧪 Automated Tests

```bash
python3 -m unittest discover tests -v
```

Expected ending:
```
Ran 39 tests in 0.0XXs

OK
```

The tests cover the domain models, QR rotation and the grace window, deep-link URLs and short codes, session start/end, **one location test** (`TestLocation.test_distance_from_required_location`: ~33 m from Ariel University is accepted, ~1 km is rejected), one-phone-per-student and the instructor-approval fallback, the 104-student class roster, concurrent check-ins of the whole class, versioned polling, self-registration, the REST router, and the **Gemini video pipeline** (against the local fake Gemini server, so no key or internet is needed).

---

### Load test (100+ students at once)

```bash
python3 tests/load_test.py                  # 150 students check in at the same moment
python3 tests/load_test.py --students 300
```

It starts its own server on a free port (your running server is not affected) and simulates every phone doing: load the list → (register if new) → verify QR + GPS → poll status, while the instructor polls the roster. Example result on a laptop:

```
Students: 150   Requests: 483   Wall time: 0.53s   Throughput: 909 req/s
Present at the end: 150 / 150
Full roster payload: 45.1 KB  |  'unchanged' poll payload: 41 bytes
Failures: 0
✅ PASS
```

---

## 📈 Scalability (100+ students)

| Concern | What the system does |
|---|---|
| **Everyone checks in at the same second** | Every attendance write runs under one lock (`DataStore.lock`, `@_synchronized` in `AttendanceService`), so concurrent check-ins can't corrupt the roster. Tested with the whole class (104 threads) in the unit tests and 300 HTTP clients in the load test. |
| **Connection bursts** | The server's listen backlog is raised from Python's default 5 to 512 (`request_queue_size`), and each request runs in its own thread. |
| **Polling traffic** | Student phones poll only their **own** status (`/api/attendance/me`, ~0.5 KB) every 10 s, and only for the open tab — not the whole class. The instructor polls every 5 s with `?since=<version>`; if nothing changed the server answers `{"unchanged": true}` (41 bytes) and the screen isn't redrawn. |
| **Payload size** | The roster is sent once (no duplicated present/absent copies). Large JS libraries are cached by phones for a day. |
| **Double taps / retries** | Check-in is idempotent: a second check-in returns *"already checked in"* without changing the original time. |
| **Buddy check-ins** | One phone = one student per session (cookie + localStorage id), enforced on the server. |
| **Real students not in the demo list** | `POST /api/students/register` lets a student add themselves (validated ID + name; an existing ID is reused, never duplicated). |
| **Big rosters in the UI** | Instructor search + scrollable tables; student name search; avatars lazy-loaded. |
| **Bounded memory** | The audit log keeps the latest 1,000 attempts. |

Limits to know: data is kept **in memory** (restarting the server resets it), and it runs as a single process. That's fine for a lecture hall of a few hundred students; a production deployment would move the repository to a database (the Repository pattern makes that a one-class change).

---

## 🌟 System Overview & Architecture

The CS302 Interactive Classroom Suite is an end-to-end web application prototype built for university instruction. It addresses two critical operational challenges:
1. **Attendance Fraud & Friction**: Eliminates buddy-signing and remote screenshot-sharing by enforcing **Dual-Factor Geofenced Verification** (Dynamic rotating QR code + real-time GPS <= 500m).
2. **Lecture Review & Knowledge Extraction**: Enables instructors to upload video recordings of classes; Google Gemini watches and listens to the recording and returns executive summaries, interactive timeline chapters, and actionable homework tasks.

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

A recorded lecture (`.mp4`, `.webm`, `.mov`, also audio files) is **really sent to an LLM – Google Gemini** – which watches *and* listens to the whole recording and returns the summary. Code: [`gemini_client.py`](app/services/gemini_client.py), [`video_summary_service.py`](app/services/video_summary_service.py).

### Turn it on (free, once)
1. Get a free API key at **https://aistudio.google.com/apikey** (Google account → *Create API key*).
2. Easiest: create a file named **`.env`** in the project folder with one line `GEMINI_API_KEY=paste-your-key` – `server.py` reads it automatically and `.env` is git-ignored, so the key never reaches GitHub. Or set it in the terminal each time:
   ```bash
   # macOS / Linux
   export GEMINI_API_KEY="paste-your-key"
   python3 server.py --tunnel
   ```
   ```powershell
   # Windows PowerShell
   $env:GEMINI_API_KEY="paste-your-key"
   python server.py --tunnel
   ```
3. The terminal prints `🤖 Video summaries: REAL – Google Gemini`. Without a key it prints `⚪ Video summaries: DEMO MODE`, and the page shows a grey *Demo mode* pill – demo results are clearly labelled **DEMO** and are never presented as a real summary.

Optional: `GEMINI_MODEL=...` picks a model (default: the newest Flash model; if Google has retired it the client automatically falls back to the next one).

> ✅ **Verified with the real Gemini API (25/11/2026).** A test lecture with 8 slides on the Observer pattern (`observer_lecture.mp4`, 1:48 min, no audio) was uploaded and Gemini returned an accurate summary: the WeatherStation coupling problem, Subject/Observer one-to-many, the `attach`/`notify` code example, Open/Closed vs. memory leaks, and Homework 3 – all taken from the slides, nothing invented. To try it yourself, record a minute on your phone or use any lecture MP4.

### Reliability
- **Google overloaded (503 "high demand"), 429, 500:** each model is retried after 4 s and 10 s, then the next model is used (5 models), then the whole list once more. Only if everything is busy does the page show *"Gemini servers are overloaded – upload again in a few minutes"*.
- **Model retired (404):** the next model is used automatically.
- **macOS "CERTIFICATE_VERIFY_FAILED":** Python from python.org has no root certificates; the client then uses `certifi` or the Mac's own `/etc/ssl/cert.pem`. Certificate checking is **never** switched off.
- **Errors are shown, not hidden:** a failed lecture is marked *Failed* with the reason; no summary is ever invented.

### Security of the API key and uploads
| Risk | Protection |
|---|---|
| Key leaks to GitHub | The key lives only in `.env` (or the terminal). `.env`, `certs/` and `Claude outputs/` are in `.gitignore`; checked that the key is in no tracked file and nowhere in git history. |
| Someone reads `.env` / source through the web server | Static files are served only from `static/`; `/../.env`, `%2e%2e` and similar paths return the home page (tested). |
| Someone with the public link uses up the key's quota | `UploadLimiter`: 3 uploads per phone per hour, 20 per network per hour, at most 3 summaries at the same time; the instructor's computer is not limited. Free-tier keys without billing can never cost money. |
| Huge or wrong files | Max 2 GB (100 MB via the tunnel); only `video/*` or `audio/*`; checked before the body is read; temp file deleted after the job. |
| Malicious text in titles / AI output | Everything from the server is HTML-escaped before it is shown (`escapeDeep` in `summary.js`). |


### What happens after you upload
```
Browser ──(file, streamed)──► server.py  POST /api/video/upload-file   (saved to a temp file)
                               │ background job – the page polls /api/video/list every 3 s
                               ├─ 1. upload to the Gemini Files API (resumable upload)
                               ├─ 2. wait until Gemini has processed the video (state ACTIVE)
                               ├─ 3. generateContent with a JSON schema → summary, chapters,
                               │     key takeaways, action items, quotes, topics
                               └─ 4. temp file deleted · summary shown · status "🤖 AI summary"
```
- **Language:** *Same as the lecture* (default), Hebrew or English.
- **Chapters are clickable** – they jump the video player to that timestamp.
- **Ask AI about this video:** the question is sent to Gemini together with the same uploaded recording, so answers come from the lecture itself, with a timestamp.
- **Who can upload:** the instructor and the students (Student Mode, also from a phone). To protect the lecturer's API key, uploads from phones are limited to **3 per phone per hour**, 20 per network per hour, and at most 3 recordings are summarised at the same time (`UploadLimiter` in `server.py`); the instructor's own computer is not limited.
- **Size limits:** up to 2 GB per file. Through the public `--tunnel` link Cloudflare limits uploads to **100 MB**, so upload long lectures from the instructor computer at **http://localhost:8000** (same server, no limit).
- Processing a one-hour lecture usually takes a few minutes; you can keep using the other tabs meanwhile.

### How it is tested without a key
`tests/fake_gemini.py` is a small local server that speaks the same API as Gemini (upload, processing state, generateContent, a retired model). `TestGeminiVideoPipeline` uploads a real file through it and checks that the file arrives, that the summary is returned and that the result is not marked as demo. A second test checks that without a key the result is labelled simulated.

---

## 🔍 Homework Deep Review (real, with comparison between students)

Students (from their phone, in Student Mode) or the lecturer upload homework as a **.zip** or a **public GitHub link**. Code: [`code_analysis.py`](app/services/code_analysis.py), [`code_review_service.py`](app/services/code_review_service.py), [`review.js`](static/js/components/review.js).

```
.zip / GitHub link ─► CodeBundle (read in memory, safely) ─► real metrics: files, lines, classes, functions, tests, README
                                                         └─► fingerprint for similarity between students
                    ─► Gemini: code (numbered lines) + the assignment requirements ─► JSON review
                    ─► validate: every finding must cite a file that is in the submission, otherwise it is removed
```

| What you get | Where it comes from |
|---|---|
| Files, lines of code, classes, functions, test files, README | **Counted** from the files (always real, also without a key) |
| Requirements met / partial / missing, SOLID, design patterns, what to fix, strengths, scores | **Gemini**, each with `file:line` evidence |
| "N AI findings removed – they pointed to files that do not exist" | The check in `CodeReviewService.validate_review()` |
| Similar code between students (% and matching files) | **Measured**: 5-token windows of the code, comments removed and names replaced, so renaming variables does not hide copying |
| AI paragraph comparing two students | Gemini, using only the two reviews |

- **No invented data:** the tab starts empty. Without `GEMINI_API_KEY` only the measured facts and similarity are shown – no scores.
- **Requirements:** the review is made against the text in *Reviewed against*. It starts with the Ex2 requirements; the lecturer clicks **Edit** (only on the instructor computer) and pastes the real assignment.
- **Privacy:** a student sees only the submissions uploaded from their own phone; the lecturer sees everyone, the similarity list and the comparison.
- **Safety:** zips are read in memory (nothing extracted to disk), `../` paths, binaries, `node_modules`, `.git`, `venv` are skipped, max 30 MB / 600 files; GitHub links go only to `github.com` (public repos); uploads from phones are limited (3 per phone per hour, at most 3 reviews at once).
- **Similarity is a hint, not proof** – shared starter code also counts. Check the matching files before deciding anything.

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
├── README.md                      # Problem, scope, how to run, architecture
├── docs/                          # Design documents: tools report, SoW, SRS, use cases, components,
│                                  #   class & sequence diagrams (Mermaid), testing strategy, conclusion
├── tools/build_css.mjs            # Rebuilds static/css/tailwind.css (Tailwind v4, run with Node)
├── server.py                      # Multi-threaded zero-dependency HTTP(S) server (--https, --host, --tunnel)
├── certs/                         # Auto-generated self-signed HTTPS certificate (git-ignored)
├── tests/
│   ├── test_app.py                # 39 unit tests (models, QR, 1 location test, one-phone lock, head count, CSV, concurrency, API, Gemini pipeline, homework review)
│   ├── load_test.py               # 150-300 simultaneous students over HTTP
│   └── fake_gemini.py             # Local stand-in for the Gemini API (tests run without a key)
├── app/
│   ├── models/                    # Encapsulated Domain Entities
│   │   ├── session.py             # ClassSession, CheckInAttempt, & Haversine formula
│   │   ├── video_summary.py       # VideoLecture & VideoChapter multi-modal models
│   │   ├── student.py             # Student state, distance & coordinates
│   │   ├── feedback.py            # Comments, categories, upvoting, & resolution
│   │   ├── poll.py                # Poll, options, & real-time tally calculations
│   │   ├── meeting_summary.py     # Lecture synthesis, action items, & transcripts
│   │   └── homework_review.py     # HomeworkSubmission: real metrics + validated AI review
│   ├── repositories/
│   │   ├── datastore.py           # Thread-safe In-Memory Repository (lock + roster version)
│   │   └── seed_students.py       # Class list: 104 students (Hebrew first + last names)
│   ├── services/                  # Business Logic Layer (Single Responsibility)
│   │   ├── attendance_service.py  # Dual-factor QR/GPS verification & audit logging
│   │   ├── video_summary_service.py# Lecture upload → background Gemini job → summary & Q&A
│   │   ├── gemini_client.py       # Google Gemini API client (Files API + JSON-schema output)
│   │   ├── feedback_service.py    # Feedback stream & upvoting rules
│   │   ├── poll_service.py        # Poll creation, state toggling, & vote recording
│   │   ├── ml_summary_service.py  # Meeting transcript synthesis & dynamic regeneration
│   │   ├── code_analysis.py       # Safe zip reading, real metrics, code similarity, GitHub download
│   │   └── code_review_service.py # Homework review job, anti-hallucination check, comparison
│   └── handlers/
│       └── api_router.py          # Command / Front Controller REST API dispatcher
└── static/                        # Frontend Single-Page Application (SPA)
    ├── index.html                 # Responsive dashboard ("engineer's notebook" theme)
    ├── gps.html                   # Standalone location test page (/gps)
    ├── css/
    │   ├── tailwind.input.css     # Theme tokens (colors, fonts) – source for tailwind.css
    │   ├── tailwind.css           # Compiled Tailwind (works offline)
    │   └── custom.css             # Theme: graph-paper page, ink header, highlighter, scanner
    └── js/
        ├── api.js                 # ApiClient (Facade Pattern)
        ├── state.js               # Reactive AppState (Observer) + role from ?role= URL
        ├── haversine.js           # Client-side Haversine geodesic distance calculator
        ├── qr_engine.js           # QR generation, camera decoding, token/short-code parsing
        ├── headcount.js           # Photo head count: in-browser face detection (face-api), tiling, merge
        ├── vendor/
        │   ├── qrcode.min.js      # Local David Shim standard QR Code generator
        │   └── jsQR.min.js        # Local universal pure-CPU QR Code scanner
        └── components/
            ├── attendance.js      # Attendance: Instructor view & Student view (separate)
            ├── summary.js         # Class Video Upload & AI Summarization Suite
            ├── comments.js        # Comments & Question feed UI component
            ├── poll.js            # Live Polls & Dynamic percentage bars UI
            ├── review.js          # Homework upload, review, similar-code list, compare two students
            └── app.js             # Root coordinator initializing all modules
```

---

## 📡 REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/review/upload-zip` | Homework .zip (raw body, headers `X-Student-Name`, `X-Filename`, `X-Review-Language`) → starts the review |
| `POST` | `/api/review/analyze` | `{repo_url, student_name, language}` – public GitHub repository → starts the review |
| `GET` | `/api/review` | Submissions, requirements, Gemini status, similar pairs |
| `GET` | `/api/review/compare?id_a=&id_b=` | Side by side + similarity % + matching files (+ AI paragraph) |
| `POST` | `/api/review/requirements` | `{text}` – assignment requirements (instructor computer only) |
| `GET` | `/api/session/active` | Active lecture session & base GPS coordinates |
| `POST` | `/api/video/upload-file` | Upload a lecture recording (raw body, `Content-Type: video/*`, headers `X-Filename`, `X-Title`, `X-Topic`, `X-Summary-Language`) → starts the Gemini job; poll `/api/video/list` |
| `GET` | `/api/server-info` | Address phones should use (`lan_origin`: LAN or tunnel URL) — used to build the QR |
| `GET` | `/api/session/qr` | Active QR token, 6-char `short_code`, `is_active`, countdown seconds |
| `POST` | `/api/session/start` | Instructor starts a session (resets the roster by default, `reset_roster`) |
| `POST` | `/api/session/end` | Instructor ends the session — further check-ins return `session_closed` |
| `POST` | `/api/session/location` | Sets classroom GPS coordinates (`lat`, `lng`, `name`) |
| `POST` | `/api/session/create` | Configures class session, radius (500m), and QR mode |
| `POST` | `/api/attendance/verify` | **Dual-Factor verification** (`student_id`, `qr_token`, `lat`, `lng`). `qr_token` may be the raw token, the QR deep-link URL or the 6-char short code; `device_id` + the `cs302_device` cookie identify the phone. Failure `reason`: `invalid_qr`, `distance_exceeded`, `device_already_used`, `session_closed`, `student_not_found`, `missing_gps` |
| `GET` | `/api/attendance` | Roster (`students`), counts, breach log and `version`. With `?since=<version>` returns `{"unchanged": true}` when nothing changed |
| `GET` | `/api/attendance/me?student_id=…` | Lightweight status of one student + session state (used by student phones) |
| `POST` | `/api/students/register` | Student adds themselves (`student_id`, `name`, `device_id`) — one per phone per session |
| `POST` | `/api/attendance/verify-network` | Location check without phone permission: current `qr_token` + same Wi-Fi as the instructor (`student_id`, `device_id`) |
| `POST` | `/api/attendance/request-approval` | Phone can't share location: request instructor approval (`student_id`, current `qr_token`, `device_id`) |
| `POST` | `/api/attendance/approve` | Instructor approves/rejects a request (`student_id`, `approve`) |
| `GET` | `/api/attendance/stats` | Detailed statistics and audit trail of remote attempts |
| `POST` | `/api/video/upload` | **Uploads lecture recording & triggers multi-modal LLM synthesis** |
| `GET` | `/api/video/list` | Returns library of uploaded lecture videos and summaries |
| `GET` | `/api/video/detail?id=...` | Detailed summary, chapters, and transcript for a video |
| `POST` | `/api/video/qa` | **Interactive AI Q&A assistant for uploaded video** |
| `POST` | `/api/attendance/headcount` | Save a photo head count (`faces_detected`, `people_counted`) → compared with check-ins; marks nobody present |
| `GET` | `/api/attendance/export.csv` | Attendance spreadsheet (CSV) — offline download or live link for Google Sheets `IMPORTDATA` |
| `POST` | `/api/attendance/photo-scan` | Facial recognition simulation (API only — removed from the UI because it marks students present without a real check-in) |
| `GET` | `/api/feedback` | Categorized student comments and questions |
| `POST` | `/api/feedback` | Submits new live/offline question |
| `GET` | `/api/poll` | Active poll & animated percentage results |
| `POST` | `/api/poll/vote` | Casts vote in active poll |
| `GET` | `/api/review` | Student assignment reviews & comparative metrics |
