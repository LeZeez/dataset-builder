import re

with open('ui/app.js', 'r') as f:
    content = f.read()

save_preset_action = """
        if (res.ok) {
            const data = await res.json();
            renderPresetSelect(data.presets);
            if (els.presetSelect) els.presetSelect.value = name;
            toast('Preset saved!', 'success');
        }
    } catch (e) { toast('Failed to save preset', 'error'); }
}
"""

save_preset_action_fixed = """
        if (res.ok) {
            const data = await res.json();
            renderPresetSelect(data.presets);
            if (els.presetSelect) {
                els.presetSelect.value = name;
                state.presetName = name;
                debouncedSaveDraft();
            }
            toast('Preset saved!', 'success');
        }
    } catch (e) { toast('Failed to save preset', 'error'); }
}
"""

delete_preset_action = """
    try {
        const res = await fetch(`/api/presets/${encodeURIComponent(name)}`, { method: 'DELETE' });
        if (res.ok) {
            await loadPresets();
            toast('Preset deleted!', 'success');
        }
    } catch (e) { toast('Failed to delete preset', 'error'); }
}
"""

delete_preset_action_fixed = """
    try {
        const res = await fetch(`/api/presets/${encodeURIComponent(name)}`, { method: 'DELETE' });
        if (res.ok) {
            await loadPresets();
            state.presetName = '';
            state.generate.variables = [];
            renderVariablesGrid();
            debouncedSaveDraft();
            toast('Preset deleted!', 'success');
        }
    } catch (e) { toast('Failed to delete preset', 'error'); }
}
"""

content = content.replace(save_preset_action, save_preset_action_fixed)
content = content.replace(delete_preset_action, delete_preset_action_fixed)

with open('ui/app.js', 'w') as f:
    f.write(content)
