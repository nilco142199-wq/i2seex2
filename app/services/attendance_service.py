"""
Attendance Service.
Encapsulates business rules for dual-factor verification:
1. Dynamic / Static QR Code token validation.
2. Geolocation verification via Haversine distance formula (<= 500 meters by default, see DEFAULT_RADIUS_METERS).
Also supports audit logging of remote check-in attempts and automated photo scanning.
"""
import functools
import ipaddress
import re
from typing import Dict, Any, List, Optional
from datetime import datetime
from app.repositories.datastore import DataStore
from app.models.student import Student
from app.models.session import (
    ClassSession, CheckInAttempt, haversine_distance,
    ARIEL_UNIVERSITY_NAME, ARIEL_UNIVERSITY_LAT, ARIEL_UNIVERSITY_LNG, DEFAULT_RADIUS_METERS
)


def _synchronized(mutates: bool = True):
    """Runs the method under the datastore lock; bumps the roster version after a write."""
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(self, *args, **kwargs):
            with self._datastore.lock:
                result = fn(self, *args, **kwargs)
                if mutates:
                    self._datastore.bump_version()
                return result
        return wrapper
    return decorator


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

    @_synchronized()
    def create_or_update_session(
        self,
        course_name: str,
        classroom_name: str,
        classroom_lat: float,
        classroom_lng: float,
        allowed_radius_meters: float = DEFAULT_RADIUS_METERS,
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
            session.device_bindings = previous.device_bindings
            session.device_registrations = previous.device_registrations
            session.pending_approvals = previous.pending_approvals
            session.instructor_networks = previous.instructor_networks
        self._datastore.set_session(session)
        return session.to_dict()

    @_synchronized()
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

    @_synchronized()
    def start_session(self, reset_roster: bool = True) -> Dict[str, Any]:
        """Instructor opens a session. By default every student starts as absent."""
        session = self.get_session()
        if reset_roster:
            for student in self._datastore.get_all_students():
                student.mark_absent()
            session.attempts_log = []
        session.start()
        return {"success": True, "session": session.to_dict()}

    @_synchronized()
    def end_session(self) -> Dict[str, Any]:
        """Instructor closes the session; further check-ins are rejected."""
        session = self.get_session()
        session.end()
        return {"success": True, "session": session.to_dict()}

    @_synchronized()
    def verify_qr_gps_checkin(
        self,
        student_id: str,
        qr_token: str,
        student_lat: float,
        student_lng: float,
        device_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Authoritative server-side verification combining TWO parallel conditions:
        1. QR Token Validity (dynamic time-slotted HMAC prevents screenshot forwarding).
        2. Geofence range verification (Haversine distance <= allowed radius from instructor coordinates).
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

        # One phone = one student: block checking in friends from the same phone
        conflict = self._device_conflict(session, device_ids, student.student_id)
        if conflict:
            return self._reject_device(session, student, conflict, s_lat, s_lng, distance)

        # Already checked in this session -> idempotent success (double taps / retries are harmless)
        if student.is_present and student.check_in_method == "qr_gps":
            return {
                "success": True,
                "already_present": True,
                "student": student.to_dict(),
                "distance_meters": student.distance_meters if student.distance_meters is not None else distance,
                "allowed_radius_meters": session.allowed_radius_meters,
                "classroom_name": session.classroom_name,
                "message": f"You are already checked in (at {student.check_in_time}). No need to scan again."
            }

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

        # 3. Condition 2 Verification: GPS Distance Range (<= allowed radius)
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

        # Both conditions satisfied: record presence and lock this phone to this student
        student.mark_present(method="qr_gps", distance_meters=distance, lat=s_lat, lng=s_lng)
        self._bind_devices(session, device_ids, student.student_id)
        session.pending_approvals.pop(student.student_id, None)

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

    # ---------- one-phone-per-student helpers ----------
    @staticmethod
    def _clean_device_ids(device_ids: Optional[List[str]]) -> List[str]:
        return [d for d in (device_ids or []) if isinstance(d, str) and 8 <= len(d) <= 100]

    def _device_conflict(self, session: ClassSession, device_ids, student_id: str) -> Optional[str]:
        """Returns the OTHER student this phone already checked in, if any."""
        for d in self._clean_device_ids(device_ids):
            other = session.device_bindings.get(d)
            if other and other != student_id:
                return other
        return None

    def _bind_devices(self, session: ClassSession, device_ids, student_id: str) -> None:
        for d in self._clean_device_ids(device_ids):
            session.device_bindings[d] = student_id

    def _reject_device(self, session, student, other_id, lat=None, lng=None, distance=None):
        other = self._datastore.get_student(other_id)
        other_name = other.name if other else other_id
        msg = (f"This phone was already used to check in {other_name}. "
               f"Every student must check in from their own phone.")
        session.log_attempt(CheckInAttempt(
            student_id=student.student_id, student_name=student.name,
            student_lat=lat if lat is not None else 0.0, student_lng=lng if lng is not None else 0.0,
            distance_meters=distance if distance is not None else 0.0,
            status="rejected_device",
            message=f"Same phone as {other_name} tried to check in {student.name}"
        ))
        return {"success": False, "reason": "device_already_used", "message": msg,
                "device_student_id": other_id, "device_student_name": other_name}

    # ---------- location check WITHOUT phone permission: same network as the instructor ----------
    @staticmethod
    def same_network(a: str, b: str) -> bool:
        """Same public IP, same private /24 (LAN), or same IPv6 /64 = same Wi-Fi network."""
        try:
            ip_a, ip_b = ipaddress.ip_address(a), ipaddress.ip_address(b)
        except (ValueError, TypeError):
            return False
        if ip_a.version != ip_b.version:
            return False
        if ip_a == ip_b:
            return True
        if ip_a.version == 4:
            return ip_a.is_private and ip_b.is_private and ip_a.packed[:3] == ip_b.packed[:3]
        return ip_a.packed[:8] == ip_b.packed[:8]

    @_synchronized(mutates=False)
    def note_instructor_network(self, *ips: str) -> None:
        """Remembers the network(s) the instructor's screen is connected from."""
        session = self.get_session()
        for ip in ips:
            if ip and ip not in session.instructor_networks:
                session.instructor_networks.insert(0, ip)
        del session.instructor_networks[20:]

    @_synchronized()
    def verify_by_network(self, student_id: str, qr_token: str, client_ip: str,
                          device_ids: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Location check that needs NO phone permission: the phone must scan the current QR code
        AND be connected to the same Wi-Fi network as the instructor's device.
        """
        session = self.get_session()
        student = self._datastore.get_student(student_id)
        if not student:
            return {"success": False, "reason": "student_not_found", "message": "Select your name first."}
        if not session.is_active:
            return {"success": False, "reason": "session_closed",
                    "message": "The instructor has not started a session (or it has ended)."}
        conflict = self._device_conflict(session, device_ids, student.student_id)
        if conflict:
            return self._reject_device(session, student, conflict)
        if student.is_present:
            return {"success": True, "already_present": True, "student": student.to_dict(),
                    "message": f"You are already checked in (at {student.check_in_time})."}
        if not session.validate_qr_token(qr_token):
            return {"success": False, "reason": "invalid_qr",
                    "message": "Invalid or expired QR code. Scan the code currently on the instructor's screen."}

        if not any(self.same_network(client_ip, ip) for ip in session.instructor_networks):
            session.log_attempt(CheckInAttempt(
                student_id=student.student_id, student_name=student.name,
                student_lat=0.0, student_lng=0.0, distance_meters=0.0,
                status="rejected_network", message="Phone is not on the classroom network"))
            return {"success": False, "reason": "different_network",
                    "message": "Your phone is not on the same Wi-Fi as the instructor. "
                               "Turn off mobile data, connect to the classroom Wi-Fi and try again."}

        student.mark_present(method="qr_network")
        self._bind_devices(session, device_ids, student.student_id)
        session.pending_approvals.pop(student.student_id, None)
        msg = "Attendance verified: current QR code + you are on the classroom Wi-Fi."
        session.log_attempt(CheckInAttempt(
            student_id=student.student_id, student_name=student.name,
            student_lat=0.0, student_lng=0.0, distance_meters=0.0, status="success", message=msg))
        return {"success": True, "student": student.to_dict(), "method": "qr_network", "message": msg}

    # ---------- fallback when the phone blocks location ----------
    @_synchronized()
    def request_manual_approval(self, student_id: str, qr_token: str,
                                device_ids: Optional[List[str]] = None, reason: str = "") -> Dict[str, Any]:
        """
        The student proved they see the CURRENT QR code but their phone refuses to share
        location. The request waits on the instructor's screen for Approve / Reject.
        """
        session = self.get_session()
        student = self._datastore.get_student(student_id)
        if not student:
            return {"success": False, "reason": "student_not_found", "message": "Select your name first."}
        if not session.is_active:
            return {"success": False, "reason": "session_closed",
                    "message": "The instructor has not started a session (or it has ended)."}
        conflict = self._device_conflict(session, device_ids, student.student_id)
        if conflict:
            return self._reject_device(session, student, conflict)
        if student.is_present:
            return {"success": True, "already_present": True, "status": "approved",
                    "message": f"You are already checked in (at {student.check_in_time})."}
        if not session.validate_qr_token(qr_token):
            return {"success": False, "reason": "invalid_qr",
                    "message": "Invalid or expired QR code. Scan the code currently on the instructor's screen."}

        self._bind_devices(session, device_ids, student.student_id)  # this phone is now reserved
        session.pending_approvals[student.student_id] = {
            "student_id": student.student_id,
            "student_name": student.name,
            "requested_at": datetime.now().strftime("%H:%M:%S"),
            "reason": (reason or "Location unavailable on the phone")[:200],
            "device_ids": self._clean_device_ids(device_ids),
        }
        return {"success": True, "status": "pending",
                "message": "Request sent. The instructor will approve you after seeing you in class."}

    @_synchronized()
    def resolve_manual_approval(self, student_id: str, approve: bool) -> Dict[str, Any]:
        session = self.get_session()
        request = session.pending_approvals.pop(student_id, None)
        student = self._datastore.get_student(student_id)
        if not request or not student:
            return {"success": False, "message": "No pending request for this student."}
        if approve:
            student.mark_present(method="instructor_approved")
            status, msg = "success", "Approved by the instructor (phone location unavailable)."
        else:
            for d in request.get("device_ids", []):
                if session.device_bindings.get(d) == student_id:
                    del session.device_bindings[d]
            status, msg = "rejected_by_instructor", "Request rejected by the instructor."
        session.log_attempt(CheckInAttempt(
            student_id=student.student_id, student_name=student.name,
            student_lat=0.0, student_lng=0.0, distance_meters=0.0, status=status, message=msg))
        return {"success": True, "approved": approve, "student": student.to_dict()}

    @_synchronized(mutates=False)
    def get_roster_summary(self, since_version: Optional[int] = None) -> Dict[str, Any]:
        """
        Attendance metrics + roster. If the caller already has `since_version`,
        a tiny {"unchanged": true} payload is returned instead of the full roster.
        """
        version = self._datastore.roster_version
        if since_version is not None and since_version == version:
            return {"unchanged": True, "version": version}

        session = self.get_session()
        students = self._datastore.get_all_students()
        total = len(students)
        student_dicts = [s.to_dict() for s in students]
        present_count = sum(1 for s in students if s.is_present)
        rate = round((present_count / total * 100), 1) if total > 0 else 0.0

        flagged_remote_attempts = [
            a.to_dict() for a in session.attempts_log if a.status in ("rejected_distance", "rejected_device")
        ][:200]

        return {
            "version": version,
            "total_enrolled": total,
            "present_count": present_count,
            "absent_count": total - present_count,
            "attendance_rate": rate,
            "students": student_dicts,
            "session": session.to_dict(),
            "flagged_remote_attempts": flagged_remote_attempts,
            "pending_approvals": [
                {k: v for k, v in r.items() if k != "device_ids"} for r in session.pending_approvals.values()
            ],
            "all_recent_attempts": [a.to_dict() for a in session.attempts_log[:20]]
        }

    @_synchronized(mutates=False)
    def get_student_status(self, student_id: str, device_ids: Optional[List[str]] = None) -> Dict[str, Any]:
        """Lightweight per-student poll (a phone doesn't need the whole roster)."""
        session = self.get_session()
        student = self._datastore.get_student(student_id) if student_id else None
        device_student = None
        for d in self._clean_device_ids(device_ids):
            if d in session.device_bindings:
                device_student = session.device_bindings[d]
                break
        if student and student.is_present:
            approval = "approved" if student.check_in_method == "instructor_approved" else None
        else:
            approval = "pending" if student and student.student_id in session.pending_approvals else None
        return {
            "version": self._datastore.roster_version,
            "student": student.to_dict() if student else None,
            "device_student_id": device_student,
            "approval_status": approval,
            "session": {
                "is_active": session.is_active,
                "course_name": session.course_name,
                "classroom_name": session.classroom_name,
                "classroom_lat": session.classroom_lat,
                "classroom_lng": session.classroom_lng,
                "allowed_radius_meters": session.allowed_radius_meters,
                "qr_mode": session.qr_mode,
            },
        }

    @_synchronized()
    def register_student(self, student_id: str, name: str,
                         device_ids: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Lets a student who is not on the pre-loaded list join the roster (e.g. a real class
        of 100+ students trying the system live). Returns the existing record if the ID exists.
        """
        student_id = (student_id or "").strip()
        name = re.sub(r"\s+", " ", (name or "").strip())
        if not re.fullmatch(r"[A-Za-z0-9\-]{3,20}", student_id):
            return {"success": False, "message": "Student ID must be 3-20 letters/digits."}
        if not (2 <= len(name) <= 60):
            return {"success": False, "message": "Please enter your full name (2-60 characters)."}

        existing = self._datastore.get_student(student_id)
        if existing:
            return {"success": True, "created": False, "student": existing.to_dict()}

        session = self.get_session()
        for d in self._clean_device_ids(device_ids):
            other_id = session.device_registrations.get(d) or session.device_bindings.get(d)
            if other_id and other_id != student_id:
                other = self._datastore.get_student(other_id)
                return {"success": False, "reason": "device_already_used",
                        "message": f"This phone is already used by {other.name if other else other_id}. "
                                   f"Each student must use their own phone."}

        student = Student(
            student_id=student_id,
            name=name,
            email="",
            avatar=f"https://api.dicebear.com/7.x/notionists/svg?seed={student_id}",
        )
        self._datastore.add_student(student)
        for d in self._clean_device_ids(device_ids):
            session.device_registrations[d] = student_id
        return {"success": True, "created": True, "student": student.to_dict()}

    @_synchronized()
    def check_in(self, student_id: str, method: str = "self_checkin") -> Dict[str, Any]:
        """Registers a student as present (manual / legacy fallback)."""
        student = self._datastore.get_student(student_id)
        if not student:
            return {"success": False, "error": f"Student with ID '{student_id}' not found."}
        
        student.mark_present(method=method)
        return {"success": True, "student": student.to_dict()}

    @_synchronized()
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

    @_synchronized()
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
