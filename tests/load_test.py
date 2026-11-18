"""
Load test: simulates a full lecture hall checking in at the same moment.

    python3 tests/load_test.py                 # 150 students
    python3 tests/load_test.py --students 300

It starts its own server on a free local port (your running server is not touched), then
every virtual student does what a real phone does:
    1. GET  /api/attendance              (load the name list once)
    2. POST /api/students/register       (only for students beyond the demo roster)
    3. POST /api/attendance/verify       (QR code + GPS inside the 500 m radius)
    4. GET  /api/attendance/me           (status poll)
while a virtual instructor polls /api/attendance?since=<version> every 0.5 s.
"""
import argparse
import json
import os
import statistics
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server as server_module  # noqa: E402
from app.models.session import ARIEL_UNIVERSITY_LAT, ARIEL_UNIVERSITY_LNG  # noqa: E402


def call(base, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = resp.read()
            status = resp.status
    except urllib.error.HTTPError as e:
        payload, status = e.read(), e.code
    return status, json.loads(payload or b"{}"), (time.perf_counter() - t0) * 1000, len(payload or b"")


def percentile(values, p):
    values = sorted(values)
    k = max(0, min(len(values) - 1, int(round(p / 100 * (len(values) - 1)))))
    return values[k]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--students", type=int, default=150)
    args = parser.parse_args()

    server_module.ClassroomRequestHandler.log_message = lambda *a, **k: None  # keep output readable
    httpd = server_module.ThreadedHTTPServer(("127.0.0.1", 0), server_module.ClassroomRequestHandler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"

    call(base, "POST", "/api/session/start", {})
    _, roster, _, roster_bytes = call(base, "GET", "/api/attendance")
    known_ids = [s["student_id"] for s in roster["students"]]
    token = call(base, "GET", "/api/session/qr")[1]["token"]

    n = args.students
    ids = [known_ids[i] if i < len(known_ids) else f"9{i:08d}" for i in range(n)]
    latencies = {"roster": [], "register": [], "verify": [], "status": [], "instructor_poll": []}
    lat_lock = threading.Lock()
    failures = []
    start_gate = threading.Barrier(n + 1)
    stop_polling = threading.Event()
    poll_bytes = []

    def record(kind, ms):
        with lat_lock:
            latencies[kind].append(ms)

    def student(i):
        sid = ids[i]
        start_gate.wait()
        st, _, ms, _ = call(base, "GET", "/api/attendance")
        record("roster", ms)
        if sid not in known_ids:
            st, body, ms, _ = call(base, "POST", "/api/students/register",
                                   {"student_id": sid, "name": f"Test Student {i}"})
            record("register", ms)
            if st != 200:
                failures.append((sid, "register", body))
        lat = ARIEL_UNIVERSITY_LAT + (i % 40) * 0.00005  # spread 0-200 m north of campus centre
        st, body, ms, _ = call(base, "POST", "/api/attendance/verify",
                               {"student_id": sid, "qr_token": token, "lat": lat, "lng": ARIEL_UNIVERSITY_LNG})
        record("verify", ms)
        if not body.get("success"):
            failures.append((sid, "verify", body.get("reason"), body.get("message")))
        st, body, ms, _ = call(base, "GET", f"/api/attendance/me?student_id={sid}")
        record("status", ms)

    def instructor():
        version = None
        while not stop_polling.is_set():
            q = f"?since={version}" if version is not None else ""
            _, body, ms, size = call(base, "GET", "/api/attendance" + q)
            record("instructor_poll", ms)
            poll_bytes.append(size)
            version = body.get("version", version)
            time.sleep(0.5)

    poller = threading.Thread(target=instructor, daemon=True)
    poller.start()

    print(f"🚀 {n} virtual students checking in at the same moment against {base} ...")
    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=n) as pool:
        futures = [pool.submit(student, i) for i in range(n)]
        start_gate.wait()
        for f in futures:
            f.result()
    elapsed = time.perf_counter() - t0
    time.sleep(0.6)
    stop_polling.set()

    _, final, _, _ = call(base, "GET", "/api/attendance")
    _, unchanged, _, unchanged_bytes = call(base, "GET", f"/api/attendance?since={final['version']}")
    httpd.shutdown()

    total_requests = sum(len(v) for v in latencies.values())
    print("=" * 66)
    print(f"Students: {n}   Requests: {total_requests}   Wall time: {elapsed:.2f}s   "
          f"Throughput: {total_requests / elapsed:.0f} req/s")
    print(f"{'endpoint':<18}{'count':>7}{'p50 ms':>10}{'p95 ms':>10}{'max ms':>10}")
    for kind, vals in latencies.items():
        if vals:
            print(f"{kind:<18}{len(vals):>7}{statistics.median(vals):>10.1f}"
                  f"{percentile(vals, 95):>10.1f}{max(vals):>10.1f}")
    print(f"Present at the end: {final['present_count']} / {final['total_enrolled']}")
    print(f"Full roster payload: {roster_bytes / 1024:.1f} KB  |  'unchanged' poll payload: {unchanged_bytes} bytes")
    print(f"Failures: {len(failures)}")
    for f in failures[:10]:
        print("   ", f)
    print("=" * 66)
    ok = not failures and final["present_count"] >= n and unchanged.get("unchanged")
    print("✅ PASS" if ok else "❌ FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
