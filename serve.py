#!/usr/bin/env python3
"""Patron dev server: static files + a tiny workspace save/load API + deploy bridge.

  GET  /api/workspace  -> data/workspace.json   (200 {} if none yet)
  PUT  /api/workspace  <- request body          (atomic write)
  POST /api/deploy     <- compiled runtime DSL  -> forwards to agent_runtime

Everything else is served as static files from this directory (the editor).

The deploy bridge forwards a compiled record to agent_runtime's admin API
(PUT /admin/agents/<id>) so the browser stays same-origin under the gated /patron
(it can't reach the localhost-bound runtime directly). Target via AGENT_RUNTIME_URL.

Dev-grade on purpose: a SINGLE workspace document, no auth, bound to localhost —
it's a local authoring tool behind the platform, not a multi-tenant store. Named
workspaces / per-user storage are a later refactor when there's a concrete need.

  python3 serve.py [port]      # default 8088
"""
import json
import os
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
WORKSPACE = os.path.join(DATA, "workspace.json")
API = "/api/workspace"
DEPLOY_API = "/api/deploy"
# agent_runtime admin API (localhost-published by its compose: 127.0.0.1:6817).
RUNTIME_URL = os.environ.get("AGENT_RUNTIME_URL", "http://127.0.0.1:6817").rstrip("/")


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

    def do_POST(self):
        if self.path.split("?")[0] == DEPLOY_API:
            return self._deploy()
        self.send_error(405, "Method Not Allowed")

    def _deploy(self):
        """Forward a compiled runtime-DSL record to agent_runtime's admin API
        (PUT /admin/agents/<id>). The browser posts here (same-origin, gated);
        we relay server-to-server to the localhost-bound runtime."""
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            dsl = json.loads(raw or b"{}")
        except json.JSONDecodeError as e:
            return self._json(400, {"ok": False, "error": f"invalid JSON: {e}"})
        agent_id = (dsl or {}).get("id")
        if not agent_id:
            return self._json(400, {"ok": False, "error": "DSL has no 'id'"})

        url = f"{RUNTIME_URL}/admin/agents/{agent_id}"
        req = urllib.request.Request(
            url,
            data=json.dumps(dsl).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="PUT",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                payload = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            return self._json(e.code, {"ok": False, "error": f"agent_runtime {e.code}", "detail": detail})
        except urllib.error.URLError as e:
            return self._json(502, {"ok": False, "error": f"cannot reach agent_runtime at {RUNTIME_URL}: {e.reason}"})

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
