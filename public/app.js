// c:/Users/dannymedinacoronel/Desktop/APP RESTAURADA 280626/app_tienda-main/public/app.js

// --- VARIABLES GLOBALES Y ESTADO DE LA APP ---
const BACKEND_URL = '';
let BASE_DATOS = [];
let LISTA_TIENDAS_GLOBAL = [];
let LISTA_CATEGORIAS_GLOBAL = [];
let LISTA_CLIENTES_CACHE = [];
let USUARIO_EMAIL_ACTUAL = '';
let USUARIO_ROL_ACTUAL = '';
let EMPRESA_CHAT_ACTUAL = '';
let CHAT_USUARIOS = [];
let CHAT_USUARIO_ACTIVO = null;
let CHAT_REFRESH_INTERVAL = null;
let CHAT_NO_LEIDOS = 0;
let FORCE_REFRESH_PROMISE = null;
let LAST_FORCE_REFRESH_AT = 0;
let CITAS_REFRESH_TIMER = null;
let CITAS_REFRESH_IN_FLIGHT = false;
let LAST_CITAS_REFRESH_AT = 0;
let INSTANCIA_CHARTS = null;
let INSTANCIA_TARTA = null;
let INSTANCIA_BARRAS = null;
let INSTANCIA_MAPA_CALOR = null;
let INSTANCIA_ADMIN_PROFIT_CHART = null;
let OBJETO_ESCANER_CAMARA = null;
let HISTORIAL_TIMESTAMPS_OPERACIONES = [];
let LECTOR_BLOQUEADO_POR_CAPTURA = false;
let ESCANER_CAMARA_ID_ACTUAL = '';
let ULTIMO_CODIGO_ESCANEADO = '';
let ULTIMO_SCAN_TS = 0;
let ULTIMA_FOTO_ESCANER = '';
let ESCANER_CAMARA_INICIANDO = false;
let ESCANER_CAMARA_ACTIVO = false;
let ESCANER_CAMARA_SECUENCIA = 0;
let ITEMS_SELECCIONADOS_MASIVOS = [];
let SOUND_MUTED_GLOBAL = false;
let CONFIG_ORDEN_COLUMNAS = { 'No Vendido': 'reciente', 'Vendido': 'reciente', 'Devuelto': 'reciente' };
let CONFIG_FILTRO_COLUMNAS = { 'No Vendido': '', 'Vendido': '', 'Devuelto': '', 'Reservado': '' };
let CALENDARIO_MES = new Date().getMonth() + 1;
let CALENDARIO_ANIO = new Date().getFullYear();
let SCRAPER_PROGRESS_INTERVAL = null;
let MONOPOLIO_URLS = [];
let MONOPOLIO_URLS_VISTA = [];
let MONOPOLIO_SELECTED_KEYS = new Set();
let MONOPOLIO_TEMP_URLS = [];
let MONOPOLIO_DISCOVERED_PROFILES = [];
let MONOPOLIO_SEARCH_REQUEST_SEQ = 0;
let MONOPOLIO_PROGRESS_INTERVAL = null;
let MONOPOLIO_PROGRESS_TOTAL = 0;
let MONOPOLIO_PROGRESS_DONE = 0;
let MONOPOLIO_PROGRESS_VALUE = 0;
let MONOPOLIO_PROGRESS_ACTIVE = false;
let MONOPOLIO_PROGRESS_MSG_INDEX = 0;
let MONOPOLIO_PROGRESS_SEEN = new Set();
let MONOPOLIO_PHASE_RESULTS = new Map();
let MONOPOLIO_DIAGNOSTICO = [];
let HIGIENE_REPORTE_CACHE = null;
let HIGIENE_DECISIONES_UI = [];
let CHAT_SEARCH_QUERY = '';
let SECCIONES_INHABILITADAS = new Set();
let SCRAPER_PROGRESS_VALUE = 0;
let SCRAPER_PROGRESS_MSG_INDEX = 0;
let SCRAPER_FAVORITOS_RECOVERY_DONE = false;
let DRAG_PREVIEW_NODE = null;

const SCRAPER_PROGRESS_MESSAGES = [
    'Conectando con GitHub Actions...',
    'Iniciando worker remoto anti-bloqueo...',
    'Cargando contenido de Vinted...',
    'Detectando productos y precios...',
    'Comparando con inventario en MongoDB...',
    'Preparando panel de resultados...'
];

// --- INICIALIZACIÓN DE SOCKET.IO ---
const socket = io({
    transports: ['websocket', 'polling']
});

socket.on('connect', () => {
    console.log('[SOCKET] Conectado al servidor con ID:', socket.id);
});

socket.on('connect_error', (error) => {
    console.error('[SOCKET] Error de conexión:', error);
});

// Helper: animación numérica suave para KPIs
function animateNumberTo(el, targetText, opts = {}) {
    if (!el) return;
    const duration = opts.duration || 500;
    const decimals = typeof opts.decimals === 'number' ? opts.decimals : (String(targetText).includes('%') ? 1 : 2);
    const currText = String(el.innerText || '').replace(/[^0-9.,-]/g, '').replace(/,/g, '.');
    const currNum = parseFloat(currText) || 0;
    const targetNum = parseFloat(String(targetText).replace(/[^0-9.,-]/g, '').replace(/,/g, '.')) || 0;
    const start = performance.now();
    function step(now) {
        const t = Math.min(1, (now - start) / duration);
        const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        const val = currNum + (targetNum - currNum) * eased;
        if (String(targetText).trim().endsWith('%')) {
            el.innerText = `${val.toFixed(decimals)}%`;
        } else if (String(targetText).trim().endsWith('€')) {
            el.innerText = `${val.toFixed(decimals)} €`;
        } else {
            el.innerText = Number.isInteger(targetNum) ? Math.round(val) : val.toFixed(decimals);
        }
        if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

// Listener para actualizaciones de KPIs desde el servidor
socket.on('kpi_update', async () => {
    try {
        await forceRefreshDataManual();
    } catch (e) {
        console.warn('Error al refrescar datos tras kpi_update:', e);
    }
});

function escapeHtmlSafe(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function closeQuickMenus() {
    document.querySelectorAll('.quick-menu-panel').forEach((panel) => panel.classList.add('hidden'));
}

const NAV_TAB_BASE_CLASS = 'nav-tab-btn nav-tab-chip py-2 rounded-xl font-black uppercase tracking-tight transition-all';
const NAV_TAB_ACTIVE_CLASS = `${NAV_TAB_BASE_CLASS} nav-btn-active text-white`;

window.toggleQuickMenu = function(menuId) {
    const panel = document.getElementById(menuId);
    if (!panel) return;
    const openNow = panel.classList.contains('hidden');
    closeQuickMenus();
    if (openNow) panel.classList.remove('hidden');
};

document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-quick-menu-wrapper="1"]')) {
        closeQuickMenus();
    }
});

function actualizarEstadoBotonesTema(theme) {
    const current = String(theme || localStorage.getItem('seychelles-theme-multi') || 'dark');
    document.querySelectorAll('[data-theme-option]').forEach((btn) => {
        const option = String(btn.getAttribute('data-theme-option') || '');
        const active = option === current;
        btn.classList.toggle('theme-item-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function limpiarEstadoVisualDrag() {
    document.body.classList.remove('drag-active');
    if (DRAG_PREVIEW_NODE && DRAG_PREVIEW_NODE.parentNode) {
        DRAG_PREVIEW_NODE.parentNode.removeChild(DRAG_PREVIEW_NODE);
    }
    DRAG_PREVIEW_NODE = null;
}

function crearDragPreviewMinimizado(e, titulo = 'Elemento', subtitulo = '') {
    try {
        limpiarEstadoVisualDrag();
        const node = document.createElement('div');
        node.className = 'drag-preview-ghost';
        node.innerHTML = `
            <p class="drag-preview-title">${escapeHtmlSafe(titulo)}</p>
            <p class="drag-preview-sub">${escapeHtmlSafe(subtitulo || 'Arrastra y suelta')}</p>
        `;
        document.body.appendChild(node);
        DRAG_PREVIEW_NODE = node;
        if (e?.dataTransfer?.setDragImage) {
            e.dataTransfer.setDragImage(node, 22, 18);
        }
        document.body.classList.add('drag-active');
    } catch (_) {}
}

function resetDiagnosticoMonopolio() {
    MONOPOLIO_DIAGNOSTICO = [];
    renderDiagnosticoMonopolio();
}

function upsertDiagnosticoMonopolio(data) {
    const key = String(data?.urlOrigen || data?.alias || '').trim();
    if (!key) return;

    const grupos = Array.isArray(data?.grupos) ? data.grupos : [];
    const productosPlano = Array.isArray(data?.productos) ? data.productos : [];
    const productosDesdeGrupos = grupos.flatMap((g) => Array.isArray(g?.productos) ? g.productos : []);
    const productosTotales = productosPlano.length > 0 ? productosPlano.length : productosDesdeGrupos.length;
    const cuentasConProductos = grupos.filter((g) => Number(g?.total || (g?.productos || []).length || 0) > 0).length;

    const item = {
        key,
        alias: String(data?.alias || data?.urlOrigen || 'URL').trim(),
        url: String(data?.urlOrigen || '').trim(),
        modo: data?.esModoSeguidos ? 'seguidos' : 'perfil',
        origen: String(data?.origen || 'github').trim(),
        grupos: grupos.length,
        cuentasConProductos,
        productos: productosTotales,
        error: String(data?.error || '').trim(),
        ts: data?.timestamp ? new Date(data.timestamp) : new Date()
    };

    const idx = MONOPOLIO_DIAGNOSTICO.findIndex((x) => x.key === key);
    if (idx >= 0) MONOPOLIO_DIAGNOSTICO[idx] = item;
    else MONOPOLIO_DIAGNOSTICO.unshift(item);

    MONOPOLIO_DIAGNOSTICO = MONOPOLIO_DIAGNOSTICO.slice(0, 80);
    renderDiagnosticoMonopolio();
}

function renderDiagnosticoMonopolio() {
    const panel = document.getElementById('monopolio-diagnostic-panel');
    if (!panel) return;

    if (!MONOPOLIO_DIAGNOSTICO.length) {
        panel.innerHTML = '<p class="text-xs opacity-50 italic">Aún no hay eventos de diagnóstico.</p>';
        return;
    }

    panel.innerHTML = MONOPOLIO_DIAGNOSTICO.map((d, i) => {
        const estado = d.error
            ? '<span class="text-rose-300">Error</span>'
            : d.productos > 0
                ? '<span class="text-emerald-300">OK</span>'
                : '<span class="text-amber-300">Sin productos</span>';

        const fechaTxt = d.ts && !isNaN(d.ts.getTime())
            ? d.ts.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : '-';

        return `
            <div class="rounded-xl border ${d.error ? 'border-rose-500/30 bg-rose-500/10' : 'border-cyan-500/20 bg-black/20'} p-2.5">
                <div class="flex items-center justify-between gap-2 mb-1">
                    <p class="text-[10px] font-black uppercase tracking-widest truncate">${i + 1}. ${escapeHtmlSafe(d.alias)}</p>
                    <p class="text-[9px] opacity-70 font-mono">${fechaTxt}</p>
                </div>
                <p class="text-[9px] opacity-65 font-mono truncate mb-1">${escapeHtmlSafe(d.url || '-')}</p>
                <p class="text-[10px]">Estado: ${estado} · Modo: <span class="text-cyan-200">${escapeHtmlSafe(d.modo)}</span> · Origen: <span class="text-purple-200">${escapeHtmlSafe(d.origen)}</span></p>
                <p class="text-[10px] opacity-80">Grupos: ${d.grupos} · Cuentas con producto: ${d.cuentasConProductos} · Productos: ${d.productos}</p>
                ${d.error ? `<p class="text-[10px] text-rose-200 mt-1 break-words">${escapeHtmlSafe(d.error)}</p>` : ''}
            </div>
        `;
    }).join('');
}

window.limpiarDiagnosticoMonopolio = function() {
    resetDiagnosticoMonopolio();
};

function esRolVisualizador() {
    return String(USUARIO_ROL_ACTUAL || '').toLowerCase() === 'visualizador';
}

function mostrarLandingPublica() {
    const landing = document.getElementById('landing-page');
    const login = document.getElementById('login-box');
    const panel = document.getElementById('panel-control');
    const ticker = document.getElementById('ticker-bar');
    const chatBtn = document.getElementById('internal-chat-btn');

    if (landing) landing.classList.remove('hidden');
    if (login) login.classList.add('hidden');
    if (panel) panel.classList.add('hidden');
    if (ticker) ticker.classList.add('hidden');
    if (chatBtn) chatBtn.classList.add('hidden');
}

function abrirAccesoDesdeLanding(modo = 'login') {
    const landing = document.getElementById('landing-page');
    const login = document.getElementById('login-box');
    if (landing) landing.classList.add('hidden');
    if (login) login.classList.remove('hidden');

    if (modo === 'registro') {
        toggleRegistroNegocioModal(true);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function volverALanding() {
    toggleRegistroNegocioModal(false);
    mostrarLandingPublica();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function scrollToLandingSection(sectionId) {
    const el = document.getElementById(sectionId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function cargarNegociosCitasLanding() {
    const negocioSelect = document.getElementById('cita-negocio');
    const asesorSelect = document.getElementById('cita-asesor');
    if (!negocioSelect || !asesorSelect) return;

    try {
        const res = await fetch('/api/public/citas/negocios');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudieron cargar negocios.');
        CITA_NEGOCIOS_CACHE = data.negocios || [];

        negocioSelect.innerHTML = '<option value="">Selecciona negocio</option>' +
            CITA_NEGOCIOS_CACHE.map(n => `<option value="${n.slug}">${n.nombre}</option>`).join('');
        asesorSelect.innerHTML = '<option value="">Selecciona persona que te atenderá</option>';
    } catch (e) {
        negocioSelect.innerHTML = '<option value="">No disponible</option>';
    }
}

async function cargarAsesoresCitaLanding() {
    const negocioSelect = document.getElementById('cita-negocio');
    const asesorSelect = document.getElementById('cita-asesor');
    if (!negocioSelect || !asesorSelect) return;

    const empresa = (negocioSelect.value || '').trim();
    if (!empresa) {
        asesorSelect.innerHTML = '<option value="">Selecciona persona que te atenderá</option>';
        return;
    }

    try {
        asesorSelect.innerHTML = '<option value="">Cargando equipo...</option>';
        const res = await fetch(`/api/public/citas/disponibilidad?empresa=${encodeURIComponent(empresa)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar el equipo.');
        const asesores = data.asesores || [];
        asesorSelect.innerHTML = '<option value="">Selecciona persona que te atenderá</option>' +
            asesores.map(a => `<option value="${a.email}">${a.nombre} · ${a.rol}</option>`).join('');
    } catch (e) {
        asesorSelect.innerHTML = '<option value="">No disponible</option>';
    }
}

async function registrarCitaLanding(event) {
    event.preventDefault();
    const btn = document.getElementById('cita-btn-submit');
    const txtOriginal = btn ? btn.innerText : '';
    if (btn) {
        btn.disabled = true;
        btn.innerText = 'Enviando solicitud...';
    }

    const payload = {
        empresa: document.getElementById('cita-negocio')?.value || '',
        asesorEmail: document.getElementById('cita-asesor')?.value || '',
        nombre: document.getElementById('cita-nombre')?.value.trim() || '',
        apellidos: document.getElementById('cita-apellidos')?.value.trim() || '',
        telefono: document.getElementById('cita-telefono')?.value.trim() || '',
        email: document.getElementById('cita-email')?.value.trim() || '',
        fechaDia: document.getElementById('cita-fecha')?.value || '',
        hora: document.getElementById('cita-hora')?.value || '',
        servicio: document.getElementById('cita-servicio')?.value.trim() || '',
        notasCliente: document.getElementById('cita-notas')?.value.trim() || ''
    };

    try {
        const res = await fetch('/api/public/citas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo registrar la cita.');

        alert('Cita registrada correctamente. Te contactaremos para confirmar.');
        const form = document.getElementById('form-cita-landing');
        if (form) form.reset();
        const asesorSelect = document.getElementById('cita-asesor');
        if (asesorSelect) asesorSelect.innerHTML = '<option value="">Selecciona persona que te atenderá</option>';
    } catch (e) {
        alert(`Error al registrar la cita: ${e.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = txtOriginal;
        }
    }
}

window.registrarCitaLanding = registrarCitaLanding;

function iniciarCountdownTrial() {
    const el = document.getElementById('trial-countdown');
    if (!el) return;

    // Ventana comercial rolling de 72h desde la primera visita local.
    const key = 'seychelles_trial_deadline';
    const now = Date.now();
    let deadline = parseInt(localStorage.getItem(key), 10);
    if (!Number.isFinite(deadline) || deadline <= now) {
        deadline = now + (72 * 60 * 60 * 1000);
        localStorage.setItem(key, String(deadline));
    }

    const tick = () => {
        const diff = Math.max(0, deadline - Date.now());
        const d = Math.floor(diff / (24 * 60 * 60 * 1000));
        const h = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        const m = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
        const s = Math.floor((diff % (60 * 1000)) / 1000);
        el.textContent = `${String(d).padStart(2, '0')}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;

        if (diff <= 0) {
            deadline = Date.now() + (72 * 60 * 60 * 1000);
            localStorage.setItem(key, String(deadline));
        }
    };

    tick();
    setInterval(tick, 1000);
}

window.abrirAccesoDesdeLanding = abrirAccesoDesdeLanding;
window.volverALanding = volverALanding;
window.scrollToLandingSection = scrollToLandingSection;

function setParticlesEnabled(enabled) {
    try {
        const isLowPower = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '') || ((navigator.deviceMemory || 8) <= 4);
        const hasParticles = Array.isArray(window.pJSDom) && window.pJSDom.length > 0;
        if (enabled) {
            if (isLowPower) return;
            if (!hasParticles && typeof window.particlesJS === 'function') {
                particlesJS("particles-js", {
                    "particles": {
                        "number": { "value": 26, "density": { "enable": true, "value_area": 900 } },
                        "color": { "value": ["#22d3ee", "#60a5fa", "#fbbf24"] },
                        "shape": { "type": ["circle"] },
                        "opacity": { "value": 0.45, "random": true },
                        "size": { "value": 3.2, "random": true },
                        "line_linked": { "enable": true, "distance": 110, "color": "#38bdf8", "opacity": 0.18, "width": 1 },
                        "move": { "enable": true, "speed": 1.5, "direction": "none", "random": true, "out_mode": "out" }
                    },
                    "interactivity": { "events": { "onhover": { "enable": true, "mode": "grab" }, "resize": true } },
                    "retina_detect": true
                });
            }
        } else if (hasParticles) {
            window.pJSDom.forEach(p => p?.pJS?.fn?.vendors?.destroypJS?.());
            window.pJSDom = [];
            const node = document.getElementById('particles-js');
            if (node) node.innerHTML = '';
        }
    } catch (_) {}
}

socket.on('mensaje_interno_nuevo', (data) => {
    if (!USUARIO_EMAIL_ACTUAL) return;
    if (!data) return;
    if (data.empresa && EMPRESA_CHAT_ACTUAL && data.empresa !== EMPRESA_CHAT_ACTUAL) return;
    if (data.paraEmail === USUARIO_EMAIL_ACTUAL || data.deEmail === USUARIO_EMAIL_ACTUAL) {
        const popupAbierto = !document.getElementById('internal-chat-window')?.classList.contains('hidden');
        if (!popupAbierto && data.deEmail !== USUARIO_EMAIL_ACTUAL) {
            CHAT_NO_LEIDOS += 1;
            renderBadgeChatInterno();
        }

        if (data.deEmail !== USUARIO_EMAIL_ACTUAL) {
            reproducirSonidoMensaje('receive');
        }

        if ((document.getElementById('sec-usuarios') && !document.getElementById('sec-usuarios').classList.contains('hidden')) || popupAbierto) {
            refrescarUsuariosChat();
            if (CHAT_USUARIO_ACTIVO && (CHAT_USUARIO_ACTIVO.email === data.deEmail || CHAT_USUARIO_ACTIVO.email === data.paraEmail)) {
                cargarConversacionInterna(CHAT_USUARIO_ACTIVO.email);
            }
        }
    }
});

socket.on('cita_nueva', (data) => {
    if (!USUARIO_EMAIL_ACTUAL) return;
    if (!data) return;
    if (data.empresa && EMPRESA_CHAT_ACTUAL && data.empresa !== EMPRESA_CHAT_ACTUAL) return;
    actualizarBadgeCitasNav();
    if (!document.getElementById('sec-citas')?.classList.contains('hidden')) {
        clearTimeout(CITAS_REFRESH_TIMER);
        CITAS_REFRESH_TIMER = setTimeout(() => { refrescarCitas(); }, 400);
    }
});

socket.on('cita_actualizada', (data) => {
    if (!USUARIO_EMAIL_ACTUAL) return;
    if (!data) return;
    if (data.empresa && EMPRESA_CHAT_ACTUAL && data.empresa !== EMPRESA_CHAT_ACTUAL) return;
    actualizarBadgeCitasNav();
    if (!document.getElementById('sec-citas')?.classList.contains('hidden')) {
        clearTimeout(CITAS_REFRESH_TIMER);
        CITAS_REFRESH_TIMER = setTimeout(() => { refrescarCitas(); }, 400);
    }
});

socket.on('scraper_update', async (data) => {
    console.log('[SOCKET] Datos recibidos de GitHub:', data);

    if (data.error) {
        console.error('[SCRAPER-ERROR]', data.error);
        detenerAnimacionCargaScraper(true); // silent = true
        alert(`❌ El scraper remoto ha fallado:\n\n${data.error}`);
        // Resetear la UI del scraper
        document.getElementById('scraper-loader').classList.add('hidden');
        document.getElementById('scraper-step-1').classList.remove('hidden');
        document.getElementById('scraper-step-2').classList.add('hidden');
        return;
    }

    actualizarCargaScraper(96, 'Recibiendo resultados del worker remoto...', 'Procesando resultados');

    const productos = Array.isArray(data?.productos) ? data.productos : [];

    try {
        const response = await fetch(`${BACKEND_URL}/api/scraper/analizar-manual`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productosExtraidos: productos.map(p => ({
                titulo: p.titulo,
                precio: p.precio,
                imagen: p.imagen,
                descripcion: p.descripcion || '',
                marca: p.marca || '',
                talla: p.talla || '',
                condicion: p.condicion || '',
                favoritos: p.favoritos || 0
            })) })
        });

        const comparativa = await response.json();
        resultadosScraperActual = comparativa;
        renderizarResultadosScraping(resultadosScraperActual);

        actualizarCargaScraper(100, 'Resultados listos para revisar e importar.', 'Completado');
        detenerAnimacionCargaScraper();

        mostrarNotificacionScraping({
            mensaje: `Escaneo finalizado. Productos detectados: ${productos.length}.`,
            success: true
        });

        document.getElementById('modal-scraper').classList.remove('hidden');
        document.getElementById('scraper-loader').classList.add('hidden');
        document.getElementById('scraper-step-1').classList.add('hidden');
        document.getElementById('scraper-step-2').classList.remove('hidden');
    } catch (e) {
        console.error('Error procesando comparativa de GitHub:', e);
        detenerAnimacionCargaScraper();
        document.getElementById('scraper-loader').classList.add('hidden');
        document.getElementById('scraper-step-1').classList.remove('hidden');
        alert('No se pudieron procesar los resultados del scraper remoto. Revisa logs de Render/GitHub.');
    }
});

socket.on('monopolio_update', (data) => {
    console.log('[SOCKET] Datos de Monopolio recibidos:', data);
    const container = document.getElementById('resultados-monopolio-scraping');
    if (!container) return;

    registrarResultadoMonopolio(data);
    actualizarFasesMonopolioDesdeEvento(data);
    upsertDiagnosticoMonopolio(data);

    const alias = data.alias || data.urlOrigen;

    if (data.error) {
        console.error(`[MONOPOLIO-ERROR] ${alias}:`, data.error);
        let existingContainer = document.getElementById(`monopolio-res-${btoa(data.urlOrigen)}`);
        if (existingContainer) existingContainer.remove();
        
        const errorBlock = document.createElement('div');
        errorBlock.id = `monopolio-res-${btoa(data.urlOrigen)}`;
        errorBlock.className = 'p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl';
        errorBlock.innerHTML = `
            <h5 class="font-bold text-rose-300 text-sm mb-2">${alias}</h5>
            <p class="text-xs text-rose-200">Scraping fallido: ${data.error}</p>
        `;
        container.prepend(errorBlock);
        fijarBloqueProgresoMonopolioAlInicio();
        cantarPorVoz(`Scraping de ${alias} ha fallado.`);
        return;
    }

    // Limpiar mensaje inicial si es el primer resultado
    if (container.querySelector('p.italic')) {
        container.innerHTML = '';
    }
    const productosPlano = Array.isArray(data.productos) ? data.productos : [];
    const grupos = Array.isArray(data.grupos) ? data.grupos : [];
    const esModoSeguidos = Boolean(data.esModoSeguidos);
    const exploracion = data?.exploracion && typeof data.exploracion === 'object' ? data.exploracion : null;
    const productos = productosPlano.length > 0 ? productosPlano : grupos.flatMap((g) => Array.isArray(g?.productos) ? g.productos : []);

    let existingContainer = document.getElementById(`monopolio-res-${btoa(data.urlOrigen)}`);
    if (existingContainer) {
        existingContainer.remove();
    }

    const resultBlock = document.createElement('div');
    resultBlock.id = `monopolio-res-${btoa(data.urlOrigen)}`;
    resultBlock.className = 'p-4 bg-black/20 border border-purple-500/20 rounded-2xl';
    const analyticsHtml = construirAnaliticaMonopolio(productos, grupos);

    let productosHtml = '<p class="text-xs opacity-60">No se encontraron productos.</p>';
    if (esModoSeguidos && grupos.length === 0) {
        productosHtml = '<p class="text-xs text-amber-300">No se detectaron perfiles en la URL de seguidos. Prueba con una URL de seguidos pública o con otra cuenta.</p>';
    }
    if (productos.length > 0) {
        productosHtml = construirCarruselMonopolio(productos, grupos);
    }

    const exploracionTxt = exploracion
        ? ` · Exploracion: ${Number(exploracion.urlsCapturadas || 0)} URLs / ${Number(exploracion.usuariosDetectados || 0)} usuarios / hasta ${Number(exploracion.maxDepth || 0)} hijos`
        : '';

    resultBlock.innerHTML = `
        <h5 class="font-bold text-purple-300 text-sm mb-2">${alias}</h5>
        <p class="text-[10px] opacity-60 mb-3">${productos.length} productos encontrados${grupos.length ? ` · ${grupos.length} cuentas analizadas` : ''}${(grupos.length > 0 && productosPlano.length === 0) ? ' · consolidado desde grupos' : ''}${exploracionTxt}.</p>
        ${analyticsHtml}
        <div class="grid grid-cols-1 gap-2">${productosHtml}</div>
    `;

    container.prepend(resultBlock);
    fijarBloqueProgresoMonopolioAlInicio();
    cantarPorVoz(`Scraping de ${alias} finalizado.`);
});

function actualizarCargaScraper(percent, message, status) {
    const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
    SCRAPER_PROGRESS_VALUE = clamped;

    const bar = document.getElementById('scraper-loader-bar');
    const percentEl = document.getElementById('scraper-loader-percent');
    const msgEl = document.getElementById('scraper-loader-message');
    const statusEl = document.getElementById('scraper-loader-status');

    if (bar) bar.style.width = `${clamped}%`;
    if (percentEl) percentEl.innerText = `${Math.round(clamped)}%`;
    if (msgEl && message) msgEl.innerText = message;
    if (statusEl && status) statusEl.innerText = status;
}

function extraerPrecioNumericoMonopolio(valor) {
    const raw = String(valor ?? '').trim();
    if (!raw) return NaN;
    const cleaned = raw.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : NaN;
}

function construirAnaliticaMonopolio(productos, grupos) {
    const listaProductos = Array.isArray(productos) ? productos : [];
    const listaGrupos = Array.isArray(grupos) ? grupos : [];
    const precios = listaProductos
        .map(p => extraerPrecioNumericoMonopolio(p?.precio))
        .filter(v => Number.isFinite(v) && v > 0);

    const totalProductos = listaProductos.length;
    const cuentasAnalizadas = listaGrupos.length;
    const cuentasConProductos = listaGrupos.length
        ? listaGrupos.filter(g => Number(g?.total || (g?.productos || []).length || 0) > 0).length
        : (totalProductos > 0 ? 1 : 0);

    const precioMin = precios.length ? Math.min(...precios) : null;
    const precioMax = precios.length ? Math.max(...precios) : null;
    const precioMedio = precios.length ? (precios.reduce((a, b) => a + b, 0) / precios.length) : null;

    const topCuentas = [...listaGrupos]
        .sort((a, b) => Number(b?.total || (b?.productos || []).length || 0) - Number(a?.total || (a?.productos || []).length || 0))
        .slice(0, 3)
        .map((g, idx) => {
            const total = Number(g?.total || (g?.productos || []).length || 0);
            const cuenta = String(g?.cuenta || g?.urlCuenta || `Cuenta ${idx + 1}`);
            return `<p class="text-[10px] opacity-80 truncate">${idx + 1}. ${cuenta} · ${total} productos</p>`;
        })
        .join('');

    return `
        <div class="mb-3 p-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5">
            <p class="text-[10px] font-black uppercase tracking-widest text-cyan-200 mb-2">Analitica Rapida</p>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                <div class="bg-black/30 border border-white/10 rounded-lg p-2">
                    <p class="text-[9px] opacity-60 uppercase">Productos</p>
                    <p class="text-xs font-black text-emerald-300">${totalProductos}</p>
                </div>
                <div class="bg-black/30 border border-white/10 rounded-lg p-2">
                    <p class="text-[9px] opacity-60 uppercase">Cuentas</p>
                    <p class="text-xs font-black text-cyan-300">${cuentasAnalizadas || '-'}</p>
                </div>
                <div class="bg-black/30 border border-white/10 rounded-lg p-2">
                    <p class="text-[9px] opacity-60 uppercase">Con producto</p>
                    <p class="text-xs font-black text-purple-300">${cuentasConProductos || 0}</p>
                </div>
                <div class="bg-black/30 border border-white/10 rounded-lg p-2">
                    <p class="text-[9px] opacity-60 uppercase">Precio medio</p>
                    <p class="text-xs font-black text-amber-300">${precioMedio !== null ? `${precioMedio.toFixed(2)}€` : '-'}</p>
                </div>
            </div>
            <p class="text-[10px] opacity-75">Rango de precio: ${precioMin !== null ? `${precioMin.toFixed(2)}€` : '-'} - ${precioMax !== null ? `${precioMax.toFixed(2)}€` : '-'}</p>
            ${topCuentas ? `<div class="mt-2 border-t border-white/10 pt-2">${topCuentas}</div>` : ''}
        </div>
    `;
}

function obtenerClaseClasificacionMonopolio(label = '') {
    const k = String(label || '').trim().toLowerCase();
    if (k === 'premium') return 'bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-400/30';
    if (k === 'medio') return 'bg-cyan-500/20 text-cyan-100 border border-cyan-400/30';
    if (k === 'entry') return 'bg-emerald-500/20 text-emerald-100 border border-emerald-400/30';
    if (k === 'nueva') return 'bg-lime-500/20 text-lime-100 border border-lime-400/30';
    if (k === 'muy_buena') return 'bg-sky-500/20 text-sky-100 border border-sky-400/30';
    if (k === 'buena') return 'bg-indigo-500/20 text-indigo-100 border border-indigo-400/30';
    if (k === 'usada') return 'bg-amber-500/20 text-amber-100 border border-amber-400/30';
    return 'bg-slate-500/20 text-slate-100 border border-slate-400/30';
}

function normalizarClasificacionMonopolioUI(producto = {}) {
    const precio = extraerPrecioNumericoMonopolio(producto?.precio);
    const condicion = String(producto?.condicion || '').toLowerCase();

    const precioTag = (() => {
        const backend = String(producto?.clasificacionPrecio || '').trim();
        if (backend) return backend;
        if (!Number.isFinite(precio) || precio <= 0) return 'sin_precio';
        if (precio < 12) return 'entry';
        if (precio < 35) return 'medio';
        return 'premium';
    })();

    const condicionTag = (() => {
        const backend = String(producto?.clasificacionCondicion || '').trim();
        if (backend) return backend;
        if (!condicion) return 'sin_dato';
        if (condicion.includes('nuevo') || condicion.includes('new')) return 'nueva';
        if (condicion.includes('muy buena') || condicion.includes('very good')) return 'muy_buena';
        if (condicion.includes('buena') || condicion.includes('good')) return 'buena';
        return 'usada';
    })();

    return { precioTag, condicionTag };
}

function construirCarruselMonopolio(productos, grupos) {
    const lista = Array.isArray(productos) ? productos.slice(0, 220) : [];
    if (!lista.length) return '<p class="text-xs opacity-60">No se encontraron productos para visualizar.</p>';

    const construirCard = (p, idx) => {
        const precio = extraerPrecioNumericoMonopolio(p?.precio);
        const precioTxt = Number.isFinite(precio) ? `${precio.toFixed(2)}€` : String(p?.precio || '-');
        const cuenta = String(p?.cuenta || p?.proveedor || 'Cuenta desconocida').trim();
        const nivel = Number.isFinite(Number(p?.nivelCadena)) ? Number(p.nivelCadena) : 0;
        const { precioTag, condicionTag } = normalizarClasificacionMonopolioUI(p);

        return `
            <article class="snap-start shrink-0 w-[215px] rounded-2xl border border-white/12 bg-black/30 p-2.5 shadow-lg">
                <div class="w-full h-36 rounded-xl overflow-hidden bg-slate-900/70 mb-2 flex items-center justify-center">
                    ${p?.imagen ? `<img src="${escapeHtmlSafe(String(p.imagen))}" class="w-full h-full object-cover" onerror="this.style.display='none'">` : '<p class="text-[10px] opacity-50">Sin imagen</p>'}
                </div>
                <p class="text-[11px] font-bold leading-snug min-h-[34px]" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtmlSafe(p?.titulo || `Producto ${idx + 1}`)}</p>
                <p class="text-[12px] font-black text-emerald-300 mt-1">${escapeHtmlSafe(precioTxt)}</p>
                <p class="text-[10px] opacity-75 truncate mt-1">Usuario: ${escapeHtmlSafe(cuenta)}</p>
                <p class="text-[10px] opacity-65 truncate">Nivel hijo: ${nivel}</p>
                <div class="flex gap-1 mt-2 flex-wrap">
                    <span class="text-[9px] px-1.5 py-0.5 rounded ${obtenerClaseClasificacionMonopolio(precioTag)}">${escapeHtmlSafe(precioTag)}</span>
                    <span class="text-[9px] px-1.5 py-0.5 rounded ${obtenerClaseClasificacionMonopolio(condicionTag)}">${escapeHtmlSafe(condicionTag)}</span>
                </div>
            </article>
        `;
    };

    const gruposNormalizados = (() => {
        const fromBackend = Array.isArray(grupos) ? grupos : [];
        const validos = fromBackend
            .map((g, idx) => {
                const cuenta = String(g?.cuenta || g?.urlCuenta || `Cuenta ${idx + 1}`).trim();
                const productosGrupo = Array.isArray(g?.productos) ? g.productos : [];
                return {
                    cuenta,
                    urlCuenta: String(g?.urlCuenta || '').trim(),
                    nivelCadena: Number.isFinite(Number(g?.nivelCadena)) ? Number(g.nivelCadena) : 0,
                    parentCuenta: String(g?.parentCuenta || '').trim(),
                    total: Number(g?.total || productosGrupo.length || 0),
                    productos: productosGrupo.slice(0, 50)
                };
            })
            .filter((g) => g.cuenta && g.productos.length > 0);

        if (validos.length > 0) return validos;

        const tmp = new Map();
        for (const p of lista) {
            const cuenta = String(p?.cuenta || p?.proveedor || '').trim() || 'Cuenta desconocida';
            if (!tmp.has(cuenta)) {
                tmp.set(cuenta, {
                    cuenta,
                    urlCuenta: String(p?.urlCuenta || '').trim(),
                    nivelCadena: Number.isFinite(Number(p?.nivelCadena)) ? Number(p.nivelCadena) : 0,
                    parentCuenta: String(p?.parentCuenta || '').trim(),
                    total: 0,
                    productos: []
                });
            }
            const item = tmp.get(cuenta);
            item.total += 1;
            if (item.productos.length < 50) item.productos.push(p);
        }
        return Array.from(tmp.values());
    })();

    const usuarios = [...new Set(gruposNormalizados.map((g) => g.cuenta).filter(Boolean))].slice(0, 40);
    const chipsUsuarios = usuarios.length
        ? `<div class="flex flex-wrap gap-1.5 mb-3">${usuarios.map((u) => `<span class="text-[10px] px-2 py-1 rounded-full bg-cyan-500/15 text-cyan-100 border border-cyan-400/30">${escapeHtmlSafe(u)}</span>`).join('')}</div>`
        : '<p class="text-[10px] opacity-55 mb-3">Sin usuarios/cuentas identificados.</p>';

    const bloquesPorPerfil = gruposNormalizados
        .sort((a, b) => Number(b.total || 0) - Number(a.total || 0))
        .slice(0, 30)
        .map((g, gIdx) => {
            const urlPerfil = g.urlCuenta
                ? `<a href="${escapeHtmlSafe(g.urlCuenta)}" target="_blank" rel="noopener noreferrer" class="text-[10px] text-cyan-300 hover:text-cyan-200 underline truncate">${escapeHtmlSafe(g.urlCuenta)}</a>`
                : '<span class="text-[10px] opacity-60">URL no disponible</span>';
            const parent = g.parentCuenta
                ? `<p class="text-[10px] opacity-65">Padre: ${escapeHtmlSafe(g.parentCuenta)} · Nivel ${Number(g.nivelCadena || 0)}</p>`
                : `<p class="text-[10px] opacity-65">Nivel ${Number(g.nivelCadena || 0)}</p>`;

            const cards = g.productos.map((p, idx) => construirCard(p, (gIdx * 100) + idx)).join('');

            return `
                <section class="rounded-xl border border-cyan-500/20 bg-black/25 p-3">
                    <div class="flex items-start justify-between gap-2 mb-2">
                        <div class="min-w-0">
                            <p class="text-[11px] font-black uppercase tracking-widest text-cyan-200 truncate">${escapeHtmlSafe(g.cuenta)} · ${Number(g.total || g.productos.length || 0)} productos</p>
                            ${parent}
                            ${urlPerfil}
                        </div>
                    </div>
                    <div class="overflow-x-auto custom-scrollbar pb-2">
                        <div class="flex gap-2 snap-x snap-mandatory w-max">
                            ${cards}
                        </div>
                    </div>
                </section>
            `;
        })
        .join('');

    return `
        <div class="rounded-xl border border-white/10 bg-black/25 p-3">
            <p class="text-[10px] font-black uppercase tracking-widest text-cyan-200 mb-2">Usuarios donde se detectaron productos</p>
            ${chipsUsuarios}
            <p class="text-[10px] font-black uppercase tracking-widest text-purple-200 mb-2">Carruseles por perfil (solo visualización)</p>
            <div class="grid grid-cols-1 gap-3">${bloquesPorPerfil || '<p class="text-xs opacity-60">Sin agrupaciones por perfil disponibles.</p>'}</div>
        </div>
    `;
}

function renderBadgeChatInterno() {
    const badge = document.getElementById('internal-chat-badge');
    if (!badge) return;
    if (CHAT_NO_LEIDOS > 0) {
        badge.classList.remove('hidden');
        badge.innerText = CHAT_NO_LEIDOS > 99 ? '99+' : String(CHAT_NO_LEIDOS);
    } else {
        badge.classList.add('hidden');
        badge.innerText = '0';
    }
}

function chatPollingDebeEstarActivo() {
    const enUsuarios = document.getElementById('sec-usuarios') && !document.getElementById('sec-usuarios').classList.contains('hidden');
    const popupAbierto = document.getElementById('internal-chat-window') && !document.getElementById('internal-chat-window').classList.contains('hidden');
    return Boolean(enUsuarios || popupAbierto);
}

function toggleChatInternoPopup() {
    const chat = document.getElementById('internal-chat-window');
    if (!chat) return;
    chat.classList.toggle('hidden');

    const abierto = !chat.classList.contains('hidden');
    if (abierto) {
        CHAT_NO_LEIDOS = 0;
        renderBadgeChatInterno();
        refrescarUsuariosChat();
        iniciarAutoRefreshChat();
        if (CHAT_USUARIO_ACTIVO?.email) {
            cargarConversacionInterna(CHAT_USUARIO_ACTIVO.email);
        }
        const input = document.getElementById('chat-popup-input');
        if (input) input.focus();
    } else if (!chatPollingDebeEstarActivo()) {
        detenerAutoRefreshChat();
    }
}
window.toggleChatInternoPopup = toggleChatInternoPopup;

function esMovilOSimilar() {
    return window.matchMedia('(max-width: 1024px)').matches;
}

async function intentarForzarLandscape() {
    // Bloqueo de orientación desactivado por UX.
    return;
}

function actualizarBloqueoOrientacion() {
    const overlay = document.getElementById('orientation-lock-overlay');
    if (!overlay) return;

    // Overlay de orientación siempre oculto.
    overlay.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
}

function configurarForzadoHorizontal() {
    actualizarBloqueoOrientacion();
    intentarForzarLandscape();
    window.addEventListener('resize', actualizarBloqueoOrientacion);
    window.addEventListener('orientationchange', actualizarBloqueoOrientacion);
}

function iniciarAnimacionCargaScraper(modo = 'vinted') {
    detenerAnimacionCargaScraper(true);
    SCRAPER_PROGRESS_MSG_INDEX = 0;
    const titleEl = document.getElementById('scraper-loader-title');
    if (titleEl) {
        titleEl.innerText = modo === 'archivo' ? 'Procesando Archivo...' : 'Analizando Vinted...';
    }

    actualizarCargaScraper(
        4,
        modo === 'archivo' ? 'Leyendo archivo y limpiando datos...' : 'Preparando conexión segura con el scraper remoto...',
        'Inicializando'
    );

    SCRAPER_PROGRESS_INTERVAL = setInterval(() => {
        const next = SCRAPER_PROGRESS_VALUE + (SCRAPER_PROGRESS_VALUE < 40 ? 8 : SCRAPER_PROGRESS_VALUE < 75 ? 5 : 2);
        const capped = Math.min(92, next);
        const msg = SCRAPER_PROGRESS_MESSAGES[SCRAPER_PROGRESS_MSG_INDEX % SCRAPER_PROGRESS_MESSAGES.length];
        SCRAPER_PROGRESS_MSG_INDEX += 1;
        actualizarCargaScraper(capped, msg, 'En progreso');

        if (capped >= 92) {
            clearInterval(SCRAPER_PROGRESS_INTERVAL);
            SCRAPER_PROGRESS_INTERVAL = null;
        }
    }, 1600);
}

function detenerAnimacionCargaScraper(silent = false) {
    if (SCRAPER_PROGRESS_INTERVAL) {
        clearInterval(SCRAPER_PROGRESS_INTERVAL);
        SCRAPER_PROGRESS_INTERVAL = null;
    }
    if (!silent) {
        actualizarCargaScraper(100, 'Proceso finalizado.', 'Completado');
    }
}

function crearBloqueCargaMonopolioSiNoExiste() {
    const container = document.getElementById('resultados-monopolio-scraping');
    if (!container) return null;

    let bloque = document.getElementById('monopolio-progress-wrap');
    if (!bloque) {
        bloque = document.createElement('div');
        bloque.id = 'monopolio-progress-wrap';
        bloque.className = 'mb-3 p-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/10';
        bloque.innerHTML = `
            <div class="flex items-center justify-between gap-2 mb-2">
                <p class="text-[10px] font-black uppercase tracking-widest text-cyan-200">Scraping Monopolio</p>
                <p id="monopolio-progress-percent" class="text-[10px] font-bold text-cyan-200">0%</p>
            </div>
            <div class="w-full h-2 rounded-full bg-black/40 overflow-hidden border border-white/10 mb-2">
                <div id="monopolio-progress-bar" class="h-full bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400 transition-all duration-500" style="width: 0%"></div>
            </div>
            <div class="flex items-center justify-between gap-2 text-[10px] opacity-80">
                <p id="monopolio-progress-message" class="text-cyan-100">Preparando ejecución...</p>
                <p id="monopolio-progress-status" class="text-cyan-300">Inicializando</p>
            </div>
            <p id="monopolio-progress-counts" class="mt-1 text-[10px] opacity-65">0 / 0 tareas completadas</p>
            <div class="mt-2.5 grid grid-cols-2 md:grid-cols-5 gap-2">
                <div class="rounded-lg border border-cyan-500/20 bg-black/25 p-2">
                    <p class="text-[9px] uppercase opacity-60">Respuestas</p>
                    <p id="monopolio-phase-urls" class="text-[11px] font-black text-cyan-200">0</p>
                </div>
                <div class="rounded-lg border border-blue-500/20 bg-black/25 p-2">
                    <p class="text-[9px] uppercase opacity-60">Perfiles detectados</p>
                    <p id="monopolio-phase-detectados" class="text-[11px] font-black text-blue-200">0</p>
                </div>
                <div class="rounded-lg border border-indigo-500/20 bg-black/25 p-2">
                    <p class="text-[9px] uppercase opacity-60">Perfiles scrapeados</p>
                    <p id="monopolio-phase-scrapeados" class="text-[11px] font-black text-indigo-200">0</p>
                </div>
                <div class="rounded-lg border border-emerald-500/20 bg-black/25 p-2">
                    <p class="text-[9px] uppercase opacity-60">Productos totales</p>
                    <p id="monopolio-phase-productos" class="text-[11px] font-black text-emerald-200">0</p>
                </div>
                <div class="rounded-lg border border-amber-500/20 bg-black/25 p-2">
                    <p class="text-[9px] uppercase opacity-60">Promedio por perfil</p>
                    <p id="monopolio-phase-promedio" class="text-[11px] font-black text-amber-200">0.0</p>
                </div>
            </div>
        `;
        container.prepend(bloque);
    }

    return bloque;
}

function recomputarFasesMonopolio() {
    const urls = MONOPOLIO_PHASE_RESULTS.size;
    let detectados = 0;
    let scrapeados = 0;
    let productos = 0;

    MONOPOLIO_PHASE_RESULTS.forEach((item) => {
        detectados += Number(item?.detectados || 0);
        scrapeados += Number(item?.scrapeados || 0);
        productos += Number(item?.productos || 0);
    });

    const promedio = scrapeados > 0 ? (productos / scrapeados) : 0;

    const urlsEl = document.getElementById('monopolio-phase-urls');
    const detectadosEl = document.getElementById('monopolio-phase-detectados');
    const scrapeadosEl = document.getElementById('monopolio-phase-scrapeados');
    const productosEl = document.getElementById('monopolio-phase-productos');
    const promedioEl = document.getElementById('monopolio-phase-promedio');

    if (urlsEl) urlsEl.innerText = String(urls);
    if (detectadosEl) detectadosEl.innerText = String(detectados);
    if (scrapeadosEl) scrapeadosEl.innerText = String(scrapeados);
    if (productosEl) productosEl.innerText = String(productos);
    if (promedioEl) promedioEl.innerText = promedio.toFixed(1);
}

function resetFasesMonopolio() {
    MONOPOLIO_PHASE_RESULTS = new Map();
    recomputarFasesMonopolio();
}

function actualizarFasesMonopolioDesdeEvento(data) {
    const key = String(data?.urlOrigen || data?.alias || '').trim();
    if (!key) return;

    const grupos = Array.isArray(data?.grupos) ? data.grupos : [];
    const productosPlano = Array.isArray(data?.productos) ? data.productos : [];
    const productosDesdeGrupos = grupos.flatMap((g) => Array.isArray(g?.productos) ? g.productos : []);
    const productosTotales = productosPlano.length > 0 ? productosPlano.length : productosDesdeGrupos.length;

    const perfilesConProductos = grupos.filter((g) => Number(g?.total || (g?.productos || []).length || 0) > 0);
    const detectadosExploracion = Number(data?.exploracion?.usuariosDetectados || 0);
    const detectados = Math.max(detectadosExploracion, grupos.length);
    const scrapeados = perfilesConProductos.length;

    MONOPOLIO_PHASE_RESULTS.set(key, {
        detectados,
        scrapeados,
        productos: productosTotales
    });

    recomputarFasesMonopolio();
}

function fijarBloqueProgresoMonopolioAlInicio() {
    const container = document.getElementById('resultados-monopolio-scraping');
    const bloque = document.getElementById('monopolio-progress-wrap');
    if (!container || !bloque) return;
    if (container.firstElementChild !== bloque) {
        container.prepend(bloque);
    }
}

function actualizarCargaMonopolio(percent, message, status) {
    const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
    MONOPOLIO_PROGRESS_VALUE = clamped;

    const bar = document.getElementById('monopolio-progress-bar');
    const percentEl = document.getElementById('monopolio-progress-percent');
    const msgEl = document.getElementById('monopolio-progress-message');
    const statusEl = document.getElementById('monopolio-progress-status');
    const countsEl = document.getElementById('monopolio-progress-counts');

    if (bar) bar.style.width = `${clamped}%`;
    if (percentEl) percentEl.innerText = `${Math.round(clamped)}%`;
    if (msgEl && message) msgEl.innerText = message;
    if (statusEl && status) statusEl.innerText = status;
    if (countsEl) {
        countsEl.innerText = `${MONOPOLIO_PROGRESS_DONE} / ${MONOPOLIO_PROGRESS_TOTAL} tareas completadas`;
    }
}

function detenerAnimacionCargaMonopolio(completado = false, message = '') {
    MONOPOLIO_PROGRESS_ACTIVE = false;
    if (MONOPOLIO_PROGRESS_INTERVAL) {
        clearInterval(MONOPOLIO_PROGRESS_INTERVAL);
        MONOPOLIO_PROGRESS_INTERVAL = null;
    }
    if (completado) {
        MONOPOLIO_PROGRESS_DONE = Math.max(MONOPOLIO_PROGRESS_DONE, MONOPOLIO_PROGRESS_TOTAL);
        actualizarCargaMonopolio(100, message || 'Scraping finalizado.', 'Completado');
    }
}

function iniciarAnimacionCargaMonopolio(totalTareas = 0, mensajeInicial = 'Lanzando tareas remotas...') {
    detenerAnimacionCargaMonopolio(false);
    MONOPOLIO_PROGRESS_TOTAL = Math.max(0, Number(totalTareas) || 0);
    MONOPOLIO_PROGRESS_DONE = 0;
    MONOPOLIO_PROGRESS_VALUE = 2;
    MONOPOLIO_PROGRESS_MSG_INDEX = 0;
    MONOPOLIO_PROGRESS_SEEN = new Set();
    MONOPOLIO_PROGRESS_ACTIVE = true;

    crearBloqueCargaMonopolioSiNoExiste();
    resetFasesMonopolio();
    actualizarCargaMonopolio(2, mensajeInicial, 'Inicializando');
    fijarBloqueProgresoMonopolioAlInicio();

    MONOPOLIO_PROGRESS_INTERVAL = setInterval(() => {
        if (!MONOPOLIO_PROGRESS_ACTIVE) return;

        const progresoPorResultados = MONOPOLIO_PROGRESS_TOTAL > 0
            ? (MONOPOLIO_PROGRESS_DONE / MONOPOLIO_PROGRESS_TOTAL) * 100
            : 0;

        const avanceNatural = MONOPOLIO_PROGRESS_VALUE + (MONOPOLIO_PROGRESS_VALUE < 35 ? 4 : MONOPOLIO_PROGRESS_VALUE < 75 ? 2.5 : 1.2);
        const techoDinamico = MONOPOLIO_PROGRESS_TOTAL > 0
            ? Math.min(94, progresoPorResultados + 14)
            : 30;
        const siguiente = Math.min(techoDinamico, avanceNatural);

        const msg = SCRAPER_PROGRESS_MESSAGES[MONOPOLIO_PROGRESS_MSG_INDEX % SCRAPER_PROGRESS_MESSAGES.length];
        MONOPOLIO_PROGRESS_MSG_INDEX += 1;
        actualizarCargaMonopolio(siguiente, msg, 'En ejecución');
        fijarBloqueProgresoMonopolioAlInicio();

        if (MONOPOLIO_PROGRESS_TOTAL > 0 && MONOPOLIO_PROGRESS_DONE >= MONOPOLIO_PROGRESS_TOTAL) {
            detenerAnimacionCargaMonopolio(true, 'Todas las tareas de Monopolio han finalizado.');
        }
    }, 1400);
}

function registrarResultadoMonopolio(data) {
    if (!MONOPOLIO_PROGRESS_ACTIVE) return;

    const clave = String(data?.urlOrigen || data?.alias || '').trim();
    if (!clave || MONOPOLIO_PROGRESS_SEEN.has(clave)) return;

    MONOPOLIO_PROGRESS_SEEN.add(clave);
    MONOPOLIO_PROGRESS_DONE += 1;

    if (MONOPOLIO_PROGRESS_TOTAL > 0) {
        MONOPOLIO_PROGRESS_DONE = Math.min(MONOPOLIO_PROGRESS_DONE, MONOPOLIO_PROGRESS_TOTAL);
        const porcentaje = (MONOPOLIO_PROGRESS_DONE / MONOPOLIO_PROGRESS_TOTAL) * 100;
        const estado = MONOPOLIO_PROGRESS_DONE >= MONOPOLIO_PROGRESS_TOTAL ? 'Completado' : 'Procesando resultados';
        const mensaje = MONOPOLIO_PROGRESS_DONE >= MONOPOLIO_PROGRESS_TOTAL
            ? 'Todas las respuestas han llegado.'
            : `Resultados recibidos: ${MONOPOLIO_PROGRESS_DONE}/${MONOPOLIO_PROGRESS_TOTAL}.`;
        actualizarCargaMonopolio(Math.min(99, porcentaje), mensaje, estado);

        if (MONOPOLIO_PROGRESS_DONE >= MONOPOLIO_PROGRESS_TOTAL) {
            detenerAnimacionCargaMonopolio(true, 'Monopolio finalizado con todas las URLs lanzadas.');
        }
    } else {
        actualizarCargaMonopolio(Math.min(90, MONOPOLIO_PROGRESS_VALUE + 6), 'Recibiendo resultados de Monopolio...', 'Procesando resultados');
    }
}

function normalizarFavoritoScraperEntrada(item, fallbackAlias = '') {
    if (item == null) return null;

    if (typeof item === 'string') {
        const texto = item.trim();
        if (!texto) return null;

        const parts = texto.split('|');
        if (parts.length >= 2) {
            const alias = String(parts[0] || '').trim();
            const url = String(parts.slice(1).join('|') || '').trim();
            if (url) return { alias, url, createdAt: Date.now() };
        }

        const maybeUrl = texto.match(/https?:\/\/[^\s,;]+/i);
        if (maybeUrl?.[0]) {
            const url = maybeUrl[0].trim();
            const alias = texto.replace(url, '').replace(/[|\-:]+$/, '').trim();
            return { alias: alias || fallbackAlias || '', url, createdAt: Date.now() };
        }

        if (/^https?:\/\//i.test(texto) || /vinted\./i.test(texto)) {
            const url = /^https?:\/\//i.test(texto) ? texto : `https://${texto.replace(/^\/+/, '')}`;
            return { alias: fallbackAlias || '', url, createdAt: Date.now() };
        }

        return null;
    }

    if (typeof item === 'object') {
        const aliasRaw = item?.alias || item?.name || item?.titulo || fallbackAlias || '';
        const urlRaw = item?.url || item?.link || item?.href || item?.targetUrl || item?.target || item?.value || '';
        const url = String(urlRaw || '').trim();
        if (!url) return null;
        return {
            alias: String(aliasRaw || '').trim(),
            url,
            createdAt: Number(item?.createdAt) || Date.now()
        };
    }

    return null;
}

function extraerFavoritosDesdeTextoLibre(rawText) {
    const text = String(rawText || '').trim();
    if (!text) return [];
    const tokens = text
        .split(/\r?\n|,|;/)
        .map((x) => x.trim())
        .filter(Boolean);
    return tokens
        .map((t) => normalizarFavoritoScraperEntrada(t))
        .filter(Boolean);
}

function extraerFavoritosDesdeValorStorage(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) return [];

    const out = [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            parsed.forEach((item) => {
                const n = normalizarFavoritoScraperEntrada(item);
                if (n) out.push(n);
            });
            return out;
        }

        if (parsed && typeof parsed === 'object') {
            const nestedArrays = [parsed.urls, parsed.favoritos, parsed.favorites, parsed.items, parsed.saved, parsed.data]
                .filter((v) => Array.isArray(v));
            nestedArrays.forEach((arr) => {
                arr.forEach((item) => {
                    const n = normalizarFavoritoScraperEntrada(item);
                    if (n) out.push(n);
                });
            });

            Object.entries(parsed).forEach(([k, v]) => {
                if (Array.isArray(v) || (v && typeof v === 'object')) return;
                const keyTxt = String(k || '').trim();
                const valTxt = String(v || '').trim();

                const fromValue = normalizarFavoritoScraperEntrada(valTxt, keyTxt);
                if (fromValue) {
                    out.push(fromValue);
                    return;
                }

                const fromKey = normalizarFavoritoScraperEntrada(keyTxt, valTxt);
                if (fromKey) out.push(fromKey);
            });

            return out;
        }
    } catch (_) {
        return extraerFavoritosDesdeTextoLibre(raw);
    }

    return out;
}

function recolectarFavoritosLegacyScraper() {
    const keysBase = [
        'seychelles-scraper-urls',
        'seychelles-scraper-urls-v2',
        'scraper-urls',
        'vinted-scraper-urls',
        'seychelles-scraper-urls-csv',
        'manual-scraper-urls',
        'manual_scraper_urls',
        'vinted-favorites',
        'vinted-favoritos',
        'scraper-favorites',
        'scraper-favoritos',
        'saved-scraper-urls',
        'savedScraperUrls',
        'favoritos-scraper'
    ];

    const storages = [localStorage, sessionStorage];
    const out = [];

    storages.forEach((storage) => {
        const dynamicKeys = [];
        try {
            for (let i = 0; i < storage.length; i += 1) {
                const k = storage.key(i);
                if (!k) continue;
                if (/(scraper|vinted|favorit|favorite|saved.?urls?|manual)/i.test(k)) {
                    dynamicKeys.push(k);
                }
            }
        } catch (_) {}

        const allKeys = [...new Set([...keysBase, ...dynamicKeys])];
        allKeys.forEach((key) => {
            let raw = '';
            try {
                raw = String(storage.getItem(key) || '');
            } catch (_) {
                raw = '';
            }
            if (!raw.trim()) return;
            const parsed = extraerFavoritosDesdeValorStorage(raw);
            if (parsed.length) out.push(...parsed);
        });
    });

    const dedupe = new Map();
    out.forEach((item) => {
        const normalized = normalizarFavoritoScraperEntrada(item);
        if (!normalized?.url) return;
        const key = normalized.url.trim().toLowerCase();
        if (!key) return;
        if (!dedupe.has(key)) {
            dedupe.set(key, normalized);
            return;
        }
        const prev = dedupe.get(key);
        const merged = {
            ...prev,
            alias: normalized.alias || prev.alias || '',
            createdAt: Math.max(Number(prev.createdAt) || 0, Number(normalized.createdAt) || 0, Date.now())
        };
        dedupe.set(key, merged);
    });

    return Array.from(dedupe.values());
}

function getSavedScraperUrls() {
    const recuperados = recolectarFavoritosLegacyScraper();
    const dedupe = new Map();

    recuperados.forEach((item) => {
        const n = normalizarFavoritoScraperEntrada(item);
        if (!n?.url) return;
        const key = String(n.url).trim().toLowerCase();
        if (!key) return;
        if (!dedupe.has(key)) {
            dedupe.set(key, n);
            return;
        }
        const prev = dedupe.get(key);
        dedupe.set(key, {
            ...prev,
            alias: n.alias || prev.alias || '',
            createdAt: Math.max(Number(prev.createdAt) || 0, Number(n.createdAt) || 0, Date.now())
        });
    });

    const normalizadas = Array.from(dedupe.values())
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
        .slice(0, 120);

    // Migra silenciosamente cualquier formato legacy a claves actuales.
    if (normalizadas.length) {
        setSavedScraperUrls(normalizadas);
        SCRAPER_FAVORITOS_RECOVERY_DONE = true;
    }

    return normalizadas;
}

function setSavedScraperUrls(items) {
    const keys = ['seychelles-scraper-urls', 'seychelles-scraper-urls-v2', 'scraper-urls', 'vinted-scraper-urls'];
    const payload = JSON.stringify((items || []).slice(0, 120));
    for (const key of keys) {
        try { localStorage.setItem(key, payload); } catch (_) {}
        try { sessionStorage.setItem(key, payload); } catch (_) {}
    }
}

window.recuperarFavoritosScraperManual = function() {
    const prev = getSavedScraperUrls();
    const totalAntes = Array.isArray(prev) ? prev.length : 0;
    const recovered = recolectarFavoritosLegacyScraper();
    if (!recovered.length) {
        alert('No encontré favoritos legacy en este navegador/dispositivo. Si limpiaste caché local o cambiaste de navegador, no hay forma de recuperarlos automáticamente.');
        return;
    }

    const mergedMap = new Map();
    [...prev, ...recovered].forEach((item) => {
        const n = normalizarFavoritoScraperEntrada(item);
        if (!n?.url) return;
        const key = n.url.trim().toLowerCase();
        if (!key) return;
        const prevItem = mergedMap.get(key);
        if (!prevItem) {
            mergedMap.set(key, n);
            return;
        }
        mergedMap.set(key, {
            ...prevItem,
            alias: n.alias || prevItem.alias || '',
            createdAt: Math.max(Number(prevItem.createdAt) || 0, Number(n.createdAt) || 0, Date.now())
        });
    });

    const merged = Array.from(mergedMap.values())
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
        .slice(0, 120);

    setSavedScraperUrls(merged);
    SCRAPER_FAVORITOS_RECOVERY_DONE = true;
    renderSavedUrls();

    const added = Math.max(0, merged.length - totalAntes);
    alert(`Recuperación completada. Favoritos actuales: ${merged.length}. Nuevos recuperados: ${added}.`);
};

function aplicarMascaraVisualizadorEnUI() {
    const blurTargets = [
        'kpi-ingresos', 'kpi-beneficio', 'kpi-inversion', 'kpi-roi',
        'admin-profit-kpi-ingresos', 'admin-profit-kpi-beneficio', 'admin-profit-kpi-inversion', 'admin-profit-kpi-roi'
    ];

    const activo = esRolVisualizador();
    blurTargets.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.filter = activo ? 'blur(6px)' : '';
        el.style.opacity = activo ? '0.65' : '';
        if (activo) el.setAttribute('title', 'Sin permisos para datos sensibles');
        else el.removeAttribute('title');
    });
}

function mostrarNotificacionScraping(data) {
    // Si ya existe un toast de scraping, lo quitamos
    const oldToast = document.getElementById('toast-scraping');
    if (oldToast) oldToast.remove();

    const toast = document.createElement('div');
    toast.id = 'toast-scraping';
    toast.className = 'fixed bottom-24 left-1/2 -translate-x-1/2 z-[9999] bg-indigo-600 text-white px-6 py-4 rounded-2xl shadow-2xl flex flex-col gap-2 border border-indigo-400 animate-bounce-short';
    toast.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="text-2xl">🤖</span>
            <div>
                <p class="font-bold">Scraping de GitHub finalizado</p>
                <p class="text-xs opacity-90">${data.mensaje}</p>
            </div>
            <button onclick="this.parentElement.parentElement.remove()" class="ml-4 hover:bg-white/10 p-1 rounded-full">✕</button>
        </div>
        <button onclick="window.location.reload()" class="bg-white/20 hover:bg-white/30 text-xs py-2 rounded-lg font-bold transition-all">
            ACTUALIZAR VISTA AHORA
        </button>
    `;
    document.body.appendChild(toast);

    // Auto-eliminar a los 15 segundos
    setTimeout(() => { if (toast.parentElement) toast.remove(); }, 15000);
}
let CAL_STOCK_MES = new Date().getMonth() + 1;
let CAL_STOCK_ANIO = new Date().getFullYear();
let LOGS_MES_ACTUAL = {};
let NOTAS_LOCALES = [];
let LISTA_TAREAS = [];
let LISTA_FAQS = [];
let LISTA_CITAS = [];
let CITA_NEGOCIOS_CACHE = [];
let LISTA_ESTADOS_KANBAN = [];
let GLOBO_INSTANCE = null;
let GLOBO_RENDERER = null;
let GLOBO_CONTROLS = null;
let GLOBO_COMPOSER = null;
let GLOBO_ANIM_FRAME = null;
let THREE_STACK_PROMISE = null;
let FOTOS_FORMULARIO_TEMP = [];
let resultadosScraperActual = null;

function loadExternalScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const script = document.createElement('script');
        script.src = src;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
        document.head.appendChild(script);
    });
}

async function loadScriptWithFallback(urls) {
    let lastErr = null;
    for (const url of urls) {
        try {
            await loadExternalScript(url);
            return;
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr || new Error('No se pudo cargar script externo.');
}

async function ensureThreeStackLoaded() {
    if (window.THREE && window.ThreeGlobe) return;
    if (!THREE_STACK_PROMISE) {
        THREE_STACK_PROMISE = (async () => {
            await loadScriptWithFallback([
                'https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.min.js',
                'https://unpkg.com/three@0.159.0/build/three.min.js'
            ]);
            await loadScriptWithFallback([
                'https://cdn.jsdelivr.net/npm/three-globe@2.31.0/dist/three-globe.min.js',
                'https://unpkg.com/three-globe@2.31.0/dist/three-globe.min.js'
            ]);
        })();
    }
    await THREE_STACK_PROMISE;
}

function numeroSeguro(valor, fallback = 0) {
    const normalizado = Number(String(valor ?? '').replace(/\s+/g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
    return Number.isFinite(normalizado) ? normalizado : fallback;
}

function valorNumeroSeguro(valor, fallback = 0) {
    return String(numeroSeguro(valor, fallback));
}

// --- NUEVO ESTADO PARA PAGINACIÓN ---
let CURRENT_PAGE = 1;
let TOTAL_PAGES = 1;
let IS_LOADING_MORE = false;

// --- FUNCIONES DE UTILIDAD (DEBOUNCE & THROTTLE) ---
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// --- LÓGICA DEL SCRAPER (VINTED / CSV) ---
function procesarScraperVinted() {
    document.getElementById('modal-scraper').classList.remove('hidden');
    document.getElementById('scraper-step-1').classList.remove('hidden');
    document.getElementById('scraper-step-2').classList.add('hidden');
    document.getElementById('scraper-loader').classList.add('hidden');
    document.getElementById('scraper-url').value = '';
    document.getElementById('scraper-file-input').value = '';
    document.getElementById('badge-scraper-count').classList.add('hidden');
    renderSavedUrls();
}

function cerrarModalScraper() {
    document.getElementById('modal-scraper').classList.add('hidden');
}

async function iniciarScraping() {
    const url = document.getElementById('scraper-url').value;
    const alias = (document.getElementById('scraper-url-alias')?.value || '').trim();
    if(!url) return alert('Debes introducir una cuenta o URL.');

    document.getElementById('scraper-step-1').classList.add('hidden');
    document.getElementById('scraper-loader').classList.remove('hidden');
    iniciarAnimacionCargaScraper('vinted');

    try {
        actualizarCargaScraper(14, 'Enviando solicitud al backend...', 'Lanzando análisis');
        const response = await fetch(`${BACKEND_URL}/api/scraper/analizar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ url, alias })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Error al conectar con el servidor.');

        // 🚀 Si el servidor nos dice que ha lanzado GitHub, avisamos y esperamos
        if (data.success && data.mensaje) {
            // MOSTRAR LOADING EN EL SCRAPER
            document.getElementById('scraper-step-1').classList.add('hidden');
            document.getElementById('scraper-loader').classList.remove('hidden');

            actualizarCargaScraper(25, 'GitHub Actions ya está trabajando. Te aviso aquí en cuanto termine.', 'Esperando worker remoto');

            return;
        }

        resultadosScraperActual = data;
        renderizarResultadosScraping(resultadosScraperActual);
        detenerAnimacionCargaScraper();

        document.getElementById('scraper-loader').classList.add('hidden');
        document.getElementById('scraper-step-2').classList.remove('hidden');
        
        const badge = document.getElementById('badge-scraper-count');
        const total = (resultadosScraperActual.discrepancias?.length || 0) + (resultadosScraperActual.nuevos?.length || 0);
        if (total > 0) {
            badge.innerText = `${total} ACCIONES`;
            badge.classList.remove('hidden');
        }
    } catch (error) {
        detenerAnimacionCargaScraper(true);
        alert("❌ " + error.message);
        document.getElementById('scraper-loader').classList.add('hidden');
        document.getElementById('scraper-step-1').classList.remove('hidden');
    }
}

async function procesarArchivoManual(event) {
    const file = event.target.files[0];
    if (!file) return;

    document.getElementById('scraper-step-1').classList.add('hidden');
    document.getElementById('scraper-loader').classList.remove('hidden');
    iniciarAnimacionCargaScraper('archivo');

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet);

            const productosMapeados = [];
            jsonData.forEach(row => {
                let titulo = '', precio = '';
                const galeriaLocal = [];
                
                for (const key in row) {
                    const k = key.toLowerCase();
                    const val = String(row[key] || '').trim();
                    if (!val) continue;

                    const isUrl = val.startsWith('http');
                    const isPrice = val.includes('€') || /^\d+[.,]\d{2}$/.test(val) || k.includes('price') || k.includes('precio') || k.includes('text 4');

                    const parts = val.split(/[\s,;|]+/);
                    let foundUrlInParts = false;
                    
                    parts.forEach(p => {
                        const pUrl = p.trim();
                        if (pUrl.startsWith('http') && (pUrl.match(/\.(jpg|jpeg|png|webp)/i) || pUrl.includes('image') || k.includes('img') || k.includes('src'))) {
                            if (!galeriaLocal.includes(pUrl)) galeriaLocal.push(pUrl);
                            foundUrlInParts = true;
                        }
                    });

                    if (!precio && isPrice && !foundUrlInParts) {
                        precio = val;
                    } else if (!titulo && !foundUrlInParts && !isPrice && val.length > 4 && isNaN(val) && !val.startsWith('http')) {
                        const vLower = val.toLowerCase();
                        if (vLower !== 'novedad' && !vLower.includes('miembro') && !vLower.includes('ver todo')) titulo = val;
                    }
                }

                const valTitleStrict = row['web_ui__Text__text 2'] || row['web_ui__Text__text'] || row.description || row.title || row.nombre || row.prenda || row['item-card-description'];
                if (valTitleStrict) titulo = String(valTitleStrict);
                
                const valUrlStrict = row['web_ui__Image__content src'] || row['image-src'] || row.image || row.foto || row.imagen || row['item-card-image-src'];
                if (valUrlStrict) {
                    String(valUrlStrict).split(/[\s,;|]+/).reverse().forEach(u => {
                        const uTrim = u.trim();
                        if (uTrim.startsWith('http') && !galeriaLocal.includes(uTrim)) {
                            galeriaLocal.unshift(uTrim);
                        }
                    });
                }

                let cleanPrice = '';
                if (precio) {
                    cleanPrice = precio.replace(/[^\d,.]/g, '').trim();
                    if (cleanPrice.includes(',') && cleanPrice.includes('.')) { 
                        cleanPrice = cleanPrice.replace(/\./g, '').replace(',', '.');
                    } else if (cleanPrice.includes(',')) { 
                        cleanPrice = cleanPrice.replace(',', '.');
                    }
                }

                if (titulo && cleanPrice) {
                    let imagen = galeriaLocal.length > 0 ? galeriaLocal[0] : '';
                    let galeria = galeriaLocal.length > 1 ? galeriaLocal.slice(1) : [];
                    productosMapeados.push({ titulo, precio: cleanPrice, imagen, galeria });
                }
            });

            if (productosMapeados.length === 0) throw new Error("No se pudo extraer la información de los productos. Asegúrate de que el CSV tenga textos descriptivos, imágenes y un precio con euros.");

            const response = await fetch(`${BACKEND_URL}/api/scraper/analizar-manual`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ productosExtraidos: productosMapeados })
            });

            if (!response.ok) throw new Error('Error al analizar el archivo.');

            resultadosScraperActual = await response.json();
            renderizarResultadosScraping(resultadosScraperActual);

            detenerAnimacionCargaScraper();

            document.getElementById('scraper-loader').classList.add('hidden');
            document.getElementById('scraper-step-2').classList.remove('hidden');
            
            const badge = document.getElementById('badge-scraper-count');
            const total = (resultadosScraperActual.discrepancias?.length || 0) + (resultadosScraperActual.nuevos?.length || 0) + (resultadosScraperActual.identicos?.length || 0);
            if (total > 0) {
                badge.innerText = `${total} EN ARCHIVO`;
                badge.classList.remove('hidden');
            }
        } catch (error) {
            detenerAnimacionCargaScraper(true);
            alert("❌ Error al leer el archivo: " + error.message);
            procesarScraperVinted();
        }
    };
    reader.readAsArrayBuffer(file);
}

function toggleSelectAllNewItems(checked) {
    const checkboxes = document.querySelectorAll('.check-new-scraper');
    checkboxes.forEach(cb => cb.checked = checked);
}

function toggleSelectAllMissingItems(checked) {
    const checkboxes = document.querySelectorAll('.check-miss-scraper');
    checkboxes.forEach(cb => cb.checked = checked);
}

function obtenerNombreEstadoVenta() {
    const estVenta = (LISTA_ESTADOS_KANBAN || []).find(e => e.rolFinanciero === 'Venta');
    return estVenta?.nombre || 'Vendido';
}

function marcarDesaparecidosComoVendidos() {
    if (!resultadosScraperActual?.desaparecidos?.length) return;

    const ids = Array.from(document.querySelectorAll('.check-miss-scraper:checked'))
        .map(cb => parseInt(cb.value, 10))
        .filter(i => Number.isInteger(i))
        .map(i => resultadosScraperActual.desaparecidos[i]?.idMongo)
        .filter(Boolean);

    if (ids.length === 0) {
        alert('Selecciona al menos un artículo no visible para marcar como vendido.');
        return;
    }

    abrirModalPostVenta(ids, obtenerNombreEstadoVenta(), {
        comentarioSugerido: 'Marcado desde Scraper: el artículo ya no aparece en Vinted.',
        canalSugerido: 'Vinted'
    });
}

function renderizarResultadosScraping(data) {
    const tbody = document.getElementById('scraper-results-body');
    const gridNuevos = document.getElementById('scraper-grid-nuevos');
    const gridExistentes = document.getElementById('scraper-grid-existentes');
    const contDisc = document.getElementById('container-discrepancias');
    const contNuev = document.getElementById('container-nuevos');
    const contExist = document.getElementById('container-existentes');
    const contDesap = document.getElementById('container-desaparecidos');
    const noRes = document.getElementById('scraper-no-results');
    const summaryText = document.getElementById('scraper-summary-text');

    if (!data) return;

    tbody.innerHTML = '';
    gridNuevos.innerHTML = '';
    gridExistentes.innerHTML = '';
    const gridDesap = document.getElementById('scraper-grid-desaparecidos');
    if (gridDesap) gridDesap.innerHTML = '';

    const discCount = data.discrepancias?.length || 0;
    const nuevoCount = data.nuevos?.length || 0;
    const identCount = data.identicos?.length || 0;
    const missCount = data.desaparecidos?.length || 0;

    const mDisc = document.getElementById('scraper-metric-disc');
    const mNuevos = document.getElementById('scraper-metric-nuevos');
    const mIdent = document.getElementById('scraper-metric-identicos');
    if (mDisc) mDisc.innerText = String(discCount);
    if (mNuevos) mNuevos.innerText = String(nuevoCount);
    if (mIdent) mIdent.innerText = String(identCount);

    const tiendasDisponibles = (LISTA_TIENDAS_GLOBAL || []).map(t => t.nombre);
    const tiendasUnicas = [...new Set(tiendasDisponibles)];
    const normalizarTxt = (v) => String(v || '').trim().toLowerCase();
    const resolverTiendaDefault = (item) => {
        const origen = String(item?.proveedor || item?.cuenta || item?.origenGrupo || '').trim();
        if (!origen) return 'Vinted';
        const exacta = tiendasUnicas.find((n) => normalizarTxt(n) === normalizarTxt(origen));
        return exacta || origen;
    };
    const defaultImportStore = 'Vinted';

    summaryText.innerHTML = `Análisis completado. He comparado Vinted con tu inventario de MongoDB:<br>
        • <span class="text-amber-400 font-bold">${discCount} cambios de precio</span>: Se han detectado modificaciones en Vinted que no tienes en el sistema.<br>
        • <span class="text-emerald-400 font-bold">${nuevoCount} productos nuevos</span>: Artículos en la web que no están registrados en Mongo.<br>
        • <span class="text-slate-400 font-bold">${identCount} artículos sin cambios</span>: Productos que ya están perfectamente sincronizados.<br>
        • <span class="text-rose-400 font-bold">${missCount} no visibles en Vinted</span>: Posibles vendidos o retirados de tu perfil.<br>
        • <span class="text-indigo-300 font-bold">Tienda de importación por defecto:</span> ${defaultImportStore}`;

    if (discCount > 0) contDisc.classList.remove('hidden'); else contDisc.classList.add('hidden');
    if (nuevoCount > 0) contNuev.classList.remove('hidden'); else contNuev.classList.add('hidden');
    if (identCount > 0) contExist.classList.remove('hidden'); else contExist.classList.add('hidden');
    if (contDesap) {
        if (missCount > 0) contDesap.classList.remove('hidden'); else contDesap.classList.add('hidden');
    }
    if (discCount === 0 && nuevoCount === 0 && identCount === 0 && missCount === 0) noRes.classList.remove('hidden'); else noRes.classList.add('hidden');

    if (discCount > 0) {
        data.discrepancias.forEach((d, i) => {
            const tituloMostrado = d.prendaNueva || d.prenda;
            tbody.innerHTML += `
                <tr class="border-b border-white/5 align-middle hover:bg-white/5">
                    <td class="py-3 pr-2 w-8"><input type="checkbox" class="check-disc-scraper form-checkbox h-4 w-4 rounded text-amber-500 bg-black/40 border-white/20" value="${i}" checked></td>
                    <td class="py-3"><img src="${d.imagen || ''}" onclick="abrirVisorScraper('disc', ${i})" class="w-10 h-12 rounded-lg object-cover border border-white/10 cursor-pointer hover:scale-110 transition-transform" title="Ver foto" onerror="this.src='data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'60\' height=\'60\' viewBox=\'0 0 60 60\'%3E%3Crect width=\'60\' height=\'60\' fill=\'%23111827\'/%3E%3Cpath d=\'M15 40l10-12 8 9 6-7 11 10\' fill=\'none\' stroke=\'%239ca3af\' stroke-width=\'3\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3Ccircle cx=\'22\' cy=\'22\' r=\'4\' fill=\'%239ca3af\'/%3E%3C/svg%3E'"></td>
                    <td class="py-3 px-2">
                        <input type="text" id="disc-item-title-${i}" value="${tituloMostrado}" class="bg-transparent border-b border-white/10 text-xs font-bold uppercase w-full focus:outline-none focus:border-amber-400 px-1 py-0.5 text-white" placeholder="Título...">
                        <div class="text-[9px] opacity-50 mt-1">En sistema: <span class="font-mono">${d.prenda}</span></div>
                    </td>
                    <td class="py-3 text-rose-400/60 line-through text-sm font-mono text-right">${d.valorAntiguo}€</td>
                    <td class="py-3 text-emerald-400 font-black text-lg text-right">
                        <input type="number" id="disc-item-price-${i}" value="${valorNumeroSeguro(d.valorNuevo)}" step="0.01" class="bg-transparent border-b border-white/10 text-base text-emerald-400 font-mono w-20 focus:outline-none focus:border-emerald-400 px-1 py-0.5 text-right"> €
                    </td>
                </tr>`;
        });
    }

    if (nuevoCount > 0) {
        let catOptions = LISTA_CATEGORIAS_GLOBAL.map(c => `<option value="${c.nombre}">${c.nombre}</option>`).join('');
        data.nuevos.forEach((n, i) => {
            const tiendaSugerida = resolverTiendaDefault(n);
            const tiendaOptions = ['<option value="">🏬 Sin asignar</option>', ...tiendasUnicas.map(t => `<option value="${t}" ${t === tiendaSugerida ? 'selected' : ''}>🏬 ${t}</option>`)].join('');
            const badgeGaleriaInfo = n.galeria && n.galeria.length > 0 ? `<div class="absolute bottom-1 right-1 bg-black/80 rounded px-1 text-[8px] font-bold border border-white/20 shadow-md">+${n.galeria.length}</div>` : '';
            
            // Pre-seleccionar talla
            const tallasDisponibles = ['S', 'M', 'L', 'XL', 'Única'];
            let tallaScraped = (n.talla || '').toUpperCase();
            if (!tallasDisponibles.includes(tallaScraped)) {
                tallaScraped = 'Única';
            }
            const tallaOptions = tallasDisponibles.map(t => `<option value="${t}" ${t === tallaScraped ? 'selected' : ''}>${t}</option>`).join('');

            gridNuevos.innerHTML += `
                <div class="flex flex-col gap-3 p-4 bg-black/20 border border-white/10 rounded-2xl hover:bg-white/5 transition-all shadow-inner relative">
                    <div class="absolute top-3 right-3 z-10">
                        <input type="checkbox" id="check-new-${i}" class="check-new-scraper w-5 h-5 rounded-md text-emerald-500 bg-black/40 border-white/20 cursor-pointer focus:ring-emerald-500" value="${i}" checked>
                    </div>
                    <div class="flex items-start gap-4">
                        <div class="relative flex-shrink-0 cursor-pointer group" onclick="abrirVisorScraper('nuevo', ${i})" title="Ver Galería">
                            <img src="${n.imagen || ''}" class="w-20 h-24 rounded-xl object-cover shadow-lg group-hover:scale-105 transition-transform" onerror="this.src='data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'80\\' height=\\'96\\' viewBox=\\'0 0 80 96\\'%3E%3Crect width=\\'80\\' height=\\'96\\' fill=\\'%23111827\\'/%3E%3Cpath d=\\'M20 60l15-18 12 14 9-10 14 15\\' fill=\\'none\\' stroke=\\'%239ca3af\\' stroke-width=\'3\\'/%3E%3C/svg%3E'">
                                ${badgeGaleriaInfo}
                        </div>
                        <div class="min-w-0 flex-1 flex flex-col gap-2 pr-6">
                            <input type="text" id="new-item-title-${i}" value="${n.prenda}" class="bg-transparent border-b-2 border-white/10 text-sm font-black uppercase w-full focus:outline-none focus:border-emerald-400 px-1 py-1 text-white transition-colors" placeholder="Título a guardar...">
                            <p class="text-[10px] font-mono opacity-70">Origen: <span class="text-cyan-300">${n.proveedor || n.cuenta || 'Vinted'}</span></p>
                            
                            <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-[10px] mt-1">
                                <div class="flex items-center gap-1.5" title="Marca">
                                    <span class="opacity-60">🏷️</span>
                                    <input type="text" id="new-item-brand-${i}" value="${n.marca || ''}" class="bg-transparent border-b border-white/10 w-full focus:outline-none focus:border-emerald-400 px-1 py-0.5 text-white/80" placeholder="Marca...">
                                </div>
                                <div class="flex items-center gap-1.5" title="Talla">
                                    <span class="opacity-60">📐</span>
                                    <select id="new-item-talla-${i}" class="bg-transparent border-b border-white/10 w-full focus:outline-none focus:border-emerald-400 px-1 py-0.5 text-white/80 appearance-none">
                                        ${tallaOptions}
                                    </select>
                                </div>
                                <div class="flex items-center gap-1.5" title="Condición">
                                    <span class="opacity-60">✨</span>
                                    <input type="text" id="new-item-condition-${i}" value="${n.condicion || ''}" class="bg-transparent border-b border-white/10 w-full focus:outline-none focus:border-emerald-400 px-1 py-0.5 text-white/80" placeholder="Condición...">
                                </div>
                                <div class="flex items-center gap-1.5" title="Favoritos">
                                    <span class="opacity-60">❤️</span>
                                    <input type="number" id="new-item-favs-${i}" value="${n.favoritos || 0}" class="bg-transparent border-b border-white/10 w-full focus:outline-none focus:border-emerald-400 px-1 py-0.5 text-white/80" placeholder="Favs...">
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-2 mt-2">
                        <select id="new-item-cat-${i}" class="bg-black/40 border border-white/10 text-[10px] rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-400 text-white">
                            <option value="General">Categoría...</option>
                            ${catOptions}
                        </select>
                        <select id="new-item-store-${i}" class="bg-indigo-500/10 border border-indigo-500/20 text-[10px] rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-400 text-indigo-100 font-bold">
                            ${tiendaOptions}
                        </select>
                    </div>
                    <div class="grid grid-cols-3 gap-2 mt-1">
                        <div class="bg-black/40 border border-white/10 rounded-lg px-2 py-1">
                            <label class="block text-[8px] opacity-60 uppercase">Coste</label>
                            <input type="number" id="new-item-cost-${i}" value="0" step="0.01" class="w-full bg-transparent text-xs py-0.5 focus:outline-none text-white">
                        </div>
                        <div class="bg-black/40 border border-white/10 rounded-lg px-2 py-1">
                            <label class="block text-[8px] opacity-60 uppercase">Precio Venta</label>
                            <input type="number" id="new-item-price-${i}" value="${valorNumeroSeguro(n.precioVenta)}" step="0.01" class="w-full bg-transparent text-xs py-0.5 focus:outline-none text-emerald-400 font-bold">
                        </div>
                        <div class="bg-black/40 border border-white/10 rounded-lg px-2 py-1">
                            <label class="block text-[8px] opacity-60 uppercase">Cantidad</label>
                            <input type="number" id="new-item-qty-${i}" value="1" min="1" class="w-full bg-transparent text-xs py-0.5 focus:outline-none text-white">
                        </div>
                    </div>
                </div>`;
        });
    }

    if (identCount > 0) {
        data.identicos.forEach((n, i) => {
            gridExistentes.innerHTML += `
                <div class="flex items-center gap-3 p-2 bg-white/5 border border-white/5 rounded-xl">
                    <img src="${n.imagen || ''}" class="w-8 h-8 rounded object-cover grayscale" onerror="this.src='data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'60\' height=\'60\' viewBox=\'0 0 60 60\'%3E%3Crect width=\'60\' height=\'60\' fill=\'%23111827\'/%3E%3Cpath d=\'M15 40l10-12 8 9 6-7 11 10\' fill=\'none\' stroke=\'%239ca3af\' stroke-width=\'3\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3Ccircle cx=\'22\' cy=\'22\' r=\'4\' fill=\'%239ca3af\'/%3E%3C/svg%3E'">
                    <div class="min-w-0 flex-1">
                        <p class="text-[9px] font-bold uppercase truncate">${n.prenda}</p>
                        <p class="text-[9px] opacity-50 font-mono">${n.precio}€</p>
                        <p class="text-[8px] opacity-40 font-mono">Alta: ${n.fechaRegistro || 's/f'}${n.fechaVenta ? ` · Vendido: ${n.fechaVenta}` : ''}</p>
                    </div>
                    <div class="flex gap-1">
                        <button onclick="cerrarModalScraper(); editItem('${n.idMongo}')" class="text-[10px] bg-blue-500/20 hover:bg-blue-500 text-blue-400 hover:text-white px-2 py-1 rounded-lg transition-all">Editar</button>
                        <button onclick="deleteItemFromScraper('${n.idMongo}')" class="text-[10px] bg-rose-500/10 hover:bg-rose-600 text-rose-500 hover:text-white px-2 py-1 rounded-lg transition-all">🗑️</button>
                    </div>
                </div>`;
        });
    }

    if (missCount > 0 && gridDesap) {
        data.desaparecidos.forEach((n, i) => {
            gridDesap.innerHTML += `
                <div class="flex items-center gap-3 p-2 bg-rose-500/5 border border-rose-500/20 rounded-xl">
                    <input type="checkbox" class="check-miss-scraper w-4 h-4 rounded text-rose-500 bg-black/40 border-white/20 cursor-pointer" value="${i}" checked>
                    <img src="${n.imagen || ''}" class="w-8 h-8 rounded object-cover" onerror="this.src='data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'60\' height=\'60\' viewBox=\'0 0 60 60\'%3E%3Crect width=\'60\' height=\'60\' fill=\'%23111827\'/%3E%3Cpath d=\'M15 40l10-12 8 9 6-7 11 10\' fill=\'none\' stroke=\'%239ca3af\' stroke-width=\'3\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3Ccircle cx=\'22\' cy=\'22\' r=\'4\' fill=\'%239ca3af\'/%3E%3C/svg%3E'">
                    <div class="min-w-0 flex-1">
                        <p class="text-[9px] font-bold uppercase truncate">${n.prenda}</p>
                        <p class="text-[8px] opacity-60 font-mono">${n.precio || 0}€ · Alta: ${n.fechaRegistro || 's/f'}</p>
                        ${n.comentariosProducto ? `<p class="text-[8px] opacity-45 truncate">${n.comentariosProducto}</p>` : ''}
                    </div>
                    <button onclick="cerrarModalScraper(); editItem('${n.idMongo}')" class="text-[10px] bg-blue-500/20 hover:bg-blue-500 text-blue-400 hover:text-white px-2 py-1 rounded-lg transition-all">Editar</button>
                </div>`;
        });
    }
}

async function autorizarCambiosScraping() {
    const checkNodes = Array.from(document.querySelectorAll('.check-disc-scraper:checked'));
    const selected = checkNodes.map(cb => {
        const idx = cb.value;
        const item = resultadosScraperActual.discrepancias[idx];
        const tituloEditado = document.getElementById(`disc-item-title-${idx}`).value.trim() || item.prendaNueva || item.prenda;
        const precioEditado = numeroSeguro(document.getElementById(`disc-item-price-${idx}`).value, numeroSeguro(item.valorNuevo));
        return { idMongo: item.idMongo, prenda: tituloEditado, valorNuevo: precioEditado };
    });
    if (selected.length === 0) return alert('Selecciona algún cambio a sincronizar.');

    if (!confirm(`¿Estás seguro de actualizar estos ${selected.length} artículos en MongoDB basándote en lo encontrado en Vinted?`)) return;

    try {
        const response = await fetch('/api/scraper/aplicar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ cambios: selected })
        });

        if (!response.ok) throw new Error('Fallo al actualizar.');

        cantarPorVoz("Precios actualizados.");
        alert(`✅ Se han actualizado los precios de ${selected.length} artículos correctamente.`);
        await forceRefreshDataManual();
        
        const indicesToRemove = checkNodes.map(cb => parseInt(cb.value));
        resultadosScraperActual.discrepancias = resultadosScraperActual.discrepancias.filter((_, i) => !indicesToRemove.includes(i));
        
        const url = document.getElementById('scraper-url').value;
        if (url) {
            iniciarScraping();
        } else {
            renderizarResultadosScraping(resultadosScraperActual);
            if (resultadosScraperActual.nuevos?.length === 0 && resultadosScraperActual.discrepancias?.length === 0) {
                cerrarModalScraper();
            }
        }

    } catch (error) {
        alert(error.message);
    }
}

async function importarNuevosScraping() {
    const checkNodes = Array.from(document.querySelectorAll('.check-new-scraper:checked'));
    const selected = checkNodes.map(cb => {
        const idx = cb.value;
        const itemOriginal = resultadosScraperActual.nuevos[idx];
        const tituloEditado = document.getElementById(`new-item-title-${idx}`).value.trim() || itemOriginal.prenda;
        const precioEditado = numeroSeguro(document.getElementById(`new-item-price-${idx}`).value, numeroSeguro(itemOriginal.precioVenta));
        const catEditada = document.getElementById(`new-item-cat-${idx}`).value || 'General';
        const tallaEditada = document.getElementById(`new-item-talla-${idx}`).value || 'Única';
        const costEditado = numeroSeguro(document.getElementById(`new-item-cost-${idx}`)?.value, 0);
        const qtyEditada = parseInt(document.getElementById(`new-item-qty-${idx}`)?.value) || 1;
        const canalEditado = 'Vinted'; // Forzado a Vinted en scraper
        const tiendaEditada = document.getElementById(`new-item-store-${idx}`)?.value || itemOriginal.proveedor || itemOriginal.cuenta || 'Vinted';
        const galeriaOriginal = itemOriginal.galeria || [];
        const descripcionOriginal = itemOriginal.descripcion || '';

        // NEW fields
        const marcaEditada = document.getElementById(`new-item-brand-${idx}`)?.value.trim() || itemOriginal.marca || '';
        const condicionEditada = document.getElementById(`new-item-condition-${idx}`)?.value.trim() || itemOriginal.condicion || '';
        const favoritosEditado = parseInt(document.getElementById(`new-item-favs-${idx}`)?.value, 10) || itemOriginal.popularidad || 0;

        return { 
            ...itemOriginal, prenda: tituloEditado, precioVenta: precioEditado, 
            categoria: catEditada, talla: tallaEditada, precioCompra: costEditado, 
            cantidad: qtyEditada, canalVenta: canalEditado, galeria: galeriaOriginal, 
            proveedor: tiendaEditada,
            // NEW
            marca: marcaEditada,
            condicion: condicionEditada,
            popularidad: favoritosEditado,
            descripcion: descripcionOriginal
        };
    });

    if (selected.length === 0) return alert('Selecciona productos para importar.');

    if (!confirm(`¿Deseas confirmar la importación de estos ${selected.length} productos nuevos a tu base de datos de MongoDB?`)) return;

    try {
        const response = await fetch('/api/scraper/importar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ productos: selected })
        });

        if (!response.ok) throw new Error('Fallo al importar.');

        const res = await response.json();
        const resumenTiendas = res.tiendas
            ? Object.entries(res.tiendas).map(([nombre, total]) => `• ${nombre}: ${total}`).join('\n')
            : '';
        const detalleDuplicados = Number(res.duplicadosOmitidos || 0) > 0
            ? `\n\nDuplicados omitidos (misma tienda): ${res.duplicadosOmitidos}`
            : '';
        alert(`✅ Se han importado ${res.count} productos exitosamente con sus fotografías a la base de datos.\n\nDistribución por tienda:\n${resumenTiendas || '• Sin detalle'}${detalleDuplicados}\n\nYa puedes verificarlos en tu inventario usando el filtro de tienda.`);
        cantarPorVoz("Importación completada.");

        await forceRefreshDataManual();
        
        const indicesToRemove = checkNodes.map(cb => parseInt(cb.value));
        resultadosScraperActual.nuevos = resultadosScraperActual.nuevos.filter((_, i) => !indicesToRemove.includes(i));
        
        const url = document.getElementById('scraper-url').value;
        if (url) {
            iniciarScraping(); 
        } else {
            renderizarResultadosScraping(resultadosScraperActual);
            if (resultadosScraperActual.nuevos?.length === 0 && resultadosScraperActual.discrepancias?.length === 0) {
                cerrarModalScraper();
            }
        }

    } catch (error) {
        alert(error.message);
    }
}

async function deleteItemFromScraper(id) {
    if (confirm("¿Seguro que quieres eliminar este artículo del sistema?")) {
        await fetch(`${BACKEND_URL}/api/ventas/${id}`, { method: 'DELETE', credentials: 'include' });
        cantarPorVoz("Artículo eliminado.");
        iniciarScraping();
    }
}

function guardarUrlScraping() {
    const url = document.getElementById('scraper-url').value.trim();
    const alias = (document.getElementById('scraper-url-alias')?.value || '').trim();
    if(!url) return;

    const saved = getSavedScraperUrls();
    const idx = saved.findIndex(item => item.url === url);

    const payload = {
        url,
        alias,
        createdAt: Date.now()
    };

    if (idx >= 0) {
        const existente = saved[idx];
        saved.splice(idx, 1);
        saved.unshift({ ...existente, ...payload, alias: alias || existente.alias || '' });
    } else {
        saved.unshift(payload);
    }

    setSavedScraperUrls(saved);
    renderSavedUrls();
    if (document.getElementById('scraper-url-alias')) document.getElementById('scraper-url-alias').value = '';
    cantarPorVoz("Favorito guardado.");
}

function cargarFavoritoScraper(idx) {
    const saved = getSavedScraperUrls();
    const item = saved[idx];
    if (!item) return;
    document.getElementById('scraper-url').value = item.url;
    const aliasInput = document.getElementById('scraper-url-alias');
    if (aliasInput) aliasInput.value = item.alias || '';
}

function renderSavedUrls() {
    const container = document.getElementById('scraper-saved-urls');
    const empty = document.getElementById('scraper-saved-urls-empty');
    if(!container) return;
    const saved = getSavedScraperUrls();
    if(saved.length === 0) {
        container.classList.add('hidden');
        if (empty) empty.classList.remove('hidden');
        return;
    }
    container.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');

    let html = '';
    saved.forEach((item, idx) => {
        const aliasSafe = item.alias || `Favorito ${idx + 1}`;
        html += `
            <div class="flex items-center justify-between gap-2 p-2 bg-black/20 rounded-xl group hover:bg-black/40 transition-colors border border-white/5">
                <div class="min-w-0 flex-1 cursor-pointer" onclick="cargarFavoritoScraper(${idx})">
                    <p class="text-[10px] font-bold uppercase tracking-wide text-indigo-300 truncate">${aliasSafe}</p>
                    <p class="text-[9px] truncate opacity-70 font-mono">${item.url}</p>
                </div>
                <div class="flex items-center gap-1">
                    <button onclick="cargarFavoritoScraper(${idx})" class="text-[9px] px-2 py-1 rounded-lg bg-blue-500/20 text-blue-300 hover:bg-blue-500/40 transition-colors">Usar</button>
                    <button onclick="eliminarUrlGuardada(${idx})" class="text-rose-500 text-[10px] font-bold px-2 py-1 rounded-lg hover:bg-rose-500/20 transition-colors">✕</button>
                </div>
            </div>`;
    });
    container.innerHTML = html;
}

function eliminarUrlGuardada(idx) {
    let saved = getSavedScraperUrls();
    saved.splice(idx, 1);
    setSavedScraperUrls(saved);
    renderSavedUrls();
}

function setEstadoHigiene(msg, tone = 'slate') {
    const el = document.getElementById('higiene-status');
    if (!el) return;
    const toneClass = tone === 'ok'
        ? 'text-emerald-300'
        : tone === 'warn'
            ? 'text-amber-300'
            : tone === 'error'
                ? 'text-rose-300'
                : 'text-slate-300';
    el.className = `text-[11px] ${toneClass}`;
    el.innerText = msg;
}

function pintarReporteHigiene(reporte) {
    const resumen = reporte?.resumen || {};
    const detalles = reporte?.detalles || {};

    const setTxt = (id, value) => {
        const el = document.getElementById(id);
        if (el) animateNumberTo(el, String(value || 0), { decimals: Number.isInteger(Number(value)) ? 0 : 2 });
    };

    setTxt('higiene-kpi-estados', resumen.estadosInvalidos || 0);
    setTxt('higiene-kpi-incompletos', resumen.incompletos || 0);
    setTxt('higiene-kpi-prov', resumen.proveedoresHuerfanos || 0);
    setTxt('higiene-kpi-cat', resumen.categoriasHuerfanas || 0);
    setTxt('higiene-kpi-dup', resumen.duplicadosExtras || 0);

    const generated = document.getElementById('higiene-generated-at');
    if (generated) {
        const ts = reporte?.generadoEn ? new Date(reporte.generadoEn) : new Date();
        generated.innerText = `Último escaneo: ${ts.toLocaleString('es-ES')}`;
    }

    const renderRows = (items, mapFn) => {
        if (!Array.isArray(items) || items.length === 0) return '<p class="text-[10px] opacity-45 italic">Sin hallazgos en esta categoría.</p>';
        return items.map(mapFn).join('');
    };

    const panel = document.getElementById('higiene-detalles-panel');
    if (!panel) return;

    panel.innerHTML = `
        <div class="card-bg border rounded-2xl p-3">
            <p class="text-[10px] font-black uppercase tracking-widest text-rose-300 mb-2">Estados inválidos</p>
            ${renderRows(detalles.estadosInvalidos, (x) => `
                <div class="text-[10px] py-1 border-b border-white/10 last:border-b-0">
                    <span class="font-mono opacity-75">${escapeHtmlSafe(x._id)}</span> · ${escapeHtmlSafe(x.prenda || 'Sin prenda')} · Estado: <b>${escapeHtmlSafe(x.estado || '-')}</b>
                </div>
            `)}
        </div>
        <div class="card-bg border rounded-2xl p-3">
            <p class="text-[10px] font-black uppercase tracking-widest text-amber-300 mb-2">Proveedores huérfanos</p>
            ${renderRows(detalles.proveedoresHuerfanos, (x) => `
                <div class="text-[10px] py-1 border-b border-white/10 last:border-b-0">
                    <b>${escapeHtmlSafe(x.proveedor || '-')}</b> · ${Number(x.cantidad || 0)} refs
                </div>
            `)}
        </div>
        <div class="card-bg border rounded-2xl p-3">
            <p class="text-[10px] font-black uppercase tracking-widest text-cyan-300 mb-2">Categorías huérfanas</p>
            ${renderRows(detalles.categoriasHuerfanas, (x) => `
                <div class="text-[10px] py-1 border-b border-white/10 last:border-b-0">
                    <b>${escapeHtmlSafe(x.categoria || '-')}</b> · ${Number(x.cantidad || 0)} refs
                </div>
            `)}
        </div>
        <div class="card-bg border rounded-2xl p-3">
            <p class="text-[10px] font-black uppercase tracking-widest text-fuchsia-300 mb-2">Duplicados por firma</p>
            ${renderRows(detalles.duplicadosFirma, (x) => `
                <div class="text-[10px] py-1 border-b border-white/10 last:border-b-0">
                    <b>${escapeHtmlSafe(x.ejemploPrenda || '-')}</b> · ${escapeHtmlSafe(x.ejemploProveedor || '-')} · x${Number(x.count || 0)}
                </div>
            `)}
        </div>
    `;
}

function opcionesDestinoHigiene(tipo) {
    const cat = HIGIENE_REPORTE_CACHE?.catalogos || {};
    const lista = tipo === 'categoria-huerfana'
        ? (Array.isArray(cat.categorias) ? cat.categorias : [])
        : (Array.isArray(cat.tiendas) ? cat.tiendas : []);
    return lista;
}

function prepararDecisionesHigiene() {
    const detalles = HIGIENE_REPORTE_CACHE?.detalles || {};
    const prov = Array.isArray(detalles.proveedoresHuerfanos) ? detalles.proveedoresHuerfanos : [];
    const cat = Array.isArray(detalles.categoriasHuerfanas) ? detalles.categoriasHuerfanas : [];
    const now = Date.now();

    const filas = [];
    prov.forEach((it, idx) => {
        const origen = String(it?.proveedor || '').trim();
        if (!origen) return;
        filas.push({
            id: `prov-${now}-${idx}`,
            tipo: 'proveedor-huerfano',
            origen,
            cantidad: Number(it?.cantidad || 0),
            accion: 'crear',
            destino: ''
        });
    });

    cat.forEach((it, idx) => {
        const origen = String(it?.categoria || '').trim();
        if (!origen) return;
        filas.push({
            id: `cat-${now}-${idx}`,
            tipo: 'categoria-huerfana',
            origen,
            cantidad: Number(it?.cantidad || 0),
            accion: 'crear',
            destino: ''
        });
    });

    HIGIENE_DECISIONES_UI = filas;
}

function renderPanelDecisionesHigiene() {
    const panel = document.getElementById('higiene-decisiones-panel');
    if (!panel) return;

    if (!Array.isArray(HIGIENE_DECISIONES_UI) || HIGIENE_DECISIONES_UI.length === 0) {
        panel.innerHTML = '<p class="text-[10px] opacity-45 italic">No hay objetos huérfanos para decidir.</p>';
        return;
    }

    const filasHtml = HIGIENE_DECISIONES_UI.map((item, idx) => {
        const opcionesDestino = opcionesDestinoHigiene(item.tipo);
        const destinoSelectHtml = opcionesDestino.map((x) => {
            const selected = String(x) === String(item.destino || '') ? 'selected' : '';
            return `<option value="${escapeHtmlSafe(x)}" ${selected}>${escapeHtmlSafe(x)}</option>`;
        }).join('');

        const destinoInputVisible = item.accion === 'renombrar';
        const destinoSelectVisible = item.accion === 'anidar';

        return `
            <div class="rounded-xl border border-white/10 bg-black/20 p-2.5 mb-2">
                <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <p class="text-[10px] font-black uppercase tracking-wider ${item.tipo === 'categoria-huerfana' ? 'text-indigo-300' : 'text-cyan-300'}">${item.tipo === 'categoria-huerfana' ? 'Categoría huérfana' : 'Proveedor huérfano'}</p>
                    <p class="text-[10px] opacity-70">${item.cantidad} refs</p>
                </div>
                <p class="text-[11px] font-mono mb-2">${escapeHtmlSafe(item.origen)}</p>

                <div class="grid grid-cols-1 lg:grid-cols-[210px_1fr] gap-2 items-center">
                    <select class="input-bg border rounded-lg px-2 py-1.5 text-[10px] dropdown-bg" onchange="actualizarAccionDecisionHigiene(${idx}, this.value)">
                        <option value="ignorar" ${item.accion === 'ignorar' ? 'selected' : ''}>Ignorar (no tocar)</option>
                        <option value="crear" ${item.accion === 'crear' ? 'selected' : ''}>Crear en catálogo</option>
                        <option value="renombrar" ${item.accion === 'renombrar' ? 'selected' : ''}>Renombrar a...</option>
                        <option value="anidar" ${item.accion === 'anidar' ? 'selected' : ''}>Anidar en existente...</option>
                        <option value="limpiar-referencia" ${item.accion === 'limpiar-referencia' ? 'selected' : ''}>Limpiar referencia</option>
                        <option value="eliminar-articulos" ${item.accion === 'eliminar-articulos' ? 'selected' : ''}>Eliminar artículos</option>
                    </select>
                    <div class="flex gap-2">
                        <input
                            type="text"
                            value="${escapeHtmlSafe(item.destino || '')}"
                            oninput="actualizarDestinoDecisionHigiene(${idx}, this.value)"
                            placeholder="Nombre destino (para renombrar)"
                            class="input-bg border rounded-lg px-2 py-1.5 text-[10px] flex-1 ${destinoInputVisible ? '' : 'hidden'}"
                            id="higiene-destino-input-${idx}">
                        <select
                            class="input-bg border rounded-lg px-2 py-1.5 text-[10px] dropdown-bg flex-1 ${destinoSelectVisible ? '' : 'hidden'}"
                            onchange="actualizarDestinoDecisionHigiene(${idx}, this.value)"
                            id="higiene-destino-select-${idx}">
                            <option value="">Selecciona destino existente</option>
                            ${destinoSelectHtml}
                        </select>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    panel.innerHTML = filasHtml;
}

window.actualizarAccionDecisionHigiene = function(idx, accion) {
    if (!HIGIENE_DECISIONES_UI[idx]) return;
    HIGIENE_DECISIONES_UI[idx].accion = String(accion || '').trim();
    if (!['renombrar', 'anidar'].includes(HIGIENE_DECISIONES_UI[idx].accion)) {
        HIGIENE_DECISIONES_UI[idx].destino = '';
    }
    renderPanelDecisionesHigiene();
}

window.actualizarDestinoDecisionHigiene = function(idx, destino) {
    if (!HIGIENE_DECISIONES_UI[idx]) return;
    HIGIENE_DECISIONES_UI[idx].destino = String(destino || '').trim();
}

window.prepararDecisionesHigieneDesdeUI = function() {
    if (!HIGIENE_REPORTE_CACHE) {
        setEstadoHigiene('Primero ejecuta un escaneo para preparar decisiones.', 'warn');
        return;
    }
    prepararDecisionesHigiene();
    renderPanelDecisionesHigiene();
    setEstadoHigiene(`Decisiones preparadas: ${HIGIENE_DECISIONES_UI.length} objetos.`, 'ok');
}

window.aplicarDecisionesHigieneUI = async function() {
    if (!Array.isArray(HIGIENE_DECISIONES_UI) || HIGIENE_DECISIONES_UI.length === 0) {
        setEstadoHigiene('No hay decisiones preparadas. Pulsa Preparar.', 'warn');
        return;
    }

    const dryRun = document.getElementById('higiene-dry-run')?.checked !== false;
    const payloadDecisions = HIGIENE_DECISIONES_UI.map((x) => ({
        tipo: x.tipo,
        origen: x.origen,
        accion: x.accion,
        destino: x.destino
    }));

    const invalidas = payloadDecisions.filter((d) => ['renombrar', 'anidar'].includes(d.accion) && !String(d.destino || '').trim());
    if (invalidas.length > 0) {
        setEstadoHigiene('Hay decisiones con destino vacío (renombrar/anidar).', 'error');
        return;
    }

    const usaEliminar = payloadDecisions.some((d) => d.accion === 'eliminar-articulos');
    if (usaEliminar && !confirm('Incluiste "Eliminar artículos" en al menos una decisión. Esta acción es destructiva. ¿Continuar?')) {
        return;
    }

    if (!dryRun && !confirm('Vas a aplicar decisiones reales por objeto. ¿Confirmas ejecutar cambios?')) return;

    const btnApply = document.getElementById('btn-higiene-apply');
    if (btnApply) btnApply.disabled = true;
    setEstadoHigiene(dryRun ? 'Simulando decisiones por objeto...' : 'Aplicando decisiones por objeto...', 'warn');

    try {
        const res = await fetch('/api/higiene/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                action: 'aplicar-decisiones-objetos',
                dryRun,
                decisions: payloadDecisions
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

        const resultBox = document.getElementById('higiene-action-result');
        if (resultBox) {
            resultBox.innerHTML = `<pre class="text-[10px] whitespace-pre-wrap break-words">${escapeHtmlSafe(JSON.stringify(data, null, 2))}</pre>`;
        }

        setEstadoHigiene(dryRun ? 'Dry-run por objeto completado.' : 'Decisiones aplicadas correctamente.', 'ok');

        if (!dryRun) {
            HIGIENE_REPORTE_CACHE = null;
            HIGIENE_DECISIONES_UI = [];
            await escanearHigieneDB(true);
        }
    } catch (e) {
        setEstadoHigiene(`Error aplicando decisiones: ${e.message}`, 'error');
    } finally {
        if (btnApply) btnApply.disabled = false;
    }
}

window.escanearHigieneDB = async function(forzar = true) {
    const sec = document.getElementById('sec-higiene') || document.getElementById('sec-ajustes');
    if (!sec || sec.classList.contains('hidden')) return;

    if (!forzar && HIGIENE_REPORTE_CACHE) {
        pintarReporteHigiene(HIGIENE_REPORTE_CACHE);
        return;
    }

    setEstadoHigiene('Escaneando integridad de datos...', 'warn');
    const btn = document.getElementById('btn-higiene-scan');
    if (btn) btn.disabled = true;

    try {
        const res = await fetch('/api/higiene/scan?limit=30', { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

        HIGIENE_REPORTE_CACHE = data;
        pintarReporteHigiene(data);
        prepararDecisionesHigiene();
        renderPanelDecisionesHigiene();
        setEstadoHigiene('Escaneo completado. Revisa hallazgos y aplica con dry-run.', 'ok');
    } catch (e) {
        setEstadoHigiene(`Error al escanear: ${e.message}`, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
};

window.ejecutarAccionHigieneDB = async function() {
    const actionEl = document.getElementById('higiene-action-select');
    const dryEl = document.getElementById('higiene-dry-run');
    const action = String(actionEl?.value || '').trim();
    const dryRun = dryEl?.checked !== false;
    if (!action) return;

    if (!dryRun && !confirm('Vas a modificar datos reales de la empresa actual. ¿Continuar?')) return;

    setEstadoHigiene(dryRun ? 'Simulando acción (dry-run)...' : 'Aplicando cambios reales...', 'warn');
    const btn = document.getElementById('btn-higiene-apply');
    if (btn) btn.disabled = true;

    try {
        const res = await fetch('/api/higiene/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ action, dryRun })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

        const resultBox = document.getElementById('higiene-action-result');
        if (resultBox) {
            resultBox.innerHTML = `<pre class="text-[10px] whitespace-pre-wrap break-words">${escapeHtmlSafe(JSON.stringify(data, null, 2))}</pre>`;
        }

        setEstadoHigiene(dryRun ? 'Dry-run completado. Revisa la simulación.' : 'Acción aplicada correctamente.', 'ok');
        if (!dryRun) {
            HIGIENE_REPORTE_CACHE = null;
            await escanearHigieneDB(true);
        }
    } catch (e) {
        setEstadoHigiene(`Error en acción: ${e.message}`, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
};

// --- FUNCIONES DEBOUNCED GLOBALES ---
window.debouncedCambiarFiltroColumna = debounce(cambiarFiltroColumna, 300);
window.debouncedFiltrarProductosMenu = debounce(filtrarProductosMenu, 250);
window.filtrarMonopolioUrls = debounce(filtrarMonopolioUrls, 250);
window.debouncedFiltrarCRM = debounce(filtrarCRM, 300);

// --- LÓGICA DE LA APLICACIÓN PRINCIPAL ---
let ITEM_FOTOS_ACTUAL = null;
let IDX_FOTO_ACTUAL = -1; 

function abrirVisorFotos(id) {

    const item = BASE_DATOS.find(v => v._id === id);
    if (!item) return;
    ITEM_FOTOS_ACTUAL = item;
    if (!ITEM_FOTOS_ACTUAL.galeria) ITEM_FOTOS_ACTUAL.galeria = [];
    
    document.getElementById('visor-item-id').value = id;
    document.getElementById('visor-fotos-titulo').innerText = item.prenda;
    document.getElementById('modal-visor-fotos').classList.remove('hidden');
    
    seleccionarFotoVisor(item.imagen ? -1 : (item.galeria.length > 0 ? 0 : -1));
    renderizarMiniaturasVisor();
}

// --- LÓGICA DE MONOPOLIO ---

async function renderMonopolioUrls() {
    try {
        const res = await fetch('/api/monopolio/urls', { credentials: 'include' });
        const ct = String(res.headers.get('content-type') || '').toLowerCase();
        if (!res.ok) {
            const msg = ct.includes('application/json') ? (await res.json())?.error : `HTTP ${res.status}`;
            throw new Error(msg || 'No se pudieron cargar las URLs de Monopolio.');
        }
        if (!ct.includes('application/json')) {
            throw new Error('Respuesta no JSON del servidor (posible ruta API interceptada).');
        }

        MONOPOLIO_URLS = await res.json();
        if (!Array.isArray(MONOPOLIO_URLS)) {
            throw new Error('Formato inválido al cargar URLs de Monopolio.');
        }
        filtrarMonopolioUrls();
    } catch (e) {
        console.error("Error cargando URLs de monopolio", e);
        const container = document.getElementById('lista-monopolio-urls');
        if (container) {
            container.innerHTML = `<p class="text-xs text-rose-400">No se pudieron cargar las URLs: ${e.message}</p>`;
        }
    }
}

function filtrarMonopolioUrls(query = '') {
    const q = String(query || '').trim();
    const qLower = q.toLowerCase();
    const container = document.getElementById('lista-monopolio-urls');
    if (!container) return;

    const escapeHtml = (txt) => String(txt || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const renderListaMonopolio = (lista) => {
        const filtradas = Array.isArray(lista) ? lista : [];
        MONOPOLIO_URLS_VISTA = filtradas;

        if (filtradas.length === 0) {
            container.innerHTML = '<p class="text-xs opacity-50 italic">No hay webs guardadas.</p>';
            return;
        }

        container.innerHTML = filtradas.map(u => `
        <div class="p-3 bg-black/20 border border-white/10 rounded-xl flex items-center justify-between gap-3">
            <div class="flex items-center gap-3 flex-1 min-w-0">
                <input
                    type="checkbox"
                    class="w-4 h-4 accent-purple-500"
                    ${MONOPOLIO_SELECTED_KEYS.has(String(u._id || u.url || '')) ? 'checked' : ''}
                    onchange="toggleMonopolioSeleccionGuardada('${escapeHtml(String(u._id || u.url || ''))}', this.checked)">
                <div class="min-w-0 flex-1">
                <p class="font-bold text-sm truncate text-purple-300">${u.alias || 'Sin Alias'}</p>
                <p class="text-xs opacity-60 truncate font-mono">${u.url}</p>
                </div>
            </div>
            <div class="flex gap-2">
                <button onclick="editarMonopolioUrl('${u._id}')" class="bg-blue-600/20 text-blue-300 px-3 py-1 rounded-lg text-xs font-bold">Editar</button>
                <button onclick="borrarMonopolioUrl('${u._id}')" class="bg-rose-600/20 text-rose-400 px-3 py-1 rounded-lg text-xs font-bold">Borrar</button>
            </div>
        </div>
    `).join('');
    };

    if (!qLower) {
        renderListaMonopolio(MONOPOLIO_URLS);
        return;
    }

    const reqSeq = ++MONOPOLIO_SEARCH_REQUEST_SEQ;
    container.innerHTML = '<p class="text-xs opacity-60 italic">Buscando en Mongo...</p>';

    fetch(`/api/monopolio/urls/search?q=${encodeURIComponent(q)}&limit=80`, { credentials: 'include' })
        .then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const items = Array.isArray(data?.items) ? data.items : [];
            return items;
        })
        .then((items) => {
            // Evita pisar resultados nuevos con respuestas lentas anteriores.
            if (reqSeq !== MONOPOLIO_SEARCH_REQUEST_SEQ) return;
            renderListaMonopolio(items);
        })
        .catch(() => {
            if (reqSeq !== MONOPOLIO_SEARCH_REQUEST_SEQ) return;
            const fallback = MONOPOLIO_URLS.filter(u =>
                (u.alias && u.alias.toLowerCase().includes(qLower)) ||
                (u.url && u.url.toLowerCase().includes(qLower))
            );
            renderListaMonopolio(fallback);
        });
}

window.toggleMonopolioSeleccionGuardada = function(key, checked) {
    const k = String(key || '');
    if (!k) return;
    if (checked) MONOPOLIO_SELECTED_KEYS.add(k);
    else MONOPOLIO_SELECTED_KEYS.delete(k);
}

window.marcarTodasMonopolioGuardadas = function(checked) {
    const baseLista = Array.isArray(MONOPOLIO_URLS_VISTA) && MONOPOLIO_URLS_VISTA.length
        ? MONOPOLIO_URLS_VISTA
        : MONOPOLIO_URLS;
    if (!Array.isArray(baseLista) || baseLista.length === 0) return;
    baseLista.forEach((u) => {
        const key = String(u._id || u.url || '');
        if (!key) return;
        if (checked) MONOPOLIO_SELECTED_KEYS.add(key);
        else MONOPOLIO_SELECTED_KEYS.delete(key);
    });

    const searchValue = document.getElementById('monopolio-search-input')?.value || '';
    filtrarMonopolioUrls(searchValue);
}

function normalizarMonopolioUrlManual(valor) {
    let url = String(valor || '').trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
        const u = new URL(url);
        u.hash = '';
        u.search = '';
        u.pathname = u.pathname.replace(/\/+$/, '');
        return u.toString();
    } catch (_) {
        return '';
    }
}

function renderMonopolioTempUrls() {
    const container = document.getElementById('lista-monopolio-temp');
    if (!container) return;

    if (!MONOPOLIO_TEMP_URLS.length) {
        container.innerHTML = '<p class="text-[10px] opacity-50 italic">Aún no hay URLs temporales preparadas.</p>';
        return;
    }

    container.innerHTML = MONOPOLIO_TEMP_URLS.map((item, idx) => `
        <div class="p-2 rounded-xl border border-white/10 bg-black/20 flex items-start gap-2">
            <input type="checkbox" class="mt-1 w-4 h-4 accent-cyan-500" ${item.selected ? 'checked' : ''} onchange="toggleMonopolioTempSeleccion(${idx}, this.checked)">
            <div class="min-w-0 flex-1">
                <p class="text-[10px] font-black uppercase tracking-widest text-cyan-200 truncate">${escapeHtmlSafe(item.alias || `URL ${idx + 1}`)}</p>
                <p class="text-[10px] opacity-70 font-mono truncate">${escapeHtmlSafe(item.url)}</p>
            </div>
        </div>
    `).join('');
}

function extraerAliasDesdeUrlSeguro(url) {
    try {
        const parsed = new URL(String(url || '').trim());
        const parts = parsed.pathname.split('/').filter(Boolean);
        return parts.length > 0 ? parts[parts.length - 1] : 'Perfil';
    } catch (_) {
        return 'Perfil';
    }
}

function renderMonopolioPerfilesDescubiertos() {
    const container = document.getElementById('monopolio-discovery-list');
    const feedback = document.getElementById('monopolio-discovery-feedback');
    if (!container) return;

    if (!Array.isArray(MONOPOLIO_DISCOVERED_PROFILES) || MONOPOLIO_DISCOVERED_PROFILES.length === 0) {
        container.innerHTML = '<p class="text-[10px] opacity-50 italic">Aqui aparecera la lista de perfiles detectados.</p>';
        return;
    }

    const total = MONOPOLIO_DISCOVERED_PROFILES.length;
    const seleccionados = MONOPOLIO_DISCOVERED_PROFILES.filter((p) => p.selected !== false).length;
    if (feedback) feedback.innerText = `${total} perfiles detectados · ${seleccionados} seleccionados para analizar`;

    container.innerHTML = MONOPOLIO_DISCOVERED_PROFILES.map((perfil, idx) => {
        const alias = escapeHtmlSafe(perfil.alias || `Perfil ${idx + 1}`);
        const url = escapeHtmlSafe(perfil.url || '');
        const parent = String(perfil.parentAlias || perfil.parentCuenta || '').trim();
        const parentTxt = parent ? ` · Padre: ${escapeHtmlSafe(parent)}` : '';
        const nivel = Number(perfil.nivelCadena || 0);
        return `
            <div class="p-2 rounded-xl border border-white/10 bg-black/20 flex items-start gap-2">
                <input type="checkbox" class="mt-1 w-4 h-4 accent-emerald-500" ${perfil.selected !== false ? 'checked' : ''} onchange="togglePerfilDescubiertoMonopolio(${idx}, this.checked)">
                <div class="min-w-0 flex-1">
                    <p class="text-[10px] font-black uppercase tracking-widest text-emerald-200 truncate">${alias}</p>
                    <p class="text-[10px] opacity-70 font-mono truncate">${url}</p>
                    <p class="text-[9px] opacity-60">Nivel: ${nivel}${parentTxt}</p>
                </div>
            </div>
        `;
    }).join('');
}

window.togglePerfilDescubiertoMonopolio = function(idx, checked) {
    const item = MONOPOLIO_DISCOVERED_PROFILES[idx];
    if (!item) return;
    item.selected = Boolean(checked);
    renderMonopolioPerfilesDescubiertos();
}

window.marcarTodosPerfilesDescubiertosMonopolio = function(checked) {
    MONOPOLIO_DISCOVERED_PROFILES = (MONOPOLIO_DISCOVERED_PROFILES || []).map((p) => ({ ...p, selected: Boolean(checked) }));
    renderMonopolioPerfilesDescubiertos();
}

window.descubrirPerfilesMonopolioDesdeInput = async function() {
    const input = document.getElementById('monopolio-discovery-input') || document.getElementById('monopolio-url-input');
    const feedback = document.getElementById('monopolio-discovery-feedback');
    if (!input) return;

    const url = normalizarMonopolioUrlManual(String(input.value || '').trim());
    if (!url) {
        alert('Introduce una URL valida para descubrir perfiles.');
        return;
    }

    if (feedback) feedback.innerText = 'Descubriendo perfiles y enlaces internos...';

    try {
        const res = await fetch('/api/monopolio/discover-profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ url })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo descubrir perfiles.');

        MONOPOLIO_DISCOVERED_PROFILES = (Array.isArray(data?.perfiles) ? data.perfiles : [])
            .map((perfil) => ({
                alias: String(perfil?.alias || '').trim() || extraerAliasDesdeUrlSeguro(perfil?.url),
                url: normalizarMonopolioUrlManual(perfil?.url),
                nivelCadena: Number(perfil?.nivelCadena || 0),
                parentAlias: String(perfil?.parentAlias || perfil?.parentCuenta || '').trim(),
                selected: true
            }))
            .filter((perfil) => Boolean(perfil.url));

        const exploracion = data?.exploracion || {};
        if (feedback) {
            feedback.innerText = `Descubrimiento listo: ${MONOPOLIO_DISCOVERED_PROFILES.length} perfiles · URLs exploradas ${Number(exploracion.urlsCapturadas || 0)} · profundidad ${Number(exploracion.maxDepth || 0)}`;
        }

        renderMonopolioPerfilesDescubiertos();
        cantarPorVoz('Perfiles detectados.');
    } catch (e) {
        MONOPOLIO_DISCOVERED_PROFILES = [];
        renderMonopolioPerfilesDescubiertos();
        if (feedback) feedback.innerText = `Error en descubrimiento: ${e.message}`;
    }
}

window.prepararMonopolioUrlsTemporales = function() {
    const input = document.getElementById('monopolio-temp-input');
    const feedback = document.getElementById('monopolio-temp-feedback');
    if (!input) return;

    const raw = String(input.value || '');
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const dedupe = new Set();
    const validas = [];
    let invalidas = 0;

    lines.forEach((linea, idx) => {
        let alias = '';
        let urlParte = linea;

        if (linea.includes('|')) {
            const [left, right] = linea.split('|', 2).map(v => String(v || '').trim());
            if (/^https?:\/\//i.test(left) || left.includes('vinted.')) {
                urlParte = left;
                alias = right;
            } else {
                alias = left;
                urlParte = right;
            }
        }

        const url = normalizarMonopolioUrlManual(urlParte);
        if (!url) {
            invalidas += 1;
            return;
        }
        if (dedupe.has(url)) return;
        dedupe.add(url);

        validas.push({
            key: `tmp-${Date.now()}-${idx}`,
            alias: alias || `Temporal ${idx + 1}`,
            url,
            selected: true
        });
    });

    MONOPOLIO_TEMP_URLS = validas;
    renderMonopolioTempUrls();

    if (feedback) {
        feedback.innerHTML = `<span class="text-cyan-300">${validas.length} URLs válidas</span>${invalidas ? ` · <span class="text-amber-300">${invalidas} inválidas</span>` : ''}`;
    }
}

window.toggleMonopolioTempSeleccion = function(idx, checked) {
    const item = MONOPOLIO_TEMP_URLS[idx];
    if (!item) return;
    item.selected = Boolean(checked);
}

window.marcarTodasMonopolioTemp = function(checked) {
    MONOPOLIO_TEMP_URLS = MONOPOLIO_TEMP_URLS.map(item => ({ ...item, selected: Boolean(checked) }));
    renderMonopolioTempUrls();
}

window.limpiarMonopolioTemp = function() {
    MONOPOLIO_TEMP_URLS = [];
    const input = document.getElementById('monopolio-temp-input');
    if (input) input.value = '';
    const feedback = document.getElementById('monopolio-temp-feedback');
    if (feedback) feedback.innerHTML = '';
    renderMonopolioTempUrls();
}

function obtenerUrlsSeleccionadasMonopolio() {
    const seleccionadasGuardadas = MONOPOLIO_URLS
        .filter(u => MONOPOLIO_SELECTED_KEYS.has(String(u._id || u.url || '')))
        .map(u => ({ url: u.url, alias: u.alias || '' }));

    const seleccionadasTemp = MONOPOLIO_TEMP_URLS
        .filter(u => u.selected)
        .map(u => ({ url: u.url, alias: u.alias || '' }));

    const unicas = [];
    const dedupe = new Set();

    [...seleccionadasGuardadas, ...seleccionadasTemp].forEach((item) => {
        const url = normalizarMonopolioUrlManual(item.url);
        if (!url || dedupe.has(url)) return;
        dedupe.add(url);
        unicas.push({
            url,
            alias: String(item.alias || '').trim() || url
        });
    });

    return unicas;
}

window.limpiarFormMonopolio = function() {
    document.getElementById('form-monopolio-url').reset();
    document.getElementById('monopolio-url-id').value = '';
    document.getElementById('monopolio-form-title').innerText = 'Añadir Web para Análisis';
    document.getElementById('btn-submit-monopolio').innerText = 'Guardar Web';
    document.getElementById('btn-cancel-monopolio').classList.add('hidden');
}

window.editarMonopolioUrl = function(id) {
    const urlItem = MONOPOLIO_URLS.find(u => u._id === id);
    if (!urlItem) return;

    document.getElementById('monopolio-url-id').value = urlItem._id;
    document.getElementById('monopolio-url-alias').value = urlItem.alias || '';
    document.getElementById('monopolio-url-input').value = urlItem.url || '';

    document.getElementById('monopolio-form-title').innerText = 'Editar Web';
    document.getElementById('btn-submit-monopolio').innerText = 'Actualizar Web';
    document.getElementById('btn-cancel-monopolio').classList.remove('hidden');
    document.getElementById('monopolio-url-alias').focus();
}

window.guardarMonopolioUrl = async function(event) {
    if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
    }
    const id = document.getElementById('monopolio-url-id').value;
    const urlInputEl = document.getElementById('monopolio-url-input');
    const btnSubmitEl = document.getElementById('btn-submit-monopolio');
    let url = (urlInputEl?.value || '').trim();
    const alias = (document.getElementById('monopolio-url-alias')?.value || '').trim();
    if (!url) return alert('La URL es obligatoria.');
    if (!/^https?:\/\//i.test(url)) {
        url = `https://${url}`;
        if (urlInputEl) urlInputEl.value = url;
    }
    const method = id ? 'PUT' : 'POST';
    const endpoint = id ? `/api/monopolio/urls/${id}` : '/api/monopolio/urls';

    try {
        if (btnSubmitEl) {
            btnSubmitEl.disabled = true;
            btnSubmitEl.classList.add('opacity-60');
            btnSubmitEl.innerText = id ? 'Actualizando...' : 'Guardando...';
        }

        const res = await fetch(endpoint, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ url, alias }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al guardar');
        if (data?.duplicada) {
            cantarPorVoz('Web ya existente, alias actualizado');
            alert(data?.mensaje || 'La URL ya existía; se actualizó su alias.');
        } else {
            cantarPorVoz('Web guardada');
        }
        limpiarFormMonopolio();
        await renderMonopolioUrls();
    } catch (e) {
        alert(`Error: ${e.message}`);
    } finally {
        if (btnSubmitEl) {
            btnSubmitEl.disabled = false;
            btnSubmitEl.classList.remove('opacity-60');
            btnSubmitEl.innerText = id ? 'Actualizar Web' : 'Guardar Web';
        }
    }
}

window.borrarMonopolioUrl = async function(id) {
    if (!confirm('¿Seguro que quieres eliminar esta web de la lista?')) return;
    try {
        const res = await fetch(`/api/monopolio/urls/${id}`, { method: 'DELETE', credentials: 'include' });
        if (!res.ok && res.status !== 204) throw new Error('No se pudo borrar');
        cantarPorVoz('Web eliminada');
        await renderMonopolioUrls();
    } catch (e) {
        alert(`Error: ${e.message}`);
    }
}

window.iniciarScrapingMonopolio = async function() {
    if (!confirm(`Esto iniciará un proceso de scraping para TODAS las webs guardadas. Puede tardar varios minutos y consumir recursos. ¿Continuar?`)) return;
    
    const resultadosContainer = document.getElementById('resultados-monopolio-scraping');
    resultadosContainer.innerHTML = '';
    resetDiagnosticoMonopolio();
    iniciarAnimacionCargaMonopolio(0, 'Lanzando tareas de scraping en GitHub Actions...');

    try {
        const res = await fetch('/api/monopolio/scrape-all', { method: 'POST', credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al iniciar el scraping');

        MONOPOLIO_PROGRESS_TOTAL = Math.max(0, Number(data?.lanzadas) || 0);
        actualizarCargaMonopolio(8, `${data.message} Esperando resultados...`, 'Esperando workers');

        let detalleFallos = '';
        if (Number(data.fallidas || 0) > 0 && Array.isArray(data.detallesFallos)) {
            const top = data.detallesFallos.slice(0, 3).map((f) => `• ${f.alias || f.url}: ${String(f.detalle || 'fallo').slice(0, 90)}`).join('<br>');
            detalleFallos = `<p class="mt-2 text-[10px] text-amber-300">${data.fallidas} dispatch fallidos.<br>${top}</p>`;
        }

        const bloque = crearBloqueCargaMonopolioSiNoExiste();
        if (bloque) {
            const extra = document.createElement('div');
            extra.className = 'mt-2 text-center py-1';
            extra.innerHTML = `
                <p class="text-xs text-purple-300">${data.message} Esperando resultados...</p>
                ${detalleFallos}
            `;
            bloque.appendChild(extra);
        }
        cantarPorVoz('Scraping masivo iniciado');
    } catch (e) {
        detenerAnimacionCargaMonopolio(false);
        resultadosContainer.innerHTML = `<p class="text-xs text-rose-400">Error: ${e.message}</p>`;
    }
}

async function lanzarScrapingMonopolioSeleccion(urlsSeleccionadas, introMsg = 'Lanzando analisis seleccionado (sin guardar)...', classColor = 'cyan', vozMsg = 'Analisis seleccionado iniciado') {
    const resultadosContainer = document.getElementById('resultados-monopolio-scraping');
    if (!resultadosContainer) return;

    resultadosContainer.innerHTML = '';
    resetDiagnosticoMonopolio();
    iniciarAnimacionCargaMonopolio(0, introMsg);

    try {
        const res = await fetch('/api/monopolio/scrape-selected', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ urls: urlsSeleccionadas })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al iniciar el scraping seleccionado');

        MONOPOLIO_PROGRESS_TOTAL = Math.max(0, Number(data?.lanzadas) || 0);
        actualizarCargaMonopolio(8, `${data.message} Esperando resultados...`, 'Esperando workers');

        let detalleFallos = '';
        if (Number(data.fallidas || 0) > 0 && Array.isArray(data.detallesFallos)) {
            const top = data.detallesFallos.slice(0, 3).map((f) => `• ${f.alias || f.url}: ${String(f.detalle || 'fallo').slice(0, 90)}`).join('<br>');
            detalleFallos = `<p class="mt-2 text-[10px] text-amber-300">${data.fallidas} dispatch fallidos.<br>${top}</p>`;
        }

        const bloque = crearBloqueCargaMonopolioSiNoExiste();
        if (bloque) {
            const extra = document.createElement('div');
            extra.className = 'mt-2 text-center py-1';
            extra.innerHTML = `
                <p class="text-xs text-${classColor}-300">${data.message} Esperando resultados...</p>
                ${detalleFallos}
            `;
            bloque.appendChild(extra);
        }
        cantarPorVoz(vozMsg);
    } catch (e) {
        detenerAnimacionCargaMonopolio(false);
        resultadosContainer.innerHTML = `<p class="text-xs text-rose-400">Error: ${e.message}</p>`;
    }
}

window.iniciarScrapingMonopolioSeleccionadas = async function() {
    const seleccionadas = obtenerUrlsSeleccionadasMonopolio();
    if (seleccionadas.length === 0) {
        alert('Marca al menos una web (guardada o temporal) para analizar.');
        return;
    }

    if (!confirm(`Se lanzará scraping para ${seleccionadas.length} webs seleccionadas sin guardarlas en la base de datos. ¿Continuar?`)) return;

    await lanzarScrapingMonopolioSeleccion(
        seleccionadas,
        'Lanzando analisis seleccionado (sin guardar)...',
        'cyan',
        'Analisis seleccionado iniciado'
    );
}

window.analizarPerfilesDescubiertosMonopolio = async function() {
    const seleccionadas = (MONOPOLIO_DISCOVERED_PROFILES || [])
        .filter((p) => p.selected !== false && p.url)
        .map((p) => ({ url: p.url, alias: p.alias || extraerAliasDesdeUrlSeguro(p.url) }));

    if (seleccionadas.length === 0) {
        alert('Primero descubre perfiles y marca al menos uno para analizar.');
        return;
    }

    if (!confirm(`Se analizaran ${seleccionadas.length} perfiles detectados en la pasada de descubrimiento. ¿Continuar?`)) return;

    await lanzarScrapingMonopolioSeleccion(
        seleccionadas,
        'Lanzando segunda pasada por perfiles detectados...',
        'emerald',
        'Analisis por perfiles iniciado'
    );
}

function cerrarVisorFotos() {
    document.getElementById('modal-visor-fotos').classList.add('hidden');
    ITEM_FOTOS_ACTUAL = null;
    
    const btnAcciones = document.getElementById('visor-foto-acciones');
    if (btnAcciones) btnAcciones.style.display = '';
    const btnAddFoto = document.getElementById('input-nueva-foto-galeria');
    if (btnAddFoto && btnAddFoto.parentElement) btnAddFoto.parentElement.style.display = '';
}

function abrirVisorScraper(tipo, idx) {
    let item;
    if (tipo === 'nuevo') item = resultadosScraperActual.nuevos[idx];
    if (tipo === 'disc') item = resultadosScraperActual.discrepancias[idx];
    if (tipo === 'identico') item = resultadosScraperActual.identicos[idx];
    if (!item) return;
    
    ITEM_FOTOS_ACTUAL = { _id: 'scraper-preview', prenda: item.prendaNueva || item.prenda || 'Vista Previa', imagen: item.imagen, galeria: item.galeria || [] };
    
    document.getElementById('visor-item-id').value = 'scraper-preview'; document.getElementById('visor-fotos-titulo').innerText = ITEM_FOTOS_ACTUAL.prenda + " (Vista Previa)";
    document.getElementById('modal-visor-fotos').classList.remove('hidden');
    
    const btnAcciones = document.getElementById('visor-foto-acciones'); if(btnAcciones) btnAcciones.style.display = 'none';
    const btnAddFoto = document.getElementById('input-nueva-foto-galeria'); if(btnAddFoto && btnAddFoto.parentElement) btnAddFoto.parentElement.style.display = 'none';
    
    seleccionarFotoVisor(ITEM_FOTOS_ACTUAL.imagen ? -1 : (ITEM_FOTOS_ACTUAL.galeria.length > 0 ? 0 : -1)); renderizarMiniaturasVisor();
}

function abrirVisorFilaFormulario(idx) {
    ITEM_FOTOS_ACTUAL = {
        _id: 'form-preview',
        prenda: document.getElementById('prenda').value || 'Vista Previa del Álbum',
        imagen: FOTOS_FORMULARIO_TEMP[0] || '',
        galeria: FOTOS_FORMULARIO_TEMP.length > 1 ? FOTOS_FORMULARIO_TEMP.slice(1) : []
    };
    
    document.getElementById('visor-item-id').value = 'form-preview';
    document.getElementById('visor-fotos-titulo').innerText = ITEM_FOTOS_ACTUAL.prenda + " (Edición)";
    document.getElementById('modal-visor-fotos').classList.remove('hidden');
    
    const btnAcciones = document.getElementById('visor-foto-acciones'); if(btnAcciones) btnAcciones.style.display = 'none';
    const btnAddFoto = document.getElementById('input-nueva-foto-galeria'); if(btnAddFoto && btnAddFoto.parentElement) btnAddFoto.parentElement.style.display = 'none';
    
    let selectedIdx = -1;
    if (idx > 0) selectedIdx = idx - 1;

    seleccionarFotoVisor(selectedIdx);
    renderizarMiniaturasVisor();
}

function renderizarMiniaturasVisor() {
    const contenedor = document.getElementById('visor-tira-miniaturas');
    let html = '';
    
    if (ITEM_FOTOS_ACTUAL.imagen) {
        html += `<img src="${ITEM_FOTOS_ACTUAL.imagen}" onclick="seleccionarFotoVisor(-1)" class="w-20 h-20 md:w-full md:h-24 object-cover rounded-xl border-2 cursor-pointer transition-all flex-shrink-0 ${IDX_FOTO_ACTUAL === -1 ? 'border-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)] scale-95' : 'border-white/10 opacity-50 hover:opacity-100'}">`;
    }
    
    if (ITEM_FOTOS_ACTUAL.galeria && ITEM_FOTOS_ACTUAL.galeria.length > 0) {
        ITEM_FOTOS_ACTUAL.galeria.forEach((imgBase64, idx) => {
            html += `<img src="${imgBase64}" onclick="seleccionarFotoVisor(${idx})" class="w-20 h-20 md:w-full md:h-24 object-cover rounded-xl border-2 cursor-pointer transition-all flex-shrink-0 ${IDX_FOTO_ACTUAL === idx ? 'border-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)] scale-95' : 'border-white/10 opacity-50 hover:opacity-100'}">`;
        });
    }
    contenedor.innerHTML = html;
}

function renderizarFlechasVisor() {
    const btnPrev = document.getElementById('btn-visor-prev');
    const btnNext = document.getElementById('btn-visor-next');
    const totalFotos = (ITEM_FOTOS_ACTUAL.imagen ? 1 : 0) + (ITEM_FOTOS_ACTUAL.galeria ? ITEM_FOTOS_ACTUAL.galeria.length : 0);
    if (totalFotos > 1 && btnPrev && btnNext) {
        btnPrev.classList.remove('hidden');
        btnNext.classList.remove('hidden');
    } else if (btnPrev && btnNext) {
        btnPrev.classList.add('hidden');
        btnNext.classList.add('hidden');
    }
}

function navegarFotoVisor(delta) {
    if (!ITEM_FOTOS_ACTUAL) return;
    const totalFotos = (ITEM_FOTOS_ACTUAL.imagen ? 1 : 0) + (ITEM_FOTOS_ACTUAL.galeria ? ITEM_FOTOS_ACTUAL.galeria.length : 0);
    if (totalFotos <= 1) return;

    let currentIndex = 0;
    if (IDX_FOTO_ACTUAL === -1) {
        currentIndex = 0;
    } else {
        currentIndex = IDX_FOTO_ACTUAL + (ITEM_FOTOS_ACTUAL.imagen ? 1 : 0);
    }
    
    currentIndex += delta;
    
    if (currentIndex < 0) {
        currentIndex = totalFotos - 1;
    } else if (currentIndex >= totalFotos) {
        currentIndex = 0;
    }
    
    const nextIdx = ITEM_FOTOS_ACTUAL.imagen ? currentIndex - 1 : currentIndex;
    seleccionarFotoVisor(nextIdx);
}

function seleccionarFotoVisor(idx) {
    IDX_FOTO_ACTUAL = idx;
    const imgElement = document.getElementById('visor-foto-principal');
    const btnPortada = document.getElementById('btn-set-portada');
    imgElement.classList.add('max-w-full', 'max-h-full', 'object-contain'); // Reset zoom
    
    if (idx === -1 && !ITEM_FOTOS_ACTUAL.imagen && ITEM_FOTOS_ACTUAL.galeria.length === 0) {
        imgElement.src = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 60 60'%3E%3Crect width='60' height='60' fill='%23111827'/%3E%3Cpath d='M15 40l10-12 8 9 6-7 11 10' fill='none' stroke='%23334155' stroke-width='2'/%3E%3C/svg%3E";
        btnPortada.classList.add('hidden');
        return;
    }
    
    if (idx === -1) {
        imgElement.src = ITEM_FOTOS_ACTUAL.imagen;
        btnPortada.classList.add('hidden');
    } else {
        imgElement.src = ITEM_FOTOS_ACTUAL.galeria[idx];
        btnPortada.classList.remove('hidden');
    }
    
    renderizarFlechasVisor();
    renderizarMiniaturasVisor();
}

async function agregarFotoGaleria(event) {
    let file = event.target.files[0];
    if (!file) return;
    document.getElementById('visor-foto-acciones').classList.add('opacity-50', 'pointer-events-none');
    
    if (file.type === "image/heic" || file.type === "image/heif" || file.name.toLowerCase().endsWith(".heic")) {
        try { const convertedBlob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.8 }); file = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob; } 
        catch (err) { alert("Error al procesar foto."); document.getElementById('visor-foto-acciones').classList.remove('opacity-50', 'pointer-events-none'); return; }
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = async () => {
            const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
            const MAX = 800; let w = img.width; let h = img.height;
            if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } } else { if (h > MAX) { w *= MAX / h; h = MAX; } }
            canvas.width = w; canvas.height = h; ctx.drawImage(img, 0, 0, w, h);
            const base64 = canvas.toDataURL('image/jpeg', 0.8);
            
            if (!ITEM_FOTOS_ACTUAL.galeria) ITEM_FOTOS_ACTUAL.galeria = [];
            let payload = {};
            if (!ITEM_FOTOS_ACTUAL.imagen) { ITEM_FOTOS_ACTUAL.imagen = base64; payload = { imagen: base64 }; } 
            else { ITEM_FOTOS_ACTUAL.galeria.push(base64); payload = { galeria: ITEM_FOTOS_ACTUAL.galeria }; }

            try { await fetch(`${BACKEND_URL}/api/ventas/${ITEM_FOTOS_ACTUAL._id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) }); await forceRefreshDataManual(); ITEM_FOTOS_ACTUAL = BASE_DATOS.find(v => v._id === ITEM_FOTOS_ACTUAL._id); if (!ITEM_FOTOS_ACTUAL.galeria) ITEM_FOTOS_ACTUAL.galeria = []; seleccionarFotoVisor(payload.imagen ? -1 : ITEM_FOTOS_ACTUAL.galeria.length - 1); } 
            catch(e) { alert("Error al guardar."); }
            document.getElementById('input-nueva-foto-galeria').value = ""; document.getElementById('visor-foto-acciones').classList.remove('opacity-50', 'pointer-events-none');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function eliminarFotoActual() {
    if (!ITEM_FOTOS_ACTUAL.imagen && ITEM_FOTOS_ACTUAL.galeria.length === 0) return;
    if (!confirm("¿Eliminar esta fotografía?")) return;
    
    let payload = {};
    if (IDX_FOTO_ACTUAL === -1) { if (ITEM_FOTOS_ACTUAL.galeria && ITEM_FOTOS_ACTUAL.galeria.length > 0) { ITEM_FOTOS_ACTUAL.imagen = ITEM_FOTOS_ACTUAL.galeria.shift(); } else { ITEM_FOTOS_ACTUAL.imagen = ''; } payload = { imagen: ITEM_FOTOS_ACTUAL.imagen, galeria: ITEM_FOTOS_ACTUAL.galeria }; } 
    else { ITEM_FOTOS_ACTUAL.galeria.splice(IDX_FOTO_ACTUAL, 1); payload = { galeria: ITEM_FOTOS_ACTUAL.galeria }; }

    try { await fetch(`${BACKEND_URL}/api/ventas/${ITEM_FOTOS_ACTUAL._id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) }); await forceRefreshDataManual(); ITEM_FOTOS_ACTUAL = BASE_DATOS.find(v => v._id === ITEM_FOTOS_ACTUAL._id); if (!ITEM_FOTOS_ACTUAL.galeria) ITEM_FOTOS_ACTUAL.galeria = []; seleccionarFotoVisor(ITEM_FOTOS_ACTUAL.imagen ? -1 : -1); } 
    catch(e) { alert("Error al eliminar."); }
}

async function establecerComoPortada() {
    if (IDX_FOTO_ACTUAL === -1) return;
    const fotoSeleccionada = ITEM_FOTOS_ACTUAL.galeria[IDX_FOTO_ACTUAL]; const fotoPrincipalAntigua = ITEM_FOTOS_ACTUAL.imagen;
    ITEM_FOTOS_ACTUAL.imagen = fotoSeleccionada; ITEM_FOTOS_ACTUAL.galeria.splice(IDX_FOTO_ACTUAL, 1); if (fotoPrincipalAntigua) { ITEM_FOTOS_ACTUAL.galeria.unshift(fotoPrincipalAntigua); }
    try { await fetch(`${BACKEND_URL}/api/ventas/${ITEM_FOTOS_ACTUAL._id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ imagen: ITEM_FOTOS_ACTUAL.imagen, galeria: ITEM_FOTOS_ACTUAL.galeria }) }); await forceRefreshDataManual(); ITEM_FOTOS_ACTUAL = BASE_DATOS.find(v => v._id === ITEM_FOTOS_ACTUAL._id); if (!ITEM_FOTOS_ACTUAL.galeria) ITEM_FOTOS_ACTUAL.galeria = []; seleccionarFotoVisor(-1); } 
    catch(e) { alert("Error al cambiar portada."); }
}

async function cargarNotasBoard() {
    const res = await fetch(`${BACKEND_URL}/api/notas`, { credentials: 'include' });
    NOTAS_LOCALES = await res.json();
    renderizarNotas();
}

async function refrescarEstadosKanban() {
    try {
        const res = await fetch('/api/estados-kanban', { credentials: 'include' });
        if (!res.ok) throw new Error("Fallo red");
        const data = await res.json();
        LISTA_ESTADOS_KANBAN = Array.isArray(data) ? data : [];
    } catch(e) { 
        console.error("Error estados, usando fallback:", e);
        LISTA_ESTADOS_KANBAN = [
            { _id: '1', nombre: 'No Vendido', icono: '📦', color: 'amber', rolFinanciero: 'Stock', orden: 1 },
            { _id: '2', nombre: 'Vendido', icono: '💰', color: 'emerald', rolFinanciero: 'Venta', orden: 2 },
            { _id: '3', nombre: 'Reservado', icono: '🤝', color: 'indigo', rolFinanciero: 'Stock', orden: 3 },
            { _id: '4', nombre: 'Devuelto', icono: '⚠️', color: 'rose', rolFinanciero: 'Oculto', orden: 4 }
        ];
    }
    const selectForm = document.getElementById('estado');
    if (selectForm) {
        const valActual = selectForm.value;
        selectForm.innerHTML = LISTA_ESTADOS_KANBAN.map(e => `<option value="${e.nombre}">${e.icono} ${e.nombre}</option>`).join('');
        if (valActual && LISTA_ESTADOS_KANBAN.find(e => e.nombre === valActual)) selectForm.value = valActual;
    }

    const panelBotones = document.getElementById('botones-estados-masivos');
    if(panelBotones) {
        panelBotones.innerHTML = LISTA_ESTADOS_KANBAN.map(e => `
            <button onclick="ejecutarAccionMasivaEstado('${e.nombre}')" class="bg-${e.color || 'slate'}-600 hover:bg-${e.color || 'slate'}-700 text-white font-bold text-[10px] uppercase px-2.5 py-2 rounded-xl transition-colors shadow-lg whitespace-nowrap">${e.icono || ''} ➡️ ${e.nombre}</button>
        `).join('');
    }
    poblarFiltroEstadosVentaAnalitica();
    renderListaAjustesKanban();
}

function renderListaAjustesKanban() {
    const list = document.getElementById('lista-estados-kanban-config');
    if(!list) return;
    
    if (!LISTA_ESTADOS_KANBAN || LISTA_ESTADOS_KANBAN.length === 0) {
        list.innerHTML = '<div class="p-5 text-center text-[10px] opacity-50 font-mono border border-white/5 bg-black/20 rounded-2xl">Aún no hay columnas configuradas.</div>';
        return;
    }
    
    list.innerHTML = LISTA_ESTADOS_KANBAN.map(e => `
        <div class="p-3 bg-black/20 border border-white/5 rounded-2xl flex items-center justify-between hover:bg-white/5 transition-all mb-3">
            <div class="flex items-center gap-4">
                <div class="w-10 h-10 rounded-xl bg-slate-500/20 text-white flex items-center justify-center border border-white/10 text-xl shadow-inner">${e.icono || '📦'}</div>
                <div>
                    <p class="font-black uppercase text-[11px] tracking-wider">${e.nombre}</p>
                    <p class="text-[9px] opacity-50 font-mono text-${e.rolFinanciero === 'Venta' ? 'emerald' : (e.rolFinanciero === 'Oculto' ? 'rose' : 'amber')}-400 mt-0.5">Rol: ${e.rolFinanciero || 'Stock'} • Orden: ${e.orden || 0}</p>
                </div>
            </div>
            <div class="flex gap-2 bg-black/30 p-1.5 rounded-xl border border-white/5">
                <button onclick="editarEstadoKanban('${e._id}')" class="text-blue-400 hover:text-blue-300 text-[10px] px-2 font-bold">✏️ Editar</button>
                <button onclick="borrarEstadoKanban('${e._id}')" class="text-rose-400 hover:text-rose-300 text-[10px] px-2 font-bold">🗑️ Borrar</button>
            </div>
        </div>
    `).join('');
}

async function guardarEstadoKanban(e) {
    e.preventDefault();
    const id = document.getElementById('ek-id').value;
    const payload = { nombre: document.getElementById('ek-nombre').value.trim(), icono: document.getElementById('ek-icono').value.trim() || '🏷️', color: document.getElementById('ek-color').value, rolFinanciero: document.getElementById('ek-rol').value, orden: parseInt(document.getElementById('ek-orden').value) || 0 };
    const url = id ? `/api/estados-kanban/${id}` : '/api/estados-kanban'; const method = id ? 'PUT' : 'POST';
    await fetch(url, { method, headers: {'Content-Type':'application/json'}, credentials: 'include', body: JSON.stringify(payload) });
    limpiarFormEstadoKanban(); await refrescarEstadosKanban(); renderKanban(true);
}
function editarEstadoKanban(id) { const e = LISTA_ESTADOS_KANBAN.find(x => x._id === id); if(!e) return; document.getElementById('ek-id').value = e._id; document.getElementById('ek-nombre').value = e.nombre; document.getElementById('ek-icono').value = e.icono; document.getElementById('ek-color').value = e.color; document.getElementById('ek-rol').value = e.rolFinanciero; document.getElementById('ek-orden').value = e.orden; }
function limpiarFormEstadoKanban() { document.getElementById('form-estado-kanban').reset(); document.getElementById('ek-id').value = ''; }
async function borrarEstadoKanban(id) { if(confirm("¿Eliminar columna del tablero? Los productos conservarán su estado textualmente, pero desaparecerán de la vista principal hasta que los reasignes.")) { await fetch(`/api/estados-kanban/${id}`, { method: 'DELETE', credentials: 'include' }); await refrescarEstadosKanban(); renderKanban(true); } }

function normalizarTextoCategoria(texto) {
    return String(texto || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function inferirGrupoCategoria(nombreCategoria) {
    const n = normalizarTextoCategoria(nombreCategoria);

    if (/(camisa|camiseta|blusa|top|polo|jersey|sudadera|chaqueta|abrigo|cazadora|vestido|falda|pantalon|jean|mono|conjunto|ropa)/.test(n)) {
        return '👚 Ropa';
    }
    if (/(zapat|zapato|bota|sandalia|tacon|calzado|sneaker)/.test(n)) {
        return '👟 Calzado';
    }
    if (/(bolso|mochila|cinturon|gaf|sombrero|gorra|bisuter|joy|reloj|accesor|pañuelo|bufanda)/.test(n)) {
        return '👜 Accesorios';
    }
    if (/(nino|nina|beb|infantil|kid|juvenil)/.test(n)) {
        return '🧸 Infantil';
    }
    if (/(hogar|deco|casa|textil hogar)/.test(n)) {
        return '🏠 Hogar';
    }
    if (/(belleza|cosmet|maquill|perfume|skincare|salud)/.test(n)) {
        return '💄 Belleza';
    }
    return '📦 Otras';
}

function construirMapaCategoriasAgrupadas(listaCategorias) {
    const ordenGrupos = ['👚 Ropa', '👟 Calzado', '👜 Accesorios', '🧸 Infantil', '🏠 Hogar', '💄 Belleza', '📦 Otras'];
    const mapa = new Map();
    ordenGrupos.forEach((g) => mapa.set(g, []));

    (listaCategorias || []).forEach((c) => {
        const nombre = String(c?.nombre || '').trim();
        if (!nombre) return;
        const grupo = inferirGrupoCategoria(nombre);
        if (!mapa.has(grupo)) mapa.set(grupo, []);
        mapa.get(grupo).push(nombre);
    });

    mapa.forEach((arr, key) => {
        arr.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
        if (!arr.length) mapa.delete(key);
    });

    return mapa;
}

function poblarSelectCategoriasAgrupadas(selectNode, mapaGrupos, cfg = {}) {
    if (!selectNode) return;
    const { opcionInicialValor = null, opcionInicialTexto = '' } = cfg;

    selectNode.innerHTML = '';
    if (opcionInicialValor !== null) {
        const optBase = document.createElement('option');
        optBase.value = opcionInicialValor;
        optBase.textContent = opcionInicialTexto;
        selectNode.appendChild(optBase);
    }

    mapaGrupos.forEach((nombres, grupo) => {
        const og = document.createElement('optgroup');
        og.label = `${grupo} (${nombres.length})`;
        nombres.forEach((nombre) => {
            const opt = document.createElement('option');
            opt.value = nombre;
            opt.textContent = nombre;
            og.appendChild(opt);
        });
        selectNode.appendChild(og);
    });
}

async function refrescarCategoriasCloud() {
    const selectForm = document.getElementById('categoria');
    const selectFiltro = document.getElementById('filtro-categoria');
    const selectAn = document.getElementById('an-filtro-categoria');
    const selectMasivo = document.getElementById('categoria-masiva');
    try {
        const res = await fetch(`${BACKEND_URL}/api/categorias`, { credentials: 'include' });
        const data = await res.json();
        LISTA_CATEGORIAS_GLOBAL = data.categorias || [];

        const mapaGrupos = construirMapaCategoriasAgrupadas(LISTA_CATEGORIAS_GLOBAL);
        poblarSelectCategoriasAgrupadas(selectForm, mapaGrupos);
        poblarSelectCategoriasAgrupadas(selectFiltro, mapaGrupos, { opcionInicialValor: 'TODOS', opcionInicialTexto: '👕 Todas las categorías' });
        poblarSelectCategoriasAgrupadas(selectAn, mapaGrupos, { opcionInicialValor: 'TODOS', opcionInicialTexto: '👕 Todas' });
        poblarSelectCategoriasAgrupadas(selectMasivo, mapaGrupos, { opcionInicialValor: '', opcionInicialTexto: '👕 Categoría...' });

        if (!document.getElementById('edit-id').value) establecerValoresPorDefecto();
    } catch(e) { console.error("Error cargando categorías:", e); }
}

async function crearNuevaCategoriaDB() {
    const nombre = prompt("Nombre de la nueva categoría (puedes incluir un emoji al inicio):");
    if (!nombre || nombre.trim() === "") return;
    try {
        const res = await fetch(`${BACKEND_URL}/api/categorias`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ nombre: nombre.trim() })
        });
        if (res.ok) {
            cantarPorVoz("Categoría añadida.");
            await refrescarCategoriasCloud();
            document.getElementById('categoria').value = nombre.trim();
        } else {
            const err = await res.json(); alert(err.error || "Error al crear categoría.");
        }
    } catch(e) { alert("Fallo de conexión."); }
}

async function editarCategoriaSeleccionadaDB() {
    const nombreActual = document.getElementById('categoria').value;
    const cat = LISTA_CATEGORIAS_GLOBAL.find(c => c.nombre === nombreActual);
    if (!cat) return alert("Selecciona una categoría válida.");

    const nuevoNombre = prompt("Nuevo nombre para la categoría:", nombreActual);
    if (!nuevoNombre || nuevoNombre.trim() === "" || nuevoNombre === nombreActual) return;

    try {
        const res = await fetch(`${BACKEND_URL}/api/categorias/${cat._id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ nombre: nuevoNombre.trim() })
        });
        if (res.ok) {
            cantarPorVoz("Categoría actualizada.");
            await refrescarCategoriasCloud();
        }
    } catch(e) { alert("Error al editar."); }
}

async function eliminarCategoriaSeleccionadaDB() {
    const nombre = document.getElementById('categoria').value;
    const cat = LISTA_CATEGORIAS_GLOBAL.find(c => c.nombre === nombre);
    if (!cat) return alert("Selecciona una categoría válida.");

    if (confirm(`¿Eliminar permanentemente la categoría "${nombre}"?\nNota: Los artículos actuales conservarán su categoría como texto, pero ya no aparecerá en el listado de creación.`)) {
        try {
            const res = await fetch(`${BACKEND_URL}/api/categorias/${cat._id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (res.ok) {
                cantarPorVoz("Categoría eliminada.");
                await refrescarCategoriasCloud();
            }
        } catch(e) { alert("Error al borrar."); }
    }
}

async function crearNotaNueva() {
    navegarASeccion('sec-notas');
    const res = await fetch('/api/notas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ texto: 'Escribe tu idea aquí...', x: 50, y: 50, width: 220, height: 180, color: 'note-yellow' })
    });
    if(res.ok) cargarNotasBoard();
}

function renderizarNotas() {
    const canvas = document.getElementById('tablero-notas');
    if(!canvas) return;
    canvas.innerHTML = '';
    NOTAS_LOCALES.forEach(nota => {
        let colorClass = nota.color;
        if(colorClass === 'bg-yellow-400') colorClass = 'note-yellow';
        if(colorClass === 'bg-blue-300') colorClass = 'note-blue';
        if(colorClass === 'bg-green-300') colorClass = 'note-green';
        if(colorClass === 'bg-pink-300') colorClass = 'note-pink';

        const div = document.createElement('div');
        div.className = `sticky-note ${colorClass}`;
        div.style.left = `${nota.x}px`;
        div.style.top = `${nota.y}px`;
        div.style.width = `${nota.width}px`;
        div.style.height = `${nota.height}px`;
        
        div.innerHTML = `
            <div class="flex justify-between items-center mb-1 border-b border-black/10 pb-1.5 cursor-grab active:cursor-grabbing" onmousedown="window.iniciarArrastreNota(event, this.parentElement, '${nota._id}')">
                <span class="text-[8px] opacity-60 font-mono font-bold uppercase pointer-events-none tracking-widest">${nota.usuario.split('@')[0]}</span>
                <div class="flex gap-1.5 items-center bg-white/40 px-2 py-0.5 rounded border border-white/20 shadow-sm">
                    <button onclick="document.execCommand('bold', false, null)" class="text-[10px] hover:text-black/60 font-black px-1 transition-colors" title="Negrita">B</button>
                    <button onclick="document.execCommand('insertUnorderedList', false, null)" class="text-[10px] hover:text-black/60 font-black px-1 transition-colors" title="Lista">•≡</button>
                    <div class="w-px h-3 bg-black/20 mx-0.5"></div>
                    <button onclick="borrarNota('${nota._id}')" class="text-[10px] text-red-500 hover:text-red-700 font-bold px-0.5 transition-colors" title="Borrar">✕</button>
                </div>
            </div>
            <div class="note-content custom-scrollbar text-[11px]" contenteditable="true" onblur="actualizarNotaTexto('${nota._id}', this.innerHTML)">${nota.texto}</div>
            <div class="absolute bottom-2 left-0 right-0 flex justify-center gap-2.5 opacity-0 hover:opacity-100 transition-opacity duration-300">
                <div onclick="cambiarColorNota('${nota._id}', 'note-yellow')" class="w-4 h-4 rounded-full bg-yellow-300 border-2 border-white/60 cursor-pointer shadow-md hover:scale-110 transition-transform"></div>
                <div onclick="cambiarColorNota('${nota._id}', 'note-blue')" class="w-4 h-4 rounded-full bg-blue-300 border-2 border-white/60 cursor-pointer shadow-md hover:scale-110 transition-transform"></div>
                <div onclick="cambiarColorNota('${nota._id}', 'note-green')" class="w-4 h-4 rounded-full bg-green-300 border-2 border-white/60 cursor-pointer shadow-md hover:scale-110 transition-transform"></div>
                <div onclick="cambiarColorNota('${nota._id}', 'note-pink')" class="w-4 h-4 rounded-full bg-pink-300 border-2 border-white/60 cursor-pointer shadow-md hover:scale-110 transition-transform"></div>
            </div>
        `;
        
        new ResizeObserver(() => {
            const w = parseInt(div.style.width);
            const h = parseInt(div.style.height);
            if(w !== nota.width || h !== nota.height) {
                actualizarNotaDimensiones(nota._id, w, h);
            }
        }).observe(div);

        canvas.appendChild(div);
    });
}

window.iniciarArrastreNota = function(e, div, id) {
    if(e.target.tagName === 'BUTTON') return;
    let isDragging = true;
    
    const board = document.getElementById('tablero-notas');
    
    let initialMouseX = e.clientX;
    let initialMouseY = e.clientY;
    let initialDivX = div.offsetLeft;
    let initialDivY = div.offsetTop;

    const mouseMoveHandler = (moveEvent) => {
        if (!isDragging) return;
        let deltaX = moveEvent.clientX - initialMouseX;
        let deltaY = moveEvent.clientY - initialMouseY;
        
        let newX = Math.max(0, initialDivX + deltaX);
        let newY = Math.max(0, initialDivY + deltaY);
        
        div.style.left = `${newX}px`;
        div.style.top = `${newY}px`;
    };
    const mouseUpHandler = async () => {
        isDragging = false;
        document.removeEventListener('mousemove', mouseMoveHandler);
        document.removeEventListener('mouseup', mouseUpHandler);
        const x = parseInt(div.style.left);
        const y = parseInt(div.style.top);
        await fetch(`${BACKEND_URL}/api/notas/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ x, y })
        });
    };
    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseUpHandler);
};

async function actualizarNotaDimensiones(id, width, height) {
    await fetch(`${BACKEND_URL}/api/notas/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ width, height }) });
}

async function borrarNota(id) {
    if(confirm('¿Borrar esta nota?')) {
        await fetch(`${BACKEND_URL}/api/notas/${id}`, { method: 'DELETE', credentials: 'include' });
        cargarNotasBoard();
    }
}

async function actualizarNotaTexto(id, texto) {
    await fetch(`${BACKEND_URL}/api/notas/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ texto }) });
}

async function cambiarColorNota(id, color) {
    await fetch(`${BACKEND_URL}/api/notas/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ color }) });
    cargarNotasBoard();
}

function establecerValoresPorDefecto() {
    const selectCat = document.getElementById('categoria');
    if (selectCat && selectCat.options.length > 0) {
        const topOpt = Array.from(selectCat.options).find(o => o.value.toLowerCase().includes('tops'));
        if (topOpt) selectCat.value = topOpt.value;
        else selectCat.selectedIndex = 0;
    }
    const selectProv = document.getElementById('proveedor');
    if (selectProv && selectProv.options.length > 0) {
        const provOpt = Array.from(selectProv.options).find(o => o.value.toLowerCase().includes('seyshelleshop'));
        if (provOpt) selectProv.value = provOpt.value;
        else selectProv.selectedIndex = 0;
    }
}

async function refrescarYListarTiendasCloud() {
    const selectForm = document.getElementById('proveedor');
    const selectFiltro = document.getElementById('an-filtro-tienda');
    const selectFiltroPrincipal = document.getElementById('filtro-tienda');
    const selectMasivo = document.getElementById('tienda-masiva');
    try {
        const res = await fetch(`${BACKEND_URL}/api/tiendas`, { credentials: 'include' });
        if (!res.ok) throw new Error("Error leyendo backend");
        const data = await res.json();
        LISTA_TIENDAS_GLOBAL = data.tiendas || [];
        
        selectForm.innerHTML = '<option value="">Sin asignar</option>';
        selectFiltro.innerHTML = '<option value="TODOS">🏬 Todas las tiendas</option>';
        if (selectFiltroPrincipal) selectFiltroPrincipal.innerHTML = '<option value="TODOS">🏬 Tienda</option>';
        if(selectMasivo) selectMasivo.innerHTML = '<option value="">🏬 Tienda...</option>';

        LISTA_TIENDAS_GLOBAL.forEach(t => {
            const opt1 = document.createElement('option');
            opt1.value = t.nombre; opt1.textContent = `🏬 ${t.nombre}`;
            selectForm.appendChild(opt1);

            const opt2 = document.createElement('option');
            opt2.value = t.nombre; opt2.textContent = t.nombre;
            selectFiltro.appendChild(opt2);

            if (selectFiltroPrincipal) {
                const optP = document.createElement('option');
                optP.value = t.nombre; optP.textContent = `🏬 ${t.nombre}`;
                selectFiltroPrincipal.appendChild(optP);
            }

            if(selectMasivo) {
                const opt3 = document.createElement('option');
                opt3.value = t.nombre; opt3.textContent = t.nombre;
                selectMasivo.appendChild(opt3);
            }
        });
        if (!document.getElementById('edit-id').value) establecerValoresPorDefecto();
    } catch (err) {
        console.error("Fallo de red cloud, cargando fallback...", err);
    }
}

async function crearNuevaTiendaEnBaseDatos() {
    const nombreTienda = prompt("Nombre del nuevo proveedor/tienda:");
    if (!nombreTienda || nombreTienda.trim() === "") return;
    try {
        const res = await fetch(`${BACKEND_URL}/api/tiendas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ nombre: nombreTienda.trim() })
        });
        if (res.ok) {
            cantarPorVoz("Tienda guardada.");
            await refrescarYListarTiendasCloud();
            document.getElementById('proveedor').value = nombreTienda.trim();
        } else {
            const errData = await res.json(); alert(errData.error || "Error al inyectar tienda.");
        }
    } catch (err) { alert("Error crítico de comunicación."); }
}

async function eliminarTiendaSeleccionadaCloud() {
    const selectTienda = document.getElementById('proveedor');
    const nombreSeleccionado = selectTienda.value;
    if (!nombreSeleccionado) {
        return alert("Por favor, selecciona una tienda válida del desplegable para poder eliminarla.");
    }
    
    const tiendaObjeto = LISTA_TIENDAS_GLOBAL.find(t => t.nombre === nombreSeleccionado);
    if (!tiendaObjeto) return;

    if (confirm(`¿Seguro que deseas eliminar permanentemente la tienda "${nombreSeleccionado}"?\nLos artículos asignados a ella quedarán sin tienda asignada.`)) {
        try {
            const res = await fetch(`${BACKEND_URL}/api/tiendas/${tiendaObjeto._id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (res.ok) {
                cantarPorVoz("Tienda eliminada.");
                await refrescarYListarTiendasCloud();
                await forceRefreshDataManual();
            } else {
                alert("No se pudo eliminar el elemento.");
            }
        } catch(e) { alert("Error al procesar la baja."); }
    }
}

window.navegarASeccion = function(idSeccion) {
    if (SECCIONES_INHABILITADAS.has(idSeccion)) {
        if (esRolVisualizador()) {
            alert('No tienes permisos para esta sección. Tu rol Visualizador solo puede consultar productos sin datos sensibles.');
        } else {
            alert('No tienes acceso a esta sección.');
        }
        return;
    }

    document.querySelectorAll('.seccion-app').forEach(sec => {
        sec.classList.add('hidden');
        sec.classList.remove('seccion-active');
    });
    const seccionDestino = document.getElementById(idSeccion);
    if (!seccionDestino) {
        console.warn(`[UI] Sección no encontrada: ${idSeccion}`);
        return;
    }
    seccionDestino.classList.remove('hidden');
    requestAnimationFrame(() => {
        seccionDestino.classList.add('seccion-active');
    });
    
    document.querySelectorAll('#main-nav-secciones button').forEach(btn => {
        btn.className = NAV_TAB_BASE_CLASS;
    });
    
    const tabActivo = document.getElementById(`tab-${idSeccion}`);
    if (tabActivo) {
        tabActivo.className = NAV_TAB_ACTIVE_CLASS;
    }
    
    if (idSeccion === 'sec-analitica' && BASE_DATOS.length > 0) {
        setTimeout(() => { actualizarTodoElBloqueGrafico(); }, 50);
    }
    if (idSeccion === 'sec-notas') {
        setTimeout(() => { cargarNotasBoard(); }, 50);
    }
    if (idSeccion === 'sec-auditoria') {
        setTimeout(() => { 
            actualizarCalendarioAuditoria(); 
            renderizarMapaDeLogins();
        }, 50);
    }
    if (idSeccion === 'sec-inventario') {
        setTimeout(() => { renderCalendarioStock(); }, 50);
    }
    if (idSeccion === 'sec-gestion') {
        setTimeout(() => { renderGestionFacturas(); }, 50);
    }
    if (idSeccion === 'sec-crm') {
        setTimeout(() => { refrescarClientesCRM(); }, 50);
    }
    if (idSeccion === 'sec-citas') {
        setTimeout(() => { refrescarCitas(); }, 50);
    }
    if (idSeccion === 'sec-usuarios') {
        setTimeout(() => {
            refrescarUsuariosAdmin();
            cargarMiPerfil();
            refrescarUsuariosChat();
            iniciarAutoRefreshChat();
        }, 50);
    } else {
        detenerAutoRefreshChat();
    }
    if (idSeccion === 'sec-tareas') {
        setTimeout(() => { refrescarTareas(); }, 50);
    }
    if (idSeccion === 'sec-faqs') {
        setTimeout(() => { refrescarFaqs(); }, 50);
    }
    if (idSeccion === 'sec-ajustes') {
        setTimeout(() => {
            renderListaAjustesKanban();
            escanearHigieneDB(false);
        }, 50);
    }
    if (idSeccion === 'sec-monopolio') {
        setTimeout(() => {
            renderMonopolioUrls();
            renderMonopolioPerfilesDescubiertos();
        }, 50);
    }

    aplicarMascaraVisualizadorEnUI();
}

function aplicarRestriccionesRolUI() {
    const nav = document.getElementById('main-nav-secciones');
    if (!nav) return;

    const bloqueadasPorRol = (() => {
        const rol = String(USUARIO_ROL_ACTUAL || 'Editor');
        if (rol === 'Editor') {
            return ['sec-analitica', 'sec-auditoria', 'sec-gestion', 'sec-ajustes', 'sec-usuarios'];
        }
        if (rol === 'Visualizador') {
            return ['sec-analitica', 'sec-auditoria', 'sec-monopolio', 'sec-tareas', 'sec-notas', 'sec-crm', 'sec-citas', 'sec-usuarios', 'sec-gestion', 'sec-ajustes', 'sec-faqs'];
        }
        return [];
    })();

    const hidden = new Set([...bloqueadasPorRol]);

    SECCIONES_INHABILITADAS = hidden;

    document.querySelectorAll('.seccion-app').forEach((sec) => {
        const secId = sec.id;
        const tab = document.getElementById(`tab-${secId}`);
        const blocked = hidden.has(secId);
        if (tab) tab.classList.toggle('hidden', blocked);
        if (blocked) sec.classList.add('hidden');
    });

    const activa = document.querySelector('.seccion-app:not(.hidden)');
    const destinoInicial = (!activa || hidden.has(activa.id)) ? 'sec-inventario' : activa.id;
    // Fuerza la clase seccion-active para evitar panel inicial invisible hasta el primer click.
    navegarASeccion(destinoInicial);
}

function formatearFechaISO(dateObj) {
    const d = new Date(dateObj);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
}

function obtenerRangoFechasPorPresetGananciasAdmin(preset, anio) {
    const now = new Date();
    const y = Number.isFinite(Number(anio)) ? Number(anio) : now.getFullYear();

    const primerDiaMesActual = new Date(now.getFullYear(), now.getMonth(), 1);
    const ultimoDiaMesActual = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    if (preset === 'mes-actual') {
        return { inicio: formatearFechaISO(primerDiaMesActual), fin: formatearFechaISO(ultimoDiaMesActual) };
    }

    const quarterActual = Math.floor(now.getMonth() / 3) + 1;
    const q = preset === 'quarter-actual' ? quarterActual :
        (preset === 'q1' ? 1 : preset === 'q2' ? 2 : preset === 'q3' ? 3 : preset === 'q4' ? 4 : 0);

    if (q >= 1 && q <= 4) {
        const mesInicio = (q - 1) * 3;
        const inicio = new Date(y, mesInicio, 1);
        const fin = new Date(y, mesInicio + 3, 0);
        return { inicio: formatearFechaISO(inicio), fin: formatearFechaISO(fin) };
    }

    return { inicio: '', fin: '' };
}

function onCambiarPresetGananciasAdmin() {
    const presetEl = document.getElementById('admin-profit-range-preset');
    const yearEl = document.getElementById('admin-profit-year');
    const startEl = document.getElementById('admin-profit-date-start');
    const endEl = document.getElementById('admin-profit-date-end');
    if (!presetEl || !yearEl || !startEl || !endEl) return;

    const preset = presetEl.value || 'mes-actual';
    const rango = obtenerRangoFechasPorPresetGananciasAdmin(preset, yearEl.value);

    const custom = preset === 'personalizado';
    startEl.disabled = !custom;
    endEl.disabled = !custom;

    if (!custom) {
        startEl.value = rango.inicio;
        endEl.value = rango.fin;
    }

    actualizarDashboardGananciasAdmin();
}

function obtenerRangoFechasPorPresetAnalitica(preset) {
    const now = new Date();
    const y = now.getFullYear();
    const mes = now.getMonth();

    if (preset === 'todo') return { inicio: '', fin: '' };
    if (preset === 'mes-actual') {
        return {
            inicio: formatearFechaISO(new Date(y, mes, 1)),
            fin: formatearFechaISO(new Date(y, mes + 1, 0))
        };
    }
    if (preset === 'mes-anterior') {
        const mPrev = mes - 1;
        return {
            inicio: formatearFechaISO(new Date(y, mPrev, 1)),
            fin: formatearFechaISO(new Date(y, mPrev + 1, 0))
        };
    }
    if (preset === 'anio-actual') {
        return {
            inicio: formatearFechaISO(new Date(y, 0, 1)),
            fin: formatearFechaISO(new Date(y, 11, 31))
        };
    }

    const q = preset === 'quarter-actual'
        ? (Math.floor(mes / 3) + 1)
        : (preset === 'q1' ? 1 : preset === 'q2' ? 2 : preset === 'q3' ? 3 : preset === 'q4' ? 4 : 0);

    if (q >= 1 && q <= 4) {
        const mesInicio = (q - 1) * 3;
        return {
            inicio: formatearFechaISO(new Date(y, mesInicio, 1)),
            fin: formatearFechaISO(new Date(y, mesInicio + 3, 0))
        };
    }

    return { inicio: '', fin: '' };
}

window.onCambiarPeriodoAnalitica = function() {
    const presetEl = document.getElementById('an-filtro-periodo');
    const startEl = document.getElementById('an-filtro-fecha-inicio');
    const endEl = document.getElementById('an-filtro-fecha-fin');
    if (!presetEl || !startEl || !endEl) return;

    const preset = String(presetEl.value || 'todo');
    const custom = preset === 'personalizado';
    const rango = obtenerRangoFechasPorPresetAnalitica(preset);

    startEl.disabled = !custom;
    endEl.disabled = !custom;

    if (!custom) {
        startEl.value = rango.inicio;
        endEl.value = rango.fin;
    }

    actualizarTodoElBloqueGrafico();
};

function poblarFiltroEstadosVentaAnalitica() {
    const select = document.getElementById('an-filtro-estado');
    if (!select) return;

    const valorActual = String(select.value || 'TODOS');
    const estadosVenta = (LISTA_ESTADOS_KANBAN || []).filter((e) => e.rolFinanciero === 'Venta');
    const options = ['<option value="TODOS">💰 Todos los estados venta</option>']
        .concat(estadosVenta.map((e) => `<option value="${e.nombre}">${e.icono || '💰'} ${e.nombre}</option>`));
    select.innerHTML = options.join('');

    if (valorActual && Array.from(select.options).some((o) => o.value === valorActual)) {
        select.value = valorActual;
    }
}

function calcularMetricasContables(lista, ivaPercent = 21) {
    const ivaRate = Math.max(0, Number(ivaPercent) || 0) / 100;
    const out = {
        ventasNetas: 0,
        inversion: 0,
        beneficio: 0,
        roi: 0,
        prendas: 0,
        ivaEstimado: 0,
        ticketMedio: 0,
        comisiones: 0,
        margenMedio: 0,
        baseImponible: 0
    };

    (lista || []).forEach((v) => {
        const qty = Number(v.cantidad || 1) || 1;
        const pv = Number(v.precioVenta || 0) || 0;
        const pc = Number(v.precioCompra || 0) || 0;
        const ge = Number(v.gastosEnvio || 0) || 0;
        const canal = String(v.canalVenta || '').toLowerCase();
        const comision = (canal === 'vinted' || canal === 'wallapop') ? (pv * 0.05) : 0;

        const netoUnit = Math.max(0, pv - comision);
        const neto = netoUnit * qty;
        const inv = (pc + ge) * qty;

        out.ventasNetas += neto;
        out.inversion += inv;
        out.comisiones += comision * qty;
        out.prendas += qty;
    });

    out.beneficio = out.ventasNetas - out.inversion;
    out.roi = out.inversion > 0 ? (out.beneficio / out.inversion) * 100 : 0;
    out.ticketMedio = out.prendas > 0 ? (out.ventasNetas / out.prendas) : 0;
    out.baseImponible = ivaRate > 0 ? (out.ventasNetas / (1 + ivaRate)) : out.ventasNetas;
    out.ivaEstimado = out.ventasNetas - out.baseImponible;
    out.margenMedio = out.ventasNetas > 0 ? (out.beneficio / out.ventasNetas) * 100 : 0;

    return out;
}

function obtenerRangoComparativo(inicio, fin, modoComparativa) {
    if (!inicio || !fin || modoComparativa === 'ninguna') return { inicio: '', fin: '' };
    const dIni = new Date(`${inicio}T00:00:00`);
    const dFin = new Date(`${fin}T00:00:00`);
    if (isNaN(dIni.getTime()) || isNaN(dFin.getTime()) || dFin < dIni) return { inicio: '', fin: '' };

    if (modoComparativa === 'mismo-periodo-anio-anterior') {
        const i = new Date(dIni); i.setFullYear(i.getFullYear() - 1);
        const f = new Date(dFin); f.setFullYear(f.getFullYear() - 1);
        return { inicio: formatearFechaISO(i), fin: formatearFechaISO(f) };
    }

    if (modoComparativa === 'periodo-anterior') {
        const diffDays = Math.max(1, Math.round((dFin.getTime() - dIni.getTime()) / 86400000) + 1);
        const f = new Date(dIni);
        f.setDate(f.getDate() - 1);
        const i = new Date(f);
        i.setDate(i.getDate() - (diffDays - 1));
        return { inicio: formatearFechaISO(i), fin: formatearFechaISO(f) };
    }

    return { inicio: '', fin: '' };
}

function actualizarResumenComparativaAnalitica() {
    const resumenEl = document.getElementById('an-resumen-comparativa');
    if (!resumenEl) return;

    const modo = String(document.getElementById('an-filtro-comparativa')?.value || 'ninguna');
    const inicio = String(document.getElementById('an-filtro-fecha-inicio')?.value || '').trim();
    const fin = String(document.getElementById('an-filtro-fecha-fin')?.value || '').trim();
    const iva = Number(document.getElementById('an-filtro-iva')?.value || 21) || 21;

    const actual = calcularMetricasContables(obtenerDatosFiltradosParaAnalitica(), iva);
    if (modo === 'ninguna' || !inicio || !fin) {
        resumenEl.innerText = `Comparativa: sin comparar · Margen medio ${actual.margenMedio.toFixed(1)}% · IVA estimado ${actual.ivaEstimado.toFixed(2)} €`;
        return;
    }

    const rangoComp = obtenerRangoComparativo(inicio, fin, modo);
    if (!rangoComp.inicio || !rangoComp.fin) {
        resumenEl.innerText = 'Comparativa: no se pudo calcular el rango comparativo.';
        return;
    }

    const prev = calcularMetricasContables(obtenerDatosFiltradosParaAnalitica({
        overrideStart: rangoComp.inicio,
        overrideEnd: rangoComp.fin
    }), iva);

    const delta = prev.ventasNetas > 0 ? ((actual.ventasNetas - prev.ventasNetas) / prev.ventasNetas) * 100 : 0;
    const signo = delta >= 0 ? '+' : '';
    const txtModo = modo === 'periodo-anterior' ? 'vs periodo anterior' : 'vs mismo periodo año anterior';
    resumenEl.innerText = `Comparativa ${txtModo}: ${signo}${delta.toFixed(1)}% en ventas netas · Actual ${actual.ventasNetas.toFixed(2)} € · Referencia ${prev.ventasNetas.toFixed(2)} €`;
}

window.abrirQuarterContabilidad = function(preset = 'quarter-actual') {
    const presetEl = document.getElementById('admin-profit-range-preset');
    const yearEl = document.getElementById('admin-profit-year');
    if (yearEl && !yearEl.value) {
        yearEl.value = String(new Date().getFullYear());
    }
    if (presetEl) {
        const normalizado = String(preset || 'quarter-actual').trim().toLowerCase();
        presetEl.value = ['q1', 'q2', 'q3', 'q4', 'quarter-actual'].includes(normalizado) ? normalizado : 'quarter-actual';
    }

    navegarASeccion('sec-analitica');
    setTimeout(() => {
        onCambiarPresetGananciasAdmin();
    }, 80);
};

window.aplicarQuarterAnalitica = function(preset = 'quarter-actual') {
    const presetEl = document.getElementById('admin-profit-range-preset');
    const yearEl = document.getElementById('admin-profit-year');
    if (yearEl && !yearEl.value) {
        yearEl.value = String(new Date().getFullYear());
    }
    if (presetEl) {
        const normalizado = String(preset || 'quarter-actual').trim().toLowerCase();
        presetEl.value = ['q1', 'q2', 'q3', 'q4', 'quarter-actual'].includes(normalizado) ? normalizado : 'quarter-actual';
    }
    onCambiarPresetGananciasAdmin();
};

function obtenerVentasEnRangoAdmin() {
    const startEl = document.getElementById('admin-profit-date-start');
    const endEl = document.getElementById('admin-profit-date-end');
    const inicio = String(startEl?.value || '').trim();
    const fin = String(endEl?.value || '').trim();

    if (!inicio || !fin) return [];

    const estadosVenta = LISTA_ESTADOS_KANBAN.filter(e => e.rolFinanciero === 'Venta').map(e => e.nombre);
    return (BASE_DATOS || []).filter((v) => {
        if (!estadosVenta.includes(v.estado)) return false;
        const fechaVenta = String(v.fechaVenta || '').slice(0, 10);
        if (!fechaVenta) return false;
        return fechaVenta >= inicio && fechaVenta <= fin;
    });
}

function actualizarDashboardGananciasAdmin() {
    const panel = document.getElementById('admin-gains-dashboard');
    if (!panel || String(USUARIO_ROL_ACTUAL || '').toLowerCase() !== 'admin') return;

    const vendidos = obtenerVentasEnRangoAdmin();

    const ivaConfig = Number(document.getElementById('an-filtro-iva')?.value || 21) || 21;
    const resumen = calcularMetricasContables(vendidos, ivaConfig);

    const beneficioPorFecha = {};
    const beneficioPorCanal = {};

    vendidos.forEach((v) => {
        const qty = Number(v.cantidad || 1) || 1;
        const pv = Number(v.precioVenta || 0) || 0;
        const pc = Number(v.precioCompra || 0) || 0;
        const ge = Number(v.gastosEnvio || 0) || 0;
        const canal = String(v.canalVenta || '').toLowerCase();
        const comision = (canal === 'vinted' || canal === 'wallapop') ? (pv * 0.05) : 0;

        const neto = (pv - comision) * qty;
        const inv = (pc + ge) * qty;
        const ben = neto - inv;
        const fecha = String(v.fechaVenta || '').slice(0, 10) || 'Sin fecha';
        const canalTag = String(v.canalVenta || 'Sin canal');

        beneficioPorFecha[fecha] = (beneficioPorFecha[fecha] || 0) + ben;
        beneficioPorCanal[canalTag] = (beneficioPorCanal[canalTag] || 0) + ben;
    });

    const ingresos = resumen.ventasNetas;
    const inversion = resumen.inversion;
    const beneficio = resumen.beneficio;
    const roi = resumen.roi;
    const prendas = resumen.prendas;

    const kIngresos = document.getElementById('admin-profit-kpi-ingresos');
    const kInversion = document.getElementById('admin-profit-kpi-inversion');
    const kBeneficio = document.getElementById('admin-profit-kpi-beneficio');
    const kRoi = document.getElementById('admin-profit-kpi-roi');
    const kPrendas = document.getElementById('admin-profit-kpi-prendas');
    const kIva = document.getElementById('admin-profit-kpi-iva');
    const kTicket = document.getElementById('admin-profit-kpi-ticket');
    const kRango = document.getElementById('admin-profit-kpi-rango');

    if (kIngresos) kIngresos.innerText = `${ingresos.toFixed(2)} €`;
    if (kInversion) kInversion.innerText = `${inversion.toFixed(2)} €`;
    if (kBeneficio) kBeneficio.innerText = `${beneficio.toFixed(2)} €`;
    if (kRoi) kRoi.innerText = `${roi.toFixed(1)}%`;
    if (kPrendas) kPrendas.innerText = String(prendas);
    if (kIva) kIva.innerText = `${resumen.ivaEstimado.toFixed(2)} €`;
    if (kTicket) kTicket.innerText = `${resumen.ticketMedio.toFixed(2)} €`;
    if (kBeneficio) {
        kBeneficio.classList.toggle('kpi-positive', beneficio >= 0);
        kBeneficio.classList.toggle('kpi-negative', beneficio < 0);
    }
    if (kRoi) {
        kRoi.classList.toggle('kpi-positive', roi >= 0);
        kRoi.classList.toggle('kpi-negative', roi < 0);
    }

    const inicio = document.getElementById('admin-profit-date-start')?.value || '-';
    const fin = document.getElementById('admin-profit-date-end')?.value || '-';
    if (kRango) kRango.innerText = `Rango: ${inicio} -> ${fin} · Registros vendidos: ${vendidos.length} · Margen medio: ${resumen.margenMedio.toFixed(1)}%`;

    const canvas = document.getElementById('admin-profit-chart');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        if (INSTANCIA_ADMIN_PROFIT_CHART) INSTANCIA_ADMIN_PROFIT_CHART.destroy();

        const labels = Object.keys(beneficioPorFecha).sort();
        const data = labels.map((f) => Number(beneficioPorFecha[f] || 0));
        INSTANCIA_ADMIN_PROFIT_CHART = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels.map((f) => f.split('-').reverse().slice(0, 2).join('/')),
                datasets: [{
                    data,
                    borderColor: '#22d3ee',
                    backgroundColor: 'rgba(34, 211, 238, 0.14)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.24,
                    pointRadius: 2.5,
                    pointBackgroundColor: '#67e8f9'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => ` Beneficio: ${Number(context.parsed.y || 0).toFixed(2)} €`
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: '#94a3b8', maxRotation: 0, autoSkip: true }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { ticks: { color: '#94a3b8', callback: (v) => `${v}€` }, grid: { color: 'rgba(255,255,255,0.05)' } }
                }
            }
        });
    }

    const topCanalesEl = document.getElementById('admin-profit-top-canales');
    if (topCanalesEl) {
        const entries = Object.entries(beneficioPorCanal).sort((a, b) => b[1] - a[1]).slice(0, 6);
        if (!entries.length) {
            topCanalesEl.innerHTML = '<p class="text-[10px] opacity-45">Sin datos en el rango seleccionado.</p>';
        } else {
            const maxAbs = Math.max(...entries.map((x) => Math.abs(Number(x[1] || 0))), 1);
            topCanalesEl.innerHTML = entries.map(([canal, ben], idx) => {
                const positivo = ben >= 0;
                const color = positivo ? 'text-emerald-300' : 'text-rose-300';
                const barraColor = positivo ? 'from-emerald-500/50 to-cyan-500/40' : 'from-rose-500/50 to-orange-500/40';
                const width = Math.max(8, (Math.abs(ben) / maxAbs) * 100);
                return `
                    <div class="p-2 rounded-xl border border-white/10 bg-black/20">
                        <div class="flex items-center justify-between text-[10px] mb-1">
                            <span class="font-black uppercase tracking-wide">${idx + 1}. ${escapeHtmlSafe(canal)}</span>
                            <span class="font-mono ${color}">${Number(ben).toFixed(2)} €</span>
                        </div>
                        <div class="h-1.5 rounded-full bg-black/30 overflow-hidden border border-white/10">
                            <div class="h-full bg-gradient-to-r ${barraColor}" style="width:${width}%"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }
}

window.onCambiarPresetGananciasAdmin = onCambiarPresetGananciasAdmin;
window.actualizarDashboardGananciasAdmin = actualizarDashboardGananciasAdmin;

function navegarCalendarioStock(delta) {
    CAL_STOCK_MES += delta;
    if (CAL_STOCK_MES > 12) { CAL_STOCK_MES = 1; CAL_STOCK_ANIO++; }
    if (CAL_STOCK_MES < 1) { CAL_STOCK_MES = 12; CAL_STOCK_ANIO--; }
    renderCalendarioStock();
}

function renderCalendarioStock() {
    const nombresMeses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const txtMes = document.getElementById('txt-calendario-stock-mes');
    if(txtMes) txtMes.innerText = `${nombresMeses[CAL_STOCK_MES-1]} ${CAL_STOCK_ANIO}`;
    const grid = document.getElementById('grid-calendario-stock');
    if(!grid) return;
    const addsPorDia = {}; const salesPorDia = {}; const modsPorDia = {};

    const parseFechaParts = (fechaRaw) => {
        if (!fechaRaw) return null;
        const fechaTxt = String(fechaRaw).slice(0, 10);
        const fParts = fechaTxt.split('-');
        if (fParts.length !== 3) return null;
        const y = parseInt(fParts[0], 10);
        const m = parseInt(fParts[1], 10);
        const d = parseInt(fParts[2], 10);
        if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
        return { y, m, d };
    };

    BASE_DATOS.forEach(v => {
        const alta = parseFechaParts(v.fecha);
        if (alta && alta.y === CAL_STOCK_ANIO && alta.m === CAL_STOCK_MES) {
            addsPorDia[alta.d] = (addsPorDia[alta.d] || 0) + 1;
        }

        const venta = parseFechaParts(v.fechaVenta);
        if (venta && venta.y === CAL_STOCK_ANIO && venta.m === CAL_STOCK_MES) {
            salesPorDia[venta.d] = (salesPorDia[venta.d] || 0) + 1;
        }

        const mod = parseFechaParts(v.fechaModificacion || v.updatedAt);
        if (mod && mod.y === CAL_STOCK_ANIO && mod.m === CAL_STOCK_MES) {
            modsPorDia[mod.d] = (modsPorDia[mod.d] || 0) + 1;
        }
    });
    const primerDiaMes = new Date(CAL_STOCK_ANIO, CAL_STOCK_MES - 1, 1).getDay();
    const diasEnMes = new Date(CAL_STOCK_ANIO, CAL_STOCK_MES, 0).getDate();
    grid.innerHTML = '';
    for (let i = 0; i < primerDiaMes; i++) { grid.innerHTML += `<div class="bg-black/5 rounded-2xl opacity-10 h-full min-h-[90px] border border-white/5"></div>`; }
    for (let d = 1; d <= diasEnMes; d++) {
        const now = new Date();
        const esHoy = d === now.getDate() && CAL_STOCK_MES === (now.getMonth() + 1) && CAL_STOCK_ANIO === now.getFullYear();
        let info = '';
        if (addsPorDia[d]) info += `
            <div class="flex items-center gap-1.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[8px] font-black px-2 py-0.5 rounded-lg shadow-sm">
                <span class="w-1 h-1 rounded-full bg-blue-500 animate-pulse"></span>
                <span>${addsPorDia[d]} ALTA${addsPorDia[d] > 1 ? 'S' : ''}</span>
            </div>`;
        if (salesPorDia[d]) info += `
            <div class="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[8px] font-black px-2 py-0.5 rounded-lg shadow-sm">
                <span class="w-1 h-1 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>${salesPorDia[d]} VENTA${salesPorDia[d] > 1 ? 'S' : ''}</span>
            </div>`;
        if (modsPorDia[d]) info += `
            <div class="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[8px] font-black px-2 py-0.5 rounded-lg shadow-sm">
                <span class="w-1 h-1 rounded-full bg-amber-500 animate-pulse"></span>
                <span>${modsPorDia[d]} MOD${modsPorDia[d] > 1 ? 'S' : ''}</span>
            </div>`;

        grid.innerHTML += ` 
            <div onclick="verDetalleStockDia(${d})" class="calendario-dia group bg-gradient-to-br from-white/5 to-transparent border rounded-2xl p-3.5 flex flex-col gap-2 transition-all hover:bg-blue-500/10 hover:border-blue-500/40 cursor-pointer min-h-[95px] shadow-md relative overflow-hidden ${esHoy ? 'border-blue-500 ring-2 ring-blue-500/20 bg-blue-500/5' : 'border-white/5'}">
                <div class="flex justify-between items-center z-10">
                    <span class="text-sm font-black transition-opacity ${esHoy ? 'text-blue-400' : 'opacity-30 group-hover:opacity-100'}">${d}</span>
                    ${esHoy ? '<span class="text-[8px] font-black bg-blue-500 text-white px-1.5 py-0.5 rounded-md uppercase tracking-widest">Hoy</span>' : ''}
                </div>
                <div class="flex-1 flex flex-col gap-1.5 justify-end z-10">
                    ${info}
                </div>
                <div class="absolute -right-2 -bottom-2 opacity-5 group-hover:opacity-10 transition-opacity">
                     <span class="text-4xl">📦</span>
                </div>
            </div>`;
    }
}

function renderGestionFacturas() {
    const container = document.getElementById('lista-articulos-factura');
    if(!container) return;
    
    const nombresEstadosVenta = LISTA_ESTADOS_KANBAN.filter(e => e.rolFinanciero === 'Venta').map(e => e.nombre);
    const vendidos = BASE_DATOS.filter(v => nombresEstadosVenta.includes(v.estado));
    
    if(vendidos.length === 0) {
        container.innerHTML = '<div class="py-20 text-center opacity-30 italic font-mono text-xs">No hay artículos vendidos disponibles para facturar en el sistema.</div>';
        return;
    }

    container.innerHTML = vendidos.map(v => `
        <div class="p-3 bg-black/10 border border-white/5 rounded-2xl flex items-center gap-4 hover:bg-white/5 transition-all group cursor-pointer" onclick="this.querySelector('input').click()">
            <input type="checkbox" class="fac-check-item w-6 h-6 rounded-lg border-slate-700 bg-black/40 text-blue-600 focus:ring-0 cursor-pointer" 
                   data-id="${v._id}" data-precio="${v.precioVenta}" data-prenda="${v.prenda}"
                   onclick="event.stopPropagation()" onchange="recalcularTotalesFactura()">
            <div class="min-w-0 flex-1">
                <p class="font-black uppercase truncate text-[11px] tracking-wide">${v.prenda}</p>
                <p class="text-[9px] font-mono opacity-40 uppercase">${v.fechaVenta || v.fecha} • SKU: ${v.sku || 'S/N'} • ${v.canalVenta}</p>
            </div>
            <div class="text-right">
                <p class="font-black text-indigo-400 text-sm font-mono">${parseFloat(v.precioVenta || 0).toFixed(2)}€</p>
            </div>
        </div>
    `).join('');
    
    recalcularTotalesFactura();
}

function recalcularTotalesFactura() {
    const checks = document.querySelectorAll('.fac-check-item:checked');
    const ivaPorcentaje = parseFloat(document.getElementById('fac-iva').value) || 0;
    let subtotal = 0;
    
    checks.forEach(c => subtotal += parseFloat(c.dataset.precio || 0));
    
    const totalConIVA = subtotal * (1 + (ivaPorcentaje / 100));
    
    document.getElementById('fac-count-total').innerText = checks.length;
    document.getElementById('fac-base-total').innerText = subtotal.toFixed(2) + ' €';
    document.getElementById('fac-monto-total').innerText = totalConIVA.toFixed(2) + ' €';
}

function filtrarListaFacturacion(query) {
    const q = query.toLowerCase();
    document.querySelectorAll('#lista-articulos-factura > div').forEach(el => {
        const text = el.innerText.toLowerCase();
        el.classList.toggle('hidden', !text.includes(q));
    });
}

async function generarGuiaPDF() {
    const btn = document.querySelector('button[onclick="generarGuiaPDF()"]');
    const textoOriginal = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = "Generando PDF... ⏳"; btn.disabled = true; }
    
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        const imgLogo = new Image();
        imgLogo.src = 'logo.png';
        await new Promise((resolve) => {
            imgLogo.onload = resolve;
            imgLogo.onerror = resolve;
        });

        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, 210, 40, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.setFont(undefined, 'bold');
        doc.text("Manual de Usuario - Seychelles", 15, 25);
        
        if (imgLogo.width > 0) {
            doc.addImage(imgLogo, 'PNG', 165, 5, 30, 30);
        }

        let y = 50;

        const seccion = (titulo, texto) => {
            if (y > 250) { doc.addPage(); y = 20; }
            
            doc.setFontSize(13);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(16, 185, 129);
            doc.text(titulo, 15, y);
            y += 8;
            
            doc.setFontSize(9);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(60, 60, 60);
            
            const lineas = doc.splitTextToSize(texto, 180);
            doc.text(lineas, 15, y);
            y += (lineas.length * 6) + 12;
        };

        seccion("1. Arquitectura del Kanban y KPIs en Tiempo Real", "El núcleo financiero de la aplicación. Al arrastrar una prenda de 'Stock' a 'Ventas', el motor matemático recalcula la Facturación Bruta, Inversión (incluyendo gastos de envío y compras), Beneficio Neto y ROI. Si hay comisiones de plataforma (ej. Vinted 5%), el algoritmo las descuenta antes de reflejar el neto.\n\nAdemás, el sistema de inventario detecta el 'Stock Frío' (prendas estancadas más de 21 días) marcándolas con un copo de nieve (❄️) y un extintor (🧯) para que puedas aplicarles ofertas.");
        seccion("2. Fichas de Alta y Procesamiento HEIC", "Diseñado para velocidad. El sistema cuenta con compresión asíncrona de imágenes mediante Canvas API. Si subes fotos directamente desde un iPhone (.HEIC), la librería heic2any las transcodifica internamente a JPEG comprimido al 80% en milisegundos. El indicador de Margen Comercial cambiará de color en vivo (Rojo < 0%, Ámbar < 30%, Verde > 30%) mientras escribes los costes.");
        seccion("3. Manipulación Masiva de Objetos", "Seleccionando las casillas circulares de las prendas habilitas el 'Panel Dark Flotante'. Esta herramienta inyecta operaciones iterativas en MongoDB. Por ejemplo, pulsando 'Ajustar Precio' e introduciendo '-5', el backend descontará 5€ al PVP de todos los objetos marcados. También permite cambios de estado masivos, duplicaciones o asignaciones de Talla/Categoría en bloque.");
        seccion("4. Terminal Punto de Venta (Scanner)", "La app convierte la lente de cualquier dispositivo móvil o webcam en un lector láser HTML5. Imprime las etiquetas con QR generadas por la app. Al leerlas, el endpoint descodifica el SKU y mueve el artículo a 'Vendido'. Incluye control anti-rebote (bloqueo por lectura doble) para evitar que el producto vuelva a stock por error.");
        seccion("5. Motor de Scraping Vinted (Auditoría Web)", "Un módulo de extracción asíncrona. Pega una URL de Vinted o sube un CSV. El motor buscará coincidencias borrosas y te alertará si un precio fue rebajado en la web pero olvidaste actualizarlo en el sistema. Además, localiza publicaciones nuevas y las importa a MongoDB descargando la imagen en Base64 de forma autónoma.");
        seccion("6. Módulo CRM (Customer Relationship Management)", "Base de datos independiente para clientes frecuentes. Permite almacenar históricos de contacto, NIF, direcciones y 'Reservas futuras'. Las reservas generan un array embebido en MongoDB que te permitirá ver cronológicamente a quién le tienes guardado un artículo especial.");
        seccion("7. Motor de Facturación y Tributación (jsPDF AutoTable)", "Permite agrupar N artículos vendidos en una matriz de facturación. Automáticamente extrae las direcciones del vendedor y del cliente del CRM, desglosa la Base Imponible según el % de IVA indicado y renderiza un PDF legal con estilo en rejilla corporativa (Azul Índigo), preparado para enviar a gestorías.");
        seccion("8. Control Financiero de Gastos (OpEx)", "El inventario no es el único coste de un negocio. La pestaña 'Gastos' permite imputar salidas de flujo de caja libre (Suministros, Publicidad, Packaging). Este OpEx impacta directamente en el KPI global de 'Ganancia Neta' restándose del margen bruto de ventas.");
        seccion("9. Business Intelligence (Analítica y Heatmap)", "Soporte para 4 instancias de Chart.js animadas. Filtrado multidimensional (Canal + Talla + Categoría + Rango PVP). Destaca el 'Scatter Heatmap' (Mapa de Calor), el cual mapea la densidad transaccional (Día vs Franja Horaria) para encontrar las horas pico donde tus clientes compran más, ayudando a programar tus lanzamientos.");
        seccion("10. Calendarios Históricos y Trazabilidad", "Doble matriz de calendario. \n- Calendario Stock: Te muestra visualmente cuántas altas y cuántas ventas hubo un día exacto. \n- Calendario de Auditoría (Logs): Un registro inmutable. Cada vez que alguien entra, edita, borra o emite una factura, su email y hora quedan grabados. Ninguna acción en la empresa es anónima.");
        seccion("11. Workspace Espacial (Notas Adhesivas)", "Sistema de Coordenadas X/Y guardado en tiempo real. Permite anclar Post-its en la pantalla. Estas notas son arrastrables (drag & drop), redimensionables y soportan cambio de color. Al actualizar la BD, todos los usuarios verán la nota en el mismo lugar de su pantalla.");
        seccion("12. Ciberseguridad y Autenticación", "La app está blindada por Google OAuth2.0 y Middleware de Sesiones. Solo los correos inscritos en la sección '🔑 Acceso' pueden validar su token.");

        doc.save('Guia_Automatizacion_Seychelles.pdf');
        cantarPorVoz("Guía en PDF generada exitosamente.");
    } catch (err) {
        console.error(err);
        alert("Hubo un error al crear la guía en PDF.");
    } finally {
        if (btn) { btn.innerHTML = textoOriginal; btn.disabled = false; }
    }
}

async function generarFacturaPDF() {
    const { jsPDF } = window.jspdf;
    const checks = document.querySelectorAll('.fac-check-item:checked');
    if(checks.length === 0) return alert("Por favor, selecciona al menos un artículo para facturar.");

    const doc = new jsPDF();
    const vendedor = {
        nombre: document.getElementById('fac-vendedor-nombre').value || 'Seychelles Shop',
        cif: document.getElementById('fac-vendedor-cif').value || '---',
        dir: document.getElementById('fac-vendedor-dir').value || '---'
    };
    const cliente = {
        nombre: document.getElementById('fac-cliente-nombre').value || 'Cliente Final',
        nif: document.getElementById('fac-cliente-nif').value || '---',
        dir: document.getElementById('fac-cliente-dir').value || '---'
    };
    const facNum = document.getElementById('fac-numero').value || `FAC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const ivaP = parseFloat(document.getElementById('fac-iva').value) || 0;

    doc.setFillColor(20, 83, 136); doc.rect(0, 0, 210, 40, 'F');
    doc.setFontSize(28); doc.setTextColor(255, 255, 255); doc.text('FACTURA', 15, 28);
    
    doc.setFontSize(10); doc.text(`Nº DOCUMENTO: ${facNum}`, 140, 20);
    doc.text(`FECHA EMISIÓN: ${new Date().toLocaleDateString('es-ES')}`, 140, 27);

    doc.setTextColor(0); doc.setFontSize(11); doc.setFont(undefined, 'bold');
    doc.text('DATOS DEL EMISOR', 15, 55); doc.text('DATOS DEL CLIENTE', 110, 55);
    
    doc.setFont(undefined, 'normal'); doc.setFontSize(9);
    doc.text([vendedor.nombre, `CIF/NIF: ${vendedor.cif}`, vendedor.dir], 15, 62, { maxWidth: 80 });
    doc.text([cliente.nombre, `NIF/CIF: ${cliente.nif}`, cliente.dir], 110, 62, { maxWidth: 80 });

    const tableData = Array.from(checks).map(c => [c.dataset.prenda, '1', `${parseFloat(c.dataset.precio).toFixed(2)} €`, `${parseFloat(c.dataset.precio).toFixed(2)} €`]);
    
    doc.autoTable({ startY: 85, head: [['DESCRIPCIÓN ARTÍCULO', 'CANT.', 'P. UNITARIO', 'TOTAL']], body: tableData, theme: 'grid', headStyles: { fillColor: [20, 83, 136] }, styles: { fontSize: 8 } });

    const finalY = doc.lastAutoTable.finalY + 10;
    let sub = 0; checks.forEach(c => sub += parseFloat(c.dataset.precio));
    const valIva = sub * (ivaP / 100);
    const total = sub + valIva;

    doc.setFontSize(10); doc.text(`SUBTOTAL (Base Imponible):`, 130, finalY); doc.text(`${sub.toFixed(2)} €`, 190, finalY, { align: 'right' });
    doc.text(`IVA (${ivaP}%):`, 130, finalY + 7); doc.text(`${valIva.toFixed(2)} €`, 190, finalY + 7, { align: 'right' });
    doc.setFontSize(14); doc.setFont(undefined, 'bold'); doc.setTextColor(20, 83, 136);
    doc.text(`TOTAL FACTURA:`, 130, finalY + 18); doc.text(`${total.toFixed(2)} €`, 190, finalY + 18, { align: 'right' });

    doc.save(`${facNum}_Seychelles_Shop.pdf`);
    cantarPorVoz("Factura emitida y guardada.");
    
    localStorage.setItem('seychelles-fac-vendedor', JSON.stringify(vendedor));
}

async function refrescarTareas() {
    try {
        const res = await fetch('/api/tareas', { credentials: 'include' });
        const data = await res.json();
        LISTA_TAREAS = Array.isArray(data) ? data : [];
        renderKanbanTareas();
        updateTickerWallStreet();
    } catch (e) { console.error("Error al cargar tareas:", e); }
}

async function refrescarCitas() {
    const now = Date.now();
    if (CITAS_REFRESH_IN_FLIGHT) return;
    if ((now - LAST_CITAS_REFRESH_AT) < 1200) return;

    try {
        CITAS_REFRESH_IN_FLIGHT = true;
        LAST_CITAS_REFRESH_AT = now;
        const res = await fetch('/api/citas', { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudieron cargar citas.');
        LISTA_CITAS = Array.isArray(data.citas) ? data.citas : [];
        renderKanbanCitas();
        actualizarBadgeCitasNav(data.pendientes);
    } catch (e) {
        console.error('Error al cargar citas:', e.message);
    } finally {
        CITAS_REFRESH_IN_FLIGHT = false;
    }
}

function estadoCitaAColumna(estado) {
    if (estado === 'Pendiente') return 'col-citas-pendiente';
    if (estado === 'Confirmada') return 'col-citas-confirmada';
    if (estado === 'En curso') return 'col-citas-en-curso';
    if (estado === 'Completada') return 'col-citas-completada';
    return 'col-citas-cancelada';
}

function renderKanbanCitas() {
    const columnas = [
        document.getElementById('col-citas-pendiente'),
        document.getElementById('col-citas-confirmada'),
        document.getElementById('col-citas-en-curso'),
        document.getElementById('col-citas-completada'),
        document.getElementById('col-citas-cancelada')
    ];
    if (columnas.some(c => !c)) return;
    columnas.forEach(c => { c.innerHTML = ''; });

    const hoy = new Date().toISOString().slice(0, 10);
    let kpiHoy = 0;
    let kpiPendientes = 0;

    LISTA_CITAS.forEach(cita => {
        if (cita.fechaDia === hoy) kpiHoy += 1;
        if (cita.estado === 'Pendiente') kpiPendientes += 1;

        const card = document.createElement('div');
        card.className = 'card-bg border border-white/10 rounded-2xl p-3 cursor-grab active:cursor-grabbing hover:border-cyan-500/50 transition-all';
        card.setAttribute('draggable', 'true');
        card.setAttribute('ondragstart', `window.handleDragStartCita(event, '${cita._id}')`);
        card.setAttribute('ondragend', `this.classList.remove('opacity-40')`);

        const nombreCompleto = `${cita.nombre || ''} ${cita.apellidos || ''}`.trim();
        const asesor = cita.asesorNombre || (cita.asesorEmail || '').split('@')[0] || 'Sin asignar';
        const estadoClass = cita.estado === 'Pendiente' ? 'text-rose-300 bg-rose-500/10 border-rose-500/30' :
            cita.estado === 'Confirmada' ? 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30' :
            cita.estado === 'En curso' ? 'text-amber-300 bg-amber-500/10 border-amber-500/30' :
            cita.estado === 'Completada' ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' :
            'text-slate-300 bg-slate-600/10 border-slate-500/30';

        card.innerHTML = `
            <div class="flex items-start justify-between gap-2 mb-2">
                <p class="text-[10px] font-black uppercase tracking-widest text-cyan-200 truncate">${nombreCompleto || 'Cliente sin nombre'}</p>
                <span class="text-[8px] px-1.5 py-0.5 rounded border ${estadoClass}">${cita.estado}</span>
            </div>
            <p class="text-[10px] opacity-80">📞 ${cita.telefono || 'Sin teléfono'}</p>
            <p class="text-[10px] opacity-80">👤 ${asesor}</p>
            <p class="text-[10px] opacity-80">🗓️ ${cita.fechaDia} · ${cita.hora}</p>
            ${cita.servicio ? `<p class="text-[10px] opacity-75 mt-1">🧾 ${cita.servicio}</p>` : ''}
            ${cita.notasCliente ? `<p class="text-[9px] italic opacity-60 mt-2 line-clamp-3">${cita.notasCliente}</p>` : ''}
        `;

        const col = document.getElementById(estadoCitaAColumna(cita.estado));
        if (col) col.appendChild(card);
    });

    const elPend = document.getElementById('citas-kpi-pendientes');
    const elHoy = document.getElementById('citas-kpi-hoy');
    if (elPend) elPend.innerText = kpiPendientes;
    if (elHoy) elHoy.innerText = kpiHoy;
}

window.handleDragStartCita = function(e, id) {
    const cita = (LISTA_CITAS || []).find((x) => x._id === id);
    const titulo = cita ? `${cita.nombre || ''} ${cita.apellidos || ''}`.trim() : 'Cita';
    const subtitulo = cita ? `${cita.fechaDia || '-'} · ${cita.hora || '-'}` : 'Mover cita';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/cita-id', id);
    e.dataTransfer.setData('text/drag-kind', 'cita-kanban');
    crearDragPreviewMinimizado(e, titulo || 'Cita', subtitulo);
    setTimeout(() => { e.target.classList.add('opacity-40'); }, 0);
};

window.handleDropCita = async function(e, nuevoEstado) {
    e.preventDefault();
    window.clearDrop(e);
    limpiarEstadoVisualDrag();
    const dragKind = e.dataTransfer.getData('text/drag-kind');
    if (dragKind !== 'cita-kanban') return;
    const id = e.dataTransfer.getData('text/cita-id');
    if (!id) return;

    const idx = LISTA_CITAS.findIndex(c => c._id === id);
    if (idx === -1) return;

    const estadoAnterior = LISTA_CITAS[idx].estado;
    if (estadoAnterior === nuevoEstado) return;

    LISTA_CITAS[idx].estado = nuevoEstado;
    renderKanbanCitas();
    if (e.currentTarget?.classList) {
        e.currentTarget.classList.add('drop-highlight');
        setTimeout(() => e.currentTarget?.classList.remove('drop-highlight'), 420);
    }

    try {
        const res = await fetch(`/api/citas/${id}/estado`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ estado: nuevoEstado })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo mover la cita.');
        actualizarBadgeCitasNav();
    } catch (err) {
        LISTA_CITAS[idx].estado = estadoAnterior;
        renderKanbanCitas();
        alert(err.message || 'Error al mover cita.');
    }
};

async function actualizarBadgeCitasNav(pendientesDirecto = null) {
    const badge = document.getElementById('badge-citas-nav');
    if (!badge || !USUARIO_EMAIL_ACTUAL) return;
    try {
        let pendientes = pendientesDirecto;
        if (pendientes === null || pendientes === undefined) {
            const res = await fetch('/api/citas/resumen', { credentials: 'include' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'No se pudo leer el resumen de citas.');
            pendientes = data.pendientes || 0;
        }
        if (pendientes > 0) {
            badge.innerText = pendientes > 99 ? '99+' : String(pendientes);
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    } catch (_) {}
}

function renderKanbanTareas() {
    const colPendiente = document.getElementById('col-tar-pendiente');
    const colProceso = document.getElementById('col-tar-proceso');
    const colCompletada = document.getElementById('col-tar-completada');
    if(!colPendiente || !colProceso || !colCompletada) return;
    
    colPendiente.innerHTML = ''; colProceso.innerHTML = ''; colCompletada.innerHTML = '';
    
    LISTA_TAREAS.forEach(t => {
        const card = document.createElement('div');
        card.className = "card-bg border border-white/10 p-3 rounded-2xl shadow-sm cursor-grab active:cursor-grabbing hover:border-blue-500/50 transition-all select-none group";
        card.setAttribute('draggable', 'true');
        card.setAttribute('ondragstart', `window.handleDragStartTarea(event, '${t._id}')`);
        card.setAttribute('ondragend', `this.classList.remove('opacity-30')`);
        
        let colorPrio = t.prioridad === 'Alta' ? 'text-rose-400 bg-rose-500/10 border-rose-500/20' : (t.prioridad === 'Media' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20');
        let fechaVenc = t.fechaVencimiento ? `<span class="text-[9px] opacity-50 font-mono mt-1 block">📅 Vence: ${t.fechaVencimiento}</span>` : '';
        
        card.innerHTML = `
            <div class="flex justify-between items-start mb-1.5">
                <span class="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${colorPrio}">${t.prioridad}</span>
                <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onclick="editarTarea('${t._id}')" class="text-blue-400 hover:text-blue-300 text-[10px]">✏️</button>
                    <button onclick="borrarTarea('${t._id}')" class="text-rose-400 hover:text-rose-300 text-[10px]">🗑️</button>
                </div>
            </div>
            <h4 class="font-bold text-xs">${t.titulo}</h4>
            ${t.descripcion ? `<p class="text-[10px] opacity-70 mt-1 line-clamp-3">${t.descripcion}</p>` : ''}
            ${fechaVenc}
        `;
        
        if (t.estado === 'Completada') colCompletada.appendChild(card);
        else if (t.estado === 'En Proceso') colProceso.appendChild(card);
        else colPendiente.appendChild(card);
    });
}

window.handleDragStartTarea = function(e, id) {
    const t = (LISTA_TAREAS || []).find((x) => x._id === id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData("text/tarea-id", id);
    e.dataTransfer.setData('text/drag-kind', 'tarea-kanban');
    crearDragPreviewMinimizado(e, t?.titulo || 'Tarea', t?.prioridad ? `Prioridad ${t.prioridad}` : 'Mover tarea');
    setTimeout(() => { e.target.classList.add('opacity-30'); }, 0);
};
window.handleDropTarea = async function(e, nuevoEstado) {
    e.preventDefault(); window.clearDrop(e); limpiarEstadoVisualDrag();
    const dragKind = e.dataTransfer.getData('text/drag-kind');
    if (dragKind && dragKind !== 'tarea-kanban') return;
    const id = e.dataTransfer.getData("text/tarea-id"); if(!id) return;
    
    const idx = LISTA_TAREAS.findIndex(t => t._id === id);
    if(idx !== -1) { LISTA_TAREAS[idx].estado = nuevoEstado; renderKanbanTareas(); }
    if (e.currentTarget?.classList) {
        e.currentTarget.classList.add('drop-highlight');
        setTimeout(() => e.currentTarget?.classList.remove('drop-highlight'), 420);
    }
    
    try { await fetch(`/api/tareas/${id}/estado`, { method: 'PUT', headers: {'Content-Type':'application/json'}, credentials: 'include', body: JSON.stringify({ estado: nuevoEstado }) }); } 
    catch(err) { refrescarTareas(); }
};

async function manejarEnvioTarea(e) {
    e.preventDefault();
    const id = document.getElementById('edit-id-tarea').value;
    const payload = {
        titulo: document.getElementById('tar-titulo').value,
        descripcion: document.getElementById('tar-desc').value,
        fechaVencimiento: document.getElementById('tar-fecha').value,
        prioridad: document.getElementById('tar-prio').value
    };
    
    const url = id ? `/api/tareas/${id}` : '/api/tareas';
    const method = id ? 'PUT' : 'POST';
    
    try {
        const res = await fetch(url, { method, headers: {'Content-Type':'application/json'}, credentials: 'include', body: JSON.stringify(payload) });
        if (res.ok) { cantarPorVoz("Tarea guardada."); cancelarEdicionTarea(); refrescarTareas(); }
    } catch(err) { alert("Error al guardar tarea."); }
}

function editarTarea(id) {
    const t = LISTA_TAREAS.find(x => x._id === id); if(!t) return;
    document.getElementById('edit-id-tarea').value = t._id;
    document.getElementById('tar-titulo').value = t.titulo;
    document.getElementById('tar-desc').value = t.descripcion;
    document.getElementById('tar-fecha').value = t.fechaVencimiento || '';
    document.getElementById('tar-prio').value = t.prioridad;
    document.getElementById('form-title-tarea').innerText = "✏️ Editar Tarea";
    document.getElementById('btn-submit-tarea').innerText = "Guardar Cambios";
    document.getElementById('btn-cancel-tarea').classList.remove('hidden');
    document.getElementById('form-container-tarea').classList.add('border-blue-500');
}
function cancelarEdicionTarea() {
    document.getElementById('form-tarea').reset();
    document.getElementById('edit-id-tarea').value = '';
    document.getElementById('form-title-tarea').innerText = "Nueva Tarea";
    document.getElementById('btn-submit-tarea').innerText = "Añadir Tarea";
    document.getElementById('btn-cancel-tarea').classList.add('hidden');
    document.getElementById('form-container-tarea').classList.remove('border-blue-500');
}
async function borrarTarea(id) { if(confirm("¿Eliminar esta tarea?")) { await fetch(`/api/tareas/${id}`, { method: 'DELETE', credentials: 'include' }); refrescarTareas(); } }

async function refrescarFaqs() {
    try {
        const res = await fetch('/api/faqs', { credentials: 'include' });
        const data = await res.json();
        LISTA_FAQS = Array.isArray(data) ? data : [];
        
        const cont = document.getElementById('lista-faqs-admin');
        if(!cont) return;
        
        if(LISTA_FAQS.length === 0) {
            cont.innerHTML = '<div class="py-10 text-center opacity-30 italic text-[10px]">No hay FAQs configuradas en el sistema.</div>';
            return;
        }
        
        cont.innerHTML = LISTA_FAQS.map(f => `
            <details class="group bg-black/20 rounded-2xl border border-white/5 transition-all open:bg-black/40">
                <summary class="p-4 font-black text-emerald-400 cursor-pointer select-none flex justify-between items-center list-none [&::-webkit-details-marker]:hidden">
                    <span class="flex items-center gap-2 text-[11px] uppercase tracking-widest flex-1 pr-4">${f.pregunta}</span>
                    <div class="flex items-center gap-3">
                        <button onclick="editarFaq('${f._id}'); event.preventDefault();" class="text-[10px] text-blue-400 hover:text-blue-300 transition-colors">✏️ Editar</button>
                        <button onclick="borrarFaq('${f._id}'); event.preventDefault();" class="text-[10px] text-rose-400 hover:text-rose-300 transition-colors">🗑️ Borrar</button>
                        <span class="group-open:rotate-180 transition-transform text-lg text-emerald-400">▾</span>
                    </div>
                </summary>
                <div class="p-4 pt-0 opacity-90 text-[11px] leading-relaxed border-t border-white/5 mt-2 whitespace-pre-wrap">${f.respuesta}</div>
            </details>
        `).join('');
    } catch(e) { console.error("Error faqs:", e); }
}

async function manejarEnvioFaq(e) {
    e.preventDefault();
    const id = document.getElementById('edit-id-faq').value;
    const payload = { pregunta: document.getElementById('faq-pregunta').value, respuesta: document.getElementById('faq-respuesta').value };
    const url = id ? `/api/faqs/${id}` : '/api/faqs'; const method = id ? 'PUT' : 'POST';
    try {
        const res = await fetch(url, { method, headers: {'Content-Type':'application/json'}, credentials: 'include', body: JSON.stringify(payload) });
        if(res.ok) { cantarPorVoz("FAQ guardada."); cancelarEdicionFaq(); refrescarFaqs(); }
    } catch(err) { alert("Error al guardar FAQ."); }
}
function editarFaq(id) {
    const f = LISTA_FAQS.find(x => x._id === id); if(!f) return;
    document.getElementById('edit-id-faq').value = f._id; document.getElementById('faq-pregunta').value = f.pregunta; document.getElementById('faq-respuesta').value = f.respuesta;
    document.getElementById('form-title-faq').innerText = "✏️ Editando FAQ"; document.getElementById('btn-submit-faq').innerText = "Actualizar Pregunta"; document.getElementById('btn-cancel-faq').classList.remove('hidden');
    document.getElementById('faq-pregunta').focus();
}
function cancelarEdicionFaq() {
    document.getElementById('form-faq').reset(); document.getElementById('edit-id-faq').value = '';
    document.getElementById('form-title-faq').innerText = "✍️ Crear Nueva FAQ"; document.getElementById('btn-submit-faq').innerText = "Guardar Pregunta"; document.getElementById('btn-cancel-faq').classList.add('hidden');
}
async function borrarFaq(id) { if(confirm("¿Eliminar esta FAQ del sistema permanentemente?")) { await fetch(`/api/faqs/${id}`, { method: 'DELETE', credentials: 'include' }); refrescarFaqs(); } }

async function refrescarUsuariosAdmin() {
    try {
        const res = await fetch('/api/usuarios-admin', { credentials: 'include' });
        const usuarios = await res.json();
        const tbody = document.getElementById('tabla-usuarios-admin');
        if(!tbody) return;
        tbody.innerHTML = usuarios.map(u => `
            <tr class="hover:bg-white/5 transition-colors">
                <td class="py-4 px-2">
                    <div class="flex items-center gap-2">
                        <img src="${construirAvatarUsuario(u)}" class="w-8 h-8 rounded-lg object-cover border border-white/10" onerror="this.src='${construirAvatarUsuario({ email: u.email })}'">
                        <div class="min-w-0">
                            <p class="font-black lowercase truncate">${u.email}</p>
                            <p class="text-[9px] opacity-55 truncate">${u.nombreVisible || 'Sin nombre visible'}</p>
                        </div>
                    </div>
                </td>
                <td class="py-4 px-2 text-[10px]">
                    ${u.rol === 'Lector' ?
                        `<span class="bg-slate-500/20 text-slate-300 px-2 py-1 rounded font-bold uppercase tracking-widest border border-slate-500/20">Lector (bloqueado)</span>` :
                        `<div class="flex items-center gap-2 justify-start">
                            <select id="rol-${u._id}" class="input-bg border rounded-lg px-2 py-1 text-[10px] dropdown-bg">
                                <option value="Admin" ${u.rol === 'Admin' ? 'selected' : ''}>Admin</option>
                                <option value="Editor" ${u.rol === 'Editor' ? 'selected' : ''}>Editor</option>
                                <option value="Visualizador" ${u.rol === 'Visualizador' ? 'selected' : ''}>Visualizador de Datos</option>
                                <option value="Lector" ${u.rol === 'Lector' ? 'selected' : ''}>Lector</option>
                            </select>
                            <button onclick="actualizarRolUsuarioAdmin('${u._id}', '${u.rol || 'Editor'}')" class="bg-indigo-600 hover:bg-indigo-700 text-white font-black px-2 py-1 rounded-lg text-[9px] uppercase">Guardar</button>
                        </div>`
                    }
                </td>
                <td class="py-4 px-2">
                    <span class="text-[10px] font-mono ${u.ultimaConexion ? 'text-emerald-400' : 'opacity-30'}">
                        ${u.ultimaConexion ? new Date(u.ultimaConexion).toLocaleString('es-ES', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'}) : 'Nunca'}
                    </span>
                </td>
                <td class="py-4 px-2 opacity-50 text-[10px]">${new Date(u.fechaAgregado).toLocaleDateString()}</td>
                <td class="py-4 px-2 text-right">
                    <button onclick="eliminarUsuarioAdmin('${u._id}')" class="text-rose-500 hover:text-rose-400 p-2">🗑️</button>
                </td>
            </tr>
        `).join('');
    } catch(e) { console.error("Error cargando usuarios:", e); }
}

async function actualizarRolUsuarioAdmin(id, rolActual) {
    const select = document.getElementById(`rol-${id}`);
    if (!select) return;
    const nuevoRol = select.value;
    if (!['Admin', 'Editor', 'Visualizador', 'Lector'].includes(nuevoRol)) return alert('Rol inválido.');
    if (nuevoRol === rolActual) return;

    try {
        const res = await fetch(`/api/usuarios-admin/${id}/rol`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ rol: nuevoRol })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo actualizar el rol.');
        cantarPorVoz('Permiso actualizado');
        refrescarUsuariosAdmin();
    } catch (e) {
        alert(`Error actualizando rol: ${e.message}`);
        refrescarUsuariosAdmin();
    }
}

function construirAvatarUsuario(usuario) {
    const inicial = (usuario?.nombreVisible || usuario?.email || '?').trim().charAt(0).toUpperCase();
    return usuario?.fotoPerfil || `data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='%23111827'/%3E%3Ctext x='50%25' y='55%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-size='56' fill='%2394a3b8'%3E${encodeURIComponent(inicial)}%3C/text%3E%3C/svg%3E`;
}

async function cargarMiPerfil() {
    try {
        const res = await fetch('/api/perfil', { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar el perfil.');

        document.getElementById('perfil-nombre-visible').value = data.nombreVisible || '';
        document.getElementById('perfil-foto-url').value = data.fotoPerfil || '';
        document.getElementById('perfil-foto-preview').src = construirAvatarUsuario(data);
    } catch (e) {
        console.error('Error perfil:', e.message);
    }
}

function cargarFotoPerfilLocal(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const base64 = String(e.target?.result || '');
        document.getElementById('perfil-foto-url').value = base64;
        document.getElementById('perfil-foto-preview').src = base64;
    };
    reader.readAsDataURL(file);
}

async function guardarMiPerfil() {
    const nombreVisible = document.getElementById('perfil-nombre-visible').value.trim();
    const fotoPerfil = document.getElementById('perfil-foto-url').value.trim();

    try {
        const res = await fetch('/api/perfil', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ nombreVisible, fotoPerfil })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo guardar el perfil.');

        document.getElementById('perfil-foto-preview').src = construirAvatarUsuario(data.perfil || { nombreVisible, fotoPerfil });
        cantarPorVoz('Perfil guardado');
        refrescarUsuariosAdmin();
        refrescarUsuariosChat();
    } catch (e) {
        alert(`Error de perfil: ${e.message}`);
    }
}

async function refrescarUsuariosChat() {
    try {
        const res = await fetch('/api/mensajes/usuarios', { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar lista de chat.');

        CHAT_USUARIOS = data.usuarios || [];
        const containers = [
            document.getElementById('lista-chat-usuarios'),
            document.getElementById('chat-popup-usuarios')
        ].filter(Boolean);
        if (containers.length === 0) return;

        const q = CHAT_SEARCH_QUERY.toLowerCase();
        const visibles = CHAT_USUARIOS.filter((u) => {
            if (!q) return true;
            const nombre = String(u.nombreVisible || '').toLowerCase();
            const email = String(u.email || '').toLowerCase();
            return nombre.includes(q) || email.includes(q);
        });

        if (visibles.length === 0) {
            containers.forEach((cont) => {
                cont.innerHTML = '<p class="text-[10px] opacity-50">No hay usuarios para ese filtro.</p>';
            });
            return;
        }

        const html = visibles.map(u => {
            const activo = CHAT_USUARIO_ACTIVO && CHAT_USUARIO_ACTIVO.email === u.email;
            const nombre = u.nombreVisible || u.email.split('@')[0];
            const preview = u.ultimoMensaje ? `${u.ultimoMensajeEsMio ? 'Tu: ' : ''}${u.ultimoMensaje}` : 'Sin mensajes aún';
            const unread = Number(u.unread || 0);
            const fecha = u.ultimoMensajeTs
                ? new Date(u.ultimoMensajeTs).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
                : '';

            return `
                <button onclick="seleccionarUsuarioChat('${u.email.replace(/'/g, "\\'")}')" class="w-full text-left p-2 rounded-xl border transition-all ${activo ? 'bg-blue-500/20 border-blue-500/40' : 'bg-black/20 border-white/10 hover:bg-white/10'}">
                    <div class="flex items-center gap-2">
                        <img src="${construirAvatarUsuario(u)}" class="w-8 h-8 rounded-lg object-cover border border-white/10" onerror="this.src='${construirAvatarUsuario({ email: u.email })}'">
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center justify-between gap-2">
                                <p class="text-[10px] font-bold uppercase truncate">${escapeHtmlSafe(nombre)}</p>
                                ${fecha ? `<span class="text-[8px] opacity-45 font-mono">${fecha}</span>` : ''}
                            </div>
                            <p class="text-[9px] opacity-65 truncate">${escapeHtmlSafe(preview)}</p>
                            <p class="text-[8px] opacity-45 truncate">${escapeHtmlSafe(u.email)}</p>
                        </div>
                        ${unread > 0 ? `<span class="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">${unread > 99 ? '99+' : unread}</span>` : ''}
                    </div>
                </button>`;
        }).join('');
        containers.forEach((cont) => { cont.innerHTML = html; });

        if (!CHAT_USUARIO_ACTIVO && visibles.length > 0) {
            CHAT_USUARIO_ACTIVO = visibles[0];
            await cargarConversacionInterna(visibles[0].email);
        }
    } catch (e) {
        console.error('Error chat usuarios:', e.message);
    }
}

window.filtrarUsuariosChatLista = function(query) {
    CHAT_SEARCH_QUERY = String(query || '').trim();
    const mainInput = document.getElementById('chat-user-search-main');
    const popInput = document.getElementById('chat-user-search-popup');
    if (mainInput && mainInput.value !== CHAT_SEARCH_QUERY) mainInput.value = CHAT_SEARCH_QUERY;
    if (popInput && popInput.value !== CHAT_SEARCH_QUERY) popInput.value = CHAT_SEARCH_QUERY;
    refrescarUsuariosChat();
}

function seleccionarUsuarioChat(email) {
    CHAT_USUARIO_ACTIVO = CHAT_USUARIOS.find(u => u.email === email) || null;
    const header = document.getElementById('chat-header-usuario');
    const headerPopup = document.getElementById('chat-popup-header-usuario');
    const nombreCabecera = CHAT_USUARIO_ACTIVO
        ? `Chat con ${CHAT_USUARIO_ACTIVO.nombreVisible || CHAT_USUARIO_ACTIVO.email.split('@')[0]}`
        : 'Selecciona un usuario';
    if (header && CHAT_USUARIO_ACTIVO) {
        header.innerText = nombreCabecera;
    }
    if (headerPopup) headerPopup.innerText = nombreCabecera;
    refrescarUsuariosChat();
    cargarConversacionInterna(email);
}

async function cargarConversacionInterna(email) {
    try {
        const res = await fetch(`/api/mensajes?con=${encodeURIComponent(email)}`, { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar la conversación.');

        const containers = [
            document.getElementById('chat-conversacion'),
            document.getElementById('chat-popup-conversacion')
        ].filter(Boolean);
        if (containers.length === 0) return;
        const mensajes = data.mensajes || [];

        if (mensajes.length === 0) {
            containers.forEach((cont) => {
                cont.innerHTML = '<p class="text-[10px] opacity-45">Aún no hay mensajes en esta conversación.</p>';
            });
            return;
        }

        const html = mensajes.map(m => {
            const mio = m.deEmail === USUARIO_EMAIL_ACTUAL;
            const emisor = mio ? 'Tu' : (m.deNombreVisible || m.deEmail || 'Usuario');
            const fecha = new Date(m.creadoEn).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            return `
                <div class="flex ${mio ? 'justify-end' : 'justify-start'}">
                    <div class="max-w-[86%] px-3 py-2 rounded-2xl border shadow-sm ${mio ? 'bg-blue-600/20 border-blue-500/40' : 'bg-slate-700/40 border-white/10'}">
                        <p class="text-[9px] font-black uppercase tracking-wider opacity-70 mb-1">${escapeHtmlSafe(emisor)}</p>
                        <p class="text-[11px] leading-relaxed whitespace-pre-wrap break-words">${escapeHtmlSafe(m.texto)}</p>
                        <p class="text-[9px] opacity-50 mt-1 font-mono text-right">${fecha}</p>
                    </div>
                </div>`;
        }).join('');

        containers.forEach((cont) => {
            cont.innerHTML = html;
            cont.scrollTop = cont.scrollHeight;
        });
    } catch (e) {
        console.error('Error conversación:', e.message);
    }
}

async function enviarMensajeInterno(origen = 'panel') {
    const input = origen === 'popup'
        ? document.getElementById('chat-popup-input')
        : document.getElementById('chat-input-mensaje');
    const inputAlternativo = origen === 'popup'
        ? document.getElementById('chat-input-mensaje')
        : document.getElementById('chat-popup-input');

    const texto = (input?.value || '').trim();
    if (!texto) return;
    if (!CHAT_USUARIO_ACTIVO) return alert('Selecciona un usuario para enviar mensaje.');

    const btn = origen === 'popup'
        ? document.querySelector('#internal-chat-window button[onclick="enviarMensajeInterno(\'popup\')"]')
        : document.querySelector('#sec-usuarios button[onclick="enviarMensajeInterno()"]');

    try {
        if (btn) {
            btn.disabled = true;
            btn.classList.add('opacity-60');
        }
        const res = await fetch('/api/mensajes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ paraEmail: CHAT_USUARIO_ACTIVO.email, texto })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo enviar el mensaje.');

        if (input) input.value = '';
        if (inputAlternativo) inputAlternativo.value = '';
        reproducirSonidoMensaje('send');
        await cargarConversacionInterna(CHAT_USUARIO_ACTIVO.email);
        await refrescarUsuariosChat();
    } catch (e) {
        alert(`Error enviando mensaje: ${e.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('opacity-60');
        }
    }
}

function iniciarAutoRefreshChat() {
    if (!chatPollingDebeEstarActivo()) return;
    detenerAutoRefreshChat();
    CHAT_REFRESH_INTERVAL = setInterval(() => {
        if (!chatPollingDebeEstarActivo()) {
            detenerAutoRefreshChat();
            return;
        }
        refrescarUsuariosChat();
        if (CHAT_USUARIO_ACTIVO?.email) {
            cargarConversacionInterna(CHAT_USUARIO_ACTIVO.email);
        }
    }, 16000);
}

function detenerAutoRefreshChat() {
    if (CHAT_REFRESH_INTERVAL) {
        clearInterval(CHAT_REFRESH_INTERVAL);
        CHAT_REFRESH_INTERVAL = null;
    }
}

async function agregarUsuarioAutorizado() {
    const emailInput = document.getElementById('user-admin-email');
    const rolInput = document.getElementById('user-admin-rol');
    const email = emailInput.value.trim();
    const rol = rolInput ? rolInput.value : 'Editor';
    if(!email) return alert("Introduce un email.");
    
    try {
        const res = await fetch('/api/usuarios-admin', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            credentials: 'include',
            body: JSON.stringify({ email, rol })
        });
        if(res.ok) {
            cantarPorVoz("Acceso concedido");
            emailInput.value = '';
            refrescarUsuariosAdmin();
        } else {
            const err = await res.json();
            alert(err.error || "Error al autorizar.");
        }
    } catch(e) { alert("Fallo de conexión."); }
}

async function eliminarUsuarioAdmin(id) {
    if(!confirm("¿Revocar acceso a esta cuenta? El usuario ya no podrá entrar al sistema.")) return;
    try {
        const res = await fetch(`/api/usuarios-admin/${id}`, { method: 'DELETE', credentials: 'include' });
        if(res.ok) {
            cantarPorVoz("Acceso revocado");
            refrescarUsuariosAdmin();
        } else {
            const err = await res.json();
            alert(err.error || "Error al eliminar.");
        }
    } catch(e) { alert("Error de red."); }
}

async function manejarEnvioCliente(e) {
    e.preventDefault();
    const btnSave = e.target.querySelector('button[type="submit"]');
    const originalText = btnSave.innerText;
    btnSave.innerText = "Guardando...";
    btnSave.disabled = true;

    const id = document.getElementById('crm-id').value;
    const payload = {
        nombre: document.getElementById('crm-nombre').value.trim(),
        nif: document.getElementById('crm-nif').value.trim(),
        email: document.getElementById('crm-email').value.trim(),
        telefono: document.getElementById('crm-tel').value.trim(),
        direccion: document.getElementById('crm-dir').value.trim(),
        comentarios: document.getElementById('crm-comentarios').value.trim(),
        reservas: RESERVAS_CLIENTE_EDICION
    };

    if (!payload.nombre) {
        alert("El nombre del cliente es obligatorio.");
        btnSave.innerText = originalText; btnSave.disabled = false;
        return;
    }

    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/clientes/${id}` : '/api/clientes';

    try {
        const res = await fetch(url, { 
            method, 
            headers: {'Content-Type':'application/json'}, 
            credentials:'include', 
            body: JSON.stringify(payload) 
        });
        
        if(res.ok) { 
            cantarPorVoz("Datos sincronizados"); 
            limpiarFormCRM(); 
            await refrescarClientesCRM(); 
        } else {
            const err = await res.json();
            alert(err.error || "Fallo en el servidor al guardar cliente.");
        }
    } catch(err) {
        alert("Error crítico de comunicación con la base de datos.");
    } finally {
        btnSave.innerText = originalText;
        btnSave.disabled = false;
    }
}

let RESERVAS_CLIENTE_EDICION = [];

function filtrarCRM(query) {
    const q = query.toLowerCase();
    const filtrados = LISTA_CLIENTES_CACHE.filter(c => 
        (c.nombre && c.nombre.toLowerCase().includes(q)) || 
        (c.nif && c.nif.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.telefono && c.telefono.toLowerCase().includes(q))
    );
    renderizarTablaClientes(filtrados);
};

function agregarReservaActual() {
    const fecha = document.getElementById('crm-reserva-fecha').value;
    if(!fecha) return;
    RESERVAS_CLIENTE_EDICION.push({ fecha: new Date(fecha), nota: "Reserva añadida" });
    renderListaReservasEdicion();
}

function renderListaReservasEdicion() {
    const container = document.getElementById('crm-reserva-lista');
    container.innerHTML = RESERVAS_CLIENTE_EDICION.map((r, i) => `
        <div class="flex justify-between items-center bg-black/40 p-1.5 rounded-lg text-[9px]">
            <span>📅 ${new Date(r.fecha).toLocaleDateString()}</span>
            <button onclick="RESERVAS_CLIENTE_EDICION.splice(${i}, 1); renderListaReservasEdicion();" class="text-rose-500">✕</button>
        </div>
    `).join('');
}

async function refrescarClientesCRM() {
    const res = await fetch('/api/clientes', { credentials: 'include' });
    const clientes = await res.json();
    LISTA_CLIENTES_CACHE = clientes;
    renderizarTablaClientes(clientes);
}

function renderizarTablaClientes(clientes) {
    const container = document.getElementById('contenedor-clientes-crm');
    if(!container) return;
    if (!Array.isArray(clientes) || clientes.length === 0) {
        container.innerHTML = '<div class="col-span-full p-6 rounded-2xl border border-white/10 bg-black/20 text-center text-sm opacity-70">No hay clientes en CRM todavia.</div>';
        return;
    }

    const hoy = new Date();
    const sumarDias = (fechaTxt) => {
        if (!fechaTxt) return null;
        const f = new Date(fechaTxt);
        if (isNaN(f.getTime())) return null;
        return Math.ceil((f - hoy) / 86400000);
    };

    container.innerHTML = clientes.map(c => `
        <div class="card-bg border rounded-3xl p-5 flex flex-col gap-3 hover:scale-[1.01] transition-transform shadow-xl bg-gradient-to-br from-slate-900/60 to-slate-800/40">
            <div class="flex justify-between items-start">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-black text-xl shadow-md border-2 border-white/10">
                        ${escapeHtmlSafe((c.nombre || '?').charAt(0).toUpperCase())}
                    </div>
                    <div>
                        <h4 class="font-black text-sm uppercase tracking-tight text-blue-400">${escapeHtmlSafe(c.nombre || 'Sin nombre')}</h4>
                        <span class="text-[10px] font-mono opacity-50">${escapeHtmlSafe(c.nif || 'Sin DNI/NIF')}</span>
                    </div>
                </div>
                <div class="flex gap-1">
                    <button onclick="cargarEnFormCRM('${c._id}')" class="bg-blue-500/10 hover:bg-blue-500 text-blue-400 hover:text-white p-2 rounded-xl transition-all" title="Editar">✏️</button>
                    <button onclick="borrarClienteCRM('${c._id}')" class="bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white p-2 rounded-xl transition-all" title="Eliminar">🗑️</button>
                </div>
            </div>
            <div class="text-[11px] space-y-1.5 mt-2 opacity-80">
                <p class="flex items-center gap-2"><span class="opacity-40">📞</span> <span class="font-bold tracking-wider">${escapeHtmlSafe(c.telefono || 'Sin telefono')}</span></p>
                <p class="flex items-center gap-2"><span class="opacity-40">✉️</span> <span class="font-mono truncate">${escapeHtmlSafe(c.email || 'Sin email')}</span></p>
                ${c.direccion ? `<p class="flex items-start gap-2"><span class="opacity-40 mt-0.5">📍</span><span class="text-[10px] opacity-70 max-h-8 overflow-hidden">${escapeHtmlSafe(c.direccion)}</span></p>` : ''}
            </div>
            ${c.comentarios ? `<div class="mt-2 p-3 bg-black/20 rounded-xl border border-white/5 text-[10px] italic opacity-80 leading-relaxed break-words">${escapeHtmlSafe(c.comentarios)}</div>` : ''}
            <div class="mt-4 pt-4 border-t border-white/10">
                <p class="text-[9px] font-black uppercase tracking-widest opacity-40 mb-2">📅 Próximas Reservas</p>
                <div class="flex flex-wrap gap-1.5">
                    ${c.reservas?.length ? c.reservas.map(r => {
                        const fechaTxt = new Date(r.fecha).toLocaleDateString();
                        const d = sumarDias(r.fecha);
                        const badge = d !== null
                            ? (d < 0 ? '<span class="text-[8px] text-rose-300">Vencida</span>' : d <= 7 ? '<span class="text-[8px] text-amber-300">Esta semana</span>' : '<span class="text-[8px] text-emerald-300">Planificada</span>')
                            : '';
                        return `<span class="bg-indigo-500/20 text-indigo-300 px-2 py-1 rounded-lg text-[9px] font-bold border border-indigo-500/30">${fechaTxt} ${badge}</span>`;
                    }).join('') : '<span class="text-[9px] opacity-30 italic">No hay reservas programadas</span>'}
                </div>
            </div>
        </div>
    `).join('');
}

async function borrarClienteCRM(id) {
    if(confirm("¿Eliminar cliente del CRM?")) { await fetch(`/api/clientes/${id}`, { method: 'DELETE', credentials: 'include' }); refrescarClientesCRM(); }
}

function toggleAIAssistant() {
    const chat = document.getElementById('ai-chat-window');
    chat.classList.toggle('hidden');
    if (!chat.classList.contains('hidden')) {
        document.getElementById('ai-chat-input').focus();
    }
}

let imagenIABase64 = "";

function procesarImagenIA(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
            const MAX = 600; let w = img.width; let h = img.height;
            if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } } else { if (h > MAX) { w *= MAX / h; h = MAX; } }
            canvas.width = w; canvas.height = h; ctx.drawImage(img, 0, 0, w, h);
            imagenIABase64 = canvas.toDataURL('image/jpeg', 0.7);
            document.getElementById('ai-image-preview').src = imagenIABase64;
            document.getElementById('ai-image-preview-container').classList.remove('hidden');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function quitarImagenIA() {
    imagenIABase64 = ""; document.getElementById('ai-file-input').value = "";
    document.getElementById('ai-image-preview-container').classList.add('hidden');
}

async function enviarMensajeIA(e) {
    e.preventDefault();
    const input = document.getElementById('ai-chat-input');
    const mensaje = input.value.trim();
    const imgData = imagenIABase64; 
    if (!mensaje && !imgData) return;

    const chatMessages = document.getElementById('ai-chat-messages');
    const btnSend = document.getElementById('ai-btn-send');

    let userMsgHtml = mensaje;
    if (imgData) userMsgHtml = `<img src="${imgData}" class="w-32 rounded-lg mb-2 border border-white/10 shadow-md">` + (mensaje ? `<p>${mensaje}</p>` : '');

    chatMessages.innerHTML += `
        <div class="flex gap-2 justify-end">
            <div class="bg-indigo-600/30 border border-indigo-500/30 p-3 rounded-2xl rounded-tr-none opacity-90 leading-relaxed text-indigo-50 max-w-[85%] shadow-sm flex flex-col items-end">
                ${userMsgHtml}
            </div>
        </div>
    `;
    input.value = ''; btnSend.disabled = true; btnSend.innerHTML = '⏳';
    quitarImagenIA();
    chatMessages.scrollTop = chatMessages.scrollHeight;

    const idTemp = 'ia-temp-' + Date.now();
    chatMessages.innerHTML += `
        <div id="${idTemp}" class="flex gap-2">
            <div class="w-7 h-7 rounded-full bg-purple-600/30 border border-purple-500/30 flex items-center justify-center flex-shrink-0 animate-pulse text-sm mt-1">🤖</div>
            <div class="bg-white/5 border border-white/5 p-3 rounded-2xl rounded-tl-none opacity-70 italic shadow-sm">
                Procesando...
            </div>
        </div>
    `;
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
        const res = await fetch(`${BACKEND_URL}/api/chat`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ mensaje, imagen: imgData })
        });
        const data = await res.json();
        document.getElementById(idTemp).remove();

        if (res.ok) {
            const respuestaFormat = data.respuesta
                .replace(/\*\*(.*?)\*\*/g, '<strong class="text-purple-300">$1</strong>')
                .replace(/\*(.*?)\*/g, '<em class="opacity-80">$1</em>')
                .replace(/\n/g, '<br>');
            chatMessages.innerHTML += `
                <div class="flex gap-2 animate-fadeIn">
                    <div class="w-7 h-7 rounded-full bg-purple-600/30 border border-purple-500/30 flex items-center justify-center flex-shrink-0 text-sm mt-1">✨</div>
                    <div class="bg-white/5 border border-white/5 p-3 rounded-2xl rounded-tl-none opacity-90 leading-relaxed max-w-[85%] shadow-sm">
                        ${respuestaFormat}
                    </div>
                </div>
            `;
            
            if (data.accionEjecutada) {
                cantarPorVoz("Operación ejecutada por Inteligencia Artificial.");
                await forceRefreshDataManual();
                
                if (data.acciones && data.acciones.length > 0) {
                    data.acciones.forEach(acc => {
                        if (acc.tipo === 'PREPARAR_FACTURA') {
                            setTimeout(() => {
                                navegarASeccion('sec-gestion');
                                setTimeout(() => {
                                    if (acc.params.cliente) document.getElementById('fac-cliente-nombre').value = acc.params.cliente;
                                    
                                    if (acc.params.sku) {
                                        const checks = document.querySelectorAll('.fac-check-item');
                                        checks.forEach(c => c.checked = false);
                                        let encontrado = false;
                                        checks.forEach(c => {
                                            const itemData = BASE_DATOS.find(v => v._id === c.dataset.id);
                                            if (itemData && itemData.sku && itemData.sku.toLowerCase() === acc.params.sku.toLowerCase()) {
                                                c.checked = true; encontrado = true;
                                            }
                                        });
                                        recalcularTotalesFactura();
                                        
                                        if (encontrado) {
                                            cantarPorVoz("Generando documento PDF");
                                            setTimeout(() => generarFacturaPDF(), 1200);
                                        } else {
                                            alert("IA: No he podido facturar porque el artículo " + acc.params.sku + " no existe o no está marcado como Vendido.");
                                        }
                                    }
                                }, 200);
                            }, 100);
                        }
                    });
                }
            }
        } else {
            throw new Error(data.error);
        }
    } catch (err) {
        document.getElementById(idTemp)?.remove();
        chatMessages.innerHTML += `
            <div class="flex gap-2">
                <div class="w-7 h-7 rounded-full bg-rose-600/30 border border-rose-500/30 flex items-center justify-center flex-shrink-0 text-sm mt-1">⚠️</div>
                <div class="bg-rose-500/10 border border-rose-500/20 text-rose-300 p-3 rounded-2xl rounded-tl-none opacity-90 leading-relaxed max-w-[85%]">
                    ${err.message || 'Error de conexión con el motor de IA.'}
                </div>
            </div>
        `;
    } finally {
        btnSend.disabled = false; btnSend.innerHTML = '➤';
        chatMessages.scrollTop = chatMessages.scrollHeight; input.focus();
    }
}

async function cargarEnFormCRM(id) {
    const c = LISTA_CLIENTES_CACHE.find(x => x._id === id);
    if(!c) return;
    document.getElementById('crm-id').value = c._id;
    document.getElementById('crm-nombre').value = c.nombre;
    document.getElementById('crm-nif').value = c.nif;
    document.getElementById('crm-email').value = c.email;
    document.getElementById('crm-tel').value = c.telefono;
    document.getElementById('crm-dir').value = c.direccion;
    document.getElementById('crm-comentarios').value = c.comentarios || '';
    RESERVAS_CLIENTE_EDICION = c.reservas || [];
    renderListaReservasEdicion();
    document.getElementById('crm-form-title').innerText = "✏️ Editando Cliente";
}

function limpiarFormCRM() {
    document.getElementById('form-cliente').reset();
    document.getElementById('crm-id').value = '';
    RESERVAS_CLIENTE_EDICION = [];
    renderListaReservasEdicion();
    document.getElementById('crm-form-title').innerText = "👥 Ficha de Cliente";
}

async function lanzarModalCRM() {
    const list = document.getElementById('crm-modal-list');
    list.innerHTML = LISTA_CLIENTES_CACHE.map(c => `
        <div onclick="seleccionarClienteParaFactura('${c._id}')" class="p-3 bg-black/20 border border-white/5 rounded-2xl hover:bg-blue-600/20 cursor-pointer transition-all">
            <p class="font-black uppercase text-[11px]">${c.nombre}</p>
            <p class="text-[9px] opacity-40 font-mono">${c.nif || '---'}</p>
        </div>
    `).join('');
    document.getElementById('modal-crm-selector').classList.remove('hidden');
}

async function seleccionarClienteParaFactura(id) {
    const c = LISTA_CLIENTES_CACHE.find(x => x._id === id);
    if(c) {
        document.getElementById('fac-cliente-nombre').value = c.nombre;
        document.getElementById('fac-cliente-nif').value = c.nif || '';
        document.getElementById('fac-cliente-dir').value = c.direccion || '';
        document.getElementById('modal-crm-selector').classList.add('hidden');
        cantarPorVoz("Cliente cargado");
    }
}

function verDetalleStockDia(dia) {
    const mm = String(CAL_STOCK_MES).padStart(2, '0');
    const dd = String(dia).padStart(2, '0');
    const fechaStr = `${CAL_STOCK_ANIO}-${mm}-${dd}`;
    
    const items = BASE_DATOS.filter(v => v.fecha === fechaStr || v.fechaVenta === fechaStr);
    const modal = document.getElementById('modal-stock-detalle');
    const lista = document.getElementById('detalle-stock-lista');
    const titulo = document.getElementById('detalle-stock-titulo');

    titulo.innerText = `Actividad del ${dia}/${CAL_STOCK_MES}/${CAL_STOCK_ANIO}`;
    
    if (items.length === 0) {
        lista.innerHTML = '<div class="py-10 text-center opacity-30">No hay movimientos registrados este día.</div>';
    } else {
        lista.innerHTML = items.map(v => {
            const esAlta = v.fecha === fechaStr;
            const esVenta = v.fechaVenta === fechaStr;
            let icon = esAlta && esVenta ? '➕💰' : (esAlta ? '➕ Alta' : '💰 Venta');
            let color = esAlta && esVenta ? 'text-indigo-400' : (esAlta ? 'text-blue-400' : 'text-emerald-400');

            return `
                <div class="p-3 bg-black/20 border border-white/5 rounded-2xl flex justify-between items-center gap-3">
                    <div class="min-w-0 flex-1">
                        <p class="font-bold uppercase truncate text-[11px]">${v.prenda}</p>
                        <p class="text-[9px] font-mono opacity-60"><span class="${color}">${icon}</span> • SKU: ${v.sku || 'N/A'} • ${parseFloat(v.precioVenta || 0).toFixed(2)}€</p>
                    </div>
                    <button onclick="document.getElementById('modal-stock-detalle').classList.add('hidden'); editItem('${v._id}')" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all shadow-md">Editar</button>
                </div>`;
        }).join('');
    }
    modal.classList.remove('hidden');
}

async function renderizarMapaDeLogins() {
    const container = document.getElementById('globe-container');
    if (!container || (GLOBO_INSTANCE && !window.__forzarRecargaMapaLogin)) return;

    if (GLOBO_ANIM_FRAME) {
        cancelAnimationFrame(GLOBO_ANIM_FRAME);
        GLOBO_ANIM_FRAME = null;
    }
    if (GLOBO_RENDERER) {
        try { GLOBO_RENDERER.dispose(); } catch (_) {}
    }
    container.innerHTML = '';
    GLOBO_INSTANCE = null;
    GLOBO_RENDERER = null;
    GLOBO_CONTROLS = null;
    GLOBO_COMPOSER = null;
    window.__forzarRecargaMapaLogin = false;

    const loaderHtml = `
        <div id="globe-loader" class="absolute inset-0 flex items-center justify-center flex-col gap-2 text-purple-300 font-mono text-xs">
            <div class="w-8 h-8 border-4 border-purple-400 border-t-transparent rounded-full animate-spin"></div>
            <span>Cargando datos geoespaciales...</span>
        </div>`;
    container.insertAdjacentHTML('beforeend', loaderHtml);

    const loader = document.getElementById('globe-loader');
    if(loader) loader.classList.remove('hidden');

    try {
        await ensureThreeStackLoaded();
        const filtroUsuario = document.getElementById('logs-map-user-filter')?.value || '';
        const queryBase = filtroUsuario ? `usuario=${encodeURIComponent(filtroUsuario)}&` : '';
        const query = `?${queryBase}limit=1200`;
        const [locationsRes, countriesRes] = await Promise.all([
            fetch(`/api/logs/locations${query}`, { credentials: 'include' }),
            fetch('/ne_110m_admin_0_countries.geojson')
        ]);

        if (!locationsRes.ok) throw new Error('Fallo al cargar datos de localización');
        const locationsData = await locationsRes.json();
        const countriesData = await countriesRes.json();

        const locations = locationsData.locations || [];
        const usuariosDisponibles = locationsData.usuariosDisponibles || [];
        if(loader) loader.classList.add('hidden');

        const selectorUsuarios = document.getElementById('logs-map-user-filter');
        if (selectorUsuarios) {
            const seleccionado = selectorUsuarios.value || '';
            selectorUsuarios.innerHTML = `<option value="">Todos los usuarios del equipo</option>` + usuariosDisponibles.map(u => `<option value="${u}">${u}</option>`).join('');
            selectorUsuarios.value = usuariosDisponibles.includes(seleccionado) ? seleccionado : '';
        }

        if (locations.length === 0) {
            container.innerHTML = `<div class="flex items-center justify-center h-full text-sm opacity-40 italic">No hay datos de conexión para mostrar.</div>`;
            return;
        }
        
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.setSize(container.offsetWidth, container.offsetHeight);
        container.appendChild(renderer.domElement);
        const scene = new THREE.Scene();

        const abrirDetallePuntoMapa = (d) => {
            if (!d) return;
            const modal = document.getElementById('modal-mapa-detalle');
            const titulo = document.getElementById('detalle-mapa-titulo');
            const lista = document.getElementById('detalle-mapa-lista');
            if (!modal || !titulo || !lista) return;

            titulo.innerText = `Actividad en ${d.ciudad || 'Ubicación desconocida'}`;
            const ipResumen = (d.ips || []).slice(0, 5).map(x => `${x.ip} (${x.count})`).join(' · ');
            lista.innerHTML = (d.eventos && d.eventos.length > 0) ? d.eventos.map(ev => {
                const isLogout = String(ev.accion || '').includes('Cerró');
                const color = isLogout ? 'text-rose-400' : 'text-emerald-400';
                const icon = isLogout ? '🚪' : '🔑';
                const dateObj = new Date(ev.fecha);
                const dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString();
                return `<div class="p-3 bg-black/20 border border-white/5 rounded-xl flex flex-col gap-1.5 shadow-sm">
                            <div class="flex justify-between items-center border-b border-white/5 pb-1">
                                <span class="${color} font-black text-[10px] uppercase">${icon} ${ev.accion}</span>
                                <span class="text-[9px] opacity-50 font-mono">${dateStr}</span>
                            </div>
                            <span class="text-white/80 font-mono text-[10px] mt-0.5">👤 ${ev.usuario}</span>
                            <span class="text-cyan-300/80 font-mono text-[10px]">🌐 IP: ${ev.ip || 'N/A'}</span>
                        </div>`;
            }).join('') : '<div class="opacity-50 italic">Sin actividad reciente.</div>';

            if (ipResumen) {
                lista.innerHTML = `<div class="mb-3 p-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-[10px] font-mono text-cyan-200">Top IPs zona: ${ipResumen}</div>` + lista.innerHTML;
            }
            modal.classList.remove('hidden');
        };

        const globe = new ThreeGlobe({ waitForGlobeReady: true, animateIn: true })
            .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
            .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
            .polygonsData(countriesData.features)
            .polygonCapColor(() => 'rgba(59, 130, 246, 0.18)')
            .polygonSideColor(() => 'rgba(15, 23, 42, 0.28)')
            .polygonStrokeColor(() => 'rgba(56, 189, 248, 0.4)')
            .pointsData(locations).pointLat('lat').pointLng('lon')
            .pointColor(d => (d.count >= 5 ? '#ef4444' : d.count >= 3 ? '#f59e0b' : '#22c55e')).pointAltitude(0.045).pointRadius(d => 0.15 + d.count * 0.09)
            .ringsData(locations).ringLat('lat').ringLng('lon')
            .ringColor((d) => (t) => {
                const base = d.count >= 5 ? '239,68,68' : d.count >= 3 ? '245,158,11' : '34,197,94';
                return `rgba(${base}, ${1 - t})`;
            })
            .ringMaxRadius(d => 4 + d.count * 0.7).ringPropagationSpeed(d => 2.4 + d.count * 0.25).ringRepeatPeriod(920);

        if (typeof globe.pointLabel === 'function') {
            globe.pointLabel(d => {
                const ipsTxt = (d.ips || []).slice(0, 3).map(ip => `${ip.ip} (${ip.count})`).join('<br>');
                return `<div class="bg-slate-900/95 border border-cyan-500/40 p-2 rounded-lg text-xs text-cyan-100"><b>${d.ciudad}, ${d.pais}</b><br>Eventos: ${d.count}<br>${ipsTxt || 'Sin IP'}</div>`;
            });
        }
        scene.add(globe);

        const atmosphere = new THREE.Mesh(
            new THREE.SphereGeometry(globe.getGlobeRadius() * 1.1, 75, 75),
            new THREE.ShaderMaterial({
                vertexShader: `varying vec3 vNormal; void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
                fragmentShader: `varying vec3 vNormal; void main() { float intensity = pow(0.58 - dot(vNormal, vec3(0, 0, 1.0)), 2.0); gl_FragColor = vec4(0.13, 0.74, 0.95, 1.0) * intensity; }`,
                blending: THREE.AdditiveBlending, side: THREE.BackSide
            })
        );
        scene.add(atmosphere);

        const starGeometry = new THREE.BufferGeometry();
        const starVertices = [];
        for (let i = 0; i < 2500; i++) {
            const x = THREE.MathUtils.randFloatSpread(2000);
            const y = THREE.MathUtils.randFloatSpread(2000);
            const z = THREE.MathUtils.randFloatSpread(2000);
            starVertices.push(x, y, z);
        }
        starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
        const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xcbd5e1, size: 0.9 }));
        scene.add(stars);

        scene.background = new THREE.Color(0x020617);
        scene.fog = new THREE.Fog(0x020617, 320, 760);
        scene.add(new THREE.AmbientLight(0xaad3ff, 1.05));
        const dirLightA = new THREE.DirectionalLight(0x9dd6ff, 0.9);
        dirLightA.position.set(180, 120, 220);
        scene.add(dirLightA);
        const dirLightB = new THREE.DirectionalLight(0x5eead4, 0.45);
        dirLightB.position.set(-140, -80, -160);
        scene.add(dirLightB);

        const camera = new THREE.PerspectiveCamera(75, container.offsetWidth / container.offsetHeight, 0.1, 1000);
        camera.position.z = 240;

        // Interacción manual ligera para evitar dependencias frágiles de OrbitControls.
        let isDragging = false;
        let lastX = 0;
        let lastY = 0;
        let dragDistance = 0;
        let zoom = 240;

        const raycaster = new THREE.Raycaster();
        raycaster.params.Points = raycaster.params.Points || {};
        raycaster.params.Points.threshold = 1.2;
        const mouse = new THREE.Vector2();

        renderer.domElement.addEventListener('pointerdown', (ev) => {
            isDragging = true;
            lastX = ev.clientX;
            lastY = ev.clientY;
            dragDistance = 0;
        });
        renderer.domElement.addEventListener('pointerup', (ev) => {
            isDragging = false;

            // Click sin arrastre: resolver punto manualmente (compatibilidad con versiones sin onPointClick).
            if (dragDistance > 5) return;
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, camera);
            const hits = raycaster.intersectObjects(scene.children, true);
            const hitConData = hits.find(h => {
                const d = h?.object?.__data;
                return d && Number.isFinite(d.lat) && Number.isFinite(d.lon);
            });
            if (hitConData?.object?.__data) {
                abrirDetallePuntoMapa(hitConData.object.__data);
            }
        });
        renderer.domElement.addEventListener('pointerleave', () => { isDragging = false; });
        renderer.domElement.addEventListener('pointermove', (ev) => {
            if (!isDragging) return;
            const dx = ev.clientX - lastX;
            const dy = ev.clientY - lastY;
            dragDistance += Math.abs(dx) + Math.abs(dy);
            globe.rotation.y += dx * 0.004;
            globe.rotation.x += dy * 0.002;
            globe.rotation.x = Math.max(-0.6, Math.min(0.6, globe.rotation.x));
            lastX = ev.clientX;
            lastY = ev.clientY;
        });
        renderer.domElement.addEventListener('wheel', (ev) => {
            ev.preventDefault();
            zoom += ev.deltaY * 0.08;
            zoom = Math.max(150, Math.min(400, zoom));
            camera.position.z = zoom;
        }, { passive: false });

        (function animate() {
            globe.rotation.y += 0.0015;
            renderer.render(scene, camera);
            GLOBO_ANIM_FRAME = requestAnimationFrame(animate);
        })();

        GLOBO_INSTANCE = globe;
        GLOBO_RENDERER = renderer;
        GLOBO_CONTROLS = null;
        GLOBO_COMPOSER = null;
        
        if (locationsData.lastLogin) {
            setTimeout(() => {
                globe.pointOfView({ lat: locationsData.lastLogin.lat, lng: locationsData.lastLogin.lon, altitude: 1.5 }, 2500);
            }, 1000);
        }

    } catch (error) {
        if(loader) loader.classList.add('hidden');
        container.innerHTML = `<div class="flex items-center justify-center h-full text-sm text-rose-400">Error al cargar el mapa: ${error.message}</div>`;
    }
}

function recargarMapaLogin3D() {
    window.__forzarRecargaMapaLogin = true;
    renderizarMapaDeLogins();
}
window.recargarMapaLogin3D = recargarMapaLogin3D;

async function navegarCalendario(delta) {
    CALENDARIO_MES += delta;
    if (CALENDARIO_MES > 12) { CALENDARIO_MES = 1; CALENDARIO_ANIO++; }
    if (CALENDARIO_MES < 1) { CALENDARIO_MES = 12; CALENDARIO_ANIO--; }
    await actualizarCalendarioAuditoria();
}

async function actualizarCalendarioAuditoria() {
    const nombresMeses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const txtMes = document.getElementById('txt-calendario-mes');
    if(txtMes) txtMes.innerText = `${nombresMeses[CALENDARIO_MES-1]} ${CALENDARIO_ANIO}`;
    
    const grid = document.getElementById('grid-calendario-audit');
    if(!grid) return;
    grid.innerHTML = '<div class="col-span-7 py-20 text-center opacity-50 animate-pulse font-mono text-xs">Sincronizando registros históricos...</div>';

    try {
        const res = await fetch(`${BACKEND_URL}/api/logs/calendario?mes=${CALENDARIO_MES}&anio=${CALENDARIO_ANIO}`, { credentials: 'include' });
        if(!res.ok) throw new Error("Fallo en respuesta");
        const data = await res.json();
        const logs = data.logs || [];

        LOGS_MES_ACTUAL = {};
        logs.forEach(l => {
            const dia = new Date(l.fechaHora).getDate();
            if (!LOGS_MES_ACTUAL[dia]) LOGS_MES_ACTUAL[dia] = [];
            LOGS_MES_ACTUAL[dia].push(l);
        });

        const primerDiaMes = new Date(CALENDARIO_ANIO, CALENDARIO_MES - 1, 1).getDay();
        const diasEnMes = new Date(CALENDARIO_ANIO, CALENDARIO_MES, 0).getDate();

        grid.innerHTML = '';
        for (let i = 0; i < primerDiaMes; i++) { grid.innerHTML += `<div class="bg-white/5 rounded-2xl opacity-10"></div>`; }

        for (let d = 1; d <= diasEnMes; d++) {
            const hoy = new Date();
            const esHoy = d === hoy.getDate() && CALENDARIO_MES === (hoy.getMonth() + 1) && CALENDARIO_ANIO === hoy.getFullYear();
            
            let logsHtml = '';
            if (LOGS_MES_ACTUAL[d]) {
                LOGS_MES_ACTUAL[d].slice(0, 4).forEach(log => {
                    const hora = new Date(log.fechaHora).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                    logsHtml += `<div class="calendario-log-item text-[7px] mb-0.5 opacity-70" title="${log.accion}">
                                    <span class="text-indigo-400 font-bold">${hora}</span> ${log.accion}
                                 </div>`;
                });
                if (LOGS_MES_ACTUAL[d].length > 4) { logsHtml += `<div class="text-[6px] opacity-30 text-right">+${LOGS_MES_ACTUAL[d].length - 4} items</div>`; }
            }

            grid.innerHTML += `
                <div onclick="verDetalleDiaCalendario(${d})" class="calendario-dia card-bg border rounded-2xl p-2 flex flex-col gap-1 transition-all hover:scale-[1.02] hover:border-indigo-500/50 ${esHoy ? 'border-indigo-500 shadow-[0_0_15px_rgba(79,70,229,0.3)]' : 'border-white/5'}">
                    <span class="text-[10px] font-black ${esHoy ? 'text-indigo-400' : 'opacity-40'}">${d}</span>
                    <div class="flex-1 overflow-hidden">
                        ${logsHtml}
                    </div>
                </div>`;
        }
    } catch (err) {
        grid.innerHTML = '<div class="col-span-7 py-20 text-center text-rose-400 text-xs">Error al conectar con la base de datos de auditoría.</div>';
    }
}

function verDetalleDiaCalendario(dia) {
    const logs = LOGS_MES_ACTUAL[dia] || [];
    const modal = document.getElementById('modal-audit-detalle');
    const lista = document.getElementById('detalle-dia-lista');
    const titulo = document.getElementById('detalle-dia-titulo');
    const fechaTxt = document.getElementById('detalle-dia-fecha');

    titulo.innerText = `Actividad del Día ${dia}`;
    fechaTxt.innerText = `${dia}/${CALENDARIO_MES}/${CALENDARIO_ANIO}`;
    
    if (logs.length === 0) {
        lista.innerHTML = '<div class="py-10 text-center opacity-30">No hubo actividad registrada este día.</div>';
    } else {
        lista.innerHTML = logs.map(l => {
            const hora = new Date(l.fechaHora).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            return `
                <div class="p-3 bg-black/20 border border-white/5 rounded-2xl flex flex-col gap-1">
                    <div class="flex justify-between items-center text-[10px]">
                        <span class="text-indigo-400 font-black">${hora}</span>
                        <span class="opacity-40 uppercase tracking-tighter">${l.usuario.split('@')[0]}</span>
                    </div>
                    <div class="text-[11px] leading-relaxed">${l.accion}</div>
                </div>`;
        }).join('');
    }
    modal.classList.remove('hidden');
}

async function generarInformePDF() {
    const btn = document.querySelector('#sec-analitica button.bg-red-600');
    const originalBtnText = btn.innerHTML;
    btn.innerHTML = 'Generando...';
    btn.disabled = true;

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        let y = 10;
        const esAdmin = String(USUARIO_ROL_ACTUAL || '').toLowerCase() === 'admin';

        const vendidosParaResumen = esAdmin ? obtenerVentasEnRangoAdmin() : obtenerDatosFiltradosParaAnalitica();
        const ivaActual = Number(document.getElementById('an-filtro-iva')?.value || 21) || 21;
        const resumen = calcularMetricasContables(vendidosParaResumen, ivaActual);

        const rangoAdminInicio = document.getElementById('admin-profit-date-start')?.value || '';
        const rangoAdminFin = document.getElementById('admin-profit-date-end')?.value || '';
        const textoRangoResumen = esAdmin && rangoAdminInicio && rangoAdminFin
            ? `${rangoAdminInicio} -> ${rangoAdminFin}`
            : 'Filtros de Analitica activos';

        doc.setFontSize(22);
        doc.text('Informe de Rendimiento - Seychelles Shop', 10, y);
        y += 10;
        doc.setFontSize(10);
        doc.text(`Fecha del Informe: ${new Date().toLocaleDateString('es-ES')}`, 10, y);
        y += 5;
        doc.text(`Rango aplicado: ${textoRangoResumen}`, 10, y);
        y += 10;

        doc.setFontSize(14);
        doc.text('Resumen Financiero', 10, y);
        y += 7;
        doc.setFontSize(10);
        doc.text(`Ventas Netas: ${resumen.ventasNetas.toFixed(2)} €`, 10, y); y += 5;
        doc.text(`Ganancia Neta: ${resumen.beneficio.toFixed(2)} €`, 10, y); y += 5;
        doc.text(`Inversion Total: ${resumen.inversion.toFixed(2)} €`, 10, y); y += 5;
        doc.text(`Comisiones estimadas: ${resumen.comisiones.toFixed(2)} €`, 10, y); y += 5;
        doc.text(`IVA estimado (${ivaActual}%): ${resumen.ivaEstimado.toFixed(2)} €`, 10, y); y += 5;
        doc.text(`ROI: ${resumen.roi.toFixed(1)}% | Ticket medio: ${resumen.ticketMedio.toFixed(2)} € | Margen medio: ${resumen.margenMedio.toFixed(1)}%`, 10, y); y += 5;
        doc.text(`Prendas vendidas: ${resumen.prendas}`, 10, y); y += 8;

        const comparativaTxt = String(document.getElementById('an-resumen-comparativa')?.innerText || '').trim();
        if (comparativaTxt) {
            doc.setFontSize(9);
            doc.text(`Comparativa: ${comparativaTxt}`, 10, y, { maxWidth: 185 });
            y += 8;
        }

        doc.setFontSize(14);
        doc.text('Productos Vendidos', 10, y);
        y += 7;
        doc.setFontSize(9);
        const vendidos = vendidosParaResumen;
        if (vendidos.length > 0) {
            const headers = [['SKU', 'Prenda', 'Categoría', 'Talla', 'Venta (€)', 'Canal', 'Fecha Venta']];
            const data = vendidos.map(v => [
                v.sku || 'N/A', v.prenda, v.categoria, v.talla,
                parseFloat(v.precioVenta || 0).toFixed(2), v.canalVenta || 'N/A', v.fechaVenta || 'N/A'
            ]);
            doc.autoTable({
                startY: y, head: headers, body: data, theme: 'grid',
                styles: { fontSize: 8, cellPadding: 1, overflow: 'linebreak' },
                headStyles: { fillColor: [20, 83, 136], textColor: [255, 255, 255] },
                alternateRowStyles: { fillColor: [240, 240, 240] }
            });
            y = doc.autoTable.previous.finalY + 10;
        } else {
            doc.text('No hay productos vendidos en el rango de filtros actual.', 10, y);
            y += 10;
        }

        doc.setFontSize(14);
        doc.text('Productos en Stock', 10, y);
        y += 7;
        doc.setFontSize(9);
        const nombresEstadosStock = LISTA_ESTADOS_KANBAN.filter(e => e.rolFinanciero === 'Stock').map(e => e.nombre);
        const enStock = BASE_DATOS.filter(v => nombresEstadosStock.includes(v.estado) &&
            (document.getElementById('an-filtro-tienda').value === 'TODOS' || v.proveedor === document.getElementById('an-filtro-tienda').value) &&
            (document.getElementById('an-filtro-canal').value === 'TODOS' || v.canalVenta === document.getElementById('an-filtro-canal').value) &&
            (document.getElementById('an-filtro-categoria').value === 'TODOS' || v.categoria === document.getElementById('an-filtro-categoria').value) &&
            (document.getElementById('an-filtro-talla').value === 'TODOS' || v.talla === document.getElementById('an-filtro-talla').value) &&
            (parseFloat(v.precioVenta || 0) >= (parseFloat(document.getElementById('an-filtro-precio-min').value) || 0)) &&
            (parseFloat(v.precioVenta || 0) <= (parseFloat(document.getElementById('an-filtro-precio-max').value) || Infinity))
        );
        if (enStock.length > 0) {
            const headers = [['SKU', 'Prenda', 'Categoría', 'Talla', 'Compra (€)', 'Venta (€)', 'Tienda', 'Fecha Alta']];
            const data = enStock.map(v => [
                v.sku || 'N/A', v.prenda, v.categoria, v.talla,
                parseFloat(v.precioCompra || 0).toFixed(2), parseFloat(v.precioVenta || 0).toFixed(2),
                v.proveedor || 'N/A', v.fecha || 'N/A'
            ]);
            doc.autoTable({
                startY: y, head: headers, body: data, theme: 'grid',
                styles: { fontSize: 8, cellPadding: 1, overflow: 'linebreak' },
                headStyles: { fillColor: [20, 83, 136], textColor: [255, 255, 255] },
                alternateRowStyles: { fillColor: [240, 240, 240] }
            });
            y = doc.autoTable.previous.finalY + 10;
        } else {
            doc.text('No hay productos en stock en el rango de filtros actual.', 10, y);
            y += 10;
        }

        doc.setFontSize(14);
        doc.text('Gráficos de Análisis', 10, y);
        y += 7;

        const addChartToPdf = (chartInstance, title, startY) => {
            if (chartInstance) {
                const imgData = chartInstance.toBase64Image();
                const imgWidth = 180;
                const imgHeight = (chartInstance.canvas.height * imgWidth) / chartInstance.canvas.width;

                if (startY + imgHeight > doc.internal.pageSize.height - 20) {
                    doc.addPage();
                    startY = 20;
                }
                doc.setFontSize(12);
                doc.text(title, 10, startY);
                doc.addImage(imgData, 'PNG', 10, startY + 5, imgWidth, imgHeight);
                return startY + imgHeight + 15;
            }
            return startY;
        };

        y = addChartToPdf(INSTANCIA_CHARTS, 'Curva de Rendimiento Diario', y);
        y = addChartToPdf(INSTANCIA_TARTA, 'Distribución de Ventas por Categoría', y);
        y = addChartToPdf(INSTANCIA_BARRAS, 'Facturación por Proveedor/Tienda', y);
        y = addChartToPdf(INSTANCIA_MAPA_CALOR, 'Mapa de Calor: Densidad Horaria de Operaciones', y);

        doc.save(`Informe_Seychelles_${new Date().toISOString().split('T')[0]}.pdf`);
        cantarPorVoz("Informe PDF generado.");

    } catch (error) {
        console.error("Error al generar PDF:", error);
        alert("Error al generar el informe PDF: " + error.message);
    } finally {
        if (btn) { btn.innerHTML = originalBtnText; btn.disabled = false; }
    }
}

async function generarInformeContablePDF() {
    const btn = Array.from(document.querySelectorAll('#sec-analitica button')).find((b) => String(b.textContent || '').includes('PDF Contable'));
    const txtOriginal = btn ? btn.innerHTML : '';
    if (btn) {
        btn.innerHTML = 'Generando...';
        btn.disabled = true;
    }

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        const datos = obtenerDatosFiltradosParaAnalitica();
        const iva = Number(document.getElementById('an-filtro-iva')?.value || 21) || 21;
        const resumen = calcularMetricasContables(datos, iva);

        const inicio = String(document.getElementById('an-filtro-fecha-inicio')?.value || '').trim() || '-';
        const fin = String(document.getElementById('an-filtro-fecha-fin')?.value || '').trim() || '-';

        doc.setFontSize(19);
        doc.text('Informe Contable Seychelles', 10, 14);
        doc.setFontSize(10);
        doc.text(`Generado: ${new Date().toLocaleString('es-ES')}`, 10, 20);
        doc.text(`Periodo: ${inicio} -> ${fin}`, 10, 25);

        doc.autoTable({
            startY: 30,
            head: [['KPI', 'Valor']],
            body: [
                ['Ventas netas', `${resumen.ventasNetas.toFixed(2)} EUR`],
                ['Base imponible estimada', `${resumen.baseImponible.toFixed(2)} EUR`],
                [`IVA estimado (${iva}%)`, `${resumen.ivaEstimado.toFixed(2)} EUR`],
                ['Comisiones estimadas', `${resumen.comisiones.toFixed(2)} EUR`],
                ['Inversion total', `${resumen.inversion.toFixed(2)} EUR`],
                ['Beneficio neto', `${resumen.beneficio.toFixed(2)} EUR`],
                ['ROI', `${resumen.roi.toFixed(1)}%`],
                ['Margen medio', `${resumen.margenMedio.toFixed(1)}%`],
                ['Ticket medio', `${resumen.ticketMedio.toFixed(2)} EUR`],
                ['Prendas vendidas', `${resumen.prendas}`]
            ],
            theme: 'grid',
            styles: { fontSize: 9, cellPadding: 2 },
            headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255] }
        });

        const porCanal = {};
        const porMes = {};
        const topProductos = {};

        datos.forEach((v) => {
            const qty = Number(v.cantidad || 1) || 1;
            const pv = Number(v.precioVenta || 0) || 0;
            const canal = String(v.canalVenta || 'Sin canal');
            const fecha = String(v.fechaVenta || '').slice(0, 7) || 'Sin fecha';
            const keyProducto = String(v.prenda || 'Producto').trim();

            porCanal[canal] = (porCanal[canal] || 0) + (pv * qty);
            porMes[fecha] = (porMes[fecha] || 0) + (pv * qty);
            topProductos[keyProducto] = (topProductos[keyProducto] || 0) + (pv * qty);
        });

        let y = doc.lastAutoTable.finalY + 8;

        const canalesRows = Object.entries(porCanal)
            .sort((a, b) => b[1] - a[1])
            .map(([canal, total]) => [canal, `${Number(total).toFixed(2)} EUR`]);
        doc.autoTable({
            startY: y,
            head: [['Canal', 'Ventas']],
            body: canalesRows.length ? canalesRows : [['Sin datos', '0.00 EUR']],
            theme: 'striped',
            styles: { fontSize: 8.5, cellPadding: 2 },
            headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255] }
        });

        y = doc.lastAutoTable.finalY + 6;
        const mesRows = Object.entries(porMes)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([mes, total]) => [mes, `${Number(total).toFixed(2)} EUR`]);
        doc.autoTable({
            startY: y,
            head: [['Mes', 'Ventas']],
            body: mesRows.length ? mesRows : [['Sin datos', '0.00 EUR']],
            theme: 'striped',
            styles: { fontSize: 8.5, cellPadding: 2 },
            headStyles: { fillColor: [124, 58, 237], textColor: [255, 255, 255] }
        });

        y = doc.lastAutoTable.finalY + 6;
        const topRows = Object.entries(topProductos)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([prenda, total]) => [prenda, `${Number(total).toFixed(2)} EUR`]);
        doc.autoTable({
            startY: y,
            head: [['Top producto', 'Ventas']],
            body: topRows.length ? topRows : [['Sin datos', '0.00 EUR']],
            theme: 'grid',
            styles: { fontSize: 8, cellPadding: 1.8 },
            headStyles: { fillColor: [245, 158, 11], textColor: [255, 255, 255] }
        });

        doc.save(`Informe_Contable_Seychelles_${new Date().toISOString().slice(0, 10)}.pdf`);
        cantarPorVoz('Informe contable generado.');
    } catch (e) {
        console.error('Error generando PDF contable:', e);
        alert(`No se pudo generar el PDF contable: ${e.message}`);
    } finally {
        if (btn) {
            btn.innerHTML = txtOriginal;
            btn.disabled = false;
        }
    }
}
window.generarInformeContablePDF = generarInformeContablePDF;

function obtenerDatosFiltradosParaAnalitica() {
    const override = arguments[0] && typeof arguments[0] === 'object' ? arguments[0] : {};
    const fTienda = document.getElementById('an-filtro-tienda').value;
    const fCanal = document.getElementById('an-filtro-canal').value;
    const fCat = document.getElementById('an-filtro-categoria').value;
    const fTalla = document.getElementById('an-filtro-talla').value;
    const fEstado = document.getElementById('an-filtro-estado')?.value || 'TODOS';
    const fMin = parseFloat(document.getElementById('an-filtro-precio-min').value) || 0;
    const fMax = parseFloat(document.getElementById('an-filtro-precio-max').value) || Infinity;
    const fInicio = String(override.overrideStart || document.getElementById('an-filtro-fecha-inicio')?.value || '').trim();
    const fFin = String(override.overrideEnd || document.getElementById('an-filtro-fecha-fin')?.value || '').trim();

    return BASE_DATOS.filter(v => {
        const eConfig = LISTA_ESTADOS_KANBAN.find(e => e.nombre === v.estado);
        if (!eConfig || eConfig.rolFinanciero !== 'Venta') return false;
        if (fEstado !== 'TODOS' && v.estado !== fEstado) return false;
        if (fTienda !== 'TODOS' && v.proveedor !== fTienda) return false;
        if (fCanal !== 'TODOS' && v.canalVenta !== fCanal) return false;
        if (fCat !== 'TODOS' && v.categoria !== fCat) return false;
        if (fTalla !== 'TODOS' && v.talla !== fTalla) return false;

        const fechaVenta = String(v.fechaVenta || '').slice(0, 10);
        if (fInicio && (!fechaVenta || fechaVenta < fInicio)) return false;
        if (fFin && (!fechaVenta || fechaVenta > fFin)) return false;
        
        const precio = parseFloat(v.precioVenta || 0);
        if (precio < fMin || precio > fMax) return false;
        return true;
    });
}

function limpiarFiltrosAnalitica() {
    document.getElementById('an-filtro-periodo').value = 'todo';
    document.getElementById('an-filtro-fecha-inicio').value = '';
    document.getElementById('an-filtro-fecha-fin').value = '';
    document.getElementById('an-filtro-fecha-inicio').disabled = true;
    document.getElementById('an-filtro-fecha-fin').disabled = true;
    document.getElementById('an-filtro-estado').value = 'TODOS';
    document.getElementById('an-filtro-tienda').value = 'TODOS';
    document.getElementById('an-filtro-canal').value = 'TODOS';
    document.getElementById('an-filtro-categoria').value = 'TODOS';
    document.getElementById('an-filtro-talla').value = 'TODOS';
    document.getElementById('an-filtro-precio-min').value = '';
    document.getElementById('an-filtro-precio-max').value = '';
    document.getElementById('an-filtro-iva').value = '21';
    document.getElementById('an-filtro-comparativa').value = 'ninguna';
    actualizarTodoElBloqueGrafico();
}

window.allowDrop = function(e) {
    e.preventDefault();
    const col = e.currentTarget;
    if (col && !col.classList.contains('drag-over')) col.classList.add('drag-over');
};
window.clearDrop = function(e) {
    const col = e.currentTarget;
    if (col) col.classList.remove('drag-over');
};

document.addEventListener('dragend', () => {
    limpiarEstadoVisualDrag();
});

window.handleDragStart = function(e, id) { 
    if (esRolVisualizador()) {
        e.preventDefault();
        return;
    }
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData("text/plain", id);
    if (ITEMS_SELECCIONADOS_MASIVOS.includes(id)) {
        e.dataTransfer.setData("text/lote-items", JSON.stringify(ITEMS_SELECCIONADOS_MASIVOS));
    } else { e.dataTransfer.setData("text/lote-items", JSON.stringify([id])); }
    e.dataTransfer.setData('text/drag-kind', 'kanban-producto');
    const producto = (BASE_DATOS || []).find((x) => x._id === id);
    const totalItems = ITEMS_SELECCIONADOS_MASIVOS.includes(id) ? ITEMS_SELECCIONADOS_MASIVOS.length : 1;
    const subtitulo = totalItems > 1 ? `${totalItems} fichas seleccionadas` : `${producto?.categoria || 'Producto'} · ${producto?.talla || '-'}`;
    crearDragPreviewMinimizado(e, producto?.prenda || 'Producto', subtitulo);
    const card = document.getElementById(id);
    if(card) { setTimeout(() => { if (ITEMS_SELECCIONADOS_MASIVOS.includes(id)) { ITEMS_SELECCIONADOS_MASIVOS.forEach(xId => { const cNode = document.getElementById(xId); if(cNode) cNode.classList.add('dragging'); }); } else { card.classList.add('dragging'); } }, 0); }
};

window.handleDropColumn = async function(e, newState) {
    if (esRolVisualizador()) {
        e.preventDefault();
        window.clearDrop(e);
        alert('No tienes permisos para mover productos.');
        return;
    }
    e.preventDefault(); window.clearDrop(e); limpiarEstadoVisualDrag();
    const dragKind = e.dataTransfer.getData('text/drag-kind');
    if (dragKind && dragKind !== 'kanban-producto') return;
    const loteRaw = e.dataTransfer.getData("text/lote-items");
    const idSimple = e.dataTransfer.getData("text/plain");
    if (!loteRaw && !idSimple) return;

    let listaIds = [];
    try {
        listaIds = loteRaw ? JSON.parse(loteRaw) : [];
    } catch (_) {
        listaIds = [];
    }
    if (!Array.isArray(listaIds) || listaIds.length === 0) {
        if (idSimple) listaIds = [idSimple];
    }
    if (!Array.isArray(listaIds) || listaIds.length === 0) return;
    
    const estadoDestino = LISTA_ESTADOS_KANBAN.find(est => est.nombre === newState);

    if (estadoDestino && estadoDestino.rolFinanciero === 'Venta') {
        tocarSonidoCajaRegistradora();
        lanzarConfetiVenta();
        procesarMultiplicadorCombo();
        abrirModalPostVenta(listaIds, newState);
        return;
    }
    
    const copiasEstadosAnteriores = {};
    listaIds.forEach(id => { 
        const idx = BASE_DATOS.findIndex(x => x._id === id); 
        if (idx !== -1) { 
            copiasEstadosAnteriores[id] = BASE_DATOS[idx].estado; 
            BASE_DATOS[idx].estado = newState; 
        } 
    });
    renderKanban();
    if (e.currentTarget?.classList) {
        e.currentTarget.classList.add('drop-highlight');
        setTimeout(() => e.currentTarget?.classList.remove('drop-highlight'), 420);
    }

    cantarPorVoz(`Columna actualizada`);
    procesarMultiplicadorCombo();

    try {
        const promesas = listaIds.map(id => fetch(`${BACKEND_URL}/api/ventas/${id}/estado`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ estado: newState }) }));
        await Promise.all(promesas); limpiarSeleccionMasiva(); await forceRefreshDataManual();
    } catch(err) {
        listaIds.forEach(id => { const idx = BASE_DATOS.findIndex(x => x._id === id); if (idx !== -1) BASE_DATOS[idx].estado = copiasEstadosAnteriores[id]; });
        forceRefreshDataManual(); alert("Fallo de red.");
    }
};

function cambiarOrdenColumna(estado, criterio) {
    CONFIG_ORDEN_COLUMNAS[estado] = criterio;
    renderKanban(true);
}

function cambiarFiltroColumna(estado, query) {
    CONFIG_FILTRO_COLUMNAS[estado] = query.toLowerCase();
    renderKanban(true);
}

async function ejecutarAjustePrecioMasivo() {
    if (ITEMS_SELECCIONADOS_MASIVOS.length === 0) return;
    const variacion = prompt("Indica cuánto quieres sumar o restar al precio de venta (ej: 5 para subir 5€, -5 para bajar 5€):");
    const valorAjuste = parseFloat(variacion);
    if (isNaN(valorAjuste)) return;

    if (confirm(`Se va a modificar el precio de ${ITEMS_SELECCIONADOS_MASIVOS.length} artículos en ${valorAjuste}€. ¿Continuar?`)) {
        const promesas = ITEMS_SELECCIONADOS_MASIVOS.map(id => {
            const item = BASE_DATOS.find(v => v._id === id);
            if (!item) return Promise.resolve();
            const nuevoPrecio = Math.max(0, (parseFloat(item.precioVenta) || 0) + valorAjuste);
            return fetch(`${BACKEND_URL}/api/ventas/${id}`, { 
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', 
                body: JSON.stringify({ ...item, precioVenta: nuevoPrecio, proveedor: item.proveedor }) 
            });
        });
        await Promise.all(promesas); cantarPorVoz("Precios actualizados."); limpiarSeleccionMasiva(); await forceRefreshDataManual();
    }
}

async function ejecutarAjusteCosteMasivo() {
    if (ITEMS_SELECCIONADOS_MASIVOS.length === 0) return;
    const variacion = prompt("Indica cuánto quieres sumar o restar al precio de COMPRA (ej: 1 para subir 1€, -1 para bajar 1€):");
    const valorAjuste = parseFloat(variacion);
    if (isNaN(valorAjuste)) return;

    if (confirm(`Se va a modificar el coste de ${ITEMS_SELECCIONADOS_MASIVOS.length} artículos en ${valorAjuste}€. ¿Continuar?`)) {
        const promesas = ITEMS_SELECCIONADOS_MASIVOS.map(id => {
            const item = BASE_DATOS.find(v => v._id === id);
            if (!item) return Promise.resolve();
            const nuevoCoste = Math.max(0, (parseFloat(item.precioCompra) || 0) + valorAjuste);
            return fetch(`${BACKEND_URL}/api/ventas/${id}`, { 
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', 
                body: JSON.stringify({ ...item, precioCompra: nuevoCoste, proveedor: item.proveedor }) 
            });
        });
        await Promise.all(promesas); cantarPorVoz("Costes actualizados."); limpiarSeleccionMasiva(); await forceRefreshDataManual();
    }
}

function toggleMuteVolumenGlobal() {
    SOUND_MUTED_GLOBAL = !SOUND_MUTED_GLOBAL;
    const btn = document.getElementById('btn-mute-volumen'); const txt = document.getElementById('txt-mute-volumen');
    if (SOUND_MUTED_GLOBAL) {
        btn.className = "bg-rose-600/20 text-rose-400 border border-rose-500/30 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1 shadow-md"; txt.innerText = "Muteado";
    } else {
        btn.className = "bg-slate-800 border border-current/10 hover:bg-slate-700 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1 shadow-md"; txt.innerText = "Sonido"; cantarPorVoz("Sonido activo");
    }
}

async function forceRefreshDataManual() { 
    const now = Date.now();
    if (FORCE_REFRESH_PROMISE) return FORCE_REFRESH_PROMISE;
    if ((now - LAST_FORCE_REFRESH_AT) < 900) return;

    const icono = document.getElementById('icon-refresh');
    if (icono) {
        icono.classList.remove('animate-spin-once');
        void icono.offsetWidth;
        icono.classList.add('animate-spin-once');
    }
    LAST_FORCE_REFRESH_AT = now;
    cantarPorVoz("Sincronizando.");
    FORCE_REFRESH_PROMISE = reloadCoreData(true).finally(() => {
        FORCE_REFRESH_PROMISE = null;
    });
    await FORCE_REFRESH_PROMISE;
}

function calcularMargenComercialAlVuelo() {
    const compra = parseFloat(document.getElementById('precioCompra').value) || 0;
    const venta = parseFloat(document.getElementById('precioVenta').value) || 0;
    const indicator = document.getElementById('txt-margen-calculado');
    if (compra <= 0 || venta <= 0) { indicator.innerText = "0.00%"; indicator.className = "font-bold text-slate-400"; return; }
    const porcentaje = ((venta - compra) / venta) * 100; indicator.innerText = `${porcentaje.toFixed(2)}%`;
    if (porcentaje <= 0) indicator.className = "font-bold text-rose-500 animate-pulse";
    else if (porcentaje < 30) indicator.className = "font-bold text-amber-500";
    else indicator.className = "font-bold text-emerald-400";
}

function aplicarFiltrosFrontLineal() {
    renderKanban(true);
}

function limpiarFiltrosAvanzados() {
    document.getElementById('filtro-categoria').value = 'TODOS';
    document.getElementById('filtro-talla').value = 'TODOS';
    document.getElementById('filtro-canal').value = 'TODOS';
    const fTienda = document.getElementById('filtro-tienda');
    if (fTienda) fTienda.value = 'TODOS';
    aplicarFiltrosFrontLineal();
}

function setTheme(theme) {
    const body = document.getElementById('main-body');
    if (!body) return;

    // Lista de todas las clases de tema posibles
    const themeClasses = ['theme-dark', 'theme-light', 'theme-pink', 'theme-emerald', 'theme-purple', 'theme-premium'];
    // Elimina cualquier clase de tema anterior para evitar conflictos
    body.classList.remove(...themeClasses);

    // Añade solo la nueva clase de tema, conservando las demás
    body.classList.add(`theme-${theme}`);

    localStorage.setItem('seychelles-theme-multi', theme);
    actualizarEstadoBotonesTema(theme);
    closeQuickMenus();
    if(BASE_DATOS.length > 0) { actualizarTodoElBloqueGrafico(); }
}

function exportarExcel() {
    if (BASE_DATOS.length === 0) return alert("Sin datos.");
    const formateado = BASE_DATOS.map(v => ({
        Fecha: v.fecha,
        SKU: v.sku || 'N/A',
        Articulo: v.prenda,
        Categoria: v.categoria,
        Talla: v.talla,
        'Coste EUR': parseFloat(v.precioCompra || 0).toFixed(2),
        'Venta EUR': parseFloat(v.precioVenta || 0).toFixed(2),
        'Envio EUR': parseFloat(v.gastosEnvio || 0).toFixed(2),
        Canal: v.canalVenta || 'Vinted',
        Comentarios: v.comentariosProducto || '',
        Rating: v.rating || 0,
        TiendaOrigen: v.proveedor || 'Sin definir',
        Estado: v.estado
    }));
    const ws = XLSX.utils.json_to_sheet(formateado); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventario"); XLSX.writeFile(wb, `Seychelles_Core_${new Date().toISOString().split('T')[0]}.xlsx`);
}

function setFormRating(estrellasSeleccionadas) {
    document.getElementById('rating').value = estrellasSeleccionadas;
    for (let i = 1; i <= 5; i++) {
        const starElement = document.getElementById(`star-${i}`);
        if (starElement) {
            if (i <= estrellasSeleccionadas) { starElement.innerText = "★"; starElement.className = "star-rating-btn text-amber-400 font-bold"; }
            else { starElement.innerText = "☆"; starElement.className = "star-rating-btn text-slate-500"; }
        }
    }
}

function autocompletarNombreLocalRapido() {
    const cat = document.getElementById('categoria').value; const talla = document.getElementById('talla').value;
    const singular = cat.endsWith('s') ? cat.slice(0, -1) : cat;
    document.getElementById('prenda').value = `Nueva ${singular} - Talla ${talla}`; cantarPorVoz("Asignado.");
}

function descargarBackupSeguridadLocal() {
    if (BASE_DATOS.length === 0) return alert("Sin datos.");
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(BASE_DATOS, null, 2));
    const downloadAnchor = document.createElement('a'); downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `Backup_Seychelles_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor); downloadAnchor.click(); downloadAnchor.remove();
}

function importarBackupJSON(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const json = JSON.parse(e.target.result);
            if (confirm(`¿Importar ${json.length} productos del backup? Esto añadirá los productos a tu base de datos actual.`)) {
                const res = await fetch(`${BACKEND_URL}/api/ventas/bulk`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                    body: JSON.stringify({ productos: json })
                });
                if (res.ok) { cantarPorVoz("Importación completa."); await forceRefreshDataManual(); }
                else alert("Error al importar.");
            }
        } catch (err) { alert("Archivo JSON no válido."); }
    };
    reader.readAsText(file);
}

function cantarPorVoz(mensajeTexto) {
    if (!SOUND_MUTED_GLOBAL && 'speechSynthesis' in window) { 
        window.speechSynthesis.cancel(); 
        const frase = new SpeechSynthesisUtterance(mensajeTexto); 
        frase.lang = 'es-ES'; 
        
        const voces = window.speechSynthesis.getVoices();
        const vozNatural = voces.find(v => v.name.includes('Google español') || v.name.includes('Microsoft Sabina') || v.name.includes('Monica') || v.name.includes('Paulina')) || voces.find(v => v.lang.startsWith('es'));
        if (vozNatural) frase.voice = vozNatural;
        
        frase.pitch = 1.15;
        frase.rate = 1.05;
        window.speechSynthesis.speak(frase); 
    }
}

function tocarSonidoCajaRegistradora() {
    if (SOUND_MUTED_GLOBAL) return;
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContext();
        const playCoin = (fStart, fEnd, time) => {
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(fStart, time);
            osc.frequency.exponentialRampToValueAtTime(fEnd, time + 0.1);
            gain.gain.setValueAtTime(0, time);
            gain.gain.linearRampToValueAtTime(0.5, time + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(time); osc.stop(time + 0.3);
        };
        playCoin(2000, 8000, ctx.currentTime);
        playCoin(3000, 9000, ctx.currentTime + 0.1);
    } catch(e) {}
}

function reproducirSonidoMensaje(tipo = 'send') {
    if (SOUND_MUTED_GLOBAL) return;
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';

        if (tipo === 'receive') {
            osc.frequency.setValueAtTime(780, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1040, ctx.currentTime + 0.12);
        } else {
            osc.frequency.setValueAtTime(920, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(680, ctx.currentTime + 0.1);
        }

        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.11, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.17);
    } catch (_) {}
}

function lanzarConfetiVenta() {
    if (typeof confetti === 'function') {
        confetti({
            particleCount: 150,
            spread: 80,
            origin: { y: 0.6 },
            colors: ['#10b981', '#3b82f6', '#fbbf24', '#f472b6', '#a855f7'],
            zIndex: 9999
        });
    }
}

function procesarMultiplicadorCombo() {
    const tAhora = Date.now(); HISTORIAL_TIMESTAMPS_OPERACIONES = HISTORIAL_TIMESTAMPS_OPERACIONES.filter(t => (tAhora - t) < 180000); HISTORIAL_TIMESTAMPS_OPERACIONES.push(tAhora);
    const totalCombos = HISTORIAL_TIMESTAMPS_OPERACIONES.length; const bBadge = document.getElementById('combo-badge'); const bCards = document.querySelectorAll('#kpi-container-grid > div');
    if (totalCombos >= 3) {
        const cc = document.getElementById('combo-count'); if(cc) cc.innerText = totalCombos;
        if(bBadge) bBadge.classList.remove('hidden'); bCards.forEach(card => card.classList.add('combo-fire-active'));
    } else { if(bBadge) bBadge.classList.add('hidden'); bCards.forEach(card => card.classList.remove('combo-fire-active')); }
}

function ejecutarVerificacionAlertasStock() {
    const resumenContador = {}; BASE_DATOS.filter(v => { const e = LISTA_ESTADOS_KANBAN.find(x => x.nombre === v.estado); return e && e.rolFinanciero === 'Stock'; }).forEach(v => { resumenContador[v.categoria] = (resumenContador[v.categoria] || 0) + (parseInt(v.cantidad) || 1); });
    const categoriesCriticas = Object.keys(resumenContador).filter(cat => resumenContador[cat] < 2);
    const footerBar = document.getElementById('ticker-bar'); const footerBadge = document.getElementById('ticker-header-badge');
    if (categoriesCriticas.length > 0 && footerBar && footerBadge) { footerBar.classList.add('ticker-alert-mode'); footerBadge.innerText = `🚨 ALERTA RESERVAS: ${categoriesCriticas.join(' / ').toUpperCase()}`; }
    else if (footerBar && footerBadge) { footerBar.classList.remove('ticker-alert-mode'); footerBadge.className = "bg-rose-600 text-white px-4 h-full flex items-center font-black tracking-wider select-none"; footerBadge.innerText = "WALL•ST•SEYCHELLES"; }
}

async function actualizarUsoBaseDatos() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/system/db-stats`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        
        const container = document.getElementById('db-storage-container');
        const bar = document.getElementById('db-storage-bar');
        const text = document.getElementById('db-storage-text');
        
        if (container && bar && text) {
            container.classList.remove('hidden'); container.classList.add('flex');
            bar.style.width = `${data.percentage}%`; text.innerText = `${data.percentage}%`;
            
            bar.classList.remove('bg-emerald-400', 'bg-amber-400', 'bg-rose-500');
            text.classList.remove('text-emerald-400', 'text-amber-400', 'text-rose-500', 'animate-pulse');

            if (data.percentage > 85) {
                bar.classList.add('bg-rose-500');
                text.classList.add('text-rose-500', 'animate-pulse');
            } else if (data.percentage > 60) {
                bar.classList.add('bg-amber-400'); text.classList.add('text-amber-400');
            } else {
                bar.classList.add('bg-emerald-400'); text.classList.add('text-emerald-400');
            }
        }
    } catch (e) { console.warn("No se pudo obtener estadísticas de la BD", e); }
}

function lanzarModalImpresionEtiqueta(idElemento) {
    const v = BASE_DATOS.find(item => item._id === idElemento); if(!v) return;
    document.getElementById('print-prenda').innerText = v.prenda; document.getElementById('print-sku').innerText = v.sku ? `SKU: ${v.sku}` : 'GENERAL';
    document.getElementById('print-precio').innerText = `${parseFloat(v.precioVenta || 0).toFixed(2)} €`; document.getElementById('canvas-generador-qr').innerText = v.sku || v._id;
    document.getElementById('modal-qr').classList.remove('hidden');
}

async function duplicarPrendaIndividual(idItem) {
    const original = BASE_DATOS.find(v => v._id === idItem); if (!original) return;
    try {
        await fetch(`${BACKEND_URL}/api/ventas`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({
                sku: original.sku ? `${original.sku}-CLON` : '', prenda: `${original.prenda} (Copia)`,
                categoria: original.categoria, talla: original.talla, cantidad: original.cantidad || 1,
                precioCompra: original.precioCompra || 0, precioVenta: original.precioVenta || 0,
                gastosEnvio: original.gastosEnvio || 0, canalVenta: original.canalVenta || 'Vinted', rating: original.rating || 0, estado: 'No Vendido',
                comentariosProducto: original.comentariosProducto || '', proveedor: original.proveedor || 'Sin definir',
                imagen: original.imagen || ''
            })
        });
        cantarPorVoz("Duplicado."); await forceRefreshDataManual();
    } catch(e) {}
}

async function ejecutarDuplicadoMasivo() {
    if (ITEMS_SELECCIONADOS_MASIVOS.length === 0) return;
    const promesas = ITEMS_SELECCIONADOS_MASIVOS.map(id => {
        const original = BASE_DATOS.find(v => v._id === id); if (!original) return Promise.resolve();
        return fetch(`${BACKEND_URL}/api/ventas`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({
                sku: original.sku ? `${original.sku}-CLON` : '', prenda: `${original.prenda} (Copia)`,
                categoria: original.categoria, talla: original.talla, cantidad: original.cantidad || 1,
                precioCompra: original.precioCompra || 0, precioVenta: original.precioVenta || 0,
                gastosEnvio: original.gastosEnvio || 0, canalVenta: original.canalVenta || 'Vinted', rating: original.rating || 0, estado: 'No Vendido',
                comentariosProducto: original.comentariosProducto || '', proveedor: original.proveedor || 'Sin definir',
                imagen: original.imagen || ''
            })
        });
    });
    await Promise.all(promesas); limpiarSeleccionMasiva(); await forceRefreshDataManual();
}

function manejarSeleccionCheckMasiva(idItem, casillaElemento) {
    if (casillaElemento.checked) { if(!ITEMS_SELECCIONADOS_MASIVOS.includes(idItem)) ITEMS_SELECCIONADOS_MASIVOS.push(idItem); }
    else { ITEMS_SELECCIONADOS_MASIVOS = ITEMS_SELECCIONADOS_MASIVOS.filter(id => id !== idItem); }
    actualizarVisibilidadPanelMasivo();
}

function alternarSeleccionColumna(estadoColumna) {
    const filtrados = BASE_DATOS.filter(v => v.estado === estadoColumna); const todosMarcadosYa = filtrados.every(v => ITEMS_SELECCIONADOS_MASIVOS.includes(v._id));
    filtrados.forEach(v => {
        const docCheck = document.getElementById(`check-${v._id}`);
        if (todosMarcadosYa) { ITEMS_SELECCIONADOS_MASIVOS = ITEMS_SELECCIONADOS_MASIVOS.filter(id => id !== v._id); if(docCheck) docCheck.checked = false; }
        else { if(!ITEMS_SELECCIONADOS_MASIVOS.includes(v._id)) ITEMS_SELECCIONADOS_MASIVOS.push(v._id); if(docCheck) docCheck.checked = true; }
    });
    actualizarVisibilidadPanelMasivo();
}

function actualizarVisibilidadPanelMasivo() {
    const panel = document.getElementById('panel-masivo-flotante'); const contador = document.getElementById('contador-masivo-seleccionado');
    if(contador) contador.innerText = ITEMS_SELECCIONADOS_MASIVOS.length;
    if (ITEMS_SELECCIONADOS_MASIVOS.length > 0 && panel) panel.classList.remove('hidden'); else if(panel) panel.classList.add('hidden');
}

function limpiarSeleccionMasiva() { ITEMS_SELECCIONADOS_MASIVOS = []; document.querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = false); actualizarVisibilidadPanelMasivo(); }

async function ejecutarAccionMasivaEstado(nuevoEstado) {
    if (ITEMS_SELECCIONADOS_MASIVOS.length === 0) return;

    const estadoDestino = LISTA_ESTADOS_KANBAN.find(est => est.nombre === nuevoEstado);
    const esVenta = estadoDestino && estadoDestino.rolFinanciero === 'Venta';

    if (esVenta) {
        abrirModalPostVenta(ITEMS_SELECCIONADOS_MASIVOS, nuevoEstado);
        return;
    }

    const promesas = ITEMS_SELECCIONADOS_MASIVOS.map(id => {
        const bodyPayload = { estado: nuevoEstado };
        if (esVenta) {
            bodyPayload.fechaVenta = new Date().toISOString().split('T')[0];
        }
        return fetch(`${BACKEND_URL}/api/ventas/${id}/estado`, { 
            method: 'PUT', 
            headers: { 'Content-Type': 'application/json' }, 
            credentials: 'include', 
            body: JSON.stringify(bodyPayload) 
        });
    });

    await Promise.all(promesas); 
    
    if (esVenta) { 
        tocarSonidoCajaRegistradora(); 
        lanzarConfetiVenta(); 
        cantarPorVoz("Lote Vendido"); 
    }
    
    limpiarSeleccionMasiva(); await forceRefreshDataManual();
}

async function ejecutarEdicionMasivaPropiedad(campo, valor) {
    if (ITEMS_SELECCIONADOS_MASIVOS.length === 0 || !valor) return;
    const promesas = ITEMS_SELECCIONADOS_MASIVOS.map(id => {
        const itemOriginal = BASE_DATOS.find(v => v._id === id); if (!itemOriginal) return Promise.resolve();
        const payload = { ...itemOriginal };
        payload[campo] = valor; 
        return fetch(`${BACKEND_URL}/api/ventas/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ ...payload, proveedor: itemOriginal.proveedor }) });
    });
    await Promise.all(promesas); limpiarSeleccionMasiva(); await forceRefreshDataManual();
}

async function ejecutarEliminacionMasiva() {
    if (ITEMS_SELECCIONADOS_MASIVOS.length === 0) return;
    if (confirm("¿Borrar permanentemente el lote seleccionado?")) {
        const promesas = ITEMS_SELECCIONADOS_MASIVOS.map(id => fetch(`${BACKEND_URL}/api/ventas/${id}`, { method: 'DELETE', credentials: 'include' }));
        await Promise.all(promesas); limpiarSeleccionMasiva(); await forceRefreshDataManual();
    }
}

function filtrarProductosMenu(valorQuery) {
    const dropdown = document.getElementById('dropdown-buscador'); const query = valorQuery.toLowerCase().trim();
    if (!query && dropdown) { dropdown.innerHTML = ''; dropdown.classList.add('hidden'); return; }
    const coincidencias = BASE_DATOS.filter(v => v.prenda.toLowerCase().includes(query) || (v.sku && v.sku.toLowerCase().includes(query)));
    if (coincidencias.length === 0 && dropdown) { dropdown.innerHTML = `<div class="p-2 opacity-50 italic text-[10px]">Sin resultados.</div>`; dropdown.classList.remove('hidden'); return; }
    let htmlItems = '';
    const nombresEstadosVenta = LISTA_ESTADOS_KANBAN.filter(e => e.rolFinanciero === 'Venta').map(e => e.nombre);
    const nombresEstadosStock = LISTA_ESTADOS_KANBAN.filter(e => e.rolFinanciero === 'Stock').map(e => e.nombre);
    
    coincidencias.slice(0, 8).forEach(item => {
        const esVendido = nombresEstadosVenta.includes(item.estado); 
        const badgeEstado = esVendido ? `<span class="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1 py-0.5 rounded text-[8px] font-bold">💰 VENDIDO</span>` : `<span class="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1 py-0.5 rounded text-[8px] font-bold">📦 STOCK</span>`;
        htmlItems += `
            <div class="dropdown-item-hover p-2 rounded-xl flex justify-between items-center gap-2 cursor-pointer transition-all border-b border-current/5 last:border-b-0">
                <div class="min-w-0 flex-1">
                    <p class="font-bold uppercase truncate text-[11px] text-current">${item.prenda} <span class="opacity-60 font-mono text-[9px]">(${item.talla})</span></p>
                    <p class="text-[9px] font-mono opacity-40 truncate">${item.sku ? `🆔 ${item.sku}` : 'Sin SKU'} • ${parseFloat(item.precioVenta || 0).toFixed(2)}€</p>
                </div>
                <div class="flex items-center gap-1.5 flex-shrink-0">
                    ${badgeEstado}
                    <div class="flex gap-1">
                        <button onclick="ejecutarAccionDesplegable('${item._id}', '${esVendido ? (nombresEstadosStock[0] || 'No Vendido') : (nombresEstadosVenta[0] || 'Vendido')}')" class="bg-blue-600 text-white font-bold text-[9px] px-2 py-0.5 rounded shadow-sm">${esVendido ? 'A Stock' : 'Vender'}</button>
                        <button onclick="editItem('${item._id}'); document.getElementById('dropdown-buscador').classList.add('hidden');" class="bg-current/10 hover:bg-current/20 px-1.5 py-0.5 rounded text-[9px]">✏️</button>
                    </div>
                </div>
            </div>`;
    });
    if(dropdown) { dropdown.innerHTML = htmlItems; dropdown.classList.remove('hidden'); }
}

async function ejecutarAccionDesplegable(id, nuevoEstado) {
    const dbb = document.getElementById('dropdown-buscador'); if(dbb) dbb.classList.add('hidden');
    const ip = document.getElementById('input-pistola'); if(ip) ip.value = '';

    const eConfig = LISTA_ESTADOS_KANBAN.find(est => est.nombre === nuevoEstado);
    if (eConfig && eConfig.rolFinanciero === 'Venta') {
        abrirModalPostVenta([id], nuevoEstado, {
            comentarioSugerido: 'Venta registrada desde acción rápida.',
            canalSugerido: 'Vinted'
        });
        return;
    }

    try {
        const r = await fetch(`${BACKEND_URL}/api/ventas/${id}/estado`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ estado: nuevoEstado }) });
        if(r.ok) { 
            procesarMultiplicadorCombo(); await forceRefreshDataManual(); 
        }
    } catch (err) {}
}

document.getElementById('form-escaner-pistola').onsubmit = async (e) => {
    e.preventDefault();
    const ip = document.getElementById('input-pistola');
    const skuInput = normalizarCodigoEscaneado(ip ? ip.value.trim() : '');
    if (!skuInput) return;
    await ejecutarLogicaEscaneo(skuInput);
    if (ip) ip.value = '';
};

function actualizarEstadoEscaner(texto, color = 'emerald') {
    const textEl = document.getElementById('camara-text-state');
    const dot = document.getElementById('camara-ping-state');
    if (textEl) textEl.innerText = texto;
    if (!dot) return;
    const colorClass = color === 'rose' ? 'bg-rose-500' : (color === 'amber' ? 'bg-amber-500' : 'bg-emerald-500');
    dot.className = `w-2 h-2 rounded-full ${colorClass} animate-pulse`;
}

function normalizarCodigoEscaneado(raw) {
    const txt = String(raw || '').trim();
    if (!txt) return '';
    try { return decodeURIComponent(txt); } catch (_) { return txt; }
}

function codigoPareceURL(codigo) {
    return /^https?:\/\//i.test(String(codigo || ''));
}

function codigoPareceBarcode(codigo) {
    return /^\d{8,14}$/.test(String(codigo || ''));
}

function mapearCodigoASku(codigo) {
    return String(codigo || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 64);
}

function aplicarSugerenciasProductoFormulario(producto = {}, codigoLeido = '') {
    const skuEl = document.getElementById('sku');
    const prendaEl = document.getElementById('prenda');
    const categoriaEl = document.getElementById('categoria');
    const precioEl = document.getElementById('precioVenta');
    const comentariosEl = document.getElementById('comentariosProducto');

    if (skuEl && !skuEl.value.trim()) {
        skuEl.value = producto.skuSugerido || mapearCodigoASku(codigoLeido);
    }

    if (prendaEl && producto.prenda && !prendaEl.value.trim()) {
        prendaEl.value = String(producto.prenda).trim();
    }

    if (precioEl && Number.isFinite(Number(producto.precioVenta)) && Number(precioEl.value || 0) <= 0) {
        precioEl.value = Number(producto.precioVenta).toFixed(2);
    }

    if (categoriaEl && producto.categoria) {
        const target = String(producto.categoria).trim().toLowerCase();
        const opts = Array.from(categoriaEl.options || []);
        const exacta = opts.find((o) => String(o.value).trim().toLowerCase() === target);
        if (exacta) {
            categoriaEl.value = exacta.value;
        } else {
            const aproximada = opts.find((o) => String(o.value).trim().toLowerCase().includes(target) || target.includes(String(o.value).trim().toLowerCase()));
            if (aproximada) categoriaEl.value = aproximada.value;
        }
    }

    if (comentariosEl) {
        const partes = [];
        if (producto.marca) partes.push(`Marca: ${producto.marca}`);
        if (producto.descripcion) partes.push(String(producto.descripcion).slice(0, 220));
        if (codigoLeido) partes.push(`Codigo: ${codigoLeido}`);
        const nuevoComentario = partes.join(' | ');
        if (nuevoComentario && !comentariosEl.value.includes('Codigo:')) {
            comentariosEl.value = [comentariosEl.value.trim(), nuevoComentario].filter(Boolean).join(' · ');
        }
    }

    calcularMargenComercialAlVuelo();
}

async function buscarInfoProductoPorCodigo(codigo) {
    const estado = document.getElementById('camara-last-lookup');
    try {
        const res = await fetch(`${BACKEND_URL}/api/producto/lookup-codigo/${encodeURIComponent(codigo)}`, { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo obtener info de codigo.');

        if (estado) {
            const fuente = data?.fuente || 'codigo';
            estado.innerText = `Sugerencias cargadas (${fuente}).`;
        }

        if (data?.producto) {
            aplicarSugerenciasProductoFormulario(data.producto, codigo);
        }
    } catch (error) {
        if (estado) estado.innerText = `Sin lookup remoto: ${error.message}`;
    }
}

async function procesarCodigoEscaneadoDesdeCamara(rawCode) {
    const codigo = normalizarCodigoEscaneado(rawCode);
    if (!codigo) return;

    const now = Date.now();
    if (codigo === ULTIMO_CODIGO_ESCANEADO && (now - ULTIMO_SCAN_TS) < 1800) return;
    ULTIMO_CODIGO_ESCANEADO = codigo;
    ULTIMO_SCAN_TS = now;

    const ult = document.getElementById('camara-ult-codigo');
    if (ult) ult.innerText = codigo;

    const skuEl = document.getElementById('sku');
    if (skuEl) {
        if (codigoPareceURL(codigo)) {
            skuEl.value = mapearCodigoASku(codigo.split('/').filter(Boolean).pop() || codigo);
        } else {
            skuEl.value = mapearCodigoASku(codigo);
        }
    }

    if (codigoPareceBarcode(codigo) || !codigoPareceURL(codigo)) {
        await buscarInfoProductoPorCodigo(codigo);
    }

    actualizarEstadoEscaner('Codigo detectado', 'amber');
    const btnRearmar = document.getElementById('btn-rearmar-escaner');
    if (btnRearmar) btnRearmar.classList.remove('hidden');
    LECTOR_BLOQUEADO_POR_CAPTURA = true;
}

async function cargarCamarasDisponibles() {
    const select = document.getElementById('select-camara-dispositivo');
    if (!select || typeof Html5Qrcode === 'undefined' || typeof Html5Qrcode.getCameras !== 'function') return;

    try {
        const cams = await Html5Qrcode.getCameras();
        select.innerHTML = '<option value="">Auto (trasera si existe)</option>';

        cams.forEach((cam) => {
            const opt = document.createElement('option');
            opt.value = cam.id;
            opt.textContent = cam.label || `Camara ${cam.id}`;
            select.appendChild(opt);
        });

        const trasera = cams.find((c) => /back|rear|trasera|environment/i.test(c.label || ''));
        if (trasera && !ESCANER_CAMARA_ID_ACTUAL) {
            ESCANER_CAMARA_ID_ACTUAL = trasera.id;
            select.value = trasera.id;
        }
    } catch (e) {
        console.warn('No se pudieron listar camaras:', e.message);
    }
}

async function iniciarEscanerCamara(cameraId = '') {
    if (typeof Html5Qrcode === 'undefined') {
        alert('El modulo de escaneo no cargo. Recarga la pagina e intenta de nuevo.');
        return;
    }

    if (ESCANER_CAMARA_INICIANDO) return;
    ESCANER_CAMARA_INICIANDO = true;
    const secuenciaLocal = ++ESCANER_CAMARA_SECUENCIA;

    if (OBJETO_ESCANER_CAMARA) {
        try { await OBJETO_ESCANER_CAMARA.stop(); } catch (_) {}
        try { OBJETO_ESCANER_CAMARA.clear(); } catch (_) {}
        OBJETO_ESCANER_CAMARA = null;
        ESCANER_CAMARA_ACTIVO = false;
    }

    const formats = (typeof Html5QrcodeSupportedFormats !== 'undefined') ? [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.CODABAR
    ] : undefined;

    OBJETO_ESCANER_CAMARA = new Html5Qrcode('reader');
    LECTOR_BLOQUEADO_POR_CAPTURA = false;
    const btnRearmar = document.getElementById('btn-rearmar-escaner');
    if (btnRearmar) btnRearmar.classList.add('hidden');

    const cameraConfig = cameraId ? { deviceId: { exact: cameraId } } : { facingMode: 'environment' };
    const qrSize = Math.min(300, Math.max(220, Math.floor(window.innerWidth * 0.52)));
    const scanConfig = {
        fps: 12,
        qrbox: { width: qrSize, height: qrSize },
        aspectRatio: 1,
        formatsToSupport: formats
    };
    const scanConfigFallback = {
        fps: 8,
        qrbox: { width: 220, height: 220 },
        aspectRatio: 1,
        formatsToSupport: formats
    };

    try {
        await OBJETO_ESCANER_CAMARA.start(cameraConfig, scanConfig, async (decodedText) => {
            if (LECTOR_BLOQUEADO_POR_CAPTURA) return;
            await procesarCodigoEscaneadoDesdeCamara(decodedText);
        }, () => {});

        if (secuenciaLocal !== ESCANER_CAMARA_SECUENCIA) {
            try { await OBJETO_ESCANER_CAMARA.stop(); } catch (_) {}
            try { OBJETO_ESCANER_CAMARA.clear(); } catch (_) {}
            OBJETO_ESCANER_CAMARA = null;
            ESCANER_CAMARA_ACTIVO = false;
            return;
        }

        ESCANER_CAMARA_ACTIVO = true;
        actualizarEstadoEscaner('Lector Listo', 'emerald');
    } catch (err) {
        console.error('Error iniciando camara:', err);
        if (cameraId) {
            try {
                await OBJETO_ESCANER_CAMARA.start({ facingMode: 'environment' }, scanConfig, async (decodedText) => {
                    if (LECTOR_BLOQUEADO_POR_CAPTURA) return;
                    await procesarCodigoEscaneadoDesdeCamara(decodedText);
                }, () => {});
                ESCANER_CAMARA_ACTIVO = true;
                actualizarEstadoEscaner('Lector Listo (Auto)', 'emerald');
                return;
            } catch (_) {}
        }

        try {
            await OBJETO_ESCANER_CAMARA.start({ facingMode: 'environment' }, scanConfigFallback, async (decodedText) => {
                if (LECTOR_BLOQUEADO_POR_CAPTURA) return;
                await procesarCodigoEscaneadoDesdeCamara(decodedText);
            }, () => {});
            ESCANER_CAMARA_ACTIVO = true;
            actualizarEstadoEscaner('Lector Listo (Modo estable)', 'emerald');
            return;
        } catch (_) {}

        ESCANER_CAMARA_ACTIVO = false;
        actualizarEstadoEscaner('Error camara', 'rose');
        alert('No se pudo iniciar la camara. Revisa permisos y prueba con otra camara.');
    } finally {
        ESCANER_CAMARA_INICIANDO = false;
    }
}

async function toggleEscanerCamara() {
    const modulo = document.getElementById('modulo-camara');
    if (!modulo) return;

    if (!modulo.classList.contains('hidden')) {
        await cerrarCamara();
        return;
    }

    modulo.classList.remove('hidden');
    actualizarBloqueoOrientacion();
    await cargarCamarasDisponibles();
    await iniciarEscanerCamara(ESCANER_CAMARA_ID_ACTUAL || '');
}

async function cambiarCamaraEscaner(cameraId) {
    ESCANER_CAMARA_ID_ACTUAL = cameraId || '';
    const modulo = document.getElementById('modulo-camara');
    if (!modulo || modulo.classList.contains('hidden')) return;
    await iniciarEscanerCamara(ESCANER_CAMARA_ID_ACTUAL);
}

function rearmarLectorParaSiguientePrenda() {
    LECTOR_BLOQUEADO_POR_CAPTURA = false;
    actualizarEstadoEscaner('Lector Listo', 'emerald');
    const btn = document.getElementById('btn-rearmar-escaner');
    if (btn) btn.classList.add('hidden');
}

async function cerrarCamara() {
    const modulo = document.getElementById('modulo-camara');
    if (modulo) modulo.classList.add('hidden');
    actualizarBloqueoOrientacion();

    ESCANER_CAMARA_SECUENCIA += 1;

    if (OBJETO_ESCANER_CAMARA) {
        try { await OBJETO_ESCANER_CAMARA.stop(); } catch (_) {}
        try { OBJETO_ESCANER_CAMARA.clear(); } catch (_) {}
        OBJETO_ESCANER_CAMARA = null;
    }
    ESCANER_CAMARA_ACTIVO = false;
    ESCANER_CAMARA_INICIANDO = false;
}

async function archivoADataUrlReducido(file, maxSize = 1024, quality = 0.8) {
    return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let w = img.width;
                let h = img.height;
                if (w > h && w > maxSize) {
                    h = Math.round(h * (maxSize / w));
                    w = maxSize;
                } else if (h > maxSize) {
                    w = Math.round(w * (maxSize / h));
                    h = maxSize;
                }
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => resolve(null);
            img.src = String(e.target?.result || '');
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
}

async function cargarFotoEscanerDesdeArchivo(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    const b64 = await archivoADataUrlReducido(file, 1200, 0.82);
    if (!b64) return alert('No se pudo procesar la foto seleccionada.');

    ULTIMA_FOTO_ESCANER = b64;
    const prev = document.getElementById('camara-foto-preview');
    if (prev) {
        prev.src = b64;
        prev.classList.remove('hidden');
    }

    FOTOS_FORMULARIO_TEMP.unshift(b64);
    FOTOS_FORMULARIO_TEMP = Array.from(new Set(FOTOS_FORMULARIO_TEMP));
    actualizarVistaFotosFormulario();
}

function capturarFotoEscaner() {
    const reader = document.getElementById('reader');
    const video = reader ? reader.querySelector('video') : null;
    if (!video || !video.videoWidth || !video.videoHeight) {
        return alert('No hay video activo para capturar. Inicia la camara primero.');
    }

    const maxW = 1280;
    const scale = video.videoWidth > maxW ? (maxW / video.videoWidth) : 1;
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);

    const b64 = canvas.toDataURL('image/jpeg', 0.82);
    ULTIMA_FOTO_ESCANER = b64;

    const prev = document.getElementById('camara-foto-preview');
    if (prev) {
        prev.src = b64;
        prev.classList.remove('hidden');
    }

    FOTOS_FORMULARIO_TEMP.unshift(b64);
    FOTOS_FORMULARIO_TEMP = Array.from(new Set(FOTOS_FORMULARIO_TEMP));
    actualizarVistaFotosFormulario();
    actualizarEstadoEscaner('Foto capturada', 'amber');
}

async function analizarFotoEscanerIA() {
    const imagenes = Array.from(new Set([
        ULTIMA_FOTO_ESCANER,
        ...(Array.isArray(FOTOS_FORMULARIO_TEMP) ? FOTOS_FORMULARIO_TEMP : [])
    ].filter(Boolean))).slice(0, 3);
    const imagen = imagenes[0] || '';
    if (!imagen) {
        return alert('Primero captura o sube una foto para analizar el producto.');
    }

    const codigo = normalizarCodigoEscaneado(document.getElementById('camara-ult-codigo')?.innerText || document.getElementById('sku')?.value || '');
    const info = document.getElementById('camara-last-lookup');
    if (info) info.innerText = 'Analizando producto con IA...';

    try {
        const res = await fetch('/api/producto/analizar-foto', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ imagen, imagenes, codigo })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo analizar la foto.');

        if (data?.producto) {
            aplicarSugerenciasProductoFormulario(data.producto, codigo);
            if (info) info.innerText = 'Producto analizado y formulario completado.';
            cantarPorVoz('Producto analizado');
        } else {
            throw new Error('Respuesta de analisis sin datos de producto.');
        }
    } catch (err) {
        if (info) info.innerText = `Error de analisis: ${err.message}`;
        alert(`No se pudo analizar la foto: ${err.message}`);
    }
}

async function ejecutarLogicaEscaneo(skuParam) {
    try {
        const sku = normalizarCodigoEscaneado(skuParam);
        if (!sku) return;
        const response = await fetch(`${BACKEND_URL}/api/ventas/escanear/${encodeURIComponent(sku)}`, { method: 'PUT', credentials: 'include' });
        if (response.ok) {
            const resJson = await response.json(); 
            const eConfig = LISTA_ESTADOS_KANBAN.find(est => est.nombre === resJson.operacion);
            if (eConfig && eConfig.rolFinanciero === 'Venta') { tocarSonidoCajaRegistradora(); lanzarConfetiVenta(); cantarPorVoz("Vendido"); }
            else if (resJson.operacion === "Creado") { cantarPorVoz("Indexado."); cancelEdit(); document.getElementById('sku').value = resJson.venta.sku; document.getElementById('prenda').focus(); }
            else { cantarPorVoz("Actualizado"); }
            procesarMultiplicadorCombo(); await forceRefreshDataManual();
        }
    } catch (err) {}
}

function toggleRegistroNegocioModal(mostrar) {
    const modal = document.getElementById('modal-registro-negocio');
    if (!modal) return;
    modal.classList.toggle('hidden', !mostrar);
}
window.toggleRegistroNegocioModal = toggleRegistroNegocioModal;

async function registrarNegocioPublico() {
    const nombreNegocio = (document.getElementById('registro-negocio-nombre')?.value || '').trim();
    const email = (document.getElementById('registro-negocio-email')?.value || '').trim().toLowerCase();
    const nombreVisible = (document.getElementById('registro-negocio-nombre-visible')?.value || '').trim();

    if (!nombreNegocio) return alert('Indica el nombre del negocio.');
    if (!email || !email.includes('@')) return alert('Indica un email válido.');

    try {
        const res = await fetch('/api/public/registrar-negocio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombreNegocio, email, nombreVisible })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo registrar el negocio.');

        alert(`Negocio creado: ${data.negocio?.nombre || nombreNegocio}. Ahora inicia sesión con Google usando ${email}.`);
        toggleRegistroNegocioModal(false);
    } catch (e) {
        alert(`Error: ${e.message}`);
    }
}
window.registrarNegocioPublico = registrarNegocioPublico;

window.__handleCredentialResponseImpl = async function(response) {
    const loginBox = document.querySelector('.login-glow-card div');
    const originalHTML = loginBox.innerHTML;
    loginBox.innerHTML = '<div class="text-white text-center"><div class="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div><p class="font-bold text-lg text-blue-400">Obteniendo ubicación satelital...</p><p class="text-[11px] opacity-60 mt-2">Por favor, acepta los permisos en tu navegador si te los pide.</p></div>';

    let clientLocation = null;
    const sendLogin = async () => {
    try {
            const res = await fetch(`${BACKEND_URL}/api/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ token: response.credential, clientLocation }) });
        if (res.ok) {
            window.location.reload();
        } else {
            const data = await res.json();
            alert(`⚠️ Acceso denegado: ${data.error || 'Correo no autorizado en el sistema.'}`);
                loginBox.innerHTML = originalHTML;
        }
    } catch(e) {
        alert("❌ Error crítico: No se pudo conectar con el servidor de Seychelles.");
            loginBox.innerHTML = originalHTML;
    }
    };

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => { clientLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude }; sendLogin(); },
            (err) => { console.warn("Localización HTML5 denegada", err); sendLogin(); },
            { timeout: 6000, enableHighAccuracy: true }
        );
    } else { sendLogin(); }
};

if (window.__pendingGoogleCredential) {
    const pendingGoogleCredential = window.__pendingGoogleCredential;
    window.__pendingGoogleCredential = null;
    window.handleCredentialResponse(pendingGoogleCredential);
}

async function reloadCoreData(isInitialLoad = false) {
    if (IS_LOADING_MORE && !isInitialLoad) return;
    IS_LOADING_MORE = true;
    
    const loaderContainer = document.getElementById('kanban-loader-container');
    if (isInitialLoad) {
        if (loaderContainer) loaderContainer.innerHTML = `<div class="text-white/50 animate-pulse py-4">Cargando inventario inicial...</div>`;
        CURRENT_PAGE = 1;
    }

    try {
        const logsVisible = !document.getElementById('sec-auditoria')?.classList.contains('hidden');
        const params = new URLSearchParams({
            page: '1',
            includeLogs: logsVisible ? '1' : '0'
        });
        // En el primer arranque pedimos payload ligero para acelerar el primer pintado.
        if (isInitialLoad) params.set('lightweight', '1');
        const res = await fetch(`${BACKEND_URL}/api/ventas?${params.toString()}`, { credentials: 'include' });
        if (!res.ok) throw new Error('Fallo de red al cargar datos.');
        const data = await res.json();

        // Si la configuración de columnas no está lista, fuerza fallback para no bloquear el render inicial.
        if (!Array.isArray(LISTA_ESTADOS_KANBAN) || LISTA_ESTADOS_KANBAN.length === 0) {
            try {
                await refrescarEstadosKanban();
            } catch (_) {}
        }
        
        BASE_DATOS = Array.isArray(data.ventas) ? data.ventas : [];

        // Último seguro: construir estados mínimos desde ventas si todo lo anterior falló.
        if ((!Array.isArray(LISTA_ESTADOS_KANBAN) || LISTA_ESTADOS_KANBAN.length === 0) && BASE_DATOS.length > 0) {
            const estadoNombres = [...new Set(BASE_DATOS.map((v) => String(v?.estado || '').trim()).filter(Boolean))];
            LISTA_ESTADOS_KANBAN = estadoNombres.map((nombre, idx) => ({
                _id: `fallback-${idx + 1}`,
                nombre,
                icono: nombre.toLowerCase().includes('vend') ? '💰' : (nombre.toLowerCase().includes('reserv') ? '🤝' : '📦'),
                color: nombre.toLowerCase().includes('vend') ? 'emerald' : (nombre.toLowerCase().includes('reserv') ? 'indigo' : 'amber'),
                rolFinanciero: nombre.toLowerCase().includes('vend') ? 'Venta' : 'Stock',
                orden: idx + 1
            }));
        }

        CURRENT_PAGE = data.currentPage || 1;
        TOTAL_PAGES = data.totalPages || 1;
        const resumen = (data && typeof data.resumen === 'object' && data.resumen) ? data.resumen : {};

        const elIngresos = document.getElementById('kpi-ingresos');
        const elBeneficio = document.getElementById('kpi-beneficio');
        const elInversion = document.getElementById('kpi-inversion');
        const elPrendas = document.getElementById('kpi-prendas');
        const elRoi = document.getElementById('kpi-roi');

        animateNumberTo(elIngresos, `${(Number(resumen.ingresos || 0)).toFixed(2)} €`);
        animateNumberTo(elBeneficio, `${(Number(resumen.beneficio || 0)).toFixed(2)} €`);
        animateNumberTo(elInversion, `${(Number(resumen.inversion || 0)).toFixed(2)} €`);
        animateNumberTo(elPrendas, `${Number(resumen.prendasVendidas || 0)}` , { decimals: 0 });
        animateNumberTo(elRoi, `${(Number(resumen.roi || 0)).toFixed(1)}%` , { decimals: 1 });
        aplicarMascaraVisualizadorEnUI();

        if (isInitialLoad) {
            cachearInventarioInicial({
                ventas: BASE_DATOS,
                resumen,
                estados: LISTA_ESTADOS_KANBAN
            });
        }

        renderKanban(true);
        requestAnimationFrame(() => {
            updateTickerWallStreet();
            ejecutarVerificacionAlertasStock();
            actualizarVisibilidadPanelMasivo();
            renderCalendarioStock();
        });
        
        if (!document.getElementById('sec-analitica').classList.contains('hidden')) {
            actualizarTodoElBloqueGrafico();
        }
        actualizarDashboardGananciasAdmin();
        
        const contenedorLogs = document.getElementById('contenedor-logs-auditoria');
        if (logsVisible && contenedorLogs && data.logs && data.logs.length > 0) {
            let htmlLogs = ''; data.logs.forEach(l => { const horaFormateada = new Date(l.fechaHora).toLocaleTimeString('es-ES', {hour: '2-digit', minute:'2-digit'}); htmlLogs += `<div class="border-b border-white/5 pb-1"><span class="text-indigo-400">[${horaFormateada}]</span> <b>${l.usuario.split('@')[0]}:</b> ${l.accion}</div>`; });
            contenedorLogs.innerHTML = htmlLogs;
        }
    } catch(e) {
        console.error("Error en reloadCoreData:", e);
        if (loaderContainer) loaderContainer.innerHTML = `<div class="text-rose-400 py-4">Error de sincronización.</div>`;
    } finally {
        IS_LOADING_MORE = false;
    }
    actualizarUsoBaseDatos();
}

function obtenerClaveCacheInventario() {
    const empresa = String(EMPRESA_CHAT_ACTUAL || 'default').toLowerCase().trim() || 'default';
    return `seychelles-cache-inventario:${empresa}`;
}

function cachearInventarioInicial(payload) {
    try {
        const ventas = Array.isArray(payload?.ventas) ? payload.ventas.slice(0, 250) : [];
        const resumen = payload?.resumen && typeof payload.resumen === 'object' ? payload.resumen : {};
        const estados = Array.isArray(payload?.estados) ? payload.estados : [];
        const snapshot = {
            createdAt: Date.now(),
            ventas,
            resumen,
            estados
        };
        localStorage.setItem(obtenerClaveCacheInventario(), JSON.stringify(snapshot));
    } catch (_) {}
}

function pintarInventarioDesdeCacheInicial() {
    try {
        const raw = localStorage.getItem(obtenerClaveCacheInventario());
        if (!raw) return false;
        const snapshot = JSON.parse(raw);
        if (!snapshot || typeof snapshot !== 'object') return false;

        const ageMs = Date.now() - Number(snapshot.createdAt || 0);
        if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > (1000 * 60 * 30)) return false;

        const ventas = Array.isArray(snapshot.ventas) ? snapshot.ventas : [];
        if (!ventas.length) return false;

        BASE_DATOS = ventas;
        if ((!Array.isArray(LISTA_ESTADOS_KANBAN) || LISTA_ESTADOS_KANBAN.length === 0) && Array.isArray(snapshot.estados) && snapshot.estados.length > 0) {
            LISTA_ESTADOS_KANBAN = snapshot.estados;
        }

        if ((!Array.isArray(LISTA_ESTADOS_KANBAN) || LISTA_ESTADOS_KANBAN.length === 0) && BASE_DATOS.length > 0) {
            const estadoNombres = [...new Set(BASE_DATOS.map((v) => String(v?.estado || '').trim()).filter(Boolean))];
            LISTA_ESTADOS_KANBAN = estadoNombres.map((nombre, idx) => ({
                _id: `cache-fallback-${idx + 1}`,
                nombre,
                icono: nombre.toLowerCase().includes('vend') ? '💰' : (nombre.toLowerCase().includes('reserv') ? '🤝' : '📦'),
                color: nombre.toLowerCase().includes('vend') ? 'emerald' : (nombre.toLowerCase().includes('reserv') ? 'indigo' : 'amber'),
                rolFinanciero: nombre.toLowerCase().includes('vend') ? 'Venta' : 'Stock',
                orden: idx + 1
            }));
        }

        const resumen = snapshot.resumen && typeof snapshot.resumen === 'object' ? snapshot.resumen : {};
        const elIngresos = document.getElementById('kpi-ingresos');
        const elBeneficio = document.getElementById('kpi-beneficio');
        const elInversion = document.getElementById('kpi-inversion');
        const elPrendas = document.getElementById('kpi-prendas');
        const elRoi = document.getElementById('kpi-roi');
        if (elIngresos) elIngresos.innerText = `${(Number(resumen.ingresos || 0)).toFixed(2)} €`;
        if (elBeneficio) elBeneficio.innerText = `${(Number(resumen.beneficio || 0)).toFixed(2)} €`;
        if (elInversion) elInversion.innerText = `${(Number(resumen.inversion || 0)).toFixed(2)} €`;
        if (elPrendas) elPrendas.innerText = Number(resumen.prendasVendidas || 0);
        if (elRoi) elRoi.innerText = `${(Number(resumen.roi || 0)).toFixed(1)}%`;

        renderKanban(true);
        return true;
    } catch (_) {
        return false;
    }
}

async function loadMoreData() {
    if (IS_LOADING_MORE || CURRENT_PAGE >= TOTAL_PAGES) return;
    IS_LOADING_MORE = true;
    CURRENT_PAGE++;

    const loaderContainer = document.getElementById('kanban-loader-container');
    const btn = loaderContainer ? loaderContainer.querySelector('button') : null;
    if (btn) {
        btn.innerHTML = 'Cargando...';
        btn.disabled = true;
    }

    try {
        const res = await fetch(`${BACKEND_URL}/api/ventas?page=${CURRENT_PAGE}&lightweight=1`, { credentials: 'include' });
        if (!res.ok) throw new Error('Fallo al cargar más datos');
        const data = await res.json();

        BASE_DATOS.push(...(data.ventas || []));
        CURRENT_PAGE = data.currentPage || CURRENT_PAGE;
        TOTAL_PAGES = data.totalPages || TOTAL_PAGES;

        renderKanban(false);

    } catch (e) {
        console.error("Error en loadMoreData:", e);
        if (loaderContainer) loaderContainer.innerHTML = `<div class="text-rose-400 py-4">Error al cargar más productos.</div>`;
        CURRENT_PAGE--;
    } finally {
        IS_LOADING_MORE = false;
    }
}

function actualizarTodoElBloqueGrafico() {
    dibujarGrafica();
    dibujarGraficaTarta();
    dibujarGraficaBarrasTiendas();
    dibujarMapaCalor();
    actualizarDashboardGananciasAdmin();
    actualizarResumenComparativaAnalitica();
}

function dibujarGrafica() {
    const contenedor = document.getElementById('contenedor-canvas-grafica'); if(!contenedor) return;
    if (INSTANCIA_CHARTS) { INSTANCIA_CHARTS.destroy(); }
    
    contenedor.innerHTML = '<canvas id="graficaTendencias"></canvas>'; const ctx = document.getElementById('graficaTendencias').getContext('2d');
    const currentTheme = localStorage.getItem('seychelles-theme-multi') || 'dark';
    
    const datosFiltrados = obtenerDatosFiltradosParaAnalitica();
    const datosAgrupados = {}; 
    
    datosFiltrados.forEach(v => { datosAgrupados[v.fechaVenta] = (datosAgrupados[v.fechaVenta] || 0) + (parseFloat(v.precioVenta || 0) * (v.cantidad || 1)); });
    const fechas = Object.keys(datosAgrupados).sort(); const montos = fechas.map(f => datosAgrupados[f]);

    const configuracionGraficas = {
        dark: { linea: '#3b82f6', texto: '#94a3b8', malla: 'rgba(255,255,255,0.05)' }, pink: { linea: '#db2777', texto: '#831843', malla: 'rgba(219,39,119,0.1)' },
        light: { linea: '#0f172a', texto: '#475569', malla: 'rgba(0,0,0,0.05)' }, emerald: { linea: '#10b981', texto: '#e6f4ea', malla: 'rgba(255,255,255,0.05)' },
        purple: { linea: '#a855f7', texto: '#e0e7ff', malla: 'rgba(255,255,255,0.05)' },
        premium: { linea: '#d4af37', texto: '#b49339', malla: 'rgba(212,175,55,0.1)' }
    };
    const cfg = configuracionGraficas[currentTheme] || configuracionGraficas.dark;

    INSTANCIA_CHARTS = new Chart(ctx, {
        type: 'line', data: { labels: fechas.map(f => f.split('-').reverse().slice(0,2).join('/')), datasets: [{ data: montos, borderColor: cfg.linea, borderWidth: 3, pointBackgroundColor: cfg.linea, tension: 0.2, fill: false }] },
        options: { responsive: true, maintainAspectRatio: false, animation: { duration: 2000, easing: 'easeOutQuart' }, plugins: { legend: { display: false } }, scales: { x: { grid: { color: cfg.malla }, ticks: { color: cfg.texto } }, y: { grid: { color: cfg.malla }, ticks: { color: cfg.texto, callback: v => v + '€' } } } }
    });
}

function dibujarGraficaTarta() {
    const contenedor = document.getElementById('contenedor-canvas-tarta'); if(!contenedor) return;
    if (INSTANCIA_TARTA) { INSTANCIA_TARTA.destroy(); }
    
    contenedor.innerHTML = '<canvas id="graficaTartaCategorias"></canvas>'; const ctx = document.getElementById('graficaTartaCategorias').getContext('2d');
    const currentTheme = localStorage.getItem('seychelles-theme-multi') || 'dark';

    const datosFiltrados = obtenerDatosFiltradosParaAnalitica();
    const contadorCategorias = {};
    datosFiltrados.forEach(v => { contadorCategorias[v.categoria] = (contadorCategorias[v.categoria] || 0) + (v.cantidad || 1); });

    const etiquetas = Object.keys(contadorCategorias); const datos = etiquetas.map(cat => contadorCategorias[cat]);

    const paletasColor = {
        dark: ['#3b82f6', '#60a5fa', '#ec4899', '#10b981', '#f59e0b'], pink: ['#db2777', '#f472b6', '#fbcfe8', '#be185d', '#9d174d'],
        light: ['#1e293b', '#475569', '#64748b', '#94a3b8', '#cbd5e1'], emerald: ['#059669', '#10b981', '#34d399', '#6ee7b7', '#a7f3d0'],
        purple: ['#7c3aed', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe'], premium: ['#d4af37', '#eab308', '#b45309', '#a16207', '#713f12']
    };
    const coloresSeleccionados = paletasColor[currentTheme] || paletasColor.dark;
    const colorTexto = currentTheme === 'light' || currentTheme === 'pink' ? '#0f172a' : (currentTheme === 'premium' ? '#d4af37' : '#f1f5f9');

    INSTANCIA_TARTA = new Chart(ctx, {
        type: 'doughnut', data: { labels: etiquetas, datasets: [{ data: datos, backgroundColor: coloresSeleccionados, borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, animation: { animateScale: true, animateRotate: true, duration: 1800, easing: 'easeOutCirc' }, plugins: { legend: { position: 'right', labels: { color: colorTexto, font: { size: 9, family: 'monospace' } } } } }
    });
}

function dibujarGraficaBarrasTiendas() {
    const contenedor = document.getElementById('contenedor-canvas-barras'); if(!contenedor) return;
    if (INSTANCIA_BARRAS) { INSTANCIA_BARRAS.destroy(); }
    
    contenedor.innerHTML = '<canvas id="graficaBarrasTiendas"></canvas>'; const ctx = document.getElementById('graficaBarrasTiendas').getContext('2d');
    const currentTheme = localStorage.getItem('seychelles-theme-multi') || 'dark';

    const datosFiltrados = obtenerDatosFiltradosParaAnalitica();
    const facturacionTiendas = {};
    
    datosFiltrados.forEach(v => {
        const nombreTienda = v.proveedor || 'Sin definir';
        facturacionTiendas[nombreTienda] = (facturacionTiendas[nombreTienda] || 0) + (parseFloat(v.precioVenta || 0) * (v.cantidad || 1));
    });

    const etiquetas = Object.keys(facturacionTiendas); const datos = etiquetas.map(t => facturacionTiendas[t]);

    const paletasColor = {
        dark: '#ec4899', pink: '#db2777', light: '#475569', emerald: '#10b981', purple: '#8b5cf6', premium: '#d4af37'
    };
    const colorBarra = paletasColor[currentTheme] || paletasColor.dark;
    const colorTexto = currentTheme === 'light' || currentTheme === 'pink' ? '#475569' : (currentTheme === 'premium' ? '#d4af37' : '#94a3b8');

    INSTANCIA_BARRAS = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: etiquetas,
            datasets: [{ data: datos, backgroundColor: colorBarra, borderRadius: 6, maxBarThickness: 30 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: { duration: 1200, easing: 'easeOutBounce', delay: (context) => context.dataIndex * 150 },
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: colorTexto, font: { size: 9 } }, grid: { display: false } },
                y: { ticks: { color: colorTexto, callback: v => v + '€' }, grid: { color: 'rgba(255,255,255,0.03)' } }
            }
        }
    });
}

function dibujarMapaCalor() {
    const canvasContenedor = document.querySelector('#graficaMapaCalor'); if (!canvasContenedor) return;
    const ctx = canvasContenedor.getContext('2d'); if (INSTANCIA_MAPA_CALOR) { INSTANCIA_MAPA_CALOR.destroy(); }

    const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const selectGran = document.getElementById('heatmap-granularidad');
    const selectMet = document.getElementById('heatmap-metrica');
    const resumenEl = document.getElementById('heatmap-summary');
    const granularidad = String(selectGran?.value || 'bloques');
    const metrica = String(selectMet?.value || 'prendas');

    const bloquesHorarios = granularidad === 'hora'
        ? Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)
        : ['00:00-06:00', '06:00-12:00', '12:00-18:00', '18:00-00:00'];

    const bloquesCount = bloquesHorarios.length;
    const matrizDatos = Array(7).fill(0).map(() => Array(bloquesCount).fill(0));
    let maxVentas = 1;

    const datosFiltrados = obtenerDatosFiltradosParaAnalitica();
    datosFiltrados.forEach(v => {
        const fechaObj = v.fechaVenta ? new Date(v.fechaVenta) : new Date(); if (isNaN(fechaObj.getTime())) return;
        const diaIndex = fechaObj.getDay(); const hora = fechaObj.getHours();
        let bloqueIndex = 0;

        if (granularidad === 'hora') {
            bloqueIndex = hora;
        } else {
            if (hora >= 6 && hora < 12) bloqueIndex = 1;
            else if (hora >= 12 && hora < 18) bloqueIndex = 2;
            else if (hora >= 18) bloqueIndex = 3;
        }

        const qty = (parseInt(v.cantidad, 10) || 1);
        const pv = Number(v.precioVenta || 0) || 0;
        const pc = Number(v.precioCompra || 0) || 0;
        const ge = Number(v.gastosEnvio || 0) || 0;
        const canal = String(v.canalVenta || '').toLowerCase();
        const comision = (canal === 'vinted' || canal === 'wallapop') ? (pv * 0.05) : 0;

        let valor = qty;
        if (metrica === 'ingresos') valor = (pv - comision) * qty;
        if (metrica === 'beneficio') valor = ((pv - comision) - (pc + ge)) * qty;

        matrizDatos[diaIndex][bloqueIndex] += valor;
        if (matrizDatos[diaIndex][bloqueIndex] > maxVentas) maxVentas = matrizDatos[diaIndex][bloqueIndex];
    });

    const scatterData = [];
    let topSlot = null;
    for (let d = 0; d < 7; d++) {
        for (let h = 0; h < bloquesCount; h++) {
            if (matrizDatos[d][h] <= 0) continue;
            const point = { x: d, y: h, v: matrizDatos[d][h] };
            scatterData.push(point);
            if (!topSlot || point.v > topSlot.v) topSlot = point;
        }
    }

    const currentTheme = localStorage.getItem('seychelles-theme-multi') || 'dark';
    const paletasTema = {
        dark: { base: '59, 130, 246', texto: '#94a3b8', malla: 'rgba(255,255,255,0.05)' }, pink: { base: '219, 39, 119', texto: '#831843', malla: 'rgba(219,39,119,0.1)' },
        light: { base: '15, 23, 42', texto: '#475569', malla: 'rgba(0,0,0,0.05)' }, emerald: { base: '16, 185, 129', texto: '#e6f4ea', malla: 'rgba(255,255,255,0.05)' },
        purple: { base: '168, 85, 247', texto: '#e0e7ff', malla: 'rgba(255,255,255,0.05)' },
        premium: { base: '212, 175, 55', texto: '#b49339', malla: 'rgba(212,175,55,0.1)' }
    };
    const cfg = paletasTema[currentTheme] || paletasTema.dark;

    INSTANCIA_MAPA_CALOR = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                data: scatterData,
                backgroundColor: function(context) {
                    const value = context.raw ? context.raw.v : 0;
                    const alpha = Math.min(0.2 + (Math.abs(value) / Math.max(Math.abs(maxVentas), 1)) * 0.8, 1);
                    if (metrica === 'beneficio' && value < 0) return `rgba(244, 63, 94, ${alpha})`;
                    return `rgba(${cfg.base}, ${alpha})`;
                },
                pointStyle: 'rectRounded',
                radius: function(context) {
                    const value = Math.abs(context.raw?.v || 0);
                    const base = granularidad === 'hora' ? Math.min(context.chart.width / 44, 17) : Math.min(context.chart.width / 24, 26);
                    const factor = Math.max(0.55, value / Math.max(Math.abs(maxVentas), 1));
                    return Math.max(6, base * factor);
                }
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: { duration: 1500, easing: 'easeOutElastic', delay: (context) => context.dataIndex * 30 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const val = Number(context.raw?.v || 0);
                            const metricLabel = metrica === 'prendas'
                                ? `${val.toFixed(0)} prenda(s)`
                                : `${val.toFixed(2)} €`;
                            return ` ${diasSemana[context.raw.x]} (${bloquesHorarios[context.raw.y]}): ${metricLabel}`;
                        }
                    }
                }
            },
            scales: {
                x: { type: 'linear', min: -0.5, max: 6.5, grid: { color: cfg.malla }, ticks: { color: cfg.texto, stepSize: 1, callback: v => diasSemana[v] } },
                y: { type: 'linear', min: -0.5, max: bloquesCount - 0.5, grid: { color: cfg.malla }, ticks: { color: cfg.texto, stepSize: 1, callback: v => bloquesHorarios[v] } }
            }
        }
    });

    if (resumenEl) {
        if (!topSlot) {
            resumenEl.innerText = 'Sin transacciones para los filtros activos.';
        } else {
            const valorTxt = metrica === 'prendas'
                ? `${Number(topSlot.v).toFixed(0)} prendas`
                : `${Number(topSlot.v).toFixed(2)} €`;
            resumenEl.innerText = `Pico detectado: ${diasSemana[topSlot.x]} · ${bloquesHorarios[topSlot.y]} · ${valorTxt}.`;
        }
    }
}

function renderKanban(isFullRefresh = false) {
    const wrapper = document.getElementById('kanban-dynamic-wrapper');
    if (!wrapper) return;

    const estadoConfigMap = new Map((LISTA_ESTADOS_KANBAN || []).map((e) => [e.nombre, e]));
    const estadosOrdenados = [...(LISTA_ESTADOS_KANBAN || [])].sort((a, b) => a.orden - b.orden);

    const filtroGlobalCat = document.getElementById('filtro-categoria')?.value || 'TODOS';
    const filtroGlobalTalla = document.getElementById('filtro-talla')?.value || 'TODOS';
    const filtroGlobalCanal = document.getElementById('filtro-canal')?.value || 'TODOS';
    const filtroGlobalTienda = document.getElementById('filtro-tienda')?.value || 'TODOS';

    if (isFullRefresh) {
        let htmlColumns = '';
        estadosOrdenados.forEach((est, index) => {
            const minHClass = index < 2 ? 'min-h-[520px]' : 'min-h-[350px]';
            htmlColumns += `
            <div class="card-bg border rounded-3xl p-4 flex flex-col ${minHClass} transition-all relative group border-${est.color}-500/20 shadow-lg">
                <div class="flex flex-col gap-2 mb-4">
                    <div class="flex justify-between items-center">
                        <h3 class="text-[10px] font-black text-${est.color}-400 uppercase tracking-widest flex items-center gap-1.5">
                            ${est.icono} ${est.nombre} <span id="badge-kanban-${est._id}" class="bg-${est.color}-500/10 px-1.5 py-0.5 rounded">0</span>
                        </h3>
                        <button onclick="alternarSeleccionColumna('${est.nombre}')" class="text-[9px] opacity-40 hover:opacity-100 uppercase font-black">Marcar</button>
                    </div>
                    <select onchange="cambiarOrdenColumna('${est.nombre}', this.value)" class="bg-black/20 border-none text-[9px] font-bold uppercase rounded-lg px-2 py-1 focus:outline-none text-${est.color}-300">
                        <option value="reciente" ${CONFIG_ORDEN_COLUMNAS[est.nombre] === 'reciente' ? 'selected' : ''}>🕒 Más Recientes</option>
                        <option value="precio-desc" ${CONFIG_ORDEN_COLUMNAS[est.nombre] === 'precio-desc' ? 'selected' : ''}>💰 Precio: Mayor</option>
                        <option value="precio-asc" ${CONFIG_ORDEN_COLUMNAS[est.nombre] === 'precio-asc' ? 'selected' : ''}>💰 Precio: Menor</option>
                        <option value="nombre" ${CONFIG_ORDEN_COLUMNAS[est.nombre] === 'nombre' ? 'selected' : ''}>🔤 Nombre</option>
                    </select>
                    <input type="text" oninput="debouncedCambiarFiltroColumna('${est.nombre}', this.value)" value="${CONFIG_FILTRO_COLUMNAS[est.nombre] || ''}" placeholder="Filtrar..." class="bg-black/10 border border-current/10 text-[9px] rounded-lg px-2 py-1 focus:outline-none placeholder-current/30">
                </div>
                <div id="col-dinamica-${est._id}" class="flex-1 space-y-3 p-1 overflow-y-auto max-h-[600px] custom-scrollbar" ondragover="allowDrop(event)" ondrop="handleDropColumn(event, '${est.nombre}')" ondragleave="clearDrop(event)"></div>
            </div>`;
        });
        wrapper.innerHTML = htmlColumns;
    }

    const totalStockPorPrenda = {};
    BASE_DATOS.forEach((x) => {
        const eConfig = estadoConfigMap.get(x.estado);
        if (eConfig && eConfig.rolFinanciero === 'Stock') {
            totalStockPorPrenda[x.prenda] = (totalStockPorPrenda[x.prenda] || 0) + 1;
        }
    });

    const baseFiltradaGlobal = BASE_DATOS.filter((v) =>
        (filtroGlobalCat === 'TODOS' || v.categoria === filtroGlobalCat) &&
        (filtroGlobalTalla === 'TODOS' || v.talla === filtroGlobalTalla) &&
        (filtroGlobalCanal === 'TODOS' || v.canalVenta === filtroGlobalCanal) &&
        (filtroGlobalTienda === 'TODOS' || (v.proveedor || 'Sin asignar') === filtroGlobalTienda)
    );

    const agrupadoPorEstado = new Map();
    baseFiltradaGlobal.forEach((v) => {
        const estado = String(v?.estado || '').trim();
        if (!agrupadoPorEstado.has(estado)) agrupadoPorEstado.set(estado, []);
        agrupadoPorEstado.get(estado).push(v);
    });

    estadosOrdenados.forEach(est => {
        const colDom = document.getElementById(`col-dinamica-${est._id}`);
        if(!colDom) return;

        if (isFullRefresh) colDom.innerHTML = '';

        const criterio = CONFIG_ORDEN_COLUMNAS[est.nombre] || 'reciente';
        const query = String(CONFIG_FILTRO_COLUMNAS[est.nombre] || '').toLowerCase().trim();

        let filtrados = (agrupadoPorEstado.get(est.nombre) || []).filter((v) =>
            !query || String(v.prenda || '').toLowerCase().includes(query) || String(v.sku || '').toLowerCase().includes(query)
        );
        
        filtrados.sort((a, b) => {
            if (criterio === 'precio-desc') return (b.precioVenta || 0) - (a.precioVenta || 0);
            if (criterio === 'precio-asc') return (a.precioVenta || 0) - (b.precioVenta || 0);
            if (criterio === 'nombre') return a.prenda.localeCompare(b.prenda);
            return new Date(b.fecha) - new Date(a.fecha);
        });

        const itemsToRender = isFullRefresh ? filtrados : filtrados.filter(v => !document.getElementById(v._id));
        const soloLecturaVisual = esRolVisualizador();

        const crearCardNodo = (v) => {
            const card = document.createElement('div');
            card.id = v._id;
            card.setAttribute('draggable', soloLecturaVisual ? 'false' : 'true');
            if (!soloLecturaVisual) {
                card.setAttribute('ondragstart', `window.handleDragStart(event, '${v._id}')`);
                card.setAttribute('ondragend', `this.classList.remove('dragging')`);
            }
            
            const esStockCritico = est.rolFinanciero === 'Stock' && totalStockPorPrenda[v.prenda] < 2;
            const claseAlertaStock = esStockCritico ? 'alerta-stock-critico border-amber-500/70 bg-amber-500/5' : '';
            card.className = `kanban-card input-bg border p-4 rounded-2xl shadow-sm cursor-grab active:cursor-grabbing hover:scale-[1.01] flex items-center gap-3 select-none ${claseAlertaStock} border-${est.color}-500/30`;
            card.style.contentVisibility = 'auto';
            card.style.containIntrinsicSize = '150px';

            const esScraping = (v.sku && v.sku.startsWith('VNT-')) || (v.comentariosProducto && v.comentariosProducto.includes('Importado'));
            const badgeScraping = esScraping ? `<div class="absolute -top-1.5 -right-1.5 bg-blue-600 rounded-full w-4 h-4 flex items-center justify-center text-[8px] shadow-lg border border-blue-300" title="Alojado en MongoDB (Vía Web/Scraping)">🌐</div>` : '';
            const badgeGaleria = v.galeria && v.galeria.length > 0 ? `<div class="absolute bottom-0 right-0 bg-black/80 rounded px-1 text-[8px] font-bold border border-white/20 shadow-md">+${v.galeria.length}</div>` : '';
            const thumb = v.imagen ? `<div class="relative flex-shrink-0 cursor-pointer hover:scale-105 transition-transform group" onclick="abrirVisorFotos('${v._id}'); event.stopPropagation();" title="Ver Galería de Fotos"><img src="${v.imagen}" loading="lazy" decoding="async" class="card-img-mini border border-white/10 shadow-lg group-hover:border-indigo-400">${badgeScraping}${badgeGaleria}</div>` : `<div class="card-img-mini flex-shrink-0 bg-slate-800 flex items-center justify-center text-[10px] opacity-20 cursor-pointer hover:bg-slate-700 transition-colors border border-dashed border-white/20" onclick="abrirVisorFotos('${v._id}'); event.stopPropagation();" title="Añadir Fotos">📸</div>`;
            const pVentaFormateado = parseFloat(v.precioVenta || 0); const estaMarcado = ITEMS_SELECCIONADOS_MASIVOS.includes(v._id);
            const badgeCanal = v.canalVenta ? `<span class="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-1 py-0.5 rounded text-[8px] font-mono font-bold">${v.canalVenta.toUpperCase()}</span>` : '';
            const badgeTienda = v.proveedor && v.proveedor !== 'Sin definir' ? `<span class="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1 py-0.5 rounded text-[8px] font-mono font-bold">🏬 ${v.proveedor.toUpperCase()}</span>` : '';
            const numEstrellas = parseInt(v.rating || 0, 10); const stringEstrellas = "★".repeat(numEstrellas) + "☆".repeat(5 - numEstrellas); const colorEstrellas = numEstrellas > 0 ? "text-amber-400" : "text-slate-600 opacity-40";
            
            let badgeComentarios = '';
            if (v.comentariosProducto) {
                const comentarioTexto = String(v.comentariosProducto);
                const esImportante = comentarioTexto.toLowerCase().includes('!importante') || comentarioTexto.startsWith('*');
                const claseCss = esImportante ? 'bg-rose-500/20 text-rose-400 border-rose-500/30 animate-pulse' : 'bg-amber-500/10 text-amber-400 border-amber-500/20';
                const titulo = esImportante ? "Ver Comentario IMPORTANTE" : "Ver Comentarios";
                badgeComentarios = `<button onclick="abrirModalComentarios('${v._id}'); event.stopPropagation();" class="${claseCss} px-1.5 py-0.5 rounded text-[8px] font-mono font-bold hover:bg-white/20" title="${titulo}">💬</button>`;
            }

            const badgeEst = `<span class="bg-${est.color}-500/10 text-${est.color}-400 border border-${est.color}-500/20 px-1 py-0.5 rounded text-[8px] font-black uppercase">${est.nombre}</span>`;

            const fechaAlta = v.fecha ? `<span class="text-blue-400/80">📦 ${v.fecha}</span>` : '';
            const fechaVenta = v.fechaVenta ? `<span class="text-emerald-400/80">💰 ${v.fechaVenta}</span>` : '';
            const fechasHtml = (fechaAlta || fechaVenta) ? `<div class="text-[8px] font-mono opacity-80 mt-1.5 flex flex-wrap gap-x-3">${fechaAlta} ${fechaVenta}</div>` : '';
            const miniComentario = v.comentariosProducto ? `<div class="text-[9px] italic opacity-60 mt-1.5 border-l-2 border-white/10 pl-2 truncate" title="${v.comentariosProducto}">${v.comentariosProducto.replace(/!importante/gi, '').replace(/^\*/, '').trim()}</div>` : '';
            const btnAjustarVenta = (!soloLecturaVisual && est.rolFinanciero === 'Venta')
                ? `<button onclick="abrirModalPostVenta(['${v._id}'], '${est.nombre}', { fechaSugerida: '${v.fechaVenta || ''}', comentarioSugerido: ${JSON.stringify(String(v.comentariosProducto || '')).replace(/"/g, '&quot;')}, canalSugerido: '${v.canalVenta || 'Vinted'}' }); event.stopPropagation();" class="text-[9px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded hover:bg-emerald-500/20" title="Ajustar fecha/comentarios de venta">Ajustar venta</button>`
                : '';

            const precioMostrar = soloLecturaVisual ? '•••• €' : `${pVentaFormateado.toFixed(2)} €`;
            const checkboxHtml = soloLecturaVisual
                ? `<div class="w-4 h-4 rounded border border-white/10 opacity-30"></div>`
                : `<input type="checkbox" id="check-${v._id}" ${estaMarcado ? 'checked' : ''} onchange="manejarSeleccionCheckMasiva('${v._id}', this)" class="w-4 h-4 rounded text-blue-600 border-slate-700 bg-black/20 cursor-pointer flex-shrink-0" onclick="event.stopPropagation();">`;
            const onClickEdicion = soloLecturaVisual ? '' : `onclick="editItem('${v._id}'); event.stopPropagation();"`;
            const accionesHtml = soloLecturaVisual ? '' : `
                <div class="flex items-center gap-1.5 flex-shrink-0 text-[11px]">
                    <button onclick="duplicarPrendaIndividual('${v._id}'); event.stopPropagation();" class="bg-current/5 hover:bg-current/10 p-1 rounded-lg" title="Duplicar">👯</button>
                    <button onclick="lanzarModalImpresionEtiqueta('${v._id}'); event.stopPropagation();" class="bg-current/5 hover:bg-current/10 p-1 rounded-lg" title="Imprimir Código QR">🖨️</button>
                    <button onclick="editItem('${v._id}'); event.stopPropagation();" class="text-[10px] text-blue-500 font-bold uppercase hover:underline px-0.5">Editar</button>
                    <button onclick="deleteItem('${v._id}'); event.stopPropagation();" class="opacity-30 hover:opacity-100 text-xs px-0.5" title="Borrar">✕</button>
                </div>`;

            card.innerHTML = `
                ${checkboxHtml}
                ${thumb}
                <div class="flex-1 min-w-0 ${soloLecturaVisual ? '' : 'cursor-pointer hover:opacity-80 transition-opacity'}" ${onClickEdicion} title="${soloLecturaVisual ? 'Modo visualizador: solo lectura' : 'Hacer clic para editar el artículo'}">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <h4 class="font-bold text-xs uppercase tracking-wide truncate">${v.prenda}</h4> 
                        ${badgeCanal} ${badgeTienda} ${badgeEst} ${badgeComentarios}
                    </div>
                    <span class="text-[9px] font-mono opacity-50 block mt-0.5">${v.categoria} • Talla ${v.talla} ${v.sku ? `• 🆔 ${v.sku}` : ''}</span>
                    <div class="text-[11px] mt-0.5 ${colorEstrellas} tracking-tight">${stringEstrellas}</div>
                    
                    ${fechasHtml}
                    ${miniComentario}
                    <span class="text-[10px] font-bold block mt-2 font-mono" style="filter:${soloLecturaVisual ? 'blur(4px)' : 'none'}; opacity:${soloLecturaVisual ? '0.7' : '1'}">${precioMostrar}</span>
                    ${btnAjustarVenta}
                </div>
                ${accionesHtml}`;

            return card;
        };

        const anexarLote = (lote) => {
            if (!Array.isArray(lote) || lote.length === 0) return;
            const fragment = document.createDocumentFragment();
            lote.forEach((v) => fragment.appendChild(crearCardNodo(v)));
            colDom.appendChild(fragment);
        };

        if (isFullRefresh && itemsToRender.length > 60) {
            anexarLote(itemsToRender.slice(0, 18));

            let idx = 18;
            const pintarSiguienteLote = () => {
                if (idx >= itemsToRender.length) return;
                const end = Math.min(idx + 24, itemsToRender.length);
                anexarLote(itemsToRender.slice(idx, end));
                idx = end;
                if (idx < itemsToRender.length) {
                    if ('requestIdleCallback' in window) {
                        window.requestIdleCallback(() => pintarSiguienteLote(), { timeout: 120 });
                    } else {
                        setTimeout(() => requestAnimationFrame(pintarSiguienteLote), 0);
                    }
                }
            };

            requestAnimationFrame(pintarSiguienteLote);
        } else {
            anexarLote(itemsToRender);
        }
        
        const badgeDom = document.getElementById(`badge-kanban-${est._id}`);
        if(badgeDom) badgeDom.innerText = filtrados.length;
    });

    const loaderContainer = document.getElementById('kanban-loader-container');
    if (loaderContainer) {
        if (CURRENT_PAGE >= TOTAL_PAGES) {
            loaderContainer.innerHTML = `<p class="text-white/40 text-xs font-mono py-4">-- Fin del inventario --</p>`;
        } else {
            loaderContainer.innerHTML = `<button onclick="loadMoreData()" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl text-xs uppercase tracking-widest shadow-lg transition-all active:scale-95">Cargar más productos</button>`;
        }
    }
}

function updateTickerWallStreet() {
    const ticker = document.getElementById('ticker-content'); if(!ticker) return; let txt = '';
    
    const tareasActivas = LISTA_TAREAS.filter(t => t.estado !== 'Completada');
    tareasActivas.forEach(t => {
        const icon = t.estado === 'En Proceso' ? '⚙️' : '📌';
        const colorTexto = t.prioridad === 'Alta' ? 'text-rose-400' : (t.estado === 'En Proceso' ? 'text-blue-400' : 'text-amber-400');
        txt += `<span onclick="navegarASeccion('sec-tareas'); setTimeout(() => editarTarea('${t._id}'), 100)" class="text-white font-mono uppercase cursor-pointer hover:bg-white/10 transition-colors mx-3 border border-white/20 bg-black/40 px-2 py-0.5 rounded-full inline-flex items-center gap-1 text-[9px] leading-none"><span class="${colorTexto} font-black">${icon} TAREA ${t.estado.toUpperCase()}:</span> ${t.titulo}</span>`;
    });

    const nombresEstadosReserva = LISTA_ESTADOS_KANBAN.filter(e => e.nombre.toLowerCase().includes('reserva') || e.icono.includes('🤝')).map(e => e.nombre);
    const reservas = BASE_DATOS.filter(v => nombresEstadosReserva.includes(v.estado) || v.estado === 'Reservado');
    reservas.forEach(v => {
        txt += `<span onclick="navegarASeccion('sec-inventario'); setTimeout(() => editItem('${v._id}'), 100)" class="text-white font-mono uppercase cursor-pointer hover:bg-indigo-500/20 transition-colors mx-3 border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 rounded-full inline-flex items-center gap-1 text-[9px] leading-none"><span class="text-indigo-400 font-black">🤝 RESERVA:</span> ${v.prenda} [${v.talla}]</span>`;
    });

    const nombresEstadosVenta = LISTA_ESTADOS_KANBAN.filter(e => e.rolFinanciero === 'Venta').map(e => e.nombre);
    BASE_DATOS.slice(0, 10).forEach(v => { 
        const symbol = nombresEstadosVenta.includes(v.estado) ? '<span class="text-emerald-400">▲</span>' : '<span class="text-amber-400">●</span>'; 
        txt += `<span class="text-white font-mono uppercase mx-3 inline-flex items-center gap-1 text-[9px] leading-none">${symbol} ${v.prenda} [${v.talla}] <b class="text-slate-400 ml-1">${parseFloat(v.precioVenta || 0).toFixed(2)}€</b></span>`; 
    });
    
    ticker.innerHTML = txt + txt;
}

async function manejarEnvioVenta(e) {
    e.preventDefault(); const id = document.getElementById('edit-id').value;
    
    const btnSubmit = document.getElementById('btn-submit');
    const textoOriginalBoton = btnSubmit.innerText;
    const clasesOriginales = btnSubmit.className;
    btnSubmit.innerText = "Guardando...";
    btnSubmit.disabled = true;

    const payload = {
        sku: document.getElementById('sku').value.trim(), 
        prenda: document.getElementById('prenda').value, 
        categoria: document.getElementById('categoria').value, 
        talla: document.getElementById('talla').value, 
        cantidad: parseInt(document.getElementById('cantidad').value) || 1, 
        precioCompra: parseFloat(document.getElementById('precioCompra').value) || 0, 
        precioVenta: parseFloat(document.getElementById('precioVenta').value) || 0, 
        gastosEnvio: parseFloat(document.getElementById('gastosEnvio').value) || 0, 
        canalVenta: document.getElementById('canalVenta').value, 
        imagen: FOTOS_FORMULARIO_TEMP.length > 0 ? FOTOS_FORMULARIO_TEMP[0] : "",
        galeria: FOTOS_FORMULARIO_TEMP.length > 1 ? FOTOS_FORMULARIO_TEMP.slice(1) : [],
        comentariosProducto: document.getElementById('comentariosProducto').value.trim(),
        rating: parseInt(document.getElementById('rating').value, 10) || 0,
        proveedor: document.getElementById('proveedor').value,
        estado: document.getElementById('estado').value
    };

    const url = id ? `${BACKEND_URL}/api/ventas/${id}` : `${BACKEND_URL}/api/ventas`; const method = id ? 'PUT' : 'POST';
    try { 
        const response = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) }); 
        if (response.ok) { 
            btnSubmit.innerText = "¡Guardado con éxito! ✅";
            btnSubmit.className = "w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold text-xs py-3 rounded-xl shadow-md uppercase tracking-widest transition-all";
            setTimeout(async () => {
                cancelEdit(); 
                btnSubmit.className = clasesOriginales;
                await forceRefreshDataManual(); 
            }, 1200);
        } else {
            const errData = await response.json();
            alert("Error al guardar: " + (errData.error || "Puede que la imagen siga siendo muy grande."));
            btnSubmit.innerText = textoOriginalBoton;
            btnSubmit.disabled = false;
        }
    } catch (err) { 
        console.error("Fallo al inyectar producto:", err); 
        alert("Fallo de red al intentar comunicarse con el servidor.");
        btnSubmit.innerText = textoOriginalBoton;
        btnSubmit.disabled = false;
    }
}

function editItem(id) {
    const item = BASE_DATOS.find(v => v._id === id); if (!item) return;
    document.getElementById('edit-id').value = item._id; 
    document.getElementById('sku').value = item.sku || ''; 
    document.getElementById('prenda').value = item.prenda; 
    document.getElementById('categoria').value = item.categoria; 
    document.getElementById('talla').value = item.talla; 
    document.getElementById('estado').value = item.estado;
    document.getElementById('cantidad').value = item.cantidad || 1;
    document.getElementById('precioCompra').value = item.precioCompra || 0; 
    document.getElementById('precioVenta').value = item.precioVenta || 0; 
    document.getElementById('gastosEnvio').value = item.gastosEnvio || 0; 
    document.getElementById('canalVenta').value = item.canalVenta || 'Vinted'; 
    document.getElementById('comentariosProducto').value = item.comentariosProducto || '';
    document.getElementById('proveedor').value = item.proveedor || 'Sin definir';
    
    FOTOS_FORMULARIO_TEMP = [];
    if (item.imagen) FOTOS_FORMULARIO_TEMP.push(item.imagen);
    if (item.galeria && item.galeria.length) FOTOS_FORMULARIO_TEMP.push(...item.galeria);
    actualizarVistaFotosFormulario();

    setFormRating(item.rating || 0); calcularMargenComercialAlVuelo();
    document.getElementById('form-container').className = "card-bg border p-5 rounded-3xl shadow-xl modo-edicion"; 
    document.getElementById('form-title').innerText = "✏️ Editar Artículo"; 
    document.getElementById('btn-submit').innerText = "Guardar Cambios"; 
    document.getElementById('btn-cancel').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEdit() {
    document.getElementById('form-venta').reset(); document.getElementById('edit-id').value = ""; 
    establecerValoresPorDefecto();
    document.getElementById('gastosEnvio').value = 0; document.getElementById('cantidad').value = 1;
    document.getElementById('canalVenta').value = "Vinted"; document.getElementById('comentariosProducto').value = "";
    document.getElementById('estado').value = "No Vendido";
    document.getElementById('proveedor').value = ""; setFormRating(0); calcularMargenComercialAlVuelo();
    cancelFoto();
    document.getElementById('form-container').className = "card-bg border p-5 rounded-3xl shadow-xl"; 
    document.getElementById('form-title').innerText = "Ficha Avanzada"; document.getElementById('btn-submit').innerText = "Registrar Artículo"; 
    document.getElementById('btn-submit').disabled = false;
    document.getElementById('btn-cancel').classList.add('hidden');
}

async function procesarUnArchivo(file) {
    if (file.type === "image/heic" || file.type === "image/heif" || file.name.toLowerCase().endsWith(".heic")) {
        try {
            const convertedBlob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.8 });
            file = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
        } catch (err) {
            console.error("Error convirtiendo HEIC:", err);
            return null;
        }
    }

    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const MAX_WIDTH = 800; const MAX_HEIGHT = 800;
                let width = img.width; let height = img.height;
                if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } } 
                else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } }
                canvas.width = width; canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.onerror = () => resolve(null);
            img.src = e.target.result;
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
}

async function procesarYComprimirFoto(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;
    
    const btnSubmit = document.getElementById('btn-submit');
    const textoBotonOriginal = btnSubmit.innerText;
    btnSubmit.disabled = true;

    for (let i = 0; i < files.length; i++) {
        btnSubmit.innerText = `Comprimiendo ${i + 1}/${files.length}...`;
        const base64 = await procesarUnArchivo(files[i]);
        if (base64) {
            FOTOS_FORMULARIO_TEMP.push(base64);
            actualizarVistaFotosFormulario();
        }
    }

    btnSubmit.innerText = textoBotonOriginal;
    btnSubmit.disabled = false;
    event.target.value = "";
}

function actualizarVistaFotosFormulario() {
    const container = document.getElementById('form-fotos-galeria-container');
    if (!container) return;

    if (FOTOS_FORMULARIO_TEMP.length === 0) {
        container.innerHTML = `
            <div onclick="document.getElementById('input-foto-file').click()" class="preview-foto flex flex-col items-center justify-center bg-black/20 gap-1 w-full border-dashed cursor-pointer hover:bg-black/30 transition-all rounded-xl h-[120px]">
                <span class="text-2xl opacity-50">📁</span>
                <span class="text-[9px] font-bold uppercase opacity-40">Subir Imágenes</span>
            </div>
        `;
    } else {
        let html = '';
        FOTOS_FORMULARIO_TEMP.forEach((b64, i) => {
            html += `
                <div class="relative w-[100px] h-[120px] flex-shrink-0 group rounded-xl overflow-hidden border border-white/10 shadow-sm cursor-pointer" onclick="abrirVisorFilaFormulario(${i})">
                    <img src="${b64}" class="w-full h-full object-cover transition-transform group-hover:scale-110">
                    <button type="button" onclick="eliminarFotoFormulario(event, ${i})" class="absolute top-1 right-1 bg-rose-600 hover:bg-rose-700 text-white w-6 h-6 flex items-center justify-center rounded-full shadow-md text-xs z-10 opacity-0 group-hover:opacity-100 transition-opacity" title="Eliminar foto">✕</button>
                    ${i === 0 ? '<span class="absolute bottom-1 left-1 bg-emerald-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase shadow-md pointer-events-none">Portada</span>' : ''}
                </div>
            `;
        });
        container.innerHTML = html;
    }
}

function eliminarFotoFormulario(e, idx) {
    e.stopPropagation();
    FOTOS_FORMULARIO_TEMP.splice(idx, 1);
    actualizarVistaFotosFormulario();
}

function cancelFoto() {
    FOTOS_FORMULARIO_TEMP = [];
    actualizarVistaFotosFormulario();
}

function setPostVentaRating(estrellasSeleccionadas) {
    document.getElementById('post-venta-rating').value = estrellasSeleccionadas;
    for (let i = 1; i <= 5; i++) {
        const starElement = document.getElementById(`post-star-${i}`);
        if (starElement) {
            if (i <= estrellasSeleccionadas) { starElement.innerText = "★"; starElement.className = "star-rating-btn text-amber-400 font-bold"; }
            else { starElement.innerText = "☆"; starElement.className = "star-rating-btn text-slate-500"; }
        }
    }
}

function abrirModalPostVenta(itemIds, nuevoEstado, opciones = {}) {
    if (!itemIds || itemIds.length === 0) return;

    document.getElementById('post-venta-item-ids').value = JSON.stringify(itemIds);
    document.getElementById('post-venta-nuevo-estado').value = nuevoEstado;

    const tituloEl = document.getElementById('post-venta-prenda-titulo');
    const precioContainerEl = document.getElementById('post-venta-precio-container');
    const envioContainerEl = document.getElementById('post-venta-envio-container');

    if (itemIds.length === 1) {
        const item = BASE_DATOS.find(v => v._id === itemIds[0]);
        if (!item) return;
        
        tituloEl.innerText = item.prenda;
        precioContainerEl.classList.remove('hidden');
        envioContainerEl.classList.remove('hidden');
        document.getElementById('post-venta-precio').value = item.precioVenta || 0;
        document.getElementById('post-venta-envio').value = item.gastosEnvio || 0;
        document.getElementById('post-venta-canal').value = opciones.canalSugerido || item.canalVenta || 'Vinted';
        document.getElementById('post-venta-comentarios').value = opciones.comentarioSugerido || item.comentariosProducto || '';
        setPostVentaRating(item.rating || 0);
    } else {
        tituloEl.innerHTML = `Registrando venta de <span class="font-black text-emerald-300">${itemIds.length}</span> artículos en lote.`;
        precioContainerEl.classList.add('hidden');
        envioContainerEl.classList.add('hidden');
        document.getElementById('post-venta-precio').value = 0;
        document.getElementById('post-venta-canal').value = opciones.canalSugerido || 'Vinted';
        document.getElementById('post-venta-comentarios').value = opciones.comentarioSugerido || 'Venta en lote.';
        setPostVentaRating(0);
    }

    document.getElementById('post-venta-fecha').value = opciones.fechaSugerida || new Date().toISOString().split('T')[0];
    document.getElementById('modal-post-venta').classList.remove('hidden');
}

function cerrarModalPostVenta(ventaConfirmada = false) {
    document.getElementById('modal-post-venta').classList.add('hidden');
    if (!ventaConfirmada) { renderKanban(true); }
}

async function confirmarVentaDesdeModal() {
    const itemIds = JSON.parse(document.getElementById('post-venta-item-ids').value || '[]');
    if (itemIds.length === 0) return;

    const nuevoEstado = document.getElementById('post-venta-nuevo-estado').value;
    const fechaVenta = document.getElementById('post-venta-fecha').value;
    const canalVenta = document.getElementById('post-venta-canal').value;
    const rating = parseInt(document.getElementById('post-venta-rating').value) || 0;
    const comentarios = document.getElementById('post-venta-comentarios').value.trim();
    const precioVentaSingle = parseFloat(document.getElementById('post-venta-precio').value);
    const gastosEnvioSingle = parseFloat(document.getElementById('post-venta-envio').value);

    try {
        const promesas = itemIds.map(id => {
            const itemOriginal = BASE_DATOS.find(v => v._id === id); if (!itemOriginal) return Promise.resolve();
            const payload = { ...itemOriginal, estado: nuevoEstado, fechaVenta: fechaVenta, canalVenta: canalVenta, rating: rating, comentariosProducto: comentarios };
            if (itemIds.length === 1) { payload.precioVenta = precioVentaSingle || itemOriginal.precioVenta; payload.gastosEnvio = gastosEnvioSingle || 0; }
            const { _id, proveedor, ...datosVenta } = payload;
            return fetch(`${BACKEND_URL}/api/ventas/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ ...datosVenta, proveedor: payload.proveedor }) });
        });
        const results = await Promise.all(promesas);
        if (results.every(res => res && res.ok)) { cerrarModalPostVenta(true); await forceRefreshDataManual(); limpiarSeleccionMasiva(); } 
        else { throw new Error('Fallo al actualizar uno o más artículos.'); }
    } catch (err) {
        alert('Error: ' + err.message);
        cerrarModalPostVenta(false);
    }
}

function abrirModalComentarios(itemId) {
    const item = BASE_DATOS.find(v => v._id === itemId);
    if (!item) return;

    document.getElementById('comentarios-item-id').value = itemId;
    document.getElementById('comentarios-prenda-titulo').innerText = item.prenda;
    document.getElementById('comentarios-contenido').value = item.comentariosProducto || '';
    document.getElementById('modal-ver-comentarios').classList.remove('hidden');
    document.getElementById('comentarios-contenido').focus();
}

function cerrarModalComentarios() {
    document.getElementById('modal-ver-comentarios').classList.add('hidden');
}

async function guardarComentariosDesdeModal() {
    const itemId = document.getElementById('comentarios-item-id').value;
    const comentarios = document.getElementById('comentarios-contenido').value;
    if (!itemId) return;

    const itemOriginal = BASE_DATOS.find(v => v._id === itemId);
    if (!itemOriginal) return;

    const payload = { ...itemOriginal, comentariosProducto: comentarios, proveedor: itemOriginal.proveedor };

    try {
        const res = await fetch(`${BACKEND_URL}/api/ventas/${itemId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) });
        if (res.ok) {
            cantarPorVoz("Comentario guardado.");
            cerrarModalComentarios();
            await forceRefreshDataManual();
        } else { throw new Error('Fallo al guardar el comentario.'); }
    } catch (err) { alert('Error: ' + err.message); }
}

async function deleteItem(id) { if (confirm("¿Seguro que deseas eliminar permanentemente este artículo?")) { await fetch(`${BACKEND_URL}/api/ventas/${id}`, { method: 'DELETE', credentials: 'include' }); await forceRefreshDataManual(); } }

async function logout(event) { 
    const btn = event ? event.target : null;
    if(btn) { btn.innerText = "Saliendo..."; btn.disabled = true; }

    const sendLogout = async (clientLocation = null) => {
        await fetch(`${BACKEND_URL}/api/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ clientLocation }) });
        window.location.reload();
    };

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => sendLogout({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
            (err) => sendLogout(null), { timeout: 3000 }
        );
    } else { sendLogout(null); }
}

document.addEventListener('wheel', (e) => {
    const modal = document.getElementById('modal-visor-fotos');
    if (modal && !modal.classList.contains('hidden')) {
        const mainImg = document.getElementById('visor-foto-principal');
        if (mainImg && !mainImg.classList.contains('max-w-full')) {
            return;
        }
        if (e.target.closest('#visor-contenedor-img-parent')) {
            e.preventDefault();
            if (e.deltaY > 0 || e.deltaX > 0) navegarFotoVisor(1);
            else if (e.deltaY < 0 || e.deltaX < 0) navegarFotoVisor(-1);
        }
    }
}, { passive: false });

document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('modal-visor-fotos');
    if (modal && !modal.classList.contains('hidden')) {
        if (e.key === 'ArrowLeft') navegarFotoVisor(-1);
        if (e.key === 'ArrowRight') navegarFotoVisor(1);
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    try {
        document.getElementById('main-body')?.classList.remove('ui-booting');
        configurarForzadoHorizontal();
        iniciarCountdownTrial();
        await cargarNegociosCitasLanding();
        document.getElementById('cita-negocio')?.addEventListener('change', cargarAsesoresCitaLanding);
        mostrarLandingPublica();
        const res = await fetch(`${BACKEND_URL}/api/auth/verificar`, { credentials: 'include' }); 
        const data = await res.json();
        
        if (data.autenticado) { 
            USUARIO_EMAIL_ACTUAL = (data.usuario || '').toLowerCase();
            USUARIO_ROL_ACTUAL = data.rol || 'Editor';
            // Normalize company slug to match server normalization (lowercase, spaces -> '-', trimmed)
            EMPRESA_CHAT_ACTUAL = String(data.empresa || '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 60) || '';
            if (EMPRESA_CHAT_ACTUAL) {
                socket.emit('join_empresa', EMPRESA_CHAT_ACTUAL);
            }
            setTheme(localStorage.getItem('seychelles-theme-multi') || 'dark');
            setParticlesEnabled(false);
            document.getElementById('landing-page')?.classList.add('hidden');
            document.getElementById('login-box').classList.add('hidden'); 
            document.getElementById('panel-control').classList.remove('hidden'); 
            document.getElementById('ticker-bar').classList.remove('hidden'); 
            document.getElementById('internal-chat-btn')?.classList.remove('hidden');
            document.getElementById('user-display').innerText = `👤 Conectado: ${data.usuario.split('@')[0]} [${data.rol}]`; 
            aplicarMascaraVisualizadorEnUI();

            aplicarRestriccionesRolUI();

            const yearEl = document.getElementById('admin-profit-year');
            if (yearEl && !yearEl.value) {
                yearEl.value = String(new Date().getFullYear());
            }
            onCambiarPresetGananciasAdmin();

            const cards3D = document.querySelectorAll('.kpi-3d-card');
            const handleCardMouseMove = throttle(function(e, card) {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left; const y = e.clientY - rect.top;
                const centerX = rect.width / 2; const centerY = rect.height / 2;
                const rotateX = ((y - centerY) / centerY) * -12;
                const rotateY = ((x - centerX) / centerX) * 12;
                card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.03, 1.03, 1.03)`;
            }, 16);

            cards3D.forEach(card => {
                card.addEventListener('mousemove', e => handleCardMouseMove(e, card));
                card.addEventListener('mouseleave', () => { card.style.transform = `perspective(1000px) rotateX(0) rotateY(0) scale3d(1, 1, 1)`; });
            });

            const ejecutarPasoInit = async (label, fn) => {
                try {
                    await fn();
                } catch (stepErr) {
                    console.warn(`[INIT] Paso fallido (${label}):`, stepErr?.message || stepErr);
                }
            };

            await ejecutarPasoInit('refrescarEstadosKanban', async () => refrescarEstadosKanban());
            aplicarRestriccionesRolUI();

            // Primer paint instantáneo con snapshot local por empresa mientras llega el backend.
            pintarInventarioDesdeCacheInicial();

            // Prioridad: mostrar productos cuanto antes.
            await ejecutarPasoInit('reloadCoreData', async () => reloadCoreData(true));

            // Cargas secundarias: ejecutarlas en background para no frenar la percepción de fluidez.
            const iniciarTareasSecundarias = () => {
                ejecutarPasoInit('refrescarYListarTiendasCloud', async () => refrescarYListarTiendasCloud());
                ejecutarPasoInit('refrescarCategoriasCloud', async () => refrescarCategoriasCloud());
                ejecutarPasoInit('renderSavedUrls', async () => renderSavedUrls());
                ejecutarPasoInit('refrescarCitas', async () => refrescarCitas());
                ejecutarPasoInit('actualizarBadgeCitasNav', async () => actualizarBadgeCitasNav());
                ejecutarPasoInit('cargarNotasBoard', async () => cargarNotasBoard());
                actualizarVistaFotosFormulario();
                poblarFiltroEstadosVentaAnalitica();
                onCambiarPeriodoAnalitica();
            };
            if ('requestIdleCallback' in window) {
                window.requestIdleCallback(() => iniciarTareasSecundarias(), { timeout: 800 });
            } else {
                setTimeout(() => iniciarTareasSecundarias(), 120);
            }

            const monopolioUrlInput = document.getElementById('monopolio-url-input');
            if (monopolioUrlInput) {
                monopolioUrlInput.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        guardarMonopolioUrl(ev);
                    }
                });
            }

            const formMonopolio = document.getElementById('form-monopolio-url');
            if (formMonopolio) {
                formMonopolio.addEventListener('submit', (ev) => {
                    ev.preventDefault();
                    guardarMonopolioUrl(ev);
                });
            }

            const reactivarCamaraSiHaceFalta = async () => {
                const modulo = document.getElementById('modulo-camara');
                if (!modulo || modulo.classList.contains('hidden')) return;
                if (ESCANER_CAMARA_INICIANDO || ESCANER_CAMARA_ACTIVO) return;
                await iniciarEscanerCamara(ESCANER_CAMARA_ID_ACTUAL || '');
            };

            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    setTimeout(() => { reactivarCamaraSiHaceFalta(); }, 250);
                }
            });
            window.addEventListener('focus', () => { reactivarCamaraSiHaceFalta(); });
        }
    } catch(e){ console.error("Error en la inicialización:", e); }
});

if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(err => {}); }); }

if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => setParticlesEnabled(true), { timeout: 1500 });
} else {
    setTimeout(() => setParticlesEnabled(true), 800);
}

