"""
Poll Service.
Manages on-the-spot interactive polls, option configuration, and real-time tallying.
"""
from typing import Dict, Any, List, Optional
from app.repositories.datastore import DataStore
from app.models.poll import Poll


class PollService:
    """
    Coordinates poll lifecycle: creation, active status toggling, and vote processing.
    """
    def __init__(self, datastore: DataStore = None):
        self._datastore = datastore or DataStore()

    def get_active_poll(self) -> Optional[Dict[str, Any]]:
        poll = self._datastore.get_active_poll()
        return poll.to_dict() if poll else None

    def submit_vote(self, option_id: str, voter_id: str = None) -> Dict[str, Any]:
        poll = self._datastore.get_active_poll()
        if not poll:
            return {"success": False, "error": "No active poll currently running."}

        if not poll.is_active:
            return {"success": False, "error": "This poll is currently closed for voting."}

        success = poll.record_vote(option_id, voter_id)
        if not success:
            return {
                "success": False,
                "error": "Failed to record vote. You may have already voted or invalid option."
            }

        return {
            "success": True,
            "poll": poll.to_dict()
        }

    def toggle_poll_state(self) -> Dict[str, Any]:
        poll = self._datastore.get_active_poll()
        if not poll:
            return {"success": False, "error": "No poll found to toggle."}

        new_state = poll.toggle_active()
        return {
            "success": True,
            "is_active": new_state,
            "poll": poll.to_dict()
        }

    def create_new_poll(self, question: str, options: List[str]) -> Dict[str, Any]:
        if not question or not question.strip():
            return {"success": False, "error": "Poll question cannot be blank."}

        clean_options = [opt.strip() for opt in options if opt and opt.strip()]
        if len(clean_options) < 2:
            return {"success": False, "error": "Poll must provide at least 2 distinct choices."}

        new_poll = Poll(question=question, options=clean_options, is_active=True)
        self._datastore.save_poll(new_poll)
        return {
            "success": True,
            "poll": new_poll.to_dict()
        }
