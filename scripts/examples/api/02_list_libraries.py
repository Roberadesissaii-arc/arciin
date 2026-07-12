#!/usr/bin/env python3
"""
Arciin API example — 02 List libraries

What this does:
  Fetches all libraries (Videos, Images, Music, Documents, Inbox) with their
  ids, slugs, and asset counts. Use the id as targetLibraryId when uploading.

Requirements:
  pip install requests

Auth:
  API key with libraries:read (or admin), or email session.

Configure:
  scripts/examples/lib/arciin_client.py → API_BASE, API_KEY

Run:
  python scripts/examples/api/02_list_libraries.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

from arciin_client import api_request, open_session, require_json


def main() -> None:
    session = open_session()
    libraries = require_json(api_request("GET", "/libraries", session=session), "GET /libraries")
    print(f"Found {len(libraries)} libraries:\n")
    for lib in libraries:
        print(
            f"  {lib.get('name', '?'):12}  slug={lib.get('slug', '?'):10}  "
            f"id={lib.get('id')}  assets={lib.get('assetCount', 0)}"
        )
    print("\nUse id as targetLibraryId on POST /uploads")


if __name__ == "__main__":
    main()
