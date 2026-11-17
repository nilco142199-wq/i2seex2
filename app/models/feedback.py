"""
Feedback and Comments Domain Model.
Encapsulates student suggestions, questions, and offline feedback.
"""
from datetime import datetime
from typing import Dict, Any
import uuid


class Comment:
    """
    Represents a student feedback comment, live question, or suggestion.
    Encapsulates voting logic and resolution status.
    """
    CATEGORIES = {"question", "feedback", "suggestion", "offline"}

    def __init__(
        self,
        content: str,
        author_name: str = "Anonymous",
        is_anonymous: bool = False,
        category: str = "question",
        comment_id: str = None,
        timestamp: str = None,
        upvotes: int = 0,
        is_resolved: bool = False
    ):
        self._id = comment_id or str(uuid.uuid4())[:8]
        self._content = content.strip()
        self._is_anonymous = is_anonymous
        self._author_name = "Anonymous Student" if is_anonymous else author_name
        self._category = category if category in self.CATEGORIES else "question"
        self._timestamp = timestamp or datetime.now().strftime("%H:%M:%S")
        self._upvotes = upvotes
        self._is_resolved = is_resolved

    @property
    def id(self) -> str:
        return self._id

    @property
    def content(self) -> str:
        return self._content

    @property
    def author_name(self) -> str:
        return self._author_name

    @property
    def is_anonymous(self) -> bool:
        return self._is_anonymous

    @property
    def category(self) -> str:
        return self._category

    @property
    def timestamp(self) -> str:
        return self._timestamp

    @property
    def upvotes(self) -> int:
        return self._upvotes

    @property
    def is_resolved(self) -> bool:
        return self._is_resolved

    def upvote(self) -> int:
        """Increments vote count."""
        self._upvotes += 1
        return self._upvotes

    def toggle_resolved(self) -> bool:
        """Toggles resolved status."""
        self._is_resolved = not self._is_resolved
        return self._is_resolved

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self._id,
            "content": self._content,
            "author_name": self._author_name,
            "is_anonymous": self._is_anonymous,
            "category": self._category,
            "timestamp": self._timestamp,
            "upvotes": self._upvotes,
            "is_resolved": self._is_resolved
        }
