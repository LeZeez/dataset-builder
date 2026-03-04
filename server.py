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

import os
import json
import re
import uuid
import threading
from pathlib import Path
from datetime import datetime
from typing import Optional, Generator

from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS

# Import our modules
from scripts.parser import parse_minimal_format, generate_conversation_id, validate_conversation
from scripts.exporter import export_dataset
from scripts.stats import get_stats
import logging

app = Flask(__name__, static_folder='ui', static_url_path='')
CORS(app)

# Filter out /api/drafts and /api/health logs
class QuietFilter(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        return '/api/drafts' not in msg and '/api/health' not in msg

# Apply the filter to Werkzeug logger
log = logging.getLogger('werkzeug')
log.addFilter(QuietFilter())

# Load config
CONFIG_PATH = Path('config.json')
DATA_DIR = Path('data')


def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except json.JSONDecodeError:
            return {}
    return {}


def save_config(config: dict):
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)


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
    return jsonify({'status': 'ok', 'timestamp': datetime.utcnow().isoformat() + 'Z'})


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
    data = request.json
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
    data = request.json
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
    data = request.json
    provider = data.get('provider')
    base_url = data.get('base_url', '')
    
    if not provider:
        return jsonify({'error': 'Provider required'}), 400
    
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
    data = request.json
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
    prompt_path = DATA_DIR / 'prompts' / f'{version}.txt'
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


# ============ GENERATION ============

@app.route('/api/generate', methods=['POST'])
def generate_conversation():
    """Generate a conversation using configured LLM."""
    data = request.json
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
    import openai
    
    provider_config = config.get('providers', {}).get('openai', {})
    
    # Try config first, then environment variable
    api_key = provider_config.get('api_key') or os.environ.get('OPENAI_API_KEY')
    if not api_key:
        raise ValueError('OpenAI API key not set. Configure it in Settings.')
    
    base_url = provider_config.get('base_url') or 'https://api.openai.com/v1'
    
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
    import anthropic
    
    provider_config = config.get('providers', {}).get('anthropic', {})
    
    api_key = provider_config.get('api_key') or os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        raise ValueError('Anthropic API key not set. Configure it in Settings.')
    
    base_url = provider_config.get('base_url') or 'https://api.anthropic.com/v1'
    
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
    import google.generativeai as genai
    
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
    data = request.json
    conversation = data.get('conversation', {})
    folder = data.get('folder', 'wanted')  # 'wanted' or 'rejected'
    metadata = data.get('metadata', {})
    
    if folder not in ('wanted', 'rejected'):
        return jsonify({'error': 'Invalid folder'}), 400
    
    # Generate ID
    target_dir = f'data/{folder}'
    conv_id = generate_conversation_id(target_dir)
    
    # Build full conversation object
    full_conv = {
        'id': conv_id,
        'conversations': conversation.get('conversations', []),
        'metadata': {
            'created_at': datetime.utcnow().isoformat() + 'Z',
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
    data = request.json
    items = data.get('items', [])
    folder = data.get('folder', 'wanted')
    
    if folder not in ('wanted', 'rejected'):
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
                    'created_at': datetime.utcnow().isoformat() + 'Z',
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

@app.route('/api/export/<format>', methods=['POST'])
def export_dataset_endpoint(format: str):
    """Export dataset to specified format."""
    if format not in ('sharegpt', 'openai', 'alpaca'):
        return jsonify({'error': 'Invalid format'}), 400
    
    try:
        data = request.json or {}
        selected_ids = data.get('ids', None)  # List of IDs or None for all
        system_prompt = data.get('system_prompt', None)  # Override system prompt
        
        output_path = export_dataset(
            'data/wanted',
            'exports',
            format,
            selected_ids=selected_ids,
            system_prompt=system_prompt
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
    folder = request.args.get('folder', 'wanted')
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
    data = request.json
    from_folder = data.get('from', 'wanted')
    to_folder = data.get('to', 'rejected')
    
    if from_folder not in ('wanted', 'rejected') or to_folder not in ('wanted', 'rejected'):
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
    folder = request.args.get('folder', 'wanted')
    
    if folder not in ('wanted', 'rejected'):
        return jsonify({'error': 'Invalid folder'}), 400
    
    filepath = DATA_DIR / folder / f'{conv_id}.json'
    
    if not filepath.exists():
        return jsonify({'error': 'Conversation not found'}), 404
    
    # Permanently delete
    filepath.unlink()
    
    return jsonify({'success': True, 'deleted': conv_id})


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
    import openai
    
    api_key = provider_config.get('api_key') or os.environ.get('OPENAI_API_KEY')
    if not api_key:
        return []
    
    base_url = provider_config.get('base_url') or 'https://api.openai.com/v1'
    client = openai.OpenAI(api_key=api_key, base_url=base_url)
    
    response = client.models.list()
    # Return all models, excluding known non-chat models (embeddings, tts, whisper, dall-e, moderation)
    excluded_prefixes = ('text-embedding', 'tts-', 'whisper', 'dall-e', 'text-moderation', 'davinci', 'babbage', 'curie', 'ada')
    all_models = [m.id for m in response.data if not m.id.lower().startswith(excluded_prefixes)]
    return sorted(all_models, reverse=True)


def fetch_anthropic_models(provider_config: dict) -> list:
    """Fetch models from Anthropic API."""
    import anthropic
    
    api_key = provider_config.get('api_key') or os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        return []
    
    try:
        base_url = provider_config.get('base_url') or 'https://api.anthropic.com'
        client = anthropic.Anthropic(api_key=api_key, base_url=base_url)
        
        response = client.models.list()
        models = [m.id for m in response.data]
        return sorted(models, reverse=True)
    except Exception as e:
        # Return empty list instead of hardcoded fallback
        return []


def fetch_google_models(provider_config: dict) -> list:
    """Fetch models from Google AI."""
    import google.generativeai as genai
    
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
    data = request.json
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
    data = request.json
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
    import openai
    
    provider_config = config.get('providers', {}).get('openai', {})
    api_key = provider_config.get('api_key') or os.environ.get('OPENAI_API_KEY')
    if not api_key:
        yield f"data: {json.dumps({'error': 'OpenAI API key not set'})}\n\n"
        return
    
    base_url = provider_config.get('base_url') or 'https://api.openai.com/v1'
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
    import anthropic
    
    provider_config = config.get('providers', {}).get('anthropic', {})
    api_key = provider_config.get('api_key') or os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        yield f"data: {json.dumps({'error': 'Anthropic API key not set'})}\n\n"
        return
    
    client = anthropic.Anthropic(api_key=api_key)
    
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
    import google.generativeai as genai
    
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
    data = request.json
    name = data.get('name', '')
    values = data.get('values', {})
    
    if not name:
        return jsonify({'error': 'Preset name required'}), 400
    
    config = load_config()
    if 'variable_presets' not in config:
        config['variable_presets'] = []
    
    # Update existing or add new
    existing = next((p for p in config['variable_presets'] if p['name'] == name), None)
    if existing:
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
    data = request.json
    drafts = load_drafts()
    
    # Merge incoming data with existing drafts
    for key, value in data.items():
        drafts[key] = value
    
    # Add timestamp
    drafts['_updated'] = datetime.utcnow().isoformat() + 'Z'
    
    save_drafts(drafts)
    return jsonify({'success': True, 'updated': drafts['_updated']})


@app.route('/api/drafts/<key>', methods=['POST'])
def save_draft_key(key: str):
    """Save a specific draft key."""
    data = request.json
    drafts = load_drafts()
    drafts[key] = data.get('value')
    drafts['_updated'] = datetime.utcnow().isoformat() + 'Z'
    save_drafts(drafts)
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
    data = request.json
    name = data.get('name', '').strip()
    prompt = data.get('prompt', '')
    
    if not name:
        return jsonify({'error': 'Name required'}), 400
    
    config = load_config()
    if 'chat_presets' not in config:
        config['chat_presets'] = []
    
    # Update existing or add new
    existing = next((p for p in config['chat_presets'] if p['name'] == name), None)
    if existing:
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
    data = request.json
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
                'createdAt': datetime.utcnow().isoformat() + 'Z'
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


@app.route('/api/review-queue', methods=['DELETE'])
def clear_review_queue():
    """Clear the entire review queue."""
    with _review_queue_lock:
        save_review_queue([])
    return jsonify({'success': True, 'count': 0})


if __name__ == '__main__':
    # Ensure directories exist
    (DATA_DIR / 'wanted').mkdir(parents=True, exist_ok=True)
    (DATA_DIR / 'rejected').mkdir(parents=True, exist_ok=True)
    (DATA_DIR / 'prompts').mkdir(parents=True, exist_ok=True)
    Path('exports').mkdir(exist_ok=True)
    
    print('   Synthetic Dataset Generator')
    print('   Server running at http://localhost:5000')
    print('   Press Ctrl+C to stop')
    
    app.run(debug=True, host='127.0.0.1', port=5000)
