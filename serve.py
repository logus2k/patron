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
# Composer contract endpoints — proxied to agent_runtime so the browser (same-origin,
# gated under /patron) uses the ONE authoritative Block model instead of a JS copy.
COMPOSER_CATALOG = "/composer/catalog"
COMPOSER_COMPILE = "/composer/compile"
# Grounded pickers: the editor reads real channel targets from the runtime admin API.
WA_TARGETS = "/admin/channels/whatsapp/targets"
# Grounded pickers: the editor reads the real MCP tool catalog from the runtime admin API.
MCP_TOOLS = "/admin/channels/mcp/tools"
# Grounded pickers: the editor reads the real agent_server presets from the runtime admin API.
PRESETS = "/admin/channels/presets"
# Template Studio co-author: the editor asks the runtime to improve an input_template via LLM.
TEMPLATE_WRITER = "/admin/tools/template-writer"
# agent_runtime admin API (localhost-published by its compose: 127.0.0.1:6817).
RUNTIME_URL = os.environ.get("AGENT_RUNTIME_URL", "http://127.0.0.1:6817").rstrip("/")
# agent_scheduler admin API (localhost-published by its compose: 127.0.0.1:6816).
SCHEDULER_URL = os.environ.get("AGENT_SCHEDULER_URL", "http://127.0.0.1:6816").rstrip("/")


def _http(method, url, body=None):
    """Tiny JSON HTTP helper. Returns (status, parsed-json|None); raises HTTPError/URLError."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=10) as resp:
        raw = resp.read()
        return resp.status, (json.loads(raw) if raw else None)


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
        if self.path.split("?")[0] == COMPOSER_CATALOG:
            return self._proxy_get(f"{RUNTIME_URL}{COMPOSER_CATALOG}")
        if self.path.split("?")[0] == WA_TARGETS:
            return self._proxy_get(f"{RUNTIME_URL}{WA_TARGETS}")
        if self.path.split("?")[0] == MCP_TOOLS:
            return self._proxy_get(f"{RUNTIME_URL}{MCP_TOOLS}")
        if self.path.split("?")[0] == PRESETS:
            return self._proxy_get(f"{RUNTIME_URL}{PRESETS}")
        # Resource model: the generic management contract (/resources/catalog, /resources/{id}).
        if self.path.split("?")[0].startswith("/resources/"):
            return self._proxy_get(f"{RUNTIME_URL}{self.path}")
        return super().do_GET()

    def _proxy_get(self, url):
        """Relay a GET to a localhost-bound backend (the browser can't reach it)."""
        try:
            status, body = _http("GET", url)
            return self._json(status, body if body is not None else {})
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            return self._json(e.code, {"ok": False, "error": f"upstream {e.code}", "detail": detail})
        except urllib.error.URLError as e:
            return self._json(502, {"ok": False, "error": f"cannot reach {url}: {e.reason}"})

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
        if self.path.split("?")[0] == COMPOSER_COMPILE:
            return self._proxy_post(f"{RUNTIME_URL}{COMPOSER_COMPILE}")
        if self.path.split("?")[0] == TEMPLATE_WRITER:
            return self._proxy_post(f"{RUNTIME_URL}{TEMPLATE_WRITER}")
        self.send_error(405, "Method Not Allowed")

    def _proxy_post(self, url):
        """Relay a POST body to a localhost-bound backend and return its response."""
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError as e:
            return self._json(400, {"ok": False, "error": f"invalid JSON: {e}"})
        try:
            status, resp = _http("POST", url, body)
            return self._json(status, resp if resp is not None else {})
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            return self._json(e.code, {"ok": False, "error": f"upstream {e.code}", "detail": detail})
        except urllib.error.URLError as e:
            return self._json(502, {"ok": False, "error": f"cannot reach {url}: {e.reason}"})

    def _deploy(self):
        """Deploy a compiled agent to BOTH backends: upsert the agent record in
        agent_runtime, then (if scheduled) upsert the agent_scheduler job that fires it —
        linked by ``event_data.agent_uid``. Browser posts here (same-origin, gated); we
        relay server-to-server to the localhost-bound services.

        Body: ``{ record: {...}, schedule: {cron, timezone}|null }`` (a bare record with
        ``id`` is accepted too, treated as no schedule)."""
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError as e:
            return self._json(400, {"ok": False, "error": f"invalid JSON: {e}"})

        record = body.get("record") if isinstance(body, dict) and "record" in body else body
        schedule = body.get("schedule") if isinstance(body, dict) else None
        agent_id = (record or {}).get("id")
        if not agent_id:
            return self._json(400, {"ok": False, "error": "record has no 'id'"})

        # 1) Agent record -> agent_runtime. The legacy 'id' is mapped to name by the
        #    runtime's admin shim, which reuses the uid for an existing name.
        try:
            _, agent = _http("PUT", f"{RUNTIME_URL}/admin/agents/{agent_id}", record)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            return self._json(e.code, {"ok": False, "error": f"agent_runtime {e.code}", "detail": detail})
        except urllib.error.URLError as e:
            return self._json(502, {"ok": False, "error": f"cannot reach agent_runtime at {RUNTIME_URL}: {e.reason}"})
        uid = (agent or {}).get("uid")
        result = {"ok": True, "id": agent_id, "uid": uid, "agent": agent}

        # 2) Schedule -> agent_scheduler job (upsert by job_id == agent_id), linked by uid.
        if schedule and schedule.get("cron"):
            ta = {"cron_expression": schedule["cron"]}
            if schedule.get("timezone"):
                ta["timezone"] = schedule["timezone"]
            job = {
                "job_id": agent_id,
                "trigger_type": "cron",
                "trigger_args": ta,
                "target_stream_id": "agent-runtime",
                "event_type": "schedule.fired",
                "event_data": {"agent_uid": uid, "agent_name": agent_id},
            }
            try:
                try:
                    _http("POST", f"{SCHEDULER_URL}/jobs", job)
                    result["scheduled"] = "created"
                except urllib.error.HTTPError as e:
                    if e.code == 409:  # job already exists -> update it
                        patch = {k: job[k] for k in
                                 ("trigger_type", "trigger_args", "target_stream_id",
                                  "event_type", "event_data")}
                        _http("PATCH", f"{SCHEDULER_URL}/jobs/{agent_id}", patch)
                        result["scheduled"] = "updated"
                    else:
                        raise
            except urllib.error.HTTPError as e:
                result["scheduled"] = "error"
                result["scheduler_detail"] = e.read().decode("utf-8", "replace")
            except urllib.error.URLError as e:
                result["scheduled"] = "error"
                result["scheduler_detail"] = f"cannot reach agent_scheduler at {SCHEDULER_URL}: {e.reason}"
        else:
            result["scheduled"] = "skipped"

        return self._json(200, result)

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
