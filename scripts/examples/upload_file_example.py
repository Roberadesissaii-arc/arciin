#!/usr/bin/env python3
"""Renamed → use upload_image_example.py (kept as alias for older links)."""

import runpy
import sys
from pathlib import Path

print("Note: upload_file_example.py was renamed to upload_image_example.py\n")
target = Path(__file__).resolve().parent / "upload_image_example.py"
sys.argv[0] = str(target)
runpy.run_path(str(target), run_name="__main__")
