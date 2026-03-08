"""Seed a standalone benchmark database with large synthetic workloads."""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import database as db


DEFAULT_DB_PATH = Path("benchmark/benchmark.db")


def _configure_db(db_path: Path):
    db.close_db()
    db.DB_PATH = db_path
    db.init_db()


def _reset_db_files(db_path: Path):
    for suffix in ("", "-wal", "-shm"):
        target = Path(str(db_path) + suffix)
        if target.exists():
            target.unlink()


def _build_conversation(index: int, human_size: int, gpt_size: int) -> tuple[list, dict]:
    human_text = (
        f"Benchmark prompt {index} alpha beta gamma "
        + ("human-" * max(1, human_size // 6))
    )[:human_size]
    gpt_text = (
        f"Benchmark response {index} delta epsilon zeta "
        + ("assistant-" * max(1, gpt_size // 10))
    )[:gpt_size]
    messages = [
        {"from": "system", "value": "You are a benchmark conversation."},
        {"from": "human", "value": human_text},
        {"from": "gpt", "value": gpt_text},
    ]
    metadata = {
        "created_at": f"2024-01-{(index % 28) + 1:02d}T00:00:00Z",
        "tags": [f"bench-{index % 5}", "benchmark"],
        "source": "benchmark-seed",
        "index": index,
    }
    return messages, metadata


def seed_database(db_path: Path, wanted: int, review: int, batch_size: int,
                  human_size: int, gpt_size: int, append: bool):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if not append:
        _reset_db_files(db_path)

    _configure_db(db_path)

    if wanted > 0:
        for index in range(wanted):
            messages, metadata = _build_conversation(index, human_size, gpt_size)
            conv_id = f"bench-{index:06d}"
            db.save_conversation(conv_id, messages, "wanted", metadata)

    if review > 0:
        batch = []
        for index in range(review):
            messages, metadata = _build_conversation(index + wanted, human_size, gpt_size)
            batch.append({
                "conversations": messages,
                "rawText": conversation_to_raw(messages),
                "metadata": metadata,
            })
            if len(batch) >= batch_size:
                db.add_to_review_queue(batch)
                batch.clear()
        if batch:
            db.add_to_review_queue(batch)

    counts = db.get_conversation_counts()
    review_count = db.get_review_queue_count()
    print(f"Seeded benchmark DB: {db_path}")
    print(f"  wanted: {counts['wanted']}")
    print(f"  rejected: {counts['rejected']}")
    print(f"  review_queue: {review_count}")


def conversation_to_raw(messages: list[dict]) -> str:
    parts = []
    for message in messages:
        role = message.get("from", "gpt")
        prefix = "user" if role == "human" else role
        parts.append(f"{prefix}: {message.get('value', '')}")
    return "\n---\n".join(parts)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed a large benchmark database")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH), help="SQLite database path")
    parser.add_argument("--wanted", type=int, default=2000, help="Number of wanted conversations")
    parser.add_argument("--review", type=int, default=3000, help="Number of review queue items")
    parser.add_argument("--batch-size", type=int, default=200, help="Batch size for review queue inserts")
    parser.add_argument("--human-size", type=int, default=600, help="Approximate human message size")
    parser.add_argument("--gpt-size", type=int, default=1800, help="Approximate GPT message size")
    parser.add_argument("--append", action="store_true", help="Append to the target DB instead of resetting it")

    args = parser.parse_args()
    seed_database(
        db_path=Path(args.db),
        wanted=max(0, args.wanted),
        review=max(0, args.review),
        batch_size=max(1, args.batch_size),
        human_size=max(32, args.human_size),
        gpt_size=max(32, args.gpt_size),
        append=args.append,
    )
