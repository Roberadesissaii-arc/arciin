#!/usr/bin/env python3
"""Example: create a folder inside a library."""

from arciin_example_client import api_request, find_library_id, open_session, require_json

LIBRARY_SLUG = "images"
FOLDER_NAME = "Python Example Folder"


def main() -> None:
    session = open_session()
    library_id = find_library_id(session, LIBRARY_SLUG)
    if not library_id:
        raise SystemExit(f'Library "{LIBRARY_SLUG}" not found.')

    r = api_request(
        "POST",
        f"/libraries/{library_id}/folders",
        session=session,
        json_body={"name": FOLDER_NAME},
    )
    folder = require_json(r, "POST /libraries/.../folders")
    print("Created folder:")
    print(f"  name: {folder.get('name')}")
    print(f"  id:   {folder.get('id')}")
    print(f"  path: {folder.get('pathCache')}")
    print(f"\nOpen: http://localhost:3000/{LIBRARY_SLUG}")


if __name__ == "__main__":
    main()
