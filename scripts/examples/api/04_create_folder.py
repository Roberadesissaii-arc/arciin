#!/usr/bin/env python3
"""
Arciin API example — 04 Create folder

What this does:
  Creates a new folder inside a library. Returns folder id and path so you
  can upload into it with targetFolderId.

Requirements:
  pip install requests

Auth:
  API key with libraries:write (or admin), or email session.

Configure:
  scripts/examples/lib/arciin_client.py → API_BASE, API_KEY
  LIBRARY_SLUG and FOLDER_NAME below

Run:
  python scripts/examples/api/04_create_folder.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

from arciin_client import api_request, find_library_id, open_session, require_json

LIBRARY_SLUG = "images"
FOLDER_NAME = "Python Example Folder"


def main() -> None:
    session = open_session()
    library_id = find_library_id(session, LIBRARY_SLUG)
    if not library_id:
        raise SystemExit(f'Library "{LIBRARY_SLUG}" not found.')

    folder = require_json(
        api_request(
            "POST",
            f"/libraries/{library_id}/folders",
            session=session,
            json_body={"name": FOLDER_NAME},
        ),
        "POST /libraries/.../folders",
    )
    print("Created folder:")
    print(f"  name: {folder.get('name')}")
    print(f"  id:   {folder.get('id')}")
    print(f"  path: {folder.get('pathCache')}")
    print(f"\nOpen in browser: /{LIBRARY_SLUG}")


if __name__ == "__main__":
    main()
