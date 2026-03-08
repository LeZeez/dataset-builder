"""
Exporter module: converts stored conversations to fine-tuning formats.

The SQLite database is the single source of truth for conversations.
"""

import json
import sys
import time
from pathlib import Path
from typing import Literal

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import database as db


def to_sharegpt(conv: dict) -> dict:
    """Convert to ShareGPT/LLaMA-Factory format."""
    conversations = []
    for message in conv.get("conversations", []):
        conversations.append({
            "role": message.get("from", "human"),
            "content": message.get("value", "")
        })
    return {"conversations": conversations}


def to_openai(conv: dict) -> dict:
    """Convert to OpenAI fine-tuning format."""
    role_map = {"human": "user", "gpt": "assistant", "system": "system"}
    messages = []
    for message in conv.get("conversations", []):
        from_role = message.get("from", "human")
        messages.append({
            "role": role_map.get(from_role, "user"),
            "content": message.get("value", "")
        })
    return {"messages": messages}


def to_alpaca(conv: dict) -> list[dict]:
    """Convert to Alpaca instruction/output pairs."""
    pairs = []
    messages = conv.get("conversations", [])

    system_prompt = ""
    start_idx = 0
    if messages and messages[0].get("from") == "system":
        system_prompt = messages[0].get("value", "")
        start_idx = 1

    index = start_idx
    while index < len(messages) - 1:
        if messages[index].get("from") == "human" and messages[index + 1].get("from") == "gpt":
            pair = {
                "instruction": messages[index].get("value", ""),
                "input": "",
                "output": messages[index + 1].get("value", "")
            }
            if system_prompt:
                pair["system"] = system_prompt
            pairs.append(pair)
            index += 2
            continue
        index += 1

    return pairs


def export_dataset(
    output_dir: str = "exports",
    format: Literal["sharegpt", "openai", "alpaca"] = "sharegpt",
    selected_ids: list[str] | None = None,
    system_prompt: str | None = None,
    filename: str | None = None,
    folder: Literal["wanted", "rejected"] = "wanted"
) -> Path:
    """Export conversations from SQLite to the selected format."""
    output_path = Path(output_dir) / format
    output_path.mkdir(parents=True, exist_ok=True)

    converter = {
        "sharegpt": to_sharegpt,
        "openai": to_openai,
        "alpaca": to_alpaca
    }[format]

    if not filename:
        filename = f"dataset_{format}_{int(time.time())}.jsonl"

    output_file = output_path / filename

    db.init_db()
    conversations = db.get_conversations_for_export(folder=folder, ids=selected_ids)

    count = 0
    with open(output_file, "w", encoding="utf-8") as out:
        for conv in conversations:
            conv_data = {
                "id": conv.get("id"),
                "conversations": [dict(message) for message in conv.get("conversations", [])],
                "metadata": dict(conv.get("metadata", {}))
            }

            if system_prompt and conv_data["conversations"]:
                messages = conv_data["conversations"]
                if messages[0].get("from") == "system":
                    messages[0]["value"] = system_prompt
                else:
                    messages.insert(0, {"from": "system", "value": system_prompt})

            converted = converter(conv_data)

            if isinstance(converted, list):
                for item in converted:
                    out.write(json.dumps(item, ensure_ascii=False) + "\n")
                    count += 1
            else:
                out.write(json.dumps(converted, ensure_ascii=False) + "\n")
                count += 1

    print(f"Exported {count} entries to {output_file}")
    return output_file


def export_all_formats(output_dir: str = "exports", folder: Literal["wanted", "rejected"] = "wanted"):
    """Export the selected folder to all supported formats."""
    for fmt in ["sharegpt", "openai", "alpaca"]:
        export_dataset(output_dir=output_dir, format=fmt, folder=folder)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Export dataset to fine-tuning formats")
    parser.add_argument("--output", default="exports", help="Output directory")
    parser.add_argument("--format", choices=["sharegpt", "openai", "alpaca", "all"],
                        default="all", help="Export format")
    parser.add_argument("--folder", choices=["wanted", "rejected"], default="wanted",
                        help="Conversation status to export")

    args = parser.parse_args()

    if args.format == "all":
        export_all_formats(output_dir=args.output, folder=args.folder)
    else:
        export_dataset(output_dir=args.output, format=args.format, folder=args.folder)
