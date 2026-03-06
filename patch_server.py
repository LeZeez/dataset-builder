import re

with open('server.py', 'r') as f:
    content = f.read()

endpoints_to_add = """
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
                'created_at': stat.st_ctime * 1000
            })

    files.sort(key=lambda x: x['created_at'], reverse=True)
    return jsonify({'files': files})

@app.route('/api/exports/<format>/<filename>', methods=['GET'])
def download_export(format: str, filename: str):
    '''Download an exported dataset.'''
    filename = re.sub(r'[^a-zA-Z0-9_.-]', '', filename)
    if not filename or filename.startswith('.'):
        return jsonify({'error': 'Invalid filename'}), 400

    export_dir = Path('exports') / format
    return send_from_directory(str(export_dir), filename, as_attachment=True)

@app.route('/api/exports/<format>/<filename>', methods=['DELETE'])
def delete_export(format: str, filename: str):
    '''Delete an exported dataset.'''
    filename = re.sub(r'[^a-zA-Z0-9_.-]', '', filename)
    if not filename or filename.startswith('.'):
        return jsonify({'error': 'Invalid filename'}), 400

    file_path = Path('exports') / format / filename
    if file_path.exists():
        file_path.unlink()
        return jsonify({'success': True})
    return jsonify({'error': 'File not found'}), 404

@app.route('/api/exports/<format>/<filename>', methods=['PUT'])
def rename_export(format: str, filename: str):
    '''Rename an exported dataset.'''
    filename = re.sub(r'[^a-zA-Z0-9_.-]', '', filename)
    if not filename or filename.startswith('.'):
        return jsonify({'error': 'Invalid old filename'}), 400

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
"""

export_endpoint = """
@app.route('/api/export/<format>', methods=['POST'])
def export_dataset_endpoint(format: str):
    \"\"\"Export dataset to specified format.\"\"\"
    if format not in ('sharegpt', 'openai', 'alpaca'):
        return jsonify({'error': 'Invalid format'}), 400

    try:
        data = request.get_json() or {}
        selected_ids = data.get('ids', None)  # List of IDs or None for all
        system_prompt = data.get('system_prompt', None)  # Override system prompt

        output_path = export_dataset(
            'data/wanted',
            'exports',
            format,
            selected_ids=selected_ids,
            system_prompt=system_prompt
        )
"""

export_endpoint_fixed = """
@app.route('/api/export/<format>', methods=['POST'])
def export_dataset_endpoint(format: str):
    \"\"\"Export dataset to specified format.\"\"\"
    if format not in ('sharegpt', 'openai', 'alpaca'):
        return jsonify({'error': 'Invalid format'}), 400

    try:
        data = request.get_json() or {}
        selected_ids = data.get('ids', None)  # List of IDs or None for all
        system_prompt = data.get('system_prompt', None)  # Override system prompt
        filename = data.get('filename', None) # Optional custom filename
        if filename:
            filename = re.sub(r'[^a-zA-Z0-9_.-]', '', filename)
            if not filename.endswith('.jsonl'): filename += '.jsonl'

        output_path = export_dataset(
            'data/wanted',
            'exports',
            format,
            selected_ids=selected_ids,
            system_prompt=system_prompt,
            filename=filename
        )
"""

content = content.replace("""
# ============ EXPORT ============

@app.route('/api/export/<format>', methods=['POST'])
""", endpoints_to_add)

content = content.replace(export_endpoint, export_endpoint_fixed)

with open('server.py', 'w') as f:
    f.write(content)
