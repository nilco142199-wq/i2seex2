"""
Meeting Summary Domain Model.
Encapsulates automated Zoom/Meet machine learning meeting synthesis.
"""
from typing import List, Dict, Any


class ActionItem:
    def __init__(self, task: str, assignee: str, due_date: str, status: str = "pending"):
        self.task = task
        self.assignee = assignee
        self.due_date = due_date
        self.status = status

    def to_dict(self) -> Dict[str, Any]:
        return {
            "task": self.task,
            "assignee": self.assignee,
            "due_date": self.due_date,
            "status": self.status
        }


class TranscriptSnippet:
    def __init__(self, timestamp: str, speaker: str, text: str, highlight: bool = False):
        self.timestamp = timestamp
        self.speaker = speaker
        self.text = text
        self.highlight = highlight

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "speaker": self.speaker,
            "text": self.text,
            "highlight": self.highlight
        }


class MeetingSummary:
    """
    Domain model representing an automated AI synthesis of a Zoom/Google Meet lecture session.
    """
    def __init__(
        self,
        lecture_id: str,
        title: str,
        course_code: str,
        date: str,
        duration: str,
        platform: str,
        executive_summary: str,
        key_takeaways: List[str],
        action_items: List[ActionItem],
        transcript_snippets: List[TranscriptSnippet],
        topics: List[str],
        engagement_score: float = 88.5
    ):
        self.lecture_id = lecture_id
        self.title = title
        self.course_code = course_code
        self.date = date
        self.duration = duration
        self.platform = platform
        self.executive_summary = executive_summary
        self.key_takeaways = key_takeaways
        self.action_items = action_items
        self.transcript_snippets = transcript_snippets
        self.topics = topics
        self.engagement_score = engagement_score

    def to_dict(self) -> Dict[str, Any]:
        return {
            "lecture_id": self.lecture_id,
            "title": self.title,
            "course_code": self.course_code,
            "date": self.date,
            "duration": self.duration,
            "platform": self.platform,
            "executive_summary": self.executive_summary,
            "key_takeaways": self.key_takeaways,
            "action_items": [item.to_dict() for item in self.action_items],
            "transcript_snippets": [s.to_dict() for s in self.transcript_snippets],
            "topics": self.topics,
            "engagement_score": self.engagement_score
        }
