import json
import os
import subprocess
import sys

import pytest


def test_generate_policy_offline(monkeypatch, tmp_path):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    script_path = os.path.join(os.path.dirname(__file__), "..", "scripts", "generate_policy.py")
    cmd = [sys.executable, script_path, "--nl", "Readers may view logs but not modify policies."]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)

    data = json.loads(result.stdout)
    assert "rules" in data
    assert "assumptions" in data

