"""
Parser module: converts the minimal editor format into the app conversation format.
"""

import re
from datetime import datetime, timezone


def parse_minimal_format(text: str, conv_id: str | None = None, metadata: dict | None = None) -> dict:
    """
    Parse minimal conversation format into the base conversation structure.

    Example:
        user: Hello
        ---
        gpt: Hi
    """
    blocks = re.split(r'^---\s*$', text.strip(), flags=re.MULTILINE)

    conversations = []
    for block in blocks:
        block = block.strip()
        if not block:
            continue

        match = re.match(r'^(user|gpt|system):\s*(.*)', block, re.DOTALL)
        if match:
            role, content = match.groups()
            conversations.append({
                "from": "human" if role == "user" else ("system" if role == "system" else "gpt"),
                "value": content.strip()
            })

    # Normalize system messages to the front (Alpaca export only consumes a leading system prompt).
    # Preserve relative order within system vs non-system messages.
    has_nonleading_system = any((m.get("from") == "system") and idx != 0 for idx, m in enumerate(conversations))
    if has_nonleading_system:
        system_messages = [m for m in conversations if m.get("from") == "system"]
        non_system_messages = [m for m in conversations if m.get("from") != "system"]
        conversations = system_messages + non_system_messages

    return {
        "id": conv_id or "",
        "conversations": conversations,
        "metadata": {
            "created_at": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
            "source": "synthetic",
            **(metadata or {})
        }
    }


def validate_conversation(conv: dict) -> tuple[bool, list[str]]:
    """Validate conversation structure."""
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
        for index, message in enumerate(conv["conversations"]):
            if "from" not in message:
                errors.append(f"Message {index}: missing 'from' field")
            elif message["from"] not in ("human", "gpt", "system"):
                errors.append(f"Message {index}: 'from' must be 'human', 'gpt', or 'system'")
            if "value" not in message:
                errors.append(f"Message {index}: missing 'value' field")

    return len(errors) == 0, errors
