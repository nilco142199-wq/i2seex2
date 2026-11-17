"""
Feedback Service.
Encapsulates operations on live student questions, offline feedback, and upvotes.
"""
from typing import Dict, Any, List, Optional
from app.repositories.datastore import DataStore
from app.models.feedback import Comment


class FeedbackService:
    """
    Handles live classroom feedback, question queues, and community moderation.
    """
    def __init__(self, datastore: DataStore = None):
        self._datastore = datastore or DataStore()

    def get_comments(self, category_filter: Optional[str] = None) -> List[Dict[str, Any]]:
        comments = self._datastore.get_all_comments()
        if category_filter and category_filter != "all":
            comments = [c for c in comments if c.category == category_filter]
        return [c.to_dict() for c in comments]

    def add_comment(
        self,
        content: str,
        author_name: str = "Anonymous",
        is_anonymous: bool = False,
        category: str = "question"
    ) -> Dict[str, Any]:
        if not content or not content.strip():
            return {"success": False, "error": "Comment text cannot be empty."}

        new_comment = Comment(
            content=content,
            author_name=author_name or "Student",
            is_anonymous=is_anonymous,
            category=category
        )
        saved = self._datastore.add_comment(new_comment)
        return {"success": True, "comment": saved.to_dict()}

    def upvote_comment(self, comment_id: str) -> Dict[str, Any]:
        comment = self._datastore.get_comment(comment_id)
        if not comment:
            return {"success": False, "error": "Comment not found."}

        new_votes = comment.upvote()
        return {"success": True, "comment_id": comment_id, "upvotes": new_votes}

    def toggle_resolved(self, comment_id: str) -> Dict[str, Any]:
        comment = self._datastore.get_comment(comment_id)
        if not comment:
            return {"success": False, "error": "Comment not found."}

        status = comment.toggle_resolved()
        return {"success": True, "comment_id": comment_id, "is_resolved": status}
