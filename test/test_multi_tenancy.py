"""Multi-tenancy unit tests for Patron's serve.py (documents/multi_tenancy.md §10).

CI-friendly: imports serve.py (its server only starts under __main__) and exercises the
ownership primitives + project-store owner stamping. Full HTTP-handler behaviour is covered
live; here we lock the logic serve.py's handlers rely on.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import serve  # noqa: E402


def test_can_access_owner_admin_legacy():
    default = serve.DEFAULT_PRINCIPAL
    admin = next(iter(serve.ADMIN_PRINCIPALS))
    # owner match
    assert serve._can_access("user-A", "user-A") is True
    # different owner denied
    assert serve._can_access("user-A", "user-B") is False
    # legacy record (owner None) belongs to the default principal
    assert serve._can_access(default, None) is True
    assert serve._can_access("user-A", None) is False
    # admins bypass ownership
    assert serve._can_access(admin, "user-A") is True


def test_proj_from_body_stamps_owner():
    p = serve._proj_from_body("uid1", {"name": "P", "graph": {}}, owner="user-A",
                              owner_email="a@x.com")
    assert p["owner"] == "user-A"
    assert p["owner_email"] == "a@x.com"
    assert p["uid"] == "uid1"


def test_proj_from_body_owner_defaults_none():
    p = serve._proj_from_body("uid1", {"name": "P"})
    assert p["owner"] is None  # a caller that doesn't pass owner leaves it unset (legacy)
