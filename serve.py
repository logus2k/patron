#!/usr/bin/env python3
"""Patron dev server: static files + a tiny workspace save/load API.

  GET  /api/workspace  -> data/workspace.json   (200 {} if none yet)
  PUT  /api/workspace  <- request body          (atomic write)

Everything else is served as static files from this directory (the editor).

Dev-grade on purpose: a SINGLE workspace document, no auth, bound to localhost —
it's a local authoring tool behind the platform, not a multi-tenant store. Named
workspaces / per-user storage are a later refactor when there's a concrete need.

  python3 serve.py [port]      # default 8088
"""
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
WORKSPACE = os.path.join(DATA, "workspace.json")
API = "/api/workspace"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?")[0] == API:
            if os.path.exists(WORKSPACE):
                try:
                    with open(WORKSPACE, "r", encoding="utf-8") as f:
                        return self._json(200, json.load(f))
                except (json.JSONDecodeError, OSError):
                    pass
            return self._json(200, {})  # no/corrupt workspace -> empty
        return super().do_GET()

    def do_PUT(self):
        if self.path.split("?")[0] == API:
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(n) if n else b"{}"
            try:
                data = json.loads(raw or b"{}")
            except json.JSONDecodeError as e:
                return self._json(400, {"ok": False, "error": f"invalid JSON: {e}"})
            os.makedirs(DATA, exist_ok=True)
            tmp = WORKSPACE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            os.replace(tmp, WORKSPACE)  # atomic
            return self._json(200, {"ok": True})
        self.send_error(405, "Method Not Allowed")

    def log_message(self, *a):  # keep the console quiet
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8088
    # Bind 0.0.0.0 by default so the reverse proxy (which reaches host services via
    # host.docker.internal) can connect — auth is enforced at the proxy: /patron is
    # OAuth2-gated to logus2k@gmail.com. Override for local-only with a 2nd arg or
    # PATRON_HOST=127.0.0.1.
    host = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("PATRON_HOST", "0.0.0.0")
    print(f"Patron on http://{host}:{port}  (API /{API} -> data/workspace.json)")
    ThreadingHTTPServer((host, port), Handler).serve_forever()
