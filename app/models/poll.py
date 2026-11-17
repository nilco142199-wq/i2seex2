"""
Poll and Voting Domain Models.
Encapsulates on-the-spot active polling, option management, and live aggregation.
"""
from typing import List, Dict, Any, Set
import uuid
from datetime import datetime


class PollOption:
    """Represents a selectable choice in a poll."""
    def __init__(self, option_id: str, text: str, votes: int = 0):
        self._id = option_id
        self._text = text
        self._votes = votes

    @property
    def id(self) -> str:
        return self._id

    @property
    def text(self) -> str:
        return self._text

    @property
    def votes(self) -> int:
        return self._votes

    def add_vote(self) -> None:
        self._votes += 1

    def to_dict(self, total_votes: int) -> Dict[str, Any]:
        percentage = round((self._votes / total_votes * 100), 1) if total_votes > 0 else 0.0
        return {
            "id": self._id,
            "text": self._text,
            "votes": self._votes,
            "percentage": percentage
        }


class Poll:
    """
    Represents an active or past on-the-spot classroom poll.
    Encapsulates voting constraints and tally logic.
    """
    def __init__(
        self,
        question: str,
        options: List[str],
        poll_id: str = None,
        is_active: bool = True,
        created_at: str = None
    ):
        self._id = poll_id or str(uuid.uuid4())[:8]
        self._question = question.strip()
        self._options: List[PollOption] = [
            PollOption(str(idx + 1), opt_text.strip()) for idx, opt_text in enumerate(options)
        ]
        self._is_active = is_active
        self._created_at = created_at or datetime.now().strftime("%H:%M:%S")
        self._voter_records: Set[str] = set()

    @property
    def id(self) -> str:
        return self._id

    @property
    def question(self) -> str:
        return self._question

    @property
    def is_active(self) -> bool:
        return self._is_active

    @property
    def total_votes(self) -> int:
        return sum(opt.votes for opt in self._options)

    def toggle_active(self) -> bool:
        """Toggles poll open/closed status."""
        self._is_active = not self._is_active
        return self._is_active

    def record_vote(self, option_id: str, voter_id: str = None) -> bool:
        """
        Records a vote for an option if poll is active.
        Optionally prevents duplicate votes by voter_id.
        """
        if not self._is_active:
            return False

        if voter_id:
            if voter_id in self._voter_records:
                return False  # Already voted
            self._voter_records.add(voter_id)

        for option in self._options:
            if option.id == str(option_id):
                option.add_vote()
                return True
        return False

    def to_dict(self) -> Dict[str, Any]:
        total = self.total_votes
        return {
            "id": self._id,
            "question": self._question,
            "is_active": self._is_active,
            "created_at": self._created_at,
            "total_votes": total,
            "options": [opt.to_dict(total) for opt in self._options]
        }
