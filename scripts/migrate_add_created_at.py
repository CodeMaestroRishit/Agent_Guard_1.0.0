import json
import sqlite3
from datetime import datetime, timezone

from app.utils import db_path


def run() -> None:
    """Add created_at column to policies if missing and backfill."""
    path = db_path()
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("PRAGMA table_info(policies)")
    cols = [row["name"] for row in cur.fetchall()]
    if "created_at" not in cols:
        cur.execute("ALTER TABLE policies ADD COLUMN created_at TEXT")
        conn.commit()

    now = datetime.utcnow().isoformat()
    cur.execute("UPDATE policies SET created_at = ? WHERE created_at IS NULL OR created_at = ''", (now,))
    conn.commit()
    conn.close()


if __name__ == "__main__":
    run()


