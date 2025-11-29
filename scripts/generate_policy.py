#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import google.generativeai as genai
from pydantic import BaseModel, ValidationError, validator

LOG_PATH = Path(__file__).resolve().parent / "gemini_calls.log"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("generate_policy")


class PolicyRule(BaseModel):
    id: str
    roles: List[str]
    tool: str
    effect: str
    conditions: Dict[str, Any]


class PolicyExamples(BaseModel):
    allowed: List[str]
    blocked: List[str]


class PolicyDocument(BaseModel):
    id: str
    version: str
    name: str
    created_by: str
    created_at: str
    description: str
    rules: List[PolicyRule]
    assumptions: List[str]
    examples: PolicyExamples
    test_vectors: List[Dict[str, Any]]

    @validator("created_at")
    def validate_timestamp(cls, value: str):
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value


def build_prompt(nl_rules: str) -> str:
    schema = {
        "id": "string unique policy id",
        "version": "semantic version e.g. v1",
        "name": "policy name",
        "created_by": "actor creating policy",
        "created_at": "ISO 8601 UTC timestamp",
        "description": "short summary",
        "rules": [
            {
                "id": "unique rule id",
                "roles": ["list of RBAC roles"],
                "tool": "MCP tool id (e.g., mcp:read_logs)",
                "effect": "allow|deny",
                "conditions": {},
            }
        ],
        "assumptions": ["text"],
        "examples": {"allowed": ["text"], "blocked": ["text"]},
        "test_vectors": [
            {"agent_roles": ["reader"], "tool": "mcp:read_logs", "expected": "allow"}
        ],
    }
    prompt = (
        "You are AgentGuard's Policy Generator. Convert NL governance rules into the "
        "strict JSON schema below. Ensure consistent casing, include at least one "
        "assumption, two allowed/blocked examples, and three test vectors.\n\n"
        f"JSON Schema (describe, do not output schema):\n{json.dumps(schema, indent=2)}\n\n"
        f"Natural-language rules:\n{nl_rules}\n\n"
        "Return ONLY a JSON object that conforms exactly to the schema."
    )
    return prompt


def _clean_model_output(text: str) -> str:
    """Strip markdown fences/backticks and extract first JSON object."""
    if text is None:
        return ""
    s = str(text).strip()
    if s.startswith("```") and s.endswith("```"):
        lines = s.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        s = "\n".join(lines).strip()
    if s.startswith("`") and s.endswith("`"):
        s = s.strip("`").strip()
    stripped = s.lstrip()
    if "{" in stripped and not stripped.startswith("{"):
        # extract first balanced JSON block
        start = stripped.find("{")
        if start != -1:
            depth = 0
            end_index = None
            for idx in range(start, len(stripped)):
                ch = stripped[idx]
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        end_index = idx
                        break
            if end_index is not None:
                stripped = stripped[start : end_index + 1]
    return stripped.strip()


def _serialize_usage(usage_obj) -> str:
    if usage_obj is None:
        return "null"
    try:
        if isinstance(usage_obj, dict):
            return json.dumps(usage_obj, default=str)
        if hasattr(usage_obj, "__dict__"):
            return json.dumps(usage_obj.__dict__, default=str)
        return json.dumps(vars(usage_obj), default=str)
    except Exception:
        try:
            return json.dumps(str(usage_obj), default=str)
        except Exception:
            return "\"<unserializable>\""


def masked_key(key: str) -> str:
    if not key or len(key) < 8:
        return "****"
    return f"{key[:2]}****{key[-4:]}"


def log_call(model_name: str, api_key: str, usage: Optional[Dict[str, Any]] = None, status: str = "ok") -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    usage_str = _serialize_usage(usage)
    with LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(
            f"{datetime.now(timezone.utc).isoformat()} model={model_name} key={masked_key(api_key)} status={status} usage={usage_str}\n"
        )


def call_gemini_model(prompt: str, model_name: str, api_key: str, timeout: int = 30) -> str:
    try:
        genai.configure(api_key=api_key)
        if hasattr(genai, "generate_text"):
            resp = genai.generate_text(
                model=model_name,
                prompt=prompt,
                temperature=0.0,
                max_output_tokens=2048,
            )
            text = getattr(resp, "text", None) or getattr(resp, "result", None)
            log_call(model_name, api_key, getattr(resp, "usage_metadata", None))
            return text if isinstance(text, str) else str(text)
        model = genai.GenerativeModel(model_name)
        result = model.generate_content(prompt)
        log_call(model_name, api_key, getattr(result, "usage_metadata", None))
        return getattr(result, "text", str(result))
    except Exception as exc:
        log_call(model_name, api_key, {"error": str(exc)}, status="error")
        raise


def mock_policy(nl_rules: str) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": "mock-policy-v1",
        "version": "v1",
        "name": "mock-gemini-policy",
        "created_by": "mock-generator",
        "created_at": now,
        "description": f"Deterministic mock for: {nl_rules[:60]}",
        "rules": [
            {
                "id": "mock-rule-allow-reader",
                "roles": ["reader"],
                "tool": "mcp:read_logs",
                "effect": "allow",
                "conditions": {},
            }
        ],
        "assumptions": ["Mock mode triggered because GEMINI_API_KEY is unavailable."],
        "examples": {
            "allowed": ["Reader fetching logs"],
            "blocked": ["Reader trying to modify policies"],
        },
        "test_vectors": [
            {"agent_roles": ["reader"], "tool": "mcp:read_logs", "expected": "allow"},
            {"agent_roles": ["reader"], "tool": "mcp:modify_policy", "expected": "deny"},
            {"agent_roles": ["unknown"], "tool": "mcp:list_tools", "expected": "deny"},
        ],
    }


def validate_and_print(policy: Dict[str, Any]) -> None:
    try:
        document = PolicyDocument(**policy)
    except ValidationError as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
    print(json.dumps(document.dict(), separators=(",", ":")))


def main():
    parser = argparse.ArgumentParser(description="Gemini-powered policy generator")
    parser.add_argument("--nl", required=True, help="Natural-language rules to convert")
    parser.add_argument(
        "--model",
        default=os.environ.get("GEMINI_MODEL", "models/gemini-2.5-pro"),
        help="Gemini model name",
    )
    args = parser.parse_args()

    prompt = build_prompt(args.nl)
    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        print(prompt, file=sys.stderr)
        policy = mock_policy(args.nl)
        validate_and_print(policy)
        return

    try:
        raw_text = call_gemini_model(prompt, args.model, api_key)
        cleaned = _clean_model_output(raw_text)
        policy = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        logger.error("Failed to parse policy JSON: %s", exc)
        logger.debug("Raw Gemini output (first 5000 chars): %s", raw_text[:5000])
        logger.debug("Cleaned Gemini output (first 5000 chars): %s", cleaned[:5000])
        sys.exit(1)
    except Exception as exc:
        logger.error("Gemini call failed: %s", exc)
        sys.exit(1)

    validate_and_print(policy)


if __name__ == "__main__":
    main()
