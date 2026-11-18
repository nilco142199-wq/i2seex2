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
from app.models.homework_review import SubmissionReview, SolidCompliance
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

    def test_haversine_distance(self):
        # 30 meters north
        d = haversine_distance(32.085300, 34.781800, 32.085570, 34.781800)
        self.assertAlmostEqual(d, 30.0, delta=2.0)

        # ~890 meters away
        d_far = haversine_distance(32.085300, 34.781800, 32.093300, 34.781800)
        self.assertGreater(d_far, 800.0)

    def test_qr_rotation_and_validation(self):
        qr_info = self.session.get_current_qr_info()
        valid_token = qr_info["token"]
        self.assertTrue(self.session.validate_qr_token(valid_token))

        # Invalid token should fail
        self.assertFalse(self.session.validate_qr_token("INVALID_FAKE_TOKEN"))

    def test_checkin_dual_factor_geofence(self):
        service = AttendanceService()
        token = service.get_current_qr()["token"]

        # 1. Close distance (within radius) -> SUCCESS
        res_ok = service.verify_qr_gps_checkin("s103", token, 32.104900, 35.209444)
        self.assertTrue(res_ok["success"])
        self.assertLessEqual(res_ok["distance_meters"], 500.0)

        # 2. Too far away (>500m) -> REJECTED_DISTANCE
        res_far = service.verify_qr_gps_checkin("s108", token, 32.114400, 35.209444)
        self.assertFalse(res_far["success"])
        self.assertEqual(res_far["reason"], "distance_exceeded")
        self.assertGreater(res_far["distance_meters"], 500.0)

        # 3. Invalid QR -> REJECTED_QR
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

    def test_side_by_side_review_comparison(self):
        res = self.review_service.compare_submissions("sub-101", "sub-102")
        self.assertTrue(res["success"])
        self.assertIn("leader", res["comparison"])

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


class TestArielUniversityGeofence(unittest.TestCase):
    """The default classroom is Ariel University with a 500 m radius."""
    def test_default_location_and_radius(self):
        session = AttendanceService().get_session()
        self.assertEqual(session.classroom_name, "Ariel University")
        self.assertAlmostEqual(session.classroom_lat, 32.104722, places=5)
        self.assertAlmostEqual(session.classroom_lng, 35.209444, places=5)
        self.assertEqual(session.allowed_radius_meters, 500.0)

    def test_boundary_inside_and_outside_500m(self):
        service = AttendanceService()
        service.start_session()
        token = service.get_current_qr()["token"]
        # ~490 m north of campus centre -> accepted
        ok = service.verify_qr_gps_checkin("s101", token, 32.104722 + 0.00440, 35.209444)
        self.assertTrue(ok["success"], ok)
        self.assertLess(ok["distance_meters"], 500.0)
        # ~510 m north -> rejected
        far = service.verify_qr_gps_checkin("s102", token, 32.104722 + 0.00460, 35.209444)
        self.assertFalse(far["success"])
        self.assertEqual(far["reason"], "distance_exceeded")
        # Tel Aviv (old default) -> far outside
        ta = service.verify_qr_gps_checkin("s104", token, 32.085300, 34.781800)
        self.assertEqual(ta["reason"], "distance_exceeded")


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

    def test_router_session_endpoints_and_bad_gps(self):
        router = ApiRouter()
        code, body = router.handle("POST", "/api/session/end", b"{}")
        self.assertEqual(code, 200)
        self.assertFalse(body["session"]["is_active"])
        code, body = router.handle("POST", "/api/session/start", b"{}")
        self.assertEqual(code, 200)
        self.assertTrue(body["session"]["is_active"])
        code, body = router.handle("POST", "/api/attendance/verify",
                                   json.dumps({"student_id": "s103", "qr_token": "x", "lat": "abc", "lng": 1}).encode())
        self.assertEqual(code, 400)
        self.assertEqual(body["reason"], "missing_gps")


class TestScalability(unittest.TestCase):
    """120-student roster, concurrent check-ins, cheap polling, self-registration."""

    def test_roster_has_120_israeli_students(self):
        students = DataStore().get_all_students()
        self.assertGreaterEqual(len(students), 120)
        names = {s.student_id: s.name for s in students}
        self.assertEqual(names["s101"], "Noa Cohen")
        self.assertEqual(names["s103"], "Itai Mizrahi")
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
        self.assertEqual(body["student"]["name"], "Noa Cohen")
        self.assertEqual(body["session"]["allowed_radius_meters"], 500.0)

    def test_self_registration(self):
        router = ApiRouter()
        code, body = router.handle("POST", "/api/students/register",
                                   json.dumps({"student_id": "318234567", "name": "  Moshe   Levi "}).encode())
        self.assertEqual(code, 200)
        self.assertTrue(body["created"])
        self.assertEqual(body["student"]["name"], "Moshe Levi")
        code, body = router.handle("POST", "/api/students/register",
                                   json.dumps({"student_id": "318234567", "name": "Other"}).encode())
        self.assertFalse(body["created"])  # existing ID is reused, not duplicated
        code, body = router.handle("POST", "/api/students/register",
                                   json.dumps({"student_id": "x", "name": "A"}).encode())
        self.assertEqual(code, 400)


if __name__ == "__main__":
    unittest.main()
