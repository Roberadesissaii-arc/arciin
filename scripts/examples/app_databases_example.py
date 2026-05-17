#!/usr/bin/env python3
"""Example: list Arciin App data databases (logical JSON stores — not media files)."""

from arciin_example_client import api_request, open_session, require_json


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
        print("  (none — create one at http://localhost:3000/database/app-data)")
        return
    for db in databases:
        print(
            f"  {db.get('name'):20}  slug={db.get('slug'):15}  "
            f"id={db.get('id')}  tables={db.get('tableCount', 0)}"
        )
    print("\nUI: http://localhost:3000/database/app-data")


if __name__ == "__main__":
    main()
