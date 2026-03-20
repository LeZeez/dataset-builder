"""SQLite database layer for Synthetic Dataset Builder."""

import json
import os
import re
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


_DEFAULT_DB_PATH = Path('data/dataset.db')
DB_PATH = Path(os.environ.get('DATASET_BUILDER_DB_PATH') or _DEFAULT_DB_PATH)
_local = threading.local()
_SEARCH_TEXT_LIMIT = 4000


def set_db_path(path: str | Path):
    """Set the SQLite database file path for subsequent connections.

    Notes:
    - This only affects new connections. Existing connections in other threads
      cannot be force-closed from here due to thread-local storage.
    - Intended for local usage; avoid exposing config mutation to untrusted users.
    """
    global DB_PATH
    DB_PATH = Path(path)
    close_db()


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


def close_db():
    """Close the current thread-local connection, if any."""
    conn = getattr(_local, 'conn', None)
    if conn is not None:
        conn.close()
        _local.conn = None


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
                search_text TEXT NOT NULL DEFAULT '',
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

            CREATE INDEX IF NOT EXISTS idx_review_queue_created_at
                ON review_queue(created_at);

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

            CREATE TABLE IF NOT EXISTS api_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT ''
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS review_queue_fts USING fts5(
                id UNINDEXED,
                raw_text,
                content='review_queue',
                content_rowid='rowid'
            );

            CREATE TRIGGER IF NOT EXISTS review_queue_ai AFTER INSERT ON review_queue BEGIN
                INSERT INTO review_queue_fts(rowid, id, raw_text)
                VALUES (new.rowid, new.id, new.raw_text);
            END;

            CREATE TRIGGER IF NOT EXISTS review_queue_ad AFTER DELETE ON review_queue BEGIN
                INSERT INTO review_queue_fts(review_queue_fts, rowid, id, raw_text)
                VALUES ('delete', old.rowid, old.id, old.raw_text);
            END;

            CREATE TRIGGER IF NOT EXISTS review_queue_au AFTER UPDATE ON review_queue BEGIN
                INSERT INTO review_queue_fts(review_queue_fts, rowid, id, raw_text)
                VALUES ('delete', old.rowid, old.id, old.raw_text);
                INSERT INTO review_queue_fts(rowid, id, raw_text)
                VALUES (new.rowid, new.id, new.raw_text);
            END;

            CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(
                id UNINDEXED,
                folder UNINDEXED,
                preview,
                search_text,
                messages,
                content='conversations',
                content_rowid='rowid'
            );

            CREATE TRIGGER IF NOT EXISTS conversations_ai AFTER INSERT ON conversations BEGIN
                INSERT INTO conversations_fts(rowid, id, folder, preview, search_text, messages)
                VALUES (new.rowid, new.id, new.folder, new.preview, new.search_text, new.messages);
            END;

            CREATE TRIGGER IF NOT EXISTS conversations_ad AFTER DELETE ON conversations BEGIN
                INSERT INTO conversations_fts(conversations_fts, rowid, id, folder, preview, search_text, messages)
                VALUES ('delete', old.rowid, old.id, old.folder, old.preview, old.search_text, old.messages);
            END;

            CREATE TRIGGER IF NOT EXISTS conversations_au AFTER UPDATE ON conversations BEGIN
                INSERT INTO conversations_fts(conversations_fts, rowid, id, folder, preview, search_text, messages)
                VALUES ('delete', old.rowid, old.id, old.folder, old.preview, old.search_text, old.messages);
                INSERT INTO conversations_fts(rowid, id, folder, preview, search_text, messages)
                VALUES (new.rowid, new.id, new.folder, new.preview, new.search_text, new.messages);
            END;
        """)
        _ensure_column(conn, 'conversations', 'search_text', "TEXT NOT NULL DEFAULT ''")
        _backfill_conversation_search_text(conn)
        _backfill_review_queue_fts(conn)
        _backfill_conversations_fts(conn)


# ============ CONVERSATION ID GENERATION (Atomic) ============

def _next_conversation_id(conn: sqlite3.Connection) -> str:
    """Generate a unique conversation ID using the current transaction."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    conn.execute(
        "INSERT INTO id_counter (date_prefix, seq) VALUES (?, 1) "
        "ON CONFLICT(date_prefix) DO UPDATE SET seq = seq + 1",
        (today,)
    )
    row = conn.execute(
        "SELECT seq FROM id_counter WHERE date_prefix = ?", (today,)
    ).fetchone()
    seq = row['seq']
    return f"{today}_{seq:03d}"

def _next_conversation_ids(conn: sqlite3.Connection, count: int) -> list[str]:
    """Generate a batch of unique conversation IDs."""
    if count <= 0:
        return []
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    conn.execute(
        "INSERT INTO id_counter (date_prefix, seq) VALUES (?, ?) "
        "ON CONFLICT(date_prefix) DO UPDATE SET seq = seq + ?",
        (today, count, count)
    )
    row = conn.execute(
        "SELECT seq FROM id_counter WHERE date_prefix = ?", (today,)
    ).fetchone()
    end_seq = row['seq']
    start_seq = end_seq - count + 1
    return [f"{today}_{seq:03d}" for seq in range(start_seq, end_seq + 1)]


def generate_conversation_id() -> str:
    """Generate a unique conversation ID atomically using SQLite.
    Format: YYYY-MM-DD_NNN
    """
    with get_db() as conn:
        return _next_conversation_id(conn)


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
    search_text = _build_search_text(messages)

    with get_db() as conn:
        _save_conversation_record(
            conn=conn,
            conv_id=conv_id,
            folder=folder,
            messages=messages,
            metadata=meta,
            preview=preview,
            search_text=search_text,
            turn_count=turn_count,
            created_at=created_at,
            updated_at=now,
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
        search_str = (search or '').strip()
        tokens: list[str] = []

        if search_str:
            # Prefer FTS5 instead of slow LIKE scans over large JSON blobs.
            safe_search = search_str.replace('"', '""').strip()
            # Tokenize on non-word boundaries so searches like "late-needle-xyz" still match.
            tokens = [t for t in re.findall(r'\w+', safe_search, flags=re.UNICODE) if t]
            if tokens:
                fts_query = " AND ".join([f"\"{t}\"*" for t in tokens])
            else:
                # Fallback: treat the whole thing as a phrase prefix query.
                fts_query = f"\"{safe_search}\"*"
            where_clauses.append("c.rowid IN (SELECT rowid FROM conversations_fts WHERE conversations_fts MATCH ?)")
            params.append(fts_query)

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

        # Extremely long single-token strings can prevent FTS from indexing the user's
        # search substring. As a narrow fallback, retry a literal substring scan but only
        # within a bounded FTS candidate set to avoid full-table JSON LIKE scans.
        if (
            total == 0
            and search_str
            and tokens
            and re.search(r"[^\w\s]", search_str, flags=re.UNICODE)
        ):
            relaxed_fts_query = " OR ".join([f"\"{t}\"*" for t in tokens])
            candidate_cnt_row = conn.execute(
                "SELECT COUNT(*) as cnt FROM conversations_fts WHERE conversations_fts MATCH ?",
                (relaxed_fts_query,)
            ).fetchone()
            candidate_cnt = candidate_cnt_row['cnt']

            # Skip fallback if the relaxed query is too broad (protects large DBs).
            if candidate_cnt > 0 and candidate_cnt <= 5000:
                def _escape_like(value: str) -> str:
                    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

                like_param = f"%{_escape_like(search_str)}%"
                like_params = [folder, relaxed_fts_query, like_param, like_param]
                like_where_clauses = [
                    "c.folder = ?",
                    "c.rowid IN (SELECT rowid FROM conversations_fts WHERE conversations_fts MATCH ?)",
                    "(c.search_text LIKE ? ESCAPE '\\' OR c.messages LIKE ? ESCAPE '\\')",
                ]

                if tag:
                    like_where_clauses.append(
                        "EXISTS (SELECT 1 FROM tags t WHERE t.conversation_id = c.id AND t.tag = ?)"
                    )
                    like_params.append(tag)

                like_where = " AND ".join(like_where_clauses)
                count_row = conn.execute(
                    f"SELECT COUNT(*) as cnt FROM conversations c WHERE {like_where}", like_params
                ).fetchone()
                total = count_row['cnt']
                if total > 0:
                    where = like_where
                    params = like_params

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
        if result.rowcount > 0:
            _invalidate_stats_cache()
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
        if result.rowcount > 0:
            _invalidate_stats_cache()
    return result.rowcount > 0


def bulk_delete_conversations(ids: list, folder: str) -> list:
    """Bulk delete conversations, returns list of deleted IDs."""
    if not ids:
        return []

    placeholders = ','.join('?' * len(ids))
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT id FROM conversations WHERE folder = ? AND id IN ({placeholders})",
            [folder, *ids]
        ).fetchall()
        matched_ids = {row['id'] for row in rows}
        deleted_ids = []
        seen_ids = set()
        for conv_id in ids:
            if conv_id in matched_ids and conv_id not in seen_ids:
                deleted_ids.append(conv_id)
                seen_ids.add(conv_id)

        if deleted_ids:
            deleted_placeholders = ','.join('?' * len(deleted_ids))
            conn.execute(
                f"DELETE FROM conversations WHERE folder = ? AND id IN ({deleted_placeholders})",
                [folder, *deleted_ids]
            )
            _invalidate_stats_cache()

    return deleted_ids


def bulk_move_conversations(ids: list, from_folder: str, to_folder: str) -> list:
    """Bulk move conversations, returns list of moved IDs."""
    if not ids:
        return []

    now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    placeholders = ','.join('?' * len(ids))
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT id FROM conversations WHERE folder = ? AND id IN ({placeholders})",
            [from_folder, *ids]
        ).fetchall()
        matched_ids = {row['id'] for row in rows}
        moved_ids = []
        seen_ids = set()
        for conv_id in ids:
            if conv_id in matched_ids and conv_id not in seen_ids:
                moved_ids.append(conv_id)
                seen_ids.add(conv_id)

        if moved_ids:
            moved_placeholders = ','.join('?' * len(moved_ids))
            conn.execute(
                f"""UPDATE conversations
                    SET folder = ?, updated_at = ?
                    WHERE folder = ? AND id IN ({moved_placeholders})""",
                [to_folder, now, from_folder, *moved_ids]
            )
            _invalidate_stats_cache()

    return moved_ids


# ============ STATS ============

def get_conversation_counts() -> dict:
    """Get lightweight saved/rejected counts for the main UI."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT folder, COUNT(*) as cnt FROM conversations GROUP BY folder"
        ).fetchall()
    counts = {row['folder']: row['cnt'] for row in rows}
    return {
        'wanted': counts.get('wanted', 0),
        'rejected': counts.get('rejected', 0),
    }

_stats_cache = {
    'stats': None,
    'last_updated': None
}

def _invalidate_stats_cache():
    """Invalidate the stats cache when data changes."""
    _stats_cache['stats'] = None
    _stats_cache['last_updated'] = None

def get_stats() -> dict:
    """Get dataset statistics efficiently using SQL and caching."""
    counts = get_conversation_counts()
    wanted = counts['wanted']
    rejected = counts['rejected']

    with get_db() as conn:
        if wanted == 0:
            return {
                'total_conversations': 0,
                'message': 'No conversations found',
                'wanted': wanted,
                'rejected': rejected
            }

        # Check if cache is still valid
        # We use a simple heuristic: if the wanted/rejected counts haven't changed
        # AND we have cached stats, return the cached stats.
        # This isn't perfect (edits within a conversation won't update stats immediately),
        # but it's vastly faster for UI refresh paths.
        if _stats_cache['stats'] is not None and \
           _stats_cache['stats']['wanted'] == wanted and \
           _stats_cache['stats']['rejected'] == rejected:
             return _stats_cache['stats']

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
        _stats_cache['stats'] = stats
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


def get_review_queue(limit: int = 0, offset: int = 0, search: str = '') -> tuple[list, int]:
    """Get review queue items. Returns (items, total_count)."""
    where_clause = ""
    params: list = []

    with get_db() as conn:
        total = _get_review_queue_count(conn, search=search)

        if search:
            query_fts = """
                SELECT r.* FROM review_queue r
                JOIN review_queue_fts f ON r.rowid = f.rowid
                WHERE review_queue_fts MATCH ?
                ORDER BY r.created_at ASC, r.rowid ASC
            """
            # FTS5 matches tokens, escape simple quotes
            safe_search = search.replace('"', '""')
            params.append(f'"{safe_search}"*')
            if limit > 0:
                query_fts += " LIMIT ? OFFSET ?"
                params.extend([limit, offset])
            rows = conn.execute(query_fts, params).fetchall()
        else:
            query = f"SELECT rowid, * FROM review_queue ORDER BY created_at ASC, rowid ASC"
            if limit > 0:
                query += " LIMIT ? OFFSET ?"
                params.extend([limit, offset])
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


def get_review_queue_ids(limit: int = 0, offset: int = 0, search: str = '') -> tuple[list[str], int]:
    """Get review queue IDs only. Returns (ids, total_count)."""
    params: list = []
    with get_db() as conn:
        total = _get_review_queue_count(conn, search=search)

        if search:
            query = """
                SELECT r.id FROM review_queue r
                JOIN review_queue_fts f ON r.rowid = f.rowid
                WHERE review_queue_fts MATCH ?
                ORDER BY r.created_at ASC, r.rowid ASC
            """
            safe_search = search.replace('"', '""')
            params.append(f'"{safe_search}"*')
            if limit > 0:
                query += " LIMIT ? OFFSET ?"
                params.extend([limit, offset])
            rows = conn.execute(query, params).fetchall()
        else:
            query = "SELECT id FROM review_queue ORDER BY created_at ASC, rowid ASC"
            if limit > 0:
                query += " LIMIT ? OFFSET ?"
                params.extend([limit, offset])
            rows = conn.execute(query, params).fetchall()

    return [row['id'] for row in rows], total


def get_review_queue_position(item_id: str) -> tuple[int, int] | None:
    """Return (0-based position, total_count) for a review queue item id."""
    if not item_id:
        return None
    with get_db() as conn:
        row = conn.execute(
            "SELECT rowid, created_at FROM review_queue WHERE id = ?",
            (item_id,)
        ).fetchone()
        if not row:
            return None
        created_at = row['created_at']
        rowid = row['rowid']
        pos_row = conn.execute(
            """
            SELECT COUNT(*) as c FROM review_queue
            WHERE (created_at < ?) OR (created_at = ? AND rowid < ?)
            """,
            (created_at, created_at, rowid)
        ).fetchone()
        position = int(pos_row['c']) if pos_row else 0
        total = _get_review_queue_count(conn, search='')
        return position, total


def remove_from_review_queue(item_id: str) -> bool:
    """Remove an item from the review queue."""
    with get_db() as conn:
        result = conn.execute(
            "DELETE FROM review_queue WHERE id = ?", (item_id,)
        )
    return result.rowcount > 0


def update_review_queue_item(item_id: str, conversations: list, raw_text: str, metadata: dict | None = None) -> bool:
    """Update a review queue item in place after inline review edits."""
    with get_db() as conn:
        result = conn.execute(
            """UPDATE review_queue
               SET conversations = ?, raw_text = ?, metadata = ?
               WHERE id = ?""",
            (
                json.dumps(conversations, ensure_ascii=False),
                raw_text,
                json.dumps(metadata or {}, ensure_ascii=False),
                item_id
            )
        )
    return result.rowcount > 0


def bulk_remove_from_review_queue(ids: list) -> list[str]:
    """Bulk remove review queue items, returns list of deleted IDs (preserves request order)."""
    if not ids:
        return []

    unique_ids: list[str] = []
    seen: set[str] = set()
    for raw_id in ids:
        if not isinstance(raw_id, str) or not raw_id:
            continue
        if raw_id in seen:
            continue
        unique_ids.append(raw_id)
        seen.add(raw_id)

    if not unique_ids:
        return []

    placeholders = ','.join('?' * len(unique_ids))
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT id FROM review_queue WHERE id IN ({placeholders})",
            unique_ids,
        ).fetchall()
        matched_ids = {row['id'] for row in rows}

        deleted_ids = [item_id for item_id in unique_ids if item_id in matched_ids]
        if deleted_ids:
            deleted_placeholders = ','.join('?' * len(deleted_ids))
            conn.execute(
                f"DELETE FROM review_queue WHERE id IN ({deleted_placeholders})",
                deleted_ids,
            )

    return deleted_ids


def clear_review_queue():
    """Clear the entire review queue."""
    with get_db() as conn:
        conn.execute("DELETE FROM review_queue")


def get_review_queue_items_by_ids(ids: list) -> list:
    """Get specific review queue items by IDs."""
    if not ids:
        return []
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


def get_review_queue_count(search: str = '') -> int:
    """Get the review queue count without loading all queue rows."""
    with get_db() as conn:
        return _get_review_queue_count(conn, search=search)


def persist_review_queue_items(ids: list[str] | None, target_folder: str) -> tuple[list, list, int]:
    """Persist review queue items into conversations and remove them atomically in batches."""
    saved = []
    errors = []
    error_ids: set[str] = set()
    now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

    with get_db() as conn:
        if ids is None:
            # Persist all items without loading the entire queue into memory at once.
            page_size = 200
            while True:
                # Always take the oldest page, then delete it after persisting so we never
                # re-scan with OFFSET, and we don't accidentally delete new rows added later.
                rows = conn.execute(
                    "SELECT rowid, * FROM review_queue ORDER BY created_at ASC LIMIT ?",
                    (page_size,)
                ).fetchall()
                if not rows:
                    break

                valid_rows: list[tuple] = []
                for row in rows:
                    try:
                        messages = json.loads(row['conversations'])
                    except Exception:
                        if row['id'] not in error_ids:
                            errors.append({'id': row['id'], 'errors': ["Invalid JSON in 'conversations'"]})
                            error_ids.add(row['id'])
                        continue

                    ok, errs = validate_review_item({'id': row['id'], 'conversations': messages})
                    if not ok:
                        if row['id'] not in error_ids:
                            errors.append({'id': row['id'], 'errors': errs})
                            error_ids.add(row['id'])
                        continue
                    valid_rows.append((row, messages))

                # Avoid infinite loops: if the oldest page is entirely invalid, stop and leave them in queue.
                if not valid_rows:
                    break

                conv_ids = _next_conversation_ids(conn, len(valid_rows))
                conv_inserts = []
                tag_inserts = []
                rowids_to_remove: list[int] = []

                for (row, messages), conv_id in zip(valid_rows, conv_ids):
                    rowids_to_remove.append(int(row['rowid']))
                    metadata = json.loads(row['metadata']) if row['metadata'] else {}

                    full_metadata = {
                        'created_at': now,
                        'source': 'synthetic',
                        **metadata
                    }

                    preview = ''
                    for message in messages:
                        if message.get('from') == 'human':
                            preview = message.get('value', '')[:80]
                            break

                    search_text = _build_search_text(messages)
                    turn_count = len([m for m in messages if m.get('from') in ('human', 'gpt')])

                    conv_inserts.append((
                        conv_id, target_folder,
                        json.dumps(messages, ensure_ascii=False),
                        json.dumps(full_metadata, ensure_ascii=False),
                        preview, search_text, turn_count, full_metadata['created_at'], now
                    ))

                    for tag in full_metadata.get('tags', []):
                        tag_inserts.append((conv_id, tag))

                    saved.append({'id': conv_id, 'original_id': row['id']})

                if conv_inserts:
                    conn.executemany("""
                        INSERT OR REPLACE INTO conversations
                            (id, folder, messages, metadata, preview, search_text, turn_count, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, conv_inserts)

                if tag_inserts:
                    conn.executemany(
                        "INSERT OR IGNORE INTO tags (conversation_id, tag) VALUES (?, ?)",
                        tag_inserts
                    )

                if rowids_to_remove:
                    placeholders = ','.join('?' * len(rowids_to_remove))
                    conn.execute(
                        f"DELETE FROM review_queue WHERE rowid IN ({placeholders})",
                        rowids_to_remove
                    )
            _invalidate_stats_cache()

        else:
            unique_ids = list(dict.fromkeys(ids))
            if not unique_ids:
                return [], [], _get_review_queue_count(conn)
            placeholders = ','.join('?' * len(unique_ids))
            rows = conn.execute(
                f"SELECT * FROM review_queue WHERE id IN ({placeholders})",
                unique_ids
            ).fetchall()
            order = {item_id: index for index, item_id in enumerate(unique_ids)}
            rows = sorted(rows, key=lambda row: order.get(row['id'], len(order)))

            valid_rows: list[tuple] = []
            for row in rows:
                try:
                    messages = json.loads(row['conversations'])
                except Exception:
                    if row['id'] not in error_ids:
                        errors.append({'id': row['id'], 'errors': ["Invalid JSON in 'conversations'"]})
                        error_ids.add(row['id'])
                    continue

                ok, errs = validate_review_item({'id': row['id'], 'conversations': messages})
                if not ok:
                    if row['id'] not in error_ids:
                        errors.append({'id': row['id'], 'errors': errs})
                        error_ids.add(row['id'])
                    continue
                valid_rows.append((row, messages))

            conv_ids = _next_conversation_ids(conn, len(valid_rows))
            ids_to_remove = [row['id'] for (row, _messages) in valid_rows]

            conv_inserts = []
            tag_inserts = []

            for (row, messages), conv_id in zip(valid_rows, conv_ids):
                metadata = json.loads(row['metadata']) if row['metadata'] else {}

                full_metadata = {
                    'created_at': now,
                    'source': 'synthetic',
                    **metadata
                }

                preview = ''
                for message in messages:
                    if message.get('from') == 'human':
                        preview = message.get('value', '')[:80]
                        break

                search_text = _build_search_text(messages)
                turn_count = len([m for m in messages if m.get('from') in ('human', 'gpt')])

                conv_inserts.append((
                    conv_id, target_folder,
                    json.dumps(messages, ensure_ascii=False),
                    json.dumps(full_metadata, ensure_ascii=False),
                    preview, search_text, turn_count, full_metadata['created_at'], now
                ))

                for tag in full_metadata.get('tags', []):
                    tag_inserts.append((conv_id, tag))

                saved.append({'id': conv_id, 'original_id': row['id']})

            if conv_inserts:
                # Insert in chunks of 500
                chunk_size = 500
                for i in range(0, len(conv_inserts), chunk_size):
                    chunk = conv_inserts[i:i+chunk_size]
                    conn.executemany("""
                        INSERT OR REPLACE INTO conversations
                            (id, folder, messages, metadata, preview, search_text, turn_count, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, chunk)

            if tag_inserts:
                # Insert in chunks of 500
                chunk_size = 500
                for i in range(0, len(tag_inserts), chunk_size):
                    chunk = tag_inserts[i:i+chunk_size]
                    conn.executemany(
                        "INSERT OR IGNORE INTO tags (conversation_id, tag) VALUES (?, ?)",
                        chunk
                    )

            if ids_to_remove:
                batch_size = 500
                for i in range(0, len(ids_to_remove), batch_size):
                    batch = ids_to_remove[i:i+batch_size]
                    placeholders = ','.join('?' * len(batch))
                    conn.execute(
                        f"DELETE FROM review_queue WHERE id IN ({placeholders})",
                        batch
                    )

            _invalidate_stats_cache()

        remaining = _get_review_queue_count(conn)
    return saved, errors, remaining


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
    """Get the draft for a specific session ID."""
    if not session_id:
        return {}
    with get_db() as conn:
        row = conn.execute(
            "SELECT data, updated_at FROM drafts WHERE session_id = ?",
            (session_id,)
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

def get_preset(preset_type: str, name: str) -> dict | None:
    """Get a single preset by type and name."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT data FROM presets WHERE type = ? AND name = ?",
            (preset_type, name)
        ).fetchone()
    if not row:
        return None
    return json.loads(row['data']) if row['data'] else {}


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


def get_conversations_for_export(folder: str = 'wanted', ids: list | None = None) -> list:
    """Get full conversations for export, preserving requested ID order when provided."""
    with get_db() as conn:
        params = [folder]
        query = """
            SELECT id, messages, metadata
            FROM conversations
            WHERE folder = ?
        """

        if ids is not None:
            if not ids:
                return []
            placeholders = ','.join('?' * len(ids))
            query += f" AND id IN ({placeholders})"
            params.extend(ids)

        query += " ORDER BY created_at DESC"
        rows = conn.execute(query, params).fetchall()

    conversations = []
    for row in rows:
        conversations.append({
            'id': row['id'],
            'conversations': json.loads(row['messages']),
            'metadata': json.loads(row['metadata']) if row['metadata'] else {}
        })

    if ids is not None:
        order = {conv_id: index for index, conv_id in enumerate(ids)}
        conversations.sort(key=lambda conv: order.get(conv['id'], len(order)))

    return conversations


def count_conversations_for_export(folder: str = 'wanted', ids: list[str] | None = None) -> int:
    """Count conversations for export without loading message bodies."""
    with get_db() as conn:
        params: list = [folder]
        query = "SELECT COUNT(*) as c FROM conversations WHERE folder = ?"
        if ids is not None:
            if not ids:
                return 0
            placeholders = ','.join('?' * len(ids))
            query += f" AND id IN ({placeholders})"
            params.extend(ids)
        row = conn.execute(query, params).fetchone()
    return int(row['c']) if row and row['c'] is not None else 0


def iter_conversations_for_export(folder: str = 'wanted', ids: list[str] | None = None):
    """Yield full conversations for export without materializing the entire result set.

    Preserves requested ID order when `ids` is provided.
    """
    conn = _get_conn()
    if ids is not None:
        if not ids:
            return
        for conv_id in ids:
            row = conn.execute(
                "SELECT id, messages, metadata FROM conversations WHERE folder = ? AND id = ?",
                (folder, conv_id),
            ).fetchone()
            if not row:
                continue
            yield {
                'id': row['id'],
                'conversations': json.loads(row['messages']),
                'metadata': json.loads(row['metadata']) if row['metadata'] else {},
            }
        return

    cursor = conn.execute(
        """
        SELECT id, messages, metadata
        FROM conversations
        WHERE folder = ?
        ORDER BY created_at DESC
        """,
        (folder,),
    )
    for row in cursor:
        yield {
            'id': row['id'],
            'conversations': json.loads(row['messages']),
            'metadata': json.loads(row['metadata']) if row['metadata'] else {},
        }

def seed_default_presets(defaults_dir: Path):
    """Ensure the built-in presets exist in SQLite."""
    # Variable presets (Generate → Variables)
    if not get_presets('variable'):
        save_preset('variable', 'Default', {'values': {}}, overwrite=False)

    for preset_type, filename in (('chat', 'Chat.txt'), ('export', 'Export.txt')):
        if get_presets(preset_type):
            continue

        path = defaults_dir / filename
        if not path.exists():
            continue

        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()

        save_preset(preset_type, 'Default', {'prompt': content}, overwrite=False)


def _row_to_conversation(row) -> dict:
    """Convert a database row to a conversation dict."""
    return {
        'id': row['id'],
        'conversations': json.loads(row['messages']),
        'metadata': json.loads(row['metadata']) if row['metadata'] else {}
    }


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str):
    """Add a missing column for lightweight migrations."""
    columns = {row['name'] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def _build_search_text(messages: list) -> str:
    """Build a compact searchable text blob without JSON punctuation noise."""
    parts = []
    for message in messages:
        role = message.get('from', '')
        value = (message.get('value') or '').strip()
        if not value:
            continue
        parts.append(f"{role}: {value}")
    return '\n'.join(parts)[:_SEARCH_TEXT_LIMIT]


def _save_conversation_record(conn: sqlite3.Connection, conv_id: str, folder: str,
                              messages: list, metadata: dict, preview: str,
                              search_text: str, turn_count: int,
                              created_at: str, updated_at: str):
    """Persist one conversation row and its tags using the active transaction."""
    conn.execute("""
        INSERT OR REPLACE INTO conversations
            (id, folder, messages, metadata, preview, search_text, turn_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        conv_id, folder,
        json.dumps(messages, ensure_ascii=False),
        json.dumps(metadata, ensure_ascii=False),
        preview, search_text, turn_count, created_at, updated_at
    ))

    tags = metadata.get('tags', [])
    conn.execute("DELETE FROM tags WHERE conversation_id = ?", (conv_id,))
    for tag in tags:
        conn.execute(
            "INSERT OR IGNORE INTO tags (conversation_id, tag) VALUES (?, ?)",
            (conv_id, tag)
        )
    _invalidate_stats_cache()


def _get_review_queue_count(conn: sqlite3.Connection, search: str = '') -> int:
    """Get review queue count using the active transaction/connection."""
    if search:
        safe_search = search.replace('"', '""')
        row = conn.execute(
            "SELECT COUNT(*) as cnt FROM review_queue_fts WHERE review_queue_fts MATCH ?",
            (f'"{safe_search}"*',)
        ).fetchone()
    else:
        row = conn.execute("SELECT COUNT(*) as cnt FROM review_queue").fetchone()
    return row['cnt']


def _backfill_conversation_search_text(conn: sqlite3.Connection):
    """Backfill search text for conversations created before the column existed."""
    batch_size = 500
    last_rowid = 0
    while True:
        rows = conn.execute(
            """SELECT rowid, messages
               FROM conversations
               WHERE (search_text = '' OR search_text IS NULL)
                 AND rowid > ?
               ORDER BY rowid ASC
               LIMIT ?""",
            (last_rowid, batch_size)
        ).fetchall()
        if not rows:
            break

        updates = []
        for row in rows:
            messages = json.loads(row['messages']) if row['messages'] else []
            updates.append((_build_search_text(messages), row['rowid']))
            last_rowid = int(row['rowid'])

        conn.executemany(
            "UPDATE conversations SET search_text = ? WHERE rowid = ?",
            updates
        )

def _backfill_review_queue_fts(conn: sqlite3.Connection):
    """Backfill the review_queue_fts table if it's empty."""
    count = conn.execute("SELECT COUNT(*) as cnt FROM review_queue_fts").fetchone()['cnt']
    if count == 0:
        conn.execute(
            "INSERT INTO review_queue_fts(rowid, id, raw_text) SELECT rowid, id, raw_text FROM review_queue"
        )

def _backfill_conversations_fts(conn: sqlite3.Connection):
    """Backfill the conversations_fts table if it's empty."""
    count = conn.execute("SELECT COUNT(*) as cnt FROM conversations_fts").fetchone()['cnt']
    if count == 0:
        conn.execute(
            """INSERT INTO conversations_fts(rowid, id, folder, preview, search_text, messages)
               SELECT rowid, id, folder, preview, search_text, messages FROM conversations"""
        )


def validate_review_item(conv: dict) -> tuple[bool, list[str]]:
    """Import parser validation lazily to avoid circular imports."""
    from scripts.parser import validate_conversation
    return validate_conversation(conv)


# ============ API SETTINGS (provider/model/key/url stored in DB) ============

def set_api_setting(key: str, value: str):
    """Set a single API setting value."""
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO api_settings (key, value) VALUES (?, ?)",
            (key, value)
        )


def get_all_api_settings() -> dict:
    """Get all API settings as a dict."""
    with get_db() as conn:
        rows = conn.execute("SELECT key, value FROM api_settings").fetchall()
    return {row['key']: row['value'] for row in rows}


def get_provider_settings() -> dict:
    """Get provider/API settings structured as a dict.

    Keys stored:
      provider, model, temperature, max_tokens,
      openai.api_key, openai.base_url,
      anthropic.api_key, anthropic.base_url,
      google.api_key, google.base_url
    """
    raw = get_all_api_settings()
    return {
        'provider': raw.get('provider', 'openai'),
        'model': raw.get('model', ''),
        'temperature': _safe_float(raw.get('temperature', ''), 0.9),
        'max_tokens': _safe_int(raw.get('max_tokens', ''), 2048),
        'providers': {
            'openai': {
                'base_url': raw.get('openai.base_url', ''),
                'api_key': raw.get('openai.api_key', ''),
                'active_key_preset': raw.get('openai.active_key_preset', ''),
                'active_url_preset': raw.get('openai.active_url_preset', '')
            },
            'anthropic': {
                'base_url': raw.get('anthropic.base_url', 'https://api.anthropic.com/v1'),
                'api_key': raw.get('anthropic.api_key', ''),
                'active_key_preset': raw.get('anthropic.active_key_preset', ''),
                'active_url_preset': raw.get('anthropic.active_url_preset', '')
            },
            'google': {
                'base_url': raw.get('google.base_url', 'https://generativelanguage.googleapis.com/v1beta'),
                'api_key': raw.get('google.api_key', ''),
                'active_key_preset': raw.get('google.active_key_preset', ''),
                'active_url_preset': raw.get('google.active_url_preset', '')
            }
        }
    }


def _safe_float(val: str, default: float) -> float:
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def _safe_int(val: str, default: int) -> int:
    try:
        return int(val)
    except (ValueError, TypeError):
        return default
