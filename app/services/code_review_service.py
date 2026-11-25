"""
Homework Deep Review Service – real reviews of real submissions.

Flow:  student uploads a .zip (or a public GitHub link)
       → CodeBundle reads the files safely and counts real metrics
       → background job sends the code + the assignment requirements to Google Gemini
       → the answer is VALIDATED: findings that cite files which are not in the submission are removed
       → comparison between students: measured code similarity + side-by-side scores (+ AI paragraph)

Without GEMINI_API_KEY nothing is invented: the submission shows its real metrics and similarity only.
"""
import threading
import uuid
from typing import Any, Dict, List, Optional

from app.repositories.datastore import DataStore
from app.models.homework_review import HomeworkSubmission
from app.services.gemini_client import GeminiClient, GeminiError, _SSL
from app.services.code_analysis import (CodeBundle, SubmissionError, fetch_github_zip, similarity,
                                        matching_files, parse_github_url)

DEFAULT_REQUIREMENTS = """Ex2 – Vibe Coding & Deep Designing: Web-based Teaching Tool (Intro to Software Engineering, OOP/OOD)
1. README: the problem, the goal and the scope, and how to install and run the project.
2. A working web application (KISS, usable from a smartphone) for teaching in class: attendance, comments, polls, lecture video summary, homework review.
3. Object-oriented design: classes with clear responsibilities, encapsulation, separation into layers (models / services / handlers).
4. SOLID principles and at least one design pattern that is really used in the code.
5. Technical tools report (which tools were tried and why).
6. Statement of Work (SoW) and Software Requirements Specification (SRS).
7. Use cases / client stories.
8. Main software components, class diagrams and sequence diagrams.
9. Testing strategy and automated tests that run.
10. Results and conclusion (what works, limitations, future work)."""


class CodeReviewService:
    MAX_SIMILARITY_PAIRS = 20

    def __init__(self, datastore: DataStore = None, gemini: Optional[GeminiClient] = None):
        self._datastore = datastore or DataStore()
        self._gemini = gemini or GeminiClient()
        self._requirements = DEFAULT_REQUIREMENTS
        self._comparison_cache: Dict[str, str] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ settings
    def llm_status(self) -> Dict[str, Any]:
        return {"enabled": self._gemini.enabled, "provider": "Google Gemini" if self._gemini.enabled else None}

    def get_requirements(self) -> str:
        return self._requirements

    def set_requirements(self, text: str) -> Dict[str, Any]:
        text = (text or "").strip()
        if len(text) < 10:
            return {"success": False, "error": "Paste the assignment requirements (at least a sentence)."}
        if len(text) > 20000:
            return {"success": False, "error": "The requirements text is too long (max 20,000 characters)."}
        self._requirements = text
        return {"success": True, "requirements": text}

    # ------------------------------------------------------------------ submitting
    def submit_zip(self, data: bytes, filename: str, student_name: str, language: str = "en") -> Dict[str, Any]:
        name = self._clean_name(student_name)
        if not name:
            return {"success": False, "error": "Write the student's name."}
        try:
            bundle = CodeBundle.from_zip_bytes(data)
        except SubmissionError as e:
            return {"success": False, "error": str(e)}
        sub = self._register(bundle, name, "zip", (filename or "homework.zip")[:120])
        threading.Thread(target=self._run_review, args=(sub, bundle, language), daemon=True).start()
        return {"success": True, "submission": sub.to_summary()}

    def submit_github(self, url: str, student_name: str, language: str = "en") -> Dict[str, Any]:
        name = self._clean_name(student_name)
        if not name:
            return {"success": False, "error": "Write the student's name."}
        try:
            owner, repo = parse_github_url(url)
        except SubmissionError as e:
            return {"success": False, "error": str(e)}
        sub = HomeworkSubmission(self._new_id(), name, "github", f"github.com/{owner}/{repo}", [], {}, set(), {})
        sub.stage = "Downloading the repository from GitHub…"
        self._datastore.add_review(sub)

        def job():
            try:
                data, label = fetch_github_zip(url, ssl_context=_SSL)
                bundle = CodeBundle.from_zip_bytes(data)
            except SubmissionError as e:
                sub.status, sub.error, sub.stage = "failed", str(e), ""
                return
            self._fill(sub, bundle)
            self._run_review(sub, bundle, language)

        threading.Thread(target=job, daemon=True).start()
        return {"success": True, "submission": sub.to_summary()}

    # Kept for older clients: POST /api/review/analyze {repo_url, student_name}
    def analyze_repo(self, repo_url: str, student_name: str, language: str = "en") -> Dict[str, Any]:
        return self.submit_github(repo_url, student_name, language)

    @staticmethod
    def _clean_name(name: str) -> str:
        return " ".join((name or "").split())[:80]

    @staticmethod
    def _new_id() -> str:
        return "hw-" + uuid.uuid4().hex[:8]

    def _register(self, bundle: CodeBundle, name: str, source: str, label: str) -> HomeworkSubmission:
        sub = HomeworkSubmission(self._new_id(), name, source, label, [], {}, set(), {})
        self._fill(sub, bundle)
        self._datastore.add_review(sub)
        return sub

    @staticmethod
    def _fill(sub: HomeworkSubmission, bundle: CodeBundle) -> None:
        sub.files = list(bundle.files)
        sub.metrics = bundle.metrics()
        sub.fingerprint = bundle.fingerprint()
        sub.file_fingerprints = bundle.file_fingerprints()

    # ------------------------------------------------------------------ the review job
    def _run_review(self, sub: HomeworkSubmission, bundle: CodeBundle, language: str) -> None:
        if not self._gemini.enabled:
            sub.status, sub.stage = "completed", ""
            sub.error = None
            return
        try:
            sub.stage = "Gemini is reading the code…"
            text, omitted = bundle.prompt_text()
            sub.omitted_files = omitted
            review = self._gemini.review_homework(text, self._requirements, sub.student_name, language)
            sub.stage = "Checking the review against the files…"
            sub.review, sub.removed_claims = self.validate_review(review, sub.files)
            sub.ai_model = f"Google Gemini ({self._gemini.last_model_used})"
            sub.status, sub.stage = "completed", ""
        except GeminiError as e:
            sub.status, sub.error, sub.stage = "failed", str(e), ""
        except Exception as e:  # never leave a submission stuck on "processing"
            sub.status, sub.error, sub.stage = "failed", f"Unexpected error: {e}", ""

    @staticmethod
    def validate_review(review: Dict[str, Any], files: List[str]):
        """
        Anti-hallucination check. Every piece of evidence must name a file that is really in the submission
        (and a line inside that file). Patterns, issues and strengths with no valid evidence are removed;
        requirement / SOLID verdicts are kept but marked unverified. Returns (clean_review, removed_count).
        """
        known = {f.lower(): f for f in files}

        def resolve(path: Any) -> Optional[str]:
            if not isinstance(path, str) or not path.strip():
                return None
            p = path.strip().strip("`").lstrip("./").replace("\\", "/")
            if p.lower() in known:
                return known[p.lower()]
            ends = [f for low, f in known.items() if low.endswith("/" + p.lower())]  # "models/a.py" vs "app/models/a.py"
            return ends[0] if len(ends) == 1 else None

        def clean_evidence(items: Any) -> List[Dict[str, Any]]:
            out = []
            for ev in items or []:
                f = resolve((ev or {}).get("file"))
                if f:
                    item = {"file": f}
                    if isinstance(ev.get("line"), int) and ev["line"] > 0:
                        item["line"] = ev["line"]
                    out.append(item)
            return out

        removed = 0
        r = dict(review or {})
        r["overall_score"] = max(0, min(100, int(r.get("overall_score") or 0)))
        r["scores"] = {k: max(0, min(100, int(v or 0))) for k, v in (r.get("scores") or {}).items()}

        for key in ("requirements", "solid"):
            items = []
            for it in r.get(key) or []:
                it = dict(it)
                had = bool(it.get("evidence"))
                it["evidence"] = clean_evidence(it.get("evidence"))
                if had and not it["evidence"]:
                    removed += 1
                it["verified"] = bool(it["evidence"]) or it.get("status") in ("missing", "not_applicable")
                items.append(it)
            r[key] = items

        patterns = []
        for it in r.get("design_patterns") or []:
            ev = clean_evidence(it.get("evidence"))
            if ev:
                patterns.append({**it, "evidence": ev})
            else:
                removed += 1
        r["design_patterns"] = patterns

        issues = []
        for it in r.get("issues") or []:
            f = resolve(it.get("file"))
            if f:
                issues.append({**it, "file": f})
            else:
                removed += 1
        order = {"high": 0, "medium": 1, "low": 2}
        r["issues"] = sorted(issues, key=lambda i: order.get(i.get("severity"), 3))

        strengths = []
        for it in r.get("strengths") or []:
            ev = clean_evidence(it.get("evidence"))
            if ev or not it.get("evidence"):
                strengths.append({"text": it.get("text", ""), "evidence": ev})
            else:
                removed += 1
        r["strengths"] = strengths
        return r, removed

    # ------------------------------------------------------------------ reading
    def get_all_reviews(self) -> List[Dict[str, Any]]:
        subs = self._datastore.get_all_reviews()
        subs.sort(key=lambda s: (s.overall_score is None, -(s.overall_score or 0), s.student_name))
        return [s.to_summary() for s in subs]

    def get_review_by_id(self, submission_id: str) -> Optional[Dict[str, Any]]:
        sub = self._datastore.get_review(submission_id)
        return sub.to_dict() if sub else None

    def similarity_overview(self) -> List[Dict[str, Any]]:
        """Pairs of submissions whose code is most alike (a hint for the lecturer, not a verdict)."""
        subs = [s for s in self._datastore.get_all_reviews() if s.fingerprint]
        pairs = []
        for i in range(len(subs)):
            for j in range(i + 1, len(subs)):
                pct = round(similarity(subs[i].fingerprint, subs[j].fingerprint) * 100)
                if pct >= 15:
                    pairs.append({"a": subs[i].submission_id, "a_name": subs[i].student_name,
                                  "b": subs[j].submission_id, "b_name": subs[j].student_name, "similarity": pct})
        pairs.sort(key=lambda p: -p["similarity"])
        return pairs[: self.MAX_SIMILARITY_PAIRS]

    def compare_submissions(self, id_a: str, id_b: str, with_ai: bool = True) -> Dict[str, Any]:
        a, b = self._datastore.get_review(id_a), self._datastore.get_review(id_b)
        if not a or not b:
            return {"success": False, "error": "One or both submissions were not found."}
        if a is b:
            return {"success": False, "error": "Choose two different submissions."}
        sim = round(similarity(a.fingerprint, b.fingerprint) * 100)
        result: Dict[str, Any] = {
            "success": True,
            "submission_a": a.to_dict(),
            "submission_b": b.to_dict(),
            "comparison": {
                "similarity": sim,
                "matching_files": matching_files(a.file_fingerprints, b.file_fingerprints),
                "score_difference": (abs((a.overall_score or 0) - (b.overall_score or 0))
                                     if a.review and b.review else None),
                "leader": (None if not (a.review and b.review) else
                           a.student_name if a.overall_score > b.overall_score else
                           b.student_name if b.overall_score > a.overall_score else "Tied"),
                "ai_comparison": None,
            },
        }
        if with_ai and a.review and b.review and self._gemini.enabled:
            key = f"{a.submission_id}|{b.submission_id}"
            with self._lock:
                cached = self._comparison_cache.get(key)
            if cached is None:
                try:
                    cached = self._gemini.compare_homework(a.review, b.review, a.student_name, b.student_name, sim)
                    with self._lock:
                        self._comparison_cache[key] = cached
                except GeminiError as e:
                    result["comparison"]["ai_error"] = str(e)
            result["comparison"]["ai_comparison"] = cached
        return result
