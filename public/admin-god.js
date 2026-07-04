const GOD_STATE = {
    sections: [],
    users: [],
    config: {
        sectionOrder: [],
        hiddenSections: [],
        tabLabels: {},
        theme: {},
        customCss: ''
    }
};

function byId(id) {
    return document.getElementById(id);
}

async function api(url, options = {}) {
    const res = await fetch(url, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

function paintThemeInputs(theme = {}) {
    byId('theme-navBackground').value = theme.navBackground || '#0f172a';
    byId('theme-cardBackground').value = theme.cardBackground || '#111827';
    byId('theme-accent').value = theme.accent || '#6366f1';
    byId('theme-textPrimary').value = theme.textPrimary || '#e2e8f0';
    byId('god-custom-css').value = GOD_STATE.config.customCss || '';
}

function sectionRow(sectionId, idx) {
    const hidden = (GOD_STATE.config.hiddenSections || []).includes(sectionId);
    const label = (GOD_STATE.config.tabLabels || {})[sectionId] || '';

    return `
        <div class="rounded-2xl border border-white/10 bg-black/25 p-3 flex flex-col md:flex-row md:items-center gap-3">
            <div class="flex items-center gap-2">
                <button onclick="moveSection(${idx}, -1)" class="px-2 py-1 text-xs rounded-lg bg-white/10">↑</button>
                <button onclick="moveSection(${idx}, 1)" class="px-2 py-1 text-xs rounded-lg bg-white/10">↓</button>
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-[11px] font-black uppercase tracking-widest text-cyan-200">${sectionId}</p>
                <input id="label-${sectionId}" value="${label}" placeholder="Etiqueta personalizada" class="mt-1 w-full rounded-xl bg-black/30 border border-white/20 px-2 py-1 text-xs">
            </div>
            <label class="flex items-center gap-2 text-xs">
                <input type="checkbox" ${hidden ? 'checked' : ''} onchange="toggleHiddenSection('${sectionId}', this.checked)">
                Ocultar global
            </label>
        </div>
    `;
}

function renderSections() {
    const list = byId('god-sections-list');
    list.innerHTML = GOD_STATE.config.sectionOrder.map((s, idx) => sectionRow(s, idx)).join('');
}

function userRow(user, idx) {
    const checks = GOD_STATE.sections.map((sec) => {
        const checked = (user.blockedSections || []).includes(sec);
        return `
            <label class="text-[11px] flex items-center gap-1 border border-white/10 bg-black/20 rounded-lg px-2 py-1">
                <input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleUserSection(${idx}, '${sec}', this.checked)">
                ${sec}
            </label>
        `;
    }).join('');

    return `
        <div class="rounded-2xl border border-white/10 bg-black/25 p-3">
            <div class="flex items-center justify-between gap-2 mb-2">
                <div>
                    <p class="text-xs font-black">${user.nombreVisible || user.email}</p>
                    <p class="text-[10px] opacity-65">${user.email} · ${user.rol}</p>
                </div>
                <button onclick="saveUserAccess(${idx})" class="bg-amber-600 hover:bg-amber-700 text-white text-[10px] uppercase font-black px-3 py-1.5 rounded-lg">Guardar</button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-2">${checks}</div>
        </div>
    `;
}

function renderUsers() {
    const list = byId('god-users-list');
    list.innerHTML = GOD_STATE.users.map((u, idx) => userRow(u, idx)).join('');
}

window.moveSection = function(idx, step) {
    const arr = [...GOD_STATE.config.sectionOrder];
    const next = idx + step;
    if (next < 0 || next >= arr.length) return;
    const tmp = arr[idx];
    arr[idx] = arr[next];
    arr[next] = tmp;
    GOD_STATE.config.sectionOrder = arr;
    renderSections();
}

window.toggleHiddenSection = function(sec, checked) {
    const set = new Set(GOD_STATE.config.hiddenSections || []);
    if (checked) set.add(sec); else set.delete(sec);
    GOD_STATE.config.hiddenSections = Array.from(set);
}

window.toggleUserSection = function(userIdx, sec, checked) {
    const user = GOD_STATE.users[userIdx];
    if (!user) return;
    const set = new Set(user.blockedSections || []);
    if (checked) set.add(sec); else set.delete(sec);
    user.blockedSections = Array.from(set);
}

window.saveUserAccess = async function(userIdx) {
    const user = GOD_STATE.users[userIdx];
    if (!user) return;
    try {
        await api(`/api/god/user-access/${encodeURIComponent(user.email)}`, {
            method: 'PUT',
            body: JSON.stringify({ blockedSections: user.blockedSections || [] })
        });
        byId('god-subtitle').innerText = `Permisos guardados para ${user.email}`;
    } catch (e) {
        alert(e.message);
    }
}

async function saveLayoutAndTheme() {
    const tabLabels = {};
    GOD_STATE.config.sectionOrder.forEach((sec) => {
        const value = byId(`label-${sec}`)?.value || '';
        if (value.trim()) tabLabels[sec] = value.trim();
    });

    const payload = {
        sectionOrder: GOD_STATE.config.sectionOrder,
        hiddenSections: GOD_STATE.config.hiddenSections || [],
        tabLabels,
        theme: {
            navBackground: byId('theme-navBackground').value,
            cardBackground: byId('theme-cardBackground').value,
            accent: byId('theme-accent').value,
            textPrimary: byId('theme-textPrimary').value
        },
        customCss: byId('god-custom-css').value || ''
    };

    await api('/api/god/ui-config', {
        method: 'PUT',
        body: JSON.stringify(payload)
    });

    byId('god-subtitle').innerText = 'Configuración visual guardada correctamente.';
}

async function loadGodDashboard() {
    const data = await api('/api/god/bootstrap');
    GOD_STATE.sections = Array.isArray(data.sections) ? data.sections : [];
    GOD_STATE.users = Array.isArray(data.users) ? data.users : [];
    GOD_STATE.config = data.config || GOD_STATE.config;

    if (!GOD_STATE.config.sectionOrder || !GOD_STATE.config.sectionOrder.length) {
        GOD_STATE.config.sectionOrder = [...GOD_STATE.sections];
    }

    renderSections();
    renderUsers();
    paintThemeInputs(GOD_STATE.config.theme || {});

    byId('god-unlock').classList.add('hidden');
    byId('god-dashboard').classList.remove('hidden');
    byId('btn-god-refresh').classList.remove('hidden');
    byId('btn-god-lock').classList.remove('hidden');
    byId('god-subtitle').innerText = `Empresa activa: ${data.empresa}`;
}

async function ensureAuth() {
    const auth = await api('/api/auth/verificar');
    if (!auth.autenticado) {
        window.location.href = '/';
        return false;
    }
    if ((auth.rol || 'Editor') !== 'Admin') {
        byId('god-unlock').innerHTML = '<p class="text-sm text-rose-300 font-black uppercase">Acceso denegado: solo Admin.</p>';
        return false;
    }
    if (auth.godMode) {
        await loadGodDashboard();
    }
    return true;
}

async function unlockGodMode() {
    const key = byId('god-key').value.trim();
    if (!key) {
        byId('god-unlock-msg').innerText = 'Introduce la clave Dios.';
        return;
    }
    byId('btn-god-unlock').disabled = true;
    try {
        await api('/api/god/login', { method: 'POST', body: JSON.stringify({ clave: key }) });
        byId('god-unlock-msg').innerText = '';
        await loadGodDashboard();
    } catch (e) {
        byId('god-unlock-msg').innerText = e.message;
    } finally {
        byId('btn-god-unlock').disabled = false;
    }
}

async function lockGodMode() {
    await api('/api/god/logout', { method: 'POST' });
    window.location.reload();
}

document.addEventListener('DOMContentLoaded', async () => {
    byId('btn-god-unlock').addEventListener('click', unlockGodMode);
    byId('god-key').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            unlockGodMode();
        }
    });

    byId('btn-save-layout').addEventListener('click', saveLayoutAndTheme);
    byId('btn-save-theme').addEventListener('click', saveLayoutAndTheme);
    byId('btn-reload-users').addEventListener('click', loadGodDashboard);
    byId('btn-god-refresh').addEventListener('click', loadGodDashboard);
    byId('btn-god-lock').addEventListener('click', lockGodMode);

    try {
        await ensureAuth();
    } catch (e) {
        byId('god-unlock-msg').innerText = e.message;
    }
});
