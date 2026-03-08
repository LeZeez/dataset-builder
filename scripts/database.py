"""
SQLite database layer for Synthetic Dataset Generator.

Replaces JSON-per-file storage for conversations, review queue, drafts,
and presets. Provides atomic operations and efficient queries.
"""

import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


DB_PATH = Path('data/dataset.db')
_local = threading.local()


def _get_conn() -> sqlite3.Connection:
    """Get a thread-local SQLite connection."""
    if not hasattr(_local, 'conn') or _local.conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return _local.conn


@contextmanager
def get_db():
    """Context manager for database operations with auto-commit."""
    conn = _get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def init_db():
    """Create all tables if they don't exist."""
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                folder TEXT NOT NULL DEFAULT 'wanted',
                messages TEXT NOT NULL DEFAULT '[]',
                metadata TEXT NOT NULL DEFAULT '{}',
                preview TEXT DEFAULT '',
                turn_count INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_conversations_folder
                ON conversations(folder);
            CREATE INDEX IF NOT EXISTS idx_conversations_created
                ON conversations(folder, created_at DESC);

            CREATE TABLE IF NOT EXISTS tags (
                conversation_id TEXT NOT NULL,
                tag TEXT NOT NULL,
                PRIMARY KEY (conversation_id, tag),
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);

            CREATE TABLE IF NOT EXISTS review_queue (
                id TEXT PRIMARY KEY,
                conversations TEXT NOT NULL DEFAULT '[]',
                raw_text TEXT DEFAULT '',
                metadata TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS drafts (
                session_id TEXT PRIMARY KEY,
                data TEXT NOT NULL DEFAULT '{}',
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS presets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                data TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(type, name)
            );

            CREATE INDEX IF NOT EXISTS idx_presets_type ON presets(type);

            CREATE TABLE IF NOT EXISTS id_counter (
                date_prefix TEXT PRIMARY KEY,
                seq INTEGER NOT NULL DEFAULT 0
            );
        """)


# ============ CONVERSATION ID GENERATION (Atomic) ============

def generate_conversation_id() -> str:
    """Generate a unique conversation ID atomically using SQLite.
    Format: YYYY-MM-DD_NNN
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with get_db() as conn:
        conn.execute(
            "INSERT INTO id_counter (date_prefix, seq) VALUES (?, 0) "
            "ON CONFLICT(date_prefix) DO UPDATE SET seq = seq + 1",
            (today,)
        )
        row = conn.execute(
            "SELECT seq FROM id_counter WHERE date_prefix = ?", (today,)
        ).fetchone()
        seq = row['seq'] + 1  # +1 because we start at 0
        conn.execute(
            "UPDATE id_counter SET seq = ? WHERE date_prefix = ?",
            (seq, today)
        )
    return f"{today}_{seq:03d}"


# ============ CONVERSATIONS ============

def save_conversation(conv_id: str, messages: list, folder: str = 'wanted',
                      metadata: dict = None) -> str:
    """Save a conversation to the database."""
    meta = metadata or {}
    created_at = meta.get('created_at',
                          datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'))
    now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

    # Generate preview from first human message
    preview = ''
    for m in messages:
        if m.get('from') == 'human':
            preview = m.get('value', '')[:80]
            break

    turn_count = len([m for m in messages if m.get('from') in ('human', 'gpt')])

    with get_db() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO conversations
                (id, folder, messages, metadata, preview, turn_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            conv_id, folder,
            json.dumps(messages, ensure_ascii=False),
            json.dumps(meta, ensure_ascii=False),
            preview, turn_count, created_at, now
        ))

        # Update tags
        tags = meta.get('tags', [])
        conn.execute("DELETE FROM tags WHERE conversation_id = ?", (conv_id,))
        for tag in tags:
            conn.execute(
                "INSERT OR IGNORE INTO tags (conversation_id, tag) VALUES (?, ?)",
                (conv_id, tag)
            )

    return conv_id


def get_conversation(conv_id: str, folder: str = None) -> dict | None:
    """Get a single conversation."""
    with get_db() as conn:
        if folder:
            row = conn.execute(
                "SELECT * FROM conversations WHERE id = ? AND folder = ?",
                (conv_id, folder)
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM conversations WHERE id = ?", (conv_id,)
            ).fetchone()

    if not row:
        return None

    return _row_to_conversation(row)


def list_conversations(folder: str = 'wanted', search: str = '',
                       tag: str = '', limit: int = 50,
                       offset: int = 0) -> tuple[list, int]:
    """List conversations with search, tag filter, and pagination.
    Returns (conversations, total_count).
    """
    with get_db() as conn:
        params = [folder]
        where_clauses = ["c.folder = ?"]

        if search:
            where_clauses.append("(c.preview LIKE ? OR c.messages LIKE ? OR c.id LIKE ?)")
            like = f"%{search}%"
            params.extend([like, like, like])

        if tag:
            where_clauses.append(
                "EXISTS (SELECT 1 FROM tags t WHERE t.conversation_id = c.id AND t.tag = ?)"
            )
            params.append(tag)

        where = " AND ".join(where_clauses)

        # Get total count
        count_row = conn.execute(
            f"SELECT COUNT(*) as cnt FROM conversations c WHERE {where}", params
        ).fetchone()
        total = count_row['cnt']

        # Get page
        rows = conn.execute(
            f"""SELECT c.id, c.preview, c.created_at, c.turn_count, c.metadata, c.folder
                FROM conversations c
                WHERE {where}
                ORDER BY c.created_at DESC
                LIMIT ? OFFSET ?""",
            params + [limit, offset]
        ).fetchall()

    conversations = []
    for row in rows:
        meta = json.loads(row['metadata']) if row['metadata'] else {}
        conversations.append({
            'id': row['id'],
            'preview': row['preview'] or row['id'],
            'created_at': row['created_at'],
            'tags': meta.get('tags', []),
            'turns': row['turn_count']
        })

    return conversations, total


def move_conversation(conv_id: str, from_folder: str, to_folder: str) -> bool:
    """Move a conversation between folders."""
    with get_db() as conn:
        result = conn.execute(
            "UPDATE conversations SET folder = ?, updated_at = ? WHERE id = ? AND folder = ?",
            (to_folder, datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
             conv_id, from_folder)
        )
    return result.rowcount > 0


def delete_conversation(conv_id: str, folder: str = None) -> bool:
    """Delete a conversation."""
    with get_db() as conn:
        if folder:
            result = conn.execute(
                "DELETE FROM conversations WHERE id = ? AND folder = ?",
                (conv_id, folder)
            )
        else:
            result = conn.execute(
                "DELETE FROM conversations WHERE id = ?", (conv_id,)
            )
    return result.rowcount > 0


def bulk_delete_conversations(ids: list, folder: str) -> list:
    """Bulk delete conversations, returns list of deleted IDs."""
    deleted = []
    with get_db() as conn:
        for conv_id in ids:
            result = conn.execute(
                "DELETE FROM conversations WHERE id = ? AND folder = ?",
                (conv_id, folder)
            )
            if result.rowcount > 0:
                deleted.append(conv_id)
    return deleted


def bulk_move_conversations(ids: list, from_folder: str, to_folder: str) -> list:
    """Bulk move conversations, returns list of moved IDs."""
    moved = []
    now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    with get_db() as conn:
        for conv_id in ids:
            result = conn.execute(
                "UPDATE conversations SET folder = ?, updated_at = ? WHERE id = ? AND folder = ?",
                (to_folder, now, conv_id, from_folder)
            )
            if result.rowcount > 0:
                moved.append(conv_id)
    return moved


# ============ STATS ============

def get_stats() -> dict:
    """Get dataset statistics efficiently using SQL."""
    with get_db() as conn:
        # Counts by folder
        wanted = conn.execute(
            "SELECT COUNT(*) as cnt FROM conversations WHERE folder = 'wanted'"
        ).fetchone()['cnt']
        rejected = conn.execute(
            "SELECT COUNT(*) as cnt FROM conversations WHERE folder = 'rejected'"
        ).fetchone()['cnt']

        if wanted == 0:
            return {
                'total_conversations': 0,
                'message': 'No conversations found',
                'wanted': wanted,
                'rejected': rejected
            }

        # Get all wanted conversations for detailed stats
        rows = conn.execute(
            "SELECT messages, metadata, created_at FROM conversations WHERE folder = 'wanted'"
        ).fetchall()

        total_messages = 0
        human_messages = 0
        gpt_messages = 0
        system_messages = 0
        human_lengths = []
        gpt_lengths = []
        dates = []
        from collections import Counter
        conversations_by_date = Counter()
        tag_counter = Counter()

        for row in rows:
            messages = json.loads(row['messages'])
            meta = json.loads(row['metadata']) if row['metadata'] else {}
            total_messages += len(messages)

            for msg in messages:
                role = msg.get('from', '')
                value = msg.get('value', '')
                if role == 'human':
                    human_messages += 1
                    human_lengths.append(len(value))
                elif role == 'gpt':
                    gpt_messages += 1
                    gpt_lengths.append(len(value))
                elif role == 'system':
                    system_messages += 1

            created = row['created_at']
            if created:
                try:
                    dt = datetime.fromisoformat(created.replace('Z', '+00:00'))
                    date_str = dt.strftime('%Y-%m-%d')
                    conversations_by_date[date_str] += 1
                    dates.append(dt)
                except Exception:
                    pass

            for tag in meta.get('tags', []):
                tag_counter[tag] += 1

        stats = {
            'total_conversations': wanted,
            'total_messages': total_messages,
            'human_messages': human_messages,
            'gpt_messages': gpt_messages,
            'system_messages': system_messages,
            'avg_messages_per_conv': round(total_messages / wanted, 2) if wanted else 0,
            'avg_human_msg_length': round(sum(human_lengths) / len(human_lengths), 2) if human_lengths else 0,
            'avg_gpt_msg_length': round(sum(gpt_lengths) / len(gpt_lengths), 2) if gpt_lengths else 0,
            'conversations_by_date': dict(conversations_by_date),
            'tags': dict(tag_counter),
            'earliest': min(dates).isoformat() if dates else None,
            'latest': max(dates).isoformat() if dates else None,
            'wanted': wanted,
            'rejected': rejected
        }
        return stats


# ============ TAGS ============

def get_all_tags() -> list:
    """Get all unique tags."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT DISTINCT tag FROM tags ORDER BY tag"
        ).fetchall()
    return [row['tag'] for row in rows]


# ============ REVIEW QUEUE ============

def add_to_review_queue(items: list) -> list:
    """Add items to the review queue. Returns list of added entries."""
    added = []
    now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    with get_db() as conn:
        for item in items:
            entry_id = str(uuid.uuid4())
            entry = {
                'id': entry_id,
                'conversations': item.get('conversations', []),
                'rawText': item.get('rawText', ''),
                'metadata': item.get('metadata', {}),
                'createdAt': now
            }
            conn.execute("""
                INSERT INTO review_queue (id, conversations, raw_text, metadata, created_at)
                VALUES (?, ?, ?, ?, ?)
            """, (
                entry_id,
                json.dumps(entry['conversations'], ensure_ascii=False),
                entry['rawText'],
                json.dumps(entry['metadata'], ensure_ascii=False),
                now
            ))
            added.append(entry)
    return added


def get_review_queue(limit: int = 0, offset: int = 0) -> tuple[list, int]:
    """Get review queue items. Returns (items, total_count)."""
    with get_db() as conn:
        total = conn.execute("SELECT COUNT(*) as cnt FROM review_queue").fetchone()['cnt']

        query = "SELECT * FROM review_queue ORDER BY created_at ASC"
        params = []
        if limit > 0:
            query += " LIMIT ? OFFSET ?"
            params = [limit, offset]

        rows = conn.execute(query, params).fetchall()

    items = []
    for row in rows:
        items.append({
            'id': row['id'],
            'conversations': json.loads(row['conversations']),
            'rawText': row['raw_text'],
            'metadata': json.loads(row['metadata']),
            'createdAt': row['created_at']
        })
    return items, total


def remove_from_review_queue(item_id: str) -> bool:
    """Remove an item from the review queue."""
    with get_db() as conn:
        result = conn.execute(
            "DELETE FROM review_queue WHERE id = ?", (item_id,)
        )
    return result.rowcount > 0


def bulk_remove_from_review_queue(ids: list) -> int:
    """Bulk remove items. Returns count removed."""
    with get_db() as conn:
        placeholders = ','.join('?' * len(ids))
        result = conn.execute(
            f"DELETE FROM review_queue WHERE id IN ({placeholders})", ids
        )
    return result.rowcount


def clear_review_queue():
    """Clear the entire review queue."""
    with get_db() as conn:
        conn.execute("DELETE FROM review_queue")


def get_review_queue_items_by_ids(ids: list) -> list:
    """Get specific review queue items by IDs."""
    with get_db() as conn:
        placeholders = ','.join('?' * len(ids))
        rows = conn.execute(
            f"SELECT * FROM review_queue WHERE id IN ({placeholders})", ids
        ).fetchall()

    items = []
    for row in rows:
        items.append({
            'id': row['id'],
            'conversations': json.loads(row['conversations']),
            'rawText': row['raw_text'],
            'metadata': json.loads(row['metadata']),
            'createdAt': row['created_at']
        })
    return items


# ============ DRAFTS ============

def save_draft(session_id: str, data: dict):
    """Save a draft for a session."""
    now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    with get_db() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO drafts (session_id, data, updated_at)
            VALUES (?, ?, ?)
        """, (session_id, json.dumps(data, ensure_ascii=False), now))


def get_draft(session_id: str = None) -> dict:
    """Get draft(s). If session_id is None, returns all drafts merged."""
    with get_db() as conn:
        if session_id:
            row = conn.execute(
                "SELECT data, updated_at FROM drafts WHERE session_id = ?",
                (session_id,)
            ).fetchone()
            if row:
                data = json.loads(row['data'])
                data['_updated'] = row['updated_at']
                return data
            return {}
        else:
            # Return the most recent draft
            row = conn.execute(
                "SELECT data, updated_at FROM drafts ORDER BY updated_at DESC LIMIT 1"
            ).fetchone()
            if row:
                data = json.loads(row['data'])
                data['_updated'] = row['updated_at']
                return data
            return {}


# ============ PRESETS ============

def get_presets(preset_type: str) -> list:
    """Get all presets of a given type."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT name, data FROM presets WHERE type = ? ORDER BY name",
            (preset_type,)
        ).fetchall()
    return [{'name': row['name'], **json.loads(row['data'])} for row in rows]


def save_preset(preset_type: str, name: str, data: dict,
                overwrite: bool = True) -> bool:
    """Save a preset. Returns False if exists and overwrite=False."""
    now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM presets WHERE type = ? AND name = ?",
            (preset_type, name)
        ).fetchone()

        if existing:
            if not overwrite:
                return False
            conn.execute(
                "UPDATE presets SET data = ?, updated_at = ? WHERE type = ? AND name = ?",
                (json.dumps(data, ensure_ascii=False), now, preset_type, name)
            )
        else:
            conn.execute(
                "INSERT INTO presets (type, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (preset_type, name, json.dumps(data, ensure_ascii=False), now, now)
            )
    return True


def delete_preset(preset_type: str, name: str) -> bool:
    """Delete a preset."""
    with get_db() as conn:
        result = conn.execute(
            "DELETE FROM presets WHERE type = ? AND name = ?",
            (preset_type, name)
        )
    return result.rowcount > 0


# ============ MIGRATION ============

def migrate_json_conversations(data_dir: Path):
    """Import existing JSON conversation files into SQLite."""
    for folder in ('wanted', 'rejected'):
        folder_path = data_dir / folder
        if not folder_path.exists():
            continue

        for json_file in folder_path.glob('*.json'):
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    conv = json.load(f)

                conv_id = conv.get('id', json_file.stem)
                messages = conv.get('conversations', [])
                metadata = conv.get('metadata', {})

                # Check if already imported
                with get_db() as conn:
                    existing = conn.execute(
                        "SELECT id FROM conversations WHERE id = ?", (conv_id,)
                    ).fetchone()

                if not existing:
                    save_conversation(conv_id, messages, folder, metadata)
            except (json.JSONDecodeError, Exception) as e:
                print(f"[Migration] Skipping {json_file}: {e}")


def migrate_review_queue(data_dir: Path):
    """Import existing review_queue.json into SQLite."""
    queue_path = data_dir / 'review_queue.json'
    if not queue_path.exists():
        return

    try:
        with open(queue_path, 'r', encoding='utf-8') as f:
            queue = json.load(f)

        if not isinstance(queue, list) or not queue:
            return

        # Check if already migrated
        with get_db() as conn:
            count = conn.execute("SELECT COUNT(*) as cnt FROM review_queue").fetchone()['cnt']
        if count > 0:
            return

        with get_db() as conn:
            for item in queue:
                conn.execute("""
                    INSERT OR IGNORE INTO review_queue (id, conversations, raw_text, metadata, created_at)
                    VALUES (?, ?, ?, ?, ?)
                """, (
                    item.get('id', str(uuid.uuid4())),
                    json.dumps(item.get('conversations', []), ensure_ascii=False),
                    item.get('rawText', ''),
                    json.dumps(item.get('metadata', {}), ensure_ascii=False),
                    item.get('createdAt', datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'))
                ))
    except (json.JSONDecodeError, Exception) as e:
        print(f"[Migration] Skipping review queue: {e}")


def migrate_presets_from_config(config: dict):
    """Import presets from config.json into SQLite."""
    now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

    for preset_type, config_key, data_key in [
        ('chat', 'chat_presets', 'prompt'),
        ('export', 'export_presets', 'prompt'),
        ('variable', 'variable_presets', 'values'),
    ]:
        presets = config.get(config_key, [])
        if not presets:
            continue

        # Check if already migrated
        existing = get_presets(preset_type)
        if existing:
            continue

        for preset in presets:
            name = preset.get('name', '')
            if not name:
                continue
            data = {data_key: preset.get(data_key, '' if data_key == 'prompt' else {})}
            save_preset(preset_type, name, data)


def migrate_drafts(data_dir: Path):
    """Import existing drafts.json into SQLite."""
    drafts_path = data_dir / 'drafts.json'
    if not drafts_path.exists():
        return

    try:
        with open(drafts_path, 'r', encoding='utf-8') as f:
            drafts = json.load(f)

        if not drafts:
            return

        session_id = drafts.get('_sessionId', 'migrated')
        save_draft(session_id, drafts)
    except (json.JSONDecodeError, Exception) as e:
        print(f"[Migration] Skipping drafts: {e}")


def run_migrations(data_dir: Path, config: dict):
    """Run all migrations from JSON files to SQLite."""
    init_db()
    migrate_json_conversations(data_dir)
    migrate_review_queue(data_dir)
    migrate_presets_from_config(config)
    migrate_drafts(data_dir)
    print("[Migration] Database migration complete.")


def _row_to_conversation(row) -> dict:
    """Convert a database row to a conversation dict."""
    return {
        'id': row['id'],
        'conversations': json.loads(row['messages']),
        'metadata': json.loads(row['metadata']) if row['metadata'] else {}
    }
