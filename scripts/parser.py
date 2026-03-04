"""
Parser module: Converts minimal conversation format to base JSON format.

Minimal format example:
    user: Hey, how are you doing?
    What have you been up to lately?
    ---
    gpt: I'm doing great, thanks!
    How about yourself?
    ---
    user: Pretty good, can't complain!
"""

import re
import json
from datetime import datetime
from pathlib import Path


def parse_minimal_format(text: str, conv_id: str = None, metadata: dict = None) -> dict:
    """
    Parse minimal conversation format into base JSON structure.
    
    Supports multi-line messages using '---' as delimiter.
    
    Args:
        text: Raw conversation text in minimal format
        conv_id: Optional conversation ID (auto-generated if not provided)
        metadata: Optional additional metadata to include
    
    Returns:
        Base format dictionary ready for export
    """
    # Split by delimiter
    blocks = re.split(r'^---\s*$', text.strip(), flags=re.MULTILINE)
    
    conversations = []
    for block in blocks:
        block = block.strip()
        if not block:
            continue
        
        # Match role prefix and capture everything after
        match = re.match(r'^(user|gpt):\s*(.*)', block, re.DOTALL)
        if match:
            role, content = match.groups()
            conversations.append({
                "from": "human" if role == "user" else "gpt",
                "value": content.strip()
            })
    
    # Generate ID if not provided
    if conv_id is None:
        conv_id = generate_conversation_id()
    
    result = {
        "id": conv_id,
        "conversations": conversations,
        "metadata": {
            "created_at": datetime.utcnow().isoformat() + "Z",
            "source": "synthetic",
            **(metadata or {})
        }
    }
    
    return result


def generate_conversation_id(data_dir: str = "data/wanted") -> str:
    """
    Generate conversation ID in format: YYYY-MM-DD_001
    
    Scans existing files to determine next sequence number for today.
    """
    today = datetime.utcnow().strftime("%Y-%m-%d")
    data_path = Path(data_dir)
    
    if not data_path.exists():
        return f"{today}_001"
    
    # Find existing files for today
    existing = list(data_path.glob(f"{today}_*.json"))
    
    if not existing:
        return f"{today}_001"
    
    # Extract sequence numbers and find max
    max_seq = 0
    for f in existing:
        match = re.search(r'_(\d+)\.json$', f.name)
        if match:
            max_seq = max(max_seq, int(match.group(1)))
    
    return f"{today}_{max_seq + 1:03d}"


def save_conversation(conv: dict, folder: str = "data/wanted") -> Path:
    """
    Save conversation to JSON file.
    
    Args:
        conv: Conversation dictionary in base format
        folder: Target folder (wanted/rejected)
    
    Returns:
        Path to saved file
    """
    folder_path = Path(folder)
    folder_path.mkdir(parents=True, exist_ok=True)
    
    filename = f"{conv['id']}.json"
    filepath = folder_path / filename
    
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(conv, f, ensure_ascii=False, indent=2)
    
    return filepath


def load_conversation(filepath: str) -> dict:
    """Load a conversation from JSON file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except json.JSONDecodeError:
        return {}


def validate_conversation(conv: dict) -> tuple[bool, list[str]]:
    """
    Validate conversation structure.
    
    Returns:
        Tuple of (is_valid, list of error messages)
    """
    errors = []
    
    if "id" not in conv:
        errors.append("Missing 'id' field")
    
    if "conversations" not in conv:
        errors.append("Missing 'conversations' field")
    elif not isinstance(conv["conversations"], list):
        errors.append("'conversations' must be a list")
    elif len(conv["conversations"]) == 0:
        errors.append("'conversations' cannot be empty")
    else:
        for i, msg in enumerate(conv["conversations"]):
            if "from" not in msg:
                errors.append(f"Message {i}: missing 'from' field")
            elif msg["from"] not in ("human", "gpt", "system"):
                errors.append(f"Message {i}: 'from' must be 'human', 'gpt', or 'system'")
            if "value" not in msg:
                errors.append(f"Message {i}: missing 'value' field")
    
    return len(errors) == 0, errors


if __name__ == "__main__":
    # Test parsing
    test_input = """user: Hey, how are you doing?
What have you been up to lately?
---
gpt: I'm doing great, thanks!
How about yourself?
---
user: Pretty good, just been busy with work"""

    result = parse_minimal_format(test_input, metadata={"tags": ["greeting", "casual"]})
    print(json.dumps(result, ensure_ascii=False, indent=2))
