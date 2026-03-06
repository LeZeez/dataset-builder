# 🗂️ Synthetic Dataset Builder

A tool for creating, curating, and exporting synthetic conversation datasets using frontier LLMs.

## Features

- **Web UI** — Generate, review, and curate conversations from a browser
- **Multi-provider support** — OpenAI, Anthropic, Google Gemini (and any OpenAI-compatible API)
- **Macros engine** — Dynamic prompt templating with `{{variables}}`, `{{random}}`, `{{list}}`, `{{roll}}`, and comment macros
- **Prompt History** — Review and restore previously sent (resolved) prompts
- **Bulk generation** — Generate multiple conversations in one shot with a review queue
- **Export formats** — ShareGPT, OpenAI, Alpaca with an export management modal (rename, download, delete)
- **Chat tab** — Interactive multi-turn chat with fork, regenerate, and continue controls
- **Manage Files modal** — Browse, move, and delete saved conversations
- **Keyboard shortcuts** — Fully configurable for fast workflows
- **Security** — Optional IP whitelisting, HTTP Basic Auth, and SSRF-safe base URL validation

---

## Quick Start

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure

On first run, `config.json` is created automatically from `config.example.json`. You can set your API key either via the UI or directly in `config.json`.

### 3. Run

```bash
python server.py
```

Then open [http://localhost:5000](http://localhost:5000).

---

## Macros

Macros let you create dynamic, reusable prompt templates. They are resolved **before** the prompt is sent to the API.

### Variable `{{name}}`

Named variables are filled in from the **Variables panel** that appears when you type `{{name}}` in your prompt.

```
Write a short story about {{topic}} for a {{age}} year old.
```

### Random `{{random::a::b::c}}`

Picks one item at random each time the prompt is sent. No item limit.

```
The user's mood is {{random::happy::sad::curious::angry}}.
```

### List `{{list::a::b::c}}`

Iterates through items in order (cycling back to the start). Useful with bulk generation.

```
Write a {{list::beginner::intermediate::advanced}} guide.
```

### Dice Roll `{{roll:NdN+M}}`

Rolls standard tabletop dice. The modifier (`+M` or `-M`) is optional.

| Macro | Result |
|---|---|
| `{{roll:1d20}}` | 1–20 |
| `{{roll:2d6+3}}` | 5–15 |
| `{{roll:1d100-5}}` | -4–95 |

### Comment `{{// your note}}`

Stripped from the prompt before it is sent. Useful for inline notes or disabled sections.

```
{{// TODO: make this more formal}}
Explain {{topic}} simply.
```

### Nesting

Macros resolve recursively (up to 3 levels). If a variable's value contains a macro syntax, it will also be resolved:

- Variable `topic` = `random::history::science::math`
- `{{topic}}` in the prompt → picks one of the three at random

### Macros Panel

Click the **Macros button** (layers icon) in the prompt toolbar to open the Macros panel, which includes:

- **Reference tab** — Syntax guide for all macro types
- **Builder tab** — Enter items one per line to auto-generate `{{random::...}}` or `{{list::...}}` macros (or build a `{{roll}}` with a notation input)
- **History tab** — View the last N sent prompts with macros already resolved; click one to restore it to the prompt editor

The history limit (default: 30) is configurable under **Auto-Sync Settings** in the sidebar.

---

## Keyboard Shortcuts

Shortcuts are configurable in the sidebar.

| Shortcut | Action |
|---|---|
| `Ctrl+G` | Generate conversation |
| `Ctrl+Enter` | Save to wanted |
| `Ctrl+Backspace` | Reject |
| `S` | Keep (Review tab) |
| `X` | Reject (Review tab) |
| `J` / `K` | Next / Previous (Review tab) |

---

## Input Format

Conversations in the **Edit** view use `---` as turn delimiters:

```
user: Hello, how are you?
What have you been up to lately?
---
gpt: I'm doing great, thanks!
How about yourself?
```

---

## Project Structure

```
dataset-builder/
├── ui/                     # Web interface
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── data/
│   ├── wanted/             # Approved conversations
│   ├── rejected/           # Discarded conversations
│   └── prompts/            # Saved prompt templates
├── defaults/               # Default prompt & config templates
├── scripts/
│   ├── parser.py           # Minimal → Base format converter
│   ├── exporter.py         # Base → ShareGPT / Alpaca / OpenAI
│   └── stats.py            # Dataset statistics
├── exports/                # Exported datasets
├── server.py               # Flask backend
├── config.json             # Configuration (auto-created on first run)
├── config.example.json     # Configuration template
└── requirements.txt
```

---

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

---

## Configuration

### `config.json`

`config.json` is auto-created from `config.example.json` on first run. Edit it to set defaults:

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
    },
    "anthropic": { "api_key": "" },
    "google":    { "api_key": "" }
  },
  "server": {
    "host": "127.0.0.1",
    "port": 5000,
    "allowed_ips": [],
    "password": ""
  }
}
```

### Security

- **`allowed_ips`** — Array of allowed client IPs. Leave empty (`[]`) to allow all.
- **`password`** — Enables HTTP Basic Authentication. Leave empty (`""`) to disable.
- **`allow_local_network`** — When `true` (default), allows `localhost`, LAN IPs, and any custom base URL. Set to `false` if you expose the server publicly to enable SSRF protection.
- **`trusted_domains`** — Array of additional trusted API domains (e.g. `["my-proxy.example.com"]`). Built-in trusted domains: OpenAI, Anthropic, Google, OpenRouter, Together AI.

### Compatible API Endpoints

Set a custom `base_url` under the provider to use alternative backends:

| Backend | Base URL |
|---|---|
| OpenAI | `https://api.openai.com/v1` |
| Azure OpenAI | `https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT` |
| Ollama (local) | `http://localhost:11434/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Together AI | `https://api.together.xyz/v1` |

> **Note:** Local endpoints (Ollama, LM Studio, etc.) work by default since `allow_local_network` is `true`. If you set it to `false`, add their domains to `trusted_domains` in your config.

---

## CLI Tools

```bash
# Export to all formats
python scripts/exporter.py --format all

# Export to a specific format
python scripts/exporter.py --format sharegpt

# View dataset statistics
python scripts/stats.py

# JSON output
python scripts/stats.py --json
```

---

## License

Apache License 2.0
