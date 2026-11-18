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
    allow_reuse_address = True
    # Default listen backlog is only 5: a burst of 100+ phones connecting in the same second
    # would get refused/delayed. A large backlog absorbs the whole lecture hall at once.
    request_queue_size = 512

    def handle_error(self, request, client_address):
        # Failed TLS handshakes (browser rejected the self-signed cert) are normal – don't spam tracebacks
        import ssl
        exc = sys.exc_info()[1]
        if isinstance(exc, (ssl.SSLError, ConnectionError, TimeoutError, OSError)):
            return
        super().handle_error(request, client_address)


class ClassroomRequestHandler(BaseHTTPRequestHandler):
    """
    HTTP Request Handler following the Front Controller Pattern.
    Routes API requests to ApiRouter, and static assets to disk reader.
    """
    router = ApiRouter()
    lan_origin = None  # address other devices use, e.g. "https://192.168.1.23:8443" or a tunnel URL
    server_mode = "http"  # "http" | "https-self-signed" | "tunnel" (shown to phones for better help)
    timeout = 30       # seconds; an idle/half-open connection can never block the server

    DEVICE_COOKIE = "cs302_device"

    def _client_ip(self) -> str:
        """Real client address (Cloudflare tunnel / proxies put it in a header)."""
        for header in ("CF-Connecting-IP", "X-Forwarded-For", "X-Real-IP"):
            value = self.headers.get(header)
            if value:
                return value.split(",")[0].strip()
        return self.client_address[0]

    def _device_cookie(self) -> str:
        """Random per-browser id (cookie). Created on the first request and sent back with Set-Cookie."""
        if getattr(self, "_device_id", None):
            return self._device_id
        import re as _re
        import uuid
        match = _re.search(rf"(?:^|;\s*){self.DEVICE_COOKIE}=([A-Za-z0-9\-]{{8,64}})", self.headers.get("Cookie", ""))
        if match:
            self._device_id, self._device_is_new = match.group(1), False
        else:
            self._device_id, self._device_is_new = uuid.uuid4().hex, True
        return self._device_id

    def handle_one_request(self):
        self._device_id, self._device_is_new = None, False  # per request (keep-alive safe)
        super().handle_one_request()

    def end_headers(self):
        # Give every browser a long-lived device cookie (used for one-phone-per-student)
        if hasattr(self, "headers") and self.headers is not None:
            self._device_cookie()
            if getattr(self, "_device_is_new", False):
                self.send_header("Set-Cookie", f"{self.DEVICE_COOKIE}={self._device_id}; Path=/; "
                                               f"Max-Age=31536000; SameSite=Lax")
                self._device_is_new = False
        # Explicitly allow camera + location for this site (never blocked by the server)
        self.send_header("Permissions-Policy", "geolocation=(self), camera=(self)")
        super().end_headers()

    def setup(self):
        # HTTPS: do the TLS handshake here, in this request's own thread, so a phone that
        # stops at the certificate warning can't freeze the whole server.
        if hasattr(self.request, "do_handshake"):
            self.request.settimeout(self.timeout)
            self.request.do_handshake()
        super().setup()

    def handle(self):
        try:
            super().handle()
        except (ConnectionError, TimeoutError, OSError):
            pass  # client went away / rejected our dev certificate – ignore quietly

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
        if self.path.split("?")[0].rstrip("/") == "/api/server-info":
            payload = json.dumps({"lan_origin": self.lan_origin, "mode": self.server_mode}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(payload)
            return
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b""

        status_code, response_data = self.router.handle(
            method, self.path, body, client={"device_cookie": self._device_cookie(), "ip": self._client_ip()})

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
        elif clean_path.rstrip("/") == "gps":
            clean_path = "gps.html"  # standalone location test page

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
            # Big libraries (jsQR 130 KB, qrcode.js) are cached by phones for a day,
            # so 100+ students don't re-download them on every visit.
            if "/vendor/" in clean_path:
                self.send_header("Cache-Control", "public, max-age=86400")
            else:
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


CERT_DIR = os.path.join(BASE_DIR, "certs")


def get_lan_ip() -> str:
    """Best-effort detection of this computer's Wi-Fi/LAN IP (no traffic is actually sent)."""
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"


def ensure_self_signed_cert(lan_ip: str):
    """
    Creates a self-signed certificate in ./certs (once) using the system `openssl` binary.
    Browsers only allow camera + GPS on HTTPS (or on localhost), so phones need this.
    """
    import subprocess
    os.makedirs(CERT_DIR, exist_ok=True)
    cert_file = os.path.join(CERT_DIR, "cert.pem")
    key_file = os.path.join(CERT_DIR, "key.pem")
    if os.path.exists(cert_file) and os.path.exists(key_file):
        return cert_file, key_file

    base_cmd = [
        "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", key_file, "-out", cert_file, "-days", "365",
        "-subj", "/CN=CS302 Classroom Suite (dev)",
    ]
    san = f"subjectAltName=DNS:localhost,IP:127.0.0.1,IP:{lan_ip}"
    try:
        subprocess.run(base_cmd + ["-addext", san], check=True, capture_output=True)
    except FileNotFoundError:
        print("❌ `openssl` was not found. Install OpenSSL or run without --https.")
        sys.exit(1)
    except subprocess.CalledProcessError:
        # Older OpenSSL/LibreSSL without -addext support
        subprocess.run(base_cmd, check=True, capture_output=True)
    print(f"🔐 Created self-signed certificate in {CERT_DIR}")
    return cert_file, key_file


def start_tunnel(port: int):
    """
    Starts a free Cloudflare quick tunnel (https://xxxx.trycloudflare.com -> localhost:port).
    Works from ANY phone on ANY network (Wi-Fi or mobile data) with a trusted certificate.
    Returns (process, public_url) or (None, None).
    """
    import shutil
    import subprocess
    import threading
    import re as _re
    import time as _time

    exe = shutil.which("cloudflared")
    if not exe:
        print("❌ --tunnel needs the free 'cloudflared' tool, which is not installed.")
        print("   macOS:   brew install cloudflared")
        print("   Windows: winget install --id Cloudflare.cloudflared")
        print("   Then run again:  python3 server.py --tunnel")
        sys.exit(1)

    proc = subprocess.Popen(
        [exe, "tunnel", "--no-autoupdate", "--url", f"http://localhost:{port}"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1
    )
    found = {"url": None}
    ready = threading.Event()

    def reader():
        for line in proc.stdout:
            if not found["url"]:
                m = _re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
                if m:
                    found["url"] = m.group(0)
                    ready.set()
        ready.set()

    threading.Thread(target=reader, daemon=True).start()
    print("🌐 Opening a public HTTPS tunnel (takes ~5-10 seconds)...")
    ready.wait(timeout=45)
    if not found["url"]:
        print("❌ Could not open the tunnel (no internet, or Cloudflare is blocked on this network).")
        proc.terminate()
        return None, None
    _time.sleep(2)  # give Cloudflare a moment to route the new hostname
    return proc, found["url"]


def detect_public_ips() -> list:
    """This computer's public IPv4/IPv6 (as seen on the internet) – used for the same-Wi-Fi check."""
    import urllib.request
    found = []
    for url in ("https://1.1.1.1/cdn-cgi/trace", "https://[2606:4700:4700::1111]/cdn-cgi/trace"):
        try:
            with urllib.request.urlopen(url, timeout=4) as resp:
                for line in resp.read().decode().splitlines():
                    if line.startswith("ip="):
                        found.append(line[3:].strip())
        except Exception:
            pass
    return found


def run(host: str = "127.0.0.1", port: int = 8000, use_https: bool = False, use_tunnel: bool = False):
    server_address = (host, port)
    try:
        httpd = ThreadedHTTPServer(server_address, ClassroomRequestHandler)
    except OSError as e:
        print(f"❌ Could not start on port {port}: {e}")
        print(f"   Another server is probably still running. Close its terminal (or press Ctrl+C there),")
        print(f"   or start on another port:  python3 server.py --port {port + 1}")
        sys.exit(1)
    lan_ip = get_lan_ip()
    scheme = "https" if use_https else "http"

    if use_https:
        import ssl
        cert_file, key_file = ensure_self_signed_cert(lan_ip)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert_file, key_file)
        httpd.socket = context.wrap_socket(httpd.socket, server_side=True, do_handshake_on_connect=False)
        ClassroomRequestHandler.server_mode = "https-self-signed"

    if host in ("0.0.0.0", "") or host == lan_ip:
        ClassroomRequestHandler.lan_origin = f"{scheme}://{lan_ip}:{port}"

    # Addresses that represent "the classroom network" when the instructor uses localhost
    from app.handlers.api_router import ApiRouter as _Router
    _Router.server_network_ips = [lan_ip] + (detect_public_ips() if use_tunnel else [])

    tunnel_proc, tunnel_url = (None, None)
    if use_tunnel:
        import threading
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        tunnel_proc, tunnel_url = start_tunnel(port)
        if not tunnel_url:
            httpd.shutdown()
            sys.exit(1)
        ClassroomRequestHandler.lan_origin = tunnel_url
        ClassroomRequestHandler.server_mode = "tunnel"
        print("=" * 70)
        print("🎓 CS302 Interactive Classroom Suite — PUBLIC LINK READY")
        print("")
        print("   Open these addresses on ANY device (laptop, phones, Wi-Fi or mobile data):")
        print(f"   👨‍🏫 Instructor:  {tunnel_url}/?role=instructor")
        print(f"   👨‍🎓 Student:     {tunnel_url}/?role=student")
        print("")
        print("   Keep this terminal open. Press Ctrl+C to stop.")
        print("   (The link changes every time you restart.)")
        print("=" * 70)
        try:
            tunnel_proc.wait()
        except KeyboardInterrupt:
            pass
        print("\n🛑 Shutting down...")
        tunnel_proc.terminate()
        httpd.shutdown()
        httpd.server_close()
        return

    print("=" * 70)
    print("🎓 CS302 Interactive Classroom Suite (Ex2 OOP Assignment)")
    print(f"🚀 Server running at: {scheme}://localhost:{port}/")
    if host in ("0.0.0.0", "") or host == lan_ip:
        print(f"📱 From a phone on the same Wi-Fi: {scheme}://{lan_ip}:{port}/?role=student")
        if not use_https:
            print("   ⚠️  Phones block camera/GPS over plain http — restart with --https for phone testing.")
    print(f"   👨‍🏫 Instructor: {scheme}://localhost:{port}/?role=instructor")
    print(f"   👨‍🎓 Student:    {scheme}://localhost:{port}/?role=student")
    print("   API endpoints available at: /api/*")
    print("   Press Ctrl+C to stop the server.")
    print("=" * 70)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Shutting down gracefully...")
        httpd.server_close()
        print("Done.")


def parse_args(argv):
    import argparse
    parser = argparse.ArgumentParser(description="CS302 Classroom Suite server")
    parser.add_argument("port_positional", nargs="?", type=int, help=argparse.SUPPRESS)
    parser.add_argument("--port", type=int, default=None, help="Port (default 8000, or 8443 with --https)")
    parser.add_argument("--host", default="127.0.0.1",
                        help="Interface to bind. Use 0.0.0.0 so phones on your Wi-Fi can connect.")
    parser.add_argument("--https", action="store_true",
                        help="Serve over HTTPS with an auto-generated self-signed certificate (needed for phone camera/GPS).")
    parser.add_argument("--tunnel", action="store_true",
                        help="Easiest phone testing: public https link via Cloudflare (needs 'cloudflared').")
    args = parser.parse_args(argv)
    if args.tunnel:
        args.https = False  # the tunnel provides HTTPS itself
    port = args.port or args.port_positional or (8443 if args.https else 8000)
    return args.host, port, args.https, args.tunnel


if __name__ == "__main__":
    host, port, use_https, use_tunnel = parse_args(sys.argv[1:])
    run(host=host, port=port, use_https=use_https, use_tunnel=use_tunnel)
