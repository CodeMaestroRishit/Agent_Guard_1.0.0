#!/bin/bash
# AgentGuard Frontend Smoke Tests

set -e

BASE_URL="${BASE_URL:-http://localhost:5073}"

echo "Testing AgentGuard frontend endpoints..."

# Test static files
echo "Testing static files..."
STATUS1=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/static/dashboard.html")
STATUS2=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/static/script.js")

if [ "$STATUS1" != "200" ]; then
  echo "ERROR: /static/dashboard.html returned $STATUS1"
  exit 1
fi

if [ "$STATUS2" != "200" ]; then
  echo "ERROR: /static/script.js returned $STATUS2"
  exit 1
fi

echo "✓ Static files accessible"

# Test API endpoints and count unique agents/tools
echo "Testing API endpoints..."
TOOLS_JSON=$(curl -s "${BASE_URL}/tools")
AUDIT_JSON=$(curl -s "${BASE_URL}/audit")

if [ -z "$TOOLS_JSON" ] || [ "$TOOLS_JSON" = "null" ]; then
  echo "ERROR: /tools returned empty or null"
  exit 1
fi

if [ -z "$AUDIT_JSON" ] || [ "$AUDIT_JSON" = "null" ]; then
  echo "WARNING: /audit returned empty or null (may be normal if no audit logs)"
  AUDIT_JSON="[]"
fi

# Count unique agents and tools
# Using Python for JSON parsing (more reliable than jq which may not be installed)
UNIQUE_AGENTS=$(echo "$AUDIT_JSON" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    agents = set()
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict) and 'agent_id' in item and item['agent_id']:
                agents.add(item['agent_id'])
    print(len(agents))
except:
    print(0)
")

UNIQUE_TOOLS=$(echo "$TOOLS_JSON" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    tools = set()
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict) and 'id' in item and item['id']:
                tools.add(item['id'])
    print(len(tools))
except:
    print(0)
")

echo "AGENTS: $UNIQUE_AGENTS"
echo "TOOLS: $UNIQUE_TOOLS"

if [ "$UNIQUE_AGENTS" -eq 0 ] && [ "$UNIQUE_TOOLS" -eq 0 ]; then
  echo "ERROR: No agents or tools found. At least one must exist."
  exit 1
fi

if [ "$UNIQUE_TOOLS" -eq 0 ]; then
  echo "ERROR: No tools found"
  exit 1
fi

if [ "$UNIQUE_AGENTS" -eq 0 ]; then
  echo "WARNING: No agents found (may be normal if no audit logs)"
fi

echo "✓ All tests passed"
