#!/usr/bin/env python3
"""
Arciin API example — 01 Health check

What this does:
  Calls GET /api/health and prints service status (API, database, Redis,
  worker, storage). Use this first to confirm the API is reachable.

Requirements:
  pip install requests

Auth:
  None — health is public.

Configure:
  scripts/examples/lib/arciin_client.py → API_BASE (default http://127.0.0.1:4000/api)

Run:
  python scripts/examples/api/01_health_check.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

from arciin_client import API_ORIGIN, check_health


def main() -> None:
    print(f"GET {API_ORIGIN}/api/health\n")
    data = check_health()
    for key in ("api", "database", "redis", "worker", "storage", "realtime", "version"):
        if key in data:
            print(f"  {key:10}  {data[key]}")


if __name__ == "__main__":
    main()
