"""
Backend server for Synthetic Dataset Builder

Provides API endpoints for:
- Conversation generation (via LLM APIs) with streaming support
- Model discovery and management
- Saving/loading conversations
- Exporting datasets
- Statistics
- Prompt template management (CRUD)
- Health check for sync engine
"""

import argparse
import hmac
import hashlib
import ipaddress
import json
import logging
import os
import re
import shutil
import socket
import threading
import traceback
import uuid
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from typing import Generator
from urllib.parse import urlparse
import anthropic
import google.generativeai as genai
import openai
import yaml
from flask import Flask, Response, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import BadRequest, HTTPException

# Import our modules
from scripts.parser import validate_conversation
from scripts.exporter import export_dataset, to_sharegpt, to_openai, to_alpaca, preview_export_lines
from scripts import database as db

# Load config
CONFIG_PATH = Path('config.yaml')
DATA_DIR = Path('data')
VALID_FOLDERS = ('wanted', 'rejected')
VALID_PROVIDERS = ('openai', 'anthropic', 'google')
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
MAX_MESSAGE_FIELD_CHARS = 16_000

_config_lock = threading.Lock()
LOGGER = logging.getLogger(__name__)


def _get_json_object():
    """Return a JSON object body or an empty dict for an empty body.

    Returns `None` for JSON values that are not objects, including an explicit
    `null` payload. Raises `BadRequest` for malformed JSON payloads.
    """
    raw_body = request.get_data(cache=True)
    if not raw_body or not raw_body.strip():
        return {}
    data = request.get_json(silent=False)
    if data is None:
        return None
    if not isinstance(data, dict):
        return None
    return data


def _get_json_object_or_error():
    """Return a JSON object body or a ready-made 400 response tuple."""
    try:
        data = _get_json_object()
    except BadRequest:
        return None, (jsonify({'error': 'Invalid JSON payload'}), 400)
    if data is None:
        return None, (jsonify({'error': 'Invalid JSON payload'}), 400)
    return data, None


def _parse_bool_flag(raw_value) -> bool:
    """Parse booleans explicitly so string payloads like 'false' stay false."""
    if isinstance(raw_value, bool):
        return raw_value
    if isinstance(raw_value, str):
        normalized = raw_value.strip().lower()
        if normalized in ('true', '1', 'yes', 'on'):
            return True
        if normalized in ('false', '0', 'no', 'off'):
            return False
    return False


def _truncate_large_fields(value, max_chars: int = MAX_MESSAGE_FIELD_CHARS):
    """Recursively cap large string payloads before returning them to the client."""
    truncated = False

    if isinstance(value, str):
        if len(value) <= max_chars:
            return value, False
        return value[:max_chars] + "\n[truncated]", True

    if isinstance(value, list):
        items = []
        for item in value:
            capped_item, item_truncated = _truncate_large_fields(item, max_chars=max_chars)
            items.append(capped_item)
            truncated = truncated or item_truncated
        return items, truncated

    if isinstance(value, dict):
        output = {}
        for key, item in value.items():
            capped_item, item_truncated = _truncate_large_fields(item, max_chars=max_chars)
            output[key] = capped_item
            truncated = truncated or item_truncated
        return output, truncated

    return value, False


def _cap_paginated_response(item_key: str, items: list, total: int, limit: int, offset: int):
    """Keep paginated JSON responses below a server-side byte ceiling."""
    base_payload = {item_key: [], 'count' if item_key == 'queue' else 'total': total, 'limit': limit, 'offset': offset}
    envelope_bytes = len(json.dumps(base_payload, ensure_ascii=False).encode('utf-8')) - 2

    bounded_items = []
    items_bytes = 2
    fields_truncated = False
    response_truncated = False

    for item in items:
        bounded_item, item_truncated = _truncate_large_fields(item)
        item_bytes = len(json.dumps(bounded_item, ensure_ascii=False).encode('utf-8'))
        next_total_bytes = envelope_bytes + items_bytes + item_bytes + (1 if bounded_items else 0)
        if next_total_bytes > MAX_RESPONSE_BYTES:
            response_truncated = True
            break
        bounded_items.append(bounded_item)
        items_bytes += item_bytes + (1 if len(bounded_items) > 1 else 0)
        fields_truncated = fields_truncated or item_truncated

    if (fields_truncated or response_truncated) and items:
        LOGGER.warning(
            "Capped paginated response for %s at offset=%s limit=%s returned=%s total=%s field_truncated=%s response_truncated=%s",
            item_key,
            offset,
            limit,
            len(bounded_items),
            total,
            fields_truncated,
            response_truncated,
        )

    oversized_single_item = bool(items and not bounded_items)
    return bounded_items, (fields_truncated or response_truncated), oversized_single_item


def is_safe_id(id_str: str) -> bool:
    """Checks for path traversal characters in an ID."""
    if not isinstance(id_str, str):
        return False
    return '..' not in id_str and '/' not in id_str and '\\' not in id_str


def is_valid_folder(folder: str) -> bool:
    """Checks if a folder is in the allowlist."""
    return folder in VALID_FOLDERS

def setup_defaults():
    # Setup prompt directories
    prompts_dir = DATA_DIR / 'prompts'
    prompts_dir.mkdir(parents=True, exist_ok=True)

    # Copy Generate.txt to Default.txt
    defaults_prompt = Path(__file__).parent / "defaults" / "Generate.txt"
    default_destination = DATA_DIR / "prompts" / "Default.txt"
    if not default_destination.exists() and defaults_prompt.exists():
        try:
            shutil.copy2(defaults_prompt, default_destination)
        except PermissionError:
            print(f"[Warning] Permission denied when copying Generate.txt")

    # Create config.yaml from example if needed
    if not CONFIG_PATH.exists():
        config_example = Path(__file__).parent / "config.example.yaml"
        if config_example.exists():
            try:
                shutil.copy2(config_example, CONFIG_PATH)
            except (FileNotFoundError, PermissionError):
                pass
        else:
            # Create minimal default
            default_config = {
                'server': {
                    'host': '127.0.0.1',
                    'port': 5000,
                    'allowed_ips': [],
                    'password': '',
                    'allow_local_network': True,
                    'trusted_domains': []
                },
                'database': {
                    'path': 'data/dataset.db'
                },
            }
            try:
                with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
                    yaml.dump(default_config, f, default_flow_style=False, allow_unicode=True)
            except PermissionError:
                print("[Warning] Permission denied when creating config.yaml")

setup_defaults()

def ensure_config_defaults() -> dict:
    """Ensure config.yaml has required default keys without overwriting user values."""
    config = load_config()
    if not isinstance(config, dict):
        config = {}

    changed = False

    server_cfg = config.get('server')
    if not isinstance(server_cfg, dict):
        server_cfg = {}
        config['server'] = server_cfg
        changed = True

    # Only fill missing keys; never override a user-provided value.
    for k, v in {
        'host': '127.0.0.1',
        'port': 5000,
        'allowed_ips': [],
        'password': '',
        'allow_local_network': True,
        'trusted_domains': [],
    }.items():
        if k not in server_cfg:
            server_cfg[k] = v
            changed = True

    db_cfg = config.get('database')
    if not isinstance(db_cfg, dict):
        db_cfg = {}
        config['database'] = db_cfg
        changed = True

    if not isinstance(db_cfg.get('path'), str) or not db_cfg.get('path', '').strip():
        db_cfg['path'] = 'data/dataset.db'
        changed = True

    if changed:
        try:
            save_config(config)
        except Exception:
            # Best-effort; avoid crashing server start because config is read-only.
            LOGGER.exception("Failed to save config; continuing startup")

    return config

def load_config() -> dict:
    with _config_lock:
        if CONFIG_PATH.exists():
            try:
                with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                    return yaml.safe_load(f) or {}
            except (yaml.YAMLError, IOError):
                return {}
        return {}

app = Flask(__name__, static_folder='ui', static_url_path='')
_app_initialized = False

# Filter out /api/drafts and /api/health logs
class QuietFilter(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        return '/api/drafts' not in msg and '/api/health' not in msg

# Apply the filter to Werkzeug logger
log = logging.getLogger('werkzeug')
log.addFilter(QuietFilter())


def _is_loopback_host(hostname: str) -> bool:
    if not hostname:
        return False
    normalized = hostname.strip().strip('[]')
    if not normalized:
        return False
    if normalized.lower() == 'localhost':
        return True
    if normalized == '0.0.0.0':
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except Exception:
        return False


def _normalize_origin(url: str) -> str:
    try:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return ''
        return f'{parsed.scheme}://{parsed.netloc}'
    except Exception:
        return ''


def _append_origin(allowed: list, origin):
    if origin and origin not in allowed:
        allowed.append(origin)


def _origin_matches_allowed(origin: str, allowed_origins: list) -> bool:
    for allowed in allowed_origins:
        if isinstance(allowed, str):
            if origin == allowed:
                return True
            continue
        try:
            if allowed.match(origin):
                return True
        except Exception:
            continue
    return False


def _add_origin_variants(allowed_exact: set[str], host: str, port: int | str | None = None):
    if not isinstance(host, str) or not host.strip():
        return
    safe_host = host.strip()
    hosts = {safe_host}
    normalized_host = safe_host.strip('[]')
    if ':' in normalized_host and safe_host == normalized_host:
        hosts.add(f'[{normalized_host}]')
    for candidate in hosts:
        allowed_exact.add(f'http://{candidate}')
        allowed_exact.add(f'https://{candidate}')
        if port is not None:
            allowed_exact.add(f'http://{candidate}:{port}')
            allowed_exact.add(f'https://{candidate}:{port}')


def _build_loopback_origin_patterns() -> list[re.Pattern[str]]:
    return [
        re.compile(r'^https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?$'),
    ]


def build_allowed_origins(config: dict) -> list:
    """Build the allowed origins list for CORS."""
    server_config = config.get('server', {})
    host = server_config.get('host', '127.0.0.1')
    port = server_config.get('port', 5000)

    allowed_exact: set[str] = set()
    allowed_patterns: list[re.Pattern[str]] = []

    _add_origin_variants(allowed_exact, 'localhost', port=port)
    _add_origin_variants(allowed_exact, '127.0.0.1', port=port)
    _add_origin_variants(allowed_exact, '0.0.0.0', port=port)
    _add_origin_variants(allowed_exact, '::1', port=port)

    if _is_loopback_host(str(host or '').strip()):
        allowed_patterns.extend(_build_loopback_origin_patterns())

    # Always include the configured host; this is safe for CSRF checks because
    # the Origin header of a cross-site request will still be the attacker's origin.
    if isinstance(host, str) and host.strip():
        _add_origin_variants(allowed_exact, host, port=port)

    # Allow user-specified trusted domains (useful for reverse proxies / dev servers).
    # Accept either full origins (https://example.com:1234) or bare hosts (example.com).
    trusted = server_config.get('trusted_domains', [])
    if isinstance(trusted, list):
        for entry in trusted:
            if not isinstance(entry, str):
                continue
            value = entry.strip()
            if not value:
                continue
            if '://' in value:
                # Normalize to origin only.
                try:
                    parsed = urlparse(value)
                    if parsed.scheme and parsed.netloc:
                        allowed_exact.add(f'{parsed.scheme}://{parsed.netloc}')
                        if _is_loopback_host(parsed.hostname or ''):
                            allowed_patterns.extend(_build_loopback_origin_patterns())
                except Exception:
                    continue
            else:
                _add_origin_variants(allowed_exact, value, port=port)
                if _is_loopback_host(value):
                    allowed_patterns.extend(_build_loopback_origin_patterns())

    allowed: list = sorted(allowed_exact)
    for pattern in allowed_patterns:
        _append_origin(allowed, pattern)
    return allowed


def initialize_app():
    """Initialize storage, run migrations, and configure app-wide services."""
    global _app_initialized
    if _app_initialized:
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / 'prompts').mkdir(parents=True, exist_ok=True)
    Path('exports').mkdir(exist_ok=True)

    config = ensure_config_defaults()
    # Configure SQLite path early so migrations/seed happen in the right file.
    db_path = (config.get('database', {}) or {}).get('path') or 'data/dataset.db'
    try:
        db.set_db_path(Path(db_path))
    except Exception:
        # Fall back to default path if config is invalid.
        db.set_db_path(Path('data/dataset.db'))
    db.init_db()
    db.seed_default_presets(Path(__file__).parent / 'defaults')

    CORS(app, origins=build_allowed_origins(config))
    _app_initialized = True


@app.before_request
def security_check():
    """Ensure basic IP whitelisting and Basic Authentication if configured."""
    config = load_config()
    server_config = config.get('server', {})

    # Basic CSRF guard for browser-based requests:
    # For state-changing API calls, require Origin/Referer to match allowed origins.
    if request.method in ('POST', 'PUT', 'PATCH', 'DELETE') and request.path.startswith('/api/'):
        allowed = list(build_allowed_origins(config))

        # Also allow the current host origin in both http/https forms (covers opening the app via
        # 0.0.0.0 / LAN IP / hostname / proxy where scheme may differ).
        try:
            _append_origin(allowed, f'http://{request.host}')
            _append_origin(allowed, f'https://{request.host}')
            _append_origin(allowed, f'{request.scheme}://{request.host}')
        except Exception:
            pass

        origin = (request.headers.get('Origin') or '').strip()
        origin_norm = _normalize_origin(origin) if origin else ''

        if origin and origin.lower() == 'null':
            return jsonify({'error': 'Forbidden: invalid origin'}), 403

        if origin_norm:
            if not _origin_matches_allowed(origin_norm, allowed):
                return jsonify({'error': 'Forbidden: invalid origin'}), 403
        else:
            referer = (request.headers.get('Referer') or '').strip()
            if referer:
                ref_origin = _normalize_origin(referer)
                if ref_origin and not _origin_matches_allowed(ref_origin, allowed):
                    return jsonify({'error': 'Forbidden: invalid referer'}), 403

    # Check IP Whitelist
    allowed_ips = server_config.get('allowed_ips', [])
    if allowed_ips and isinstance(allowed_ips, list) and len(allowed_ips) > 0:
        client_ip = request.remote_addr
        if client_ip not in allowed_ips:
            return jsonify({'error': 'Forbidden: IP not allowed'}), 403

    # Check Basic Auth
    required_password = server_config.get('password', '')
    if required_password:
        auth = request.authorization
        if not auth or not hmac.compare_digest(auth.password, required_password):
            return Response(
                json.dumps({'error': 'Unauthorized'}),
                401,
                {'WWW-Authenticate': 'Basic realm="Login Required"', 'Content-Type': 'application/json'}
            )


def save_config(config: dict):
    with _config_lock:
        temp_path = CONFIG_PATH.with_suffix('.yaml.tmp')
        with open(temp_path, 'w', encoding='utf-8') as f:
            yaml.dump(config, f, default_flow_style=False, allow_unicode=True)
        os.replace(temp_path, CONFIG_PATH)


@app.errorhandler(Exception)
def handle_exception(e):
    """Return JSON instead of HTML for HTTP errors and uncaught exceptions."""

    if isinstance(e, HTTPException):
        return jsonify({'error': e.description}), e.code

    # Log the full traceback for 500 errors
    app.logger.error(f"Unhandled exception: {str(e)}\n{traceback.format_exc()}")
    return jsonify({'error': 'An internal server error occurred.'}), 500


# Serve UI
@app.route('/')
def serve_ui():
    return send_from_directory('ui', 'index.html')


@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('ui', path)


# ============ HEALTH CHECK ============

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint for sync engine connectivity detection."""
    return jsonify({'status': 'ok', 'timestamp': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')})


# ============ CONFIG ============

@app.route('/api/config', methods=['GET'])
def get_config():
    """Get current configuration (API settings from DB, server from config file)."""
    api_settings = db.get_provider_settings()
    # Mask API keys for security (show last 4 chars only)
    safe_settings = json.loads(json.dumps(api_settings))
    for provider in safe_settings.get('providers', {}).values():
        key = provider.get('api_key', '')
        if key and len(key) > 4:
            provider['api_key'] = '•' * 20 + key[-4:]
    return jsonify(safe_settings)

@app.route('/api/server-config', methods=['GET'])
def get_server_config():
    """Get server-side configuration (config.yaml-backed)."""
    config = ensure_config_defaults()
    server_config = config.get('server', {}) or {}
    database_config = config.get('database', {}) or {}
    return jsonify({
        'server': {
            'host': server_config.get('host', '127.0.0.1'),
            'port': server_config.get('port', 5000),
            'allowed_ips': server_config.get('allowed_ips', []),
            'password': '•' * 8 if server_config.get('password') else '',
            'allow_local_network': bool(server_config.get('allow_local_network', True)),
            'trusted_domains': server_config.get('trusted_domains', []),
        },
        'database': {
            'path': database_config.get('path', 'data/dataset.db'),
        }
    })


@app.route('/api/server-config', methods=['POST'])
def update_server_config():
    """Update server-side config (config.yaml-backed).

    For database.path, this endpoint only validates and persists the new path.
    A process restart is required to fully switch the live app to the new DB file.
    """
    try:
        data = _get_json_object()
    except BadRequest:
        return jsonify({'error': 'Invalid JSON payload'}), 400
    if data is None:
        return jsonify({'error': 'Invalid JSON payload'}), 400
    config = ensure_config_defaults()
    if not isinstance(config, dict):
        config = {}

    db_cfg = config.get('database', {}) if isinstance(config.get('database', {}), dict) else {}
    desired_path = (data.get('database', {}) or {}).get('path')
    if isinstance(desired_path, str):
        desired_path = desired_path.strip()
        if not desired_path:
            return jsonify({'error': 'database.path is required'}), 400
        # Basic guardrail: disallow null bytes
        if '\x00' in desired_path:
            return jsonify({'error': 'Invalid database.path'}), 400
        db_cfg['path'] = desired_path
        config['database'] = db_cfg

        # Validate that we can open/create the file (without hot-swapping the live DB).
        try:
            import sqlite3
            p = Path(desired_path)
            if p.exists() and p.is_dir():
                return jsonify({'error': 'database.path must be a file, not a directory'}), 400
            p.parent.mkdir(parents=True, exist_ok=True)
            with sqlite3.connect(str(p), timeout=1) as test_conn:
                test_conn.execute("PRAGMA user_version")
        except Exception as e:
            return jsonify({'error': f'Failed to validate database.path: {e}'}), 400

    save_config(config)
    return jsonify({'success': True, 'restart_required': True})

@app.route('/api/databases/list', methods=['GET'])
def list_database_files():
    """List candidate SQLite database files for the Settings → Databases chooser.

    This is intentionally limited to known local workspace folders to avoid leaking server
    filesystem structure.
    """
    config = ensure_config_defaults()
    current = ((config.get('database', {}) or {}).get('path') or 'data/dataset.db').strip()
    candidates: set[str] = set()
    if current:
        candidates.add(current)

    roots = [Path('data'), Path('data') / 'backups', Path('benchmark')]
    for root in roots:
        try:
            if root.exists() and root.is_dir():
                for p in sorted(root.glob('*.db')):
                    candidates.add(str(p))
        except Exception:
            continue

    return jsonify({
        'current': current,
        'candidates': sorted(candidates),
    })


@app.route('/api/databases/backup', methods=['POST'])
def backup_database_file():
    """Create a safe SQLite backup copy of the current database into data/backups/."""
    initialize_app()
    src = Path(db.DB_PATH)
    if not src.exists():
        return jsonify({'error': f'Database not found: {src}'}), 404

    backup_dir = DATA_DIR / 'backups'
    backup_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
    dest = backup_dir / f'dataset_backup_{ts}.db'

    try:
        import sqlite3
        with sqlite3.connect(str(src), check_same_thread=False) as src_conn:
            with sqlite3.connect(str(dest), check_same_thread=False) as dest_conn:
                src_conn.backup(dest_conn)
    except Exception as e:
        try:
            if dest.exists():
                dest.unlink()
        except Exception:
            pass
        return jsonify({'error': f'Backup failed: {e}'}), 500

    return jsonify({'success': True, 'path': str(dest)})


@app.route('/api/config', methods=['POST'])
def update_config():
    """Update configuration (API keys, base URLs, etc) - stored in DB."""
    data, error = _get_json_object_or_error()
    if error:
        return error

    # Update provider-specific settings
    if 'provider' in data:
        provider = data['provider']

        # Update API key (only if not masked)
        if 'api_key' in data and not data['api_key'].startswith('•'):
            db.set_api_setting(f'{provider}.api_key', data['api_key'])

        # Update base URL
        if 'base_url' in data:
            if not validate_base_url(data['base_url']):
                return jsonify({'error': 'Invalid base URL'}), 400
            db.set_api_setting(f'{provider}.base_url', data['base_url'])

    # Update default provider/model/temperature
    if 'default_provider' in data:
        db.set_api_setting('provider', data['default_provider'])
    if 'default_model' in data:
        db.set_api_setting('model', data['default_model'])
    if 'default_temperature' in data:
        db.set_api_setting('temperature', str(data['default_temperature']))
    if 'default_max_tokens' in data:
        db.set_api_setting('max_tokens', str(data['default_max_tokens']))

    return jsonify({'success': True})


@app.route('/api/config/key', methods=['POST'])
def set_api_key():
    """Set API key for a provider."""
    data, error = _get_json_object_or_error()
    if error:
        return error
    provider = data.get('provider')
    api_key = data.get('api_key', '')

    if not provider:
        return jsonify({'error': 'Provider required'}), 400

    db.set_api_setting(f'{provider}.api_key', api_key)

    return jsonify({'success': True})


@app.route('/api/config/baseurl', methods=['POST'])
def set_base_url():
    """Set base URL for a provider."""
    data, error = _get_json_object_or_error()
    if error:
        return error
    provider = data.get('provider')
    base_url = data.get('base_url', '')

    if not provider:
        return jsonify({'error': 'Provider required'}), 400

    if base_url and not validate_base_url(base_url):
        return jsonify({'error': 'Invalid base URL'}), 400

    db.set_api_setting(f'{provider}.base_url', base_url)

    return jsonify({'success': True})


# ============ PROMPT TEMPLATES (CRUD) ============

@app.route('/api/prompts', methods=['GET'])
def list_prompts():
    """List all available prompt templates."""
    prompts_dir = DATA_DIR / 'prompts'
    prompts_dir.mkdir(parents=True, exist_ok=True)
    
    prompts = []
    for f in sorted(prompts_dir.glob('*.txt')):
        content = f.read_text(encoding='utf-8')
        # Extract variables
        variables = list(set(re.findall(r'\{\{(\w+)\}\}', content)))
        prompts.append({
            'name': f.stem,
            'content': content,
            'variables': variables,
            'size': len(content)
        })
    
    return jsonify({'prompts': prompts})


@app.route('/api/prompts/<name>', methods=['GET'])
def get_prompt(name: str):
    """Get a single prompt template by name."""
    # Sanitize name
    safe_name = re.sub(r'[^a-zA-Z0-9_-]', '', name)
    prompt_path = DATA_DIR / 'prompts' / f'{safe_name}.txt'
    
    if not prompt_path.exists():
        return jsonify({'error': 'Prompt not found'}), 404
    
    content = prompt_path.read_text(encoding='utf-8')
    variables = list(set(re.findall(r'\{\{(\w+)\}\}', content)))
    
    return jsonify({
        'name': safe_name,
        'content': content,
        'variables': variables
    })


@app.route('/api/prompts', methods=['POST'])
def save_prompt():
    """Create or update a prompt template."""
    data, error = _get_json_object_or_error()
    if error:
        return error
    name = data.get('name', '').strip()
    content = data.get('content', '')
    
    if not name:
        return jsonify({'error': 'Prompt name required'}), 400
    
    # Sanitize name (allow letters, numbers, underscores, hyphens)
    safe_name = re.sub(r'[^a-zA-Z0-9_-]', '', name)
    if not safe_name:
        return jsonify({'error': 'Invalid prompt name'}), 400
    
    prompts_dir = DATA_DIR / 'prompts'
    prompts_dir.mkdir(parents=True, exist_ok=True)
    
    prompt_path = prompts_dir / f'{safe_name}.txt'
    prompt_path.write_text(content, encoding='utf-8')
    
    variables = list(set(re.findall(r'\{\{(\w+)\}\}', content)))
    
    return jsonify({
        'success': True,
        'name': safe_name,
        'variables': variables
    })


@app.route('/api/prompts/<name>', methods=['DELETE'])
def delete_prompt(name: str):
    """Delete a prompt template."""
    safe_name = re.sub(r'[^a-zA-Z0-9_-]', '', name)
    prompt_path = DATA_DIR / 'prompts' / f'{safe_name}.txt'
    
    if not prompt_path.exists():
        return jsonify({'error': 'Prompt not found'}), 404
    
    prompt_path.unlink()
    return jsonify({'success': True})


# ============ STATS ============

@app.route('/api/stats', methods=['GET'])
def get_statistics():
    """Get dataset statistics."""
    counts = db.get_conversation_counts()
    details = db.get_stats() if request.args.get('details') == '1' else None

    return jsonify({
        'wanted': counts.get('wanted', 0),
        'rejected': counts.get('rejected', 0),
        'details': details
    })


# ============ CUSTOM PARAMS HELPER ============

def parse_param_value(value):
    """Try to convert string values to appropriate types."""
    if isinstance(value, (int, float, bool)):
        return value
    if not isinstance(value, str):
        return value
    if value.lower() == 'true':
        return True
    if value.lower() == 'false':
        return False
    try:
        return int(value)
    except (ValueError, TypeError):
        pass
    try:
        return float(value)
    except (ValueError, TypeError):
        pass
    return value


def prepare_custom_params(raw_params: dict) -> dict:
    """Parse custom params dict, converting values to appropriate types."""
    if not raw_params:
        return {}
    return {k: parse_param_value(v) for k, v in raw_params.items()}


# Default trusted API domains (can be extended via config.yaml server.trusted_domains)
_DEFAULT_TRUSTED_DOMAINS = (
    'api.openai.com',
    'api.anthropic.com',
    'generativelanguage.googleapis.com',
    'openrouter.ai',
    'api.together.xyz',
)


def _get_trusted_domains(config: dict) -> tuple:
    """Get trusted domains from config, falling back to defaults."""
    extra = config.get('server', {}).get('trusted_domains', [])
    if extra:
        return tuple(set(_DEFAULT_TRUSTED_DOMAINS) | set(extra))
    return _DEFAULT_TRUSTED_DOMAINS


def _is_private_ip(hostname: str) -> bool:
    """Resolve hostname and check if it points to a private/reserved IP."""
    try:
        infos = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
        for _family, _type, _proto, _canonname, sockaddr in infos:
            ip = ipaddress.ip_address(sockaddr[0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return True
        return False
    except (socket.gaierror, ValueError):
        # If DNS resolution fails, treat as unsafe
        return True


def validate_base_url(url: str, config: dict = None) -> bool:
    """Validate base_url to prevent SSRF attacks.

    - Always blocks non-http(s) schemes
    - Always allows known trusted API domains (configurable via config.yaml)
    - If server.allow_local_network is true (default), allows any URL including
      localhost and private IPs — suitable for self-hosted setups
    - If server.allow_local_network is false, rejects private/loopback/link-local IPs
    """
    if not url:
        return True
    if config is None:
        config = load_config()
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ('http', 'https'):
            return False
        hostname = parsed.hostname
        if not hostname:
            return False

        # Always allow known trusted API domains
        trusted = _get_trusted_domains(config)
        if any(hostname == d or hostname.endswith('.' + d) for d in trusted):
            return True

        # Check config: allow_local_network defaults to true (self-hosted friendly)
        allow_local = config.get('server', {}).get('allow_local_network', True)
        if allow_local:
            return True

        # Strict mode: reject private/reserved IPs
        if _is_private_ip(hostname):
            return False

        return True
    except Exception:
        return False


def normalize_credentials_override(value) -> dict:
    """Normalize a request-scoped credentials override payload.

    Accepts only dicts, and only keeps string api_key/base_url fields.
    """
    if not isinstance(value, dict):
        return {}
    out = {}
    api_key = value.get('api_key')
    if isinstance(api_key, str) and api_key.strip():
        out['api_key'] = api_key.strip()
    base_url = value.get('base_url')
    if isinstance(base_url, str) and base_url.strip():
        out['base_url'] = base_url.strip()
    return out


def _resolve_credentials(provider_label: str,
                         provider_config: dict,
                         env_var: str,
                         default_base_url: str,
                         config: dict,
                         credentials_override: dict | None) -> tuple[str, str]:
    """Resolve API key/base_url for a request, preventing key exfil via base_url-only overrides."""
    override_key = (credentials_override or {}).get('api_key', '') or ''
    override_url = (credentials_override or {}).get('base_url', '') or ''

    # Critical: if the client overrides the endpoint, they must also provide the key.
    # Otherwise the server would send its stored key to an attacker-controlled URL.
    if override_url and not override_key:
        raise ValueError(f"{provider_label}: 'api_key' is required when overriding 'base_url'.")

    api_key = override_key or provider_config.get('api_key') or os.environ.get(env_var)
    if not api_key:
        raise ValueError(f'{provider_label} API key not set. Configure it in Settings.')

    base_url = override_url or provider_config.get('base_url') or default_base_url
    if base_url and not validate_base_url(base_url, config):
        raise ValueError(f'Invalid base URL configured for {provider_label}.')

    return api_key, base_url


def _google_api_endpoint(base_url: str) -> str:
    """Convert a configured base URL to a GAPIC api_endpoint."""
    if not base_url:
        return ''
    parsed = urlparse(base_url)
    if parsed.scheme and parsed.netloc:
        # Drop any /v1beta path component; the GAPIC client owns request routing.
        return f"{parsed.scheme}://{parsed.netloc}"
    return base_url


def _build_google_clients(api_key: str, base_url: str):
    """Build per-request Google Generative Language clients (avoids genai.configure global state)."""
    try:
        from google.api_core.client_options import ClientOptions
        try:
            from google.ai.generativelanguage_v1beta.services.generative_service import GenerativeServiceClient
            from google.ai.generativelanguage_v1beta.services.model_service import ModelServiceClient
        except ImportError:
            from google.ai.generativelanguage.services.generative_service import GenerativeServiceClient
            from google.ai.generativelanguage.services.model_service import ModelServiceClient
    except Exception as e:
        raise RuntimeError("Google client libraries not available; install dependencies from requirements.txt.") from e

    endpoint = _google_api_endpoint(base_url)
    try:
        opts = ClientOptions(api_key=api_key, **({'api_endpoint': endpoint} if endpoint else {}))
    except TypeError:
        # Older google-api-core may not support api_key on ClientOptions; fall back to dict.
        opts = {'api_key': api_key, **({'api_endpoint': endpoint} if endpoint else {})}

    return (
        GenerativeServiceClient(client_options=opts),
        ModelServiceClient(client_options=opts),
    )


# ============ GENERATION ============

@app.route('/api/generate', methods=['POST'])
def generate_conversation():
    """Generate a conversation using configured LLM."""
    data, error = _get_json_object_or_error()
    if error:
        return error
    prompt = data.get('prompt', '')
    provider = data.get('provider', 'openai')
    model = data.get('model', 'gpt-4o')
    temperature = data.get('temperature', 0.9)
    custom_params = prepare_custom_params(data.get('custom_params', {}))
    credentials_override = normalize_credentials_override(data.get('credentials_override'))
    
    config = load_config()
    
    try:
        if provider == 'openai':
            content = generate_openai(prompt, model, temperature, config, custom_params, credentials_override)
        elif provider == 'anthropic':
            content = generate_anthropic(prompt, model, temperature, config, custom_params, credentials_override)
        elif provider == 'google':
            content = generate_google(prompt, model, temperature, config, custom_params, credentials_override)
        else:
            return jsonify({'error': 'Unknown provider'}), 400

        return jsonify({'content': content})
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def generate_openai(prompt: str, model: str, temperature: float, config: dict, custom_params: dict = None,
                    credentials_override: dict | None = None) -> str:
    """Generate using OpenAI API."""

    api_settings = db.get_provider_settings()
    provider_config = api_settings.get('providers', {}).get('openai', {})

    # Try DB first, then environment variable
    api_key, base_url = _resolve_credentials(
        'OpenAI',
        provider_config,
        'OPENAI_API_KEY',
        'https://api.openai.com/v1',
        config,
        credentials_override,
    )

    client = openai.OpenAI(api_key=api_key, base_url=base_url)

    max_tokens = api_settings.get('max_tokens', 2048)
    kwargs = dict(
        model=model,
        messages=[{'role': 'user', 'content': prompt}],
        temperature=temperature,
        max_tokens=max_tokens
    )
    if custom_params:
        kwargs['extra_body'] = custom_params

    response = client.chat.completions.create(**kwargs)

    return response.choices[0].message.content


def generate_anthropic(prompt: str, model: str, temperature: float, config: dict, custom_params: dict = None,
                       credentials_override: dict | None = None) -> str:
    """Generate using Anthropic API."""

    api_settings = db.get_provider_settings()
    provider_config = api_settings.get('providers', {}).get('anthropic', {})

    api_key, base_url = _resolve_credentials(
        'Anthropic',
        provider_config,
        'ANTHROPIC_API_KEY',
        'https://api.anthropic.com/v1',
        config,
        credentials_override,
    )

    client = anthropic.Anthropic(api_key=api_key, base_url=base_url)

    max_tokens = api_settings.get('max_tokens', 2048)
    kwargs = dict(
        model=model or 'claude-3-5-sonnet-20241022',
        max_tokens=max_tokens,
        messages=[{'role': 'user', 'content': prompt}],
        temperature=temperature
    )
    if custom_params:
        kwargs.update(custom_params)

    response = client.messages.create(**kwargs)

    return response.content[0].text


def generate_google(prompt: str, model: str, temperature: float, config: dict, custom_params: dict = None,
                    credentials_override: dict | None = None) -> str:
    """Generate using Google Gemini API."""

    api_settings = db.get_provider_settings()
    provider_config = api_settings.get('providers', {}).get('google', {})

    api_key, base_url = _resolve_credentials(
        'Google',
        provider_config,
        'GOOGLE_API_KEY',
        '',
        config,
        credentials_override,
    )
    gen_client, _model_client = _build_google_clients(api_key, base_url)

    max_tokens = api_settings.get('max_tokens', 2048)
    gen_config = dict(
        temperature=temperature,
        max_output_tokens=max_tokens
    )
    if custom_params:
        gen_config.update(custom_params)

    gen_model = genai.GenerativeModel(model or 'gemini-1.5-flash')
    gen_model._client = gen_client
    response = gen_model.generate_content(
        prompt,
        generation_config=genai.types.GenerationConfig(**gen_config)
    )

    return response.text


# ============ SAVE ============

@app.route('/api/save', methods=['POST'])
def save_conversation_endpoint():
    """Save a conversation to wanted or rejected folder."""
    data, error = _get_json_object_or_error()
    if error:
        return error
    conversation = data.get('conversation', {})
    folder = data.get('folder', 'wanted')  # 'wanted' or 'rejected'
    metadata = data.get('metadata', {})

    if not is_valid_folder(folder):
        return jsonify({'error': 'Invalid folder'}), 400

    # Generate ID atomically via SQLite
    conv_id = db.generate_conversation_id()
    messages = conversation.get('conversations', [])

    # Build metadata
    full_metadata = {
        'created_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'source': 'synthetic',
        **metadata
    }

    # Build full conversation for validation
    full_conv = {
        'id': conv_id,
        'conversations': messages,
        'metadata': full_metadata
    }

    # Validate
    is_valid, errors = validate_conversation(full_conv)
    if not is_valid:
        return jsonify({'error': 'Invalid conversation', 'details': errors}), 400

    # Save to SQLite
    db.save_conversation(conv_id, messages, folder, full_metadata)

    return jsonify({
        'success': True,
        'id': conv_id
    })


# ============ BULK SAVE ============

@app.route('/api/save/bulk', methods=['POST'])
def save_bulk_conversations():
    """Save multiple conversations at once (for bulk generation review)."""
    data, error = _get_json_object_or_error()
    if error:
        return error
    items = data.get('items', [])
    folder = data.get('folder', 'wanted')

    if not is_valid_folder(folder):
        return jsonify({'error': 'Invalid folder'}), 400

    saved = []
    errors = []

    for item in items:
        try:
            conversation = item.get('conversation', {})
            metadata = item.get('metadata', {})

            conv_id = db.generate_conversation_id()
            messages = conversation.get('conversations', [])

            full_metadata = {
                'created_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
                'source': 'synthetic',
                **metadata
            }

            full_conv = {
                'id': conv_id,
                'conversations': messages,
                'metadata': full_metadata
            }

            is_valid, errs = validate_conversation(full_conv)
            if not is_valid:
                errors.append({'error': errs})
                continue

            db.save_conversation(conv_id, messages, folder, full_metadata)

            saved.append({'id': conv_id})
        except Exception as e:
            errors.append({'error': str(e)})

    return jsonify({
        'success': True,
        'saved_count': len(saved),
        'error_count': len(errors),
        'saved': saved,
        'errors': errors
    })


# ============ EXPORT ============

@app.route('/api/exports', methods=['GET'])
def list_exports():
    '''List all exported datasets.'''
    export_dir = Path('exports')
    if not export_dir.exists():
        return jsonify({'files': []})

    files = []
    for fmt_dir in export_dir.iterdir():
        if not fmt_dir.is_dir(): continue
        for file in fmt_dir.glob('*.jsonl'):
            try:
                stat = file.stat()
                files.append({
                    'name': file.name,
                    'format': fmt_dir.name,
                    'path': f"{fmt_dir.name}/{file.name}",
                    'size': stat.st_size,
                    'created_at': stat.st_mtime * 1000
                })
            except FileNotFoundError:
                continue

    files.sort(key=lambda x: x['created_at'], reverse=True)
    return jsonify({'files': files})

VALID_EXPORT_FORMATS = ('sharegpt', 'openai', 'alpaca')


def validate_export_params(f):
    """Decorator to validate export format and sanitize filename for export endpoints."""
    @wraps(f)
    def decorated(format, filename, *args, **kwargs):
        if format not in VALID_EXPORT_FORMATS:
            return jsonify({'error': 'Invalid format'}), 400
        filename = re.sub(r'[^a-zA-Z0-9_.-]', '', filename)
        if not filename or filename.startswith('.'):
            return jsonify({'error': 'Invalid filename'}), 400
        return f(format, filename, *args, **kwargs)
    return decorated


@app.route('/api/exports/<format>/<filename>', methods=['GET'])
@validate_export_params
def download_export(format: str, filename: str):
    '''Download an exported dataset.'''
    export_dir = Path('exports') / format
    return send_from_directory(str(export_dir), filename, as_attachment=True)


@app.route('/api/exports/<format>/<filename>', methods=['DELETE'])
@validate_export_params
def delete_export(format: str, filename: str):
    '''Delete an exported dataset.'''
    file_path = Path('exports') / format / filename
    if file_path.exists():
        file_path.unlink()
        return jsonify({'success': True})
    return jsonify({'error': 'File not found'}), 404


@app.route('/api/exports/<format>/<filename>', methods=['PUT'])
@validate_export_params
def rename_export(format: str, filename: str):
    '''Rename an exported dataset.'''
    data, error = _get_json_object_or_error()
    if error:
        return error
    new_filename = data.get('new_name', '')
    new_filename = re.sub(r'[^a-zA-Z0-9_.-]', '', new_filename)
    if not new_filename or new_filename.startswith('.') or not new_filename.endswith('.jsonl'):
        return jsonify({'error': 'Invalid new filename. Must end in .jsonl'}), 400

    file_path = Path('exports') / format / filename
    new_file_path = Path('exports') / format / new_filename

    if file_path.exists():
        if new_file_path.exists():
            return jsonify({'error': 'File already exists'}), 400
        file_path.rename(new_file_path)
        return jsonify({'success': True})
    return jsonify({'error': 'File not found'}), 404

@app.route('/api/export/<format>', methods=['POST'])
def export_dataset_endpoint(format: str):
    """Export dataset to specified format."""
    if format not in VALID_EXPORT_FORMATS:
        return jsonify({'error': 'Invalid format'}), 400
    
    try:
        try:
            data = _get_json_object()
        except BadRequest:
            return jsonify({'error': 'Invalid JSON payload'}), 400
        if data is None:
            return jsonify({'error': 'Invalid JSON payload'}), 400
        selected_ids = data.get('ids', None)  # List of IDs or None for all
        if selected_ids is not None and not isinstance(selected_ids, list):
            return jsonify({'error': 'ids must be an array of conversation IDs'}), 400
        folder = data.get('folder', 'wanted')
        if not is_valid_folder(folder):
            return jsonify({'error': 'Invalid folder'}), 400
        system_prompt = data.get('system_prompt', None)
        system_prompt_mode = data.get('system_prompt_mode', None)
        filename = data.get('filename', None) # Optional custom filename
        write_manifest = _parse_bool_flag(data.get('write_manifest', False))
        prompt_source = data.get('prompt_source', '')
        if system_prompt_mode == 'override':
            system_prompt_mode = 'replace_all'
        elif system_prompt_mode == 'strip':
            system_prompt_mode = 'remove_all'
        if system_prompt_mode not in ('keep', 'add_if_missing', 'replace_first', 'replace_all', 'remove_all', 'prepend', 'append', None):
            system_prompt_mode = None
        if filename:
            filename = re.sub(r'[^a-zA-Z0-9_.-]', '', filename)
            if not filename or filename.startswith('.'):
                return jsonify({'error': 'Invalid filename'}), 400
            if not filename.endswith('.jsonl'): filename += '.jsonl'
        
        output_path = export_dataset(
            output_dir='exports',
            export_format=format,
            selected_ids=selected_ids,
            system_prompt=system_prompt,
            system_prompt_mode=system_prompt_mode,
            filename=filename,
            folder=folder
        )
        manifest_path = None
        if write_manifest:
            manifest = {
                'created_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
                'format': format,
                'folder': folder,
                'filename': output_path.name,
                'selected_ids_count': (len(selected_ids) if isinstance(selected_ids, list) else None),
                'system_prompt_provided': bool(system_prompt),
                'system_prompt_sha256': hashlib.sha256((system_prompt or '').encode('utf-8')).hexdigest() if system_prompt else '',
                'prompt_source': prompt_source if isinstance(prompt_source, str) else '',
                'system_prompt_mode': system_prompt_mode if isinstance(system_prompt_mode, str) else '',
            }
            manifest_path = output_path.with_name(output_path.name + '.manifest.json')
            with open(manifest_path, 'w', encoding='utf-8') as f:
                json.dump(manifest, f, ensure_ascii=False, indent=2)
        return jsonify({
            'success': True,
            'path': str(output_path),
            'manifest_path': str(manifest_path) if manifest_path else ''
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/export-preview/<format>', methods=['POST'])
def export_preview_endpoint(export_format: str | None = None, **route_params):
    """Preview export conversion without writing files."""
    if export_format is None:
        export_format = route_params.get('format')
    if export_format not in VALID_EXPORT_FORMATS:
        return jsonify({'error': 'Invalid format'}), 400

    try:
        data = _get_json_object()
    except BadRequest:
        return jsonify({'error': 'Invalid JSON payload'}), 400
    if data is None:
        return jsonify({'error': 'Invalid JSON payload'}), 400
    selected_ids = data.get('ids', None)
    if selected_ids is not None and not isinstance(selected_ids, list):
        return jsonify({'error': 'ids must be an array of conversation IDs'}), 400
    folder = data.get('folder', 'wanted')
    if not is_valid_folder(folder):
        return jsonify({'error': 'Invalid folder'}), 400
    system_prompt = data.get('system_prompt', None)
    system_prompt_mode = data.get('system_prompt_mode', None)
    if system_prompt_mode == 'override':
        system_prompt_mode = 'replace_all'
    elif system_prompt_mode == 'strip':
        system_prompt_mode = 'remove_all'
    if system_prompt_mode not in ('keep', 'add_if_missing', 'replace_first', 'replace_all', 'remove_all', 'prepend', 'append', None):
        system_prompt_mode = None
    try:
        limit = max(1, min(int(data.get('limit', 20)), 200))
    except Exception:
        limit = 20

    try:
        total_conversations = db.count_conversations_for_export(folder=folder, ids=selected_ids)
        conversations_iter = db.iter_conversations_for_export(folder=folder, ids=selected_ids)
        preview = preview_export_lines(conversations_iter, export_format=export_format, system_prompt=system_prompt, system_prompt_mode=system_prompt_mode, limit=limit)

        return jsonify({
            'success': True,
            'lines': preview.get('lines', []),
            'total_conversations': total_conversations,
            'total_entries': preview.get('total_entries', 0),
            'truncated': bool(preview.get('truncated', False)),
            'limit': preview.get('limit', limit)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============ CONVERSATIONS ============

@app.route('/api/conversations', methods=['GET'])
def list_conversations():
    """List all saved conversations with pagination."""
    folder = request.args.get('folder', 'wanted')
    if not is_valid_folder(folder):
        return jsonify({'error': 'Invalid folder'}), 400

    search = request.args.get('search', '').strip().lower()
    tag_filter = request.args.get('tag', '').strip()
    try:
        limit = max(1, min(int(request.args.get('limit', 50)), 2000))
        offset = max(0, int(request.args.get('offset', 0)))
    except ValueError:
        return jsonify({'error': 'Invalid pagination parameters'}), 400

    conversations, total = db.list_conversations(
        folder=folder, search=search, tag=tag_filter,
        limit=limit, offset=offset
    )
    conversations, response_truncated, oversized_single_item = _cap_paginated_response('conversations', conversations, total, limit, offset)
    if oversized_single_item:
        return jsonify({'error': 'Response page too large; reduce limit'}), 413

    return jsonify({
        'conversations': conversations,
        'total': total,
        'limit': limit,
        'offset': offset,
        'response_truncated': response_truncated
    })


@app.route('/api/conversation/<conv_id>', methods=['GET'])
def get_conversation(conv_id: str):
    """Get a single conversation by ID."""
    if not is_safe_id(conv_id):
        return jsonify({'error': 'Invalid conversation ID'}), 400

    folder = request.args.get('folder', 'wanted')
    if not is_valid_folder(folder):
        return jsonify({'error': 'Invalid folder'}), 400

    conv = db.get_conversation(conv_id, folder)
    if not conv:
        return jsonify({'error': 'Conversation not found'}), 404

    return jsonify(conv)


@app.route('/api/conversation/<conv_id>/move', methods=['POST'])
def move_conversation(conv_id: str):
    """Move conversation between wanted and rejected."""
    if not is_safe_id(conv_id):
        return jsonify({'error': 'Invalid conversation ID'}), 400

    data, error = _get_json_object_or_error()
    if error:
        return error
    from_folder = data.get('from', 'wanted')
    to_folder = data.get('to', 'rejected')

    if not is_valid_folder(from_folder) or not is_valid_folder(to_folder):
        return jsonify({'error': 'Invalid folder'}), 400

    if not db.move_conversation(conv_id, from_folder, to_folder):
        return jsonify({'error': 'Conversation not found'}), 404

    return jsonify({'success': True})


@app.route('/api/conversation/<conv_id>', methods=['DELETE'])
def delete_conversation(conv_id: str):
    """Permanently delete a conversation."""
    if not is_safe_id(conv_id):
        return jsonify({'error': 'Invalid conversation ID'}), 400

    folder = request.args.get('folder', 'wanted')

    if not is_valid_folder(folder):
        return jsonify({'error': 'Invalid folder'}), 400

    if not db.delete_conversation(conv_id, folder):
        return jsonify({'error': 'Conversation not found'}), 404

    return jsonify({'success': True, 'deleted': conv_id})

@app.route('/api/conversations/bulk-delete', methods=['POST'])
def bulk_delete_conversations():
    """Bulk delete conversations."""
    data, error = _get_json_object_or_error()
    if error:
        return error
    ids = data.get('ids', [])
    folder = data.get('folder', 'wanted')

    if not is_valid_folder(folder):
        return jsonify({'error': 'Invalid folder'}), 400

    if not isinstance(ids, list):
        return jsonify({'error': 'ids must be an array of conversation IDs'}), 400

    invalid = []
    safe_ids = []
    for raw_id in ids:
        if not isinstance(raw_id, str):
            invalid.append(raw_id)
            continue
        raw_id = raw_id.strip()
        if not raw_id:
            invalid.append(raw_id)
            continue
        if not is_safe_id(raw_id):
            invalid.append(raw_id)
            continue
        safe_ids.append(raw_id)

    deleted = db.bulk_delete_conversations(safe_ids, folder)
    deleted_set = set(deleted)
    missing = [cid for cid in safe_ids if cid not in deleted_set]

    return jsonify({
        'success': True,
        'deleted': deleted,
        'deleted_count': len(deleted),
        'missing': missing,
        'invalid': invalid,
    })

@app.route('/api/conversations/bulk-move', methods=['POST'])
def bulk_move_conversations():
    """Bulk move conversations."""
    data, error = _get_json_object_or_error()
    if error:
        return error
    ids = data.get('ids', [])
    from_folder = data.get('from', 'wanted')
    to_folder = data.get('to', 'rejected')

    if not is_valid_folder(from_folder) or not is_valid_folder(to_folder):
        return jsonify({'error': 'Invalid folder'}), 400

    if not isinstance(ids, list):
        return jsonify({'error': 'ids must be an array of conversation IDs'}), 400
    invalid = []
    safe_ids: list[str] = []
    for raw_id in ids:
        if not isinstance(raw_id, str):
            invalid.append(raw_id)
            continue
        raw_id = raw_id.strip()
        if not raw_id:
            invalid.append(raw_id)
            continue
        if not is_safe_id(raw_id):
            invalid.append(raw_id)
            continue
        safe_ids.append(raw_id)

    moved = db.bulk_move_conversations(safe_ids, from_folder, to_folder)
    moved_set = set(moved)
    missing = [cid for cid in safe_ids if cid not in moved_set]

    return jsonify({
        'success': True,
        'moved': moved,
        'moved_count': len(moved),
        'missing': missing,
        'invalid': invalid,
    })


# ============ MODELS ============

@app.route('/api/models', methods=['GET', 'POST'])
def list_models():
    """Fetch available models from provider."""
    if request.method == 'POST':
        data, error = _get_json_object_or_error()
        if error:
            return error
        provider = data.get('provider', 'openai')
        credentials_override = normalize_credentials_override(data.get('credentials_override'))
    else:
        provider = request.args.get('provider', 'openai')
        credentials_override = {}
    if provider not in VALID_PROVIDERS:
        provider = 'openai'
    if credentials_override.get('base_url') and not credentials_override.get('api_key'):
        return jsonify({'models': [], 'error': "api_key is required when overriding base_url."}), 400
    api_settings = db.get_provider_settings()
    provider_config = api_settings.get('providers', {}).get(provider, {})
    if credentials_override.get('api_key'):
        provider_config = { **provider_config, 'api_key': credentials_override.get('api_key') }
    if credentials_override.get('base_url'):
        provider_config = { **provider_config, 'base_url': credentials_override.get('base_url') }

    try:
        if provider == 'openai':
            models = fetch_openai_models(provider_config)
        elif provider == 'anthropic':
            models = fetch_anthropic_models(provider_config)
        elif provider == 'google':
            models = fetch_google_models(provider_config)
        else:
            models = []

        return jsonify({
            'models': models,
            'default': api_settings.get('model', '')
        })
    except Exception as e:
        return jsonify({
            'models': [],
            'error': str(e)
        })


def fetch_openai_models(provider_config: dict) -> list:
    """Fetch models from OpenAI-compatible API."""

    api_key = provider_config.get('api_key') or os.environ.get('OPENAI_API_KEY')
    if not api_key:
        return []

    base_url = provider_config.get('base_url') or 'https://api.openai.com/v1'
    if not validate_base_url(base_url):
        return []
    client = openai.OpenAI(api_key=api_key, base_url=base_url)

    response = client.models.list()
    # Return all models, excluding known non-chat models (embeddings, tts, whisper, dall-e, moderation)
    excluded_prefixes = ('text-embedding', 'tts-', 'whisper', 'dall-e', 'text-moderation', 'davinci', 'babbage', 'curie', 'ada')
    all_models = [m.id for m in response.data if not m.id.lower().startswith(excluded_prefixes)]
    return sorted(all_models, reverse=True)


def fetch_anthropic_models(provider_config: dict) -> list:
    """Fetch models from Anthropic API."""

    api_key = provider_config.get('api_key') or os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        return []

    try:
        base_url = provider_config.get('base_url') or 'https://api.anthropic.com'
        if not validate_base_url(base_url):
            return []
        client = anthropic.Anthropic(api_key=api_key, base_url=base_url)

        response = client.models.list()
        models = [m.id for m in response.data]
        return sorted(models, reverse=True)
    except Exception as e:
        return []


def fetch_google_models(provider_config: dict) -> list:
    """Fetch models from Google AI."""

    api_key = provider_config.get('api_key') or os.environ.get('GOOGLE_API_KEY')
    if not api_key:
        return []

    base_url = provider_config.get('base_url', '')
    if base_url:
        if not validate_base_url(base_url, load_config()):
            return []
    try:
        _gen_client, model_client = _build_google_clients(api_key, base_url)
    except Exception:
        return []

    try:
        models = model_client.list_models()
    except TypeError:
        models = model_client.list_models(request={})

    result = []
    for m in models:
        name = getattr(m, 'name', '') or ''
        methods = getattr(m, 'supported_generation_methods', None) or []
        if 'generateContent' in methods:
            result.append(name.replace('models/', ''))
    return result


# ============ STREAMING ============

@app.route('/api/generate/stream', methods=['POST'])
def generate_stream():
    """Generate conversation with streaming response (SSE)."""
    data, error = _get_json_object_or_error()
    if error:
        return error
    prompt = data.get('prompt', '')
    provider = data.get('provider', 'openai')
    model = data.get('model', 'gpt-4o')
    temperature = data.get('temperature', 0.9)
    system_prompt = data.get('system_prompt', '')
    custom_params = prepare_custom_params(data.get('custom_params', {}))
    credentials_override = normalize_credentials_override(data.get('credentials_override'))
    
    config = load_config()
    
    def stream_response():
        try:
            if provider == 'openai':
                yield from stream_openai(prompt, model, temperature, config, system_prompt, custom_params, credentials_override)
            elif provider == 'anthropic':
                yield from stream_anthropic(prompt, model, temperature, config, system_prompt, custom_params, credentials_override)
            elif provider == 'google':
                yield from stream_google(prompt, model, temperature, config, system_prompt, custom_params, credentials_override)
            else:
                yield f"data: {json.dumps({'error': 'Unknown provider'})}\n\n"
                return
            
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
    
    return Response(stream_response(), mimetype='text/event-stream')


def stream_openai(prompt: str, model: str, temperature: float, config: dict, system_prompt: str = '',
                  custom_params: dict = None, credentials_override: dict | None = None) -> Generator:
    """Stream from OpenAI API."""

    api_settings = db.get_provider_settings()
    provider_config = api_settings.get('providers', {}).get('openai', {})
    try:
        api_key, base_url = _resolve_credentials(
            'OpenAI',
            provider_config,
            'OPENAI_API_KEY',
            'https://api.openai.com/v1',
            config,
            credentials_override,
        )
    except ValueError as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
        return
    client = openai.OpenAI(api_key=api_key, base_url=base_url)

    messages = []
    if system_prompt:
        messages.append({'role': 'system', 'content': system_prompt})
    messages.append({'role': 'user', 'content': prompt})

    max_tokens = api_settings.get('max_tokens', 2048)
    kwargs = dict(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True
    )
    if custom_params:
        kwargs['extra_body'] = custom_params

    stream = client.chat.completions.create(**kwargs)

    for chunk in stream:
        if chunk.choices[0].delta.content:
            yield f"data: {json.dumps({'content': chunk.choices[0].delta.content})}\n\n"


def stream_anthropic(prompt: str, model: str, temperature: float, config: dict, system_prompt: str = '',
                     custom_params: dict = None, credentials_override: dict | None = None) -> Generator:
    """Stream from Anthropic API."""

    api_settings = db.get_provider_settings()
    provider_config = api_settings.get('providers', {}).get('anthropic', {})
    try:
        api_key, base_url = _resolve_credentials(
            'Anthropic',
            provider_config,
            'ANTHROPIC_API_KEY',
            'https://api.anthropic.com/v1',
            config,
            credentials_override,
        )
    except ValueError as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
        return

    client = anthropic.Anthropic(api_key=api_key, base_url=base_url)

    max_tokens = api_settings.get('max_tokens', 2048)
    kwargs = dict(
        model=model or 'claude-3-5-sonnet-20241022',
        max_tokens=max_tokens,
        system=system_prompt if system_prompt else anthropic.NOT_GIVEN,
        messages=[{'role': 'user', 'content': prompt}],
        temperature=temperature
    )
    if custom_params:
        kwargs.update(custom_params)

    with client.messages.stream(**kwargs) as stream:
        for text in stream.text_stream:
            yield f"data: {json.dumps({'content': text})}\n\n"


def stream_google(prompt: str, model: str, temperature: float, config: dict, system_prompt: str = '',
                  custom_params: dict = None, credentials_override: dict | None = None) -> Generator:
    """Stream from Google Gemini API."""

    api_settings = db.get_provider_settings()
    provider_config = api_settings.get('providers', {}).get('google', {})
    try:
        api_key, base_url = _resolve_credentials(
            'Google',
            provider_config,
            'GOOGLE_API_KEY',
            '',
            config,
            credentials_override,
        )
    except ValueError as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
        return
    gen_client, _model_client = _build_google_clients(api_key, base_url)

    max_tokens = api_settings.get('max_tokens', 2048)
    gen_config = dict(
        temperature=temperature,
        max_output_tokens=max_tokens
    )
    if custom_params:
        gen_config.update(custom_params)
    
    gen_model = genai.GenerativeModel(
        model or 'gemini-1.5-flash',
        system_instruction=system_prompt if system_prompt else None
    )
    gen_model._client = gen_client
    
    response = gen_model.generate_content(
        prompt,
        generation_config=genai.types.GenerationConfig(**gen_config),
        stream=True
    )
    
    for chunk in response:
        if chunk.text:
            yield f"data: {json.dumps({'content': chunk.text})}\n\n"


# ============ PRESETS ============

@app.route('/api/presets', methods=['GET'])
def get_presets():
    """Get variable presets."""
    presets = db.get_presets('variable')
    return jsonify({'presets': presets})


@app.route('/api/presets', methods=['POST'])
def save_preset():
    """Save a new variable preset."""
    data, error = _get_json_object_or_error()
    if error:
        return error
    name = data.get('name', '')
    values = data.get('values', {})
    overwrite = data.get('overwrite', True)

    if not name:
        return jsonify({'error': 'Preset name required'}), 400

    if not db.save_preset('variable', name, {'values': values}, overwrite):
        return jsonify({'error': 'Preset already exists'}), 400

    presets = db.get_presets('variable')
    return jsonify({'success': True, 'presets': presets})


@app.route('/api/presets/<name>', methods=['DELETE'])
def delete_preset(name: str):
    """Delete a variable preset."""
    db.delete_preset('variable', name)
    return jsonify({'success': True})


# ============ CREDENTIALS (Named Keys & URLs) ============

def _cred_preset_type(provider: str, kind: str) -> str:
    if provider not in VALID_PROVIDERS:
        raise ValueError("Invalid provider")
    if kind not in ('key', 'url'):
        raise ValueError("Invalid kind")
    return f"cred_{kind}_{provider}"

def _mask_last4(value: str) -> str:
    v = (value or '').strip()
    return v[-4:] if len(v) >= 4 else ''

@app.route('/api/credentials/<provider>', methods=['GET'])
def list_credentials(provider: str):
    """List credential presets and active selections for a provider."""
    if provider not in VALID_PROVIDERS:
        return jsonify({'error': 'Invalid provider'}), 400

    key_type = _cred_preset_type(provider, 'key')
    url_type = _cred_preset_type(provider, 'url')
    key_presets_raw = db.get_presets(key_type)
    url_presets_raw = db.get_presets(url_type)

    api_settings = db.get_provider_settings()
    provider_cfg = api_settings.get('providers', {}).get(provider, {})

    key_presets = []
    for p in key_presets_raw:
        api_key = p.get('api_key', '')
        key_presets.append({
            'name': p.get('name', ''),
            'last4': _mask_last4(api_key),
            'has_value': bool((api_key or '').strip())
        })

    url_presets = []
    for p in url_presets_raw:
        base_url = p.get('base_url', '')
        url_presets.append({
            'name': p.get('name', ''),
            'base_url': base_url
        })

    return jsonify({
        'key_presets': key_presets,
        'url_presets': url_presets,
        'active': {
            'key_preset': provider_cfg.get('active_key_preset', ''),
            'url_preset': provider_cfg.get('active_url_preset', '')
        }
    })

@app.route('/api/credentials/<provider>/keys', methods=['POST'])
def save_credential_key(provider: str):
    if provider not in VALID_PROVIDERS:
        return jsonify({'error': 'Invalid provider'}), 400
    data, error = _get_json_object_or_error()
    if error:
        return error
    name = (data.get('name') or '').strip()
    api_key = (data.get('api_key') or '').strip()
    overwrite = bool(data.get('overwrite', True))
    if not name:
        return jsonify({'error': 'Name required'}), 400
    if not api_key:
        return jsonify({'error': 'API key required'}), 400
    preset_type = _cred_preset_type(provider, 'key')
    if not db.save_preset(preset_type, name, {'api_key': api_key}, overwrite):
        return jsonify({'error': 'Preset already exists'}), 400
    return jsonify({'success': True})

@app.route('/api/credentials/<provider>/keys/<name>', methods=['DELETE'])
def delete_credential_key(provider: str, name: str):
    if provider not in VALID_PROVIDERS:
        return jsonify({'error': 'Invalid provider'}), 400
    preset_type = _cred_preset_type(provider, 'key')
    db.delete_preset(preset_type, name)
    api_settings = db.get_provider_settings()
    provider_cfg = api_settings.get('providers', {}).get(provider, {})
    if provider_cfg.get('active_key_preset') == name:
        db.set_api_setting(f'{provider}.active_key_preset', '')
        db.set_api_setting(f'{provider}.api_key', '')
    return jsonify({'success': True})

@app.route('/api/credentials/<provider>/urls', methods=['POST'])
def save_credential_url(provider: str):
    if provider not in VALID_PROVIDERS:
        return jsonify({'error': 'Invalid provider'}), 400
    data, error = _get_json_object_or_error()
    if error:
        return error
    name = (data.get('name') or '').strip()
    base_url = (data.get('base_url') or '').strip()
    overwrite = bool(data.get('overwrite', True))
    if not name:
        return jsonify({'error': 'Name required'}), 400
    if base_url and not validate_base_url(base_url, load_config()):
        return jsonify({'error': 'Invalid base URL'}), 400
    preset_type = _cred_preset_type(provider, 'url')
    if not db.save_preset(preset_type, name, {'base_url': base_url}, overwrite):
        return jsonify({'error': 'Preset already exists'}), 400
    return jsonify({'success': True})

@app.route('/api/credentials/<provider>/urls/<name>', methods=['DELETE'])
def delete_credential_url(provider: str, name: str):
    if provider not in VALID_PROVIDERS:
        return jsonify({'error': 'Invalid provider'}), 400
    preset_type = _cred_preset_type(provider, 'url')
    db.delete_preset(preset_type, name)
    api_settings = db.get_provider_settings()
    provider_cfg = api_settings.get('providers', {}).get(provider, {})
    if provider_cfg.get('active_url_preset') == name:
        db.set_api_setting(f'{provider}.active_url_preset', '')
        db.set_api_setting(f'{provider}.base_url', '')
    return jsonify({'success': True})

@app.route('/api/credentials/<provider>/apply', methods=['POST'])
def apply_credentials(provider: str):
    if provider not in VALID_PROVIDERS:
        return jsonify({'error': 'Invalid provider'}), 400
    data, error = _get_json_object_or_error()
    if error:
        return error
    key_name = data.get('key_name', None)
    url_name = data.get('url_name', None)

    config = load_config()
    api_settings = db.get_provider_settings()
    provider_cfg = api_settings.get('providers', {}).get(provider, {})

    current_active_key = (provider_cfg.get('active_key_preset') or '').strip()
    current_active_url = (provider_cfg.get('active_url_preset') or '').strip()
    current_api_key = (provider_cfg.get('api_key') or '').strip()
    current_base_url = (provider_cfg.get('base_url') or '').strip()

    next_active_key = current_active_key
    next_active_url = current_active_url
    next_api_key = current_api_key
    next_base_url = current_base_url

    if key_name is not None:
        desired = (key_name or '').strip()
        if not desired:
            next_active_key = ''
            next_api_key = ''
        else:
            preset = db.get_preset(_cred_preset_type(provider, 'key'), desired)
            if not preset:
                return jsonify({'error': 'Key preset not found'}), 400
            api_key = (preset.get('api_key') or '').strip()
            if not api_key:
                return jsonify({'error': 'Key preset is empty'}), 400
            next_active_key = desired
            next_api_key = api_key

    if url_name is not None:
        desired = (url_name or '').strip()
        if not desired:
            next_active_url = ''
            next_base_url = ''
        else:
            preset = db.get_preset(_cred_preset_type(provider, 'url'), desired)
            if not preset:
                return jsonify({'error': 'URL preset not found'}), 400
            base_url = (preset.get('base_url') or '').strip()
            if base_url and not validate_base_url(base_url, config):
                return jsonify({'error': 'Invalid base URL'}), 400
            next_active_url = desired
            next_base_url = base_url

    # Persist only after all validations succeed (avoids inconsistent selections).
    if key_name is not None:
        db.set_api_setting(f'{provider}.active_key_preset', next_active_key)
        db.set_api_setting(f'{provider}.api_key', next_api_key)
    if url_name is not None:
        db.set_api_setting(f'{provider}.active_url_preset', next_active_url)
        db.set_api_setting(f'{provider}.base_url', next_base_url)

    return jsonify({'success': True})


# ============ DRAFTS (Per-Session, SQLite-backed) ============


@app.route('/api/drafts', methods=['GET'])
def get_drafts():
    """Get drafts for cross-device sync."""
    session_id = request.args.get('session_id', None)
    if not session_id:
        return jsonify({})
    return jsonify(db.get_draft(session_id))


@app.route('/api/drafts', methods=['POST'])
def save_draft_endpoint():
    """Save drafts for cross-device sync (per-session)."""
    data, error = _get_json_object_or_error()
    if error:
        return error
    session_id = data.get('_sessionId', 'default')

    # Only save a whitelist of fields to avoid bloat
    list_iterators = data.get('listIterators', {})
    if not isinstance(list_iterators, dict):
        list_iterators = {}
    # Keep small: cap entries and coerce values to ints when possible.
    safe_iterators = {}
    for k, v in list(list_iterators.items())[:200]:
        if not isinstance(k, str) or len(k) > 200:
            continue
        try:
            safe_iterators[k] = int(v)
        except Exception:
            continue

    macro_trace_last = data.get('macroTraceLast', None)
    if not isinstance(macro_trace_last, dict):
        macro_trace_last = None

    draft = {
        '_sessionId': session_id,
        'currentPromptName': data.get('currentPromptName', ''),
        'model': data.get('model', ''),
        'temperature': data.get('temperature'),
        'customParams': data.get('customParams', {}),
        'listIterators': safe_iterators,
        'macroTraceLast': macro_trace_last,
        'generate': {
            'prompt': data.get('generate', {}).get('prompt', ''),
            'variables': data.get('generate', {}).get('variables', {}),
            'presetName': data.get('generate', {}).get('presetName', ''),
            'rawText': data.get('generate', {}).get('rawText', '')
        },
        'chat': {
            'systemPrompt': data.get('chat', {}).get('systemPrompt', ''),
            'presetName': data.get('chat', {}).get('presetName', ''),
            # Store chat messages but cap to avoid bloat
            'messages': (data.get('chat', {}).get('messages', []))[:100]
        },
        'export': {
            'systemPrompt': data.get('export', {}).get('systemPrompt', ''),
            'presetName': data.get('export', {}).get('presetName', '')
        },
        '_localTime': data.get('_localTime', datetime.now(timezone.utc).isoformat())
    }

    db.save_draft(session_id, draft)

    return jsonify({
        'success': True,
        'updated': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    })


# ============ EXPORT PRESETS (SQLite-backed) ============

@app.route('/api/export-presets', methods=['GET'])
def get_export_presets():
    """Get export system prompt presets."""
    presets = db.get_presets('export')
    return jsonify({'presets': presets})

@app.route('/api/export-presets', methods=['POST'])
def save_export_preset():
    """Save an export system prompt preset."""
    data, error = _get_json_object_or_error()
    if error:
        return error
    name = data.get('name', '').strip()
    prompt = data.get('prompt', '')
    overwrite = data.get('overwrite', True)

    if not name:
        return jsonify({'error': 'Name required'}), 400

    if not db.save_preset('export', name, {'prompt': prompt}, overwrite):
        return jsonify({'error': 'Preset already exists'}), 400

    presets = db.get_presets('export')
    return jsonify({'success': True, 'presets': presets})

@app.route('/api/export-presets/<name>', methods=['DELETE'])
def delete_export_preset(name: str):
    """Delete an export preset."""
    db.delete_preset('export', name)
    return jsonify({'success': True})


# ============ CHAT PRESETS (SQLite-backed) ============

@app.route('/api/chat-presets', methods=['GET'])
def get_chat_presets():
    """Get chat system prompt presets."""
    presets = db.get_presets('chat')
    return jsonify({'presets': presets})


@app.route('/api/chat-presets', methods=['POST'])
def save_chat_preset():
    """Save a chat system prompt preset."""
    data, error = _get_json_object_or_error()
    if error:
        return error
    name = data.get('name', '').strip()
    prompt = data.get('prompt', '')
    overwrite = data.get('overwrite', True)

    if not name:
        return jsonify({'error': 'Name required'}), 400

    if not db.save_preset('chat', name, {'prompt': prompt}, overwrite):
        return jsonify({'error': 'Preset already exists'}), 400

    presets = db.get_presets('chat')
    return jsonify({'success': True, 'presets': presets})


@app.route('/api/chat-presets/<name>', methods=['DELETE'])
def delete_chat_preset(name: str):
    """Delete a chat preset."""
    db.delete_preset('chat', name)
    return jsonify({'success': True})


# ============ TAGS ============

@app.route('/api/tags', methods=['GET'])
def get_all_tags():
    """Get all unique tags used across conversations."""
    tags = db.get_all_tags()
    return jsonify({'tags': tags})


# ============ REVIEW QUEUE (SQLite-backed) ============


@app.route('/api/review-queue', methods=['GET'])
def get_review_queue():
    """Get all items in the review queue."""
    search = request.args.get('search', '').strip()
    ids_only = request.args.get('ids_only', '').strip().lower() in ('1', 'true', 'yes')
    summary_only = request.args.get('summary', '').strip().lower() in ('1', 'true', 'yes')
    try:
        limit = max(1, min(int(request.args.get('limit', 500)), 2000))
        offset = max(0, int(request.args.get('offset', 0)))
    except ValueError:
        return jsonify({'error': 'Invalid pagination parameters'}), 400

    if ids_only:
        ids, total = db.get_review_queue_ids(limit=limit, offset=offset, search=search)
        return jsonify({'ids': ids, 'count': total, 'limit': limit, 'offset': offset})

    if summary_only:
        queue, total = db.get_review_queue_summaries(limit=limit, offset=offset, search=search)
        return jsonify({'queue': queue, 'count': total, 'limit': limit, 'offset': offset, 'response_truncated': False})

    queue, total = db.get_review_queue(limit=limit, offset=offset, search=search)
    queue, response_truncated, oversized_single_item = _cap_paginated_response('queue', queue, total, limit, offset)
    if oversized_single_item:
        return jsonify({'error': 'Response page too large; reduce limit'}), 413
    return jsonify({'queue': queue, 'count': total, 'limit': limit, 'offset': offset, 'response_truncated': response_truncated})


@app.route('/api/review-queue/<item_id>', methods=['GET'])
def get_review_queue_item_endpoint(item_id: str):
    """Get one full review queue item."""
    if not is_safe_id(item_id):
        return jsonify({'error': 'Invalid review queue ID'}), 400
    item = db.get_review_queue_item(item_id)
    if not item:
        return jsonify({'error': 'Review queue item not found'}), 404
    return jsonify(item)


@app.route('/api/review-queue-position/<item_id>', methods=['GET'])
def get_review_queue_position(item_id: str):
    """Get 0-based absolute position of an item in the review queue."""
    search = request.args.get('search', '').strip()
    pos = db.get_review_queue_position(item_id, search=search)
    if pos is None:
        return jsonify({'error': 'Item not found'}), 404
    position, total = pos
    return jsonify({'position': int(position), 'count': int(total)})


@app.route('/api/review-queue', methods=['POST'])
def add_to_review_queue():
    """Add one or more items to the review queue."""
    data, error = _get_json_object_or_error()
    if error:
        return error
    items = data.get('items', [])

    # Also support single-item POST
    if not items and 'conversations' in data:
        items = [data]

    if not items:
        return jsonify({'error': 'No items provided'}), 400

    added = db.add_to_review_queue(items)
    total = db.get_review_queue_count()

    return jsonify({
        'success': True,
        'added': added,
        'count': total
    })


@app.route('/api/review-queue/<item_id>', methods=['DELETE'])
def remove_from_review_queue(item_id: str):
    """Remove a specific item from the review queue."""
    if not db.remove_from_review_queue(item_id):
        return jsonify({'error': 'Item not found'}), 404

    total = db.get_review_queue_count()
    return jsonify({'success': True, 'count': total})


@app.route('/api/review-queue/<item_id>', methods=['PUT'])
def update_review_queue_item(item_id: str):
    """Update a specific review queue item after inline edits."""
    data, error = _get_json_object_or_error()
    if error:
        return error
    conversations = data.get('conversations', [])
    raw_text = data.get('raw_text', '')
    metadata = data.get('metadata', {})

    if not isinstance(conversations, list) or not isinstance(raw_text, str):
        return jsonify({'error': 'Invalid review item payload'}), 400

    if not db.update_review_queue_item(item_id, conversations, raw_text, metadata):
        return jsonify({'error': 'Item not found'}), 404

    return jsonify({'success': True})

@app.route('/api/review-queue/bulk-delete', methods=['POST'])
def bulk_remove_from_review_queue():
    """Bulk remove items from the review queue."""
    data, error = _get_json_object_or_error()
    if error:
        return error
    ids = data.get('ids', [])
    if not isinstance(ids, list):
        return jsonify({'error': 'ids must be an array of review queue item IDs'}), 400

    invalid = []
    safe_ids: list[str] = []
    for raw_id in ids:
        if not isinstance(raw_id, str):
            invalid.append(raw_id)
            continue
        raw_id = raw_id.strip()
        if not raw_id:
            invalid.append(raw_id)
            continue
        safe_ids.append(raw_id)

    deleted = db.bulk_remove_from_review_queue(safe_ids)
    deleted_set = set(deleted)
    missing = [item_id for item_id in dict.fromkeys(safe_ids) if item_id not in deleted_set]
    total = db.get_review_queue_count()

    return jsonify({
        'success': True,
        'deleted': deleted,
        'deleted_count': len(deleted),
        'missing': missing,
        'invalid': invalid,
        'count': total,
    })


def _persist_review_items(ids: list[str] | None, target_folder: str):
    """Save selected review queue items to a folder and remove successful ones."""
    saved, errors, total = db.persist_review_queue_items(ids, target_folder)
    return jsonify({
        'success': True,
        'saved_count': len(saved),
        'error_count': len(errors),
        'saved': saved,
        'errors': errors,
        'count': total
    })

@app.route('/api/review-queue/bulk-keep', methods=['POST'])
def bulk_keep_from_review_queue():
    """Atomically save items from the review queue to wanted and remove them from the queue."""
    try:
        data = _get_json_object()
    except BadRequest:
        return jsonify({'error': 'Invalid JSON payload'}), 400
    if data is None:
        return jsonify({'error': 'Invalid JSON payload'}), 400
    ids = data.get('ids', [])
    keep_all = _parse_bool_flag(data.get('all', False))

    if not keep_all and not isinstance(ids, list):
        return jsonify({'error': 'ids must be an array of review queue item IDs'}), 400

    if not keep_all and not ids:
        return jsonify({'error': 'No ids provided'}), 400

    if not keep_all:
        normalized_ids: list[str] = []
        for raw_id in ids:
            if not isinstance(raw_id, str) or not raw_id.strip():
                return jsonify({'error': 'ids must contain only non-empty review queue item IDs'}), 400
            normalized_ids.append(raw_id.strip())
        if not normalized_ids:
            return jsonify({'error': 'No ids provided'}), 400
        ids = list(dict.fromkeys(normalized_ids))

    return _persist_review_items(None if keep_all else ids, 'wanted')


@app.route('/api/review-queue/bulk-reject', methods=['POST'])
def bulk_reject_from_review_queue():
    """Atomically save items from the review queue to rejected and remove them from the queue."""
    try:
        data = _get_json_object()
    except BadRequest:
        return jsonify({'error': 'Invalid JSON payload'}), 400
    if data is None:
        return jsonify({'error': 'Invalid JSON payload'}), 400
    ids = data.get('ids', [])
    reject_all = _parse_bool_flag(data.get('all', False))

    if not reject_all and not isinstance(ids, list):
        return jsonify({'error': 'ids must be an array of review queue item IDs'}), 400

    if not reject_all and not ids:
        return jsonify({'error': 'No ids provided'}), 400

    if not reject_all:
        normalized_ids: list[str] = []
        for raw_id in ids:
            if not isinstance(raw_id, str) or not raw_id.strip():
                return jsonify({'error': 'ids must contain only non-empty review queue item IDs'}), 400
            normalized_ids.append(raw_id.strip())
        if not normalized_ids:
            return jsonify({'error': 'No ids provided'}), 400
        ids = list(dict.fromkeys(normalized_ids))

    return _persist_review_items(None if reject_all else ids, 'rejected')


@app.route('/api/review-queue', methods=['DELETE'])
def clear_review_queue():
    """Clear the entire review queue (discard without saving)."""
    db.clear_review_queue()
    return jsonify({'success': True, 'count': 0})


initialize_app()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Synthetic Dataset Builder Server')
    parser.add_argument('--host', type=str, help='Host to bind to')
    parser.add_argument('--port', type=int, help='Port to bind to')
    args = parser.parse_args()

    config = load_config()
    server_config = config.get('server', {})

    host = args.host or server_config.get('host', '127.0.0.1')
    port = args.port or server_config.get('port', 5000)
    
    print('   Synthetic Dataset Builder')
    print(f'   Server running at http://{host}:{port}')

    # Check security configurations
    allowed_ips = server_config.get('allowed_ips', [])
    password = server_config.get('password', '')
    if not allowed_ips and not password:
        print('   [WARNING] Running WITHOUT authentication or IP whitelisting.')
        print('   [WARNING] Ensure you are not exposing this server to the public internet.')
    elif not allowed_ips:
        print('   [INFO] IP whitelisting is not configured.')
    elif not password:
        print('   [INFO] Password authentication is not configured.')

    print('   Press Ctrl+C to stop')
    
    app.run(debug=False, host=host, port=port)
