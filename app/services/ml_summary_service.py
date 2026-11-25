"""
ML Summary Service.
Provides lecture transcript processing and automated ML summarization mockups.
"""
from typing import Dict, Any, Optional
from datetime import datetime
from app.repositories.datastore import DataStore
from app.models.meeting_summary import MeetingSummary, ActionItem, TranscriptSnippet


class MLSummaryService:
    """
    Simulates speech-to-text NLP synthesis, sentiment analytics, and key takeaway extraction.
    """
    def __init__(self, datastore: DataStore = None):
        self._datastore = datastore or DataStore()

    def get_summary(self) -> Dict[str, Any]:
        summary = self._datastore.get_meeting_summary()
        if not summary:
            return {"error": "No meeting summary available."}
        return summary.to_dict()

    def generate_custom_summary(self, topic: str, duration: str = "45m") -> Dict[str, Any]:
        """
        Dynamically simulates processing a new recorded video session using an LLM pipeline.
        """
        topic_clean = topic.strip() if topic else "Object-Oriented Design Principles"
        new_summary = MeetingSummary(
            lecture_id=f"lec-{datetime.now().strftime('%M%S')}",
            title=f"Special Session: Deep Dive into {topic_clean}",
            course_code="CS302 - Advanced OOP",
            date=datetime.now().strftime("%Y-%m-%d %H:%M"),
            duration=duration,
            platform="Zoom AI Companion & Meet Cloud Transcription",
            executive_summary=(
                f"In this high-impact session on '{topic_clean}', the class evaluated fundamental "
                f"architectural trade-offs, code smells, and design pattern selection. Real-world case studies "
                f"demonstrated how to transform coupled legacy code into modular, easily testable components."
            ),
            key_takeaways=[
                f"Core tenets of {topic_clean} were analyzed against real-world production incidents.",
                "Favor composition over inheritance to retain runtime flexibility.",
                "Interface contracts must remain minimal and focused to prevent breaking client assumptions.",
                "Automated tests verify that architectural constraints are not violated across iterations."
            ],
            action_items=[
                ActionItem(f"Complete hands-on exercise on {topic_clean}", "All Students", "In 3 Days", "pending"),
                ActionItem("Review professor's refactored sample repository", "All Students", "This Weekend", "pending"),
                ActionItem("Publish synthesis notes to student Slack / Teams", "Teaching Assistant", "Tomorrow 10:00", "completed")
            ],
            transcript_snippets=[
                TranscriptSnippet("00:03:15", "Dr. Avi Ben-David", f"Today we focus specifically on {topic_clean} and its impact on maintainability.", highlight=True),
                TranscriptSnippet("00:15:22", "ליאל אבידור", "Can we apply this pattern in both statically and dynamically typed languages?", highlight=False),
                TranscriptSnippet("00:15:40", "Dr. Avi Ben-David", "Yes! The behavioral contract remains identical regardless of compile-time typing.", highlight=True),
                TranscriptSnippet("00:32:05", "נועם יעקב אוחיון", "How does this affect unit test isolation with mock objects?", highlight=False),
                TranscriptSnippet("00:32:30", "Dr. Avi Ben-David", "It makes isolation straightforward because dependencies can be mocked via simple stubs.", highlight=True)
            ],
            topics=[topic_clean, "Loose Coupling", "Design Patterns", "Clean Code", "OOP Architecture"],
            engagement_score=94.2
        )
        self._datastore._meeting_summary = new_summary
        return new_summary.to_dict()
