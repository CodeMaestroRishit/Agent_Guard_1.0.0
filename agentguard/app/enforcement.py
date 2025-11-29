import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from flask import Blueprint, jsonify, request
from pydantic import BaseModel, ValidationError
from .policy_store import PolicyStore
from .tool_registry import ToolRegistry
from .utils import get_db

logger = logging.getLogger(__name__)


class EnforcementRequest(BaseModel):
    agent_id: str
    agent_roles: List[str]
    tool_id: str
    tool_version: Optional[str] = "1.0"
    params: Dict[str, Any]
    request_id: str

class EnforcementService:
    def __init__(self, policy_store: PolicyStore, tool_registry: ToolRegistry):
        self.policy_store = policy_store
        self.tool_registry = tool_registry
        self.blueprint = Blueprint("enforcement", __name__)
        self.blueprint.add_url_rule("/enforce", "enforce", self.enforce, methods=["POST"])
        self.blueprint.add_url_rule("/audit", "list_audit", self.list_audit, methods=["GET"])

    def enforce(self):
        try:
            payload = EnforcementRequest(**request.get_json(force=True))
        except ValidationError as exc:
            return jsonify({"error": "invalid_request", "details": exc.errors()}), 400

        db = get_db()
        original_tool_version = payload.tool_version
        tool_version = original_tool_version or "1.0"
        if original_tool_version is None:
            logger.debug("No tool_version provided; defaulting to 1.0 for request_id=%s", payload.request_id)
        payload.tool_version = tool_version

        tool = self.tool_registry.get_tool(payload.tool_id, tool_version)
        if not tool:
            logger.debug("Tool not found in registry: %s@%s", payload.tool_id, tool_version)
            decision = "BLOCK"
            reason = "tool_not_found"
            policy_version = None
            response = self._build_response(decision, policy_version, reason, payload)
            self._log_audit(db, payload, decision, reason, policy_version)
            return jsonify(response), 404

        if not self._verify_signature(tool):
            decision = "BLOCK"
            reason = "invalid_tool_signature"
            policy_version = None
            response = self._build_response(decision, policy_version, reason, payload)
            self._log_audit(db, payload, decision, reason, policy_version)
            return jsonify(response), 403

        schema_cls = self.tool_registry.get_schema(payload.tool_id)
        if schema_cls is None:
            logger.debug("No input schema registered for tool %s; skipping params validation", payload.tool_id)
        else:
            try:
                schema_cls(**payload.params)
            except ValidationError as exc:
                decision = "BLOCK"
                reason = f"schema_error:{exc.errors()[0]['msg']}"
                policy_version = None
                response = self._build_response(decision, policy_version, reason, payload)
                self._log_audit(db, payload, decision, reason, policy_version)
                return jsonify(response), 400

        policy = self.policy_store.evaluate(payload.agent_roles, payload.tool_id, payload.params)
        response = self._build_response(policy.decision, policy.version, policy.reason, payload)
        status = 200 if policy.decision == "ALLOW" else 403
        self._log_audit(db, payload, policy.decision, policy.reason, policy.version)
        return jsonify(response), status

    def list_audit(self):
        db = get_db()
        rows = db.execute(
            "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200"
        ).fetchall()
        return jsonify([dict(row) for row in rows])

    def _verify_signature(self, tool: Dict[str, Any]) -> bool:
        secret = os.getenv("ENFORCEMENT_HMAC_KEY", "dev-secret").encode()
        msg = f"{tool['id']}|{tool['version']}|{json.dumps(tool['input_schema'], sort_keys=True)}".encode()
        expected = hmac.new(secret, msg, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, tool.get("signature", ""))

    def _build_response(self, decision: str, version: Optional[str], reason: str, payload: EnforcementRequest) -> Dict[str, Any]:
        payload_dict = payload.dict()
        serialized = json.dumps(payload_dict, sort_keys=True, default=str)
        request_hash = hashlib.sha256(serialized.encode()).hexdigest()
        return {
            "decision": decision,
            "policy_version": version,
            "reason": reason,
            "request_hash": request_hash,
        }

    def _hash_params(self, params: Dict[str, Any]) -> Dict[str, str]:
        out: Dict[str, str] = {}
        for key, value in params.items():
            try:
                serial = json.dumps(value, sort_keys=True, default=str)
            except TypeError:
                serial = str(value)
            out[key] = hashlib.sha256(serial.encode()).hexdigest()
        return out

    def _log_audit(self, db, payload: EnforcementRequest, decision: str, reason: str, policy_version: Optional[str]) -> None:
        created_at = datetime.now(timezone.utc).isoformat()
        db.execute(
            """
            INSERT INTO audit_logs (request_id, agent_id, roles, tool_id, tool_version, params_hash, decision, reason, policy_version, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.request_id,
                payload.agent_id,
                ",".join(payload.agent_roles),
                payload.tool_id,
                payload.tool_version,
                json.dumps(self._hash_params(payload.params)),
                decision,
                reason,
                policy_version,
                created_at,
            ),
        )
        db.commit()
