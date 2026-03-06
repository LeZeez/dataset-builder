"""
Backend server for Synthetic Dataset Generator

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
from flask import Flask, Response, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

# Import our modules
from scripts.parser import generate_conversation_id, validate_conversation
from scripts.exporter import export_dataset
from scripts.stats import get_stats

# Load config
CONFIG_PATH = Path('config.json')
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

    # Copy config.example.json to config.json
    config_example = Path(__file__).parent / "config.example.json"
    if not CONFIG_PATH.exists():
        try:
            shutil.copy2(config_example, CONFIG_PATH)
        except FileNotFoundError:
            pass
        except PermissionError:
            print(f"[Warning] Permission denied when copying config.example.json")

    # Load config to setup default presets if empty
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                config = json.load(f)

            changed = False

            def _add_default_preset(key, filename):
                nonlocal changed
                if key not in config or not config[key]:
                    path = Path(__file__).parent / "defaults" / filename
                    if path.exists():
                        with open(path, 'r', encoding='utf-8') as f_preset:
                            content = f_preset.read()
                        config[key] = [{'name': 'Default', 'prompt': content}]
                        changed = True

            _add_default_preset('chat_presets', 'Chat.txt')
            _add_default_preset('export_presets', 'Export.txt')

            if changed:
                with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
                    json.dump(config, f, indent=2, ensure_ascii=False)

        except (json.JSONDecodeError, IOError) as e:
            print(f"[Warning] Failed to setup default presets due to a config or file error: {e}")

setup_defaults()

def load_config() -> dict:
    with _config_lock:
        if CONFIG_PATH.exists():
            try:
                with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                return {}
        return {}

app = Flask(__name__, static_folder='ui', static_url_path='')

# Filter out /api/drafts and /api/health logs
class QuietFilter(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        return '/api/drafts' not in msg and '/api/health' not in msg

# Apply the filter to Werkzeug logger
log = logging.getLogger('werkzeug')
log.addFilter(QuietFilter())


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
        temp_path = CONFIG_PATH.with_suffix('.json.tmp')
        with open(temp_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
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
    """Get current configuration (hides full API keys)."""
    config = load_config()
    # Mask API keys for security (show last 4 chars only)
    safe_config = json.loads(json.dumps(config))  # deep copy
    for provider in safe_config.get('providers', {}).values():
        key = provider.get('api_key', '')
        if key and len(key) > 4:
            provider['api_key'] = '•' * 20 + key[-4:]
    return jsonify(safe_config)


@app.route('/api/config', methods=['POST'])
def update_config():
    """Update configuration (API keys, base URLs, etc)."""
    data = request.get_json() or {}
    config = load_config()
    
    # Update provider settings
    if 'provider' in data:
        provider = data['provider']
        
        if provider in config.get('providers', {}):
            # Update API key (only if not masked)
            if 'api_key' in data and not data['api_key'].startswith('•'):
                config['providers'][provider]['api_key'] = data['api_key']
            
            # Update base URL
            if 'base_url' in data:
                if not validate_base_url(data['base_url']):
                    return jsonify({'error': 'Invalid base URL'}), 400
                config['providers'][provider]['base_url'] = data['base_url']
    
    # Update default provider/model/temperature
    if 'default_provider' in data:
        config['api']['provider'] = data['default_provider']
    if 'default_model' in data:
        config['api']['model'] = data['default_model']
    if 'default_temperature' in data:
        config['api']['temperature'] = data['default_temperature']
    
    save_config(config)
    return jsonify({'success': True})


@app.route('/api/config/key', methods=['POST'])
def set_api_key():
    """Set API key for a provider."""
    data = request.get_json() or {}
    provider = data.get('provider')
    api_key = data.get('api_key', '')
    
    if not provider:
        return jsonify({'error': 'Provider required'}), 400

    config = load_config()
    
    if provider not in config.get('providers', {}):
        return jsonify({'error': 'Unknown provider'}), 400
    
    config['providers'][provider]['api_key'] = api_key
    save_config(config)
    
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
    
    config = load_config()
    
    if provider not in config.get('providers', {}):
        return jsonify({'error': 'Unknown provider'}), 400
    
    config['providers'][provider]['base_url'] = base_url
    save_config(config)
    
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


# Keep backward-compatible endpoint
@app.route('/api/prompt/<version>', methods=['GET'])
def get_prompt_legacy(version: str):
    """Get prompt template by version (legacy endpoint)."""
    # Sanitize version
    safe_version = re.sub(r'[^a-zA-Z0-9_-]', '', version)
    prompt_path = DATA_DIR / 'prompts' / f'{safe_version}.txt'
    if prompt_path.exists():
        return jsonify({'content': prompt_path.read_text(encoding='utf-8')})
    return jsonify({'error': 'Prompt not found'}), 404


# ============ STATS ============

@app.route('/api/stats', methods=['GET'])
def get_statistics():
    """Get dataset statistics."""
    wanted_stats = get_stats('data/wanted')
    rejected_count = len(list((DATA_DIR / 'rejected').glob('*.json'))) if (DATA_DIR / 'rejected').exists() else 0
    
    return jsonify({
        'wanted': wanted_stats.get('total_conversations', 0),
        'rejected': rejected_count,
        'details': wanted_stats
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


# Default trusted API domains (can be extended via config.json server.trusted_domains)
_DEFAULT_TRUSTED_DOMAINS = (
    'api.openai.com',
    'api.anthropic.com',
    'generativelanguage.googleapis.com',
    'openrouter.ai',
    'api.together.xyz',
)


def _get_trusted_domains() -> tuple:
    """Get trusted domains from config, falling back to defaults."""
    config = load_config()
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


def validate_base_url(url: str) -> bool:
    """Validate base_url to prevent SSRF attacks.

    - Always blocks non-http(s) schemes
    - Always allows known trusted API domains (configurable via config.json)
    - If server.allow_local_network is true (default), allows any URL including
      localhost and private IPs — suitable for self-hosted setups
    - If server.allow_local_network is false, rejects private/loopback/link-local IPs
    """
    if not url:
        return True
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ('http', 'https'):
            return False
        hostname = parsed.hostname
        if not hostname:
            return False

        # Always allow known trusted API domains
        trusted = _get_trusted_domains()
        if any(hostname == d or hostname.endswith('.' + d) for d in trusted):
            return True

        # Check config: allow_local_network defaults to true (self-hosted friendly)
        config = load_config()
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
    
    provider_config = config.get('providers', {}).get('openai', {})
    
    # Try config first, then environment variable
    api_key = provider_config.get('api_key') or os.environ.get('OPENAI_API_KEY')
    if not api_key:
        raise ValueError('OpenAI API key not set. Configure it in Settings.')
    
    base_url = provider_config.get('base_url') or 'https://api.openai.com/v1'
    if not validate_base_url(base_url):
        raise ValueError('Invalid base URL configured for OpenAI.')

    client = openai.OpenAI(api_key=api_key, base_url=base_url)
    
    kwargs = dict(
        model=model,
        messages=[{'role': 'user', 'content': prompt}],
        temperature=temperature,
        max_tokens=2048
    )
    if custom_params:
        kwargs['extra_body'] = custom_params
    
    response = client.chat.completions.create(**kwargs)
    
    return response.choices[0].message.content


def generate_anthropic(prompt: str, model: str, temperature: float, config: dict, custom_params: dict = None) -> str:
    """Generate using Anthropic API."""
    
    provider_config = config.get('providers', {}).get('anthropic', {})
    
    api_key = provider_config.get('api_key') or os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        raise ValueError('Anthropic API key not set. Configure it in Settings.')
    
    base_url = provider_config.get('base_url') or 'https://api.anthropic.com/v1'
    if not validate_base_url(base_url):
        raise ValueError('Invalid base URL configured for Anthropic.')

    client = anthropic.Anthropic(api_key=api_key, base_url=base_url)
    
    kwargs = dict(
        model=model or 'claude-3-5-sonnet-20241022',
        max_tokens=2048,
        messages=[{'role': 'user', 'content': prompt}],
        temperature=temperature
    )
    if custom_params:
        kwargs.update(custom_params)
    
    response = client.messages.create(**kwargs)
    
    return response.content[0].text


def generate_google(prompt: str, model: str, temperature: float, config: dict, custom_params: dict = None) -> str:
    """Generate using Google Gemini API."""
    
    provider_config = config.get('providers', {}).get('google', {})
    
    api_key = provider_config.get('api_key') or os.environ.get('GOOGLE_API_KEY')
    if not api_key:
        raise ValueError('Google API key not set. Configure it in Settings.')
    
    genai.configure(api_key=api_key)
    
    gen_config = dict(
        temperature=temperature,
        max_output_tokens=2048
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
    
    # Generate ID
    target_dir = f'data/{folder}'
    conv_id = generate_conversation_id(target_dir)
    
    # Build full conversation object
    full_conv = {
        'id': conv_id,
        'conversations': conversation.get('conversations', []),
        'metadata': {
            'created_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
            'source': 'synthetic',
            **metadata
        }
    }
    
    # Validate
    is_valid, errors = validate_conversation(full_conv)
    if not is_valid:
        return jsonify({'error': 'Invalid conversation', 'details': errors}), 400
    
    # Save
    folder_path = Path(target_dir)
    folder_path.mkdir(parents=True, exist_ok=True)
    
    filepath = folder_path / f'{conv_id}.json'
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(full_conv, f, ensure_ascii=False, indent=2)
    
    return jsonify({
        'success': True,
        'id': conv_id,
        'path': str(filepath)
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
            
            target_dir = f'data/{folder}'
            conv_id = generate_conversation_id(target_dir)
            
            full_conv = {
                'id': conv_id,
                'conversations': conversation.get('conversations', []),
                'metadata': {
                    'created_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
                    'source': 'synthetic',
                    **metadata
                }
            }
            
            is_valid, errs = validate_conversation(full_conv)
            if not is_valid:
                errors.append({'error': errs})
                continue
            
            folder_path = Path(target_dir)
            folder_path.mkdir(parents=True, exist_ok=True)
            
            filepath = folder_path / f'{conv_id}.json'
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(full_conv, f, ensure_ascii=False, indent=2)
            
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
            stat = file.stat()
            files.append({
                'name': file.name,
                'format': fmt_dir.name,
                'path': f"{fmt_dir.name}/{file.name}",
                'size': stat.st_size,
                'created_at': stat.st_mtime * 1000
            })

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
            'data/wanted',
            'exports',
            format,
            selected_ids=selected_ids,
            system_prompt=system_prompt,
            filename=filename
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
    """List all saved conversations."""
    folder = request.args.get('folder', 'wanted')
    if not is_valid_folder(folder):
        return jsonify({'error': 'Invalid folder'}), 400

    search = request.args.get('search', '').strip().lower()
    tag_filter = request.args.get('tag', '').strip()
    folder_path = DATA_DIR / folder
    
    if not folder_path.exists():
        return jsonify([])
    
    conversations = []
    for json_file in sorted(folder_path.glob('*.json'), reverse=True):
        try:
            with open(json_file, 'r', encoding='utf-8') as f:
                conv = json.load(f)
                msgs = conv.get('conversations', [])
                # Get first user message as preview
                first_user = next((m['value'] for m in msgs if m.get('from') == 'human'), '')
                tags = conv.get('metadata', {}).get('tags', [])
                
                # Apply search filter
                if search:
                    all_text = ' '.join(m.get('value', '') for m in msgs).lower()
                    if search not in all_text and search not in json_file.stem.lower():
                        continue
                
                # Apply tag filter
                if tag_filter and tag_filter not in tags:
                    continue
                
                conversations.append({
                    'id': conv.get('id', json_file.stem),
                    'preview': first_user[:80] if first_user else json_file.stem,
                    'created_at': conv.get('metadata', {}).get('created_at'),
                    'tags': tags,
                    'turns': len([m for m in msgs if m.get('from') in ('human', 'gpt')])
                })
        except json.JSONDecodeError:
            # Skip malformed files
            continue
        except Exception:
            # Skip other processing errors
            continue
    
    return jsonify(conversations)


@app.route('/api/conversation/<conv_id>', methods=['GET'])
def get_conversation(conv_id: str):
    """Get a single conversation by ID."""
    if not is_safe_id(conv_id):
        return jsonify({'error': 'Invalid conversation ID'}), 400

    folder = request.args.get('folder', 'wanted')
    if not is_valid_folder(folder):
        return jsonify({'error': 'Invalid folder'}), 400

    filepath = DATA_DIR / folder / f'{conv_id}.json'
    
    if not filepath.exists():
        return jsonify({'error': 'Conversation not found'}), 404
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return jsonify(json.load(f))
    except json.JSONDecodeError:
        return jsonify({'error': 'Invalid conversation file format'}), 400


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
    
    src_path = DATA_DIR / from_folder / f'{conv_id}.json'
    dst_path = DATA_DIR / to_folder / f'{conv_id}.json'
    
    if not src_path.exists():
        return jsonify({'error': 'Conversation not found'}), 404
    
    # Move file
    dst_path.parent.mkdir(parents=True, exist_ok=True)
    src_path.rename(dst_path)
    
    return jsonify({'success': True, 'new_path': str(dst_path)})


@app.route('/api/conversation/<conv_id>', methods=['DELETE'])
def delete_conversation(conv_id: str):
    """Permanently delete a conversation."""
    if not is_safe_id(conv_id):
        return jsonify({'error': 'Invalid conversation ID'}), 400

    folder = request.args.get('folder', 'wanted')
    
    if not is_valid_folder(folder):
        return jsonify({'error': 'Invalid folder'}), 400
    
    filepath = DATA_DIR / folder / f'{conv_id}.json'
    
    if not filepath.exists():
        return jsonify({'error': 'Conversation not found'}), 404
    
    # Permanently delete
    filepath.unlink()
    
    return jsonify({'success': True, 'deleted': conv_id})

@app.route('/api/conversations/bulk-delete', methods=['POST'])
def bulk_delete_conversations():
    """Bulk delete conversations."""
    data = request.get_json() or {}
    ids = data.get('ids', [])
    folder = data.get('folder', 'wanted')

    if not is_valid_folder(folder):
        return jsonify({'error': 'Invalid folder'}), 400

    deleted = []
    for conv_id in ids:
        if not is_safe_id(conv_id):
            continue

        filepath = DATA_DIR / folder / f'{conv_id}.json'
        if filepath.exists():
            try:
                filepath.unlink()
                deleted.append(conv_id)
            except Exception as e:
                app.logger.error(f"Failed to delete conversation {conv_id}: {e}")

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

    moved = []

    dst_dir = DATA_DIR / to_folder
    dst_dir.mkdir(parents=True, exist_ok=True)

    for conv_id in ids:
        if not is_safe_id(conv_id):
            continue

        src_path = DATA_DIR / from_folder / f'{conv_id}.json'
        dst_path = dst_dir / f'{conv_id}.json'

        if src_path.exists():
            try:
                src_path.rename(dst_path)
                moved.append(conv_id)
            except Exception as e:
                app.logger.error(f"Failed to move conversation {conv_id}: {e}")

    return jsonify({'success': True, 'moved': moved})


# ============ MODELS ============

@app.route('/api/models', methods=['GET'])
def list_models():
    """Fetch available models from provider."""
    provider = request.args.get('provider', 'openai')
    config = load_config()
    provider_config = config.get('providers', {}).get(provider, {})
    
    # Get saved model history
    model_history = config.get('model_history', {}).get(provider, [])
    
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
            'history': model_history,
            'default': config.get('api', {}).get('model', '')
        })
    except Exception as e:
        return jsonify({
            'models': [],
            'history': model_history,
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
        # Return empty list instead of hardcoded fallback
        return []


def fetch_google_models(provider_config: dict) -> list:
    """Fetch models from Google AI."""
    
    api_key = provider_config.get('api_key') or os.environ.get('GOOGLE_API_KEY')
    if not api_key:
        return []
    
    genai.configure(api_key=api_key)
    models = genai.list_models()
    result = [m.name.replace('models/', '') for m in models if 'generateContent' in m.supported_generation_methods]
    return result


@app.route('/api/models/history', methods=['POST'])
def add_model_to_history():
    """Add a model to history for quick access."""
    data = request.get_json() or {}
    provider = data.get('provider', 'openai')
    model = data.get('model', '')
    
    if not model:
        return jsonify({'error': 'Model required'}), 400
    
    config = load_config()
    if 'model_history' not in config:
        config['model_history'] = {}
    if provider not in config['model_history']:
        config['model_history'][provider] = []
    
    # Add to front, remove duplicates, limit to 10
    history = config['model_history'][provider]
    if model in history:
        history.remove(model)
    history.insert(0, model)
    config['model_history'][provider] = history[:10]
    
    save_config(config)
    return jsonify({'success': True, 'history': config['model_history'][provider]})


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
    
    provider_config = config.get('providers', {}).get('openai', {})
    api_key = provider_config.get('api_key') or os.environ.get('OPENAI_API_KEY')
    if not api_key:
        yield f"data: {json.dumps({'error': 'OpenAI API key not set'})}\n\n"
        return
    
    base_url = provider_config.get('base_url') or 'https://api.openai.com/v1'
    if not validate_base_url(base_url):
        yield f"data: {json.dumps({'error': 'Invalid base URL configured for OpenAI'})}\n\n"
        return
    client = openai.OpenAI(api_key=api_key, base_url=base_url)
    
    messages = []
    if system_prompt:
        messages.append({'role': 'system', 'content': system_prompt})
    messages.append({'role': 'user', 'content': prompt})
    
    kwargs = dict(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=2048,
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
    
    provider_config = config.get('providers', {}).get('anthropic', {})
    api_key = provider_config.get('api_key') or os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        yield f"data: {json.dumps({'error': 'Anthropic API key not set'})}\n\n"
        return
    
    base_url = provider_config.get('base_url') or 'https://api.anthropic.com/v1'
    if not validate_base_url(base_url):
        yield f"data: {json.dumps({'error': 'Invalid base URL configured for Anthropic'})}\n\n"
        return

    client = anthropic.Anthropic(api_key=api_key, base_url=base_url)
    
    kwargs = dict(
        model=model or 'claude-3-5-sonnet-20241022',
        max_tokens=2048,
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
    
    provider_config = config.get('providers', {}).get('google', {})
    api_key = provider_config.get('api_key') or os.environ.get('GOOGLE_API_KEY')
    if not api_key:
        yield f"data: {json.dumps({'error': 'Google API key not set'})}\n\n"
        return
    
    genai.configure(api_key=api_key)
    
    gen_config = dict(
        temperature=temperature,
        max_output_tokens=2048
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
    config = load_config()
    return jsonify({'presets': config.get('variable_presets', [])})


@app.route('/api/presets', methods=['POST'])
def save_preset():
    """Save a new variable preset."""
    data = request.get_json() or {}
    name = data.get('name', '')
    values = data.get('values', {})
    overwrite = data.get('overwrite', True)
    
    if not name:
        return jsonify({'error': 'Preset name required'}), 400
    
    config = load_config()
    if 'variable_presets' not in config:
        config['variable_presets'] = []
    
    # Update existing or add new
    existing = next((p for p in config['variable_presets'] if p['name'] == name), None)
    if existing:
        if not overwrite:
            return jsonify({'error': 'Preset already exists'}), 400
        existing['values'] = values
    else:
        config['variable_presets'].append({'name': name, 'values': values})
    
    save_config(config)
    return jsonify({'success': True, 'presets': config['variable_presets']})


@app.route('/api/presets/<name>', methods=['DELETE'])
def delete_preset(name: str):
    """Delete a variable preset."""
    config = load_config()
    config['variable_presets'] = [p for p in config.get('variable_presets', []) if p['name'] != name]
    save_config(config)
    return jsonify({'success': True})


# ============ DRAFTS (Cross-Device Sync) ============

DRAFTS_PATH = DATA_DIR / 'drafts.json'


def load_drafts() -> dict:
    """Load drafts from file."""
    if DRAFTS_PATH.exists():
        try:
            with open(DRAFTS_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except json.JSONDecodeError:
            pass
    return {}


def save_drafts(drafts: dict):
    """Save drafts to file."""
    with open(DRAFTS_PATH, 'w', encoding='utf-8') as f:
        json.dump(drafts, f, indent=2, ensure_ascii=False)


@app.route('/api/drafts', methods=['GET'])
def get_drafts():
    """Get all saved drafts for cross-device sync."""
    return jsonify(load_drafts())


@app.route('/api/drafts', methods=['POST'])
def save_draft_endpoint():
    """Save drafts for cross-device sync."""
    data = request.get_json() or {}
    drafts = load_drafts()
    
    # Merge incoming data with existing drafts
    for key, value in data.items():
        drafts[key] = value
    
    # Add timestamp
    drafts['_updated'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    
    save_drafts(drafts)
    return jsonify({'success': True, 'updated': drafts['_updated']})


@app.route('/api/drafts/<key>', methods=['POST'])
def save_draft_key(key: str):
    """Save a specific draft key."""
    data = request.get_json() or {}
    drafts = load_drafts()
    drafts[key] = data.get('value')
    drafts['_updated'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    save_drafts(drafts)
    return jsonify({'success': True})


# ============ EXPORT PRESETS ============

@app.route('/api/export-presets', methods=['GET'])
def get_export_presets():
    """Get export system prompt presets."""
    config = load_config()
    return jsonify({'presets': config.get('export_presets', [])})

@app.route('/api/export-presets', methods=['POST'])
def save_export_preset():
    """Save an export system prompt preset."""
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    prompt = data.get('prompt', '')
    overwrite = data.get('overwrite', True)

    if not name:
        return jsonify({'error': 'Name required'}), 400

    config = load_config()
    if 'export_presets' not in config:
        config['export_presets'] = []

    # Update existing or add new
    existing = next((p for p in config['export_presets'] if p['name'] == name), None)
    if existing:
        if not overwrite:
            return jsonify({'error': 'Preset already exists'}), 400
        existing['prompt'] = prompt
    else:
        config['export_presets'].append({'name': name, 'prompt': prompt})

    save_config(config)
    return jsonify({'success': True, 'presets': config['export_presets']})

@app.route('/api/export-presets/<name>', methods=['DELETE'])
def delete_export_preset(name: str):
    """Delete an export preset."""
    config = load_config()
    config['export_presets'] = [p for p in config.get('export_presets', []) if p['name'] != name]
    save_config(config)
    return jsonify({'success': True})


# ============ CHAT PRESETS ============

@app.route('/api/chat-presets', methods=['GET'])
def get_chat_presets():
    """Get chat system prompt presets."""
    config = load_config()
    return jsonify({'presets': config.get('chat_presets', [])})


@app.route('/api/chat-presets', methods=['POST'])
def save_chat_preset():
    """Save a chat system prompt preset."""
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    prompt = data.get('prompt', '')
    overwrite = data.get('overwrite', True)
    
    if not name:
        return jsonify({'error': 'Name required'}), 400
    
    config = load_config()
    if 'chat_presets' not in config:
        config['chat_presets'] = []
    
    # Update existing or add new
    existing = next((p for p in config['chat_presets'] if p['name'] == name), None)
    if existing:
        if not overwrite:
            return jsonify({'error': 'Preset already exists'}), 400
        existing['prompt'] = prompt
    else:
        config['chat_presets'].append({'name': name, 'prompt': prompt})
    
    save_config(config)
    return jsonify({'success': True, 'presets': config['chat_presets']})


@app.route('/api/chat-presets/<name>', methods=['DELETE'])
def delete_chat_preset(name: str):
    """Delete a chat preset."""
    config = load_config()
    config['chat_presets'] = [p for p in config.get('chat_presets', []) if p['name'] != name]
    save_config(config)
    return jsonify({'success': True})


# ============ TAGS ============

@app.route('/api/tags', methods=['GET'])
def get_all_tags():
    """Get all unique tags used across conversations."""
    wanted_path = DATA_DIR / 'wanted'
    tags = set()
    
    if wanted_path.exists():
        for json_file in wanted_path.glob('*.json'):
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    conv = json.load(f)
                    for tag in conv.get('metadata', {}).get('tags', []):
                        tags.add(tag)
            except json.JSONDecodeError:
                continue
            except Exception:
                continue
    
    return jsonify({'tags': sorted(list(tags))})


# ============ REVIEW QUEUE (Server-Side) ============

REVIEW_QUEUE_PATH = DATA_DIR / 'review_queue.json'
_review_queue_lock = threading.Lock()


def load_review_queue() -> list:
    """Load review queue from file."""
    if REVIEW_QUEUE_PATH.exists():
        try:
            with open(REVIEW_QUEUE_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except json.JSONDecodeError:
            pass
    return []


def save_review_queue(queue: list):
    """Save review queue to file."""
    with open(REVIEW_QUEUE_PATH, 'w', encoding='utf-8') as f:
        json.dump(queue, f, indent=2, ensure_ascii=False)


@app.route('/api/review-queue', methods=['GET'])
def get_review_queue():
    """Get all items in the review queue."""
    with _review_queue_lock:
        queue = load_review_queue()
    return jsonify({'queue': queue, 'count': len(queue)})


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
    
    with _review_queue_lock:
        queue = load_review_queue()
        
        added = []
        for item in items:
            entry = {
                'id': str(uuid.uuid4()),
                'conversations': item.get('conversations', []),
                'rawText': item.get('rawText', ''),
                'metadata': item.get('metadata', {}),
                'createdAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            }
            queue.append(entry)
            added.append(entry)
        
        save_review_queue(queue)
    
    return jsonify({
        'success': True,
        'added': added,
        'count': len(queue)
    })


@app.route('/api/review-queue/<item_id>', methods=['DELETE'])
def remove_from_review_queue(item_id: str):
    """Remove a specific item from the review queue."""
    with _review_queue_lock:
        queue = load_review_queue()
        original_len = len(queue)
        queue = [item for item in queue if item.get('id') != item_id]
        
        if len(queue) == original_len:
            return jsonify({'error': 'Item not found'}), 404
        
        save_review_queue(queue)
    
    return jsonify({'success': True, 'count': len(queue)})

@app.route('/api/review-queue/bulk-delete', methods=['POST'])
def bulk_remove_from_review_queue():
    """Bulk remove items from the review queue."""
    data = request.get_json() or {}
    ids = data.get('ids', [])

    with _review_queue_lock:
        queue = load_review_queue()
        ids_set = set(ids)
        queue = [item for item in queue if item.get('id') not in ids_set]
        save_review_queue(queue)

    return jsonify({'success': True, 'count': len(queue)})

@app.route('/api/review-queue/bulk-keep', methods=['POST'])
def bulk_keep_from_review_queue():
    """Atomically save items from the review queue to wanted and remove them from the queue."""
    data = request.get_json() or {}
    ids = data.get('ids', [])
    ids_set = set(ids)

    if not ids:
        return jsonify({'error': 'No ids provided'}), 400

    saved = []
    errors = []

    with _review_queue_lock:
        queue = load_review_queue()

        # Find items to keep
        items_to_keep = [item for item in queue if item.get('id') in ids_set]

        # Save them to wanted folder
        target_dir = DATA_DIR / 'wanted'
        target_dir.mkdir(parents=True, exist_ok=True)

        for item in items_to_keep:
            try:
                conv_id = generate_conversation_id(str(target_dir))
                full_conv = {
                    'id': conv_id,
                    'conversations': item.get('conversations', []),
                    'metadata': {
                        'created_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
                        'source': 'synthetic',
                        **item.get('metadata', {})
                    }
                }

                is_valid, errs = validate_conversation(full_conv)
                if not is_valid:
                    errors.append({'error': errs, 'original_id': item.get('id')})
                    # Don't remove from queue if validation fails
                    ids_set.discard(item.get('id'))
                    continue

                filepath = target_dir / f'{conv_id}.json'
                with open(filepath, 'w', encoding='utf-8') as f:
                    json.dump(full_conv, f, ensure_ascii=False, indent=2)

                saved.append({'id': conv_id, 'original_id': item.get('id')})
            except Exception as e:
                errors.append({'error': str(e), 'original_id': item.get('id')})
                ids_set.discard(item.get('id'))

        # Remove successfully saved items from the review queue
        if saved:
            queue = [item for item in queue if item.get('id') not in ids_set]
            save_review_queue(queue)

    return jsonify({
        'success': True,
        'saved_count': len(saved),
        'error_count': len(errors),
        'saved': saved,
        'errors': errors,
        'count': len(queue)
    })


@app.route('/api/review-queue', methods=['DELETE'])
def clear_review_queue():
    """Clear the entire review queue."""
    with _review_queue_lock:
        save_review_queue([])
    return jsonify({'success': True, 'count': 0})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Synthetic Dataset Generator Server')
    parser.add_argument('--host', type=str, help='Host to bind to')
    parser.add_argument('--port', type=int, help='Port to bind to')
    args = parser.parse_args()

    config = load_config()
    server_config = config.get('server', {})

    host = args.host or server_config.get('host', '127.0.0.1')
    port = args.port or server_config.get('port', 5000)

    # Initialize proper CORS
    allowed_origins = [
        f'http://localhost:{port}',
        f'http://127.0.0.1:{port}'
    ]
    if host not in ('127.0.0.1', 'localhost', '0.0.0.0'):
        allowed_origins.append(f'http://{host}:{port}')
    CORS(app, origins=allowed_origins)

    # Ensure directories exist
    (DATA_DIR / 'wanted').mkdir(parents=True, exist_ok=True)
    (DATA_DIR / 'rejected').mkdir(parents=True, exist_ok=True)
    (DATA_DIR / 'prompts').mkdir(parents=True, exist_ok=True)
    Path('exports').mkdir(exist_ok=True)
    
    print('   Synthetic Dataset Generator')
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
