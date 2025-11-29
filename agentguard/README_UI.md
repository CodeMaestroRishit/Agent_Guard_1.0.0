# AgentGuard UI Guide

## Quick Start

1. **Start the server:**
   ```bash
   export ENFORCEMENT_HMAC_KEY="your-secret-key"
   export GEMINI_API_KEY="your-gemini-key"  # Optional, for AI Policy tab
   PORT=5073 python3 -m app.main
   ```

2. **Open the dashboard:**
   Navigate to `http://localhost:5073/static/dashboard.html` in your browser.

## Features

- **Overview Tab**: Main dashboard with Agents/Tools sidebar and audit logs table. Click agents or tools to filter the audit table.

- **AI Policy Tab**: Generate policies from natural language using Gemini. Type a description (e.g., "Auditors may read logs but cannot modify policies"), select a model, click Generate, then Apply to deploy.

- **Tabs**: Switch between Overview, Anomalies, Policies, Tools, Simulator, and AI Policy using the top navigation.

- **Sidebar**: Collapsible sidebar on Overview tab shows agents and tools. Click any item to filter the audit table.

## Testing

Run the frontend smoke tests:
```bash
./scripts/test_frontend.sh
```

This verifies static files are accessible and counts unique agents/tools from the API.

