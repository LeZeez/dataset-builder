import re

with open('ui/app.js', 'r') as f:
    content = f.read()

# Fix saveSystemPreset
save_preset = """
        if (res.ok) {
            const data = await res.json();
            renderSystemPresetSelect(type, data.presets || []);
            if (selectEl) selectEl.value = name;
            toast(`${type === 'chat' ? 'Chat' : 'Export'} preset saved!`, 'success');
        }
"""
save_preset_fixed = """
        if (res.ok) {
            const data = await res.json();
            renderSystemPresetSelect(type, data.presets || []);
            if (selectEl) {
                selectEl.value = name;
                loadSystemPreset(type);
            }
            toast(`${type === 'chat' ? 'Chat' : 'Export'} preset saved!`, 'success');
        }
"""
content = content.replace(save_preset, save_preset_fixed)

# Fix newSystemPreset
new_preset = """
        if (res.ok) {
            renderSystemPresetSelect(type, data.presets || []);
            if (selectEl) selectEl.value = name;
            toast(`New ${type === 'chat' ? 'chat' : 'export'} preset created!`, 'success');
        }
"""
new_preset_fixed = """
        if (res.ok) {
            renderSystemPresetSelect(type, data.presets || []);
            if (selectEl) {
                selectEl.value = name;
                loadSystemPreset(type);
            }
            toast(`New ${type === 'chat' ? 'chat' : 'export'} preset created!`, 'success');
        }
"""
content = content.replace(new_preset, new_preset_fixed)

with open('ui/app.js', 'w') as f:
    f.write(content)
