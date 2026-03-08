"""Run repeatable storage benchmarks against a benchmark SQLite database."""

import argparse
import json
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import database as db
from benchmark.stress_seed import seed_database


DEFAULT_DB_PATH = Path("benchmark/benchmark.db")
DEFAULT_SEED_WANTED = 2000
DEFAULT_SEED_REVIEW = 3000
DEFAULT_SEED_BATCH_SIZE = 200
DEFAULT_SEED_HUMAN_SIZE = 600
DEFAULT_SEED_GPT_SIZE = 1800


def _configure_db(db_path: Path):
    db.close_db()
    db.DB_PATH = db_path
    db.init_db()


def _measure(name: str, fn, repeat: int) -> dict:
    samples = []
    last_result = None
    for _ in range(repeat):
        started = time.perf_counter()
        last_result = fn()
        samples.append((time.perf_counter() - started) * 1000)
    return {
        "name": name,
        "avg_ms": round(sum(samples) / len(samples), 2),
        "min_ms": round(min(samples), 2),
        "max_ms": round(max(samples), 2),
        "samples": [round(sample, 2) for sample in samples],
        "result_size": _result_size(last_result),
    }


def _result_size(result) -> int | None:
    if isinstance(result, tuple) and result:
        first = result[0]
        if isinstance(first, list):
            return len(first)
    if isinstance(result, list):
        return len(result)
    if isinstance(result, dict) and "saved_count" in result:
        return result["saved_count"]
    return None


def _copy_db_for_write_benchmark(source_db: Path) -> tuple[tempfile.TemporaryDirectory, Path]:
    temp_dir = tempfile.TemporaryDirectory()
    target_db = Path(temp_dir.name) / "write-benchmark.db"

    with sqlite3.connect(source_db) as source_conn:
        with sqlite3.connect(target_db) as target_conn:
            source_conn.backup(target_conn)

    return temp_dir, target_db


def _ensure_benchmark_db(db_path: Path, wanted: int, review: int, batch_size: int,
                         human_size: int, gpt_size: int):
    if not db_path.exists():
        print(
            f"{db_path} does not exist. Seeding a fresh benchmark database "
            f"(wanted={wanted}, review={review})."
        )
        seed_database(
            db_path=db_path,
            wanted=wanted,
            review=review,
            batch_size=batch_size,
            human_size=human_size,
            gpt_size=gpt_size,
            append=False,
        )


def run_benchmarks(db_path: Path, repeat: int, search_term: str, include_write: bool,
                   seed_wanted: int, seed_review: int, seed_batch_size: int,
                   seed_human_size: int, seed_gpt_size: int) -> dict:
    _ensure_benchmark_db(
        db_path=db_path,
        wanted=seed_wanted,
        review=seed_review,
        batch_size=seed_batch_size,
        human_size=seed_human_size,
        gpt_size=seed_gpt_size,
    )

    _configure_db(db_path)

    report = {
        "db_path": str(db_path),
        "counts": {
            **db.get_conversation_counts(),
            "review_queue": db.get_review_queue_count(),
        },
        "benchmarks": [],
    }

    report["benchmarks"].append(_measure(
        "conversation_counts",
        db.get_conversation_counts,
        repeat,
    ))
    report["benchmarks"].append(_measure(
        "list_wanted_page",
        lambda: db.list_conversations("wanted", limit=100, offset=0),
        repeat,
    ))
    report["benchmarks"].append(_measure(
        "search_wanted_page",
        lambda: db.list_conversations("wanted", search=search_term, limit=100, offset=0),
        repeat,
    ))
    report["benchmarks"].append(_measure(
        "review_queue_page",
        lambda: db.get_review_queue(limit=100, offset=0),
        repeat,
    ))
    report["benchmarks"].append(_measure(
        "review_queue_search_page",
        lambda: db.get_review_queue(limit=100, offset=0, search=search_term),
        repeat,
    ))
    report["benchmarks"].append(_measure(
        "detailed_stats",
        db.get_stats,
        repeat,
    ))

    if include_write and report["counts"]["review_queue"] > 0:
        temp_dir, write_db = _copy_db_for_write_benchmark(db_path)
        _configure_db(write_db)
        report["benchmarks"].append(_measure(
            "persist_review_queue_all",
            lambda: {
                "saved_count": len(db.persist_review_queue_items(None, "wanted")[0])
            },
            1,
        ))
        db.close_db()
        temp_dir.cleanup()
        _configure_db(db_path)

    return report


def print_report(report: dict):
    print(f"Benchmark DB: {report['db_path']}")
    counts = report["counts"]
    print(
        f"Counts: wanted={counts['wanted']} rejected={counts['rejected']} "
        f"review_queue={counts['review_queue']}"
    )
    print("")
    print(f"{'Benchmark':30} {'avg':>8} {'min':>8} {'max':>8} {'size':>8}")
    print("-" * 70)
    for benchmark in report["benchmarks"]:
        size = benchmark["result_size"]
        size_label = "-" if size is None else str(size)
        print(
            f"{benchmark['name']:30} "
            f"{benchmark['avg_ms']:>8.2f} "
            f"{benchmark['min_ms']:>8.2f} "
            f"{benchmark['max_ms']:>8.2f} "
            f"{size_label:>8}"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run local SQLite/storage benchmarks")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH), help="SQLite database path")
    parser.add_argument("--repeat", type=int, default=5, help="Number of runs per benchmark")
    parser.add_argument("--search", default="alpha", help="Search term for search-path benchmarks")
    parser.add_argument("--include-write", action="store_true",
                        help="Benchmark Keep All on a temporary copy of the DB")
    parser.add_argument("--json", action="store_true", help="Output JSON instead of a table")
    parser.add_argument("--seed-wanted", type=int, default=DEFAULT_SEED_WANTED,
                        help="Wanted conversations to auto-seed if the DB is missing")
    parser.add_argument("--seed-review", type=int, default=DEFAULT_SEED_REVIEW,
                        help="Review queue items to auto-seed if the DB is missing")
    parser.add_argument("--seed-batch-size", type=int, default=DEFAULT_SEED_BATCH_SIZE,
                        help="Batch size for auto-seeding review queue items")
    parser.add_argument("--seed-human-size", type=int, default=DEFAULT_SEED_HUMAN_SIZE,
                        help="Approximate human message size for auto-seeded data")
    parser.add_argument("--seed-gpt-size", type=int, default=DEFAULT_SEED_GPT_SIZE,
                        help="Approximate GPT message size for auto-seeded data")

    args = parser.parse_args()
    report = run_benchmarks(
        db_path=Path(args.db),
        repeat=max(1, args.repeat),
        search_term=args.search,
        include_write=args.include_write,
        seed_wanted=max(0, args.seed_wanted),
        seed_review=max(0, args.seed_review),
        seed_batch_size=max(1, args.seed_batch_size),
        seed_human_size=max(32, args.seed_human_size),
        seed_gpt_size=max(32, args.seed_gpt_size),
    )

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_report(report)
