#!/bin/bash
set -euo pipefail

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -r requirements.txt
export FLASK_APP=app.main
export FLASK_ENV=development
export ENFORCEMENT_HMAC_KEY=${ENFORCEMENT_HMAC_KEY:-"dev-secret"}
export GEMINI_API_KEY=${GEMINI_API_KEY:-""}
export AGENTGUARD_PORT=${AGENTGUARD_PORT:-5073}
python -m app.main
