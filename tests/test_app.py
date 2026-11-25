"""
Comprehensive Unit Tests for CS302 Interactive Classroom Suite.
Validates OOP models, domain encapsulation, repositories, and service business logic.
"""
import os
import sys
import unittest
import json

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.models.student import Student
from app.models.feedback import Comment
from app.models.poll import Poll
from app.models.meeting_summary import MeetingSummary
from app.models.homework_review import HomeworkSubmission
from app.models.session import ClassSession, CheckInAttempt, haversine_distance
from app.repositories.datastore import DataStore
from app.services.attendance_service import AttendanceService
from app.services.feedback_service import FeedbackService
from app.services.poll_service import PollService
from app.services.ml_summary_service import MLSummaryService
from app.services.code_review_service import CodeReviewService
from app.handlers.api_router import ApiRouter


class TestStudentModel(unittest.TestCase):
    def test_student_attendance_encapsulation(self):
        student = Student("t01", "Ada Lovelace", "ada@cs.univ.edu")
        self.assertFalse(student.is_present)
        self.assertIsNone(student.check_in_time)

        student.mark_present(method="self_checkin")
        self.assertTrue(student.is_present)
        self.assertEqual(student.check_in_method, "self_checkin")
        self.assertIsNotNone(student.check_in_time)

        student.mark_absent()
        self.assertFalse(student.is_present)
        self.assertEqual(student.check_in_method, "none")


class TestCommentModel(unittest.TestCase):
    def test_comment_upvote_and_resolve(self):
        c = Comment(content="How does polymorphism work?", author_name="Alan Turing", category="question")
        self.assertEqual(c.upvotes, 0)
        self.assertFalse(c.is_resolved)

        c.upvote()
        c.upvote()
        self.assertEqual(c.upvotes, 2)

        c.toggle_resolved()
        self.assertTrue(c.is_resolved)


class TestPollModel(unittest.TestCase):
    def test_poll_voting_and_results(self):
        poll = Poll("Best design pattern?", ["Observer", "Strategy", "Factory"])
        self.assertTrue(poll.is_active)
        self.assertEqual(poll.total_votes, 0)

        # Vote for option 1
        success = poll.record_vote("1", "voter_a")
        self.assertTrue(success)
        self.assertEqual(poll.total_votes, 1)

        # Duplicate vote attempt from voter_a should be rejected
        duplicate_success = poll.record_vote("2", "voter_a")
        self.assertFalse(duplicate_success)

        # Vote from different voter
        poll.record_vote("2", "voter_b")
        self.assertEqual(poll.total_votes, 2)

        results = poll.to_dict()
        self.assertEqual(results["options"][0]["percentage"], 50.0)
        self.assertEqual(results["options"][1]["percentage"], 50.0)


class TestGeofenceAndQRSession(unittest.TestCase):
    def setUp(self):
        self.session = ClassSession(
            session_id="test_cs302",
            classroom_lat=32.085300,
            classroom_lng=34.781800,
            allowed_radius_meters=150.0,
            qr_mode="dynamic",
            qr_rotation_interval_seconds=20
        )

    def test_qr_rotation_and_validation(self):
        qr_info = self.session.get_current_qr_info()
        valid_token = qr_info["token"]
        self.assertTrue(self.session.validate_qr_token(valid_token))

        # Invalid token should fail
        self.assertFalse(self.session.validate_qr_token("INVALID_FAKE_TOKEN"))

    def test_checkin_rejects_invalid_qr(self):
        service = AttendanceService()
        service.start_session()
        res_bad_qr = service.verify_qr_gps_checkin("s105", "STALE_TOKEN", 32.104800, 35.209444)
        self.assertFalse(res_bad_qr["success"])
        self.assertEqual(res_bad_qr["reason"], "invalid_qr")


class TestServicesAndRouter(unittest.TestCase):
    def setUp(self):
        self.datastore = DataStore()
        self.attendance_service = AttendanceService(self.datastore)
        self.poll_service = PollService(self.datastore)
        self.review_service = CodeReviewService(self.datastore)
        self.router = ApiRouter()

    def test_attendance_summary(self):
        summary = self.attendance_service.get_roster_summary()
        self.assertGreaterEqual(summary["total_enrolled"], 10)
        self.assertIn("attendance_rate", summary)

    def test_photo_scan_simulation(self):
        res = self.attendance_service.simulate_photo_attendance(6)
        self.assertTrue(res["success"])
        self.assertEqual(res["biometric_matches"], 6)

    def test_no_invented_homework_reviews(self):
        """The review tab starts empty – nothing is shown that a student did not really upload."""
        for sub in self.review_service.get_all_reviews():
            self.assertTrue(sub["submission_id"].startswith("hw-"))

    def test_api_router_dispatch(self):
        code, body = self.router.handle("GET", "/api/status", b"")
        self.assertEqual(code, 200)
        self.assertEqual(body["status"], "healthy")

        code, body = self.router.handle("GET", "/api/attendance", b"")
        self.assertEqual(code, 200)
        self.assertIn("students", body)

        # Test POST
        payload = json.dumps({"content": "Testing router", "category": "feedback"}).encode("utf-8")
        code, body = self.router.handle("POST", "/api/feedback", payload)
        self.assertEqual(code, 201)
        self.assertTrue(body["success"])


    def test_video_upload_and_llm_summarization(self):
        # 1. Test GET /api/video/list
        code, body = self.router.handle("GET", "/api/video/list", b"")
        self.assertEqual(code, 200)
        self.assertGreaterEqual(len(body["videos"]), 2)

        # 2. Test POST /api/video/upload
        upload_payload = json.dumps({
            "filename": "CS302_Class_Recording_Polymorphism.mp4",
            "file_size_mb": 520.5,
            "title": "Polymorphism and Dynamic Dispatch",
            "topic": "Polymorphism"
        }).encode("utf-8")
        code, body = self.router.handle("POST", "/api/video/upload", upload_payload)
        self.assertEqual(code, 200)
        self.assertTrue(body["success"])
        vid = body["video"]
        self.assertIn("chapters", vid)
        self.assertGreater(len(vid["chapters"]), 2)
        self.assertIn("key_takeaways", vid)
        self.assertIn("action_items", vid)

        # 3. Test POST /api/video/qa
        qa_payload = json.dumps({
            "video_id": vid["video_id"],
            "question": "When is the homework deadline?"
        }).encode("utf-8")
        code, body = self.router.handle("POST", "/api/video/qa", qa_payload)
        self.assertEqual(code, 200)
        self.assertTrue(body["success"])
        self.assertIn("answer", body)


class TestLocation(unittest.TestCase):
    """The ONLY location test: distance from Ariel University decides the check-in (500 m radius)."""

    def test_distance_from_required_location(self):
        service = AttendanceService()
        service.start_session()
        token = service.get_current_qr()["token"]

        near = service.verify_qr_gps_checkin("s101", token, 32.104722 + 0.0003, 35.209444)   # ~33 m
        far = service.verify_qr_gps_checkin("s102", token, 32.104722 + 0.0090, 35.209444)    # ~1 km

        self.assertTrue(near["success"])
        self.assertLess(near["distance_meters"], 500.0)
        self.assertFalse(far["success"])
        self.assertEqual(far["reason"], "distance_exceeded")
        self.assertGreater(far["distance_meters"], 500.0)


class TestQrScanFixes(unittest.TestCase):
    """QR deep links, short manual codes and session start/end."""
    def setUp(self):
        self.session = ClassSession(session_id="test_qr", qr_mode="dynamic", qr_rotation_interval_seconds=20)

    def test_deep_link_url_is_accepted(self):
        token = self.session.get_current_qr_info()["token"]
        url = f"https://192.168.1.20:8443/?role=student&token={token}"
        self.assertTrue(self.session.validate_qr_token(url))

    def test_short_code_is_accepted_case_insensitive(self):
        code = self.session.get_current_qr_info()["short_code"]
        self.assertEqual(len(code), 6)
        self.assertTrue(self.session.validate_qr_token(code))
        self.assertTrue(self.session.validate_qr_token(f" {code[:3].lower()}-{code[3:].lower()} "))
        self.assertFalse(self.session.validate_qr_token("ZZZZZZ" if code != "ZZZZZZ" else "YYYYYY"))

    def test_previous_slot_is_grace_window_only(self):
        slot = self.session.get_time_window_slot()
        self.assertTrue(self.session.validate_qr_token(self.session.generate_token_for_slot(slot - 1)))
        self.assertFalse(self.session.validate_qr_token(self.session.generate_token_for_slot(slot - 2)))
        self.assertTrue(self.session.validate_qr_token(self.session.generate_short_code_for_slot(slot - 1)))
        self.assertFalse(self.session.validate_qr_token(self.session.generate_short_code_for_slot(slot - 2)))

    def test_ended_session_rejects_checkins_and_start_reopens(self):
        service = AttendanceService()
        service.end_session()
        token = service.get_current_qr()["token"]
        res = service.verify_qr_gps_checkin("s103", token, 32.104900, 35.209444)
        self.assertFalse(res["success"])
        self.assertEqual(res["reason"], "session_closed")

        started = service.start_session()
        self.assertTrue(started["session"]["is_active"])
        self.assertEqual(service.get_roster_summary()["present_count"], 0)
        token = service.get_current_qr()["token"]
        res = service.verify_qr_gps_checkin("s103", token, 32.104900, 35.209444)
        self.assertTrue(res["success"])

    def test_router_session_endpoints(self):
        router = ApiRouter()
        code, body = router.handle("POST", "/api/session/end", b"{}")
        self.assertEqual(code, 200)
        self.assertFalse(body["session"]["is_active"])
        code, body = router.handle("POST", "/api/session/start", b"{}")
        self.assertEqual(code, 200)
        self.assertTrue(body["session"]["is_active"])


class TestScalability(unittest.TestCase):
    """120-student roster, concurrent check-ins, cheap polling, self-registration."""

    def test_roster_is_the_class_list(self):
        from app.repositories.seed_students import CLASS_LIST
        students = [s for s in DataStore().get_all_students() if s.student_id.startswith("s")]
        self.assertGreaterEqual(len(students), len(CLASS_LIST))    # 104 students from the lecturer's list
        names = {s.student_id: s.name for s in students}
        self.assertEqual(names["s101"], "גיא אביב")
        self.assertEqual(names["s103"], "דולב אהרון")
        self.assertEqual(len(set(names.values())), len(names))  # no duplicate names

    def test_concurrent_checkins_of_whole_class(self):
        import threading
        service = AttendanceService()
        service.start_session()
        token = service.get_current_qr()["token"]
        ids = [s.student_id for s in DataStore().get_all_students()]
        results, errors = [], []
        barrier = threading.Barrier(len(ids))

        def worker(sid):
            try:
                barrier.wait()  # everyone checks in at the same instant
                results.append(service.verify_qr_gps_checkin(sid, token, 32.104900, 35.209444))
            except Exception as e:  # pragma: no cover
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(sid,)) for sid in ids]
        for t in threads: t.start()
        for t in threads: t.join()

        self.assertEqual(errors, [])
        self.assertTrue(all(r["success"] for r in results))
        summary = service.get_roster_summary()
        self.assertEqual(summary["present_count"], len(ids))
        self.assertEqual(summary["total_enrolled"], len(ids))

    def test_double_checkin_is_idempotent(self):
        service = AttendanceService()
        service.start_session()
        token = service.get_current_qr()["token"]
        first = service.verify_qr_gps_checkin("s103", token, 32.104900, 35.209444)
        second = service.verify_qr_gps_checkin("s103", token, 32.104900, 35.209444)
        self.assertTrue(first["success"])
        self.assertTrue(second["success"])
        self.assertTrue(second.get("already_present"))
        self.assertEqual(first["student"]["check_in_time"], second["student"]["check_in_time"])

    def test_versioned_polling_returns_tiny_payload_when_unchanged(self):
        router = ApiRouter()
        _, full = router.handle("GET", "/api/attendance", b"")
        self.assertIn("students", full)
        self.assertNotIn("present_students", full)  # no duplicated lists anymore
        _, again = router.handle("GET", f"/api/attendance?since={full['version']}", b"")
        self.assertEqual(again, {"unchanged": True, "version": full["version"]})
        router.handle("POST", "/api/session/start", b"{}")
        _, after = router.handle("GET", f"/api/attendance?since={full['version']}", b"")
        self.assertIn("students", after)
        self.assertGreater(after["version"], full["version"])

    def test_student_status_endpoint(self):
        router = ApiRouter()
        code, body = router.handle("GET", "/api/attendance/me?student_id=s101", b"")
        self.assertEqual(code, 200)
        self.assertEqual(body["student"]["name"], "גיא אביב")

    def test_self_registration(self):
        router = ApiRouter()
        code, body = router.handle("POST", "/api/students/register",
                                   json.dumps({"student_id": "318234567", "name": "  משה   לוי "}, ensure_ascii=False).encode())
        self.assertEqual(code, 200)
        self.assertTrue(body["created"])
        self.assertEqual(body["student"]["name"], "משה לוי")  # Hebrew name, extra spaces removed
        code, body = router.handle("POST", "/api/students/register",
                                   json.dumps({"student_id": "318234567", "name": "Other"}).encode())
        self.assertFalse(body["created"])  # existing ID is reused, not duplicated
        code, body = router.handle("POST", "/api/students/register",
                                   json.dumps({"student_id": "x", "name": "A"}).encode())
        self.assertEqual(code, 400)


class TestOnePhonePerStudent(unittest.TestCase):
    """A student can't check in classmates from his own phone."""

    def setUp(self):
        self.service = AttendanceService()
        self.service.start_session()
        self.token = self.service.get_current_qr()["token"]
        self.lat, self.lng = 32.104900, 35.209444

    def test_same_phone_cannot_check_in_second_student(self):
        phone = ["phone-aaaa-1111"]
        first = self.service.verify_qr_gps_checkin("s101", self.token, self.lat, self.lng, device_ids=phone)
        second = self.service.verify_qr_gps_checkin("s102", self.token, self.lat, self.lng, device_ids=phone)
        self.assertTrue(first["success"])
        self.assertFalse(second["success"])
        self.assertEqual(second["reason"], "device_already_used")
        self.assertEqual(second["device_student_id"], "s101")
        summary = self.service.get_roster_summary()
        self.assertEqual(summary["present_count"], 1)
        self.assertTrue(any(a["status"] == "rejected_device" for a in summary["flagged_remote_attempts"]))

    def test_cookie_or_local_id_alone_is_enough_to_detect(self):
        self.service.verify_qr_gps_checkin("s101", self.token, self.lat, self.lng, device_ids=["cookie-1234", "local-5678"])
        # student cleared localStorage but the cookie is still there (or the other way round)
        res = self.service.verify_qr_gps_checkin("s102", self.token, self.lat, self.lng, device_ids=["cookie-1234", "local-9999"])
        self.assertEqual(res["reason"], "device_already_used")

    def test_different_phones_both_succeed_and_new_session_resets(self):
        a = self.service.verify_qr_gps_checkin("s101", self.token, self.lat, self.lng, device_ids=["phone-aaaa"])
        b = self.service.verify_qr_gps_checkin("s102", self.token, self.lat, self.lng, device_ids=["phone-bbbb"])
        self.assertTrue(a["success"] and b["success"])
        self.service.start_session()  # next lecture: the phone may be used by its owner again
        token = self.service.get_current_qr()["token"]
        again = self.service.verify_qr_gps_checkin("s102", token, self.lat, self.lng, device_ids=["phone-aaaa"])
        self.assertTrue(again["success"])

    def test_one_self_registration_per_phone(self):
        ok = self.service.register_student("318111222", "משה לוי", device_ids=["phone-reg-1"])
        bad = self.service.register_student("318333444", "Fake Friend", device_ids=["phone-reg-1"])
        self.assertTrue(ok["success"])
        self.assertFalse(bad["success"])
        self.assertEqual(bad["reason"], "device_already_used")

    def test_manual_approval_when_location_is_blocked(self):
        phone = ["phone-nogps-1"]
        bad_qr = self.service.request_manual_approval("s103", "OLD", device_ids=phone)
        self.assertEqual(bad_qr["reason"], "invalid_qr")
        req = self.service.request_manual_approval("s103", self.token, device_ids=phone)
        self.assertEqual(req["status"], "pending")
        # the same phone can't send a request for a friend
        friend = self.service.request_manual_approval("s104", self.token, device_ids=phone)
        self.assertEqual(friend["reason"], "device_already_used")
        self.assertEqual(len(self.service.get_roster_summary()["pending_approvals"]), 1)
        self.service.resolve_manual_approval("s103", approve=True)
        student = self.service.get_student_status("s103", phone)
        self.assertTrue(student["student"]["is_present"])
        self.assertEqual(student["student"]["check_in_method"], "instructor_approved")
        self.assertEqual(student["device_student_id"], "s103")


class TestWifiFallback(unittest.TestCase):
    """Phone blocks location: current QR + same Wi-Fi as the instructor is accepted instead."""

    def test_same_wifi_accepted_other_network_rejected(self):
        service = AttendanceService()
        service.start_session()
        service.note_instructor_network("85.130.10.20")            # instructor's public IP (campus Wi-Fi)
        token = service.get_current_qr()["token"]
        other = service.verify_by_network("s104", token, "176.12.1.9", device_ids=["phone-x-1"])  # mobile data
        same = service.verify_by_network("s105", token, "85.130.10.20", device_ids=["phone-y-2"])
        self.assertEqual(other["reason"], "different_network")
        self.assertTrue(same["success"])
        self.assertEqual(same["student"]["check_in_method"], "qr_network")
        self.assertTrue(AttendanceService.same_network("192.168.1.10", "192.168.1.77"))   # same home/LAN Wi-Fi


class TestPhotoHeadcount(unittest.TestCase):
    """Class photo head count is compared with check-ins and never marks anyone present."""

    def test_headcount_compares_without_marking_present(self):
        service = AttendanceService()
        service.start_session()
        token = service.get_current_qr()["token"]
        service.verify_qr_gps_checkin("s101", token, 32.104900, 35.209444)
        service.verify_qr_gps_checkin("s102", token, 32.104900, 35.209444)

        res = service.record_headcount(faces_detected=4, people_counted=5)
        self.assertTrue(res["success"])
        self.assertEqual(res["headcount"]["checked_in"], 2)
        self.assertEqual(res["headcount"]["difference"], 3)
        summary = service.get_roster_summary()
        self.assertEqual(summary["present_count"], 2)                 # nobody added by the photo
        self.assertEqual(summary["latest_headcount"]["people_counted"], 5)
        self.assertFalse(service.record_headcount("abc")["success"])  # invalid input rejected


class TestSpreadsheetExport(unittest.TestCase):
    """The live spreadsheet (CSV) lists every student with the right status."""

    def test_csv_has_all_students_and_status(self):
        import csv, io
        service = AttendanceService()
        service.start_session()
        token = service.get_current_qr()["token"]
        service.verify_qr_gps_checkin("s101", token, 32.104900, 35.209444)
        rows = list(csv.reader(io.StringIO(service.export_csv())))
        self.assertEqual(rows[0][:4], ["Student ID", "Name", "Email", "Status"])
        self.assertEqual(len(rows) - 1, len(DataStore().get_all_students()))
        status = {r[0]: r[3] for r in rows[1:]}
        self.assertEqual(status["s101"], "Present")
        self.assertEqual(status["s102"], "Absent")


class TestGeminiVideoPipeline(unittest.TestCase):
    """Real-LLM video summary path, run against a local stand-in for the Gemini API (no internet needed)."""

    def test_recording_is_uploaded_processed_and_summarised(self):
        import os, tempfile, time
        from tests.fake_gemini import FakeGemini, HEBREW_SUMMARY
        from app.services.gemini_client import GeminiClient
        from app.services.video_summary_service import VideoSummaryService

        fake = FakeGemini(processing_polls=2).start()
        try:
            client = GeminiClient(api_key="test-key", base_url=fake.base_url)
            client.poll_seconds = 0.05
            service = VideoSummaryService(gemini=client)
            fd, path = tempfile.mkstemp(suffix=".mp4")
            os.write(fd, b"\x00\x00\x00\x18ftypmp42" + b"x" * 5000)
            os.close(fd)

            job = service.start_video_job(path, "lecture.mp4", 0.01, title="", language="he")
            self.assertEqual(job["status"], "processing")
            self.assertFalse(job["simulated"])
            for _ in range(100):
                video = service.get_video_by_id(job["video_id"])
                if video["status"] != "processing":
                    break
                time.sleep(0.05)

            self.assertEqual(video["status"], "completed", video.get("error"))
            self.assertEqual(video["executive_summary"], HEBREW_SUMMARY["executive_summary"])
            self.assertEqual(len(video["chapters"]), 2)
            self.assertIn("gemini-3.7-flash", video["ai_model"])        # 3.8 "retired" → automatic fallback
            self.assertEqual(fake.uploaded_bytes, 5012)                  # the actual file bytes reached the API
            self.assertEqual(fake.api_keys, {"test-key"})
            self.assertFalse(os.path.exists(path))                       # temp file cleaned up
            qa = service.ask_video_qa(job["video_id"], "מתי מוסברת התבנית?")
            self.assertFalse(qa["simulated"])
            self.assertEqual(qa["timestamp"], "12:30")
        finally:
            fake.stop()

    def test_without_api_key_result_is_labelled_simulated(self):
        import os, tempfile
        from app.services.gemini_client import GeminiClient
        from app.services.video_summary_service import VideoSummaryService
        service = VideoSummaryService(gemini=GeminiClient(api_key=""))
        fd, path = tempfile.mkstemp(suffix=".mp4"); os.close(fd)
        video = service.start_video_job(path, "lecture.mp4", 1.0)
        self.assertTrue(video["simulated"])
        self.assertIn("DEMO MODE", video["executive_summary"])
        self.assertFalse(service.llm_status()["enabled"])

    def test_busy_model_is_retried_then_next_model_used(self):
        """503 'high demand' from one model → retried, then the next model answers."""
        from tests.fake_gemini import FakeGemini
        from app.services.gemini_client import GeminiClient
        fake = FakeGemini(processing_polls=0, retired_models=(), busy_models=("gemini-3.8-flash",)).start()
        try:
            client = GeminiClient(api_key="test-key", base_url=fake.base_url)
            client.retry_delays = (0.01,)
            text = client.generate([{"file_data": {"file_uri": "https://fake/files/abc123", "mime_type": "video/mp4"}},
                                    {"text": "Question: when is the homework due?"}])
            self.assertTrue(text)
            self.assertEqual(client.last_model_used, "gemini-3.7-flash")
        finally:
            fake.stop()


def _zip(files):
    import io, zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


SHAPES = """from abc import ABC, abstractmethod


class Shape(ABC):
    @abstractmethod
    def area(self):
        ...

    def describe(self):
        return f"{type(self).__name__} with area {self.area():.2f}"


class Circle(Shape):
    def __init__(self, radius):
        self.radius = radius

    def area(self):
        return 3.14 * self.radius * self.radius


class Square(Shape):
    def __init__(self, side):
        self.side = side

    def area(self):
        return self.side * self.side
"""
SHAPES_RENAMED = SHAPES.replace("Shape", "Figure").replace("radius", "r").replace("side", "edge").replace("Circle", "Round")
OTHER = """import json


def load(path):
    with open(path) as fh:
        data = json.load(fh)
    total = 0
    for row in data:
        if row.get("active"):
            total += row["amount"]
    return total


def main():
    print(load("data.json"))
"""
TESTS = "import unittest\nfrom src.shapes import Circle\n\nclass T(unittest.TestCase):\n    def test_area(self):\n        self.assertGreater(Circle(1).area(), 3)\n"


class TestHomeworkReview(unittest.TestCase):
    """Real homework review: safe zip reading, real metrics, validated LLM review, similarity between students."""

    def setUp(self):
        from app.services.gemini_client import GeminiClient
        self.offline = CodeReviewService(DataStore(), gemini=GeminiClient(api_key=""))

    def _wait(self, service, sub_id):
        import time
        for _ in range(200):
            d = service.get_review_by_id(sub_id)
            if d["status"] != "processing":
                return d
            time.sleep(0.02)
        self.fail("review did not finish")

    def test_zip_is_read_safely_and_metrics_are_real(self):
        from app.services.code_analysis import CodeBundle
        data = _zip({"proj/src/shapes.py": SHAPES, "proj/tests/test_shapes.py": TESTS, "proj/README.md": "# Shapes",
                     "proj/../evil.py": "x = 1", "proj/node_modules/lib.js": "var a;", "proj/logo.png": b"\x89PNG\x00\x00",
                     "proj/fake.py": b"\x00\x01binary"})
        bundle = CodeBundle.from_zip_bytes(data)
        self.assertEqual(sorted(bundle.files), ["README.md", "src/shapes.py", "tests/test_shapes.py"])
        m = bundle.metrics()
        self.assertEqual(m["classes"], 4)            # Shape, Circle, Square + test class T
        self.assertEqual(m["test_files"], 1)
        self.assertTrue(m["has_readme"])
        self.assertEqual(m["skipped_files"], 4)

    def test_bad_uploads_are_refused_with_a_reason(self):
        res = self.offline.submit_zip(b"not a zip", "x.zip", "Dana")
        self.assertFalse(res["success"]); self.assertIn("not a valid", res["error"])
        res = self.offline.submit_zip(_zip({"notes.txt": "hello"}), "x.zip", "Dana")
        self.assertFalse(res["success"]); self.assertIn("No source code", res["error"])
        res = self.offline.submit_zip(_zip({"a.py": SHAPES}), "x.zip", "   ")
        self.assertFalse(res["success"])
        for url in ("https://gitlab.com/a/b", "http://169.254.169.254/latest", "github.com/a", "file:///etc/passwd"):
            self.assertFalse(self.offline.submit_github(url, "Dana")["success"], url)

    def test_without_api_key_nothing_is_invented(self):
        res = self.offline.submit_zip(_zip({"src/shapes.py": SHAPES}), "hw.zip", "Dana")
        self.assertTrue(res["success"])
        d = self._wait(self.offline, res["submission"]["submission_id"])
        self.assertEqual(d["status"], "completed")
        self.assertIsNone(d["review"])               # no scores, no fake findings
        self.assertIsNone(d["overall_score"])
        self.assertEqual(d["metrics"]["classes"], 3)  # only real facts

    def test_similarity_finds_copied_code_even_with_renamed_names(self):
        a = self.offline.submit_zip(_zip({"src/shapes.py": SHAPES}), "a.zip", "Student A")["submission"]["submission_id"]
        b = self.offline.submit_zip(_zip({"shapes.py": SHAPES_RENAMED}), "b.zip", "Student B")["submission"]["submission_id"]
        c = self.offline.submit_zip(_zip({"load.py": OTHER}), "c.zip", "Student C")["submission"]["submission_id"]
        for x in (a, b, c):
            self._wait(self.offline, x)
        ab = self.offline.compare_submissions(a, b, with_ai=False)["comparison"]
        ac = self.offline.compare_submissions(a, c, with_ai=False)["comparison"]
        self.assertGreaterEqual(ab["similarity"], 80)
        self.assertLess(ac["similarity"], 20)
        self.assertEqual(ab["matching_files"][0]["file_a"], "shapes.py")   # single top folder "src/" is stripped
        pairs = self.offline.similarity_overview()
        self.assertTrue(any({p["a"], p["b"]} == {a, b} for p in pairs))

    def test_llm_review_is_checked_against_the_real_files(self):
        from tests.fake_gemini import FakeGemini
        from app.services.gemini_client import GeminiClient
        fake = FakeGemini(retired_models=()).start()
        try:
            service = CodeReviewService(DataStore(), gemini=GeminiClient(api_key="k", base_url=fake.base_url))
            res = service.submit_zip(_zip({"p/src/shapes.py": SHAPES, "p/tests/test_shapes.py": TESTS,
                                           "p/README.md": "# Shapes"}), "hw.zip", "Dana")
            d = self._wait(service, res["submission"]["submission_id"])
            self.assertEqual(d["status"], "completed", d["error"])
            r = d["review"]
            self.assertEqual(r["overall_score"], 100)                          # clamped
            self.assertEqual([p["name"] for p in r["design_patterns"]], ["Template Method"])  # ghost.py removed
            self.assertEqual([i["file"] for i in r["issues"]], ["src/shapes.py"])            # database.py removed
            self.assertEqual(r["solid"][0]["evidence"][0]["file"], "src/shapes.py")          # "shapes.py" resolved
            uml = [q for q in r["requirements"] if q["requirement"] == "Class diagram"][0]
            self.assertFalse(uml["verified"]); self.assertEqual(uml["evidence"], [])
            self.assertEqual(d["removed_claims"], 3)
            self.assertIn("Google Gemini", d["ai_model"])
            self.assertIn("ASSIGNMENT REQUIREMENTS", fake.review_prompts[0])
            self.assertIn("   9| ", fake.review_prompts[0])                     # numbered lines sent

            other = service.submit_zip(_zip({"load.py": OTHER}), "c.zip", "Noa")["submission"]["submission_id"]
            self._wait(service, other)
            cmp = service.compare_submissions(d["submission_id"], other)
            self.assertEqual(cmp["comparison"]["ai_comparison"], "Student A has tests; student B does not.")
        finally:
            fake.stop()

    def test_requirements_can_be_set(self):
        self.assertIn("Ex2", self.offline.get_requirements())
        self.assertFalse(self.offline.set_requirements("x")["success"])
        self.assertTrue(self.offline.set_requirements("1. Implement Observer. 2. Tests.")["success"])
        self.assertIn("Observer", self.offline.get_requirements())


if __name__ == "__main__":
    unittest.main()
