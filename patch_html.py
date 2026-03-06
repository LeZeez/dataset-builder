import re

with open('ui/index.html', 'r') as f:
    content = f.read()

# Add a button to open exported datasets modal in the export tab
export_action_html = """
                                <button id="export-select-none" class="btn btn-sm">Select None</button>
                            </div>
                        </div>
"""
export_action_fixed = """
                                <button id="export-select-none" class="btn btn-sm">Select None</button>
                            </div>
                            <button id="view-exported-datasets-btn" class="btn btn-sm btn-secondary" style="margin-left: auto;">View Exported</button>
                        </div>
"""
content = content.replace(export_action_html, export_action_fixed)

# Add custom filename input
export_summary_html = """
                        <div class="export-summary">
                            <span id="export-file-count">0</span> conversations selected
                        </div>
"""
export_summary_fixed = """
                        <div class="export-summary">
                            <span id="export-file-count">0</span> conversations selected
                        </div>
                        <div class="form-group" style="margin-top: 1rem;">
                            <label for="export-filename">Custom Filename (optional)</label>
                            <input type="text" id="export-filename" class="input" placeholder="e.g. my_dataset.jsonl">
                        </div>
"""
content = content.replace(export_summary_html, export_summary_fixed)

# Add Exported Datasets Modal
modals_html = """
        <!-- Macros Modal -->
"""

exported_datasets_modal = """
        <!-- Exported Datasets Modal -->
        <div id="exported-datasets-modal" class="modal hidden">
            <div class="modal-backdrop"></div>
            <div class="modal-content files-modal-content">
                <div class="export-header">
                    <h3>Exported Datasets</h3>
                    <button id="close-exported-datasets-modal" class="icon-btn" title="Close">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="export-body flex-col">
                    <div class="export-selection flex-1">
                        <div id="exported-datasets-list" class="export-file-list max-h-50vh">
                            <!-- Items populated by JS -->
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Macros Modal -->
"""
content = content.replace(modals_html, exported_datasets_modal)

with open('ui/index.html', 'w') as f:
    f.write(content)
