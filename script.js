// ============================================================
// CONFIG
// ============================================================
const AW_ENDPOINT = 'https://sfo.cloud.appwrite.io/v1';
const AW_PROJECT  = '6a6dd3c900350363b8e7';
const AW_DB       = '6a6dd4fb001f662f0f79';
const AW_COL      = 'bookmarks';

// ============================================================
// INIT
// ============================================================
const { Client, Account, Databases, ID, Query } = Appwrite;

const client    = new Client().setEndpoint(AW_ENDPOINT).setProject(AW_PROJECT);
const account   = new Account(client);
const databases = new Databases(client);

let currentUser = null;
let bookmarks   = [];
let appBound    = false;
let confirmResolve = null;
let ctxId       = null;
let toastTimer  = null;

const dragState = {
    id: null, ghostEl: null, timer: null,
    active: false, startX: 0, startY: 0, moved: false
};

// ============================================================
// DOM REFS
// ============================================================
const loginPage    = document.getElementById('loginPage');
const appEl        = document.getElementById('app');
const treeEl       = document.getElementById('tree');
const emptyEl      = document.getElementById('empty');
const searchInput  = document.getElementById('searchInput');
const clearBtn     = document.getElementById('clearSearch');
const modalEl      = document.getElementById('modal');
const moveModalEl  = document.getElementById('moveModal');
const ctxMenu      = document.getElementById('ctx');
const dropZone     = document.getElementById('dropZone');
const rootDrop     = document.getElementById('rootDrop');
const toastEl      = document.getElementById('toast');
const confirmModal = document.getElementById('confirmModal');
const logoutModal  = document.getElementById('logoutModal');

// ============================================================
// BOOT
// ============================================================
(async () => {
    try {
        currentUser = await account.get();
        enterApp();
    } catch (e) {
        showLogin();
    }
})();

// ============================================================
// AUTH
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
        bookmarks = await loadAll();
    } catch (e) {
        bookmarks = [];
        notify('Failed to load bookmarks');
    }
    render();
    bindApp();
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;
    const errEl    = document.getElementById('loginError');
    const btn      = document.getElementById('loginBtn');
    const btnText  = document.getElementById('loginBtnText');
    const spinner  = document.getElementById('loginSpinner');

    errEl.classList.remove('show');
    btn.disabled = true;
    btnText.textContent = 'Signing in…';
    spinner.style.display = '';

    try {
        try { await account.deleteSession('current'); } catch (e) {}
        await account.createEmailPasswordSession(email, password);
        currentUser = await account.get();
        document.getElementById('loginForm').reset();
        await enterApp();
    } catch (err) {
        let msg = 'Invalid email or password';
        if (err && err.message) {
            if (err.message.includes('Rate limit')) msg = 'Too many attempts. Please wait.';
            else if (err.message.includes('Network')) msg = 'Network error. Check your connection.';
            else if (err.message.includes('hostname') || err.message.includes('platform')) msg = 'Add your domain to Appwrite platforms.';
            else msg = err.message;
        }
        errEl.textContent = msg;
        errEl.classList.add('show');
        document.getElementById('loginPass').value = '';
    } finally {
        btn.disabled = false;
        btnText.textContent = 'Sign In';
        spinner.style.display = 'none';
    }
});

document.getElementById('togglePass').addEventListener('click', () => {
    const p = document.getElementById('loginPass');
    const isPass = p.type === 'password';
    p.type = isPass ? 'text' : 'password';
    document.getElementById('eyeOpen').style.display = isPass ? 'none' : '';
    document.getElementById('eyeShut').style.display = isPass ? '' : 'none';
});

// ============================================================
// DATABASE
// ============================================================
async function loadAll() {
    const all = [];
    let lastId = null;
    let more = true;

    while (more) {
        const q = [
            Query.equal('userID', currentUser.$id),
            Query.orderAsc('order'),
            Query.limit(100)
        ];
        if (lastId) q.push(Query.cursorAfter(lastId));

        const res = await databases.listDocuments(AW_DB, AW_COL, q);
        all.push(...res.documents.map(docToLocal));

        if (res.documents.length < 100) {
            more = false;
        } else {
            lastId = res.documents[res.documents.length - 1].$id;
        }
    }
    return all;
}

async function dbCreate(item) {
    const res = await databases.createDocument(AW_DB, AW_COL, ID.unique(), localToDoc(item));
    return docToLocal(res);
}

async function dbUpdate(id, fields) {
    const patch = {};
    if (fields.name      !== undefined) patch.name     = fields.name;
    if (fields.url       !== undefined) patch.url      = fields.url;
    if (fields.expanded  !== undefined) patch.expanded = fields.expanded;
    if (fields.order     !== undefined) patch.order    = fields.order;
    if (fields.type      !== undefined) patch.type     = fields.type;
    if (fields.parentId  !== undefined) patch.parentId = fields.parentId === null ? '' : String(fields.parentId);
    const res = await databases.updateDocument(AW_DB, AW_COL, id, patch);
    return docToLocal(res);
}

async function dbDelete(id) {
    await databases.deleteDocument(AW_DB, AW_COL, id);
}

async function dbBatchUpdate(updates) {
    for (let i = 0; i < updates.length; i += 5) {
        const chunk = updates.slice(i, i + 5);
        await Promise.all(chunk.map(u => {
            const d = { order: u.order };
            if (u.parentId !== undefined) d.parentId = u.parentId;
            return dbUpdate(u.id, d);
        }));
    }
}

// ============================================================
// CONVERTERS
// ============================================================
function docToLocal(doc) {
    return {
        id:       doc.$id,
        type:     doc.type     || 'bookmark',
        name:     doc.name     || '',
        url:      doc.url      || '',
        parentId: (doc.parentId && doc.parentId !== '') ? doc.parentId : null,
        order:    typeof doc.order === 'number' ? doc.order : 0,
        expanded: doc.expanded !== false
    };
}

function localToDoc(item) {
    return {
        type:     item.type     || 'bookmark',
        name:     item.name     || '',
        url:      item.url      || '',
        parentId: item.parentId ? String(item.parentId) : '',
        order:    item.order    || 0,
        expanded: item.expanded !== false,
        userID:   currentUser.$id
    };
}

// ============================================================
// HELPERS
// ============================================================
function sid(id)         { return String(id || ''); }
function pidMatch(a, b)  { return sid(a) === sid(b); }

function normalizeUrl(raw) {
    let s = raw.trim();
    if (!s) return '';
    s = s.replace(/^["'<\s]+|["'>\s]+$/g, '');
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(s)) { try { new URL(s); return s; } catch (e) {} }
    s = s.replace(/^\/\//, '');
    if (/^[^\s]+\.[^\s]+/.test(s)) { try { new URL('https://' + s); return 'https://' + s; } catch (e) {} }
    if (/^[a-zA-Z0-9][-a-zA-Z0-9]*$/.test(s)) return 'https://' + s + '.com';
    return 'https://' + s;
}

function extractUrlName(url) {
    try { const h = new URL(url).hostname.replace(/^www\./, ''); return h.charAt(0).toUpperCase() + h.slice(1); }
    catch (e) { return url.slice(0, 40); }
}

function displayUrl(url) {
    if (!url) return '';
    try {
        const u = new URL(url);
        let d = u.hostname.replace(/^www\./, '') + u.pathname;
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
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function hlText(text, term) {
    const safe = esc(text);
    if (!term) return safe;
    return safe.replace(new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<span class="hl">$1</span>');
}

function notify(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

// ============================================================
// CUSTOM CONFIRM
// ============================================================
function customConfirm(title, message, label) {
    return new Promise(resolve => {
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmMsg').textContent   = message;
        document.getElementById('confirmYes').textContent   = label || 'Delete';
        confirmModal.classList.add('on');
        confirmResolve = resolve;
    });
}

function closeConfirm(result) {
    confirmModal.classList.remove('on');
    if (confirmResolve) { const r = confirmResolve; confirmResolve = null; r(result); }
}

// ============================================================
// RENDER
// ============================================================
function getChildren(pid) {
    return bookmarks
        .filter(i => pidMatch(i.parentId, pid))
        .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function render(q) {
    const term = (q || '').toLowerCase().trim();
    treeEl.innerHTML = '';

    if (term) {
        const hits = bookmarks.filter(i =>
            i.name.toLowerCase().includes(term) || (i.url && i.url.toLowerCase().includes(term))
        );
        if (!hits.length) { treeEl.innerHTML = '<li class="no-results">No results</li>'; emptyEl.classList.add('hide'); return; }
        hits.forEach(i => treeEl.appendChild(mkNode(i, term)));
        emptyEl.classList.add('hide');
    } else {
        const roots = getChildren(null);
        if (!roots.length) { emptyEl.classList.remove('hide'); return; }
        emptyEl.classList.add('hide');
        roots.forEach(i => treeEl.appendChild(mkNode(i)));
    }
}

function mkNode(item, q) {
    q = q || '';
    const li  = document.createElement('li');
    li.className    = 'node';
    li.dataset.id   = item.id;

    const row = document.createElement('div');
    row.className   = 'node-row';
    row.dataset.id  = item.id;
    row.dataset.type = item.type;

    const isFolder = item.type === 'folder';
    const kids = bookmarks.filter(i => pidMatch(i.parentId, item.id));
    let h = '';

    if (isFolder) {
        const open = item.expanded !== false;
        h += `<button class="node-toggle ${open ? 'open' : ''}" data-id="${item.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></button>`;
        h += `<span class="node-icon folder-ic"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg></span>`;
        h += `<span class="node-info"><span class="node-name">${hlText(item.name, q)}</span></span>`;
        h += `<span class="node-count">${kids.length}</span>`;
    } else {
        const fav = faviconOf(item.url);
        const ic  = fav
            ? `<img src="${fav}" alt="" onerror="this.outerHTML='<svg viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\'><path d=\\'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z\\'/></svg>'">`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
        h += `<span class="node-icon">${ic}</span>`;
        h += `<span class="node-info"><span class="node-name">${hlText(item.name, q)}</span><span class="node-url-text">${hlText(displayUrl(item.url), q)}</span></span>`;
    }

    h += `<span class="node-actions">
        <button class="act" data-act="edit" data-id="${item.id}" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="act del" data-act="delete" data-id="${item.id}" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
    </span>`;

    row.innerHTML = h;
    li.appendChild(row);

    if (isFolder && !q) {
        const wrap = document.createElement('div');
        wrap.className = 'folder-kids' + (item.expanded === false ? ' shut' : '');
        const ul = document.createElement('ul');
        getChildren(item.id).forEach(c => ul.appendChild(mkNode(c)));
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

    searchInput.addEventListener('input', () => {
        clearBtn.classList.toggle('show', searchInput.value.length > 0);
        render(searchInput.value);
    });

    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearBtn.classList.remove('show');
        render();
        searchInput.focus();
    });

    document.getElementById('addBtn').addEventListener('click', () => openModal('bookmark'));
    document.getElementById('addFolderBtn').addEventListener('click', () => openModal('folder'));

    document.getElementById('logoutBtn').addEventListener('click', () => logoutModal.classList.add('on'));
    document.getElementById('logoutNo').addEventListener('click', () => logoutModal.classList.remove('on'));
    document.getElementById('logoutYes').addEventListener('click', async () => {
        logoutModal.classList.remove('on');
        try { await account.deleteSession('current'); } catch (e) {}
        currentUser = null;
        bookmarks = [];
        appBound = false;
        treeEl.innerHTML = '';
        showLogin();
        notify('Signed out');
    });
    logoutModal.addEventListener('click', e => { if (e.target === logoutModal) logoutModal.classList.remove('on'); });

    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('cancelBtn').addEventListener('click', closeModal);
    modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(); });
    document.getElementById('itemForm').addEventListener('submit', onSubmit);

    document.getElementById('confirmNo').addEventListener('click', () => closeConfirm(false));
    document.getElementById('confirmYes').addEventListener('click', () => closeConfirm(true));
    confirmModal.addEventListener('click', e => { if (e.target === confirmModal) closeConfirm(false); });

    treeEl.addEventListener('click', onTreeClick);
    treeEl.addEventListener('contextmenu', onCtxMenu);
    ctxMenu.querySelectorAll('button').forEach(b => b.addEventListener('click', () => doCtxAction(b.dataset.action)));
    document.addEventListener('click', e => { if (!ctxMenu.contains(e.target)) ctxMenu.classList.remove('on'); });

    document.getElementById('moveClose').addEventListener('click', () => moveModalEl.classList.remove('on'));
    moveModalEl.addEventListener('click', e => { if (e.target === moveModalEl) moveModalEl.classList.remove('on'); });

    treeEl.addEventListener('mousedown', onPointerDown);
    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('mouseup', onPointerUp);
    treeEl.addEventListener('touchstart', onTouchStart, { passive: false });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);

    let extC = 0;
    document.addEventListener('dragenter', e => {
        if (dragState.active || appEl.classList.contains('hidden')) return;
        const t = Array.from(e.dataTransfer.types);
        if (t.includes('text/uri-list') || t.includes('text/plain') || t.includes('text/html')) { extC++; dropZone.classList.add('active'); }
    });
    document.addEventListener('dragover', e => {
        if (dragState.active || appEl.classList.contains('hidden')) return;
        const t = Array.from(e.dataTransfer.types);
        if (t.includes('text/uri-list') || t.includes('text/plain') || t.includes('text/html')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    });
    document.addEventListener('dragleave', () => {
        if (dragState.active) return;
        extC--;
        if (extC <= 0) { extC = 0; dropZone.classList.remove('active'); }
    });
    document.addEventListener('drop', onExternalDrop);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            closeModal();
            moveModalEl.classList.remove('on');
            ctxMenu.classList.remove('on');
            logoutModal.classList.remove('on');
            closeConfirm(false);
        }
    });
}

// ============================================================
// TREE CLICKS
// ============================================================
function onTreeClick(e) {
    const tog = e.target.closest('.node-toggle');
    if (tog) { e.stopPropagation(); toggleFolder(tog.dataset.id); return; }
    const act = e.target.closest('.act');
    if (act) {
        e.stopPropagation();
        if (act.dataset.act === 'edit') editItem(act.dataset.id);
        else if (act.dataset.act === 'delete') delItem(act.dataset.id);
        return;
    }
    if (dragState.active || dragState.moved) return;
    const row = e.target.closest('.node-row');
    if (!row) return;
    const item = bookmarks.find(i => sid(i.id) === row.dataset.id);
    if (item && item.type === 'bookmark' && item.url) window.open(item.url, '_blank', 'noopener');
}

async function toggleFolder(id) {
    const item = bookmarks.find(i => sid(i.id) === id);
    if (!item) return;
    item.expanded = !item.expanded;
    try { await dbUpdate(item.id, { expanded: item.expanded }); } catch (e) {}
    const li = treeEl.querySelector(`.node[data-id="${id}"]`);
    if (li) {
        const t = li.querySelector('.node-toggle');
        const k = li.querySelector('.folder-kids');
        if (t) t.classList.toggle('open', item.expanded);
        if (k) k.classList.toggle('shut', !item.expanded);
    }
}

// ============================================================
// MODAL
// ============================================================
function openModal(type, editId) {
    const form = document.getElementById('itemForm');
    form.reset();
    document.getElementById('itemId').value   = '';
    document.getElementById('itemType').value = type;
    const urlField = document.getElementById('itemUrl');
    urlField.classList.toggle('hide', type === 'folder');
    document.getElementById('modalTitle').textContent = editId
        ? (type === 'folder' ? 'Edit Folder' : 'Edit Bookmark')
        : (type === 'folder' ? 'New Folder'  : 'Add Bookmark');
    populateParentSelect(editId);
    if (editId) {
        const item = bookmarks.find(i => sid(i.id) === sid(editId));
        if (!item) return;
        document.getElementById('itemId').value   = item.id;
        document.getElementById('itemType').value = item.type;
        document.getElementById('itemName').value = item.name;
        document.getElementById('itemUrl').value  = item.url || '';
        urlField.classList.toggle('hide', item.type === 'folder');
        document.getElementById('itemParent').value = item.parentId || '';
    }
    modalEl.classList.add('on');
    setTimeout(() => document.getElementById('itemName').focus(), 80);
}

function closeModal() { modalEl.classList.remove('on'); }

function populateParentSelect(excl) {
    const sel = document.getElementById('itemParent');
    sel.innerHTML = '<option value="">— Root —</option>';
    const folders = bookmarks.filter(i => i.type === 'folder' && sid(i.id) !== sid(excl));
    function addOpts(pid, depth) {
        folders.filter(f => pidMatch(f.parentId, pid)).forEach(f => {
            const o = document.createElement('option');
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
    const id       = document.getElementById('itemId').value;
    const type     = document.getElementById('itemType').value;
    const name     = document.getElementById('itemName').value.trim();
    let   url      = document.getElementById('itemUrl').value.trim();
    const parentId = document.getElementById('itemParent').value || null;
    if (!name) return;
    if (type === 'bookmark' && url) url = normalizeUrl(url);
    try {
        if (id) {
            await dbUpdate(id, { name, url, parentId });
            const idx = bookmarks.findIndex(i => sid(i.id) === sid(id));
            if (idx >= 0) { bookmarks[idx].name = name; bookmarks[idx].url = url; bookmarks[idx].parentId = parentId; }
            notify('Updated');
        } else {
            const created = await dbCreate({ type, name, url, parentId, order: bookmarks.length, expanded: true });
            bookmarks.push(created);
            notify(type === 'folder' ? 'Folder created' : 'Bookmark saved');
        }
    } catch (err) { notify('Error: ' + (err.message || err)); return; }
    closeModal();
    render(searchInput.value);
}

function editItem(id) {
    const item = bookmarks.find(i => sid(i.id) === id);
    if (!item) return;
    openModal(item.type, id);
}

async function delItem(id) {
    const item = bookmarks.find(i => sid(i.id) === id);
    if (!item) return;
    const kids = bookmarks.filter(i => sid(i.parentId) === id).length;
    const msg  = item.type === 'folder' && kids
        ? `This will delete "${item.name}" and ${kids} item${kids > 1 ? 's' : ''} inside it.`
        : `Are you sure you want to delete "${item.name}"?`;
    const yes = await customConfirm('Delete', msg, 'Delete');
    if (!yes) return;
    try {
        const toDelete = [];
        function collect(pid) { toDelete.push(pid); bookmarks.filter(i => pidMatch(i.parentId, pid)).forEach(c => collect(c.id)); }
        collect(item.id);
        for (const d of toDelete) await dbDelete(d);
        bookmarks = bookmarks.filter(i => !toDelete.includes(i.id));
        notify('Deleted');
        render(searchInput.value);
    } catch (err) { notify('Error: ' + (err.message || err)); }
}

// ============================================================
// CONTEXT MENU
// ============================================================
function onCtxMenu(e) {
    const row = e.target.closest('.node-row');
    if (!row) return;
    e.preventDefault();
    ctxId = row.dataset.id;
    ctxMenu.style.left = Math.min(e.clientX, innerWidth  - 180) + 'px';
    ctxMenu.style.top  = Math.min(e.clientY, innerHeight - 140) + 'px';
    ctxMenu.classList.add('on');
}

function doCtxAction(action) {
    ctxMenu.classList.remove('on');
    if (!ctxId) return;
    const id = ctxId; ctxId = null;
    if (action === 'edit')   editItem(id);
    if (action === 'move')   openMoveModal(id);
    if (action === 'delete') delItem(id);
}

// ============================================================
// MOVE MODAL
// ============================================================
function openMoveModal(id) {
    const item = bookmarks.find(i => sid(i.id) === id);
    if (!item) return;
    const list = document.getElementById('moveList');
    list.innerHTML = '';
    const desc = [];
    if (item.type === 'folder') {
        function collectDesc(pid) { bookmarks.filter(i => pidMatch(i.parentId, pid)).forEach(c => { desc.push(sid(c.id)); collectDesc(c.id); }); }
        collectDesc(item.id);
    }
    const rootDiv = document.createElement('div');
    rootDiv.className = 'mv-item' + (!item.parentId ? ' current' : '');
    rootDiv.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> Root';
    rootDiv.addEventListener('click', () => moveItemTo(item.id, null));
    list.appendChild(rootDiv);
    function addFolders(pid, depth) {
        bookmarks
            .filter(f => f.type === 'folder' && pidMatch(f.parentId, pid) && sid(f.id) !== id && !desc.includes(sid(f.id)))
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .forEach(f => {
                const d = document.createElement('div');
                d.className = 'mv-item' + (pidMatch(item.parentId, f.id) ? ' current' : '');
                d.style.paddingLeft = (12 + depth * 16) + 'px';
                d.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg> ${esc(f.name)}`;
                d.addEventListener('click', () => moveItemTo(item.id, f.id));
                list.appendChild(d);
                addFolders(f.id, depth + 1);
            });
    }
    addFolders(null, 0);
    moveModalEl.classList.add('on');
}

async function moveItemTo(id, newPid) {
    const item = bookmarks.find(i => sid(i.id) === sid(id));
    if (!item) return;
    if (item.type === 'folder' && newPid) {
        let cur = newPid;
        while (cur) {
            if (sid(cur) === sid(id)) { notify('Cannot move into itself'); return; }
            const p = bookmarks.find(i => sid(i.id) === sid(cur));
            cur = p ? (p.parentId || null) : null;
        }
    }
    try {
        const newOrder = bookmarks.filter(i => pidMatch(i.parentId, newPid)).length;
        await dbUpdate(id, { parentId: newPid, order: newOrder });
        item.parentId = newPid;
        reorderSibs(newPid);
        moveModalEl.classList.remove('on');
        notify('Moved');
        render(searchInput.value);
    } catch (err) { notify('Error: ' + (err.message || err)); }
}

function reorderSibs(pid) {
    bookmarks.filter(i => pidMatch(i.parentId, pid)).sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((s, idx) => { s.order = idx; });
}

// ============================================================
// DRAG & DROP
// ============================================================
const DRAG_THRESHOLD = 8;
const LONG_PRESS_MS  = 400;

function createGhost(item) {
    const g = document.createElement('div');
    g.className = 'drag-ghost';
    g.textContent = item.name;
    document.body.appendChild(g);
    return g;
}

function clearHighlights() {
    document.querySelectorAll('.drag-over-folder,.dragging').forEach(el => el.classList.remove('drag-over-folder', 'dragging'));
    document.querySelectorAll('.drop-bar').forEach(el => el.remove());
    rootDrop.classList.remove('drag-hover');
}

function getDropTarget(x, y) {
    if (dragState.ghostEl) dragState.ghostEl.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    if (dragState.ghostEl) dragState.ghostEl.style.display = '';
    if (!el) return null;
    if (el.closest('#rootDrop')) return { type: 'root' };
    const row = el.closest('.node-row');
    if (!row || row.dataset.id === dragState.id) return null;
    const rect = row.getBoundingClientRect();
    const yPos = y - rect.top;
    const h    = rect.height;
    const isFolder = row.dataset.type === 'folder';
    if (isFolder) {
        if (yPos < h * 0.25) return { type: 'before', id: row.dataset.id, row };
        if (yPos > h * 0.75) return { type: 'after',  id: row.dataset.id, row };
        return { type: 'inside', id: row.dataset.id, row };
    }
    return yPos < h * 0.5 ? { type: 'before', id: row.dataset.id, row } : { type: 'after', id: row.dataset.id, row };
}

function showDropIndicator(target) {
    clearHighlights();
    const srcRow = treeEl.querySelector(`.node-row[data-id="${dragState.id}"]`);
    if (srcRow) srcRow.classList.add('dragging');
    if (!target) return;
    if (target.type === 'root')   { rootDrop.classList.add('drag-hover'); return; }
    if (target.type === 'inside') { target.row.classList.add('drag-over-folder'); return; }
    const bar  = document.createElement('div');
    bar.className = 'drop-bar';
    const node = target.row.closest('.node');
    if (!node) return;
    if (target.type === 'before') node.parentNode.insertBefore(bar, node);
    else node.parentNode.insertBefore(bar, node.nextSibling);
}

async function executeDrop(target) {
    if (!target || !dragState.id) return;
    const dragged = bookmarks.find(i => sid(i.id) === dragState.id);
    if (!dragged) return;
    try {
        if (target.type === 'root') {
            const op = dragged.parentId; dragged.parentId = null;
            reorderSibs(null); reorderSibs(op);
            await dbUpdate(dragged.id, { parentId: null, order: dragged.order });
            notify('Moved to root');
        } else if (target.type === 'inside') {
            const folder = bookmarks.find(i => sid(i.id) === target.id);
            if (!folder) return;
            if (dragged.type === 'folder') {
                let c = folder.id;
                while (c) {
                    if (sid(c) === sid(dragged.id)) { notify('Cannot move into itself'); return; }
                    const pp = bookmarks.find(i => sid(i.id) === sid(c));
                    c = pp ? (pp.parentId || null) : null;
                }
            }
            const op2 = dragged.parentId; dragged.parentId = folder.id;
            reorderSibs(folder.id); reorderSibs(op2);
            if (!folder.expanded) { folder.expanded = true; try { await dbUpdate(folder.id, { expanded: true }); } catch (e) {} }
            await dbUpdate(dragged.id, { parentId: folder.id, order: dragged.order });
            notify('Moved to ' + folder.name);
        } else {
            const ti2 = bookmarks.find(i => sid(i.id) === target.id);
            if (!ti2) return;
            const op3 = dragged.parentId;
            const np  = ti2.parentId || null;
            if (dragged.type === 'folder' && np) {
                let ck = np;
                while (ck) {
                    if (sid(ck) === sid(dragged.id)) { notify('Cannot move there'); return; }
                    const px = bookmarks.find(i => sid(i.id) === sid(ck));
                    ck = px ? (px.parentId || null) : null;
                }
            }
            dragged.parentId = np;
            const sibs = bookmarks.filter(i => pidMatch(i.parentId, np) && sid(i.id) !== sid(dragged.id)).sort((a, b) => (a.order || 0) - (b.order || 0));
            const idx  = sibs.findIndex(s => sid(s.id) === sid(ti2.id));
            sibs.splice(target.type === 'before' ? idx : idx + 1, 0, dragged);
            const ups = sibs.map((s, i) => { s.order = i; return { id: s.id, parentId: np, order: i }; });
            reorderSibs(op3);
            await dbBatchUpdate(ups);
            notify('Reordered');
        }
    } catch (err) { notify('Error: ' + (err.message || err)); }
    render(searchInput.value);
}

function onPointerDown(e) {
    if (e.button !== 0) return;
    const row = e.target.closest('.node-row');
    if (!row || e.target.closest('.act,.node-toggle')) return;
    dragState.id = row.dataset.id; dragState.startX = e.clientX; dragState.startY = e.clientY;
    dragState.moved = false; dragState.active = false;
}

function onPointerMove(e) {
    if (!dragState.id) return;
    if (!dragState.active) {
        if (Math.abs(e.clientX - dragState.startX) < DRAG_THRESHOLD && Math.abs(e.clientY - dragState.startY) < DRAG_THRESHOLD) return;
        dragState.active = true; dragState.moved = true;
        const item = bookmarks.find(i => sid(i.id) === dragState.id);
        if (!item) { dragState.id = null; return; }
        dragState.ghostEl = createGhost(item);
        rootDrop.style.display = 'block';
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
    }
    dragState.ghostEl.style.left = (e.clientX + 12) + 'px';
    dragState.ghostEl.style.top  = (e.clientY - 12) + 'px';
    showDropIndicator(getDropTarget(e.clientX, e.clientY));
}

function onPointerUp(e) {
    if (!dragState.id) return;
    if (dragState.active) {
        const target = getDropTarget(e.clientX, e.clientY);
        clearHighlights();
        if (dragState.ghostEl) { dragState.ghostEl.remove(); dragState.ghostEl = null; }
        rootDrop.style.display = 'none';
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        executeDrop(target);
    }
    const wm = dragState.moved; dragState.id = null; dragState.active = false;
    if (wm) setTimeout(() => { dragState.moved = false; }, 50);
}

function onTouchStart(e) {
    const row = e.target.closest('.node-row');
    if (!row || e.target.closest('.act,.node-toggle')) return;
    const touch = e.touches[0];
    dragState.startX = touch.clientX; dragState.startY = touch.clientY;
    dragState.moved = false; dragState.active = false;
    const rowId = row.dataset.id;
    dragState.timer = setTimeout(() => {
        dragState.id = rowId; dragState.active = true; dragState.moved = true;
        const item = bookmarks.find(i => sid(i.id) === rowId);
        if (!item) { dragState.id = null; dragState.active = false; return; }
        dragState.ghostEl = createGhost(item);
        dragState.ghostEl.style.left = (touch.clientX + 12) + 'px';
        dragState.ghostEl.style.top  = (touch.clientY - 12) + 'px';
        rootDrop.style.display = 'block';
        if (navigator.vibrate) navigator.vibrate(30);
    }, LONG_PRESS_MS);
}

function onTouchMove(e) {
    const touch = e.touches[0];
    if (dragState.timer && !dragState.active) {
        if (Math.abs(touch.clientX - dragState.startX) > 10 || Math.abs(touch.clientY - dragState.startY) > 10) {
            clearTimeout(dragState.timer); dragState.timer = null;
        }
        return;
    }
    if (!dragState.active) return;
    e.preventDefault();
    if (dragState.ghostEl) {
        dragState.ghostEl.style.left = (touch.clientX + 12) + 'px';
        dragState.ghostEl.style.top  = (touch.clientY - 12) + 'px';
    }
    showDropIndicator(getDropTarget(touch.clientX, touch.clientY));
}

function onTouchEnd(e) {
    clearTimeout(dragState.timer); dragState.timer = null;
    if (!dragState.active) return;
    const touch  = e.changedTouches[0];
    const target = getDropTarget(touch.clientX, touch.clientY);
    clearHighlights();
    if (dragState.ghostEl) { dragState.ghostEl.remove(); dragState.ghostEl = null; }
    rootDrop.style.display = 'none';
    executeDrop(target);
    dragState.id = null; dragState.active = false;
    setTimeout(() => { dragState.moved = false; }, 50);
}

async function onExternalDrop(e) {
    dropZone.classList.remove('active');
    if (dragState.active || appEl.classList.contains('hidden')) return;
    const uriList  = e.dataTransfer.getData('text/uri-list');
    const plain    = e.dataTransfer.getData('text/plain');
    const htmlData = e.dataTransfer.getData('text/html');
    const urls = [];
    if (htmlData) {
        const doc = new DOMParser().parseFromString(htmlData, 'text/html');
        doc.querySelectorAll('a[href]').forEach(a => {
            const href = a.href.trim();
            if (/^https?:\/\//i.test(href)) urls.push({ url: href, name: a.textContent.trim() || '' });
        });
    }
    if (!urls.length && uriList) {
        uriList.split('\n').filter(l => l.trim() && !l.startsWith('#')).forEach(l => {
            if (/^https?:\/\//i.test(l.trim())) urls.push({ url: l.trim(), name: '' });
        });
    }
    if (!urls.length && plain) {
        const norm = normalizeUrl(plain);
        if (/^https?:\/\//i.test(norm)) urls.push({ url: norm, name: '' });
    }
    if (!urls.length) return;
    e.preventDefault();
    try {
        for (const en of urls) {
            const cr = await dbCreate({ type: 'bookmark', name: en.name || extractUrlName(en.url), url: en.url, parentId: null, order: bookmarks.length, expanded: true });
            bookmarks.push(cr);
        }
        notify(urls.length + ' bookmark' + (urls.length > 1 ? 's' : '') + ' saved');
        render(searchInput.value);
    } catch (err) { notify('Error: ' + (err.message || err)); }
}