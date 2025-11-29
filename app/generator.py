import os
import shlex
import subprocess
import json
import logging
from typing import Tuple, Optional

logger = logging.getLogger(__name__)
SCRIPT_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "scripts", "generate_policy.py")


def run_policy_generator(nl_text: str, model: Optional[str] = None, timeout: int = 60) -> Tuple[bool, dict]:
    """
    Run scripts/generate_policy.py as subprocess and return (ok, payload).
    ok=True => payload is parsed JSON policy
    ok=False => error dict
    """
    if not os.path.exists(SCRIPT_PATH):
        return False, {"error": "script_missing", "detail": SCRIPT_PATH}

    cmd = ["python3", SCRIPT_PATH, "--nl", nl_text]
    if model:
        cmd += ["--model", model]

    env = os.environ.copy()
    logger.debug("Running policy generator: %s", " ".join(shlex.quote(p) for p in cmd))

    try:
        proc = subprocess.run(
            cmd,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout
        )
    except subprocess.TimeoutExpired as e:
        return False, {"error": "timeout", "detail": str(e)}

    stdout = proc.stdout.strip()
    stderr = proc.stderr.strip()

    if proc.returncode != 0:
        return False, {
            "error": "generator_failed",
            "exit_code": proc.returncode,
            "stderr": stderr[:2000],
            "stdout_preview": stdout[:2000]
        }

    try:
        policy = json.loads(stdout)
    except Exception as e:
        return False, {
            "error": "invalid_json",
            "detail": str(e),
            "stdout": stdout[:4000],
            "stderr": stderr[:2000]
        }

    return True, policy
