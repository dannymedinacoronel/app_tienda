const BACKEND_URL = '';
let BASE_DATOS = [];
let LISTA_TIENDAS_GLOBAL = [];
let LISTA_GASTOS_GLOBAL = [];
let LISTA_CATEGORIAS_GLOBAL = [];
let LISTA_CLIENTES_CACHE = [];
let INSTANCIA_CHARTS = null;
let INSTANCIA_TARTA = null;
let INSTANCIA_BARRAS = null;
let INSTANCIA_MAPA_CALOR = null;
let INSTANCIA_TOP_PRODUCTOS = null;
let INSTANCIA_RENTABILIDAD_CANAL = null;
let OBJETO_ESCANER_CAMARA = null;
let HISTORIAL_TIMESTAMPS_OPERACIONES = [];
let LECTOR_BLOQUEADO_POR_CAPTURA = false;
let ITEMS_SELECCIONADOS_MASIVOS = [];
let SOUND_MUTED_GLOBAL = false;
let CONFIG_ORDEN_COLUMNAS = { 'No Vendido': 'reciente', 'Vendido': 'reciente', 'Devuelto': 'reciente' };
let CONFIG_FILTRO_COLUMNAS = { 'No Vendido': '', 'Vendido': '', 'Devuelto': '', 'Reservado': '' };
let CALENDARIO_MES = new Date().getMonth() + 1;
let CALENDARIO_ANIO = new Date().getFullYear();
let CAL_STOCK_MES = new Date().getMonth() + 1;
let CAL_STOCK_ANIO = new Date().getFullYear();
let LOGS_MES_ACTUAL = {};
let NOTAS_LOCALES = [];
let LISTA_TAREAS = [];
let LISTA_FAQS = [];
let LISTA_ESTADOS_KANBAN = [];
let GLOBO_INSTANCE = null;
let FOTOS_FORMULARIO_TEMP = [];
let ROL_USUARIO_ACTUAL = 'Admin'; // Rol por defecto hasta que se verifique
let resultadosScraperActual = null;
let CHAT_USUARIOS = [];
let CHAT_GRUPOS = [];
let CHAT_WEBSOCKET = null;
let CHAT_CONVERSACION_ACTIVA = null; // { tipo: 'user'/'group', id: '...', nombre: '...' }
let CHAT_NOTIFICACIONES = {}; // { email: count }
const SECCIONES_DISPONIBLES = [
    { id: 'sec-inventario', nombre: '📦 Panel Inventario', desc: 'Vista principal del Kanban y gestión de productos.' },
    { id: 'sec-tareas', nombre: '✅ Tareas', desc: 'Tablero de tareas pendientes, en proceso y completadas.' },
    { id: 'sec-analitica', nombre: '📊 Analítica', desc: 'Gráficos de rendimiento, ventas y rentabilidad.' },
    { id: 'sec-gastos', nombre: '💸 Gastos', desc: 'Registro y control de gastos operativos (OpEx).' },
    { id: 'sec-crm', nombre: '👥 CRM', desc: 'Base de datos y gestión de fichas de clientes.' },
    { id: 'sec-gestion', nombre: '📋 Facturación', desc: 'Generador de facturas en PDF para clientes.' },
    { id: 'sec-notas', nombre: '📝 Notas', desc: 'Tablero de notas adhesivas para ideas y recordatorios.' },
    { id: 'sec-auditoria', nombre: '📜 Logs', desc: 'Registro de actividad y calendario de eventos.' },
    { id: 'sec-usuarios', nombre: '🔑 Gestión de Acceso', desc: 'Añadir o eliminar usuarios que pueden acceder al sistema.' },
    { id: 'sec-faqs', nombre: '❓ FAQs', desc: 'Crear y editar la base de conocimiento interna.' },
    { id: 'sec-ajustes', nombre: '⚙️ Ajustes', desc: 'Configuración del negocio, Kanban y permisos.' },
    { id: 'sec-mi-cuenta', nombre: '👤 Mi Cuenta', desc: 'Ver uso del plan y gestionar la suscripción.' },
    { id: 'sec-comunicaciones', nombre: '💬 Comms', desc: 'Anuncios globales y chat interno del equipo.' }];

function setTheme(themeName) {
    const body = document.getElementById('main-body');
    if (!body) return;
    // Lista de todos los temas posibles para limpiar
    const themes = ['theme-dark', 'theme-light', 'theme-pink', 'theme-emerald', 'theme-purple', 'theme-premium'];
    themes.forEach(t => body.classList.remove(t));
    // Añadir el nuevo tema
    body.classList.add(`theme-${themeName}`);
    localStorage.setItem('seychelles-theme-multi', themeName);
}

// 📸 LÓGICA DE VISOR Y GALERÍA DE FOTOS
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

function cerrarVisorFotos() {
    document.getElementById('modal-visor-fotos').classList.add('hidden');
    ITEM_FOTOS_ACTUAL = null;
    
    // Restaurar botones por si se ocultaron en la vista previa del Scraper
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
        imgElement.src = 'https://via.placeholder.com/800x600/0f172a/ffffff?text=Sin+Fotografias';
        if (btnPortada) btnPortada.classList.add('hidden');
        return;
    }
    
    if (idx === -1) {
        imgElement.src = ITEM_FOTOS_ACTUAL.imagen;
        if (btnPortada) btnPortada.classList.add('hidden');
    } else {
        imgElement.src = ITEM_FOTOS_ACTUAL.galeria[idx];
        if (btnPortada) btnPortada.classList.remove('hidden');
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

            try { await fetch(`${BACKEND_URL}/api/ventas/${ITEM_FOTOS_ACTUAL._id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) }); await reloadCoreData(); ITEM_FOTOS_ACTUAL = BASE_DATOS.find(v => v._id === ITEM_FOTOS_ACTUAL._id); if (!ITEM_FOTOS_ACTUAL.galeria) ITEM_FOTOS_ACTUAL.galeria = []; seleccionarFotoVisor(payload.imagen ? -1 : ITEM_FOTOS_ACTUAL.galeria.length - 1); } 
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

    try { await fetch(`${BACKEND_URL}/api/ventas/${ITEM_FOTOS_ACTUAL._id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) }); await reloadCoreData(); ITEM_FOTOS_ACTUAL = BASE_DATOS.find(v => v._id === ITEM_FOTOS_ACTUAL._id); if (!ITEM_FOTOS_ACTUAL.galeria) ITEM_FOTOS_ACTUAL.galeria = []; seleccionarFotoVisor(ITEM_FOTOS_ACTUAL.imagen ? -1 : -1); } 
    catch(e) { alert("Error al eliminar."); }
}

async function establecerComoPortada() {
    if (IDX_FOTO_ACTUAL === -1) return;
    const fotoSeleccionada = ITEM_FOTOS_ACTUAL.galeria[IDX_FOTO_ACTUAL]; const fotoPrincipalAntigua = ITEM_FOTOS_ACTUAL.imagen;
    ITEM_FOTOS_ACTUAL.imagen = fotoSeleccionada; ITEM_FOTOS_ACTUAL.galeria.splice(IDX_FOTO_ACTUAL, 1); if (fotoPrincipalAntigua) { ITEM_FOTOS_ACTUAL.galeria.unshift(fotoPrincipalAntigua); }
    try { await fetch(`${BACKEND_URL}/api/ventas/${ITEM_FOTOS_ACTUAL._id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ imagen: ITEM_FOTOS_ACTUAL.imagen, galeria: ITEM_FOTOS_ACTUAL.galeria }) }); await reloadCoreData(); ITEM_FOTOS_ACTUAL = BASE_DATOS.find(v => v._id === ITEM_FOTOS_ACTUAL._id); if (!ITEM_FOTOS_ACTUAL.galeria) ITEM_FOTOS_ACTUAL.galeria = []; seleccionarFotoVisor(-1); } 
    catch(e) { alert("Error al cambiar portada."); }
}

// 📌 LÓGICA DE NOTAS ADHESIVAS
async function cargarNotasBoard() {
    const res = await fetch(`${BACKEND_URL}/api/notas`, { credentials: 'include' });
    NOTAS_LOCALES = await res.json();
    renderizarNotas();
}

// 🎛️ CONFIGURADOR DE TABLERO KANBAN DINÁMICO
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
        // Actualizar dropdown del formulario
        const selectForm = document.getElementById('estado');
        if (selectForm) {
        const valActual = selectForm.value;
        selectForm.innerHTML = LISTA_ESTADOS_KANBAN.map(e => `<option value="${e.nombre}">${e.icono} ${e.nombre}</option>`).join('');
        if (valActual && LISTA_ESTADOS_KANBAN.find(e => e.nombre === valActual)) selectForm.value = valActual;
        }

        // Actualizar botones masivos
        const panelBotones = document.getElementById('botones-estados-masivos');
        if(panelBotones) {
            panelBotones.innerHTML = LISTA_ESTADOS_KANBAN.map(e => `
                <button onclick="ejecutarAccionMasivaEstado('${e.nombre}')" class="bg-${e.color || 'slate'}-600 hover:bg-${e.color || 'slate'}-700 text-white font-bold text-[10px] uppercase px-2.5 py-2 rounded-xl transition-colors shadow-lg whitespace-nowrap">${e.icono || ''} ➡️ ${e.nombre}</button>
            `).join('');
        }
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
    limpiarFormEstadoKanban(); await refrescarEstadosKanban(); renderKanban(); recalcularKPIsLocalesOptimistas();
}
function editarEstadoKanban(id) { const e = LISTA_ESTADOS_KANBAN.find(x => x._id === id); if(!e) return; document.getElementById('ek-id').value = e._id; document.getElementById('ek-nombre').value = e.nombre; document.getElementById('ek-icono').value = e.icono; document.getElementById('ek-color').value = e.color; document.getElementById('ek-rol').value = e.rolFinanciero; document.getElementById('ek-orden').value = e.orden; }
function limpiarFormEstadoKanban() { document.getElementById('form-estado-kanban').reset(); document.getElementById('ek-id').value = ''; }
async function borrarEstadoKanban(id) { if(confirm("¿Eliminar columna del tablero? Los productos conservarán su estado textualmente, pero desaparecerán de la vista principal hasta que los reasignes.")) { await fetch(`/api/estados-kanban/${id}`, { method: 'DELETE', credentials: 'include' }); await refrescarEstadosKanban(); renderKanban(); } }

// 🏷️ LÓGICA DE CATEGORÍAS DINÁMICAS
async function refrescarCategoriasCloud() {
    const selectForm = document.getElementById('categoria');
    const selectFiltro = document.getElementById('filtro-categoria');
    const selectAn = document.getElementById('an-filtro-categoria');
    const selectMasivo = document.getElementById('categoria-masiva');
    try {
        const res = await fetch(`${BACKEND_URL}/api/categorias`, { credentials: 'include' });
        const data = await res.json();
        LISTA_CATEGORIAS_GLOBAL = data.categorias || [];
        
        selectForm.innerHTML = '';
        if(selectFiltro) selectFiltro.innerHTML = '<option value="TODOS">👕 Todas las categorías</option>';
        if(selectAn) selectAn.innerHTML = '<option value="TODOS">👕 Todas</option>';
        if(selectMasivo) selectMasivo.innerHTML = '<option value="">👕 Categoría...</option>';

        LISTA_CATEGORIAS_GLOBAL.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.nombre; opt.textContent = c.nombre;
            selectForm.appendChild(opt.cloneNode(true));
            if(selectFiltro) selectFiltro.appendChild(opt.cloneNode(true));
            if(selectAn) selectAn.appendChild(opt.cloneNode(true));
            if(selectMasivo) selectMasivo.appendChild(opt.cloneNode(true));
        });
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
    } catch (e) {
        console.error("Error creando categoría", e);
        alert("Fallo de red al crear categoría.");
    }
}

async function editarCategoriaSeleccionadaDB() {
    const select = document.getElementById('categoria');
    const nombreActual = select.value;
    if (!nombreActual) return alert("Selecciona una categoría para editar.");
    const nuevoNombre = prompt("Nuevo nombre para la categoría:", nombreActual);
    if (!nuevoNombre || nuevoNombre.trim() === "" || nuevoNombre.trim() === nombreActual) return;

    const categoria = LISTA_CATEGORIAS_GLOBAL.find(c => c.nombre === nombreActual);
    if (!categoria) return alert("Categoría no encontrada.");

    await fetch(`${BACKEND_URL}/api/categorias/${categoria._id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ nombre: nuevoNombre.trim() }) });
    cantarPorVoz("Categoría actualizada.");
    await refrescarCategoriasCloud();
    select.value = nuevoNombre.trim();
}

async function eliminarCategoriaSeleccionadaDB() {
    const select = document.getElementById('categoria');
    const nombreActual = select.value;
    if (!nombreActual) return alert("Selecciona una categoría para eliminar.");
    if (!confirm(`¿Seguro que quieres eliminar la categoría "${nombreActual}"? Esta acción no se puede deshacer.`)) return;

    const categoria = LISTA_CATEGORIAS_GLOBAL.find(c => c.nombre === nombreActual);
    if (!categoria) return alert("Categoría no encontrada.");

    await fetch(`${BACKEND_URL}/api/categorias/${categoria._id}`, { method: 'DELETE', credentials: 'include' });
    cantarPorVoz("Categoría eliminada.");
    await refrescarCategoriasCloud();
}

async function crearNuevaTiendaEnBaseDatos() {
    const nombre = prompt("Nombre de la nueva tienda/proveedor:");
    if (!nombre || nombre.trim() === "") return;
    try {
        const res = await fetch(`${BACKEND_URL}/api/tiendas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ nombre: nombre.trim() })
        });
        if (res.ok) {
            cantarPorVoz("Tienda añadida.");
            await refrescarYListarTiendasCloud();
            document.getElementById('proveedor').value = nombre.trim();
        } else {
            const err = await res.json(); alert(err.error || "Error al crear tienda.");
        }
    } catch (e) {
        console.error("Error creando tienda", e);
        alert("Fallo de red al crear tienda.");
    }
}

async function eliminarTiendaSeleccionadaCloud() {
    const select = document.getElementById('proveedor');
    const nombreActual = select.value;
    if (!nombreActual) return alert("Selecciona una tienda para eliminar.");
    if (!confirm(`¿Seguro que quieres eliminar la tienda "${nombreActual}"? Los productos asociados quedarán sin tienda.`)) return;

    const tienda = LISTA_TIENDAS_GLOBAL.find(t => t.nombre === nombreActual);
    if (!tienda) return alert("Tienda no encontrada.");

    await fetch(`${BACKEND_URL}/api/tiendas/${tienda._id}`, { method: 'DELETE', credentials: 'include' });
    cantarPorVoz("Tienda eliminada.");
    await refrescarYListarTiendasCloud();
}

async function refrescarYListarTiendasCloud() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/tiendas`, { credentials: 'include' });
        const data = await res.json();
        LISTA_TIENDAS_GLOBAL = data.tiendas || [];
        
        const selectProveedor = document.getElementById('proveedor');
        const selectTiendaMasiva = document.getElementById('tienda-masiva');
        const selectAnTienda = document.getElementById('an-filtro-tienda');

        if (selectProveedor) {
            selectProveedor.innerHTML = '<option value="">Sin tienda asignada</option>';
            LISTA_TIENDAS_GLOBAL.forEach(t => {
                selectProveedor.innerHTML += `<option value="${t.nombre}">${t.nombre}</option>`;
            });
        }
        if (selectTiendaMasiva) {
            selectTiendaMasiva.innerHTML = '<option value="">🏬 Tienda...</option>';
             LISTA_TIENDAS_GLOBAL.forEach(t => {
                selectTiendaMasiva.innerHTML += `<option value="${t.nombre}">${t.nombre}</option>`;
            });
        }
        if (selectAnTienda) {
            selectAnTienda.innerHTML = '<option value="TODOS">🏬 Todas</option>';
             LISTA_TIENDAS_GLOBAL.forEach(t => {
                selectAnTienda.innerHTML += `<option value="${t.nombre}">${t.nombre}</option>`;
            });
        }

    } catch (e) {
        console.error("Error cargando tiendas:", e);
    }
}

async function reloadCoreData() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/ventas`, { credentials: 'include' });
        const data = await res.json();
        if (data.error) {
            console.error("Error reloading core data:", data.error);
            if (data.error.includes("No autorizado")) {
                window.location.reload();
            }
            return;
        }
        BASE_DATOS = data.ventas || [];
        
        const resumen = data.resumen || {};
        if (document.getElementById('kpi-ingresos')) {
            document.getElementById('kpi-ingresos').innerText = `${(resumen.ingresos || 0).toFixed(2)} €`;
            document.getElementById('kpi-beneficio').innerText = `${(resumen.beneficio || 0).toFixed(2)} €`;
            document.getElementById('kpi-inversion').innerText = `${(resumen.inversion || 0).toFixed(2)} €`;
            document.getElementById('kpi-roi').innerText = `${(resumen.roi || 0).toFixed(2)}%`;
            document.getElementById('kpi-prendas').innerText = resumen.prendasVendidas || 0;
        }

        renderKanban();
        updateTickerWallStreet();
    } catch (e) {
        console.error("Critical error reloading core data:", e);
    }
}

function renderKanban() {
            // Limpiar columnas antes de renderizar
            const wrapper = document.getElementById('kanban-dynamic-wrapper');
            if (!wrapper) return;
            wrapper.innerHTML = '';

            LISTA_ESTADOS_KANBAN.forEach(est => {
                const vCount = BASE_DATOS.filter(v => v.estado === est.nombre).reduce((acc, v) => acc + (v.cantidad || 1), 0);
                
                const colHTML = `
                <div class="card-bg border rounded-3xl p-4 flex flex-col min-h-[600px] shadow-xl">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-[10px] font-black text-${est.color}-500 uppercase tracking-widest flex items-center gap-1.5">${est.icono} ${est.nombre}</h3>
                        <span id="badge-kanban-${est._id}" class="bg-${est.color}-500/10 text-${est.color}-400 border border-${est.color}-500/20 text-[10px] font-bold px-2 py-0.5 rounded-lg">${vCount}</span>
                    </div>
                    <div id="col-${est._id}" class="flex-1 space-y-3 overflow-y-auto pr-1 pb-10 custom-scrollbar" ondragover="allowDrop(event)" ondrop="handleDrop(event, '${est.nombre}')" ondragleave="clearDrop(event)">
                        <!-- Inyectado vía JS -->
                    </div>
                </div>`;
                wrapper.innerHTML += colHTML;
            });

            // Ahora que las columnas existen, llenarlas
            LISTA_ESTADOS_KANBAN.forEach(est => {
                const colDom = document.getElementById(`col-${est._id}`);
                if (!colDom) return;

                const itemsColumna = BASE_DATOS.filter(v => v.estado === est.nombre);
                let vCount = 0;

                itemsColumna.forEach(v => {
                    const estaMarcado = ITEMS_SELECCIONADOS_MASIVOS.includes(v._id);
                    const pVentaFormateado = parseFloat(v.precioVenta || 0);
                    const stringEstrellas = '★'.repeat(v.rating || 0) + '☆'.repeat(5 - (v.rating || 0));
                    const colorEstrellas = (v.rating || 0) > 0 ? 'text-amber-400' : 'text-slate-600';

                    const card = document.createElement('div');
                    card.id = v._id;
                    card.draggable = ROL_USUARIO_ACTUAL !== 'Lector';
                    card.ondragstart = (e) => handleDragStart(e, v._id);
                    card.className = `kanban-card card-bg border p-3 rounded-2xl flex items-start gap-3 shadow-lg ${estaMarcado ? 'ring-2 ring-blue-500' : ''}`;

                    const thumb = `<div class="relative flex-shrink-0 cursor-pointer group" onclick="abrirVisorFotos('${v._id}')" title="Ver Galería">
                                      <img src="${v.imagen || 'https://via.placeholder.com/100x100/0f172a/1e293b?text=S/F'}" class="card-img-mini shadow-md group-hover:scale-105 transition-transform">
                                      ${(v.galeria && v.galeria.length > 0) ? `<div class="absolute -bottom-1 -right-1 bg-indigo-600 text-white rounded-full text-[8px] w-4 h-4 flex items-center justify-center font-black border-2 border-slate-800 pointer-events-none">+${v.galeria.length}</div>` : ''}
                                   </div>`;
                    
                    const badgeCanal = `<span class="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded bg-current/5">${v.canalVenta || 'N/A'}</span>`;
                    const badgeTienda = v.proveedor ? `<span class="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">${v.proveedor}</span>` : '';
                    const badgeEst = `<span class="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">${v.estado}</span>`;

                    let botonesAccion = '';
                    if (ROL_USUARIO_ACTUAL !== 'Lector') {
                        botonesAccion = `<div class="flex items-center gap-1.5">
                                <button onclick="lanzarModalImpresionEtiqueta('${v._id}'); event.stopPropagation();" class="bg-current/5 hover:bg-current/10 p-1 rounded-lg" title="Imprimir Código QR">🖨️</button>
                                <button onclick="editItem('${v._id}'); event.stopPropagation();" class="text-[10px] text-blue-500 font-bold uppercase hover:underline px-0.5">Editar</button>
                                <button onclick="deleteItem('${v._id}'); event.stopPropagation();" class="opacity-30 hover:opacity-100 text-xs px-0.5" title="Borrar">✕</button>
                            </div>`;
                    }

                    card.innerHTML = `
                        <input type="checkbox" id="check-${v._id}" ${estaMarcado ? 'checked' : ''} onchange="manejarSeleccionCheckMasiva('${v._id}', this)" 
                               class="w-4 h-4 rounded text-blue-600 border-slate-700 bg-black/20 cursor-pointer flex-shrink-0" 
                               onclick="event.stopPropagation();" ${ROL_USUARIO_ACTUAL === 'Lector' ? 'disabled' : ''}>
                        ${thumb}
                        <div class="flex-1 min-w-0 ${ROL_USUARIO_ACTUAL !== 'Lector' ? 'cursor-pointer hover:opacity-80' : ''} transition-opacity" 
                             ${ROL_USUARIO_ACTUAL !== 'Lector' ? `onclick="editItem('${v._id}'); event.stopPropagation();"` : ''} 
                             title="${ROL_USUARIO_ACTUAL !== 'Lector' ? 'Hacer clic para editar el artículo' : ''}">
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <h4 class="font-bold text-xs uppercase tracking-wide truncate">${v.prenda}</h4> 
                                ${badgeCanal} ${badgeTienda} ${badgeEst}
                            </div>
                            <span class="text-[9px] font-mono opacity-50 block mt-0.5">${v.categoria} • Talla ${v.talla} ${v.sku ? `• 🆔 ${v.sku}` : ''}</span>
                            <div class="text-[11px] mt-0.5 ${colorEstrellas} tracking-tight">${stringEstrellas}</div>
                            <span class="text-[10px] font-bold block mt-1 font-mono">${pVentaFormateado.toFixed(2)} €</span>
                        </div>
                        ${botonesAccion}`;

                    colDom.appendChild(card);
                    vCount += (v.cantidad || 1);
                });
                
                const badgeDom = document.getElementById(`badge-kanban-${est._id}`);
                if(badgeDom) badgeDom.innerText = vCount;
            });
        }

function updateTickerWallStreet() {
    const ticker = document.getElementById('ticker-content'); if(!ticker) return; let txt = '';
    
    // 1. TAREAS ACTIVAS (Urgencia y Proceso)
    const tareasActivas = LISTA_TAREAS.filter(t => t.estado !== 'Completada');
    tareasActivas.forEach(t => {
        const icon = t.estado === 'En Proceso' ? '⚙️' : '📌';
        const colorTexto = t.prioridad === 'Alta' ? 'text-rose-400' : (t.estado === 'En Proceso' ? 'text-blue-400' : 'text-amber-400');
        txt += `<span onclick="navegarASeccion('sec-tareas'); setTimeout(() => editarTarea('${t._id}'), 100)" class="text-white font-mono uppercase cursor-pointer hover:bg-white/10 transition-colors mx-4 border border-white/20 bg-black/40 px-3 py-1 rounded-full inline-flex items-center gap-1.5"><span class="${colorTexto} font-black">${icon} TAREA ${t.estado.toUpperCase()}:</span> ${t.titulo}</span>`;
    });

    // 2. ARTÍCULOS RESERVADOS
    const nombresEstadosReserva = LISTA_ESTADOS_KANBAN.filter(e => e.nombre.toLowerCase().includes('reserva') || e.icono.includes('🤝')).map(e => e.nombre);
    const reservas = BASE_DATOS.filter(v => nombresEstadosReserva.includes(v.estado) || v.estado === 'Reservado');
    reservas.forEach(v => {
        txt += `<span onclick="navegarASeccion('sec-inventario'); setTimeout(() => editItem('${v._id}'), 100)" class="text-white font-mono uppercase cursor-pointer hover:bg-indigo-500/20 transition-colors mx-4 border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 rounded-full inline-flex items-center gap-1.5"><span class="text-indigo-400 font-black">🤝 RESERVA:</span> ${v.prenda} [${v.talla}]</span>`;
    });

    // 3. PRODUCTOS RECIENTES (Últimos 10)
    const nombresEstadosVenta = LISTA_ESTADOS_KANBAN.filter(e => e.rolFinanciero === 'Venta').map(e => e.nombre);
    BASE_DATOS.slice(0, 10).forEach(v => { 
        const symbol = nombresEstadosVenta.includes(v.estado) ? '<span class="text-emerald-400">▲</span>' : '<span class="text-amber-400">●</span>'; 
        txt += `<span class="text-white font-mono uppercase mx-4 inline-flex items-center gap-1">${symbol} ${v.prenda} [${v.talla}] <b class="text-slate-400 ml-1">${parseFloat(v.precioVenta || 0).toFixed(2)}€</b></span>`; 
    });
    
    ticker.innerHTML = txt + txt; // Duplicar para efecto infinito suave
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
        proveedor: document.getElementById('proveedor').value
    };
    if (id) { const itemOriginal = BASE_DATOS.find(v => v._id === id); if (itemOriginal) payload.estado = itemOriginal.estado; }
    const url = id ? `${BACKEND_URL}/api/ventas/${id}` : `${BACKEND_URL}/api/ventas`; const method = id ? 'PUT' : 'POST';
    try { 
        const response = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) }); 
        if (response.ok) { 
            btnSubmit.innerText = "¡Guardado con éxito! ✅";
            btnSubmit.className = "w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold text-xs py-3 rounded-xl shadow-md uppercase tracking-widest transition-all";
            setTimeout(async () => {
                cancelEdit(); 
                btnSubmit.className = clasesOriginales;
                await reloadCoreData(); 
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
    document.getElementById('proveedor').value = item.proveedor || '';
    
    FOTOS_FORMULARIO_TEMP = [];
    if (item.imagen) FOTOS_FORMULARIO_TEMP.push(item.imagen);
    if (item.galeria && item.galeria.length) FOTOS_FORMULARIO_TEMP.push(...item.galeria);
    actualizarVistaFotosFormulario();

    setFormRating(item.rating || 0); calcularMargenComercialAlVuelo();
    document.getElementById('form-container').className = "card-bg border p-5 rounded-3xl shadow-xl modo-edicion"; 
    document.getElementById('form-title').innerText = "✏️ Editar Artículo"; 
    document.getElementById('btn-submit').innerText = "Guardar Cambios"; 
    document.getElementById('btn-cancel').classList.remove('hidden');
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

async function procesarYComprimirFoto(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;
    
    const btnSubmit = document.getElementById('btn-submit');
    const textoBotonOriginal = btnSubmit.innerText;
    btnSubmit.innerText = "Comprimiendo imágenes...";
    btnSubmit.disabled = true;

    for (let file of files) {
        if (file.type === "image/heic" || file.type === "image/heif" || file.name.toLowerCase().endsWith(".heic")) {
            try {
                const convertedBlob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.8 });
                file = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
            } catch (err) { continue; }
        }

        const base64 = await new Promise((resolve) => {
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
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
        
        FOTOS_FORMULARIO_TEMP.push(base64);
    }

    actualizarVistaFotosFormulario();
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

async function deleteItem(id) { if (confirm("¿Seguro que deseas eliminar permanentemente este artículo?")) { await fetch(`${BACKEND_URL}/api/ventas/${id}`, { method: 'DELETE', credentials: 'include' }); await reloadCoreData(); } }

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

// --- CONTROLADORES DE TECLADO Y SCROLL PARA LA GALERÍA ---
document.addEventListener('wheel', (e) => {
    const modal = document.getElementById('modal-visor-fotos');
    if (modal && !modal.classList.contains('hidden')) {
        const mainImg = document.getElementById('visor-foto-principal');
        if (mainImg && !mainImg.classList.contains('max-w-full')) {
            return; // Permitir scroll nativo cuando la imagen está ampliada con Zoom
        }
        if (e.target.closest('#visor-contenedor-img-parent')) {
            e.preventDefault();
            if (e.deltaY > 0 || e.deltaX > 0) navegarFotoVisor(1);
            else if (e.deltaY < 0 || e.deltaX < 0) navegarFotoVisor(-1);
        }
    }
}, { passive: false });

async function solicitarEliminacionCuenta() {
    try {
        const negocioRes = await fetch(`${BACKEND_URL}/api/negocio/detalles`, { credentials: 'include' });
        if (!negocioRes.ok) throw new Error("No se pudo obtener el nombre del negocio.");
        const negocio = await negocioRes.json();
        const nombreNegocio = negocio.nombre;

        const confirm1 = prompt(`ZONA DE PELIGRO:\n\nEsta acción eliminará PERMANENTEMENTE tu negocio y todos los datos asociados (productos, clientes, ventas, etc.).\n\nPara confirmar, escribe el nombre de tu negocio: "${nombreNegocio}"`);
        if (confirm1 !== nombreNegocio) {
            alert("La confirmación no coincide. Operación cancelada.");
            return;
        }

        const confirm2 = confirm("ÚLTIMO AVISO:\n\n¿Estás absolutamente seguro de que quieres borrar todo? Esta acción no se puede deshacer.");
        if (!confirm2) {
            alert("Operación cancelada.");
            return;
        }

        const deleteRes = await fetch(`${BACKEND_URL}/api/negocio/mi-cuenta`, {
            method: 'DELETE',
            credentials: 'include'
        });

        const data = await deleteRes.json();
        if (deleteRes.ok) {
            alert("Tu cuenta y todos tus datos han sido eliminados con éxito. Serás redirigido.");
            window.location.href = "/";
        } else {
            throw new Error(data.error || "Error desconocido durante la eliminación.");
        }
    } catch (error) {
        alert("Error al eliminar la cuenta: " + error.message);
    }
}

async function renderSuperAdminPanel() {
    const container = document.getElementById('superadmin-panel-container');
    if (!container) return;
    container.innerHTML = '<div class="animate-pulse text-center p-10">Cargando panel de control universal...</div>';

    try {
        const [statsRes, negociosRes] = await Promise.all([
            fetch('/api/superadmin/stats', { credentials: 'include' }),
            fetch('/api/superadmin/negocios', { credentials: 'include' })
        ]);
        const stats = await statsRes.json();
        const negocios = await negociosRes.json();

        let html = `
            <h3 class="text-xs font-black text-rose-400 uppercase tracking-widest flex items-center gap-2 mb-6">
                <span class="bg-rose-500/20 p-2 rounded-xl">👑</span> Panel de Super Administrador
            </h3>
            <div class="grid grid-cols-3 gap-4 mb-8 text-center">
                <div class="card-bg p-4 rounded-2xl"><p class="text-3xl font-black">${stats.negocios}</p><p class="text-xs opacity-50">Negocios</p></div>
                <div class="card-bg p-4 rounded-2xl"><p class="text-3xl font-black">${stats.usuarios}</p><p class="text-xs opacity-50">Usuarios</p></div>
                <div class="card-bg p-4 rounded-2xl"><p class="text-3xl font-black">${stats.productos}</p><p class="text-xs opacity-50">Productos</p></div>
            </div>
            <h4 class="text-sm font-bold mb-4">Lista de Negocios Registrados</h4>
            <div class="overflow-x-auto"><table class="w-full text-left text-xs">
                <thead class="opacity-50 border-b border-white/10"><tr>
                    <th class="p-2">Nombre Negocio</th><th class="p-2">Plan</th><th class="p-2">Fecha Creación</th><th class="p-2">Acciones</th>
                </tr></thead><tbody>`;
        
        negocios.forEach(n => {
            html += `<tr class="border-b border-white/5 hover:bg-white/5">
                <td class="p-2 font-bold">${n.nombreVisible || n.nombre}</td>
                <td class="p-2 font-mono">${n.plan}</td>
                <td class="p-2 font-mono">${new Date(n.fechaCreacion).toLocaleDateString()}</td>
                <td class="p-2"><button onclick="deleteNegocioSuperAdmin('${n._id}', '${n.nombre}')" class="text-rose-500 hover:underline">Eliminar</button></td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
        container.innerHTML = html;

    } catch (e) {
        container.innerHTML = `<div class="text-rose-400 text-center p-10">Error al cargar el panel: ${e.message}</div>`;
    }
}

async function deleteNegocioSuperAdmin(id, nombre) {
    if (confirm(`¿Estás seguro de eliminar el negocio "${nombre}" y TODOS sus datos asociados? Esta acción es irreversible.`)) {
        await fetch(`/api/superadmin/negocios/${id}`, { method: 'DELETE', credentials: 'include' });
        cantarPorVoz("Negocio eliminado.");
        renderSuperAdminPanel();
    }
}

document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('modal-visor-fotos');
    if (modal && !modal.classList.contains('hidden')) {
        if (e.key === 'ArrowLeft') navegarFotoVisor(-1);
        if (e.key === 'ArrowRight') navegarFotoVisor(1);
        if (e.key === 'Escape') cerrarVisorFotos();
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log("Verificando sesión...");
        const res = await fetch(`${BACKEND_URL}/api/auth/verificar`, { credentials: 'include' }); 
        const data = await res.json();
        
        if (data.autenticado) { 
            console.log("Sesión activa:", data.usuario);
            ROL_USUARIO_ACTUAL = data.rol; // Guardar rol globalmente

            setTheme(localStorage.getItem('seychelles-theme-multi') || 'dark');
            document.getElementById('login-box').classList.add('hidden'); 
            document.getElementById('panel-control').classList.remove('hidden'); 
            document.getElementById('ticker-bar').classList.remove('hidden'); 
            document.getElementById('user-display').innerText = `👤 Conectado: ${data.usuario.split('@')[0]} [${data.rol}]`; 

            const planContainer = document.getElementById('plan-badge-container');
            const planName = 'Business (Beta)';
            planContainer.innerHTML = `<span class="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md">
                <span>👑</span> Plan ${planName}
            </span>`;

            // Cargar y aplicar personalización del negocio
            try {
                const negocioRes = await fetch(`${BACKEND_URL}/api/negocio/detalles`, { credentials: 'include' });
                if (negocioRes.ok) {
                    const negocio = await negocioRes.json();
                    actualizarNombresUI(negocio);
                    const nombreVisibleInput = document.getElementById('ajustes-nombre-visible');
                    if (nombreVisibleInput) nombreVisibleInput.value = negocio.nombreVisible || negocio.nombre || '';
                }
            } catch(e) { console.error("Error cargando detalles del negocio", e); }

            if (data.esSuperAdmin) {
                const superAdminTab = document.getElementById('tab-sec-superadmin');
                if (superAdminTab) superAdminTab.classList.remove('hidden');
                // Opcional: navegar directamente al panel de superadmin al logear
                // navegarASeccion('sec-superadmin');
            }
            aplicarPermisosUI(data.permisos);

            // Inicializar Efecto 3D en Tarjetas
            const cards3D = document.querySelectorAll('.kpi-3d-card');
            cards3D.forEach(card => {
                card.addEventListener('mousemove', e => {
                    const rect = card.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    const centerX = rect.width / 2;
                    const centerY = rect.height / 2;
                    const rotateX = ((y - centerY) / centerY) * -12;
                    const rotateY = ((x - centerX) / centerX) * 12;
                    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.03, 1.03, 1.03)`;
                });
                card.addEventListener('mouseleave', () => { card.style.transform = `perspective(1000px) rotateX(0) rotateY(0) scale3d(1, 1, 1)`; });
            });

            await refrescarEstadosKanban();
            // 3. Cargar datos protegidos solo después de confirmar acceso
            await refrescarYListarTiendasCloud();
            await refrescarCategoriasCloud();
            await reloadCoreData(); 
            await cargarNotasBoard();
            await refrescarYRenderizarGastos();
            await inicializarComunicaciones();
            await renderizarPanelPermisos();
        } else {
            console.log("No hay sesión activa.");
        }
    } catch(e){ console.error("Error en la inicialización:", e); }
});

if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(err => {}); }); }

// Inicializar el fondo de partículas
if (document.getElementById('particles-js')) {
    particlesJS("particles-js", {
        "particles": {
            "number": { "value": 40, "density": { "enable": true, "value_area": 800 } },
            "color": { "value": ["#4f46e5", "#818cf8", "#a5b4fc"] },
            "shape": { "type": "circle" },
            "opacity": { "value": 0.4, "random": true },
            "size": { "value": 3, "random": true },
            "line_linked": { "enable": true, "distance": 150, "color": "#4f46e5", "opacity": 0.15, "width": 1 },
            "move": { "enable": true, "speed": 1.5, "direction": "none", "random": true, "out_mode": "out" }
        },
        "interactivity": { "events": { "onhover": { "enable": true, "mode": "repulse" }, "resize": true } },
        "retina_detect": true
    });
}

function aplicarPermisosUI(permisos) {
    // Si no se reciben permisos, no se muestra nada por seguridad (excepto al admin)
    const seccionesPermitidas = ROL_USUARIO_ACTUAL === 'Admin' ? SECCIONES_DISPONIBLES.map(s => s.id) : (permisos || []);

    SECCIONES_DISPONIBLES.forEach(seccion => {
        const tab = document.getElementById(`tab-${seccion.id}`);
        if (tab) {
            tab.style.display = seccionesPermitidas.includes(seccion.id) ? '' : 'none';
        }
    });

    // Lógica adicional para elementos específicos que no son secciones enteras
    const esLector = ROL_USUARIO_ACTUAL === 'Lector';
    document.getElementById('form-container').style.display = esLector ? 'none' : '';
    document.getElementById('form-container-tarea').style.display = esLector ? 'none' : '';
    document.querySelector('button[onclick="crearNotaNueva()"]').style.display = esLector ? 'none' : '';
    document.getElementById('ai-assistant-btn').style.display = esLector ? 'none' : '';

    // Ocultar KPIs financieros si no tiene acceso a analítica
    const kpiGrid = document.getElementById('kpi-container-grid');
    if (kpiGrid) {
        kpiGrid.style.display = seccionesPermitidas.includes('sec-analitica') ? '' : 'none';
    }
}



// --- GESTIÓN DE GASTOS ---

async function refrescarYRenderizarGastos() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/gastos`, { credentials: 'include' });
        if (!res.ok) throw new Error('No se pudieron cargar los gastos.');
        LISTA_GASTOS_GLOBAL = await res.json();
        renderListaGastos();
    } catch (e) {
        console.error("Error cargando gastos:", e);
        const container = document.getElementById('lista-gastos-negocio');
        if (container) container.innerHTML = `<p class="text-rose-400 p-4">${e.message}</p>`;
    }
}

function renderListaGastos() {
    const container = document.getElementById('lista-gastos-negocio');
    const totalContainer = document.getElementById('txt-total-gastos-opex');
    if (!container || !totalContainer) return;

    if (!LISTA_GASTOS_GLOBAL || LISTA_GASTOS_GLOBAL.length === 0) {
        container.innerHTML = '<p class="opacity-50 text-center py-4">No hay gastos registrados.</p>';
        totalContainer.innerText = '0.00 €';
        return;
    }

    let totalGastos = 0;
    let html = '';
    LISTA_GASTOS_GLOBAL.forEach(gasto => {
        totalGastos += gasto.monto;
        html += `
            <div class="flex justify-between items-center p-2.5 bg-black/20 rounded-lg border border-white/5 hover:bg-white/10 transition-colors">
                <div>
                    <p class="font-bold text-sm">${gasto.concepto}</p>
                    <p class="text-[10px] opacity-60 font-mono mt-1">${new Date(gasto.fecha).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })} - ${gasto.categoria}</p>
                </div>
                <div class="flex items-center gap-4">
                    <span class="font-mono font-bold text-rose-400 text-lg">${gasto.monto.toFixed(2)} €</span>
                    <button onclick="eliminarGastoDB('${gasto._id}')" class="text-rose-500 opacity-30 hover:opacity-100 text-xl transition-opacity" title="Eliminar Gasto">✕</button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
    totalContainer.innerText = `${totalGastos.toFixed(2)} €`;
}

async function registrarGastoDB() {
    const concepto = document.getElementById('gas-concepto').value.trim();
    const monto = parseFloat(document.getElementById('gas-monto').value);
    const categoria = document.getElementById('gas-categoria').value;

    if (!concepto || isNaN(monto) || monto <= 0) return alert('Por favor, completa el concepto y un monto válido.');

    await fetch(`${BACKEND_URL}/api/gastos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ concepto, monto, categoria }) });
    document.getElementById('gas-concepto').value = ''; document.getElementById('gas-monto').value = '';
    cantarPorVoz("Gasto registrado.");
    await refrescarYRenderizarGastos();
    await reloadCoreData();
}

async function eliminarGastoDB(id) {
    if (!confirm('¿Estás seguro de que quieres eliminar este gasto?')) return;
    await fetch(`${BACKEND_URL}/api/gastos/${id}`, { method: 'DELETE', credentials: 'include' });
    cantarPorVoz("Gasto eliminado.");
    await refrescarYRenderizarGastos();
    await reloadCoreData();
}

// --- GESTIÓN DE PERMISOS POR ROL ---

async function renderizarPanelPermisos() {
    const container = document.getElementById('permisos-roles-container');
    if (!container) return;

    try {
        const response = await fetch('/api/permisos', { credentials: 'include' });
        if (!response.ok) throw new Error('No se pudieron cargar los permisos.');
        const permisosActuales = await response.json();

        const roles = ['Editor', 'Manager', 'Lector']; // Roles que el Admin puede configurar
        
        let tableHTML = `
            <table class="w-full text-left text-xs border-collapse">
                <thead>
                    <tr class="border-b border-white/10">
                        <th class="p-3 font-black uppercase text-amber-300 tracking-wider">Rol de Usuario</th>
        `;
        SECCIONES_DISPONIBLES.forEach(s => {
            tableHTML += `<th class="p-3 text-center font-bold" title="${s.desc}">${s.nombre}</th>`;
        });
        tableHTML += `</tr></thead><tbody>`;

        roles.forEach(rol => {
            const permisoRol = permisosActuales.find(p => p.rol === rol) || { seccionesPermitidas: [] };
            tableHTML += `<tr class="border-b border-white/5 hover:bg-white/5">
                            <td class="p-3 font-bold text-base">${rol}</td>`;
            SECCIONES_DISPONIBLES.forEach(s => {
                const isChecked = permisoRol.seccionesPermitidas.includes(s.id);
                tableHTML += `<td class="p-3 text-center">
                                <input type="checkbox" id="permiso-${rol}-${s.id}" data-rol="${rol}" data-seccion="${s.id}" 
                                       class="w-5 h-5 rounded text-amber-500 bg-black/20 border-slate-600 cursor-pointer focus:ring-amber-500" ${isChecked ? 'checked' : ''}>
                              </td>`;
            });
            tableHTML += `</tr>`;
        });

        tableHTML += `</tbody></table>`;
        container.innerHTML = tableHTML;

    } catch (error) {
        container.innerHTML = `<p class="text-rose-400 text-center p-4">${error.message}</p>`;
    }
}

async function guardarPermisosRoles() {
    const payload = { permisos: [] };
    const roles = ['Editor', 'Manager', 'Lector'];

    roles.forEach(rol => {
        const seccionesPermitidas = [];
        SECCIONES_DISPONIBLES.forEach(seccion => {
            const checkbox = document.getElementById(`permiso-${rol}-${seccion.id}`);
            if (checkbox && checkbox.checked) {
                seccionesPermitidas.push(seccion.id);
            }
        });
        payload.permisos.push({ rol, seccionesPermitidas });
    });

    try {
        const response = await fetch('/api/permisos', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Error al guardar los permisos.');
        alert('✅ Permisos actualizados correctamente. Los cambios se aplicarán la próxima vez que los usuarios inicien sesión.');
        cantarPorVoz("Permisos guardados.");
    } catch (error) {
        alert(`❌ ${error.message}`);
    }
}

async function cambiarRolUsuario(userId, nuevoRol, selectElement) {
    const emailUsuario = selectElement.dataset.email;
    if (!confirm(`¿Estás seguro de cambiar el rol de ${emailUsuario} a ${nuevoRol}?`)) {
        selectElement.value = selectElement.dataset.rolOriginal; // Revertir cambio visual
        return;
    }

    try {
        const response = await fetch(`/api/usuarios-admin/${userId}/rol`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ rol: nuevoRol })
        });
        if (!response.ok) throw new Error('No se pudo actualizar el rol.');
        
        cantarPorVoz("Rol actualizado.");
        selectElement.dataset.rolOriginal = nuevoRol; // Actualizar el rol original para futuras reversiones
        // Opcional: refrescar toda la lista de usuarios
        // await refrescarListaUsuariosAdmin();
    } catch (error) {
        alert(`❌ ${error.message}`);
        selectElement.value = selectElement.dataset.rolOriginal; // Revertir en caso de error
    }
}

// --- MEJORAS ANALÍTICA ---

function renderGraficaTopProductos(datos) {
    const ctx = document.getElementById('graficaTopProductos')?.getContext('2d');
    if (!ctx) return;

    const conteo = datos.reduce((acc, v) => {
        acc[v.prenda] = (acc[v.prenda] || 0) + v.cantidad;
        return acc;
    }, {});

    const top5 = Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const labels = top5.map(item => item[0]);
    const data = top5.map(item => item[1]);

    if (INSTANCIA_TOP_PRODUCTOS) INSTANCIA_TOP_PRODUCTOS.destroy();
    INSTANCIA_TOP_PRODUCTOS = new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: 'Unidades Vendidas', data, backgroundColor: '#0d9488', borderColor: '#14b8a6', borderWidth: 2, borderRadius: 5 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, scales: { x: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } }, y: { grid: { color: 'rgba(255,255,255,0.05)' } } }, plugins: { legend: { display: false } } } });
}

function renderGraficaRentabilidadCanal(datos) {
    const ctx = document.getElementById('graficaRentabilidadCanal')?.getContext('2d');
    if (!ctx) return;

    const rentabilidad = datos.reduce((acc, v) => {
        const beneficio = (v.precioVenta - v.precioCompra) * v.cantidad;
        acc[v.canalVenta] = (acc[v.canalVenta] || 0) + beneficio;
        return acc;
    }, {});

    const labels = Object.keys(rentabilidad);
    const data = Object.values(rentabilidad);

    if (INSTANCIA_RENTABILIDAD_CANAL) INSTANCIA_RENTABILIDAD_CANAL.destroy();
    INSTANCIA_RENTABILIDAD_CANAL = new Chart(ctx, { type: 'doughnut', data: { labels, datasets: [{ label: 'Beneficio Neto (€)', data, backgroundColor: ['#0e7490', '#0d9488', '#5b21b6', '#be185d'], borderColor: '#0b0f19', borderWidth: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } } } });
}

// --- LÓGICA DE AUTENTICACIÓN Y SETUP ---

async function handleCredentialResponse(response) {
    const loginButtonContainer = document.querySelector('.g_id_signin');
    if(loginButtonContainer) loginButtonContainer.innerHTML = '<div class="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto"></div>';

    const sendLoginRequest = async (clientLocation = null) => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/auth/google`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ token: response.credential, clientLocation })
            });
            const data = await res.json();

            if (data.success) {
                window.location.reload();
            } else if (data.setupRequired) {
                document.getElementById('login-box').classList.add('blur-sm', 'pointer-events-none');
                const setupContainer = document.getElementById('setup-container');
                setupContainer.classList.remove('hidden');
                setupContainer.dataset.email = data.email;
                setupContainer.dataset.token = response.credential;
            } else {
                alert('Error en el login: ' + (data.error || 'Respuesta desconocida del servidor.'));
                if(loginButtonContainer) loginButtonContainer.innerHTML = '<p class="text-rose-400 text-xs">Error. Inténtalo de nuevo.</p>';
            }
        } catch (err) {
            console.error("Error de red durante el login:", err);
            alert("Fallo de red. No se pudo conectar con el servidor para iniciar sesión.");
            if(loginButtonContainer) loginButtonContainer.innerHTML = '<p class="text-rose-400 text-xs">Error de red.</p>';
        }
    };

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => sendLoginRequest({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
            (err) => sendLoginRequest(null),
            { timeout: 3000 }
        );
    } else {
        sendLoginRequest(null);
    }
}

async function submitSetup() {
    const container = document.getElementById('setup-container');
    const email = container.dataset.email;
    const token = container.dataset.token;
    const negocioNombre = document.getElementById('setup-business-name').value.trim();
    const tipoNegocio = document.getElementById('setup-business-type').value;
    const rolUsuario = document.getElementById('setup-user-role').value;

    if (!negocioNombre || !tipoNegocio || !rolUsuario) {
        alert('Por favor, completa todos los campos para crear tu negocio.');
        return;
    }

    const setupButton = document.getElementById('btn-submit-setup');
    setupButton.disabled = true;
    setupButton.innerText = 'Creando tu espacio...';

    try {
        const res = await fetch(`${BACKEND_URL}/api/auth/setup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, token, negocioNombre, tipoNegocio, rolUsuario })
        });
        const data = await res.json();

        if (data.success) {
            window.location.reload();
        } else {
            alert('Error en la creación: ' + (data.error || 'Error desconocido.'));
            setupButton.disabled = false;
            setupButton.innerText = 'Crear mi Espacio de Trabajo';
        }
    } catch (err) {
        alert('Error de red al crear el negocio.');
        setupButton.disabled = false;
        setupButton.innerText = 'Crear mi Espacio de Trabajo';
    }
}

// --- SISTEMA DE COMUNICACIONES (ANUNCIOS Y CHAT) ---

async function inicializarComunicaciones() {
    if (ROL_USUARIO_ACTUAL === 'Admin') {
        document.getElementById('form-anuncio-container').classList.remove('hidden');
    }
    await cargarAnuncios();
    await conectarWebSocket();
    await cargarGruposChat(); // Carga primero los grupos
    await cargarUsuariosChat(); // Luego los usuarios para renderizar todo junto
    await cargarNotificacionesChat();
}

async function cargarAnuncios() {
    try {
        const res = await fetch('/api/anuncios', { credentials: 'include' });
        const data = await res.json();
        const lista = document.getElementById('lista-anuncios');
        if (lista) {
            lista.innerHTML = data.todos.length === 0 ? '<p class="text-xs opacity-50 text-center p-4">No hay anuncios.</p>' : data.todos.map(a => `
                <div class="p-3 bg-black/20 rounded-xl border border-white/5 relative">
                    ${ROL_USUARIO_ACTUAL === 'Admin' ? `<button onclick="eliminarAnuncio('${a._id}')" class="absolute top-2 right-2 text-rose-500 opacity-30 hover:opacity-100 text-xs">✕</button>` : ''}
                    <p class="text-xs font-bold text-${a.tipo === 'urgent' ? 'rose' : (a.tipo === 'warning' ? 'amber' : 'blue')}-400 mb-1">${a.titulo}</p>
                    <p class="text-[11px] opacity-80 leading-relaxed">${a.mensaje}</p>
                    <p class="text-[9px] opacity-40 font-mono mt-2">${new Date(a.fechaCreacion).toLocaleString('es-ES')} - ${a.creador.split('@')[0]}</p>
                </div>`).join('');
        }
        const modalLista = document.getElementById('anuncios-login-lista');
        if (data.noLeidos.length > 0 && modalLista) {
            modalLista.innerHTML = data.noLeidos.map(a => `
                <div class="p-4 bg-black/30 rounded-2xl border border-white/10">
                    <p class="text-sm font-bold text-${a.tipo === 'urgent' ? 'rose' : (a.tipo === 'warning' ? 'amber' : 'blue')}-400 mb-1.5">${a.titulo}</p>
                    <p class="text-xs opacity-90 leading-relaxed">${a.mensaje}</p>
                    <p class="text-[10px] opacity-50 font-mono mt-3">${new Date(a.fechaCreacion).toLocaleString('es-ES')} - por ${a.creador.split('@')[0]}</p>
                </div>`).join('');
            document.getElementById('modal-anuncios-login').classList.remove('hidden');
            data.noLeidos.forEach(a => fetch(`/api/anuncios/${a._id}/leido`, { method: 'POST', credentials: 'include' }));
        }
    } catch (e) { console.error("Error al cargar anuncios:", e); }
}

function cerrarModalAnunciosLogin() { document.getElementById('modal-anuncios-login').classList.add('hidden'); }

async function crearAnuncio() {
    const titulo = document.getElementById('anuncio-titulo').value, mensaje = document.getElementById('anuncio-mensaje').value, tipo = document.getElementById('anuncio-tipo').value;
    if (!titulo || !mensaje) return alert('El título y el mensaje son obligatorios.');
    await fetch('/api/anuncios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ titulo, mensaje, tipo }) });
    document.getElementById('anuncio-titulo').value = ''; document.getElementById('anuncio-mensaje').value = '';
    await cargarAnuncios();
}

async function eliminarAnuncio(id) { if (confirm('¿Eliminar este anuncio para todos?')) { await fetch(`/api/anuncios/${id}`, { method: 'DELETE', credentials: 'include' }); await cargarAnuncios(); } }

function conectarWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    CHAT_WEBSOCKET = new WebSocket(`${protocol}//${window.location.host}`);
    CHAT_WEBSOCKET.onopen = () => console.log('[WSS] Conexión establecida.');
    CHAT_WEBSOCKET.onclose = () => setTimeout(conectarWebSocket, 3000);
    CHAT_WEBSOCKET.onerror = (err) => console.error('[WSS] Error:', err);
    CHAT_WEBSOCKET.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'online_users') actualizarEstadoOnlineUsuarios(message.users);
        else if (message.type === 'new_message') recibirMensajePrivado(message.data);
        else if (message.type === 'new_group_message') recibirMensajeGrupo(message.data);
        else if (message.type === 'message_sent') appendMensajeToChat(message.data, true);
    };
}

async function cargarGruposChat() {
    try {
        const res = await fetch('/api/chat/grupos', { credentials: 'include' });
        CHAT_GRUPOS = await res.json();
    } catch (e) {
        console.error("Error cargando grupos de chat:", e);
    }
}

async function cargarUsuariosChat() {
    const res = await fetch('/api/usuarios-admin', { credentials: 'include' });
    CHAT_USUARIOS = await res.json();
    renderizarListaConversaciones();
}

function renderizarListaConversaciones() {
    const miEmail = document.getElementById('user-display').innerText.match(/Conectado: (.*?) \[/)[1];
    const container = document.getElementById('chat-lista-usuarios');
    let html = '';

    // Renderizar Grupos
    html += CHAT_GRUPOS.map(g => `
        <div id="chat-conv-${g._id}" onclick="seleccionarConversacion('group', '${g._id}', '${g.nombre}')" class="flex items-center gap-3 p-3 border-b border-white/5 cursor-pointer hover:bg-white/10 transition-colors relative">
            <div class="relative"><div class="w-10 h-10 rounded-full bg-purple-700 flex items-center justify-center font-bold text-white uppercase">👥</div></div>
            <div class="flex-1 min-w-0"><p class="font-bold text-sm truncate">${g.nombre}</p><p class="text-xs opacity-60">${g.miembros.length} miembros</p></div>
            <div id="chat-notif-${g._id}" class="hidden bg-rose-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full"></div>
        </div>`).join('');

    // Renderizar Usuarios
    html += CHAT_USUARIOS.filter(u => u.email !== miEmail).map(u => `
        <div id="chat-conv-${u.email.replace(/[@.]/g, '-')}" onclick="seleccionarConversacion('user', '${u.email}', '${u.email.split('@')[0]}')" class="flex items-center gap-3 p-3 border-b border-white/5 cursor-pointer hover:bg-white/10 transition-colors relative">
            <div class="relative"><div class="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center font-bold text-indigo-300 uppercase">${u.email.substring(0, 2)}</div><div id="chat-status-${u.email.replace(/[@.]/g, '-')}" class="absolute bottom-0 right-0 w-3 h-3 bg-slate-500 rounded-full border-2 border-slate-800"></div></div>
            <div class="flex-1 min-w-0"><p class="font-bold text-sm truncate">${u.email.split('@')[0]}</p><p class="text-xs opacity-60">${u.rol}</p></div>
            <div id="chat-notif-${u.email.replace(/[@.]/g, '-')}" class="hidden bg-rose-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full"></div>
        </div>`).join('');
    container.innerHTML = html;
}

function actualizarEstadoOnlineUsuarios(onlineUsers) {
    CHAT_USUARIOS.forEach(u => {
        const statusDot = document.getElementById(`chat-status-${u.email.replace(/[@.]/g, '-')}`);
        if (statusDot) { statusDot.className = `absolute bottom-0 right-0 w-3 h-3 ${onlineUsers.includes(u.email) ? 'bg-emerald-500' : 'bg-slate-500'} rounded-full border-2 border-slate-800`; }
    });
    if (CHAT_CONVERSACION_ACTIVA && CHAT_CONVERSACION_ACTIVA.tipo === 'user') {
        const headerStatus = document.getElementById('chat-header-status');
        headerStatus.className = `w-3 h-3 rounded-full ${onlineUsers.includes(CHAT_CONVERSACION_ACTIVA.id) ? 'bg-emerald-500' : 'bg-slate-600'}`;
    }
}

async function seleccionarConversacion(tipo, id, nombre) {
    CHAT_CONVERSACION_ACTIVA = { tipo, id, nombre };
    document.getElementById('chat-ventana-placeholder').classList.add('hidden');
    document.getElementById('chat-area-activa').classList.remove('hidden');
    document.getElementById('chat-input').disabled = false;
    document.getElementById('chat-header-nombre').innerText = nombre;
    document.getElementById('chat-header-status').style.display = tipo === 'user' ? 'block' : 'none';

    document.querySelectorAll('#chat-lista-usuarios > div').forEach(el => el.classList.remove('bg-blue-500/20'));
    const convId = tipo === 'user' ? id.replace(/[@.]/g, '-') : id;
    document.getElementById(`chat-conv-${convId}`).classList.add('bg-blue-500/20');
    
    const notifBadge = document.getElementById(`chat-notif-${id}`);
    if (notifBadge) { notifBadge.classList.add('hidden'); notifBadge.innerText = ''; delete CHAT_NOTIFICACIONES[id]; }
    
    const url = tipo === 'user' ? `/api/chat/conversacion/${id}` : `/api/chat/grupos/${id}/mensajes`;
    const res = await fetch(url, { credentials: 'include' });
    const mensajes = await res.json();
    const container = document.getElementById('chat-mensajes');
    container.innerHTML = '';
    mensajes.forEach(msg => appendMensajeToChat(msg, false));
}

function appendMensajeToChat(msg, esMio) {
    const container = document.getElementById('chat-mensajes');
    if (!esMio) {
        const miEmail = document.getElementById('user-display').innerText.match(/Conectado: (.*?) \[/)[1];
        esMio = msg.remitenteEmail === miEmail;
    }
    const nombreRemitente = esMio ? 'Tú' : msg.remitenteEmail.split('@')[0];

    container.innerHTML += `
        <div class="flex items-start gap-3 ${esMio ? 'flex-row-reverse' : ''}">
            <div class="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center font-bold text-indigo-300 uppercase flex-shrink-0">${msg.remitenteEmail.substring(0, 2)}</div>
            <div class="max-w-xs md:max-w-md">
                ${!esMio && CHAT_CONVERSACION_ACTIVA.tipo === 'group' ? `<p class="text-[10px] font-bold opacity-60 mb-1 ml-2">${nombreRemitente}</p>` : ''}
                <div class="p-3 rounded-2xl ${esMio ? 'bg-blue-600 text-white rounded-br-none' : 'bg-slate-700 rounded-bl-none'}"><p class="text-sm leading-relaxed">${msg.contenido}</p></div>
                <p class="text-[10px] opacity-50 mt-1 px-1 ${esMio ? 'text-right' : ''}">${new Date(msg.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
        </div>`;
    container.scrollTop = container.scrollHeight;
}

function enviarMensajeChat(event) {
    event.preventDefault();
    const input = document.getElementById('chat-input');
    const contenido = input.value.trim();
    if (contenido && CHAT_CONVERSACION_ACTIVA && CHAT_WEBSOCKET.readyState === 1) {
        const payload = { contenido };
        if (CHAT_CONVERSACION_ACTIVA.tipo === 'user') {
            payload.type = 'chat_message';
            payload.destinatarioEmail = CHAT_CONVERSACION_ACTIVA.id;
        } else {
            payload.type = 'group_chat_message';
            payload.grupoId = CHAT_CONVERSACION_ACTIVA.id;
        }
        CHAT_WEBSOCKET.send(JSON.stringify(payload));
        input.value = '';
    }
}

function recibirMensajePrivado(msg) {
    cantarPorVoz("Mensaje nuevo");
    if (CHAT_CONVERSACION_ACTIVA && CHAT_CONVERSACION_ACTIVA.tipo === 'user' && msg.remitenteEmail === CHAT_CONVERSACION_ACTIVA.id) {
        appendMensajeToChat(msg, false);
        fetch(`/api/chat/conversacion/${msg.remitenteEmail}`, { credentials: 'include' }); // Marca como leído
    } else {
        CHAT_NOTIFICACIONES[msg.remitenteEmail] = (CHAT_NOTIFICACIONES[msg.remitenteEmail] || 0) + 1;
        const notifBadge = document.getElementById(`chat-notif-${msg.remitenteEmail.replace(/[@.]/g, '-')}`);
        if (notifBadge) { notifBadge.innerText = CHAT_NOTIFICACIONES[msg.remitenteEmail]; notifBadge.classList.remove('hidden'); }
    }
}

function recibirMensajeGrupo(msg) {
    cantarPorVoz("Mensaje de grupo");
    if (CHAT_CONVERSACION_ACTIVA && CHAT_CONVERSACION_ACTIVA.tipo === 'group' && msg.destinatarioEmail === CHAT_CONVERSACION_ACTIVA.id) {
        appendMensajeToChat(msg, false);
    } else {
        const grupoId = msg.destinatarioEmail;
        CHAT_NOTIFICACIONES[grupoId] = (CHAT_NOTIFICACIONES[grupoId] || 0) + 1;
        const notifBadge = document.getElementById(`chat-notif-${grupoId}`);
        if (notifBadge) { notifBadge.innerText = CHAT_NOTIFICACIONES[grupoId]; notifBadge.classList.remove('hidden'); }
    }
}

async function cargarNotificacionesChat() {
    const res = await fetch('/api/chat/notificaciones', { credentials: 'include' });
    const notificaciones = await res.json();
    notificaciones.forEach(notif => {
        CHAT_NOTIFICACIONES[notif._id] = notif.count;
        const convId = notif._id.includes('@') ? notif._id.replace(/[@.]/g, '-') : notif._id;
        const notifBadge = document.getElementById(`chat-notif-${convId}`);
        if (notifBadge) { notifBadge.innerText = notif.count; notifBadge.classList.remove('hidden'); }
    });
}

function abrirModalCrearGrupo() {
    const modal = document.getElementById('modal-crear-grupo');
    modal.classList.remove('hidden');
    const miEmail = document.getElementById('user-display').innerText.match(/Conectado: (.*?) \[/)[1];
    const container = document.getElementById('grupo-lista-miembros');
    container.innerHTML = CHAT_USUARIOS
        .filter(u => u.email !== miEmail)
        .map(u => `
            <label class="flex items-center gap-3 p-2 hover:bg-white/10 rounded-lg cursor-pointer">
                <input type="checkbox" value="${u.email}" class="w-4 h-4 rounded text-blue-500 bg-black/30 border-slate-600">
                <span class="text-sm">${u.email.split('@')[0]}</span>
            </label>
        `).join('');
}

async function crearGrupoChat() {
    const nombre = document.getElementById('grupo-nombre').value.trim();
    const miembros = Array.from(document.querySelectorAll('#grupo-lista-miembros input:checked')).map(cb => cb.value);
    if (!nombre || miembros.length === 0) return alert('El nombre del grupo y al menos un miembro son necesarios.');

    await fetch('/api/chat/grupos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ nombre, miembros }) });
    
    document.getElementById('modal-crear-grupo').classList.add('hidden');
    document.getElementById('grupo-nombre').value = '';
    cantarPorVoz("Grupo creado.");
    await cargarGruposChat();
    renderizarListaConversaciones();
}

// --- IMPLEMENTACIÓN DE FUNCIONES FALTANTES ---

function navegarASeccion(seccionId) {
    document.querySelectorAll('.seccion-app').forEach(sec => sec.classList.add('hidden'));
    const seccionActiva = document.getElementById(seccionId);
    if (seccionActiva) {
        seccionActiva.classList.remove('hidden');
    }

    document.querySelectorAll('nav button[id^="tab-"]').forEach(btn => {
        const esActivo = btn.id === `tab-${seccionId}`;
        btn.classList.toggle('nav-btn-active', esActivo);
        btn.classList.toggle('text-white', esActivo);
        btn.classList.toggle('opacity-40', !esActivo);
        btn.classList.toggle('hover:opacity-100', !esActivo);
    });

    // Lógica específica al navegar
    if (seccionId === 'sec-auditoria' && typeof renderizarCalendario === 'function') renderizarCalendario();
    if (seccionId === 'sec-inventario' && typeof renderizarCalendarioStock === 'function') renderizarCalendarioStock();
    if (seccionId === 'sec-analitica' && typeof actualizarTodoElBloqueGrafico === 'function') actualizarTodoElBloqueGrafico();
    if (seccionId === 'sec-usuarios' && typeof refrescarListaUsuariosAdmin === 'function') refrescarListaUsuariosAdmin();
    if (seccionId === 'sec-ajustes') {
        if (typeof renderListaAjustesKanban === 'function') renderListaAjustesKanban();
        if (typeof renderizarPanelPermisos === 'function') renderizarPanelPermisos();
    }
    if (seccionId === 'sec-superadmin' && typeof renderSuperAdminPanel === 'function') renderSuperAdminPanel();
    if (seccionId === 'sec-comunicaciones' && typeof inicializarComunicaciones === 'function') inicializarComunicaciones();
}

function cantarPorVoz(texto) {
    if (SOUND_MUTED_GLOBAL || !('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(texto);
    utterance.lang = 'es-ES';
    utterance.volume = 0.5;
    speechSynthesis.speak(utterance);
}

function establecerValoresPorDefecto() {
    if (LISTA_CATEGORIAS_GLOBAL.length > 0) document.getElementById('categoria').value = LISTA_CATEGORIAS_GLOBAL[0].nombre;
    if (LISTA_ESTADOS_KANBAN.length > 0) document.getElementById('estado').value = LISTA_ESTADOS_KANBAN[0].nombre;
}

async function crearNotaNueva() {
    if (NOTAS_LOCALES.length >= 10) return alert('Límite de 10 notas alcanzado.');
    const nota = { texto: 'Nueva nota...', color: 'note-yellow', x: 50, y: 50, width: 200, height: 150 };
    const res = await fetch(`${BACKEND_URL}/api/notas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(nota) });
    if (res.ok) await cargarNotasBoard();
}

async function forceRefreshDataManual() {
    const icon = document.getElementById('icon-refresh');
    if(icon) icon.classList.add('animate-spin-once');
    await reloadCoreData();
    cantarPorVoz("Datos sincronizados");
    setTimeout(() => {
        if(icon) icon.classList.remove('animate-spin-once');
    }, 600);
}

function recalcularKPIsLocalesOptimistas() {
    reloadCoreData();
}

// --- KANBAN DRAG & DROP ---
function allowDrop(ev) {
    ev.preventDefault();
    const targetCol = ev.target.closest('.flex-1.space-y-3');
    if (targetCol) targetCol.classList.add('drag-over');
}

function clearDrop(ev) {
    const targetCol = ev.target.closest('.flex-1.space-y-3');
    if (targetCol) targetCol.classList.remove('drag-over');
}

function handleDragStart(ev, id) {
    ev.dataTransfer.setData("text/plain", id);
    const card = document.getElementById(id);
    if (card) setTimeout(() => card.classList.add('dragging'), 0);
}

async function handleDrop(ev, nuevoEstado) {
    ev.preventDefault();
    clearDrop(ev);
    const id = ev.dataTransfer.getData("text");
    const card = document.getElementById(id);
    if (card) card.classList.remove('dragging');

    const item = BASE_DATOS.find(v => v._id === id);
    if (item && item.estado !== nuevoEstado) {
        try {
            await fetch(`${BACKEND_URL}/api/ventas/${id}/estado`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ estado: nuevoEstado })
            });
            await reloadCoreData();
            cantarPorVoz(nuevoEstado);
        } catch (error) {
            alert('Error al actualizar el estado del artículo.');
        }
    }
}

// --- STUBS PARA FUNCIONES FALTANTES ---

function autocompletarNombreLocalRapido() { alert('Función "autocompletarNombreLocalRapido" no implementada.'); }
function lanzarModalImpresionEtiqueta(id) { alert(`Función "lanzarModalImpresionEtiqueta" para ID: ${id} no implementada.`); }
function aplicarFiltrosFrontLineal() { alert('Función "aplicarFiltrosFrontLineal" no implementada.'); }
function toggleEscanerCamara() { alert('Función "toggleEscanerCamara" no implementada.'); }
function exportarExcel() { alert('Función "exportarExcel" no implementada.'); }
function descargarBackupSeguridadLocal() { alert('Función "descargarBackupSeguridadLocal" no implementada.'); }
function importarBackupJSON() { alert('Función "importarBackupJSON" no implementada.'); }
function limpiarFiltrosAnalitica() { alert('Función "limpiarFiltrosAnalitica" no implementada.'); }
function generarInformePDF() { alert('Función "generarInformePDF" no implementada.'); }
function lanzarModalCRM() { alert('Función "lanzarModalCRM" no implementada.'); }
function renderGestionFacturas() { alert('Función "renderGestionFacturas" no implementada.'); }
function generarGuiaPDF() { alert('Función "generarGuiaPDF" no implementada.'); }
function guardarAjustesNegocio() { alert('Función "guardarAjustesNegocio" no implementada.'); }
function toggleAIAssistant() { alert('Función "toggleAIAssistant" no implementada.'); }
function enviarMensajeIA() { alert('Función "enviarMensajeIA" no implementada.'); }
function quitarImagenIA() { alert('Función "quitarImagenIA" no implementada.'); }
function procesarImagenIA() { alert('Función "procesarImagenIA" no implementada.'); }

function toggleMuteVolumenGlobal() {
    SOUND_MUTED_GLOBAL = !SOUND_MUTED_GLOBAL;
    const txt = document.getElementById('txt-mute-volumen');
    if (txt) txt.innerText = SOUND_MUTED_GLOBAL ? 'Sonido (OFF)' : 'Sonido (ON)';
    cantarPorVoz(SOUND_MUTED_GLOBAL ? 'Sonido desactivado' : 'Sonido activado');
}

function manejarSeleccionCheckMasiva(id, checkbox) {
    if (checkbox.checked) {
        if (!ITEMS_SELECCIONADOS_MASIVOS.includes(id)) {
            ITEMS_SELECCIONADOS_MASIVOS.push(id);
        }
    } else {
        ITEMS_SELECCIONADOS_MASIVOS = ITEMS_SELECCIONADOS_MASIVOS.filter(itemId => itemId !== id);
    }
    actualizarPanelMasivo();
}

function actualizarPanelMasivo() {
    const panel = document.getElementById('panel-masivo-flotante');
    const contador = document.getElementById('contador-masivo-seleccionado');
    if (!panel || !contador) return;

    if (ITEMS_SELECCIONADOS_MASIVOS.length > 0) {
        panel.classList.remove('hidden');
        contador.innerText = ITEMS_SELECCIONADOS_MASIVOS.length;
    } else {
        panel.classList.add('hidden');
    }
}

function limpiarSeleccionMasiva() {
    ITEMS_SELECCIONADOS_MASIVOS = [];
    document.querySelectorAll('.kanban-card input[type="checkbox"]').forEach(cb => cb.checked = false);
    actualizarPanelMasivo();
    renderKanban();
}

function ejecutarAccionMasivaEstado(nuevoEstado) { alert(`Mover ${ITEMS_SELECCIONADOS_MASIVOS.length} items a "${nuevoEstado}" (no implementado).`); }
function ejecutarDuplicadoMasivo() { alert(`Duplicar ${ITEMS_SELECCIONADOS_MASIVOS.length} items (no implementado).`); }
function ejecutarAjustePrecioMasivo() { alert(`Ajustar precio para ${ITEMS_SELECCIONADOS_MASIVOS.length} items (no implementado).`); }
function ejecutarAjusteCosteMasivo() { alert(`Ajustar coste para ${ITEMS_SELECCIONADOS_MASIVOS.length} items (no implementado).`); }
function ejecutarEdicionMasivaPropiedad(prop, valor) { alert(`Cambiar "${prop}" a "${valor}" para ${ITEMS_SELECCIONADOS_MASIVOS.length} items (no implementado).`); }
function ejecutarEliminacionMasiva() { alert(`Eliminar ${ITEMS_SELECCIONADOS_MASIVOS.length} items (no implementado).`); }