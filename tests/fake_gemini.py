"""
A local stand-in for the Google Gemini API (Files API + generateContent), used only by tests.
It checks that our client sends well-formed requests (API key, resumable upload headers,
file reference, JSON schema) and answers like the real service.
"""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

HEBREW_SUMMARY = {
    "title": "תבניות עיצוב – Observer",
    "duration": "48:12",
    "executive_summary": "המרצה הציג את תבנית Observer והסביר צימוד רופף בין Subject למאזינים.",
    "chapters": [
        {"timestamp": "00:00", "title": "פתיחה", "description": "מטרות השיעור"},
        {"timestamp": "12:30", "title": "תבנית Observer", "description": "דוגמת קוד חיה"},
    ],
    "key_takeaways": ["להעדיף הרכבה על פני ירושה", "לנתק מאזינים כדי למנוע דליפת זיכרון"],
    "action_items": [{"task": "להגיש את מטלה 2", "assignee": "כל הסטודנטים", "due_date": "25/11"}],
    "transcript_highlights": [{"timestamp": "12:31", "speaker": "Lecturer", "text": "ה-Subject לא מכיר את המאזינים"}],
    "topics": ["Observer", "SOLID"],
}


HOMEWORK_REVIEW = {
    "summary": "Shapes are modelled with an abstract base class; tests exist.",
    "overall_score": 140,          # out of range on purpose → must be clamped to 100
    "scores": {"requirements": 70, "oop_design": 85, "solid": 80, "code_quality": 75, "testing": 60, "documentation": 50},
    "requirements": [
        {"requirement": "README", "status": "met", "evidence": [{"file": "README.md"}], "comment": "Has run steps."},
        {"requirement": "Tests", "status": "met", "evidence": [{"file": "tests/test_shapes.py", "line": 3}], "comment": "ok"},
        {"requirement": "Class diagram", "status": "met", "evidence": [{"file": "docs/uml.md"}], "comment": "invented file"},
    ],
    "solid": [{"principle": "Open/Closed", "status": "pass", "evidence": [{"file": "shapes.py", "line": 1}], "comment": "new shapes subclass Shape"}],
    "design_patterns": [
        {"name": "Template Method", "evidence": [{"file": "src/shapes.py", "line": 4}], "explanation": "area() hook"},
        {"name": "Singleton", "evidence": [{"file": "src/ghost.py"}], "explanation": "invented"},
    ],
    "issues": [
        {"severity": "low", "file": "src/shapes.py", "line": 9, "problem": "magic number 3.14", "fix": "use math.pi"},
        {"severity": "high", "file": "src/database.py", "problem": "SQL injection", "fix": "invented file"},
    ],
    "strengths": [{"text": "Clear abstraction", "evidence": [{"file": "src/shapes.py"}]}],
}


class FakeGemini:
    def __init__(self, processing_polls=2, retired_models=("gemini-3.8-flash",), busy_models=()):
        self.processing_polls = processing_polls
        self.retired_models = set(retired_models)
        self.busy_models = set(busy_models)   # always answer 503 "high demand"
        self.review_prompts = []
        self.uploaded_bytes = 0
        self.requests = []          # (method, path) log
        self.generate_bodies = []   # parsed generateContent bodies
        self.api_keys = set()
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _json(self, code, data, headers=None):
                payload = json.dumps(data, ensure_ascii=False).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def do_POST(self):
                outer.requests.append(("POST", self.path))
                outer.api_keys.add(self.headers.get("x-goog-api-key"))
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length)
                if self.path == "/upload/v1beta/files":
                    assert self.headers["X-Goog-Upload-Protocol"] == "resumable"
                    assert self.headers["X-Goog-Upload-Command"] == "start"
                    outer.declared_size = int(self.headers["X-Goog-Upload-Header-Content-Length"])
                    outer.declared_mime = self.headers["X-Goog-Upload-Header-Content-Type"]
                    return self._json(200, {}, {"X-Goog-Upload-URL": f"http://127.0.0.1:{outer.port}/upload-session/1"})
                if self.path == "/upload-session/1":
                    assert self.headers["X-Goog-Upload-Command"] == "upload, finalize"
                    outer.uploaded_bytes = len(body)
                    return self._json(200, {"file": {"name": "files/abc123", "uri": "https://fake/files/abc123",
                                                     "mimeType": outer.declared_mime, "state": "PROCESSING"}})
                if self.path.startswith("/v1beta/models/") and self.path.endswith(":generateContent"):
                    model = self.path.split("/models/")[1].split(":")[0]
                    if model in outer.retired_models:
                        return self._json(404, {"error": {"message": f"models/{model} is not found"}})
                    if model in outer.busy_models:
                        return self._json(503, {"error": {"message": "This model is currently experiencing high demand."}})
                    req = json.loads(body)
                    outer.generate_bodies.append((model, req))
                    parts = req["contents"][0]["parts"]
                    first_text = parts[0].get("text", "")
                    if first_text.startswith("HOMEWORK REVIEW"):
                        assert "ASSIGNMENT REQUIREMENTS" in first_text and "===== FILE: " in first_text
                        assert req["generationConfig"]["responseMimeType"] == "application/json"
                        outer.review_prompts.append(first_text)
                        return self._json(200, {"candidates": [{"content": {"parts": [
                            {"text": json.dumps(HOMEWORK_REVIEW, ensure_ascii=False)}]}}]})
                    if first_text.startswith("Compare these two homework reviews"):
                        return self._json(200, {"candidates": [{"content": {"parts": [
                            {"text": "Student A has tests; student B does not."}]}}]})
                    assert parts[0]["file_data"]["file_uri"] == "https://fake/files/abc123"
                    prompt = parts[1]["text"]
                    if "Question:" in prompt:
                        answer = {"answer": "התבנית מוסברת בדקה 12:30.", "timestamp": "12:30"}
                    else:
                        assert req["generationConfig"]["responseMimeType"] == "application/json"
                        answer = HEBREW_SUMMARY
                    return self._json(200, {"candidates": [{"content": {"parts": [{"text": json.dumps(answer, ensure_ascii=False)}]}}]})
                return self._json(404, {"error": {"message": "unknown path"}})

            def do_GET(self):
                outer.requests.append(("GET", self.path))
                if self.path == "/v1beta/files/abc123":
                    outer.processing_polls -= 1
                    state = "PROCESSING" if outer.processing_polls > 0 else "ACTIVE"
                    return self._json(200, {"name": "files/abc123", "uri": "https://fake/files/abc123",
                                            "mimeType": "video/mp4", "state": state})
                return self._json(404, {"error": {"message": "unknown path"}})

        self.httpd = HTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.httpd.server_address[1]
        self.base_url = f"http://127.0.0.1:{self.port}"

    def start(self):
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        return self

    def stop(self):
        self.httpd.shutdown()


if __name__ == "__main__":  # run standalone for manual / browser testing
    import sys, time
    fg = FakeGemini(processing_polls=3).start()
    print(fg.base_url, flush=True)
    while True:
        time.sleep(3600)
