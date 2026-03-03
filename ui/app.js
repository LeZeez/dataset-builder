/**
 * Synthetic Dataset Generator v3.0
 * Full-featured frontend with IndexedDB, Smart Sync, Prompt Management,
 * Bulk Generation, Review Queue, Search & Filter
 */

// ============ IndexedDB WRAPPER ============
const DB_NAME = 'dataset-builder';
const DB_VERSION = 2;
let _db = null;

function openDB() {
    return new Promise((resolve, reject) => {
        if (_db) return resolve(_db);
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts');
            if (!db.objectStoreNames.contains('reviewQueue')) db.createObjectStore('reviewQueue', { keyPath: 'id', autoIncrement: true });
            if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
        };
        req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
        req.onerror = (e) => reject(e.target.error);
    });
}

async function dbGet(store, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbSet(store, key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function dbGetAll(store) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbGetAllKeys(store) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAllKeys();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbDelete(store, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function dbClear(store) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// For stores with inline keyPath — puts value using its embedded key (no out-of-line key)
async function dbPut(store, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ============ SESSION ID (per-tab isolation) ============
const SESSION_ID = (() => {
    let id = sessionStorage.getItem('dataset-builder-session');
    if (!id) { id = 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2); sessionStorage.setItem('dataset-builder-session', id); }
    return id;
})();

// ============ SYNC ENGINE ============
const syncEngine = {
    status: 'unknown', // 'online', 'offline', 'syncing', 'error'
    lastSync: null,
    pendingChanges: false,
    autoSyncTimer: null,
    listeners: [],
    lastPushHash: null,
    noChangeStreak: 0,
    baseInterval: 30,

    init() {
        window.addEventListener('online', () => this.onConnectionChange(true));
        window.addEventListener('offline', () => this.onConnectionChange(false));
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.pendingChanges) this.push();
        });
        window.addEventListener('beforeunload', () => {
            if (this.pendingChanges) {
                try {
                    const draft = JSON.stringify({ _sessionId: SESSION_ID, _localTime: new Date().toISOString() });
                    navigator.sendBeacon('/api/drafts', new Blob([draft], { type: 'application/json' }));
                } catch (e) { }
            }
        });
        this.checkConnection();
    },

    onConnectionChange(isOnline) {
        if (isOnline) {
            this.setStatus('online');
            if (this.pendingChanges) this.push();
        } else {
            this.setStatus('offline');
        }
    },

    setStatus(s) {
        this.status = s;
        this.listeners.forEach(fn => fn(s));
        updateSyncUI(s);
    },

    onChange(fn) { this.listeners.push(fn); },

    async checkConnection() {
        try {
            const res = await fetch('/api/health', { method: 'GET', cache: 'no-store' });
            if (res.ok) { this.setStatus('online'); return true; }
        } catch (e) { }
        this.setStatus('offline');
        return false;
    },

    _simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
        return hash;
    },

    startAutoSync() {
        this.stopAutoSync();
        this.noChangeStreak = 0;
        const scheduleNext = () => {
            const adaptiveMultiplier = Math.min(Math.pow(2, Math.floor(this.noChangeStreak / 3)), 10);
            const interval = (syncSettings.syncInterval || this.baseInterval) * 1000 * adaptiveMultiplier;
            this.autoSyncTimer = setTimeout(async () => {
                if (!syncSettings.autoSyncEnabled) { scheduleNext(); return; }
                if (this.status === 'syncing') { scheduleNext(); return; }
                if (!navigator.onLine) { scheduleNext(); return; }
                if (document.hidden) { scheduleNext(); return; }
                if (this.pendingChanges) {
                    await this.push();
                    this.noChangeStreak = 0;
                } else {
                    this.noChangeStreak++;
                }
                scheduleNext();
            }, interval);
        };
        scheduleNext();
    },

    stopAutoSync() {
        if (this.autoSyncTimer) { clearTimeout(this.autoSyncTimer); this.autoSyncTimer = null; }
    },

    markDirty() { this.pendingChanges = true; this.noChangeStreak = 0; },

    async push() {
        if (this.status === 'syncing') return;
        this.setStatus('syncing');
        showSaveIndicator('Syncing...');
        try {
            const draft = await buildDraftObject();
            const draftJson = JSON.stringify(draft);
            const hash = this._simpleHash(draftJson);
            if (hash === this.lastPushHash) {
                this.pendingChanges = false;
                this.setStatus('online');
                hideSaveIndicator('Synced ✓');
                return;
            }
            const res = await fetch('/api/drafts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: draftJson
            });
            if (res.ok) {
                const data = await res.json();
                this.lastSync = data.updated;
                this.lastPushHash = hash;
                this.pendingChanges = false;
                this.setStatus('online');
                hideSaveIndicator('Synced ✓');
            } else {
                this.setStatus('error');
                hideSaveIndicator('Sync failed');
            }
        } catch (e) {
            this.setStatus(navigator.onLine ? 'error' : 'offline');
            hideSaveIndicator('Sync failed');
        }
    },

    async pull() {
        try {
            const res = await fetch('/api/drafts');
            if (res.ok) {
                const data = await res.json();
                this.lastSync = data._updated;
                return data;
            }
        } catch (e) { }
        return null;
    }
};

// ============ SYNC SETTINGS ============
let syncSettings = {
    autoSyncEnabled: true,
    syncInterval: 30,
    autoSaveEnabled: true,
    saveInterval: 2000
};

async function loadSyncSettings() {
    try {
        const saved = await dbGet('settings', 'syncSettings');
        if (saved) syncSettings = { ...syncSettings, ...saved };
    } catch (e) { }
    applySyncSettingsToUI();
}

async function saveSyncSettings() {
    const el = (id) => document.getElementById(id);
    syncSettings.autoSyncEnabled = el('auto-sync-enabled')?.checked ?? true;
    syncSettings.syncInterval = parseInt(el('sync-interval')?.value) || 30;
    syncSettings.autoSaveEnabled = el('auto-save-enabled')?.checked ?? true;
    syncSettings.saveInterval = parseInt(el('save-interval')?.value) || 2000;
    await dbSet('settings', 'syncSettings', syncSettings);
    syncEngine.stopAutoSync();
    syncEngine.startAutoSync();
    setupAutoSaveTimer();
}

function applySyncSettingsToUI() {
    const el = (id) => document.getElementById(id);
    if (el('auto-sync-enabled')) el('auto-sync-enabled').checked = syncSettings.autoSyncEnabled;
    if (el('sync-interval')) el('sync-interval').value = syncSettings.syncInterval;
    if (el('auto-save-enabled')) el('auto-save-enabled').checked = syncSettings.autoSaveEnabled;
    if (el('save-interval')) el('save-interval').value = syncSettings.saveInterval;
}

// ============ DEFAULT HOTKEYS ============
const DEFAULT_HOTKEYS = {
    reviewKeep: 's',
    reviewReject: 'x',
    reviewNext: 'j',
    reviewPrev: 'k',
    generate: 'ctrl+g',
    save: 'ctrl+Enter',
    reject: 'ctrl+Backspace'
};
let hotkeys = { ...DEFAULT_HOTKEYS };

async function loadHotkeys() {
    try {
        const saved = await dbGet('settings', 'hotkeys');
        if (saved) hotkeys = { ...DEFAULT_HOTKEYS, ...saved };
    } catch (e) { }
}

async function saveHotkeys() {
    await dbSet('settings', 'hotkeys', hotkeys);
    toast('Hotkeys saved', 'success');
}

function resetHotkeys() {
    hotkeys = { ...DEFAULT_HOTKEYS };
    saveHotkeys();
    applyHotkeysToUI();
    toast('Hotkeys reset to defaults', 'info');
}

function applyHotkeysToUI() {
    document.querySelectorAll('.hotkey-input').forEach(input => {
        const action = input.dataset.action;
        if (action && hotkeys[action]) input.value = hotkeys[action];
    });
}

function matchesHotkey(e, hotkeyStr) {
    const parts = hotkeyStr.toLowerCase().split('+');
    const key = parts.pop();
    const needCtrl = parts.includes('ctrl') || parts.includes('meta');
    const needShift = parts.includes('shift');
    const needAlt = parts.includes('alt');
    if (needCtrl && !(e.ctrlKey || e.metaKey)) return false;
    if (needShift && !e.shiftKey) return false;
    if (needAlt && !e.altKey) return false;
    if (!needCtrl && (e.ctrlKey || e.metaKey)) return false;
    return e.key.toLowerCase() === key || e.key === key;
}

// ============ STATE ============
const state = {
    config: null,
    currentTab: 'generate',
    prompts: [],
    currentPromptName: '',
    generate: {
        prompt: '',
        variables: {},
        variableNames: [],
        conversation: null,
        rawText: '',
        isEditing: false,
        isLoading: false,
        abortController: null
    },
    chat: {
        messages: [],
        isStreaming: false,
        systemPrompt: '',
        abortController: null,
        editingIndex: null
    },
    sidebar: {
        open: false,
        currentFolder: 'wanted',
        files: []
    },
    export: {
        selectedConversations: new Set(),
        selectedIds: new Set(),
        files: [],
        systemPrompt: ''
    },
    review: {
        queue: [],
        currentIndex: 0
    },
    bulk: {
        isRunning: false,
        total: 0,
        completed: 0,
        abortController: null
    },
    tags: [],
    customParams: {}
};

// Throttle utility for streaming updates
let renderThrottleTimer = null;
function throttledRenderChat() {
    if (renderThrottleTimer) return;
    renderThrottleTimer = requestAnimationFrame(() => {
        renderChatMessages();
        renderThrottleTimer = null;
    });
}

// ============ DOM ELEMENTS ============
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let els = {};

// ============ INITIALIZATION ============
async function init() {
    els = {
        // Header
        sidebarToggle: $('#sidebar-toggle'),
        wantedCount: $('#wanted-count'),
        rejectedCount: $('#rejected-count'),
        syncDot: $('#sync-dot'),
        syncLabel: $('#sync-label'),
        syncStatus: $('#sync-status'),
        saveIndicator: $('#save-indicator'),
        saveLabel: $('#save-label'),
        manualSyncBtn: $('#manual-sync-btn'),

        // Sidebar
        sidebar: $('#sidebar'),
        sidebarOverlay: $('#sidebar-overlay'),
        provider: $('#provider'),
        model: $('#model'),
        modelInput: $('#model-input'),
        modelDatalist: $('#model-datalist'),
        refreshModels: $('#refresh-models'),
        temperature: $('#temperature'),
        tempValue: $('#temp-value'),
        apiKey: $('#api-key'),
        toggleKey: $('#toggle-key'),
        saveKey: $('#save-key'),
        baseUrl: $('#base-url'),
        saveUrl: $('#save-url'),
        apiStatus: $('#api-status'),
        searchInput: $('#search-input'),
        fileList: $('#file-list'),

        // Tabs
        tabs: $$('.tab'),
        generateTab: $('#generate-tab'),
        chatTab: $('#chat-tab'),
        reviewTab: $('#review-tab'),
        reviewBadge: $('#review-badge'),

        // Generate Tab - Prompt Manager
        promptSelect: $('#prompt-select'),
        savePromptBtn: $('#save-prompt-btn'),
        newPromptBtn: $('#new-prompt-btn'),
        deletePromptBtn: $('#delete-prompt-btn'),
        refreshPromptBtn: $('#refresh-prompt-btn'),
        systemPrompt: $('#system-prompt'),
        variablesSection: $('#variables-section'),
        variablesGrid: $('#variables-grid'),
        presetSelect: $('#preset-select'),
        savePreset: $('#save-preset'),
        deletePreset: $('#delete-preset'),
        tokenCount: $('#token-count'),
        bulkCount: $('#bulk-count'),
        generateBtn: $('#generate-btn'),
        bulkProgress: $('#bulk-progress'),
        bulkProgressFill: $('#bulk-progress-fill'),
        bulkProgressText: $('#bulk-progress-text'),
        bulkCancel: $('#bulk-cancel'),
        conversationView: $('#conversation-view'),
        conversationEdit: $('#conversation-edit'),
        editToggle: $('#edit-toggle'),
        turnCount: $('#turn-count'),
        tags: $('#tags'),
        tagSuggestions: $('#tag-suggestions'),
        rating: $('#rating'),
        saveBtn: $('#save-btn'),
        rejectBtn: $('#reject-btn'),
        regenerateBtn: $('#regenerate-btn'),

        // Chat Tab
        chatMessages: $('#chat-messages'),
        chatInput: $('#chat-input'),
        sendBtn: $('#send-btn'),
        chatTurns: $('#chat-turns'),
        clearChat: $('#clear-chat'),
        saveChatBtn: $('#save-chat-btn'),
        forkChatBtn: $('#fork-chat-btn'),
        chatSystemPrompt: $('#chat-system-prompt'),
        chatPresetSelect: $('#chat-preset-select'),
        saveChatPreset: $('#save-chat-preset'),
        deleteChatPreset: $('#delete-chat-preset'),

        // Review Tab
        reviewConversation: $('#review-conversation'),
        reviewCount: $('#review-count'),
        reviewPosition: $('#review-position'),
        reviewPrev: $('#review-prev'),
        reviewNext: $('#review-next'),
        reviewKeepBtn: $('#review-keep-btn'),
        reviewRejectBtn: $('#review-reject-btn'),
        reviewEditBtn: $('#review-edit-btn'),
        keepAllBtn: $('#keep-all-btn'),
        rejectAllBtn: $('#reject-all-btn'),
        clearQueueBtn: $('#clear-queue-btn'),

        // Modals
        rejectModal: $('#reject-modal'),
        cancelReject: $('#cancel-reject'),
        exportModal: $('#export-modal'),
        exportFormat: $('#export-format'),
        exportPromptSource: $('#export-prompt-source'),
        exportCustomPromptGroup: $('#export-custom-prompt-group'),
        exportSystemPrompt: $('#export-system-prompt'),
        saveExportPrompt: $('#save-export-prompt'),
        exportFileCount: $('#export-file-count'),
        exportFileList: $('#export-file-list'),
        exportSelectAll: $('#export-select-all'),
        exportSelectNone: $('#export-select-none'),
        closeExport: $('#close-export'),
        confirmExport: $('#confirm-export'),
        cancelExport: $('#cancel-export'),

        // Toast
        toastContainer: $('#toast-container'),

        // Clear & Search toggle
        clearGenBtn: $('#clear-gen-btn'),
        searchToggle: $('#search-toggle'),
        searchBox: $('#search-box'),

        // Custom Parameters
        customParamsList: $('#custom-params-list'),
        newParamKey: $('#new-param-key'),
        newParamValue: $('#new-param-value'),
        addParamBtn: $('#add-param-btn')
    };

    // Initialize sync engine
    syncEngine.init();
    await loadSyncSettings();
    await loadHotkeys();

    // Load data
    await loadConfig();
    await loadPrompts();
    await loadStats();
    await loadModels();
    await loadPresets();
    await loadChatPresets();
    await loadTags();
    await loadFiles();
    await restoreDraft();
    await loadReviewQueue();

    setupEventListeners();
    applyHotkeysToUI();
    setupAutoSaveTimer();
    syncEngine.startAutoSync();
}

// ============ SYNC UI ============
function updateSyncUI(status) {
    if (!els.syncDot || !els.syncLabel) return;
    els.syncDot.className = 'sync-dot ' + status;
    const labels = { online: 'Online', offline: 'Offline', syncing: 'Syncing...', error: 'Error', unknown: '...' };
    els.syncLabel.textContent = labels[status] || status;
}

function showSaveIndicator(text) {
    if (!els.saveIndicator) return;
    els.saveIndicator.classList.remove('hidden');
    if (els.saveLabel) els.saveLabel.textContent = text || 'Saving...';
}

function hideSaveIndicator(text) {
    if (!els.saveLabel) return;
    els.saveLabel.textContent = text || 'Saved';
    setTimeout(() => { if (els.saveIndicator) els.saveIndicator.classList.add('hidden'); }, 1500);
}

// ============ CONFIG ============
async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        if (res.ok) {
            state.config = await res.json();
            els.provider.value = state.config.api?.provider || 'openai';
            const model = state.config.api?.model || 'gpt-4o';
            els.modelInput.value = model;
            els.model.value = model;
            els.temperature.value = state.config.api?.temperature || 0.9;
            els.tempValue.textContent = els.temperature.value;
            updateProviderUI();
        }
    } catch (e) { console.error('Failed to load config:', e); }
}

function updateProviderUI() {
    const provider = els.provider.value;
    const providerConfig = state.config?.providers?.[provider] || {};
    els.apiKey.value = providerConfig.api_key || '';
    els.baseUrl.value = providerConfig.base_url || '';
}

// ============ MODELS ============
async function loadModels() {
    const provider = els.provider.value;
    try {
        const res = await fetch(`/api/models?provider=${provider}`);
        if (res.ok) {
            const data = await res.json();
            if (data.error) console.warn('Model fetch warning:', data.error);
            populateModelSelect(data.models, data.history);
        }
    } catch (e) { console.error('Failed to load models:', e); }
}

function populateModelSelect(models, history) {
    const current = els.modelInput?.value || els.model.value;
    const defaultModel = state.config?.api?.model;
    els.model.innerHTML = '';
    if (els.modelDatalist) els.modelDatalist.innerHTML = '';

    const allModels = [];

    if (history && history.length > 0) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = '⭐ Recent';
        history.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m; opt.textContent = m;
            optgroup.appendChild(opt);
            allModels.push(m);
        });
        els.model.appendChild(optgroup);
    }

    if (models && models.length > 0) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = 'All Models';
        models.forEach(m => {
            if (!history?.includes(m)) {
                const opt = document.createElement('option');
                opt.value = m; opt.textContent = m;
                optgroup.appendChild(opt);
                allModels.push(m);
            }
        });
        els.model.appendChild(optgroup);
    }

    // Populate datalist for the text input
    if (els.modelDatalist) {
        allModels.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            els.modelDatalist.appendChild(opt);
        });
    }

    const preferredModel = current || defaultModel;
    if (preferredModel) {
        if (els.modelInput) els.modelInput.value = preferredModel;
        if ([...els.model.options].some(o => o.value === preferredModel)) {
            els.model.value = preferredModel;
        }
    }
}

function getModelValue() {
    return els.modelInput?.value?.trim() || els.model.value || 'gpt-4o';
}

async function refreshModels() {
    els.refreshModels.classList.add('spinning');
    await loadModels();
    setTimeout(() => els.refreshModels.classList.remove('spinning'), 500);
}

// ============ PROMPT MANAGEMENT ============
async function loadPrompts() {
    try {
        const res = await fetch('/api/prompts');
        if (res.ok) {
            const data = await res.json();
            state.prompts = data.prompts || [];
            renderPromptSelect();
        }
    } catch (e) { console.error('Failed to load prompts:', e); }
}

function renderPromptSelect() {
    if (!els.promptSelect) return;
    els.promptSelect.innerHTML = '<option value="">Select prompt...</option>';
    state.prompts.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name + (p.variables?.length ? ` (${p.variables.join(', ')})` : '');
        els.promptSelect.appendChild(opt);
    });
    if (state.currentPromptName) els.promptSelect.value = state.currentPromptName;
}

function selectPrompt() {
    const name = els.promptSelect.value;
    if (!name) return;
    const prompt = state.prompts.find(p => p.name === name);
    if (prompt) {
        state.currentPromptName = name;
        els.systemPrompt.value = prompt.content;
        state.generate.prompt = prompt.content;
        extractVariables();
        debouncedSaveDraft();
    }
}

async function refreshPrompt() {
    const name = state.currentPromptName;
    if (!name) { toast('No prompt selected to refresh', 'error'); return; }
    try {
        await loadPrompts();
        const prompt = state.prompts.find(p => p.name === name);
        if (prompt) {
            els.systemPrompt.value = prompt.content;
            state.generate.prompt = prompt.content;
            extractVariables();
            toast(`Prompt "${name}" reloaded`, 'success');
        } else {
            toast(`Prompt "${name}" no longer exists on server`, 'error');
        }
    } catch (e) { toast('Failed to refresh prompt', 'error'); }
}

async function savePrompt() {
    let name = state.currentPromptName;
    if (!name) {
        name = prompt('Prompt template name:');
        if (!name) return;
    }
    const content = els.systemPrompt.value;
    try {
        const res = await fetch('/api/prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, content })
        });
        if (res.ok) {
            state.currentPromptName = name;
            await loadPrompts();
            toast('Prompt saved!', 'success');
        }
    } catch (e) { toast('Failed to save prompt', 'error'); }
}

async function newPrompt() {
    const name = prompt('New prompt template name:');
    if (!name) return;
    state.currentPromptName = name;
    els.systemPrompt.value = '';
    state.generate.prompt = '';
    extractVariables();
    els.promptSelect.value = '';
}

async function deletePrompt() {
    const name = state.currentPromptName || els.promptSelect.value;
    if (!name) { toast('Select a prompt to delete', 'info'); return; }
    if (!confirm(`Delete prompt "${name}"?`)) return;
    try {
        const res = await fetch(`/api/prompts/${encodeURIComponent(name)}`, { method: 'DELETE' });
        if (res.ok) {
            state.currentPromptName = '';
            els.systemPrompt.value = '';
            await loadPrompts();
            toast('Prompt deleted', 'success');
        }
    } catch (e) { toast('Failed to delete', 'error'); }
}

// ============ VARIABLES & PRESETS ============
function extractVariables() {
    const text = els.systemPrompt.value;
    const regex = /\{\{(\w+)\}\}/g;
    const matches = [...text.matchAll(regex)];
    const names = [...new Set(matches.map(m => m[1]))];
    state.generate.variableNames = names;
    if (names.length > 0) {
        els.variablesSection.classList.remove('hidden');
        renderVariableInputs(names);
    } else {
        els.variablesSection.classList.add('hidden');
    }
    updateTokenCount();
}

function renderVariableInputs(names) {
    els.variablesGrid.innerHTML = names.map(name => `
        <div class="form-group">
            <label for="var-${name}">${name}</label>
            <input type="text" id="var-${name}" class="input var-input"
                   data-var="${name}"
                   value="${state.generate.variables[name] || ''}"
                   placeholder="${name}...">
        </div>
    `).join('');
    $$('.var-input').forEach(input => {
        input.addEventListener('input', (e) => {
            state.generate.variables[e.target.dataset.var] = e.target.value;
            updateTokenCount();
            debouncedSaveDraft();
        });
    });
}

function applyVariables(text) {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => state.generate.variables[key] || `{{${key}}}`);
}

async function loadPresets() {
    try {
        const res = await fetch('/api/presets');
        if (res.ok) {
            const data = await res.json();
            renderPresetSelect(data.presets);
        }
    } catch (e) { console.error('Failed to load presets:', e); }
}

function renderPresetSelect(presets) {
    els.presetSelect.innerHTML = '<option value="">Load preset...</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name; opt.textContent = p.name;
        opt.dataset.values = JSON.stringify(p.values);
        els.presetSelect.appendChild(opt);
    });
}

function loadPresetAction() {
    const selected = els.presetSelect.selectedOptions[0];
    if (selected && selected.dataset.values) {
        const values = JSON.parse(selected.dataset.values);
        state.generate.variables = values;
        renderVariableInputs(state.generate.variableNames);
    }
}

async function savePresetAction() {
    const name = prompt('Preset name:');
    if (!name) return;
    try {
        const res = await fetch('/api/presets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, values: state.generate.variables })
        });
        if (res.ok) {
            const data = await res.json();
            renderPresetSelect(data.presets);
            toast('Preset saved!', 'success');
        }
    } catch (e) { toast('Failed to save preset', 'error'); }
}

async function deletePresetAction() {
    const name = els.presetSelect.value;
    if (!name) { toast('Select a preset to delete', 'info'); return; }
    if (!confirm(`Delete preset "${name}"?`)) return;
    try {
        const res = await fetch(`/api/presets/${encodeURIComponent(name)}`, { method: 'DELETE' });
        if (res.ok) { await loadPresets(); toast('Preset deleted!', 'success'); }
        else toast('Failed to delete preset', 'error');
    } catch (e) { toast('Failed to delete preset', 'error'); }
}

// ============ CUSTOM PARAMETERS ============
function renderCustomParams() {
    if (!els.customParamsList) return;
    const params = state.customParams || {};
    const keys = Object.keys(params);
    if (keys.length === 0) {
        els.customParamsList.innerHTML = '<div class="empty-params">No custom parameters</div>';
        return;
    }
    els.customParamsList.innerHTML = keys.map(key => `
        <div class="custom-param-item" data-key="${escapeHtml(key)}">
            <span class="param-key">${escapeHtml(key)}</span>
            <span class="param-value" data-key="${escapeHtml(key)}" title="Click to edit">${escapeHtml(String(params[key]))}</span>
            <button class="icon-btn param-remove" data-key="${escapeHtml(key)}" title="Remove">✕</button>
        </div>
    `).join('');
    els.customParamsList.querySelectorAll('.param-remove').forEach(btn => {
        btn.addEventListener('click', () => removeCustomParam(btn.dataset.key));
    });
    els.customParamsList.querySelectorAll('.param-value').forEach(span => {
        span.addEventListener('click', () => startEditParam(span.dataset.key, span));
    });
}

function startEditParam(key, span) {
    const currentVal = String(state.customParams[key] || '');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'param-value-input';
    input.value = currentVal;
    span.replaceWith(input);
    input.focus();
    input.select();
    const finish = () => {
        state.customParams[key] = input.value;
        debouncedSaveDraft();
        renderCustomParams();
    };
    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(); }
        if (e.key === 'Escape') { renderCustomParams(); }
    });
}

function addCustomParam() {
    const key = els.newParamKey?.value?.trim();
    const value = els.newParamValue?.value?.trim();
    if (!key) { toast('Parameter key is required', 'info'); return; }
    state.customParams[key] = value || '';
    if (els.newParamKey) els.newParamKey.value = '';
    if (els.newParamValue) els.newParamValue.value = '';
    renderCustomParams();
    debouncedSaveDraft();
}

function removeCustomParam(key) {
    delete state.customParams[key];
    renderCustomParams();
    debouncedSaveDraft();
}

// ============ CHAT PRESETS ============
async function loadChatPresets() {
    try {
        const res = await fetch('/api/chat-presets');
        if (res.ok) {
            const data = await res.json();
            renderChatPresetSelect(data.presets || []);
        }
    } catch (e) { console.error('Failed to load chat presets:', e); }
}

function renderChatPresetSelect(presets) {
    if (!els.chatPresetSelect) return;
    els.chatPresetSelect.innerHTML = '<option value="">Load preset...</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name; opt.textContent = p.name;
        opt.dataset.prompt = p.prompt;
        els.chatPresetSelect.appendChild(opt);
    });
}

function loadChatPreset() {
    const selected = els.chatPresetSelect.selectedOptions[0];
    if (selected && selected.dataset.prompt) {
        els.chatSystemPrompt.value = selected.dataset.prompt;
        state.chat.systemPrompt = selected.dataset.prompt;
        debouncedSaveDraft();
        toast('Preset loaded!', 'success');
    }
}

async function saveChatPreset() {
    const name = prompt('Preset name:');
    if (!name) return;
    const promptText = els.chatSystemPrompt?.value || '';
    try {
        const res = await fetch('/api/chat-presets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, prompt: promptText })
        });
        if (res.ok) {
            const data = await res.json();
            renderChatPresetSelect(data.presets || []);
            toast('Chat preset saved!', 'success');
        }
    } catch (e) { toast('Failed to save preset', 'error'); }
}

async function deleteChatPreset() {
    const selected = els.chatPresetSelect?.value;
    if (!selected) { toast('Select a preset to delete', 'info'); return; }
    if (!confirm(`Delete preset "${selected}"?`)) return;
    try {
        const res = await fetch(`/api/chat-presets/${encodeURIComponent(selected)}`, { method: 'DELETE' });
        if (res.ok) { await loadChatPresets(); toast('Preset deleted!', 'success'); }
    } catch (e) { toast('Failed to delete preset', 'error'); }
}

// ============ TAGS ============
async function loadTags() {
    try {
        const res = await fetch('/api/tags');
        if (res.ok) {
            const data = await res.json();
            state.tags = data.tags || [];
            renderTagSuggestions();
        }
    } catch (e) { }
}

function renderTagSuggestions() {
    if (!els.tagSuggestions) return;
    els.tagSuggestions.innerHTML = '';
    state.tags.forEach(tag => {
        const opt = document.createElement('option');
        opt.value = tag;
        els.tagSuggestions.appendChild(opt);
    });
}

// ============ TOKEN COUNT ============
function updateTokenCount() {
    const p = applyVariables(els.systemPrompt.value);
    const tokens = Math.ceil(p.length / 2);
    els.tokenCount.textContent = `~${tokens} tokens`;
}

// ============ STATS ============
async function loadStats() {
    try {
        const res = await fetch('/api/stats');
        if (res.ok) {
            const data = await res.json();
            els.wantedCount.textContent = data.wanted || 0;
            els.rejectedCount.textContent = data.rejected || 0;
        }
    } catch (e) { console.error('Failed to load stats:', e); }
}

// ============ FILES (SEARCH & FILTER) ============
async function loadFiles(folder = 'wanted') {
    state.sidebar.currentFolder = folder;
    const search = els.searchInput?.value?.trim() || '';
    try {
        let url = `/api/conversations?folder=${folder}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            state.sidebar.files = Array.isArray(data) ? data : (data.conversations || []);
            renderFileList();
        }
    } catch (e) { console.error('Failed to load files:', e); }
}

function renderFileList() {
    els.fileList.innerHTML = '';
    if (state.sidebar.files.length === 0) {
        els.fileList.innerHTML = '<div class="empty-files">No conversations yet</div>';
        return;
    }
    state.sidebar.files.forEach(f => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.dataset.id = f.id;
        const isSelected = state.export.selectedConversations?.has(f.id) || false;
        const isRejected = state.sidebar.currentFolder === 'rejected';
        item.innerHTML = `
            <div class="file-checkbox">
                <input type="checkbox" class="select-file" ${isSelected ? 'checked' : ''}>
            </div>
            <div class="file-content">
                <div class="file-preview">${escapeHtml(f.preview || '...')}</div>
                <div class="file-meta">${formatDate(f.created_at)}${f.turns ? ` • ${f.turns} msgs` : ''}</div>
            </div>
            <div class="file-actions">
                ${!isRejected ? '<button class="icon-btn reject-file" title="Reject">❌</button>' : ''}
                ${isRejected ? '<button class="icon-btn restore-file" title="Restore">♻️</button>' : ''}
                <button class="icon-btn delete-file" title="Delete permanently">🗑️</button>
            </div>
        `;
        item.addEventListener('click', (e) => {
            if (!e.target.closest('.select-file') && !e.target.closest('.file-actions'))
                loadConversation(f.id);
        });
        const checkbox = item.querySelector('.select-file');
        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            if (checkbox.checked) state.export.selectedConversations.add(f.id);
            else state.export.selectedConversations.delete(f.id);
        });
        const rejectBtn = item.querySelector('.reject-file');
        if (rejectBtn) rejectBtn.addEventListener('click', (e) => { e.stopPropagation(); moveConversation(f.id, 'rejected'); });
        const restoreBtn = item.querySelector('.restore-file');
        if (restoreBtn) restoreBtn.addEventListener('click', (e) => { e.stopPropagation(); restoreConversation(f.id); });
        item.querySelector('.delete-file').addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Permanently delete this conversation? This cannot be undone.'))
                deleteConversation(f.id);
        });
        els.fileList.appendChild(item);
    });
}

async function loadConversation(id) {
    try {
        const res = await fetch(`/api/conversation/${id}?folder=${state.sidebar.currentFolder}`);
        if (res.ok) {
            const conv = await res.json();
            state.generate.conversation = conv;
            state.generate.rawText = conversationToRaw(conv.conversations);
            renderConversation(conv.conversations);
            enableActionButtons();
            switchTab('generate');
            if (window.innerWidth < 1024) toggleSidebar();
        }
    } catch (e) { toast('Failed to load conversation', 'error'); }
}

function conversationToRaw(messages) {
    return messages.map(m => `${m.from === 'human' ? 'user' : 'gpt'}: ${m.value}`).join('\n---\n');
}

async function moveConversation(id, targetFolder) {
    try {
        const res = await fetch(`/api/conversation/${id}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: state.sidebar.currentFolder, to: targetFolder })
        });
        if (res.ok) { toast(`Moved to ${targetFolder}`, 'success'); loadFiles(state.sidebar.currentFolder); loadStats(); }
        else toast('Failed to move', 'error');
    } catch (e) { toast('Failed to move', 'error'); }
}

async function restoreConversation(id) { await moveConversation(id, 'wanted'); }

async function deleteConversation(id) {
    try {
        const res = await fetch(`/api/conversation/${id}?folder=${state.sidebar.currentFolder}`, { method: 'DELETE' });
        if (res.ok) { toast('Permanently deleted', 'success'); loadFiles(state.sidebar.currentFolder); loadStats(); }
        else { const err = await res.json(); toast(err.error || 'Failed to delete', 'error'); }
    } catch (e) { toast('Failed to delete', 'error'); }
}

// ============ GENERATION (Single & Bulk) ============
async function generate() {
    const count = parseInt(els.bulkCount?.value) || 1;
    if (count > 1) { await bulkGenerate(count); return; }

    if (state.generate.isLoading) {
        if (state.generate.abortController) { state.generate.abortController.abort(); state.generate.abortController = null; toast('Generation stopped', 'info'); }
        return;
    }
    state.generate.isLoading = true;
    state.generate.abortController = new AbortController();
    els.generateBtn.classList.add('btn-danger');
    els.generateBtn.classList.remove('btn-primary');
    els.generateBtn.querySelector('.btn-text').textContent = '⏹ Stop';

    const promptText = applyVariables(els.systemPrompt.value);
    try {
        const response = await fetch('/api/generate/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: promptText,
                provider: els.provider.value,
                model: getModelValue(),
                temperature: parseFloat(els.temperature.value),
                custom_params: state.customParams
            }),
            signal: state.generate.abortController.signal
        });
        if (!response.ok) throw new Error('Generation failed');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let thinkingShown = true;
        els.conversationView.innerHTML = '<div class="thinking-indicator"><div class="thinking-dots"><span></span><span></span><span></span></div> Thinking...</div><div class="streaming-text" style="display:none;"></div>';
        const thinkingEl = els.conversationView.querySelector('.thinking-indicator');
        const streamingEl = els.conversationView.querySelector('.streaming-text');

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            for (const line of chunk.split('\n')) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.content) {
                            if (thinkingShown) { thinkingEl.style.display = 'none'; streamingEl.style.display = ''; thinkingShown = false; }
                            fullText += data.content; streamingEl.textContent = fullText;
                        }
                        if (data.error) throw new Error(data.error);
                    } catch (e) { if (e.message && !e.message.includes('JSON')) throw e; }
                }
            }
        }

        state.generate.rawText = fullText;
        els.conversationEdit.value = fullText;
        parseAndRender();
        enableActionButtons();
        addModelToHistory();
    } catch (e) {
        if (e.name !== 'AbortError') toast(e.message || 'Generation failed', 'error');
    } finally {
        state.generate.isLoading = false;
        state.generate.abortController = null;
        els.generateBtn.disabled = false;
        els.generateBtn.classList.remove('btn-danger');
        els.generateBtn.classList.add('btn-primary');
        els.generateBtn.querySelector('.btn-text').textContent = '🎲 Generate';
    }
}

async function bulkGenerate(count) {
    if (state.bulk.isRunning) {
        if (state.bulk.abortController) { state.bulk.abortController.abort(); }
        return;
    }
    state.bulk.isRunning = true;
    state.bulk.total = count;
    state.bulk.completed = 0;
    state.bulk.abortController = new AbortController();

    els.bulkProgress.classList.remove('hidden');
    updateBulkProgress();

    const promptText = applyVariables(els.systemPrompt.value);

    for (let i = 0; i < count; i++) {
        if (state.bulk.abortController.signal.aborted) break;
        try {
            const res = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: promptText,
                    provider: els.provider.value,
                    model: getModelValue(),
                    temperature: parseFloat(els.temperature.value),
                    custom_params: state.customParams
                }),
                signal: state.bulk.abortController.signal
            });
            if (res.ok) {
                const data = await res.json();
                const parsed = parseMinimalFormat(data.content);
                if (parsed.length > 0) {
                    await addToReviewQueue({
                        conversations: parsed,
                        rawText: data.content,
                        metadata: { model: getModelValue(), prompt: state.currentPromptName, variables: { ...state.generate.variables } }
                    });
                }
            }
        } catch (e) {
            if (e.name === 'AbortError') break;
            console.error('Bulk gen error:', e);
        }
        state.bulk.completed++;
        updateBulkProgress();
    }

    state.bulk.isRunning = false;
    state.bulk.abortController = null;
    els.bulkProgress.classList.add('hidden');
    addModelToHistory();
    toast(`Generated ${state.bulk.completed}/${count} conversations`, 'success');
    updateReviewBadge();
    if (state.bulk.completed > 0) switchTab('review');
}

function updateBulkProgress() {
    const pct = state.bulk.total > 0 ? (state.bulk.completed / state.bulk.total * 100) : 0;
    if (els.bulkProgressFill) els.bulkProgressFill.style.width = pct + '%';
    if (els.bulkProgressText) els.bulkProgressText.textContent = `${state.bulk.completed}/${state.bulk.total}`;
}

async function addModelToHistory() {
    try {
        await fetch('/api/models/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: els.provider.value, model: getModelValue() })
        });
    } catch (e) { }
}

function parseAndRender() {
    // Force parse from edit buffer if editing
    if (state.generate.isEditing) {
        state.generate.rawText = els.conversationEdit.value;
    }
    const parsed = parseMinimalFormat(state.generate.rawText);
    state.generate.conversation = { conversations: parsed };
    renderConversation(parsed);
    updateTurnCount(parsed.length);
}

function parseMinimalFormat(text) {
    const blocks = text.split(/^---\s*$/m);
    const conversations = [];
    for (const block of blocks) {
        const trimmed = block.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^(user|gpt):\s*([\s\S]*)/);
        if (match) {
            conversations.push({ from: match[1] === 'user' ? 'human' : 'gpt', value: match[2].trim() });
        }
    }
    return conversations;
}

function renderConversation(messages) {
    if (!messages || messages.length === 0) {
        els.conversationView.innerHTML = `<div class="empty-state"><div class="empty-icon">💭</div><p>Click "Generate" to create a conversation</p></div>`;
        return;
    }
    els.conversationView.innerHTML = messages.map(m => `
        <div class="bubble ${m.from}">
            <span class="role-label">${m.from === 'human' ? 'USER' : 'GPT'}</span>
            ${escapeHtml(m.value)}
        </div>
    `).join('');
    els.conversationView.scrollTop = els.conversationView.scrollHeight;
}

function updateTurnCount(count) { els.turnCount.textContent = `${count} turns`; }


// ============ SAVE/REJECT ============
async function saveConversation(folder, reason = null) {
    // Force parse from current state
    if (state.generate.isEditing) {
        state.generate.rawText = els.conversationEdit.value;
        parseAndRender();
    }
    if (!state.generate.conversation?.conversations?.length) return;

    showSaveIndicator('Saving...');
    const metadata = {
        tags: els.tags.value.split(',').map(t => t.trim()).filter(Boolean),
        rating: els.rating.value ? parseInt(els.rating.value) : null,
        model: getModelValue(),
        variables: state.generate.variables
    };
    if (reason) metadata.reject_reason = reason;

    try {
        const res = await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversation: state.generate.conversation, folder, metadata })
        });
        if (res.ok) {
            toast(`Saved to ${folder}!`, 'success');
            hideSaveIndicator('Saved ✓');
            resetGenerateTab();
            loadStats();
            loadFiles(state.sidebar.currentFolder);
            loadTags();
        } else {
            toast('Failed to save', 'error');
            hideSaveIndicator('Save failed');
        }
    } catch (e) { toast('Failed to save', 'error'); hideSaveIndicator('Save failed'); }
}

function showRejectModal() { els.rejectModal.classList.remove('hidden'); }
function hideRejectModal() { els.rejectModal.classList.add('hidden'); }

function resetGenerateTab() {
    state.generate.conversation = null;
    state.generate.rawText = '';
    els.conversationEdit.value = '';
    els.tags.value = '';
    els.rating.value = '';
    renderConversation([]);
    disableActionButtons();
}

function enableActionButtons() { els.saveBtn.disabled = false; els.rejectBtn.disabled = false; els.regenerateBtn.disabled = false; }
function disableActionButtons() { els.saveBtn.disabled = true; els.rejectBtn.disabled = true; els.regenerateBtn.disabled = true; }

// ============ EDIT MODE ============
function toggleEditMode() {
    state.generate.isEditing = !state.generate.isEditing;
    if (state.generate.isEditing) {
        els.conversationView.classList.add('hidden');
        els.conversationEdit.classList.remove('hidden');
        els.conversationEdit.value = state.generate.rawText;
        els.editToggle.textContent = '👁️ View';
    } else {
        els.conversationView.classList.remove('hidden');
        els.conversationEdit.classList.add('hidden');
        state.generate.rawText = els.conversationEdit.value;
        parseAndRender();
        els.editToggle.textContent = '✏️ Edit';
    }
}

// ============ CHAT TAB ============
async function sendChatMessage() {
    if (state.chat.isStreaming) {
        if (state.chat.abortController) { state.chat.abortController.abort(); state.chat.abortController = null; toast('Chat stopped', 'info'); }
        return;
    }
    const message = els.chatInput.value.trim();
    if (!message) {
        if (state.chat.messages.length > 0 && state.chat.messages[state.chat.messages.length - 1].from === 'human') {
            await generateAIResponse();
        }
        return;
    }
    state.chat.messages.push({ from: 'human', value: message, timestamp: new Date().toISOString() });
    debouncedSaveDraft();
    els.chatInput.value = '';
    renderChatMessages();

    state.chat.isStreaming = true;
    state.chat.abortController = new AbortController();
    els.sendBtn.disabled = false;
    els.sendBtn.classList.add('btn-danger');
    els.sendBtn.classList.remove('btn-primary');
    els.sendBtn.innerHTML = '⏹ Stop';

    const context = state.chat.messages.map(m => `${m.from === 'human' ? 'User' : 'Assistant'}: ${m.value}`).join('\n');
    const baseSystemPrompt = els.chatSystemPrompt?.value || 'You are a helpful and friendly conversational assistant. Keep responses natural and engaging.';
    const systemPrompt = `${baseSystemPrompt}\n\nPrevious conversation:\n${context}\n\nContinue the conversation naturally.`;

    const streamingMsg = { from: 'gpt', value: '', timestamp: new Date().toISOString(), streaming: true };

    try {
        const response = await fetch('/api/generate/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: message, system_prompt: systemPrompt,
                provider: els.provider.value, model: getModelValue(),
                temperature: parseFloat(els.temperature.value),
                custom_params: state.customParams
            }),
            signal: state.chat.abortController.signal
        });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        state.chat.messages.push(streamingMsg);
        renderChatMessages();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            for (const line of chunk.split('\n')) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.error) { toast(data.error, 'error'); break; }
                        if (data.done) break;
                        if (data.content) { fullText += data.content; streamingMsg.value = fullText; throttledRenderChat(); }
                    } catch (e) { }
                }
            }
        }
        streamingMsg.streaming = false;
        renderChatMessages();
        updateChatTurns();
        enableChatButtons();
    } catch (e) {
        if (e.name !== 'AbortError') {
            toast('Failed to send message', 'error');
            const idx = state.chat.messages.indexOf(streamingMsg);
            if (idx > -1) state.chat.messages.splice(idx, 1);
        } else {
            streamingMsg.streaming = false;
            if (!streamingMsg.value) { const idx = state.chat.messages.indexOf(streamingMsg); if (idx > -1) state.chat.messages.splice(idx, 1); }
        }
        renderChatMessages();
    } finally {
        state.chat.isStreaming = false;
        state.chat.abortController = null;
        streamingMsg.streaming = false;
        renderChatMessages();
        els.sendBtn.classList.remove('btn-danger');
        els.sendBtn.classList.add('btn-primary');
        els.sendBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>';
        debouncedSaveDraft();
    }
}

function renderChatMessages() {
    if (state.chat.messages.length === 0) {
        els.chatMessages.innerHTML = `<div class="empty-state"><div class="empty-icon">🗣️</div><p>Start a conversation by typing below</p></div>`;
        return;
    }
    els.chatMessages.innerHTML = state.chat.messages.map((m, i) => {
        const isEditing = state.chat.editingIndex === i;
        const isStreaming = m.streaming;
        if (isEditing) {
            return `<div class="bubble ${m.from} editing" data-index="${i}">
                <span class="role-label">${m.from === 'human' ? 'YOU' : 'GPT'} (editing)</span>
                <textarea class="edit-textarea" id="edit-msg-${i}">${escapeHtml(m.value)}</textarea>
                <div class="bubble-actions">
                    <button class="bubble-btn save" onclick="saveEditMessage(${i})">✓ Save</button>
                    <button class="bubble-btn cancel" onclick="cancelEditMessage()">✕ Cancel</button>
                </div>
            </div>`;
        }
        return `<div class="bubble ${m.from}" data-index="${i}">
            <span class="role-label">${m.from === 'human' ? 'YOU' : 'GPT'}${isStreaming ? ' (typing...)' : ''}</span>
            <div class="bubble-content">${escapeHtml(m.value)}</div>
            ${!isStreaming ? `<div class="bubble-actions">
                <button class="bubble-btn edit" onclick="startEditMessage(${i})" title="Edit">✏️</button>
                <button class="bubble-btn delete" onclick="deleteMessage(${i})" title="Delete">🗑️</button>
                ${m.from === 'gpt' ? `<button class="bubble-btn regen" onclick="regenerateFrom(${i})" title="Regenerate">🔄</button>` : ''}
                ${m.from === 'human' ? `<button class="bubble-btn continue" onclick="continueFromMessage(${i})" title="Continue from here">▶️</button>` : ''}
            </div>` : ''}
        </div>`;
    }).join('');
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function startEditMessage(index) {
    state.chat.editingIndex = index;
    renderChatMessages();
    setTimeout(() => { const ta = document.getElementById(`edit-msg-${index}`); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 50);
}

function saveEditMessage(index) {
    const ta = document.getElementById(`edit-msg-${index}`);
    if (ta && ta.value.trim()) state.chat.messages[index].value = ta.value.trim();
    state.chat.editingIndex = null;
    renderChatMessages();
    updateChatTurns();
    debouncedSaveDraft();
}

function cancelEditMessage() { state.chat.editingIndex = null; renderChatMessages(); }

function deleteMessage(index) {
    if (confirm('Delete this message?')) {
        state.chat.messages.splice(index, 1);
        renderChatMessages();
        updateChatTurns();
        debouncedSaveDraft();
    }
}

async function continueFromMessage(index) {
    state.chat.messages = state.chat.messages.slice(0, index + 1);
    renderChatMessages();
    updateChatTurns();
    await generateAIResponse();
}

function updateChatTurns() {
    const turns = Math.floor(state.chat.messages.length / 2);
    els.chatTurns.textContent = `${turns} turns`;
}

function clearChat() {
    if (confirm('Clear all messages?')) {
        state.chat.messages = [];
        renderChatMessages();
        updateChatTurns();
        disableChatButtons();
        debouncedSaveDraft();
    }
}

async function saveChat() {
    if (state.chat.messages.length < 2) return;
    showSaveIndicator('Saving chat...');
    const conversation = { conversations: state.chat.messages.map(m => ({ from: m.from, value: m.value })) };
    try {
        const res = await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversation, folder: 'wanted', metadata: { source: 'chat', model: getModelValue() } })
        });
        if (res.ok) { toast('Chat saved!', 'success'); hideSaveIndicator('Saved ✓'); clearChat(); loadStats(); }
    } catch (e) { toast('Failed to save chat', 'error'); hideSaveIndicator('Save failed'); }
}

function forkChat() {
    const index = prompt('Fork from message # (1-' + state.chat.messages.length + '):');
    if (index) {
        const idx = parseInt(index) - 1;
        if (idx >= 0 && idx < state.chat.messages.length) {
            state.chat.messages = state.chat.messages.slice(0, idx + 1);
            renderChatMessages();
            updateChatTurns();
        }
    }
}

async function regenerateFrom(index) {
    state.chat.messages = state.chat.messages.slice(0, index);
    renderChatMessages();
    updateChatTurns();
    await generateAIResponse();
}

async function generateAIResponse() {
    if (state.chat.isStreaming) {
        if (state.chat.abortController) { state.chat.abortController.abort(); state.chat.abortController = null; }
        return;
    }
    if (state.chat.messages.length === 0) { toast('No context to regenerate from', 'info'); return; }

    state.chat.isStreaming = true;
    state.chat.abortController = new AbortController();
    els.sendBtn.disabled = false;
    els.sendBtn.classList.add('btn-danger');
    els.sendBtn.classList.remove('btn-primary');
    els.sendBtn.innerHTML = '⏹ Stop';

    const context = state.chat.messages.map(m => `${m.from === 'human' ? 'User' : 'Assistant'}: ${m.value}`).join('\n');
    const baseSystemPrompt = els.chatSystemPrompt?.value || 'You are a helpful and friendly conversational assistant. Keep responses natural and engaging.';
    const systemPrompt = `${baseSystemPrompt}\n\nPrevious conversation:\n${context}\n\nContinue the conversation naturally.`;
    const lastUserMsg = [...state.chat.messages].reverse().find(m => m.from === 'human');
    const promptText = lastUserMsg?.value || 'Continue the conversation.';

    const streamingMsg = { from: 'gpt', value: '', timestamp: new Date().toISOString(), streaming: true };
    state.chat.messages.push(streamingMsg);
    renderChatMessages();

    try {
        const response = await fetch('/api/generate/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: promptText, system_prompt: systemPrompt,
                provider: els.provider.value, model: getModelValue(),
                temperature: parseFloat(els.temperature.value),
                custom_params: state.customParams
            }),
            signal: state.chat.abortController.signal
        });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            for (const line of chunk.split('\n')) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.error) { toast(data.error, 'error'); break; }
                        if (data.done) break;
                        if (data.content) { fullText += data.content; streamingMsg.value = fullText; throttledRenderChat(); }
                    } catch (e) { }
                }
            }
        }
        streamingMsg.streaming = false;
        renderChatMessages();
        updateChatTurns();
        enableChatButtons();
    } catch (e) {
        if (e.name !== 'AbortError') {
            toast('Failed to generate response', 'error');
            const idx = state.chat.messages.indexOf(streamingMsg);
            if (idx > -1) state.chat.messages.splice(idx, 1);
        } else {
            streamingMsg.streaming = false;
            if (!streamingMsg.value) { const idx = state.chat.messages.indexOf(streamingMsg); if (idx > -1) state.chat.messages.splice(idx, 1); }
        }
        renderChatMessages();
    } finally {
        state.chat.isStreaming = false;
        state.chat.abortController = null;
        streamingMsg.streaming = false;
        renderChatMessages();
        els.sendBtn.classList.remove('btn-danger');
        els.sendBtn.classList.add('btn-primary');
        els.sendBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>';
        debouncedSaveDraft();
    }
}

function enableChatButtons() { els.saveChatBtn.disabled = false; els.forkChatBtn.disabled = false; }
function disableChatButtons() { els.saveChatBtn.disabled = true; els.forkChatBtn.disabled = true; }

// ============ REVIEW QUEUE (Server-Synced) ============
async function addToReviewQueue(item) {
    try {
        const res = await fetch('/api/review-queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversations: item.conversations,
                rawText: item.rawText,
                metadata: item.metadata || {}
            })
        });
        if (res.ok) {
            const data = await res.json();
            // Update local state with server-assigned IDs
            if (data.added) {
                data.added.forEach(entry => state.review.queue.push(entry));
            }
        } else {
            // Fallback: add locally with temp ID
            const entry = {
                id: 'local-' + Date.now() + '-' + Math.random(),
                conversations: item.conversations,
                rawText: item.rawText,
                metadata: item.metadata || {},
                createdAt: new Date().toISOString()
            };
            state.review.queue.push(entry);
            try { await dbPut('reviewQueue', entry); } catch (e) { }
        }
    } catch (e) {
        // Offline fallback
        const entry = {
            id: 'local-' + Date.now() + '-' + Math.random(),
            conversations: item.conversations,
            rawText: item.rawText,
            metadata: item.metadata || {},
            createdAt: new Date().toISOString()
        };
        state.review.queue.push(entry);
        try { await dbPut('reviewQueue', entry); } catch (e2) { }
        console.error('Failed to add to server review queue, saved locally:', e);
    }
    updateReviewBadge();
    renderReviewItem();
}

async function loadReviewQueue() {
    try {
        const res = await fetch('/api/review-queue');
        if (res.ok) {
            const data = await res.json();
            state.review.queue = data.queue || [];
            state.review.currentIndex = 0;
            // Sync local IndexedDB items to server if any exist
            try {
                const localItems = await dbGetAll('reviewQueue');
                if (localItems && localItems.length > 0) {
                    for (const item of localItems) {
                        if (String(item.id).startsWith('local-')) {
                            await addToReviewQueue(item);
                        }
                    }
                    await dbClear('reviewQueue');
                    // Re-fetch after sync
                    const res2 = await fetch('/api/review-queue');
                    if (res2.ok) {
                        const data2 = await res2.json();
                        state.review.queue = data2.queue || [];
                    }
                }
            } catch (e) { }
            updateReviewBadge();
            renderReviewItem();
            return;
        }
    } catch (e) {
        console.warn('Server unreachable, loading review queue from IndexedDB');
    }
    // Fallback to IndexedDB
    try {
        const items = await dbGetAll('reviewQueue');
        state.review.queue = items || [];
        state.review.currentIndex = 0;
        updateReviewBadge();
        renderReviewItem();
    } catch (e) { console.error('Failed to load review queue:', e); }
}

function updateReviewBadge() {
    const count = state.review.queue.length;
    if (els.reviewBadge) {
        els.reviewBadge.textContent = count;
        els.reviewBadge.classList.toggle('hidden', count === 0);
    }
    if (els.reviewCount) els.reviewCount.textContent = `${count} items`;
}

function renderReviewItem() {
    const queue = state.review.queue;
    const idx = state.review.currentIndex;

    if (queue.length === 0) {
        els.reviewConversation.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>No items in review queue</p><p class="small">Generate conversations in bulk to fill the queue</p></div>`;
        els.reviewKeepBtn.disabled = true;
        els.reviewRejectBtn.disabled = true;
        els.reviewEditBtn.disabled = true;
        els.reviewPrev.disabled = true;
        els.reviewNext.disabled = true;
        els.reviewPosition.textContent = '0/0';
        return;
    }

    const item = queue[idx];
    els.reviewConversation.innerHTML = (item.conversations || []).map(m => `
        <div class="bubble ${m.from}">
            <span class="role-label">${m.from === 'human' ? 'USER' : 'GPT'}</span>
            <div class="bubble-content">${escapeHtml(m.value)}</div>
        </div>
    `).join('');
    els.reviewConversation.scrollTop = 0;

    els.reviewKeepBtn.disabled = false;
    els.reviewRejectBtn.disabled = false;
    els.reviewEditBtn.disabled = false;
    els.reviewPrev.disabled = idx <= 0;
    els.reviewNext.disabled = idx >= queue.length - 1;
    els.reviewPosition.textContent = `${idx + 1}/${queue.length}`;
}

function reviewNext() {
    if (state.review.currentIndex < state.review.queue.length - 1) {
        state.review.currentIndex++;
        renderReviewItem();
    }
}

function reviewPrev() {
    if (state.review.currentIndex > 0) {
        state.review.currentIndex--;
        renderReviewItem();
    }
}

async function reviewKeep() {
    const item = state.review.queue[state.review.currentIndex];
    if (!item) return;
    showSaveIndicator('Saving...');
    try {
        const res = await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversation: { conversations: item.conversations },
                folder: 'wanted',
                metadata: item.metadata || {}
            })
        });
        if (res.ok) {
            await removeFromReviewQueue(state.review.currentIndex);
            toast('Kept!', 'success');
            hideSaveIndicator('Saved ✓');
            loadStats();
        }
    } catch (e) { toast('Failed to save', 'error'); hideSaveIndicator('Save failed'); }
}

async function reviewReject() {
    await removeFromReviewQueue(state.review.currentIndex);
    toast('Rejected', 'info');
}

async function removeFromReviewQueue(idx) {
    const item = state.review.queue[idx];
    if (item) {
        try {
            await fetch(`/api/review-queue/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
        } catch (e) {
            console.warn('Failed to remove from server, removing locally');
        }
        try { await dbDelete('reviewQueue', item.id); } catch (e) { }
    }
    state.review.queue.splice(idx, 1);
    if (state.review.currentIndex >= state.review.queue.length && state.review.currentIndex > 0) {
        state.review.currentIndex--;
    }
    updateReviewBadge();
    renderReviewItem();
}

function reviewEdit() {
    const item = state.review.queue[state.review.currentIndex];
    if (!item) return;
    state.generate.rawText = item.rawText || conversationToRaw(item.conversations);
    state.generate.conversation = { conversations: item.conversations };
    els.conversationEdit.value = state.generate.rawText;
    renderConversation(item.conversations);
    enableActionButtons();
    switchTab('generate');
    removeFromReviewQueue(state.review.currentIndex);
}

async function keepAllReview() {
    if (state.review.queue.length === 0) return;
    if (!confirm(`Save all ${state.review.queue.length} conversations?`)) return;
    showSaveIndicator('Saving all...');
    const items = state.review.queue.map(item => ({
        conversation: { conversations: item.conversations },
        metadata: item.metadata || {}
    }));
    try {
        const res = await fetch('/api/save/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items, folder: 'wanted' })
        });
        if (res.ok) {
            const data = await res.json();
            toast(`Saved ${data.saved_count} conversations`, 'success');
            hideSaveIndicator('Saved ✓');
            // Clear server review queue
            try { await fetch('/api/review-queue', { method: 'DELETE' }); } catch (e) { }
            await dbClear('reviewQueue');
            state.review.queue = [];
            state.review.currentIndex = 0;
            updateReviewBadge();
            renderReviewItem();
            loadStats();
            loadFiles();
        }
    } catch (e) { toast('Bulk save failed', 'error'); hideSaveIndicator('Save failed'); }
}

async function rejectAllReview() {
    if (state.review.queue.length === 0) return;
    if (!confirm(`Discard all ${state.review.queue.length} conversations?`)) return;
    try { await fetch('/api/review-queue', { method: 'DELETE' }); } catch (e) { }
    await dbClear('reviewQueue');
    state.review.queue = [];
    state.review.currentIndex = 0;
    updateReviewBadge();
    renderReviewItem();
    toast('Queue cleared', 'info');
}

async function clearReviewQueue() {
    await rejectAllReview();
}

// ============ TABS ============
function switchTab(tabName) {
    state.currentTab = tabName;
    els.tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    els.generateTab.classList.toggle('active', tabName === 'generate');
    els.chatTab.classList.toggle('active', tabName === 'chat');
    els.reviewTab.classList.toggle('active', tabName === 'review');
    if (tabName === 'review') loadReviewQueue();
    debouncedSaveDraft();
}

// ============ SIDEBAR ============
function toggleSidebar() {
    state.sidebar.open = !state.sidebar.open;
    els.sidebar.classList.toggle('open', state.sidebar.open);
    els.sidebarOverlay?.classList.toggle('active', state.sidebar.open);
}

function closeSidebar() {
    state.sidebar.open = false;
    els.sidebar.classList.remove('open');
    els.sidebarOverlay?.classList.remove('active');
}

// ============ API SETTINGS ============
async function saveApiKey() {
    const key = els.apiKey.value.trim();
    if (key.startsWith('•')) { toast('Enter a new key', 'info'); return; }
    try {
        const res = await fetch('/api/config/key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: els.provider.value, api_key: key })
        });
        if (res.ok) { toast('API key saved!', 'success'); loadConfig(); }
    } catch (e) { toast('Failed to save key', 'error'); }
}

async function saveBaseUrl() {
    try {
        const res = await fetch('/api/config/baseurl', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: els.provider.value, base_url: els.baseUrl.value.trim() })
        });
        if (res.ok) toast('Base URL saved!', 'success');
    } catch (e) { toast('Failed to save URL', 'error'); }
}

async function saveDefaultModel() {
    const model = getModelValue();
    if (!model) return;
    try {
        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ default_model: model })
        });
    } catch (e) { console.error('Failed to save default model:', e); }
}

// ============ EXPORT ============
async function openExportModal(format) {
    els.exportFormat.value = format || 'sharegpt';
    els.exportPromptSource.value = 'custom';
    if (els.exportCustomPromptGroup) els.exportCustomPromptGroup.style.display = 'block';
    if (els.exportSystemPrompt) {
        if (state.export.systemPrompt) els.exportSystemPrompt.value = state.export.systemPrompt;
        else if (state.currentTab === 'chat') els.exportSystemPrompt.value = els.chatSystemPrompt?.value || '';
        else els.exportSystemPrompt.value = els.systemPrompt?.value || '';
    }
    await loadExportFiles();
    els.exportModal.classList.remove('hidden');
}

async function loadExportFiles() {
    try {
        const res = await fetch('/api/conversations?folder=wanted');
        if (res.ok) {
            const data = await res.json();
            state.export.files = Array.isArray(data) ? data : (data.conversations || []);
            state.export.selectedIds = new Set(state.export.files.map(f => f.id));
            renderExportFileList();
            updateExportCount();
        }
    } catch (e) { state.export.files = []; renderExportFileList(); }
}

function renderExportFileList() {
    if (!els.exportFileList) return;
    if (!state.export.files || state.export.files.length === 0) {
        els.exportFileList.innerHTML = '<div class="empty-files">No conversations to export</div>';
        return;
    }
    els.exportFileList.innerHTML = state.export.files.map(file => {
        const isSelected = state.export.selectedIds.has(file.id);
        const preview = file.preview || file.id || 'No preview';
        const meta = [file.created_at ? formatDate(file.created_at) : '', file.turns ? `${file.turns} msgs` : '', file.tags?.length ? file.tags.join(', ') : ''].filter(Boolean).join(' • ');
        return `<div class="export-file-item ${isSelected ? 'selected' : ''}" data-id="${file.id}">
            <input type="checkbox" ${isSelected ? 'checked' : ''}>
            <div class="export-file-info">
                <div class="export-file-preview">${escapeHtml(preview)}</div>
                <div class="export-file-meta">${meta || file.id}</div>
            </div>
        </div>`;
    }).join('');
    els.exportFileList.querySelectorAll('.export-file-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.type === 'checkbox') return;
            const cb = item.querySelector('input[type="checkbox"]');
            cb.checked = !cb.checked;
            toggleExportFile(item.dataset.id, cb.checked);
        });
        item.querySelector('input[type="checkbox"]').addEventListener('change', (e) => { toggleExportFile(item.dataset.id, e.target.checked); });
    });
}

function toggleExportFile(id, selected) {
    if (selected) state.export.selectedIds.add(id);
    else state.export.selectedIds.delete(id);
    const item = els.exportFileList.querySelector(`[data-id="${id}"]`);
    if (item) item.classList.toggle('selected', selected);
    updateExportCount();
}

function updateExportCount() { if (els.exportFileCount) els.exportFileCount.textContent = state.export.selectedIds.size; }

function selectAllExportFiles() { state.export.selectedIds = new Set(state.export.files.map(f => f.id)); renderExportFileList(); updateExportCount(); }
function selectNoneExportFiles() { state.export.selectedIds.clear(); renderExportFileList(); updateExportCount(); }

function getExportSystemPrompt() {
    const source = els.exportPromptSource?.value || 'none';
    switch (source) {
        case 'generate': return els.systemPrompt?.value || '';
        case 'chat': return els.chatSystemPrompt?.value || state.chat.systemPrompt || '';
        case 'custom': return els.exportSystemPrompt?.value || '';
        default: return null;
    }
}

async function exportDataset(format, selectedIds = null, systemPrompt = null) {
    showSaveIndicator('Exporting...');
    try {
        const res = await fetch(`/api/export/${format}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: selectedIds, system_prompt: systemPrompt })
        });
        if (res.ok) {
            const data = await res.json();
            toast(`Exported ${selectedIds?.length || 'all'} conversations to ${data.path}`, 'success');
            hideSaveIndicator('Exported ✓');
        } else { const err = await res.json(); toast(err.error || 'Export failed', 'error'); hideSaveIndicator('Export failed'); }
    } catch (e) { toast('Export failed', 'error'); hideSaveIndicator('Export failed'); }
}

function closeExportModal() { els.exportModal.classList.add('hidden'); }

async function saveExportPromptToServer() {
    showSaveIndicator('Saving...');
    try {
        const draft = await buildDraftObject();
        await fetch('/api/drafts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draft)
        });
        toast('Export prompt saved!', 'success');
        hideSaveIndicator('Saved ✓');
    } catch (e) { toast('Failed to save prompt', 'error'); hideSaveIndicator('Save failed'); }
}

// ============ DRAFT AUTO-SAVE (IndexedDB + Smart Sync) ============
let saveDraftTimer = null;

function setupAutoSaveTimer() {
    // Clear existing listeners won't be needed since we use debounced approach
    els.systemPrompt?.removeEventListener('input', onDraftInput);
    els.chatSystemPrompt?.removeEventListener('input', onDraftInput);
    els.exportSystemPrompt?.removeEventListener('input', onDraftInput);
    els.systemPrompt?.addEventListener('input', onDraftInput);
    els.chatSystemPrompt?.addEventListener('input', onDraftInput);
    els.exportSystemPrompt?.addEventListener('input', onDraftInput);
}

function onDraftInput() { debouncedSaveDraft(); }

function debouncedSaveDraft() {
    if (saveDraftTimer) clearTimeout(saveDraftTimer);
    const delay = syncSettings.saveInterval || 2000;
    saveDraftTimer = setTimeout(async () => {
        await saveDraftToLocal();
        syncEngine.markDirty();
        // Auto-push if enabled and online
        if (syncSettings.autoSyncEnabled && syncEngine.status === 'online') {
            syncEngine.push();
        }
    }, delay);
}

async function saveDraftToLocal() {
    showSaveIndicator('Saving locally...');
    try {
        const draft = await buildDraftObject();
        await dbSet('drafts', SESSION_ID, draft);
        // Also keep localStorage as fallback
        localStorage.setItem('dataset-builder-draft', JSON.stringify(draft));
        hideSaveIndicator('Saved ✓');
    } catch (e) {
        console.error('Failed to save draft locally:', e);
        hideSaveIndicator('Save failed');
    }
}

async function buildDraftObject() {
    return {
        _sessionId: SESSION_ID,
        currentPromptName: state.currentPromptName,
        model: getModelValue(),
        temperature: parseFloat(els.temperature?.value || 0.9),
        customParams: state.customParams,
        generate: {
            prompt: els.systemPrompt?.value || '',
            variables: state.generate.variables,
            rawText: state.generate.rawText
        },
        chat: {
            messages: state.chat.messages.filter(m => !m.streaming),
            systemPrompt: els.chatSystemPrompt?.value || ''
        },
        export: {
            systemPrompt: els.exportSystemPrompt?.value || ''
        },
        _localTime: new Date().toISOString()
    };
}

async function restoreDraft() {
    // Try session-specific draft from IndexedDB first
    try {
        const sessionDraft = await dbGet('drafts', SESSION_ID);
        if (sessionDraft) { applyDraft(sessionDraft); return; }
    } catch (e) { }
    // Fallback: try global draft (legacy)
    try {
        const localDraft = await dbGet('drafts', 'currentDraft');
        if (localDraft) { applyDraft(localDraft); return; }
    } catch (e) { }
    // Fallback to localStorage
    try {
        const saved = localStorage.getItem('dataset-builder-draft');
        if (saved) applyDraft(JSON.parse(saved));
    } catch (e) { }
    // Then try server (only shared prefs, not tab state)
    try {
        const serverDraft = await syncEngine.pull();
        if (serverDraft) {
            applyDraft(serverDraft);
        }
    } catch (e) { }
}

function applyDraft(draft) {
    if (!draft) return;
    // Never force tab switch from restored drafts (cross-tab isolation)
    if (draft.currentPromptName) {
        state.currentPromptName = draft.currentPromptName;
        if (els.promptSelect) els.promptSelect.value = draft.currentPromptName;
    }
    if (draft.model && els.modelInput) {
        els.modelInput.value = draft.model;
    }
    if (draft.temperature != null && els.temperature) {
        els.temperature.value = draft.temperature;
        if (els.tempValue) els.tempValue.textContent = draft.temperature;
    }
    if (draft.customParams) {
        state.customParams = draft.customParams;
        renderCustomParams();
    }
    if (draft.generate?.prompt && els.systemPrompt) {
        els.systemPrompt.value = draft.generate.prompt;
        extractVariables();
    }
    if (draft.generate?.variables) {
        state.generate.variables = draft.generate.variables;
        renderVariableInputs(state.generate.variableNames);
    }
    if (draft.chat?.messages?.length) {
        state.chat.messages = draft.chat.messages;
        renderChatMessages();
        updateChatTurns();
        if (state.chat.messages.length >= 2) enableChatButtons();
    }
    if (draft.chat?.systemPrompt && els.chatSystemPrompt) {
        els.chatSystemPrompt.value = draft.chat.systemPrompt;
        state.chat.systemPrompt = draft.chat.systemPrompt;
    }
    if (draft.export?.systemPrompt && els.exportSystemPrompt) {
        els.exportSystemPrompt.value = draft.export.systemPrompt;
        state.export.systemPrompt = draft.export.systemPrompt;
    }
}

async function manualSync() {
    showSaveIndicator('Syncing...');
    await saveDraftToLocal();
    await syncEngine.push();
}

// ============ SWIPE GESTURES ============
function setupSwipeGestures() {
    let startX = 0, startY = 0;
    els.conversationView.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; startY = e.touches[0].clientY; });
    els.conversationView.addEventListener('touchend', (e) => {
        const diffX = e.changedTouches[0].clientX - startX;
        const diffY = e.changedTouches[0].clientY - startY;
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 100) {
            if (diffX > 0) { if (!els.saveBtn.disabled) saveConversation('wanted'); }
            else { if (!els.rejectBtn.disabled) showRejectModal(); }
        }
    });
}

// ============ KEYBOARD SHORTCUTS ============
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Skip when typing in inputs (except hotkey config inputs)
        if (e.target.closest('input:not(.hotkey-input), textarea, select')) return;

        // Review tab shortcuts
        if (state.currentTab === 'review') {
            if (matchesHotkey(e, hotkeys.reviewKeep)) { e.preventDefault(); reviewKeep(); return; }
            if (matchesHotkey(e, hotkeys.reviewReject)) { e.preventDefault(); reviewReject(); return; }
            if (matchesHotkey(e, hotkeys.reviewNext)) { e.preventDefault(); reviewNext(); return; }
            if (matchesHotkey(e, hotkeys.reviewPrev)) { e.preventDefault(); reviewPrev(); return; }
        }
        // Generate tab shortcuts
        if (state.currentTab === 'generate') {
            if (matchesHotkey(e, hotkeys.generate)) { e.preventDefault(); generate(); return; }
            if (matchesHotkey(e, hotkeys.save)) { e.preventDefault(); if (!els.saveBtn.disabled) saveConversation('wanted'); return; }
            if (matchesHotkey(e, hotkeys.reject)) { e.preventDefault(); if (!els.rejectBtn.disabled) showRejectModal(); return; }
        }
    });

    // Enter to send in chat
    els.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
    });
}

// ============ UTILITIES ============
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function toast(message, type = 'info') {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = message;
    els.toastContainer.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
}

// ============ EVENT LISTENERS ============
function setupEventListeners() {
    // Sidebar
    els.sidebarToggle.addEventListener('click', toggleSidebar);
    els.sidebarOverlay?.addEventListener('click', closeSidebar);

    // Manual sync
    els.manualSyncBtn?.addEventListener('click', manualSync);

    // Provider change
    els.provider.addEventListener('change', () => { updateProviderUI(); loadModels(); });
    els.refreshModels.addEventListener('click', refreshModels);
    els.modelInput?.addEventListener('change', saveDefaultModel);
    els.modelInput?.addEventListener('input', () => { debouncedSaveDraft(); });

    // Temperature
    els.temperature.addEventListener('input', (e) => { els.tempValue.textContent = e.target.value; debouncedSaveDraft(); });

    // API settings
    els.toggleKey.addEventListener('click', () => { els.apiKey.type = els.apiKey.type === 'password' ? 'text' : 'password'; });
    els.saveKey.addEventListener('click', saveApiKey);
    els.saveUrl.addEventListener('click', saveBaseUrl);

    // Sync settings
    document.querySelectorAll('#auto-sync-enabled, #sync-interval, #auto-save-enabled, #save-interval').forEach(el => {
        el.addEventListener('change', saveSyncSettings);
    });

    // Search
    let searchTimer = null;
    els.searchInput?.addEventListener('input', () => {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => loadFiles(state.sidebar.currentFolder), 300);
    });

    // File tabs
    $$('.file-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            $$('.file-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            loadFiles(e.target.dataset.folder);
        });
    });

    // Export buttons
    $$('.export-btns .btn').forEach(btn => {
        btn.addEventListener('click', () => openExportModal(btn.dataset.format));
    });

    // Export Modal
    els.confirmExport?.addEventListener('click', () => {
        const format = els.exportFormat.value;
        const systemPrompt = getExportSystemPrompt();
        const selectedIds = state.export.selectedIds.size > 0 ? Array.from(state.export.selectedIds) : null;
        if (selectedIds && selectedIds.length === 0) { toast('Please select at least one conversation to export', 'error'); return; }
        exportDataset(format, selectedIds, systemPrompt);
        closeExportModal();
    });
    els.cancelExport?.addEventListener('click', closeExportModal);
    els.closeExport?.addEventListener('click', closeExportModal);
    els.exportPromptSource?.addEventListener('change', (e) => {
        if (els.exportCustomPromptGroup) els.exportCustomPromptGroup.style.display = e.target.value === 'custom' ? 'block' : 'none';
    });
    els.exportSelectAll?.addEventListener('click', selectAllExportFiles);
    els.exportSelectNone?.addEventListener('click', selectNoneExportFiles);
    $('#export-modal .modal-backdrop')?.addEventListener('click', closeExportModal);
    els.saveExportPrompt?.addEventListener('click', saveExportPromptToServer);

    // Tabs
    els.tabs.forEach(tab => { tab.addEventListener('click', () => switchTab(tab.dataset.tab)); });

    // Prompt Manager
    els.promptSelect?.addEventListener('change', selectPrompt);
    els.savePromptBtn?.addEventListener('click', savePrompt);
    els.newPromptBtn?.addEventListener('click', newPrompt);
    els.deletePromptBtn?.addEventListener('click', deletePrompt);
    els.refreshPromptBtn?.addEventListener('click', refreshPrompt);

    // Prompt change
    els.systemPrompt.addEventListener('input', () => { state.generate.prompt = els.systemPrompt.value; extractVariables(); });

    // Presets
    els.presetSelect.addEventListener('change', loadPresetAction);
    els.savePreset.addEventListener('click', savePresetAction);
    els.deletePreset?.addEventListener('click', deletePresetAction);

    // Custom Parameters
    els.addParamBtn?.addEventListener('click', addCustomParam);
    els.newParamKey?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCustomParam(); });
    els.newParamValue?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCustomParam(); });

    // Generate
    els.generateBtn.addEventListener('click', generate);
    els.regenerateBtn.addEventListener('click', generate);
    els.bulkCancel?.addEventListener('click', () => { if (state.bulk.abortController) state.bulk.abortController.abort(); });

    // Edit toggle
    els.editToggle.addEventListener('click', toggleEditMode);

    // Save/Reject
    els.saveBtn.addEventListener('click', () => saveConversation('wanted'));
    els.rejectBtn.addEventListener('click', showRejectModal);

    // Reject modal
    $$('.reason-btn').forEach(btn => {
        btn.addEventListener('click', () => { hideRejectModal(); saveConversation('rejected', btn.dataset.reason); });
    });
    els.cancelReject.addEventListener('click', hideRejectModal);
    $('#reject-modal .modal-backdrop').addEventListener('click', hideRejectModal);

    // Chat
    els.sendBtn.addEventListener('click', sendChatMessage);
    els.clearChat.addEventListener('click', clearChat);
    els.saveChatBtn.addEventListener('click', saveChat);
    els.forkChatBtn.addEventListener('click', forkChat);

    // Chat Presets
    els.chatPresetSelect?.addEventListener('change', loadChatPreset);
    els.saveChatPreset?.addEventListener('click', saveChatPreset);
    els.deleteChatPreset?.addEventListener('click', deleteChatPreset);

    // Review
    els.reviewPrev?.addEventListener('click', reviewPrev);
    els.reviewNext?.addEventListener('click', reviewNext);
    els.reviewKeepBtn?.addEventListener('click', reviewKeep);
    els.reviewRejectBtn?.addEventListener('click', reviewReject);
    els.reviewEditBtn?.addEventListener('click', reviewEdit);
    els.keepAllBtn?.addEventListener('click', keepAllReview);
    els.rejectAllBtn?.addEventListener('click', rejectAllReview);
    els.clearQueueBtn?.addEventListener('click', clearReviewQueue);

    // Clear generate tab
    els.clearGenBtn?.addEventListener('click', resetGenerateTab);

    // Search toggle
    els.searchToggle?.addEventListener('click', () => {
        const box = els.searchBox;
        if (box) {
            box.classList.toggle('expanded');
            if (box.classList.contains('expanded')) els.searchInput?.focus();
            else { if (els.searchInput) els.searchInput.value = ''; loadFiles(state.sidebar.currentFolder); }
        }
    });

    // Hotkey config
    $$('.hotkey-input').forEach(input => {
        input.addEventListener('keydown', (e) => {
            e.preventDefault();
            const parts = [];
            if (e.ctrlKey || e.metaKey) parts.push('ctrl');
            if (e.shiftKey) parts.push('shift');
            if (e.altKey) parts.push('alt');
            if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) parts.push(e.key);
            const combo = parts.join('+');
            input.value = combo;
            hotkeys[input.dataset.action] = combo;
        });
    });
    $('#save-hotkeys-btn')?.addEventListener('click', saveHotkeys);
    $('#reset-hotkeys-btn')?.addEventListener('click', resetHotkeys);

    // Collapsible sections
    $$('.collapse-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => { toggle.parentElement.classList.toggle('collapsed'); });
    });

    // Setup advanced features
    setupSwipeGestures();
    setupKeyboardShortcuts();
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', init);
