#!/usr/bin/env python3
"""
Arciin — Socket.IO monitor #4: upload pipeline only

Best for: verifying upload → asset → activity events on a remote machine while
you drag-and-drop files in the dashboard.

  pip install requests "python-socketio[client]" websocket-client
  python 04_monitor_upload_pipeline.py

Watches: upload.* · asset.created · asset.classified · thumbnail.created · activity.created
"""

from __future__ import annotations

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

WATCH = [
    "upload.started",
    "upload.progress",
    "upload.completed",
    "upload.failed",
    "asset.created",
    "asset.classified",
    "thumbnail.created",
    "activity.created",
]


def ts() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S")


def fmt_upload(data: dict) -> str:
    parts: list[str] = []
    d = data.get("data") or {}
    if d.get("fileName"):
        parts.append(str(d["fileName"]))
    if d.get("destination"):
        parts.append(f"→ {d['destination']}")
    if data.get("progress") is not None:
        parts.append(f"{data['progress']}%")
    if data.get("message"):
        parts.append(str(data["message"]))
    return " · ".join(parts) if parts else "(no detail)"


def main() -> None:
    key = API_KEY.strip().strip('"').strip("'")
    if not key.startswith("arc_") or key == "arc_paste_full_key_here":
        sys.exit("Set API_KEY (events:subscribe scope).")

    r = requests.get(
        f"{API_BASE}/auth/me",
        headers={"Authorization": f"Bearer {key}"},
        timeout=15,
    )
    if r.status_code != 200:
        sys.exit(f"API key invalid ({r.status_code})")

    sio = socketio.Client(reconnection=True)
    seen: list[str] = []

    @sio.event
    def connect() -> None:
        print(f"[{ts()}] Upload pipeline monitor connected (sid={sio.sid})")
        print("  Drop a file anywhere in Arciin — you should see a chain like:")
        print("  upload.started → upload.completed → asset.created → activity.created\n")

    @sio.event
    def connect_error(data) -> None:
        print(f"[{ts()}] connect_error: {data}")

    for name in WATCH:

        def handler(data, _name=name) -> None:
            if not isinstance(data, dict):
                print(f"[{ts()}] {_name}: {data}")
                return
            detail = fmt_upload(data) if _name.startswith("upload") or _name.startswith("asset") else (
                data.get("message") or data.get("data", {}).get("title") or ""
            )
            print(f"[{ts()}] {_name}")
            if detail:
                print(f"           {detail}")
            seen.append(_name)
            if _name == "activity.created" and "upload.completed" in seen:
                print(f"[{ts()}] ✓ Upload pipeline events received end-to-end")

        sio.on(name)(handler)

    print(f"[{ts()}] Connecting → {API_ORIGIN}")
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
        print(f"\n[{ts()}] Events seen: {', '.join(seen) or '(none)'}")
        sio.disconnect()


if __name__ == "__main__":
    main()
