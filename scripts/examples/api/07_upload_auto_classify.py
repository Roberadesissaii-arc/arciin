#!/usr/bin/env python3
"""
Arciin API example — 07 Upload auto-classify

What this does:
  Uploads a file without targetLibraryId. Arciin detects the MIME type and
  routes automatically: video→Videos, image→Images, audio→Music, unknown→Inbox.

Requirements:
  pip install requests

Auth:
  API key with uploads:create (or admin), or email session.

Configure:
  scripts/examples/lib/arciin_client.py → API_BASE, API_KEY
  Pass file path as first argument, or edit DEFAULT_FILE below

Run:
  python scripts/examples/api/07_upload_auto_classify.py
  python scripts/examples/api/07_upload_auto_classify.py /path/to/file.pdf
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

from arciin_client import open_session, upload_file_multipart

DEFAULT_FILE = r"/path/to/your/file.bin"


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload — Arciin picks library by file type")
    parser.add_argument("file", nargs="?", default=DEFAULT_FILE, help="Path to file on disk")
    args = parser.parse_args()

    path = Path(args.file).expanduser()
    session = open_session()
    print("No targetLibraryId — server classifies by MIME type.")
    data = upload_file_multipart(session, path, library_id=None)
    lib = data.get("targetLibrary") or {}
    slug = lib.get("slug", "inbox")
    print("\nDone")
    print(f"  detected: {data.get('detectedMediaType')}")
    print(f"  library:  {lib.get('name', slug)}")
    print(f"\nOpen: /{slug}")


if __name__ == "__main__":
    main()
