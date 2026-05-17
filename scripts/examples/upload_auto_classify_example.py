#!/usr/bin/env python3
"""Example: upload without targetLibraryId — Arciin routes by file type."""

from pathlib import Path

from arciin_example_client import open_session, upload_file_multipart

FILE_PATH = r"/path/to/your/file.bin"


def main() -> None:
    path = Path(FILE_PATH).expanduser()
    session = open_session()
    print("No targetLibraryId — server classifies by MIME type.")
    data = upload_file_multipart(session, path, library_id=None)
    lib = data.get("targetLibrary") or {}
    slug = lib.get("slug", "inbox")
    print("\nDone")
    print(f"  detected: {data.get('detectedMediaType')}")
    print(f"  library:  {lib.get('name', slug)}")
    print(f"\nhttp://localhost:3000/{slug}")


if __name__ == "__main__":
    main()
