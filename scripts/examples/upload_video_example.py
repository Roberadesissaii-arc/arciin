#!/usr/bin/env python3
"""Example: upload a video file to the Videos library."""

from pathlib import Path

from arciin_example_client import find_library_id, open_session, upload_file_multipart

FILE_PATH = r"/path/to/your/video.mp4"
LIBRARY_SLUG = "videos"


def main() -> None:
    path = Path(FILE_PATH).expanduser()
    session = open_session()
    library_id = find_library_id(session, LIBRARY_SLUG)
    if not library_id:
        raise SystemExit(f'Library "{LIBRARY_SLUG}" not found.')

    print(f"Target: {LIBRARY_SLUG} ({library_id})")
    data = upload_file_multipart(session, path, library_id=library_id)
    lib = data.get("targetLibrary") or {}
    print("\nDone — worker may still process thumbnails/metadata.")
    print(f"  status: {data.get('status')}")
    print(f"  asset:  {data.get('assetId')}")
    print(f"\nhttp://localhost:3000/{lib.get('slug', 'videos')}")


if __name__ == "__main__":
    main()
