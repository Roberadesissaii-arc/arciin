#!/usr/bin/env python3
"""
Arciin — Socket.IO monitor #1: API key (direct API :4000)

Best for: another computer on your LAN. Uses Bearer arc_… + events:subscribe
auth (same as automation scripts and the Events docs).

  pip install requests "python-socketio[client]" websocket-client
  python 01_monitor_api_key.py

Environment (optional):
  ARCIIN_API_ORIGIN=http://192.168.4.53:4000
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
import socketio

# ═══ CONFIG — edit for your instance ═══════════════════════════════════════
# On server: hostname -I | awk '{print $1}' — install.sh opens :4000 in UFW
API_ORIGIN = os.environ.get("ARCIIN_API_ORIGIN", "http://192.168.4.53:4000").rstrip("/")
API_BASE = f"{API_ORIGIN}/api"
API_KEY = "arc_paste_full_key_here"  # Developer → API keys (events:subscribe)
# ═══════════════════════════════════════════════════════════════════════════

EVENT_TYPES = [
    "upload.started", "upload.progress", "upload.completed", "upload.failed",
    "asset.created", "asset.updated", "asset.moved", "asset.deleted", "asset.classified",
    "thumbnail.created", "media.metadata.extracted", "media.processing.completed",
    "media.processing.failed", "library.created", "library.updated", "library.scanned",
    "job.created", "job.progress", "job.completed", "job.failed", "activity.created",
    "instance.urls.updated", "plex.connected", "plex.sync.started",
    "plex.sync.completed", "plex.sync.failed",
]


def ts() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S")


def unreachable_help(origin: str, exc: Exception) -> str:
    parsed = urlparse(origin)
    host = parsed.hostname or "?"
    return "\n".join(
        [
            f"Arciin unreachable: {exc}",
            "",
            "Network/firewall check:",
            f"  1. On Arciin server: hostname -I",
            f"  2. From this PC: ping {host}",
            f"  3. curl {origin}/api/health",
            "",
            "install.sh opens API port in UFW. If blocked, on the server run:",
            f"  sudo ufw allow 4000/tcp comment 'Arciin API'",
            "",
            f"Configured API_ORIGIN: {origin}",
        ]
    )


def main() -> None:
    key = API_KEY.strip().strip('"').strip("'")
    if not key.startswith("arc_") or key == "arc_paste_full_key_here":
        sys.exit('Set API_KEY to your full arc_… secret (scope: events:subscribe).')

    print(f"[{ts()}] Health check → {API_ORIGIN}/api/health")
    try:
        health = requests.get(f"{API_ORIGIN}/api/health", timeout=8).json().get("data", {})
        print(f"  API {health.get('status', '?')} · worker {health.get('worker', '?')}")
    except requests.RequestException as exc:
        sys.exit(unreachable_help(API_ORIGIN, exc))

    me = requests.get(
        f"{API_BASE}/auth/me",
        headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
        timeout=15,
    )
    if me.status_code != 200:
        sys.exit(f"API key rejected ({me.status_code}): {me.text.strip()}")
    user = me.json().get("data", {}).get("user", {})
    print(f"[{ts()}] API key OK — {user.get('name', '?')} ({user.get('email', '?')})")

    sio = socketio.Client(reconnection=True, reconnection_attempts=5)

    @sio.event
    def connect() -> None:
        print(f"[{ts()}] Connected · sid={sio.sid} · listening for {len(EVENT_TYPES)} event types")
        print("  Trigger activity: upload a file, sign in, or change security settings.")
        print("  Dashboard compare: open /events in Arciin.\n")

    @sio.event
    def connect_error(data) -> None:
        print(f"[{ts()}] connect_error: {data}")

    @sio.event
    def disconnect() -> None:
        print(f"[{ts()}] Disconnected")

    def on_event(data, _name: str) -> None:
        msg = data.get("message") if isinstance(data, dict) else None
        extra = ""
        if isinstance(data, dict) and data.get("progress") is not None:
            extra = f" · {data['progress']}%"
        print(f"[{ts()}] {_name}{extra}")
        if msg:
            print(f"           {msg}")

    for name in EVENT_TYPES:
        sio.on(name)(lambda data, n=name: on_event(data, n))

    print(f"[{ts()}] Connecting → {API_ORIGIN} (Socket.IO /socket.io)")
    try:
        sio.connect(
            API_ORIGIN,
            headers={"Authorization": f"Bearer {key}"},
            auth={"token": key},
            transports=["websocket", "polling"],
            wait_timeout=20,
        )
        sio.wait()
    except socketio.exceptions.ConnectionError as exc:
        sys.exit(f"Socket connect failed: {exc}\n\n{unreachable_help(API_ORIGIN, exc)}")
    except KeyboardInterrupt:
        print(f"\n[{ts()}] Stopping…")
        sio.disconnect()


if __name__ == "__main__":
    main()
