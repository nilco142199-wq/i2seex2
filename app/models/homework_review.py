"""
Homework Deep Review Domain Models.
Encapsulates automated LLM code review, OOP metric evaluation, and multi-repo comparison.
"""
from typing import List, Dict, Any


class SolidCompliance:
    def __init__(self, principle: str, status: str, critique: str):
        self.principle = principle  # e.g., "Single Responsibility (SRP)"
        self.status = status        # "pass", "warning", "fail"
        self.critique = critique

    def to_dict(self) -> Dict[str, Any]:
        return {
            "principle": self.principle,
            "status": self.status,
            "critique": self.critique
        }


class SubmissionReview:
    """
    Domain entity representing an automated LLM evaluation of a student repository.
    """
    def __init__(
        self,
        submission_id: str,
        student_id: str,
        student_name: str,
        repo_name: str,
        branch: str,
        commit_hash: str,
        overall_score: int,
        scores: Dict[str, int],  # e.g., {"architecture": 92, "solid": 88, "testing": 85, "clean_code": 90}
        solid_compliance: List[SolidCompliance],
        design_patterns: List[str],
        code_smells: List[str],
        ai_summary: str,
        refactoring_suggestions: List[str]
    ):
        self.submission_id = submission_id
        self.student_id = student_id
        self.student_name = student_name
        self.repo_name = repo_name
        self.branch = branch
        self.commit_hash = commit_hash
        self.overall_score = overall_score
        self.scores = scores
        self.solid_compliance = solid_compliance
        self.design_patterns = design_patterns
        self.code_smells = code_smells
        self.ai_summary = ai_summary
        self.refactoring_suggestions = refactoring_suggestions

    def to_dict(self) -> Dict[str, Any]:
        return {
            "submission_id": self.submission_id,
            "student_id": self.student_id,
            "student_name": self.student_name,
            "repo_name": self.repo_name,
            "branch": self.branch,
            "commit_hash": self.commit_hash,
            "overall_score": self.overall_score,
            "scores": self.scores,
            "solid_compliance": [sc.to_dict() for sc in self.solid_compliance],
            "design_patterns": self.design_patterns,
            "code_smells": self.code_smells,
            "ai_summary": self.ai_summary,
            "refactoring_suggestions": self.refactoring_suggestions
        }
