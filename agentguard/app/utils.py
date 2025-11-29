import hashlib
import hmac
import json
import os
import sqlite3
from flask import g

def db_path() -> str:
    return os.getenv("DATABASE_FILE", "agentguard.db")

def open_db():
    conn = sqlite3.connect(db_path())
    conn.row_factory = sqlite3.Row
    return conn

def get_db():
    if "db" not in g:
        g.db = open_db()
    return g.db

def close_db(e=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()

def init_db_command():
    conn = open_db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS policies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version TEXT UNIQUE,
            name TEXT,
            rules TEXT,
            created_by TEXT,
            signature_placeholder TEXT,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id TEXT,
            agent_id TEXT,
            roles TEXT,
            tool_id TEXT,
            tool_version TEXT,
            params_hash TEXT,
            decision TEXT,
            reason TEXT,
            policy_version TEXT,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS tools (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tool_id TEXT,
            version TEXT,
            definition TEXT,
            UNIQUE(tool_id, version)
        );
        CREATE TABLE IF NOT EXISTS anomalies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT,
            detail TEXT,
            created_at TEXT
        );
        """
    )
    conn.commit()
    conn.close()

def sign_tool(tool_id: str, version: str, schema: dict) -> str:
    secret = os.getenv("ENFORCEMENT_HMAC_KEY", "dev-secret").encode()
    payload = f"{tool_id}|{version}|{json.dumps(schema, sort_keys=True)}".encode()
    return hmac.new(secret, payload, hashlib.sha256).hexdigest()

if __name__ == "__main__":
    init_db_command()
