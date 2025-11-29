import importlib
import os
import sys
import pytest

MODULES = [
    "app.utils",
    "app.policy_store",
    "app.tool_registry",
    "app.enforcement",
    "app.auditor",
    "app.main",
]

def reload_app():
    importlib.import_module("app")
    for name in MODULES:
        if name in sys.modules:
            importlib.reload(sys.modules[name])
        else:
            importlib.import_module(name)

@pytest.fixture
def client(tmp_path, monkeypatch):
    db_path = tmp_path / "policy.db"
    monkeypatch.setenv("DATABASE_FILE", str(db_path))
    monkeypatch.setenv("ENFORCEMENT_HMAC_KEY", "policy-key")
    monkeypatch.setenv("AUTO_SEED", "false")  # Don't auto-seed during tests
    reload_app()
    from flask import Flask
    from app.main import configure_app
    from app.utils import init_db_command
    init_db_command()
    app = Flask(__name__)
    configure_app(app)
    return app.test_client()

def test_policy_versioning(client):
    res1 = client.post("/policies", json={"name": "p1", "rules": []})
    res2 = client.post("/policies", json={"name": "p2", "rules": []})
    assert res1.status_code == 200
    assert res2.status_code == 200
    res = client.get("/policies")
    versions = [p["version"] for p in res.get_json()]
    assert "1.0.0" in versions
    assert "1.0.1" in versions
