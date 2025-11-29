import json
import time
from datetime import datetime, timedelta
from flask import Blueprint, jsonify
from .utils import get_db

class AuditorService:
    def __init__(self):
        self.blueprint = Blueprint("auditor", __name__)
        self.blueprint.add_url_rule("/anomalies", "list_anomalies", self.list_anomalies, methods=["GET"])

    def run(self, app):
        with app.app_context():
            while True:
                self._scan()
                time.sleep(5)

    def _scan(self):
        db = get_db()
        cutoff = (datetime.utcnow() - timedelta(minutes=1)).isoformat()
        rows = db.execute(
            """
            SELECT agent_id, COUNT(*) as cnt
            FROM audit_logs
            WHERE decision='BLOCK' AND created_at >= ?
            GROUP BY agent_id
            HAVING cnt >= 3
            """,
            (cutoff,),
        ).fetchall()
        for row in rows:
            db.execute(
                """
                INSERT INTO anomalies (agent_id, detail, created_at)
                VALUES (?, ?, ?)
                """,
                (
                    row["agent_id"],
                    json.dumps({"blocks_last_minute": row["cnt"]}),
                    datetime.utcnow().isoformat(),
                ),
            )
        db.commit()

    def list_anomalies(self):
        db = get_db()
        rows = db.execute("SELECT * FROM anomalies ORDER BY created_at DESC").fetchall()
        return jsonify([dict(row) for row in rows])
