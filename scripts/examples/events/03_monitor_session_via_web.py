#!/usr/bin/env python3
"""
Arciin — Socket.IO monitor #3: session via web origin (like dashboard Events page)

Best for: matching the in-app Events monitor at /events — connects through the
Next.js host (port 3000 or 3002) with the same-origin session cookie.

  pip install requests "python-socketio[client]" websocket-client
  python 03_monitor_session_via_web.py

Important: login must go through WEB_ORIGIN (/api/auth/login), not :4000,
so the cookie is valid for the web host Socket.IO proxy.
"""

import getpass
import os
import sys
from datetime import datetime, timezone

import requests
import socketio

# ═══ CONFIG — edit for your instance ═══════════════════════════════════════
WEB_ORIGIN = os.environ.get("ARCIIN_WEB_ORIGIN", "http://192.168.4.53:3002").rstrip("/")  # Arciin web UI
API_BASE = f"{WEB_ORIGIN}/api"  # proxied REST through Next.js
EMAIL = "you@example.com"
PASSWORD = ""
# ═══════════════════════════════════════════════════════════════════════════

EVENT_TYPES = [
    "upload.started", "upload.completed", "upload.failed",
    "asset.created", "asset.moved", "asset.deleted", "activity.created",
    "instance.urls.updated", "job.completed", "job.failed",
]


def ts() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S")


def login_via_web() -> requests.Session:
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
    user = me.json().get("data", {}).get("user", {})
    print(f"[{ts()}] Logged in via {WEB_ORIGIN} as {user.get('name', '?')}")
    return http


def main() -> None:
    http = login_via_web()
    cookies = "; ".join(f"{k}={v}" for k, v in http.cookies.get_dict().items())
    if not cookies:
        sys.exit("No session cookie — login must use WEB_ORIGIN.")

    sio = socketio.Client(reconnection=True)

    @sio.event
    def connect() -> None:
        print(f"[{ts()}] Connected · sid={sio.sid}")
        print(f"  Transport: Socket.IO via {WEB_ORIGIN}/socket.io (session cookie)")
        print("  This mirrors the dashboard Events page. Open /events side-by-side.\n")

    @sio.event
    def connect_error(data) -> None:
        print(f"[{ts()}] connect_error: {data}")
        print("  Tip: confirm WEB_ORIGIN matches the URL in your browser.")

    @sio.event
    def disconnect() -> None:
        print(f"[{ts()}] Disconnected")

    for name in EVENT_TYPES:

        def handler(data, _name=name) -> None:
            print(f"[{ts()}] {_name}", end="")
            if isinstance(data, dict):
                if data.get("message"):
                    print(f" — {data['message']}", end="")
                if data.get("data", {}).get("fileName"):
                    print(f" · {data['data']['fileName']}", end="")
            print()

        sio.on(name)(handler)

    print(f"[{ts()}] Connecting → {WEB_ORIGIN} (path /socket.io)")
    try:
        sio.connect(
            WEB_ORIGIN,
            socketio_path="/socket.io",
            headers={"Cookie": cookies},
            transports=["polling", "websocket"],
            wait_timeout=25,
        )
        sio.wait()
    except socketio.exceptions.ConnectionError as exc:
        sys.exit(f"Socket connect failed: {exc}\nUse WEB_ORIGIN = the URL in your browser.")
    except KeyboardInterrupt:
        print(f"\n[{ts()}] Stopping…")
        sio.disconnect()


if __name__ == "__main__":
    main()
