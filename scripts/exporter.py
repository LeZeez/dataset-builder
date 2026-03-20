"""
Exporter module: converts stored conversations to fine-tuning formats.

The SQLite database is the single source of truth for conversations.
"""

import json
import sys
import time
from pathlib import Path
from typing import Iterable, Literal

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import database as db

SystemPromptMode = Literal[
    "keep",
    "add_if_missing",
    "replace_all",
    "remove_all",
    "prepend",
    "append",
    # Back-compat aliases (accepted, normalized below)
    "override",
    "strip",
]

def _normalize_system_prompt_mode(system_prompt_mode: str | None) -> str | None:
    if not system_prompt_mode:
        return None
    mode = str(system_prompt_mode).strip().lower()
    if mode == "override":
        return "replace_all"
    if mode == "strip":
        return "remove_all"
    if mode in ("keep", "add_if_missing", "replace_all", "remove_all", "prepend", "append"):
        return mode
    return None

def _apply_system_prompt_mode(conv_data: dict, system_prompt: str | None, system_prompt_mode: SystemPromptMode | None):
    """Apply system prompt handling to conv_data in-place (best-effort)."""
    mode = _normalize_system_prompt_mode(system_prompt_mode)
    if not mode:
        # Backwards-compatible behavior:
        # - if a non-empty system prompt is provided: replace_all
        # - otherwise: keep original system messages
        mode = "replace_all" if (system_prompt is not None and str(system_prompt).strip() != "") else "keep"

    messages = conv_data.get("conversations", [])
    if not isinstance(messages, list):
        return

    if mode == "keep":
        return

    # Only mutate when there is a conversation to export.
    if not messages:
        return

    prompt = "" if system_prompt is None else str(system_prompt)
    prompt_is_blank = (prompt.strip() == "")
    system_indexes = [idx for idx, m in enumerate(messages) if isinstance(m, dict) and m.get("from") == "system"]

    if mode == "remove_all":
        conv_data["conversations"] = [m for m in messages if isinstance(m, dict) and m.get("from") != "system"]
        return

    if mode == "add_if_missing":
        if system_indexes:
            return
        if prompt_is_blank:
            return
        messages.insert(0, {"from": "system", "value": prompt})
        return

    if mode == "replace_all":
        if prompt_is_blank:
            return
        conv_data["conversations"] = [m for m in messages if isinstance(m, dict) and m.get("from") != "system"]
        conv_data["conversations"].insert(0, {"from": "system", "value": prompt})
        return

    if mode in ("prepend", "append"):
        if system_indexes:
            idx = system_indexes[0]
            existing = "" if messages[idx].get("value") is None else str(messages[idx].get("value"))
            if not existing:
                messages[idx]["value"] = prompt
            elif not prompt:
                # No-op if prompt is empty (preserve existing).
                messages[idx]["value"] = existing
            elif mode == "prepend":
                messages[idx]["value"] = f"{prompt}\n\n{existing}"
            else:
                messages[idx]["value"] = f"{existing}\n\n{prompt}"
        else:
            messages.insert(0, {"from": "system", "value": prompt})
        return


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


def preview_export_lines(
    conversations: Iterable[dict],
    format: Literal["sharegpt", "openai", "alpaca"] = "sharegpt",
    system_prompt: str | None = None,
    system_prompt_mode: SystemPromptMode | None = None,
    limit: int = 20,
) -> dict:
    """Convert conversations to JSONL lines without writing files.

    Returns:
      { lines: [str], total_entries: int, truncated: bool, limit: int }
    """
    converter = {
        "sharegpt": to_sharegpt,
        "openai": to_openai,
        "alpaca": to_alpaca
    }[format]

    lines: list[str] = []
    total_entries = 0
    truncated = False

    safe_limit = max(1, min(int(limit), 200))

    def _count_alpaca_pairs(messages: list) -> int:
        if not isinstance(messages, list) or not messages:
            return 0
        start_idx = 1 if (messages and isinstance(messages[0], dict) and messages[0].get("from") == "system") else 0
        count = 0
        i = start_idx
        while i < len(messages) - 1:
            if isinstance(messages[i], dict) and isinstance(messages[i + 1], dict) and messages[i].get("from") == "human" and messages[i + 1].get("from") == "gpt":
                count += 1
                i += 2
            else:
                i += 1
        return count

    for conv in conversations:
        conv_data = {
            "id": conv.get("id"),
            "conversations": [dict(message) for message in conv.get("conversations", [])],
            "metadata": dict(conv.get("metadata", {}))
        }

        _apply_system_prompt_mode(conv_data, system_prompt, system_prompt_mode)

        if format == "alpaca" and truncated:
            # Fast-path counting without building full pair dicts once preview lines are already full.
            total_entries += _count_alpaca_pairs(conv_data.get("conversations", []))
            continue

        converted = converter(conv_data)

        if isinstance(converted, list):
            total_entries += len(converted)
            for item in converted:
                if len(lines) < safe_limit:
                    lines.append(json.dumps(item, ensure_ascii=False))
                else:
                    truncated = True
        else:
            total_entries += 1
            if len(lines) < safe_limit:
                lines.append(json.dumps(converted, ensure_ascii=False))
            else:
                truncated = True

    return {
        "lines": lines,
        "total_entries": total_entries,
        "truncated": truncated,
        "limit": safe_limit,
    }


def export_dataset(
    output_dir: str = "exports",
    format: Literal["sharegpt", "openai", "alpaca"] = "sharegpt",
    selected_ids: list[str] | None = None,
    system_prompt: str | None = None,
    system_prompt_mode: SystemPromptMode | None = None,
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

            _apply_system_prompt_mode(conv_data, system_prompt, system_prompt_mode)

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
