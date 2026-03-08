# Synthetic Dataset Builder

Synthetic Dataset Builder is a local web app for generating, reviewing, curating, and exporting conversational datasets.

It is built around a simple model:

- the browser UI is the primary workspace
- SQLite is the single source of truth for dataset state
- prompt templates stay as plain text files in `data/prompts/`
- exports are written as JSONL files in `exports/`

## Features

- Generate conversations with OpenAI, Anthropic, Google, and OpenAI-compatible APIs
- Review generated items in a queue before keeping or rejecting them
- Edit review items inline before saving them
- Manage saved conversations with search, tags, preview, move, and delete flows
- Export selected conversations as ShareGPT, OpenAI, or Alpaca
- Save chat and export presets in SQLite
- Use prompt macros such as `{{variable}}`, `{{random}}`, `{{list}}`, `{{roll}}`, and comments
- Work with local-first drafts and offline-safe review queue syncing
- Configure hotkeys, sync behavior, and provider defaults from the UI

## Performance Notes

- Large lists (Files, Export selection, Review Browser) are virtualized by default so only nearby rows are rendered while scrolling.
  You can tune this under `Settings -> Advanced`:
  - "Rows per chunk" (how many rows render at a time)
  - "Chunks kept around you" (render distance)
- "Load All" fetches pages in the background and is cancelable from the on-screen loading tracker.
- Review "Keep All" and "Reject All" process the queue in batches for stability (progress + cancel support) instead of loading the full queue into RAM.

## Quick Start

### 1. Install

```bash
python3 -m pip install -r requirements.txt
```

### 2. Configure

Create `config.yaml` from `config.example.yaml` if you want to customize host, auth, or trusted domains before first run.

Default server config:

```yaml
server:
  host: "127.0.0.1"
  port: 5000
  allowed_ips: []
  password: ""
  allow_local_network: true
  trusted_domains: []
```

API keys and model/base URL settings are managed from the app UI and stored in SQLite.

### 3. Run

```bash
python3 server.py
```

Then open `http://127.0.0.1:5000`.

## Storage

```text
data/
├── dataset.db          # conversations, review queue, drafts, presets, provider settings
└── prompts/            # prompt template .txt files

defaults/               # built-in prompt and preset seed files
exports/                # generated dataset files
benchmark/              # standalone benchmark scripts and disposable benchmark DBs
ui/                     # frontend
scripts/                # storage, export, parser, stats helpers
```

## Export Formats

### ShareGPT

```json
{"conversations":[{"role":"human","content":"..."},{"role":"gpt","content":"..."}]}
```

### OpenAI

```json
{"messages":[{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}
```

### Alpaca

```json
{"instruction":"...","input":"","output":"..."}
```

## Macros

Macros are resolved before prompt submission.

- `{{name}}` inserts a named variable
- `{{random::a::b::c}}` picks one option randomly
- `{{list::a::b::c}}` iterates options across generations
- `{{roll:2d6+3}}` rolls dice notation
- `{{// note}}` is removed before sending

## CLI

Export all wanted conversations:

```bash
python3 scripts/exporter.py --format all
```

Export rejected conversations as OpenAI JSONL:

```bash
python3 scripts/exporter.py --format openai --folder rejected
```

Seed a standalone benchmark database:

```bash
python3 benchmark/stress_seed.py --wanted 2000 --review 3000
```

Run local storage benchmarks against that benchmark database.
If `benchmark/benchmark.db` does not exist yet, this command creates and seeds it automatically:

```bash
python3 benchmark/benchmark.py --include-write
```

Print dataset stats:

```bash
python3 scripts/stats.py
```

Print dataset stats as JSON:

```bash
python3 scripts/stats.py --json
```

## Notes

- `exports/` is created automatically if missing.
- `data/prompts/Default.txt` is created automatically from `defaults/Generate.txt` on first run.
- The app does not depend on JSON conversation folders or alternate config formats.
- Benchmark tooling lives under `benchmark/` and defaults to `benchmark/benchmark.db`, which is auto-created and gitignored so you can stress-test without touching `data/dataset.db`.

## License

Apache License 2.0
