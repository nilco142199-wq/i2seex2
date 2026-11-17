"""
Student and Attendance Domain Models.
Encapsulates individual student entity and attendance state transitions.
"""
from datetime import datetime
from typing import Optional, Dict, Any


class Student:
    """
    Represents a student enrolled in the course.
    Follows OOP encapsulation by managing its own attendance state.
    """
    def __init__(
        self,
        student_id: str,
        name: str,
        email: str,
        avatar: str = "",
        is_present: bool = False,
        check_in_time: Optional[str] = None,
        check_in_method: str = "none",
        distance_meters: Optional[float] = None,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None
    ):
        self._student_id = student_id
        self._name = name
        self._email = email
        self._avatar = avatar or f"https://api.dicebear.com/7.x/bottts/svg?seed={student_id}"
        self._is_present = is_present
        self._check_in_time = check_in_time
        self._check_in_method = check_in_method
        self._distance_meters = distance_meters
        self._latitude = latitude
        self._longitude = longitude

    @property
    def student_id(self) -> str:
        return self._student_id

    @property
    def name(self) -> str:
        return self._name

    @property
    def email(self) -> str:
        return self._email

    @property
    def avatar(self) -> str:
        return self._avatar

    @property
    def is_present(self) -> bool:
        return self._is_present

    @property
    def check_in_time(self) -> Optional[str]:
        return self._check_in_time

    @property
    def check_in_method(self) -> str:
        return self._check_in_method

    @property
    def distance_meters(self) -> Optional[float]:
        return self._distance_meters

    @property
    def latitude(self) -> Optional[float]:
        return self._latitude

    @property
    def longitude(self) -> Optional[float]:
        return self._longitude

    def mark_present(
        self,
        method: str = "qr_gps",
        distance_meters: Optional[float] = None,
        lat: Optional[float] = None,
        lng: Optional[float] = None
    ) -> None:
        """Mark student present with timestamp, geofence distance, and coordinates."""
        self._is_present = True
        self._check_in_time = datetime.now().strftime("%H:%M:%S")
        self._check_in_method = method
        self._distance_meters = distance_meters
        self._latitude = lat
        self._longitude = lng

    def mark_absent(self) -> None:
        """Reset student attendance status."""
        self._is_present = False
        self._check_in_time = None
        self._check_in_method = "none"
        self._distance_meters = None
        self._latitude = None
        self._longitude = None

    def toggle_attendance(self, method: str = "manual") -> bool:
        """Toggles presence and returns new status."""
        if self._is_present:
            self.mark_absent()
        else:
            self.mark_present(method=method)
        return self._is_present

    def to_dict(self) -> Dict[str, Any]:
        """Serialize student to dictionary."""
        return {
            "student_id": self._student_id,
            "name": self._name,
            "email": self._email,
            "avatar": self._avatar,
            "is_present": self._is_present,
            "check_in_time": self._check_in_time,
            "check_in_method": self._check_in_method,
            "distance_meters": self._distance_meters,
            "latitude": self._latitude,
            "longitude": self._longitude
        }
