#!/usr/bin/env python3
"""
Arciin — Socket.IO monitor #5: full JSON log (all 26 event types)

Best for: debugging on a second machine — prints every payload as formatted JSON.
Use with `tee` to save a log file.

  pip install requests "python-socketio[client]" websocket-client
  python 05_monitor_all_events_json.py | tee arciin-events.log

"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

import requests
import socketio

# ═══ CONFIG ════════════════════════════════════════════════════════════════
API_ORIGIN = os.environ.get("ARCIIN_API_ORIGIN", "http://192.168.4.53:4000").rstrip("/")
API_BASE = f"{API_ORIGIN}/api"
API_KEY = "arc_paste_full_key_here"
# ═══════════════════════════════════════════════════════════════════════════

ALL_EVENT_TYPES = [
    "upload.started", "upload.progress", "upload.completed", "upload.failed",
    "asset.created", "asset.updated", "asset.moved", "asset.deleted", "asset.classified",
    "thumbnail.created", "media.metadata.extracted", "media.processing.completed",
    "media.processing.failed", "library.created", "library.updated", "library.scanned",
    "job.created", "job.progress", "job.completed", "job.failed", "activity.created",
    "instance.urls.updated", "plex.connected", "plex.sync.started",
    "plex.sync.completed", "plex.sync.failed",
]


def ts() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def main() -> None:
    key = API_KEY.strip().strip('"').strip("'")
    if not key.startswith("arc_") or key == "arc_paste_full_key_here":
        sys.exit("Set API_KEY (events:subscribe scope).")

    health = requests.get(f"{API_ORIGIN}/api/health", timeout=8)
    health.raise_for_status()
    me = requests.get(
        f"{API_BASE}/auth/me",
        headers={"Authorization": f"Bearer {key}"},
        timeout=15,
    )
    if me.status_code != 200:
        sys.exit(f"API key rejected ({me.status_code})")

    count = 0
    sio = socketio.Client(reconnection=True)

    @sio.event
    def connect() -> None:
        print(json.dumps({
            "_meta": "connected",
            "at": ts(),
            "socket_id": sio.sid,
            "url": API_ORIGIN,
            "event_types": len(ALL_EVENT_TYPES),
        }, indent=2))
        sys.stdout.flush()

    @sio.event
    def connect_error(data) -> None:
        print(json.dumps({"_meta": "connect_error", "at": ts(), "detail": str(data)}, indent=2))

    @sio.event
    def disconnect() -> None:
        print(json.dumps({"_meta": "disconnected", "at": ts(), "received": count}, indent=2))

    for name in ALL_EVENT_TYPES:

        def handler(data, _name=name) -> None:
            nonlocal count
            count += 1
            record = {
                "_rx_at": ts(),
                "_event": _name,
                "payload": data,
            }
            print(json.dumps(record, indent=2, default=str))
            print("---")
            sys.stdout.flush()

        sio.on(name)(handler)

    try:
        sio.connect(
            API_ORIGIN,
            headers={"Authorization": f"Bearer {key}"},
            auth={"token": key},
            transports=["websocket", "polling"],
            wait_timeout=20,
        )
        sio.wait()
    except KeyboardInterrupt:
        print(json.dumps({"_meta": "stopped", "at": ts(), "received": count}, indent=2))
        sio.disconnect()


if __name__ == "__main__":
    main()
