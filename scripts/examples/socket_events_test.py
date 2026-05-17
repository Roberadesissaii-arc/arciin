#!/usr/bin/env python3
"""Renamed → use socket_events_example.py (kept as alias for older links)."""

import runpy
import sys
from pathlib import Path

print("Note: socket_events_test.py was renamed to socket_events_example.py\n")
target = Path(__file__).resolve().parent / "socket_events_example.py"
sys.argv[0] = str(target)
runpy.run_path(str(target), run_name="__main__")
