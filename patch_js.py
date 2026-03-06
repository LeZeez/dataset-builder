import re

with open('ui/app.js', 'r') as f:
    content = f.read()

# Add logic for exported datasets
new_js = """
// ============ EXPORTED DATASETS ============
async function openExportedDatasetsModal() {
    await loadExportedDatasets();
    els.exportedDatasetsModal.classList.remove('hidden');
}

function closeExportedDatasetsModal() {
    els.exportedDatasetsModal.classList.add('hidden');
}

async function loadExportedDatasets() {
    try {
        const res = await fetch('/api/exports');
        if (res.ok) {
            const data = await res.json();
            renderExportedDatasets(data.files || []);
        }
    } catch (e) {
        console.error('Failed to load exported datasets:', e);
    }
}

function formatSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024, sizes = ['Bytes', 'KB', 'MB', 'GB'], i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function renderExportedDatasets(files) {
    const listEl = els.exportedDatasetsList;
    if (!listEl) return;
    listEl.innerHTML = '';

    if (files.length === 0) {
        listEl.innerHTML = '<div class="empty-state">No exported datasets found</div>';
        return;
    }

    files.forEach(file => {
        const div = document.createElement('div');
        div.className = 'export-file-item file-item-compact';

        const info = document.createElement('div');
        info.className = 'file-info';

        const name = document.createElement('div');
        name.className = 'file-name';
        name.textContent = file.name;

        const meta = document.createElement('div');
        meta.className = 'file-meta';
        meta.textContent = `${file.format} • ${formatSize(file.size)} • ${formatDate(new Date(file.created_at).toISOString())}`;

        info.appendChild(name);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'file-actions';

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'icon-btn';
        downloadBtn.title = 'Download';
        downloadBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
        downloadBtn.onclick = () => window.open(`/api/exports/${file.format}/${encodeURIComponent(file.name)}`, '_blank');

        const renameBtn = document.createElement('button');
        renameBtn.className = 'icon-btn';
        renameBtn.title = 'Rename';
        renameBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
        renameBtn.onclick = async () => {
            const newName = prompt('Enter new filename (must end in .jsonl):', file.name);
            if (!newName || newName === file.name) return;
            try {
                const res = await fetch(`/api/exports/${file.format}/${encodeURIComponent(file.name)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ new_name: newName })
                });
                if (res.ok) {
                    toast('File renamed', 'success');
                    await loadExportedDatasets();
                } else {
                    const err = await res.json();
                    toast(err.error || 'Failed to rename', 'error');
                }
            } catch (e) { toast('Failed to rename', 'error'); }
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'icon-btn text-danger';
        deleteBtn.title = 'Delete';
        deleteBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
        deleteBtn.onclick = async () => {
            if (!confirm(`Delete ${file.name}?`)) return;
            try {
                const res = await fetch(`/api/exports/${file.format}/${encodeURIComponent(file.name)}`, { method: 'DELETE' });
                if (res.ok) {
                    toast('File deleted', 'success');
                    await loadExportedDatasets();
                } else {
                    toast('Failed to delete', 'error');
                }
            } catch (e) { toast('Failed to delete', 'error'); }
        };

        actions.appendChild(downloadBtn);
        actions.appendChild(renameBtn);
        actions.appendChild(deleteBtn);

        div.appendChild(info);
        div.appendChild(actions);
        listEl.appendChild(div);
    });
}
"""

with open('ui/app.js', 'a') as f:
    f.write(new_js)

# Add elements
import re

with open('ui/app.js', 'r') as f:
    content = f.read()

els_replace = """
        macrosModal: $('#macros-modal'),
        closeMacrosModal: $('#close-macros-modal'),
"""
els_fixed = """
        macrosModal: $('#macros-modal'),
        closeMacrosModal: $('#close-macros-modal'),
        viewExportedDatasetsBtn: $('#view-exported-datasets-btn'),
        exportedDatasetsModal: $('#exported-datasets-modal'),
        closeExportedDatasetsModal: $('#close-exported-datasets-modal'),
        exportedDatasetsList: $('#exported-datasets-list'),
        exportFilename: $('#export-filename'),
"""

content = content.replace(els_replace, els_fixed)

listeners_replace = """
    $('#macros-modal .modal-backdrop')?.addEventListener('click', closeMacrosModal);
"""
listeners_fixed = """
    $('#macros-modal .modal-backdrop')?.addEventListener('click', closeMacrosModal);
    $('#exported-datasets-modal .modal-backdrop')?.addEventListener('click', closeExportedDatasetsModal);
    els.viewExportedDatasetsBtn?.addEventListener('click', openExportedDatasetsModal);
    els.closeExportedDatasetsModal?.addEventListener('click', closeExportedDatasetsModal);
"""

content = content.replace(listeners_replace, listeners_fixed)

# Modify export dataset to send custom filename
export_dataset_func = """
async function exportDataset(format, selectedIds = null, systemPrompt = null) {
    showSaveIndicator('Exporting...');
    try {
        const res = await fetch(`/api/export/${format}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: selectedIds, system_prompt: systemPrompt })
        });
"""
export_dataset_fixed = """
async function exportDataset(format, selectedIds = null, systemPrompt = null) {
    showSaveIndicator('Exporting...');
    try {
        const filename = els.exportFilename?.value?.trim() || null;
        const res = await fetch(`/api/export/${format}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: selectedIds, system_prompt: systemPrompt, filename })
        });
"""
content = content.replace(export_dataset_func, export_dataset_fixed)

with open('ui/app.js', 'w') as f:
    f.write(content)
