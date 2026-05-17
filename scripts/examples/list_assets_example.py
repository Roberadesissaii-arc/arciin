#!/usr/bin/env python3
"""Example: list recent assets (optional filter by library slug)."""

from arciin_example_client import api_request, find_library_id, open_session, require_json

LIBRARY_SLUG = ""  # empty = all libraries; or "images", "videos", …


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
    payload = r.json()
    if r.status_code >= 400:
        raise SystemExit(f"GET /assets failed ({r.status_code}): {r.text}")

    assets = payload.get("data", [])
    if not assets:
        print("  (none)")
        return
    for a in assets:
        print(
            f"  {a.get('originalFilename', '?')[:40]:40}  "
            f"type={a.get('mediaType', '?'):8}  id={a.get('id')}"
        )


if __name__ == "__main__":
    main()
