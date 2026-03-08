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
from werkzeug.exceptions import HTTPException

# Import our modules
from scripts.parser import validate_conversation
from scripts.exporter import export_dataset
from scripts import database as db

# Load config
CONFIG_PATH = Path('config.yaml')
DATA_DIR = Path('data')
VALID_FOLDERS = ('wanted', 'rejected')

_config_lock = threading.Lock()


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
                }
            }
            try:
                with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
                    yaml.dump(default_config, f, default_flow_style=False, allow_unicode=True)
            except PermissionError:
                print("[Warning] Permission denied when creating config.yaml")

setup_defaults()

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


def build_allowed_origins(config: dict) -> list[str]:
    """Build the allowed origins list for CORS."""
    server_config = config.get('server', {})
    host = server_config.get('host', '127.0.0.1')
    port = server_config.get('port', 5000)

    allowed_origins = [
        f'http://localhost:{port}',
        f'http://127.0.0.1:{port}'
    ]
    if host not in ('127.0.0.1', 'localhost', '0.0.0.0'):
        allowed_origins.append(f'http://{host}:{port}')
    return allowed_origins


def initialize_app():
    """Initialize storage, run migrations, and configure app-wide services."""
    global _app_initialized
    if _app_initialized:
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / 'prompts').mkdir(parents=True, exist_ok=True)
    Path('exports').mkdir(exist_ok=True)

    config = load_config()
    db.init_db()
    db.seed_default_presets(Path(__file__).parent / 'defaults')

    CORS(app, origins=build_allowed_origins(config))
    _app_initialized = True


@app.before_request
def security_check():
    """Ensure basic IP whitelisting and Basic Authentication if configured."""
    config = load_config()
    server_config = config.get('server', {})

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


@app.route('/api/config', methods=['POST'])
def update_config():
    """Update configuration (API keys, base URLs, etc) - stored in DB."""
    data = request.get_json() or {}

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
    data = request.get_json() or {}
    provider = data.get('provider')
    api_key = data.get('api_key', '')

    if not provider:
        return jsonify({'error': 'Provider required'}), 400

    db.set_api_setting(f'{provider}.api_key', api_key)

    return jsonify({'success': True})


@app.route('/api/config/baseurl', methods=['POST'])
def set_base_url():
    """Set base URL for a provider."""
    data = request.get_json() or {}
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
    data = request.get_json() or {}
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


# ============ GENERATION ============

@app.route('/api/generate', methods=['POST'])
def generate_conversation():
    """Generate a conversation using configured LLM."""
    data = request.get_json() or {}
    prompt = data.get('prompt', '')
    provider = data.get('provider', 'openai')
    model = data.get('model', 'gpt-4o')
    temperature = data.get('temperature', 0.9)
    custom_params = prepare_custom_params(data.get('custom_params', {}))
    
    config = load_config()
    
    try:
        if provider == 'openai':
            content = generate_openai(prompt, model, temperature, config, custom_params)
        elif provider == 'anthropic':
            content = generate_anthropic(prompt, model, temperature, config, custom_params)
        elif provider == 'google':
            content = generate_google(prompt, model, temperature, config, custom_params)
        else:
            return jsonify({'error': 'Unknown provider'}), 400
        
        return jsonify({'content': content})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def generate_openai(prompt: str, model: str, temperature: float, config: dict, custom_params: dict = None) -> str:
    """Generate using OpenAI API."""

    api_settings = db.get_provider_settings()
    provider_config = api_settings.get('providers', {}).get('openai', {})

    # Try DB first, then environment variable
    api_key = provider_config.get('api_key') or os.environ.get('OPENAI_API_KEY')
    if not api_key:
        raise ValueError('OpenAI API key not set. Configure it in Settings.')

    base_url = provider_config.get('base_url') or 'https://api.openai.com/v1'
    if not validate_base_url(base_url, config):
        raise ValueError('Invalid base URL configured for OpenAI.')

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


def generate_anthropic(prompt: str, model: str, temperature: float, config: dict, custom_params: dict = None) -> str:
    """Generate using Anthropic API."""

    api_settings = db.get_provider_settings()
    provider_config = api_settings.get('providers', {}).get('anthropic', {})

    api_key = provider_config.get('api_key') or os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        raise ValueError('Anthropic API key not set. Configure it in Settings.')

    base_url = provider_config.get('base_url') or 'https://api.anthropic.com/v1'
    if not validate_base_url(base_url, config):
        raise ValueError('Invalid base URL configured for Anthropic.')

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


def generate_google(prompt: str, model: str, temperature: float, config: dict, custom_params: dict = None) -> str:
    """Generate using Google Gemini API."""

    api_settings = db.get_provider_settings()
    provider_config = api_settings.get('providers', {}).get('google', {})

    api_key = provider_config.get('api_key') or os.environ.get('GOOGLE_API_KEY')
    if not api_key:
        raise ValueError('Google API key not set. Configure it in Settings.')

    base_url = provider_config.get('base_url', '')
    # Configure with base_url if provided (for proxy/custom endpoints)
    if base_url:
        if not validate_base_url(base_url, config):
            raise ValueError('Invalid base URL configured for Google.')
        genai.configure(api_key=api_key, client_options={'api_endpoint': base_url})
    else:
        genai.configure(api_key=api_key)

    max_tokens = api_settings.get('max_tokens', 2048)
    gen_config = dict(
        temperature=temperature,
        max_output_tokens=max_tokens
    )
    if custom_params:
        gen_config.update(custom_params)

    gen_model = genai.GenerativeModel(model or 'gemini-1.5-flash')
    response = gen_model.generate_content(
        prompt,
        generation_config=genai.types.GenerationConfig(**gen_config)
    )

    return response.text


# ============ SAVE ============

@app.route('/api/save', methods=['POST'])
def save_conversation_endpoint():
    """Save a conversation to wanted or rejected folder."""
    data = request.get_json() or {}
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
    data = request.get_json() or {}
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
    data = request.get_json() or {}
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
        data = request.get_json() or {}
        selected_ids = data.get('ids', None)  # List of IDs or None for all
        system_prompt = data.get('system_prompt', None)  # Override system prompt
        filename = data.get('filename', None) # Optional custom filename
        if filename:
            filename = re.sub(r'[^a-zA-Z0-9_.-]', '', filename)
            if not filename or filename.startswith('.'):
                return jsonify({'error': 'Invalid filename'}), 400
            if not filename.endswith('.jsonl'): filename += '.jsonl'
        
        output_path = export_dataset(
            output_dir='exports',
            format=format,
            selected_ids=selected_ids,
            system_prompt=system_prompt,
            filename=filename,
            folder='wanted'
        )
        return jsonify({
            'success': True,
            'path': str(output_path)
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
        limit = max(1, min(int(request.args.get('limit', 50)), 200))
        offset = max(0, int(request.args.get('offset', 0)))
    except ValueError:
        return jsonify({'error': 'Invalid pagination parameters'}), 400

    conversations, total = db.list_conversations(
        folder=folder, search=search, tag=tag_filter,
        limit=limit, offset=offset
    )

    return jsonify({
        'conversations': conversations,
        'total': total,
        'limit': limit,
        'offset': offset
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

    data = request.get_json() or {}
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
    data = request.get_json() or {}
    ids = data.get('ids', [])
    folder = data.get('folder', 'wanted')

    if not is_valid_folder(folder):
        return jsonify({'error': 'Invalid folder'}), 400

    safe_ids = [cid for cid in ids if is_safe_id(cid)]
    deleted = db.bulk_delete_conversations(safe_ids, folder)

    return jsonify({'success': True, 'deleted': deleted})

@app.route('/api/conversations/bulk-move', methods=['POST'])
def bulk_move_conversations():
    """Bulk move conversations."""
    data = request.get_json() or {}
    ids = data.get('ids', [])
    from_folder = data.get('from', 'wanted')
    to_folder = data.get('to', 'rejected')

    if not is_valid_folder(from_folder) or not is_valid_folder(to_folder):
        return jsonify({'error': 'Invalid folder'}), 400

    safe_ids = [cid for cid in ids if is_safe_id(cid)]
    moved = db.bulk_move_conversations(safe_ids, from_folder, to_folder)

    return jsonify({'success': True, 'moved': moved})


# ============ MODELS ============

@app.route('/api/models', methods=['GET'])
def list_models():
    """Fetch available models from provider."""
    provider = request.args.get('provider', 'openai')
    api_settings = db.get_provider_settings()
    provider_config = api_settings.get('providers', {}).get(provider, {})

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
        genai.configure(api_key=api_key, client_options={'api_endpoint': base_url})
    else:
        genai.configure(api_key=api_key)

    models = genai.list_models()
    result = [m.name.replace('models/', '') for m in models if 'generateContent' in m.supported_generation_methods]
    return result


# ============ STREAMING ============

@app.route('/api/generate/stream', methods=['POST'])
def generate_stream():
    """Generate conversation with streaming response (SSE)."""
    data = request.get_json() or {}
    prompt = data.get('prompt', '')
    provider = data.get('provider', 'openai')
    model = data.get('model', 'gpt-4o')
    temperature = data.get('temperature', 0.9)
    system_prompt = data.get('system_prompt', '')
    custom_params = prepare_custom_params(data.get('custom_params', {}))
    
    config = load_config()
    
    def stream_response():
        try:
            if provider == 'openai':
                yield from stream_openai(prompt, model, temperature, config, system_prompt, custom_params)
            elif provider == 'anthropic':
                yield from stream_anthropic(prompt, model, temperature, config, system_prompt, custom_params)
            elif provider == 'google':
                yield from stream_google(prompt, model, temperature, config, system_prompt, custom_params)
            else:
                yield f"data: {json.dumps({'error': 'Unknown provider'})}\n\n"
                return
            
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
    
    return Response(stream_response(), mimetype='text/event-stream')


def stream_openai(prompt: str, model: str, temperature: float, config: dict, system_prompt: str = '', custom_params: dict = None) -> Generator:
    """Stream from OpenAI API."""

    api_settings = db.get_provider_settings()
    provider_config = api_settings.get('providers', {}).get('openai', {})
    api_key = provider_config.get('api_key') or os.environ.get('OPENAI_API_KEY')
    if not api_key:
        yield f"data: {json.dumps({'error': 'OpenAI API key not set'})}\n\n"
        return

    base_url = provider_config.get('base_url') or 'https://api.openai.com/v1'
    if not validate_base_url(base_url, config):
        yield f"data: {json.dumps({'error': 'Invalid base URL configured for OpenAI'})}\n\n"
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


def stream_anthropic(prompt: str, model: str, temperature: float, config: dict, system_prompt: str = '', custom_params: dict = None) -> Generator:
    """Stream from Anthropic API."""

    api_settings = db.get_provider_settings()
    provider_config = api_settings.get('providers', {}).get('anthropic', {})
    api_key = provider_config.get('api_key') or os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        yield f"data: {json.dumps({'error': 'Anthropic API key not set'})}\n\n"
        return

    base_url = provider_config.get('base_url') or 'https://api.anthropic.com/v1'
    if not validate_base_url(base_url, config):
        yield f"data: {json.dumps({'error': 'Invalid base URL configured for Anthropic'})}\n\n"
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


def stream_google(prompt: str, model: str, temperature: float, config: dict, system_prompt: str = '', custom_params: dict = None) -> Generator:
    """Stream from Google Gemini API."""

    api_settings = db.get_provider_settings()
    provider_config = api_settings.get('providers', {}).get('google', {})
    api_key = provider_config.get('api_key') or os.environ.get('GOOGLE_API_KEY')
    if not api_key:
        yield f"data: {json.dumps({'error': 'Google API key not set'})}\n\n"
        return

    genai.configure(api_key=api_key)

    base_url = provider_config.get('base_url', '')
    if base_url:
        if not validate_base_url(base_url, config):
            yield f"data: {json.dumps({'error': 'Invalid base URL configured for Google'})}\n\n"
            return
        genai.configure(api_key=api_key, client_options={'api_endpoint': base_url})

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
    data = request.get_json() or {}
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
    data = request.get_json() or {}
    session_id = data.get('_sessionId', 'default')

    # Only save a whitelist of fields to avoid bloat
    draft = {
        '_sessionId': session_id,
        'currentPromptName': data.get('currentPromptName', ''),
        'model': data.get('model', ''),
        'temperature': data.get('temperature'),
        'customParams': data.get('customParams', {}),
        'generate': {
            'prompt': data.get('generate', {}).get('prompt', ''),
            'variables': data.get('generate', {}).get('variables', {}),
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
    data = request.get_json() or {}
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
    data = request.get_json() or {}
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
    try:
        limit = max(1, min(int(request.args.get('limit', 100)), 200))
        offset = max(0, int(request.args.get('offset', 0)))
    except ValueError:
        return jsonify({'error': 'Invalid pagination parameters'}), 400

    if ids_only:
        ids, total = db.get_review_queue_ids(limit=limit, offset=offset, search=search)
        return jsonify({'ids': ids, 'count': total, 'limit': limit, 'offset': offset})

    queue, total = db.get_review_queue(limit=limit, offset=offset, search=search)
    return jsonify({'queue': queue, 'count': total, 'limit': limit, 'offset': offset})


@app.route('/api/review-queue', methods=['POST'])
def add_to_review_queue():
    """Add one or more items to the review queue."""
    data = request.get_json() or {}
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
    data = request.get_json() or {}
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
    data = request.get_json() or {}
    ids = data.get('ids', [])

    db.bulk_remove_from_review_queue(ids)
    total = db.get_review_queue_count()

    return jsonify({'success': True, 'count': total})


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
    data = request.get_json() or {}
    ids = data.get('ids', [])
    keep_all = bool(data.get('all'))

    if not keep_all and not ids:
        return jsonify({'error': 'No ids provided'}), 400

    return _persist_review_items(None if keep_all else ids, 'wanted')


@app.route('/api/review-queue/bulk-reject', methods=['POST'])
def bulk_reject_from_review_queue():
    """Atomically save items from the review queue to rejected and remove them from the queue."""
    data = request.get_json() or {}
    ids = data.get('ids', [])
    reject_all = bool(data.get('all'))

    if not reject_all and not ids:
        return jsonify({'error': 'No ids provided'}), 400

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
