// ============================================================
// APPWRITE CONFIG
// ============================================================
var AW_ENDPOINT = 'https://sfo.cloud.appwrite.io/v1';
var AW_PROJECT = '6a6dd3c900350363b8e7';
var AW_DB = '6a6dd4fb001f662f0f79';
var AW_COL = 'bookmarks';

// ============================================================
// SDK GLOBALS
// ============================================================
var client = null;
var account = null;
var databases = null;
var currentUser = null;
var sdkReady = false;

// ============================================================
// LOAD SDK
// ============================================================
function loadSDK() {
    return new Promise(function(resolve, reject) {
        if (window.Appwrite) { resolve(); return; }
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/appwrite@16.0.2/dist/appwrite.min.js';
        s.onload = function() { resolve(); };
        s.onerror = function() { reject(new Error('SDK load failed')); };
        document.head.appendChild(s);
    });
}

function initSDK() {
    var sdk = window.Appwrite;
    if (!sdk || !sdk.Client) {
        throw new Error('Appwrite SDK not available');
    }
    client = new sdk.Client();
    client.setEndpoint(AW_ENDPOINT);
    client.setProject(AW_PROJECT);
    account = new sdk.Account(client);
    databases = new sdk.Databases(client);
    sdkReady = true;
}

// ============================================================
// AUTH
// ============================================================
async function doLogin(email, password) {
    try {
        await account.deleteSession('current');
    } catch (e) {}
    await account.createEmailPasswordSession(email, password);
    currentUser = await account.get();
    return currentUser;
}

async function checkExistingSession() {
    try {
        currentUser = await account.get();
        return true;
    } catch (e) {
        currentUser = null;
        return false;
    }
}

async function doLogout() {
    try {
        await account.deleteSession('current');
    } catch (e) {}
    currentUser = null;
}

// ============================================================
// DATABASE
// ============================================================
async function dbGetAll() {
    if (!currentUser) return [];

    var sdk = window.Appwrite;
    var allDocs = [];
    var lastId = null;
    var keepGoing = true;

    while (keepGoing) {
        var queries = [
            sdk.Query.equal('userID', currentUser.$id),
            sdk.Query.orderAsc('order'),
            sdk.Query.limit(100)
        ];
        if (lastId) {
            queries.push(sdk.Query.cursorAfter(lastId));
        }
        var res = await databases.listDocuments(AW_DB, AW_COL, queries);
        allDocs = allDocs.concat(res.documents);
        if (res.documents.length < 100) {
            keepGoing = false;
        } else {
            lastId = res.documents[res.documents.length - 1].$id;
        }
    }

    return allDocs.map(docToLocal);
}

async function dbCreate(item) {
    var sdk = window.Appwrite;
    var data = localToDoc(item);
    var res = await databases.createDocument(AW_DB, AW_COL, sdk.ID.unique(), data);
    return docToLocal(res);
}

async function dbUpdate(id, fields) {
    var patch = {};
    if (fields.name !== undefined) patch.name = fields.name;
    if (fields.url !== undefined) patch.url = fields.url;
    if (fields.expanded !== undefined) patch.expanded = fields.expanded;
    if (fields.order !== undefined) patch.order = fields.order;
    if (fields.type !== undefined) patch.type = fields.type;
    if (fields.parentId !== undefined) {
        patch.parentId = (fields.parentId === null) ? '' : fields.parentId;
    }
    var res = await databases.updateDocument(AW_DB, AW_COL, id, patch);
    return docToLocal(res);
}

async function dbDeleteDoc(id) {
    await databases.deleteDocument(AW_DB, AW_COL, id);
}

async function dbBatchUpdate(updates) {
    for (var i = 0; i < updates.length; i += 5) {
        var chunk = updates.slice(i, i + 5);
        await Promise.all(chunk.map(function(u) {
            var d = { order: u.order };
            if (u.parentId !== undefined) d.parentId = u.parentId;
            return dbUpdate(u.id, d);
        }));
    }
}

// ============================================================
// DATA CONVERTERS
// ============================================================
function docToLocal(doc) {
    if (!doc) return { id: '', type: 'bookmark', name: '', url: '', parentId: null, order: 0, expanded: true };
    return {
        id: doc.$id || '',
        type: doc.type || 'bookmark',
        name: doc.name || '',
        url: doc.url || '',
        parentId: (doc.parentId && doc.parentId !== '') ? doc.parentId : null,
        order: (typeof doc.order === 'number') ? doc.order : 0,
        expanded: doc.expanded !== false
    };
}

// ✅ Only ONE localToDoc - correctly uses userID
function localToDoc(item) {
    return {
        type: item.type || 'bookmark',
        name: item.name || '',
        url: item.url || '',
        parentId: (item.parentId !== null && item.parentId !== undefined) ? String(item.parentId) : '',
        order: item.order || 0,
        expanded: item.expanded !== false,
        userID: currentUser ? currentUser.$id : ''
    };
}

// ============================================================
// URL HELPERS
// ============================================================
function normalizeUrl(raw) {
    var s = raw.trim();
    if (!s) return '';
    s = s.replace(/^["'<\s]+|["'>\s]+$/g, '');
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(s)) {
        try { new URL(s); return s; } catch (e) {}
    }
    s = s.replace(/^\/\//, '');
    if (/^[^\s]+\.[^\s]+/.test(s)) {
        try { new URL('https://' + s); return 'https://' + s; } catch (e) {}
    }
    if (/^[a-zA-Z0-9][-a-zA-Z0-9]*$/.test(s)) return 'https://' + s + '.com';
    return 'https://' + s;
}

function extractUrlName(url) {
    try {
        var h = new URL(url).hostname.replace(/^www\./, '');
        return h.charAt(0).toUpperCase() + h.slice(1);
    } catch (e) { return url.slice(0, 40); }
}

function displayUrl(url) {
    if (!url) return '';
    try {
        var u = new URL(url);
        var d = u.hostname.replace(/^www\./, '') + u.pathname;
        if (d.endsWith('/')) d = d.slice(0, -1);
        return d.length > 55 ? d.slice(0, 52) + '…' : d;
    } catch (e) { return url.length > 55 ? url.slice(0, 52) + '…' : url; }
}

function faviconOf(url) {
    try { return 'https://www.google.com/s2/favicons?domain=' + new URL(url).hostname + '&sz=32'; }
    catch (e) { return null; }
}

function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function hlText(text, term) {
    var safe = esc(text);
    if (!term) return safe;
    return safe.replace(
        new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'),
        '<span class="hl">$1</span>'
    );
}

function sid(id) { return String(id || ''); }
function pidMatch(a, b) { return sid(a) === sid(b); }

// ============================================================
// STATE
// ============================================================
var bookmarks = [];
var dragState = { id: null, ghostEl: null, timer: null, active: false, startX: 0, startY: 0, moved: false };
var ctxId = null;
var confirmResolve = null;
var appBound = false;

// ============================================================
// DOM
// ============================================================
var loginPage, appEl, treeEl, emptyEl, searchInput, clearBtn;
var modalEl, moveModalEl, ctxMenu, dropZone, rootDrop, toastEl;
var confirmModalEl, logoutModalEl;

function $(sel) { return document.querySelector(sel); }

function cacheDom() {
    loginPage = $('#loginPage');
    appEl = $('#app');
    treeEl = $('#tree');
    emptyEl = $('#empty');
    searchInput = $('#searchInput');
    clearBtn = $('#clearSearch');
    modalEl = $('#modal');
    moveModalEl = $('#moveModal');
    ctxMenu = $('#ctx');
    dropZone = $('#dropZone');
    rootDrop = $('#rootDrop');
    toastEl = $('#toast');
    confirmModalEl = $('#confirmModal');
    logoutModalEl = $('#logoutModal');
}

// ============================================================
// BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', async function() {
    cacheDom();
    try {
        await loadSDK();
        initSDK();
    } catch (e) {
        showLoginError('Failed to initialize. Please refresh the page.');
        return;
    }
    bindLogin();
    var loggedIn = await checkExistingSession();
    if (loggedIn) {
        await enterApp();
    } else {
        showLogin();
    }
});

// ============================================================
// PAGE SWITCHING
// ============================================================
function showLogin() {
    if (loginPage) loginPage.classList.remove('hidden');
    if (appEl) appEl.classList.add('hidden');
    bookmarks = [];
    if (treeEl) treeEl.innerHTML = '';
}

function showLoginError(msg) {
    showLogin();
    var errEl = $('#loginError');
    if (errEl) {
        errEl.textContent = msg;
        errEl.classList.add('show');
    }
}

async function enterApp() {
    if (loginPage) loginPage.classList.add('hidden');
    if (appEl) appEl.classList.remove('hidden');
    try {
        bookmarks = await dbGetAll();
    } catch (e) {
        bookmarks = [];
        notify('Failed to load bookmarks');
    }
    render();
    bindApp();
}

// ============================================================
// LOGIN
// ============================================================
function bindLogin() {
    var form = $('#loginForm');
    if (!form) return;

    var userField = $('#loginUser');
    var passField = $('#loginPass');
    var errEl = $('#loginError');
    var btn = $('#loginBtn');
    var btnText = $('#loginBtnText');
    var spinner = $('#loginSpinner');
    var togglePass = $('#togglePass');

    if (togglePass) {
        togglePass.addEventListener('click', function() {
            var isPass = passField.type === 'password';
            passField.type = isPass ? 'text' : 'password';
            var eyeOpen = $('#eyeOpen');
            var eyeShut = $('#eyeShut');
            if (eyeOpen) eyeOpen.style.display = isPass ? 'none' : '';
            if (eyeShut) eyeShut.style.display = isPass ? '' : 'none';
        });
    }

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        if (!sdkReady) {
            errEl.textContent = 'Still loading, please wait...';
            errEl.classList.add('show');
            return;
        }
        var email = userField.value.trim();
        var password = passField.value;
        if (!email || !password) {
            errEl.textContent = 'Please enter both fields';
            errEl.classList.add('show');
            return;
        }
        btn.disabled = true;
        btnText.textContent = 'Signing in…';
        if (spinner) spinner.style.display = '';
        errEl.classList.remove('show');
        try {
            await doLogin(email, password);
            form.reset();
            errEl.classList.remove('show');
            await enterApp();
        } catch (err) {
            var msg = 'Invalid email or password';
            if (err && err.message) {
                if (err.message.indexOf('Invalid credentials') !== -1) {
                    msg = 'Invalid email or password';
                } else if (err.message.indexOf('Invalid `password`') !== -1) {
                    msg = 'Password must be at least 8 characters';
                } else if (err.message.indexOf('Rate limit') !== -1) {
                    msg = 'Too many attempts. Please wait a moment.';
                } else if (err.message.indexOf('user_not_found') !== -1 || err.message.indexOf('general_argument_invalid') !== -1) {
                    msg = 'Invalid email or password';
                } else if (err.message.indexOf('Network') !== -1) {
                    msg = 'Network error. Check your connection.';
                } else if (err.message.indexOf('hostname') !== -1 || err.message.indexOf('Missing') !== -1) {
                    msg = 'Configuration error. Add your domain to Appwrite platforms.';
                } else {
                    msg = err.message;
                }
            }
            errEl.textContent = msg;
            errEl.classList.add('show');
            passField.value = '';
            passField.focus();
        } finally {
            btn.disabled = false;
            btnText.textContent = 'Sign In';
            if (spinner) spinner.style.display = 'none';
        }
    });
}

// ============================================================
// CUSTOM CONFIRM
// ============================================================
function customConfirm(title, message, actionLabel) {
    return new Promise(function(resolve) {
        $('#confirmTitle').textContent = title;
        $('#confirmMsg').textContent = message;
        $('#confirmYes').textContent = actionLabel || 'Delete';
        confirmModalEl.classList.add('on');
        confirmResolve = resolve;
    });
}

function closeConfirm(result) {
    confirmModalEl.classList.remove('on');
    if (confirmResolve) {
        var r = confirmResolve;
        confirmResolve = null;
        r(result);
    }
}

// ============================================================
// RENDER
// ============================================================
function getChildren(pid) {
    return bookmarks
        .filter(function(i) { return pidMatch(i.parentId, pid); })
        .sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
}

function render(q) {
    if (!treeEl) return;
    var term = (q || '').toLowerCase().trim();
    treeEl.innerHTML = '';
    if (term) {
        var hits = bookmarks.filter(function(i) {
            return i.name.toLowerCase().includes(term) || (i.url && i.url.toLowerCase().includes(term));
        });
        if (!hits.length) {
            treeEl.innerHTML = '<li class="no-results">No results</li>';
            emptyEl.classList.add('hide');
            return;
        }
        hits.forEach(function(i) { treeEl.appendChild(mkNode(i, term)); });
        emptyEl.classList.add('hide');
    } else {
        var roots = getChildren(null);
        if (!roots.length) { emptyEl.classList.remove('hide'); return; }
        emptyEl.classList.add('hide');
        roots.forEach(function(i) { treeEl.appendChild(mkNode(i)); });
    }
}

function mkNode(item, q) {
    q = q || '';
    var li = document.createElement('li');
    li.className = 'node';
    li.dataset.id = item.id;

    var row = document.createElement('div');
    row.className = 'node-row';
    row.dataset.id = item.id;
    row.dataset.type = item.type;

    var isFolder = item.type === 'folder';
    var kids = bookmarks.filter(function(i) { return pidMatch(i.parentId, item.id); });
    var h = '';

    if (isFolder) {
        var open = item.expanded !== false;
        h += '<button class="node-toggle ' + (open ? 'open' : '') + '" data-id="' + item.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></button>';
        h += '<span class="node-icon folder-ic"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg></span>';
        h += '<span class="node-info"><span class="node-name">' + hlText(item.name, q) + '</span></span>';
        h += '<span class="node-count">' + kids.length + '</span>';
    } else {
        var fav = faviconOf(item.url);
        var ic = fav
            ? '<img src="' + fav + '" alt="" onerror="this.outerHTML=\'<svg viewBox=\\\'0 0 24 24\\\' fill=\\\'none\\\' stroke=\\\'currentColor\\\' stroke-width=\\\'2\\\'><path d=\\\'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z\\\'/></svg>\'">'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
        h += '<span class="node-icon">' + ic + '</span>';
        h += '<span class="node-info"><span class="node-name">' + hlText(item.name, q) + '</span><span class="node-url-text">' + hlText(displayUrl(item.url), q) + '</span></span>';
    }

    h += '<span class="node-actions">'
       + '<button class="act" data-act="edit" data-id="' + item.id + '" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>'
       + '<button class="act del" data-act="delete" data-id="' + item.id + '" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>'
       + '</span>';

    row.innerHTML = h;
    li.appendChild(row);

    if (isFolder && !q) {
        var wrap = document.createElement('div');
        wrap.className = 'folder-kids' + (item.expanded === false ? ' shut' : '');
        var ul = document.createElement('ul');
        getChildren(item.id).forEach(function(c) { ul.appendChild(mkNode(c)); });
        wrap.appendChild(ul);
        li.appendChild(wrap);
    }

    return li;
}

// ============================================================
// BIND APP
// ============================================================
function bindApp() {
    if (appBound) return;
    appBound = true;

    searchInput.addEventListener('input', function() {
        clearBtn.classList.toggle('show', searchInput.value.length > 0);
        render(searchInput.value);
    });
    clearBtn.addEventListener('click', function() {
        searchInput.value = '';
        clearBtn.classList.remove('show');
        render();
        searchInput.focus();
    });

    $('#addBtn').addEventListener('click', function() { openModal('bookmark'); });
    $('#addFolderBtn').addEventListener('click', function() { openModal('folder'); });

    $('#logoutBtn').addEventListener('click', function() { logoutModalEl.classList.add('on'); });
    $('#logoutNo').addEventListener('click', function() { logoutModalEl.classList.remove('on'); });
    $('#logoutYes').addEventListener('click', async function() {
        logoutModalEl.classList.remove('on');
        await doLogout();
        bookmarks = [];
        treeEl.innerHTML = '';
        appBound = false;
        showLogin();
        notify('Signed out');
    });
    logoutModalEl.addEventListener('click', function(e) {
        if (e.target === logoutModalEl) logoutModalEl.classList.remove('on');
    });

    $('#modalClose').addEventListener('click', closeModal);
    $('#cancelBtn').addEventListener('click', closeModal);
    modalEl.addEventListener('click', function(e) { if (e.target === modalEl) closeModal(); });
    $('#itemForm').addEventListener('submit', onSubmit);

    $('#confirmNo').addEventListener('click', function() { closeConfirm(false); });
    $('#confirmYes').addEventListener('click', function() { closeConfirm(true); });
    confirmModalEl.addEventListener('click', function(e) {
        if (e.target === confirmModalEl) closeConfirm(false);
    });

    treeEl.addEventListener('click', onTreeClick);
    treeEl.addEventListener('contextmenu', onCtxMenu);
    ctxMenu.querySelectorAll('button').forEach(function(b) {
        b.addEventListener('click', function() { doCtxAction(b.dataset.action); });
    });
    document.addEventListener('click', function(e) {
        if (!ctxMenu.contains(e.target)) ctxMenu.classList.remove('on');
    });

    $('#moveClose').addEventListener('click', function() { moveModalEl.classList.remove('on'); });
    moveModalEl.addEventListener('click', function(e) {
        if (e.target === moveModalEl) moveModalEl.classList.remove('on');
    });

    treeEl.addEventListener('mousedown', onPointerDown);
    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('mouseup', onPointerUp);

    treeEl.addEventListener('touchstart', onTouchStart, { passive: false });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);

    var extC = 0;
    document.addEventListener('dragenter', function(e) {
        if (dragState.active || appEl.classList.contains('hidden')) return;
        var t = Array.from(e.dataTransfer.types);
        if (t.includes('text/uri-list') || t.includes('text/plain') || t.includes('text/html')) { extC++; dropZone.classList.add('active'); }
    });
    document.addEventListener('dragover', function(e) {
        if (dragState.active || appEl.classList.contains('hidden')) return;
        var t = Array.from(e.dataTransfer.types);
        if (t.includes('text/uri-list') || t.includes('text/plain') || t.includes('text/html')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    });
    document.addEventListener('dragleave', function() {
        if (dragState.active) return;
        extC--;
        if (extC <= 0) { extC = 0; dropZone.classList.remove('active'); }
    });
    document.addEventListener('drop', onExternalDrop);

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeModal();
            moveModalEl.classList.remove('on');
            ctxMenu.classList.remove('on');
            logoutModalEl.classList.remove('on');
            closeConfirm(false);
        }
    });
}

// ============================================================
// TREE CLICKS
// ============================================================
function onTreeClick(e) {
    var tog = e.target.closest('.node-toggle');
    if (tog) { e.stopPropagation(); toggleFolder(tog.dataset.id); return; }
    var act = e.target.closest('.act');
    if (act) {
        e.stopPropagation();
        if (act.dataset.act === 'edit') editItem(act.dataset.id);
        else if (act.dataset.act === 'delete') delItem(act.dataset.id);
        return;
    }
    if (dragState.active || dragState.moved) return;
    var row = e.target.closest('.node-row');
    if (!row) return;
    var item = bookmarks.find(function(i) { return sid(i.id) === row.dataset.id; });
    if (item && item.type === 'bookmark' && item.url) {
        window.open(item.url, '_blank', 'noopener');
    }
}

async function toggleFolder(id) {
    var item = bookmarks.find(function(i) { return sid(i.id) === id; });
    if (!item) return;
    item.expanded = !item.expanded;
    try { await dbUpdate(item.id, { expanded: item.expanded }); } catch (e) {}
    var li = treeEl.querySelector('.node[data-id="' + id + '"]');
    if (li) {
        var t = li.querySelector('.node-toggle');
        var k = li.querySelector('.folder-kids');
        if (t) t.classList.toggle('open', item.expanded);
        if (k) k.classList.toggle('shut', !item.expanded);
    }
}

// ============================================================
// MODAL
// ============================================================
function openModal(type, editId) {
    var form = $('#itemForm');
    form.reset();
    $('#itemId').value = '';
    $('#itemType').value = type;
    var urlField = $('#itemUrl');
    urlField.classList.toggle('hide', type === 'folder');
    $('#modalTitle').textContent = editId
        ? (type === 'folder' ? 'Edit Folder' : 'Edit Bookmark')
        : (type === 'folder' ? 'New Folder' : 'Add Bookmark');
    populateParentSelect(editId);
    if (editId) {
        var item = bookmarks.find(function(i) { return sid(i.id) === sid(editId); });
        if (!item) return;
        $('#itemId').value = item.id;
        $('#itemType').value = item.type;
        $('#itemName').value = item.name;
        $('#itemUrl').value = item.url || '';
        urlField.classList.toggle('hide', item.type === 'folder');
        $('#itemParent').value = item.parentId || '';
    }
    modalEl.classList.add('on');
    setTimeout(function() { $('#itemName').focus(); }, 80);
}

function closeModal() { modalEl.classList.remove('on'); }

function populateParentSelect(excl) {
    var sel = $('#itemParent');
    sel.innerHTML = '<option value="">— Root —</option>';
    var folders = bookmarks.filter(function(i) {
        return i.type === 'folder' && sid(i.id) !== sid(excl);
    });
    function addOpts(pid, depth) {
        folders.filter(function(f) { return pidMatch(f.parentId, pid); }).forEach(function(f) {
            var o = document.createElement('option');
            o.value = f.id;
            o.textContent = '\u00A0\u00A0'.repeat(depth) + (depth ? '└ ' : '') + f.name;
            sel.appendChild(o);
            addOpts(f.id, depth + 1);
        });
    }
    addOpts(null, 0);
}

async function onSubmit(e) {
    e.preventDefault();
    var id = $('#itemId').value;
    var type = $('#itemType').value;
    var name = $('#itemName').value.trim();
    var url = $('#itemUrl').value.trim();
    var parentId = $('#itemParent').value || null;
    if (!name) return;
    if (type === 'bookmark' && url) url = normalizeUrl(url);
    try {
        if (id) {
            await dbUpdate(id, { name: name, url: url, parentId: parentId });
            var idx = bookmarks.findIndex(function(i) { return sid(i.id) === sid(id); });
            if (idx >= 0) { bookmarks[idx].name = name; bookmarks[idx].url = url; bookmarks[idx].parentId = parentId; }
            notify('Updated');
        } else {
            var created = await dbCreate({ type: type, name: name, url: url, parentId: parentId, order: bookmarks.length, expanded: true });
            bookmarks.push(created);
            notify(type === 'folder' ? 'Folder created' : 'Bookmark saved');
        }
    } catch (err) { notify('Error: ' + (err.message || err)); return; }
    closeModal();
    render(searchInput.value);
}

function editItem(id) {
    var item = bookmarks.find(function(i) { return sid(i.id) === id; });
    if (!item) return;
    openModal(item.type, id);
}

async function delItem(id) {
    var item = bookmarks.find(function(i) { return sid(i.id) === id; });
    if (!item) return;
    var kids = bookmarks.filter(function(i) { return sid(i.parentId) === id; }).length;
    var msg = item.type === 'folder' && kids
        ? 'This will delete "' + item.name + '" and ' + kids + ' item' + (kids > 1 ? 's' : '') + ' inside it.'
        : 'Are you sure you want to delete "' + item.name + '"?';
    var yes = await customConfirm('Delete', msg, 'Delete');
    if (!yes) return;
    try {
        var toDelete = [];
        function collect(pid) { toDelete.push(pid); bookmarks.filter(function(i) { return pidMatch(i.parentId, pid); }).forEach(function(c) { collect(c.id); }); }
        collect(item.id);
        for (var d = 0; d < toDelete.length; d++) { await dbDeleteDoc(toDelete[d]); }
        bookmarks = bookmarks.filter(function(i) { return toDelete.indexOf(i.id) === -1; });
        notify('Deleted');
        render(searchInput.value);
    } catch (err) { notify('Error: ' + (err.message || err)); }
}

// ============================================================
// CONTEXT MENU
// ============================================================
function onCtxMenu(e) {
    var row = e.target.closest('.node-row');
    if (!row) return;
    e.preventDefault();
    ctxId = row.dataset.id;
    ctxMenu.style.left = Math.min(e.clientX, innerWidth - 180) + 'px';
    ctxMenu.style.top = Math.min(e.clientY, innerHeight - 140) + 'px';
    ctxMenu.classList.add('on');
}

function doCtxAction(action) {
    ctxMenu.classList.remove('on');
    if (!ctxId) return;
    var id = ctxId; ctxId = null;
    if (action === 'edit') editItem(id);
    else if (action === 'move') openMoveModal(id);
    else if (action === 'delete') delItem(id);
}

// ============================================================
// MOVE MODAL
// ============================================================
function openMoveModal(id) {
    var item = bookmarks.find(function(i) { return sid(i.id) === id; });
    if (!item) return;
    var list = $('#moveList');
    list.innerHTML = '';
    var desc = [];
    if (item.type === 'folder') {
        function collectDesc(pid) { bookmarks.filter(function(i) { return pidMatch(i.parentId, pid); }).forEach(function(c) { desc.push(sid(c.id)); collectDesc(c.id); }); }
        collectDesc(item.id);
    }
    var rootDiv = document.createElement('div');
    rootDiv.className = 'mv-item' + (!item.parentId ? ' current' : '');
    rootDiv.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> Root';
    rootDiv.addEventListener('click', function() { moveItemTo(item.id, null); });
    list.appendChild(rootDiv);
    function addFolders(pid, depth) {
        bookmarks.filter(function(f) { return f.type === 'folder' && pidMatch(f.parentId, pid) && sid(f.id) !== id && desc.indexOf(sid(f.id)) === -1; })
            .sort(function(a, b) { return (a.order || 0) - (b.order || 0); })
            .forEach(function(f) {
                var d = document.createElement('div');
                d.className = 'mv-item' + (pidMatch(item.parentId, f.id) ? ' current' : '');
                d.style.paddingLeft = (12 + depth * 16) + 'px';
                d.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg> ' + esc(f.name);
                d.addEventListener('click', function() { moveItemTo(item.id, f.id); });
                list.appendChild(d);
                addFolders(f.id, depth + 1);
            });
    }
    addFolders(null, 0);
    moveModalEl.classList.add('on');
}

async function moveItemTo(id, newPid) {
    var item = bookmarks.find(function(i) { return sid(i.id) === sid(id); });
    if (!item) return;
    if (item.type === 'folder' && newPid) {
        var cur = newPid;
        while (cur) { if (sid(cur) === sid(id)) { notify('Cannot move into itself'); return; } var p = bookmarks.find(function(i) { return sid(i.id) === sid(cur); }); cur = p ? (p.parentId || null) : null; }
    }
    try {
        var newOrder = bookmarks.filter(function(i) { return pidMatch(i.parentId, newPid); }).length;
        await dbUpdate(id, { parentId: newPid, order: newOrder });
        item.parentId = newPid;
        reorderSibs(newPid);
        moveModalEl.classList.remove('on');
        notify('Moved');
        render(searchInput.value);
    } catch (err) { notify('Error: ' + (err.message || err)); }
}

function reorderSibs(pid) {
    bookmarks.filter(function(i) { return pidMatch(i.parentId, pid); }).sort(function(a, b) { return (a.order || 0) - (b.order || 0); }).forEach(function(s, idx) { s.order = idx; });
}

// ============================================================
// DRAG & DROP
// ============================================================
var DRAG_THRESHOLD = 8;
var LONG_PRESS_MS = 400;

function createGhost(item) { var g = document.createElement('div'); g.className = 'drag-ghost'; g.textContent = item.name; document.body.appendChild(g); return g; }

function clearHighlights() {
    document.querySelectorAll('.drag-over-folder,.dragging').forEach(function(el) { el.classList.remove('drag-over-folder', 'dragging'); });
    document.querySelectorAll('.drop-bar').forEach(function(el) { el.remove(); });
    if (rootDrop) rootDrop.classList.remove('drag-hover');
}

function getDropTarget(x, y) {
    if (dragState.ghostEl) dragState.ghostEl.style.display = 'none';
    var el = document.elementFromPoint(x, y);
    if (dragState.ghostEl) dragState.ghostEl.style.display = '';
    if (!el) return null;
    if (el.closest('#rootDrop')) return { type: 'root' };
    var row = el.closest('.node-row');
    if (!row || row.dataset.id === dragState.id) return null;
    var rect = row.getBoundingClientRect();
    var yPos = y - rect.top; var h = rect.height;
    var isFolder = row.dataset.type === 'folder';
    if (isFolder) {
        if (yPos < h * 0.25) return { type: 'before', id: row.dataset.id, row: row };
        if (yPos > h * 0.75) return { type: 'after', id: row.dataset.id, row: row };
        return { type: 'inside', id: row.dataset.id, row: row };
    }
    return yPos < h * 0.5 ? { type: 'before', id: row.dataset.id, row: row } : { type: 'after', id: row.dataset.id, row: row };
}

function showDropIndicator(target) {
    clearHighlights();
    var srcRow = treeEl.querySelector('.node-row[data-id="' + dragState.id + '"]');
    if (srcRow) srcRow.classList.add('dragging');
    if (!target) return;
    if (target.type === 'root') { rootDrop.classList.add('drag-hover'); return; }
    if (target.type === 'inside') { target.row.classList.add('drag-over-folder'); return; }
    var bar = document.createElement('div'); bar.className = 'drop-bar';
    var node = target.row.closest('.node'); if (!node) return;
    if (target.type === 'before') node.parentNode.insertBefore(bar, node);
    else node.parentNode.insertBefore(bar, node.nextSibling);
}

async function executeDrop(target) {
    if (!target || !dragState.id) return;
    var dragged = bookmarks.find(function(i) { return sid(i.id) === dragState.id; });
    if (!dragged) return;
    try {
        if (target.type === 'root') {
            var op = dragged.parentId; dragged.parentId = null; reorderSibs(null); reorderSibs(op);
            await dbUpdate(dragged.id, { parentId: null, order: dragged.order }); notify('Moved to root');
        } else if (target.type === 'inside') {
            var folder = bookmarks.find(function(i) { return sid(i.id) === target.id; });
            if (!folder) return;
            if (dragged.type === 'folder') { var c = folder.id; while (c) { if (sid(c) === sid(dragged.id)) { notify('Cannot move into itself'); return; } var pp = bookmarks.find(function(i) { return sid(i.id) === sid(c); }); c = pp ? (pp.parentId || null) : null; } }
            var op2 = dragged.parentId; dragged.parentId = folder.id; reorderSibs(folder.id); reorderSibs(op2);
            if (!folder.expanded) { folder.expanded = true; try { await dbUpdate(folder.id, { expanded: true }); } catch (e) {} }
            await dbUpdate(dragged.id, { parentId: folder.id, order: dragged.order }); notify('Moved to ' + folder.name);
        } else {
            var ti2 = bookmarks.find(function(i) { return sid(i.id) === target.id; }); if (!ti2) return;
            var op3 = dragged.parentId; var np = ti2.parentId || null;
            if (dragged.type === 'folder' && np) { var ck = np; while (ck) { if (sid(ck) === sid(dragged.id)) { notify('Cannot move there'); return; } var px = bookmarks.find(function(i) { return sid(i.id) === sid(ck); }); ck = px ? (px.parentId || null) : null; } }
            dragged.parentId = np;
            var sibs = bookmarks.filter(function(i) { return pidMatch(i.parentId, np) && sid(i.id) !== sid(dragged.id); }).sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
            var idx = sibs.findIndex(function(s) { return sid(s.id) === sid(ti2.id); });
            sibs.splice(target.type === 'before' ? idx : idx + 1, 0, dragged);
            var ups = sibs.map(function(s, i) { s.order = i; return { id: s.id, parentId: np, order: i }; });
            reorderSibs(op3); await dbBatchUpdate(ups); notify('Reordered');
        }
    } catch (err) { notify('Error: ' + (err.message || err)); }
    render(searchInput.value);
}

function onPointerDown(e) {
    if (e.button !== 0) return; var row = e.target.closest('.node-row');
    if (!row || e.target.closest('.act,.node-toggle')) return;
    dragState.id = row.dataset.id; dragState.startX = e.clientX; dragState.startY = e.clientY; dragState.moved = false; dragState.active = false;
}

function onPointerMove(e) {
    if (!dragState.id) return;
    if (!dragState.active) {
        if (Math.abs(e.clientX - dragState.startX) < DRAG_THRESHOLD && Math.abs(e.clientY - dragState.startY) < DRAG_THRESHOLD) return;
        dragState.active = true; dragState.moved = true;
        var item = bookmarks.find(function(i) { return sid(i.id) === dragState.id; });
        if (!item) { dragState.id = null; return; }
        dragState.ghostEl = createGhost(item); rootDrop.style.display = 'block';
        document.body.style.cursor = 'grabbing'; document.body.style.userSelect = 'none';
    }
    dragState.ghostEl.style.left = (e.clientX + 12) + 'px'; dragState.ghostEl.style.top = (e.clientY - 12) + 'px';
    showDropIndicator(getDropTarget(e.clientX, e.clientY));
}

function onPointerUp(e) {
    if (!dragState.id) return;
    if (dragState.active) {
        var target = getDropTarget(e.clientX, e.clientY); clearHighlights();
        if (dragState.ghostEl) { dragState.ghostEl.remove(); dragState.ghostEl = null; }
        rootDrop.style.display = 'none'; document.body.style.cursor = ''; document.body.style.userSelect = '';
        executeDrop(target);
    }
    var wm = dragState.moved; dragState.id = null; dragState.active = false;
    if (wm) setTimeout(function() { dragState.moved = false; }, 50);
}

function onTouchStart(e) {
    var row = e.target.closest('.node-row');
    if (!row || e.target.closest('.act,.node-toggle')) return;
    var touch = e.touches[0]; dragState.startX = touch.clientX; dragState.startY = touch.clientY; dragState.moved = false; dragState.active = false;
    var rowId = row.dataset.id;
    dragState.timer = setTimeout(function() {
        dragState.id = rowId; dragState.active = true; dragState.moved = true;
        var item = bookmarks.find(function(i) { return sid(i.id) === rowId; });
        if (!item) { dragState.id = null; dragState.active = false; return; }
        dragState.ghostEl = createGhost(item);
        dragState.ghostEl.style.left = (touch.clientX + 12) + 'px'; dragState.ghostEl.style.top = (touch.clientY - 12) + 'px';
        rootDrop.style.display = 'block'; if (navigator.vibrate) navigator.vibrate(30);
    }, LONG_PRESS_MS);
}

function onTouchMove(e) {
    var touch = e.touches[0];
    if (dragState.timer && !dragState.active) { if (Math.abs(touch.clientX - dragState.startX) > 10 || Math.abs(touch.clientY - dragState.startY) > 10) { clearTimeout(dragState.timer); dragState.timer = null; } return; }
    if (!dragState.active) return; e.preventDefault();
    if (dragState.ghostEl) { dragState.ghostEl.style.left = (touch.clientX + 12) + 'px'; dragState.ghostEl.style.top = (touch.clientY - 12) + 'px'; }
    showDropIndicator(getDropTarget(touch.clientX, touch.clientY));
}

function onTouchEnd(e) {
    clearTimeout(dragState.timer); dragState.timer = null;
    if (!dragState.active) return;
    var touch = e.changedTouches[0]; var target = getDropTarget(touch.clientX, touch.clientY); clearHighlights();
    if (dragState.ghostEl) { dragState.ghostEl.remove(); dragState.ghostEl = null; }
    rootDrop.style.display = 'none'; executeDrop(target);
    dragState.id = null; dragState.active = false; setTimeout(function() { dragState.moved = false; }, 50);
}

async function onExternalDrop(e) {
    dropZone.classList.remove('active');
    if (dragState.active || appEl.classList.contains('hidden')) return;
    var uriList = e.dataTransfer.getData('text/uri-list'); var plain = e.dataTransfer.getData('text/plain'); var htmlData = e.dataTransfer.getData('text/html');
    var urls = [];
    if (htmlData) { var doc = new DOMParser().parseFromString(htmlData, 'text/html'); doc.querySelectorAll('a[href]').forEach(function(a) { var href = a.href.trim(); if (/^https?:\/\//i.test(href)) urls.push({ url: href, name: a.textContent.trim() || '' }); }); }
    if (!urls.length && uriList) { uriList.split('\n').filter(function(l) { return l.trim() && !l.startsWith('#'); }).forEach(function(l) { if (/^https?:\/\//i.test(l.trim())) urls.push({ url: l.trim(), name: '' }); }); }
    if (!urls.length && plain) { var norm = normalizeUrl(plain); if (/^https?:\/\//i.test(norm)) urls.push({ url: norm, name: '' }); }
    if (!urls.length) return; e.preventDefault();
    try {
        for (var u = 0; u < urls.length; u++) { var en = urls[u]; var cr = await dbCreate({ type: 'bookmark', name: en.name || extractUrlName(en.url), url: en.url, parentId: null, order: bookmarks.length, expanded: true }); bookmarks.push(cr); }
        notify(urls.length + ' bookmark' + (urls.length > 1 ? 's' : '') + ' saved'); render(searchInput.value);
    } catch (err) { notify('Error: ' + (err.message || err)); }
}

// ============================================================
// TOAST
// ============================================================
var toastTimer;
function notify(msg) {
    if (!toastEl) return; toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function() { toastEl.classList.remove('show'); }, 2400);
}