"""
Dataset statistics module.

Provides insights about the conversation dataset.
"""

import json
from pathlib import Path
from collections import Counter
from datetime import datetime


def get_stats(data_dir: str = "data/wanted") -> dict:
    """
    Calculate dataset statistics.
    
    Returns:
        Dictionary with various statistics
    """
    data_path = Path(data_dir)
    
    if not data_path.exists():
        return {"error": "Directory does not exist"}
    
    json_files = list(data_path.glob("*.json"))
    
    if not json_files:
        return {
            "total_conversations": 0,
            "message": "No conversations found"
        }
    
    stats = {
        "total_conversations": len(json_files),
        "total_messages": 0,
        "human_messages": 0,
        "gpt_messages": 0,
        "avg_messages_per_conv": 0,
        "avg_human_msg_length": 0,
        "avg_gpt_msg_length": 0,
        "conversations_by_date": Counter(),
        "tags": Counter(),
        "earliest": None,
        "latest": None
    }
    
    human_lengths = []
    gpt_lengths = []
    dates = []
    
    for json_file in json_files:
        with open(json_file, 'r', encoding='utf-8') as f:
            conv = json.load(f)
        
        messages = conv.get("conversations", [])
        stats["total_messages"] += len(messages)
        
        for msg in messages:
            if msg["from"] == "human":
                stats["human_messages"] += 1
                human_lengths.append(len(msg["value"]))
            else:
                stats["gpt_messages"] += 1
                gpt_lengths.append(len(msg["value"]))
        
        # Extract date from ID or metadata
        metadata = conv.get("metadata", {})
        created_at = metadata.get("created_at")
        if created_at:
            try:
                dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                date_str = dt.strftime("%Y-%m-%d")
                stats["conversations_by_date"][date_str] += 1
                dates.append(dt)
            except:
                pass
        
        # Count tags
        tags = metadata.get("tags", [])
        for tag in tags:
            stats["tags"][tag] += 1
    
    # Calculate averages
    if stats["total_conversations"] > 0:
        stats["avg_messages_per_conv"] = round(
            stats["total_messages"] / stats["total_conversations"], 2
        )
    
    if human_lengths:
        stats["avg_human_msg_length"] = round(sum(human_lengths) / len(human_lengths), 2)
    
    if gpt_lengths:
        stats["avg_gpt_msg_length"] = round(sum(gpt_lengths) / len(gpt_lengths), 2)
    
    if dates:
        stats["earliest"] = min(dates).isoformat()
        stats["latest"] = max(dates).isoformat()
    
    # Convert Counters to dicts for JSON serialization
    stats["conversations_by_date"] = dict(stats["conversations_by_date"])
    stats["tags"] = dict(stats["tags"])
    
    return stats


def print_stats(data_dir: str = "data/wanted"):
    """Print formatted statistics."""
    stats = get_stats(data_dir)
    
    print("\n" + "=" * 50)
    print("📊 DATASET STATISTICS")
    print("=" * 50)
    
    if "error" in stats:
        print(f"Error: {stats['error']}")
        return
    
    print(f"\n📁 Total Conversations: {stats['total_conversations']}")
    print(f"💬 Total Messages: {stats['total_messages']}")
    print(f"   └─ Human: {stats['human_messages']}")
    print(f"   └─ GPT: {stats['gpt_messages']}")
    print(f"\n📏 Averages:")
    print(f"   └─ Messages per conversation: {stats['avg_messages_per_conv']}")
    print(f"   └─ Human message length: {stats['avg_human_msg_length']} chars")
    print(f"   └─ GPT message length: {stats['avg_gpt_msg_length']} chars")
    
    if stats['earliest']:
        print(f"\n📅 Date Range:")
        print(f"   └─ Earliest: {stats['earliest']}")
        print(f"   └─ Latest: {stats['latest']}")
    
    if stats['conversations_by_date']:
        print(f"\n📆 Conversations by Date:")
        for date, count in sorted(stats['conversations_by_date'].items()):
            print(f"   └─ {date}: {count}")
    
    if stats['tags']:
        print(f"\n🏷️  Tags:")
        for tag, count in stats['tags'].most_common(10):
            print(f"   └─ {tag}: {count}")
    
    print("\n" + "=" * 50)


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Show dataset statistics")
    parser.add_argument("--dir", default="data/wanted", help="Data directory")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    
    args = parser.parse_args()
    
    if args.json:
        print(json.dumps(get_stats(args.dir), ensure_ascii=False, indent=2))
    else:
        print_stats(args.dir)