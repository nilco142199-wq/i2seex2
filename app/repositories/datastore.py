"""
In-Memory Repository and Seed Data Store.
Provides thread-safe access to application entities following the Repository Pattern.
"""
import threading
from typing import List, Optional, Dict
from app.models.student import Student
from app.repositories.seed_students import generate_roster, DEFAULT_CLASS_SIZE
from app.models.feedback import Comment
from app.models.poll import Poll
from app.models.meeting_summary import MeetingSummary, ActionItem, TranscriptSnippet
from app.models.homework_review import SubmissionReview, SolidCompliance
from app.models.session import (
    ClassSession, CheckInAttempt,
    ARIEL_UNIVERSITY_NAME, ARIEL_UNIVERSITY_LAT, ARIEL_UNIVERSITY_LNG, DEFAULT_RADIUS_METERS
)


class DataStore:
    """
    Singleton / Central Repository managing data access and in-memory persistence.
    """
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(DataStore, cls).__new__(cls)
                cls._instance._initialize()
            return cls._instance

    def _initialize(self):
        self._students: Dict[str, Student] = {}
        self._comments: List[Comment] = []
        self._polls: Dict[str, Poll] = {}
        self._active_poll_id: Optional[str] = None
        self._meeting_summary: Optional[MeetingSummary] = None
        self._submissions: Dict[str, SubmissionReview] = {}
        self._session: Optional[ClassSession] = None
        # Concurrency: one re-entrant lock serialises every attendance write, so 100+ students
        # checking in at the same second can never corrupt the roster.
        self.lock = threading.RLock()
        # Increases on every roster change; lets the instructor's poll skip unchanged data.
        self.roster_version = 0
        self._seed_data()

    def bump_version(self) -> int:
        self.roster_version += 1
        return self.roster_version

    def _seed_data(self):
        # 0. Seed Active Class Session with GPS coordinates and Dynamic QR
        self._session = ClassSession(
            session_id="cs302_lec08",
            course_name="CS302 - Advanced OOP",
            instructor_name="Dr. Avi Ben-David",
            classroom_name=ARIEL_UNIVERSITY_NAME,
            classroom_lat=ARIEL_UNIVERSITY_LAT,
            classroom_lng=ARIEL_UNIVERSITY_LNG,
            allowed_radius_meters=DEFAULT_RADIUS_METERS,
            qr_mode="dynamic",
            qr_rotation_interval_seconds=20
        )

        # No pre-seeded check-in attempts: the audit log only shows real attempts.

        # 1. Seed Students (the real class list – see seed_students.py)
        for record in generate_roster(DEFAULT_CLASS_SIZE):
            self._students[record["student_id"]] = Student(
                avatar=f"https://api.dicebear.com/7.x/notionists/svg?seed={record['student_id']}",
                **record
            )

        # 2. Seed Feedback Comments
        seed_comments = [
            Comment(
                comment_id="c1",
                content="Could you explain the difference between Strategy and State pattern with a quick code snippet?",
                author_name="דניאל שלמה אהרן",
                is_anonymous=False,
                category="question",
                timestamp="09:15:20",
                upvotes=7,
                is_resolved=False
            ),
            Comment(
                comment_id="c2",
                content="The sound on the live mic had an echo for 2 minutes, but it's clear now!",
                author_name="Anonymous Student",
                is_anonymous=True,
                category="feedback",
                timestamp="09:18:44",
                upvotes=2,
                is_resolved=True
            ),
            Comment(
                comment_id="c3",
                content="For Exercise 2, can we use Python dataclasses or should we strictly write explicit getters and setters?",
                author_name="גיא אביב",
                is_anonymous=False,
                category="question",
                timestamp="09:24:11",
                upvotes=5,
                is_resolved=False
            ),
            Comment(
                comment_id="c4",
                content="Offline suggestion: Please upload the UML diagram template for the midterm project.",
                author_name="דולב אהרון",
                is_anonymous=False,
                category="offline",
                timestamp="09:30:05",
                upvotes=3,
                is_resolved=False
            )
        ]
        self._comments.extend(seed_comments)

        # 3. Seed Poll
        default_poll = Poll(
            poll_id="poll_01",
            question="Which GoF pattern best decouples an event broadcaster from dynamic event consumers?",
            options=[
                "Observer Pattern",
                "Factory Method Pattern",
                "Singleton Pattern",
                "Adapter Pattern"
            ],
            is_active=True,
            created_at="09:20:00"
        )
        # Pre-seed some votes
        default_poll.record_vote("1", "voter_1")
        default_poll.record_vote("1", "voter_2")
        default_poll.record_vote("1", "voter_3")
        default_poll.record_vote("1", "voter_4")
        default_poll.record_vote("2", "voter_5")
        default_poll.record_vote("4", "voter_6")
        self._polls[default_poll.id] = default_poll
        self._active_poll_id = default_poll.id

        # 4. Seed Meeting ML Summary
        self._meeting_summary = MeetingSummary(
            lecture_id="lec-08",
            title="Lecture 08: Behavioral Patterns, SOLID Refactoring & Loose Coupling",
            course_code="CS302 - Advanced OOP",
            date="Today, 09:00 AM - 10:30 AM",
            duration="1h 32m",
            platform="Zoom AI Companion & Meet Transcriber",
            executive_summary=(
                "Today's lecture analyzed behavioural design patterns with an emphasis on the Observer "
                "and Strategy patterns. We explored real-world refactoring from monolithic procedural code "
                "to clean OOP architecture adhering to the Open/Closed and Dependency Inversion principles. "
                "Student participation in the live poll reflected strong comprehension of decoupling mechanisms."
            ),
            key_takeaways=[
                "Observer pattern provides publish-subscribe decoupling with 1-to-many relationship.",
                "Strategy pattern encapsulates interchangeable algorithms behind a common interface.",
                "Dependency Inversion: High-level modules should depend on abstractions, not concretions.",
                "Refactoring tip: Replace complex conditional switch statements with polymorphic dispatch.",
                "Upcoming Ex2 submission requires clean modularity and zero external dependencies."
            ],
            action_items=[
                ActionItem("Submit Assignment 2 (Classroom Dashboard prototype)", "All Students", "Friday 23:59", "pending"),
                ActionItem("Review Chapter 6 on Behavioral Design Patterns", "All Students", "Next Monday", "pending"),
                ActionItem("Upload recorded lecture & annotated slides to portal", "Dr. Avi Ben-David", "Today 16:00", "completed"),
                ActionItem("Host QA Office Hours on Discord / Zoom", "Teaching Assistant", "Wednesday 14:00", "pending")
            ],
            transcript_snippets=[
                TranscriptSnippet("09:12:40", "Dr. Avi Ben-David", "Notice how when the Subject updates its state, it notifies observers via a defined interface.", highlight=True),
                TranscriptSnippet("09:14:15", "דניאל שלמה אהרן", "Does that mean the Subject has zero knowledge of the concrete observer implementation?", highlight=False),
                TranscriptSnippet("09:14:28", "Dr. Avi Ben-David", "Precisely! That's the core essence of loose coupling in Object-Oriented Design.", highlight=True),
                TranscriptSnippet("09:28:10", "גיא אביב", "How does this prevent violation of the Open/Closed Principle?", highlight=False),
                TranscriptSnippet("09:28:35", "Dr. Avi Ben-David", "Because you can add new observer classes without altering a single line of the subject.", highlight=True)
            ],
            topics=["Observer Pattern", "Strategy Pattern", "SOLID Principles", "Loose Coupling", "Refactoring", "Clean Architecture"],
            engagement_score=92.4
        )

        # 5. Seed Homework Deep Reviews
        rev_alex = SubmissionReview(
            submission_id="sub-101",
            student_id="s101",
            student_name="גיא אביב",
            repo_name="alex-rivera/oop-classroom-tool",
            branch="main",
            commit_hash="7f3c91a",
            overall_score=94,
            scores={
                "architecture": 96,
                "solid_compliance": 92,
                "clean_code": 95,
                "testability": 90
            },
            solid_compliance=[
                SolidCompliance("Single Responsibility (SRP)", "pass", "Models and Services are cleanly decoupled into dedicated modules."),
                SolidCompliance("Open/Closed Principle (OCP)", "pass", "New report generators can be added via polymorphic base classes."),
                SolidCompliance("Liskov Substitution (LSP)", "pass", "Derived entities honor the contracts of their base types without side effects."),
                SolidCompliance("Interface Segregation (ISP)", "pass", "Narrow role-based protocols prevent unnecessary method implementation."),
                SolidCompliance("Dependency Inversion (DIP)", "warning", "Direct instantiation of DataStore in some service methods; consider dependency injection.")
            ],
            design_patterns=["Repository Pattern", "Singleton", "Facade (ApiClient)", "Observer Pattern"],
            code_smells=["Minor duplicate validation logic in student name format"],
            ai_summary=(
                "Outstanding submission! Highly cohesive structure with crystal clear OOP boundaries. "
                "Data structures are properly encapsulated with properties, and the in-memory repository "
                "provides an elegant abstraction. Code is readable, well-commented, and ready for production."
            ),
            refactoring_suggestions=[
                "Inject the repository into services rather than calling DataStore() directly for enhanced unit testing.",
                "Extract validation logic into a shared Validator helper class."
            ]
        )

        rev_elena = SubmissionReview(
            submission_id="sub-102",
            student_id="s102",
            student_name="ליאל אבידור",
            repo_name="elena-r/interactive-teaching-platform",
            branch="feature/vibe-prototype",
            commit_hash="4a8d11c",
            overall_score=86,
            scores={
                "architecture": 84,
                "solid_compliance": 85,
                "clean_code": 88,
                "testability": 82
            },
            solid_compliance=[
                SolidCompliance("Single Responsibility (SRP)", "pass", "Presentation and business logic are distinct."),
                SolidCompliance("Open/Closed Principle (OCP)", "warning", "Adding a new feedback category requires modifying the enum in two places."),
                SolidCompliance("Liskov Substitution (LSP)", "pass", "Substitutability preserved across polymorphic models."),
                SolidCompliance("Interface Segregation (ISP)", "pass", "Clean separation of responsibilities."),
                SolidCompliance("Dependency Inversion (DIP)", "pass", "High-level controllers rely on abstract service handlers.")
            ],
            design_patterns=["Strategy Pattern", "Data Mapper", "Observer"],
            code_smells=["Slightly long handler method in HTTP request router (~65 lines)"],
            ai_summary=(
                "Strong work with great intuitive UI and solid domain separation. "
                "The routing layer could benefit from being broken down into discrete sub-routers, "
                "but the object-oriented abstractions in the domain layer are exemplary."
            ),
            refactoring_suggestions=[
                "Break down the monolithic HTTP dispatch method into modular sub-command handlers.",
                "Convert feedback category string matching into a polymorphic Category Strategy."
            ]
        )

        rev_david = SubmissionReview(
            submission_id="sub-103",
            student_id="s103",
            student_name="דולב אהרון",
            repo_name="david-kim/cs-teach-dashboard",
            branch="master",
            commit_hash="2b9e602",
            overall_score=72,
            scores={
                "architecture": 70,
                "solid_compliance": 68,
                "clean_code": 75,
                "testability": 74
            },
            solid_compliance=[
                SolidCompliance("Single Responsibility (SRP)", "warning", "Datastore model handles both persistence and HTTP formatting."),
                SolidCompliance("Open/Closed Principle (OCP)", "warning", "Poll evaluation uses chained if-elif branches instead of polymorphism."),
                SolidCompliance("Liskov Substitution (LSP)", "pass", "No contract violations detected."),
                SolidCompliance("Interface Segregation (ISP)", "warning", "Fat interface includes unused serialisation hooks."),
                SolidCompliance("Dependency Inversion (DIP)", "warning", "Tight coupling between HTTP handler and raw dictionary state.")
            ],
            design_patterns=["Singleton (Basic)"],
            code_smells=["God Class candidate in server routing", "Primitive Obsession with raw dicts", "Magic Strings"],
            ai_summary=(
                "Functional prototype, but architecture exhibits high coupling. Domain logic is mixed "
                "directly into HTTP responses without dedicated service intermediaries. Refactoring to "
                "distinct Model-Service-Handler layers will elevate this to an A-grade standard."
            ),
            refactoring_suggestions=[
                "Separate domain entities into explicit classes with private attributes and properties.",
                "Implement a Service layer to encapsulate business rules away from the HTTP transport layer.",
                "Replace raw string keys with strongly-typed properties or data transfer objects."
            ]
        )

        self._submissions[rev_alex.submission_id] = rev_alex
        self._submissions[rev_elena.submission_id] = rev_elena
        self._submissions[rev_david.submission_id] = rev_david

    # Data Access Methods
    def get_all_students(self) -> List[Student]:
        return list(self._students.values())

    def add_student(self, student: Student) -> Student:
        self._students[student.student_id] = student
        return student

    def get_student(self, student_id: str) -> Optional[Student]:
        return self._students.get(student_id)

    def get_all_comments(self) -> List[Comment]:
        # Return sorted by upvotes descending, then timestamp descending
        return sorted(self._comments, key=lambda c: (c.upvotes, c.timestamp), reverse=True)

    def add_comment(self, comment: Comment) -> Comment:
        self._comments.insert(0, comment)
        return comment

    def get_comment(self, comment_id: str) -> Optional[Comment]:
        for c in self._comments:
            if c.id == comment_id:
                return c
        return None

    def get_active_poll(self) -> Optional[Poll]:
        if self._active_poll_id and self._active_poll_id in self._polls:
            return self._polls[self._active_poll_id]
        return None

    def get_all_polls(self) -> List[Poll]:
        return list(self._polls.values())

    def save_poll(self, poll: Poll) -> Poll:
        self._polls[poll.id] = poll
        self._active_poll_id = poll.id
        return poll

    def get_meeting_summary(self) -> Optional[MeetingSummary]:
        return self._meeting_summary

    def get_all_reviews(self) -> List[SubmissionReview]:
        return list(self._submissions.values())

    def get_review(self, submission_id: str) -> Optional[SubmissionReview]:
        return self._submissions.get(submission_id)

    def get_active_session(self) -> Optional[ClassSession]:
        return self._session

    def set_session(self, session: ClassSession) -> ClassSession:
        self._session = session
        return session
