#!/usr/bin/env python3
"""
Arciin API example — 03 List folders

What this does:
  Lists all folders inside one library (name, id, path, asset count).
  Change LIBRARY_SLUG below to match your library.

Requirements:
  pip install requests

Auth:
  API key with libraries:read (or admin), or email session.

Configure:
  scripts/examples/lib/arciin_client.py → API_BASE, API_KEY
  LIBRARY_SLUG below (default: images)

Run:
  python scripts/examples/api/03_list_folders.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

from arciin_client import api_request, find_library_id, open_session, require_json

LIBRARY_SLUG = "images"


def main() -> None:
    session = open_session()
    library_id = find_library_id(session, LIBRARY_SLUG)
    if not library_id:
        raise SystemExit(f'Library "{LIBRARY_SLUG}" not found. Run 02_list_libraries.py first.')

    folders = require_json(
        api_request("GET", f"/libraries/{library_id}/folders", session=session),
        "GET /libraries/.../folders",
    )
    print(f"Folders in {LIBRARY_SLUG} ({library_id}):\n")
    if not folders:
        print("  (none)")
        return
    for folder in folders:
        print(
            f"  {folder.get('name', '?'):20}  id={folder.get('id')}  "
            f"path={folder.get('pathCache')}  assets={folder.get('assetCount', 0)}"
        )


if __name__ == "__main__":
    main()
