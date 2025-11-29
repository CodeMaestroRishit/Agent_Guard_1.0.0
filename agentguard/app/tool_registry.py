import json
from typing import Any, Dict, Optional
from flask import Blueprint, jsonify
from pydantic import BaseModel, Field
from .utils import get_db, open_db
from . import utils


# -----------------------------
# Pydantic Schemas
# -----------------------------
class ReadLogsSchema(BaseModel):
    limit: int = Field(ge=1, le=100)

class ListToolsSchema(BaseModel):
    pass

class GetPolicySchema(BaseModel):
    version: str

class ModifyPolicySchema(BaseModel):
    change: str

class ExecuteToolWrapperSchema(BaseModel):
    target_tool: str

class RunShellSchema(BaseModel):
    cmd: str

class ReadSensitiveSchema(BaseModel):
    path: str

class MetricsWriteSchema(BaseModel):
    series: str
    value: float


# -----------------------------
# Schema Map
# -----------------------------
SCHEMA_MAP = {
    "mcp:read_logs": ReadLogsSchema,
    "mcp:list_tools": ListToolsSchema,
    "mcp:get_policy": GetPolicySchema,
    "mcp:modify_policy": ModifyPolicySchema,
    "mcp:execute_tool_wrapper": ExecuteToolWrapperSchema,
    "mcp:run_shell_sim": RunShellSchema,
    "mcp:read_sensitive_sim": ReadSensitiveSchema,
    "mcp:metrics_write": MetricsWriteSchema,
}


# -----------------------------
# Default MCP Tools
# -----------------------------
DEFAULT_TOOLS = [
    {
        "id": "mcp:read_logs",
        "version": "1.0.0",
        "description": "Read audit logs",
        "input_schema": {"limit": {"type": "integer", "max": 100}},
        "example_calls": [{"params": {"limit": 10}}],
    },
    {
        "id": "mcp:list_tools",
        "version": "1.0.0",
        "description": "List MCP tools",
        "input_schema": {},
        "example_calls": [{"params": {}}],
    },
    {
        "id": "mcp:get_policy",
        "version": "1.0.0",
        "description": "Fetch latest policy",
        "input_schema": {"version": {"type": "string"}},
        "example_calls": [{"params": {"version": "1.0.0"}}],
    },
    {
        "id": "mcp:modify_policy",
        "version": "1.0.0",
        "description": "Modify policy entries",
        "input_schema": {"change": {"type": "string"}},
        "example_calls": [{"params": {"change": "add"}}],
    },
    { 
        "id": "mcp:execute_tool_wrapper",
        "version": "1.0.0",
        "description": "Wraps tool execution",
        "input_schema": {"target_tool": {"type": "string"}},
        "example_calls": [{"params": {"target_tool": "mcp:read_logs"}}],
    },
    { 
        "id": "mcp:run_shell_sim",
        "version": "1.0.0",
        "description": "Simulated shell",
        "input_schema": {"cmd": {"type": "string"}},
        "example_calls": [{"params": {"cmd": "ls"}}],   
    },
    { 
        "id": "mcp:read_sensitive_sim",
        "version": "1.0.0",
        "description": "Simulated sensitive reader",
        "input_schema": {"path": {"type": "string"}},
        "example_calls": [{"params": {"path": "/etc/shadow"}}],
    },
    { 
        "id": "mcp:metrics_write",
        "version": "1.0.0",
        "description": "Write metrics",
        "input_schema": {
            "series": {"type": "string"},
            "value": {"type": "number"}
        },
        "example_calls": [{"params": {"series": "latency", "value": 12}}],
    },
]


# -----------------------------
# Tool Registry Class
# -----------------------------
class ToolRegistry:
    def __init__(self):
        self.blueprint = Blueprint("tools", __name__)
        self.blueprint.add_url_rule("/tools", "list_tools", self.list_tools)
        self._load_default_tools()

    def _load_default_tools(self):
        db = open_db()
        for tool in DEFAULT_TOOLS:
            signature = utils.sign_tool(
                tool["id"], tool["version"], tool["input_schema"]
            )
            full = {**tool, "signature": signature}

            db.execute(
                """
                INSERT OR IGNORE INTO tools (tool_id, version, definition)
                VALUES (?, ?, ?)
                """,
                (tool["id"], tool["version"], json.dumps(full)),
            )
        db.commit()
        db.close()

    def list_tools(self):
        db = get_db()
        rows = db.execute("SELECT definition FROM tools").fetchall()
        return jsonify([json.loads(row["definition"]) for row in rows])

    def get_tool(self, tool_id: str, version: str) -> Optional[Dict[str, Any]]:
        db = get_db()
        row = db.execute(
            "SELECT definition FROM tools WHERE tool_id=? AND version=?",
            (tool_id, version),
        ).fetchone()
        return json.loads(row["definition"]) if row else None

    def get_schema(self, tool_id: str):
        return SCHEMA_MAP.get(tool_id, BaseModel)
