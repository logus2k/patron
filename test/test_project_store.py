"""Phase 01 — Patron Project store unit test (block_management.md §9.1).

Runnable two ways:
  pytest patron/test/            # CI
  python3 patron/test/test_project_store.py   # standalone
Imports serve.py (its server only starts under __main__, so import is safe) and
exercises the file-backed project store against a temp dir.
"""
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import serve  # noqa: E402


def test_project_store():
    d = tempfile.mkdtemp()
    orig = serve.PROJECTS
    serve.PROJECTS = d
    try:
        p = serve._proj_write(serve._proj_from_body(
            "abc123", {"name": "T", "description": "d", "graph": {"nodes": []}}))
        assert p["uid"] == "abc123"
        assert p["name"] == "T"
        assert p["description"] == "d"
        assert "updated" in p and p["updated"].endswith("Z")

        got = serve._proj_read("abc123")
        assert got["name"] == "T" and got["graph"] == {"nodes": []}

        listed = serve._proj_list()
        assert any(x["uid"] == "abc123" and x["name"] == "T" for x in listed)

        # defaults + missing
        assert serve._proj_from_body("x", {})["name"] == "Untitled Project"
        assert serve._proj_read("does-not-exist") is None

        # version is coerced to int
        v = serve._proj_from_body("y", {"version": "3"})
        assert v["version"] == 3
    finally:
        serve.PROJECTS = orig
        shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    test_project_store()
    print("test_project_store PASS")
