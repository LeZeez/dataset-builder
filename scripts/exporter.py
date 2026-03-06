"""
Exporter module: Converts base format to various fine-tuning formats.

Supported formats:
- ShareGPT (LLaMA-Factory compatible) - uses role/content keys
- OpenAI (messages format)
- Alpaca (instruction/input/output)
"""

import json
import time
from pathlib import Path
from typing import Literal


def to_sharegpt(conv: dict) -> dict:
    """
    Convert to ShareGPT/LLaMA-Factory format.
    
    Output:
        {"conversations": [{"role": "human", "content": "..."}, ...]}
    """
    conversations = []
    for m in conv.get("conversations", []):
        role = m.get("from", "human")
        content = m.get("value", "")
        conversations.append({
            "role": role,
            "content": content
        })
    return {"conversations": conversations}


def to_openai(conv: dict) -> dict:
    """
    Convert to OpenAI fine-tuning format.
    
    Output:
        {"messages": [{"role": "user", "content": "..."}, ...]}
    """
    role_map = {"human": "user", "gpt": "assistant", "system": "system"}
    messages = []
    for m in conv.get("conversations", []):
        from_role = m.get("from", "human")
        role = role_map.get(from_role, "user")
        content = m.get("value", "")
        messages.append({"role": role, "content": content})
    return {"messages": messages}


def to_alpaca(conv: dict) -> list[dict]:
    """
    Convert to Alpaca format.
    
    Splits multi-turn conversations into instruction/output pairs.
    Handles system prompts by including them as context in the first pair.
    
    Output:
        [{"instruction": "...", "input": "", "output": "...", "system": "..."}, ...]
    """
    pairs = []
    messages = conv.get("conversations", [])
    
    # Extract system prompt if present
    system_prompt = ""
    start_idx = 0
    if messages and messages[0].get("from") == "system":
        system_prompt = messages[0].get("value", "")
        start_idx = 1
    
    # Pair up human/gpt messages
    i = start_idx
    while i < len(messages) - 1:
        # Find next human message
        if messages[i].get("from") == "human":
            # Find corresponding gpt response
            if i + 1 < len(messages) and messages[i + 1].get("from") == "gpt":
                pair = {
                    "instruction": messages[i].get("value", ""),
                    "input": "",
                    "output": messages[i + 1].get("value", "")
                }
                if system_prompt:
                    pair["system"] = system_prompt
                pairs.append(pair)
                i += 2
                continue
        i += 1
    
    return pairs


def export_dataset(
    source_dir: str = "data/wanted",
    output_dir: str = "exports",
    format: Literal["sharegpt", "openai", "alpaca"] = "sharegpt",
    selected_ids: list[str] = None,
    system_prompt: str = None,
    filename: str = None
) -> Path:
    """
    Export all conversations from source directory to specified format.
    
    Args:
        source_dir: Directory containing base format JSON files
        output_dir: Output directory for exports
        format: Target format (sharegpt, openai, alpaca)
        selected_ids: Optional list of conversation IDs to export (None for all)
        system_prompt: Optional system prompt to override/prepend
    
    Returns:
        Path to exported JSONL file
    """
    source_path = Path(source_dir)
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
    
    count = 0
    with open(output_file, 'w', encoding='utf-8') as out:
        for json_file in sorted(source_path.glob("*.json")):
            # Filter by ID if specified
            if selected_ids is not None and json_file.stem not in selected_ids:
                continue
                
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    conv = json.load(f)
            except json.JSONDecodeError:
                print(f"Skipping malformed JSON file: {json_file}")
                continue
            
            # Inject system prompt if provided
            if system_prompt and conv.get('conversations'):
                msgs = conv['conversations']
                if msgs and msgs[0].get('from') == 'system':
                    msgs[0]['value'] = system_prompt
                else:
                    msgs.insert(0, {'from': 'system', 'value': system_prompt})
            
            converted = converter(conv)
            
            # Alpaca returns a list, others return a single dict
            if isinstance(converted, list):
                for item in converted:
                    out.write(json.dumps(item, ensure_ascii=False) + "\n")
                    count += 1
            else:
                out.write(json.dumps(converted, ensure_ascii=False) + "\n")
                count += 1
    
    print(f"Exported {count} entries to {output_file}")
    return output_file


def export_all_formats(source_dir: str = "data/wanted", output_dir: str = "exports"):
    """Export to all supported formats."""
    for fmt in ["sharegpt", "openai", "alpaca"]:
        export_dataset(source_dir, output_dir, fmt)


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Export dataset to fine-tuning formats")
    parser.add_argument("--source", default="data/wanted", help="Source directory")
    parser.add_argument("--output", default="exports", help="Output directory")
    parser.add_argument("--format", choices=["sharegpt", "openai", "alpaca", "all"], 
                        default="all", help="Export format")
    
    args = parser.parse_args()
    
    if args.format == "all":
        export_all_formats(args.source, args.output)
    else:
        export_dataset(args.source, args.output, args.format)
