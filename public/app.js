const BACKEND_URL = '';
let BASE_DATOS = [];
let LISTA_TIENDAS_GLOBAL = [];
let LISTA_CATEGORIAS_GLOBAL = [];
let LISTA_CLIENTES_CACHE = [];
let INSTANCIA_CHARTS = null;
let INSTANCIA_TARTA = null;
let INSTANCIA_BARRAS = null;
let INSTANCIA_MAPA_CALOR = null;
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
    IDX