"""
Homework Deep Review Service.
Performs simulated LLM code auditing, SOLID rubric compliance checks,
and multi-student repository comparison.
"""
from typing import Dict, Any, List, Optional
import random
from app.repositories.datastore import DataStore
from app.models.homework_review import SubmissionReview, SolidCompliance


class CodeReviewService:
    """
    Coordinates AI-assisted code reviews, OOP design evaluations, and repository comparisons.
    """
    def __init__(self, datastore: DataStore = None):
        self._datastore = datastore or DataStore()

    def get_all_reviews(self) -> List[Dict[str, Any]]:
        reviews = self._datastore.get_all_reviews()
        # Return sorted by score descending
        sorted_revs = sorted(reviews, key=lambda r: r.overall_score, reverse=True)
        return [r.to_dict() for r in sorted_revs]

    def get_review_by_id(self, submission_id: str) -> Optional[Dict[str, Any]]:
        review = self._datastore.get_review(submission_id)
        return review.to_dict() if review else None

    def compare_submissions(self, id_a: str, id_b: str) -> Dict[str, Any]:
        """Generates a side-by-side comparative analysis of two student submissions."""
        rev_a = self._datastore.get_review(id_a)
        rev_b = self._datastore.get_review(id_b)

        if not rev_a or not rev_b:
            return {"success": False, "error": "One or both submission IDs were not found."}

        dict_a = rev_a.to_dict()
        dict_b = rev_b.to_dict()

        score_diff = rev_a.overall_score - rev_b.overall_score
        winner = rev_a.student_name if score_diff > 0 else (rev_b.student_name if score_diff < 0 else "Tied")

        return {
            "success": True,
            "submission_a": dict_a,
            "submission_b": dict_b,
            "comparison": {
                "score_difference": abs(score_diff),
                "leader": winner,
                "metrics_delta": {
                    key: dict_a["scores"].get(key, 0) - dict_b["scores"].get(key, 0)
                    for key in dict_a["scores"]
                },
                "comparative_summary": (
                    f"{rev_a.student_name} demonstrates higher adherence in {list(dict_a['scores'].keys())[0]}, "
                    f"while {rev_b.student_name} features distinctive approaches in design pattern composition."
                )
            }
        }

    def analyze_repo(self, repo_url: str, student_name: str) -> Dict[str, Any]:
        """
        Simulates an automated deep LLM scan on a newly submitted GitHub repository.
        """
        if not repo_url or not repo_url.strip():
            return {"success": False, "error": "Repository URL is required."}

        clean_name = student_name.strip() if student_name else "Student Contributor"
        sub_id = f"sub-{random.randint(104, 999)}"
        score = random.randint(82, 98)

        new_review = SubmissionReview(
            submission_id=sub_id,
            student_id=f"s{random.randint(111, 199)}",
            student_name=clean_name,
            repo_name=repo_url.replace("https://github.com/", "").strip(),
            branch="main",
            commit_hash=f"{random.randint(1000000, 9999999):x}"[:7],
            overall_score=score,
            scores={
                "architecture": random.randint(80, 98),
                "solid_compliance": random.randint(82, 96),
                "clean_code": random.randint(85, 99),
                "testability": random.randint(75, 95)
            },
            solid_compliance=[
                SolidCompliance("Single Responsibility (SRP)", "pass", "Module separation observed across classes."),
                SolidCompliance("Open/Closed Principle (OCP)", "pass", "Extensible design utilizing composition."),
                SolidCompliance("Liskov Substitution (LSP)", "pass", "Polymorphic contracts honored in all child entities."),
                SolidCompliance("Interface Segregation (ISP)", "pass", "Clean granular interfaces detected."),
                SolidCompliance("Dependency Inversion (DIP)", "pass", "Services depend on abstractions rather than low-level details.")
            ],
            design_patterns=["Repository Pattern", "Observer Pattern", "Strategy"],
            code_smells=["Minor: docstrings could include typing annotations for return types"],
            ai_summary=(
                f"LLM Audit Completed for {clean_name}'s repository. The code demonstrates a mature "
                "understanding of OOP principles, proper separation between presentation and data domains, "
                "and effective use of object-oriented idioms."
            ),
            refactoring_suggestions=[
                "Add automated CI unit test runner (e.g. GitHub Actions).",
                "Ensure consistent typing hints across all helper utility functions."
            ]
        )

        self._datastore._submissions[sub_id] = new_review
        return {
            "success": True,
            "submission": new_review.to_dict()
        }
