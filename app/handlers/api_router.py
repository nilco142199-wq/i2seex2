"""
API Router and Request Dispatcher.
Implements the Command / Front Controller pattern for JSON REST endpoints.
Dispatches incoming HTTP requests to dedicated domain services.
"""
import json
from urllib.parse import urlparse, parse_qs
from typing import Dict, Any, Tuple
from app.services.attendance_service import AttendanceService
from app.models.session import ARIEL_UNIVERSITY_NAME, ARIEL_UNIVERSITY_LAT, ARIEL_UNIVERSITY_LNG, DEFAULT_RADIUS_METERS
from app.services.feedback_service import FeedbackService
from app.services.poll_service import PollService
from app.services.ml_summary_service import MLSummaryService
from app.services.code_review_service import CodeReviewService
from app.services.video_summary_service import VideoSummaryService


class ApiRouter:
    """
    Router class mapping HTTP method and path to corresponding service methods.
    Returns (status_code, response_dict).
    """
    def __init__(self):
        self._attendance_service = AttendanceService()
        self._feedback_service = FeedbackService()
        self._poll_service = PollService()
        self._summary_service = MLSummaryService()
        self._review_service = CodeReviewService()
        self._video_service = VideoSummaryService()

    def handle(self, method: str, path: str, body: bytes) -> Tuple[int, Dict[str, Any]]:
        parsed_url = urlparse(path)
        route_path = parsed_url.path.rstrip('/')
        query_params = parse_qs(parsed_url.query)

        data = {}
        if body and len(body) > 0:
            try:
                data = json.loads(body.decode('utf-8'))
            except Exception:
                return 400, {"error": "Invalid JSON payload in request body."}

        # Route matching
        try:
            if method == "GET":
                return self._handle_get(route_path, query_params)
            elif method == "POST":
                return self._handle_post(route_path, data)
            else:
                return 405, {"error": f"Method {method} not allowed."}
        except Exception as e:
            return 500, {"error": f"Internal server error: {str(e)}"}

    def _handle_get(self, path: str, query: Dict[str, list]) -> Tuple[int, Dict[str, Any]]:
        if path == "/api/status":
            return 200, {
                "status": "healthy",
                "system": "CS302 OOP Classroom Suite",
                "version": "2.0.0"
            }

        elif path == "/api/attendance":
            return 200, self._attendance_service.get_roster_summary()

        elif path == "/api/attendance/stats":
            return 200, self._attendance_service.get_roster_summary()

        elif path == "/api/session/active":
            return 200, self._attendance_service.get_session_info()

        elif path == "/api/session/qr":
            return 200, self._attendance_service.get_current_qr()

        elif path == "/api/feedback":
            category = query.get("category", [None])[0]
            return 200, {"comments": self._feedback_service.get_comments(category)}

        elif path == "/api/poll":
            poll = self._poll_service.get_active_poll()
            return 200, {"poll": poll}

        elif path == "/api/summary":
            return 200, self._summary_service.get_summary()

        elif path == "/api/video/list":
            return 200, {"videos": self._video_service.get_all_videos()}

        elif path == "/api/video/detail":
            vid_id = query.get("id", [None])[0]
            if not vid_id:
                return 400, {"error": "Missing 'id' query parameter."}
            video = self._video_service.get_video_by_id(vid_id)
            if not video:
                return 404, {"error": f"Video {vid_id} not found."}
            return 200, {"video": video}

        elif path == "/api/review":
            return 200, {"submissions": self._review_service.get_all_reviews()}

        elif path == "/api/review/detail":
            sub_id = query.get("id", [None])[0]
            if not sub_id:
                return 400, {"error": "Missing 'id' query parameter."}
            detail = self._review_service.get_review_by_id(sub_id)
            if not detail:
                return 404, {"error": f"Submission {sub_id} not found."}
            return 200, {"submission": detail}

        elif path == "/api/review/compare":
            id_a = query.get("id_a", [None])[0]
            id_b = query.get("id_b", [None])[0]
            if not id_a or not id_b:
                return 400, {"error": "Both 'id_a' and 'id_b' query parameters are required."}
            result = self._review_service.compare_submissions(id_a, id_b)
            return (200, result) if result.get("success") else (400, result)

        return 404, {"error": f"API endpoint not found: {path}"}

    def _handle_post(self, path: str, data: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
        # Attendance Routes
        if path == "/api/attendance/verify":
            student_id = data.get("student_id")
            qr_token = data.get("qr_token", "")
            lat = data.get("lat")
            lng = data.get("lng")
            if lat is None or lng is None:
                return 400, {"success": False, "reason": "missing_gps", "message": "GPS coordinates (lat, lng) are required for verification."}
            try:
                lat, lng = float(lat), float(lng)
            except (TypeError, ValueError):
                return 400, {"success": False, "reason": "missing_gps", "message": "GPS coordinates must be numbers."}
            if not student_id:
                return 400, {"success": False, "reason": "student_not_found", "message": "Please select your student profile first."}
            res = self._attendance_service.verify_qr_gps_checkin(student_id, qr_token, lat, lng)
            # Return 200 with result so client receives clear structured verification feedback
            return 200, res

        elif path == "/api/session/create":
            res = self._attendance_service.create_or_update_session(
                course_name=data.get("course_name", "CS302 - Advanced OOP"),
                classroom_name=data.get("classroom_name", ARIEL_UNIVERSITY_NAME),
                classroom_lat=data.get("classroom_lat", ARIEL_UNIVERSITY_LAT),
                classroom_lng=data.get("classroom_lng", ARIEL_UNIVERSITY_LNG),
                allowed_radius_meters=data.get("allowed_radius_meters", DEFAULT_RADIUS_METERS),
                qr_mode=data.get("qr_mode", "dynamic"),
                qr_rotation_interval_seconds=data.get("qr_rotation_interval_seconds", 20)
            )
            return 200, {"success": True, "session": res}

        elif path == "/api/session/start":
            res = self._attendance_service.start_session(reset_roster=bool(data.get("reset_roster", True)))
            return 200, res

        elif path == "/api/session/end":
            return 200, self._attendance_service.end_session()

        elif path == "/api/session/location":
            lat = data.get("lat")
            lng = data.get("lng")
            name = data.get("name")
            if lat is None or lng is None:
                return 400, {"success": False, "error": "lat and lng are required."}
            res = self._attendance_service.set_classroom_location(lat, lng, name)
            return 200, res

        elif path == "/api/attendance/checkin":
            student_id = data.get("student_id")
            method = data.get("method", "self_checkin")
            res = self._attendance_service.check_in(student_id, method)
            return (200, res) if res.get("success") else (400, res)

        elif path == "/api/attendance/toggle":
            student_id = data.get("student_id")
            res = self._attendance_service.toggle_status(student_id)
            return (200, res) if res.get("success") else (400, res)

        elif path == "/api/attendance/photo-scan":
            faces = data.get("detected_faces", 8)
            res = self._attendance_service.simulate_photo_attendance(int(faces))
            return 200, res

        # Feedback Routes
        elif path == "/api/feedback":
            res = self._feedback_service.add_comment(
                content=data.get("content", ""),
                author_name=data.get("author_name", "Anonymous"),
                is_anonymous=data.get("is_anonymous", False),
                category=data.get("category", "question")
            )
            return (201, res) if res.get("success") else (400, res)

        elif path == "/api/feedback/upvote":
            comment_id = data.get("comment_id")
            res = self._feedback_service.upvote_comment(comment_id)
            return (200, res) if res.get("success") else (400, res)

        elif path == "/api/feedback/resolve":
            comment_id = data.get("comment_id")
            res = self._feedback_service.toggle_resolved(comment_id)
            return (200, res) if res.get("success") else (400, res)

        # Poll Routes
        elif path == "/api/poll/vote":
            option_id = data.get("option_id")
            voter_id = data.get("voter_id")
            res = self._poll_service.submit_vote(option_id, voter_id)
            return (200, res) if res.get("success") else (400, res)

        elif path == "/api/poll/toggle":
            res = self._poll_service.toggle_poll_state()
            return (200, res) if res.get("success") else (400, res)

        elif path == "/api/poll/create":
            question = data.get("question", "")
            options = data.get("options", [])
            res = self._poll_service.create_new_poll(question, options)
            return (201, res) if res.get("success") else (400, res)

        # Video Upload & AI Summarization Routes
        elif path == "/api/video/upload":
            filename = data.get("filename", "Class_Recording.mp4")
            filesize = data.get("file_size_mb", 450.0)
            title = data.get("title")
            topic = data.get("topic")
            res = self._video_service.process_uploaded_video(filename, filesize, title, topic)
            return 200, {"success": True, "video": res}

        elif path == "/api/video/qa":
            video_id = data.get("video_id", "vid-101")
            question = data.get("question", "")
            res = self._video_service.ask_video_qa(video_id, question)
            return 200, res

        # Summary Routes
        elif path == "/api/summary/regenerate":
            topic = data.get("topic", "Advanced OOP Design")
            res = self._summary_service.generate_custom_summary(topic)
            return 200, {"success": True, "summary": res}

        # Homework Review Routes
        elif path == "/api/review/analyze":
            repo_url = data.get("repo_url", "")
            student_name = data.get("student_name", "Student")
            res = self._review_service.analyze_repo(repo_url, student_name)
            return (201, res) if res.get("success") else (400, res)

        return 404, {"error": f"API endpoint not found: {path}"}
