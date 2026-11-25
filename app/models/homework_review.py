"""
Homework Deep Review – domain model.

A HomeworkSubmission is one student's real upload (a .zip or a public GitHub repository).
  * metrics   – counted from the files (always real)
  * review    – the LLM's review, validated against the files (None until it is ready / without a key)
  * status    – "processing" → "completed" | "failed"
Nothing in this model is invented: without an API key the review stays empty and the UI says so.
"""
import time
from typing import Any, Dict, List, Optional, Set


class HomeworkSubmission:
    def __init__(self, submission_id: str, student_name: str, source: str, source_label: str,
                 files: List[str], metrics: Dict[str, Any], fingerprint: Set[int],
                 file_fingerprints: Dict[str, Set[int]]):
        self.submission_id = submission_id
        self.student_name = student_name
        self.source = source                    # "zip" | "github"
        self.source_label = source_label        # file name or github.com/user/repo
        self.files = files                      # paths that were read
        self.metrics = metrics
        self.fingerprint = fingerprint          # for comparing submissions with each other
        self.file_fingerprints = file_fingerprints
        self.uploaded_at = time.strftime("%d/%m %H:%M")
        self.status = "processing"
        self.stage = "Reading the code…"
        self.error: Optional[str] = None
        self.review: Optional[Dict[str, Any]] = None
        self.ai_model: Optional[str] = None
        self.omitted_files: List[str] = []      # too long to send to the model
        self.removed_claims = 0                 # LLM findings dropped because their file does not exist

    @property
    def overall_score(self) -> Optional[int]:
        return (self.review or {}).get("overall_score")

    def to_summary(self) -> Dict[str, Any]:
        return {
            "submission_id": self.submission_id,
            "student_name": self.student_name,
            "source": self.source,
            "source_label": self.source_label,
            "uploaded_at": self.uploaded_at,
            "status": self.status,
            "stage": self.stage,
            "error": self.error,
            "overall_score": self.overall_score,
            "reviewed": self.review is not None,
            "metrics": self.metrics,
        }

    def to_dict(self) -> Dict[str, Any]:
        data = self.to_summary()
        data.update({
            "files": self.files,
            "review": self.review,
            "ai_model": self.ai_model,
            "omitted_files": self.omitted_files,
            "removed_claims": self.removed_claims,
        })
        return data
