"""
Shared helpers for Arciin Python API examples (scripts/examples/api/*.py).

Edit CONFIG below once — every script in api/ imports from here.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

try:
    import requests
except ImportError:
    print("Install: pip install requests")
    sys.exit(1)

# ═══════════════════════════════════════════════════════════════════════════
# CONFIG — edit here (not loaded from shell environment)
# ═══════════════════════════════════════════════════════════════════════════

# WSL: bash scripts/examples/lib/wsl_hosts.sh → use that IP from Windows
API_BASE = "http://127.0.0.1:4000/api"
API_ORIGIN = API_BASE.removesuffix("/api")
SOCKET_URL = "http://127.0.0.1:4000"

AUTH_MODE = "api_key"  # "api_key" | "email"
API_KEY = "arc_paste_full_key_here"  # full arc_… secret (Developer → API keys)
EMAIL = "admin@example.com"  # placeholder — use your Arciin login email
PASSWORD = "change-me"  # placeholder — use your Arciin password

_PLACEHOLDER_API_KEYS = frozenset({"", "arc_paste_full_key_here", "arc_live_your_key_here"})
_PLACEHOLDER_EMAILS = frozenset({"admin@example.com", "you@example.com", "user@example.com"})

# ═══════════════════════════════════════════════════════════════════════════


def clean_api_key(key: str) -> str:
    return key.strip().strip('"').strip("'")


def validate_auth_config() -> None:
    if AUTH_MODE not in ("api_key", "email"):
        raise SystemExit('AUTH_MODE must be "api_key" or "email"')
    if AUTH_MODE == "api_key":
        key = clean_api_key(API_KEY)
        if key in _PLACEHOLDER_API_KEYS:
            raise SystemExit(
                "Replace API_KEY in scripts/examples/lib/arciin_client.py "
                "with your full arc_… secret from Developer → API keys."
            )
        if not key.startswith("arc_"):
            raise SystemExit('API_KEY must start with "arc_"')
    else:
        email = EMAIL.strip().lower()
        if not email or email in _PLACEHOLDER_EMAILS:
            raise SystemExit(
                "Replace EMAIL in scripts/examples/lib/arciin_client.py "
                "with your Arciin login (e.g. you@yourdomain.com)."
            )
        if PASSWORD.strip() in ("", "change-me", "your-password", "secret"):
            raise SystemExit(
                "Replace PASSWORD in scripts/examples/lib/arciin_client.py with your real password."
            )


def auth_headers() -> dict[str, str]:
    if AUTH_MODE == "api_key":
        return {"Authorization": f"Bearer {clean_api_key(API_KEY)}"}
    return {}


def api_request(
    method: str,
    path: str,
    *,
    session: requests.Session | None = None,
    json_body: dict[str, Any] | None = None,
    params: dict[str, str] | None = None,
    files: dict | None = None,
    timeout: int = 60,
) -> requests.Response:
    url = f"{API_BASE}{path}" if path.startswith("/") else f"{API_BASE}/{path}"
    client = session or requests
    return client.request(
        method,
        url,
        headers={**auth_headers(), "Accept": "application/json"},
        json=json_body,
        params=params,
        files=files,
        cookies=session.cookies if session else None,
        timeout=timeout,
    )


def check_health() -> dict[str, Any]:
    r = requests.get(f"{API_ORIGIN}/api/health", timeout=8)
    r.raise_for_status()
    return r.json().get("data", {})


def open_session() -> requests.Session:
    validate_auth_config()
    check_health()
    session = requests.Session()
    if AUTH_MODE == "api_key":
        r = api_request("GET", "/auth/me", session=session)
        if r.status_code != 200:
            raise SystemExit(f"API key rejected ({r.status_code}): {r.text.strip()}")
        user = r.json().get("data", {}).get("user", {})
        print(f"API key OK — {user.get('name', '?')}")
        return session

    password = PASSWORD.strip() or __import__("getpass").getpass("Arciin password: ")
    r = session.post(
        f"{API_BASE}/auth/login",
        json={"email": EMAIL.strip(), "password": password},
        timeout=30,
    )
    if r.status_code != 200:
        raise SystemExit(f"Login failed ({r.status_code}): {r.text}")
    me = session.get(f"{API_BASE}/auth/me", timeout=30)
    me.raise_for_status()
    print("Logged in as", me.json().get("data", {}).get("user", {}).get("name", "?"))
    return session


def find_library_id(session: requests.Session, slug: str) -> str | None:
    r = api_request("GET", "/libraries", session=session)
    if r.status_code != 200:
        raise SystemExit(f"GET /libraries failed ({r.status_code}): {r.text}")
    for lib in r.json().get("data", []):
        if lib.get("slug", "").lower() == slug.lower():
            return lib["id"]
    return None


def require_json(r: requests.Response, label: str) -> Any:
    if r.status_code >= 400:
        raise SystemExit(f"{label} failed ({r.status_code}): {r.text}")
    return r.json().get("data")


def upload_file_multipart(
    session: requests.Session,
    path: str | Path,
    *,
    library_id: str | None = None,
) -> dict[str, Any]:
    import mimetypes

    p = Path(path)
    if not p.is_file():
        raise SystemExit(f"File not found: {p}")

    mime, _ = mimetypes.guess_type(p.name)
    mime = mime or "application/octet-stream"
    params = {"targetLibraryId": library_id} if library_id else {}
    print(f"Uploading {p.name} ({p.stat().st_size:,} bytes) → {API_BASE}/uploads")
    with p.open("rb") as handle:
        r = api_request(
            "POST",
            "/uploads",
            session=session,
            params=params,
            files={"file": (p.name, handle, mime)},
            timeout=600,
        )
    return require_json(r, "POST /uploads")
