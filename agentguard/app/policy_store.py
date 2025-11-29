import json
import logging
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from flask import Blueprint, jsonify, request
from .utils import get_db

@dataclass
class PolicyResult:
    decision: str
    version: Optional[str]
    reason: str

class PolicyStore:
    def __init__(self):
        self.blueprint = Blueprint("policy", __name__)
        self.blueprint.add_url_rule("/policies", "list_policies", self.list_policies, methods=["GET"])
        self.blueprint.add_url_rule("/policies", "create_policy", self.create_policy, methods=["POST"])

    def list_policies(self):
        db = get_db()
        rows = db.execute("SELECT * FROM policies ORDER BY version DESC").fetchall()
        return jsonify([dict(row) for row in rows])

    def create_policy(self):
        data = request.get_json(force=True)
        db = get_db()
        version = data.get("version")
        if not version:
            version = self._next_version(db)
        raw_rules = data.get("rules", [])
        if isinstance(raw_rules, str):
            try:
                raw_rules = json.loads(raw_rules)
            except json.JSONDecodeError:
                raw_rules = []
        rules_list = []
        for rule in raw_rules or []:
            if not isinstance(rule, dict):
                continue
            if "tool" in rule and "tool_id" not in rule:
                rule = {**rule, "tool_id": rule["tool"]}
            rules_list.append(rule)
        created_at = datetime.now(timezone.utc).isoformat()
        db.execute(
            """
            INSERT INTO policies (version, name, rules, created_by, signature_placeholder, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                version,
                data.get("name", f"policy-{version}"),
                json.dumps(rules_list),
                data.get("created_by", "unknown"),
                data.get("signature_placeholder", "pending"),
                created_at,
            ),
        )
        db.commit()
        return jsonify({"status": "created", "version": version, "created_at": created_at})

    def evaluate(self, roles: List[str], tool_id: str, params: Dict[str, Any]) -> PolicyResult:
        db = get_db()
        row = db.execute(
            """
            SELECT * FROM policies
            ORDER BY (created_at IS NOT NULL) DESC, created_at DESC, id DESC, version DESC
            LIMIT 1
            """
        ).fetchone()
        if not row:
            return PolicyResult("BLOCK", None, "no_policy")
        rules = json.loads(row["rules"])
        for rule in rules:
            rule_roles = rule.get("roles", [])
            rule_tool = rule.get("tool_id")
            if not set(roles).intersection(rule_roles):
                continue
            normalized_targets = {rule_tool}
            if isinstance(rule_tool, str) and rule_tool.startswith("mcp:"):
                normalized_targets.add(rule_tool.split("mcp:", 1)[1])
            if tool_id not in normalized_targets:
                continue
            conditions = rule.get("conditions", {})
            if self._match_conditions(params, conditions):
                return PolicyResult(rule.get("effect", "BLOCK"), row["version"], rule.get("reason", "rule_matched"))
        return PolicyResult("BLOCK", row["version"], "no_rule_matched")

    def _match_conditions(self, params: Dict[str, Any], conditions: Dict[str, Any]) -> bool:
        for key, expected in conditions.items():
            value = params.get(key)
            if isinstance(expected, dict):
                if "equals" in expected and value != expected["equals"]:
                    return False
                if "lte" in expected and not isinstance(value, (int, float)):
                    return False
                if "lte" in expected and value > expected["lte"]:
                    return False
            else:
                if value != expected:
                    return False
        return True

    def _next_version(self, db) -> str:
        row = db.execute("SELECT version FROM policies ORDER BY version DESC LIMIT 1").fetchone()
        if not row:
            return "1.0.0"
        major, minor, patch = map(int, row["version"].split("."))
        patch += 1
        return f"{major}.{minor}.{patch}"


DEMO_RULES = [
    {
        "roles": ["reader"],
        "tool_id": "mcp:read_logs",
        "effect": "ALLOW",
        "conditions": {"limit": {"lte": 50}},
        "reason": "Reader access to logs",
    },
    {
        "roles": ["auditor"],
        "tool_id": "mcp:list_tools",
        "effect": "ALLOW",
        "conditions": {},
        "reason": "Auditor can list tools",
    },
    {
        "roles": ["policy_admin"],
        "tool_id": "mcp:modify_policy",
        "effect": "ALLOW",
        "conditions": {},
        "reason": "Policy admin privileges",
    },
]


def seed_demo_policy() -> None:
    db = get_db()
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS policy_version_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            policy_id INTEGER,
            version TEXT,
            detail TEXT,
            recorded_at TEXT
        )
        """
    )
    row = db.execute("SELECT COUNT(*) as cnt FROM policies").fetchone()
    if row["cnt"]:
        logging.debug("Policy seed skipped; %s policies already exist", row["cnt"])
        return
    version = "1.0.0"
    cursor = db.execute(
        """
        INSERT INTO policies (version, name, rules, created_by, signature_placeholder)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            version,
            "demo-autoseed-policy",
            json.dumps(DEMO_RULES),
            "auto-seed",
            "approved",
        ),
    )
    policy_id = cursor.lastrowid
    db.execute(
        """
        INSERT INTO policy_version_history (policy_id, version, detail, recorded_at)
        VALUES (?, ?, ?, ?)
        """,
        (
            policy_id,
            version,
            "auto-seed demo policy",
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    db.commit()
    logging.debug("Policy seed inserted policy_id=%s version=%s", policy_id, version)
