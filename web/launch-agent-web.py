#!/usr/bin/env python3
"""Launch the Agent web frontend via a local static server."""

import mimetypes
import os
import socket
import subprocess
import sys
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

# Serve the built frontend from the `dist` directory.
SERVE_DIR = Path(__file__).resolve().parent / "dist"
DEFAULT_PORT = 8080

# Custom avatar image path. The frontend requests /avatar.jpg; we map it here
# so the image can live outside the dist folder.
AVATAR_PATH = Path(__file__).resolve().parent.parent / "403183c52b49b61ac9dc9baa1f1c6733.jpg"

SENSITIVE_NAMES = {".env", ".env.local", ".env.development", ".env.production"}
SENSITIVE_SUFFIXES = (".map",)


def is_sensitive_path(path: str) -> bool:
    """Check whether the requested URL path points to a sensitive file."""
    for part in Path(path).parts:
        lower = part.lower()
        if lower in SENSITIVE_NAMES:
            return True
        if any(lower.endswith(suffix) for suffix in SENSITIVE_SUFFIXES):
            return True
    return False


def validate_serve_dir() -> None:
    """Warn about sensitive files that may be accidentally served."""
    found: list[Path] = []
    for item in SERVE_DIR.rglob("*"):
        if not item.is_file():
            continue
        name = item.name.lower()
        if name in SENSITIVE_NAMES or any(name.endswith(suffix) for suffix in SENSITIVE_SUFFIXES):
            found.append(item.relative_to(SERVE_DIR))
    if found:
        print("WARNING: sensitive files detected in SERVE_DIR:", file=sys.stderr)
        for f in found:
            print(f"  - {f}", file=sys.stderr)
        print("These files can be downloaded by clients. Remove them before serving.", file=sys.stderr)


class AvatarHTTPRequestHandler(SimpleHTTPRequestHandler):
    """Static file handler that intercepts /avatar.jpg and serves a custom file.

    Security hardening:
    - Directory listing is disabled.
    - Security headers are added to every response.
    - Access to .env and *.map files is blocked.
    """

    def do_GET(self):
        if self.path == "/avatar.jpg":
            if not AVATAR_PATH.exists():
                self.send_error(404, "Avatar not found")
                return

            content_type, _ = mimetypes.guess_type(str(AVATAR_PATH))
            if content_type is None:
                content_type = "application/octet-stream"

            try:
                data = AVATAR_PATH.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except OSError as exc:
                self.send_error(500, f"Error reading avatar: {exc}")
            return

        if is_sensitive_path(self.path):
            self.send_error(403, "Forbidden")
            return

        super().do_GET()

    def list_directory(self, path):
        self.send_error(403, "Directory listing is disabled")
        return None

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        super().end_headers()


def find_free_port(start=DEFAULT_PORT, max_attempts=20):
    for port in range(start, start + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise RuntimeError("Could not find a free port")


def main():
    validate_serve_dir()
    os.chdir(SERVE_DIR)
    port = find_free_port()
    url = f"http://127.0.0.1:{port}/"

    server = ThreadingHTTPServer(
        ("127.0.0.1", port),
        AvatarHTTPRequestHandler,
    )

    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()

    # Give the server a moment to start, then open the browser.
    time.sleep(0.5)
    webbrowser.open(url)

    # Keep this process alive so the server keeps running.
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
