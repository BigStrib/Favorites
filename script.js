// ============================================================
// APPWRITE CONFIG (UPDATED)
// ============================================================
var AW = {
    ENDPOINT: 'https://sfo.cloud.appwrite.io/v1',
    PROJECT_ID: '6a6dd3c900350363b8e7', // Removed "sfo-" prefix
    DATABASE_ID: '6a6dd4fb001f662f0f79',
    COLLECTION_ID: 'bookmarks'
};

// ============================================================
// AUTH
// ============================================================
var Auth = {
    session: null,
    user: null,

    save: function(session, user) {
        this.session = session;
        this.user = user;
        sessionStorage.setItem('aw_session', JSON.stringify(session));
        sessionStorage.setItem('aw_user', JSON.stringify(user));
    },

    load: function() {
        try {
            var s = sessionStorage.getItem('aw_session');
            var u = sessionStorage.getItem('aw_user');
            if (s) this.session = JSON.parse(s);
            if (u) this.user = JSON.parse(u);
        } catch {}
        return !!(this.session);
    },

    clear: function() {
        this.session = null;
        this.user = null;
        sessionStorage.removeItem('aw_session');
        sessionStorage.removeItem('aw_user');
    },

    headers: function() {
        var h = {
            'Content-Type': 'application/json',
            'X-Appwrite-Project': AW.PROJECT_ID
        };
        // Cookie-based auth is default for Appwrite web,
        // but for REST we pass the session cookie/fallback
        return h;
    }
};

// ============================================================
// API — Appwrite REST
// ============================================================
var API = {
    req: async function(method, path, body) {
        var opts = {
            method: method,
            headers: Auth.headers(),
            credentials: 'include'           // send session cookie
        };
        if (body) opts.body = JSON.stringify(body);
        var res = await fetch(AW.ENDPOINT + path, opts);
        if (res.status === 401) {
            Auth.clear();
            showLogin();
            throw new Error('Session expired');
        }
        if (!res.ok) {
            var errData;
            try { errData = await res.json(); } catch { errData = { message: res.statusText }; }
            throw new Error(errData.message || res.statusText);
        }
        var txt = await res.text();
        return txt ? JSON.parse(txt) : null;
    },

    // ---- Auth ----
    login: async function(email, password) {
        // Create email session
        var session = await this.req('POST', '/account/sessions/email', {
            email: email,
            password: password
        });
        return session;
    },

    getAccount: async function() {
        var user = await this.req('GET', '/account');
        return user;
    },

    logout: async function() {
        try {
            await this.req('DELETE', '/account/sessions/current');
        } catch {}
    },

    // ---- Database ----
    getAll: async function() {
        var userId = Auth.user ? Auth.user.$id : '';
        var queries = [
            'equal("userId",["' + userId + '"])',
            'limit(500)',
            'orderAsc("order")'
        ];
        var url = '/databases/' + AW.DATABASE_ID
                + '/collections/' + AW.COLLECTION_ID
                + '/documents?queries[]=' + queries.map(encodeURIComponent).join('&queries[]=');
        var res = await this.req('GET', url);
        return (res.documents || []).map(function(doc) { return docToLocal(doc); });
    },

    create: async function(item) {
        var body = {
            documentId: 'unique()',
            data: localToDoc(item)
        };
        var url = '/databases/' + AW.DATABASE_ID
                + '/collections/' + AW.COLLECTION_ID
                + '/documents';
        var res = await this.req('POST', url, body);
        return docToLocal(res);
    },

    update: async function(id, data) {
        var body = { data: {} };
        if (data.name !== undefined) body.data.name = data.name;
        if (data.url !== undefined) body.data.url = data.url;
        if (data.expanded !== undefined) body.data.expanded = data.expanded;
        if (data.order !== undefined) body.data.order = data.order;
        if (data.type !== undefined) body.data.type = data.type;
        if (data.parentId !== undefined) {
            body.data.parentId = data.parentId === null ? '' : data.parentId;
        }
        var url = '/databases/' + AW.DATABASE_ID
                + '/collections/' + AW.COLLECTION_ID
                + '/documents/' + id;
        var res = await this.req('PATCH', url, body);
        return docToLocal(res);
    },

    deleteDoc: async function(id) {
        var url = '/databases/' + AW.DATABASE_ID
                + '/collections/' + AW.COLLECTION_ID
                + '/documents/' + id;
        await this.req('DELETE', url);
    },

    batchUpdate: async function(updates) {
        // Appwrite has no native batch endpoint; run in parallel chunks
        var chunkSize = 10;
        for (var i = 0; i < updates.length; i += chunkSize) {
            var chunk = updates.slice(i, i + chunkSize);
            await Promise.all(chunk.map(function(u) {
                var d = { order: u.order };
                if (u.parentId !== undefined) d.parentId = u.parentId;
                return API.update(u.id, d);
            }));
        }
    }
};

// ============================================================
// DATA CONVERTERS
// ============================================================
function docToLocal(doc) {
    return {
        id: doc.$id,
        type: doc.type || 'bookmark',
        name: doc.name || '',
        url: doc.url || '',
        parentId: doc.parentId || null,
        order: typeof doc.order === 'number' ? doc.order : 0,
        expanded: doc.expanded !== false
    };
}

function localToDoc(item) {
    return {
        type: item.type || 'bookmark',
        name: item.name || '',
        url: item.url || '',
        parentId: item.parentId || '',
        order: item.order || 0,
        expanded: item.expanded !== false,
        userId: Auth.user ? Auth.user.$id : ''
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
        try { new URL(s); return s; } catch {}
    }
    s = s.replace(/^\/\//, '');
    if (/^[^\s]+\.[^\s]+/.test(s)) {
        try { new URL('https://' + s); return 'https://' + s; } catch {}
    }
    if (/^[a-zA-Z0-9][-a-zA-Z0-9]*$/.test(s)) return 'https://' + s + '.com';
    return 'https://' + s;
}

function extractUrlName(url) {
    try {
        var h = new URL(url).hostname.replace(/^www\./, '');
        return h.charAt(0).toUpperCase() + h.slice(1);
    } catch { return url.slice(0, 40); }
}

function displayUrl(url) {
    if (!url) return '';
    try {
        var u = new URL(url);
        var d = u.hostname.replace(/^www\./, '') + u.pathname;
        if (d.endsWith('/')) d = d.slice(0, -1);
        return d.length > 55 ? d.slice(0, 52) + '…' : d;
    } catch { return url.length > 55 ? url.slice(0, 52) + '…' : url; }
}

function faviconOf(url) {
    try { return 'https://www.google.com/s2/favicons?domain=' + new URL(url).hostname + '&sz=32'; }
    catch { return null; }
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
var $ = function(s) { return document.querySelector(s); };
var loginPage = $('#loginPage');
var appEl = $('#app');
var treeEl = $('#tree');
var emptyEl = $('#empty');
var searchInput = $('#searchInput');
var clearBtn = $('#clearSearch');
var modalEl = $('#modal');
var moveModalEl = $('#moveModal');
var ctxMenu = $('#ctx');
var dropZone = $('#dropZone');
var rootDrop = $('#rootDrop');
var toastEl = $('#toast');
var confirmModalEl = $('#confirmModal');
var logoutModalEl = $('#logoutModal');

// ============================================================
// BOOT
// ============================================================
(async function boot() {
    bindLogin();
    if (Auth.load()) {
        try {
            var user = await API.getAccount();
            Auth.user = user;
            sessionStorage.setItem('aw_user', JSON.stringify(user));
            await enterApp();
        } catch {
            showLogin();
        }
    } else {
        showLogin();
    }
})();

// ============================================================
// PAGE SWITCHING
// ============================================================
function showLogin() {
    loginPage.classList.remove('hidden');
    appEl.classList.add('hidden');
    bookmarks = [];
    treeEl.innerHTML = '';
}

async function enterApp() {
    loginPage.classList.add('hidden');
    appEl.classList.remove('hidden');

    try {
        bookmarks = await API.getAll();
    } catch {
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
    var userField = $('#loginUser');
    var passField = $('#loginPass');
    var errEl = $('#loginError');
    var btn = $('#loginBtn');
    var btnText = $('#loginBtnText');
    var spinner = $('#loginSpinner');
    var togglePass = $('#togglePass');

    togglePass.addEventListener('click', function() {
        var isPass = passField.type === 'password';
        passField.type = isPass ? 'text' : 'password';
        $('#eyeOpen').style.display = isPass ? 'none' : '';
        $('#eyeShut').style.display = isPass ? '' : 'none';
    });

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        var email = userField.value.trim();
        var password = passField.value;

        if (!email || !password) {
            errEl.textContent = 'Please enter both fields';
            errEl.classList.add('show');
            return;
        }

        btn.disabled = true;
        btnText.textContent = 'Signing in…';
        spinner.style.display = '';
        errEl.classList.remove('show');

        try {
            var session = await API.login(email, password);
            var user = await API.getAccount();
            Auth.save(session, user);
            form.reset();
            await enterApp();
        } catch (err) {
            var msg = 'Invalid email or password';
            if (err.message && !err.message.includes('<!')) {
                msg = err.message;
            }
            errEl.textContent = msg;
            errEl.classList.add('show');
            passField.value = '';
            passField.focus();
        } finally {
            btn.disabled = false;
            btnText.textContent = 'Sign In';
            spinner.style.display = 'none';
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
        h += '<button class="node-toggle ' + (open ? 'open' : '') + '" data-id="' + item.id + '">'
           + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">'
           + '<polyline points="9 18 15 12 9 6"/></svg></button>';
        h += '<span class="node-icon folder-ic"><svg viewBox="0 0 24 24" fill="currentColor">'
           + '<path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg></span>';
        h += '<span class="node-info"><span class="node-name">' + hlText(item.name, q) + '</span></span>';
        h += '<span class="node-count">' + kids.length + '</span>';
    } else {
        var fav = faviconOf(item.url);
        var ic = fav
            ? '<img src="' + fav + '" alt="" onerror="this.outerHTML=\'<svg viewBox=\\\'0 0 24 24\\\' fill=\\\'none\\\' stroke=\\\'currentColor\\\' stroke-width=\\\'2\\\'>'
              + '<path d=\\\'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z\\\'/></svg>\'">'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
              + '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
        h += '<span class="node-icon">' + ic + '</span>';
        h += '<span class="node-info"><span class="node-name">' + hlText(item.name, q) + '</span>'
           + '<span class="node-url-text">' + hlText(displayUrl(item.url), q) + '</span></span>';
    }

    h += '<span class="node-actions">'
       + '<button class="act" data-act="edit" data-id="' + item.id + '" title="Edit">'
       + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
       + '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>'
       + '<path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>'
       + '<button class="act del" data-act="delete" data-id="' + item.id + '" title="Delete">'
       + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
       + '<polyline points="3 6 5 6 21 6"/>'
       + '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>'
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
// APP EVENTS
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

    // Logout
    $('#logoutBtn').addEventListener('click', function() { logoutModalEl.classList.add('on'); });
    $('#logoutNo').addEventListener('click', function() { logoutModalEl.classList.remove('on'); });
    $('#logoutYes').addEventListener('click', async function() {
        logoutModalEl.classList.remove('on');
        await API.logout();
        Auth.clear();
        bookmarks = [];
        treeEl.innerHTML = '';
        appBound = false;
        showLogin();
        notify('Signed out');
    });
    logoutModalEl.addEventListener('click', function(e) {
        if (e.target === logoutModalEl) logoutModalEl.classList.remove('on');
    });

    // Modal
    $('#modalClose').addEventListener('click', closeModal);
    $('#cancelBtn').addEventListener('click', closeModal);
    modalEl.addEventListener('click', function(e) { if (e.target === modalEl) closeModal(); });
    $('#itemForm').addEventListener('submit', onSubmit);

    // Confirm
    $('#confirmNo').addEventListener('click', function() { closeConfirm(false); });
    $('#confirmYes').addEventListener('click', function() { closeConfirm(true); });
    confirmModalEl.addEventListener('click', function(e) {
        if (e.target === confirmModalEl) closeConfirm(false);
    });

    // Tree clicks
    treeEl.addEventListener('click', onTreeClick);
    treeEl.addEventListener('contextmenu', onCtxMenu);
    ctxMenu.querySelectorAll('button').forEach(function(b) {
        b.addEventListener('click', function() { doCtxAction(b.dataset.action); });
    });
    document.addEventListener('click', function(e) {
        if (!ctxMenu.contains(e.target)) ctxMenu.classList.remove('on');
    });

    // Move modal
    $('#moveClose').addEventListener('click', function() { moveModalEl.classList.remove('on'); });
    moveModalEl.addEventListener('click', function(e) {
        if (e.target === moveModalEl) moveModalEl.classList.remove('on');
    });

    // Mouse drag
    treeEl.addEventListener('mousedown', onPointerDown);
    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('mouseup', onPointerUp);

    // Touch drag
    treeEl.addEventListener('touchstart', onTouchStart, { passive: false });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);

    // External drag-and-drop
    var extC = 0;
    document.addEventListener('dragenter', function(e) {
        if (dragState.active || appEl.classList.contains('hidden')) return;
        var t = Array.from(e.dataTransfer.types);
        if (t.includes('text/uri-list') || t.includes('text/plain') || t.includes('text/html')) {
            extC++;
            dropZone.classList.add('active');
        }
    });
    document.addEventListener('dragover', function(e) {
        if (dragState.active || appEl.classList.contains('hidden')) return;
        var t = Array.from(e.dataTransfer.types);
        if (t.includes('text/uri-list') || t.includes('text/plain') || t.includes('text/html')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        }
    });
    document.addEventListener('dragleave', function() {
        if (dragState.active) return;
        extC--;
        if (extC <= 0) { extC = 0; dropZone.classList.remove('active'); }
    });
    document.addEventListener('drop', onExternalDrop);

    // Keyboard
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
    try { await API.update(item.id, { expanded: item.expanded }); } catch {}
    var li = treeEl.querySelector('.node[data-id="' + id + '"]');
    if (li) {
        var t = li.querySelector('.node-toggle');
        var k = li.querySelector('.folder-kids');
        if (t) t.classList.toggle('open', item.expanded);
        if (k) k.classList.toggle('shut', !item.expanded);
    }
}

// ============================================================
// MODAL (Add / Edit)
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
            var updated = await API.update(id, { name: name, url: url, parentId: parentId });
            var idx = bookmarks.findIndex(function(i) { return sid(i.id) === sid(id); });
            if (idx >= 0) {
                bookmarks[idx].name = name;
                bookmarks[idx].url = url;
                bookmarks[idx].parentId = parentId;
            }
            notify('Updated');
        } else {
            var newItem = {
                type: type,
                name: name,
                url: url,
                parentId: parentId,
                order: bookmarks.length,
                expanded: true
            };
            var created = await API.create(newItem);
            bookmarks.push(created);
            notify(type === 'folder' ? 'Folder created' : 'Bookmark saved');
        }
    } catch (err) {
        notify('Error: ' + err.message);
        return;
    }

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
        function collect(pid) {
            toDelete.push(pid);
            bookmarks.filter(function(i) { return pidMatch(i.parentId, pid); }).forEach(function(c) {
                collect(c.id);
            });
        }
        collect(item.id);

        for (var d = 0; d < toDelete.length; d++) {
            await API.deleteDoc(toDelete[d]);
        }

        bookmarks = bookmarks.filter(function(i) {
            return toDelete.indexOf(i.id) === -1;
        });
        notify('Deleted');
        render(searchInput.value);
    } catch (err) { notify('Error: ' + err.message); }
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
    var id = ctxId;
    ctxId = null;
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
        function collectDesc(pid) {
            bookmarks.filter(function(i) { return pidMatch(i.parentId, pid); }).forEach(function(c) {
                desc.push(sid(c.id));
                collectDesc(c.id);
            });
        }
        collectDesc(item.id);
    }

    var rootDiv = document.createElement('div');
    rootDiv.className = 'mv-item' + (!item.parentId ? ' current' : '');
    rootDiv.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> Root';
    rootDiv.addEventListener('click', function() { moveItemTo(item.id, null); });
    list.appendChild(rootDiv);

    function addFolders(pid, depth) {
        bookmarks
            .filter(function(f) {
                return f.type === 'folder'
                    && pidMatch(f.parentId, pid)
                    && sid(f.id) !== id
                    && desc.indexOf(sid(f.id)) === -1;
            })
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
        while (cur) {
            if (sid(cur) === sid(id)) { notify('Cannot move into itself'); return; }
            var p = bookmarks.find(function(i) { return sid(i.id) === sid(cur); });
            cur = p ? (p.parentId || null) : null;
        }
    }

    try {
        var newOrder = bookmarks.filter(function(i) { return pidMatch(i.parentId, newPid); }).length;
        await API.update(id, { parentId: newPid, order: newOrder });
        item.parentId = newPid;
        reorderSibs(newPid);
        moveModalEl.classList.remove('on');
        notify('Moved');
        render(searchInput.value);
    } catch (err) { notify('Error: ' + err.message); }
}

function reorderSibs(pid) {
    bookmarks
        .filter(function(i) { return pidMatch(i.parentId, pid); })
        .sort(function(a, b) { return (a.order || 0) - (b.order || 0); })
        .forEach(function(s, idx) { s.order = idx; });
}

// ============================================================
// DRAG & DROP
// ============================================================
var DRAG_THRESHOLD = 8;
var LONG_PRESS_MS = 400;

function createGhost(item) {
    var g = document.createElement('div');
    g.className = 'drag-ghost';
    g.textContent = item.name;
    document.body.appendChild(g);
    return g;
}

function clearHighlights() {
    document.querySelectorAll('.drag-over-folder,.dragging').forEach(function(el) {
        el.classList.remove('drag-over-folder', 'dragging');
    });
    document.querySelectorAll('.drop-bar').forEach(function(el) { el.remove(); });
    rootDrop.classList.remove('drag-hover');
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
    var yPos = y - rect.top;
    var h = rect.height;
    var isFolder = row.dataset.type === 'folder';

    if (isFolder) {
        if (yPos < h * 0.25) return { type: 'before', id: row.dataset.id, row: row };
        if (yPos > h * 0.75) return { type: 'after', id: row.dataset.id, row: row };
        return { type: 'inside', id: row.dataset.id, row: row };
    }
    return yPos < h * 0.5
        ? { type: 'before', id: row.dataset.id, row: row }
        : { type: 'after', id: row.dataset.id, row: row };
}

function showDropIndicator(target) {
    clearHighlights();
    var srcRow = treeEl.querySelector('.node-row[data-id="' + dragState.id + '"]');
    if (srcRow) srcRow.classList.add('dragging');
    if (!target) return;

    if (target.type === 'root') { rootDrop.classList.add('drag-hover'); return; }
    if (target.type === 'inside') { target.row.classList.add('drag-over-folder'); return; }

    var bar = document.createElement('div');
    bar.className = 'drop-bar';
    var node = target.row.closest('.node');
    if (!node) return;

    if (target.type === 'before') node.parentNode.insertBefore(bar, node);
    else node.parentNode.insertBefore(bar, node.nextSibling);
}

async function executeDrop(target) {
    if (!target || !dragState.id) return;
    var dragged = bookmarks.find(function(i) { return sid(i.id) === dragState.id; });
    if (!dragged) return;

    try {
        if (target.type === 'root') {
            var oldPid = dragged.parentId;
            dragged.parentId = null;
            reorderSibs(null);
            reorderSibs(oldPid);
            await API.update(dragged.id, { parentId: null, order: dragged.order });
            notify('Moved to root');

        } else if (target.type === 'inside') {
            var folder = bookmarks.find(function(i) { return sid(i.id) === target.id; });
            if (!folder) return;

            if (dragged.type === 'folder') {
                var cur = folder.id;
                while (cur) {
                    if (sid(cur) === sid(dragged.id)) { notify('Cannot move into itself'); return; }
                    var par = bookmarks.find(function(i) { return sid(i.id) === sid(cur); });
                    cur = par ? (par.parentId || null) : null;
                }
            }

            var oldPid2 = dragged.parentId;
            dragged.parentId = folder.id;
            reorderSibs(folder.id);
            reorderSibs(oldPid2);

            if (!folder.expanded) {
                folder.expanded = true;
                try { await API.update(folder.id, { expanded: true }); } catch {}
            }

            await API.update(dragged.id, { parentId: folder.id, order: dragged.order });
            notify('Moved to ' + folder.name);

        } else {
            var targetItem = bookmarks.find(function(i) { return sid(i.id) === target.id; });
            if (!targetItem) return;

            var oldPid3 = dragged.parentId;
            var newPid = targetItem.parentId || null;

            if (dragged.type === 'folder' && newPid) {
                var check = newPid;
                while (check) {
                    if (sid(check) === sid(dragged.id)) { notify('Cannot move there'); return; }
                    var pp = bookmarks.find(function(i) { return sid(i.id) === sid(check); });
                    check = pp ? (pp.parentId || null) : null;
                }
            }

            dragged.parentId = newPid;

            var sibs = bookmarks
                .filter(function(i) { return pidMatch(i.parentId, newPid) && sid(i.id) !== sid(dragged.id); })
                .sort(function(a, b) { return (a.order || 0) - (b.order || 0); });

            var ti = sibs.findIndex(function(s) { return sid(s.id) === sid(targetItem.id); });
            var insertIdx = target.type === 'before' ? ti : ti + 1;
            sibs.splice(insertIdx, 0, dragged);

            var updates = sibs.map(function(s, idx) {
                s.order = idx;
                return { id: s.id, parentId: newPid, order: idx };
            });

            reorderSibs(oldPid3);

            await API.batchUpdate(updates);
            notify('Reordered');
        }
    } catch (err) { notify('Error: ' + err.message); }

    render(searchInput.value);
}

// ---- Mouse ----
function onPointerDown(e) {
    if (e.button !== 0) return;
    var row = e.target.closest('.node-row');
    if (!row || e.target.closest('.act,.node-toggle')) return;
    dragState.id = row.dataset.id;
    dragState.startX = e.clientX;
    dragState.startY = e.clientY;
    dragState.moved = false;
    dragState.active = false;
}

function onPointerMove(e) {
    if (!dragState.id) return;
    if (!dragState.active) {
        if (Math.abs(e.clientX - dragState.startX) < DRAG_THRESHOLD && Math.abs(e.clientY - dragState.startY) < DRAG_THRESHOLD) return;
        dragState.active = true;
        dragState.moved = true;
        var item = bookmarks.find(function(i) { return sid(i.id) === dragState.id; });
        if (!item) { dragState.id = null; return; }
        dragState.ghostEl = createGhost(item);
        rootDrop.style.display = 'block';
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
    }
    dragState.ghostEl.style.left = (e.clientX + 12) + 'px';
    dragState.ghostEl.style.top = (e.clientY - 12) + 'px';
    showDropIndicator(getDropTarget(e.clientX, e.clientY));
}

function onPointerUp(e) {
    if (!dragState.id) return;
    if (dragState.active) {
        var target = getDropTarget(e.clientX, e.clientY);
        clearHighlights();
        if (dragState.ghostEl) { dragState.ghostEl.remove(); dragState.ghostEl = null; }
        rootDrop.style.display = 'none';
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        executeDrop(target);
    }
    var wasMoved = dragState.moved;
    dragState.id = null;
    dragState.active = false;
    if (wasMoved) setTimeout(function() { dragState.moved = false; }, 50);
}

// ---- Touch ----
function onTouchStart(e) {
    var row = e.target.closest('.node-row');
    if (!row || e.target.closest('.act,.node-toggle')) return;
    var touch = e.touches[0];
    dragState.startX = touch.clientX;
    dragState.startY = touch.clientY;
    dragState.moved = false;
    dragState.active = false;

    var rowId = row.dataset.id;
    dragState.timer = setTimeout(function() {
        dragState.id = rowId;
        dragState.active = true;
        dragState.moved = true;
        var item = bookmarks.find(function(i) { return sid(i.id) === rowId; });
        if (!item) { dragState.id = null; dragState.active = false; return; }
        dragState.ghostEl = createGhost(item);
        dragState.ghostEl.style.left = (touch.clientX + 12) + 'px';
        dragState.ghostEl.style.top = (touch.clientY - 12) + 'px';
        rootDrop.style.display = 'block';
        if (navigator.vibrate) navigator.vibrate(30);
    }, LONG_PRESS_MS);
}

function onTouchMove(e) {
    var touch = e.touches[0];
    if (dragState.timer && !dragState.active) {
        if (Math.abs(touch.clientX - dragState.startX) > 10 || Math.abs(touch.clientY - dragState.startY) > 10) {
            clearTimeout(dragState.timer);
            dragState.timer = null;
        }
        return;
    }
    if (!dragState.active) return;
    e.preventDefault();
    if (dragState.ghostEl) {
        dragState.ghostEl.style.left = (touch.clientX + 12) + 'px';
        dragState.ghostEl.style.top = (touch.clientY - 12) + 'px';
    }
    showDropIndicator(getDropTarget(touch.clientX, touch.clientY));
}

function onTouchEnd(e) {
    clearTimeout(dragState.timer);
    dragState.timer = null;
    if (!dragState.active) return;
    var touch = e.changedTouches[0];
    var target = getDropTarget(touch.clientX, touch.clientY);
    clearHighlights();
    if (dragState.ghostEl) { dragState.ghostEl.remove(); dragState.ghostEl = null; }
    rootDrop.style.display = 'none';
    executeDrop(target);
    dragState.id = null;
    dragState.active = false;
    setTimeout(function() { dragState.moved = false; }, 50);
}

// ---- External Drop ----
async function onExternalDrop(e) {
    dropZone.classList.remove('active');
    if (dragState.active || appEl.classList.contains('hidden')) return;

    var uriList = e.dataTransfer.getData('text/uri-list');
    var plain = e.dataTransfer.getData('text/plain');
    var htmlData = e.dataTransfer.getData('text/html');
    var urls = [];

    if (htmlData) {
        var doc = new DOMParser().parseFromString(htmlData, 'text/html');
        doc.querySelectorAll('a[href]').forEach(function(a) {
            var href = a.href.trim();
            if (/^https?:\/\//i.test(href)) urls.push({ url: href, name: a.textContent.trim() || '' });
        });
    }
    if (!urls.length && uriList) {
        uriList.split('\n').filter(function(l) { return l.trim() && !l.startsWith('#'); }).forEach(function(l) {
            if (/^https?:\/\//i.test(l.trim())) urls.push({ url: l.trim(), name: '' });
        });
    }
    if (!urls.length && plain) {
        var norm = normalizeUrl(plain);
        if (/^https?:\/\//i.test(norm)) urls.push({ url: norm, name: '' });
    }
    if (!urls.length) return;
    e.preventDefault();

    try {
        for (var u = 0; u < urls.length; u++) {
            var entry = urls[u];
            var created = await API.create({
                type: 'bookmark',
                name: entry.name || extractUrlName(entry.url),
                url: entry.url,
                parentId: null,
                order: bookmarks.length,
                expanded: true
            });
            bookmarks.push(created);
        }
        notify(urls.length + ' bookmark' + (urls.length > 1 ? 's' : '') + ' saved');
        render(searchInput.value);
    } catch (err) { notify('Error: ' + err.message); }
}

// ============================================================
// TOAST
// ============================================================
var toastTimer;
function notify(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function() { toastEl.classList.remove('show'); }, 2400);
}