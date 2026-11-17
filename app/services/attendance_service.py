"""
Attendance Service.
Encapsulates business rules for dual-factor verification:
1. Dynamic / Static QR Code token validation.
2. Geolocation verification via Haversine distance formula (<= 150 meters).
Also supports audit logging of remote check-in attempts and automated photo scanning.
"""
from typing import Dict, Any, List, Optional
from datetime import datetime
from app.repositories.datastore import DataStore
from app.models.session import (
    ClassSession, CheckInAttempt, haversine_distance,
    ARIEL_UNIVERSITY_NAME, ARIEL_UNIVERSITY_LAT, ARIEL_UNIVERSITY_LNG, DEFAULT_RADIUS_METERS
)


class AttendanceService:
    """
    Manages class sessions, anti-spoofing geofencing, QR rotation,
    and student check-in verification workflows.
    """
    def __init__(self, datastore: DataStore = None):
        self._datastore = datastore or DataStore()

    def get_session(self) -> ClassSession:
        session = self._datastore.get_active_session()
        if not session:
            session = ClassSession()
            self._datastore.set_session(session)
        return session

    def get_session_info(self) -> Dict[str, Any]:
        session = self.get_session()
        return session.to_dict()

    def get_current_qr(self) -> Dict[str, Any]:
        session = self.get_session()
        return session.get_current_qr_info()

    def create_or_update_session(
        self,
        course_name: str,
        classroom_name: str,
        classroom_lat: float,
        classroom_lng: float,
        allowed_radius_meters: float = 150.0,
        qr_mode: str = "dynamic",
        qr_rotation_interval_seconds: int = 20
    ) -> Dict[str, Any]:
        """Creates or updates a class lecture session with GPS base coordinates."""
        session = ClassSession(
            course_name=course_name or "CS302 - Advanced OOP",
            classroom_name=classroom_name or ARIEL_UNIVERSITY_NAME,
            classroom_lat=float(classroom_lat),
            classroom_lng=float(classroom_lng),
            allowed_radius_meters=float(allowed_radius_meters),
            qr_mode=qr_mode,
            qr_rotation_interval_seconds=int(qr_rotation_interval_seconds)
        )
        # Keep the live state (open/closed + audit log) when only settings change
        previous = self._datastore.get_active_session()
        if previous:
            session.is_active = previous.is_active
            session.started_at = previous.started_at
            session.ended_at = previous.ended_at
            session.attempts_log = previous.attempts_log
        self._datastore.set_session(session)
        return session.to_dict()

    def set_classroom_location(self, lat: float, lng: float, name: Optional[str] = None) -> Dict[str, Any]:
        """Updates the instructor's classroom base coordinates."""
        session = self.get_session()
        session.set_classroom_location(float(lat), float(lng), name)
        return {
            "success": True,
            "classroom_name": session.classroom_name,
            "classroom_lat": session.classroom_lat,
            "classroom_lng": session.classroom_lng,
            "allowed_radius_meters": session.allowed_radius_meters
        }

    def start_session(self, reset_roster: bool = True) -> Dict[str, Any]:
        """Instructor opens a session. By default every student starts as absent."""
        session = self.get_session()
        if reset_roster:
            for student in self._datastore.get_all_students():
                student.mark_absent()
            session.attempts_log = []
        session.start()
        return {"success": True, "session": session.to_dict()}

    def end_session(self) -> Dict[str, Any]:
        """Instructor closes the session; further check-ins are rejected."""
        session = self.get_session()
        session.end()
        return {"success": True, "session": session.to_dict()}

    def verify_qr_gps_checkin(
        self,
        student_id: str,
        qr_token: str,
        student_lat: float,
        student_lng: float
    ) -> Dict[str, Any]:
        """
        Authoritative server-side verification combining TWO parallel conditions:
        1. QR Token Validity (dynamic time-slotted HMAC prevents screenshot forwarding).
        2. Geofence range verification (Haversine distance <= 150m from instructor coordinates).
        """
        session = self.get_session()
        student = self._datastore.get_student(student_id)

        if not student:
            return {
                "success": False,
                "reason": "student_not_found",
                "message": f"Student with ID '{student_id}' is not enrolled in this course."
            }

        s_lat = float(student_lat)
        s_lng = float(student_lng)

        # 0. The instructor must have an open session
        if not session.is_active:
            return {
                "success": False,
                "reason": "session_closed",
                "message": "The instructor has not started a session (or it has ended). Ask the instructor to start the class session."
            }

        # 1. Calculate Geodesic Distance via Haversine Formula
        distance = session.calculate_distance(s_lat, s_lng)

        # 2. Condition 1 Verification: QR Code Token
        is_qr_valid = session.validate_qr_token(qr_token)
        if not is_qr_valid:
            msg = "Invalid or expired QR code. Please scan the current rotating code displayed by the instructor."
            attempt = CheckInAttempt(
                student_id=student.student_id,
                student_name=student.name,
                student_lat=s_lat,
                student_lng=s_lng,
                distance_meters=distance,
                status="rejected_qr",
                message=msg
            )
            session.log_attempt(attempt)
            return {
                "success": False,
                "reason": "invalid_qr",
                "distance_meters": distance,
                "message": msg
            }

        # 3. Condition 2 Verification: GPS Distance Range (<= 150m)
        if distance > session.allowed_radius_meters:
            msg = (
                f"Geofence Range Violation: You are {distance:.1f} meters away from {session.classroom_name}. "
                f"Maximum allowed distance is {session.allowed_radius_meters:.0f} meters."
            )
            attempt = CheckInAttempt(
                student_id=student.student_id,
                student_name=student.name,
                student_lat=s_lat,
                student_lng=s_lng,
                distance_meters=distance,
                status="rejected_distance",
                message=msg
            )
            session.log_attempt(attempt)
            return {
                "success": False,
                "reason": "distance_exceeded",
                "distance_meters": distance,
                "allowed_radius_meters": session.allowed_radius_meters,
                "classroom_name": session.classroom_name,
                "message": msg
            }

        # Both conditions satisfied: record presence
        student.mark_present(method="qr_gps", distance_meters=distance, lat=s_lat, lng=s_lng)

        success_msg = (
            f"Attendance verified successfully! You are {distance:.1f}m from {session.classroom_name}. "
            f"Dual factors (QR + GPS geofence) confirmed."
        )
        attempt = CheckInAttempt(
            student_id=student.student_id,
            student_name=student.name,
            student_lat=s_lat,
            student_lng=s_lng,
            distance_meters=distance,
            status="success",
            message=success_msg
        )
        session.log_attempt(attempt)

        return {
            "success": True,
            "student": student.to_dict(),
            "distance_meters": distance,
            "allowed_radius_meters": session.allowed_radius_meters,
            "classroom_name": session.classroom_name,
            "message": success_msg
        }

    def get_roster_summary(self) -> Dict[str, Any]:
        """Calculates attendance metrics across all enrolled students."""
        session = self.get_session()
        students = self._datastore.get_all_students()
        total = len(students)
        present_students = [s.to_dict() for s in students if s.is_present]
        absent_students = [s.to_dict() for s in students if not s.is_present]
        present_count = len(present_students)
        absent_count = len(absent_students)
        rate = round((present_count / total * 100), 1) if total > 0 else 0.0

        # Extract flagged remote attempts (attempts rejected due to distance)
        flagged_remote_attempts = [
            a.to_dict() for a in session.attempts_log if a.status == "rejected_distance"
        ]

        return {
            "total_enrolled": total,
            "present_count": present_count,
            "absent_count": absent_count,
            "attendance_rate": rate,
            "present_students": present_students,
            "absent_students": absent_students,
            "students": [s.to_dict() for s in students],
            "session": session.to_dict(),
            "flagged_remote_attempts": flagged_remote_attempts,
            "all_recent_attempts": [a.to_dict() for a in session.attempts_log[:20]]
        }

    def check_in(self, student_id: str, method: str = "self_checkin") -> Dict[str, Any]:
        """Registers a student as present (manual / legacy fallback)."""
        student = self._datastore.get_student(student_id)
        if not student:
            return {"success": False, "error": f"Student with ID '{student_id}' not found."}
        
        student.mark_present(method=method)
        return {"success": True, "student": student.to_dict()}

    def toggle_status(self, student_id: str) -> Dict[str, Any]:
        """Toggles a student's presence (lecturer manual override)."""
        student = self._datastore.get_student(student_id)
        if not student:
            return {"success": False, "error": "Student not found."}

        new_status = student.toggle_attendance(method="manual_override")
        return {
            "success": True,
            "is_present": new_status,
            "student": student.to_dict()
        }

    def simulate_photo_attendance(self, detected_faces: int = 8) -> Dict[str, Any]:
        """Simulates automated photo/facial recognition scan."""
        students = self._datastore.get_all_students()
        target_count = min(detected_faces, len(students))
        
        matched = []
        for idx, student in enumerate(students):
            if idx < target_count:
                student.mark_present(method="face_scan", distance_meters=25.0)
                matched.append(student.name)
            else:
                student.mark_absent()

        return {
            "success": True,
            "faces_detected": detected_faces,
            "biometric_matches": len(matched),
            "matched_students": matched,
            "confidence_score": 97.8,
            "summary": self.get_roster_summary()
        }
