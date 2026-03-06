import re

with open('ui/app.js', 'r') as f:
    content = f.read()

delete_preset = """
    try {
        const res = await fetch(`/api/${type}-presets/${encodeURIComponent(selected)}`, { method: 'DELETE' });
        if (res.ok) {
            await loadSystemPresets(type);
            toast('Preset deleted!', 'success');
        }
    } catch (e) { toast('Failed to delete preset', 'error'); }
}
"""

delete_preset_fixed = """
    try {
        const res = await fetch(`/api/${type}-presets/${encodeURIComponent(selected)}`, { method: 'DELETE' });
        if (res.ok) {
            await loadSystemPresets(type);
            const targetEl = els[`${type}SystemPrompt`];
            if (targetEl) targetEl.value = '';
            if (state[type]) state[type].systemPrompt = '';
            debouncedSaveDraft();
            toast('Preset deleted!', 'success');
        }
    } catch (e) { toast('Failed to delete preset', 'error'); }
}
"""

content = content.replace(delete_preset, delete_preset_fixed)

with open('ui/app.js', 'w') as f:
    f.write(content)
