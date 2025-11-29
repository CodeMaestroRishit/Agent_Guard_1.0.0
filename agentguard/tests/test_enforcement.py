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
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("DATABASE_FILE", str(db_path))
    monkeypatch.setenv("ENFORCEMENT_HMAC_KEY", "test-key")
    monkeypatch.setenv("AUTO_SEED", "false")  # Don't auto-seed during tests
    reload_app()
    from flask import Flask
    from app.main import configure_app
    from app.utils import init_db_command
    init_db_command()
    app = Flask(__name__)
    configure_app(app)
    return app.test_client()

def seed_policy(client, rules):
    res = client.post("/policies", json={
        "name": "test-policy",
        "version": "1.0.0",
        "rules": rules,
        "created_by": "pytest",
    })
    assert res.status_code == 200

ALLOWED_RULE = [
    {
        "roles": ["reader"],
        "tool_id": "mcp:read_logs",
        "effect": "ALLOW",
        "conditions": {"limit": {"lte": 10}},
        "reason": "reader-allow",
    }
]


def test_allow_request(client):
    seed_policy(client, ALLOWED_RULE)
    payload = {
        "agent_id": "agent1",
        "agent_roles": ["reader"],
        "tool_id": "mcp:read_logs",
        "tool_version": "1.0.0",
        "params": {"limit": 5},
        "request_id": "req-allow",
    }
    res = client.post("/enforce", json=payload)
    assert res.status_code == 200
    body = res.get_json()
    assert body["decision"] == "ALLOW"
    assert body["policy_version"] == "1.0.0"


def test_schema_block(client):
    seed_policy(client, ALLOWED_RULE)
    payload = {
        "agent_id": "agent2",
        "agent_roles": ["reader"],
        "tool_id": "mcp:read_logs",
        "tool_version": "1.0.0",
        "params": {"limit": 5073},
        "request_id": "req-bad-schema",
    }
    res = client.post("/enforce", json=payload)
    assert res.status_code == 400
    assert res.get_json()["decision"] == "BLOCK"


def test_unknown_tool(client):
    seed_policy(client, ALLOWED_RULE)
    payload = {
        "agent_id": "agent3",
        "agent_roles": ["reader"],
        "tool_id": "unknown",
        "tool_version": "1.0.0",
        "params": {},
        "request_id": "req-unknown",
    }
    res = client.post("/enforce", json=payload)
    assert res.status_code == 404
    assert res.get_json()["reason"] == "tool_not_found"
