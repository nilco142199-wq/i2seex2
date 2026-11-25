# 2. Statement of Work (SoW)

| | |
|---|---|
| **Project** | CS302 Interactive Classroom Suite – web-based teaching tool |
| **Course** | Introduction to Software Engineering (OOP, OOD) – Ex2: *Vibe Coding & Deep Designing* |
| **Team** | _[your name(s)]_ |
| **Client** | The course lecturer (on behalf of lecturers and students of the class) |
| **Date** | 18/11/2026 · **Deadline** 25/11/2026 · **Demo** in class (10 minutes) |

---

## 2.1 Background

Online tools used in class today (Moodle quizzes, Zoom chat, paper attendance sheets, generic polling sites) are scattered, slow to set up and not designed for an in-room lecture. Attendance in particular is either manual (reading names, signing a sheet) or easy to fake (a code sent over WhatsApp). The course asks for **better, simpler and LLM-ready** teaching tools.

## 2.2 Objectives

1. Let students mark attendance **in seconds from their own phone**, in a way that is hard to fake from outside the room.
2. Give the lecturer a **simple way to evaluate attendance** (live roster, class-photo head count) and a **spreadsheet** (offline file + online live sheet).
3. Provide lightweight in-class interaction: **comments/suggestions** and **on-the-spot polls**.
4. Provide **LLM-ready** analysis: a **class-video summary** and a **deep homework review** with comparison between students.
5. Keep it **KISS**: one web app, no installation for students, works on any smartphone browser.

## 2.3 Scope of work

### In scope
| # | Work item | Result |
|---|---|---|
| W1 | Attendance: rotating HMAC QR + GPS geofence (Ariel University, 500 m) | Implemented |
| W2 | Anti-fraud: one phone = one student, expired-QR rejection, breach log | Implemented |
| W3 | Fallbacks when a phone blocks location: same-Wi-Fi check, instructor approval | Implemented |
| W4 | Lecturer evaluation: live roster, search, photo head count, manual override | Implemented |
| W5 | Spreadsheet: CSV download (offline) + live `IMPORTDATA` link (online) | Implemented |
| W6 | Comments & suggestions (anonymous option, upvote, resolve) | Implemented |
| W7 | On-the-spot polls (create, vote once, live results, open/close) | Implemented |
| W8 | Class-video ML summary (chapters, takeaways, action items, Q&A) | UI + pipeline + **real LLM (Google Gemini)**; demo mode without an API key |
| W9 | Homework deep review + comparison between submissions | UI + pipeline + **real LLM (Gemini)** with evidence check; measured code similarity |
| W10 | Scalability for 100–300 students, public HTTPS link for phones | Implemented + load-tested |
| W11 | Design documents (this folder), tests, demo | Delivered |

### Out of scope (per the assignment guidelines)
- Integration with **Moodle, Zoom, Google Classroom** or university systems (SSO).
- Storing **personal information** (no ID numbers – the roster is the lecturer's class list with names only, in Hebrew; class photos are analysed in the browser and not uploaded).
- Persistent database, user accounts and passwords.
- A real paid LLM / speech-to-text subscription (the interfaces are ready for it).

## 2.4 Deliverables

| To-Do item in the assignment | Deliverable |
|---|---|
| 1. Repository, problem & scope | `README.md` → *Problem Statement & Scope* |
| 2. Submission form | Link to the repository (done by the team) |
| 3. Technical tools report | [`docs/01_tools_report.md`](01_tools_report.md) |
| 4. SoW | this document |
| 5. SRS | [`docs/03_SRS.md`](03_SRS.md) |
| 6. Use cases / client stories | [`docs/04_use_cases.md`](04_use_cases.md) |
| 7. Main software components | [`docs/05_components.md`](05_components.md) |
| 8. Class & sequence diagrams | [`docs/06_class_diagrams.md`](06_class_diagrams.md), [`docs/07_sequence_diagrams.md`](07_sequence_diagrams.md) |
| 9. Testing strategy | [`docs/08_testing_strategy.md`](08_testing_strategy.md) |
| 10. Demo web application | `server.py`, `app/`, `static/` |
| 11. Demo in class | Runbook: README → *How to Run* + *Testing Guide* |
| 12. Conclusion | [`docs/09_results_and_conclusion.md`](09_results_and_conclusion.md) |

## 2.5 Schedule

| Milestone | Date | Status |
|---|---|---|
| M1 – Problem, scope, tools research | 17/11/2026 | ✅ |
| M2 – Attendance MVP (QR + GPS) running on phones | 17/11/2026 | ✅ |
| M3 – Anti-fraud, fallbacks, 100+ student scalability | 18/11/2026 | ✅ |
| M4 – Photo head count, live spreadsheet | 18/11/2026 | ✅ |
| M5 – Design documents (SoW, SRS, use cases, diagrams, tests) | 18/11/2026 | ✅ |
| M6 – Rehearsal with real phones in class conditions | before the demo | ☐ |
| M7 – Submission (form + repository) | 25/11/2026 | ☐ |

## 2.6 Acceptance criteria

1. A student checks in from a phone in **under 30 seconds** (location → scan → verify).
2. A check-in from **more than 500 m** away, with an **expired QR**, or for a **second student from the same phone** is rejected and visible to the lecturer.
3. The lecturer sees the roster update within **5 seconds** and can download / live-link a spreadsheet.
4. **150 simultaneous** check-ins complete with **0 failures** (load test).
5. Comments, polls, video summary and homework review are reachable from the same app.
6. All automated tests pass (`python3 -m unittest discover tests`).

## 2.7 Assumptions, constraints and risks

| Type | Item | Mitigation |
|---|---|---|
| Constraint | Phones only allow camera/GPS on **HTTPS** | `--tunnel` (Cloudflare, trusted certificate) |
| Risk | A phone **blocks location** in its settings (seen on a real iPhone during testing) | Phone-specific instructions, `/gps` test page, Wi-Fi check, instructor approval |
| Risk | University Wi-Fi blocks device-to-device traffic | Public tunnel instead of LAN address |
| Risk | Face detection misses faces in a crowded photo | Tiled detection + manual −/+ correction; count is advisory only |
| Risk | Student uses two phones / private window | Rotating QR + geofence still require presence; SSO listed as future work |
| Assumption | Classroom has internet access | Needed for the tunnel and the face-detection model download |
| Constraint | In-memory data – restart clears attendance | Export CSV before stopping; database = future work |
