# Lightweight container for the Patron authoring UI + its tiny backend (serve.py).
# serve.py is Python stdlib only (http.server / json / urllib) — no pip deps — so
# an alpine base keeps the image small (~50MB). It serves the static editor AND the
# small API the UI depends on: /api/workspace (Save/Load) and /api/deploy (the
# bridge to agent_runtime). See serve.py.
FROM python:3.12-alpine

WORKDIR /app

# App files only — data/, .git, the venv, docs, examples and tests are excluded
# via .dockerignore and intentionally NOT copied (data/ is a runtime volume).
COPY index.html serve.py ./
COPY js/ ./js/
COPY css/ ./css/
COPY fonts/ ./fonts/
COPY vendor/ ./vendor/

# serve.py listens on 8088, bound to 0.0.0.0 inside the container by default.
EXPOSE 8088

# Where the deploy bridge forwards compiled DSLs. On the shared docker network the
# runtime is reachable by its service name; override per environment as needed.
ENV AGENT_RUNTIME_URL=http://agent-runtime-app:6817
# Deploy also upserts the agent_scheduler cron job, linked by event_data.agent_uid.
ENV AGENT_SCHEDULER_URL=http://agent-scheduler-app:6816

# Liveness: the workspace API always returns 200 (even with no saved doc yet).
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python3 -c "import urllib.request,sys; urllib.request.urlopen('http://127.0.0.1:8088/api/workspace'); sys.exit(0)"

CMD ["python3", "serve.py"]
