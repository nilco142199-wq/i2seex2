# 8. Testing Strategy

## 8.1 Goals
1. Prove that the **attendance rules** (the main feature) are correct: QR validity, 500 m geofence, one phone per student, fallbacks.
2. Prove that the system **holds a full lecture hall** (100–300 students at the same moment).
3. Prove that it **works on real phones** in class conditions (HTTPS, camera, location permissions).

## 8.2 Test levels

| Level | What | Tool | How to run |
|---|---|---|---|
| **Unit** | One class/method in isolation (models, services) | `unittest` | `python3 -m unittest discover tests -v` |
| **Integration** | Request → `ApiRouter` → service → `DataStore` | `unittest` (router called directly) | same command |
| **Concurrency** | The whole class (104 threads) checks in at the same instant | `unittest` + `threading.Barrier` | same command |
| **Load / system** | Real HTTP server, 150–300 virtual phones + instructor polling | `tests/load_test.py` | `python3 tests/load_test.py --students 300` |
| **End-to-end (browser)** | Full UI flows in Chrome with fake camera, fake GPS, fake iPhone/Android user agents | Playwright (development) | see §8.5 |
| **Manual on real devices** | iPhone + Android over `--tunnel`: location, camera, QR deep link | checklist §8.6 | before the demo |

## 8.3 Tests per class (as in the component list)

| Class | Test (in `tests/test_app.py`) | What it proves |
|---|---|---|
| `Student` | `test_student_attendance_encapsulation` | State changes only through `mark_present / mark_absent / toggle` |
| `Comment` | `test_comment_upvote_and_resolve` | Upvote count, resolve toggle |
| `Poll`, `PollOption` | `test_poll_voting_and_results` | One vote per voter, percentages |
| `ClassSession` | `test_qr_rotation_and_validation`, `test_previous_slot_is_grace_window_only`, `test_deep_link_url_is_accepted`, `test_short_code_is_accepted_case_insensitive` | HMAC token per 20 s slot, grace window of exactly one slot, deep link and short code accepted |
| `ClassSession` + `AttendanceService` (location) | **`test_distance_from_required_location`** (the single location test) | ~33 m from Ariel University accepted, ~1 km rejected (`distance_exceeded`) |
| `AttendanceService` – QR | `test_checkin_rejects_invalid_qr` | Expired / fake token → `invalid_qr` |
| `AttendanceService` – session | `test_ended_session_rejects_checkins_and_start_reopens` | Closed session rejects; start resets the roster |
| `AttendanceService` – anti-fraud | `test_same_phone_cannot_check_in_second_student`, `test_cookie_or_local_id_alone_is_enough_to_detect`, `test_different_phones_both_succeed_and_new_session_resets`, `test_one_self_registration_per_phone` | One phone = one student; either id detects; new session releases phones |
| `AttendanceService` – fallbacks | `test_same_wifi_accepted_other_network_rejected`, `test_manual_approval_when_location_is_blocked` | Same network accepted / other rejected; approval flow + device lock |
| `AttendanceService` – evaluation | `test_headcount_compares_without_marking_present`, `test_csv_has_all_students_and_status`, `test_attendance_summary`, `test_photo_scan_simulation` | Head count compared, nobody marked present; CSV complete and correct |
| `AttendanceService` – scale | `test_concurrent_checkins_of_whole_class`, `test_double_checkin_is_idempotent`, `test_versioned_polling_returns_tiny_payload_when_unchanged`, `test_student_status_endpoint`, `test_self_registration` | Thread-safety, idempotency, cheap polling, per-student status, registration rules |
| `DataStore` | `test_roster_is_the_class_list` | Roster = the 104-student class list, unique names |
| `ApiRouter` | `test_api_router_dispatch`, `test_router_session_endpoints` | Routing, JSON, start/end endpoints |
| `VideoSummaryService` | `test_video_upload_and_llm_summarization` | Upload produces summary, chapters, takeaways |
| `VideoSummaryService` + `GeminiClient` | `test_recording_is_uploaded_processed_and_summarised`, `test_without_api_key_result_is_labelled_simulated` (against `tests/fake_gemini.py`) | Real file reaches the API, processing is awaited, retired model → fallback, summary applied and not marked demo; without a key → labelled simulated |
| Video page (JS) | browser test: real 20 s MP4 → fake Gemini | Progress → Hebrew summary, chapter click seeks the player, Q&A answer with timestamp |
| `CodeBundle` | `test_zip_is_read_safely_and_metrics_are_real`, `test_bad_uploads_are_refused_with_a_reason` | `../` paths, binaries, node_modules skipped; counts correct; non-zip / no code / non-GitHub URLs refused |
| `CodeReviewService` | `test_no_invented_homework_reviews`, `test_without_api_key_nothing_is_invented`, `test_similarity_finds_copied_code_even_with_renamed_names`, `test_llm_review_is_checked_against_the_real_files`, `test_requirements_can_be_set` | Empty at start; no scores without a key; renamed copy ≥ 80 %, unrelated < 20 %; findings citing invented files removed (3 of 3), score clamped |
| Homework page (JS) | browser test: student uploads, lecturer uploads two more | Student sees only own; lecturer sees 3, similar pair 76 %, comparison table + AI paragraph |
| `HeadCounter` (JS) | browser test with a stand-in detector | Tiling covers the image; duplicates across tiles merged (36 of 36 faces) |
| `QREngine` (JS) | browser test with a fake camera showing the projected QR | QR rendered by the instructor view decodes in the student view |
| `ThreadedHTTPServer` | `tests/load_test.py` | 150 students: 0 failures, p95 verify ≈ 250 ms; 300 students: 0 failures |

**Current result:** `Ran 39 tests … OK` and load test `✅ PASS` (150 and 300 students).

## 8.4 Test data
- Roster = the **lecturer's class list: 104 students**, Hebrew names, no ID numbers (`seed_students.py`); everyone starts absent.
- Coordinates: Ariel University `32.104722, 35.209444`; "inside" ≈ +0.0003° latitude (~33 m); "outside" ≈ +0.009° (~1 km).
- Phones are simulated with device-id strings; networks with example IP addresses.

## 8.5 End-to-end browser checks (Playwright, development)
Flows exercised in Chrome: instructor QR → fake-camera scan → check-in; denied location on iPhone/Android/in-app user agents → correct help text; location request happens inside the user's tap (`userActivation = true`); same-phone rejection even via direct API call; Wi-Fi fallback; approval → instructor approves → student present; photo count with −/+ and save; live-sheet panel; Hebrew name search (104 students).

## 8.6 Manual real-device checklist (before the demo)
| # | Check | Expected |
|---|---|---|
| 1 | iPhone Safari opens the `--tunnel` link, `/gps` → *Check my location* | Distance shown (Location Services → Safari Websites must not be "Never") |
| 2 | Android Chrome, same | Distance shown |
| 3 | Scan the projected QR with the phone camera app | Student Mode opens with the code |
| 4 | Full check-in inside 500 m | 🎉 + name on the projector within 5 s |
| 5 | Try a second name on the same phone | Rejected, *SAME PHONE* on the projector |
| 6 | Photo count of the real class (lecturer's photos) | Count close to the people visible; correct with −/+ |
| 7 | Google Sheets `IMPORTDATA` with the tunnel link | Sheet fills with the roster |

## 8.7 Known gaps
- Face-detection accuracy can only be measured on real class photos (checklist #6).
- The Gemini pipeline is tested against `tests/fake_gemini.py` (same API, local), so tests check the flow and the labelling, not the quality of a real model's summary; that is checked by hand with a real key.
- Homework review is tested against the fake Gemini (which deliberately cites files that do not exist); the quality of a real review is checked by hand.
- No automated test runs on a physical phone; that is covered by the manual checklist.
