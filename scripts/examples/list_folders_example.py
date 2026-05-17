#!/usr/bin/env python3
"""Example: list folders in a library."""

from arciin_example_client import api_request, find_library_id, open_session, require_json

LIBRARY_SLUG = "images"


def main() -> None:
    session = open_session()
    library_id = find_library_id(session, LIBRARY_SLUG)
    if not library_id:
        raise SystemExit(f'Library "{LIBRARY_SLUG}" not found.')

    r = api_request("GET", f"/libraries/{library_id}/folders", session=session)
    folders = require_json(r, "GET /libraries/.../folders")
    print(f"Folders in {LIBRARY_SLUG} ({library_id}):\n")
    if not folders:
        print("  (none)")
        return
    for f in folders:
        print(
            f"  {f.get('name'):20}  id={f.get('id')}  "
            f"path={f.get('pathCache')}  assets={f.get('assetCount', 0)}"
        )


if __name__ == "__main__":
    main()
