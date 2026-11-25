# 7. Sequence Diagrams

Each diagram follows the real calls in the code (class and method names match `app/` and `static/js/`).

- [7.1 Instructor starts a session and projects the rotating QR](#71-instructor-starts-a-session-and-projects-the-rotating-qr)
- [7.2 Student checks in: location → QR → verify (main flow)](#72-student-checks-in-location--qr--verify-main-flow)
- [7.3 Same phone tries to check in a second student (rejected)](#73-same-phone-tries-to-check-in-a-second-student-rejected)
- [7.4 Phone blocks location: Wi-Fi check, then instructor approval](#74-phone-blocks-location-wi-fi-check-then-instructor-approval)
- [7.5 Instructor counts the class from a photo](#75-instructor-counts-the-class-from-a-photo)
- [7.6 Live spreadsheet (Google Sheets IMPORTDATA)](#76-live-spreadsheet-google-sheets-importdata)
- [7.7 Instructor live roster polling (versioned)](#77-instructor-live-roster-polling-versioned)
- [7.8 Poll, comment, video summary, homework review](#78-poll-comment-video-summary-homework-review)

---

## 7.1 Instructor starts a session and projects the rotating QR

```mermaid
sequenceDiagram
    actor I as Instructor
    participant UI as AttendanceComponent (browser)
    participant API as ApiClient
    participant H as ClassroomRequestHandler
    participant R as ApiRouter
    participant S as AttendanceService
    participant CS as ClassSession

    I->>UI: ▶ Start Session
    UI->>API: startSession()
    API->>H: POST /api/session/start
    H->>R: handle(POST, path, body, client{ip, device_cookie})
    R->>S: note_instructor_network(ip)
    R->>S: start_session(reset_roster=True)
    S->>CS: start()  (clears device locks, approvals, head counts)
    S-->>R: {success, session}
    R-->>UI: 200 JSON

    loop every 20 s (dynamic QR)
        UI->>API: getSessionQR()
        API->>H: GET /api/session/qr
        H->>R: handle(...)
        R->>S: get_current_qr()
        S->>CS: get_current_qr_info()
        CS->>CS: slot = now // 20, token = HMAC-SHA256(secret, session, slot)
        CS-->>UI: {token, short_code, seconds_remaining}
        UI->>UI: QREngine.renderQR(deep link …/?role=student&token=…)
    end
```

---

## 7.2 Student checks in: location → QR → verify (main flow)

Location and QR are **separate steps**: the camera is never open while the phone asks for location.

```mermaid
sequenceDiagram
    actor St as Student (phone)
    participant UI as AttendanceComponent
    participant Geo as navigator.geolocation
    participant QR as QREngine
    participant API as ApiClient
    participant R as ApiRouter
    participant S as AttendanceService
    participant CS as ClassSession
    participant Stu as Student

    Note over St,UI: Step 1 – location (inside the tap, so Safari shows "Allow")
    St->>UI: 📍 Check my location
    UI->>Geo: getCurrentPosition(highAccuracy)
    Geo-->>UI: lat, lng, accuracy
    UI->>UI: calculateHaversineDistance() → show "34 m ✓"

    Note over St,UI: Step 2 – QR
    St->>UI: 📷 Start Camera
    loop every 200 ms
        UI->>QR: detectBarcode(video frame)
    end
    QR-->>UI: "https://…/?role=student&token=QR_…"
    UI->>QR: extractToken(raw) → token

    Note over St,UI: Step 3 – verify (automatic after the scan)
    UI->>API: verifyAttendance(studentId, token, lat, lng, deviceId)
    API->>R: POST /api/attendance/verify (+ cs302_device cookie)
    R->>S: verify_qr_gps_checkin(id, token, lat, lng, device_ids)
    activate S
    Note right of S: @_synchronized → DataStore.lock
    S->>CS: is_active?
    S->>CS: calculate_distance(lat, lng)
    S->>S: _device_conflict(device_ids) → none
    S->>CS: validate_qr_token(token) (current or previous slot)
    S->>S: distance ≤ 500 m ?
    S->>Stu: mark_present("qr_gps", distance, lat, lng)
    S->>S: _bind_devices(device_ids → student)
    S->>CS: log_attempt(success)
    S->>S: roster_version += 1
    deactivate S
    S-->>UI: {success, distance_meters, message}
    UI-->>St: 🎉 Attendance recorded · picker locked to this student
```

**Alternative outcomes** (same sequence, different branch): session ended → `session_closed`; expired/wrong token → `invalid_qr` (logged `rejected_qr`); distance > 500 m → `distance_exceeded` (logged `rejected_distance`, shown in 🚨 Flagged Breaches); already present → idempotent success *"already checked in"*.

---

## 7.3 Same phone tries to check in a second student (rejected)

```mermaid
sequenceDiagram
    actor A as Student A (phone X)
    participant UI as AttendanceComponent
    participant R as ApiRouter
    participant S as AttendanceService
    participant CS as ClassSession
    actor I as Instructor screen

    A->>UI: (already checked in as Noa) selects "Itai" or calls the API directly
    UI->>R: POST /api/attendance/verify {student_id: Itai, device_id: X} + cookie X'
    R->>S: verify_qr_gps_checkin(..., device_ids=[X', X])
    S->>CS: device_bindings[X'] = Noa  ≠ Itai
    S->>CS: log_attempt(rejected_device)
    S-->>UI: {success:false, reason: device_already_used, device_student_id: Noa}
    UI-->>A: 📵 This phone already checked in גיא אביב
    I->>R: GET /api/attendance?since=v (poll)
    R-->>I: flagged attempt "SAME PHONE"
```

---

## 7.4 Phone blocks location: Wi-Fi check, then instructor approval

```mermaid
sequenceDiagram
    actor St as Student (location blocked)
    participant UI as AttendanceComponent
    participant H as ClassroomRequestHandler
    participant R as ApiRouter
    participant S as AttendanceService
    actor I as Instructor

    St->>UI: 📍 Check my location
    UI-->>St: 🚫 blocked → phone-specific steps + fallback buttons

    alt 📶 Check my location by Wi-Fi
        St->>UI: tap (QR already scanned)
        UI->>H: POST /api/attendance/verify-network {token, device_id}
        H->>H: _client_ip() (CF-Connecting-IP when tunnelled)
        H->>R: handle(..., client{ip})
        R->>S: verify_by_network(id, token, ip, device_ids)
        S->>S: validate_qr_token + _device_conflict
        S->>S: same_network(ip, instructor_networks)?
        alt same Wi-Fi as the instructor
            S-->>UI: success (method qr_network)
        else different network
            S-->>UI: different_network
        end
    else 🙋 Ask the instructor to approve me
        St->>UI: tap (QR already scanned)
        UI->>R: POST /api/attendance/request-approval
        R->>S: request_manual_approval(id, token, device_ids)
        S-->>UI: status pending (phone reserved for this student)
        I->>R: GET /api/attendance → pending_approvals
        I->>R: POST /api/attendance/approve {student_id, approve:true}
        R->>S: resolve_manual_approval(id, True)
        S-->>I: student present (method instructor_approved)
        UI->>R: GET /api/attendance/me (poll every 10 s)
        R-->>UI: is_present = true
    end
```

---

## 7.5 Instructor counts the class from a photo

The photo is analysed **in the instructor's browser**; only the numbers are sent to the server. Nobody is marked present by the photo.

```mermaid
sequenceDiagram
    actor I as Instructor
    participant UI as AttendanceComponent
    participant HC as HeadCounter
    participant FA as face-api (TF.js, SSD-MobileNet)
    participant R as ApiRouter
    participant S as AttendanceService

    I->>UI: 📸 Photo count → take / upload photo
    UI->>HC: countFaces(img)
    HC->>FA: ensureModel() (first time: download from CDN)
    HC->>HC: tiles(width, height) (overlapping parts for small faces)
    loop each tile
        HC->>FA: detectAllFaces(tile canvas)
        FA-->>HC: boxes + scores
    end
    HC->>HC: mergeBoxes() (remove duplicates from overlapping tiles)
    HC-->>UI: count = 47, boxes
    UI->>HC: drawResult(canvas, img, boxes)
    I->>UI: fix count with − / + (e.g. 48), 💾 Save
    UI->>R: POST /api/attendance/headcount {faces_detected:47, people_counted:48}
    R->>S: record_headcount(47, 48)
    S->>S: checked_in = 45 → difference +3
    S-->>UI: "3 people in the photo have not checked in"
```

---

## 7.6 Live spreadsheet (Google Sheets IMPORTDATA)

```mermaid
sequenceDiagram
    actor I as Instructor
    participant GS as Google Sheets
    participant CF as Cloudflare tunnel
    participant H as ClassroomRequestHandler
    participant S as AttendanceService

    I->>GS: cell A1 = IMPORTDATA("https://….trycloudflare.com/api/attendance/export.csv")
    loop about every hour while the sheet is open (or when the formula is re-entered)
        GS->>CF: GET /api/attendance/export.csv
        CF->>H: forward
        H->>S: export_csv()
        S-->>H: CSV (ID, name, email, status, distance, time, method, course, classroom, date)
        H-->>GS: text/csv
    end
```

The **📥 Export CSV** button produces the same table as a file (offline spreadsheet).

---

## 7.7 Instructor live roster polling (versioned)

```mermaid
sequenceDiagram
    participant App as App.startLiveSync()
    participant UI as AttendanceComponent
    participant R as ApiRouter
    participant S as AttendanceService

    loop every 5 s
        App->>UI: fetchData()
        UI->>R: GET /api/attendance?since=v
        R->>S: get_roster_summary(since_version=v)
        alt nothing changed
            S-->>UI: {unchanged:true, version:v} (41 bytes)
            UI->>UI: no re-render
        else roster changed
            S-->>UI: full roster, version v+n
            UI->>UI: render()
        end
    end
```

Student phones do **not** poll the roster: they call `GET /api/attendance/me` every 10 s (own status only).

---

## 7.8 Poll, comment, video summary, homework review

```mermaid
sequenceDiagram
    actor St as Student
    actor I as Instructor
    participant FE as Components
    participant R as ApiRouter
    participant P as PollService
    participant F as FeedbackService
    participant V as VideoSummaryService
    participant C as CodeReviewService

    I->>FE: create poll (question, options)
    FE->>R: POST /api/poll/create
    R->>P: create_new_poll()
    St->>FE: vote
    FE->>R: POST /api/poll/vote
    R->>P: submit_vote(option, voter) (one vote per voter)

    St->>FE: comment / suggestion (optionally anonymous)
    FE->>R: POST /api/feedback
    R->>F: add_comment()
    I->>FE: upvote / resolve

    I->>FE: upload class recording
    FE->>R: POST /api/video/upload
    R->>V: process_uploaded_video() → summary, chapters, action items
    I->>FE: ask a question about the video
    FE->>R: POST /api/video/qa
    R->>V: ask_video_qa()

    I->>FE: analyse a student repo / compare two
    FE->>R: POST /api/review/analyze · GET /api/review/compare
    R->>C: analyze_repo() · compare_submissions()
```

> The video summary calls the real Google Gemini API (sequence below). The homework review still returns simulated model output; see the SRS (§3.4).

### Video upload → Gemini summary

```mermaid
sequenceDiagram
    actor I as Instructor
    participant UI as summary.js
    participant S as server.py
    participant V as VideoSummaryService
    participant G as GeminiClient
    participant API as Google Gemini API
    I->>UI: choose lecture.mp4
    UI->>S: POST /api/video/upload-file (streamed body)
    S->>V: start_video_job(temp file)
    V-->>UI: lecture id, status processing
    V->>G: upload_file()
    G->>API: resumable upload
    loop until ACTIVE
        G->>API: GET file state
    end
    V->>G: summarize_lecture()
    G->>API: generateContent (video + JSON schema)
    API-->>G: summary JSON
    V->>V: apply summary, delete temp file
    loop every 3 s
        UI->>S: GET /api/video/list
    end
    UI-->>I: summary, chapters, Q&A
```
