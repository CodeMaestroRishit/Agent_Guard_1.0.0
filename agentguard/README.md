# AgentGuard — Secure Policy Enforcement Layer

AgentGuard is an MVP enforcing RBAC policies over multi-agent LLM tool calls, verifying MCP tool signatures, validating schemas, and logging immutable audit events. It also includes a simple auditor, HTML UI, policy generation scaffold, and simulator scripts.

## Features
- Flask API with `/enforce`, `/policies`, `/tools`, `/audit`, `/anomalies`
- SQLite-backed policy store with versioning and audit log hashing
- Tool registry with simulated signatures via HMAC
- Background auditor detecting repeated blocks
- Simple dashboard, policy viewer, tool registry viewer, simulator UI
- Scripts to simulate agents and craft Gemini policy prompts
- Pytest coverage for enforcement, tool registry, policy store

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # update secrets
python -m app.utils init-db  # initializes SQLite schema
```

## Running

```bash
./run_mvp.sh
```

## Testing

```bash
pytest
```

## Smoke Test

```bash
curl -X POST http://localhost:5073/enforce \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"demo","agent_roles":["reader"],"tool_id":"read_logs","tool_version":"1.0.0","params":{"limit":5},"request_id":"req-1"}'
```
