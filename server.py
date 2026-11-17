"""
University Classroom Teaching Tool - Main Application Server.
Ex2 Assignment - Object-Oriented Programming & Deep Architecture.

Zero-dependency standard library Python HTTP Server.
Integrates static file hosting and modular REST API routing.
"""
import os
import sys
import json
import mimetypes
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

from app.handlers.api_router import ApiRouter

# Base paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    """Multi-threaded HTTP Server for handling concurrent student requests."""
    daemon_threads = True


class ClassroomRequestHandler(BaseHTTPRequestHandler):
    """
    HTTP Request Handler following the Front Controller Pattern.
    Routes API requests to ApiRouter, and static assets to disk reader.
    """
    router = ApiRouter()

    def do_OPTIONS(self):
        """Handle CORS pre-flight requests."""
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        """Handle HTTP GET requests."""
        if self.path.startswith("/api"):
            self._handle_api("GET")
        else:
            self._serve_static()

    def do_POST(self):
        """Handle HTTP POST requests."""
        if self.path.startswith("/api"):
            self._handle_api("POST")
        else:
            self.send_error(405, "Method Not Allowed")

    def _handle_api(self, method: str):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b""

        status_code, response_data = self.router.handle(method, self.path, body)

        json_bytes = json.dumps(response_data, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(json_bytes)))
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(json_bytes)

    def _serve_static(self):
        """Serves HTML, CSS, JavaScript, and assets from static/."""
        clean_path = self.path.split("?")[0].lstrip("/")
        if not clean_path or clean_path == "/":
            clean_path = "index.html"

        file_path = os.path.normpath(os.path.join(STATIC_DIR, clean_path))

        # Security check: prevent directory traversal
        if not file_path.startswith(STATIC_DIR) or not os.path.exists(file_path) or os.path.isdir(file_path):
            # Fallback to index.html for client-side routing if requested path isn't a direct asset
            fallback_index = os.path.join(STATIC_DIR, "index.html")
            if os.path.exists(fallback_index) and not clean_path.startswith("api/"):
                file_path = fallback_index
            else:
                self.send_error(404, f"File Not Found: {clean_path}")
                return

        mime_type, _ = mimetypes.guess_type(file_path)
        if mime_type is None:
            mime_type = "application/octet-stream"

        try:
            with open(file_path, "rb") as f:
                content = f.read()

            self.send_response(200)
            self.send_header("Content-Type", f"{mime_type}; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-cache")
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(500, f"Error reading file: {str(e)}")

    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def log_message(self, format, *args):
        # Clean terminal logging
        sys.stderr.write(f"[{self.log_date_time_string()}] {self.address_string()} - {format % args}\n")


def run(host: str = "127.0.0.1", port: int = 8000):
    server_address = (host, port)
    httpd = ThreadedHTTPServer(server_address, ClassroomRequestHandler)
    print("=" * 70)
    print("🎓 CS302 Interactive Classroom Suite (Ex2 OOP Assignment)")
    print("   Vibe Coding & Deep Designing Architecture")
    print(f"🚀 Server running live at: http://{host}:{port}/")
    print("   API endpoints available at: /api/*")
    print("   Press Ctrl+C to stop the server.")
    print("=" * 70)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Shutting down gracefully...")
        httpd.server_close()
        print("Done.")


if __name__ == "__main__":
    port = 8000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    run(port=port)
