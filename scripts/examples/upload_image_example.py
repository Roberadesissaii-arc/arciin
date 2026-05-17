#!/usr/bin/env python3
"""Example: upload an image file to the Images library (multipart POST)."""

from __future__ import annotations

import argparse
from pathlib import Path

from arciin_example_client import (
    API_BASE,
    find_library_id,
    open_session,
    upload_file_multipart,
)

FILE_PATH = r"/path/to/your/photo.jpg"
LIBRARY_SLUG = "images"


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload an image to Arciin")
    parser.add_argument("file", nargs="?", default=FILE_PATH)
    parser.add_argument("--auto", action="store_true", help="Let Arciin pick library by MIME")
    args = parser.parse_args()

    path = Path(args.file).expanduser()
    session = open_session()
    library_id = None
    if not args.auto:
        library_id = find_library_id(session, LIBRARY_SLUG)
        if library_id:
            print(f"Target: {LIBRARY_SLUG} ({library_id})")

    data = upload_file_multipart(session, path, library_id=library_id)
    lib = data.get("targetLibrary") or {}
    slug = lib.get("slug", "inbox")
    print("\nDone")
    print(f"  status:  {data.get('status')}")
    print(f"  asset:   {data.get('assetId')}")
    print(f"  library: {lib.get('name', slug)}")
    print(f"\nhttp://localhost:3000/{slug}")


if __name__ == "__main__":
    main()
