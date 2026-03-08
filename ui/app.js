
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
const hydratedFields = { model: false, temperature: false };

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
    askRejectReason: true
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
    syncSettings.askRejectReason = el('ask-reject-reason')?.checked ?? true;
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
        const saved = await dbGet('settings', UI_PREFS_KEY);
        if (!saved) return;
        state.uiPrefs = { ...state.uiPrefs, ...saved };
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
    dbSet('settings', UI_PREFS_KEY, state.uiPrefs).catch(() => { });
}

function clampNumber(val, { min = -Infinity, max = Infinity, fallback = 0 } = {}) {
    const num = Number(val);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, num));
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
        selectedIds: new Set(),
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
        loadAllController: null
    },
	    export: {
        selectedIds: new Set(),
        anchorId: null,
        previewId: null,
        previewConversation: null,
        files: [],
        systemPrompt: '',
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
        loadAllController: null
    },
    exportedDatasets: [],
    review: {
        queue: [],
        currentIndex: 0,
        isEditing: false,
        offset: 0,
        total: 0,
        hasMore: false,
        isLoading: false
    },
	    reviewBrowser: {
        items: [],
        selectedIds: new Set(),
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
        loadAllController: null
    },
    bulk: {
        isRunning: false,
        total: 0,
        completed: 0,
        abortController: null
    },
    tags: [],
    customParams: {},
    promptHistory: [], // array of {text, timestamp}
    tasks: {
        nextId: 1,
        items: new Map()
    },
    uiPrefs: {
        currentTab: 'generate',
        chatZoom: 1,
        showAllTools: false,
        chatPromptCollapsed: true,
        settingsSearch: '',
        lastExportFormat: 'sharegpt',
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
        cards.forEach(card => card.remove());
        cards.clear();
        els.taskTracker.innerHTML = '';
        return;
    }

    const activeIds = new Set(tasks.map(t => t.id));
    for (const [id, card] of cards.entries()) {
        if (!activeIds.has(id)) {
            card.remove();
            cards.delete(id);
        }
    }

    for (const task of tasks) {
        let card = cards.get(task.id);
        if (!card) {
            card = buildTaskCard(task.id);
            cards.set(task.id, card);
            els.taskTracker.appendChild(card);
        } else {
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
    const controller = new AbortController();
    slice.loadAllController = controller;
    slice.isLoadAllRunning = true;
    const taskId = createTask({
        title,
        detail: typeof getProgressDetail === 'function' ? (getProgressDetail() || '') : (getProgressDetail || ''),
        onCancel: () => controller.abort()
    });
    slice.loadAllTaskId = taskId;

    const pushProgress = () => {
        const total = slice.total || 0;
        const loaded = Array.isArray(slice.files) ? slice.files.length
            : Array.isArray(slice.items) ? slice.items.length
                : Array.isArray(slice.queue) ? slice.queue.length
                    : (slice.offset || 0);
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
            pushProgress();
            finishTask(taskId, { status: 'done', detail: 'Done' });
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
        filesSelectToggle: $('#files-select-toggle'),
        filesClearSelection: $('#files-clear-selection'),
        filesSelectionChip: $('#files-selection-chip'),
        filesLoadAll: $('#files-load-all'),
        filesPreview: $('#files-preview'),
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
        exportFormat: $('#export-format'),
        exportPromptSourceCustom: $('#export-prompt-source-custom'),
        exportPromptSourceChat: $('#export-prompt-source-chat'),
        exportPromptSourceGenerate: $('#export-prompt-source-generate'),
        exportCustomPromptGroup: $('#export-custom-prompt-group'),
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
        exportLoadMore: $('#export-load-more'),
        exportPaginationStatus: $('#export-pagination-status'),
        closeExport: $('#close-export'),
        confirmExport: $('#confirm-export'),
        cancelExport: $('#cancel-export'),
        filesLoadMore: $('#files-load-more'),
        filesPaginationStatus: $('#files-pagination-status'),

        // Toast
        toastContainer: $('#toast-container'),
        taskTracker: $('#task-tracker'),

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
        reviewBrowserLoadMore: $('#review-browser-load-more'),
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
        ,
        // Advanced settings
        virtualListEnabled: $('#virtual-list-enabled'),
        virtualBatchSize: $('#virtual-batch-size'),
        virtualMaxBatches: $('#virtual-max-batches'),
        autoLoadOnScroll: $('#auto-load-on-scroll')
    };

    // Initialize sync engine
    syncEngine.init();
    await loadSyncSettings();
    await loadHotkeys();
    await loadUiPrefs();
    applyVirtualPrefs();
    updateSidebarExportButton();
    await restoreDraft();

    // Load data
    await loadConfig();
    await loadPrompts();
    await loadStats();
    await loadModels();
    await loadPresets();
    await loadChatPresets();
    await loadExportPresets();
    await loadReviewQueue();
    await loadPromptHistory();

    setupEventListeners();
    applyHotkeysToUI();
    setupAutoSaveTimer();
    syncEngine.startAutoSync();
    switchTab(state.uiPrefs.currentTab || state.currentTab);

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
            populateModelSelect(data.models);
        }
    } catch (e) { console.error('Failed to load models:', e); }
}

function populateModelSelect(models) {
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
}

function getModelValue() {
    return els.modelInput?.value?.trim() || els.model.value || '';
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
            const data = await res.json();
            // Use the sanitized name from server, not the raw client name
            state.currentPromptName = data.name || name;
            await loadPrompts();
            toast('Prompt saved!', 'success');
        }
    } catch (e) { toast('Failed to save prompt', 'error'); }
}

async function newPrompt() {
    const name = prompt('New prompt template name:');
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
            if (els.presetSelect) {
                els.presetSelect.value = name;
                state.presetName = name;
                debouncedSaveDraft();
            }
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
    const params = state.customParams || {};
    const keys = Object.keys(params);
    if (els.customParamsList) {
        els.customParamsList.innerHTML = keys.length === 0
            ? '<div class="empty-params">No custom parameters added</div>'
            : keys.map(key => `
                <div class="custom-param-item" data-key="${escapeHtml(key)}">
                    <span class="param-key">${escapeHtml(key)}</span>
                    <span class="param-value">${escapeHtml(String(params[key]))}</span>
                </div>
            `).join('');
    }

    if (!els.customParamsModalList) return;
    const search = els.customParamsSearchInput?.value?.trim().toLowerCase() || '';
    const filteredKeys = keys.filter(key =>
        !search ||
        key.toLowerCase().includes(search) ||
        String(params[key]).toLowerCase().includes(search)
    );

    if (filteredKeys.length === 0) {
        els.customParamsModalList.innerHTML = '<div class="empty-params">No matching parameters</div>';
        return;
    }

    els.customParamsModalList.innerHTML = filteredKeys.map(key => `
        <div class="custom-param-item" data-key="${escapeHtml(key)}">
            <span class="param-key">${escapeHtml(key)}</span>
            <span class="param-value" data-key="${escapeHtml(key)}" title="Click to edit">${escapeHtml(String(params[key]))}</span>
            <button class="icon-btn param-remove" data-key="${escapeHtml(key)}" title="Remove">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
    `).join('');
    els.customParamsModalList.querySelectorAll('.param-remove').forEach(btn => {
        btn.addEventListener('click', () => removeCustomParam(btn.dataset.key));
    });
    els.customParamsModalList.querySelectorAll('.param-value').forEach(span => {
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
    selectEl.innerHTML = '<option value="">Load preset...</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name; opt.textContent = p.name;
        opt.dataset.prompt = p.prompt;
        selectEl.appendChild(opt);
    });
}

function loadSystemPreset(type) {
    const selectEl = els[`${type}PresetSelect`];
    const targetEl = els[`${type}SystemPrompt`];
    const selected = selectEl.selectedOptions[0];

    if (selected && selected.dataset.prompt) {
        targetEl.value = selected.dataset.prompt;
        if (state[type]) state[type].systemPrompt = selected.dataset.prompt;
        debouncedSaveDraft();
        toast('Preset loaded!', 'success');
    }
}

async function saveSystemPreset(type) {
    const selectEl = els[`${type}PresetSelect`];
    const targetEl = els[`${type}SystemPrompt`];
    let name = selectEl?.value;

    if (!name) {
        name = prompt('Preset name:');
        if (!name) return;
    }

    const promptText = targetEl?.value || '';
    try {
        const res = await fetch(`/api/${type}-presets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, prompt: promptText })
        });
        if (res.ok) {
            const data = await res.json();
            renderSystemPresetSelect(type, data.presets || []);
            if (selectEl) {
                selectEl.value = name;
                loadSystemPreset(type);
            }
            toast(`${type === 'chat' ? 'Chat' : 'Export'} preset saved!`, 'success');
        }
    } catch (e) { toast('Failed to save preset', 'error'); }
}

async function newSystemPreset(type) {
    const name = prompt('New preset name:');
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
    if (!confirm(`Delete preset "${selected}"?`)) return;

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
    if (chip) chip.classList.toggle('hidden', selectedCount === 0);
    if (toggleButton) {
        const shouldClear = selectedCount > 0;
        toggleButton.textContent = shouldClear ? 'Clear Selection' : 'Select All';
        toggleButton.classList.toggle('btn-danger', shouldClear);
        toggleButton.classList.toggle('btn-secondary', !shouldClear);
    }
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

function getSliceIndex(slice, items, id) {
    if (slice?.idToIndex && typeof slice.idToIndex.get === 'function') {
        const idx = slice.idToIndex.get(id);
        if (typeof idx === 'number') return idx;
    }
    return items.findIndex(item => item.id === id);
}

function handleSelectableInteraction(slice, items, id, event, onPreview) {
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
            if (rangeId) slice.selectedIds.add(rangeId);
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
    if (els.filesLoadMore) {
        els.filesLoadMore.classList.toggle('hidden', !state.filesModal.hasMore);
        els.filesLoadMore.disabled = state.filesModal.isLoading;
    }
}

async function loadFilesModal(folder = 'wanted', { reset = false, signal = null } = {}) {
    state.filesModal.currentFolder = folder;
    const search = els.filesSearchInput?.value?.trim() || '';
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
            limit: String(MODAL_PAGE_SIZE),
            offset: String(state.filesModal.offset)
        });
        if (search) params.set('search', search);
        const url = `/api/conversations?${params.toString()}`;
        const res = await fetch(url, signal ? { signal } : undefined);
        if (res.ok) {
            const data = await res.json();
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
            if (!els.filesModal?.classList.contains('hidden')) {
                renderFilesModalList();
            }
        }

        if (!els.filesModal?.classList.contains('hidden')) {
            updateFilesModalCount();
            if (reset) renderFilesPreview();
            updateFilesPaginationUI();
        }
    } catch (e) {
        if (e?.name === 'AbortError') aborted = true;
        else console.error('Failed to load files:', e);
    } finally {
        state.filesModal.isLoading = false;
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
    updateSelectionToolbar({
        selectedIds: state.filesModal.selectedIds,
        files: state.filesModal.files,
        toggleButton: els.filesSelectToggle,
        chip: els.filesSelectionChip,
        countEl: els.filesModalCount
    });
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

    renderVirtualWindow({
        slice: state.filesModal,
        container: els.filesModalList,
        items: state.filesModal.files,
        renderRowHtml: renderFilesRowHtml
    });
    updateFilesPaginationUI();
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
            const data = await res.json();
            const movedCount = Array.isArray(data.moved) ? data.moved.length : 0;
            const toastType = movedCount === ids.length ? 'success' : 'warning';
            toast(`Moved ${movedCount}/${ids.length} items to ${to}`, toastType);
            clearSelectableSelection(state.filesModal);
            loadFilesModal(from, { reset: true });
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
            const data = await res.json();
            const deletedCount = Array.isArray(data.deleted) ? data.deleted.length : 0;
            const toastType = deletedCount === ids.length ? 'success' : 'warning';
            toast(`Deleted ${deletedCount}/${ids.length} items`, toastType);
            clearSelectableSelection(state.filesModal);
            loadFilesModal(folder, { reset: true });
            loadStats();
        } else { toast('Failed to delete', 'error'); }
    } catch (e) { toast('Failed to delete', 'error'); }
    hideSaveIndicator('Deleted');
}

async function loadConversation(id, folder) {
    try {
        const res = await fetch(`/api/conversation/${encodeURIComponent(id)}?folder=${encodeURIComponent(folder)}`);
        if (res.ok) {
            const conv = await res.json();
            state.generate.conversation = conv;
            state.generate.rawText = conversationToRaw(conv.conversations);
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
        let fullText = '';
        let thinkingShown = true;
        els.conversationView.innerHTML = '<div class="thinking-indicator"><div class="thinking-dots"><span></span><span></span><span></span></div> Thinking...</div><div class="streaming-text" style="display:none;"></div>';
        const thinkingEl = els.conversationView.querySelector('.thinking-indicator');
        const streamingEl = els.conversationView.querySelector('.streaming-text');

        await readSSEStream(reader, async (data) => {
            if (data.content) {
                if (thinkingShown) { thinkingEl.style.display = 'none'; streamingEl.style.display = ''; thinkingShown = false; }
                fullText += data.content;
                streamingEl.textContent = fullText;
            }
            if (data.error) throw new Error(data.error);
        });

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
        } else {
            state.generate.rawText = extractedText;
            els.conversationEdit.value = extractedText;
            parseAndRender();
            enableActionButtons();
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
    const generatedItems = [];
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
                        generatedItems.push({
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
    if (generatedItems.length > 0) {
        await addReviewQueueItems(generatedItems);
    }
    toast(`Generated ${state.bulk.completed}/${count} conversations`, 'success');
    updateReviewBadge();
    if (state.bulk.completed > 0) switchTab('review');
}

function updateBulkProgress() {
    const pct = state.bulk.total > 0 ? (state.bulk.completed / state.bulk.total * 100) : 0;
    if (els.bulkProgressFill) els.bulkProgressFill.style.width = pct + '%';
    if (els.bulkProgressText) els.bulkProgressText.textContent = `${state.bulk.completed}/${state.bulk.total}`;
}

function parseAndRender() {
    // Force parse from edit buffer if editing
    if (state.generate.isEditing) {
        state.generate.rawText = els.conversationEdit.value;
    }
    const parsed = parseMinimalFormat(state.generate.rawText);
    state.generate.conversation = { conversations: parsed };
    renderConversation(parsed);
    updateTurnCount(countConversationTurns(parsed));
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
        } else {
            toast('Failed to save', 'error');
            hideSaveIndicator('Save failed');
        }
    } catch (e) { toast('Failed to save', 'error'); hideSaveIndicator('Save failed'); }
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
    state.generate.rawText = '';
    els.conversationEdit.value = '';
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
        let fullText = '';
        state.chat.messages.push(streamingMsg);
        renderChatMessages();

        await readSSEStream(reader, async (data) => {
            if (data.error) throw new Error(data.error);
            if (data.done) return;
            if (data.content) {
                fullText += data.content;
                streamingMsg.value = fullText;
                throttledRenderChat();
            }
        });
        streamingMsg.streaming = false;
        renderChatMessages();
        updateChatTurns();
        enableChatButtons();
    } catch (e) {
        if (e.name !== 'AbortError') {
            toast(e.message || 'Failed to send message', 'error');
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
        let fullText = '';

        await readSSEStream(reader, async (data) => {
            if (data.error) throw new Error(data.error);
            if (data.done) return;
            if (data.content) {
                fullText += data.content;
                streamingMsg.value = fullText;
                throttledRenderChat();
            }
        });
        streamingMsg.streaming = false;
        renderChatMessages();
        updateChatTurns();
        enableChatButtons();
    } catch (e) {
        if (e.name !== 'AbortError') {
            toast(e.message || 'Failed to generate response', 'error');
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
function createLocalReviewEntry(item) {
    return {
        id: 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2),
        conversations: item.conversations,
        rawText: item.rawText,
        metadata: item.metadata || {},
        createdAt: new Date().toISOString()
    };
}

function appendReviewQueueEntries(entries) {
    if (!entries.length) return;
    const hadMore = state.review.hasMore;
    state.review.queue.push(...entries);
    state.review.total = (state.review.total || 0) + entries.length;
    if (!hadMore) {
        state.review.offset += entries.length;
    }
    state.review.hasMore = state.review.offset < state.review.total;
}

async function addReviewQueueItems(items) {
    if (!items.length) return [];
    try {
        const res = await fetch('/api/review-queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items })
        });
        if (!res.ok) throw new Error('Failed to add review items');
        const data = await res.json();
        const added = data.added || [];
        appendReviewQueueEntries(added);
        if (typeof data.count === 'number') {
            state.review.total = data.count;
            state.review.hasMore = state.review.offset < state.review.total;
        }
        updateReviewBadge();
        renderReviewItem();
        return added;
    } catch (e) {
        const localEntries = items.map(createLocalReviewEntry);
        appendReviewQueueEntries(localEntries);
        for (const entry of localEntries) {
            try { await dbPut('reviewQueue', entry); } catch (_err) { }
        }
        console.error('Failed to add to server review queue, saved locally:', e);
        updateReviewBadge();
        renderReviewItem();
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

    const localItems = await dbGetAll('reviewQueue');
    const mergedLocalItems = new Map((localItems || []).map(item => [String(item.id), item]));
    [...state.review.queue, ...state.reviewBrowser.items].forEach(item => {
        if (item?.id && String(item.id).startsWith('local-') && !mergedLocalItems.has(String(item.id))) {
            mergedLocalItems.set(String(item.id), item);
        }
    });

    const pendingItems = Array.from(mergedLocalItems.values()).filter(item =>
        String(item.id).startsWith('local-') &&
        (!requestedIds || requestedIds.has(String(item.id)))
    );

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

async function loadReviewQueue({ reset = true, targetIndex = null } = {}) {
    const currentItemId = state.review.queue[state.review.currentIndex]?.id;
    if (reset) {
        state.review.queue = [];
        state.review.offset = 0;
        state.review.total = 0;
        state.review.hasMore = false;
    }
    state.review.isLoading = true;
    try {
        await syncReviewQueueItemsToServer();
        const params = new URLSearchParams({
            limit: String(MODAL_PAGE_SIZE),
            offset: String(reset ? 0 : state.review.offset)
        });
        const res = await fetch(`/api/review-queue?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to load review queue');

        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const items = data.queue || [];
        const start = reset ? 0 : state.review.offset;
        state.review.queue = reset ? items : mergeReviewQueuePage(state.review.queue, items, start);
        state.review.total = data.count || state.review.queue.length;
        state.review.offset = start + items.length;
        state.review.hasMore = state.review.offset < state.review.total;

        if (typeof targetIndex === 'number') {
            state.review.currentIndex = Math.max(0, Math.min(targetIndex, state.review.queue.length - 1));
        } else if (currentItemId) {
            const nextIndex = state.review.queue.findIndex(item => item.id === currentItemId);
            state.review.currentIndex = nextIndex === -1 ? Math.min(state.review.currentIndex, Math.max(0, state.review.queue.length - 1)) : nextIndex;
        } else {
            state.review.currentIndex = Math.min(state.review.currentIndex, Math.max(0, state.review.queue.length - 1));
        }

        updateReviewBadge();
        renderReviewItem();
    } catch (e) {
        console.warn('Server unreachable, loading review queue from IndexedDB');
        // Fallback to IndexedDB
        try {
            const items = await dbGetAll('reviewQueue');
            const allItems = items || [];
            const start = reset ? 0 : state.review.offset;
            const nextItems = allItems.slice(start, start + MODAL_PAGE_SIZE);
            state.review.queue = reset ? nextItems : mergeReviewQueuePage(state.review.queue, nextItems, start);
            state.review.total = allItems.length;
            state.review.offset = start + nextItems.length;
            state.review.hasMore = state.review.offset < state.review.total;
            if (typeof targetIndex === 'number') {
                state.review.currentIndex = Math.max(0, Math.min(targetIndex, state.review.queue.length - 1));
            } else {
                state.review.currentIndex = Math.min(state.review.currentIndex, Math.max(0, state.review.queue.length - 1));
            }
            updateReviewBadge();
            renderReviewItem();
        } catch (err) {
            console.error('Failed to load review queue:', err);
        }
    } finally {
        state.review.isLoading = false;
    }
}

function getLoadedReviewCount() {
    return state.review.hasMore ? Math.min(state.review.offset, state.review.queue.length) : state.review.queue.length;
}

function updateReviewBadge() {
    const count = state.review.total || state.review.queue.length;
    if (els.reviewBadge) {
        els.reviewBadge.textContent = count;
        els.reviewBadge.classList.toggle('hidden', count === 0);
    }
    if (els.reviewCount) {
        const loaded = getLoadedReviewCount();
        els.reviewCount.textContent = count > loaded ? `${count} items (${loaded} loaded)` : `${count} items`;
    }
}

function renderReviewItem() {
    const queue = state.review.queue;
    const idx = state.review.currentIndex;

    if (queue.length === 0) {
        els.reviewConversation.innerHTML = `<div class="empty-state"><div class="empty-icon">${ICON_EMPTY_QUEUE}</div><p>No items in review queue</p><p class="small">Generate conversations in bulk to fill the queue</p></div>`;
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
    els.reviewConversation.innerHTML = renderConversationMarkup(item.conversations || []);
    els.reviewConversation.scrollTop = 0;
    els.reviewEditInput.value = item.rawText || conversationToRaw(item.conversations || []);
    els.reviewConversation.classList.toggle('hidden', state.review.isEditing);
    els.reviewEditInput.classList.toggle('hidden', !state.review.isEditing);
    els.reviewEditCancelBtn.classList.toggle('hidden', !state.review.isEditing);

    els.reviewKeepBtn.disabled = false;
    els.reviewRejectBtn.disabled = false;
    els.reviewEditBtn.disabled = false;
    els.reviewPrev.disabled = idx <= 0;
    els.reviewNext.disabled = idx >= getLoadedReviewCount() - 1 && !state.review.hasMore;
    const total = state.review.total || queue.length;
    els.reviewPosition.textContent = `${idx + 1}/${total}`;
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
            await fetch(`/api/review-queue/${encodeURIComponent(item.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    conversations,
                    raw_text: rawText,
                    metadata: item.metadata || {}
                })
            });
        }
    } catch (e) {
        console.warn('Failed to persist inline review edit:', e);
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
    const loadedCount = getLoadedReviewCount();
    if (state.review.currentIndex < loadedCount - 1) {
        state.review.currentIndex++;
        renderReviewItem();
        return;
    }
    if (state.review.hasMore && !state.review.isLoading) {
        await loadReviewQueue({ reset: false, targetIndex: loadedCount });
    }
}

async function reviewPrev() {
    if (!(await persistCurrentReviewEdits())) return;
    if (state.review.currentIndex > 0) {
        state.review.currentIndex--;
        renderReviewItem();
    }
}

async function reviewKeep() {
    const item = state.review.queue[state.review.currentIndex];
    if (!item) return;
    if (!(await persistCurrentReviewEdits())) return;
    showSaveIndicator('Saving...');
    try {
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
            const removedIndex = state.review.currentIndex;
            removeReviewQueueEntryAt(removedIndex, { removedFromServer: !String(item.id).startsWith('local-') });
            state.review.total = typeof data.count === 'number' ? data.count : state.review.total;
            state.review.hasMore = state.review.offset < state.review.total;
            if (state.review.hasMore && state.review.currentIndex >= getLoadedReviewCount()) {
                await loadReviewQueue({ reset: false, targetIndex: state.review.currentIndex });
            } else {
                renderReviewItem();
            }
            toast('Kept!', 'success');
            hideSaveIndicator('Saved ✓');
            loadStats();
        }
    } catch (e) { toast('Failed to save', 'error'); hideSaveIndicator('Save failed'); }
}

async function reviewReject() {
    const item = state.review.queue[state.review.currentIndex];
    if (!item) return;
    if (!(await persistCurrentReviewEdits())) return;
    showSaveIndicator('Rejecting...');
    try {
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
            const removedIndex = state.review.currentIndex;
            removeReviewQueueEntryAt(removedIndex, { removedFromServer: !String(item.id).startsWith('local-') });
            state.review.total = typeof data.count === 'number' ? data.count : state.review.total;
            state.review.hasMore = state.review.offset < state.review.total;
            if (state.review.hasMore && state.review.currentIndex >= getLoadedReviewCount()) {
                await loadReviewQueue({ reset: false, targetIndex: state.review.currentIndex });
            } else {
                renderReviewItem();
            }
            toast('Rejected', 'info');
            hideSaveIndicator('Rejected ✓');
            loadStats();
        } else {
            toast('Failed to reject', 'error'); hideSaveIndicator('Reject failed');
        }
    } catch (e) { toast('Failed to reject', 'error'); hideSaveIndicator('Reject failed'); }
}

function removeReviewQueueEntryAt(idx, { removedFromServer = true } = {}) {
    const removed = state.review.queue[idx];
    if (!removed) return null;

    state.review.queue.splice(idx, 1);
    state.review.total = Math.max(0, (state.review.total || state.review.queue.length + 1) - 1);
    if (removedFromServer && idx < state.review.offset) {
        state.review.offset = Math.max(0, state.review.offset - 1);
    }
    state.review.hasMore = state.review.offset < state.review.total;
    if (state.review.currentIndex >= state.review.queue.length && state.review.currentIndex > 0) {
        state.review.currentIndex--;
    }
    state.review.isEditing = false;
    updateReviewBadge();
    return removed;
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
    removeReviewQueueEntryAt(idx, { removedFromServer: !!item && !String(item.id).startsWith('local-') });
    renderReviewItem();
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

    if (!confirm(`${verb} all ${count} conversations?`)) return;
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

        const batchLimit = 200; // server caps the review queue page size at 200
        let processed = 0;
        let total = null;
        let lastRemaining = null;
        let stagnant = 0;

        while (!controller.signal.aborted) {
            const idsRes = await fetch(`/api/review-queue?limit=${batchLimit}&offset=0&ids_only=1`, { signal: controller.signal });
            if (!idsRes.ok) throw new Error('Failed to fetch queue ids');
            const idsData = await idsRes.json().catch(() => ({}));

            if (total === null && typeof idsData.count === 'number') total = idsData.count;
            const ids = Array.isArray(idsData.ids) ? idsData.ids : [];
            if (ids.length === 0) break;

            updateTask(taskId, {
                detail: `Queue -> ${targetLabel}`,
                current: total ? Math.min(processed, total) : null,
                total: total || null,
                indeterminate: !total
            });

            const persistRes = await fetch(`/api/review-queue/bulk-${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids }),
                signal: controller.signal
            });
            if (!persistRes.ok) throw new Error(`Bulk ${action} failed`);
            const persistData = await persistRes.json().catch(() => ({}));

            const savedCount = typeof persistData.saved_count === 'number' ? persistData.saved_count : ids.length;
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
                detail: `Queue -> ${targetLabel}`,
                current: total ? Math.min(processed, total) : null,
                total: total || null,
                indeterminate: !total
            });

            // Yield so the UI stays responsive.
            await new Promise(resolve => requestAnimationFrame(() => resolve()));
        }

        if (controller.signal.aborted) {
            toast(`${verb} canceled`, 'info');
            hideSaveIndicator('Canceled');
            finishTask(taskId, { status: 'canceled', detail: 'Canceled' });
            return;
        }

        await loadReviewQueue({ reset: true, targetIndex: 0 });
        loadStats();
        hideSaveIndicator(isKeep ? 'Saved ✓' : 'Rejected ✓');
        toast(isKeep ? `Saved ${processed} conversations` : `Rejected ${processed} conversations`, isKeep ? 'success' : 'info');
        finishTask(taskId, { status: 'done', detail: isKeep ? `Saved ${processed}` : `Rejected ${processed}` });
    } catch (e) {
        if (e?.name === 'AbortError' || controller.signal.aborted) {
            toast(`${verb} canceled`, 'info');
            hideSaveIndicator('Canceled');
            finishTask(taskId, { status: 'canceled', detail: 'Canceled' });
            return;
        }
        console.error(`Bulk ${action} failed:`, e);
        toast(`Bulk ${action} failed`, 'error');
        hideSaveIndicator('Failed');
        finishTask(taskId, { status: 'error', detail: 'Failed' });
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
    if (!confirm(`Discard all ${count} conversations from the queue? This will NOT save them anywhere.`)) return;
    showSaveIndicator('Clearing...');
    try {
        await fetch('/api/review-queue', { method: 'DELETE' });
        await dbClear('reviewQueue');
        state.review.queue = [];
        state.review.currentIndex = 0;
        state.review.offset = 0;
        state.review.total = 0;
        state.review.hasMore = false;
        updateReviewBadge();
        renderReviewItem();
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
    const shouldReset = !hasActiveLoadAll && state.reviewBrowser.items.length === 0;
    if (shouldReset) loadReviewBrowser({ reset: true });
    else { renderReviewBrowserList(); renderReviewBrowserPreview(); updateReviewBrowserPaginationUI(); }
}

function closeReviewBrowserModal() {
    els.reviewBrowserModal.classList.add('hidden');
}

function updateReviewBrowserPaginationUI() {
    if (els.reviewBrowserPaginationStatus) {
        const loaded = Math.min(state.reviewBrowser.offset, state.reviewBrowser.items.length);
        const total = state.reviewBrowser.total || 0;
        els.reviewBrowserPaginationStatus.textContent = total > 0 ? `Showing ${loaded} of ${total}` : '';
    }
    if (els.reviewBrowserLoadMore) {
        els.reviewBrowserLoadMore.classList.toggle('hidden', !state.reviewBrowser.hasMore);
        els.reviewBrowserLoadMore.disabled = state.reviewBrowser.isLoading;
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
        els.reviewBrowserPreview.innerHTML = '<div class="empty-files">Click a queue item to load it into the review tab</div>';
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
    const firstMsg = item.conversations?.find(msg => msg.from === 'human') || item.conversations?.[0];
    const preview = firstMsg?.value || 'Empty conversation';
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

async function loadReviewBrowser({ reset = false, signal = null } = {}) {
    if (reset) {
        state.reviewBrowser.items = [];
        clearSelectableSelection(state.reviewBrowser);
        state.reviewBrowser.offset = 0;
        state.reviewBrowser.total = 0;
        state.reviewBrowser.hasMore = false;
        state.reviewBrowser.renderedCount = 0;
        state.reviewBrowser.seenIds.clear();
        state.reviewBrowser.idToIndex.clear();
        if (els.reviewBrowserList) els.reviewBrowserList.innerHTML = '';
    }

    state.reviewBrowser.isLoading = true;
    if (!els.reviewBrowserModal?.classList.contains('hidden')) {
        // Show immediate feedback (spinner / "Loading...") and ensure virtual loading row state is correct.
        renderReviewBrowserList();
        updateReviewBrowserPaginationUI();
    }
    try {
        const params = new URLSearchParams({
            limit: String(MODAL_PAGE_SIZE),
            offset: String(state.reviewBrowser.offset)
        });
        const search = els.reviewBrowserSearchInput?.value?.trim() || '';
        if (search) params.set('search', search);
        const res = await fetch(`/api/review-queue?${params.toString()}`, signal ? { signal } : undefined);
        if (!res.ok) throw new Error('Failed to load review browser');
        const data = await res.json();
        const items = data.queue || [];
        for (const item of items) {
            const itemId = item?.id;
            if (!itemId || state.reviewBrowser.seenIds.has(itemId)) continue;
            state.reviewBrowser.seenIds.add(itemId);
            state.reviewBrowser.idToIndex.set(itemId, state.reviewBrowser.items.length);
            state.reviewBrowser.items.push(item);
        }
        state.reviewBrowser.total = data.count || state.reviewBrowser.items.length;
        state.reviewBrowser.offset += items.length;
        if (items.length === 0) state.reviewBrowser.hasMore = false;
        else state.reviewBrowser.hasMore = state.reviewBrowser.offset < state.reviewBrowser.total;
        if (!els.reviewBrowserModal?.classList.contains('hidden')) {
            renderReviewBrowserList();
        }
    } catch (e) {
        if (e?.name === 'AbortError') {
            state.reviewBrowser.isLoading = false;
            return;
        }
        const search = els.reviewBrowserSearchInput?.value?.trim().toLowerCase() || '';
        const localItems = await dbGetAll('reviewQueue').catch(() => []);
        const filtered = (localItems || []).filter(item => {
            if (!search) return true;
            return (item.rawText || '').toLowerCase().includes(search);
        });
        const page = reset ? filtered.slice(0, MODAL_PAGE_SIZE) : filtered.slice(state.reviewBrowser.offset, state.reviewBrowser.offset + MODAL_PAGE_SIZE);
        for (const item of page) {
            const itemId = item?.id;
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
    state.reviewBrowser.isLoading = false;
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
    if (state.reviewBrowser.selectedIds.size > 0) clearSelectableSelection(state.reviewBrowser);
    else state.reviewBrowser.selectedIds = new Set(state.reviewBrowser.items.map(item => item.id));
    refreshSelectableListUI(els.reviewBrowserList, state.reviewBrowser);
    updateReviewBrowserCount();
}

async function handleReviewBrowserBulk(action) {
    const ids = await ensureReviewQueueIdsSynced(Array.from(state.reviewBrowser.selectedIds));
    if (!ids.length) return;
    showSaveIndicator(action === 'keep' ? 'Saving...' : 'Rejecting...');
    try {
        const res = await fetch(`/api/review-queue/bulk-${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
        if (res.ok) {
            clearSelectableSelection(state.reviewBrowser);
            await loadReviewQueue();
            await loadReviewBrowser({ reset: true });
            loadStats();
            hideSaveIndicator(action === 'keep' ? 'Saved ✓' : 'Rejected ✓');
        } else {
            hideSaveIndicator('Action failed');
            toast('Bulk review action failed', 'error');
        }
    } catch (e) {
        hideSaveIndicator('Action failed');
        toast('Bulk review action failed', 'error');
    }
}

// ============ TABS ============
function switchTab(tabName) {
    state.currentTab = tabName;
    els.tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    els.generateTab.classList.toggle('active', tabName === 'generate');
    els.chatTab.classList.toggle('active', tabName === 'chat');
    els.reviewTab.classList.toggle('active', tabName === 'review');
    if (tabName === 'review') loadReviewQueue();
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

// ============ API SETTINGS ============
async function saveApiKey() {
    const key = els.apiKey.value.trim();
    if (key.startsWith('•')) { toast('Enter a new key', 'info'); return; }
    // Preserve the current base URL value before config reload wipes it
    const currentBaseUrl = els.baseUrl.value;
    try {
        const res = await fetch('/api/config/key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: els.provider.value, api_key: key })
        });
        if (res.ok) {
            toast('API key saved!', 'success');
            await loadConfig();
            // Restore base URL that loadConfig() overwrote from disk
            els.baseUrl.value = currentBaseUrl;
        } else {
            const data = await res.json().catch(() => ({}));
            toast(data.error || 'Failed to save key', 'error');
        }
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
        else {
            const data = await res.json().catch(() => ({}));
            toast(data.error || 'Failed to save URL', 'error');
        }
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

    // Set prompt source based on current tab if no custom export draft exists
    if (!state.export.systemPrompt) {
        if (state.currentTab === 'chat') {
            els.exportPromptSourceChat.checked = true;
        } else if (state.currentTab === 'generate') {
            els.exportPromptSourceGenerate.checked = true;
        } else {
            els.exportPromptSourceCustom.checked = true;
        }
        updateExportPromptState();
    } else {
        els.exportPromptSourceCustom.checked = true;
        if (els.exportSystemPrompt) els.exportSystemPrompt.value = state.export.systemPrompt;
    }

    els.exportModal.classList.remove('hidden');
    const hasActiveLoadAll = !!state.export.loadAllTaskId && state.tasks.items.has(state.export.loadAllTaskId);
    const shouldReset = !hasActiveLoadAll && state.export.files.length === 0;
    if (shouldReset) await loadExportFiles({ reset: true });
    else { renderExportFileList(); updateExportCount(); }
    renderExportPreview();
}

function getSelectedExportPromptSource() {
    return document.querySelector('input[name="export-prompt-source"]:checked')?.value || 'custom';
}

function updateExportPromptState() {
    if (getSelectedExportPromptSource() !== 'custom') {
        els.exportCustomPromptGroup.classList.add('disabled-group');
        els.exportSystemPrompt.disabled = true;
        els.exportPresetSelect.disabled = true;
    } else {
        els.exportCustomPromptGroup.classList.remove('disabled-group');
        els.exportSystemPrompt.disabled = false;
        els.exportPresetSelect.disabled = false;
    }
}

function updateExportPaginationUI() {
    if (els.exportPaginationStatus) {
        const loaded = Math.min(state.export.offset, state.export.files.length);
        const total = state.export.total || 0;
        els.exportPaginationStatus.textContent = total > 0 ? `Showing ${loaded} of ${total}` : '';
    }
    if (els.exportLoadMore) {
        els.exportLoadMore.classList.toggle('hidden', !state.export.hasMore);
        els.exportLoadMore.disabled = state.export.isLoading;
    }
}

async function loadExportFiles({ reset = false, signal = null } = {}) {
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
            folder: 'wanted',
            limit: String(MODAL_PAGE_SIZE),
            offset: String(state.export.offset)
        });
        const search = els.exportSearchInput?.value?.trim() || '';
        if (search) params.set('search', search);
        const res = await fetch(`/api/conversations?${params.toString()}`, signal ? { signal } : undefined);
        if (res.ok) {
            const data = await res.json();
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
        else { state.export.files = []; renderExportFileList(); renderExportPreview(); }
    } finally {
        state.export.isLoading = false;
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
    if (state.export.selectedIds.size > 0) clearSelectableSelection(state.export);
    else state.export.selectedIds = new Set(state.export.files.map(f => f.id));
    refreshSelectableListUI(els.exportFileList, state.export);
    updateExportCount();
}

function getExportSystemPrompt() {
    const source = getSelectedExportPromptSource();
    if (source === 'chat') {
        return els.chatSystemPrompt?.value || state.chat.systemPrompt || '';
    } else if (source === 'generate') {
        return els.systemPrompt?.value || '';
    } else {
        return els.exportSystemPrompt?.value || '';
    }
}

async function exportDataset(format, selectedIds = null, systemPrompt = null) {
    showSaveIndicator('Exporting...');
    try {
        const filename = els.exportFilename?.value?.trim() || null;
        const res = await fetch(`/api/export/${format}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: selectedIds, system_prompt: systemPrompt, filename })
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
    // Respect the autoSave setting
    if (!syncSettings.autoSaveEnabled) return;
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
            presetName: els.chatPresetSelect?.value || ''
        },
        export: {
            systemPrompt: els.exportSystemPrompt?.value || '',
            presetName: els.exportPresetSelect?.value || ''
        },
        _localTime: new Date().toISOString()
    };
}

async function restoreDraft() {
    try {
        const sessionDraft = await dbGet('drafts', SESSION_ID);
        if (sessionDraft) { applyDraft(sessionDraft); return; }
    } catch (e) { }
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
    if (draft.chat?.presetName && els.chatPresetSelect) {
        els.chatPresetSelect.value = draft.chat.presetName;
    }
    if (draft.export?.systemPrompt && els.exportSystemPrompt) {
        els.exportSystemPrompt.value = draft.export.systemPrompt;
        state.export.systemPrompt = draft.export.systemPrompt;
    }
    if (draft.export?.presetName && els.exportPresetSelect) {
        els.exportPresetSelect.value = draft.export.presetName;
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
    document.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => scrollSidebarToSection(btn.dataset.sidebarScroll, btn));
    });

    // Manual sync
    els.manualSyncBtn?.addEventListener('click', manualSync);

    // Provider change
    els.provider.addEventListener('change', () => {
        updateProviderUI();
        loadModels();
        // Save provider choice to DB
        fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ default_provider: els.provider.value })
        }).catch(() => {});
    });
    els.refreshModels.addEventListener('click', refreshModels);
    els.modelInput?.addEventListener('change', saveDefaultModel);
    els.modelInput?.addEventListener('input', () => { debouncedSaveDraft(); });

    // Temperature
    els.temperature.addEventListener('input', (e) => { els.tempValue.textContent = e.target.value; debouncedSaveDraft(); });
    els.temperature.addEventListener('change', saveDefaultTemperature);

    // API settings
    els.toggleKey.addEventListener('click', () => { els.apiKey.type = els.apiKey.type === 'password' ? 'text' : 'password'; });
    els.saveKey.addEventListener('click', saveApiKey);
    els.saveUrl.addEventListener('click', saveBaseUrl);

    // Sync settings
    document.querySelectorAll('#auto-sync-enabled, #sync-interval, #auto-save-enabled, #save-interval, #ask-reject-reason').forEach(el => {
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
        filesSearchTimer = setTimeout(() => loadFilesModal(state.filesModal.currentFolder, { reset: true }), 300);
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
        closeSidebar();
    });
    els.closeSettingsModal?.addEventListener('click', closeSettingsModal);
    $('#settings-modal .modal-backdrop')?.addEventListener('click', closeSettingsModal);
    els.settingsSearchInput?.addEventListener('input', filterSettingsSections);
    document.querySelectorAll('.settings-category-btn').forEach(btn => {
        btn.addEventListener('click', () => scrollSettingsSection(btn.dataset.settingsTarget, btn));
    });

    // Files Modal Bulk Actions Static Listeners
    els.filesSelectToggle?.addEventListener('click', () => {
        if (state.filesModal.selectedIds.size > 0) clearSelectableSelection(state.filesModal);
        else state.filesModal.selectedIds = new Set(state.filesModal.files.map(f => f.id));
        refreshSelectableListUI(els.filesModalList, state.filesModal);
        updateFilesModalCount();
    });
    els.filesClearSelection?.addEventListener('click', () => {
        clearSelectableSelection(state.filesModal);
        refreshSelectableListUI(els.filesModalList, state.filesModal);
        updateFilesModalCount();
    });
    els.filesLoadAll?.addEventListener('click', () => startLoadAllForSlice({
        slice: state.filesModal,
        title: 'Files: Loading conversations',
        loadNextPage: () => loadFilesModal(state.filesModal.currentFolder, { reset: false, signal: state.filesModal.loadAllController?.signal || null }),
        hasMore: () => state.filesModal.hasMore && !state.filesModal.isLoading,
        getProgressDetail: () => state.filesModal.currentFolder === 'rejected' ? 'Rejected' : 'Wanted'
    }));
    els.filesLoadMore?.addEventListener('click', loadMoreFilesModal);
    $('#files-bulk-reject')?.addEventListener('click', () => handleBulkMove('wanted', 'rejected'));
    $('#files-bulk-restore')?.addEventListener('click', () => handleBulkMove('rejected', 'wanted'));
    $('#files-bulk-delete')?.addEventListener('click', () => handleBulkDelete(state.filesModal.currentFolder));

    // Event Delegation for Files Modal List Items
    els.filesModalList?.addEventListener('click', (e) => {
        const item = e.target.closest('.export-file-item');
        if (!item) return;
        const id = item.dataset.id;
        const diff = handleSelectableInteraction(state.filesModal, state.filesModal.files, id, e, (previewId) => {
            const requestedId = previewId;
            fetchConversationPreview(previewId, state.filesModal.currentFolder)
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
    els.confirmExport?.addEventListener('click', () => {
        const format = els.exportFormat.value;
        const systemPrompt = getExportSystemPrompt();
        const selectedIds = Array.from(state.export.selectedIds);
        // Fix: zero selected means nothing selected, NOT "export all"
        if (selectedIds.length === 0) {
            toast('Please select at least one conversation to export', 'error');
            return;
        }
        exportDataset(format, selectedIds, systemPrompt);
        closeExportModal();
    });
    els.cancelExport?.addEventListener('click', closeExportModal);
    els.closeExport?.addEventListener('click', closeExportModal);

    document.querySelectorAll('input[name="export-prompt-source"]').forEach(input => {
        input.addEventListener('change', updateExportPromptState);
    });
    els.exportFormat?.addEventListener('change', (e) => setLastExportFormat(e.target.value));

    // Export Presets
    els.exportPresetSelect?.addEventListener('change', loadExportPreset);
    els.saveExportPreset?.addEventListener('click', saveExportPreset);
    els.newExportPreset?.addEventListener('click', newExportPreset);
    els.deleteExportPreset?.addEventListener('click', deleteExportPreset);

    els.exportSearchInput?.addEventListener('input', () => { cancelSliceLoadAll(state.export, 'Canceled'); loadExportFiles({ reset: true }); });
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
    els.exportLoadMore?.addEventListener('click', loadMoreExportFiles);
    els.exportFileList?.addEventListener('click', (e) => {
        const item = e.target.closest('.export-file-item');
        if (!item) return;
        const id = item.dataset.id;
        const diff = handleSelectableInteraction(state.export, state.export.files, id, e, (previewId) => {
            const requestedId = previewId;
            fetchConversationPreview(previewId, 'wanted')
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
    els.deletePreset?.addEventListener('click', deletePresetAction);

    // Custom Parameters
    els.openCustomParamsBtn?.addEventListener('click', openCustomParamsModal);
    els.closeCustomParamsModal?.addEventListener('click', closeCustomParamsModal);
    $('#custom-params-modal .modal-backdrop')?.addEventListener('click', closeCustomParamsModal);
    els.customParamsSearchInput?.addEventListener('input', renderCustomParams);
    els.customParamAddBtn?.addEventListener('click', addCustomParam);
    els.customParamKey?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCustomParam(); });
    els.customParamValue?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCustomParam(); });

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
    els.reviewBrowserSearchInput?.addEventListener('input', () => { cancelSliceLoadAll(state.reviewBrowser, 'Canceled'); loadReviewBrowser({ reset: true }); });
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
    els.reviewBrowserLoadMore?.addEventListener('click', loadMoreReviewBrowser);
    els.reviewBrowserBulkKeep?.addEventListener('click', () => handleReviewBrowserBulk('keep'));
    els.reviewBrowserBulkReject?.addEventListener('click', () => handleReviewBrowserBulk('reject'));
    els.reviewBrowserList?.addEventListener('click', (e) => {
        const item = e.target.closest('.export-file-item');
        if (!item) return;
        const id = item.dataset.id;
        const diff = handleSelectableInteraction(state.reviewBrowser, state.reviewBrowser.items, id, e, (previewId) => {
            const queueIndex = state.review.queue.findIndex(entry => entry.id === previewId);
            if (queueIndex !== -1) {
                state.review.currentIndex = queueIndex;
                state.review.isEditing = false;
                renderReviewItem();
            }
            state.reviewBrowser.previewId = previewId;
            state.reviewBrowser.previewConversation = state.reviewBrowser.items.find(entry => entry.id === previewId) || null;
            renderReviewBrowserPreview();
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

    // History
    els.openHistoryBtn?.addEventListener('click', () => { openMacrosModal(); switchMacrosTab('history'); });
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
            const newName = prompt('Enter new filename (must end in .jsonl):', file.name);
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
