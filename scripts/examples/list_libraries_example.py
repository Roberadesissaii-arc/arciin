#!/usr/bin/env python3
"""Example: list libraries (Videos, Images, …) with ids for uploads and folders."""

from arciin_example_client import api_request, open_session, require_json


def main() -> None:
    session = open_session()
    r = api_request("GET", "/libraries", session=session)
    libraries = require_json(r, "GET /libraries")
    print(f"Found {len(libraries)} libraries:\n")
    for lib in libraries:
        print(
            f"  {lib.get('name'):12}  slug={lib.get('slug'):10}  "
            f"id={lib.get('id')}  assets={lib.get('assetCount', 0)}"
        )
    print("\nUse id as targetLibraryId on POST /uploads")


if __name__ == "__main__":
    main()
