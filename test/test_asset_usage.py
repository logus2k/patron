"""Phase 05 — cross-project asset-usage index unit test (block_management.md §9.4).

Runnable two ways:
  pytest patron/test/
  python3 patron/test/test_asset_usage.py

Exercises serve.py's pure asset-usage logic (_graph_asset_ids, _asset_usage_index)
against a temp project store — the data driving the shared-asset delete warning.
"""
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import serve  # noqa: E402


def _graph(persona=None, target=None):
    nodes = []
    if persona is not None:
        nodes.append({"id": 1, "type": "agent", "properties": {"persona": persona}})
    if target is not None:
        nodes.append({"id": 2, "type": "whatsapp", "properties": {"target": target}})
    return {"nodes": nodes, "links": []}


def test_graph_asset_ids():
    ids = serve._graph_asset_ids(_graph(persona="news_curator", target="group-1"))
    assert ids == {"news_curator", "group-1"}
    # empty / missing props → no ids, no crash
    assert serve._graph_asset_ids({"nodes": [{"id": 9, "type": "trigger"}]}) == set()
    assert serve._graph_asset_ids({}) == set()
    # blank strings are ignored
    assert serve._graph_asset_ids(_graph(persona="  ")) == set()


def test_asset_usage_index():
    d = tempfile.mkdtemp()
    orig = serve.PROJECTS
    serve.PROJECTS = d
    try:
        serve._proj_write(serve._proj_from_body("proj-a", {"name": "A", "graph": _graph(persona="news_curator", target="wa-1")}))
        serve._proj_write(serve._proj_from_body("proj-b", {"name": "B", "graph": _graph(persona="news_curator")}))
        serve._proj_write(serve._proj_from_body("proj-c", {"name": "C", "graph": _graph(persona="other")}))

        full = serve._asset_usage_index()
        # news_curator used by A and B; wa-1 by A only; other by C only
        assert {u["uid"] for u in full["news_curator"]} == {"proj-a", "proj-b"}
        assert [u["uid"] for u in full["wa-1"]] == ["proj-a"]
        assert [u["uid"] for u in full["other"]] == ["proj-c"]

        # excluding A: news_curator still used by B (so deleting A must warn it's shared)
        ex = serve._asset_usage_index(exclude_uid="proj-a")
        assert {u["uid"] for u in ex["news_curator"]} == {"proj-b"}
        assert "wa-1" not in ex  # only A used it → not shared once A is excluded

        # excluding B AND A leaves news_curator unused by others
        # (simulate: exclude the only other user)
        ex_b = serve._asset_usage_index(exclude_uid="proj-b")
        assert {u["uid"] for u in ex_b["news_curator"]} == {"proj-a"}
    finally:
        serve.PROJECTS = orig
        shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    test_graph_asset_ids()
    test_asset_usage_index()
    print("test_asset_usage PASS")
