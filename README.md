# 🗂️ Synthetic Dataset Generator

A tool for creating synthetic conversation datasets using frontier LLMs.

## Features

- **Web UI** for generating, reviewing, and curating conversations
- **Multi-provider support**: OpenAI, Anthropic, Google Gemini
- **Simple input format** with multi-line message support
- **Export to popular formats**: ShareGPT, OpenAI, Alpaca
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
3. In the right panel under "🔑 API Configuration"
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
{"conversations": [{"from": "human", "value": "..."}, {"from": "gpt", "value": "..."}]}
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
The right panel has settings for:
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
  }
}
```

### Custom Base URLs

You can use alternative endpoints:

| Use Case | Base URL |
|----------|----------|
| OpenAI | `https://api.openai.com/v1` |
| Azure OpenAI | `https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT` |
| Local (Ollama) | `http://localhost:11434/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Together AI | `https://api.together.xyz/v1` |

## Tips for Quality Data

1. **Be specific in prompts** - Include example scenarios and expressions
2. **Use tags** - Tag conversations by topic for balanced datasets
3. **Rate conversations** - Use ratings to filter high-quality samples later
4. **Edit before saving** - The edit mode lets you fix issues before saving
5. **Review rejected** - Sometimes rejected conversations have salvageable parts

## License

Apache License 2.0
