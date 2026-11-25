"""
Class Video Upload & AI Summarization Domain Model.
Encapsulates video lecture recordings, multi-modal LLM synthesis,
timeline chapters, and timestamped transcript extracts.
"""
from typing import List, Dict, Any, Optional
from datetime import datetime
import uuid
from app.models.meeting_summary import ActionItem, TranscriptSnippet


class VideoChapter:
    """Represents an indexed chapter segment detected in the lecture video."""
    def __init__(self, timestamp: str, title: str, description: str):
        self.timestamp = timestamp
        self.title = title
        self.description = description

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "title": self.title,
            "description": self.description
        }


class VideoLecture:
    """
    Domain entity representing an instructor-uploaded class video recording
    and its automated multi-modal LLM synthesis.
    """
    def __init__(
        self,
        video_id: str,
        title: str,
        filename: str,
        filesize_mb: float,
        duration: str,
        upload_time: str,
        executive_summary: str,
        chapters: List[VideoChapter],
        key_takeaways: List[str],
        action_items: List[ActionItem],
        transcript_snippets: List[TranscriptSnippet],
        topics: List[str],
        ai_model: str = "Whisper ASR + Gemini 1.5 Video LLM",
        engagement_score: Optional[float] = 93.5,
        status: str = "completed",
        simulated: bool = True
    ):
        self.video_id = video_id
        self.title = title
        self.filename = filename
        self.filesize_mb = filesize_mb
        self.duration = duration
        self.upload_time = upload_time
        self.executive_summary = executive_summary
        self.chapters = chapters
        self.key_takeaways = key_takeaways
        self.action_items = action_items
        self.transcript_snippets = transcript_snippets
        self.topics = topics
        self.ai_model = ai_model
        self.engagement_score = engagement_score
        self.status = status            # "processing" | "completed" | "failed"
        self.simulated = simulated      # True = demo content, NOT produced by a model
        self.stage = ""                 # human-readable progress while processing
        self.error: Optional[str] = None
        self.gemini_file_uri: Optional[str] = None   # kept for real Q&A (Gemini keeps files ~48 h)
        self.mime_type = "video/mp4"
        self.summary_language = "auto"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "video_id": self.video_id,
            "title": self.title,
            "filename": self.filename,
            "filesize_mb": self.filesize_mb,
            "duration": self.duration,
            "upload_time": self.upload_time,
            "executive_summary": self.executive_summary,
            "chapters": [c.to_dict() for c in self.chapters],
            "key_takeaways": self.key_takeaways,
            "action_items": [a.to_dict() for a in self.action_items],
            "transcript_snippets": [s.to_dict() for s in self.transcript_snippets],
            "topics": self.topics,
            "ai_model": self.ai_model,
            "engagement_score": self.engagement_score,
            "status": self.status,
            "simulated": self.simulated,
            "stage": self.stage,
            "error": self.error,
            "qa_available": bool(self.gemini_file_uri),
        }
