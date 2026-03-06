
// ============ CONSTANTS ============
const ICON_FULLSCREEN_EXIT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>';
const ICON_FULLSCREEN_ENTER = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>';
const ICON_SEND = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>';
const ICON_LOAD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
const ICON_VIEW = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
const ICON_EDIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
const ICON_STOP = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>';
const ICON_EMPTY_CONV = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
const ICON_EMPTY_CHAT = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>';
const ICON_EMPTY_QUEUE = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>';

const CHAT_ZOOM_MIN = 0.5;
const CHAT_ZOOM_MAX = 2;
const CHAT_ZOOM_STEP = 0.1;

function applyChatZoom() {
    if (els.chatMessages) els.chatMessages.style.setProperty('--chat-zoom', state.chat.zoomLevel);
    if (els.chatZoomLabel) els.chatZoomLabel.textContent = Math.round(state.chat.zoomLevel * 100) + '%';
}
function toggleChatFullscreen() {
    state.chat.isFullscreen = !state.chat.isFullscreen;
    if (els.chatCard) els.chatCard.classList.toggle('fullscreen-mobile', state.chat.isFullscreen);
    if (els.chatFullscreen) {
        els.chatFullscreen.innerHTML = state.chat.isFullscreen ? ICON_FULLSCREEN_EXIT : ICON_FULLSCREEN_ENTER;
    }
    if (state.chat.isFullscreen) {
        const escHandler = (e) => { if (e.key === 'Escape') { toggleChatFullscreen(); document.removeEventListener('keydown', escHandler); } };
        document.addEventListener('keydown', escHandler);
    }
}
function toggleChatTools() {
    state.chat.showAllTools = !state.chat.showAllTools;
    if (els.chatMessages) els.chatMessages.classList.toggle('show-all-tools', state.chat.showAllTools);
    if (els.chatToggleTools) els.chatToggleTools.style.color = state.chat.showAllTools ? 'var(--accent)' : '';
}


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
    listIterators: {},
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
        editingIndex: null,
        zoomLevel: 1,
        isFullscreen: false,
        showAllTools: false
    },
    sidebar: {
        open: false
    },
    filesModal: {
        currentFolder: 'wanted',
        files: [],
        selectedIds: new Set()
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
    customParams: {},
    promptHistory: [] // array of {text, timestamp}
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
        // Files Modal
        openFilesBtn: $('#open-files-btn'),
        filesModal: $('#files-modal'),
        closeFilesModal: $('#close-files-modal'),
        filesSearchInput: $('#files-search-input'),
        filesModalList: $('#files-modal-list'),
        filesModalCount: $('#files-modal-count'),
        filesSelectAll: $('#files-select-all'),
        filesSelectNone: $('#files-select-none'),
        filesBulkActions: $('#files-bulk-actions'),

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
        chatCard: $('.chat-card'),
        chatZoomOut: $('#chat-zoom-out'),
        chatZoomIn: $('#chat-zoom-in'),
        chatFullscreen: $('#chat-fullscreen'),
        chatToggleTools: $('#chat-toggle-tools'),
        chatInput: $('#chat-input'),
        sendBtn: $('#send-btn'),
        chatTurns: $('#chat-turns'),
        clearChat: $('#clear-chat'),
        saveChatBtn: $('#save-chat-btn'),
        chatZoomLabel: $('#chat-zoom-label'),
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

        // Clear toggle
        clearGenBtn: $('#clear-gen-btn'),

        // Custom Parameters
        customParamsList: $('#custom-params-list'),
        newParamKey: $('#new-param-key'),
        newParamValue: $('#new-param-value'),
        addParamBtn: $('#add-param-btn'),

        // Macros & History
        openMacrosBtn: $('#open-macros-btn'),
        macrosModal: $('#macros-modal'),
        closeMacrosModal: $('#close-macros-modal'),
        macrosBadge: $('#macros-badge'),
        openHistoryBtn: $('#open-history-btn'),
        promptHistoryList: $('#prompt-history-list'),
        clearHistoryBtn: $('#clear-history-btn'),
        builderType: $('#builder-type'),
        builderItems: $('#builder-items'),
        builderItemsSection: $('#builder-items-section'),
        builderRollSection: $('#builder-roll-section'),
        builderRollInput: $('#builder-roll-input'),
        builderPreviewText: $('#builder-preview-text'),
        builderCopy: $('#builder-copy'),
        historyMaxSetting: $('#history-max-setting')
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
    await restoreDraft();
    await loadReviewQueue();
    await loadPromptHistory();

    setupEventListeners();
    applyHotkeysToUI();
    setupAutoSaveTimer();
    syncEngine.startAutoSync();

    // Initial renders
    renderConversation([]);
    renderChatMessages();
    renderReviewItem();
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
        optgroup.label = 'Recent';
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

    // 1. Check for duplicates FIRST, before clearing anything
    if (state.prompts.some(p => p.name === name)) {
        toast(`A prompt with the name "${name}" already exists. Please use a unique name.`, 'error');
        return; // Exit immediately
    }

    // 2. Now it's safe to clear the UI and state for the new prompt
    state.currentPromptName = name;
    els.systemPrompt.value = '';
    state.generate.prompt = '';
    extractVariables();

    // 3. Save and reload
    await savePrompt();
    await loadPrompts();

    // Select the new prompt
    if (els.promptSelect) {
        els.promptSelect.value = name;
    }
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

    // Update the inline count badge next to token count
    const badge = document.getElementById('var-count-badge');
    if (badge) badge.textContent = names.length > 0 ? `· ${names.length} variable${names.length > 1 ? 's' : ''}` : '';

    // Always render variables grid in macros modal
    renderVariableInputs(names);
    updateMacrosBadge();
    updateTokenCount();
}

function renderVariableInputs(names) {
    const grid = els.variablesGrid || document.getElementById('variables-grid');
    if (!grid) return;
    if (names.length === 0) {
        grid.innerHTML = '<p class="muted small">No variables detected. Type <code>{{name}}</code> in your prompt to add one.</p>';
        return;
    }
    grid.innerHTML = names.map(name => `
        <div class="var-modal-row">
            <label class="var-modal-label" for="var-${name}">${name}</label>
            <textarea id="var-${name}" class="textarea var-modal-textarea var-input"
                data-var="${name}"
                placeholder="Value or macro, e.g. random::a::b"
                rows="2">${escapeHtml(state.generate.variables[name] || '')}</textarea>
        </div>
    `).join('');
    grid.querySelectorAll('.var-input').forEach(ta => {
        ta.addEventListener('input', (e) => {
            state.generate.variables[e.target.dataset.var] = e.target.value;
            updateTokenCount();
            debouncedSaveDraft();
        });
    });
}

function rollDice(notation) {
    // Parses NdN, NdN+M, NdN-M
    const m = notation.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
    if (!m) return NaN;
    const count = parseInt(m[1], 10);
    const sides = parseInt(m[2], 10);
    const modifier = m[3] ? parseInt(m[3], 10) : 0;
    if (count < 1 || sides < 1) return NaN;
    let total = modifier;
    for (let i = 0; i < count; i++) total += Math.floor(Math.random() * sides) + 1;
    return total;
}

function _resolveInlineMacros(text, isPreview) {
    // Strip {{// comments}}
    text = text.replace(/\{\{\/\/[^}]*\}\}/g, '');
    // Resolve {{roll:...}}
    text = text.replace(/\{\{roll:([^}]+)\}\}/gi, (_, notation) => {
        const result = rollDice(notation.trim());
        return isNaN(result) ? `{{roll:${notation}}}` : String(result);
    });
    // Resolve {{random::...}} and {{list::...}}
    text = text.replace(/\{\{(random|list)::([^}]+)\}\}/g, (_, type, rest) => {
        const parts = rest.split('::');
        if (type === 'random') return parts[Math.floor(Math.random() * parts.length)];
        const k = `${type}::${rest}`;
        if (!state.listIterators[k]) state.listIterators[k] = 0;
        const val = parts[state.listIterators[k] % parts.length];
        if (!isPreview) state.listIterators[k]++;
        return val;
    });
    return text;
}

function applyVariables(text, isPreview = false) {
    const sessionCache = {};
    // First strip comments and run inline macros
    text = _resolveInlineMacros(text, isPreview);

    // Then resolve named variables (up to 3 levels deep to handle nesting)
    for (let depth = 0; depth < 3; depth++) {
        text = text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
            if (sessionCache[key] !== undefined) return sessionCache[key];
            let val = state.generate.variables[key];
            if (!val) return match;
            // Resolve macros in the variable's value
            val = _resolveInlineMacros(val, isPreview);
            sessionCache[key] = val;
            return val;
        });
        if (!/\{\{\w+\}\}/.test(text)) break; // No more variables to resolve
    }
    return text;
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
            <button class="icon-btn param-remove" data-key="${escapeHtml(key)}" title="Remove">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
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
    const p = applyVariables(els.systemPrompt.value, true);
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

// ============ FILES MODAL ============
function openFilesModal() {
    els.filesModal.classList.remove('hidden');
    loadFilesModal(state.filesModal.currentFolder);
}

function closeFilesModal() {
    els.filesModal.classList.add('hidden');
}

async function loadFilesModal(folder = 'wanted') {
    state.filesModal.currentFolder = folder;
    const search = els.filesSearchInput?.value?.trim() || '';

    // Update active tab styling
    $$('#files-modal .file-tab').forEach(t => t.classList.toggle('active', t.dataset.folder === folder));

    try {
        if (folder === 'review') {
            const res = await fetch('/api/review-queue');
            if (res.ok) {
                const data = await res.json();
                state.filesModal.files = data.queue || [];
                if (search) {
                    const s = search.toLowerCase();
                    state.filesModal.files = state.filesModal.files.filter(f =>
                        (f.rawText && f.rawText.toLowerCase().includes(s)) ||
                        (f.conversations && f.conversations.some(c => c.value && c.value.toLowerCase().includes(s)))
                    );
                }
            }
        } else {
            let url = `/api/conversations?folder=${folder}`;
            if (search) url += `&search=${encodeURIComponent(search)}`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                state.filesModal.files = Array.isArray(data) ? data : (data.conversations || []);
            }
        }

        // Clean up selected IDs that no longer exist
        const currentIds = new Set(state.filesModal.files.map(f => f.id));
        for (let id of state.filesModal.selectedIds) {
            if (!currentIds.has(id)) state.filesModal.selectedIds.delete(id);
        }

        renderFilesModalList();
        updateFilesModalCount();
    } catch (e) { console.error('Failed to load files:', e); }
}

function updateFilesModalCount() {
    if (els.filesModalCount) els.filesModalCount.textContent = state.filesModal.selectedIds.size;
}

function renderFilesModalList() {
    if (!els.filesModalList) return;
    const folder = state.filesModal.currentFolder;

    // Update bulk action buttons visibility
    const buttons = Array.from(els.filesBulkActions.querySelectorAll('button[data-folder]'));
    buttons.forEach(btn => {
        const folders = btn.dataset.folder.split(' ');
        if (folders.includes(folder)) {
            btn.removeAttribute('hidden');
        } else {
            btn.setAttribute('hidden', '');
        }
    });

    if (state.filesModal.files.length === 0) {
        els.filesModalList.innerHTML = '<div class="empty-files">No items found</div>';
        return;
    }

    els.filesModalList.innerHTML = state.filesModal.files.map(f => {
        const isSelected = state.filesModal.selectedIds.has(f.id);

        let preview = '';
        let metaStr = '';

        if (folder === 'review') {
            const firstMsg = f.conversations?.find(c => c.from === 'human') || f.conversations?.[0];
            preview = firstMsg ? firstMsg.value : 'Empty conversation';
            preview = preview.length > 80 ? preview.substring(0, 80) + '...' : preview;
            metaStr = f.createdAt ? formatDate(f.createdAt) : '';
        } else {
            preview = f.preview || f.id || 'No preview';
            const meta = [];
            if (f.created_at) meta.push(formatDate(f.created_at));
            if (f.turns) meta.push(`${f.turns} msgs`);
            if (f.tags?.length) meta.push(f.tags.map(t => escapeHtml(t)).join(', '));
            metaStr = meta.join(' • ');
        }

        return `
            <div class="export-file-item ${isSelected ? 'selected' : ''}" data-id="${escapeHtml(f.id)}">
                <input type="checkbox" class="file-checkbox" ${isSelected ? 'checked' : ''}>
                <div class="export-file-info">
                    <div class="export-file-preview">${escapeHtml(preview)}</div>
                    <div class="export-file-meta">${metaStr ? metaStr : escapeHtml(f.id)}</div>
                </div>
                ${folder !== 'review' ? `
                <div class="file-actions">
                    <button class="icon-btn load-btn" data-id="${escapeHtml(f.id)}" title="Load in Generate Tab">${ICON_LOAD} Load</button>
                </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

function toggleFilesModalSelection(id, selected) {
    if (selected) state.filesModal.selectedIds.add(id);
    else state.filesModal.selectedIds.delete(id);

    const item = els.filesModalList.querySelector(`[data-id="${id}"]`);
    if (item) item.classList.toggle('selected', selected);
    updateFilesModalCount();
}

// Bulk Actions Handlers
async function handleBulkMove(from, to) {
    const ids = Array.from(state.filesModal.selectedIds);
    if (ids.length === 0) return;

    showSaveIndicator('Moving...');
    try {
        const res = await fetch('/api/conversations/bulk-move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, from, to })
        });
        if (res.ok) {
            toast(`Moved ${ids.length} items to ${to}`, 'success');
            state.filesModal.selectedIds.clear();
            loadFilesModal(from);
            loadStats();
        } else { toast('Failed to move', 'error'); }
    } catch (e) { toast('Failed to move', 'error'); }
    hideSaveIndicator('Moved');
}

async function handleBulkDelete(folder) {
    const ids = Array.from(state.filesModal.selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Permanently delete ${ids.length} conversations?`)) return;

    showSaveIndicator('Deleting...');
    try {
        const res = await fetch('/api/conversations/bulk-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, folder })
        });
        if (res.ok) {
            toast(`Deleted ${ids.length} items`, 'success');
            state.filesModal.selectedIds.clear();
            loadFilesModal(folder);
            loadStats();
        } else { toast('Failed to delete', 'error'); }
    } catch (e) { toast('Failed to delete', 'error'); }
    hideSaveIndicator('Deleted');
}

async function handleBulkReviewKeep() {
    const ids = Array.from(state.filesModal.selectedIds);
    if (ids.length === 0) return;

    showSaveIndicator('Saving...');
    try {
        const res = await fetch('/api/review-queue/bulk-keep', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });

        if (res.ok) {
            const data = await res.json();
            if (data.error_count > 0) {
                toast(`Kept ${data.saved_count} items. Failed to save ${data.error_count} items.`, 'warning');
            } else {
                toast(`Kept ${data.saved_count} items`, 'success');
            }
            state.filesModal.selectedIds.clear();
            loadFilesModal('review');
            loadReviewQueue(); // Refresh main review tab
            loadStats();
        } else { toast('Failed to keep items', 'error'); }
    } catch (e) { toast('Failed to keep items', 'error'); }
    hideSaveIndicator('Saved');
}

async function handleBulkReviewDiscard() {
    const ids = Array.from(state.filesModal.selectedIds);
    if (ids.length === 0) return;

    showSaveIndicator('Discarding...');
    try {
        const res = await fetch('/api/review-queue/bulk-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
        if (res.ok) {
            toast(`Discarded ${ids.length} items`, 'success');
            state.filesModal.selectedIds.clear();
            loadFilesModal('review');
            loadReviewQueue(); // Refresh main review tab
        } else { toast('Failed to discard', 'error'); }
    } catch (e) { toast('Failed to discard', 'error'); }
    hideSaveIndicator('Discarded');
}

async function loadConversation(id, folder) {
    try {
        const res = await fetch(`/api/conversation/${encodeURIComponent(id)}?folder=${encodeURIComponent(folder)}`);
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
    els.generateBtn.textContent = 'Stop';

    const promptText = applyVariables(els.systemPrompt.value);
    addToPromptHistory(promptText);
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

        const extractedText = extractOutput(fullText);

        if (extractedText.includes('+++')) {
            const conversationsRaw = extractedText.split('+++').map(s => s.trim()).filter(s => s);
            let addedCount = 0;
            for (const convRaw of conversationsRaw) {
                const parsed = parseMinimalFormat(convRaw);
                if (parsed.length > 0) {
                    await addToReviewQueue({
                        conversations: parsed,
                        rawText: convRaw,
                        metadata: { model: getModelValue(), prompt: state.currentPromptName, variables: { ...state.generate.variables } }
                    });
                    addedCount++;
                }
            }
            if (addedCount > 0) {
                toast(`Added ${addedCount} conversations to review queue`, 'success');
            }

            // Clear current view so we don't accidentally save duplicates manually
            state.generate.rawText = '';
            els.conversationEdit.value = '';
            parseAndRender();
            disableActionButtons();
            addModelToHistory();
        } else {
            state.generate.rawText = extractedText;
            els.conversationEdit.value = extractedText;
            parseAndRender();
            enableActionButtons();
            addModelToHistory();
        }
    } catch (e) {
        if (e.name !== 'AbortError') toast(e.message || 'Generation failed', 'error');
    } finally {
        state.generate.isLoading = false;
        state.generate.abortController = null;
        els.generateBtn.disabled = false;
        els.generateBtn.classList.remove('btn-danger');
        els.generateBtn.classList.add('btn-primary');
        els.generateBtn.textContent = 'Generate';
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
    state.listIterators = {};
    for (let i = 0; i < count; i++) {
        if (state.bulk.abortController.signal.aborted) break;
        const promptText = applyVariables(els.systemPrompt.value);
        addToPromptHistory(promptText); // record each resolved prompt
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
                const extractedText = extractOutput(data.content);

                const conversationsRaw = extractedText.includes('+++') ?
                    extractedText.split('+++').map(s => s.trim()).filter(s => s) :
                    [extractedText];

                for (const convRaw of conversationsRaw) {
                    const parsed = parseMinimalFormat(convRaw);
                    if (parsed.length > 0) {
                        await addToReviewQueue({
                            conversations: parsed,
                            rawText: convRaw,
                            metadata: { model: getModelValue(), prompt: state.currentPromptName, variables: { ...state.generate.variables } }
                        });
                    }
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

function extractOutput(text) {
    const match = text.match(/<output>([\s\S]*?)<\/output>/);
    if (match) {
        return match[1].trim();
    }
    return text.trim();
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
        els.conversationView.innerHTML = `<div class="empty-state"><div class="empty-icon">${ICON_EMPTY_CONV}</div><p>Click "Generate" to create a conversation</p></div>`;
        return;
    }
    els.conversationView.innerHTML = messages.map(m => `
        <div class="bubble ${m.from}">
            <div class="bubble-header">
                <span class="role-label">${m.from === 'human' ? 'USER' : 'GPT'}</span>
            </div>
            <div class="bubble-content">${escapeHtml(m.value)}</div>
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
        els.editToggle.innerHTML = `${ICON_VIEW} View`;

        // Also enable buttons immediately if there is text when entering edit mode
        if (els.conversationEdit.value.trim().length > 0) {
            enableActionButtons();
        } else {
            disableActionButtons();
        }
    } else {
        els.conversationView.classList.remove('hidden');
        els.conversationEdit.classList.add('hidden');
        state.generate.rawText = els.conversationEdit.value;
        parseAndRender();
        els.editToggle.innerHTML = `${ICON_EDIT} Edit`;
    }
}


// ============ CHAT TAB ============
function setButtonToStop(button) {
    button.disabled = false;
    button.classList.add('btn-danger');
    button.classList.remove('btn-primary');
    button.innerHTML = `${ICON_STOP} Stop`;
}

function setButtonToSend(button) {
    button.disabled = false;
    button.classList.add('btn-primary');
    button.classList.remove('btn-danger');
    button.innerHTML = `${ICON_SEND}`;
}

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
    setButtonToStop(els.sendBtn);

    const context = state.chat.messages.map(m => `${m.from === 'human' ? 'User' : 'Assistant'}: ${m.value}`).join('\n');
    const baseSystemPrompt = applyVariables(els.chatSystemPrompt?.value || 'You are a helpful and friendly conversational assistant. Keep responses natural and engaging.');
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
        setButtonToSend(els.sendBtn);
        debouncedSaveDraft();
    }
}

function renderChatMessages() {
    if (state.chat.messages.length === 0) {
        els.chatMessages.innerHTML = `<div class="empty-state"><div class="empty-icon">${ICON_EMPTY_CHAT}</div><p>Start a conversation by typing below</p></div>`;
        return;
    }
    els.chatMessages.innerHTML = state.chat.messages.map((m, i) => {
        const isEditing = state.chat.editingIndex === i;
        const isStreaming = m.streaming;
        const roleLabel = m.from === 'human' ? 'YOU' : 'GPT';

        if (isEditing) {
            return `<div class="bubble ${m.from} editing" data-index="${i}">
                <span class="role-label">${roleLabel} (editing)</span>
                <textarea class="edit-textarea" id="edit-msg-${i}">${escapeHtml(m.value)}</textarea>
                <div class="edit-actions">
                    <button class="msg-btn msg-btn-save" onclick="saveEditMessage(${i})" title="Save">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                    <button class="msg-btn msg-btn-cancel" onclick="cancelEditMessage()" title="Cancel">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            </div>`;
        }

        const toolsHtml = isStreaming ? '' : `<div class="bubble-tools">
            <button class="msg-btn edit" onclick="startEditMessage(${i})" title="Edit">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="msg-btn delete" onclick="deleteMessage(${i})" title="Delete">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
            <button class="msg-btn fork" onclick="forkChat(${i})" title="Fork">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
            </button>
            ${m.from === 'gpt' ? `<button class="msg-btn regen" onclick="regenerateFrom(${i})" title="Regenerate">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.5 2v6h6M21.5 22v-6h-6"/><path d="M22 11.5A10 10 0 0 0 3.2 7.2M2 12.5a10 10 0 0 0 18.8 4.2"/></svg>
            </button>` : ''}
            ${m.from === 'human' ? `<button class="msg-btn continue" onclick="continueFromMessage(${i})" title="Continue">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </button>` : ''}
        </div>`;

        const meatball = isStreaming ? '' : `<button class="msg-menu-btn" title="Toggle tools">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
        </button>`;

        return `<div class="bubble ${m.from}${isStreaming ? ' streaming' : ''}" data-index="${i}">
            <div class="bubble-header">
                <span class="role-label">${roleLabel}${isStreaming ? ' (typing\u2026)' : ''}</span>
                ${toolsHtml}
                ${meatball}
            </div>
            <div class="bubble-content">${escapeHtml(m.value)}${isStreaming ? '<span class="streaming-cursor"></span>' : ''}</div>
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

function forkChat(index) {
    if (typeof index === 'number' && index >= 0 && index < state.chat.messages.length) {
        state.chat.messages = state.chat.messages.slice(0, index + 1);
        renderChatMessages();
        updateChatTurns();
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
    setButtonToStop(els.sendBtn);

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

function enableChatButtons() { if (els.saveChatBtn) els.saveChatBtn.disabled = false; }
function disableChatButtons() { if (els.saveChatBtn) els.saveChatBtn.disabled = true; }

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
        els.reviewConversation.innerHTML = `<div class="empty-state"><div class="empty-icon">${ICON_EMPTY_QUEUE}</div><p>No items in review queue</p><p class="small">Generate conversations in bulk to fill the queue</p></div>`;
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
            systemPrompt: els.chatSystemPrompt?.value || '',
            zoomLevel: state.chat.zoomLevel
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
    if (draft.chat?.zoomLevel != null) {
        state.chat.zoomLevel = draft.chat.zoomLevel;
        applyChatZoom();
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

// ============ MACROS MODAL ============
function openMacrosModal() {
    if (els.macrosModal) els.macrosModal.classList.remove('hidden');
    switchMacrosTab('variables');
}

function closeMacrosModal() {
    if (els.macrosModal) els.macrosModal.classList.add('hidden');
}

function switchMacrosTab(tabName) {
    $$('.macros-tab').forEach(t => t.classList.toggle('active', t.dataset.macrosTab === tabName));
    $$('.macros-tab-content').forEach(c => c.classList.remove('active'));
    const target = document.getElementById(`macros-${tabName}`);
    if (target) target.classList.add('active');
    // On switching to variables, re-render so values are fresh
    if (tabName === 'variables') renderVariableInputs(state.generate.variableNames || []);
    if (tabName === 'history') renderPromptHistory();
}

function updateBuilderPreview() {
    if (!els.builderType || !els.builderPreviewText) return;
    const type = els.builderType.value;
    if (type === 'roll') {
        const notation = els.builderRollInput?.value.trim() || '1d20';
        els.builderPreviewText.textContent = `{{roll:${notation}}}`;
    } else {
        const raw = els.builderItems?.value || '';
        const items = raw.split('\n').map(l => l.trim()).filter(Boolean);
        if (items.length === 0) { els.builderPreviewText.textContent = '—'; return; }
        els.builderPreviewText.textContent = `{{${type}::${items.join('::')}}}`;
    }
}

function copyBuilderMacro() {
    const text = els.builderPreviewText?.textContent;
    if (!text || text === '—') return;
    navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard!', 'success')).catch(() => toast('Copy failed', 'error'));
}

function updateMacrosBadge() {
    const count = Object.keys(state.generate.variables).filter(k => state.generate.variables[k]).length;
    if (els.macrosBadge) {
        els.macrosBadge.textContent = count;
        els.macrosBadge.classList.toggle('hidden', count === 0);
    }
}

// ============ PROMPT HISTORY ============
function getHistoryMax() {
    return parseInt(els.historyMaxSetting?.value || document.getElementById('history-max-setting')?.value || 30, 10) || 30;
}

function addToPromptHistory(resolvedText) {
    if (!resolvedText || !resolvedText.trim()) return;
    const max = getHistoryMax();
    state.promptHistory.unshift({ text: resolvedText.trim(), timestamp: new Date().toISOString() });
    if (state.promptHistory.length > max) state.promptHistory.length = max;
    // Persist to IndexedDB
    dbSet('settings', 'promptHistory', state.promptHistory).catch(() => { });
}

async function loadPromptHistory() {
    try {
        const saved = await dbGet('settings', 'promptHistory');
        if (Array.isArray(saved)) state.promptHistory = saved;
    } catch (e) { }
}

function renderPromptHistory() {
    if (!els.promptHistoryList) return;
    if (state.promptHistory.length === 0) {
        els.promptHistoryList.innerHTML = '<div class="empty-state" style="padding:1.5rem 1rem;"><p>No history yet. Send a prompt to record it here.</p></div>';
        return;
    }
    els.promptHistoryList.innerHTML = state.promptHistory.map((entry, i) => {
        const date = new Date(entry.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        return `<div class="history-item" data-index="${i}" title="Click to view">
            <div class="history-item-time">${date}</div>
            <div class="history-item-text">${escapeHtml(entry.text)}</div>
        </div>`;
    }).join('');
    els.promptHistoryList.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', () => {
            const idx = parseInt(item.dataset.index, 10);
            showHistoryDetail(idx);
        });
    });
}

function showHistoryDetail(idx) {
    const entry = state.promptHistory[idx];
    if (!entry) return;
    const date = new Date(entry.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const histTab = document.getElementById('macros-history');
    if (!histTab) return;

    let detailContainer = document.getElementById('history-detail-view');
    if (!detailContainer) {
        detailContainer = document.createElement('div');
        detailContainer.id = 'history-detail-view';
        detailContainer.style.display = 'none';
        detailContainer.style.flexDirection = 'column';
        detailContainer.style.gap = '0.5rem';
        detailContainer.style.flex = '1';
        detailContainer.style.minHeight = '0';
        histTab.appendChild(detailContainer);
    }

    const header = histTab.querySelector('.history-header');
    const list = els.promptHistoryList;

    if (header) header.style.display = 'none';
    if (list) list.style.display = 'none';
    detailContainer.style.display = 'flex';

    detailContainer.innerHTML = `
        <div style="display:flex;align-items:center;gap:0.5rem;flex-shrink:0;">
            <button id="history-back-btn" class="btn btn-sm btn-secondary">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                Back
            </button>
            <span class="muted small">${date}</span>
            <button id="history-copy-btn" class="btn btn-sm btn-accent" style="margin-left:auto;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                Copy
            </button>
        </div>
        <pre style="white-space:pre-wrap;word-break:break-word;font-size:0.82rem;line-height:1.6;color:var(--text-primary);background:rgba(255,255,255,.03);border:1px solid var(--border-glass);border-radius:8px;padding:0.75rem;overflow-y:auto;flex:1;">${escapeHtml(entry.text)}</pre>
    `;

    document.getElementById('history-back-btn').addEventListener('click', () => {
        detailContainer.style.display = 'none';
        if (header) header.style.display = '';
        if (list) list.style.display = '';
    });
    document.getElementById('history-copy-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(entry.text).then(() => toast('Copied to clipboard', 'success')).catch(() => toast('Copy failed', 'error'));
    });
}



function clearPromptHistory() {
    if (!confirm('Clear all prompt history?')) return;
    state.promptHistory = [];
    dbSet('settings', 'promptHistory', []).catch(() => { });
    renderPromptHistory();
    toast('History cleared', 'info');
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

    // Handle meatball menu clicks and outside clicks
    document.addEventListener('click', (e) => {
        const meatballBtn = e.target.closest('.msg-menu-btn');
        if (meatballBtn) {
            const bubble = meatballBtn.closest('.bubble');
            if (bubble) {
                // Close all other open bubbles
                document.querySelectorAll('.bubble.tools-open').forEach(b => { if (b !== bubble) b.classList.remove('tools-open'); });
                bubble.classList.toggle('tools-open');
            }
            return;
        }
        // Close on outside click
        if (!e.target.closest('.bubble')) {
            document.querySelectorAll('.bubble.tools-open').forEach(b => b.classList.remove('tools-open'));
        }
    });
    // Files Modal
    els.openFilesBtn?.addEventListener('click', openFilesModal);
    els.closeFilesModal?.addEventListener('click', closeFilesModal);
    $('#files-modal .modal-backdrop')?.addEventListener('click', closeFilesModal);

    // Files Search
    let filesSearchTimer = null;
    els.filesSearchInput?.addEventListener('input', () => {
        if (filesSearchTimer) clearTimeout(filesSearchTimer);
        filesSearchTimer = setTimeout(() => loadFilesModal(state.filesModal.currentFolder), 300);
    });

    // Files Modal Tabs
    $$('#files-modal .file-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            loadFilesModal(e.target.dataset.folder);
        });
    });

    // Files Modal Bulk Actions Static Listeners
    $('#files-select-all')?.addEventListener('click', () => {
        state.filesModal.selectedIds = new Set(state.filesModal.files.map(f => f.id));
        renderFilesModalList();
        updateFilesModalCount();
    });
    $('#files-select-none')?.addEventListener('click', () => {
        state.filesModal.selectedIds.clear();
        renderFilesModalList();
        updateFilesModalCount();
    });
    $('#files-bulk-reject')?.addEventListener('click', () => handleBulkMove('wanted', 'rejected'));
    $('#files-bulk-restore')?.addEventListener('click', () => handleBulkMove('rejected', 'wanted'));
    $('#files-bulk-delete')?.addEventListener('click', () => handleBulkDelete(state.filesModal.currentFolder));
    $('#files-bulk-keep')?.addEventListener('click', () => handleBulkReviewKeep());
    $('#files-bulk-discard')?.addEventListener('click', () => handleBulkReviewDiscard());

    // Event Delegation for Files Modal List Items
    els.filesModalList?.addEventListener('click', (e) => {
        const item = e.target.closest('.export-file-item');
        if (!item) return;

        const id = item.dataset.id;
        const loadBtn = e.target.closest('.load-btn');
        const checkbox = e.target.closest('.file-checkbox');

        if (loadBtn) {
            e.stopPropagation();
            loadConversation(id, state.filesModal.currentFolder);
            closeFilesModal();
        } else if (checkbox) {
            e.stopPropagation();
            toggleFilesModalSelection(id, checkbox.checked);
        } else if (!e.target.closest('.file-actions')) {
            const cb = item.querySelector('.file-checkbox');
            if (cb) {
                cb.checked = !cb.checked;
                toggleFilesModalSelection(id, cb.checked);
            }
        }
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
    els.systemPrompt.addEventListener('input', () => {
        state.generate.prompt = els.systemPrompt.value;
        extractVariables();
        updateMacrosBadge();
    });

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

    // Manual edit listener
    els.conversationEdit.addEventListener('input', () => {
        if (state.generate.isEditing && els.conversationEdit.value.trim().length > 0) {
            enableActionButtons();
        } else if (state.generate.isEditing) {
            disableActionButtons();
        }
    });

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

    // Chat header tools
    els.chatZoomOut?.addEventListener('click', () => { state.chat.zoomLevel = Math.max(CHAT_ZOOM_MIN, Number(state.chat.zoomLevel) - CHAT_ZOOM_STEP).toFixed(2); applyChatZoom(); debouncedSaveDraft(); });
    els.chatZoomIn?.addEventListener('click', () => { state.chat.zoomLevel = Math.min(CHAT_ZOOM_MAX, Number(state.chat.zoomLevel) + CHAT_ZOOM_STEP).toFixed(2); applyChatZoom(); debouncedSaveDraft(); });
    els.chatFullscreen?.addEventListener('click', toggleChatFullscreen);
    els.chatToggleTools?.addEventListener('click', toggleChatTools);

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

    // Macros Modal
    els.openMacrosBtn?.addEventListener('click', openMacrosModal);
    els.closeMacrosModal?.addEventListener('click', closeMacrosModal);
    $('#macros-modal .modal-backdrop')?.addEventListener('click', closeMacrosModal);
    $$('.macros-tab').forEach(tab => {
        tab.addEventListener('click', () => switchMacrosTab(tab.dataset.macrosTab));
    });
    els.builderType?.addEventListener('change', () => {
        const isRoll = els.builderType.value === 'roll';
        if (els.builderItemsSection) els.builderItemsSection.classList.toggle('hidden', isRoll);
        if (els.builderRollSection) els.builderRollSection.classList.toggle('hidden', !isRoll);
        updateBuilderPreview();
    });
    els.builderItems?.addEventListener('input', updateBuilderPreview);
    els.builderRollInput?.addEventListener('input', updateBuilderPreview);
    els.builderCopy?.addEventListener('click', copyBuilderMacro);

    // History
    els.openHistoryBtn?.addEventListener('click', () => { openMacrosModal(); switchMacrosTab('history'); });
    els.clearHistoryBtn?.addEventListener('click', clearPromptHistory);
    els.historyMaxSetting?.addEventListener('change', () => {
        const max = getHistoryMax();
        if (state.promptHistory.length > max) { state.promptHistory.length = max; dbSet('settings', 'promptHistory', state.promptHistory).catch(() => { }); }
    });

    // Setup advanced features
    setupSwipeGestures();
    setupKeyboardShortcuts();
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', init);

