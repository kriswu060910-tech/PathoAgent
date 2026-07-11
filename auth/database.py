"""SQLite 数据库管理。"""

import json
import sqlite3
from pathlib import Path
from typing import Optional

from .config import DB_PATH


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                display_name TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                user_id INTEGER PRIMARY KEY,
                data TEXT NOT NULL DEFAULT '{}',
                updated_at REAL NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)
        # 迁移：为旧表添加 role / enabled 列
        try:
            cols = [row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()]
            if "role" not in cols:
                conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
            if "enabled" not in cols:
                conn.execute("ALTER TABLE users ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1")
        except sqlite3.OperationalError:
            pass


def create_user(username: str, password_hash: str, salt: str, display_name: str, created_at: float, role: str = "user") -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO users (username, password_hash, salt, display_name, created_at, role) VALUES (?, ?, ?, ?, ?, ?)",
            (username, password_hash, salt, display_name, created_at, role),
        )
        return cur.lastrowid


def find_user(username: str) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        return dict(row) if row else None


def find_user_by_id(user_id: int) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def get_settings(user_id: int) -> Optional[str]:
    with get_conn() as conn:
        row = conn.execute("SELECT data FROM settings WHERE user_id = ?", (user_id,)).fetchone()
        return row["data"] if row else None


def save_settings(user_id: int, data: str, updated_at: float):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO settings (user_id, data, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
            (user_id, data, updated_at),
        )


# --- 管理员函数 ---

def list_users() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, username, display_name, role, enabled, created_at FROM users ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def delete_user(user_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        return cur.rowcount > 0


def update_user_role(user_id: int, role: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
        return cur.rowcount > 0


def update_user_display_name(user_id: int, display_name: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute("UPDATE users SET display_name = ? WHERE id = ?", (display_name, user_id))
        return cur.rowcount > 0


def update_user_password(user_id: int, password_hash: str, salt: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE users SET password_hash = ?, salt = ? WHERE id = ?",
            (password_hash, salt, user_id),
        )
        return cur.rowcount > 0


def update_user_enabled(user_id: int, enabled: bool) -> bool:
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE users SET enabled = ? WHERE id = ?", (int(enabled), user_id)
        )
        return cur.rowcount > 0


def get_user_settings(user_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            return None
        settings_data = conn.execute(
            "SELECT data FROM settings WHERE user_id = ?", (user_id,)
        ).fetchone()
        return {
            "user": {
                "id": row["id"],
                "username": row["username"],
                "display_name": row["display_name"],
                "role": row["role"],
                "enabled": bool(row["enabled"]),
                "created_at": row["created_at"],
            },
            "settings": json.loads(settings_data["data"]) if settings_data else {},
        }


def batch_delete_users(user_ids: list[int]) -> int:
    with get_conn() as conn:
        placeholders = ",".join("?" for _ in user_ids)
        cur = conn.execute(f"DELETE FROM users WHERE id IN ({placeholders})", user_ids)
        return cur.rowcount


def batch_update_enabled(user_ids: list[int], enabled: bool) -> int:
    with get_conn() as conn:
        placeholders = ",".join("?" for _ in user_ids)
        cur = conn.execute(
            f"UPDATE users SET enabled = ? WHERE id IN ({placeholders})",
            [int(enabled)] + user_ids,
        )
        return cur.rowcount