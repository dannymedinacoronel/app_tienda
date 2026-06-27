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
    { id: 'sec-mi-cuenta', nombre: '👤 Mi Cuenta', desc: 'Ver uso del plan y gestionar la suscripción.' }];

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