import json
import logging
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from flask import Blueprint, jsonify, request
from packaging.version import Version, InvalidVersion
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
        self.blueprint.add_url_rule("/policies/<int:policy_id>", "delete_policy", self.delete_policy, methods=["DELETE"])

    def list_policies(self):
        db = get_db()
        rows = db.execute("SELECT * FROM policies ORDER BY version DESC").fetchall()
        policies = []
        for row in rows:
            policy_dict = dict(row)
            # Deserialize rules from JSON string to object/list
            rules = policy_dict.get("rules")
            if isinstance(rules, str):
                try:
                    policy_dict["rules"] = json.loads(rules)
                except json.JSONDecodeError:
                    # If parsing fails, keep as string (backwards compatible)
                    logging.warning("Failed to parse rules JSON for policy %s: %s", policy_dict.get("id"), rules[:100])
                    policy_dict["rules"] = []
            elif rules is None:
                policy_dict["rules"] = []
            policies.append(policy_dict)
        return jsonify(policies)

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
        policy_dict = self.get_active_policy_for_request(db)
        if not policy_dict:
            return PolicyResult("BLOCK", None, "no_policy")
        
        rules_str = policy_dict.get("rules")
        if isinstance(rules_str, str):
            rules = json.loads(rules_str)
        elif isinstance(rules_str, list):
            rules = rules_str
        else:
            rules = []
        
        version = policy_dict.get("version")
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
                return PolicyResult(rule.get("effect", "BLOCK"), version, rule.get("reason", "rule_matched"))
        return PolicyResult("BLOCK", version, "no_rule_matched")

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

    def _safe_version_key(self, version_str: str, created_at_str: Optional[str] = None) -> Tuple[Any, Optional[datetime]]:
        """
        Create a sortable key for policy version comparison.
        Returns (Version object or fallback, datetime or None) for sorting.
        Higher version numbers sort first, then newer created_at.
        """
        try:
            version_obj = Version(version_str)
        except (InvalidVersion, ValueError, TypeError):
            # Fallback: treat as string for invalid versions (backwards compatible)
            version_obj = version_str
        
        created_at_dt = None
        if created_at_str:
            try:
                # Handle both with and without timezone
                if created_at_str.endswith("Z"):
                    created_at_str = created_at_str[:-1] + "+00:00"
                created_at_dt = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                pass
        
        return (version_obj, created_at_dt)
    
    def get_active_policy_for_request(self, db) -> Optional[Dict[str, Any]]:
        """
        Get the active policy for evaluation, sorted by:
        1. Highest semantic version (packaging.version.Version)
        2. Newest created_at as tiebreaker
        
        Returns the policy dict or None if no policies exist.
        """
        rows = db.execute("SELECT * FROM policies").fetchall()
        if not rows:
            return None
        
        # Convert to list of dicts and compute sort keys
        policies_with_keys = []
        for row in rows:
            policy_dict = dict(row)
            version_str = policy_dict.get("version", "0.0.0")
            created_at_str = policy_dict.get("created_at")
            version_obj, created_at_dt = self._safe_version_key(version_str, created_at_str)
            policies_with_keys.append((version_obj, created_at_dt, policy_dict))
        
        # Sort: highest version first, then newest created_at
        # Version objects are directly comparable, strings get lowest priority
        def sort_key(item):
            version_obj, created_at_dt, _ = item
            # Convert to comparable format: Version objects use release tuple, strings use (0,0,0)
            if isinstance(version_obj, Version):
                version_key = version_obj.release  # e.g., (9, 9, 7) for "9.9.7"
            else:
                # Invalid versions get lowest priority
                version_key = (0, 0, 0)
            
            # Use created_at or a very old date for None
            created_at_for_sort = created_at_dt if created_at_dt else datetime.min.replace(tzinfo=timezone.utc)
            
            return (version_key, created_at_for_sort)
        
        # Sort in reverse: highest version/newest date first
        policies_with_keys.sort(key=sort_key, reverse=True)
        
        return policies_with_keys[0][2] if policies_with_keys else None

    def _next_version(self, db) -> str:
        row = db.execute("SELECT version FROM policies ORDER BY version DESC LIMIT 1").fetchone()
        if not row:
            return "1.0.0"
        major, minor, patch = map(int, row["version"].split("."))
        patch += 1
        return f"{major}.{minor}.{patch}"
    
    def delete_policy(self, policy_id: int):
        """Delete a policy by ID. Returns 200 on success, 404 if not found."""
        db = get_db()
        cursor = db.execute("SELECT id FROM policies WHERE id = ?", (policy_id,))
        if not cursor.fetchone():
            return jsonify({"status": "error", "error": "not_found"}), 404
        
        db.execute("DELETE FROM policies WHERE id = ?", (policy_id,))
        db.commit()
        return jsonify({"status": "deleted", "policy_id": policy_id}), 200


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
