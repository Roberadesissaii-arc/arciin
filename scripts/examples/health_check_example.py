#!/usr/bin/env python3
"""Example: check Arciin API health (no auth required)."""

from arciin_example_client import API_ORIGIN, check_health


def main() -> None:
    print(f"GET {API_ORIGIN}/api/health")
    data = check_health()
    print("API:", data.get("api"))
    print("Database:", data.get("database"))
    print("Redis:", data.get("redis"))
    print("Worker:", data.get("worker"))
    print("Storage:", data.get("storage"))
    print("Version:", data.get("version"))


if __name__ == "__main__":
    main()
