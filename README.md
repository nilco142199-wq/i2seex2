# 🎓 CS302 Interactive Classroom Suite (Ex2 Assignment)
> **Dual-Factor Student Attendance (Dynamic QR + 150m GPS Geofence) & Class Video AI Summarization**  
> Built adopting a **"Vibe Coding & Deep Designing"** approach: maximizing composition of clean standard libraries and tools over writing complex boilerplate from scratch, keeping everything strictly KISS (Keep It Simple, Stupid). Zero external installations required.

---

## 📋 Table of Contents
1. [System Overview & Architecture](#-system-overview--architecture)
2. [Dual-Factor Attendance: Student & Instructor Flows](#-dual-factor-attendance-student--instructor-flows)
3. [QR Code Scanner & Generator (Technical Solution)](#-qr-code-scanner--generator-technical-solution)
4. [GPS Distance Calculation (Haversine Formula)](#-gps-distance-calculation-haversine-formula)
5. [Class Video Upload & AI Summarization](#-class-video-upload--ai-summarization)
6. [Anti-Spoofing & Anti-Screenshot Security](#-anti-spoofing--anti-screenshot-security)
7. [Project Structure](#-project-structure)
8. [Quickstart Guide (Run in 10 Seconds)](#-quickstart-guide-run-in-10-seconds)
9. [10-Minute Live Demo Walkthrough](#-10-minute-live-demo-walkthrough)
10. [Automated Test Suite](#-automated-test-suite)
11. [REST API Reference](#-rest-api-reference)

---

## 🌟 System Overview & Architecture

The CS302 Interactive Classroom Suite is an end-to-end web application prototype built for university instruction. It addresses two critical operational challenges:
1. **Attendance Fraud & Friction**: Eliminates buddy-signing and remote screenshot-sharing by enforcing **Dual-Factor Geofenced Verification** (Dynamic rotating QR code + real-time GPS <= 150m).
2. **Lecture Review & Knowledge Extraction**: Enables instructors to upload video recordings of classes and leverages a multi-modal AI pipeline (Whisper ASR + Gemini LLM) to synthesize executive summaries, interactive timeline chapters, and actionable homework tasks.

```
+───────────────────────────────────────────────────────────────────────────────+
|                             INSTRUCTOR INTERFACE                              |
|  • Defines Classroom Base GPS (e.g. 32.085300, 34.781800 - Turing Hall 101)     |
|  • Displays Dynamic QR Code (HMAC-SHA256 Token rotates every 20s)             |
|  • Uploads Class Video Recording (.mp4, .webm, .mov) for Multi-Modal LLM      |
|  • Monitors Real-Time Stats: Present, Absent, & Flagged Geofence Breaches    |
+───────────────────────────────────────┬───────────────────────────────────────+
                                        │ Projector / Display
                                        ▼
+───────────────────────────────────────────────────────────────────────────────+
|                        STUDENT INTERFACE (MOBILE-OPTIMIZED)                   |
|  • Requests Device GPS Permission (navigator.geolocation.getCurrentPosition) |
|  • Calculates Live Haversine Distance (Live proximity preview: <= 150m)       |
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
|                 ↳ Distance <= 150.0 meters?                                   |
|                 ↳ IF > 150m: Logs attempt as "rejected_distance" & REJECTS    |
|                                                                               |
|  [Result]: IF BOTH PASS ➔ Student marked PRESENT with exact distance & time  |
|            IF EITHER FAILS ➔ Returns structured error + distance to student   |
+───────────────────────────────────────────────────────────────────────────────+
```

---

## 📲 Dual-Factor Attendance: Student & Instructor Flows

### 1. Student Flow (Step-by-Step)
1. **Open Mobile View**: Switch role to **👨‍🎓 Student** in the header. The interface displays the mobile smartphone card for the student (*e.g. David Kim, s103*).
2. **Device GPS Permission & Distance Preview**:
   - Click **"📍 Acquire Real Device GPS Location"**.
   - The browser prompts for location permission (`navigator.geolocation`).
   - The app computes the geodesic distance to the classroom:
     - **Within 150m**: Green indicator `✓ Within allowed 150-meter classroom perimeter (30.0m)`.
     - **Beyond 150m**: Red indicator `✕ Distance exceeds 150-meter perimeter (889.6m)`.
   - *Local Simulators*: `[🟢 In-Class (30m)]` and `[🔴 At Home (850m)]` buttons allow simulating both conditions during testing without leaving your desk.
3. **Scan the QR Code**:
   - **Camera Scanner**: Click **"📷 Start Live Camera Scanner"**. The WebRTC camera viewfinder opens with a laser sweep and target reticle. Aim the camera at the instructor's screen; `jsQR` decodes the frame in real time, plays an audio chime (`AudioContext`), closes the camera, and triggers verification.
   - **Photo Upload**: Click **"📁 Upload"** to pick a photo from your library.
   - **Fast Live Scan**: Click `[⚡ Live Scan]` to capture the active token directly from the session.
   - **Stale QR Test**: Click `[⚠️ Stale QR]` to test anti-screenshot rejection.
4. **Instant Verification Feedback**:
   - **Success (Green)**: *"Attendance verified successfully! You are 30.0m from Turing Hall 101. Dual factors (QR + GPS geofence) confirmed."*
   - **Distance Violation (Red)**: *"Geofence Range Violation: You are 889.6 meters away from Turing Hall 101. Maximum allowed distance is 150 meters."*
   - **Expired QR (Amber)**: *"Invalid or expired QR code. Please scan the current rotating code displayed by the instructor."*

### 2. Instructor Flow (Step-by-Step)
1. **Session Setup & Base Geofence**:
   - Set Course Name (*e.g., "CS302 - Advanced OOP"*) and Classroom (*e.g., "Turing Hall 101"*).
   - Allowed perimeter is fixed to **150 meters**.
2. **Classroom GPS Coordinates**:
   - Click **"Auto-Fetch My Current GPS Location"** or select a campus preset (*e.g. Turing Hall 101: 32.085300, 34.781800*).
3. **Dynamic QR Code Generation**:
   - Renders a standards-compliant ISO/IEC 18004 QR code.
   - Rotates automatically every **20 seconds** with a countdown badge (`🔄 Rotates in: 18s`).
4. **Real-Time Attendance Monitoring**:
   - **✓ Verified Present**: Real-time roster with check-in timestamp (*09:04:30*), verified distance (*📍 28.4m*), and factor (*QR Code + GPS*).
   - **⏳ Not Checked In (Pending)**: Real-time list of enrolled students who are absent.
   - **🚨 Flagged Breaches**: Audit log of remote check-in attempts blocked by the geofence (*e.g., Marcus Brody tried to check in from 1,380.5m away - BLOCKED*).
   - **Export CSV**: Instant export of complete audit log.

---

## 📷 QR Code Scanner & Generator (Technical Solution)

### Why the Previous Implementation Failed & How It Was Resolved:
1. **The Root Cause**:
   - Previously, the QR generator produced a pseudo-matrix visualization rather than standard ISO Reed-Solomon codewords, preventing external cameras from decoding it.
   - Additionally, camera scanning relied exclusively on `window.BarcodeDetector`, which is **disabled by default on desktop Chrome/Safari/Firefox** without experimental flags, causing the scanner to silently return `null`.
2. **The Robust Solution**:
   - **Local Offline Libraries ([`static/js/vendor/`](file:///Users/neilcohen/Desktop/2nd%20assingment%20OOP/static/js/vendor)):**
     - Bundled David Shim's [`qrcode.min.js`](file:///Users/neilcohen/Desktop/2nd%20assingment%20OOP/static/js/vendor/qrcode.min.js) (19KB) for 100% standards-compliant ISO QR generation.
     - Bundled [`jsQR.min.js`](file:///Users/neilcohen/Desktop/2nd%20assingment%20OOP/static/js/vendor/jsQR.min.js) (128KB), the industry-standard pure-CPU pixel buffer QR decoder that works in **100% of browsers** without external network or experimental flags.
   - **Multi-Strategy Decoder ([`qr_engine.js`](file:///Users/neilcohen/Desktop/2nd%20assingment%20OOP/static/js/qr_engine.js)):**
     - **Strategy 1 (Primary)**: Captures video frame pixels onto an offscreen canvas and decodes via `jsQR(imageData.data, width, height)`.
     - **Strategy 2 (Hardware)**: Uses native `BarcodeDetector` when present.
     - **Strategy 3 (Photo Upload)**: Decodes uploaded image files through canvas analysis.
   - **Web Audio Confirmation**: Plays an audio chime (`AudioContext`) upon successful decode.

---

## 📐 GPS Distance Calculation (Haversine Formula)

The great-circle geodesic distance between the student's device and the classroom coordinates is calculated using the **Haversine formula**:

$$\Delta\phi = \phi_2 - \phi_1, \quad \Delta\lambda = \lambda_2 - \lambda_1$$

$$a = \sin^2\left(\frac{\Delta\phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta\lambda}{2}\right)$$

$$c = 2 \cdot \operatorname{atan2}\left(\sqrt{a}, \sqrt{1-a}\right), \quad d = R \cdot c \quad (R = 6,371,000 \text{ m})$$

### Python Implementation ([`session.py`](file:///Users/neilcohen/Desktop/2nd%20assingment%20OOP/app/models/session.py)):
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

The system features an automated **Class Video Upload & Multi-Modal AI Summarization Suite** ([`video_summary_service.py`](file:///Users/neilcohen/Desktop/2nd%20assingment%20OOP/app/services/video_summary_service.py)):

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
   Even if an attacker receives the QR code within seconds, the server computes the Haversine distance from their device GPS. If the distance exceeds **150 meters**, check-in is unconditionally rejected.
4. **Audit Trail of Breaches**:
   Rejected attempts are permanently logged with the student's ID, coordinates, timestamp, and distance, surfacing directly on the instructor's dashboard under **"🚨 Flagged Breaches"**.

---

## 📁 Project Structure

```
2nd assingment OOP/
├── README.md                      # Complete system specification & architecture
├── server.py                      # Multi-threaded zero-dependency HTTP server
├── tests/
│   └── test_app.py                # 11 comprehensive unit tests (100% pass)
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
        ├── state.js               # Reactive AppState (Observer Pattern)
        ├── haversine.js           # Client-side Haversine geodesic distance calculator
        ├── qr_engine.js           # Multi-strategy QR Generator & jsQR Camera Scanner
        ├── vendor/
        │   ├── qrcode.min.js      # Local David Shim standard QR Code generator
        │   └── jsQR.min.js        # Local universal pure-CPU QR Code scanner
        └── components/
            ├── attendance.js      # Dual-Factor Attendance (Instructor & Student Views)
            ├── summary.js         # Class Video Upload & AI Summarization Suite
            ├── comments.js        # Comments & Question feed UI component
            ├── poll.js            # Live Polls & Dynamic percentage bars UI
            ├── review.js          # Homework Deep Review & Side-by-side comparison UI
            └── app.js             # Root coordinator initializing all modules
```

---

## 🚀 Quickstart Guide (Run in 10 Seconds)

### Zero External Dependencies Required!
The entire backend uses Python 3's built-in standard library (`http.server`, `urllib`, `json`, `math`, `hmac`, `threading`).  
The frontend uses Tailwind CSS via CDN and local vendor libraries. **No `npm install` and no `pip install` required!**

### Step 1: Start the Server
```bash
python3 server.py
```

### Step 2: Open in Your Browser
```
http://127.0.0.1:8000/
```

---

## 🎭 10-Minute Live Demo Walkthrough

### Part 1: Instructor View (Dual-Factor QR Setup)
1. In the header dropdown, ensure role is set to **👨‍🏫 Lecturer**.
2. Click **📸 Automated Attendance**:
   - Point out the **Rotating Dynamic QR Code**: counts down `🔄 Rotates in: X seconds`.
   - In the **Classroom GPS Base Coordinates** panel: click **"Auto-Fetch My Current GPS Location"** or pick a campus preset.
   - Point out the Real-Time Statistics: **Verified Present**, **Not Checked In**, and **🚨 Flagged Breaches** (shows *Marcus Brody* who was blocked from *1,380.5m away*).

### Part 2: Student Mobile View (Testing QR & GPS Verification)
1. Switch role to **👨‍🎓 Student**.
2. Notice the **Mobile-Optimized Smartphone View**:
   - **Test 1: In-Class Check-In (Success)**:
     - Click **"🟢 In-Class (30m)"**. Indicator turns green: `✓ Within allowed 150-meter classroom perimeter (30.0m)`.
     - Click **"📷 Start Live Camera Scanner"** (aim camera at instructor QR code) OR click **"⚡ Live Scan"**.
     - Notice the **Green Success Banner**: *"🎉 SUCCESS: Attendance verified successfully! You are 30.0m from Turing Hall 101."*
   - **Test 2: Geofence Rejection (Remote Anti-Spoofing)**:
     - Click **"🔴 At Home (850m)"**. Indicator turns red: `✕ Distance exceeds 150-meter perimeter (889.6m)`.
     - Click **"⚡ Live Scan"** + **"🚀 Verify & Record Attendance"**.
     - Notice the **Red Rejection Banner**: *"✕ CHECK-IN REJECTED: Geofence Range Violation: You are 889.6 meters away. Maximum allowed distance is 150 meters."*
   - **Test 3: Stale Screenshot Rejection**:
     - Click **"🟢 In-Class (30m)"** + **"⚠️ Stale QR"** + **"🚀 Verify & Record Attendance"**.
     - Notice the **Amber Rejection Banner**: *"✕ CHECK-IN REJECTED: Invalid or expired QR code."*

### Part 3: Class Video Upload & AI Summarization
1. Click on the **🎥 Class Video & AI Summary** tab.
2. Click **"⚡ 1-Click Demo: Process Sample Lecture (850 MB)"** (or drag and drop your own `.mp4` file).
3. Watch the animated 4-step AI processing pipeline:
   - `1. 📤 Uploading Video Stream` ➔ `2. 🎙️ Whisper ASR Speech` ➔ `3. 🖼️ Frame & Slide OCR` ➔ `4. 🧠 LLM Synthesis`.
4. Inspect the resulting AI output:
   - Click between chapters in the **Timeline Chapters Navigator** (*e.g., `14:20 - Observer Pattern UML`*).
   - Review the Executive Summary and Action Items.
   - In the **"Ask AI About This Video"** box, type *"When is the homework deadline?"* and see the immediate timestamped answer (`Ref: 1:18:00`)!

---

## 🧪 Automated Test Suite

Run the unit tests to verify models, Haversine calculations, QR rotation, and the video summarization service:

```bash
python3 tests/test_app.py
```

Expected output:
```
...........
----------------------------------------------------------------------
Ran 11 tests in 0.001s

OK
```

---

## 📡 REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/session/active` | Active lecture session & base GPS coordinates |
| `GET` | `/api/session/qr` | Active dynamic QR token & countdown seconds |
| `POST` | `/api/session/location` | Sets classroom GPS coordinates (`lat`, `lng`, `name`) |
| `POST` | `/api/session/create` | Configures class session, radius (150m), and QR mode |
| `POST` | `/api/attendance/verify` | **Dual-Factor verification** (`student_id`, `qr_token`, `lat`, `lng`) |
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
