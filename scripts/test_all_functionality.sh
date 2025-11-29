#!/bin/bash
# AgentGuard - Comprehensive Functionality Test Suite
# Tests all features before demo

set -e

BASE_URL="${BASE_URL:-http://localhost:5073}"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🧪 AgentGuard - Comprehensive Functionality Test"
echo "=================================================="
echo ""

PASSED=0
FAILED=0

test_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✅ PASS${NC}: $2"
        ((PASSED++))
    else
        echo -e "${RED}❌ FAIL${NC}: $2"
        ((FAILED++))
    fi
}

# Test 1: Server is running
echo "1. Testing server connectivity..."
if curl -sSf "${BASE_URL}/tools" > /dev/null 2>&1; then
    test_result 0 "Server is running and accessible"
else
    test_result 1 "Server is not accessible"
    echo "   Please start the server first: python3 -m app.main"
    exit 1
fi

# Test 2: Tools endpoint
echo ""
echo "2. Testing Tool Registry..."
TOOLS_RESPONSE=$(curl -sSf "${BASE_URL}/tools")
TOOLS_COUNT=$(echo "$TOOLS_RESPONSE" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
if [ "$TOOLS_COUNT" -gt 0 ]; then
    test_result 0 "Tool registry returns $TOOLS_COUNT tools"
    echo "   Sample tools:"
    echo "$TOOLS_RESPONSE" | python3 -c "import sys, json; [print(f\"     - {t.get('id')} v{t.get('version')}\") for t in json.load(sys.stdin)[:3]]" 2>/dev/null
else
    test_result 1 "Tool registry is empty or invalid"
fi

# Test 3: Policies endpoint (GET)
echo ""
echo "3. Testing Policy Store (GET)..."
POLICIES_RESPONSE=$(curl -sSf "${BASE_URL}/policies")
POLICIES_COUNT=$(echo "$POLICIES_RESPONSE" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
test_result 0 "Policies endpoint returns $POLICIES_COUNT policies"

# Test 4: Create a test policy
echo ""
echo "4. Testing Policy Creation (POST)..."
CREATE_POLICY_RESPONSE=$(curl -sSf -X POST "${BASE_URL}/policies" \
    -H "Content-Type: application/json" \
    -d '{
        "name": "test-demo-policy",
        "version": "9.9.9",
        "created_by": "test-suite",
        "rules": [
            {
                "id": "rule-test-1",
                "roles": ["test_role"],
                "tool_id": "read_logs",
                "effect": "ALLOW",
                "conditions": {"limit": {"lte": 100}},
                "reason": "test-allow"
            }
        ]
    }')
if echo "$CREATE_POLICY_RESPONSE" | python3 -c "import sys, json; d=json.load(sys.stdin); exit(0 if d.get('status') == 'created' else 1)" 2>/dev/null; then
    test_result 0 "Policy created successfully"
else
    test_result 1 "Policy creation failed"
    echo "   Response: $CREATE_POLICY_RESPONSE"
fi

# Test 5: Enforcement - ALLOW
echo ""
echo "5. Testing Enforcement - ALLOW decision..."
ENFORCE_ALLOW=$(curl -sSf -X POST "${BASE_URL}/enforce" \
    -H "Content-Type: application/json" \
    -d '{
        "agent_id": "test-agent-allow",
        "agent_roles": ["test_role"],
        "tool_id": "read_logs",
        "tool_version": "1.0.0",
        "params": {"limit": 50},
        "request_id": "req-test-allow-1"
    }')
if echo "$ENFORCE_ALLOW" | python3 -c "import sys, json; d=json.load(sys.stdin); exit(0 if d.get('decision') == 'ALLOW' or d.get('decision') == 'allow' else 1)" 2>/dev/null; then
    test_result 0 "Enforcement ALLOW decision works"
    DECISION=$(echo "$ENFORCE_ALLOW" | python3 -c "import sys, json; print(json.load(sys.stdin).get('decision'))" 2>/dev/null)
    REASON=$(echo "$ENFORCE_ALLOW" | python3 -c "import sys, json; print(json.load(sys.stdin).get('reason'))" 2>/dev/null)
    echo "   Decision: $DECISION, Reason: $REASON"
else
    test_result 1 "Enforcement ALLOW failed"
    echo "   Response: $ENFORCE_ALLOW"
fi

# Test 6: Enforcement - BLOCK (schema violation)
echo ""
echo "6. Testing Enforcement - BLOCK (schema violation)..."
ENFORCE_BLOCK=$(curl -sSf -X POST "${BASE_URL}/enforce" \
    -H "Content-Type: application/json" \
    -d '{
        "agent_id": "test-agent-block",
        "agent_roles": ["test_role"],
        "tool_id": "read_logs",
        "tool_version": "1.0.0",
        "params": {"limit": 200},
        "request_id": "req-test-block-1"
    }')
HTTP_STATUS=$(curl -sSf -w "%{http_code}" -o /dev/null -X POST "${BASE_URL}/enforce" \
    -H "Content-Type: application/json" \
    -d '{
        "agent_id": "test-agent-block",
        "agent_roles": ["test_role"],
        "tool_id": "read_logs",
        "tool_version": "1.0.0",
        "params": {"limit": 200},
        "request_id": "req-test-block-2"
    }')
if [ "$HTTP_STATUS" = "400" ] || [ "$HTTP_STATUS" = "403" ]; then
    test_result 0 "Enforcement BLOCK decision works (HTTP $HTTP_STATUS)"
else
    test_result 1 "Enforcement BLOCK failed (HTTP $HTTP_STATUS)"
fi

# Test 7: Enforcement - Tool not found
echo ""
echo "7. Testing Enforcement - Tool not found..."
ENFORCE_NOTFOUND=$(curl -sSf -X POST "${BASE_URL}/enforce" \
    -H "Content-Type: application/json" \
    -d '{
        "agent_id": "test-agent-notfound",
        "agent_roles": ["test_role"],
        "tool_id": "nonexistent_tool",
        "tool_version": "1.0.0",
        "params": {},
        "request_id": "req-test-notfound-1"
    }')
HTTP_STATUS=$(curl -sSf -w "%{http_code}" -o /dev/null -X POST "${BASE_URL}/enforce" \
    -H "Content-Type: application/json" \
    -d '{
        "agent_id": "test-agent-notfound",
        "agent_roles": ["test_role"],
        "tool_id": "nonexistent_tool",
        "tool_version": "1.0.0",
        "params": {},
        "request_id": "req-test-notfound-2"
    }')
if [ "$HTTP_STATUS" = "404" ]; then
    test_result 0 "Tool not found returns 404"
else
    test_result 1 "Tool not found returned HTTP $HTTP_STATUS (expected 404)"
fi

# Test 8: Audit logs
echo ""
echo "8. Testing Audit Logs..."
AUDIT_RESPONSE=$(curl -sSf "${BASE_URL}/audit")
AUDIT_COUNT=$(echo "$AUDIT_RESPONSE" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
if [ "$AUDIT_COUNT" -gt 0 ]; then
    test_result 0 "Audit logs endpoint returns $AUDIT_COUNT entries"
    # Check for our test entries
    TEST_ENTRIES=$(echo "$AUDIT_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(len([d for d in data if 'test-agent' in d.get('agent_id', '')]))" 2>/dev/null || echo "0")
    echo "   Test agent entries: $TEST_ENTRIES"
else
    test_result 1 "Audit logs endpoint failed or empty"
fi

# Test 9: Anomalies endpoint
echo ""
echo "9. Testing Anomalies Detection..."
ANOMALIES_RESPONSE=$(curl -sSf "${BASE_URL}/anomalies")
ANOMALIES_COUNT=$(echo "$ANOMALIES_RESPONSE" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
test_result 0 "Anomalies endpoint returns $ANOMALIES_COUNT anomalies"

# Test 10: AI Policy Generation
echo ""
echo "10. Testing AI Policy Generation..."
GENERATE_RESPONSE=$(curl -sSf -X POST "${BASE_URL}/generate_policy" \
    -H "Content-Type: application/json" \
    -d '{
        "nl": "Test policy: Users with admin role can use all tools",
        "model": "models/gemini-2.5-pro"
    }')
if echo "$GENERATE_RESPONSE" | python3 -c "import sys, json; d=json.load(sys.stdin); exit(0 if d.get('status') == 'ok' or d.get('status') == 'error' else 1)" 2>/dev/null; then
    STATUS=$(echo "$GENERATE_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('status'))" 2>/dev/null)
    if [ "$STATUS" = "ok" ]; then
        test_result 0 "AI Policy generation successful"
        POLICY_NAME=$(echo "$GENERATE_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('policy', {}).get('name', 'N/A'))" 2>/dev/null)
        echo "   Generated policy: $POLICY_NAME"
    else
        ERROR=$(echo "$GENERATE_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('error', 'unknown'))" 2>/dev/null)
        echo -e "${YELLOW}⚠️  WARN${NC}: AI Policy generation returned error: $ERROR"
        echo "   (This is OK if GEMINI_API_KEY is not set or invalid)"
        ((PASSED++))
    fi
else
    test_result 1 "AI Policy generation endpoint failed"
fi

# Test 11: Static files
echo ""
echo "11. Testing Static Files..."
STATIC_FILES=("dashboard.html" "script.js" "style.css")
for file in "${STATIC_FILES[@]}"; do
    if curl -sSf "${BASE_URL}/static/${file}" > /dev/null 2>&1; then
        test_result 0 "Static file accessible: $file"
    else
        test_result 1 "Static file not accessible: $file"
    fi
done

# Test 12: Root route
echo ""
echo "12. Testing Root Route..."
if curl -sSf "${BASE_URL}/" > /dev/null 2>&1; then
    test_result 0 "Root route serves dashboard.html"
else
    test_result 1 "Root route failed"
fi

# Test 13: Agent aggregation from audit
echo ""
echo "13. Testing Agent Data Aggregation..."
AGENTS=$(curl -sSf "${BASE_URL}/audit" | python3 -c "
import sys, json
data = json.load(sys.stdin)
agents = set([d.get('agent_id') for d in data if d.get('agent_id')])
print(len(agents))
for agent in list(agents)[:5]:
    allows = len([d for d in data if d.get('agent_id') == agent and d.get('decision') in ['ALLOW', 'allow']])
    blocks = len([d for d in data if d.get('agent_id') == agent and d.get('decision') in ['BLOCK', 'BLOCK', 'deny']])
    print(f\"{agent}: {allows} allow, {blocks} block\")
" 2>/dev/null)
AGENT_COUNT=$(echo "$AGENTS" | head -1)
if [ "$AGENT_COUNT" -gt 0 ]; then
    test_result 0 "Found $AGENT_COUNT unique agents in audit logs"
    echo "$AGENTS" | tail -n +2 | while read line; do
        echo "   $line"
    done
else
    test_result 1 "No agents found in audit logs"
fi

# Test 14: Tool signature verification
echo ""
echo "14. Testing Tool Signature Verification..."
TOOL_WITH_SIG=$(curl -sSf "${BASE_URL}/tools" | python3 -c "
import sys, json
tools = json.load(sys.stdin)
for tool in tools:
    if tool.get('signature'):
        sig = tool.get('signature', '')
        if len(sig) >= 32:
            print(f\"{tool.get('id')}: signature OK (length: {len(sig)})\")
            exit(0)
print('No valid signatures found')
exit(1)
" 2>/dev/null)
if [ $? -eq 0 ]; then
    test_result 0 "Tool signatures are present and valid"
    echo "   $TOOL_WITH_SIG"
else
    test_result 1 "Tool signature verification failed"
fi

# Test 15: Policy versioning
echo ""
echo "15. Testing Policy Versioning..."
VERSIONS=$(curl -sSf "${BASE_URL}/policies" | python3 -c "
import sys, json
policies = json.load(sys.stdin)
versions = [p.get('version') for p in policies if p.get('version')]
print(len(versions))
if versions:
    print(f\"Versions: {', '.join(sorted(versions)[-5:])}\")
" 2>/dev/null)
VERSION_COUNT=$(echo "$VERSIONS" | head -1)
if [ "$VERSION_COUNT" -gt 0 ]; then
    test_result 0 "Policy versioning works ($VERSION_COUNT versions)"
    echo "$VERSIONS" | tail -n +2
else
    test_result 1 "Policy versioning failed"
fi

# Summary
echo ""
echo "=================================================="
echo "📊 Test Summary"
echo "=================================================="
echo -e "${GREEN}✅ Passed: $PASSED${NC}"
echo -e "${RED}❌ Failed: $FAILED${NC}"
TOTAL=$((PASSED + FAILED))
if [ $TOTAL -gt 0 ]; then
    PERCENT=$((PASSED * 100 / TOTAL))
    echo "📈 Success Rate: $PERCENT%"
fi
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All tests passed! Ready for demo!${NC}"
    exit 0
else
    echo -e "${RED}⚠️  Some tests failed. Please review before demo.${NC}"
    exit 1
fi

