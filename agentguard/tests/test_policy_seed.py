import importlib
import os
import sys

import pytest

MODULES = [
    "app.utils",
    "app.policy_store",
    "app.tool_registry",
    "app.enforcement",
    "app.auditor",
    "app.main",
]


def reload_modules():
    for name in MODULES:
        if name in sys.modules:
            importlib.reload(sys.modules[name])
        else:
            importlib.import_module(name)


@pytest.fixture
def app_context(tmp_path, monkeypatch):
    db_path = tmp_path / "seed.db"
    monkeypatch.setenv("DATABASE_FILE", str(db_path))
    reload_modules()
    from app.utils import init_db_command
    init_db_command()
    from app import create_app
    app = create_app()
    with app.app_context():
        yield


def test_demo_policy_seed(app_context):
    from app.policy_store import seed_demo_policy
    from app.utils import get_db

    seed_demo_policy()
    db = get_db()
    count = db.execute("SELECT COUNT(*) as cnt FROM policies").fetchone()["cnt"]
    assert count == 1
    history_count = db.execute("SELECT COUNT(*) as cnt FROM policy_version_history").fetchone()["cnt"]
    assert history_count == 1

    seed_demo_policy()
    count_after = db.execute("SELECT COUNT(*) as cnt FROM policies").fetchone()["cnt"]
    assert count_after == 1

