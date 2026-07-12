#!/usr/bin/env python3
"""
Arciin API example — 06 Upload to library

What this does:
  Uploads one file to a specific library (Images, Videos, Music, …) using
  multipart POST /uploads?targetLibraryId=…

Requirements:
  pip install requests

Auth:
  API key with uploads:create and libraries:read (or admin), or email session.

Configure:
  scripts/examples/lib/arciin_client.py → API_BASE, API_KEY
  LIBRARY_SLUG below — or pass file path as first argument

Run:
  python scripts/examples/api/06_upload_to_library.py
  python scripts/examples/api/06_upload_to_library.py /path/to/photo.jpg
  python scripts/examples/api/06_upload_to_library.py /path/to/video.mp4 --library videos
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

from arciin_client import find_library_id, open_session, upload_file_multipart

DEFAULT_FILE = r"/path/to/your/file.jpg"
LIBRARY_SLUG = "images"


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload a file to a specific Arciin library")
    parser.add_argument("file", nargs="?", default=DEFAULT_FILE, help="Path to file on disk")
    parser.add_argument(
        "--library",
        default=LIBRARY_SLUG,
        help=f"Library slug (default: {LIBRARY_SLUG})",
    )
    args = parser.parse_args()

    path = Path(args.file).expanduser()
    session = open_session()
    library_id = find_library_id(session, args.library)
    if not library_id:
        raise SystemExit(f'Library "{args.library}" not found. Run 02_list_libraries.py.')

    print(f"Target library: {args.library} ({library_id})")
    data = upload_file_multipart(session, path, library_id=library_id)
    lib = data.get("targetLibrary") or {}
    slug = lib.get("slug", args.library)
    print("\nDone")
    print(f"  status:  {data.get('status')}")
    print(f"  asset:   {data.get('assetId')}")
    print(f"  library: {lib.get('name', slug)}")
    print(f"\nOpen: /{slug}")


if __name__ == "__main__":
    main()
