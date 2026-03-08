"""Dataset statistics CLI backed by the SQLite database."""

import json

from scripts import database as db


def get_stats() -> dict:
    """Return dataset statistics from SQLite."""
    db.init_db()
    return db.get_stats()


def print_stats():
    """Print formatted statistics."""
    stats = get_stats()

    print("\n" + "=" * 50)
    print("DATASET STATISTICS")
    print("=" * 50)

    if "error" in stats:
        print(f"Error: {stats['error']}")
        return

    print(f"\nWanted Conversations: {stats.get('wanted', 0)}")
    print(f"Rejected Conversations: {stats.get('rejected', 0)}")
    print(f"Total Messages: {stats.get('total_messages', 0)}")
    print(f"  Human: {stats.get('human_messages', 0)}")
    print(f"  GPT: {stats.get('gpt_messages', 0)}")
    print(f"  System: {stats.get('system_messages', 0)}")

    print("\nAverages:")
    print(f"  Messages per conversation: {stats.get('avg_messages_per_conv', 0)}")
    print(f"  Human message length: {stats.get('avg_human_msg_length', 0)} chars")
    print(f"  GPT message length: {stats.get('avg_gpt_msg_length', 0)} chars")

    if stats.get('earliest'):
        print("\nDate Range:")
        print(f"  Earliest: {stats['earliest']}")
        print(f"  Latest: {stats['latest']}")

    if stats.get('conversations_by_date'):
        print("\nConversations by Date:")
        for date, count in sorted(stats['conversations_by_date'].items()):
            print(f"  {date}: {count}")

    if stats.get('tags'):
        print("\nTop Tags:")
        sorted_tags = sorted(stats['tags'].items(), key=lambda item: item[1], reverse=True)
        for tag, count in sorted_tags[:10]:
            print(f"  {tag}: {count}")

    print("\n" + "=" * 50)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Show dataset statistics")
    parser.add_argument("--json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    if args.json:
        print(json.dumps(get_stats(), ensure_ascii=False, indent=2))
    else:
        print_stats()
