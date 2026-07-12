#!/usr/bin/env python3
"""
Arciin API example — 05 List assets

What this does:
  Lists recent files (assets) on the instance. Optionally filter to one
  library by setting LIBRARY_SLUG (leave empty for all libraries).

Requirements:
  pip install requests

Auth:
  API key with assets:read or libraries:read (or admin), or email session.

Configure:
  scripts/examples/lib/arciin_client.py → API_BASE, API_KEY
  LIBRARY_SLUG below — "" = all, or "images", "videos", …

Run:
  python scripts/examples/api/05_list_assets.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

from arciin_client import api_request, find_library_id, open_session

LIBRARY_SLUG = ""  # empty = all libraries


def main() -> None:
    session = open_session()
    params: dict[str, str] = {}
    if LIBRARY_SLUG.strip():
        library_id = find_library_id(session, LIBRARY_SLUG.strip())
        if not library_id:
            raise SystemExit(f'Library "{LIBRARY_SLUG}" not found.')
        params["libraryId"] = library_id
        print(f"Assets in library {LIBRARY_SLUG}:\n")
    else:
        print("Recent assets (all libraries):\n")

    r = api_request("GET", "/assets", session=session, params=params)
    if r.status_code >= 400:
        raise SystemExit(f"GET /assets failed ({r.status_code}): {r.text}")

    assets = r.json().get("data", [])
    if not assets:
        print("  (none)")
        return
    for asset in assets:
        name = (asset.get("originalFilename") or "?")[:40]
        print(
            f"  {name:40}  type={asset.get('mediaType', '?'):8}  id={asset.get('id')}"
        )


if __name__ == "__main__":
    main()
