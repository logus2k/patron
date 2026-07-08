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
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
WORKSPACE = os.path.join(DATA, "workspace.json")
API = "/api/workspace"
DEPLOY_API = "/api/deploy"
# Phase 05 — Project deploy lifecycle. A Patron Project deploys 1:1 to ONE runtime graph
# record (idempotent by uid, version-bumped): POST /api/projects/<uid>/deploy relays the
# composition to the runtime POST /admin/projects/<uid>/deploy; POST /api/undeploy/<uid>
# relays to the runtime undeploy. Same server-to-server pattern as _deploy (the browser is
# gated under /patron and cannot reach the localhost-bound runtime directly).
UNDEPLOY_API = "/api/undeploy"           # POST /api/undeploy/<uid>
ASSET_USAGE_API = "/api/asset-usage"     # GET  /api/asset-usage/<asset_id> (cross-project §9.4)
# Phase 01 — named Projects (uid/name/description + composition), file-backed under
# data/projects/<uid>.json. The single workspace.json above stays as the "current open /
# autosave" doc; a Project is a NAMED, savable composition (block_management.md §9.1).
PROJECTS = os.path.join(DATA, "projects")
PROJECTS_API = "/api/projects"
_UID_RE = re.compile(r"^[A-Za-z0-9._-]+$")  # project uid must be filesystem-safe
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
# stt_ingress audio ingest (the Mic control relays raw PCM16 here → it transcribes + fires).
# On the shared docker network the service is reachable by name; override per environment.
STT_INGRESS_URL = os.environ.get("STT_INGRESS_URL", "http://stt-ingress-app:6818").rstrip("/")

# --- Multi-tenancy (documents/multi_tenancy.md §3) ---
# The principal used when the edge proxy hasn't injected an identity (dev / direct access).
DEFAULT_PRINCIPAL = os.environ.get("DEFAULT_PRINCIPAL", "logus2k@gmail.com")
# Superusers (bypass ownership). Comma-separated principals.
ADMIN_PRINCIPALS = {e.strip() for e in os.environ.get(
    "ADMIN_PRINCIPALS", "logus2k@gmail.com").split(",") if e.strip()}
# Shared secret sent to the farm so it trusts our X-Patron-User header (empty = dev).
INTERNAL_AUTH_TOKEN = os.environ.get("INTERNAL_AUTH_TOKEN", "")


def _is_admin(principal, email=None):
    """Admin membership is matched by EITHER the principal (sub) OR the email. ADMIN_PRINCIPALS
    stays configured as human-readable EMAILS, so the sole admin keeps access even though the
    live principal is an opaque Google `sub` (and even before any owner backfill)."""
    return principal in ADMIN_PRINCIPALS or (email is not None and email in ADMIN_PRINCIPALS)


def _can_access(principal, owner, email=None):
    """A principal may access a resource it owns (owner None/legacy → the default principal)
    or if it is an admin (matched by sub OR email)."""
    return _is_admin(principal, email) or principal == (owner or DEFAULT_PRINCIPAL)


def _http(method, url, body=None, headers=None):
    """Tiny JSON HTTP helper. Returns (status, parsed-json|None); raises HTTPError/URLError.
    ``headers`` forwards the caller identity (X-Patron-User …) to the runtime."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    hdrs = {"Content-Type": "application/json"} if data is not None else {}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    with urllib.request.urlopen(req, timeout=10) as resp:
        raw = resp.read()
        return resp.status, (json.loads(raw) if raw else None)


# --- Google profile (real name + picture) for the user menu ------------------
# Google omits name/picture from the ID token AND from the X-Auth-Request-* headers;
# they live only at the UserInfo endpoint, fetched with the OAuth access token that
# oauth2-proxy forwards (--pass-access-token → X-Auth-Request-Access-Token, which the
# /patron nginx location must copy to the upstream). Mirrors job2cool's proven pattern.
_GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
_userinfo_cache = {}  # access_token -> (expires_at, claims); token rotates ~hourly


def _google_userinfo(access_token):
    """Real profile claims {name, picture, email} for an access token, or {} if
    unavailable (no token in dev, expired token, or the endpoint errors)."""
    if not access_token:
        return {}
    now = time.time()
    hit = _userinfo_cache.get(access_token)
    if hit and hit[0] > now:
        return hit[1]
    info = {}
    try:
        status, body = _http("GET", _GOOGLE_USERINFO_URL,
                             headers={"Authorization": f"Bearer {access_token}"})
        if status == 200 and isinstance(body, dict):
            info = body
    except (urllib.error.HTTPError, urllib.error.URLError, ValueError):
        info = {}
    if info:
        if len(_userinfo_cache) > 256:
            _userinfo_cache.clear()
        _userinfo_cache[access_token] = (now + 600, info)
    return info


# --- Project store (file-backed; data/projects/<uid>.json) -------------------
def _proj_path(uid):
    return os.path.join(PROJECTS, uid + ".json")


def _proj_list():
    """Metadata for every saved project (uid/name/description/updated)."""
    out = []
    if os.path.isdir(PROJECTS):
        for fn in sorted(os.listdir(PROJECTS)):
            if not fn.endswith(".json"):
                continue
            try:
                with open(os.path.join(PROJECTS, fn), "r", encoding="utf-8") as f:
                    p = json.load(f)
                out.append({"uid": p.get("uid"), "name": p.get("name"),
                            "description": p.get("description", ""),
                            "updated": p.get("updated"), "version": p.get("version", 0),
                            "owner": p.get("owner")})
            except (json.JSONDecodeError, OSError):
                continue
    return out


def _proj_read(uid):
    try:
        with open(_proj_path(uid), "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _proj_write(p):
    os.makedirs(PROJECTS, exist_ok=True)
    p["updated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    path = _proj_path(p["uid"])
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(p, f, indent=2)
    os.replace(tmp, path)  # atomic
    return p


# --- Cross-project asset-usage (§9.4) -----------------------------------------
# A block's binding is a pointer to an asset id living in the node's `properties`
# (§5.1 / §9.2): the Agent's `persona` (agent_server preset), the Trigger's schedule,
# the Destination's `target`. We index those ids per project so a delete can warn when
# an asset is shared. The keys checked are deliberately broad (a superset) — a false
# "shared" warning is safe; a missed one is not.
_ASSET_KEYS = ("persona", "target", "schedule_id", "agent_id", "preset", "rag_id")


def _graph_asset_ids(graph):
    """Every asset id referenced by a project graph's nodes (from block `properties`)."""
    ids = set()
    for n in (graph or {}).get("nodes") or []:
        props = n.get("properties") or {}
        for k in _ASSET_KEYS:
            v = props.get(k)
            if isinstance(v, str) and v.strip():
                ids.add(v.strip())
    return ids


def _asset_usage_index(exclude_uid=None):
    """Map asset_id -> [ {uid, name} ] of projects that reference it (optionally
    excluding one project uid — used when checking what ELSE uses an asset)."""
    index = {}
    if not os.path.isdir(PROJECTS):
        return index
    for fn in sorted(os.listdir(PROJECTS)):
        if not fn.endswith(".json"):
            continue
        p = _proj_read(fn[:-len(".json")])
        if not p or p.get("uid") == exclude_uid:
            continue
        for aid in _graph_asset_ids(p.get("graph")):
            index.setdefault(aid, []).append({"uid": p.get("uid"), "name": p.get("name")})
    return index


def _proj_from_body(uid, body, owner=None, owner_email=None):
    return {
        "uid": uid,
        "name": (body.get("name") or "Untitled Project").strip() or "Untitled Project",
        "description": body.get("description", ""),
        "version": int(body.get("version") or 0),
        "graph": body.get("graph") or {},
        "ui": body.get("ui") or {},
        "owner": owner,
        "owner_email": owner_email,
    }


class Handler(SimpleHTTPRequestHandler):
    # Serve the voice assets with correct MIME: onnxruntime-web wants `application/wasm` for
    # streaming instantiation, ES modules want a JS type, and the Silero model is opaque bytes.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".onnx": "application/octet-stream",
    }

    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    # --- multi-tenancy identity (documents/multi_tenancy.md §3) ---
    def _principal(self):
        """The calling principal = the immutable OIDC ``sub`` (oauth2-proxy's
        ``X-Auth-Request-User``). Ownership keys on the ``sub`` (never reassigned); the email is
        display-only (``owner_email``) and the admin-match key (see ``_is_admin``). Precedence:
        sub → email → default (dev/no-proxy has no sub)."""
        return (self.headers.get("X-Auth-Request-User")
                or self.headers.get("X-Auth-Request-Email")
                or DEFAULT_PRINCIPAL)

    def _principal_email(self):
        return self.headers.get("X-Auth-Request-Email") or ""

    def _farm_headers(self):
        """Identity headers forwarded to the runtime on server-to-server calls."""
        h = {"X-Patron-User": self._principal(), "X-Patron-Email": self._principal_email()}
        if INTERNAL_AUTH_TOKEN:
            h["X-Internal-Auth"] = INTERNAL_AUTH_TOKEN
        return h

    def end_headers(self):
        # Never let the browser (or a proxy) cache the editor's HTML/JS/CSS — a stale build in
        # the tab is indistinguishable from "your change didn't work". Always serve fresh.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        """Parse the request body as JSON, or emit 400 and return None."""
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            return json.loads(raw or b"{}")
        except json.JSONDecodeError as e:
            self._json(400, {"ok": False, "error": f"invalid JSON: {e}"})
            return None

    # --- Projects (Phase 01) ---
    def _project_create(self):
        body = self._read_json()
        if body is None:
            return
        uid = body.get("uid") or uuid.uuid4().hex[:12]
        if not _UID_RE.match(uid):
            return self._json(400, {"ok": False, "error": "invalid uid"})
        # Multi-tenancy: the creator owns the new project.
        p = self._principal()
        return self._json(201, _proj_write(_proj_from_body(uid, body, owner=p, owner_email=self._principal_email())))

    def _project_put(self, uid):
        if not _UID_RE.match(uid):
            return self._json(400, {"ok": False, "error": "invalid uid"})
        body = self._read_json()
        if body is None:
            return
        # Multi-tenancy: only the owner (or admin) may update; owner is immutable across saves.
        existing = _proj_read(uid)
        p = self._principal()
        if existing is not None and not _can_access(p, existing.get("owner"), self._principal_email()):
            return self._json(403, {"ok": False, "error": "not authorized for this project"})
        owner = existing.get("owner") if existing else p
        owner_email = existing.get("owner_email") if existing else self._principal_email()
        return self._json(200, _proj_write(_proj_from_body(uid, body, owner=owner or p, owner_email=owner_email)))

    def do_GET(self):
        p0 = self.path.split("?")[0]
        # Who is logged in — for the top-right user menu. Identity comes from the edge proxy's
        # verified headers (X-Auth-Request-User/-Email); dev/no-proxy falls back to
        # DEFAULT_PRINCIPAL. No profile picture is available from the proxy headers, so the UI
        # renders an initials avatar.
        if p0 == "/api/me":
            # Real name + picture come from Google's UserInfo (via the forwarded access token);
            # they are NOT in the proxy headers. Fall back to preferred_username for the name,
            # else "" (the UI shows the email alone — we never fabricate a name from the email).
            info = _google_userinfo(self.headers.get("X-Auth-Request-Access-Token", "").strip())
            email = self._principal_email() or (info.get("email") or "").strip() or self._principal()
            name = (info.get("name") or "").strip()
            if not name:
                pref = (self.headers.get("X-Auth-Request-Preferred-Username") or "").strip()
                name = pref if pref and pref != email else ""
            return self._json(200, {"user": self._principal(), "email": email,
                                    "name": name, "picture": (info.get("picture") or "").strip()})
        if p0 == PROJECTS_API:
            # Multi-tenancy: list only the caller's projects (admins see all).
            p = self._principal()
            email = self._principal_email()
            return self._json(200, {"projects": [x for x in _proj_list() if _can_access(p, x.get("owner"), email)]})
        # Phase 05 §9.4 — cross-project asset-usage: which OTHER projects reference an asset id.
        if p0.startswith(ASSET_USAGE_API + "/"):
            return self._asset_usage(p0[len(ASSET_USAGE_API) + 1:])
        # Console (Receive): relay the runtime's SSE stream to the browser (long-lived).
        if p0.startswith(PROJECTS_API + "/") and p0.endswith("/events"):
            return self._project_events(p0[len(PROJECTS_API) + 1:-len("/events")])
        if p0.startswith(PROJECTS_API + "/"):
            proj = _proj_read(p0[len(PROJECTS_API) + 1:])
            if not proj:
                return self._json(404, {"ok": False, "error": "no such project"})
            if not _can_access(self._principal(), proj.get("owner"), self._principal_email()):
                return self._json(403, {"ok": False, "error": "not authorized for this project"})
            return self._json(200, proj)
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

    def _project_events(self, uid):
        """Console (Receive): stream-relay the runtime's SSE (``GET /admin/projects/<uid>/
        events``) to the browser. The buffering ``_http`` can't do this — we open the
        upstream and copy each line through as it arrives (ThreadingHTTPServer gives this
        its own thread, so it never blocks other requests)."""
        if not _UID_RE.match(uid):
            return self._json(400, {"ok": False, "error": "invalid uid"})
        try:
            req = urllib.request.Request(f"{RUNTIME_URL}/admin/projects/{uid}/events",
                                         headers=self._farm_headers())  # forward identity
            upstream = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            return self._json(e.code, {"ok": False, "error": f"agent_runtime {e.code}"})
        except urllib.error.URLError as e:
            return self._json(502, {"ok": False, "error": f"cannot reach agent_runtime: {e.reason}"})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        try:
            for line in upstream:            # SSE is line-framed; forward + flush as it arrives
                self.wfile.write(line)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass                             # browser closed the stream
        finally:
            try:
                upstream.close()
            except Exception:
                pass

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
        p0 = self.path.split("?")[0]
        if p0.startswith(PROJECTS_API + "/"):
            return self._project_put(p0[len(PROJECTS_API) + 1:])
        # /api/workspace is DROPPED (multi_tenancy.md §9.3): auto-save is gone and boot no
        # longer reads it, so the global workspace store is removed.
        # Resource model update: PUT /resources/{id}/{key}.
        if self.path.split("?")[0].startswith("/resources/"):
            return self._proxy_put(f"{RUNTIME_URL}{self.path}")
        self.send_error(405, "Method Not Allowed")

    def _proxy_put(self, url):
        """Relay a PUT body to a localhost-bound backend and return its response."""
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError as e:
            return self._json(400, {"ok": False, "error": f"invalid JSON: {e}"})
        try:
            status, resp = _http("PUT", url, body)
            return self._json(status, resp if resp is not None else {})
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            return self._json(e.code, {"ok": False, "error": f"upstream {e.code}", "detail": detail})
        except urllib.error.URLError as e:
            return self._json(502, {"ok": False, "error": f"cannot reach {url}: {e.reason}"})

    def do_POST(self):
        if self.path.split("?")[0] == PROJECTS_API:
            return self._project_create()
        if self.path.split("?")[0] == DEPLOY_API:
            return self._deploy()
        # Phase 05 — Project deploy lifecycle (relay to the runtime graph-record API).
        p0 = self.path.split("?")[0]
        if p0.startswith(PROJECTS_API + "/") and p0.endswith("/deploy"):
            uid = p0[len(PROJECTS_API) + 1:-len("/deploy")]
            return self._project_deploy(uid)
        if p0.startswith(PROJECTS_API + "/") and p0.endswith("/fire"):
            uid = p0[len(PROJECTS_API) + 1:-len("/fire")]
            return self._project_fire(uid)
        # Mic control: relay a raw-PCM16 utterance to the deployed STT source (stt_ingress),
        # which transcribes it server-side and fires the workflow — same path a web STT client uses.
        if p0.startswith(PROJECTS_API + "/") and p0.endswith("/stt-audio"):
            uid = p0[len(PROJECTS_API) + 1:-len("/stt-audio")]
            return self._project_stt_audio(uid)
        if p0.startswith(PROJECTS_API + "/") and p0.endswith("/status"):
            uid = p0[len(PROJECTS_API) + 1:-len("/status")]
            return self._project_status(uid)
        for _verb in ("step", "continue", "stop", "breakpoints"):
            if p0.startswith(PROJECTS_API + "/") and p0.endswith("/" + _verb):
                uid = p0[len(PROJECTS_API) + 1:-len("/" + _verb)]
                return self._project_debug(uid, _verb)
        if p0.startswith(UNDEPLOY_API + "/"):
            return self._project_undeploy(p0[len(UNDEPLOY_API) + 1:])
        if self.path.split("?")[0] == COMPOSER_COMPILE:
            return self._proxy_post(f"{RUNTIME_URL}{COMPOSER_COMPILE}")
        if self.path.split("?")[0] == TEMPLATE_WRITER:
            return self._proxy_post(f"{RUNTIME_URL}{TEMPLATE_WRITER}")
        # Resource model action verbs: POST /resources/{id}/{key}/{verb}.
        if self.path.split("?")[0].startswith("/resources/"):
            return self._proxy_post(f"{RUNTIME_URL}{self.path}")
        self.send_error(405, "Method Not Allowed")

    def do_DELETE(self):
        p0 = self.path.split("?")[0]
        if p0.startswith(PROJECTS_API + "/"):
            uid = p0[len(PROJECTS_API) + 1:]
            if not _UID_RE.match(uid):
                return self._json(400, {"ok": False, "error": "invalid uid"})
            existing = _proj_read(uid)
            if existing is None:
                return self._json(404, {"ok": False, "error": "no such project"})
            if not _can_access(self._principal(), existing.get("owner"), self._principal_email()):
                return self._json(403, {"ok": False, "error": "not authorized for this project"})
            try:
                os.remove(_proj_path(uid))
                return self._json(200, {"ok": True})
            except FileNotFoundError:
                return self._json(404, {"ok": False, "error": "no such project"})
        # Resource model delete: DELETE /resources/{id}/{key}.
        if self.path.split("?")[0].startswith("/resources/"):
            return self._proxy_delete(f"{RUNTIME_URL}{self.path}")
        self.send_error(405, "Method Not Allowed")

    def _proxy_delete(self, url):
        """Relay a DELETE to a localhost-bound backend and return its response."""
        try:
            status, resp = _http("DELETE", url)
            return self._json(status, resp if resp is not None else {})
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            return self._json(e.code, {"ok": False, "error": f"upstream {e.code}", "detail": detail})
        except urllib.error.URLError as e:
            return self._json(502, {"ok": False, "error": f"cannot reach {url}: {e.reason}"})

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

    # --- Phase 05: Project deploy lifecycle (relay to runtime graph-record API) ---
    def _project_deploy(self, uid):
        """Deploy the CURRENT project composition to the runtime as ONE graph record
        (§9.3, idempotent by uid, version-bumped). Relays the browser's same-origin POST
        to the runtime ``POST /admin/projects/<uid>/deploy``.

        Body: ``{name, composition:{nodes[], links[]}}`` — the litegraph ``serialize()``
        graph. Response: the runtime's ``{ok, uid, version, warnings[], firing}`` verbatim,
        so advisory ``warnings`` reach the Output panel (warn, don't block)."""
        if not _UID_RE.match(uid):
            return self._json(400, {"ok": False, "error": "invalid uid"})
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError as e:
            return self._json(400, {"ok": False, "error": f"invalid JSON: {e}"})
        # Accept either {name, composition} or a bare graph — normalise to the runtime shape.
        name = (body.get("name") or "").strip()
        composition = body.get("composition")
        if composition is None:
            # A bare serialize() graph was posted: treat the whole body as the composition.
            composition = {"nodes": body.get("nodes") or [], "links": body.get("links") or []}
        payload = {"name": name or "Untitled Project", "composition": composition}
        try:
            status, resp = _http("POST", f"{RUNTIME_URL}/admin/projects/{uid}/deploy", payload, headers=self._farm_headers())
            return self._json(status, resp if resp is not None else {})
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            return self._json(e.code, {"ok": False, "error": f"agent_runtime {e.code}", "detail": detail})
        except urllib.error.URLError as e:
            return self._json(502, {"ok": False, "error": f"cannot reach agent_runtime at {RUNTIME_URL}: {e.reason}"})

    def _project_fire(self, uid):
        """Console Send / Trace "Fire (debug)": manually FIRE a deployed Project. Relays the
        browser's same-origin POST to the runtime ``POST /admin/projects/<uid>/fire`` with
        ``{task, debug}`` (the typed message becomes the workflow seed; ``debug`` runs it
        step-by-step). Requires the project to be deployed."""
        if not _UID_RE.match(uid):
            return self._json(400, {"ok": False, "error": "invalid uid"})
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError as e:
            return self._json(400, {"ok": False, "error": f"invalid JSON: {e}"})
        payload = {"task": str(body.get("task") or ""), "debug": bool(body.get("debug")),
                   "breakpoints": list(body.get("breakpoints") or []),
                   "bp_enabled": bool(body.get("bp_enabled", True))}
        try:
            status, resp = _http("POST", f"{RUNTIME_URL}/admin/projects/{uid}/fire", payload, headers=self._farm_headers())
            return self._json(status, resp if resp is not None else {})
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            return self._json(e.code, {"ok": False, "error": f"agent_runtime {e.code}", "detail": detail})
        except urllib.error.URLError as e:
            return self._json(502, {"ok": False, "error": f"cannot reach agent_runtime at {RUNTIME_URL}: {e.reason}"})

    def _project_stt_audio(self, uid):
        """Mic control (Speech-to-Text block): relay one raw-PCM16@16k utterance to the deployed
        STT source at ``stt_ingress POST /sources/<source>/audio``. The ingress transcribes it
        (Socket.IO → Whisper) and fires the bound workflow — exactly what a raw-audio web STT
        client does. Owner-gated by the project; ``?source=<stream_id>`` names the STT source.
        Body is opaque bytes (NOT JSON), so this bypasses the JSON ``_http`` helper."""
        from urllib.parse import quote, parse_qs, urlparse
        if not _UID_RE.match(uid):
            return self._json(400, {"ok": False, "error": "invalid uid"})
        proj = _proj_read(uid)
        if proj is not None and not _can_access(self._principal(), proj.get("owner"), self._principal_email()):
            return self._json(403, {"ok": False, "error": "not authorized for this project"})
        source = (parse_qs(urlparse(self.path).query).get("source") or [""])[0].strip()
        if not source:
            return self._json(400, {"ok": False, "error": "missing ?source=<stream_id>"})
        n = int(self.headers.get("Content-Length") or 0)
        audio = self.rfile.read(n) if n else b""
        if not audio:
            return self._json(400, {"ok": False, "error": "empty audio body"})
        url = f"{STT_INGRESS_URL}/sources/{quote(source, safe='')}/audio"
        ctype = self.headers.get("Content-Type", "application/octet-stream")
        try:
            req = urllib.request.Request(url, data=audio, headers={"Content-Type": ctype}, method="POST")
            with urllib.request.urlopen(req, timeout=60) as resp:  # transcription streams ~real-time
                raw = resp.read()
                return self._json(resp.status, json.loads(raw) if raw else {})
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            return self._json(e.code, {"ok": False, "error": f"stt_ingress {e.code}", "detail": detail})
        except urllib.error.URLError as e:
            return self._json(502, {"ok": False, "error": f"cannot reach stt_ingress at {STT_INGRESS_URL}: {e.reason}"})

    def _project_debug(self, uid, verb):
        """Debug control: relay ``POST /api/projects/<uid>/{step|continue|stop|breakpoints}`` to
        the runtime's matching endpoint (owner-gated there). Drives a paused debug run."""
        if not _UID_RE.match(uid) or verb not in ("step", "continue", "stop", "breakpoints"):
            return self._json(400, {"ok": False, "error": "invalid request"})
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError as e:
            return self._json(400, {"ok": False, "error": f"invalid JSON: {e}"})
        payload = {"cid": str(body.get("cid") or "")}
        if verb == "breakpoints":
            payload["breakpoints"] = list(body.get("breakpoints") or [])
            if body.get("bp_enabled") is not None:
                payload["bp_enabled"] = bool(body.get("bp_enabled"))
        try:
            status, resp = _http("POST", f"{RUNTIME_URL}/admin/projects/{uid}/{verb}", payload, headers=self._farm_headers())
            return self._json(status, resp if resp is not None else {})
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            return self._json(e.code, {"ok": False, "error": f"agent_runtime {e.code}", "detail": detail})
        except urllib.error.URLError as e:
            return self._json(502, {"ok": False, "error": f"cannot reach agent_runtime at {RUNTIME_URL}: {e.reason}"})

    def _project_status(self, uid):
        """Deploy-readiness of the CURRENT (unsaved-to-farm) composition — powers the status
        badge. Relays the browser's same-origin POST to the runtime ``POST /admin/projects/
        <uid>/status`` (a pure DRY RUN: lowers with the deploy compiler, never persists).
        Body: ``{name, composition}`` (bare graph accepted). Response verbatim:
        ``{ok, errors, warnings, deployed, deployed_version, in_sync}``."""
        if not _UID_RE.match(uid):
            return self._json(400, {"ok": False, "error": "invalid uid"})
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError as e:
            return self._json(400, {"ok": False, "error": f"invalid JSON: {e}"})
        name = (body.get("name") or "").strip()
        composition = body.get("composition")
        if composition is None:
            composition = {"nodes": body.get("nodes") or [], "links": body.get("links") or []}
        payload = {"name": name or "Untitled Project", "composition": composition}
        try:
            status, resp = _http("POST", f"{RUNTIME_URL}/admin/projects/{uid}/status", payload, headers=self._farm_headers())
            return self._json(status, resp if resp is not None else {})
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            return self._json(e.code, {"ok": False, "error": f"agent_runtime {e.code}", "detail": detail})
        except urllib.error.URLError as e:
            return self._json(502, {"ok": False, "error": f"cannot reach agent_runtime at {RUNTIME_URL}: {e.reason}"})

    def _project_undeploy(self, uid):
        """Undeploy a Project (§9.4): relay to the runtime ``POST /admin/projects/<uid>/
        undeploy`` — removes the live record + firing binding, source assets untouched.
        Idempotent: a not-deployed uid returns ``removed:false`` + a warning, not an error."""
        if not _UID_RE.match(uid):
            return self._json(400, {"ok": False, "error": "invalid uid"})
        try:
            status, resp = _http("POST", f"{RUNTIME_URL}/admin/projects/{uid}/undeploy", {}, headers=self._farm_headers())
            return self._json(status, resp if resp is not None else {})
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            return self._json(e.code, {"ok": False, "error": f"agent_runtime {e.code}", "detail": detail})
        except urllib.error.URLError as e:
            return self._json(502, {"ok": False, "error": f"cannot reach agent_runtime at {RUNTIME_URL}: {e.reason}"})

    def _asset_usage(self, asset_id):
        """§9.4 cross-project protection: which OTHER projects reference ``asset_id``.
        Optional ``?exclude=<uid>`` drops the project being deleted. Returns
        ``{asset_id, used_by:[{uid,name}], shared: bool}``."""
        from urllib.parse import parse_qs, urlparse, unquote
        exclude = (parse_qs(urlparse(self.path).query).get("exclude") or [None])[0]
        asset_id = unquote(asset_id)
        used_by = _asset_usage_index(exclude_uid=exclude).get(asset_id, [])
        return self._json(200, {"asset_id": asset_id, "used_by": used_by, "shared": bool(used_by)})

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
