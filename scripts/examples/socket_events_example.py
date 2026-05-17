#!/usr/bin/env python3
"""
Example: listen to Arciin Socket.IO events from Python.

Install:
  pip install requests "python-socketio[client]" websocket-client

Keep the dashboard open (Realtime live) to see matching alerts in Notifications.
"""

from __future__ import annotations

import argparse
import time

import requests
import socketio

from arciin_example_client import (
    API_BASE,
    AUTH_MODE,
    EMAIL,
    PASSWORD,
    SOCKET_URL,
    clean_api_key,
    validate_auth_config,
    API_KEY,
)

EVENT_TYPES = [
    "upload.started",
    "upload.progress",
    "upload.completed",
    "upload.failed",
    "asset.created",
    "activity.created",
    "job.completed",
    "job.failed",
]


def login_session() -> requests.Session:
    password = PASSWORD.strip() or __import__("getpass").getpass("Arciin password: ")
    http = requests.Session()
    res = http.post(
        f"{API_BASE}/auth/login",
        json={"email": EMAIL.strip(), "password": password},
        timeout=30,
    )
    if res.status_code != 200:
        raise SystemExit(f"Login failed ({res.status_code}): {res.text}")
    print("Logged in (session cookie)")
    return http


def main() -> None:
    parser = argparse.ArgumentParser(description="Listen to Arciin Socket.IO events")
    parser.add_argument(
        "--trigger",
        action="store_true",
        help="Create/delete a test API key to emit activity.created (session auth only)",
    )
    args = parser.parse_args()

    validate_auth_config()
    connect_headers: dict[str, str] = {}
    http: requests.Session | None = None

    if AUTH_MODE == "api_key":
        key = clean_api_key(API_KEY)
        connect_headers["Authorization"] = f"Bearer {key}"
        print("Using API key (events:subscribe scope required)")
    else:
        http = login_session()
        cookie_header = "; ".join(f"{k}={v}" for k, v in http.cookies.get_dict().items())
        if not cookie_header:
            raise SystemExit("No session cookie after login.")
        connect_headers["Cookie"] = cookie_header

    sio = socketio.Client(reconnection=True, reconnection_attempts=3)

    @sio.event
    def connect() -> None:
        print(f"Connected to {SOCKET_URL} (sid={sio.sid})")
        if args.trigger and http is not None:
            name = f"socket-example-{int(time.time())}"
            res = http.post(
                f"{API_BASE}/api-keys",
                json={"name": name, "scopes": ["events:subscribe", "libraries:read"]},
                timeout=30,
            )
            if res.status_code in (200, 201):
                key_id = res.json().get("data", {}).get("apiKey", {}).get("id")
                print(f"Triggered activity.created (API key “{name}”)")
                if key_id:
                    http.delete(f"{API_BASE}/api-keys/{key_id}", timeout=30)
            else:
                print(f"Could not trigger test event ({res.status_code})")

    @sio.event
    def connect_error(data) -> None:
        print("Connection error:", data)

    @sio.event
    def disconnect() -> None:
        print("Disconnected")

    for event_name in EVENT_TYPES:

        def on_event(data, _name=event_name) -> None:
            print(f"[{_name}]", data)

        sio.on(event_name)(on_event)

    print(f"Connecting to {SOCKET_URL} …")
    print("Compare with http://localhost:3000/events — Ctrl+C to stop.\n")

    try:
        sio.connect(
            SOCKET_URL,
            headers=connect_headers,
            transports=["websocket", "polling"],
            wait_timeout=15,
        )
        sio.wait()
    except socketio.exceptions.ConnectionError as exc:
        print("\nCould not connect. Check API + Redis and auth.")
        raise SystemExit(str(exc)) from exc
    except KeyboardInterrupt:
        print("\nStopping…")
        sio.disconnect()


if __name__ == "__main__":
    main()
