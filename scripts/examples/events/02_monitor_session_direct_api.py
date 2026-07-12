#!/usr/bin/env python3
"""
Arciin — Socket.IO monitor #2: session cookie (direct API :4000)

Best for: testing cookie auth the same way the API sees it (no Next.js proxy).

  pip install requests "python-socketio[client]" websocket-client
  python 02_monitor_session_direct_api.py

Login hits the API directly; the session cookie is sent on the Socket.IO handshake.
"""

import os
import getpass
import sys
from datetime import datetime, timezone

import requests
import socketio

# ═══ CONFIG — edit for your instance ═══════════════════════════════════════
API_ORIGIN = os.environ.get("ARCIIN_API_ORIGIN", "http://192.168.4.53:4000").rstrip("/")
API_BASE = f"{API_ORIGIN}/api"
EMAIL = "you@example.com"
PASSWORD = ""  # leave empty to prompt securely
# ═══════════════════════════════════════════════════════════════════════════

EVENT_TYPES = [
    "upload.started", "upload.progress", "upload.completed", "upload.failed",
    "asset.created", "asset.updated", "asset.moved", "asset.deleted", "asset.classified",
    "thumbnail.created", "activity.created", "job.created", "job.progress",
    "job.completed", "job.failed", "instance.urls.updated",
]


def ts() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S")


def login() -> requests.Session:
    email = EMAIL.strip()
    if not email or email == "you@example.com":
        sys.exit("Set EMAIL to your Arciin login.")
    password = PASSWORD.strip() or getpass.getpass("Arciin password: ")
    http = requests.Session()
    res = http.post(
        f"{API_BASE}/auth/login",
        json={"email": email, "password": password},
        timeout=30,
    )
    if res.status_code != 200:
        sys.exit(f"Login failed ({res.status_code}): {res.text.strip()}")
    me = http.get(f"{API_BASE}/auth/me", timeout=15)
    me.raise_for_status()
    name = me.json().get("data", {}).get("user", {}).get("name", "?")
    print(f"[{ts()}] Logged in as {name}")
    return http


def main() -> None:
    http = login()
    cookies = "; ".join(f"{k}={v}" for k, v in http.cookies.get_dict().items())
    if not cookies:
        sys.exit("No session cookie after login.")

    sio = socketio.Client(reconnection=True)

    @sio.event
    def connect() -> None:
        print(f"[{ts()}] Connected (session cookie) · sid={sio.sid}")
        print("  Auth mode: Session cookie → direct API")
        print("  Compare with dashboard /events while you upload or browse.\n")

    @sio.event
    def connect_error(data) -> None:
        print(f"[{ts()}] connect_error: {data}")

    @sio.event
    def disconnect() -> None:
        print(f"[{ts()}] Disconnected")

    for name in EVENT_TYPES:

        def handler(data, _name=name) -> None:
            line = f"[{ts()}] {_name}"
            if isinstance(data, dict) and data.get("message"):
                line += f" — {data['message']}"
            print(line)

        sio.on(name)(handler)

    print(f"[{ts()}] Connecting → {API_ORIGIN}")
    try:
        sio.connect(
            API_ORIGIN,
            headers={"Cookie": cookies},
            transports=["websocket", "polling"],
            wait_timeout=20,
        )
        sio.wait()
    except socketio.exceptions.ConnectionError as exc:
        sys.exit(f"Socket connect failed: {exc}")
    except KeyboardInterrupt:
        print(f"\n[{ts()}] Stopping…")
        sio.disconnect()


if __name__ == "__main__":
    main()
