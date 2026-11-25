"""
GeminiClient – minimal Google Gemini API client (Python standard library only).

Used to really "watch" an uploaded class recording (audio + picture) and summarise it.
Flow (Gemini Files API, see https://ai.google.dev/gemini-api/docs/video-understanding):
  1. Resumable upload of the video file          POST {base}/upload/v1beta/files
  2. Wait until the file is processed (ACTIVE)   GET  {base}/v1beta/files/{id}
  3. Ask the model, with a JSON response schema  POST {base}/v1beta/models/{model}:generateContent

Configuration (environment variables):
  GEMINI_API_KEY   – required for real summaries (free key: https://aistudio.google.com/apikey)
  GEMINI_MODEL     – optional, model to try first (default: newest Flash in DEFAULT_MODELS)
  GEMINI_API_BASE  – optional, API address (tests point it at a local fake server)
"""
import json
import os
import ssl
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, List, Optional


def _ssl_context() -> ssl.SSLContext:
    """
    HTTPS context that verifies Google's certificate.
    Python from python.org on macOS ships without root certificates ("CERTIFICATE_VERIFY_FAILED")
    until 'Install Certificates.command' is run. Instead of turning verification off, fall back to
    certifi (if installed) or the operating system's own certificate bundle.
    """
    ctx = ssl.create_default_context()
    if ctx.cert_store_stats().get("x509_ca", 0) == 0:
        candidates = []
        try:
            import certifi  # optional
            candidates.append(certifi.where())
        except ImportError:
            pass
        candidates += ["/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt",
                       "/etc/pki/tls/certs/ca-bundle.crt", "/usr/local/etc/openssl/cert.pem",
                       "/opt/homebrew/etc/openssl@3/cert.pem"]
        for path in candidates:
            if path and os.path.exists(path):
                try:
                    ctx.load_verify_locations(cafile=path)
                    break
                except (ssl.SSLError, OSError):
                    continue
    return ctx


_SSL = _ssl_context()


class GeminiError(Exception):
    """Readable error for the instructor (shown in the UI)."""


class GeminiClient:
    # Tried in order; a model name that no longer exists (404) falls through to the next one.
    DEFAULT_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-2.5-flash",
                      "gemini-2.5-flash-lite"]
    TRANSIENT_STATUSES = (429, 500, 502, 503, 504)   # "try again later" answers
    retry_delays = (4, 10)                             # seconds between retries of one model
    MAX_FREE_TIER_BYTES = 2 * 1024 ** 3  # Files API: 2 GB per file on the free tier

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None,
                 model: Optional[str] = None, request_timeout: int = 300):
        self.api_key = (api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or "").strip()
        self.base_url = (base_url or os.environ.get("GEMINI_API_BASE") or "https://generativelanguage.googleapis.com").rstrip("/")
        preferred = model or os.environ.get("GEMINI_MODEL")
        self.models: List[str] = list(dict.fromkeys(([preferred] if preferred else []) + self.DEFAULT_MODELS))
        self.request_timeout = request_timeout
        self.last_model_used: Optional[str] = None
        self.poll_seconds = 5.0  # how often to check whether Google finished processing the video

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    # ------------------------------------------------------------------ HTTP helpers
    def _request(self, method: str, url: str, body=None, headers: Optional[Dict[str, str]] = None,
                 timeout: Optional[int] = None):
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("x-goog-api-key", self.api_key)
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        try:
            resp = urllib.request.urlopen(req, timeout=timeout or self.request_timeout, context=_SSL)
            return resp.status, dict(resp.headers), resp.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers or {}), e.read()
        except urllib.error.URLError as e:
            raise GeminiError(f"Cannot reach the Gemini API ({e.reason}). Check the internet connection.")

    @staticmethod
    def _error_text(status: int, raw: bytes) -> str:
        try:
            msg = json.loads(raw.decode("utf-8")).get("error", {}).get("message", "")
        except Exception:
            msg = raw[:200].decode("utf-8", "replace")
        if status in (401, 403):
            return f"Gemini rejected the API key ({status}). Check GEMINI_API_KEY. {msg}".strip()
        if status == 429:
            return f"Gemini quota exceeded (429) – wait a minute or use another key. {msg}".strip()
        return f"Gemini API error {status}: {msg}".strip()

    # ------------------------------------------------------------------ Files API
    def upload_file(self, path: str, mime_type: str, display_name: str) -> Dict[str, Any]:
        """Resumable upload (start + upload/finalize). Returns the File resource."""
        size = os.path.getsize(path)
        if size > self.MAX_FREE_TIER_BYTES:
            raise GeminiError("The video is larger than 2 GB (Gemini free-tier limit). Compress it or cut it.")

        start_body = json.dumps({"file": {"display_name": display_name[:120]}}).encode("utf-8")
        status, headers, raw = self._request("POST", f"{self.base_url}/upload/v1beta/files", start_body, {
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": str(size),
            "X-Goog-Upload-Header-Content-Type": mime_type,
            "Content-Type": "application/json",
        })
        upload_url = next((v for k, v in headers.items() if k.lower() == "x-goog-upload-url"), None)
        if status >= 300 or not upload_url:
            raise GeminiError(self._error_text(status, raw))

        with open(path, "rb") as fh:  # streamed by http.client, never fully in memory
            status, _, raw = self._request("POST", upload_url, fh, {
                "Content-Length": str(size),
                "X-Goog-Upload-Offset": "0",
                "X-Goog-Upload-Command": "upload, finalize",
            }, timeout=max(self.request_timeout, 1800))
        if status >= 300:
            raise GeminiError(self._error_text(status, raw))
        file_info = json.loads(raw.decode("utf-8")).get("file") or {}
        if not file_info.get("uri"):
            raise GeminiError("Gemini did not return a file URI after the upload.")
        return file_info

    def wait_until_active(self, file_info: Dict[str, Any], poll_seconds: Optional[float] = None,
                          max_wait_seconds: int = 1800,
                          on_poll: Optional[Callable[[str], None]] = None) -> Dict[str, Any]:
        """Videos are processed by Google before they can be used; poll until ACTIVE."""
        name = file_info.get("name")
        poll_seconds = self.poll_seconds if poll_seconds is None else poll_seconds
        deadline = time.time() + max_wait_seconds
        info = file_info
        while True:
            state = info.get("state", "STATE_UNSPECIFIED")
            if state == "ACTIVE":
                return info
            if state == "FAILED":
                raise GeminiError("Gemini could not process this video file (state FAILED).")
            if time.time() > deadline:
                raise GeminiError("Gemini took too long to process the video.")
            if on_poll:
                on_poll(state)
            time.sleep(poll_seconds)
            status, _, raw = self._request("GET", f"{self.base_url}/v1beta/{name}")
            if status >= 300:
                raise GeminiError(self._error_text(status, raw))
            payload = json.loads(raw.decode("utf-8"))
            info = payload.get("file", payload)

    # ------------------------------------------------------------------ generateContent
    def generate(self, parts: List[Dict[str, Any]], response_schema: Optional[Dict[str, Any]] = None,
                 temperature: float = 0.3) -> str:
        """Calls generateContent, falling back through self.models on 404 (retired model name)."""
        body: Dict[str, Any] = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"temperature": temperature},
        }
        if response_schema:
            body["generationConfig"]["responseMimeType"] = "application/json"
            body["generationConfig"]["responseSchema"] = response_schema
        data = json.dumps(body).encode("utf-8")

        last_error = "No Gemini model available."
        busy_error = None
        # Google sometimes answers 503 "high demand" / 429 / 500 for a while. Each model is retried
        # with growing pauses, then the next model is tried; then the whole list once more.
        for round_no in range(2):
            for model in self.models:
                for attempt, pause in enumerate([0] + list(self.retry_delays)):
                    if pause:
                        time.sleep(pause * (round_no + 1))
                    status, _, raw = self._request("POST", f"{self.base_url}/v1beta/models/{model}:generateContent",
                                                   data, {"Content-Type": "application/json"})
                    if status in self.TRANSIENT_STATUSES:
                        busy_error = self._error_text(status, raw)
                        continue                      # retry the same model after a pause
                    break
                else:
                    continue                          # still busy after all retries → next model
                if status == 404:
                    last_error = f"Model {model} not found"
                    continue
                if status >= 300:
                    raise GeminiError(self._error_text(status, raw))
                payload = json.loads(raw.decode("utf-8"))
                try:
                    text = "".join(p.get("text", "") for p in payload["candidates"][0]["content"]["parts"])
                except (KeyError, IndexError, TypeError):
                    reason = (payload.get("promptFeedback") or {}).get("blockReason") or "empty response"
                    raise GeminiError(f"Gemini returned no text ({reason}).")
                self.last_model_used = model
                return text
            if busy_error is None:
                break                                 # nothing was busy – a second round won't help
        if busy_error:
            raise GeminiError("Google's Gemini servers are overloaded right now (tried every model several times). "
                              "Please upload again in a few minutes. Details: " + busy_error)
        raise GeminiError(last_error)

    # ------------------------------------------------------------------ lecture-specific prompts
    SUMMARY_SCHEMA: Dict[str, Any] = {
        "type": "OBJECT",
        "properties": {
            "title": {"type": "STRING"},
            "duration": {"type": "STRING"},
            "executive_summary": {"type": "STRING"},
            "chapters": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
                "timestamp": {"type": "STRING"}, "title": {"type": "STRING"}, "description": {"type": "STRING"}},
                "required": ["timestamp", "title", "description"]}},
            "key_takeaways": {"type": "ARRAY", "items": {"type": "STRING"}},
            "action_items": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
                "task": {"type": "STRING"}, "assignee": {"type": "STRING"}, "due_date": {"type": "STRING"}},
                "required": ["task"]}},
            "transcript_highlights": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
                "timestamp": {"type": "STRING"}, "speaker": {"type": "STRING"}, "text": {"type": "STRING"}},
                "required": ["timestamp", "text"]}},
            "topics": {"type": "ARRAY", "items": {"type": "STRING"}},
        },
        "required": ["executive_summary", "chapters", "key_takeaways"],
    }

    @staticmethod
    def _language_rule(language: str) -> str:
        if language == "he":
            return "Write every text field in Hebrew."
        if language == "en":
            return "Write every text field in English."
        return "Write every text field in the main language spoken in the lecture."

    def summarize_lecture(self, file_info: Dict[str, Any], title_hint: str = "", topic_hint: str = "",
                          language: str = "auto") -> Dict[str, Any]:
        prompt = (
            "You are a teaching assistant. Watch and listen to this recorded university lecture and summarise it "
            "for the students and the lecturer. Base everything ONLY on what is actually said and shown in the "
            "video – do not invent content. "
            f"{self._language_rule(language)} "
            "Return: a short title; the video duration (H:MM:SS or MM:SS); an executive summary (5-8 sentences); "
            "chapters with start timestamps (MM:SS or H:MM:SS) covering the whole lecture; 4-8 key takeaways; "
            "action items the lecturer gave (homework, deadlines, reading) – empty list if none; "
            "3-6 short verbatim highlights with timestamps and speaker ('Lecturer' or 'Student'); 3-6 topic tags. "
            + (f"Lecture title given by the lecturer: {title_hint}. " if title_hint else "")
            + (f"Expected topic: {topic_hint}. " if topic_hint else "")
        )
        text = self.generate([
            {"file_data": {"mime_type": file_info.get("mimeType", "video/mp4"), "file_uri": file_info["uri"]}},
            {"text": prompt},
        ], response_schema=self.SUMMARY_SCHEMA)
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            raise GeminiError("Gemini's answer was not valid JSON – try again.")

    def ask_about_lecture(self, file_uri: str, mime_type: str, question: str) -> Dict[str, str]:
        schema = {"type": "OBJECT", "properties": {
            "answer": {"type": "STRING"}, "timestamp": {"type": "STRING"}}, "required": ["answer"]}
        text = self.generate([
            {"file_data": {"mime_type": mime_type, "file_uri": file_uri}},
            {"text": "Answer the student's question using ONLY this lecture recording. Answer in the language of "
                     "the question. If the lecture does not cover it, say so. Give the timestamp (MM:SS) where it "
                     f"is discussed, or an empty string. Question: {question}"},
        ], response_schema=schema)
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return {"answer": text.strip(), "timestamp": ""}

    # ------------------------------------------------------------------ homework review
    _EVIDENCE = {"type": "OBJECT", "properties": {
        "file": {"type": "STRING"}, "line": {"type": "INTEGER"}}, "required": ["file"]}
    REVIEW_SCHEMA: Dict[str, Any] = {
        "type": "OBJECT",
        "properties": {
            "summary": {"type": "STRING"},
            "overall_score": {"type": "INTEGER"},
            "scores": {"type": "OBJECT", "properties": {
                "requirements": {"type": "INTEGER"}, "oop_design": {"type": "INTEGER"},
                "solid": {"type": "INTEGER"}, "code_quality": {"type": "INTEGER"},
                "testing": {"type": "INTEGER"}, "documentation": {"type": "INTEGER"}},
                "required": ["requirements", "oop_design", "solid", "code_quality", "testing", "documentation"]},
            "requirements": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
                "requirement": {"type": "STRING"},
                "status": {"type": "STRING", "enum": ["met", "partial", "missing"]},
                "evidence": {"type": "ARRAY", "items": _EVIDENCE},
                "comment": {"type": "STRING"}}, "required": ["requirement", "status", "comment"]}},
            "solid": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
                "principle": {"type": "STRING"},
                "status": {"type": "STRING", "enum": ["pass", "warning", "fail", "not_applicable"]},
                "evidence": {"type": "ARRAY", "items": _EVIDENCE},
                "comment": {"type": "STRING"}}, "required": ["principle", "status", "comment"]}},
            "design_patterns": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
                "name": {"type": "STRING"},
                "evidence": {"type": "ARRAY", "items": _EVIDENCE},
                "explanation": {"type": "STRING"}}, "required": ["name", "evidence", "explanation"]}},
            "issues": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
                "severity": {"type": "STRING", "enum": ["high", "medium", "low"]},
                "file": {"type": "STRING"}, "line": {"type": "INTEGER"},
                "problem": {"type": "STRING"}, "fix": {"type": "STRING"}},
                "required": ["severity", "file", "problem", "fix"]}},
            "strengths": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
                "text": {"type": "STRING"}, "evidence": {"type": "ARRAY", "items": _EVIDENCE}},
                "required": ["text"]}},
        },
        "required": ["summary", "overall_score", "scores", "requirements", "solid", "design_patterns",
                     "issues", "strengths"],
    }

    def review_homework(self, code_text: str, requirements: str, student_name: str = "",
                        language: str = "en") -> Dict[str, Any]:
        """Deep review of one submission. code_text = file tree + numbered file contents (CodeBundle)."""
        lang = "Write every text field in Hebrew." if language == "he" else "Write every text field in English."
        prompt = (
            "HOMEWORK REVIEW. You are a strict but fair teaching assistant in an Object-Oriented Programming and "
            "Software Engineering course. Review the student's submission below against the assignment "
            "requirements.\n"
            "RULES – follow them exactly:\n"
            "1. Use ONLY the files shown below. Never assume code, files, tests or documents that are not shown.\n"
            "2. Every requirement, SOLID verdict, design pattern, issue and strength must cite evidence: the exact "
            "file path as written in the FILE TREE, and the line number when relevant (the numbers before '|').\n"
            "3. If something required is not in the files, mark it 'missing' – do not guess that it exists.\n"
            "4. Report a design pattern only if its structure is really in the code; otherwise return an empty list.\n"
            "5. Scores are 0-100 and must match the findings (missing requirements → low requirements score).\n"
            "6. Issues: the most important 3-10 real problems, each with a concrete fix. Strengths: 2-5.\n"
            f"7. {lang}\n\n"
            f"ASSIGNMENT REQUIREMENTS:\n{requirements.strip() or 'General OOP homework: correct, well-designed, tested and documented code.'}\n\n"
            + (f"STUDENT: {student_name}\n\n" if student_name else "")
            + "SUBMISSION:\n" + code_text
        )
        text = self.generate([{"text": prompt}], response_schema=self.REVIEW_SCHEMA, temperature=0.2)
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            raise GeminiError("Gemini's answer was not valid JSON – try again.")

    def compare_homework(self, review_a: Dict[str, Any], review_b: Dict[str, Any],
                         name_a: str, name_b: str, similarity_percent: int, language: str = "en") -> str:
        """Short written comparison of two reviews that already exist (no new facts are introduced)."""
        lang = "Answer in Hebrew." if language == "he" else "Answer in English."
        prompt = (
            "Compare these two homework reviews in 4-6 sentences for the lecturer: where each submission is "
            "stronger, which requirements one met and the other did not, and what each should fix first. Use only "
            f"the facts in the two reviews. {lang}\n"
            f"Measured code similarity between the two submissions: {similarity_percent}%.\n\n"
            f"REVIEW OF {name_a}:\n{json.dumps(review_a, ensure_ascii=False)[:20000]}\n\n"
            f"REVIEW OF {name_b}:\n{json.dumps(review_b, ensure_ascii=False)[:20000]}"
        )
        return self.generate([{"text": prompt}], temperature=0.2).strip()
