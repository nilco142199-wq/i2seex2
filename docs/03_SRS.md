# 3. Software Requirements Specification (SRS)

Structure loosely follows IEEE 830 / ISO 29148. Requirement IDs are used in the traceability matrix (§3.7) and in the testing strategy.

## 3.1 Introduction

### Purpose
Specify the behaviour of the **CS302 Interactive Classroom Suite**, a web application used during a lecture by the lecturer (instructor) and the students.

### Definitions
| Term | Meaning |
|---|---|
| **Session** | One lecture. Opened with *Start Session*, closed with *End Session*. |
| **Rotating QR** | QR code whose token is `HMAC-SHA256(secret, session, ⌊time / 20 s⌋)`; valid for the current and the previous 20-second slot. |
| **Short code** | 6-character code derived from the same slot (manual fallback for the QR). |
| **Geofence** | Circle around the classroom: centre Ariel University `32.104722, 35.209444`, radius **500 m**. |
| **Device id** | Random id per browser: `cs302_device` cookie (server) + `localStorage` id (client). |
| **Head count** | Number of people detected in a class photo. |

### Users
| User | Device | Goal |
|---|---|---|
| **Student** | Own smartphone (iOS / Android browser) | Check in fast; comment; vote |
| **Instructor** | Laptop connected to the projector (+ optionally a phone) | Run the session; evaluate attendance; spreadsheet; polls; summaries; reviews |

## 3.2 Overall description

- **Product perspective:** stand-alone web app. One Python process serves both the REST API and the web pages. No installation for students.
- **Operating environment:** Python 3.8+ (standard library only) on the instructor's computer; any modern browser; HTTPS via Cloudflare quick tunnel for phones.
- **Design constraints:** KISS; no Moodle/Zoom integration; no personal ID numbers; must run live in class.

## 3.3 Functional requirements

### FR-A Attendance (main feature)
| ID | Requirement | Priority |
|---|---|---|
| FR-A1 | The instructor shall start and end a session; starting resets the roster, device locks, approvals and head counts. | Must |
| FR-A2 | While a session is active, the instructor screen shall display a QR code that rotates every 20 s, plus a 6-character short code. | Must |
| FR-A3 | The QR shall encode a deep link (`/?role=student&token=…`) so a phone's camera app opens Student Mode with the code filled in. | Should |
| FR-A4 | The student shall pick their name from the roster (searchable) or add themselves (ID + name). | Must |
| FR-A5 | The student shall check their location as a **separate step** (*Check my location*) and see the distance to the classroom. | Must |
| FR-A6 | The student shall scan the QR with the in-app camera, from a photo, or type the short code. | Must |
| FR-A7 | The server shall accept a check-in only if: the session is active, the token is valid (current or previous slot), and the distance ≤ 500 m. | Must |
| FR-A8 | Rejected attempts shall be logged with a reason (`rejected_distance`, `rejected_qr`, `rejected_device`, `rejected_network`). | Must |
| FR-A9 | A phone that checked in a student shall not check in, register or request approval for another student in the same session. | Must |
| FR-A10 | Check-in shall be idempotent: repeating it returns "already checked in" without changing the original time. | Should |
| FR-A11 | If the phone blocks location, the student shall be able to check in with the current QR **and** the same network as the instructor (Wi-Fi check). | Should |
| FR-A12 | As a last resort the student shall request approval; the instructor approves or rejects it. | Should |
| FR-A13 | The instructor shall be able to mark a student present/absent manually. | Must |

### FR-E Attendance evaluation & spreadsheet
| ID | Requirement | Priority |
|---|---|---|
| FR-E1 | The instructor roster shall refresh automatically (≤ 5 s) and be searchable by name or ID. | Must |
| FR-E2 | The instructor shall take/upload a class photo; faces shall be counted automatically, drawn on the photo, and correctable with −/+. | Must |
| FR-E3 | The head count shall be compared with the number of check-ins and saved; it shall **never** mark anyone present. | Must |
| FR-E4 | The instructor shall download the attendance as a CSV file (offline spreadsheet). | Must |
| FR-E5 | The system shall expose a live CSV link usable with Google Sheets `IMPORTDATA` / Excel *From Web* (online spreadsheet). | Must |

### FR-C Comments & suggestions
| ID | Requirement | Priority |
|---|---|---|
| FR-C1 | Students shall post comments/suggestions by category, optionally anonymous. | Must |
| FR-C2 | Users shall upvote comments; the instructor shall mark them resolved. | Should |

### FR-P Polls
| ID | Requirement | Priority |
|---|---|---|
| FR-P1 | The instructor shall create a poll (question + options) in seconds. | Must |
| FR-P2 | Students shall vote once per poll; results shall update live; the instructor shall open/close the poll. | Must |

### FR-V Class video ML summary
| ID | Requirement | Priority |
|---|---|---|
| FR-V1 | The instructor shall upload a class recording (Zoom/Meet/Classroom export) and receive an executive summary, chapters with timestamps, key takeaways and action items. | Must |
| FR-V2 | The instructor shall ask questions about a processed video. | Could |

### FR-R Homework deep review
| ID | Requirement | Priority |
|---|---|---|
| FR-R1 | The system shall accept a submission as a .zip or a public GitHub link and review it against the assignment requirements: requirements met/partial/missing, SOLID, design patterns, problems with fixes, scores. | Must |
| FR-R2 | The system shall compare two submissions side by side and measure how similar their code is. | Must |
| FR-R3 | Every finding shall cite a file (and line) in the submission; findings that cite files not in the submission shall be removed. | Must |
| FR-R4 | Without an LLM key the system shall show only measured facts and never invent scores. | Must |

## 3.4 Implementation status of the LLM / ML requirements

- **FR-V (video summary) uses a real LLM.** `VideoSummaryService.start_video_job()` streams the uploaded recording to the **Google Gemini Files API** through `GeminiClient`, waits until it is processed, and asks the model for a summary that must follow a JSON schema (summary, chapters, takeaways, action items, quotes, topics). Q&A sends the question with the same recording. The key comes from the `GEMINI_API_KEY` environment variable; without it the feature runs in a clearly labelled **demo mode**.
- **FR-R (homework review) uses a real LLM.** `CodeBundle` reads the zip, `GeminiClient.review_homework()` returns a JSON review that `CodeReviewService.validate_review()` checks against the real file list. Similarity between students is computed locally (no LLM).

## 3.5 Non-functional requirements

| ID | Category | Requirement | How it is met |
|---|---|---|---|
| NFR-1 | Performance | 150 simultaneous check-ins, 0 failures, p95 < 1 s | Load test: 150 → 0 failures, p95 verify 248 ms; 300 → 0 failures |
| NFR-2 | Network efficiency | Idle instructor poll < 100 bytes; phones never download the whole roster repeatedly | `?since=<version>` → 41-byte reply; phones poll `/api/attendance/me` |
| NFR-3 | Usability (KISS) | Student check-in in 3 steps, no install, works on iOS & Android browsers | Web app; steps 1-2-3 on one card |
| NFR-4 | Security | Forwarded screenshots stop working within ~40 s; remote check-ins rejected | HMAC rotating QR + geofence |
| NFR-5 | Integrity | Concurrent writes never corrupt the roster | `@_synchronized` + `DataStore.lock` |
| NFR-6 | Privacy | No ID numbers; class photos never leave the instructor's browser | Class list with names only (no IDs, fake e-mails); in-browser face detection |
| NFR-7 | Portability | Runs with Python standard library only | No `pip install` |
| NFR-8 | Availability (demo) | Public HTTPS link usable from any network | `--tunnel` |
| NFR-9 | Maintainability | Layered OOP design; storage replaceable | Router → Services → Repository |

## 3.6 External interfaces

- **User interface:** single-page web app (`static/index.html`), role chosen per tab (`?role=instructor` / `?role=student`), standalone `/gps` page.
- **REST API:** JSON over HTTP(S), see README → *REST API Reference*. Key endpoints: `/api/session/*`, `/api/attendance/*`, `/api/students/register`, `/api/feedback*`, `/api/poll*`, `/api/video/*`, `/api/review/*`, `/api/attendance/export.csv`.
- **Browser APIs:** Geolocation, `getUserMedia` (camera), `BarcodeDetector` (when available), Canvas, `localStorage`, Clipboard.
- **Third-party:** Cloudflare quick tunnel (HTTPS), jsQR and qrcode.js (bundled), face-api / TensorFlow.js (CDN), Google Sheets `IMPORTDATA`.

## 3.7 Traceability matrix

| Requirement | Main classes | Verified by |
|---|---|---|
| FR-A1 | `AttendanceService.start_session/end_session`, `ClassSession.start/end` | `test_ended_session_rejects_checkins_and_start_reopens`, `test_router_session_endpoints` |
| FR-A2, FR-A3 | `ClassSession.get_current_qr_info`, `QREngine.buildPayload` | `test_qr_rotation_and_validation`, `test_deep_link_url_is_accepted`, browser test |
| FR-A4 | `AttendanceService.register_student`, `seed_students` | `test_self_registration`, `test_roster_is_the_class_list` |
| FR-A5 | `AttendanceComponent.handleAcquireStudentGPS`, `/gps` page | browser test, real iPhone |
| FR-A6 | `QREngine.detectBarcode/extractToken` | camera e2e test (fake camera), `test_short_code_is_accepted_case_insensitive` |
| FR-A7 | `AttendanceService.verify_qr_gps_checkin`, `ClassSession.validate_qr_token/calculate_distance` | `test_distance_from_required_location`, `test_checkin_rejects_invalid_qr`, `test_previous_slot_is_grace_window_only` |
| FR-A8 | `ClassSession.log_attempt`, `CheckInAttempt` | `test_same_phone_cannot_check_in_second_student` |
| FR-A9 | `_device_conflict`, `_bind_devices` | `TestOnePhonePerStudent` (5 tests) |
| FR-A10 | `verify_qr_gps_checkin` | `test_double_checkin_is_idempotent` |
| FR-A11 | `verify_by_network`, `same_network` | `test_same_wifi_accepted_other_network_rejected` |
| FR-A12 | `request_manual_approval`, `resolve_manual_approval` | `test_manual_approval_when_location_is_blocked` |
| FR-A13 | `toggle_status`, `Student.toggle_attendance` | `test_student_attendance_encapsulation` |
| FR-E1 | `get_roster_summary(since_version)` | `test_versioned_polling_returns_tiny_payload_when_unchanged` |
| FR-E2, FR-E3 | `HeadCounter`, `record_headcount` | `test_headcount_compares_without_marking_present`, browser test |
| FR-E4, FR-E5 | `export_csv`, `/api/attendance/export.csv` | `test_csv_has_all_students_and_status` |
| FR-C1, FR-C2 | `FeedbackService`, `Comment` | `test_comment_upvote_and_resolve` |
| FR-P1, FR-P2 | `PollService`, `Poll`, `PollOption` | `test_poll_voting_and_results` |
| FR-V1, FR-V2 | `VideoSummaryService`, `VideoLecture` | `test_video_upload_and_llm_summarization` |
| FR-R1–R4 | `CodeReviewService`, `CodeBundle`, `HomeworkSubmission` | `TestHomeworkReview` (6 tests) |
| NFR-1, NFR-5 | `@_synchronized`, `ThreadedHTTPServer` | `test_concurrent_checkins_of_whole_class`, `tests/load_test.py` |
