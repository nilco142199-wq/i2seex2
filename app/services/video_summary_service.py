"""
Video Upload & AI Summarization Service.
Coordinates video lecture ingestion, Whisper ASR speech-to-text transcription,
multi-modal LLM chapter indexing, and automated lecture synthesis.
"""
from typing import Dict, Any, List, Optional
from datetime import datetime
import os
import random
import threading
import uuid

from app.models.video_summary import VideoLecture, VideoChapter
from app.models.meeting_summary import ActionItem, TranscriptSnippet
from app.services.gemini_client import GeminiClient, GeminiError


class VideoSummaryService:
    """
    Manages video recordings, multi-modal LLM processing pipelines,
    and chapter-indexed lecture summaries.
    """
    def __init__(self, gemini: Optional[GeminiClient] = None):
        self._videos: Dict[str, VideoLecture] = {}
        self._gemini = gemini or GeminiClient()
        self._lock = threading.Lock()
        self._seed_default_videos()

    # ------------------------------------------------------------------ real LLM pipeline
    def llm_status(self) -> Dict[str, Any]:
        """Shown in the UI so it is always clear whether summaries come from a real model."""
        return {
            "enabled": self._gemini.enabled,
            "provider": "Google Gemini" if self._gemini.enabled else None,
            "models": self._gemini.models,
            "hint": None if self._gemini.enabled else
                    "Set GEMINI_API_KEY before starting the server to summarise real recordings with Gemini.",
        }

    def start_video_job(self, file_path: str, filename: str, filesize_mb: float, title: str = "",
                        topic: str = "", language: str = "auto", mime_type: str = "video/mp4") -> Dict[str, Any]:
        """
        Registers the uploaded recording and processes it in a background thread:
        upload to Gemini → wait until processed → summarise. The browser polls /api/video/detail.
        Without an API key the recording is NOT analysed and a clearly-labelled demo summary is returned.
        """
        if not self._gemini.enabled:
            try:
                os.remove(file_path)
            except OSError:
                pass
            video = self.process_uploaded_video(filename, filesize_mb, title, topic)
            return video

        video_id = f"vid-{uuid.uuid4().hex[:6]}"
        clean_title = (title or os.path.splitext(filename)[0].replace("_", " ")).strip()
        lecture = VideoLecture(
            video_id=video_id, title=clean_title or "Class recording", filename=filename,
            filesize_mb=round(float(filesize_mb), 1), duration="—", upload_time="Just now",
            executive_summary="", chapters=[], key_takeaways=[], action_items=[], transcript_snippets=[],
            topics=[], ai_model="Google Gemini", engagement_score=None, status="processing", simulated=False,
        )
        lecture.stage = "Uploading the recording to Gemini…"
        lecture.mime_type = mime_type or "video/mp4"
        lecture.summary_language = language
        with self._lock:
            self._videos[video_id] = lecture
        threading.Thread(target=self._run_job, args=(lecture, file_path, title, topic, language), daemon=True).start()
        return lecture.to_dict()

    def _run_job(self, lecture: VideoLecture, file_path: str, title: str, topic: str, language: str) -> None:
        try:
            info = self._gemini.upload_file(file_path, lecture.mime_type, lecture.filename)
            lecture.stage = "Gemini is processing the video (picture + sound)…"
            info = self._gemini.wait_until_active(
                info, on_poll=lambda state: setattr(lecture, "stage", f"Gemini is processing the video… ({state.lower()})"))
            lecture.gemini_file_uri = info["uri"]
            lecture.mime_type = info.get("mimeType", lecture.mime_type)
            lecture.stage = "Gemini is watching the lecture and writing the summary…"
            result = self._gemini.summarize_lecture(info, title, topic, language)
            self._apply_summary(lecture, result, title)
            lecture.ai_model = f"Google Gemini ({self._gemini.last_model_used})"
            lecture.status, lecture.stage = "completed", ""
        except GeminiError as e:
            lecture.status, lecture.error, lecture.stage = "failed", str(e), ""
        except Exception as e:  # never leave a job stuck in "processing"
            lecture.status, lecture.error, lecture.stage = "failed", f"Unexpected error: {e}", ""
        finally:
            try:
                os.remove(file_path)
            except OSError:
                pass

    @staticmethod
    def _apply_summary(lecture: VideoLecture, r: Dict[str, Any], title_hint: str) -> None:
        lecture.title = (title_hint or r.get("title") or lecture.title).strip()
        lecture.duration = r.get("duration") or lecture.duration
        lecture.executive_summary = r.get("executive_summary", "").strip()
        lecture.chapters = [VideoChapter(c.get("timestamp", ""), c.get("title", ""), c.get("description", ""))
                            for c in r.get("chapters", []) if c.get("title")]
        lecture.key_takeaways = [t for t in r.get("key_takeaways", []) if t]
        lecture.action_items = [ActionItem(a.get("task", ""), a.get("assignee") or "All students",
                                           a.get("due_date") or "—", "pending")
                                for a in r.get("action_items", []) if a.get("task")]
        lecture.transcript_snippets = [
            TranscriptSnippet(h.get("timestamp", ""), h.get("speaker") or "Lecturer", h.get("text", ""), i == 0)
            for i, h in enumerate(r.get("transcript_highlights", [])) if h.get("text")]
        lecture.topics = [t.lstrip("#") for t in r.get("topics", []) if t]

    def _seed_default_videos(self):
        # Seed Lecture 1
        vid1 = VideoLecture(
            video_id="vid-101",
            title="Lecture 08: Behavioral Design Patterns & Observer Refactoring",
            filename="CS302_Lecture_08_Behavioral_Patterns.mp4",
            filesize_mb=1150.4,
            duration="1h 32m",
            upload_time="Today, 10:45 AM",
            executive_summary=(
                "Comprehensive recording of Lecture 08 analyzing the Observer and Strategy patterns. "
                "The instructor demonstrates live refactoring of a monolithic procedural event dispatcher "
                "into decoupled observers honoring the Open/Closed Principle. Student questions focused on "
                "preventing memory leaks in long-running listener subscriptions."
            ),
            chapters=[
                VideoChapter("00:00", "Recap & Assignment 2 Scope", "Overview of clean architecture requirements and KISS methodology."),
                VideoChapter("14:20", "Observer Pattern UML & Contracts", "Deconstructing Subject and Observer interfaces, push vs pull notifications."),
                VideoChapter("31:45", "Live Refactoring Code Walkthrough", "Transforming tightly coupled switch statements into polymorphic listeners."),
                VideoChapter("52:10", "Thread Safety & Memory Leaks", "Weak references and unsubscribing listeners to prevent zombie objects."),
                VideoChapter("1:18:00", "Q&A & Assignment 2 Rubric", "Clarifications on SOLID compliance checklist and submission deadline.")
            ],
            key_takeaways=[
                "The Observer pattern provides clean 1-to-many publish-subscribe loose coupling.",
                "Always implement an explicit unsubscribe/detach mechanism to avoid memory retention.",
                "Favor composition over inheritance to allow dynamic swapping of algorithm strategies.",
                "Unit tests should mock observers to isolate domain state transitions."
            ],
            action_items=[
                ActionItem("Submit Assignment 2 with modular SOLID design", "All Students", "Friday 23:59", "pending"),
                ActionItem("Review Chapter 6 on Behavioral GoF Patterns", "All Students", "Next Monday", "pending"),
                ActionItem("Publish annotated refactoring branch to GitHub", "Dr. Avi Ben-David", "Today 16:00", "completed")
            ],
            transcript_snippets=[
                TranscriptSnippet("14:25", "Dr. Avi Ben-David", "Notice how the Subject never depends on concrete observer implementations.", highlight=True),
                TranscriptSnippet("32:10", "גיא אביב", "Does the push model pass the whole payload or just the event ID?", highlight=False),
                TranscriptSnippet("32:30", "Dr. Avi Ben-David", "Passing a granular event object gives the observer flexibility without tight coupling.", highlight=True),
                TranscriptSnippet("54:15", "דניאל שלמה אהרן", "How do we prevent memory leaks if an observer isn't unregistered?", highlight=False),
                TranscriptSnippet("54:40", "Dr. Avi Ben-David", "By utilizing weak references or an explicit disposable lifecycle pattern.", highlight=True)
            ],
            topics=["Observer Pattern", "Strategy Pattern", "SOLID Principles", "Refactoring", "Loose Coupling"],
            ai_model="Demo example (simulated – no model)",
            engagement_score=94.5,
            status="completed"
        )

        # Seed Lecture 2
        vid2 = VideoLecture(
            video_id="vid-102",
            title="Workshop: Clean Architecture & SOLID Code Auditing",
            filename="CS302_Workshop_Clean_Architecture.mp4",
            filesize_mb=720.8,
            duration="54m 10s",
            upload_time="Yesterday, 14:30 PM",
            executive_summary=(
                "Hands-on workshop demonstrating automated LLM code review pipelines. "
                "Students reviewed common anti-patterns including God Classes, Feature Envy, "
                "and violations of the Single Responsibility Principle. Live benchmarks showed "
                "how clean modularity accelerates unit testing."
            ),
            chapters=[
                VideoChapter("00:00", "Code Smell Taxonomy", "Identifying Bloaters, Object-Orientation Abusers, and Couplers."),
                VideoChapter("18:30", "Single Responsibility Principle (SRP)", "Refactoring multi-purpose classes into distinct domain models and services."),
                VideoChapter("36:10", "Dependency Inversion with Interfaces", "Decoupling high-level business rules from low-level database details.")
            ],
            key_takeaways=[
                "High cohesion and low coupling are the fundamental goals of object-oriented design.",
                "A class should have one, and only one, reason to change.",
                "Program to an interface, not an implementation."
            ],
            action_items=[
                ActionItem("Run linter and SOLID rubric check on project repos", "All Students", "Thursday", "pending")
            ],
            transcript_snippets=[
                TranscriptSnippet("19:05", "Dr. Avi Ben-David", "If a class handles both persistence and HTTP formatting, it violates SRP.", highlight=True)
            ],
            topics=["Clean Architecture", "SOLID Rubric", "Refactoring", "Code Smells"],
            ai_model="Demo example (simulated – no model)",
            engagement_score=91.0,
            status="completed"
        )

        self._videos[vid1.video_id] = vid1
        self._videos[vid2.video_id] = vid2

    def get_all_videos(self) -> List[Dict[str, Any]]:
        return [v.to_dict() for v in self._videos.values()]

    def get_video_by_id(self, video_id: str) -> Optional[Dict[str, Any]]:
        video = self._videos.get(video_id)
        return video.to_dict() if video else None

    def process_uploaded_video(
        self,
        filename: str,
        filesize_mb: float = 450.0,
        custom_title: Optional[str] = None,
        topic: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        DEMO MODE ONLY (no GEMINI_API_KEY): returns a template summary – the recording is NOT analysed.
        The result is flagged simulated=True and labelled in the UI.
        Originally simulated end-to-end multi-modal LLM ingestion:
        1. Audio extraction & Whisper speech-to-text transcript generation.
        2. Visual keyframe & slide OCR analysis.
        3. Gemini LLM chapter indexing, executive summary, and action item extraction.
        """
        clean_name = filename.strip() if filename else "Uploaded_Class_Lecture.mp4"
        clean_title = custom_title.strip() if custom_title else clean_name.replace(".mp4", "").replace("_", " ")
        topic_clean = topic.strip() if topic else "Object-Oriented Design & System Architecture"
        video_id = f"vid-{uuid.uuid4().hex[:6]}"

        new_lecture = VideoLecture(
            video_id=video_id,
            title=f"Class Recording: {clean_title}",
            filename=clean_name,
            filesize_mb=float(filesize_mb),
            duration=f"{random.randint(45, 95)}m {random.randint(10, 59)}s",
            upload_time="Just now",
            executive_summary=(
                f"⚠️ DEMO MODE – this recording was NOT analysed (no GEMINI_API_KEY configured). "
                f"Template text for '{clean_name}'. "
                f"The lecture delivered a deep exploration of '{topic_clean}', examining design trade-offs, "
                f"architectural constraints, and SOLID principles. Multi-modal frame analysis identified "
                f"several UML diagram slides and live terminal refactoring demonstrations."
            ),
            chapters=[
                VideoChapter("00:00", f"Introduction to {topic_clean}", "Lecture objectives, homework announcements, and context setting."),
                VideoChapter("12:45", "Architectural Foundations & Theory", "Examining class diagrams, coupling metrics, and contracts."),
                VideoChapter("29:30", "Live Implementation & Case Studies", "Interactive code demo demonstrating pattern application."),
                VideoChapter("48:15", "Student Discussions & Best Practices", "Answering student inquiries on testing, decoupling, and edge cases.")
            ],
            key_takeaways=[
                f"Key concepts of {topic_clean} were analyzed with production-grade architectural patterns.",
                "Favor composition over inheritance to maintain maintainability.",
                "Automated unit testing verifies that domain invariants remain intact.",
                "Refactor code smells early before technical debt compounds."
            ],
            action_items=[
                ActionItem(f"Complete homework assignment on {topic_clean}", "All Students", "In 4 Days", "pending"),
                ActionItem("Review uploaded slides and lecture summary notes", "All Students", "This Weekend", "pending")
            ],
            transcript_snippets=[
                TranscriptSnippet("00:02:10", "Dr. Avi Ben-David", f"Welcome everyone. Today's recorded session investigates {topic_clean}.", highlight=True),
                TranscriptSnippet("13:15", "Student", "How does this compare to procedural alternatives?", highlight=False),
                TranscriptSnippet("13:40", "Dr. Avi Ben-David", "It encapsulates behavior so changes are localized without ripple effects.", highlight=True),
                TranscriptSnippet("30:10", "Dr. Avi Ben-David", "Notice on this slide how the abstraction insulates the client code.", highlight=True)
            ],
            topics=[topic_clean, "Design Patterns", "Clean Architecture", "OOP Principles"],
            ai_model="Demo example (simulated – no model)",
            engagement_score=round(random.uniform(90.0, 97.5), 1),
            status="completed"
        )

        # Store in repository
        self._videos[video_id] = new_lecture
        return new_lecture.to_dict()

    def ask_video_qa(self, video_id: str, question: str) -> Dict[str, Any]:
        """
        Interactive LLM Q&A tool allowing students/instructors to query the video content.
        """
        video = self._videos.get(video_id)
        if not video:
            return {"error": "Video not found."}

        if video.gemini_file_uri and self._gemini.enabled and question.strip():
            try:
                res = self._gemini.ask_about_lecture(video.gemini_file_uri, video.mime_type, question.strip())
                return {"success": True, "video_id": video_id, "question": question,
                        "answer": res.get("answer", ""), "timestamp": res.get("timestamp", ""),
                        "ai_model": f"Google Gemini ({self._gemini.last_model_used})", "simulated": False}
            except GeminiError as e:
                return {"success": False, "video_id": video_id, "question": question,
                        "answer": f"Gemini could not answer: {e}", "timestamp": "", "ai_model": video.ai_model,
                        "simulated": False}

        q = question.lower()
        if "deadline" in q or "due" in q or "homework" in q:
            answer = "The homework submission deadline mentioned in the video is Friday at 23:59. Check Chapter 5 at 1:18:00 for the full rubric explanation."
            timestamp = "1:18:00"
        elif "observer" in q or "pattern" in q:
            answer = "The Observer pattern is analyzed in detail starting at timestamp 14:20. The professor notes that the Subject should maintain loose coupling with zero direct knowledge of concrete listeners."
            timestamp = "14:20"
        elif "memory" in q or "leak" in q:
            answer = "Memory leaks from un-detached listeners are addressed at 52:10. The recommended solution is to implement an explicit unsubscribe or weak reference pattern."
            timestamp = "52:10"
        else:
            answer = f"Based on the multi-modal video transcript for '{video.title}', the professor discussed this concept during Chapter 2 and 3, emphasizing modularity, test isolation, and adherence to SOLID design."
            timestamp = "29:30"

        return {
            "success": True,
            "video_id": video_id,
            "question": question,
            "answer": answer,
            "timestamp": timestamp,
            "ai_model": video.ai_model,
            "simulated": True
        }
