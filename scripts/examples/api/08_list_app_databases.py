#!/usr/bin/env python3
"""
Arciin API example — 08 List app data databases

What this does:
  Lists logical App data databases (JSON document stores in PostgreSQL).
  These are separate from media libraries — used for automation and app records.

Requirements:
  pip install requests

Auth:
  API key with appdata:databases:read (or admin), or email session.

Configure:
  scripts/examples/lib/arciin_client.py → API_BASE, API_KEY

Run:
  python scripts/examples/api/08_list_app_databases.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

from arciin_client import api_request, open_session, require_json


def main() -> None:
    session = open_session()
    r = api_request("GET", "/app-databases", session=session)
    if r.status_code == 403:
        raise SystemExit(
            "Forbidden — add appdata:databases:read (or admin) to your API key.\n"
            f"Server: {r.text.strip()}"
        )
    databases = require_json(r, "GET /app-databases")
    print(f"App data databases: {len(databases)}\n")
    if not databases:
        print("  (none — create one in the UI under Database → App data)")
        return
    for db in databases:
        print(
            f"  {db.get('name', '?'):20}  slug={db.get('slug', '?'):15}  "
            f"id={db.get('id')}  tables={db.get('tableCount', 0)}"
        )
    print("\nUI: /database/app-data")


if __name__ == "__main__":
    main()
