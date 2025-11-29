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


def test_policy_selection_by_semantic_version(client):
    """Test that higher semantic version wins even with older created_at."""
    from datetime import datetime, timezone, timedelta
    from flask import Flask
    from app.main import configure_app
    from app.policy_store import PolicyStore
    from app.utils import get_db, open_db
    import json
    
    # Use app context for database operations
    app = Flask(__name__)
    configure_app(app)
    
    with app.app_context():
        # Create two policies: v9.9.7 (older) and v1.0.0 (newer timestamp)
        # v9.9.7 should win because it's a higher version
        db = get_db()
        
        # Insert v9.9.7 with older timestamp
        older_time = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        db.execute(
            """
            INSERT INTO policies (version, name, rules, created_by, signature_placeholder, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("9.9.7", "old-high-version", json.dumps([{"roles": ["reader"], "tool_id": "mcp:read_logs", "effect": "ALLOW"}]), "test", "test", older_time)
        )
        
        # Insert v1.0.0 with newer timestamp
        newer_time = datetime.now(timezone.utc).isoformat()
        db.execute(
            """
            INSERT INTO policies (version, name, rules, created_by, signature_placeholder, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("1.0.0", "new-low-version", json.dumps([{"roles": ["reader"], "tool_id": "mcp:read_logs", "effect": "BLOCK"}]), "test", "test", newer_time)
        )
        db.commit()
        
        # Test that evaluate() selects v9.9.7 (higher version)
        policy_store = PolicyStore()
        result = policy_store.evaluate(["reader"], "mcp:read_logs", {})
        assert result.version == "9.9.7", f"Expected version 9.9.7, got {result.version}"
        assert result.decision == "ALLOW", f"Expected ALLOW from v9.9.7, got {result.decision}"


def test_policies_endpoint_returns_rules_as_objects(client):
    """Test that /policies endpoint returns rules as arrays/objects, not JSON strings."""
    # Create a policy with rules
    rules_data = [
        {"roles": ["reader"], "tool_id": "mcp:read_logs", "effect": "ALLOW", "conditions": {}}
    ]
    res = client.post("/policies", json={
        "name": "test-policy",
        "version": "2.0.0",
        "rules": rules_data
    })
    assert res.status_code == 200
    
    # Get policies and verify rules is a list/object, not a string
    res = client.get("/policies")
    assert res.status_code == 200
    policies = res.get_json()
    assert len(policies) > 0
    
    # Find our test policy
    test_policy = next((p for p in policies if p.get("version") == "2.0.0"), None)
    assert test_policy is not None, "Test policy not found"
    
    # Verify rules is a list, not a string
    rules = test_policy.get("rules")
    assert isinstance(rules, list), f"Expected rules to be a list, got {type(rules)}: {rules}"
    assert len(rules) == 1, f"Expected 1 rule, got {len(rules)}"
    assert rules[0]["roles"] == ["reader"], f"Expected reader role, got {rules[0]}"


def test_delete_policy(client):
    """Test DELETE /policies/<id> endpoint."""
    # Create a policy
    res = client.post("/policies", json={
        "name": "delete-test",
        "version": "3.0.0",
        "rules": []
    })
    assert res.status_code == 200
    
    # Get policies to find the ID
    res = client.get("/policies")
    policies = res.get_json()
    test_policy = next((p for p in policies if p.get("version") == "3.0.0"), None)
    assert test_policy is not None
    policy_id = test_policy["id"]
    
    # Delete it
    res = client.delete(f"/policies/{policy_id}")
    assert res.status_code == 200
    assert res.get_json()["status"] == "deleted"
    
    # Verify it's gone
    res = client.delete(f"/policies/{policy_id}")
    assert res.status_code == 404
