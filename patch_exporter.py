import re

with open('scripts/exporter.py', 'r') as f:
    content = f.read()

export_dataset_def = """
def export_dataset(
    source_dir: str = "data/wanted",
    output_dir: str = "exports",
    format: Literal["sharegpt", "openai", "alpaca"] = "sharegpt",
    selected_ids: list[str] = None,
    system_prompt: str = None
) -> Path:
"""

export_dataset_fixed = """
def export_dataset(
    source_dir: str = "data/wanted",
    output_dir: str = "exports",
    format: Literal["sharegpt", "openai", "alpaca"] = "sharegpt",
    selected_ids: list[str] = None,
    system_prompt: str = None,
    filename: str = None
) -> Path:
"""

output_file_logic = """
    converter = {
        "sharegpt": to_sharegpt,
        "openai": to_openai,
        "alpaca": to_alpaca
    }[format]

    output_file = output_path / "dataset.jsonl"
"""

import time

output_file_fixed = """
    converter = {
        "sharegpt": to_sharegpt,
        "openai": to_openai,
        "alpaca": to_alpaca
    }[format]

    import time
    if not filename:
        filename = f"dataset_{format}_{int(time.time())}.jsonl"

    output_file = output_path / filename
"""

content = content.replace(export_dataset_def, export_dataset_fixed)
content = content.replace(output_file_logic, output_file_fixed)

with open('scripts/exporter.py', 'w') as f:
    f.write(content)
