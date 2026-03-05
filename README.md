# 🗂️ Synthetic Dataset Generator

A tool for creating synthetic conversation datasets using frontier LLMs.

## Features

- **Web UI** for generating, reviewing, and curating conversations
- **Multi-provider support**: OpenAI, Anthropic, Google Gemini
- **Simple input format** with multi-line message support
- **Export to popular formats**: ShareGPT, OpenAI, Alpaca
- **Bulk actions** (Delete, Move, Keep, Discard)
- **Review queue** management
- **Manage Files modal** for better organization
- **Individual JSON files** per conversation for easy management
- **Keyboard shortcuts** for fast workflow

## Quick Start

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Set your API key

**Option A: Via UI (Recommended)**
1. Start the server
2. Open http://localhost:5000
3. In the left panel under "🔑 API Keys"
4. Enter your API key and click "Save Key"

**Option B: Via environment variable**
```bash
export OPENAI_API_KEY='your-key-here'
# or
export ANTHROPIC_API_KEY='your-key-here'
# or
export GOOGLE_API_KEY='your-key-here'
```

### 3. Run the server

```bash
python server.py
```

### 4. Open the UI

Navigate to [http://localhost:5000](http://localhost:5000)

## Usage

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+G` | Generate conversation |
| `Ctrl+Enter` | Save to wanted |
| `Ctrl+Backspace` | Reject |
| `Ctrl+R` | Regenerate |

## Macros Engine

The Dataset Builder includes a powerful Macros Engine that allows you to dynamically alter your prompts. Macros are processed iteratively, so you can nest them inside each other! The UI features a "Macro Maker" to easily generate these syntaxes.

### Available Built-in Macros

*   **Variables:** `{{my_variable}}` - Basic variable substitution, managed via the Macros button.
*   **Random:** `{{random::apple::banana::cherry}}` - Picks one item at random from the list.
*   **List Iterator:** `{{list::first::second::third}}` - Iterates sequentially through the list on each generation.
*   **Dice Rolls:** `{{roll:1d20+5}}` - Simulates dice rolls (e.g., 2d6-1, 1d100).
*   **Math Evaluation:** `{{5+4*2/4}}` - Safely evaluates simple mathematical expressions.
*   **Comments:** `{{// This is a comment}}` - Text that will be removed from the prompt before being sent to the LLM.

### Macro Highlighting
When you generate a conversation, the "Last Sent Prompt" view will display your fully resolved prompt. Any text that was generated via a built-in macro will be highlighted in red with a dotted underline. Hovering over the highlighted text will reveal the original macro syntax that generated it.

### Input Format

Conversations use a simple format with `---` as message delimiter:

```
user: Hello, how are you?
What have you been up to lately?
---
gpt: I'm doing great, thanks!
How about yourself?
---
user: Pretty good, thanks for asking!
```

This allows multi-line messages naturally.

### Base Format (Internal)

Conversations are stored in ShareGPT-compatible JSON:

```json
{
  "id": "2024-02-09_001",
  "conversations": [
    {"from": "human", "value": "Hello, how are you?"},
    {"from": "gpt", "value": "I'm doing great, thanks!"}
  ],
  "metadata": {
    "created_at": "2024-02-09T12:00:00Z",
    "source": "synthetic",
    "tags": ["greeting", "casual"],
    "rating": 5
  }
}
```

## Project Structure

```
dataset-builder/
├── ui/                     # Web interface
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── data/
│   ├── wanted/            # Approved conversations
│   ├── rejected/          # Discarded conversations
│   └── prompts/           # Generation prompts
├── scripts/
│   ├── parser.py          # Minimal → Base format
│   ├── exporter.py        # Base → ShareGPT/Alpaca/OpenAI
│   └── stats.py           # Dataset statistics
├── exports/               # Exported datasets
├── server.py              # Flask backend
├── config.json            # Configuration
└── requirements.txt
```

## Export Formats

### ShareGPT (LLaMA-Factory)
```json
{"conversations": [{"role": "human", "content": "..."}, {"role": "gpt", "content": "..."}]}
```

### OpenAI
```json
{"messages": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
```

### Alpaca
```json
{"instruction": "...", "input": "", "output": "..."}
```

## CLI Usage

### Export dataset

```bash
# Export to all formats
python scripts/exporter.py --format all

# Export to specific format
python scripts/exporter.py --format sharegpt
```

### View statistics

```bash
python scripts/stats.py

# JSON output
python scripts/stats.py --json
```

### Parse a conversation file

```bash
python scripts/parser.py
```

## Configuration

### Via UI
The left panel has settings for:
- **Provider**: OpenAI, Anthropic, or Google
- **Model**: Model name (auto-updates when provider changes)
- **Temperature**: 0-2 slider
- **API Key**: Saved per-provider, masked for security
- **Base URL**: Customizable for proxies or compatible APIs (e.g., Azure, local LLMs)

### Via config.json

Copy `config.example.json` to `config.json`:

```bash
cp config.example.json config.json
```

Then edit as needed:

```json
{
  "api": {
    "provider": "openai",
    "model": "gpt-4o",
    "temperature": 0.9
  },
  "providers": {
    "openai": {
      "base_url": "https://api.openai.com/v1",
      "api_key": "sk-..."
    }
  },
  "server": {
    "host": "127.0.0.1",
    "port": 5000,
    "allowed_ips": ["127.0.0.1"],
    "password": "your-secure-password"
  }
}
```

### Security Configuration

You can secure the web UI by configuring the `server` block in `config.json`:

*   **`allowed_ips`**: An array of allowed IP addresses. If provided, only clients matching these IPs can access the server. Leave empty `[]` to allow all.
*   **`password`**: A password for HTTP Basic Authentication. If provided, users will be prompted for this password when accessing the UI. Leave empty `""` to disable authentication.

### Custom Base URLs

You can use alternative endpoints:

| Use Case | Base URL |
|----------|----------|
| OpenAI | `https://api.openai.com/v1` |
| Azure OpenAI | `https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT` |
| Local (Ollama) | `http://localhost:11434/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Together AI | `https://api.together.xyz/v1` |

## License

Apache License 2.0
