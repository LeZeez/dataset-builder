
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
const MODAL_PAGE_SIZE = 100;
const UI_PREFS_KEY = 'uiPrefs';
const RAW_CONVERSATION_SEPARATOR_RE = /^\s*\+\+\+\s*$/m;
const hydratedFields = { model: false, temperature: false };
const LIST_SEARCH_DEBOUNCE_MS = 300;
let lastLocalDraftHash = null;
let modelsLoadedForProvider = '';
let promptHistoryLoaded = false;

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
    saveUiPrefs();
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
        window.addEventListener('beforeunload', async () => {
            if (this.pendingChanges) {
                try {
                    // Send actual draft content, not just session metadata
                    const draft = await buildDraftObject();
                    navigator.sendBeacon('/api/drafts', new Blob([JSON.stringify(draft)], { type: 'application/json' }));
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
            const res = await fetch(`/api/drafts?session_id=${encodeURIComponent(SESSION_ID)}`);
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
    saveInterval: 2000,
    askRejectReason: false,
    bulkRetryAttempts: 2
};

async function loadSyncSettings() {
    try {
        const saved = await dbGet('settings', 'syncSettings');
        if (saved) syncSettings = { ...syncSettings, ...saved };
    } catch (e) { }
    syncSettings.saveInterval = Math.max(30, parseInt(syncSettings.saveInterval, 10) || 2000);
    applySyncSettingsToUI();
}

async function saveSyncSettings() {
    const el = (id) => document.getElementById(id);
    syncSettings.autoSyncEnabled = el('auto-sync-enabled')?.checked ?? true;
    syncSettings.syncInterval = parseInt(el('sync-interval')?.value) || 30;
    syncSettings.autoSaveEnabled = el('auto-save-enabled')?.checked ?? true;
    syncSettings.saveInterval = Math.max(30, parseInt(el('save-interval')?.value, 10) || 2000);
    syncSettings.askRejectReason = el('ask-reject-reason')?.checked ?? false;
    syncSettings.bulkRetryAttempts = Math.max(0, Math.min(5, parseInt(el('bulk-retry-attempts')?.value, 10) || 0));
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
    if (el('ask-reject-reason')) el('ask-reject-reason').checked = syncSettings.askRejectReason;
    if (el('bulk-retry-attempts')) el('bulk-retry-attempts').value = String(syncSettings.bulkRetryAttempts ?? 2);
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

async function loadUiPrefs() {
    try {
        state._hadUiPrefs = false;
        const saved = await dbGet('settings', UI_PREFS_KEY);
        if (!saved) return;
        state._hadUiPrefs = true;
	        state.uiPrefs = { ...state.uiPrefs, ...saved };
	        state.uiPrefs.exportSystemMode = normalizeExportSystemMode(state.uiPrefs.exportSystemMode);
	        state.uiPrefs.modalPageSize = clampNumber(state.uiPrefs.modalPageSize, { min: 50, max: 2000, fallback: MODAL_PAGE_SIZE });
	        if (state.uiPrefs.warnOnLoadAll === undefined) {
	            state.uiPrefs.warnOnLoadAll = !(state.uiPrefs.skipLoadAllWarning === true);
	        }
	        state.uiPrefs.warnOnLoadAll = state.uiPrefs.warnOnLoadAll !== false;
	        state.uiPrefs.skipLoadAllWarning = !state.uiPrefs.warnOnLoadAll;
	        state.currentTab = state.uiPrefs.currentTab || 'generate';
        state.chat.zoomLevel = state.uiPrefs.chatZoom ?? 1;
        state.chat.showAllTools = !!state.uiPrefs.showAllTools;
        applyChatZoom();
        if (els.chatMessages) els.chatMessages.classList.toggle('show-all-tools', state.chat.showAllTools);
        if (els.chatToggleTools) els.chatToggleTools.style.color = state.chat.showAllTools ? 'var(--accent)' : '';
        const chatPrompt = document.querySelector('.chat-system-prompt');
        if (chatPrompt) chatPrompt.classList.toggle('collapsed', state.uiPrefs.chatPromptCollapsed !== false);
        if (els.settingsSearchInput && state.uiPrefs.settingsSearch) {
            els.settingsSearchInput.value = state.uiPrefs.settingsSearch;
        }
        if (els.virtualListEnabled) els.virtualListEnabled.checked = state.uiPrefs.virtualListEnabled !== false;
        if (els.virtualBatchSize) els.virtualBatchSize.value = String(state.uiPrefs.virtualBatchSize ?? 200);
	        if (els.virtualMaxBatches) els.virtualMaxBatches.value = String(state.uiPrefs.virtualMaxBatches ?? 3);
	        if (els.autoLoadOnScroll) els.autoLoadOnScroll.checked = state.uiPrefs.autoLoadOnScroll !== false;
	        if (els.modalPageSize) els.modalPageSize.value = String(getModalPageSize());
	        if (els.warnLoadAll) els.warnLoadAll.checked = state.uiPrefs.warnOnLoadAll !== false;
	        applyVirtualPrefs();
	        updateSidebarExportButton();
	    } catch (e) { }
}

function saveUiPrefs() {
    state.uiPrefs.currentTab = state.currentTab;
    state.uiPrefs.chatZoom = Number(state.chat.zoomLevel) || 1;
    state.uiPrefs.showAllTools = !!state.chat.showAllTools;
    state.uiPrefs.chatPromptCollapsed = document.querySelector('.chat-system-prompt')?.classList.contains('collapsed') ?? true;
    state.uiPrefs.settingsSearch = els.settingsSearchInput?.value || '';
    state.uiPrefs.lastExportFormat = normalizeExportFormat(state.uiPrefs.lastExportFormat);
    state.uiPrefs.exportFolder = (state.uiPrefs.exportFolder === 'rejected') ? 'rejected' : 'wanted';
	    state.uiPrefs.exportSystemMode = normalizeExportSystemMode(state.uiPrefs.exportSystemMode);
	    state.uiPrefs.exportPromptSource = ['custom', 'chat', 'generate'].includes(state.uiPrefs.exportPromptSource) ? state.uiPrefs.exportPromptSource : 'custom';
	    state.uiPrefs.modalPageSize = clampNumber(state.uiPrefs.modalPageSize, { min: 50, max: 2000, fallback: MODAL_PAGE_SIZE });
	    if (els.warnLoadAll) state.uiPrefs.warnOnLoadAll = els.warnLoadAll.checked !== false;
	    state.uiPrefs.warnOnLoadAll = state.uiPrefs.warnOnLoadAll !== false;
	    state.uiPrefs.skipLoadAllWarning = !state.uiPrefs.warnOnLoadAll;
	    dbSet('settings', UI_PREFS_KEY, state.uiPrefs).catch(() => { });
}

// ============ CREDENTIAL DRAFT (Local-only) ============
const CRED_DRAFT_SESSION_KEY = 'credentialDraft';
async function loadCredentialDraft() {
    try {
        let saved = null;
        try {
            const raw = sessionStorage.getItem(CRED_DRAFT_SESSION_KEY);
            if (raw) saved = JSON.parse(raw);
        } catch (e) { }
        if (!saved) {
            saved = await dbGet('settings', 'credentialDraft');
            // Legacy cleanup: older builds persisted sensitive drafts to IndexedDB.
            if (saved) dbDelete('settings', 'credentialDraft').catch(() => { });
        }
        if (!saved || typeof saved !== 'object') return;
        const safe = {
            openai: { api_key: '', base_url: '' },
            anthropic: { api_key: '', base_url: '' },
            google: { api_key: '', base_url: '' },
            ...saved
        };
        // Normalize shape
        for (const p of ['openai', 'anthropic', 'google']) {
            safe[p] = {
                api_key: String(safe[p]?.api_key || ''),
                base_url: String(safe[p]?.base_url || '')
            };
        }
        state.credentialDraft = safe;
        saveCredentialDraft();
    } catch (e) { }
}

function saveCredentialDraft() {
    try {
        sessionStorage.setItem(CRED_DRAFT_SESSION_KEY, JSON.stringify(state.credentialDraft));
    } catch (e) { }
    return Promise.resolve();
}

function getCredentialOverride(provider) {
    const d = state.credentialDraft?.[provider] || {};
    const api_key = String(d.api_key || '').trim();
    const base_url = String(d.base_url || '').trim();
    if (!api_key && !base_url) return null;
    return {
        ...(api_key ? { api_key } : {}),
        ...(base_url ? { base_url } : {})
    };
}

function setCredentialDraft(provider, patch) {
    if (!provider) return;
    const prev = state.credentialDraft?.[provider] || { api_key: '', base_url: '' };
    state.credentialDraft[provider] = {
        api_key: String(patch.api_key ?? prev.api_key ?? ''),
        base_url: String(patch.base_url ?? prev.base_url ?? '')
    };
    saveCredentialDraft();
    updateProviderUI();
}

function clearCredentialDraft(provider) {
    if (!provider) return;
    state.credentialDraft[provider] = { api_key: '', base_url: '' };
    saveCredentialDraft();
    updateProviderUI();
}

function clampNumber(val, { min = -Infinity, max = Infinity, fallback = 0 } = {}) {
    const num = Number(val);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, num));
}

function getModalPageSize() {
    return clampNumber(state.uiPrefs?.modalPageSize, { min: 50, max: 2000, fallback: MODAL_PAGE_SIZE });
}

function applyVirtualPrefs() {
    const enabled = state.uiPrefs.virtualListEnabled !== false;
    const batchSize = clampNumber(state.uiPrefs.virtualBatchSize, { min: 50, max: 2000, fallback: 200 });
    const maxBatches = clampNumber(state.uiPrefs.virtualMaxBatches, { min: 1, max: 20, fallback: 3 });
    const autoLoad = state.uiPrefs.autoLoadOnScroll !== false;

    state.uiPrefs.virtualListEnabled = enabled;
    state.uiPrefs.virtualBatchSize = batchSize;
    state.uiPrefs.virtualMaxBatches = maxBatches;
    state.uiPrefs.autoLoadOnScroll = autoLoad;

    [state.filesModal, state.export, state.reviewBrowser].forEach(slice => {
        slice.virtualEnabled = enabled;
        slice.virtualBatchSize = batchSize;
        slice.virtualMaxBatches = maxBatches;
        slice.autoLoadOnScroll = autoLoad;
        if (!slice.virtualRowHeight) slice.virtualRowHeight = 64;
        slice.virtualRafPending = false;
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
    serverConfig: null,
    credentialDraft: {
        openai: { api_key: '', base_url: '' },
        anthropic: { api_key: '', base_url: '' },
        google: { api_key: '', base_url: '' }
    },
    credentialPresets: {
        openai: { key_presets: [], url_presets: [], active: { key_preset: '', url_preset: '' } },
        anthropic: { key_presets: [], url_presets: [], active: { key_preset: '', url_preset: '' } },
        google: { key_presets: [], url_presets: [], active: { key_preset: '', url_preset: '' } }
    },
    currentTab: 'generate',
    prompts: [],
    currentPromptName: '',
    listIterators: {},
    macroTraceLast: null, // last resolved macro values (non-preview)
    generate: {
        prompt: '',
        variables: {},
        variableNames: [],
        variablePresetName: '',
        conversation: null,
        rawText: '',
        lastResolvedPrompt: '',
        lastMacroTrace: null,
        isEditing: false,
        isLoading: false,
        abortController: null
    },
    chat: {
        messages: [],
        isStreaming: false,
        systemPrompt: '',
        presetName: '',
        lastResolvedSystemPrompt: '',
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
        selectedIds: new Set(),
        pendingSelection: null,
        anchorId: null,
        previewId: null,
        previewConversation: null,
        offset: 0,
        total: 0,
        hasMore: false,
        isLoading: false,
        renderedCount: 0,
        seenIds: new Set(),
        idToIndex: new Map(),
        virtualEnabled: true,
	        virtualBatchSize: 200,
	        virtualMaxBatches: 3,
	        virtualRowHeight: 60,
	        virtualRafPending: false,
        autoLoadOnScroll: true,
        loadAllTaskId: null,
        loadAllController: null,
        requestSeq: 0
    },
    export: {
	        selectedIds: new Set(),
	        anchorId: null,
	        previewId: null,
	        previewConversation: null,
	        files: [],
	        folder: 'wanted',
            systemPromptMode: 'add_if_missing',
	        systemPrompt: '',
	        presetName: '',
	        offset: 0,
        total: 0,
        hasMore: false,
        isLoading: false,
        renderedCount: 0,
        seenIds: new Set(),
        idToIndex: new Map(),
        virtualEnabled: true,
	        virtualBatchSize: 200,
	        virtualMaxBatches: 3,
	        virtualRowHeight: 60,
	        virtualRafPending: false,
        autoLoadOnScroll: true,
        loadAllTaskId: null,
        loadAllController: null,
        requestSeq: 0
    },
    exportedDatasets: [],
    review: {
        queue: [],
        currentIndex: 0,
        isEditing: false,
        pageOffset: 0,
        total: 0,
        hasMore: false,
        isLoading: false,
        currentItemLoading: false,
        deferredRestoreApplied: false,
        requestSeq: 0
    },
	    reviewBrowser: {
        items: [],
        selectedIds: new Set(),
        anchorId: null,
        previewId: null,
        previewConversation: null,
        previewLoading: false,
        offset: 0,
        total: 0,
        hasMore: false,
        isLoading: false,
        renderedCount: 0,
        seenIds: new Set(),
        idToIndex: new Map(),
        virtualEnabled: true,
	        virtualBatchSize: 200,
	        virtualMaxBatches: 3,
	        virtualRowHeight: 60,
        virtualRafPending: false,
        autoLoadOnScroll: true,
        loadAllTaskId: null,
        loadAllController: null,
        requestSeq: 0,
        currentRequest: null
    },
    bulk: {
        isRunning: false,
        pauseRequested: false,
        isPaused: false,
        pauseResolver: null,
        total: 0,
        completed: 0,
        abortController: null,
        runs: [],
        selectedRunIndex: null,
        activeIndex: null
    },
    tags: [],
    customParams: {},
    promptHistory: [], // array of {text, timestamp}
    promptPreview: { text: '', trace: null },
    tasks: {
        nextId: 1,
        items: new Map()
    },
    modelActivity: {
        runId: 0,
        phase: 'idle', // idle|waiting|thinking|writing|done|error|canceled
        label: '',
        provider: '',
        model: '',
        source: '',
        raw: '',
        hasFirstToken: false
    },
	    uiPrefs: {
	        currentTab: 'generate',
	        chatZoom: 1,
	        showAllTools: false,
	        chatPromptCollapsed: true,
	        settingsSearch: '',
	        lastExportFormat: 'sharegpt',
	        exportFolder: 'wanted',
	        exportSystemMode: 'add_if_missing',
	        exportPromptSource: 'custom',
	        modalPageSize: 100,
	        warnOnLoadAll: true,
	        skipLoadAllWarning: false, // legacy (migrated to warnOnLoadAll)
	        virtualListEnabled: true,
	        virtualBatchSize: 200,
	        virtualMaxBatches: 3,
	        autoLoadOnScroll: true
	    }
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

function ensureVirtualListStructure(container) {
    if (!container) return null;
    container.classList.add('virtual-list');
    let topSpacer = container.querySelector('.virtual-spacer[data-spacer="top"]');
    let bottomSpacer = container.querySelector('.virtual-spacer[data-spacer="bottom"]');
    let itemsHost = container.querySelector('.virtual-items-host');
    let loadingRow = container.querySelector('.virtual-loading');
    if (!topSpacer || !bottomSpacer || !itemsHost || !loadingRow) {
        container.innerHTML = `
            <div class="virtual-spacer" data-spacer="top"></div>
            <div class="virtual-items-host"></div>
            <div class="virtual-spacer" data-spacer="bottom"></div>
            <div class="virtual-loading" hidden>
                <div class="virtual-spinner" aria-hidden="true"></div>
                <div class="virtual-loading-text">Loading more...</div>
            </div>
        `;
        topSpacer = container.querySelector('.virtual-spacer[data-spacer="top"]');
        bottomSpacer = container.querySelector('.virtual-spacer[data-spacer="bottom"]');
        itemsHost = container.querySelector('.virtual-items-host');
        loadingRow = container.querySelector('.virtual-loading');
    }
    return { topSpacer, itemsHost, bottomSpacer, loadingRow };
}

function renderVirtualWindow({ slice, container, items, renderRowHtml }) {
    if (!container) return;

    if (!items || items.length === 0) {
        container.innerHTML = slice?.isLoading
            ? '<div class="empty-files"><span class="inline-spinner"></span> Loading...</div>'
            : '<div class="empty-files">No items found</div>';
        slice.renderedCount = 0;
        slice.virtualWindowStart = 0;
        slice.virtualWindowEnd = 0;
        slice.virtualRenderedItemsLength = 0;
        return;
    }

    if (!slice.virtualEnabled) {
        container.innerHTML = items.map(renderRowHtml).join('');
        slice.renderedCount = items.length;
        slice.virtualWindowStart = 0;
        slice.virtualWindowEnd = items.length;
        slice.virtualRenderedItemsLength = items.length;
        return;
    }

    const parts = ensureVirtualListStructure(container);
    if (!parts) return;

    const batchSize = slice.virtualBatchSize || 200;
    const maxBatches = slice.virtualMaxBatches || 3;
    const rowHeight = slice.virtualRowHeight || 64;

    const safeBatch = Math.max(20, Math.min(5000, batchSize));
    const safeMaxBatches = Math.max(1, Math.min(30, maxBatches));
    const totalChunks = Math.max(1, Math.ceil(items.length / safeBatch));
    const windowChunks = Math.min(totalChunks, safeMaxBatches);

    // Chunk-based windowing: only swap the rendered window when you cross a chunk boundary.
    const firstIndex = Math.max(0, Math.floor((container.scrollTop || 0) / rowHeight));
    const chunkIndex = Math.floor(firstIndex / safeBatch);
    const maxStartChunk = Math.max(0, totalChunks - windowChunks);
    const desiredStartChunk = Math.max(0, Math.min(chunkIndex - Math.floor(windowChunks / 2), maxStartChunk));
    const windowStart = desiredStartChunk * safeBatch;
    const windowEnd = Math.min(items.length, windowStart + windowChunks * safeBatch);

    const needsHostRender =
        slice.virtualWindowStart !== windowStart ||
        slice.virtualWindowEnd !== windowEnd ||
        slice.virtualRenderedItemsLength !== items.length;

    const topH = `${windowStart * rowHeight}px`;
    const bottomH = `${Math.max(0, (items.length - windowEnd) * rowHeight)}px`;
    if (parts.topSpacer.style.height !== topH) parts.topSpacer.style.height = topH;
    if (parts.bottomSpacer.style.height !== bottomH) parts.bottomSpacer.style.height = bottomH;

    if (needsHostRender) {
        let html = '';
        for (let i = windowStart; i < windowEnd; i++) html += renderRowHtml(items[i]);
        parts.itemsHost.innerHTML = html;
        parts.itemsHost.classList.remove('virtual-swap');
        parts.itemsHost.classList.add('virtual-swap');
        requestAnimationFrame(() => parts.itemsHost.classList.remove('virtual-swap'));
        slice.virtualWindowStart = windowStart;
        slice.virtualWindowEnd = windowEnd;
        slice.virtualRenderedItemsLength = items.length;
    }

    slice.renderedCount = windowEnd - windowStart;

    // Loading indicator (sticky) for paged lists.
    if (parts.loadingRow) {
        const show = (items.length > 0) && !!slice.hasMore && (!!slice.isLoading || !!slice.isLoadAllRunning);
        const shouldBeHidden = !show;
        if (parts.loadingRow.hidden !== shouldBeHidden) parts.loadingRow.hidden = shouldBeHidden;
    }

    // Update row height estimate once, after first render.
    if (!slice.virtualRowHeightMeasured) {
        const firstRow = parts.itemsHost.firstElementChild;
        if (firstRow && firstRow.offsetHeight) {
            slice.virtualRowHeight = Math.max(40, Math.min(220, firstRow.offsetHeight));
            slice.virtualRowHeightMeasured = true;
        }
    }
}

function createTask({ title, detail = '', onCancel = null } = {}) {
    const id = state.tasks.nextId++;
    state.tasks.items.set(id, {
        id,
        title: String(title || 'Working...'),
        detail: String(detail || ''),
        current: null,
        total: null,
        indeterminate: true,
        status: 'running',
        onCancel
    });
    renderTasks();
    return id;
}

function updateTask(id, { detail, current, total, indeterminate } = {}) {
    const task = state.tasks.items.get(id);
    if (!task) return;
    if (detail !== undefined) task.detail = String(detail);
    if (current !== undefined) task.current = current;
    if (total !== undefined) task.total = total;
    if (indeterminate !== undefined) task.indeterminate = !!indeterminate;
    renderTasks();
}

function finishTask(id, { status = 'done', detail } = {}) {
    const task = state.tasks.items.get(id);
    if (!task) return;
    task.status = status;
    if (detail !== undefined) task.detail = String(detail);
    renderTasks();
    setTimeout(() => {
        state.tasks.items.delete(id);
        renderTasks();
    }, 1500);
}

function buildTaskCard(taskId) {
    const card = document.createElement('div');
    card.className = 'task-card';
    card.dataset.taskId = String(taskId);

    const header = document.createElement('div');
    header.className = 'task-header';

    const title = document.createElement('div');
    title.className = 'task-title';
    const spinner = document.createElement('span');
    spinner.className = 'task-mini-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const titleText = document.createElement('span');
    const status = document.createElement('span');
    status.className = 'muted small';
    status.hidden = true;
    title.appendChild(spinner);
    title.appendChild(titleText);
    title.appendChild(status);

    const cancel = document.createElement('button');
    cancel.className = 'task-cancel';
    cancel.type = 'button';
    cancel.title = 'Cancel';
    cancel.textContent = '×';

    header.appendChild(title);
    header.appendChild(cancel);

    const detail = document.createElement('div');
    detail.className = 'task-detail';
    detail.hidden = true;

    const progress = document.createElement('div');
    progress.className = 'task-progress';
    const progressText = document.createElement('span');
    const progressPct = document.createElement('span');
    progress.appendChild(progressText);
    progress.appendChild(progressPct);

    const bar = document.createElement('div');
    bar.className = 'task-bar';
    const barInner = document.createElement('div');
    bar.appendChild(barInner);

    card.appendChild(header);
    card.appendChild(detail);
    card.appendChild(progress);
    card.appendChild(bar);

    card._refs = { spinner, titleText, status, cancel, detail, progressText, progressPct, bar, barInner };
    return card;
}

function renderTasks() {
    if (!els.taskTracker) return;
    if (!els.taskTracker._taskCards) els.taskTracker._taskCards = new Map();
    const cards = els.taskTracker._taskCards;
    const tasks = Array.from(state.tasks.items.values());

    if (tasks.length === 0) {
        cards.forEach(card => {
            card.classList.add('leaving');
            setTimeout(() => card.remove(), 240);
        });
        cards.clear();
        els.taskTracker.innerHTML = '';
        return;
    }

    const activeIds = new Set(tasks.map(t => t.id));
    for (const [id, card] of cards.entries()) {
        if (!activeIds.has(id)) {
            card.classList.add('leaving');
            setTimeout(() => card.remove(), 240);
            cards.delete(id);
        }
    }

    for (const task of tasks) {
        let card = cards.get(task.id);
        if (!card) {
            card = buildTaskCard(task.id);
            cards.set(task.id, card);
            els.taskTracker.appendChild(card);
            requestAnimationFrame(() => card.classList.add('show'));
        } else {
            card.classList.remove('leaving');
            card.classList.add('show');
            // Keep DOM order aligned with current task order.
            if (card !== els.taskTracker.lastElementChild) {
                // Append moves the node if it already exists.
                els.taskTracker.appendChild(card);
            }
        }

        const refs = card._refs;
        const hasProgress = typeof task.current === 'number' && typeof task.total === 'number' && task.total > 0;
        const pct = hasProgress ? Math.max(0, Math.min(100, (task.current / task.total) * 100)) : 0;
        const statusLabel = task.status === 'canceled' ? 'Canceled' : task.status === 'error' ? 'Error' : task.status === 'done' ? 'Done' : '';
        const progressText = hasProgress
            ? `${Math.min(task.current, task.total)}/${task.total}`
            : (task.status === 'running' ? 'Working...' : '');

        refs.spinner.hidden = task.status !== 'running';
        refs.titleText.textContent = String(task.title || 'Working...');
        refs.status.hidden = !statusLabel;
        refs.status.textContent = statusLabel ? `(${statusLabel})` : '';

        const d = String(task.detail || '');
        refs.detail.hidden = !d;
        refs.detail.textContent = d;

        refs.progressText.textContent = progressText;
        refs.progressPct.textContent = hasProgress ? `${Math.round(pct)}%` : '';

        refs.bar.classList.toggle('task-bar-indeterminate', !hasProgress && task.status === 'running');
        refs.bar.classList.toggle('task-bar-muted', !hasProgress && task.status !== 'running');
        refs.barInner.style.width = hasProgress ? `${pct.toFixed(2)}%` : '';

        refs.cancel.disabled = task.status !== 'running';
        refs.cancel.onclick = () => {
            const t = state.tasks.items.get(task.id);
            if (!t || t.status !== 'running') return;
            try { t.onCancel?.(); } catch (_e) { }
            t.status = 'canceled';
            renderTasks();
            setTimeout(() => {
                state.tasks.items.delete(task.id);
                renderTasks();
            }, 800);
        };
    }
}

function setupVirtualListScroll({ slice, container, render, loadMore }) {
    if (!container || container._virtualScrollBound) return;
    container._virtualScrollBound = true;

    const maybeLoadMore = () => {
        if (!slice.autoLoadOnScroll) return;
        if (!slice.hasMore || slice.isLoading) return;
        const threshold = 280;
        const nearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - threshold;
        if (nearBottom) loadMore?.();
    };

    container.addEventListener('scroll', () => {
        if (slice.virtualRafPending) return;
        slice.virtualRafPending = true;
        requestAnimationFrame(() => {
            slice.virtualRafPending = false;
            render?.();
            maybeLoadMore();
        });
    }, { passive: true });
}

function isTaskActive(taskId) {
    return !!taskId && state.tasks.items.has(taskId);
}

async function startLoadAllForSlice({ slice, title, loadNextPage, hasMore, getProgressDetail }) {
    if (isTaskActive(slice.loadAllTaskId)) {
        toast('Already loading...', 'info');
        return;
    }
    const canLoadMore = !!hasMore?.();
    if (!canLoadMore && !slice.isLoading) {
        toast('Nothing to load', 'info');
        return;
    }

    if (state.uiPrefs.warnOnLoadAll !== false) {
        const { confirmed, checked } = await popupConfirmWithCheckbox({
            title: 'Load All',
            message: `Load All can be slow on large datasets.\n\nTip: Auto-load while scrolling is usually enough. If you see lag, lower "Modal fetch size" in Settings → Advanced.`,
            confirmText: 'Load All',
            cancelText: 'Cancel',
            danger: false,
            checkboxLabel: 'Do not ask again',
            checkboxChecked: false,
        });
        if (!confirmed) return;
        if (checked) {
            state.uiPrefs.warnOnLoadAll = false;
            state.uiPrefs.skipLoadAllWarning = true;
            if (els.warnLoadAll) els.warnLoadAll.checked = false;
            saveUiPrefs();
        }
    }
    const controller = new AbortController();
    slice.loadAllController = controller;
    slice.isLoadAllRunning = true;
    const taskId = createTask({
        title,
        detail: typeof getProgressDetail === 'function' ? (getProgressDetail() || '') : (getProgressDetail || ''),
        onCancel: () => controller.abort()
    });
    slice.loadAllTaskId = taskId;

    const getLoadedCount = () => (
        Array.isArray(slice.files) ? slice.files.length
            : Array.isArray(slice.items) ? slice.items.length
                : Array.isArray(slice.queue) ? slice.queue.length
                    : (slice.offset || 0)
    );
    const loadedAtStart = getLoadedCount();

    const pushProgress = () => {
        const total = slice.total || 0;
        const loaded = getLoadedCount();
        const current = total ? Math.min(loaded, total) : null;
        updateTask(taskId, {
            detail: typeof getProgressDetail === 'function' ? (getProgressDetail() || '') : (getProgressDetail || ''),
            current,
            total: total || null,
            indeterminate: !total
        });
    };

    pushProgress();
    try {
        await loadAllPages(loadNextPage, hasMore, {
            signal: controller.signal,
            onProgress: pushProgress
        });
        if (controller.signal.aborted) {
            finishTask(taskId, { status: 'canceled', detail: 'Canceled' });
        } else {
            const loadedAtEnd = getLoadedCount();
            const nothingLoaded = loadedAtEnd <= loadedAtStart && (!hasMore() || (slice.total || 0) === 0);
            pushProgress();
            finishTask(taskId, { status: 'done', detail: nothingLoaded ? 'Nothing to load' : 'Done' });
        }
    } catch (e) {
        if (e?.name === 'AbortError' || controller.signal.aborted) {
            finishTask(taskId, { status: 'canceled', detail: 'Canceled' });
        } else {
            console.error('Load all failed:', e);
            finishTask(taskId, { status: 'error', detail: e?.message || 'Failed' });
        }
    } finally {
        if (slice.loadAllTaskId === taskId) slice.loadAllTaskId = null;
        if (slice.loadAllController === controller) slice.loadAllController = null;
        slice.isLoadAllRunning = false;
    }
}

function cancelSliceLoadAll(slice, reason = 'Canceled') {
    if (isTaskActive(slice.loadAllTaskId)) {
        try { slice.loadAllController?.abort(); } catch (_e) { }
        finishTask(slice.loadAllTaskId, { status: 'canceled', detail: reason });
    }
    slice.loadAllTaskId = null;
    slice.loadAllController = null;
    slice.isLoadAllRunning = false;
}

function beginSliceRequest(slice) {
    const requestSeq = (slice.requestSeq || 0) + 1;
    slice.requestSeq = requestSeq;
    return requestSeq;
}

function isSliceRequestStale(slice, requestSeq, signal = null) {
    return slice.requestSeq !== requestSeq || !!signal?.aborted;
}

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
        openSettingsBtn: $('#open-settings-btn'),
        openExportBtn: $('#open-export-btn'),
        sidebarExportFormat: $('#sidebar-export-format'),
        provider: $('#provider'),
        model: $('#model'),
        modelInput: $('#model-input'),
        modelDatalist: $('#model-datalist'),
        refreshModels: $('#refresh-models'),
        temperature: $('#temperature'),
        tempValue: $('#temp-value'),
        maxOutputTokens: $('#max-output-tokens'),
        apiStatus: $('#api-status'),
        credDraftWarning: $('#cred-draft-warning'),
        sidebarCredKeyActive: $('#sidebar-cred-key-active'),
        sidebarCredUrlActive: $('#sidebar-cred-url-active'),
        sidebarCredKeyDraft: $('#sidebar-cred-key-draft'),
        sidebarCredUrlDraft: $('#sidebar-cred-url-draft'),
        sidebarCredKeyToggle: $('#sidebar-cred-key-toggle'),
        sidebarCredKeyLoad: $('#sidebar-cred-key-load'),
        sidebarCredKeySave: $('#sidebar-cred-key-save'),
        sidebarCredKeyAdd: $('#sidebar-cred-key-add'),
        sidebarCredKeyDel: $('#sidebar-cred-key-del'),
        sidebarCredUrlLoad: $('#sidebar-cred-url-load'),
        sidebarCredUrlSave: $('#sidebar-cred-url-save'),
        sidebarCredUrlAdd: $('#sidebar-cred-url-add'),
        sidebarCredUrlDel: $('#sidebar-cred-url-del'),
        // Files Modal
        openFilesBtn: $('#open-files-btn'),
        filesModal: $('#files-modal'),
        closeFilesModal: $('#close-files-modal'),
        filesSearchInput: $('#files-search-input'),
        filesModalList: $('#files-modal-list'),
        filesModalCount: $('#files-modal-count'),
        filesSelectToggle: $('#files-select-toggle'),
        filesSelectToggleRejected: $('#files-select-toggle-rejected'),
        filesClearSelection: $('#files-clear-selection'),
        filesSelectionChip: $('#files-selection-chip'),
        filesLoadAll: $('#files-load-all'),
        filesLoadAllRejected: $('#files-load-all-rejected'),
        filesPreview: $('#files-preview'),
        filesBulkActionsWanted: $('#files-bulk-actions-wanted'),
        filesBulkActionsRejected: $('#files-bulk-actions-rejected'),
        filesBulkDeleteRejected: $('#files-bulk-delete-rejected'),

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
        newPreset: $('#new-preset'),
        deletePreset: $('#delete-preset'),
        tokenCount: $('#token-count'),
        bulkCount: $('#bulk-count'),
        generateBtn: $('#generate-btn'),
        bulkProgress: $('#bulk-progress'),
        bulkProgressFill: $('#bulk-progress-fill'),
        bulkProgressText: $('#bulk-progress-text'),
        bulkDetails: $('#bulk-details'),
        bulkPause: $('#bulk-pause'),
        bulkDetailsModal: $('#bulk-details-modal'),
        closeBulkDetailsModal: $('#close-bulk-details-modal'),
        bulkDetailsList: $('#bulk-details-list'),
        bulkDetailsPreview: $('#bulk-details-preview'),
        bulkDetailsSummary: $('#bulk-details-summary'),
        bulkDetailsClear: $('#bulk-details-clear'),
        bulkCancel: $('#bulk-cancel'),
        conversationView: $('#conversation-view'),
        conversationEdit: $('#conversation-edit'),
        editToggle: $('#edit-toggle'),
        turnCount: $('#turn-count'),
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
        newChatPreset: $('#new-chat-preset'),
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
        reviewEditInput: $('#review-edit'),
        reviewEditCancelBtn: $('#review-edit-cancel-btn'),
        openReviewBrowserBtn: $('#open-review-browser-btn'),
        keepAllBtn: $('#keep-all-btn'),
        rejectAllBtn: $('#reject-all-btn'),
        clearQueueBtn: $('#clear-queue-btn'),

        // Modals
        rejectModal: $('#reject-modal'),
        cancelReject: $('#cancel-reject'),
        settingsModal: $('#settings-modal'),
        closeSettingsModal: $('#close-settings-modal'),
        settingsSearchInput: $('#settings-search-input'),
        exportModal: $('#export-modal'),
        exportSearchInput: $('#export-search-input'),
        exportFolder: $('#export-folder'),
        exportFormat: $('#export-format'),
        exportPromptSourceCustom: $('#export-prompt-source-custom'),
        exportPromptSourceChat: $('#export-prompt-source-chat'),
        exportPromptSourceGenerate: $('#export-prompt-source-generate'),
        exportCustomPromptGroup: $('#export-custom-prompt-group'),
        exportSystemModeBtn: $('#export-system-mode-btn'),
        exportSystemModeSummary: $('#export-system-mode-summary'),
        exportSystemModeModal: $('#export-system-mode-modal'),
        closeExportSystemModeModal: $('#close-export-system-mode-modal'),
        exportSystemModeCards: $('#export-system-mode-cards'),
        exportSystemModeCancel: $('#export-system-mode-cancel'),
        exportSystemModeApply: $('#export-system-mode-apply'),
        exportSystemPrompt: $('#export-system-prompt'),
        exportPresetSelect: $('#export-preset-select'),
        saveExportPreset: $('#save-export-preset'),
        newExportPreset: $('#new-export-preset'),
        deleteExportPreset: $('#delete-export-preset'),
        exportFileCount: $('#export-file-count'),
        exportFileList: $('#export-file-list'),
        exportSelectToggle: $('#export-select-toggle'),
        exportClearSelection: $('#export-clear-selection'),
        exportSelectionChip: $('#export-selection-chip'),
        exportLoadAll: $('#export-load-all'),
        exportPreview: $('#export-preview'),
        exportPaginationStatus: $('#export-pagination-status'),
        closeExport: $('#close-export'),
        confirmExport: $('#confirm-export'),
        cancelExport: $('#cancel-export'),
        filesPaginationStatus: $('#files-pagination-status'),

        // Toast
        toastContainer: $('#toast-container'),
        taskTracker: $('#task-tracker'),
        modelActivityIndicator: $('#model-activity-indicator'),
        modelActivitySpinner: $('#model-activity-spinner'),
        modelActivityLabel: $('#model-activity-label'),
        modelActivityMeta: $('#model-activity-meta'),
        modelActivityOpen: $('#model-activity-open'),
        modelActivityDismiss: $('#model-activity-dismiss'),
        modelInspectorModal: $('#model-inspector-modal'),
        closeModelInspectorModal: $('#close-model-inspector-modal'),
        modelInspectorStatus: $('#model-inspector-status'),
        modelInspectorMeta: $('#model-inspector-meta'),
        modelInspectorRaw: $('#model-inspector-raw'),
        modelInspectorCopy: $('#model-inspector-copy'),
        modelInspectorClear: $('#model-inspector-clear'),
        exportPreviewModal: $('#export-preview-modal'),
        closeExportPreviewModal: $('#close-export-preview-modal'),
        exportPreviewSummary: $('#export-preview-summary'),
        exportPreviewJsonl: $('#export-preview-jsonl'),
        copyExportPreview: $('#copy-export-preview'),
        promptPreviewModal: $('#prompt-preview-modal'),
        closePromptPreviewModal: $('#close-prompt-preview-modal'),
        promptPreviewText: $('#prompt-preview-text'),
        promptPreviewTrace: $('#prompt-preview-trace'),
        promptPreviewCopy: $('#prompt-preview-copy'),
        promptPreviewCopyTrace: $('#prompt-preview-copy-trace'),
        promptPreviewClose: $('#prompt-preview-close'),
        credPickerModal: $('#cred-picker-modal'),
        credPickerClose: $('#cred-picker-close'),
        credPickerTabKey: $('#cred-picker-tab-key'),
        credPickerTabUrl: $('#cred-picker-tab-url'),
        credPickerSearch: $('#cred-picker-search'),
        credPickerList: $('#cred-picker-list'),
        popupModal: $('#popup-modal'),
        popupTitle: $('#popup-title'),
        popupMessage: $('#popup-message'),
        popupInputGroup: $('#popup-input-group'),
        popupInputLabel: $('#popup-input-label'),
        popupInput: $('#popup-input'),
        popupHint: $('#popup-hint'),
        popupCheckboxGroup: $('#popup-checkbox-group'),
        popupCheckbox: $('#popup-checkbox'),
        popupCheckboxLabel: $('#popup-checkbox-label'),
        popupClose: $('#popup-close'),
        popupCancel: $('#popup-cancel'),
        popupConfirm: $('#popup-confirm'),

        // Clear toggle
        clearGenBtn: $('#clear-gen-btn'),

        // Custom Parameters
        customParamsList: $('#custom-params-list'),
        openCustomParamsBtn: $('#open-custom-params-btn'),
        customParamsModal: $('#custom-params-modal'),
        closeCustomParamsModal: $('#close-custom-params-modal'),
        customParamsSearchInput: $('#custom-params-search-input'),
        customParamsModalList: $('#custom-params-modal-list'),
        customParamKey: $('#custom-param-key'),
        customParamValue: $('#custom-param-value'),
        customParamAddBtn: $('#custom-param-add-btn'),

        // Macros & History
        openMacrosBtn: $('#open-macros-btn'),
        macrosModal: $('#macros-modal'),
        closeMacrosModal: $('#close-macros-modal'),
        viewExportedDatasetsBtn: $('#view-exported-datasets-btn'),
        exportedDatasetsModal: $('#exported-datasets-modal'),
        closeExportedDatasetsModal: $('#close-exported-datasets-modal'),
        exportedDatasetsList: $('#exported-datasets-list'),
        exportedDatasetsSearchInput: $('#exported-datasets-search-input'),
        exportFilename: $('#export-filename'),
        exportWriteManifest: $('#export-write-manifest'),
        previewExport: $('#preview-export'),
        reviewBrowserModal: $('#review-browser-modal'),
        closeReviewBrowserModal: $('#close-review-browser-modal'),
        reviewBrowserSearchInput: $('#review-browser-search-input'),
        reviewBrowserList: $('#review-browser-list'),
        reviewBrowserPreview: $('#review-browser-preview'),
        reviewBrowserCount: $('#review-browser-count'),
        reviewBrowserSelectionChip: $('#review-browser-selection-chip'),
        reviewBrowserClearSelection: $('#review-browser-clear-selection'),
        reviewBrowserSelectToggle: $('#review-browser-select-toggle'),
        reviewBrowserLoadAll: $('#review-browser-load-all'),
        reviewBrowserBulkKeep: $('#review-browser-bulk-keep'),
        reviewBrowserBulkReject: $('#review-browser-bulk-reject'),
        reviewBrowserPaginationStatus: $('#review-browser-pagination-status'),
        macrosBadge: $('#macros-badge'),
        openHistoryBtn: $('#open-history-btn'),
        previewResolvedBtn: $('#preview-resolved-btn'),
        promptHistoryList: $('#prompt-history-list'),
        clearHistoryBtn: $('#clear-history-btn'),
        builderType: $('#builder-type'),
        builderItems: $('#builder-items'),
        builderItemsSection: $('#builder-items-section'),
        builderRollSection: $('#builder-roll-section'),
        builderRollInput: $('#builder-roll-input'),
	        builderPreviewText: $('#builder-preview-text'),
	        builderCopy: $('#builder-copy'),
	        historyMaxSetting: $('#history-max-setting'),
	        bulkRetryAttempts: $('#bulk-retry-attempts'),
	        resetMacrosBtn: $('#reset-macros-btn'),
	        macrosStateBody: $('#macros-state-body')
	        ,
	        // Database settings
	        databasePath: $('#database-path'),
        databasePathOptions: $('#database-path-options'),
        applyDatabasePath: $('#apply-database-path'),
	        scanDatabasePaths: $('#scan-database-paths'),
	        backupDatabaseBtn: $('#backup-database-btn'),
	        databasePathNote: $('#database-path-note'),
	        warnLoadAll: $('#warn-load-all'),

        // Advanced settings
        virtualListEnabled: $('#virtual-list-enabled'),
        virtualBatchSize: $('#virtual-batch-size'),
        virtualMaxBatches: $('#virtual-max-batches'),
        autoLoadOnScroll: $('#auto-load-on-scroll'),
        modalPageSize: $('#modal-page-size')
    };

    // Initialize sync engine
    syncEngine.init();
    await loadSyncSettings();
    await loadHotkeys();
    await loadUiPrefs();
    await loadCredentialDraft();
    applyVirtualPrefs();
    updateSidebarExportButton();
    state._restoredDraft = await restoreDraft();

    // Load data
    await Promise.all([
        loadServerConfig(),
        loadConfig()
    ]);
    await Promise.all([
        loadCredentialPresets(els.provider.value),
        loadPrompts(),
        loadStats(),
        ensureModelsLoaded(),
        loadPresets(),
        loadChatPresets(),
        loadExportPresets()
    ]);
    applyFirstRunDefaults();
    const initialTab = state.uiPrefs.currentTab || state.currentTab;
    if (initialTab === 'review') {
        state.review.deferredRestoreApplied = true;
        await loadReviewQueue();
        await applyDeferredDraftState(state._restoredDraft);
    }

    setupEventListeners();
    applyHotkeysToUI();
    setupAutoSaveTimer();
    syncEngine.startAutoSync();
    switchTab(initialTab);

    // Initial renders
    if (getGenerateRawText().trim()) parseAndRender();
    else {
        renderConversation([]);
        updateTurnCount(0);
        disableActionButtons();
    }
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

async function saveRecoveryDraft(_reason = '') {
    try {
        const draft = await buildDraftObject();
        await dbSet('drafts', SESSION_ID, draft);
    } catch (_e) { }
}

// ============ CONFIG ============
async function loadServerConfig() {
    try {
        const res = await fetch('/api/server-config', { method: 'GET', cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        state.serverConfig = data;
        const path = String(data?.database?.path || 'data/dataset.db');
        if (els.databasePath && document.activeElement !== els.databasePath) {
            els.databasePath.value = path;
        }
        if (els.databasePathNote) {
            els.databasePathNote.textContent = 'Restart the server after switching databases for best results.';
        }
        // Populate autocomplete options for the DB path input.
        loadDatabaseCandidates({ quiet: true });
    } catch (e) { }
}

function renderDatabaseCandidates(candidates) {
    if (!els.databasePathOptions) return;
    const paths = Array.isArray(candidates) ? candidates : [];
    els.databasePathOptions.innerHTML = paths.map(p => `<option value="${escapeHtml(String(p || ''))}"></option>`).join('');
}

async function loadDatabaseCandidates({ quiet = false } = {}) {
    try {
        const res = await fetch('/api/databases/list', { method: 'GET', cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        renderDatabaseCandidates(data.candidates || []);
        if (!quiet) toast(`Found ${(data.candidates || []).length || 0} database file(s)`, 'success');
    } catch (e) {
        if (!quiet) toast('Failed to scan databases', 'error');
    }
}

async function backupDatabaseNow() {
    showSaveIndicator('Backing up DB...');
    try {
        const res = await fetch('/api/databases/backup', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Backup failed');
        toast(`Backup created: ${data.path}`, 'success');
        hideSaveIndicator('Backed up ✓');
        // The backup is a .db file, so refresh the candidates list.
        loadDatabaseCandidates({ quiet: true });
    } catch (e) {
        toast(e.message || 'Backup failed', 'error');
        hideSaveIndicator('Backup failed');
    }
}

async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        if (res.ok) {
            state.config = await res.json();
            // API settings now come directly from DB (no 'api' wrapper)
            els.provider.value = state.config.provider || 'openai';
            if (!hydratedFields.model) {
                const model = state.config.model || '';
                els.modelInput.value = model;
                els.model.value = model;
            }
            if (!hydratedFields.temperature) {
                const temp = state.config.temperature ?? 0.9;
                els.temperature.value = temp;
                els.tempValue.textContent = temp;
            }
            if (els.maxOutputTokens) {
                const mt = state.config.max_tokens || 2048;
                els.maxOutputTokens.value = mt;
            }
            updateProviderUI();
        }
    } catch (e) { console.error('Failed to load config:', e); }
}

function updateProviderUI() {
    const provider = els.provider.value;
    const providerConfig = state.config?.providers?.[provider] || {};

    const draft = state.credentialDraft?.[provider] || { api_key: '', base_url: '' };
    const draftKey = String(draft.api_key || '').trim();
    const draftUrl = String(draft.base_url || '').trim();
    const hasDraft = !!draftKey || !!draftUrl;

    const cached = state.credentialPresets?.[provider] || { key_presets: [], url_presets: [], active: { key_preset: '', url_preset: '' } };
    const activeKeyName = (cached.active?.key_preset || providerConfig.active_key_preset || '').trim();
    const activeUrlName = (cached.active?.url_preset || providerConfig.active_url_preset || '').trim();

    const keyPreset = cached.key_presets?.find(p => p.name === activeKeyName) || null;
    const keyTail = keyPreset?.last4 ? `*****${keyPreset.last4}` : (activeKeyName ? '*****----' : '');
    const rawKey = providerConfig.api_key ? String(providerConfig.api_key) : '';
    const maskedKey = rawKey ? `*****${rawKey.slice(-4)}` : '';
    const keyActiveLabel = activeKeyName ? `${activeKeyName} ${keyTail}`.trim() : (maskedKey || 'Not set');

    const urlPreset = cached.url_presets?.find(p => p.name === activeUrlName) || null;
    const activeUrlValue = (urlPreset?.base_url || '').trim() || (providerConfig.base_url ? String(providerConfig.base_url) : 'Default');
    const urlActiveLabel = activeUrlName ? `${activeUrlName} (${activeUrlValue})` : activeUrlValue;

    if (els.sidebarCredKeyActive) els.sidebarCredKeyActive.textContent = keyActiveLabel;
    if (els.sidebarCredUrlActive) els.sidebarCredUrlActive.textContent = urlActiveLabel;

    if (els.sidebarCredKeyDraft && document.activeElement !== els.sidebarCredKeyDraft) {
        els.sidebarCredKeyDraft.value = draftKey;
    }
    if (els.sidebarCredUrlDraft && document.activeElement !== els.sidebarCredUrlDraft) {
        els.sidebarCredUrlDraft.value = draftUrl;
    }

    if (els.credDraftWarning) els.credDraftWarning.classList.toggle('hidden', !hasDraft);
}

// ============ MODELS ============
async function loadModels(provider = String(els.provider?.value || '')) {
    if (!provider) return;
    try {
        const override = getCredentialOverride(provider);
        const res = await fetch('/api/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, credentials_override: override })
        });
        if (res.ok) {
            const data = await res.json();
            if (data.error) console.warn('Model fetch warning:', data.error);
            populateModelSelect(data.models, provider);
            return;
        }
        if (res.status === 404 || res.status === 405) {
            // Fallback for older servers
            const fallback = await fetch(`/api/models?provider=${encodeURIComponent(provider)}`);
            if (fallback.ok) {
                const data = await fallback.json();
                if (data.error) console.warn('Model fetch warning:', data.error);
                populateModelSelect(data.models, provider);
            }
            return;
        }
        let errMsg = `Model fetch failed (${res.status})`;
        try {
            const data = await res.json();
            if (data?.error) errMsg = String(data.error);
        } catch (e) { }
        console.warn(errMsg);
        toast(errMsg, 'error');
    } catch (e) { console.error('Failed to load models:', e); }
}

async function ensureModelsLoaded({ force = false } = {}) {
    const provider = String(els.provider?.value || '');
    if (!provider) return;
    if (!force && modelsLoadedForProvider === provider && ((els.model?.options?.length || 0) > 0 || (els.modelDatalist?.children?.length || 0) > 0)) {
        return;
    }
    await loadModels(provider);
}

function populateModelSelect(models, provider = String(els.provider?.value || '')) {
    const providerToken = String(provider || '');
    const liveProvider = String(els.provider?.value || '');
    if (providerToken && liveProvider && providerToken !== liveProvider) return;
    const current = els.modelInput?.value || els.model.value;
    const defaultModel = state.config?.model;
    els.model.innerHTML = '';
    if (els.modelDatalist) els.modelDatalist.innerHTML = '';

    const allModels = [];

    if (models && models.length > 0) {
        models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m; opt.textContent = m;
            els.model.appendChild(opt);
            allModels.push(m);
        });
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
    if (!providerToken || providerToken === liveProvider) {
        modelsLoadedForProvider = providerToken;
    }
}

function getModelValue() {
    return els.modelInput?.value?.trim() || els.model.value || '';
}

async function refreshModels() {
    els.refreshModels.classList.add('spinning');
    await ensureModelsLoaded({ force: true });
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
    els.promptSelect.innerHTML = '<option value="">Load preset...</option>';
    state.prompts.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name + (p.variables?.length ? ` (${p.variables.join(', ')})` : '');
        els.promptSelect.appendChild(opt);
    });
    if (state.currentPromptName) {
        if (selectHasOption(els.promptSelect, state.currentPromptName)) {
            els.promptSelect.value = state.currentPromptName;
            return;
        }
        state.currentPromptName = '';
    }

    // First-run convenience: auto-load Default when nothing is selected and the editor is empty.
    const defaultName = 'Default';
    const generatePromptEmpty = !String(els.systemPrompt?.value || state.generate?.prompt || '').trim();
    if (generatePromptEmpty && selectHasOption(els.promptSelect, defaultName)) {
        els.promptSelect.value = defaultName;
        selectPrompt();
    }
}

function sanitizePromptName(name) {
    return (name || '').replace(/[^a-zA-Z0-9_-]/g, '');
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
        name = await popupPrompt({
            title: 'Save Prompt',
            message: 'Enter a prompt template name.',
            label: 'Prompt name',
            placeholder: 'e.g. Default',
            confirmText: 'Save',
            required: true
        });
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
            const data = await res.json();
            // Use the sanitized name from server, not the raw client name
            state.currentPromptName = data.name || name;
            await loadPrompts();
            toast('Prompt saved!', 'success');
        }
    } catch (e) { toast('Failed to save prompt', 'error'); }
}

async function newPrompt() {
    const name = await popupPrompt({
        title: 'New Prompt',
        message: 'Create a new prompt template.',
        label: 'Prompt name',
        placeholder: 'e.g. MyPrompt',
        confirmText: 'Create',
        required: true
    });
    if (!name) return;

    const safeName = sanitizePromptName(name);
    if (!safeName) {
        toast('Prompt name must contain letters, numbers, underscores, or hyphens', 'error');
        return;
    }

    if (state.prompts.some(p => sanitizePromptName(p.name) === safeName)) {
        toast(`A prompt with the name "${safeName}" already exists. Please use a unique name.`, 'error');
        return;
    }

    state.currentPromptName = safeName;
    els.systemPrompt.value = '';
    state.generate.prompt = '';
    extractVariables();

    await savePrompt();
    await loadPrompts();

    if (els.promptSelect) {
        els.promptSelect.value = safeName;
    }
}

async function deletePrompt() {
    const name = state.currentPromptName || els.promptSelect.value;
    if (!name) { toast('Select a prompt to delete', 'info'); return; }
    const ok = await popupConfirm({
        title: 'Delete Prompt',
        message: `Delete prompt "${name}"?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        danger: true
    });
    if (!ok) return;
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

function _emptyMacroTrace() {
    return { random: {}, list: {}, roll: {}, variables: {} };
}

function _cleanMacroParts(rest) {
    return String(rest || '')
        .split('::')
        .map(p => p.trim())
        .filter(p => p.length > 0);
}

function _resolveInlineMacros(text, { isPreview, memo, trace, recordTrace = null, iteratorState = null, advanceList = null } = {}) {
    const preview = !!isPreview;
    const record = (recordTrace == null) ? !preview : !!recordTrace;
    const iter = iteratorState || state.listIterators || {};
    const shouldAdvance = (advanceList == null) ? !preview : !!advanceList;
    const m = memo || new Map();
    const t = trace || _emptyMacroTrace();

    // Strip {{// comments}}
    text = text.replace(/\{\{\/\/[^}]*\}\}/g, '');
    // Resolve {{roll:...}}
    text = text.replace(/\{\{roll:([^}]+)\}\}/gi, (_, notation) => {
        const result = rollDice(notation.trim());
        if (record && !isNaN(result)) {
            t.roll[String(notation || '').trim()] = String(result);
        }
        return isNaN(result) ? `{{roll:${notation}}}` : String(result);
    });
    // Resolve {{random::...}} and {{list::...}}
    text = text.replace(/\{\{(random|list)::([^}]+)\}\}/g, (_, type, rest) => {
        const parts = _cleanMacroParts(rest);
        if (parts.length === 0) return '';
        const rawKey = `${type}::${rest}`;
        const k = `${type}::${parts.join('::')}`;
        if (m.has(k)) return m.get(k);

        if (type === 'random') {
            const val = parts[Math.floor(Math.random() * parts.length)];
            if (record) t.random[k] = { value: val, options: parts.length };
            m.set(k, val);
            return val;
        }

        // list: stable within a single applyVariables call; advance once per macro key
        // Back-compat: if previous drafts stored the untrimmed key, migrate to the normalized key.
        if (shouldAdvance && state.listIterators?.[k] == null && state.listIterators?.[rawKey] != null) {
            state.listIterators[k] = state.listIterators[rawKey];
            delete state.listIterators[rawKey];
        }
        const current = Number(iter?.[k] || 0);
        const idx = ((current % parts.length) + parts.length) % parts.length;
        const val = parts[idx];
        if (record) {
            const nextIdx = (idx + 1) % parts.length;
            t.list[k] = { value: val, index: idx, next: parts[nextIdx], options: parts.length };
        }
        if (shouldAdvance) {
            iter[k] = current + 1;
        }
        m.set(k, val);
        return val;
    });
    return text;
}

function resolvePromptWithTrace(text, { isPreview = false, recordTrace = null, iteratorState = null } = {}) {
    const record = (recordTrace == null) ? !isPreview : !!recordTrace;
    const iter = iteratorState || state.listIterators || {};
    const sessionCache = {};
    const memo = new Map();
    const trace = _emptyMacroTrace();

    // First strip comments and run inline macros
    text = _resolveInlineMacros(text, { isPreview, memo, trace, recordTrace: record, iteratorState: iter, advanceList: !isPreview });

    // Then resolve named variables (up to 3 levels deep to handle nesting)
    for (let depth = 0; depth < 3; depth++) {
        text = text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
            if (sessionCache[key] !== undefined) return sessionCache[key];
            let val = state.generate.variables[key];
            if (val === undefined || val === null) return match;
            // Resolve macros in the variable's value
            val = _resolveInlineMacros(val, { isPreview, memo, trace, recordTrace: record, iteratorState: iter, advanceList: !isPreview });
            sessionCache[key] = val;
            if (record) trace.variables[key] = val;
            return val;
        });
        if (!/\{\{\w+\}\}/.test(text)) break; // No more variables to resolve
    }
    return { text, trace };
}

function applyVariables(text, isPreview = false) {
    const { text: resolved, trace } = resolvePromptWithTrace(text, { isPreview });
    if (!isPreview) {
        state.macroTraceLast = {
            ...trace,
            resolvedAt: new Date().toISOString()
        };
        renderMacroState();
    }
    return resolved;
}

function findUnresolvedPlaceholders(text) {
    const matches = String(text || '').match(/\{\{[^}]+\}\}/g) || [];
    const uniq = [];
    const seen = new Set();
    for (const m of matches) {
        const s = String(m || '').trim();
        if (!s) continue;
        if (seen.has(s)) continue;
        seen.add(s);
        uniq.push(s);
    }
    return uniq;
}

async function confirmIfUnresolved({ title = 'Unresolved placeholders', context = '', resolvedText = '' } = {}) {
    const unresolved = findUnresolvedPlaceholders(resolvedText);
    if (unresolved.length === 0) return true;
    const shown = unresolved.slice(0, 10).join(', ');
    const extra = unresolved.length > 10 ? `\n\n(+${unresolved.length - 10} more)` : '';
    const ok = await popupConfirm({
        title,
        message: `${context ? context + '\n\n' : ''}Found unresolved placeholders:\n${shown}${extra}\n\nContinue anyway?`,
        confirmText: 'Continue',
        cancelText: 'Cancel',
        danger: false
    });
    return !!ok;
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
    const desired = state.generate.variablePresetName || els.presetSelect?.value || '';
    els.presetSelect.innerHTML = '<option value="">Load preset...</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name; opt.textContent = p.name;
        opt.dataset.values = JSON.stringify(p.values);
        els.presetSelect.appendChild(opt);
    });
    if (desired && presets.some(p => p.name === desired)) {
        els.presetSelect.value = desired;
    } else {
        els.presetSelect.value = '';
        state.generate.variablePresetName = '';
    }
}

function loadPresetAction() {
    const selectedName = els.presetSelect.value || '';
    state.generate.variablePresetName = selectedName;
    const selected = els.presetSelect.selectedOptions[0];
    if (selected && selected.dataset.values) {
        const values = JSON.parse(selected.dataset.values);
        state.generate.variables = values;
        renderVariableInputs(state.generate.variableNames);
    }
    debouncedSaveDraft();
}

async function savePresetAction() {
    const selectedName = els.presetSelect?.value?.trim() || state.generate.variablePresetName || '';
    const name = selectedName || await popupPrompt({
        title: 'Save Preset',
        message: 'Save variables to a preset.',
        label: 'Preset name',
        placeholder: 'e.g. Default',
        confirmText: 'Save',
        required: true
    });
    if (!name) return;
    try {
        const res = await fetch('/api/presets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, values: state.generate.variables, overwrite: true })
        });
        if (res.ok) {
            const data = await res.json();
            renderPresetSelect(data.presets);
            if (els.presetSelect) {
                els.presetSelect.value = name;
                state.generate.variablePresetName = name;
                debouncedSaveDraft();
            }
            toast('Preset saved!', 'success');
        } else {
            const data = await res.json().catch(() => ({}));
            toast(data.error || 'Failed to save preset', 'error');
        }
    } catch (e) { toast('Failed to save preset', 'error'); }
}

async function newPresetAction() {
    const name = await popupPrompt({
        title: 'New Preset',
        message: 'Create a new variables preset.',
        label: 'Preset name',
        placeholder: 'e.g. RunA',
        confirmText: 'Create',
        required: true
    });
    if (!name) return;
    try {
        const res = await fetch('/api/presets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, values: state.generate.variables, overwrite: false })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            renderPresetSelect(data.presets || []);
            if (els.presetSelect) els.presetSelect.value = name;
            state.generate.variablePresetName = name;
            debouncedSaveDraft();
            toast('Preset created!', 'success');
        } else {
            toast(data.error || 'Failed to create preset', 'error');
        }
    } catch (e) { toast('Failed to create preset', 'error'); }
}

async function deletePresetAction() {
    const name = els.presetSelect.value;
    if (!name) { toast('Select a preset to delete', 'info'); return; }
    const ok = await popupConfirm({
        title: 'Delete Preset',
        message: `Delete preset "${name}"?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        danger: true
    });
    if (!ok) return;
    try {
        const res = await fetch(`/api/presets/${encodeURIComponent(name)}`, { method: 'DELETE' });
        if (res.ok) {
            state.generate.variablePresetName = '';
            els.presetSelect.value = '';
            await loadPresets();
            debouncedSaveDraft();
            toast('Preset deleted!', 'success');
        }
        else toast('Failed to delete preset', 'error');
    } catch (e) { toast('Failed to delete preset', 'error'); }
}

// ============ CUSTOM PARAMETERS ============
function setElementHtmlIfChanged(el, html) {
    if (!el) return false;
    if (el.innerHTML === html) return false;
    el.innerHTML = html;
    return true;
}

function renderCustomParamsSummary() {
    const params = state.customParams || {};
    const keys = Object.keys(params);
    const summaryHtml = keys.length === 0
        ? '<div class="empty-params">No custom parameters added</div>'
        : keys.map(key => `
            <div class="custom-param-item" data-key="${escapeHtml(key)}">
                <span class="param-key">${escapeHtml(key)}</span>
                <span class="param-value">${escapeHtml(String(params[key]))}</span>
            </div>
        `).join('');
    setElementHtmlIfChanged(els.customParamsList, summaryHtml);
}

function renderCustomParamsModalList() {
    const params = state.customParams || {};
    const keys = Object.keys(params);
    if (!els.customParamsModalList) return;
    const search = els.customParamsSearchInput?.value?.trim().toLowerCase() || '';
    const filteredKeys = keys.filter(key =>
        !search ||
        key.toLowerCase().includes(search) ||
        String(params[key]).toLowerCase().includes(search)
    );

    if (keys.length === 0) {
        setElementHtmlIfChanged(els.customParamsModalList, '<div class="empty-params">No custom parameters added</div>');
        return;
    }

    if (filteredKeys.length === 0) {
        setElementHtmlIfChanged(els.customParamsModalList, '<div class="empty-params">No matching parameters</div>');
        return;
    }

    const modalHtml = filteredKeys.map(key => `
        <div class="custom-param-item" data-key="${escapeHtml(key)}">
            <span class="param-key">${escapeHtml(key)}</span>
            <span class="param-value" data-key="${escapeHtml(key)}" title="Click to edit">${escapeHtml(String(params[key]))}</span>
            <button class="icon-btn param-remove" data-key="${escapeHtml(key)}" title="Remove">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
    `).join('');
    setElementHtmlIfChanged(els.customParamsModalList, modalHtml);
}

function renderCustomParams() {
    renderCustomParamsSummary();
    renderCustomParamsModalList();
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
    const key = els.customParamKey?.value?.trim();
    const value = els.customParamValue?.value?.trim();
    if (!key) { toast('Parameter key is required', 'info'); return; }
    state.customParams[key] = value || '';
    if (els.customParamKey) els.customParamKey.value = '';
    if (els.customParamValue) els.customParamValue.value = '';
    renderCustomParams();
    debouncedSaveDraft();
}

function removeCustomParam(key) {
    delete state.customParams[key];
    renderCustomParams();
    debouncedSaveDraft();
}

// ============ SYSTEM PRESETS (Chat & Export) ============
async function loadSystemPresets(type) {
    try {
        const res = await fetch(`/api/${type}-presets`);
        if (res.ok) {
            const data = await res.json();
            renderSystemPresetSelect(type, data.presets || []);
        }
    } catch (e) { console.error(`Failed to load ${type} presets:`, e); }
}

function renderSystemPresetSelect(type, presets) {
    const selectEl = els[`${type}PresetSelect`];
    if (!selectEl) return;
    let desired = (state[type]?.presetName || selectEl.value || '').trim();
    selectEl.innerHTML = '<option value="">Load preset...</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name; opt.textContent = p.name;
        opt.dataset.prompt = p.prompt;
        selectEl.appendChild(opt);
    });
    if (desired && presets.some(p => p.name === desired)) {
        selectEl.value = desired;
    } else {
        selectEl.value = '';
        if (state[type]) state[type].presetName = '';
        desired = '';
    }

    // First-run convenience: if nothing selected and prompt is empty, load Default silently.
    const defaultName = 'Default';
    const targetEl = els[`${type}SystemPrompt`];
    const promptEmpty = !String(targetEl?.value || state[type]?.systemPrompt || '').trim();
    if (!desired && promptEmpty && presets.some(p => p.name === defaultName)) {
        selectEl.value = defaultName;
        if (state[type]) state[type].presetName = defaultName;
        loadSystemPreset(type, { silent: true });
    }
}

function loadSystemPreset(type, { silent = false } = {}) {
    const selectEl = els[`${type}PresetSelect`];
    const targetEl = els[`${type}SystemPrompt`];
    const selected = selectEl.selectedOptions[0];
    if (state[type]) state[type].presetName = selectEl.value || '';

    if (selected && selected.dataset.prompt) {
        targetEl.value = selected.dataset.prompt;
        if (state[type]) state[type].systemPrompt = selected.dataset.prompt;
        debouncedSaveDraft();
        if (!silent) toast('Preset loaded!', 'success');
    }
}

function selectHasOption(selectEl, value) {
    if (!selectEl) return false;
    const v = String(value || '');
    return [...selectEl.options].some(o => String(o.value) === v);
}

function applyFirstRunDefaults() {
    const defaultName = 'Default';

    const generatePromptEmpty = !String(els.systemPrompt?.value || state.generate?.prompt || '').trim();
    if (!state.currentPromptName && generatePromptEmpty && selectHasOption(els.promptSelect, defaultName)) {
        els.promptSelect.value = defaultName;
        selectPrompt();
    }

    const hasVars = state.generate?.variables && typeof state.generate.variables === 'object'
        ? Object.values(state.generate.variables).some(v => String(v ?? '').trim() !== '')
        : false;
    if (!state.generate.variablePresetName && !hasVars && selectHasOption(els.presetSelect, defaultName)) {
        els.presetSelect.value = defaultName;
        loadPresetAction();
    }

    const chatPromptEmpty = !String(els.chatSystemPrompt?.value || state.chat?.systemPrompt || '').trim();
    if (!state.chat.presetName && chatPromptEmpty && selectHasOption(els.chatPresetSelect, defaultName)) {
        els.chatPresetSelect.value = defaultName;
        loadSystemPreset('chat', { silent: true });
    }

    const exportPromptEmpty = !String(els.exportSystemPrompt?.value || state.export?.systemPrompt || '').trim();
    if (!state.export.presetName && exportPromptEmpty && selectHasOption(els.exportPresetSelect, defaultName)) {
        els.exportPresetSelect.value = defaultName;
        loadSystemPreset('export', { silent: true });
    }
}

async function saveSystemPreset(type) {
    const selectEl = els[`${type}PresetSelect`];
    const targetEl = els[`${type}SystemPrompt`];
    let name = (state[type]?.presetName || selectEl?.value || '').trim();

    if (!name) {
        name = await popupPrompt({
            title: `Save ${type === 'chat' ? 'Chat' : 'Export'} Preset`,
            message: 'Save the current system prompt to a preset.',
            label: 'Preset name',
            placeholder: 'e.g. Default',
            confirmText: 'Save',
            required: true
        });
        if (!name) return;
    }

    const promptText = targetEl?.value || '';
    try {
        const res = await fetch(`/api/${type}-presets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, prompt: promptText, overwrite: true })
        });
        if (res.ok) {
            const data = await res.json();
            renderSystemPresetSelect(type, data.presets || []);
            if (selectEl) {
                selectEl.value = name;
                if (state[type]) state[type].presetName = name;
                debouncedSaveDraft();
            }
            toast(`${type === 'chat' ? 'Chat' : 'Export'} preset saved!`, 'success');
        } else {
            const data = await res.json().catch(() => ({}));
            toast(data.error || 'Failed to save preset', 'error');
        }
    } catch (e) { toast('Failed to save preset', 'error'); }
}

async function newSystemPreset(type) {
    const name = await popupPrompt({
        title: `New ${type === 'chat' ? 'Chat' : 'Export'} Preset`,
        message: 'Create a new preset from the current system prompt.',
        label: 'Preset name',
        placeholder: 'e.g. RunA',
        confirmText: 'Create',
        required: true
    });
    if (!name) return;

    const selectEl = els[`${type}PresetSelect`];
    const targetEl = els[`${type}SystemPrompt`];
    const promptText = targetEl?.value || '';

    try {
        const res = await fetch(`/api/${type}-presets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, prompt: promptText, overwrite: false })
        });
        const data = await res.json();

        if (res.ok) {
            renderSystemPresetSelect(type, data.presets || []);
            if (selectEl) selectEl.value = name;
            if (state[type]) state[type].presetName = name;
            debouncedSaveDraft();
            toast(`New ${type === 'chat' ? 'chat' : 'export'} preset created!`, 'success');
        } else {
            toast(data.error || 'Failed to create preset', 'error');
        }
    } catch (e) { toast('Failed to create preset', 'error'); }
}

async function deleteSystemPreset(type) {
    const selectEl = els[`${type}PresetSelect`];
    const selected = selectEl?.value;

    if (!selected) { toast('Select a preset to delete', 'info'); return; }
    const ok = await popupConfirm({
        title: `Delete ${type === 'chat' ? 'Chat' : 'Export'} Preset`,
        message: `Delete preset "${selected}"?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        danger: true
    });
    if (!ok) return;

    try {
        const res = await fetch(`/api/${type}-presets/${encodeURIComponent(selected)}`, { method: 'DELETE' });
        if (res.ok) {
            await loadSystemPresets(type);
            const targetEl = els[`${type}SystemPrompt`];
            if (targetEl) targetEl.value = '';
            if (state[type]) state[type].systemPrompt = '';
            if (state[type]) state[type].presetName = '';
            debouncedSaveDraft();
            toast('Preset deleted!', 'success');
        }
    } catch (e) { toast('Failed to delete preset', 'error'); }
}

async function loadChatPresets() { await loadSystemPresets('chat'); }
function loadChatPreset() { loadSystemPreset('chat'); }
async function saveChatPreset() { await saveSystemPreset('chat'); }
async function newChatPreset() { await newSystemPreset('chat'); }
async function deleteChatPreset() { await deleteSystemPreset('chat'); }

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
    const hasActiveLoadAll = !!state.filesModal.loadAllTaskId && state.tasks.items.has(state.filesModal.loadAllTaskId);
    const shouldReset = !hasActiveLoadAll && state.filesModal.files.length === 0;
    if (shouldReset) {
        loadFilesModal(state.filesModal.currentFolder, { reset: true });
    } else {
        renderFilesModalList();
        updateFilesModalCount();
        renderFilesPreview();
        updateFilesPaginationUI();
    }
}

function closeFilesModal() {
    els.filesModal.classList.add('hidden');
}

function mergeUniqueById(existing, incoming) {
    const seen = new Set(existing.map(item => item.id));
    const merged = existing.slice();
    incoming.forEach(item => {
        if (!seen.has(item.id)) {
            merged.push(item);
            seen.add(item.id);
        }
    });
    return merged;
}

function mergeReviewQueuePage(existing, incoming, insertAt) {
    const head = existing.slice(0, insertAt);
    const tail = existing.slice(insertAt);
    const seen = new Set(head.map(item => item.id));
    const mergedIncoming = [];
    const mergedTail = [];

    incoming.forEach(item => {
        if (!seen.has(item.id)) {
            mergedIncoming.push(item);
            seen.add(item.id);
        }
    });

    tail.forEach(item => {
        if (!seen.has(item.id)) {
            mergedTail.push(item);
            seen.add(item.id);
        }
    });

    return [...head, ...mergedIncoming, ...mergedTail];
}

async function loadAllPages(loadNextPage, hasMore, { signal = null, onProgress = null } = {}) {
    const yieldToUI = () => new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
        else setTimeout(resolve, 0);
    });
    let guard = 0;
    while (hasMore() && guard < 200) {
        if (signal?.aborted) break;
        await loadNextPage();
        onProgress?.();
        await yieldToUI();
        guard++;
    }
}

function renderConversationMarkup(messages = []) {
    if (!messages.length) {
        return '<div class="empty-files">Nothing to preview</div>';
    }
    return messages.map(m => `
        <div class="bubble ${m.from}">
            <div class="bubble-header">
                <span class="role-label">${getConversationRoleLabel(m.from)}</span>
            </div>
            <div class="bubble-content">${escapeHtml(m.value)}</div>
        </div>
    `).join('');
}

function getConversationRoleLabel(role) {
    if (role === 'human') return 'USER';
    if (role === 'system') return 'SYSTEM';
    return 'GPT';
}

function countConversationTurns(messages = []) {
    return messages.filter(m => m.from === 'human' || m.from === 'gpt').length;
}

function updateSelectionToolbar({ selectedIds, files, toggleButton, chip, countEl }) {
    const selectedCount = selectedIds.size;
    if (countEl) countEl.textContent = `${selectedCount} selected`;
    if (chip) {
        const hideClass = chip.classList.contains('slot-hidden') ? 'slot-hidden' : 'hidden';
        chip.classList.toggle(hideClass, selectedCount === 0);
        if (hideClass === 'slot-hidden') chip.classList.remove('hidden');
    }
    // Keep action buttons layout stable; clearing is done via the detached selection chip.
}

function clearSelectableSelection(slice) {
    slice.selectedIds.clear();
    slice.anchorId = null;
}

function escapeAttrSelector(value) {
    const str = String(value ?? '');
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(str);
    return str.replace(/["\\]/g, '\\$&');
}

function updateSelectableRowUI(container, slice, id) {
    if (!container || !id) return;
    const el = container.querySelector(`.export-file-item[data-id="${escapeAttrSelector(id)}"]`);
    if (!el) return;
    const isSelected = slice.selectedIds.has(id);
    const isPreviewing = slice.previewId === id;
    el.classList.toggle('selected', isSelected);
    el.classList.toggle('active-preview', isPreviewing);
    const checkbox = el.querySelector('input.file-checkbox');
    if (checkbox) checkbox.checked = isSelected;
}

function refreshSelectableListUI(container, slice) {
    if (!container) return;
    const rows = container.querySelectorAll('.export-file-item');
    rows.forEach(row => {
        const id = row.dataset.id;
        if (!id) return;
        const isSelected = slice.selectedIds.has(id);
        const isPreviewing = slice.previewId === id;
        row.classList.toggle('selected', isSelected);
        row.classList.toggle('active-preview', isPreviewing);
        const checkbox = row.querySelector('input.file-checkbox');
        if (checkbox) checkbox.checked = isSelected;
    });
}

function filterSelectableIdsToLoadedItems(items, ids) {
    const availableIds = new Set((items || []).map(item => String(item?.id || '')).filter(Boolean));
    return new Set((ids || []).map(id => String(id || '')).filter(id => availableIds.has(id)));
}

function setFilesModalPendingSelection(selectedIds, previewId = '') {
    const pendingIds = Array.from(selectedIds || []).map(id => String(id || '')).filter(Boolean);
    const pendingPreviewId = String(previewId || '').trim();
    if (!pendingIds.length && !pendingPreviewId) {
        state.filesModal.pendingSelection = null;
        return;
    }
    state.filesModal.pendingSelection = {
        selectedIds: pendingIds,
        previewId: pendingPreviewId,
    };
}

function applyFilesModalPendingSelection() {
    const pending = state.filesModal.pendingSelection;
    if (!pending) return;

    const availableIds = new Set((state.filesModal.files || []).map(item => String(item?.id || '')).filter(Boolean));
    const matchedSelectedIds = (pending.selectedIds || []).filter(id => availableIds.has(id));
    if (matchedSelectedIds.length) {
        state.filesModal.selectedIds = new Set([
            ...Array.from(state.filesModal.selectedIds || []),
            ...matchedSelectedIds,
        ]);
    }

    const previewId = String(pending.previewId || '');
    if (previewId && availableIds.has(previewId)) {
        state.filesModal.previewId = previewId;
    }

    const remainingSelectedIds = (pending.selectedIds || []).filter(id => !availableIds.has(id));
    const remainingPreviewId = previewId && !availableIds.has(previewId) ? previewId : '';
    if (!remainingSelectedIds.length && !remainingPreviewId) {
        state.filesModal.pendingSelection = null;
        return;
    }

    state.filesModal.pendingSelection = {
        selectedIds: remainingSelectedIds,
        previewId: remainingPreviewId,
    };
}

function getSliceIndex(slice, items, id) {
    if (slice?.idToIndex && typeof slice.idToIndex.get === 'function') {
        const idx = slice.idToIndex.get(id);
        if (typeof idx === 'number') return idx;
    }
    const needle = String(id ?? '');
    return items.findIndex(item => String(item?.id ?? '') === needle);
}

function handleSelectableInteraction(slice, items, id, event, onPreview) {
    id = String(id ?? '');
    const wantsSelection = !!event.shiftKey || !!event.ctrlKey || !!event.metaKey || event.target.closest('input[type="checkbox"]');
    const prevPreviewId = slice.previewId;

    if (!wantsSelection) {
        slice.previewId = id;
        slice.anchorId = id;
        onPreview?.(id);
        return { needsFullRefresh: false, changedSelectionIds: [], changedPreviewIds: [prevPreviewId, id] };
    }

    if (event.shiftKey && slice.anchorId) {
        const anchorIndex = getSliceIndex(slice, items, slice.anchorId);
        const currentIndex = getSliceIndex(slice, items, id);
        if (anchorIndex === -1 || currentIndex === -1) {
            // Fallback to a single-item toggle if we can't resolve indices.
            if (slice.selectedIds.has(id)) slice.selectedIds.delete(id);
            else slice.selectedIds.add(id);
            slice.anchorId = id;
            return { needsFullRefresh: false, changedSelectionIds: [id], changedPreviewIds: [] };
        }
        const [start, end] = anchorIndex < currentIndex ? [anchorIndex, currentIndex] : [currentIndex, anchorIndex];
        const rangeSize = end - start + 1;
        const clearsExisting = !(event.ctrlKey || event.metaKey);
        if (clearsExisting) slice.selectedIds.clear();
        for (let i = start; i <= end; i++) {
            const rangeId = items[i]?.id;
            if (rangeId !== undefined && rangeId !== null && String(rangeId) !== '') slice.selectedIds.add(String(rangeId));
        }
        slice.anchorId = id;
        // If we cleared existing selection or the range is big, it's cheaper to refresh DOM classes in-place.
        return { needsFullRefresh: clearsExisting || rangeSize > 300, changedSelectionIds: [], changedPreviewIds: [] };
    } else {
        if (slice.selectedIds.has(id)) slice.selectedIds.delete(id);
        else slice.selectedIds.add(id);
    }

    slice.anchorId = id;
    return { needsFullRefresh: false, changedSelectionIds: [id], changedPreviewIds: [] };
}

async function fetchConversationPreview(id, folder) {
    const res = await fetch(`/api/conversation/${encodeURIComponent(id)}?folder=${encodeURIComponent(folder)}`);
    if (!res.ok) throw new Error('Failed to load conversation preview');
    return res.json();
}

function renderFilesPreview() {
    if (!els.filesPreview) return;
    const conv = state.filesModal.previewConversation;
    if (!conv?.conversations?.length) {
        els.filesPreview.innerHTML = '<div class="empty-files">Select a conversation to preview it here</div>';
        return;
    }

    els.filesPreview.innerHTML = `
        <div class="selection-toolbar">
            <button id="files-open-previewed" class="btn btn-sm btn-secondary">Open in Generate</button>
        </div>
        ${renderConversationMarkup(conv.conversations)}
    `;
}

function updateFilesPaginationUI() {
    if (els.filesPaginationStatus) {
        const loaded = Math.min(state.filesModal.offset, state.filesModal.files.length);
        const total = state.filesModal.total || 0;
        els.filesPaginationStatus.textContent = total > 0 ? `Showing ${loaded} of ${total}` : '';
    }
}

async function loadFilesModal(folder = 'wanted', { reset = false, signal = null, requestSeq = null } = {}) {
    if (requestSeq != null && state.filesModal.requestSeq !== requestSeq) return;
    const activeRequestSeq = requestSeq ?? beginSliceRequest(state.filesModal);
    state.filesModal.currentFolder = folder;
    updateFilesBulkActionsVisibility(folder);
    const search = els.filesSearchInput?.value?.trim() || '';
    const pageSize = getModalPageSize();
    if (reset) {
        state.filesModal.files = [];
        clearSelectableSelection(state.filesModal);
        state.filesModal.offset = 0;
        state.filesModal.total = 0;
        state.filesModal.hasMore = false;
        state.filesModal.previewId = null;
        state.filesModal.previewConversation = null;
        state.filesModal.renderedCount = 0;
        state.filesModal.seenIds.clear();
        state.filesModal.idToIndex.clear();
        if (els.filesModalList) els.filesModalList.innerHTML = '';
    }
    state.filesModal.isLoading = true;
    if (!els.filesModal?.classList.contains('hidden')) {
        // Show immediate feedback (spinner / "Loading...") and ensure virtual loading row state is correct.
        renderFilesModalList();
        updateFilesPaginationUI();
    }

    // Update active tab styling
    $$('#files-modal .file-tab').forEach(t => t.classList.toggle('active', t.dataset.folder === folder));

    let aborted = false;
    try {
        const params = new URLSearchParams({
            folder,
            limit: String(pageSize),
            offset: String(state.filesModal.offset)
        });
        if (search) params.set('search', search);
        const url = `/api/conversations?${params.toString()}`;
        const res = await fetch(url, signal ? { signal } : undefined);
        if (isSliceRequestStale(state.filesModal, activeRequestSeq, signal)) return;
        if (res.ok) {
            const data = await res.json();
            if (isSliceRequestStale(state.filesModal, activeRequestSeq, signal)) return;
            const items = Array.isArray(data) ? data : (data.conversations || []);
            for (const item of items) {
                const itemId = item?.id;
                if (!itemId || state.filesModal.seenIds.has(itemId)) continue;
                state.filesModal.seenIds.add(itemId);
                state.filesModal.idToIndex.set(itemId, state.filesModal.files.length);
                state.filesModal.files.push(item);
            }
            state.filesModal.total = Array.isArray(data) ? items.length : (data.total || state.filesModal.files.length);
            state.filesModal.offset += items.length;
            if (items.length === 0) state.filesModal.hasMore = false;
            else state.filesModal.hasMore = state.filesModal.offset < state.filesModal.total;
            applyFilesModalPendingSelection();
            if (!els.filesModal?.classList.contains('hidden')) {
                renderFilesModalList();
            }
        }

        if (isSliceRequestStale(state.filesModal, activeRequestSeq, signal)) return;
        if (!els.filesModal?.classList.contains('hidden')) {
            updateFilesModalCount();
            if (reset) renderFilesPreview();
            updateFilesPaginationUI();
        }
    } catch (e) {
        if (e?.name === 'AbortError') aborted = true;
        else if (!isSliceRequestStale(state.filesModal, activeRequestSeq, signal)) console.error('Failed to load files:', e);
    } finally {
        const requestIsStale = state.filesModal.requestSeq !== activeRequestSeq;
        if (requestIsStale) return;
        state.filesModal.isLoading = false;
        if (aborted || signal?.aborted) return;
        if (!aborted) updateFilesPaginationUI();
        if (!els.filesModal?.classList.contains('hidden')) {
            // Ensure the "Loading more..." row is hidden after paging completes.
            renderFilesModalList();
        }
    }
}

function loadMoreFilesModal() {
    if (state.filesModal.hasMore && !state.filesModal.isLoading) {
        loadFilesModal(state.filesModal.currentFolder);
    }
}

function updateFilesModalCount() {
    const isRejected = state.filesModal.currentFolder === 'rejected';
    updateSelectionToolbar({
        selectedIds: state.filesModal.selectedIds,
        files: state.filesModal.files,
        toggleButton: isRejected ? els.filesSelectToggleRejected : els.filesSelectToggle,
        chip: els.filesSelectionChip,
        countEl: els.filesModalCount
    });
}

function updateFilesBulkActionsVisibility(folder) {
    const isRejected = folder === 'rejected';
    if (els.filesBulkActionsWanted) els.filesBulkActionsWanted.classList.toggle('hidden', isRejected);
    if (els.filesBulkActionsRejected) els.filesBulkActionsRejected.classList.toggle('hidden', !isRejected);
}

function renderFilesRowHtml(f) {
    const isSelected = state.filesModal.selectedIds.has(f.id);
    const isPreviewing = state.filesModal.previewId === f.id;

    const preview = f.preview || f.id || 'No preview';
    const meta = [];
    if (f.created_at) meta.push(formatDate(f.created_at));
    if (f.turns) meta.push(`${f.turns} msgs`);
    const metaStr = meta.join(' • ');

    return `
        <div class="export-file-item ${isSelected ? 'selected' : ''} ${isPreviewing ? 'active-preview' : ''}" data-id="${escapeHtml(f.id)}">
            <input type="checkbox" class="file-checkbox" ${isSelected ? 'checked' : ''}>
            <div class="export-file-info">
                <div class="export-file-preview">${escapeHtml(preview)}</div>
                <div class="export-file-meta">${metaStr ? metaStr : escapeHtml(f.id)}</div>
            </div>
        </div>
    `;
}

function renderFilesModalList() {
    if (!els.filesModalList) return;
    const folder = state.filesModal.currentFolder;

    updateFilesBulkActionsVisibility(folder);

    renderVirtualWindow({
        slice: state.filesModal,
        container: els.filesModalList,
        items: state.filesModal.files,
        renderRowHtml: renderFilesRowHtml
    });
    updateFilesPaginationUI();
}

// Bulk Actions Handlers
function chunkArray(items, size) {
    const out = [];
    const safeSize = Math.max(1, Number(size) || 1);
    for (let i = 0; i < items.length; i += safeSize) out.push(items.slice(i, i + safeSize));
    return out;
}

function isSafeConversationId(idStr) {
    if (typeof idStr !== 'string') return false;
    if (!idStr) return false;
    return !idStr.includes('..') && !idStr.includes('/') && !idStr.includes('\\');
}

function getBulkRetryAttempts() {
    return Math.max(0, Math.min(5, parseInt(syncSettings.bulkRetryAttempts, 10) || 0));
}

function sleepWithAbort(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        const t = setTimeout(() => {
            if (signal) signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(t);
            if (signal) signal.removeEventListener('abort', onAbort);
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
}

async function handleBulkMove(from, to) {
    const ids = Array.from(state.filesModal.selectedIds).map(id => String(id || '')).filter(Boolean);
    if (ids.length === 0) return;

    showSaveIndicator('Moving...');
    const controller = new AbortController();
    const taskId = createTask({
        title: 'Files: Moving conversations',
        detail: `${from} -> ${to}`,
        onCancel: () => controller.abort(),
    });

    const invalidIds = [];
    const safeIds = [];
    for (const id of ids) {
        if (isSafeConversationId(id)) safeIds.push(id);
        else invalidIds.push(id);
    }

    const maxRetries = getBulkRetryAttempts();
    const batchSize = 200;
    let processed = invalidIds.length;
    const movedIds = [];
    const missingIds = [];
    const failedIds = [];

    const pushProgress = (detailSuffix = '') => {
        const detail = [`${from} -> ${to}`, detailSuffix].filter(Boolean).join(' · ');
        updateTask(taskId, {
            detail,
            current: Math.min(processed, ids.length),
            total: ids.length,
            indeterminate: false,
        });
    };
    pushProgress(`Starting (${invalidIds.length} invalid)`);

    try {
        for (const batch of chunkArray(safeIds, batchSize)) {
            if (controller.signal.aborted) break;
            let attempt = 0;
            while (true) {
                if (controller.signal.aborted) break;
                try {
                    const res = await fetch('/api/conversations/bulk-move', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids: batch, from, to }),
                        signal: controller.signal,
                    });
                    if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        const msg = err.error || `Bulk move failed (${res.status})`;
                        const e = new Error(msg);
                        e._status = res.status;
                        throw e;
                    }

                    const data = await res.json().catch(() => ({}));
                    const moved = Array.isArray(data.moved) ? data.moved.map(String).filter(Boolean) : [];
                    const missing = Array.isArray(data.missing) ? data.missing.map(String).filter(Boolean) : [];
                    const invalid = Array.isArray(data.invalid) ? data.invalid.map(String).filter(Boolean) : [];
                    movedIds.push(...moved);
                    if (missing.length) missingIds.push(...missing);
                    if (invalid.length) invalidIds.push(...invalid);

                    processed += batch.length;
                    pushProgress(`Moved ${movedIds.length}/${safeIds.length} · Missing ${missingIds.length} · Invalid ${invalidIds.length} · Failed ${failedIds.length}`);
                    break;
                } catch (e) {
                    if (e?.name === 'AbortError' || controller.signal.aborted) throw e;
                    const status = Number(e?._status || 0);
                    const retryable = (status === 0 || status === 429 || status >= 500);
                    attempt += 1;
                    if (!retryable || attempt > maxRetries) {
                        failedIds.push(...batch);
                        processed += batch.length;
                        pushProgress(`Moved ${movedIds.length}/${safeIds.length} · Missing ${missingIds.length} · Invalid ${invalidIds.length} · Failed ${failedIds.length}`);
                        break;
                    }
                    pushProgress(`Retrying batch (${attempt}/${maxRetries}) · ${e?.message || 'Failed'}`);
                    await sleepWithAbort(350 * attempt, controller.signal);
                }
            }
        }

        if (controller.signal.aborted) {
            toast('Move canceled', 'info');
            finishTask(taskId, { status: 'canceled', detail: `Canceled (${movedIds.length} moved)` });
            hideSaveIndicator('Canceled');
            return;
        }

        const uniqueMissing = Array.from(new Set(missingIds));
        const uniqueFailed = Array.from(new Set([...invalidIds, ...failedIds]));
        const movedUnique = Array.from(new Set(movedIds));

        const hasFailures = uniqueFailed.length > 0;
        const hasWarnings = uniqueMissing.length > 0;
        const toastType = hasFailures ? 'error' : hasWarnings ? 'warning' : 'success';
        toast(`Moved ${movedUnique.length}/${safeIds.length} items to ${to}`, toastType);
        finishTask(taskId, {
            status: hasFailures ? 'error' : 'done',
            detail: hasFailures ? `Failed: ${uniqueFailed.length}` : hasWarnings ? `Missing: ${uniqueMissing.length}` : 'Done',
        });

        await loadFilesModal(from, { reset: true });
        const safeFailedIds = uniqueFailed.filter(isSafeConversationId);
        state.filesModal.selectedIds = filterSelectableIdsToLoadedItems(
            state.filesModal.files,
            safeFailedIds
        );
        const remainingFailed = safeFailedIds.filter(id => !state.filesModal.selectedIds.has(id));
        setFilesModalPendingSelection(remainingFailed);
        refreshSelectableListUI(els.filesModalList, state.filesModal);
        updateFilesModalCount();
        loadStats();
        hideSaveIndicator(hasFailures ? 'Failed' : 'Moved');
    } catch (e) {
        if (e?.name === 'AbortError' || controller.signal.aborted) {
            toast('Move canceled', 'info');
            finishTask(taskId, { status: 'canceled', detail: 'Canceled' });
            hideSaveIndicator('Canceled');
            return;
        }
        console.error('Bulk move failed:', e);
        toast(e?.message || 'Failed to move', 'error');
        finishTask(taskId, { status: 'error', detail: e?.message || 'Failed' });
        await saveRecoveryDraft('bulkMove');
        hideSaveIndicator('Failed');
    }
}

async function handleBulkDelete(folder) {
    const ids = Array.from(state.filesModal.selectedIds).map(id => String(id || '')).filter(Boolean);
    if (ids.length === 0) return;
    const ok = await popupConfirm({
        title: 'Delete Conversations',
        message: `Permanently delete ${ids.length} conversation(s)?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        danger: true
    });
    if (!ok) return;

    showSaveIndicator('Deleting...');
    const controller = new AbortController();
    const taskId = createTask({
        title: 'Files: Deleting conversations',
        detail: folder === 'rejected' ? 'Rejected' : 'Wanted',
        onCancel: () => controller.abort(),
    });

    const invalidIds = [];
    const safeIds = [];
    for (const id of ids) {
        if (isSafeConversationId(id)) safeIds.push(id);
        else invalidIds.push(id);
    }

    const maxRetries = getBulkRetryAttempts();
    const batchSize = 200;
    let processed = invalidIds.length;
    const deletedIds = [];
    const missingIds = [];
    const failedIds = [];

    const pushProgress = (detailSuffix = '') => {
        const baseDetail = folder === 'rejected' ? 'Rejected' : 'Wanted';
        const detail = [baseDetail, detailSuffix].filter(Boolean).join(' · ');
        updateTask(taskId, {
            detail,
            current: Math.min(processed, ids.length),
            total: ids.length,
            indeterminate: false,
        });
    };
    pushProgress(`Starting (${invalidIds.length} invalid)`);
    try {
        for (const batch of chunkArray(safeIds, batchSize)) {
            if (controller.signal.aborted) break;
            let attempt = 0;
            while (true) {
                if (controller.signal.aborted) break;
                try {
                    const res = await fetch('/api/conversations/bulk-delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids: batch, folder }),
                        signal: controller.signal,
                    });
                    if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        const msg = err.error || `Bulk delete failed (${res.status})`;
                        const e = new Error(msg);
                        e._status = res.status;
                        throw e;
                    }

                    const data = await res.json().catch(() => ({}));
                    const deleted = Array.isArray(data.deleted) ? data.deleted.map(String).filter(Boolean) : [];
                    const missing = Array.isArray(data.missing) ? data.missing.map(String).filter(Boolean) : [];
                    const invalid = Array.isArray(data.invalid) ? data.invalid.map(String).filter(Boolean) : [];
                    deletedIds.push(...deleted);
                    if (missing.length) missingIds.push(...missing);
                    if (invalid.length) invalidIds.push(...invalid);

                    processed += batch.length;
                    pushProgress(`Deleted ${deletedIds.length}/${safeIds.length} · Missing ${missingIds.length} · Invalid ${invalidIds.length} · Failed ${failedIds.length}`);
                    break;
                } catch (e) {
                    if (e?.name === 'AbortError' || controller.signal.aborted) throw e;
                    const status = Number(e?._status || 0);
                    const retryable = (status === 0 || status === 429 || status >= 500);
                    attempt += 1;
                    if (!retryable || attempt > maxRetries) {
                        failedIds.push(...batch);
                        processed += batch.length;
                        pushProgress(`Deleted ${deletedIds.length}/${safeIds.length} · Missing ${missingIds.length} · Invalid ${invalidIds.length} · Failed ${failedIds.length}`);
                        break;
                    }
                    pushProgress(`Retrying batch (${attempt}/${maxRetries}) · ${e?.message || 'Failed'}`);
                    await sleepWithAbort(350 * attempt, controller.signal);
                }
            }
        }

        const aborted = controller.signal.aborted;
        const uniqueMissing = Array.from(new Set(missingIds));
        const uniqueFailed = Array.from(new Set([...invalidIds, ...failedIds]));
        const deletedUnique = Array.from(new Set(deletedIds));

        if (aborted) {
            toast('Delete canceled', 'info');
            finishTask(taskId, { status: 'canceled', detail: `Canceled (${deletedUnique.length} deleted)` });
            hideSaveIndicator('Canceled');
            return;
        }

        const hasFailures = uniqueFailed.length > 0;
        const hasWarnings = uniqueMissing.length > 0;
        const toastType = hasFailures ? 'error' : hasWarnings ? 'warning' : 'success';
        toast(`Deleted ${deletedUnique.length}/${safeIds.length} conversations`, toastType);

	        finishTask(taskId, {
	            status: hasFailures ? 'error' : 'done',
	            detail: hasFailures ? `Failed: ${uniqueFailed.length}` : hasWarnings ? `Missing: ${uniqueMissing.length}` : 'Done',
	        });

	        // Keep failed items selected so the user can retry.
	        await loadFilesModal(folder, { reset: true });
	        const safeFailedIds = uniqueFailed.filter(isSafeConversationId);
	        state.filesModal.selectedIds = filterSelectableIdsToLoadedItems(state.filesModal.files, safeFailedIds);
	        const remainingFailed = safeFailedIds.filter(id => !state.filesModal.selectedIds.has(id));
	        setFilesModalPendingSelection(remainingFailed);
	        refreshSelectableListUI(els.filesModalList, state.filesModal);
	        updateFilesModalCount();
	        loadStats();
	        hideSaveIndicator(hasFailures ? 'Failed' : 'Deleted');
    } catch (e) {
        if (e?.name === 'AbortError' || controller.signal.aborted) {
            toast('Delete canceled', 'info');
            finishTask(taskId, { status: 'canceled', detail: 'Canceled' });
            hideSaveIndicator('Canceled');
            return;
        }
        console.error('Bulk delete failed:', e);
        toast(e?.message || 'Failed to delete', 'error');
        finishTask(taskId, { status: 'error', detail: e?.message || 'Failed' });
        await saveRecoveryDraft('bulkDelete');
        hideSaveIndicator('Failed');
    }
}

async function loadConversation(id, folder) {
    try {
        const res = await fetch(`/api/conversation/${encodeURIComponent(id)}?folder=${encodeURIComponent(folder)}`);
        if (res.ok) {
            const conv = await res.json();
            state.generate.conversation = conv;
            setGenerateRawText(conversationToRaw(conv.conversations), { persist: true });
            renderConversation(conv.conversations);
            updateTurnCount(countConversationTurns(conv.conversations));
            enableActionButtons();
            switchTab('generate');
            if (window.innerWidth < 1024) toggleSidebar();
        }
    } catch (e) { toast('Failed to load conversation', 'error'); }
}

function conversationToRaw(messages) {
    return messages.map(m => {
        const role = m.from === 'human' ? 'user' : (m.from === 'system' ? 'system' : 'gpt');
        return `${role}: ${m.value}`;
    }).join('\n---\n');
}

async function readSSEStream(reader, onMessage) {
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data: ')) continue;

            const payload = line.slice(6);
            if (!payload) continue;

            const data = JSON.parse(payload);
            await onMessage(data);
        }
    }

    const finalLine = buffer.trim();
    if (finalLine.startsWith('data: ')) {
        const payload = finalLine.slice(6);
        if (payload) {
            await onMessage(JSON.parse(payload));
        }
    }
}

// ============ MODEL ACTIVITY (Bottom-right indicator + inspector) ============
function formatProviderLabel(provider) {
    if (provider === 'openai') return 'OpenAI';
    if (provider === 'anthropic') return 'Anthropic';
    if (provider === 'google') return 'Google';
    return String(provider || '—');
}

function beginModelActivity({ provider, model, source } = {}) {
    state.modelActivity.runId += 1;
    const runId = state.modelActivity.runId;
    state.modelActivity.phase = 'waiting';
    state.modelActivity.label = 'Waiting for request...';
    state.modelActivity.provider = String(provider || '');
    state.modelActivity.model = String(model || '');
    state.modelActivity.source = String(source || '');
    state.modelActivity.raw = '';
    state.modelActivity.hasFirstToken = false;
    updateModelActivityUI();
    return runId;
}

function setModelActivityPhase(runId, phase) {
    if (runId !== state.modelActivity.runId) return;
    state.modelActivity.phase = phase;
    if (phase === 'waiting') state.modelActivity.label = 'Waiting for request...';
    else if (phase === 'thinking') state.modelActivity.label = 'Thinking...';
    else if (phase === 'writing') state.modelActivity.label = 'Writing...';
    else if (phase === 'done') state.modelActivity.label = 'Done';
    else if (phase === 'canceled') state.modelActivity.label = 'Canceled';
    else if (phase === 'error') state.modelActivity.label = 'Error';
    updateModelActivityUI();
}

function appendModelActivityText(runId, text) {
    if (runId !== state.modelActivity.runId) return;
    const chunk = String(text || '');
    if (!chunk) return;
    const MAX = 300_000;
    state.modelActivity.raw = (state.modelActivity.raw || '') + chunk;
    if (state.modelActivity.raw.length > MAX) {
        state.modelActivity.raw = '…' + state.modelActivity.raw.slice(-MAX);
    }
    updateModelInspectorUI();
}

function updateModelActivityUI() {
    if (!els.modelActivityIndicator) return;

    const isIdle = state.modelActivity.phase === 'idle';
    const showSpinner = ['waiting', 'thinking', 'writing'].includes(state.modelActivity.phase);
    const pausedSpinner = !showSpinner;

    const providerLabel = formatProviderLabel(state.modelActivity.provider);
    const modelLabel = state.modelActivity.model || '—';
    const sourceLabel = state.modelActivity.source || '—';
    const meta = `${providerLabel} · ${modelLabel} · ${sourceLabel}`;

    if (els.modelActivityLabel) els.modelActivityLabel.textContent = state.modelActivity.label || '—';
    if (els.modelActivityMeta) els.modelActivityMeta.textContent = meta;
    if (els.modelActivitySpinner) {
        els.modelActivitySpinner.classList.toggle('paused', pausedSpinner);
        els.modelActivitySpinner.style.opacity = showSpinner ? '1' : '0.55';
    }

    if (isIdle) return;

    if (els.modelActivityIndicator.classList.contains('hidden')) {
        els.modelActivityIndicator.classList.remove('hidden');
        requestAnimationFrame(() => els.modelActivityIndicator.classList.add('show'));
    } else {
        els.modelActivityIndicator.classList.add('show');
    }

    updateModelInspectorUI();
    updateStatusStackLayout();
}

function openModelInspector() {
    if (!els.modelInspectorModal) return;
    if (state.modelActivity.phase === 'idle') return;
    els.modelInspectorModal.classList.remove('hidden');
    updateModelInspectorUI();
}

function closeModelInspector() {
    if (!els.modelInspectorModal) return;
    els.modelInspectorModal.classList.add('hidden');
}

function updateModelInspectorUI() {
    if (!els.modelInspectorModal || els.modelInspectorModal.classList.contains('hidden')) return;
    const providerLabel = formatProviderLabel(state.modelActivity.provider);
    const modelLabel = state.modelActivity.model || '—';
    const sourceLabel = state.modelActivity.source || '—';
    if (els.modelInspectorStatus) els.modelInspectorStatus.textContent = state.modelActivity.label || '—';
    if (els.modelInspectorMeta) els.modelInspectorMeta.textContent = `${providerLabel} · ${modelLabel} · ${sourceLabel}`;
    if (els.modelInspectorRaw) els.modelInspectorRaw.textContent = state.modelActivity.raw || '';
}

function dismissModelActivity() {
    // Invalidate the current run so in-flight callbacks can't revive the UI.
    state.modelActivity.runId = Number(state.modelActivity.runId || 0) + 1;
    state.modelActivity.phase = 'idle';
    state.modelActivity.label = '';
    state.modelActivity.provider = '';
    state.modelActivity.model = '';
    state.modelActivity.source = '';
    state.modelActivity.raw = '';
    state.modelActivity.hasFirstToken = false;

    closeModelInspector();

    if (els.modelActivityIndicator) {
        els.modelActivityIndicator.classList.remove('show');
        setTimeout(() => {
            if (state.modelActivity.phase !== 'idle') return;
            els.modelActivityIndicator.classList.add('hidden');
            updateStatusStackLayout();
        }, 300);
    }
    updateStatusStackLayout();
}

// ============ GENERATION (Single & Bulk) ============
function setGenerateRawText(rawText, { persist = false } = {}) {
    const next = String(rawText ?? '');
    state.generate.rawText = next;
    if (els.conversationEdit) els.conversationEdit.value = next;
    if (persist) {
        syncEngine.markDirty();
        debouncedSaveDraft();
    }
    return next;
}

function getGenerateRawText() {
    return state.generate.isEditing
        ? String(els.conversationEdit?.value ?? '')
        : String(state.generate.rawText ?? '');
}

function splitRawConversationBlocks(text) {
    const rawText = String(text ?? '');
    if (!rawText.trim()) return [];
    return rawText
        .split(RAW_CONVERSATION_SEPARATOR_RE)
        .map(part => part.trim())
        .filter(Boolean);
}

function buildGenerateMetadata({
    promptResolved = null,
    macroTrace = null,
    generatedAt = null,
    rejectReason = null
} = {}) {
    const metadata = {
        provider: els.provider.value,
        model: getModelValue(),
        temperature: parseFloat(els.temperature.value),
        prompt_template: state.currentPromptName,
        variables: safeJsonClone(state.generate.variables, {}),
        custom_params: safeJsonClone(state.customParams, {})
    };
    if (promptResolved !== null) metadata.prompt_resolved = promptResolved;
    if (macroTrace !== null) metadata.macro_trace = safeJsonClone(macroTrace, null);
    if (generatedAt) metadata.generated_at = generatedAt;
    if (rejectReason) metadata.reject_reason = rejectReason;
    return metadata;
}

function buildReviewQueueItemsFromRawText(rawText, metadata = {}) {
    const blocks = splitRawConversationBlocks(rawText);
    const items = [];
    for (const convRaw of blocks) {
        const parsed = parseMinimalFormat(convRaw);
        if (parsed.length > 0) {
            items.push({
                conversations: parsed,
                rawText: convRaw,
                metadata: safeJsonClone(metadata, {})
            });
        }
    }
    return { blocks, items };
}

async function queueRawConversations(rawText, { metadata = {}, refreshView = true } = {}) {
    const { blocks, items } = buildReviewQueueItemsFromRawText(rawText, metadata);
    if (items.length === 0) return { blocks, items, added: [] };
    const added = await addReviewQueueItems(items, { refreshView });
    return { blocks, items, added };
}

function hasSavableGenerateContent(rawText = getGenerateRawText()) {
    const blocks = splitRawConversationBlocks(rawText);
    if (!blocks.length) return false;
    return blocks.some(block => parseMinimalFormat(block).length > 0);
}

function renderGenerateMultiConversationNotice(count) {
    els.conversationView.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">${ICON_EMPTY_QUEUE}</div>
            <p>${count} conversations detected</p>
            <p class="small">Use Save or Reject to add them to the review queue.</p>
        </div>
    `;
}

function syncGenerateActionButtons() {
    if (!state.generate.isLoading && hasSavableGenerateContent()) enableActionButtons();
    else disableActionButtons();
}

let syncGenerateActionButtonsTimer = null;
function debouncedSyncGenerateActionButtons(delay = 120) {
    if (syncGenerateActionButtonsTimer) clearTimeout(syncGenerateActionButtonsTimer);
    syncGenerateActionButtonsTimer = setTimeout(() => {
        syncGenerateActionButtonsTimer = null;
        syncGenerateActionButtons();
    }, delay);
}

async function generate() {
    const count = parseInt(els.bulkCount?.value) || 1;
    if (count > 1) { await bulkGenerate(count); return; }

    if (state.generate.isLoading) {
        if (state.generate.abortController) {
            state.generate.abortController.abort();
            state.generate.abortController = null;
            setModelActivityPhase(state.modelActivity.runId, 'canceled');
            toast('Generation stopped', 'info');
        }
        return;
    }

    const previewResolved = applyVariables(els.systemPrompt.value, true);
    const okToSend = await confirmIfUnresolved({
        title: 'Unresolved placeholders',
        context: 'The generated prompt still contains {{...}} placeholders. Missing variables will be sent as-is.',
        resolvedText: previewResolved
    });
    if (!okToSend) return;

    state.generate.isLoading = true;
    state.generate.abortController = new AbortController();
    els.generateBtn.classList.add('btn-danger');
    els.generateBtn.classList.remove('btn-primary');
    els.generateBtn.textContent = 'Stop';
    syncGenerateActionButtons();

    const promptText = applyVariables(els.systemPrompt.value);
    state.generate.lastResolvedPrompt = promptText;
    state.generate.lastMacroTrace = safeJsonClone(state.macroTraceLast, null);
    addToPromptHistory(promptText);
    const modelRunId = beginModelActivity({ provider: els.provider.value, model: getModelValue(), source: 'Generate' });
    let fullText = '';
    try {
        const response = await fetch('/api/generate/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: promptText,
                provider: els.provider.value,
                model: getModelValue(),
                temperature: parseFloat(els.temperature.value),
                custom_params: state.customParams,
                credentials_override: getCredentialOverride(els.provider.value)
            }),
            signal: state.generate.abortController.signal
        });
        if (!response.ok) throw new Error('Generation failed');
        setModelActivityPhase(modelRunId, 'thinking');

        const reader = response.body.getReader();
        els.conversationView.innerHTML = '<div class="streaming-text"></div>';
        const streamingEl = els.conversationView.querySelector('.streaming-text');

        await readSSEStream(reader, async (data) => {
            if (data.content) {
                if (modelRunId === state.modelActivity.runId && !state.modelActivity.hasFirstToken) {
                    state.modelActivity.hasFirstToken = true;
                    setModelActivityPhase(modelRunId, 'writing');
                }
                fullText += data.content;
                appendModelActivityText(modelRunId, data.content);
                streamingEl.textContent = fullText;
                setGenerateRawText(extractOutput(fullText, { allowPartial: true }));
            }
            if (data.done) setModelActivityPhase(modelRunId, 'done');
            if (data.error) throw new Error(data.error);
        });
        setModelActivityPhase(modelRunId, 'done');

        const extractedText = extractOutput(fullText);
        const blocks = splitRawConversationBlocks(extractedText);

        if (blocks.length > 1) {
            const { added } = await queueRawConversations(extractedText, {
                metadata: buildGenerateMetadata({
                    promptResolved: promptText,
                    macroTrace: state.generate.lastMacroTrace,
                    generatedAt: new Date().toISOString()
                })
            });
            if (added.length === blocks.length) {
                toast(`Added ${added.length} conversations to review queue`, 'success');
                resetGenerateTab();
                await saveRecoveryDraft('generateQueued');
            } else if (added.length > 0) {
                setGenerateRawText(extractedText, { persist: true });
                parseAndRender();
                toast(`Added ${added.length}/${blocks.length} conversations to review queue. Kept the remaining blocks in Generate.`, 'warning');
                await saveRecoveryDraft('generateQueuedPartial');
            } else {
                setGenerateRawText(extractedText, { persist: true });
                parseAndRender();
            }
        } else {
            setGenerateRawText(extractedText, { persist: true });
            parseAndRender();
        }
    } catch (e) {
        const partialText = extractOutput(fullText, { allowPartial: true });
        if (partialText) {
            setGenerateRawText(partialText);
            if (hasSavableGenerateContent(partialText)) parseAndRender();
            else syncGenerateActionButtons();
            await saveRecoveryDraft(e.name === 'AbortError' ? 'generateAbort' : 'generateError');
        }
        if (e.name === 'AbortError') {
            setModelActivityPhase(modelRunId, 'canceled');
        } else {
            setModelActivityPhase(modelRunId, 'error');
            toast(e.message || 'Generation failed', 'error');
        }
    } finally {
        state.generate.isLoading = false;
        state.generate.abortController = null;
        els.generateBtn.disabled = false;
        els.generateBtn.classList.remove('btn-danger');
        els.generateBtn.classList.add('btn-primary');
        els.generateBtn.textContent = 'Generate';
        syncGenerateActionButtons();
    }
}

function requestBulkPauseAfterCurrentRun() {
    if (!state.bulk.isRunning) return;
    if (state.bulk.isPaused) return;
    if (state.bulk.pauseRequested) return;
    state.bulk.pauseRequested = true;
    updateBulkProgress();
    toast('Will pause after the current run finishes', 'info');
}

function resumeBulkGeneration() {
    if (!state.bulk.isRunning) return;
    state.bulk.pauseRequested = false;
    state.bulk.isPaused = false;
    const resolver = state.bulk.pauseResolver;
    state.bulk.pauseResolver = null;
    if (typeof resolver === 'function') {
        try { resolver(); } catch (_e) { }
    }
    updateBulkProgress();
}

function toggleBulkPause() {
    if (!state.bulk.isRunning) return;
    if (state.bulk.isPaused) {
        state.bulk.pauseRequested = false;
        resumeBulkGeneration();
        toast('Bulk resumed', 'success');
    } else {
        // Toggle the pending pause request on/off (do not affect the in-flight request).
        if (state.bulk.pauseRequested) {
            state.bulk.pauseRequested = false;
            updateBulkProgress();
            toast('Pause request canceled', 'info');
        } else {
            requestBulkPauseAfterCurrentRun();
        }
    }
}

async function bulkGenerate(count) {
    if (state.bulk.isRunning) {
        if (state.bulk.abortController) { state.bulk.abortController.abort(); }
        return;
    }

    const { text: bulkPreviewResolved } = resolvePromptWithTrace(String(els.systemPrompt?.value || ''), { isPreview: true, recordTrace: false, iteratorState: {} });
    const okToSend = await confirmIfUnresolved({
        title: 'Unresolved placeholders',
        context: 'Bulk generation will send prompts as-is if they still contain {{...}} placeholders.',
        resolvedText: bulkPreviewResolved
    });
    if (!okToSend) return;

    state.bulk.isRunning = true;
    state.bulk.pauseRequested = false;
    state.bulk.isPaused = false;
    state.bulk.pauseResolver = null;
    state.bulk.total = count;
    state.bulk.completed = 0;
    state.bulk.abortController = new AbortController();
    state.bulk.activeIndex = null;

    els.bulkProgress.classList.remove('hidden');
    updateBulkProgress();
    state.listIterators = {};
    state.bulk.runs = [];
    state.bulk.selectedRunIndex = null;
    renderBulkDetailsSummary();
    renderBulkDetailsList();
    renderBulkDetailsPreview();

    let queuedCount = 0;
    const maybePauseBetweenRuns = async () => {
        const signal = state.bulk.abortController?.signal || null;
        if (!state.bulk.pauseRequested || signal?.aborted) return;
        state.bulk.pauseRequested = false;
        state.bulk.isPaused = true;
        updateBulkProgress();

        let abortListener = null;
        const resumePromise = new Promise(resolve => { state.bulk.pauseResolver = resolve; });
        const abortPromise = new Promise(resolve => {
            if (!signal) return;
            if (signal.aborted) return resolve();
            abortListener = () => resolve();
            signal.addEventListener('abort', abortListener, { once: true });
        });

        await Promise.race([resumePromise, abortPromise]);
        if (abortListener && signal) signal.removeEventListener('abort', abortListener);
        state.bulk.pauseResolver = null;
        state.bulk.isPaused = false;
        updateBulkProgress();
    };
    for (let i = 0; i < count; i++) {
        if (state.bulk.abortController.signal.aborted) break;
        state.bulk.activeIndex = i;
        const promptText = applyVariables(els.systemPrompt.value);
        addToPromptHistory(promptText); // record each resolved prompt

        const run = {
            status: 'running',
            provider: els.provider.value,
            model: getModelValue(),
            startedAt: new Date().toISOString(),
            promptResolved: String(promptText || '').slice(0, 5000),
            macroTrace: safeJsonClone(state.macroTraceLast, null),
            outputText: '',
            charCount: 0,
            error: ''
        };
        state.bulk.runs.push(run);
        if (state.bulk.selectedRunIndex == null) state.bulk.selectedRunIndex = 0;
        throttledRenderBulkDetails();
        renderBulkDetailsPreview();
        updateBulkProgress();

        const modelRunId = beginModelActivity({ provider: els.provider.value, model: getModelValue(), source: `Bulk ${i + 1}/${count}` });
        try {
            const response = await fetch('/api/generate/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: promptText,
                    provider: els.provider.value,
                    model: getModelValue(),
                    temperature: parseFloat(els.temperature.value),
                    custom_params: state.customParams,
                    credentials_override: getCredentialOverride(els.provider.value)
                }),
                signal: state.bulk.abortController.signal
            });
            if (!response.ok) throw new Error(`Bulk generation failed (${response.status})`);
            setModelActivityPhase(modelRunId, 'thinking');
            run.status = 'thinking';
            throttledRenderBulkDetails();
            updateBulkProgress();

            const reader = response.body.getReader();
            let fullText = '';
            let sawToken = false;
            await readSSEStream(reader, async (data) => {
                if (data.error) throw new Error(data.error);
                if (data.done) return;
                if (data.content) {
                    if (!sawToken) {
                        sawToken = true;
                        run.status = 'writing';
                        setModelActivityPhase(modelRunId, 'writing');
                        updateBulkProgress();
                    }
                    fullText += data.content;
                    appendModelActivityText(modelRunId, data.content);
                    run.charCount = Number(run.charCount || 0) + String(data.content || '').length;
                    // Keep the preview bounded.
                    run.outputText = (run.outputText || '') + data.content;
                    if (run.outputText.length > 12_000) run.outputText = '…' + run.outputText.slice(-12_000);
                    if (state.bulk.selectedRunIndex === i) renderBulkDetailsPreview();
                }
            });
            setModelActivityPhase(modelRunId, 'done');
            run.status = 'done';

            const extractedText = extractOutput(fullText);
            run.outputText = String(extractedText || '').slice(0, 20_000);
            run.finishedAt = new Date().toISOString();
            throttledRenderBulkDetails();
            if (state.bulk.selectedRunIndex === i) renderBulkDetailsPreview();
            updateBulkProgress();

            const { blocks, added } = await queueRawConversations(extractedText, {
                metadata: buildGenerateMetadata({
                    promptResolved: promptText,
                    macroTrace: run.macroTrace,
                    generatedAt: run.startedAt
                }),
                refreshView: false
            });
            run.generatedCount = blocks.length;
            run.queuedCount = added.length;
            queuedCount += added.length;
            throttledRenderBulkDetails();
        } catch (e) {
            if (e.name === 'AbortError') {
                run.status = 'canceled';
                run.error = '';
                run.finishedAt = new Date().toISOString();
                setModelActivityPhase(modelRunId, 'canceled');
                throttledRenderBulkDetails();
                if (state.bulk.selectedRunIndex === i) renderBulkDetailsPreview();
                updateBulkProgress();
                break;
            }
            run.status = 'error';
            run.error = e?.message || String(e);
            run.finishedAt = new Date().toISOString();
            setModelActivityPhase(modelRunId, 'error');
            throttledRenderBulkDetails();
            if (state.bulk.selectedRunIndex === i) renderBulkDetailsPreview();
            updateBulkProgress();
        }
        state.bulk.completed++;
        updateBulkProgress();
        if (i < count - 1) {
            await maybePauseBetweenRuns();
        }
    }

    const wasCanceled = !!state.bulk.abortController?.signal?.aborted;
    state.bulk.isRunning = false;
    state.bulk.pauseRequested = false;
    state.bulk.isPaused = false;
    state.bulk.pauseResolver = null;
    state.bulk.abortController = null;
    state.bulk.activeIndex = null;
    els.bulkProgress.classList.add('hidden');
    renderBulkDetailsSummary();
    const summary = queuedCount > 0
        ? `${state.bulk.completed}/${count} completed · ${queuedCount} queued`
        : `${state.bulk.completed}/${count} completed`;
    toast(wasCanceled ? `Bulk generation canceled (${summary})` : `Bulk generation finished (${summary})`, wasCanceled ? 'info' : 'success');
    updateReviewBadge();
    if (queuedCount > 0) switchTab('review');
}

function updateBulkProgress() {
    const pct = state.bulk.total > 0 ? (state.bulk.completed / state.bulk.total * 100) : 0;
    if (els.bulkProgressFill) els.bulkProgressFill.style.width = pct + '%';
    if (els.bulkProgressText) {
        const base = `${state.bulk.completed}/${state.bulk.total}`;
        const idx = typeof state.bulk.activeIndex === 'number' ? state.bulk.activeIndex : null;
        const active = (idx != null && idx >= 0 && idx < (state.bulk.runs || []).length) ? state.bulk.runs[idx] : null;
        if (!state.bulk.isRunning || !active) {
            els.bulkProgressText.textContent = base;
        } else {
            const status = String(active.status || 'running');
            const meta = [formatProviderLabel(active.provider), active.model || '—'].filter(Boolean).join(' · ');
            const paused = state.bulk.isPaused ? ' · paused' : (state.bulk.pauseRequested ? ' · pause requested' : '');
            els.bulkProgressText.textContent = `${base} · #${idx + 1} ${status}${paused} · ${meta}`;
        }
    }
    if (els.bulkPause) {
        els.bulkPause.textContent = state.bulk.isPaused ? 'Resume' : (state.bulk.pauseRequested ? 'Cancel pause' : 'Pause');
        els.bulkPause.disabled = !state.bulk.isRunning;
    }
    renderBulkDetailsSummary();
}

let _bulkDetailsRaf = null;
function throttledRenderBulkDetails() {
    if (_bulkDetailsRaf) return;
    _bulkDetailsRaf = requestAnimationFrame(() => {
        renderBulkDetailsList();
        _bulkDetailsRaf = null;
    });
}

function openBulkDetailsModal() {
    if (!els.bulkDetailsModal) return;
    els.bulkDetailsModal.classList.remove('hidden');
    renderBulkDetailsList();
    renderBulkDetailsPreview();
}

function closeBulkDetailsModal() {
    els.bulkDetailsModal?.classList.add('hidden');
}

function renderBulkDetailsSummary() {
    if (!els.bulkDetailsSummary) return;
    const total = Number(state.bulk.total || 0);
    const completed = Number(state.bulk.completed || 0);
    const errs = state.bulk.runs.filter(r => r.status === 'error').length;
    const canceled = state.bulk.runs.filter(r => r.status === 'canceled').length;
    const done = state.bulk.runs.filter(r => r.status === 'done').length;
    const queued = state.bulk.runs.reduce((sum, run) => sum + (Number(run?.queuedCount || 0) || 0), 0);
    const parts = [
        total ? `Total: ${total}` : '',
        `Done: ${done}`,
        queued ? `Queued: ${queued}` : '',
        errs ? `Errors: ${errs}` : '',
        canceled ? `Canceled: ${canceled}` : '',
        state.bulk.isRunning ? (state.bulk.isPaused ? 'Paused' : `Running: ${completed + 1}`) : ''
    ].filter(Boolean);
    els.bulkDetailsSummary.textContent = parts.join(' · ');
}

function renderBulkDetailsList() {
    if (!els.bulkDetailsList) return;
    const runs = state.bulk.runs || [];
    if (runs.length === 0) {
        els.bulkDetailsList.innerHTML = '<div class="empty-files">No bulk runs yet</div>';
        return;
    }
    els.bulkDetailsList.innerHTML = runs.map((r, idx) => {
        const active = state.bulk.selectedRunIndex === idx;
        const status = r.status || 'running';
        const meta = [r.provider ? formatProviderLabel(r.provider) : '', r.model || ''].filter(Boolean).join(' · ');
        const detail = status === 'error' ? (r.error || 'Error') : status;
        const showSpinner = ['running', 'thinking', 'writing'].includes(status);
        const pillLabel = status === 'writing' ? 'typing…' : status;
        const chars = Number(r.charCount || 0) || 0;
        const snippet = String(r.outputText || '').trim().split('\n')[0] || '';
        const snippetTrimmed = snippet.length > 140 ? snippet.slice(0, 140) + '…' : snippet;
        const queued = Number(r.queuedCount || 0) || 0;
        const meta2 = [meta, queued ? `${queued} queued` : '', chars ? `${chars.toLocaleString()} chars` : '', snippetTrimmed ? `“${snippetTrimmed}”` : ''].filter(Boolean).join(' • ');
        return `<div class="export-file-item ${active ? 'active-preview' : ''}" data-index="${idx}">
            <div class="export-file-info">
                <div class="export-file-preview bulk-run-preview">
                    ${showSpinner ? '<span class="inline-spinner" aria-hidden="true"></span>' : ''}
                    <span>#${idx + 1}</span>
                    <span class="bulk-status-pill bulk-status-${escapeHtml(status)}">${escapeHtml(pillLabel)}</span>
                    <span class="bulk-run-detail">${escapeHtml(detail)}</span>
                </div>
                <div class="export-file-meta">${escapeHtml(meta2 || '')}</div>
            </div>
        </div>`;
    }).join('');
}

function renderBulkDetailsPreview() {
    if (!els.bulkDetailsPreview) return;
    const idx = state.bulk.selectedRunIndex;
    const run = (typeof idx === 'number') ? state.bulk.runs[idx] : null;
    if (!run) {
        els.bulkDetailsPreview.textContent = 'Select a run to preview it here';
        return;
    }
    const lines = [];
    lines.push(`#${(idx + 1)} — ${run.status || 'running'}`);
    if (run.provider || run.model) lines.push(`Model: ${formatProviderLabel(run.provider)} · ${run.model || '—'}`);
    if (run.error) lines.push(`Error: ${run.error}`);
    if (run.promptResolved) lines.push(`\nResolved prompt:\n${run.promptResolved}`);
    if (run.outputText) lines.push(`\nOutput:\n${run.outputText}`);
    els.bulkDetailsPreview.textContent = lines.join('\n');
}

function parseAndRender() {
    // Force parse from edit buffer if editing
    if (state.generate.isEditing) {
        setGenerateRawText(els.conversationEdit.value);
    }
    const rawText = getGenerateRawText();
    const blocks = splitRawConversationBlocks(rawText);
    if (blocks.length > 1) {
        state.generate.conversation = null;
        renderGenerateMultiConversationNotice(blocks.length);
        updateTurnCount(blocks.length, 'conversation', 'conversations');
        syncGenerateActionButtons();
        return;
    }
    const parsed = parseMinimalFormat(rawText);
    state.generate.conversation = { conversations: parsed };
    renderConversation(parsed);
    updateTurnCount(countConversationTurns(parsed));
    syncGenerateActionButtons();
}

function extractOutput(text, { allowPartial = false } = {}) {
    const source = String(text ?? '');
    const match = source.match(/<output>([\s\S]*?)<\/output>/);
    if (match) {
        return match[1].trim();
    }
    if (allowPartial) {
        const start = source.indexOf('<output>');
        if (start !== -1) return source.slice(start + '<output>'.length).trimStart();
    }
    return source.trim();
}

function parseMinimalFormat(text) {
    const blocks = text.split(/^---\s*$/m);
    const conversations = [];
    for (const block of blocks) {
        const trimmed = block.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^(user|gpt|system):\s*([\s\S]*)/);
        if (match) {
            const role = match[1] === 'user' ? 'human' : match[1];
            conversations.push({ from: role, value: match[2].trim() });
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
                <span class="role-label">${getConversationRoleLabel(m.from)}</span>
            </div>
            <div class="bubble-content">${escapeHtml(m.value)}</div>
        </div>
    `).join('');
    els.conversationView.scrollTop = els.conversationView.scrollHeight;
}

function updateTurnCount(count, singular = 'turn', plural = 'turns') {
    els.turnCount.textContent = `${count} ${count === 1 ? singular : plural}`;
}


// ============ SAVE/REJECT ============
async function saveConversation(folder, reason = null) {
    const rawText = setGenerateRawText(getGenerateRawText());
    const blocks = splitRawConversationBlocks(rawText);
    if (blocks.length > 1) {
        const { added } = await queueRawConversations(rawText, {
            metadata: buildGenerateMetadata({ rejectReason: reason })
        });
        if (added.length === blocks.length) {
            toast(`Added ${added.length} conversations to review queue`, 'success');
            hideSaveIndicator('Queued ✓');
            resetGenerateTab();
            await saveRecoveryDraft('saveConversationQueue');
            switchTab('review');
        } else if (added.length > 0) {
            setGenerateRawText(rawText, { persist: true });
            parseAndRender();
            toast(`Added ${added.length}/${blocks.length} conversations to review queue. Kept the remaining blocks in Generate.`, 'warning');
            await saveRecoveryDraft('saveConversationQueuePartial');
        } else {
            toast('No valid conversations found to add to the review queue', 'info');
        }
        return;
    }
    parseAndRender();
    if (!state.generate.conversation?.conversations?.length) return;

    showSaveIndicator('Saving...');
    const metadata = buildGenerateMetadata({ rejectReason: reason });

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
        } else {
            const err = await res.json().catch(() => ({}));
            toast(err.error || 'Failed to save', 'error');
            await saveRecoveryDraft('saveConversation');
            hideSaveIndicator('Save failed');
        }
    } catch (e) {
        toast('Failed to save', 'error');
        await saveRecoveryDraft('saveConversation');
        hideSaveIndicator('Save failed');
    }
}

function showRejectModal() {
    if (syncSettings.askRejectReason === false) {
        saveConversation('rejected', 'none');
        return;
    }
    els.rejectModal.classList.remove('hidden');
}
function hideRejectModal() { els.rejectModal.classList.add('hidden'); }

function resetGenerateTab() {
    state.generate.conversation = null;
    setGenerateRawText('', { persist: true });
    renderConversation([]);
    updateTurnCount(0);
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
        els.conversationEdit.value = getGenerateRawText();
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
        setGenerateRawText(els.conversationEdit.value);
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
        if (state.chat.abortController) {
            state.chat.abortController.abort();
            state.chat.abortController = null;
            setModelActivityPhase(state.modelActivity.runId, 'canceled');
            toast('Chat stopped', 'info');
        }
        return;
    }
    const message = els.chatInput.value.trim();
    if (!message) {
        if (state.chat.messages.length > 0 && state.chat.messages[state.chat.messages.length - 1].from === 'human') {
            await generateAIResponse();
        }
        return;
    }

    const previewMsg = applyVariables(message, true);
    const previewSys = applyVariables(els.chatSystemPrompt?.value || 'You are a helpful and friendly conversational assistant. Keep responses natural and engaging.', true);
    const okToSend = await confirmIfUnresolved({
        title: 'Unresolved placeholders',
        context: 'Your chat message or system prompt still contains {{...}} placeholders.',
        resolvedText: `${previewSys}\n${previewMsg}`
    });
    if (!okToSend) return;

    const resolvedMessage = applyVariables(message);
    state.chat.messages.push({ from: 'human', value: resolvedMessage, timestamp: new Date().toISOString() });
    debouncedSaveDraft();
    els.chatInput.value = '';
    renderChatMessages();

    state.chat.isStreaming = true;
    state.chat.abortController = new AbortController();
    setButtonToStop(els.sendBtn);

    const context = state.chat.messages.map(m => `${m.from === 'human' ? 'User' : 'Assistant'}: ${m.value}`).join('\n');
    const baseSystemPrompt = applyVariables(els.chatSystemPrompt?.value || 'You are a helpful and friendly conversational assistant. Keep responses natural and engaging.');
    state.chat.lastResolvedSystemPrompt = baseSystemPrompt;
    const systemPrompt = `${baseSystemPrompt}\n\nPrevious conversation:\n${context}\n\nContinue the conversation naturally.`;

    const streamingMsg = { from: 'gpt', value: '', timestamp: new Date().toISOString(), streaming: true };

    const modelRunId = beginModelActivity({ provider: els.provider.value, model: getModelValue(), source: 'Chat' });
    try {
        const response = await fetch('/api/generate/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: resolvedMessage, system_prompt: systemPrompt,
                provider: els.provider.value, model: getModelValue(),
                temperature: parseFloat(els.temperature.value),
                custom_params: state.customParams,
                credentials_override: getCredentialOverride(els.provider.value)
            }),
            signal: state.chat.abortController.signal
        });
        if (!response.ok) throw new Error('Failed to send message');
        setModelActivityPhase(modelRunId, 'thinking');
        const reader = response.body.getReader();
        let fullText = '';
        state.chat.messages.push(streamingMsg);
        renderChatMessages();

        await readSSEStream(reader, async (data) => {
            if (data.error) throw new Error(data.error);
            if (data.done) return;
            if (data.content) {
                if (modelRunId === state.modelActivity.runId && !state.modelActivity.hasFirstToken) {
                    state.modelActivity.hasFirstToken = true;
                    setModelActivityPhase(modelRunId, 'writing');
                }
                fullText += data.content;
                appendModelActivityText(modelRunId, data.content);
                streamingMsg.value = fullText;
                throttledRenderChat();
            }
        });
        setModelActivityPhase(modelRunId, 'done');
        streamingMsg.streaming = false;
        renderChatMessages();
        updateChatTurns();
        enableChatButtons();
    } catch (e) {
        if (e.name !== 'AbortError') {
            setModelActivityPhase(modelRunId, 'error');
            toast(e.message || 'Failed to send message', 'error');
            const idx = state.chat.messages.indexOf(streamingMsg);
            if (idx > -1) state.chat.messages.splice(idx, 1);
        } else {
            setModelActivityPhase(modelRunId, 'canceled');
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

async function deleteMessage(index) {
    const ok = await popupConfirm({
        title: 'Delete Message',
        message: 'Delete this message?',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        danger: true
    });
    if (!ok) return;
    state.chat.messages.splice(index, 1);
    renderChatMessages();
    updateChatTurns();
    debouncedSaveDraft();
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

async function clearChat({ confirm = true } = {}) {
    if (confirm) {
        const ok = await popupConfirm({
            title: 'Clear Chat',
            message: 'Clear all messages?',
            confirmText: 'Clear',
            cancelText: 'Cancel',
            danger: true
        });
        if (!ok) return;
    }
    state.chat.messages = [];
    renderChatMessages();
    updateChatTurns();
    disableChatButtons();
    debouncedSaveDraft();
}

async function saveChat() {
    if (state.chat.messages.length < 2) return;
    showSaveIndicator('Saving chat...');
    const fallbackSystem = applyVariables(els.chatSystemPrompt?.value || 'You are a helpful and friendly conversational assistant. Keep responses natural and engaging.', true);
    const systemPrompt = String(state.chat.lastResolvedSystemPrompt || fallbackSystem || '').trim();
    const messages = [];
    if (systemPrompt) messages.push({ from: 'system', value: systemPrompt });
    messages.push(...state.chat.messages.map(m => ({ from: m.from, value: m.value })));
    const conversation = { conversations: messages };
    try {
        const res = await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversation, folder: 'wanted', metadata: { source: 'chat', model: getModelValue(), system_prompt: systemPrompt } })
        });
        if (res.ok) {
            toast('Chat saved!', 'success');
            hideSaveIndicator('Saved ✓');
            await clearChat({ confirm: false });
            loadStats();
        } else {
            const err = await res.json().catch(() => ({}));
            toast(err.error || 'Failed to save chat', 'error');
            await saveRecoveryDraft('saveChat');
            hideSaveIndicator('Save failed');
        }
    } catch (e) {
        toast('Failed to save chat', 'error');
        await saveRecoveryDraft('saveChat');
        hideSaveIndicator('Save failed');
    }
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
        if (state.chat.abortController) {
            state.chat.abortController.abort();
            state.chat.abortController = null;
            setModelActivityPhase(state.modelActivity.runId, 'canceled');
        }
        return;
    }
    if (state.chat.messages.length === 0) { toast('No context to regenerate from', 'info'); return; }

    const previewSys = applyVariables(els.chatSystemPrompt?.value || 'You are a helpful and friendly conversational assistant. Keep responses natural and engaging.', true);
    const okToSend = await confirmIfUnresolved({
        title: 'Unresolved placeholders',
        context: 'Your chat system prompt still contains {{...}} placeholders.',
        resolvedText: previewSys
    });
    if (!okToSend) return;

    state.chat.isStreaming = true;
    state.chat.abortController = new AbortController();
    setButtonToStop(els.sendBtn);

    const context = state.chat.messages.map(m => `${m.from === 'human' ? 'User' : 'Assistant'}: ${m.value}`).join('\n');
    const baseSystemPrompt = applyVariables(els.chatSystemPrompt?.value || 'You are a helpful and friendly conversational assistant. Keep responses natural and engaging.');
    state.chat.lastResolvedSystemPrompt = baseSystemPrompt;
    const systemPrompt = `${baseSystemPrompt}\n\nPrevious conversation:\n${context}\n\nContinue the conversation naturally.`;
    const lastUserMsg = [...state.chat.messages].reverse().find(m => m.from === 'human');
    const promptText = lastUserMsg?.value || 'Continue the conversation.';

    const streamingMsg = { from: 'gpt', value: '', timestamp: new Date().toISOString(), streaming: true };
    state.chat.messages.push(streamingMsg);
    renderChatMessages();

    const modelRunId = beginModelActivity({ provider: els.provider.value, model: getModelValue(), source: 'Chat' });
    try {
        const response = await fetch('/api/generate/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: promptText, system_prompt: systemPrompt,
                provider: els.provider.value, model: getModelValue(),
                temperature: parseFloat(els.temperature.value),
                custom_params: state.customParams,
                credentials_override: getCredentialOverride(els.provider.value)
            }),
            signal: state.chat.abortController.signal
        });
        if (!response.ok) throw new Error('Failed to generate response');
        setModelActivityPhase(modelRunId, 'thinking');
        const reader = response.body.getReader();
        let fullText = '';

        await readSSEStream(reader, async (data) => {
            if (data.error) throw new Error(data.error);
            if (data.done) return;
            if (data.content) {
                if (modelRunId === state.modelActivity.runId && !state.modelActivity.hasFirstToken) {
                    state.modelActivity.hasFirstToken = true;
                    setModelActivityPhase(modelRunId, 'writing');
                }
                fullText += data.content;
                appendModelActivityText(modelRunId, data.content);
                streamingMsg.value = fullText;
                throttledRenderChat();
            }
        });
        setModelActivityPhase(modelRunId, 'done');
        streamingMsg.streaming = false;
        renderChatMessages();
        updateChatTurns();
        enableChatButtons();
    } catch (e) {
        if (e.name !== 'AbortError') {
            setModelActivityPhase(modelRunId, 'error');
            toast(e.message || 'Failed to generate response', 'error');
            const idx = state.chat.messages.indexOf(streamingMsg);
            if (idx > -1) state.chat.messages.splice(idx, 1);
        } else {
            setModelActivityPhase(modelRunId, 'canceled');
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
function isValidConversationMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return false;
    let hasHuman = false;
    let hasGpt = false;
    for (const m of messages) {
        if (!m || typeof m !== 'object') continue;
        const from = m.from;
        const value = String(m.value ?? '');
        if (!value.trim()) continue;
        if (from === 'human') hasHuman = true;
        if (from === 'gpt') hasGpt = true;
    }
    return hasHuman && hasGpt;
}

function createLocalReviewEntry(item) {
    return {
        id: 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2),
        conversations: item.conversations,
        rawText: item.rawText,
        metadata: item.metadata || {},
        createdAt: new Date().toISOString()
    };
}

async function addReviewQueueItems(items, { refreshView = true } = {}) {
    if (!items.length) return [];
    const seen = new Set();
    const filtered = [];
    let skippedDup = 0;
    let skippedInvalid = 0;
    for (const it of items) {
        if (!it || typeof it !== 'object') { skippedInvalid++; continue; }
        const convs = it.conversations;
        if (!isValidConversationMessages(convs)) { skippedInvalid++; continue; }
        const rawKey = String(it.rawText || JSON.stringify(convs));
        const h = String(syncEngine._simpleHash(rawKey));
        if (seen.has(h)) { skippedDup++; continue; }
        seen.add(h);
        filtered.push(it);
    }
    if (skippedInvalid) toast(`Skipped ${skippedInvalid} invalid items`, 'info');
    if (skippedDup) toast(`Skipped ${skippedDup} duplicates`, 'info');
    if (filtered.length === 0) return [];
    items = filtered;

    const applyReviewTotalUpdate = (nextTotal, { syncPosition = false } = {}) => {
        state.review.total = nextTotal;
        state.review.hasMore = (state.review.pageOffset + state.review.queue.length) < nextTotal;
        updateReviewBadge();
        if (syncPosition) syncReviewPositionUI();
    };

    try {
        const prevTotal = state.review.total || 0;
        const res = await fetch('/api/review-queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items })
        });
        if (!res.ok) throw new Error('Failed to add review items');
        const data = await res.json();
        const added = data.added || [];
        const total = (typeof data.count === 'number') ? data.count : (prevTotal + added.length);
        const shouldRefreshView = refreshView || state.currentTab === 'review' || state.review.queue.length === 0;
        if (shouldRefreshView) {
            if (state.currentTab === 'review' && state.review.queue.length > 0) {
                // Preserve the current review item; only update totals so the UI can continue where it is.
                applyReviewTotalUpdate(total, { syncPosition: true });
            } else {
                const startIndex = Math.max(0, total - added.length);
                await loadReviewQueue({ reset: true, targetAbsoluteIndex: startIndex });
            }
        } else {
            applyReviewTotalUpdate(total, { syncPosition: false });
        }
        await refreshReviewBrowserIfOpen({ reset: true });
        return added;
    } catch (e) {
        const prevTotal = state.review.total || 0;
        const startIndex = prevTotal;
        const localEntries = items.map(createLocalReviewEntry);
        for (const entry of localEntries) {
            try { await dbPut('reviewQueue', entry); } catch (_err) { }
        }
        console.error('Failed to add to server review queue, saved locally:', e);
        toast('Server unreachable: saved review items locally', 'warning');
        const shouldRefreshView = refreshView || state.currentTab === 'review' || state.review.queue.length === 0;
        if (shouldRefreshView) {
            if (state.currentTab === 'review' && state.review.queue.length > 0) {
                const nextTotal = prevTotal + localEntries.length;
                applyReviewTotalUpdate(nextTotal, { syncPosition: true });
            } else {
                await loadReviewQueue({ reset: true, targetAbsoluteIndex: startIndex });
            }
        } else {
            applyReviewTotalUpdate(prevTotal + localEntries.length, { syncPosition: false });
        }
        await refreshReviewBrowserIfOpen({ reset: true });
        return localEntries;
    }
}

async function addToReviewQueue(item) {
    return addReviewQueueItems([item]);
}

function remapSelectableSliceIds(slice, syncedEntries) {
    if (!slice) return;
    if (slice.selectedIds instanceof Set) {
        slice.selectedIds = new Set(Array.from(slice.selectedIds).map(id => syncedEntries.get(id)?.id || id));
    }
    if (slice.anchorId && syncedEntries.has(slice.anchorId)) {
        slice.anchorId = syncedEntries.get(slice.anchorId).id;
    }
    if (slice.previewId && syncedEntries.has(slice.previewId)) {
        slice.previewId = syncedEntries.get(slice.previewId).id;
    }
}

function remapReviewQueueState(syncedEntries) {
    if (!syncedEntries?.size) return;

    state.review.queue = state.review.queue.map(item => {
        const synced = syncedEntries.get(item.id);
        return synced ? { ...item, ...synced } : item;
    });

    state.reviewBrowser.items = state.reviewBrowser.items.map(item => {
        const synced = syncedEntries.get(item.id);
        return synced ? { ...item, ...synced } : item;
    });

    if (state.reviewBrowser.previewConversation?.id && syncedEntries.has(state.reviewBrowser.previewConversation.id)) {
        state.reviewBrowser.previewConversation = {
            ...state.reviewBrowser.previewConversation,
            ...syncedEntries.get(state.reviewBrowser.previewConversation.id)
        };
    }

    remapSelectableSliceIds(state.reviewBrowser, syncedEntries);
}

async function createReviewQueueItemsOnServer(items) {
    const res = await fetch('/api/review-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
    });
    if (!res.ok) throw new Error('Failed to sync review queue item');
    const data = await res.json();
    return data.added || [];
}

async function syncReviewQueueItemsToServer(ids = null) {
    const requestedIds = ids ? new Set(ids.map(String).filter(id => id.startsWith('local-'))) : null;
    if (requestedIds && requestedIds.size === 0) return new Map();

    let pendingItems = [];
    if (requestedIds) {
        const localItems = await Promise.all(Array.from(requestedIds).map(id => dbGet('reviewQueue', id).catch(() => null)));
        const fallbackById = new Map(
            [...state.review.queue, ...state.reviewBrowser.items]
                .filter(item => item?.id && String(item.id).startsWith('local-'))
                .map(item => [String(item.id), item])
        );
        pendingItems = Array.from(requestedIds)
            .map(id => localItems.find(item => String(item?.id || '') === id) || fallbackById.get(id) || null)
            .filter(Boolean);
    } else {
        const localItems = await dbGetAll('reviewQueue');
        const mergedLocalItems = new Map((localItems || []).map(item => [String(item.id), item]));
        [...state.review.queue, ...state.reviewBrowser.items].forEach(item => {
            if (item?.id && String(item.id).startsWith('local-') && !mergedLocalItems.has(String(item.id))) {
                mergedLocalItems.set(String(item.id), item);
            }
        });
        pendingItems = Array.from(mergedLocalItems.values()).filter(item => String(item.id).startsWith('local-'));
    }

    if (pendingItems.length === 0) return new Map();

    const syncedEntries = new Map();
    const payloadItems = pendingItems.map(item => ({
        conversations: item.conversations,
        rawText: item.rawText,
        metadata: item.metadata || {}
    }));
    const added = await createReviewQueueItemsOnServer(payloadItems);

    for (let index = 0; index < pendingItems.length; index++) {
        const item = pendingItems[index];
        const synced = added[index];
        if (!synced?.id) continue;
        syncedEntries.set(item.id, synced);
        await dbDelete('reviewQueue', item.id);
    }

    remapReviewQueueState(syncedEntries);
    return new Map(Array.from(syncedEntries.entries()).map(([oldId, synced]) => [oldId, synced.id]));
}

async function ensureReviewQueueIdsSynced(ids) {
    const idMap = await syncReviewQueueItemsToServer(ids);
    return ids.map(id => idMap.get(id) || id);
}

async function fetchReviewQueueWindowFromServer({ offset = 0, limit = 0, search = '', signal = null, summary = false } = {}) {
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
    const safeLimit = Math.max(1, Math.floor(Number(limit) || getModalPageSize()));
    const MAX_FETCH_ITERATIONS = 10;
    const collected = [];
    let total = 0;
    let nextOffset = safeOffset;
    let guard = 0;
    let iterationCapped = false;

    // The server may cap oversized pages by bytes, so keep fetching until we
    // reconstruct the logical page the UI asked for.
    const maxIterations = Math.max(1, Math.min(safeLimit, MAX_FETCH_ITERATIONS));
    while (collected.length < safeLimit && guard < maxIterations) {
        const requested = safeLimit - collected.length;
        const params = new URLSearchParams({
            limit: String(requested),
            offset: String(nextOffset)
        });
        if (search) params.set('search', search);
        if (summary) params.set('summary', '1');
        const res = await fetch(`/api/review-queue?${params.toString()}`, signal ? { signal } : undefined);
        if (!res.ok) throw new Error('Failed to load review queue');

        const data = await res.json().catch(() => ({}));
        if (data.error) throw new Error(data.error);

        const pageItems = Array.isArray(data.queue) ? data.queue : [];
        if (typeof data.count === 'number') total = data.count;
        if (!pageItems.length) break;

        collected.push(...pageItems);
        nextOffset += pageItems.length;

        const responseTruncated = data.response_truncated === true;
        if (total > 0 && nextOffset >= total) break;
        if (!responseTruncated && pageItems.length < requested) break;
        guard++;
    }

    if (guard >= maxIterations && collected.length < safeLimit) {
        iterationCapped = true;
        console.warn('Review queue window fetch capped; returning partial results', {
            safeLimit,
            guard,
            nextOffset,
            collected: collected.length
        });
    }

    return { items: collected, total: total || collected.length, iterationCapped };
}

async function fetchReviewQueueItem(id, signal = null) {
    const res = await fetch(`/api/review-queue/${encodeURIComponent(id)}`, signal ? { signal } : undefined);
    if (!res.ok) throw new Error('Failed to load review item');
    return res.json();
}

function syncReviewBrowserPreviewState({ allowFallback = true } = {}) {
    state.reviewBrowser.currentRequest = null;
    const previewId = String(state.reviewBrowser.previewId || '');
    const loadedPreview = state.reviewBrowser.items.find(item => String(item?.id || '') === previewId) || null;
    const existingPreview = String(state.reviewBrowser.previewConversation?.id || '') === previewId
        ? state.reviewBrowser.previewConversation
        : null;
    if (loadedPreview?.conversations?.length) {
        state.reviewBrowser.previewConversation = loadedPreview;
        state.reviewBrowser.previewLoading = false;
        return;
    }

    if (previewId) {
        const matchingReviewItem = state.review.queue.find(item => String(item?.id || '') === previewId) || null;
        state.reviewBrowser.previewConversation = matchingReviewItem?.conversations?.length
            ? matchingReviewItem
            : (existingPreview?.conversations?.length ? existingPreview : null);
        state.reviewBrowser.previewLoading = false;
        return;
    }

    if (!allowFallback) {
        state.reviewBrowser.previewConversation = null;
        state.reviewBrowser.previewLoading = false;
        return;
    }

    const currentReviewItem = state.review.queue[state.review.currentIndex] || null;
    if (currentReviewItem?.id && currentReviewItem?.conversations?.length) {
        state.reviewBrowser.previewId = String(currentReviewItem.id);
        state.reviewBrowser.previewConversation = currentReviewItem;
        state.reviewBrowser.previewLoading = false;
        return;
    }

    const firstItem = state.reviewBrowser.items[0] || null;
    state.reviewBrowser.previewId = String(firstItem?.id || '');
    state.reviewBrowser.previewConversation = null;
    state.reviewBrowser.previewLoading = false;
}

async function refreshReviewBrowserIfOpen({ reset = true } = {}) {
    if (els.reviewBrowserModal?.classList.contains('hidden')) return;
    cancelSliceLoadAll(state.reviewBrowser, 'Refreshing');
    await loadReviewBrowser({ reset, preserveState: true });
}

function syncReviewPositionUI() {
    if (!els.reviewPosition || !els.reviewPrev || !els.reviewNext) return;
    const queue = state.review.queue || [];
    if (!queue.length) return;
    const total = state.review.total || queue.length;
    const absolute = state.review.pageOffset + state.review.currentIndex;
    els.reviewPrev.disabled = absolute <= 0;
    els.reviewNext.disabled = absolute >= (total - 1);
    els.reviewPosition.textContent = `${absolute + 1}/${total}`;
}

async function hydrateCurrentReviewItem({ requestSeq = state.review.requestSeq } = {}) {
    const currentIndex = state.review.currentIndex;
    const item = state.review.queue[currentIndex];
    if (!item?.id) return;
    if (Array.isArray(item.conversations) && item.conversations.length) return;

    state.review.currentItemLoading = true;
    if (state.currentTab === 'review') renderReviewItem();
    try {
        let fullItem = null;
        if (String(item.id).startsWith('local-')) {
            fullItem = await dbGet('reviewQueue', item.id).catch(err => {
                console.warn('Failed to get review item from local DB:', err);
                return null;
            });
        } else {
            fullItem = await fetchReviewQueueItem(item.id);
        }
        if (state.review.requestSeq !== requestSeq) return;
        if (state.review.currentIndex !== currentIndex) return;
        const currentItem = state.review.queue[currentIndex];
        if (!currentItem?.id || String(currentItem.id) !== String(item.id)) return;
        if (fullItem) {
            state.review.queue[currentIndex] = {
                ...currentItem,
                ...fullItem,
                id: item.id,
            };
        }
    } catch (e) {
        console.warn('Failed to hydrate review item:', e);
    } finally {
        if (state.review.requestSeq === requestSeq && state.review.currentIndex === currentIndex) {
            state.review.currentItemLoading = false;
            if (state.currentTab === 'review') renderReviewItem();
        }
    }
}

async function loadReviewQueue({ reset = true, targetAbsoluteIndex = null } = {}) {
    const pageSize = getModalPageSize();
    const currentAbsolute = state.review.pageOffset + state.review.currentIndex;
    const desiredAbsolute = (typeof targetAbsoluteIndex === 'number' && Number.isFinite(targetAbsoluteIndex))
        ? Math.max(0, Math.floor(targetAbsoluteIndex))
        : currentAbsolute;
    const desiredPageOffset = Math.floor(desiredAbsolute / pageSize) * pageSize;
    const requestSeq = (state.review.requestSeq || 0) + 1;
    state.review.requestSeq = requestSeq;

    if (reset) {
        state.review.queue = [];
        state.review.pageOffset = desiredPageOffset;
        state.review.total = 0;
        state.review.hasMore = false;
        state.review.currentItemLoading = false;
    }

    state.review.isLoading = true;
    if (reset && state.currentTab === 'review') {
        renderReviewItem();
    }
    try {
        const data = await fetchReviewQueueWindowFromServer({
            offset: state.review.pageOffset,
            limit: pageSize,
            summary: true
        });
        if (state.review.requestSeq !== requestSeq) return;
        const items = data.items || [];
        state.review.queue = items;
        state.review.total = data.total || state.review.queue.length;
        state.review.hasMore = (state.review.pageOffset + state.review.queue.length) < state.review.total;

        const nextAbsolute = Math.min(desiredAbsolute, Math.max(0, state.review.total - 1));
        state.review.currentIndex = Math.max(0, Math.min(nextAbsolute - state.review.pageOffset, Math.max(0, state.review.queue.length - 1)));
        updateReviewBadge();
        renderReviewItem();
        await hydrateCurrentReviewItem({ requestSeq });
    } catch (e) {
        console.warn('Server unreachable, loading review queue from IndexedDB');
        try {
            const items = await dbGetAll('reviewQueue');
            if (state.review.requestSeq !== requestSeq) return;
            const allItems = items || [];
            state.review.total = allItems.length;
            const safeOffset = Math.max(0, Math.min(state.review.pageOffset, Math.max(0, state.review.total - 1)));
            state.review.pageOffset = Math.floor(safeOffset / pageSize) * pageSize;
            state.review.queue = allItems.slice(state.review.pageOffset, state.review.pageOffset + pageSize);
            state.review.hasMore = (state.review.pageOffset + state.review.queue.length) < state.review.total;
            const nextAbsolute = Math.min(desiredAbsolute, Math.max(0, state.review.total - 1));
            state.review.currentIndex = Math.max(0, Math.min(nextAbsolute - state.review.pageOffset, Math.max(0, state.review.queue.length - 1)));
            updateReviewBadge();
            renderReviewItem();
        } catch (err) {
            console.error('Failed to load review queue:', err);
        }
    } finally {
        if (state.review.requestSeq === requestSeq) {
            state.review.isLoading = false;
            state.review.currentItemLoading = false;
            if (state.currentTab === 'review' && state.review.queue.length === 0) {
                renderReviewItem();
            }
        }
    }
}

async function navigateReviewToAbsolute(targetAbsoluteIndex) {
    const total = state.review.total || state.review.queue.length;
    if (total === 0) return;

    const target = Math.max(0, Math.min(Math.floor(targetAbsoluteIndex), total - 1));
    const pageStart = state.review.pageOffset;
    const pageEnd = pageStart + state.review.queue.length - 1;
    if (target >= pageStart && target <= pageEnd) {
        state.review.currentIndex = target - pageStart;
        renderReviewItem();
        await hydrateCurrentReviewItem();
        return;
    }

    await loadReviewQueue({ reset: true, targetAbsoluteIndex: target });
}

function updateReviewBadge() {
    const count = state.review.total || state.review.queue.length;
    if (els.reviewBadge) {
        els.reviewBadge.textContent = count;
        els.reviewBadge.classList.toggle('hidden', count === 0);
    }
    if (els.reviewCount) {
        if (count === 0) {
            els.reviewCount.textContent = '0 items';
        } else {
            const start = state.review.pageOffset + 1;
            const end = Math.min(count, state.review.pageOffset + state.review.queue.length);
            els.reviewCount.textContent = `${count} items (showing ${start}-${end})`;
        }
    }
}

function renderReviewItem() {
    const queue = state.review.queue;
    const idx = state.review.currentIndex;

    if (queue.length === 0) {
        if (state.review.isLoading) {
            els.reviewConversation.innerHTML = '<div class="empty-state"><div class="empty-icon"><span class="inline-spinner"></span></div><p>Loading review queue...</p><p class="small">Refreshing the current page</p></div>';
        } else {
            els.reviewConversation.innerHTML = `<div class="empty-state"><div class="empty-icon">${ICON_EMPTY_QUEUE}</div><p>No items in review queue</p><p class="small">Generate conversations in bulk to fill the queue</p></div>`;
        }
        els.reviewEditInput.classList.add('hidden');
        els.reviewKeepBtn.disabled = true;
        els.reviewRejectBtn.disabled = true;
        els.reviewEditBtn.disabled = true;
        els.reviewEditCancelBtn.classList.add('hidden');
        els.reviewPrev.disabled = true;
        els.reviewNext.disabled = true;
        els.reviewPosition.textContent = '0/0';
        state.review.isEditing = false;
        return;
    }

    const item = queue[idx];
    if (!item?.id) return;
    if ((!Array.isArray(item.conversations) || item.conversations.length === 0) && state.review.currentItemLoading) {
        els.reviewConversation.innerHTML = '<div class="empty-state"><div class="empty-icon"><span class="inline-spinner"></span></div><p>Loading review item...</p></div>';
        els.reviewEditInput.classList.add('hidden');
        els.reviewConversation.classList.remove('hidden');
        els.reviewKeepBtn.disabled = true;
        els.reviewRejectBtn.disabled = true;
        els.reviewEditBtn.disabled = true;
        els.reviewEditCancelBtn.classList.add('hidden');
        const total = state.review.total || queue.length;
        const absolute = state.review.pageOffset + idx;
        els.reviewPrev.disabled = absolute <= 0;
        els.reviewNext.disabled = absolute >= (total - 1);
        els.reviewPosition.textContent = `${absolute + 1}/${total}`;
        return;
    }
    if (!Array.isArray(item.conversations) || item.conversations.length === 0) {
        els.reviewConversation.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Failed to load review item</p><p class="small">Try navigating again or reopening Review.</p></div>';
        els.reviewEditInput.classList.add('hidden');
        els.reviewConversation.classList.remove('hidden');
        els.reviewKeepBtn.disabled = true;
        els.reviewRejectBtn.disabled = true;
        els.reviewEditBtn.disabled = true;
        els.reviewEditCancelBtn.classList.add('hidden');
        const total = state.review.total || queue.length;
        const absolute = state.review.pageOffset + idx;
        els.reviewPrev.disabled = absolute <= 0;
        els.reviewNext.disabled = absolute >= (total - 1);
        els.reviewPosition.textContent = `${absolute + 1}/${total}`;
        return;
    }
    els.reviewConversation.innerHTML = renderConversationMarkup(item.conversations || []);
    els.reviewConversation.scrollTop = 0;
    els.reviewEditInput.value = item.rawText || conversationToRaw(item.conversations || []);
    els.reviewConversation.classList.toggle('hidden', state.review.isEditing);
    els.reviewEditInput.classList.toggle('hidden', !state.review.isEditing);
    els.reviewEditCancelBtn.classList.toggle('hidden', !state.review.isEditing);

    els.reviewKeepBtn.disabled = false;
    els.reviewRejectBtn.disabled = false;
    els.reviewEditBtn.disabled = false;
    const total = state.review.total || queue.length;
    const absolute = state.review.pageOffset + idx;
    els.reviewPrev.disabled = absolute <= 0;
    els.reviewNext.disabled = absolute >= (total - 1);
    els.reviewPosition.textContent = `${state.review.pageOffset + idx + 1}/${total}`;
    els.reviewEditBtn.textContent = state.review.isEditing ? 'Apply Edit' : 'Edit';
}

async function persistCurrentReviewEdits() {
    if (!state.review.isEditing) return true;
    const item = state.review.queue[state.review.currentIndex];
    if (!item) return false;

    const rawText = els.reviewEditInput.value.trim();
    const conversations = parseMinimalFormat(rawText);
    if (!conversations.length) {
        toast('Review item cannot be empty', 'error');
        return false;
    }

    item.rawText = rawText;
    item.conversations = conversations;

    try {
        if (String(item.id).startsWith('local-')) {
            await dbPut('reviewQueue', item);
        } else {
            const res = await fetch(`/api/review-queue/${encodeURIComponent(item.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    conversations,
                    raw_text: rawText,
                    metadata: item.metadata || {}
                })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Failed to save edit (${res.status})`);
            }
        }
    } catch (e) {
        console.warn('Failed to persist inline review edit:', e);
        toast(e?.message || 'Failed to save edit', 'error');
        await saveRecoveryDraft('reviewEdit');
        return false;
    }

    state.review.isEditing = false;
    renderReviewItem();
    return true;
}

function cancelReviewEdit() {
    state.review.isEditing = false;
    renderReviewItem();
}

async function reviewNext() {
    if (!(await persistCurrentReviewEdits())) return;
    const absolute = state.review.pageOffset + state.review.currentIndex;
    const next = absolute + 1;
    const total = state.review.total || state.review.queue.length;
    if (next >= total) return;
    await navigateReviewToAbsolute(next);
}

async function reviewPrev() {
    if (!(await persistCurrentReviewEdits())) return;
    const absolute = state.review.pageOffset + state.review.currentIndex;
    const prev = absolute - 1;
    if (prev < 0) return;
    await navigateReviewToAbsolute(prev);
}

async function reviewKeep() {
    const item = state.review.queue[state.review.currentIndex];
    if (!item) return;
    if (!(await persistCurrentReviewEdits())) return;
    showSaveIndicator('Saving...');
    try {
        const absolute = state.review.pageOffset + state.review.currentIndex;
        const [syncedId] = await ensureReviewQueueIdsSynced([item.id]);
        const res = await fetch('/api/review-queue/bulk-keep', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [syncedId] })
        });
        if (res.ok) {
            const data = await res.json();
            if (data.error_count > 0 || data.saved_count < 1) {
                toast('Failed to save item', 'error');
                hideSaveIndicator('Save failed');
                return;
            }
            const nextTotal = (typeof data.count === 'number') ? data.count : Math.max(0, (state.review.total || 0) - 1);
            const nextAbsolute = Math.min(absolute, Math.max(0, nextTotal - 1));
            await loadReviewQueue({ reset: true, targetAbsoluteIndex: nextTotal > 0 ? nextAbsolute : 0 });
            await refreshReviewBrowserIfOpen({ reset: true });
            toast('Kept!', 'success');
            hideSaveIndicator('Saved ✓');
            loadStats();
        } else {
            const err = await res.json().catch(() => ({}));
            toast(err.error || 'Failed to save', 'error');
            await saveRecoveryDraft('reviewKeep');
            hideSaveIndicator('Save failed');
        }
    } catch (e) {
        toast('Failed to save', 'error');
        await saveRecoveryDraft('reviewKeep');
        hideSaveIndicator('Save failed');
    }
}

async function reviewReject() {
    const item = state.review.queue[state.review.currentIndex];
    if (!item) return;
    if (!(await persistCurrentReviewEdits())) return;
    showSaveIndicator('Rejecting...');
    try {
        const absolute = state.review.pageOffset + state.review.currentIndex;
        const [syncedId] = await ensureReviewQueueIdsSynced([item.id]);
        const res = await fetch('/api/review-queue/bulk-reject', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [syncedId] })
        });
        if (res.ok) {
            const data = await res.json();
            if (data.error_count > 0 || data.saved_count < 1) {
                toast('Failed to reject', 'error');
                hideSaveIndicator('Reject failed');
                return;
            }
            const nextTotal = (typeof data.count === 'number') ? data.count : Math.max(0, (state.review.total || 0) - 1);
            const nextAbsolute = Math.min(absolute, Math.max(0, nextTotal - 1));
            await loadReviewQueue({ reset: true, targetAbsoluteIndex: nextTotal > 0 ? nextAbsolute : 0 });
            await refreshReviewBrowserIfOpen({ reset: true });
            toast('Rejected', 'info');
            hideSaveIndicator('Rejected ✓');
            loadStats();
        } else {
            const err = await res.json().catch(() => ({}));
            toast(err.error || 'Failed to reject', 'error');
            await saveRecoveryDraft('reviewReject');
            hideSaveIndicator('Reject failed');
        }
    } catch (e) {
        toast('Failed to reject', 'error');
        await saveRecoveryDraft('reviewReject');
        hideSaveIndicator('Reject failed');
    }
}

async function removeFromReviewQueue(idx) {
    const item = state.review.queue[idx];
    if (!item) return;
    const absolute = state.review.pageOffset + idx;
    try {
        const [syncedId] = await ensureReviewQueueIdsSynced([item.id]);
        await fetch(`/api/review-queue/${encodeURIComponent(syncedId)}`, { method: 'DELETE' });
    } catch (e) {
        console.warn('Failed to remove from server, removing locally');
    }
    try { await dbDelete('reviewQueue', item.id); } catch (e) { }

    const nextTotal = Math.max(0, (state.review.total || 0) - 1);
    const nextAbsolute = Math.min(absolute, Math.max(0, nextTotal - 1));
    await loadReviewQueue({ reset: true, targetAbsoluteIndex: nextTotal > 0 ? nextAbsolute : 0 });
    await refreshReviewBrowserIfOpen({ reset: true });
}

async function reviewEdit() {
    const item = state.review.queue[state.review.currentIndex];
    if (!item) return;
    if (state.review.isEditing) {
        await persistCurrentReviewEdits();
        return;
    }
    state.review.isEditing = true;
    els.reviewEditInput.value = item.rawText || conversationToRaw(item.conversations);
    renderReviewItem();
}

async function persistAllReviewQueueInBatches(action) {
    const count = state.review.total || state.review.queue.length;
    if (count === 0) return;

    const isKeep = action === 'keep';
    const verb = isKeep ? 'Save' : 'Reject';
    const targetLabel = isKeep ? 'Wanted' : 'Rejected';

    const ok = await popupConfirm({
        title: `Review: ${verb} All`,
        message: `${verb} all ${count} conversation(s)?`,
        confirmText: verb,
        cancelText: 'Cancel',
        danger: !isKeep
    });
    if (!ok) return;
    if (!(await persistCurrentReviewEdits())) return;

    showSaveIndicator(isKeep ? 'Saving...' : 'Rejecting...');
    const controller = new AbortController();
    const taskId = createTask({
        title: `Review: ${verb} all`,
        detail: `Queue -> ${targetLabel}`,
        onCancel: () => controller.abort()
    });

	    try {
	        await syncReviewQueueItemsToServer();

	        const batchLimit = 200; // client-side batch size for queue ids paging
	        const maxRetries = getBulkRetryAttempts();
	        let processed = 0;
	        let total = null;
	        let lastRemaining = null;
	        let stagnant = 0;
	        let totalErrors = 0;

		        while (!controller.signal.aborted) {
		            let idsRes;
		            for (let attempt = 0; attempt <= maxRetries; attempt++) {
		                try {
		                    idsRes = await fetch(`/api/review-queue?limit=${batchLimit}&offset=0&ids_only=1`, { signal: controller.signal });
		                } catch (e) {
		                    if (e?.name === 'AbortError' || controller.signal.aborted) throw e;
		                    if (attempt >= maxRetries) throw new Error('Failed to fetch queue ids');
		                    await sleepWithAbort(350 * (attempt + 1), controller.signal);
		                    continue;
		                }
		                if (idsRes.ok) break;
		                const retryable = idsRes.status === 429 || idsRes.status >= 500;
		                if (!retryable || attempt >= maxRetries) throw new Error('Failed to fetch queue ids');
		                await sleepWithAbort(350 * (attempt + 1), controller.signal);
		            }
		            const idsData = await idsRes.json().catch(() => ({}));

	            if (total === null && typeof idsData.count === 'number') total = idsData.count;
	            const ids = Array.isArray(idsData.ids) ? idsData.ids : [];
	            if (ids.length === 0) break;

	            updateTask(taskId, {
	                detail: `Queue -> ${targetLabel}${totalErrors ? ` · Errors ${totalErrors}` : ''}`,
	                current: total ? Math.min(processed, total) : null,
	                total: total || null,
	                indeterminate: !total
	            });

		            let persistRes;
		            for (let attempt = 0; attempt <= maxRetries; attempt++) {
		                try {
		                    persistRes = await fetch(`/api/review-queue/bulk-${action}`, {
		                        method: 'POST',
		                        headers: { 'Content-Type': 'application/json' },
		                        body: JSON.stringify({ ids }),
		                        signal: controller.signal
		                    });
		                } catch (e) {
		                    if (e?.name === 'AbortError' || controller.signal.aborted) throw e;
		                    if (attempt >= maxRetries) throw new Error(`Bulk ${action} failed`);
		                    await sleepWithAbort(350 * (attempt + 1), controller.signal);
		                    continue;
		                }
		                if (persistRes.ok) break;
		                const retryable = persistRes.status === 429 || persistRes.status >= 500;
		                if (!retryable || attempt >= maxRetries) throw new Error(`Bulk ${action} failed`);
		                await sleepWithAbort(350 * (attempt + 1), controller.signal);
		            }
		            const persistData = await persistRes.json().catch(() => ({}));

	            const savedCount = typeof persistData.saved_count === 'number' ? persistData.saved_count : ids.length;
	            const errorCount = typeof persistData.error_count === 'number' ? persistData.error_count : 0;
	            totalErrors += errorCount;
	            processed += savedCount;

            const remaining = typeof persistData.count === 'number' ? persistData.count : null;
            if (remaining !== null) {
                if (total === null) total = processed + remaining;
                if (lastRemaining !== null && remaining >= lastRemaining) stagnant++;
                else stagnant = 0;
                lastRemaining = remaining;
                if (stagnant >= 4) throw new Error('Queue did not shrink; stopping to avoid an infinite loop');
                if (remaining === 0) break;
            }

	            updateTask(taskId, {
	                detail: `Queue -> ${targetLabel}${totalErrors ? ` · Errors ${totalErrors}` : ''}`,
	                current: total ? Math.min(processed, total) : null,
	                total: total || null,
	                indeterminate: !total
	            });

	            if (savedCount === 0 && errorCount > 0) {
	                toast(`Stopped: ${errorCount} invalid item(s) stayed in the queue`, 'warning');
	                break;
	            }

            // Yield so the UI stays responsive.
            await new Promise(resolve => requestAnimationFrame(() => resolve()));
        }

        if (controller.signal.aborted) {
            toast(`${verb} canceled`, 'info');
            hideSaveIndicator('Canceled');
            finishTask(taskId, { status: 'canceled', detail: 'Canceled' });
            return;
        }

	        await loadReviewQueue({ reset: true, targetAbsoluteIndex: 0 });
	        await refreshReviewBrowserIfOpen({ reset: true });
	        loadStats();
		        hideSaveIndicator(isKeep ? 'Saved ✓' : 'Rejected ✓');
		        const toastType = totalErrors ? 'warning' : (isKeep ? 'success' : 'info');
		        toast(isKeep ? `Saved ${processed} conversations` : `Rejected ${processed} conversations`, toastType);
		        finishTask(taskId, { status: 'done', detail: totalErrors ? `Completed with errors: ${totalErrors}` : (isKeep ? `Saved ${processed}` : `Rejected ${processed}`) });
		    } catch (e) {
	        if (e?.name === 'AbortError' || controller.signal.aborted) {
	            toast(`${verb} canceled`, 'info');
	            hideSaveIndicator('Canceled');
	            finishTask(taskId, { status: 'canceled', detail: 'Canceled' });
	            return;
	        }
	        console.error(`Bulk ${action} failed:`, e);
	        toast(e?.message || `Bulk ${action} failed`, 'error');
	        hideSaveIndicator('Failed');
	        finishTask(taskId, { status: 'error', detail: 'Failed' });
	        await saveRecoveryDraft(`bulk-${action}`);
	    }
}

async function keepAllReview() {
    return persistAllReviewQueueInBatches('keep');
}

async function rejectAllReview() {
    return persistAllReviewQueueInBatches('reject');
}

async function clearReviewQueue() {
    const count = state.review.total || state.review.queue.length;
    if (count === 0) return;
    const ok = await popupConfirm({
        title: 'Discard Review Queue',
        message: `Discard all ${count} conversation(s) from the queue?\nThis will NOT save them anywhere.`,
        confirmText: 'Discard',
        cancelText: 'Cancel',
        danger: true
    });
    if (!ok) return;
    showSaveIndicator('Clearing...');
    try {
        await fetch('/api/review-queue', { method: 'DELETE' });
        await dbClear('reviewQueue');
        state.review.queue = [];
        state.review.currentIndex = 0;
        state.review.pageOffset = 0;
        state.review.total = 0;
        state.review.hasMore = false;
        updateReviewBadge();
        renderReviewItem();
        await refreshReviewBrowserIfOpen({ reset: true });
        hideSaveIndicator('Cleared');
        toast('Queue cleared', 'info');
    } catch (e) {
        toast('Failed to clear queue', 'error');
        hideSaveIndicator('Clear failed');
    }
}

function openReviewBrowserModal() {
    const currentItem = state.review.queue[state.review.currentIndex];
    state.reviewBrowser.previewId = currentItem?.id || null;
    state.reviewBrowser.previewConversation = currentItem || null;
    els.reviewBrowserModal.classList.remove('hidden');
    const hasActiveLoadAll = !!state.reviewBrowser.loadAllTaskId && state.tasks.items.has(state.reviewBrowser.loadAllTaskId);
    if (!hasActiveLoadAll) loadReviewBrowser({ reset: true });
    else { renderReviewBrowserList(); renderReviewBrowserPreview(); updateReviewBrowserPaginationUI(); }
}

function closeReviewBrowserModal() {
    cancelSliceLoadAll(state.reviewBrowser, 'Closed');
    state.reviewBrowser.requestSeq = (state.reviewBrowser.requestSeq || 0) + 1;
    state.reviewBrowser.currentRequest = null;
    state.reviewBrowser.isLoading = false;
    state.reviewBrowser.previewLoading = false;
    els.reviewBrowserModal.classList.add('hidden');
}

async function jumpReviewToItemId(itemId) {
    const requestedId = String(itemId || '');
    if (!requestedId) return;
    try {
        const [syncedId] = await ensureReviewQueueIdsSynced([requestedId]);
        const res = await fetch(`/api/review-queue-position/${encodeURIComponent(syncedId)}`);
        if (!res.ok) throw new Error('Failed to locate item');
        const data = await res.json().catch(() => ({}));
        const pos = Number(data.position);
        if (!Number.isFinite(pos)) throw new Error('Invalid position');
        // Ignore outdated clicks
        const livePreview = String(state.reviewBrowser.previewId || '');
        if (livePreview !== requestedId && livePreview !== String(syncedId || '')) return;
        state.review.isEditing = false;
        await navigateReviewToAbsolute(pos);
    } catch (e) {
        // Offline fallback: compute index from IndexedDB list order.
        try {
            const localItems = await dbGetAll('reviewQueue').catch(() => []);
            const idx = (localItems || []).findIndex(it => String(it?.id) === requestedId);
            if (idx === -1) return;
            if (state.reviewBrowser.previewId !== requestedId) return;
            state.review.isEditing = false;
            await navigateReviewToAbsolute(idx);
        } catch (_err) { }
    }
}

function updateReviewBrowserPaginationUI() {
    if (els.reviewBrowserPaginationStatus) {
        const loaded = Math.min(state.reviewBrowser.offset, state.reviewBrowser.items.length);
        const total = state.reviewBrowser.total || 0;
        els.reviewBrowserPaginationStatus.textContent = total > 0 ? `Showing ${loaded} of ${total}` : '';
    }
}

function updateReviewBrowserCount() {
    updateSelectionToolbar({
        selectedIds: state.reviewBrowser.selectedIds,
        files: state.reviewBrowser.items,
        toggleButton: els.reviewBrowserSelectToggle,
        chip: els.reviewBrowserSelectionChip,
        countEl: els.reviewBrowserCount
    });
}

function renderReviewBrowserPreview() {
    if (!els.reviewBrowserPreview) return;
    const item = state.reviewBrowser.previewConversation;
    if (!item?.conversations?.length) {
        els.reviewBrowserPreview.innerHTML = state.reviewBrowser.previewLoading
            ? '<div class="empty-files"><span class="inline-spinner"></span> Loading preview...</div>'
            : '<div class="empty-files">Click a queue item to load it into the review tab</div>';
        return;
    }
    els.reviewBrowserPreview.innerHTML = renderConversationMarkup(item.conversations);
}

function renderReviewBrowserList() {
    if (!els.reviewBrowserList) return;
    renderVirtualWindow({
        slice: state.reviewBrowser,
        container: els.reviewBrowserList,
        items: state.reviewBrowser.items,
        renderRowHtml: renderReviewBrowserRowHtml
    });
    updateReviewBrowserCount();
    updateReviewBrowserPaginationUI();
}

function renderReviewBrowserRowHtml(item) {
    const isSelected = state.reviewBrowser.selectedIds.has(item.id);
    const isPreviewing = state.reviewBrowser.previewId === item.id;
    const preview = item.preview || item.rawText || 'Empty conversation';
    const meta = item.createdAt ? formatDate(item.createdAt) : '';
    return `
        <div class="export-file-item ${isSelected ? 'selected' : ''} ${isPreviewing ? 'active-preview' : ''}" data-id="${escapeHtml(item.id)}">
            <input type="checkbox" class="file-checkbox" ${isSelected ? 'checked' : ''}>
            <div class="export-file-info">
                <div class="export-file-preview">${escapeHtml(preview)}</div>
                <div class="export-file-meta">${escapeHtml(meta)}</div>
            </div>
        </div>
    `;
}

async function loadReviewBrowserPreviewItem(itemId) {
    const requestedId = String(itemId || '');
    if (!requestedId) return;
    const requestToken = Symbol('review-browser-preview');
    state.reviewBrowser.currentRequest = requestToken;
    state.reviewBrowser.previewId = requestedId;
    state.reviewBrowser.previewConversation = null;
    state.reviewBrowser.previewLoading = true;
    renderReviewBrowserPreview();
    try {
        let preview = null;
        const currentReviewItem = state.review.queue[state.review.currentIndex];
        if (currentReviewItem?.id && String(currentReviewItem.id) === requestedId && currentReviewItem?.conversations?.length) {
            preview = currentReviewItem;
        } else if (requestedId.startsWith('local-')) {
            preview = await dbGet('reviewQueue', requestedId).catch(() => null);
        } else {
            preview = await fetchReviewQueueItem(requestedId);
        }
        if (state.reviewBrowser.currentRequest !== requestToken) return;
        state.reviewBrowser.previewConversation = preview;
    } catch (_e) {
        if (state.reviewBrowser.currentRequest !== requestToken) return;
        state.reviewBrowser.previewConversation = null;
        toast('Failed to preview queue item', 'error');
    } finally {
        if (state.reviewBrowser.currentRequest === requestToken) {
            state.reviewBrowser.currentRequest = null;
            state.reviewBrowser.previewLoading = false;
            renderReviewBrowserPreview();
        }
    }
}

async function loadReviewBrowser({ reset = false, signal = null, preserveState = false } = {}) {
    const pageSize = getModalPageSize();
    const activeSearch = String(els.reviewBrowserSearchInput?.value || '').trim();
    const activeSearchLower = activeSearch.toLowerCase();
    const requestSeq = (state.reviewBrowser.requestSeq || 0) + 1;
    state.reviewBrowser.requestSeq = requestSeq;
    if (reset) {
        const prevSelectedIds = preserveState ? new Set(Array.from(state.reviewBrowser.selectedIds || []).map(id => String(id || '')).filter(Boolean)) : null;
        const prevAnchorId = preserveState ? String(state.reviewBrowser.anchorId || '') : '';
        const prevPreviewId = preserveState ? String(state.reviewBrowser.previewId || '') : '';
        let preservedOffset = null;

        // When refreshing while the user is browsing, keep the page window that contains
        // the currently previewed item (otherwise we jump back to the first page).
        if (preserveState && prevPreviewId) {
            try {
                if (!String(prevPreviewId).startsWith('local-')) {
                    const url = activeSearch
                        ? `/api/review-queue-position/${encodeURIComponent(prevPreviewId)}?search=${encodeURIComponent(activeSearch)}`
                        : `/api/review-queue-position/${encodeURIComponent(prevPreviewId)}`;
                    const res = await fetch(url);
                    if (res.ok) {
                        const data = await res.json().catch(() => ({}));
                        const pos = Number(data.position);
                        if (Number.isFinite(pos) && pos >= 0) preservedOffset = Math.floor(pos / pageSize) * pageSize;
                    }
                }
            } catch (e) {
                console.warn('Failed to get review queue position from API:', e);
            }
            if (preservedOffset == null) {
                try {
                    const localItems = await dbGetAll('reviewQueue').catch(() => []);
                    const filteredLocalItems = !activeSearchLower
                        ? (localItems || [])
                        : (localItems || []).filter(item => String(item?.rawText || '').toLowerCase().includes(activeSearchLower));
                    const idx = filteredLocalItems.findIndex(it => String(it?.id) === prevPreviewId);
                    if (idx >= 0) preservedOffset = Math.floor(idx / pageSize) * pageSize;
                } catch (e) {
                    console.warn('Failed to get review queue position from IndexedDB:', e);
                }
            }
        }
        if (state.reviewBrowser.requestSeq !== requestSeq) return;

        state.reviewBrowser.items = [];
        if (!preserveState) {
            clearSelectableSelection(state.reviewBrowser);
        } else if (prevSelectedIds) {
            state.reviewBrowser.selectedIds = prevSelectedIds;
            state.reviewBrowser.anchorId = prevAnchorId || null;
            state.reviewBrowser.previewId = prevPreviewId || null;
        }
        state.reviewBrowser.offset = preservedOffset ?? 0;
        state.reviewBrowser.total = 0;
        state.reviewBrowser.hasMore = false;
        state.reviewBrowser.renderedCount = 0;
        state.reviewBrowser.seenIds.clear();
        state.reviewBrowser.idToIndex.clear();
        if (els.reviewBrowserList) els.reviewBrowserList.innerHTML = '';
    }

    state.reviewBrowser.isLoading = true;
    if (reset) syncReviewBrowserPreviewState({ allowFallback: !preserveState });
    if (!els.reviewBrowserModal?.classList.contains('hidden')) {
        // Show immediate feedback (spinner / "Loading...") and ensure virtual loading row state is correct.
        renderReviewBrowserList();
        renderReviewBrowserPreview();
        updateReviewBrowserPaginationUI();
    }
    try {
        const search = activeSearch;
        const data = await fetchReviewQueueWindowFromServer({
            offset: state.reviewBrowser.offset,
            limit: pageSize,
            search,
            signal,
            summary: true
        });
        if (state.reviewBrowser.requestSeq !== requestSeq) return;
        const items = data.items || [];
        for (const item of items) {
            const rawId = item?.id;
            const itemId = (rawId === undefined || rawId === null) ? '' : String(rawId);
            if (rawId !== itemId && item) item.id = itemId;
            if (!itemId || state.reviewBrowser.seenIds.has(itemId)) continue;
            state.reviewBrowser.seenIds.add(itemId);
            state.reviewBrowser.idToIndex.set(itemId, state.reviewBrowser.items.length);
            state.reviewBrowser.items.push(item);
        }
        state.reviewBrowser.total = data.total || state.reviewBrowser.items.length;
        state.reviewBrowser.offset += items.length;
        if (items.length === 0) state.reviewBrowser.hasMore = false;
        else state.reviewBrowser.hasMore = state.reviewBrowser.offset < state.reviewBrowser.total;
        if (!els.reviewBrowserModal?.classList.contains('hidden')) {
            renderReviewBrowserList();
        }
    } catch (e) {
        if (e?.name === 'AbortError') {
            if (state.reviewBrowser.requestSeq === requestSeq) {
                state.reviewBrowser.isLoading = false;
                syncReviewBrowserPreviewState();
                if (!els.reviewBrowserModal?.classList.contains('hidden')) {
                    renderReviewBrowserPreview();
                    updateReviewBrowserPaginationUI();
                    renderReviewBrowserList();
                }
            }
            return;
        }
        const search = els.reviewBrowserSearchInput?.value?.trim().toLowerCase() || '';
        const localItems = await dbGetAll('reviewQueue').catch(() => []);
        if (state.reviewBrowser.requestSeq !== requestSeq) return;
        const filtered = (localItems || []).filter(item => {
            if (!search) return true;
            return (item.rawText || '').toLowerCase().includes(search);
        });
        const page = reset ? filtered.slice(0, pageSize) : filtered.slice(state.reviewBrowser.offset, state.reviewBrowser.offset + pageSize);
        for (const item of page) {
            const rawId = item?.id;
            const itemId = (rawId === undefined || rawId === null) ? '' : String(rawId);
            if (rawId !== itemId && item) item.id = itemId;
            if (!itemId || state.reviewBrowser.seenIds.has(itemId)) continue;
            state.reviewBrowser.seenIds.add(itemId);
            state.reviewBrowser.idToIndex.set(itemId, state.reviewBrowser.items.length);
            state.reviewBrowser.items.push(item);
        }
        state.reviewBrowser.total = filtered.length;
        state.reviewBrowser.offset += page.length;
        if (page.length === 0) state.reviewBrowser.hasMore = false;
        else state.reviewBrowser.hasMore = state.reviewBrowser.offset < state.reviewBrowser.total;
        if (!els.reviewBrowserModal?.classList.contains('hidden')) {
            renderReviewBrowserList();
        }
    }
    if (state.reviewBrowser.requestSeq !== requestSeq) return;
    state.reviewBrowser.isLoading = false;
    syncReviewBrowserPreviewState({ allowFallback: true });
    if (!els.reviewBrowserModal?.classList.contains('hidden')) {
        renderReviewBrowserPreview();
        updateReviewBrowserPaginationUI();
        // Ensure the "Loading more..." row is hidden after paging completes.
        renderReviewBrowserList();
    }
}

function loadMoreReviewBrowser() {
    if (state.reviewBrowser.hasMore && !state.reviewBrowser.isLoading) {
        loadReviewBrowser();
    }
}

function toggleAllReviewBrowser() {
    state.reviewBrowser.selectedIds = new Set(state.reviewBrowser.items.map(item => item.id));
    refreshSelectableListUI(els.reviewBrowserList, state.reviewBrowser);
    updateReviewBrowserCount();
}

async function handleReviewBrowserBulk(action) {
    const isKeep = action === 'keep';
    const verb = isKeep ? 'Save' : 'Reject';
    const selectedCount = state.reviewBrowser.selectedIds.size;
    showSaveIndicator(isKeep ? 'Saving...' : 'Rejecting...');
    const controller = new AbortController();
    const taskId = createTask({
        title: `Browse queue: ${verb} selected`,
        detail: `${selectedCount} selected`,
        onCancel: () => controller.abort(),
    });
	    const maxRetries = getBulkRetryAttempts();
	    try {
        const ids = await ensureReviewQueueIdsSynced(Array.from(state.reviewBrowser.selectedIds));
        if (!ids.length) {
            hideSaveIndicator(isKeep ? 'Saved ✓' : 'Rejected ✓');
            finishTask(taskId, { status: 'done', detail: 'Nothing selected' });
            return;
        }
	        let res;
	        for (let attempt = 0; attempt <= maxRetries; attempt++) {
	            try {
	                res = await fetch(`/api/review-queue/bulk-${action}`, {
	                    method: 'POST',
	                    headers: { 'Content-Type': 'application/json' },
	                    body: JSON.stringify({ ids }),
	                    signal: controller.signal,
	                });
	            } catch (e) {
	                if (e?.name === 'AbortError' || controller.signal.aborted) throw e;
	                if (attempt >= maxRetries) break;
	                updateTask(taskId, { detail: `Retrying (${attempt + 1}/${maxRetries})` });
	                await sleepWithAbort(350 * (attempt + 1), controller.signal);
	                continue;
	            }
	            if (res.ok) break;
	            const retryable = res.status === 429 || res.status >= 500;
	            if (!retryable || attempt >= maxRetries) break;
	            updateTask(taskId, { detail: `Retrying (${attempt + 1}/${maxRetries})` });
	            await sleepWithAbort(350 * (attempt + 1), controller.signal);
        }
        if (!res?.ok) {
            const err = await res?.json?.().catch(() => ({}));
            throw new Error(err?.error || 'Bulk review action failed');
        }
	        const data = await res.json().catch(() => ({}));
	        const errorCount = typeof data.error_count === 'number' ? data.error_count : 0;
	        const errors = Array.isArray(data.errors) ? data.errors : [];
	        const failedIds = errors.map(e => String(e?.id || '')).filter(Boolean);

	        await loadReviewQueue();
	        await loadReviewBrowser({ reset: true });
	        if (errorCount > 0 || failedIds.length > 0) {
	            state.reviewBrowser.selectedIds = new Set(failedIds);
	            refreshSelectableListUI(els.reviewBrowserList, state.reviewBrowser);
	            updateReviewBrowserCount();
	            toast(`Completed with ${errorCount || failedIds.length} error(s)`, 'warning');
	            finishTask(taskId, { status: 'done', detail: `Errors: ${errorCount || failedIds.length}` });
	        } else {
	            clearSelectableSelection(state.reviewBrowser);
	            refreshSelectableListUI(els.reviewBrowserList, state.reviewBrowser);
	            updateReviewBrowserCount();
	            toast(isKeep ? 'Saved selected items' : 'Rejected selected items', isKeep ? 'success' : 'info');
	            finishTask(taskId, { status: 'done', detail: 'Done' });
	        }
	        loadStats();
	        hideSaveIndicator(isKeep ? 'Saved ✓' : 'Rejected ✓');
    } catch (e) {
        if (e?.name === 'AbortError' || controller.signal.aborted) {
            toast(`${verb} canceled`, 'info');
            hideSaveIndicator('Canceled');
            finishTask(taskId, { status: 'canceled', detail: 'Canceled' });
            return;
        }
        hideSaveIndicator('Action failed');
        toast(e?.message || 'Bulk review action failed', 'error');
        finishTask(taskId, { status: 'error', detail: 'Failed' });
        await saveRecoveryDraft(`reviewBrowser-${action}`);
    }
}

// ============ TABS ============
function switchTab(tabName) {
    state.currentTab = tabName;
    els.tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    els.generateTab.classList.toggle('active', tabName === 'generate');
    els.chatTab.classList.toggle('active', tabName === 'chat');
    els.reviewTab.classList.toggle('active', tabName === 'review');
    if (tabName === 'review' && !state.review.isLoading) {
        if (!state.review.deferredRestoreApplied && state._restoredDraft?.review) {
            state.review.deferredRestoreApplied = true;
            applyDeferredDraftState(state._restoredDraft);
        } else if (state.review.queue.length === 0) {
            loadReviewQueue();
        }
    }
    saveUiPrefs();
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

function setActiveGroupedNav(selector, activeButton) {
    document.querySelectorAll(selector).forEach(btn => btn.classList.toggle('active', btn === activeButton));
}

function scrollSidebarToSection(sectionId, trigger = null) {
    const target = document.getElementById(sectionId);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (trigger) setActiveGroupedNav('.sidebar-nav-btn', trigger);
}

function scrollSettingsSection(sectionId, trigger = null) {
    const target = document.getElementById(sectionId);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (trigger) setActiveGroupedNav('.settings-category-btn', trigger);
}

function openSettingsModal() {
    els.settingsModal?.classList.remove('hidden');
    filterSettingsSections();
}

function closeSettingsModal() {
    els.settingsModal?.classList.add('hidden');
}

async function applyDatabasePath() {
    const nextPath = String(els.databasePath?.value || '').trim();
    if (!nextPath) { toast('Enter a database file path', 'error'); return; }
    showSaveIndicator('Applying database...');
    try {
        const res = await fetch('/api/server-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ database: { path: nextPath } })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to apply database');
        const needsRestart = !!data.restart_required || !!data.restart_recommended;
        toast(needsRestart ? 'Database path saved. Restart the server to switch databases.' : 'Database path saved.', 'success');
        if (els.databasePathNote) {
            els.databasePathNote.textContent = needsRestart
                ? 'Restart the server to switch databases.'
                : 'Database path updated.';
        }
        hideSaveIndicator('Saved ✓');
    } catch (e) {
        toast(e.message || 'Failed to apply database', 'error');
        hideSaveIndicator('Apply failed');
    }
}

function filterSettingsSections() {
    const query = els.settingsSearchInput?.value?.trim().toLowerCase() || '';
    document.querySelectorAll('.settings-section').forEach(section => {
        const haystack = (section.dataset.settingsSearch || '').toLowerCase();
        section.classList.toggle('hidden-by-search', !!query && !haystack.includes(query));
    });
    document.querySelectorAll('.settings-category-btn').forEach(btn => {
        const target = document.getElementById(btn.dataset.settingsTarget || '');
        const hidden = !target || target.classList.contains('hidden-by-search');
        btn.classList.toggle('hidden', hidden);
        if (hidden && btn.classList.contains('active')) btn.classList.remove('active');
    });
    const firstVisibleCategory = document.querySelector('.settings-category-btn:not(.hidden)');
    if (firstVisibleCategory && !document.querySelector('.settings-category-btn.active')) {
        firstVisibleCategory.classList.add('active');
    }
    saveUiPrefs();
}

function openCustomParamsModal() {
    renderCustomParams();
    els.customParamsModal?.classList.remove('hidden');
    els.customParamKey?.focus();
}

function closeCustomParamsModal() {
    els.customParamsModal?.classList.add('hidden');
}

// ============ CREDENTIALS (Sidebar Presets + Picker Modal) ============
const credPickerState = { tab: 'key', query: '' };

function getSidebarCredProvider() {
    return els.provider?.value || 'openai';
}

function formatKeyTail(last4) {
    const tail = String(last4 || '').trim();
    return `*****${tail || '----'}`;
}

async function loadCredentialPresets(provider = null) {
    const p = provider || getSidebarCredProvider();
    try {
        const res = await fetch(`/api/credentials/${encodeURIComponent(p)}`);
        if (!res.ok) throw new Error('Failed to load credentials');
        const data = await res.json();
        state.credentialPresets[p] = {
            key_presets: Array.isArray(data.key_presets) ? data.key_presets : [],
            url_presets: Array.isArray(data.url_presets) ? data.url_presets : [],
            active: data.active || { key_preset: '', url_preset: '' }
        };
        updateProviderUI();
        return state.credentialPresets[p];
    } catch (e) {
        console.error('Failed to load credential presets:', e);
        toast('Failed to load credentials', 'error');
        return state.credentialPresets[p];
    }
}

async function applyCredentialsActive({ provider, keyName = null, urlName = null } = {}) {
    const p = provider || getSidebarCredProvider();
    try {
        const res = await fetch(`/api/credentials/${encodeURIComponent(p)}/apply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key_name: keyName, url_name: urlName })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Apply failed');
        await loadCredentialPresets(p);
        await loadConfig();
    } catch (e) {
        toast(e.message || 'Failed to apply credentials', 'error');
    }
}

function openCredPicker(tab) {
    credPickerState.tab = tab === 'url' ? 'url' : 'key';
    credPickerState.query = '';
    if (els.credPickerSearch) els.credPickerSearch.value = '';
    renderCredPicker();
    els.credPickerModal?.classList.remove('hidden');
}

function closeCredPicker() {
    els.credPickerModal?.classList.add('hidden');
}

function setCredPickerTab(tab) {
    credPickerState.tab = tab === 'url' ? 'url' : 'key';
    renderCredPicker();
}

function getFilteredCredItems(provider) {
    const cache = state.credentialPresets?.[provider] || { key_presets: [], url_presets: [], active: {} };
    const query = (credPickerState.query || '').trim().toLowerCase();
    const items = credPickerState.tab === 'url' ? (cache.url_presets || []) : (cache.key_presets || []);
    if (!query) return items;
    return items.filter(it => {
        const name = String(it.name || '').toLowerCase();
        const val = credPickerState.tab === 'url' ? String(it.base_url || '').toLowerCase() : String(it.last4 || '').toLowerCase();
        return name.includes(query) || val.includes(query);
    });
}

function renderCredPicker() {
    if (!els.credPickerModal || !els.credPickerList) return;
    const provider = getSidebarCredProvider();
    const cache = state.credentialPresets?.[provider] || { key_presets: [], url_presets: [], active: {} };

    if (els.credPickerTabKey) els.credPickerTabKey.classList.toggle('active', credPickerState.tab === 'key');
    if (els.credPickerTabUrl) els.credPickerTabUrl.classList.toggle('active', credPickerState.tab === 'url');

    const activeName = credPickerState.tab === 'url' ? (cache.active?.url_preset || '') : (cache.active?.key_preset || '');
    const items = getFilteredCredItems(provider);
    els.credPickerList.textContent = '';
    if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-files';
        empty.textContent = 'No presets found';
        els.credPickerList.appendChild(empty);
        return;
    }

    items.forEach(it => {
        const name = String(it.name || '');
        const isActive = name === activeName;
        const rightText = credPickerState.tab === 'url'
            ? (String(it.base_url || '') || 'Default')
            : formatKeyTail(it.last4);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cred-picker-row' + (isActive ? ' active' : '');
        btn.dataset.name = name;

        const left = document.createElement('div');
        left.className = 'cred-picker-left';
        const nameEl = document.createElement('div');
        nameEl.className = 'cred-picker-name';
        nameEl.textContent = name;
        left.appendChild(nameEl);

        const right = document.createElement('div');
        right.className = 'cred-picker-right';
        right.textContent = rightText;

        btn.appendChild(left);
        btn.appendChild(right);
        els.credPickerList.appendChild(btn);
    });
}

async function sidebarSaveKeyPreset({ forceNew = false } = {}) {
    const provider = getSidebarCredProvider();
    const cache = state.credentialPresets?.[provider] || { active: {} };
    const current = String(cache.active?.key_preset || '').trim();
    const name = (!forceNew && current) ? current : await popupPrompt({
        title: 'Save API Key Preset',
        message: 'Name this API key preset.',
        label: 'Preset name',
        placeholder: 'e.g. MainKey',
        confirmText: 'Save',
        required: true
    });
    if (!name) return;
    const apiKey = String(els.sidebarCredKeyDraft?.value || '').trim();
    if (!apiKey) { toast('Enter a draft API key value first', 'error'); return; }
    try {
        const res = await fetch(`/api/credentials/${encodeURIComponent(provider)}/keys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, api_key: apiKey, overwrite: true })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Save failed');
        await applyCredentialsActive({ provider, keyName: name });
        toast('API key preset saved', 'success');
    } catch (e) {
        toast(e.message || 'Failed to save key preset', 'error');
    }
}

async function sidebarAddKeyPreset() {
    const provider = getSidebarCredProvider();
    const name = await popupPrompt({
        title: 'Add API Key Preset',
        message: 'Create a new API key preset.',
        label: 'Preset name',
        placeholder: 'e.g. NewKey',
        confirmText: 'Add',
        required: true
    });
    if (!name) return;
    const apiKey = String(els.sidebarCredKeyDraft?.value || '').trim();
    if (!apiKey) { toast('Enter a draft API key value first', 'error'); return; }
    try {
        const res = await fetch(`/api/credentials/${encodeURIComponent(provider)}/keys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, api_key: apiKey, overwrite: false })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Add failed');
        await applyCredentialsActive({ provider, keyName: name });
        toast('API key preset added', 'success');
    } catch (e) {
        toast(e.message || 'Failed to add key preset', 'error');
    }
}

async function sidebarDeleteKeyPreset() {
    const provider = getSidebarCredProvider();
    const cache = state.credentialPresets?.[provider] || { active: {} };
    const name = String(cache.active?.key_preset || '').trim();
    if (!name) { toast('No active key preset to delete', 'info'); return; }
    const ok = await popupConfirm({
        title: 'Delete API Key Preset',
        message: `Delete key preset "${name}"?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        danger: true
    });
    if (!ok) return;
    try {
        const res = await fetch(`/api/credentials/${encodeURIComponent(provider)}/keys/${encodeURIComponent(name)}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Delete failed');
        await loadCredentialPresets(provider);
        await loadConfig();
        toast('Key preset deleted', 'success');
    } catch (e) {
        toast(e.message || 'Failed to delete key preset', 'error');
    }
}

async function sidebarSaveUrlPreset({ forceNew = false } = {}) {
    const provider = getSidebarCredProvider();
    const cache = state.credentialPresets?.[provider] || { active: {} };
    const current = String(cache.active?.url_preset || '').trim();
    const name = (!forceNew && current) ? current : await popupPrompt({
        title: 'Save Base URL Preset',
        message: 'Name this base URL preset.',
        label: 'Preset name',
        placeholder: 'e.g. DefaultURL',
        confirmText: 'Save',
        required: true
    });
    if (!name) return;
    const baseUrl = String(els.sidebarCredUrlDraft?.value || '').trim();
    try {
        const res = await fetch(`/api/credentials/${encodeURIComponent(provider)}/urls`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, base_url: baseUrl, overwrite: true })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Save failed');
        await applyCredentialsActive({ provider, urlName: name });
        toast('Base URL preset saved', 'success');
    } catch (e) {
        toast(e.message || 'Failed to save URL preset', 'error');
    }
}

async function sidebarAddUrlPreset() {
    const provider = getSidebarCredProvider();
    const name = await popupPrompt({
        title: 'Add Base URL Preset',
        message: 'Create a new base URL preset.',
        label: 'Preset name',
        placeholder: 'e.g. NewURL',
        confirmText: 'Add',
        required: true
    });
    if (!name) return;
    const baseUrl = String(els.sidebarCredUrlDraft?.value || '').trim();
    try {
        const res = await fetch(`/api/credentials/${encodeURIComponent(provider)}/urls`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, base_url: baseUrl, overwrite: false })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Add failed');
        await applyCredentialsActive({ provider, urlName: name });
        toast('Base URL preset added', 'success');
    } catch (e) {
        toast(e.message || 'Failed to add URL preset', 'error');
    }
}

async function sidebarDeleteUrlPreset() {
    const provider = getSidebarCredProvider();
    const cache = state.credentialPresets?.[provider] || { active: {} };
    const name = String(cache.active?.url_preset || '').trim();
    if (!name) { toast('No active URL preset to delete', 'info'); return; }
    const ok = await popupConfirm({
        title: 'Delete Base URL Preset',
        message: `Delete base URL preset "${name}"?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        danger: true
    });
    if (!ok) return;
    try {
        const res = await fetch(`/api/credentials/${encodeURIComponent(provider)}/urls/${encodeURIComponent(name)}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Delete failed');
        await loadCredentialPresets(provider);
        await loadConfig();
        toast('URL preset deleted', 'success');
    } catch (e) {
        toast(e.message || 'Failed to delete URL preset', 'error');
    }
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

async function saveDefaultTemperature() {
    const temperature = parseFloat(els.temperature?.value || '0');
    if (Number.isNaN(temperature)) return;
    try {
        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ default_temperature: temperature })
        });
    } catch (e) { console.error('Failed to save default temperature:', e); }
}

async function saveDefaultMaxTokens() {
    const maxTokens = parseInt(els.maxOutputTokens?.value || '0', 10);
    if (!maxTokens) return;
    try {
        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ default_max_tokens: maxTokens })
        });
    } catch (e) { console.error('Failed to save max output tokens:', e); }
}

// ============ EXPORT ============
function normalizeExportFormat(format) {
    return ['sharegpt', 'openai', 'alpaca'].includes(format) ? format : 'sharegpt';
}

function normalizeExportSystemMode(mode) {
    const raw = String(mode || '').trim().toLowerCase();
    if (raw === 'override') return 'replace_all';
    if (raw === 'strip') return 'remove_all';
    if (['keep', 'add_if_missing', 'replace_first', 'replace_all', 'remove_all', 'prepend', 'append'].includes(raw)) return raw;
    return 'add_if_missing';
}

function updateSidebarExportButton() {
    const format = normalizeExportFormat(state.uiPrefs.lastExportFormat);
    if (els.sidebarExportFormat) {
        const labels = {
            sharegpt: 'ShareGPT',
            openai: 'OpenAI',
            alpaca: 'Alpaca'
        };
        els.sidebarExportFormat.textContent = labels[format] || 'ShareGPT';
    }
}

function setLastExportFormat(format) {
    state.uiPrefs.lastExportFormat = normalizeExportFormat(format);
    updateSidebarExportButton();
    saveUiPrefs();
}

function setLastExportFolder(folder) {
    state.uiPrefs.exportFolder = (String(folder) === 'rejected') ? 'rejected' : 'wanted';
    saveUiPrefs();
}

function setLastExportSystemMode(mode) {
    state.uiPrefs.exportSystemMode = normalizeExportSystemMode(mode);
    saveUiPrefs();
}

function setLastExportPromptSource(source) {
    const s = String(source || '');
    state.uiPrefs.exportPromptSource = ['custom', 'chat', 'generate'].includes(s) ? s : 'custom';
    saveUiPrefs();
}

// ============ EXPORT PRESETS ============
async function loadExportPresets() { await loadSystemPresets('export'); }
function loadExportPreset() { loadSystemPreset('export'); }
async function saveExportPreset() { await saveSystemPreset('export'); }
async function newExportPreset() { await newSystemPreset('export'); }
async function deleteExportPreset() { await deleteSystemPreset('export'); }

async function openExportModal(format) {
    const selectedFormat = normalizeExportFormat(format || state.uiPrefs.lastExportFormat || els.exportFormat?.value);
    els.exportFormat.value = selectedFormat;
    setLastExportFormat(selectedFormat);

    const prevFolder = state.export.folder || 'wanted';
    const desiredFolder = String(state.uiPrefs.exportFolder || prevFolder || 'wanted');
    state.export.folder = (desiredFolder === 'rejected') ? 'rejected' : 'wanted';
    if (els.exportFolder) els.exportFolder.value = state.export.folder;

    state.export.systemPromptMode = normalizeExportSystemMode(state.uiPrefs.exportSystemMode || state.export.systemPromptMode);
    renderExportSystemModeSummary();

    const systemMode = getSelectedExportSystemMode();
    const needsPrompt = exportModeUsesPrompt(systemMode);

    // Set prompt source based on current tab if no custom export draft exists
    if (!needsPrompt) {
        els.exportPromptSourceCustom.checked = true;
    } else if (!state.export.systemPrompt) {
        const prefSource = String(state.uiPrefs.exportPromptSource || '');
        if (prefSource === 'chat') els.exportPromptSourceChat.checked = true;
        else if (prefSource === 'generate') els.exportPromptSourceGenerate.checked = true;
        else if (prefSource === 'custom') els.exportPromptSourceCustom.checked = true;
        else if (state.currentTab === 'chat') els.exportPromptSourceChat.checked = true;
        else if (state.currentTab === 'generate') els.exportPromptSourceGenerate.checked = true;
        else els.exportPromptSourceCustom.checked = true;
    } else {
        els.exportPromptSourceCustom.checked = true;
        if (els.exportSystemPrompt) els.exportSystemPrompt.value = state.export.systemPrompt;
    }
    updateExportPromptState();

    els.exportModal.classList.remove('hidden');
    const hasActiveLoadAll = !!state.export.loadAllTaskId && state.tasks.items.has(state.export.loadAllTaskId);
    const folderChanged = prevFolder !== state.export.folder;
    const shouldReset = folderChanged || (!hasActiveLoadAll && state.export.files.length === 0);
    if (shouldReset) await loadExportFiles({ reset: true });
    else { renderExportFileList(); updateExportCount(); }
    renderExportPreview();
}

function getSelectedExportPromptSource() {
    return document.querySelector('input[name="export-prompt-source"]:checked')?.value || 'custom';
}

function getSelectedExportSystemMode() {
    return normalizeExportSystemMode(state.export.systemPromptMode || state.uiPrefs.exportSystemMode);
}

function exportModeUsesPrompt(mode) {
    const m = normalizeExportSystemMode(mode);
    return ['add_if_missing', 'replace_first', 'replace_all', 'prepend', 'append'].includes(m);
}

function getExportSystemModeMeta(mode) {
    const m = normalizeExportSystemMode(mode);
    const meta = {
        add_if_missing: { label: 'Add if missing', desc: 'Keep existing system; insert only when missing.' },
        keep: { label: 'Keep as-is', desc: 'Export exactly as stored.' },
        replace_first: { label: 'Replace first system', desc: 'Replace only the leading system message (or insert at top). Mid-conversation system messages are preserved.' },
        replace_all: { label: 'Replace all system', desc: 'Remove existing system and insert your prompt first.' },
        remove_all: { label: 'Remove all system', desc: 'Remove all system messages; ignore your prompt.' },
        prepend: { label: 'Prepend', desc: 'Prepend prompt to first system (or insert if missing).' },
        append: { label: 'Append', desc: 'Append prompt to first system (or insert if missing).' },
    };
    return meta[m] || meta.add_if_missing;
}

function renderExportSystemModeSummary() {
    if (!els.exportSystemModeSummary) return;
    const mode = getSelectedExportSystemMode();
    const meta = getExportSystemModeMeta(mode);
    const needsPrompt = exportModeUsesPrompt(mode);
    els.exportSystemModeSummary.textContent = `${meta.label} — ${meta.desc}${needsPrompt ? '' : ' (prompt disabled)'}`;
}

function updateExportPromptState() {
    const mode = getSelectedExportSystemMode();
    const needsPrompt = exportModeUsesPrompt(mode);
    const source = getSelectedExportPromptSource();
    const canEditCustom = needsPrompt && source === 'custom';

    setLastExportSystemMode(mode);
    if (needsPrompt) setLastExportPromptSource(source);
    renderExportSystemModeSummary();

    // Disable prompt source radios unless this mode uses a prompt.
    document.querySelectorAll('input[name="export-prompt-source"]').forEach(input => {
        input.disabled = !needsPrompt;
    });

    if (!canEditCustom) {
        els.exportCustomPromptGroup.classList.add('disabled-group');
        els.exportSystemPrompt.disabled = true;
        els.exportPresetSelect.disabled = true;
    } else {
        els.exportCustomPromptGroup.classList.remove('disabled-group');
        els.exportSystemPrompt.disabled = false;
        els.exportPresetSelect.disabled = false;
    }
}

function openExportSystemModeModal() {
    if (!els.exportSystemModeModal) return;
    const current = getSelectedExportSystemMode();
    const radios = els.exportSystemModeModal.querySelectorAll('input[name="export-system-mode-choice"]');
    radios.forEach(r => { r.checked = (r.value === current); });
    els.exportSystemModeModal.classList.remove('hidden');
}

function closeExportSystemModeModal() {
    els.exportSystemModeModal?.classList.add('hidden');
}

function applyExportSystemModeFromModal() {
    if (!els.exportSystemModeModal) return;
    const checked = els.exportSystemModeModal.querySelector('input[name="export-system-mode-choice"]:checked');
    const mode = normalizeExportSystemMode(checked?.value || '');
    state.export.systemPromptMode = mode;
    setLastExportSystemMode(mode);
    renderExportSystemModeSummary();
    updateExportPromptState();
    closeExportSystemModeModal();
}

function updateExportPaginationUI() {
    if (els.exportPaginationStatus) {
        const loaded = Math.min(state.export.offset, state.export.files.length);
        const total = state.export.total || 0;
        els.exportPaginationStatus.textContent = total > 0 ? `Showing ${loaded} of ${total}` : '';
    }
}

async function loadExportFiles({ reset = false, signal = null, requestSeq = null } = {}) {
    if (requestSeq != null && state.export.requestSeq !== requestSeq) return;
    const activeRequestSeq = requestSeq ?? beginSliceRequest(state.export);
    const pageSize = getModalPageSize();
    if (reset) {
        state.export.files = [];
        clearSelectableSelection(state.export);
        state.export.offset = 0;
        state.export.total = 0;
        state.export.hasMore = false;
        state.export.previewId = null;
        state.export.previewConversation = null;
        state.export.renderedCount = 0;
        state.export.seenIds.clear();
        state.export.idToIndex.clear();
        if (els.exportFileList) els.exportFileList.innerHTML = '';
    }
    state.export.isLoading = true;
    if (!els.exportModal?.classList.contains('hidden')) {
        // Show immediate feedback (spinner / "Loading...") and ensure virtual loading row state is correct.
        renderExportFileList();
        updateExportPaginationUI();
    }
    let aborted = false;
    try {
        const params = new URLSearchParams({
            folder: state.export.folder === 'rejected' ? 'rejected' : 'wanted',
            limit: String(pageSize),
            offset: String(state.export.offset)
        });
        const search = els.exportSearchInput?.value?.trim() || '';
        if (search) params.set('search', search);
        const res = await fetch(`/api/conversations?${params.toString()}`, signal ? { signal } : undefined);
        if (isSliceRequestStale(state.export, activeRequestSeq, signal)) return;
        if (res.ok) {
            const data = await res.json();
            if (isSliceRequestStale(state.export, activeRequestSeq, signal)) return;
            const items = Array.isArray(data) ? data : (data.conversations || []);
            for (const item of items) {
                const itemId = item?.id;
                if (!itemId || state.export.seenIds.has(itemId)) continue;
                state.export.seenIds.add(itemId);
                state.export.idToIndex.set(itemId, state.export.files.length);
                state.export.files.push(item);
            }
            state.export.total = Array.isArray(data) ? items.length : (data.total || state.export.files.length);
            state.export.offset += items.length;
            if (items.length === 0) state.export.hasMore = false;
            else state.export.hasMore = state.export.offset < state.export.total;
            if (!els.exportModal?.classList.contains('hidden')) {
                renderExportFileList();
                updateExportCount();
                if (reset) renderExportPreview();
                updateExportPaginationUI();
            }
        }
    } catch (e) {
        if (e?.name === 'AbortError') aborted = true;
        else if (!isSliceRequestStale(state.export, activeRequestSeq, signal)) { state.export.files = []; renderExportFileList(); renderExportPreview(); }
    } finally {
        const requestIsStale = state.export.requestSeq !== activeRequestSeq;
        if (requestIsStale) return;
        state.export.isLoading = false;
        if (aborted || signal?.aborted) return;
        if (!aborted) updateExportPaginationUI();
        if (!els.exportModal?.classList.contains('hidden')) {
            // Ensure the "Loading more..." row is hidden after paging completes.
            renderExportFileList();
        }
    }
}

function loadMoreExportFiles() {
    if (state.export.hasMore && !state.export.isLoading) {
        loadExportFiles();
    }
}

function renderExportFileList() {
    if (!els.exportFileList) return;
    renderVirtualWindow({
        slice: state.export,
        container: els.exportFileList,
        items: state.export.files,
        renderRowHtml: renderExportRowHtml
    });
    updateExportPaginationUI();
}

function renderExportRowHtml(file) {
    const isSelected = state.export.selectedIds.has(file.id);
    const isPreviewing = state.export.previewId === file.id;
    const preview = file.preview || file.id || 'No preview';
    const meta = [file.created_at ? formatDate(file.created_at) : '', file.turns ? `${file.turns} msgs` : ''].filter(Boolean).join(' • ');
    return `<div class="export-file-item ${isSelected ? 'selected' : ''} ${isPreviewing ? 'active-preview' : ''}" data-id="${escapeHtml(file.id)}">
        <input type="checkbox" class="file-checkbox" ${isSelected ? 'checked' : ''}>
        <div class="export-file-info">
            <div class="export-file-preview">${escapeHtml(preview)}</div>
            <div class="export-file-meta">${escapeHtml(meta || file.id)}</div>
        </div>
    </div>`;
}

function renderExportPreview() {
    if (!els.exportPreview) return;
    const conv = state.export.previewConversation;
    if (!conv?.conversations?.length) {
        els.exportPreview.innerHTML = '<div class="empty-files">Select a conversation to preview it here</div>';
        return;
    }
    els.exportPreview.innerHTML = renderConversationMarkup(conv.conversations);
}

function updateExportCount() {
    updateSelectionToolbar({
        selectedIds: state.export.selectedIds,
        files: state.export.files,
        toggleButton: els.exportSelectToggle,
        chip: els.exportSelectionChip,
        countEl: els.exportFileCount
    });
}

function toggleAllExportFiles() {
    state.export.selectedIds = new Set(state.export.files.map(f => f.id));
    refreshSelectableListUI(els.exportFileList, state.export);
    updateExportCount();
}

function getExportSystemPromptPayload() {
    const mode = getSelectedExportSystemMode();
    if (mode === 'keep' || mode === 'remove_all') {
        return { systemPrompt: null, systemPromptMode: mode };
    }
    const source = getSelectedExportPromptSource();
    if (source === 'chat') {
        return { systemPrompt: (els.chatSystemPrompt?.value || state.chat.systemPrompt || ''), systemPromptMode: mode };
    } else if (source === 'generate') {
        return { systemPrompt: (els.systemPrompt?.value || ''), systemPromptMode: mode };
    } else {
        return { systemPrompt: (els.exportSystemPrompt?.value ?? ''), systemPromptMode: mode };
    }
}

async function exportDataset(format, selectedIds = null, systemPrompt = null, systemPromptMode = null) {
    showSaveIndicator('Exporting...');
    try {
        const filename = els.exportFilename?.value?.trim() || null;
        const write_manifest = els.exportWriteManifest?.checked ?? false;
        const prompt_source = getSelectedExportPromptSource();
        const folder = state.export.folder === 'rejected' ? 'rejected' : 'wanted';
        const res = await fetch(`/api/export/${format}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: selectedIds, folder, system_prompt: systemPrompt, system_prompt_mode: systemPromptMode, filename, write_manifest, prompt_source })
        });
        if (res.ok) {
            const data = await res.json();
            const extra = data.manifest_path ? ` (manifest: ${data.manifest_path})` : '';
            toast(`Exported ${selectedIds?.length || 'all'} conversations to ${data.path}${extra}`, 'success');
            hideSaveIndicator('Exported ✓');
        } else { const err = await res.json(); toast(err.error || 'Export failed', 'error'); hideSaveIndicator('Export failed'); }
    } catch (e) { toast('Export failed', 'error'); hideSaveIndicator('Export failed'); }
}

async function previewExportDataset(format, selectedIds = null, systemPrompt = null, systemPromptMode = null) {
    showSaveIndicator('Previewing...');
    try {
        const folder = state.export.folder === 'rejected' ? 'rejected' : 'wanted';
        const res = await fetch(`/api/export-preview/${format}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: selectedIds, folder, system_prompt: systemPrompt, system_prompt_mode: systemPromptMode, limit: 30 })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Preview failed');
        if (!els.exportPreviewModal || !els.exportPreviewJsonl) return;
        els.exportPreviewModal.classList.remove('hidden');
        const lines = Array.isArray(data.lines) ? data.lines : [];
        els.exportPreviewJsonl.textContent = lines.join('\n');
        if (els.exportPreviewSummary) {
            const trunc = data.truncated ? ' · truncated' : '';
            els.exportPreviewSummary.textContent = `Conversations: ${data.total_conversations || 0} · Entries (est.): ${data.total_entries || 0} · Showing: ${lines.length}${trunc}`;
        }
        hideSaveIndicator('Preview ✓');
    } catch (e) {
        toast(e.message || 'Preview failed', 'error');
        hideSaveIndicator('Preview failed');
    }
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
    // Respect the autoSave setting
    if (!syncSettings.autoSaveEnabled) return;
    if (saveDraftTimer) clearTimeout(saveDraftTimer);
    const delay = syncSettings.saveInterval || 2000;
    saveDraftTimer = setTimeout(async () => {
        const changed = await saveDraftToLocal();
        if (changed) syncEngine.markDirty();
    }, delay);
}

async function saveDraftToLocal() {
    try {
        const draft = await buildDraftObject();
        const draftJson = JSON.stringify(draft);
        const hash = syncEngine._simpleHash(draftJson);
        if (hash === lastLocalDraftHash) return false;
        showSaveIndicator('Saving locally...');
        await dbSet('drafts', SESSION_ID, draft);
        lastLocalDraftHash = hash;
        hideSaveIndicator('Saved ✓');
        return true;
    } catch (e) {
        console.error('Failed to save draft locally:', e);
        hideSaveIndicator('Save failed');
        return false;
    }
}

async function buildDraftObject() {
    const currentReviewItem = state.review.queue[state.review.currentIndex];
    const reviewEditBuffer = state.review.isEditing ? String(els.reviewEditInput?.value || '') : '';
    const reviewQueuePage = (state.review.queue || [])
        .map(item => ({
            id: String(item?.id || ''),
            rawText: String(item?.rawText || ''),
            preview: String(item?.preview || item?.rawText || ''),
            createdAt: item?.createdAt || ''
        }))
        .filter(item => item.id);
    const reviewCurrentItem = currentReviewItem?.id
        ? {
            id: String(currentReviewItem.id),
            conversations: Array.isArray(currentReviewItem.conversations) ? currentReviewItem.conversations : [],
            rawText: String(currentReviewItem.rawText || ''),
            metadata: currentReviewItem.metadata || {},
            createdAt: currentReviewItem.createdAt || ''
        }
        : null;
    const reviewBrowserItems = (state.reviewBrowser.items || [])
        .map(item => ({
            id: String(item?.id || ''),
            preview: String(item?.preview || item?.rawText || ''),
            createdAt: item?.createdAt || ''
        }))
        .filter(item => item.id);

    return {
        _sessionId: SESSION_ID,
        currentPromptName: state.currentPromptName,
        model: getModelValue(),
        temperature: parseFloat(els.temperature?.value || 0.9),
        customParams: state.customParams,
        listIterators: state.listIterators || {},
        macroTraceLast: state.macroTraceLast || null,
        generate: {
            prompt: els.systemPrompt?.value || '',
            variables: state.generate.variables,
            presetName: state.generate.variablePresetName || els.presetSelect?.value || '',
            rawText: getGenerateRawText()
        },
        chat: {
            messages: state.chat.messages.filter(m => !m.streaming),
            systemPrompt: els.chatSystemPrompt?.value || '',
            presetName: state.chat.presetName || els.chatPresetSelect?.value || ''
        },
        export: {
            systemPrompt: els.exportSystemPrompt?.value || '',
            presetName: state.export.presetName || els.exportPresetSelect?.value || ''
        },
        review: {
            currentIndex: state.review.pageOffset + state.review.currentIndex,
            pageOffset: state.review.pageOffset,
            total: state.review.total || state.review.queue.length,
            isEditing: !!state.review.isEditing,
            editBuffer: reviewEditBuffer,
            currentItemId: String(currentReviewItem?.id || ''),
            queuePage: reviewQueuePage,
            currentItem: reviewCurrentItem,
        },
        filesModal: {
            currentFolder: state.filesModal.currentFolder,
            selectedIds: Array.from(state.filesModal.selectedIds || []),
            previewId: state.filesModal.previewId || '',
            search: els.filesSearchInput?.value || '',
        },
        reviewBrowser: {
            items: reviewBrowserItems,
            total: state.reviewBrowser.total,
            offset: state.reviewBrowser.offset,
            hasMore: state.reviewBrowser.hasMore,
            selectedIds: Array.from(state.reviewBrowser.selectedIds || []),
            previewId: state.reviewBrowser.previewId || '',
            search: els.reviewBrowserSearchInput?.value || '',
        },
        _localTime: new Date().toISOString()
    };
}

async function restoreDraft() {
    try {
        const sessionDraft = await dbGet('drafts', SESSION_ID);
        if (sessionDraft) {
            lastLocalDraftHash = syncEngine._simpleHash(JSON.stringify(sessionDraft));
            applyDraft(sessionDraft);
            return sessionDraft;
        }
    } catch (e) { }
    try {
        const serverDraft = await syncEngine.pull();
        if (serverDraft) {
            applyDraft(serverDraft);
            return serverDraft;
        }
    } catch (e) { }
    return null;
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
        hydratedFields.model = true;
    }
    if (draft.temperature != null && els.temperature) {
        els.temperature.value = draft.temperature;
        if (els.tempValue) els.tempValue.textContent = draft.temperature;
        hydratedFields.temperature = true;
    }
    if (draft.customParams) {
        state.customParams = draft.customParams;
        renderCustomParams();
    }
    if (draft.listIterators && typeof draft.listIterators === 'object') {
        state.listIterators = draft.listIterators;
    }
    if (draft.macroTraceLast && typeof draft.macroTraceLast === 'object') {
        state.macroTraceLast = draft.macroTraceLast;
    }
    if (draft.generate?.prompt && els.systemPrompt) {
        els.systemPrompt.value = draft.generate.prompt;
        extractVariables();
    }
    if (draft.generate?.variables) {
        state.generate.variables = draft.generate.variables;
        renderVariableInputs(state.generate.variableNames);
    }
    if (draft.generate?.presetName) {
        state.generate.variablePresetName = draft.generate.presetName;
        if (els.presetSelect) els.presetSelect.value = draft.generate.presetName;
    }
    if (typeof draft.generate?.rawText === 'string') {
        setGenerateRawText(draft.generate.rawText);
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
    if (draft.chat?.presetName && els.chatPresetSelect) {
        state.chat.presetName = draft.chat.presetName;
        els.chatPresetSelect.value = draft.chat.presetName;
    }
    if (draft.export?.systemPrompt && els.exportSystemPrompt) {
        els.exportSystemPrompt.value = draft.export.systemPrompt;
        state.export.systemPrompt = draft.export.systemPrompt;
    }
    if (draft.export?.presetName && els.exportPresetSelect) {
        state.export.presetName = draft.export.presetName;
        els.exportPresetSelect.value = draft.export.presetName;
    }
    if (draft.review) {
        const restoredQueuePage = Array.isArray(draft.review.queuePage)
            ? draft.review.queuePage
                .map(item => ({
                    id: String(item?.id || ''),
                    rawText: String(item?.rawText || ''),
                    preview: String(item?.preview || item?.rawText || ''),
                    createdAt: item?.createdAt || ''
                }))
                .filter(item => item.id)
            : [];
        state.review.queue = restoredQueuePage;
        state.review.pageOffset = Number.isFinite(Number(draft.review.pageOffset))
            ? Math.max(0, Number(draft.review.pageOffset))
            : state.review.pageOffset;
        state.review.total = Number.isFinite(Number(draft.review.total))
            ? Math.max(restoredQueuePage.length, Number(draft.review.total))
            : restoredQueuePage.length;
        const restoredAbsoluteIndex = Number.isFinite(Number(draft.review.currentIndex))
            ? Math.max(0, Number(draft.review.currentIndex))
            : state.review.pageOffset;
        state.review.currentIndex = restoredQueuePage.length
            ? Math.max(0, Math.min(restoredAbsoluteIndex - state.review.pageOffset, restoredQueuePage.length - 1))
            : 0;
        const restoredCurrentItem = draft.review.currentItem;
        if (restoredCurrentItem?.id) {
            const currentItemIndex = state.review.queue.findIndex(item => item.id === String(restoredCurrentItem.id));
            if (currentItemIndex !== -1) {
                state.review.queue[currentItemIndex] = {
                    ...state.review.queue[currentItemIndex],
                    id: String(restoredCurrentItem.id),
                    conversations: Array.isArray(restoredCurrentItem.conversations) ? restoredCurrentItem.conversations : [],
                    rawText: String(restoredCurrentItem.rawText || state.review.queue[currentItemIndex].rawText || ''),
                    metadata: restoredCurrentItem.metadata || {},
                    createdAt: restoredCurrentItem.createdAt || state.review.queue[currentItemIndex].createdAt || ''
                };
            }
        }
    }
    if (draft.filesModal) {
        state.filesModal.currentFolder = String(draft.filesModal.currentFolder || state.filesModal.currentFolder || 'wanted');
        const restoredSelectedIds = (draft.filesModal.selectedIds || []).map(id => String(id || '')).filter(Boolean);
        const restoredPreviewId = String(draft.filesModal.previewId || '');
        state.filesModal.selectedIds = new Set(restoredSelectedIds);
        state.filesModal.previewId = restoredPreviewId;
        setFilesModalPendingSelection(restoredSelectedIds, restoredPreviewId);
        if (els.filesSearchInput && typeof draft.filesModal.search === 'string') {
            els.filesSearchInput.value = draft.filesModal.search;
        }
    }
    if (draft.reviewBrowser) {
        const restoredItems = Array.isArray(draft.reviewBrowser.items)
            ? draft.reviewBrowser.items
                .map(item => ({
                    id: String(item?.id || ''),
                    preview: String(item?.preview || item?.rawText || ''),
                    createdAt: item?.createdAt || ''
                }))
                .filter(item => item.id)
            : [];
        state.reviewBrowser.items = restoredItems;
        state.reviewBrowser.total = draft.reviewBrowser.total ?? 0;
        state.reviewBrowser.offset = draft.reviewBrowser.offset ?? 0;
        state.reviewBrowser.hasMore = draft.reviewBrowser.hasMore ?? false;
        state.reviewBrowser.seenIds = new Set(restoredItems.map(item => item.id));
        state.reviewBrowser.idToIndex = new Map(restoredItems.map((item, index) => [item.id, index]));
        state.reviewBrowser.selectedIds = new Set((draft.reviewBrowser.selectedIds || []).map(id => String(id || '')).filter(Boolean));
        state.reviewBrowser.previewId = String(draft.reviewBrowser.previewId || '');
        state.reviewBrowser.previewConversation = null;
        state.reviewBrowser.previewLoading = false;
        if (els.reviewBrowserSearchInput && typeof draft.reviewBrowser.search === 'string') {
            els.reviewBrowserSearchInput.value = draft.reviewBrowser.search;
        }
    }
}

async function applyDeferredDraftState(draft) {
    if (!draft?.review) return;

    const reviewPageSize = getModalPageSize();
    if (Number.isFinite(Number(draft.review.currentIndex))) {
        const absoluteIndex = Math.max(0, Number(draft.review.currentIndex));
        const pageOffset = Math.floor(absoluteIndex / reviewPageSize) * reviewPageSize;
        state.review.pageOffset = pageOffset;
        await loadReviewQueue({ reset: true, targetAbsoluteIndex: absoluteIndex });
    } else if (Number.isFinite(Number(draft.review.pageOffset))) {
        state.review.pageOffset = Math.max(0, Number(draft.review.pageOffset));
    }

    const currentItem = state.review.queue[state.review.currentIndex];
    if (currentItem && typeof draft.review.editBuffer === 'string' && draft.review.editBuffer.trim()) {
        currentItem.rawText = draft.review.editBuffer;
    }
    state.review.isEditing = !!draft.review.isEditing && !!currentItem;
    updateReviewBadge();
    renderReviewItem();
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

function safeJsonClone(value, fallback = null) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (e) {
        return fallback;
    }
}

function formatDate(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ============ POPUP MODAL (replaces prompt()/confirm()) ============
const popupState = {
    resolve: null,
    requiresInput: false,
};

function isPopupOpen() {
    return !!els.popupModal && !els.popupModal.classList.contains('hidden');
}

function closePopup({ confirmed = false, value = '', checked = false } = {}) {
    if (!els.popupModal) return;
    els.popupModal.classList.add('hidden');
    const resolve = popupState.resolve;
    popupState.resolve = null;
    popupState.requiresInput = false;
    resolve?.({ confirmed, value, checked: !!checked });
}

function setPopupHint(text = '') {
    if (!els.popupHint) return;
    const t = String(text || '').trim();
    els.popupHint.textContent = t;
    els.popupHint.classList.toggle('hidden', !t);
}

function openPopup({
    title = 'Confirm',
    message = '',
    confirmText = 'OK',
    cancelText = 'Cancel',
    danger = false,
    input = null, // { label, value, placeholder, required, hint }
    checkbox = null, // { label, checked }
} = {}) {
    if (!els.popupModal) return Promise.resolve({ confirmed: false, value: '' });
    if (popupState.resolve) closePopup({ confirmed: false, value: '' });

    els.popupTitle.textContent = String(title || 'Confirm');
    els.popupMessage.textContent = String(message || '');

    els.popupCancel.textContent = String(cancelText || 'Cancel');
    els.popupConfirm.textContent = String(confirmText || 'OK');

    els.popupConfirm.classList.toggle('btn-danger', !!danger);
    els.popupConfirm.classList.toggle('btn-primary', !danger);

    const wantsInput = !!input;
    popupState.requiresInput = !!(input && input.required);
    els.popupInputGroup.classList.toggle('hidden', !wantsInput);
    const wantsCheckbox = !!checkbox;
    if (els.popupCheckboxGroup) els.popupCheckboxGroup.classList.toggle('hidden', !wantsCheckbox);

    if (wantsInput) {
        els.popupInputLabel.textContent = String(input.label || 'Name');
        els.popupInput.type = String(input.type || 'text');
        els.popupInput.value = String(input.value || '');
        els.popupInput.placeholder = String(input.placeholder || '');
        setPopupHint(input.hint || '');
    } else {
        els.popupInput.type = 'text';
        els.popupInput.value = '';
        els.popupInput.placeholder = '';
        setPopupHint('');
    }

    if (wantsCheckbox) {
        if (els.popupCheckboxLabel) els.popupCheckboxLabel.textContent = String(checkbox.label || 'Do not ask again');
        if (els.popupCheckbox) els.popupCheckbox.checked = !!checkbox.checked;
    } else {
        if (els.popupCheckbox) els.popupCheckbox.checked = false;
        if (els.popupCheckboxLabel) els.popupCheckboxLabel.textContent = 'Do not ask again';
    }

    els.popupModal.classList.remove('hidden');

    // Focus
    setTimeout(() => {
        if (wantsInput) {
            els.popupInput.focus();
            els.popupInput.select();
        } else {
            els.popupConfirm.focus();
        }
    }, 0);

    return new Promise(resolve => {
        popupState.resolve = resolve;
    });
}

async function popupConfirmWithCheckbox({
    title = 'Confirm',
    message = '',
    confirmText = 'OK',
    cancelText = 'Cancel',
    danger = false,
    checkboxLabel = 'Do not ask again',
    checkboxChecked = false,
} = {}) {
    const res = await openPopup({
        title,
        message,
        confirmText,
        cancelText,
        danger,
        checkbox: { label: checkboxLabel, checked: checkboxChecked }
    });
    return { confirmed: !!res.confirmed, checked: !!res.checked };
}

async function popupConfirm({
    title = 'Confirm',
    message = '',
    confirmText = 'OK',
    cancelText = 'Cancel',
    danger = false,
} = {}) {
    const res = await openPopup({ title, message, confirmText, cancelText, danger });
    return !!res.confirmed;
}

async function popupPrompt({
    title = 'Enter value',
    message = '',
    label = 'Name',
    value = '',
    placeholder = '',
    type = 'text',
    confirmText = 'Save',
    cancelText = 'Cancel',
    required = true,
    hint = '',
} = {}) {
    const res = await openPopup({
        title,
        message,
        confirmText,
        cancelText,
        danger: false,
        input: { label, value, placeholder, required, hint, type }
    });
    if (!res.confirmed) return null;
    return String(res.value || '').trim();
}

function toast(message, type = 'info') {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = message;
    els.toastContainer.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    updateStatusStackLayout();
    setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => {
            t.remove();
            updateStatusStackLayout();
        }, 300);
    }, 3000);
}

function updateStatusStackLayout() {
    const h = els.toastContainer?.offsetHeight || 0;
    const pad = h > 0 ? 8 : 0;
    document.documentElement.style.setProperty('--toast-stack-height', `${h + pad}px`);

    const modelVisible = !!els.modelActivityIndicator && !els.modelActivityIndicator.classList.contains('hidden');
    const mh = modelVisible ? (els.modelActivityIndicator.offsetHeight || 0) : 0;
    const mpad = mh > 0 ? 10 : 0;
    document.documentElement.style.setProperty('--model-indicator-height', `${mh + mpad}px`);
}

// ============ RESOLVED PROMPT PREVIEW ============
function renderPromptPreviewModal() {
    if (!els.promptPreviewModal || els.promptPreviewModal.classList.contains('hidden')) return;
    const raw = String(els.systemPrompt?.value || '');
    const iteratorSnapshot = { ...(state.listIterators || {}) };
    const { text, trace } = resolvePromptWithTrace(raw, { isPreview: true, recordTrace: true, iteratorState: iteratorSnapshot });
    state.promptPreview.text = text;
    state.promptPreview.trace = trace;

    if (els.promptPreviewText) {
        els.promptPreviewText.textContent = text || '—';
    }
    if (els.promptPreviewTrace) {
        const randomEntries = Object.entries(trace.random || {})
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([k, v]) => ({ code: `{{${k}}}`, value: v?.value ?? '', meta: `options: ${v?.options ?? '—'}` }));

        const listEntries = Object.entries(trace.list || {})
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([k, v]) => {
                const idx = typeof v?.index === 'number' ? v.index : '—';
                const meta = `index: ${idx} · next: ${v?.next ?? '—'} · options: ${v?.options ?? '—'}`;
                return ({ code: `{{${k}}}`, value: v?.value ?? '', meta });
            });

        const rollEntries = Object.entries(trace.roll || {})
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([notation, value]) => ({ code: `{{roll:${notation}}}`, value: String(value ?? ''), meta: '' }));

        const variableEntries = Object.entries(trace.variables || {})
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([k, v]) => ({ code: `{{${k}}}`, value: String(v ?? ''), meta: '' }));

        els.promptPreviewTrace.innerHTML = [
            _renderMacroStateGroup('Variables', variableEntries),
            _renderMacroStateGroup('List', listEntries),
            _renderMacroStateGroup('Random', randomEntries),
            _renderMacroStateGroup('Roll', rollEntries),
        ].join('\n');
    }
}

function openPromptPreviewModal() {
    if (!els.promptPreviewModal) return;
    els.promptPreviewModal.classList.remove('hidden');
    renderPromptPreviewModal();
}

function closePromptPreviewModal() {
    els.promptPreviewModal?.classList.add('hidden');
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
    if (tabName === 'state') renderMacroState();
    if (tabName === 'history') ensurePromptHistoryLoaded().then(() => renderPromptHistory());
}

function _renderMacroStateGroup(title, entries) {
    const items = entries.map(({ code, value, meta }) => `
        <div class="macro-ref-item">
            <code class="macro-code">${escapeHtml(code)}</code>
            <div class="muted small">${escapeHtml(String(value ?? ''))}</div>
            ${meta ? `<div class="muted small">${escapeHtml(meta)}</div>` : ''}
        </div>
    `).join('');
    return `
        <div class="macro-ref-item macro-ref-tip">
            <strong>${escapeHtml(title)}</strong>
        </div>
        ${items || '<div class="muted small">None</div>'}
    `;
}

function renderMacroState() {
    if (!els.macrosStateBody) return;
    const trace = state.macroTraceLast;
    if (!trace || (!Object.keys(trace.random || {}).length && !Object.keys(trace.list || {}).length && !Object.keys(trace.roll || {}).length && !Object.keys(trace.variables || {}).length)) {
        els.macrosStateBody.innerHTML = '<div class="muted small">No macro state yet. Generate or chat once to populate.</div>';
        return;
    }

    const randomEntries = Object.entries(trace.random || {})
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, v]) => ({ code: `{{${k}}}`, value: v?.value ?? '', meta: `options: ${v?.options ?? '—'}` }));

    const listEntries = Object.entries(trace.list || {})
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, v]) => {
            const idx = typeof v?.index === 'number' ? v.index : '—';
            const meta = `index: ${idx} · next: ${v?.next ?? '—'} · options: ${v?.options ?? '—'}`;
            return ({ code: `{{${k}}}`, value: v?.value ?? '', meta });
        });

    const rollEntries = Object.entries(trace.roll || {})
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([notation, value]) => ({ code: `{{roll:${notation}}}`, value: String(value ?? ''), meta: '' }));

    const variableEntries = Object.entries(trace.variables || {})
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, v]) => ({ code: `{{${k}}}`, value: String(v ?? ''), meta: '' }));

    const resolvedAt = trace.resolvedAt ? new Date(trace.resolvedAt).toLocaleString() : '';
    const iterCount = Object.keys(state.listIterators || {}).length;
    const header = [
        resolvedAt ? `<div class="muted small">Last resolved: ${escapeHtml(resolvedAt)}</div>` : '',
        iterCount ? `<div class="muted small">Active list iterators: ${iterCount}</div>` : ''
    ].filter(Boolean).join('');
    els.macrosStateBody.innerHTML = [
        header,
        _renderMacroStateGroup('Variables', variableEntries),
        _renderMacroStateGroup('List', listEntries),
        _renderMacroStateGroup('Random', randomEntries),
        _renderMacroStateGroup('Roll', rollEntries),
    ].filter(Boolean).join('\n');
}

async function resetMacros() {
    const hasAny = (Object.keys(state.listIterators || {}).length > 0) || !!state.macroTraceLast;
    if (hasAny) {
        const ok = await popupConfirm({
            title: 'Reset Macros',
            message: 'Reset {{list::...}} iterators and clear the last macro state?',
            confirmText: 'Reset',
            cancelText: 'Cancel',
            danger: true
        });
        if (!ok) return;
    }
    state.listIterators = {};
    state.macroTraceLast = null;
    state.generate.lastMacroTrace = null;
    renderMacroState();
    debouncedSaveDraft();
    toast('Macros reset', 'success');
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
        promptHistoryLoaded = true;
    } catch (e) { }
}

async function ensurePromptHistoryLoaded() {
    if (promptHistoryLoaded) return;
    await loadPromptHistory();
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



async function clearPromptHistory() {
    const ok = await popupConfirm({
        title: 'Clear History',
        message: 'Clear all prompt history?',
        confirmText: 'Clear',
        cancelText: 'Cancel',
        danger: true
    });
    if (!ok) return;
    state.promptHistory = [];
    dbSet('settings', 'promptHistory', []).catch(() => { });
    renderPromptHistory();
    toast('History cleared', 'info');
}

// ============ EVENT LISTENERS ============
function setupEventListeners() {
    // Unified popup modal
    const getPopupCheckbox = () => (!els.popupCheckboxGroup?.classList.contains('hidden') && !!els.popupCheckbox?.checked);
    els.popupClose?.addEventListener('click', () => closePopup({ confirmed: false, value: '', checked: getPopupCheckbox() }));
    els.popupCancel?.addEventListener('click', () => closePopup({ confirmed: false, value: '', checked: getPopupCheckbox() }));
    els.popupConfirm?.addEventListener('click', () => {
        const value = els.popupInputGroup?.classList.contains('hidden') ? '' : (els.popupInput?.value || '');
        if (popupState.requiresInput && !String(value).trim()) {
            setPopupHint('Value required.');
            els.popupInput?.focus();
            return;
        }
        closePopup({ confirmed: true, value, checked: getPopupCheckbox() });
    });
    $('#popup-modal .modal-backdrop')?.addEventListener('click', () => closePopup({ confirmed: false, value: '', checked: getPopupCheckbox() }));
    document.addEventListener('keydown', (e) => {
        if (!isPopupOpen()) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closePopup({ confirmed: false, value: '', checked: getPopupCheckbox() });
            return;
        }
        if (e.key === 'Enter') {
            // Only consume Enter for input popups (avoids interfering with other hotkeys).
            if (els.popupInputGroup?.classList.contains('hidden')) return;
            e.preventDefault();
            e.stopPropagation();
            els.popupConfirm?.click();
        }
    }, { capture: true });

    // Model activity indicator + inspector
    els.modelActivityOpen?.addEventListener('click', (e) => {
        e.preventDefault();
        openModelInspector();
    });
    els.modelActivityDismiss?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dismissModelActivity();
    });
    els.closeModelInspectorModal?.addEventListener('click', closeModelInspector);
    $('#model-inspector-modal .modal-backdrop')?.addEventListener('click', closeModelInspector);
    els.modelInspectorCopy?.addEventListener('click', () => {
        const text = state.modelActivity.raw || '';
        if (!text) { toast('Nothing to copy', 'info'); return; }
        navigator.clipboard.writeText(text).then(() => toast('Copied', 'success')).catch(() => toast('Copy failed', 'error'));
    });
    els.modelInspectorClear?.addEventListener('click', () => {
        dismissModelActivity();
        toast('Cleared', 'info');
    });

    // Sidebar
    els.sidebarToggle.addEventListener('click', toggleSidebar);
    els.sidebarOverlay?.addEventListener('click', closeSidebar);
    document.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => scrollSidebarToSection(btn.dataset.sidebarScroll, btn));
    });

    // Manual sync
    els.manualSyncBtn?.addEventListener('click', manualSync);

    // Provider change
    els.provider.addEventListener('change', () => {
        updateProviderUI();
        loadCredentialPresets(els.provider.value);
        ensureModelsLoaded({ force: true });
        // Save provider choice to DB
        fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ default_provider: els.provider.value })
        }).catch(() => {});
    });
    els.refreshModels.addEventListener('click', refreshModels);
    els.model?.addEventListener('focus', () => { ensureModelsLoaded(); });
    els.modelInput?.addEventListener('focus', () => { ensureModelsLoaded(); });
    els.modelInput?.addEventListener('change', saveDefaultModel);
    els.modelInput?.addEventListener('input', () => { debouncedSaveDraft(); });

    // Temperature
    els.temperature.addEventListener('input', (e) => { els.tempValue.textContent = e.target.value; debouncedSaveDraft(); });
    els.temperature.addEventListener('change', saveDefaultTemperature);

    // Credentials (sidebar presets + draft inputs)
    els.sidebarCredKeyToggle?.addEventListener('click', () => {
        if (!els.sidebarCredKeyDraft) return;
        const show = els.sidebarCredKeyDraft.type === 'password';
        els.sidebarCredKeyDraft.type = show ? 'text' : 'password';
        const label = show ? 'Hide API key' : 'Show API key';
        els.sidebarCredKeyToggle.setAttribute('aria-pressed', show ? 'true' : 'false');
        els.sidebarCredKeyToggle.setAttribute('aria-label', label);
        els.sidebarCredKeyToggle.title = show ? 'Hide key' : 'Show key';
    });
    els.sidebarCredKeyDraft?.addEventListener('input', () => {
        setCredentialDraft(getSidebarCredProvider(), { api_key: els.sidebarCredKeyDraft.value });
    });
    els.sidebarCredUrlDraft?.addEventListener('input', () => {
        setCredentialDraft(getSidebarCredProvider(), { base_url: els.sidebarCredUrlDraft.value });
    });
    els.sidebarCredKeyLoad?.addEventListener('click', async () => {
        await loadCredentialPresets(getSidebarCredProvider());
        openCredPicker('key');
    });
    els.sidebarCredUrlLoad?.addEventListener('click', async () => {
        await loadCredentialPresets(getSidebarCredProvider());
        openCredPicker('url');
    });
    els.sidebarCredKeySave?.addEventListener('click', () => sidebarSaveKeyPreset({ forceNew: false }));
    els.sidebarCredKeyAdd?.addEventListener('click', sidebarAddKeyPreset);
    els.sidebarCredKeyDel?.addEventListener('click', sidebarDeleteKeyPreset);
    els.sidebarCredUrlSave?.addEventListener('click', () => sidebarSaveUrlPreset({ forceNew: false }));
    els.sidebarCredUrlAdd?.addEventListener('click', sidebarAddUrlPreset);
    els.sidebarCredUrlDel?.addEventListener('click', sidebarDeleteUrlPreset);

    // Credentials picker modal
    els.credPickerClose?.addEventListener('click', closeCredPicker);
    $('#cred-picker-modal .modal-backdrop')?.addEventListener('click', closeCredPicker);
    els.credPickerTabKey?.addEventListener('click', () => setCredPickerTab('key'));
    els.credPickerTabUrl?.addEventListener('click', () => setCredPickerTab('url'));
    els.credPickerSearch?.addEventListener('input', () => {
        credPickerState.query = String(els.credPickerSearch.value || '');
        renderCredPicker();
    });
    els.credPickerList?.addEventListener('click', async (e) => {
        const row = e.target.closest('.cred-picker-row');
        if (!row) return;
        const name = row.dataset.name || '';
        const provider = getSidebarCredProvider();
        if (credPickerState.tab === 'url') await applyCredentialsActive({ provider, urlName: name });
        else await applyCredentialsActive({ provider, keyName: name });
        closeCredPicker();
    });

	    // Sync settings
	    document.querySelectorAll('#auto-sync-enabled, #sync-interval, #auto-save-enabled, #save-interval, #ask-reject-reason, #bulk-retry-attempts').forEach(el => {
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
    els.openFilesBtn?.addEventListener('click', () => {
        openFilesModal();
        closeSidebar();
    });
    els.closeFilesModal?.addEventListener('click', closeFilesModal);
    $('#files-modal .modal-backdrop')?.addEventListener('click', closeFilesModal);

    // Files Search
    let filesSearchTimer = null;
    els.filesSearchInput?.addEventListener('input', () => {
        cancelSliceLoadAll(state.filesModal, 'Canceled');
        if (filesSearchTimer) clearTimeout(filesSearchTimer);
        const requestSeq = beginSliceRequest(state.filesModal);
        filesSearchTimer = setTimeout(() => loadFilesModal(state.filesModal.currentFolder, { reset: true, requestSeq }), LIST_SEARCH_DEBOUNCE_MS);
    });

    // Files Modal Tabs
    $$('#files-modal .file-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            cancelSliceLoadAll(state.filesModal, 'Canceled');
            loadFilesModal(e.target.dataset.folder, { reset: true });
        });
    });

    // Settings modal
    els.openSettingsBtn?.addEventListener('click', () => {
        openSettingsModal();
        scrollSettingsSection('settings-misc-section');
        closeSidebar();
    });
    els.closeSettingsModal?.addEventListener('click', closeSettingsModal);
    $('#settings-modal .modal-backdrop')?.addEventListener('click', closeSettingsModal);
    els.settingsSearchInput?.addEventListener('input', filterSettingsSections);
    document.querySelectorAll('.settings-category-btn').forEach(btn => {
        btn.addEventListener('click', () => scrollSettingsSection(btn.dataset.settingsTarget, btn));
    });
	    els.applyDatabasePath?.addEventListener('click', applyDatabasePath);
	    els.scanDatabasePaths?.addEventListener('click', () => loadDatabaseCandidates({ quiet: false }));
	    els.backupDatabaseBtn?.addEventListener('click', backupDatabaseNow);
	    els.warnLoadAll?.addEventListener('change', () => {
	        state.uiPrefs.warnOnLoadAll = els.warnLoadAll.checked !== false;
	        state.uiPrefs.skipLoadAllWarning = !state.uiPrefs.warnOnLoadAll;
	        saveUiPrefs();
	    });

    // Files Modal Bulk Actions Static Listeners
    const selectAllFiles = () => {
        state.filesModal.selectedIds = new Set(state.filesModal.files.map(f => f.id));
        refreshSelectableListUI(els.filesModalList, state.filesModal);
        updateFilesModalCount();
    };
    els.filesSelectToggle?.addEventListener('click', selectAllFiles);
    els.filesSelectToggleRejected?.addEventListener('click', selectAllFiles);
    els.filesClearSelection?.addEventListener('click', () => {
        clearSelectableSelection(state.filesModal);
        refreshSelectableListUI(els.filesModalList, state.filesModal);
        updateFilesModalCount();
    });
    const loadAllFiles = () => startLoadAllForSlice({
        slice: state.filesModal,
        title: 'Files: Loading conversations',
        loadNextPage: () => loadFilesModal(state.filesModal.currentFolder, { reset: false, signal: state.filesModal.loadAllController?.signal || null }),
        hasMore: () => state.filesModal.hasMore && !state.filesModal.isLoading,
        getProgressDetail: () => state.filesModal.currentFolder === 'rejected' ? 'Rejected' : 'Wanted'
    });
    els.filesLoadAll?.addEventListener('click', loadAllFiles);
    els.filesLoadAllRejected?.addEventListener('click', loadAllFiles);
    $('#files-bulk-reject')?.addEventListener('click', () => handleBulkMove('wanted', 'rejected'));
    $('#files-bulk-restore')?.addEventListener('click', () => handleBulkMove('rejected', 'wanted'));
    $('#files-bulk-delete')?.addEventListener('click', () => handleBulkDelete(state.filesModal.currentFolder));
    els.filesBulkDeleteRejected?.addEventListener('click', () => handleBulkDelete(state.filesModal.currentFolder));

    // Event Delegation for Files Modal List Items
    els.filesModalList?.addEventListener('mousedown', (e) => {
        if (!(e.shiftKey || e.ctrlKey || e.metaKey)) return;
        if (e.target.closest('input, textarea, select, button')) return;
        e.preventDefault();
    });
    els.filesModalList?.addEventListener('click', (e) => {
        const item = e.target.closest('.export-file-item');
        if (!item) return;
        const id = String(item.dataset.id || '');
        const diff = handleSelectableInteraction(state.filesModal, state.filesModal.files, id, e, (previewId) => {
            const requestedId = String(previewId || '');
            fetchConversationPreview(requestedId, state.filesModal.currentFolder)
                .then(conv => {
                    if (state.filesModal.previewId !== requestedId) return;
                    state.filesModal.previewConversation = conv;
                    renderFilesPreview();
                })
                .catch(() => toast('Failed to preview conversation', 'error'));
        });
        if (diff?.needsFullRefresh) {
            refreshSelectableListUI(els.filesModalList, state.filesModal);
        } else {
            (diff?.changedSelectionIds || []).forEach(changedId => updateSelectableRowUI(els.filesModalList, state.filesModal, changedId));
            (diff?.changedPreviewIds || []).forEach(changedId => updateSelectableRowUI(els.filesModalList, state.filesModal, changedId));
        }
        updateFilesModalCount();
    });
    els.filesPreview?.addEventListener('click', (e) => {
        if (e.target.id === 'files-open-previewed' && state.filesModal.previewId) {
            loadConversation(state.filesModal.previewId, state.filesModal.currentFolder);
            closeFilesModal();
        }
    });

    // Export button
    els.openExportBtn?.addEventListener('click', () => {
        openExportModal();
        closeSidebar();
    });

    // Export Modal
    els.confirmExport?.addEventListener('click', async () => {
        const format = els.exportFormat.value;
        const { systemPrompt, systemPromptMode } = getExportSystemPromptPayload();
        const selectedIds = Array.from(state.export.selectedIds);
        // Fix: zero selected means nothing selected, NOT "export all"
        if (selectedIds.length === 0) {
            toast('Please select at least one conversation to export', 'error');
            return;
        }
        if (exportModeUsesPrompt(systemPromptMode) && typeof systemPrompt === 'string') {
            const ok = await confirmIfUnresolved({
                title: 'Export system prompt contains placeholders',
                context: 'Exports write the system prompt exactly as provided (no macro resolution).',
                resolvedText: systemPrompt
            });
            if (!ok) return;
        }
        exportDataset(format, selectedIds, systemPrompt, systemPromptMode);
        closeExportModal();
    });
    els.cancelExport?.addEventListener('click', closeExportModal);
    els.closeExport?.addEventListener('click', closeExportModal);
    els.previewExport?.addEventListener('click', async () => {
        const format = els.exportFormat.value;
        const { systemPrompt, systemPromptMode } = getExportSystemPromptPayload();
        const selectedIds = Array.from(state.export.selectedIds);
        if (selectedIds.length === 0) {
            toast('Please select at least one conversation to preview', 'error');
            return;
        }
        if (exportModeUsesPrompt(systemPromptMode) && typeof systemPrompt === 'string') {
            const ok = await confirmIfUnresolved({
                title: 'Export system prompt contains placeholders',
                context: 'Exports write the system prompt exactly as provided (no macro resolution).',
                resolvedText: systemPrompt
            });
            if (!ok) return;
        }
        previewExportDataset(format, selectedIds, systemPrompt, systemPromptMode);
    });

    // Export preview modal
    els.closeExportPreviewModal?.addEventListener('click', () => els.exportPreviewModal?.classList.add('hidden'));
    $('#export-preview-modal .modal-backdrop')?.addEventListener('click', () => els.exportPreviewModal?.classList.add('hidden'));
    els.copyExportPreview?.addEventListener('click', () => {
        const text = els.exportPreviewJsonl?.textContent || '';
        if (!text.trim()) return;
        navigator.clipboard.writeText(text).then(() => toast('Copied preview', 'success')).catch(() => toast('Copy failed', 'error'));
    });

    document.querySelectorAll('input[name="export-prompt-source"]').forEach(input => {
        input.addEventListener('change', updateExportPromptState);
    });
    els.exportSystemModeBtn?.addEventListener('click', openExportSystemModeModal);
    els.exportSystemModeCancel?.addEventListener('click', closeExportSystemModeModal);
    els.exportSystemModeApply?.addEventListener('click', applyExportSystemModeFromModal);
    els.closeExportSystemModeModal?.addEventListener('click', closeExportSystemModeModal);
    $('#export-system-mode-modal .modal-backdrop')?.addEventListener('click', closeExportSystemModeModal);
    els.exportFormat?.addEventListener('change', (e) => setLastExportFormat(e.target.value));
    els.exportFolder?.addEventListener('change', async (e) => {
        const next = String(e.target.value || 'wanted') === 'rejected' ? 'rejected' : 'wanted';
        setLastExportFolder(next);
        state.export.folder = next;
        cancelSliceLoadAll(state.export, 'Canceled');
        await loadExportFiles({ reset: true });
        renderExportPreview();
        updateExportCount();
    });

    // Export Presets
    els.exportPresetSelect?.addEventListener('change', loadExportPreset);
    els.saveExportPreset?.addEventListener('click', saveExportPreset);
    els.newExportPreset?.addEventListener('click', newExportPreset);
    els.deleteExportPreset?.addEventListener('click', deleteExportPreset);

    let exportSearchTimer = null;
    els.exportSearchInput?.addEventListener('input', () => {
        cancelSliceLoadAll(state.export, 'Canceled');
        if (exportSearchTimer) clearTimeout(exportSearchTimer);
        const requestSeq = beginSliceRequest(state.export);
        exportSearchTimer = setTimeout(() => loadExportFiles({ reset: true, requestSeq }), LIST_SEARCH_DEBOUNCE_MS);
    });
    els.exportSelectToggle?.addEventListener('click', toggleAllExportFiles);
    els.exportClearSelection?.addEventListener('click', () => {
        clearSelectableSelection(state.export);
        refreshSelectableListUI(els.exportFileList, state.export);
        updateExportCount();
    });
    els.exportLoadAll?.addEventListener('click', () => startLoadAllForSlice({
        slice: state.export,
        title: 'Export: Loading conversations',
        loadNextPage: () => loadExportFiles({ reset: false, signal: state.export.loadAllController?.signal || null }),
        hasMore: () => state.export.hasMore && !state.export.isLoading,
        getProgressDetail: 'Wanted'
    }));
    els.exportFileList?.addEventListener('mousedown', (e) => {
        if (!(e.shiftKey || e.ctrlKey || e.metaKey)) return;
        if (e.target.closest('input, textarea, select, button')) return;
        e.preventDefault();
    });
    els.exportFileList?.addEventListener('click', (e) => {
        const item = e.target.closest('.export-file-item');
        if (!item) return;
        const id = String(item.dataset.id || '');
        const diff = handleSelectableInteraction(state.export, state.export.files, id, e, (previewId) => {
            const requestedId = String(previewId || '');
            fetchConversationPreview(requestedId, state.export.folder)
                .then(conv => {
                    if (state.export.previewId !== requestedId) return;
                    state.export.previewConversation = conv;
                    renderExportPreview();
                })
                .catch(() => toast('Failed to preview conversation', 'error'));
        });
        if (diff?.needsFullRefresh) {
            refreshSelectableListUI(els.exportFileList, state.export);
        } else {
            (diff?.changedSelectionIds || []).forEach(changedId => updateSelectableRowUI(els.exportFileList, state.export, changedId));
            (diff?.changedPreviewIds || []).forEach(changedId => updateSelectableRowUI(els.exportFileList, state.export, changedId));
        }
        updateExportCount();
    });
    $('#export-modal .modal-backdrop')?.addEventListener('click', closeExportModal);

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
    els.newPreset?.addEventListener('click', newPresetAction);
    els.deletePreset?.addEventListener('click', deletePresetAction);

    // Custom Parameters
    els.openCustomParamsBtn?.addEventListener('click', openCustomParamsModal);
    els.closeCustomParamsModal?.addEventListener('click', closeCustomParamsModal);
    $('#custom-params-modal .modal-backdrop')?.addEventListener('click', closeCustomParamsModal);
    els.customParamsSearchInput?.addEventListener('input', renderCustomParamsModalList);
    els.customParamAddBtn?.addEventListener('click', addCustomParam);
    els.customParamKey?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCustomParam(); });
    els.customParamValue?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCustomParam(); });
    els.customParamsModalList?.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.param-remove');
        if (removeBtn?.dataset.key) {
            removeCustomParam(removeBtn.dataset.key);
            return;
        }
        const valueEl = e.target.closest('.param-value');
        if (valueEl?.dataset.key) {
            startEditParam(valueEl.dataset.key, valueEl);
        }
    });

    // Generate
    els.generateBtn.addEventListener('click', generate);
    els.regenerateBtn.addEventListener('click', generate);
    els.bulkCancel?.addEventListener('click', () => {
        if (state.bulk.abortController) state.bulk.abortController.abort();
        state.bulk.pauseRequested = false;
        state.bulk.isPaused = false;
        updateBulkProgress();
    });
    els.bulkDetails?.addEventListener('click', openBulkDetailsModal);
    els.bulkPause?.addEventListener('click', toggleBulkPause);
    els.closeBulkDetailsModal?.addEventListener('click', closeBulkDetailsModal);
    $('#bulk-details-modal .modal-backdrop')?.addEventListener('click', closeBulkDetailsModal);
    els.bulkDetailsClear?.addEventListener('click', async () => {
        const ok = await popupConfirm({
            title: 'Clear Bulk Runs',
            message: 'Clear the bulk runs history?',
            confirmText: 'Clear',
            cancelText: 'Cancel',
            danger: true
        });
        if (!ok) return;
        state.bulk.runs = [];
        state.bulk.selectedRunIndex = null;
        renderBulkDetailsSummary();
        renderBulkDetailsList();
        renderBulkDetailsPreview();
    });
    els.bulkDetailsList?.addEventListener('click', (e) => {
        const item = e.target.closest('.export-file-item');
        if (!item) return;
        const idx = parseInt(item.dataset.index, 10);
        if (!Number.isFinite(idx)) return;
        state.bulk.selectedRunIndex = idx;
        renderBulkDetailsList();
        renderBulkDetailsPreview();
    });

    // Edit toggle
    els.editToggle.addEventListener('click', toggleEditMode);

    // Manual edit listener
    els.conversationEdit.addEventListener('input', () => {
        if (!state.generate.isEditing) return;
        setGenerateRawText(els.conversationEdit.value);
        debouncedSyncGenerateActionButtons();
        debouncedSaveDraft();
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
    els.clearChat.addEventListener('click', () => clearChat());
    els.saveChatBtn.addEventListener('click', saveChat);

    // Chat header tools
    els.chatZoomOut?.addEventListener('click', () => { state.chat.zoomLevel = Math.max(CHAT_ZOOM_MIN, Number(state.chat.zoomLevel) - CHAT_ZOOM_STEP).toFixed(2); applyChatZoom(); saveUiPrefs(); });
    els.chatZoomIn?.addEventListener('click', () => { state.chat.zoomLevel = Math.min(CHAT_ZOOM_MAX, Number(state.chat.zoomLevel) + CHAT_ZOOM_STEP).toFixed(2); applyChatZoom(); saveUiPrefs(); });
    els.chatFullscreen?.addEventListener('click', toggleChatFullscreen);
    els.chatToggleTools?.addEventListener('click', toggleChatTools);

    // Chat Presets
    els.chatPresetSelect?.addEventListener('change', loadChatPreset);
    els.saveChatPreset?.addEventListener('click', saveChatPreset);
    els.newChatPreset?.addEventListener('click', newChatPreset);
    els.deleteChatPreset?.addEventListener('click', deleteChatPreset);

    // Review
    els.reviewPrev?.addEventListener('click', reviewPrev);
    els.reviewNext?.addEventListener('click', reviewNext);
    els.reviewKeepBtn?.addEventListener('click', reviewKeep);
    els.reviewRejectBtn?.addEventListener('click', reviewReject);
    els.reviewEditBtn?.addEventListener('click', reviewEdit);
    els.reviewEditCancelBtn?.addEventListener('click', cancelReviewEdit);
    els.openReviewBrowserBtn?.addEventListener('click', openReviewBrowserModal);
    els.keepAllBtn?.addEventListener('click', keepAllReview);
    els.rejectAllBtn?.addEventListener('click', rejectAllReview);
    els.clearQueueBtn?.addEventListener('click', clearReviewQueue);

    // Review browser modal
    els.closeReviewBrowserModal?.addEventListener('click', closeReviewBrowserModal);
    $('#review-browser-modal .modal-backdrop')?.addEventListener('click', closeReviewBrowserModal);
    let reviewBrowserSearchTimer = null;
    els.reviewBrowserSearchInput?.addEventListener('input', () => {
        cancelSliceLoadAll(state.reviewBrowser, 'Canceled');
        if (reviewBrowserSearchTimer) clearTimeout(reviewBrowserSearchTimer);
        reviewBrowserSearchTimer = setTimeout(() => loadReviewBrowser({ reset: true }), LIST_SEARCH_DEBOUNCE_MS);
    });
    els.reviewBrowserSelectToggle?.addEventListener('click', toggleAllReviewBrowser);
    els.reviewBrowserClearSelection?.addEventListener('click', () => {
        clearSelectableSelection(state.reviewBrowser);
        refreshSelectableListUI(els.reviewBrowserList, state.reviewBrowser);
        updateReviewBrowserCount();
    });
    els.reviewBrowserLoadAll?.addEventListener('click', () => startLoadAllForSlice({
        slice: state.reviewBrowser,
        title: 'Review: Loading queue',
        loadNextPage: () => loadReviewBrowser({ reset: false, signal: state.reviewBrowser.loadAllController?.signal || null }),
        hasMore: () => state.reviewBrowser.hasMore && !state.reviewBrowser.isLoading,
        getProgressDetail: 'Browse queue'
    }));
    els.reviewBrowserBulkKeep?.addEventListener('click', () => handleReviewBrowserBulk('keep'));
    els.reviewBrowserBulkReject?.addEventListener('click', () => handleReviewBrowserBulk('reject'));
    els.reviewBrowserList?.addEventListener('mousedown', (e) => {
        if (!(e.shiftKey || e.ctrlKey || e.metaKey)) return;
        if (e.target.closest('input, textarea, select, button')) return;
        e.preventDefault();
    });
    els.reviewBrowserList?.addEventListener('click', (e) => {
        const item = e.target.closest('.export-file-item');
        if (!item) return;
        const id = String(item.dataset.id || '');
        const diff = handleSelectableInteraction(state.reviewBrowser, state.reviewBrowser.items, id, e, (previewId) => {
            const pid = String(previewId || '');
            loadReviewBrowserPreviewItem(pid);
            jumpReviewToItemId(pid);
        });
        if (diff?.needsFullRefresh) {
            refreshSelectableListUI(els.reviewBrowserList, state.reviewBrowser);
        } else {
            (diff?.changedSelectionIds || []).forEach(changedId => updateSelectableRowUI(els.reviewBrowserList, state.reviewBrowser, changedId));
            (diff?.changedPreviewIds || []).forEach(changedId => updateSelectableRowUI(els.reviewBrowserList, state.reviewBrowser, changedId));
        }
        updateReviewBrowserCount();
    });

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
        toggle.addEventListener('click', () => {
            toggle.parentElement.classList.toggle('collapsed');
            saveUiPrefs();
        });
    });

    // Macros Modal
    els.openMacrosBtn?.addEventListener('click', openMacrosModal);
    els.closeMacrosModal?.addEventListener('click', closeMacrosModal);
    $('#macros-modal .modal-backdrop')?.addEventListener('click', closeMacrosModal);
    $('#exported-datasets-modal .modal-backdrop')?.addEventListener('click', closeExportedDatasetsModal);
    els.viewExportedDatasetsBtn?.addEventListener('click', openExportedDatasetsModal);
    els.closeExportedDatasetsModal?.addEventListener('click', closeExportedDatasetsModal);
    els.exportedDatasetsSearchInput?.addEventListener('input', renderExportedDatasets);
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
    els.resetMacrosBtn?.addEventListener('click', resetMacros);

    // History
    els.openHistoryBtn?.addEventListener('click', () => { openMacrosModal(); switchMacrosTab('history'); });
    els.previewResolvedBtn?.addEventListener('click', () => {
        openPromptPreviewModal();
    });
    els.closePromptPreviewModal?.addEventListener('click', closePromptPreviewModal);
    $('#prompt-preview-modal .modal-backdrop')?.addEventListener('click', closePromptPreviewModal);
    els.promptPreviewClose?.addEventListener('click', closePromptPreviewModal);
    els.promptPreviewCopy?.addEventListener('click', () => {
        const text = String(state.promptPreview?.text || els.promptPreviewText?.textContent || '');
        if (!text.trim()) return;
        navigator.clipboard.writeText(text).then(() => toast('Copied prompt preview', 'success')).catch(() => toast('Copy failed', 'error'));
    });
    els.promptPreviewCopyTrace?.addEventListener('click', () => {
        const trace = state.promptPreview?.trace || null;
        const text = trace ? JSON.stringify(trace, null, 2) : '';
        if (!text.trim()) return;
        navigator.clipboard.writeText(text).then(() => toast('Copied trace', 'success')).catch(() => toast('Copy failed', 'error'));
    });
    els.clearHistoryBtn?.addEventListener('click', clearPromptHistory);
    els.historyMaxSetting?.addEventListener('change', () => {
        const max = getHistoryMax();
        if (state.promptHistory.length > max) { state.promptHistory.length = max; dbSet('settings', 'promptHistory', state.promptHistory).catch(() => { }); }
    });
    els.maxOutputTokens?.addEventListener('change', saveDefaultMaxTokens);
    els.maxOutputTokens?.addEventListener('input', debouncedSaveDraft);

    // Advanced UI settings
    els.virtualListEnabled?.addEventListener('change', () => {
        state.uiPrefs.virtualListEnabled = !!els.virtualListEnabled.checked;
        saveUiPrefs();
        applyVirtualPrefs();
        renderFilesModalList();
        renderExportFileList();
        renderReviewBrowserList();
    });
    els.virtualBatchSize?.addEventListener('change', () => {
        state.uiPrefs.virtualBatchSize = clampNumber(els.virtualBatchSize.value, { min: 50, max: 2000, fallback: 200 });
        saveUiPrefs();
        applyVirtualPrefs();
        renderFilesModalList();
        renderExportFileList();
        renderReviewBrowserList();
    });
    els.virtualMaxBatches?.addEventListener('change', () => {
        state.uiPrefs.virtualMaxBatches = clampNumber(els.virtualMaxBatches.value, { min: 1, max: 20, fallback: 3 });
        saveUiPrefs();
        applyVirtualPrefs();
        renderFilesModalList();
        renderExportFileList();
        renderReviewBrowserList();
    });
    els.autoLoadOnScroll?.addEventListener('change', () => {
        state.uiPrefs.autoLoadOnScroll = !!els.autoLoadOnScroll.checked;
        saveUiPrefs();
        applyVirtualPrefs();
    });
    els.modalPageSize?.addEventListener('change', () => {
        state.uiPrefs.modalPageSize = clampNumber(els.modalPageSize.value, { min: 50, max: 2000, fallback: MODAL_PAGE_SIZE });
        saveUiPrefs();
    });

    // Virtual list scroll handlers (renders window + auto-load)
    setupVirtualListScroll({ slice: state.filesModal, container: els.filesModalList, render: renderFilesModalList, loadMore: loadMoreFilesModal });
    setupVirtualListScroll({ slice: state.export, container: els.exportFileList, render: renderExportFileList, loadMore: loadMoreExportFiles });
    setupVirtualListScroll({ slice: state.reviewBrowser, container: els.reviewBrowserList, render: renderReviewBrowserList, loadMore: loadMoreReviewBrowser });

    // Setup advanced features
    setupSwipeGestures();
    setupKeyboardShortcuts();
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', init);


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
            state.exportedDatasets = data.files || [];
            renderExportedDatasets();
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

function renderExportedDatasets() {
    const listEl = els.exportedDatasetsList;
    if (!listEl) return;
    const search = els.exportedDatasetsSearchInput?.value?.trim().toLowerCase() || '';
    const files = state.exportedDatasets.filter(file =>
        !search ||
        file.name.toLowerCase().includes(search) ||
        file.format.toLowerCase().includes(search)
    );
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
            const newName = await popupPrompt({
                title: 'Rename Export',
                message: 'Enter a new filename (must end in .jsonl).',
                label: 'Filename',
                value: file.name,
                placeholder: 'e.g. my_dataset.jsonl',
                confirmText: 'Rename',
                required: true,
                hint: 'Tip: keep the .jsonl extension.'
            });
            if (!newName || newName === file.name) return;
            if (!newName.endsWith('.jsonl')) {
                toast('Filename must end with .jsonl', 'error');
                return;
            }
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
            const ok = await popupConfirm({
                title: 'Delete Export',
                message: `Delete ${file.name}?`,
                confirmText: 'Delete',
                cancelText: 'Cancel',
                danger: true
            });
            if (!ok) return;
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
