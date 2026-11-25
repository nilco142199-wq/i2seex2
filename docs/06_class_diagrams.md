# 6. Low-Level Class Diagrams

The diagrams below are drawn from the actual code (`app/` and `static/js/`). Private fields are marked `-`, public members `+`, static members are underlined (`$`). GitHub renders the Mermaid blocks as images.

- [6.1 Domain model – attendance](#61-domain-model--attendance)
- [6.2 Domain model – comments, polls, video summary, homework review](#62-domain-model--comments-polls-video-summary-homework-review)
- [6.3 Service, repository and API layer](#63-service-repository-and-api-layer)
- [6.4 HTTP server](#64-http-server)
- [6.5 Front-end (browser) classes](#65-front-end-browser-classes)
- [6.6 Design patterns used](#66-design-patterns-used)

---

## 6.1 Domain model – attendance

```mermaid
classDiagram
    direction LR

    class Student {
        -str _student_id
        -str _name
        -str _email
        -str _avatar
        -bool _is_present
        -str _check_in_time
        -str _check_in_method
        -float _distance_meters
        -float _latitude
        -float _longitude
        +student_id() str
        +name() str
        +is_present() bool
        +mark_present(method, distance_meters, lat, lng) void
        +mark_absent() void
        +toggle_attendance(method) bool
        +to_dict() dict
    }

    class ClassSession {
        +str session_id
        +str course_name
        +str instructor_name
        +str classroom_name
        +float classroom_lat
        +float classroom_lng
        +float allowed_radius_meters
        +str qr_mode
        +int qr_rotation_interval_seconds
        +bool is_active
        +str started_at
        +str ended_at
        +List~CheckInAttempt~ attempts_log
        +Dict device_bindings
        +Dict device_registrations
        +Dict pending_approvals
        +List instructor_networks
        +List headcounts
        +SECRET_KEY$
        +MAX_ATTEMPTS_LOG = 1000$
        +start() void
        +end() void
        +set_classroom_location(lat, lng, name) void
        +get_time_window_slot() int
        +generate_token_for_slot(slot) str
        +generate_short_code_for_slot(slot) str
        +normalize_token(raw)$ str
        +get_current_qr_info() dict
        +validate_qr_token(token) bool
        +calculate_distance(lat, lng) float
        +log_attempt(attempt) void
        +to_dict() dict
    }

    class CheckInAttempt {
        +str student_id
        +str student_name
        +float student_lat
        +float student_lng
        +float distance_meters
        +str status
        +str message
        +str timestamp
        +to_dict() dict
    }

    class haversine_distance {
        <<function>>
        lat1, lon1, lat2, lon2 → meters
    }

    ClassSession "1" *-- "0..1000" CheckInAttempt : audit log
    ClassSession ..> haversine_distance : uses
    CheckInAttempt ..> Student : refers to (by id)
```

**Notes**
- `Student` encapsulates its attendance state: it can only change through `mark_present()`, `mark_absent()` and `toggle_attendance()` (tested in `TestStudentModel`).
- `ClassSession` owns everything that is valid for **one lecture**: the HMAC secret for the rotating QR, the geofence (centre = Ariel University, radius 500 m), the audit log and the anti-fraud state (`device_bindings`: phone → student). `start()` clears that state for the next lecture.
- `status` of a `CheckInAttempt` is one of `success`, `rejected_distance`, `rejected_qr`, `rejected_device`, `rejected_network`, `rejected_by_instructor`.

---

## 6.2 Domain model – comments, polls, video summary, homework review

```mermaid
classDiagram
    direction LR

    class Comment {
        -str _id
        -str _content
        -str _author_name
        -bool _is_anonymous
        -str _category
        -str _timestamp
        -int _upvotes
        -bool _is_resolved
        +upvote() int
        +toggle_resolved() bool
        +to_dict() dict
    }

    class Poll {
        -str _id
        -str _question
        -List~PollOption~ _options
        -bool _is_active
        -Set~str~ _voter_records
        +total_votes() int
        +toggle_active() bool
        +record_vote(option_id, voter_id) bool
        +to_dict() dict
    }
    class PollOption {
        -str _id
        -str _text
        -int _votes
        +add_vote() void
        +to_dict(total_votes) dict
    }
    Poll "1" *-- "2..*" PollOption

    class VideoLecture {
        +str video_id
        +str title
        +str filename
        +float filesize_mb
        +str duration
        +str executive_summary
        +List~VideoChapter~ chapters
        +List key_takeaways
        +List~ActionItem~ action_items
        +List~TranscriptSnippet~ transcript_snippets
        +str ai_model
        +float engagement_score
        +str status
        +to_dict() dict
    }
    class VideoChapter {
        +str timestamp
        +str title
        +str description
    }
    class MeetingSummary {
        +str lecture_id
        +str title
        +str platform
        +str executive_summary
        +List key_takeaways
        +List~ActionItem~ action_items
        +List~TranscriptSnippet~ transcript_snippets
        +float engagement_score
        +to_dict() dict
    }
    class ActionItem {
        +str task
        +str assignee
        +str due_date
        +str status
    }
    class TranscriptSnippet {
        +str timestamp
        +str speaker
        +str text
        +bool highlight
    }
    VideoLecture "1" *-- "*" VideoChapter
    VideoLecture "1" *-- "*" ActionItem
    VideoLecture "1" *-- "*" TranscriptSnippet
    MeetingSummary "1" *-- "*" ActionItem
    MeetingSummary "1" *-- "*" TranscriptSnippet

    class HomeworkSubmission {
        +str submission_id
        +str student_name
        +str source
        +str source_label
        +List files
        +dict metrics
        +set fingerprint
        +str status
        +dict review
        +int removed_claims
        +overall_score() int
        +to_summary() dict
        +to_dict() dict
    }
    class CodeBundle {
        +Dict~str,str~ files
        +from_zip_bytes(data)$ CodeBundle
        +metrics() dict
        +prompt_text() str
        +fingerprint() set
    }
    CodeBundle ..> HomeworkSubmission : fills metrics and fingerprint
```

---

## 6.3 Service, repository and API layer

```mermaid
classDiagram
    direction TB

    class DataStore {
        <<Singleton / Repository>>
        -DataStore _instance$
        -Dict~str,Student~ _students
        -List~Comment~ _comments
        -Dict~str,Poll~ _polls
        -str _active_poll_id
        -MeetingSummary _meeting_summary
        -Dict~str,HomeworkSubmission~ _submissions
        -ClassSession _session
        +RLock lock
        +int roster_version
        +bump_version() int
        +get_all_students() List~Student~
        +get_student(id) Student
        +add_student(student) Student
        +get_all_comments() List~Comment~
        +add_comment(c) Comment
        +get_active_poll() Poll
        +save_poll(p) Poll
        +get_all_reviews() List~HomeworkSubmission~
        +add_review(s) HomeworkSubmission
        +get_meeting_summary() MeetingSummary
        +get_active_session() ClassSession
        +set_session(s) ClassSession
    }

    class AttendanceService {
        -DataStore _datastore
        +get_session() ClassSession
        +get_current_qr() dict
        +start_session(reset_roster) dict
        +end_session() dict
        +set_classroom_location(lat, lng, name) dict
        +verify_qr_gps_checkin(student_id, qr_token, lat, lng, device_ids) dict
        +verify_by_network(student_id, qr_token, client_ip, device_ids) dict
        +request_manual_approval(student_id, qr_token, device_ids, reason) dict
        +resolve_manual_approval(student_id, approve) dict
        +record_headcount(faces_detected, people_counted) dict
        +export_csv() str
        +get_roster_summary(since_version) dict
        +get_student_status(student_id, device_ids) dict
        +register_student(student_id, name, device_ids) dict
        +same_network(a, b)$ bool
        -_device_conflict(session, device_ids, student_id) str
        -_bind_devices(session, device_ids, student_id) void
        -_reject_device(...) dict
    }

    class FeedbackService {
        +get_comments(category_filter) List
        +add_comment(content, author, anonymous, category) dict
        +upvote_comment(id) dict
        +toggle_resolved(id) dict
    }
    class PollService {
        +get_active_poll() dict
        +submit_vote(option_id, voter_id) dict
        +toggle_poll_state() dict
        +create_new_poll(question, options) dict
    }
    class MLSummaryService {
        +get_summary() dict
        +generate_custom_summary(topic, duration) dict
    }
    class VideoSummaryService {
        -Dict~str,VideoLecture~ _videos
        +get_all_videos() List
        +get_video_by_id(id) dict
        -GeminiClient _gemini
        +llm_status() dict
        +start_video_job(file_path, filename, size_mb, title, topic, language) dict
        -_run_job(lecture, file_path)
        +process_uploaded_video(filename, size, title, topic) dict
        +ask_video_qa(video_id, question) dict
    }
    class GeminiClient {
        -str api_key
        +bool enabled
        +upload_file(path, mime_type, name) dict
        +wait_until_active(file_info) dict
        +generate(parts, response_schema) dict
        +summarize_lecture(file_info, title, topic, language) dict
        +ask_about_lecture(file_uri, mime_type, question) dict
        +review_homework(code, requirements, student, language) dict
        +compare_homework(review_a, review_b, ...) str
    }
    class CodeReviewService {
        -GeminiClient _gemini
        -str _requirements
        +submit_zip(data, filename, student, language) dict
        +submit_github(url, student, language) dict
        +validate_review(review, files)$ tuple
        +similarity_overview() List
        +compare_submissions(id_a, id_b) dict
        +set_requirements(text) dict
    }

    class ApiRouter {
        +list server_network_ips$
        -AttendanceService _attendance_service
        -FeedbackService _feedback_service
        -PollService _poll_service
        -MLSummaryService _ml_service
        -VideoSummaryService _video_service
        -CodeReviewService _review_service
        +handle(method, path, body, client) tuple
        -_handle_get(path, query, client) tuple
        -_handle_post(path, data, client) tuple
        -_device_ids(client, extra)$ list
        -_instructor_ips(client) list
    }

    class synchronized {
        <<decorator>>
        _synchronized(mutates)
        runs method under DataStore.lock
        bumps roster_version after writes
    }

    ApiRouter --> AttendanceService
    ApiRouter --> FeedbackService
    ApiRouter --> PollService
    ApiRouter --> MLSummaryService
    ApiRouter --> VideoSummaryService
    ApiRouter --> CodeReviewService
    AttendanceService --> DataStore
    FeedbackService --> DataStore
    PollService --> DataStore
    MLSummaryService --> DataStore
    CodeReviewService --> DataStore
    VideoSummaryService --> GeminiClient
    CodeReviewService --> GeminiClient
    AttendanceService ..> synchronized : every write
    DataStore o-- Student
    DataStore o-- ClassSession
    DataStore o-- Comment
    DataStore o-- Poll
```

**Notes**
- **Layering:** `ApiRouter` (transport) → `*Service` (business rules) → `DataStore` (data). Models never call services, services never deal with HTTP.
- **Concurrency:** every attendance write goes through `@_synchronized`, which takes `DataStore.lock` and increments `roster_version`. That is how 150–300 simultaneous check-ins stay consistent (see the load test).
- Replacing the in-memory `DataStore` with a database would only change this one class – the services depend on its methods, not on how it stores data.

---

## 6.4 HTTP server

```mermaid
classDiagram
    direction LR
    class ThreadingMixIn
    class HTTPServer
    class BaseHTTPRequestHandler

    class ThreadedHTTPServer {
        +daemon_threads = True
        +request_queue_size = 512
        +handle_error(request, client_address) void
    }
    class ClassroomRequestHandler {
        +ApiRouter router$
        +str lan_origin$
        +str server_mode$
        +DEVICE_COOKIE = cs302_device$
        +timeout = 30
        +do_GET() void
        +do_POST() void
        -_handle_api(method) void
        -_serve_static() void
        -_client_ip() str
        -_device_cookie() str
        +end_headers() void
        +setup() void
    }
    ThreadingMixIn <|-- ThreadedHTTPServer
    HTTPServer <|-- ThreadedHTTPServer
    BaseHTTPRequestHandler <|-- ClassroomRequestHandler
    ThreadedHTTPServer ..> ClassroomRequestHandler : one thread per request
    ClassroomRequestHandler --> ApiRouter : /api/*
```

`server.py` also contains the start-up functions `run()`, `start_tunnel()` (Cloudflare quick tunnel), `ensure_self_signed_cert()` (`--https`), `get_lan_ip()` and `detect_public_ips()`.

---

## 6.5 Front-end (browser) classes

```mermaid
classDiagram
    direction TB

    class AppState {
        <<Singleton / Observer>>
        +str currentRole
        +str activeTab
        +str currentStudentId
        +str pendingQrToken
        +getInstance()$ AppState
        +subscribe(event, callback) void
        +notify(event, data) void
        +setRole(role) void
        +setActiveTab(tab) void
        +setCurrentStudent(id) void
    }

    class App {
        +init() void
        +switchTab(tab) void
        +updateRoleUI(role) void
        +renderDashboardSummary() void
        +startLiveSync() void
    }

    class ApiClient {
        <<Facade>>
        +request(endpoint, options)$
        +deviceId()$ str
        +getAttendance(sinceVersion)$
        +getMyAttendance(studentId)$
        +verifyAttendance(params)$
        +verifyByNetwork(params)$
        +requestApproval(params)$
        +resolveApproval(id, approve)$
        +saveHeadcount(detected, counted)$
        +registerStudent(id, name)$
        +getSessionQR()$
        +startSession()$
        +endSession()$
    }

    class QREngine {
        +buildPayload(token)$ str
        +extractToken(raw)$ str
        +renderQR(container, text, size)$
        +detectBarcode(source, thorough)$ str
        +publicOrigin()$ str
    }

    class HeadCounter {
        +LIB_URL$
        +MODEL_URL$
        +ensureModel(onStatus)$
        +countFaces(img, options)$ result
        +tiles(width, height)$ List
        +mergeBoxes(boxes)$ List
        +drawResult(canvas, img, boxes)$
    }

    class AttendanceComponent {
        -dict data
        -dict session
        -dict studentGps
        -str scannedQrToken
        -str lockedStudentId
        +init() void
        +fetchData(full) bool
        +render() void
        +renderInstructorView() str
        +renderStudentView() str
        +handleAcquireStudentGPS() Promise
        +startCameraScanner() void
        +onQrDecoded(raw, source) void
        +handleSubmitVerification() void
        +handleVerifyByNetwork() void
        +handleRequestApproval() void
        +handleHeadcountPhoto(file) void
        +handleStartSession() void
        +handleEndSession() void
    }
    class CommentsComponent
    class PollComponent
    class SummaryComponent
    class HomeworkReviewComponent

    App --> AppState
    App *-- AttendanceComponent
    App *-- CommentsComponent
    App *-- PollComponent
    App *-- SummaryComponent
    App *-- HomeworkReviewComponent
    AttendanceComponent --> AppState : subscribes
    AttendanceComponent ..> ApiClient
    AttendanceComponent ..> QREngine
    AttendanceComponent ..> HeadCounter
    CommentsComponent ..> ApiClient
    PollComponent ..> ApiClient
    SummaryComponent ..> ApiClient
    HomeworkReviewComponent ..> ApiClient
```

---

## 6.6 Design patterns used

| Pattern | Where | Why |
|---|---|---|
| **Singleton** | `DataStore`, `AppState` | One shared roster / one shared UI state |
| **Repository** | `DataStore` | Services don't know how data is stored → easy to swap for a database |
| **Service layer** | `*Service` classes | Business rules separated from HTTP and from data |
| **Facade** | `ApiClient`, `ApiRouter` | One entry point for every API call |
| **Observer** | `AppState.subscribe/notify` | Components re-render when role / tab / student changes |
| **Decorator** | `@_synchronized` | Thread-safety + version bump added to methods without changing their logic |
| **Encapsulation** | `Student`, `Comment`, `Poll` (private `_fields` + properties) | State can only change through validated methods |
