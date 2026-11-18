"""
Class Session and Anti-Spoofing Geofence Domain Models.
Encapsulates classroom session state, GPS coordinates, Haversine geofencing,
and dynamic time-slotted QR token generation/verification.
"""
import math
import time
import re
from urllib.parse import urlparse, parse_qs
import hmac
import hashlib
from datetime import datetime
from typing import Dict, Any, Tuple, Optional, List


# Default classroom: Ariel University campus centre (Hecht Library area), Ariel.
# Source: Wikipedia "Ariel University" – 32°06′17″N 35°12′34″E.
ARIEL_UNIVERSITY_NAME = "Ariel University"
ARIEL_UNIVERSITY_LAT = 32.104722
ARIEL_UNIVERSITY_LNG = 35.209444
DEFAULT_RADIUS_METERS = 500.0


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Computes the great-circle distance between two points on Earth using the Haversine formula.
    Returns distance in meters.
    """
    R = 6371000.0  # Earth's radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(R * c, 2)


class CheckInAttempt:
    """
    Logs every check-in attempt (successful or rejected).
    Provides audit trails for instructors to detect spoofing or remote attempts.
    """
    def __init__(
        self,
        student_id: str,
        student_name: str,
        student_lat: float,
        student_lng: float,
        distance_meters: float,
        status: str,  # 'success' | 'rejected_distance' | 'rejected_qr' | 'rejected_duplicate'
        message: str,
        timestamp: Optional[str] = None
    ):
        self.student_id = student_id
        self.student_name = student_name
        self.student_lat = student_lat
        self.student_lng = student_lng
        self.distance_meters = distance_meters
        self.status = status
        self.message = message
        self.timestamp = timestamp or datetime.now().strftime("%H:%M:%S")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "student_id": self.student_id,
            "student_name": self.student_name,
            "student_lat": self.student_lat,
            "student_lng": self.student_lng,
            "distance_meters": self.distance_meters,
            "status": self.status,
            "message": self.message,
            "timestamp": self.timestamp
        }


class ClassSession:
    """
    Represents an active lecture session managed by the instructor.
    Encapsulates classroom base GPS location, dynamic rotating QR tokens,
    and anti-spoofing distance verification.
    """
    SECRET_KEY = b"cs302_attendance_geofence_secret_2026"

    def __init__(
        self,
        session_id: str = "cs302_lec08",
        course_name: str = "CS302 - Advanced OOP",
        instructor_name: str = "Prof. Architect",
        classroom_name: str = ARIEL_UNIVERSITY_NAME,
        classroom_lat: float = ARIEL_UNIVERSITY_LAT,
        classroom_lng: float = ARIEL_UNIVERSITY_LNG,
        allowed_radius_meters: float = DEFAULT_RADIUS_METERS,
        qr_mode: str = "dynamic",  # "dynamic" | "static"
        qr_rotation_interval_seconds: int = 20
    ):
        self.session_id = session_id
        self.course_name = course_name
        self.instructor_name = instructor_name
        self.classroom_name = classroom_name
        self.classroom_lat = classroom_lat
        self.classroom_lng = classroom_lng
        self.allowed_radius_meters = allowed_radius_meters
        self.qr_mode = qr_mode
        self.qr_rotation_interval = qr_rotation_interval_seconds
        self.created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.is_active = True
        self.started_at: Optional[str] = datetime.now().strftime("%H:%M:%S")
        self.ended_at: Optional[str] = None
        self.attempts_log: List[CheckInAttempt] = []

    def set_classroom_location(self, lat: float, lng: float, name: Optional[str] = None) -> None:
        """Updates the instructor's classroom base coordinates."""
        self.classroom_lat = round(lat, 6)
        self.classroom_lng = round(lng, 6)
        if name:
            self.classroom_name = name

    def get_time_window_slot(self) -> int:
        """Returns the current discrete time step for rotating QR codes."""
        if self.qr_mode == "static":
            return 0
        return int(time.time() // self.qr_rotation_interval)

    def generate_token_for_slot(self, slot: int) -> str:
        """Generates HMAC signature for a specific time-window slot."""
        msg = f"{self.session_id}:{self.course_name}:{slot}".encode("utf-8")
        sig = hmac.new(self.SECRET_KEY, msg, hashlib.sha256).hexdigest()[:16]
        return f"QR_{self.session_id}_{slot}_{sig}"

    MAX_ATTEMPTS_LOG = 1000

    SHORT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I confusion

    def generate_short_code_for_slot(self, slot: int) -> str:
        """Generates a 6-character human-readable code for manual entry (camera fallback)."""
        msg = f"short:{self.session_id}:{self.course_name}:{slot}".encode("utf-8")
        digest = hmac.new(self.SECRET_KEY, msg, hashlib.sha256).digest()
        alphabet = self.SHORT_CODE_ALPHABET
        return "".join(alphabet[b % len(alphabet)] for b in digest[:6])

    @staticmethod
    def normalize_token(raw: str) -> str:
        """
        Accepts whatever the student's device produced and extracts the token:
        - a plain token ("QR_cs302_lec08_123_abcd...")
        - a QR deep-link URL ("https://host/?role=student&token=QR_...")
        - a short manual code, with spaces/dashes/lower-case ("abc-def")
        """
        if not raw:
            return ""
        value = str(raw).strip()
        if "token=" in value or "code=" in value:
            try:
                query = parse_qs(urlparse(value).query)
                value = (query.get("token") or query.get("code") or [value])[0].strip()
            except Exception:
                pass
        if value.upper().startswith("QR_"):
            return value
        # Short manual code: drop separators, upper-case
        return re.sub(r"[\s\-_]", "", value).upper()

    def start(self) -> None:
        """Opens the session for check-ins."""
        self.is_active = True
        self.started_at = datetime.now().strftime("%H:%M:%S")
        self.ended_at = None

    def end(self) -> None:
        """Closes the session: no more check-ins are accepted."""
        self.is_active = False
        self.ended_at = datetime.now().strftime("%H:%M:%S")

    def get_current_qr_info(self) -> Dict[str, Any]:
        """
        Returns the current active QR payload and seconds remaining until rotation.
        Used by the instructor display to re-render the QR code smoothly.
        """
        slot = self.get_time_window_slot()
        token = self.generate_token_for_slot(slot)
        
        if self.qr_mode == "dynamic":
            elapsed_in_slot = time.time() % self.qr_rotation_interval
            seconds_remaining = max(1, int(self.qr_rotation_interval - elapsed_in_slot))
        else:
            seconds_remaining = 9999

        return {
            "session_id": self.session_id,
            "course_name": self.course_name,
            "classroom_name": self.classroom_name,
            "classroom_lat": self.classroom_lat,
            "classroom_lng": self.classroom_lng,
            "allowed_radius_meters": self.allowed_radius_meters,
            "qr_mode": self.qr_mode,
            "token": token,
            "short_code": self.generate_short_code_for_slot(slot),
            "is_active": self.is_active,
            "slot": slot,
            "seconds_remaining": seconds_remaining,
            "rotation_interval": self.qr_rotation_interval
        }

    def validate_qr_token(self, token: str) -> bool:
        """
        Validates token against current slot and previous slot (anti-latency grace window).
        Prevents screenshot replay attacks by ensuring tokens older than 40s are rejected.
        """
        token = self.normalize_token(token)
        if not token:
            return False

        if self.qr_mode == "static":
            slots = [0]
        else:
            current_slot = self.get_time_window_slot()
            # Accept current slot or 1 previous slot (tolerates scan flight latency)
            slots = [current_slot, current_slot - 1]

        valid = set()
        for slot in slots:
            valid.add(self.generate_token_for_slot(slot))
            valid.add(self.generate_short_code_for_slot(slot))
        return token in valid

    def calculate_distance(self, student_lat: float, student_lng: float) -> float:
        """Calculates distance in meters between student and classroom base location."""
        return haversine_distance(self.classroom_lat, self.classroom_lng, student_lat, student_lng)

    def log_attempt(self, attempt: CheckInAttempt) -> None:
        self.attempts_log.insert(0, attempt)
        # Bounded audit log: enough for a large lecture hall, constant memory
        if len(self.attempts_log) > self.MAX_ATTEMPTS_LOG:
            del self.attempts_log[self.MAX_ATTEMPTS_LOG:]

    def to_dict(self) -> Dict[str, Any]:
        qr_info = self.get_current_qr_info()
        return {
            "session_id": self.session_id,
            "course_name": self.course_name,
            "instructor_name": self.instructor_name,
            "classroom_name": self.classroom_name,
            "classroom_lat": self.classroom_lat,
            "classroom_lng": self.classroom_lng,
            "allowed_radius_meters": self.allowed_radius_meters,
            "qr_mode": self.qr_mode,
            "is_active": self.is_active,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "created_at": self.created_at,
            "qr_info": qr_info,
            "recent_attempts": [a.to_dict() for a in self.attempts_log[:15]]
        }
