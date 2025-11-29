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
    db_path = tmp_path / "registry.db"
    monkeypatch.setenv("DATABASE_FILE", str(db_path))
    monkeypatch.setenv("ENFORCEMENT_HMAC_KEY", "registry-key")
    monkeypatch.setenv("AUTO_SEED", "false")  # Don't auto-seed during tests
    reload_app()
    from flask import Flask
    from app.main import configure_app
    from app.utils import init_db_command
    init_db_command()
    app = Flask(__name__)
    configure_app(app)
    return app.test_client()

def test_registry_loads_and_verifies(client, monkeypatch):
    res = client.get("/tools")
    assert res.status_code == 200
    tools = res.get_json()
    assert len(tools) >= 8
    from app.utils import sign_tool
    first = tools[0]
    assert first["signature"] == sign_tool(first["id"], first["version"], first["input_schema"])
