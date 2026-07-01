// c:/Users/dannymedinacoronel/Desktop/APP RESTAURADA 280626/app_tienda-main/public/app.js

// --- VARIABLES GLOBALES Y ESTADO DE LA APP ---
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

socket.on('scraper_update', async (data) => {
    console.log('[SOCKET] Datos recibidos de GitHub:', data);

    const productos = Array.isArray(data?.productos) ? data.productos : [];

    try {
        const response = await fetch(`${BACKEND_URL}/api/scraper/analizar-manual`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productosExtraidos: productos.map(p => ({
                titulo: p.titulo,
                precio: p.precio,
                imagen: p.imagen
            })) })
        });

        const comparativa = await response.json();
        resultadosScraperActual = comparativa;
        renderizarResultadosScraping(resultadosScraperActual);

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
        document.getElementById('scraper-loader').classList.add('hidden');
        document.getElementById('scraper-step-1').classList.remove('hidden');
        alert('No se pudieron procesar los resultados del scraper remoto. Revisa logs de Render/GitHub.');
    }
});

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
let LISTA_ESTADOS_KANBAN = [];
let GLOBO_INSTANCE = null;
let FOTOS_FORMULARIO_TEMP = [];
let resultadosScraperActual = null;

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
    if(!url) return alert('Debes introducir una cuenta o URL.');

    document.getElementById('scraper-step-1').classList.add('hidden');
    document.getElementById('scraper-loader').classList.remove('hidden');

    try {
        const response = await fetch(`${BACKEND_URL}/api/scraper/analizar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ url })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Error al conectar con el servidor.');

        // 🚀 Si el servidor nos dice que ha lanzado GitHub, avisamos y esperamos
        if (data.success && data.mensaje) {
            // MOSTRAR LOADING EN EL SCRAPER
            document.getElementById('scraper-step-1').classList.add('hidden');
            document.getElementById('scraper-loader').classList.remove('hidden');
            
            // Texto dinámico para que el usuario sepa que está esperando a GitHub
            const loaderTitle = document.querySelector('#scraper-loader h3');
            if (loaderTitle) loaderTitle.innerText = "GitHub Actions está analizando Vinted...";
            
            const loaderText = document.querySelector('#scraper-loader p');
            if (loaderText) loaderText.innerText = "Esto tardará unos 2 minutos. No cierres el modal, los resultados aparecerán aquí automáticamente.";

            return;
        }

        resultadosScraperActual = data;
        renderizarResultadosScraping(resultadosScraperActual);

        document.getElementById('scraper-loader').classList.add('hidden');
        document.getElementById('scraper-step-2').classList.remove('hidden');
        
        const badge = document.getElementById('badge-scraper-count');
        const total = (resultadosScraperActual.discrepancias?.length || 0) + (resultadosScraperActual.nuevos?.length || 0);
        if (total > 0) {
            badge.innerText = `${total} ACCIONES`;
            badge.classList.remove('hidden');
        }
    } catch (error) {
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

            document.getElementById('scraper-loader').classList.add('hidden');
            document.getElementById('scraper-step-2').classList.remove('hidden');
            
            const badge = document.getElementById('badge-scraper-count');
            const total = (resultadosScraperActual.discrepancias?.length || 0) + (resultadosScraperActual.nuevos?.length || 0) + (resultadosScraperActual.identicos?.length || 0);
            if (total > 0) {
                badge.innerText = `${total} EN ARCHIVO`;
                badge.classList.remove('hidden');
            }
        } catch (error) {
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

function renderizarResultadosScraping(data) {
    const tbody = document.getElementById('scraper-results-body');
    const gridNuevos = document.getElementById('scraper-grid-nuevos');
    const gridExistentes = document.getElementById('scraper-grid-existentes');
    const contDisc = document.getElementById('container-discrepancias');
    const contNuev = document.getElementById('container-nuevos');
    const contExist = document.getElementById('container-existentes');
    const noRes = document.getElementById('scraper-no-results');
    const summaryText = document.getElementById('scraper-summary-text');

    if (!data) return;

    tbody.innerHTML = '';
    gridNuevos.innerHTML = '';
    gridExistentes.innerHTML = '';

    const discCount = data.discrepancias?.length || 0;
    const nuevoCount = data.nuevos?.length || 0;
    const identCount = data.identicos?.length || 0;

    summaryText.innerHTML = `Análisis completado. He comparado Vinted con tu inventario de MongoDB:<br>
        • <span class="text-amber-400 font-bold">${discCount} cambios de precio</span>: Se han detectado modificaciones en Vinted que no tienes en el sistema.<br>
        • <span class="text-emerald-400 font-bold">${nuevoCount} productos nuevos</span>: Artículos en la web que no están registrados en Mongo.<br>
        • <span class="text-slate-400 font-bold">${identCount} artículos sin cambios</span>: Productos que ya están perfectamente sincronizados.`;

    if (discCount > 0) contDisc.classList.remove('hidden'); else contDisc.classList.add('hidden');
    if (nuevoCount > 0) contNuev.classList.remove('hidden'); else contNuev.classList.add('hidden');
    if (identCount > 0) contExist.classList.remove('hidden'); else contExist.classList.add('hidden');
    if (discCount === 0 && nuevoCount === 0 && identCount === 0) noRes.classList.remove('hidden'); else noRes.classList.add('hidden');

    if (discCount > 0) {
        data.discrepancias.forEach((d, i) => {
            const tituloMostrado = d.prendaNueva || d.prenda;
            tbody.innerHTML += `
                <tr class="border-b border-white/5 align-middle">
                    <td class="py-2 pr-2 w-8"><input type="checkbox" class="check-disc-scraper" value="${i}" checked></td>
                    <td class="py-2"><img src="${d.imagen || ''}" onclick="abrirVisorScraper('disc', ${i})" class="w-8 h-8 rounded object-cover border border-white/10 cursor-pointer hover:scale-110 transition-transform" title="Ver foto" onerror="this.src='data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'60\' height=\'60\' viewBox=\'0 0 60 60\'%3E%3Crect width=\'60\' height=\'60\' fill=\'%23111827\'/%3E%3Cpath d=\'M15 40l10-12 8 9 6-7 11 10\' fill=\'none\' stroke=\'%239ca3af\' stroke-width=\'3\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3Ccircle cx=\'22\' cy=\'22\' r=\'4\' fill=\'%239ca3af\'/%3E%3C/svg%3E'"></td>
                    <td class="py-2 px-2">
                        <input type="text" id="disc-item-title-${i}" value="${tituloMostrado}" class="bg-transparent border-b border-white/10 text-[11px] font-bold uppercase w-full focus:outline-none focus:border-amber-400 px-1 py-0.5 text-white" placeholder="Título...">
                        <div class="text-[8px] opacity-40 mt-0.5 lowercase">En Mongo: ${d.prenda}</div>
                    </td>
                    <td class="py-2 text-rose-400/50 line-through text-[11px] font-mono text-right">${d.valorAntiguo}€</td>
                    <td class="py-2 text-emerald-400 font-black text-right">
                        <input type="number" id="disc-item-price-${i}" value="${valorNumeroSeguro(d.valorNuevo)}" step="0.01" class="bg-transparent border-b border-white/10 text-[11px] text-emerald-400 font-mono w-14 focus:outline-none focus:border-emerald-400 px-1 py-0.5 text-right"> €
                    </td>
                </tr>`;
        });
    }

    if (nuevoCount > 0) {
        let catOptions = LISTA_CATEGORIAS_GLOBAL.map(c => `<option value="${c.nombre}">${c.nombre}</option>`).join('');
        data.nuevos.forEach((n, i) => {
                const badgeGaleriaInfo = n.galeria && n.galeria.length > 0 ? `<div class="absolute bottom-1 right-1 bg-black/80 rounded px-1 text-[8px] font-bold border border-white/20 shadow-md">+${n.galeria.length}</div>` : '';
            gridNuevos.innerHTML += `
                <div class="flex flex-col gap-2 p-3 bg-black/20 border border-white/10 rounded-2xl hover:bg-white/5 transition-all shadow-inner relative">
                    <div class="absolute top-3 right-3">
                        <input type="checkbox" id="check-new-${i}" class="check-new-scraper w-4 h-4 rounded text-emerald-500 bg-black/40 border-white/20 cursor-pointer" value="${i}" checked>
                    </div>
                    <div class="flex items-start gap-3">
                            <div class="relative flex-shrink-0 cursor-pointer group" onclick="abrirVisorScraper('nuevo', ${i})" title="Ver Galería">
                                <img src="${n.imagen || ''}" class="w-14 h-14 rounded-xl object-cover shadow-md group-hover:scale-105 transition-transform" onerror="this.src='data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'60\' height=\'60\' viewBox=\'0 0 60 60\'%3E%3Crect width=\'60\' height=\'60\' fill=\'%23111827\'/%3E%3Cpath d=\'M15 40l10-12 8 9 6-7 11 10\' fill=\'none\' stroke=\'%239ca3af\' stroke-width=\'3\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3Ccircle cx=\'22\' cy=\'22\' r=\'4\' fill=\'%239ca3af\'/%3E%3C/svg%3E'">
                                ${badgeGaleriaInfo}
                            </div>
                        <div class="min-w-0 flex-1 flex flex-col gap-1.5 pr-6">
                            <input type="text" id="new-item-title-${i}" value="${n.prenda}" class="bg-transparent border-b border-white/10 text-[11px] font-bold uppercase w-full focus:outline-none focus:border-emerald-400 px-1 py-0.5 text-white transition-colors" placeholder="Título a guardar...">
                            <div class="flex items-center gap-1 mt-1">
                                <span class="text-[9px] opacity-60">Precio:</span>
                                <input type="number" id="new-item-price-${i}" value="${valorNumeroSeguro(n.precioVenta)}" step="0.01" class="bg-transparent border-b border-white/10 text-[11px] text-emerald-400 font-mono w-16 focus:outline-none focus:border-emerald-400 px-1 py-0.5 transition-colors text-right">
                                <span class="text-[10px] text-emerald-400 font-mono">€</span>
                            </div>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-2 mt-1">
                        <select id="new-item-cat-${i}" class="bg-black/40 border border-white/10 text-[10px] rounded px-1 py-1 focus:outline-none focus:border-emerald-400 text-white">
                            <option value="General">Categoría...</option>
                            ${catOptions}
                        </select>
                        <select id="new-item-talla-${i}" class="bg-black/40 border border-white/10 text-[10px] rounded px-1 py-1 focus:outline-none focus:border-emerald-400 text-white">
                            <option value="Única">Talla: Única</option>
                            <option value="S">S</option><option value="M">M</option><option value="L">L</option><option value="XL">XL</option>
                        </select>
                    </div>
                    <div class="grid grid-cols-3 gap-2 mt-1">
                        <div class="flex items-center gap-1 bg-black/40 border border-white/10 rounded px-1">
                            <span class="text-[8px] opacity-60">Coste:</span>
                            <input type="number" id="new-item-cost-${i}" value="0" step="0.01" class="w-full bg-transparent text-[10px] py-1 focus:outline-none focus:text-emerald-400 text-white text-right">
                            <span class="text-[8px] opacity-60">€</span>
                        </div>
                        <div class="flex items-center gap-1 bg-black/40 border border-white/10 rounded px-1">
                            <span class="text-[8px] opacity-60">Cant:</span>
                            <input type="number" id="new-item-qty-${i}" value="1" min="1" class="w-full bg-transparent text-[10px] py-1 focus:outline-none focus:text-emerald-400 text-white text-right">
                        </div>
                        <select id="new-item-canal-${i}" class="bg-black/40 border border-white/10 text-[10px] rounded px-1 py-1 focus:outline-none focus:border-emerald-400 text-white">
                            <option value="Vinted" selected>Vinted</option><option value="Wallapop">Wallapop</option><option value="Web">Web</option><option value="Tienda Física">Tienda</option>
                        </select>
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
                    </div>
                    <div class="flex gap-1">
                        <button onclick="cerrarModalScraper(); editItem('${n.idMongo}')" class="text-[10px] bg-blue-500/20 hover:bg-blue-500 text-blue-400 hover:text-white px-2 py-1 rounded-lg transition-all">Editar</button>
                        <button onclick="deleteItemFromScraper('${n.idMongo}')" class="text-[10px] bg-rose-500/10 hover:bg-rose-600 text-rose-500 hover:text-white px-2 py-1 rounded-lg transition-all">🗑️</button>
                    </div>
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
        const canalEditado = document.getElementById(`new-item-canal-${idx}`)?.value || 'Vinted';
        const galeriaOriginal = itemOriginal.galeria || [];

        return { 
            ...itemOriginal, prenda: tituloEditado, precioVenta: precioEditado, 
            categoria: catEditada, talla: tallaEditada, precioCompra: costEditado, 
            cantidad: qtyEditada, canalVenta: canalEditado, galeria: galeriaOriginal
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
        alert(`✅ Se han importado ${res.count} productos exitosamente con sus fotografías a la base de datos.\n\nYa puedes verificarlos en tu inventario.`);
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
    if(!url) return;
    let saved = JSON.parse(localStorage.getItem('seychelles-scraper-urls') || '[]');
    if(!saved.includes(url)) {
        saved.unshift(url);
        if(saved.length > 5) saved.pop();
        localStorage.setItem('seychelles-scraper-urls', JSON.stringify(saved));
        renderSavedUrls();
        cantarPorVoz("URL guardada.");
    }
}

function renderSavedUrls() {
    const container = document.getElementById('scraper-saved-urls');
    if(!container) return;
    const saved = JSON.parse(localStorage.getItem('seychelles-scraper-urls') || '[]');
    if(saved.length === 0) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');
    let html = '<p class="text-[9px] font-bold uppercase opacity-40 mb-1">Favoritos:</p>';
    saved.forEach((url, idx) => {
        html += `
            <div class="flex items-center justify-between gap-2 p-2 bg-black/20 rounded-xl group hover:bg-black/40 transition-colors">
                <span class="text-[10px] truncate flex-1 cursor-pointer hover:text-blue-400 font-mono" onclick="document.getElementById('scraper-url').value='${url}'">${url}</span>
                <button onclick="eliminarUrlGuardada(${idx})" class="text-rose-500 text-[10px] font-bold px-1 hover:scale-125 transition-transform">✕</button>
            </div>`;
    });
    container.innerHTML = html;
}

function eliminarUrlGuardada(idx) {
    let saved = JSON.parse(localStorage.getItem('seychelles-scraper-urls') || '[]');
    saved.splice(idx, 1);
    localStorage.setItem('seychelles-scraper-urls', JSON.stringify(saved));
    renderSavedUrls();
}

// --- FUNCIONES DEBOUNCED GLOBALES ---
window.debouncedCambiarFiltroColumna = debounce(cambiarFiltroColumna, 300);
window.debouncedFiltrarProductosMenu = debounce(filtrarProductosMenu, 250);
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
    const selectMasivo = document.getElementById('tienda-masiva');
    try {
        const res = await fetch(`${BACKEND_URL}/api/tiendas`, { credentials: 'include' });
        if (!res.ok) throw new Error("Error leyendo backend");
        const data = await res.json();
        LISTA_TIENDAS_GLOBAL = data.tiendas || [];
        
        selectForm.innerHTML = '<option value="">Sin asignar</option>';
        selectFiltro.innerHTML = '<option value="TODOS">🏬 Todas las tiendas</option>';
        if(selectMasivo) selectMasivo.innerHTML = '<option value="">🏬 Tienda...</option>';

        LISTA_TIENDAS_GLOBAL.forEach(t => {
            const opt1 = document.createElement('option');
            opt1.value = t.nombre; opt1.textContent = `🏬 ${t.nombre}`;
            selectForm.appendChild(opt1);

            const opt2 = document.createElement('option');
            opt2.value = t.nombre; opt2.textContent = t.nombre;
            selectFiltro.appendChild(opt2);

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
    document.querySelectorAll('.seccion-app').forEach(sec => sec.classList.add('hidden'));
    document.getElementById(idSeccion).classList.remove('hidden');
    
    document.querySelectorAll('nav button').forEach(btn => {
        btn.className = "flex-1 py-2 rounded-xl font-black uppercase tracking-tighter transition-all opacity-40 hover:opacity-100";
    });
    
    const tabActivo = document.getElementById(`tab-${idSeccion}`);
    if (tabActivo) {
        tabActivo.className = "flex-1 py-2 rounded-xl font-black uppercase tracking-tighter transition-all nav-btn-active text-white";
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
    if (idSeccion === 'sec-usuarios') {
        setTimeout(() => { refrescarUsuariosAdmin(); }, 50);
    }
    if (idSeccion === 'sec-tareas') {
        setTimeout(() => { refrescarTareas(); }, 50);
    }
    if (idSeccion === 'sec-faqs') {
        setTimeout(() => { refrescarFaqs(); }, 50);
    }
    if (idSeccion === 'sec-ajustes') {
        setTimeout(() => { renderListaAjustesKanban(); }, 50);
    }
}

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
    const addsPorDia = {}; const salesPorDia = {};
    BASE_DATOS.forEach(v => {
        if (v.fecha) {
            const fParts = v.fecha.split('-');
            if (parseInt(fParts[0]) === CAL_STOCK_ANIO && parseInt(fParts[1]) === CAL_STOCK_MES) {
                const d = parseInt(fParts[2]); addsPorDia[d] = (addsPorDia[d] || 0) + 1;
            }
        }
        if (v.fechaVenta) {
            const fParts = v.fechaVenta.split('-');
            if (parseInt(fParts[0]) === CAL_STOCK_ANIO && parseInt(fParts[1]) === CAL_STOCK_MES) {
                const d = parseInt(fParts[2]); salesPorDia[d] = (salesPorDia[d] || 0) + 1;
            }
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

window.handleDragStartTarea = function(e, id) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData("text/tarea-id", id); setTimeout(() => { e.target.classList.add('opacity-30'); }, 0); };
window.handleDropTarea = async function(e, nuevoEstado) {
    e.preventDefault(); window.clearDrop(e);
    const id = e.dataTransfer.getData("text/tarea-id"); if(!id) return;
    
    const idx = LISTA_TAREAS.findIndex(t => t._id === id);
    if(idx !== -1) { LISTA_TAREAS[idx].estado = nuevoEstado; renderKanbanTareas(); }
    
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
                <td class="py-4 px-2 font-black lowercase">${u.email}</td>
                <td class="py-4 px-2 text-[10px]"><span class="bg-indigo-500/20 text-indigo-400 px-2 py-1 rounded font-bold uppercase tracking-widest border border-indigo-500/20">${u.rol || 'Admin'}</span></td>
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
    container.innerHTML = clientes.map(c => `
        <div class="card-bg border rounded-3xl p-5 flex flex-col gap-3 hover:scale-[1.02] transition-transform shadow-xl">
            <div class="flex justify-between items-start">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-black text-xl shadow-md border-2 border-white/10">
                        ${c.nombre.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <h4 class="font-black text-sm uppercase tracking-tight text-blue-400">${c.nombre}</h4>
                        <span class="text-[10px] font-mono opacity-50">${c.nif || 'Sin DNI/NIF'}</span>
                    </div>
                </div>
                <div class="flex gap-1">
                    <button onclick="cargarEnFormCRM('${c._id}')" class="bg-blue-500/10 hover:bg-blue-500 text-blue-400 hover:text-white p-2 rounded-xl transition-all" title="Editar">✏️</button>
                    <button onclick="borrarClienteCRM('${c._id}')" class="bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white p-2 rounded-xl transition-all" title="Eliminar">🗑️</button>
                </div>
            </div>
            <div class="text-[11px] space-y-1.5 mt-2 opacity-80">
                <p class="flex items-center gap-2"><span class="opacity-40">📞</span> <span class="font-bold tracking-wider">${c.telefono || 'Sin teléfono'}</span></p>
                <p class="flex items-center gap-2"><span class="opacity-40">✉️</span> <span class="font-mono">${c.email || 'Sin email'}</span></p>
            </div>
            ${c.comentarios ? `<div class="mt-2 p-3 bg-black/20 rounded-xl border border-white/5 text-[10px] italic opacity-80 leading-relaxed break-words">${c.comentarios}</div>` : ''}
            <div class="mt-4 pt-4 border-t border-white/10">
                <p class="text-[9px] font-black uppercase tracking-widest opacity-40 mb-2">📅 Próximas Reservas</p>
                <div class="flex flex-wrap gap-1.5">
                    ${c.reservas?.length ? c.reservas.map(r => `<span class="bg-indigo-500/20 text-indigo-400 px-2 py-1 rounded-lg text-[9px] font-bold border border-indigo-500/30">${new Date(r.fecha).toLocaleDateString()}</span>`).join('') : '<span class="text-[9px] opacity-30 italic">No hay reservas programadas</span>'}
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
    if (!container || GLOBO_INSTANCE) return;

    const loader = document.getElementById('globe-loader');
    if(loader) loader.classList.remove('hidden');

    try {
        const [locationsRes, countriesRes] = await Promise.all([
            fetch('/api/logs/locations', { credentials: 'include' }),
            fetch('/ne_110m_admin_0_countries.geojson')
        ]);

        if (!locationsRes.ok) throw new Error('Fallo al cargar datos de localización');
        const locationsData = await locationsRes.json();
        const countriesData = await countriesRes.json();

        const locations = locationsData.locations || [];
        if(loader) loader.classList.add('hidden');

        if (locations.length === 0) {
            container.innerHTML = `<div class="flex items-center justify-center h-full text-sm opacity-40 italic">No hay datos de conexión para mostrar.</div>`;
            return;
        }
        
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(container.offsetWidth, container.offsetHeight);
        container.appendChild(renderer.domElement);
        const scene = new THREE.Scene();

        const globe = new ThreeGlobe({ waitForGlobeReady: true, animateIn: true })
            .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
            .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
            .polygonsData(countriesData.features)
            .polygonCapColor(() => 'rgba(168, 85, 247, 0.15)')
            .polygonSideColor(() => 'rgba(168, 85, 247, 0.05)')
            .polygonStrokeColor(() => '#6b21a8')
            .pointsData(locations).pointLat('lat').pointLng('lon')
            .pointColor(() => '#f0abfc').pointAltitude(0.02).pointRadius(d => 0.15 + d.count * 0.08)
            .pointLabel(d => `<div class="card-bg border border-slate-700 p-2 rounded-lg text-xs"><b>${d.ciudad}, ${d.pais}</b><br>Eventos Registrados: ${d.count}</div>`)
            .onPointClick(d => {
                const modal = document.getElementById('modal-mapa-detalle'), titulo = document.getElementById('detalle-mapa-titulo'), lista = document.getElementById('detalle-mapa-lista');
                if (!modal || !titulo || !lista) return;
                titulo.innerText = `Actividad en ${d.ciudad}`;
                lista.innerHTML = (d.eventos && d.eventos.length > 0) ? d.eventos.map(ev => {
                    const isLogout = ev.accion.includes('Cerró');
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
                            </div>`;
                }).join('') : '<div class="opacity-50 italic">Sin actividad reciente.</div>';
                modal.classList.remove('hidden');
            })
            .ringsData(locations).ringLat('lat').ringLng('lon')
            .ringColor(() => (t) => `rgba(233, 138, 255, ${1-t})`)
            .ringMaxRadius(d => 3 + d.count * 0.5).ringPropagationSpeed(d => 2 + d.count * 0.2).ringRepeatPeriod(1000);
        scene.add(globe);

        const atmosphere = new THREE.Mesh(
            new THREE.SphereGeometry(globe.getGlobeRadius() * 1.1, 75, 75),
            new THREE.ShaderMaterial({
                vertexShader: `varying vec3 vNormal; void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
                fragmentShader: `varying vec3 vNormal; void main() { float intensity = pow(0.6 - dot(vNormal, vec3(0, 0, 1.0)), 2.0); gl_FragColor = vec4(0.5, 0.2, 0.8, 1.0) * intensity; }`,
                blending: THREE.AdditiveBlending, side: THREE.BackSide
            })
        );
        scene.add(atmosphere);

        const starGeometry = new THREE.BufferGeometry();
        const starVertices = [];
        for (let i = 0; i < 10000; i++) {
            const x = THREE.MathUtils.randFloatSpread(2000);
            const y = THREE.MathUtils.randFloatSpread(2000);
            const z = THREE.MathUtils.randFloatSpread(2000);
            starVertices.push(x, y, z);
        }
        starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
        const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xaaaaaa, size: 0.7 }));
        scene.add(stars);

        scene.add(new THREE.AmbientLight(0xcccccc, 1));
        scene.add(new THREE.DirectionalLight(0xffffff, 0.6));

        const camera = new THREE.PerspectiveCamera(75, container.offsetWidth / container.offsetHeight, 0.1, 1000);
        camera.position.z = 240;
        const controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.enableZoom = true;
        controls.minDistance = 150;
        controls.maxDistance = 400;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.5;

        const renderScene = new THREE.RenderPass(scene, camera);
        const bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(container.offsetWidth, container.offsetHeight), 1.0, 0.1, 0.1);
        const composer = new THREE.EffectComposer(renderer);
        composer.addPass(renderScene);
        composer.addPass(bloomPass);

        (function animate() {
            controls.update();
            composer.render();
            requestAnimationFrame(animate);
        })();

        GLOBO_INSTANCE = globe;
        
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

        doc.setFontSize(22);
        doc.text('Informe de Rendimiento - Seychelles Shop', 10, y);
        y += 10;
        doc.setFontSize(10);
        doc.text(`Fecha del Informe: ${new Date().toLocaleDateString('es-ES')}`, 10, y);
        y += 10;

        doc.setFontSize(14);
        doc.text('Resumen Financiero', 10, y);
        y += 7;
        doc.setFontSize(10);
        doc.text(`Facturación Bruta: ${document.getElementById('kpi-ingresos').innerText}`, 10, y); y += 5;
        doc.text(`Ganancia Neta: ${document.getElementById('kpi-beneficio').innerText}`, 10, y); y += 5;
        doc.text(`Inversión Total: ${document.getElementById('kpi-inversion').innerText}`, 10, y); y += 5;
        doc.text(`Retorno (ROI): ${document.getElementById('kpi-roi').innerText}`, 10, y); y += 5;
        doc.text(`Prendas Vendidas: ${document.getElementById('kpi-prendas').innerText}`, 10, y); y += 10;

        doc.setFontSize(14);
        doc.text('Productos Vendidos', 10, y);
        y += 7;
        doc.setFontSize(9);
        const nombresEstadosVenta = LISTA_ESTADOS_KANBAN.filter(e => e.rolFinanciero === 'Venta').map(e => e.nombre);
        const vendidos = BASE_DATOS.filter(v => nombresEstadosVenta.includes(v.estado));
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

function obtenerDatosFiltradosParaAnalitica() {
    const fTienda = document.getElementById('an-filtro-tienda').value;
    const fCanal = document.getElementById('an-filtro-canal').value;
    const fCat = document.getElementById('an-filtro-categoria').value;
    const fTalla = document.getElementById('an-filtro-talla').value;
    const fMin = parseFloat(document.getElementById('an-filtro-precio-min').value) || 0;
    const fMax = parseFloat(document.getElementById('an-filtro-precio-max').value) || Infinity;

    return BASE_DATOS.filter(v => {
        const eConfig = LISTA_ESTADOS_KANBAN.find(e => e.nombre === v.estado);
        if (!eConfig || eConfig.rolFinanciero !== 'Venta') return false;
        if (fTienda !== 'TODOS' && v.proveedor !== fTienda) return false;
        if (fCanal !== 'TODOS' && v.canalVenta !== fCanal) return false;
        if (fCat !== 'TODOS' && v.categoria !== fCat) return false;
        if (fTalla !== 'TODOS' && v.talla !== fTalla) return false;
        
        const precio = parseFloat(v.precioVenta || 0);
        if (precio < fMin || precio > fMax) return false;
        return true;
    });
}

function limpiarFiltrosAnalitica() {
    document.getElementById('an-filtro-tienda').value = 'TODOS';
    document.getElementById('an-filtro-canal').value = 'TODOS';
    document.getElementById('an-filtro-categoria').value = 'TODOS';
    document.getElementById('an-filtro-talla').value = 'TODOS';
    document.getElementById('an-filtro-precio-min').value = '';
    document.getElementById('an-filtro-precio-max').value = '';
    actualizarTodoElBloqueGrafico();
}

window.allowDrop = function(e) { e.preventDefault(); const col = e.currentTarget; if(col) col.classList.add('drag-over'); };
window.clearDrop = function(e) { const col = e.currentTarget; if(col) col.classList.remove('drag-over'); };

window.handleDragStart = function(e, id) { 
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData("text/plain", id);
    if (ITEMS_SELECCIONADOS_MASIVOS.includes(id)) {
        e.dataTransfer.setData("text/lote-items", JSON.stringify(ITEMS_SELECCIONADOS_MASIVOS));
    } else { e.dataTransfer.setData("text/lote-items", JSON.stringify([id])); }
    const card = document.getElementById(id);
    if(card) { setTimeout(() => { if (ITEMS_SELECCIONADOS_MASIVOS.includes(id)) { ITEMS_SELECCIONADOS_MASIVOS.forEach(xId => { const cNode = document.getElementById(xId); if(cNode) cNode.classList.add('dragging'); }); } else { card.classList.add('dragging'); } }, 0); }
};

window.handleDropColumn = async function(e, newState) {
    e.preventDefault(); window.clearDrop(e);
    const loteRaw = e.dataTransfer.getData("text/lote-items"); if (!loteRaw) return;
    const listaIds = JSON.parse(loteRaw);
    
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
    const icono = document.getElementById('icon-refresh');
    if (icono) {
        icono.classList.remove('animate-spin-once');
        void icono.offsetWidth;
        icono.classList.add('animate-spin-once');
    }
    cantarPorVoz("Sincronizando."); await reloadCoreData(true); 
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
    if(BASE_DATOS.length > 0) { actualizarTodoElBloqueGrafico(); }
}

function exportarExcel() {
    if (BASE_DATOS.length === 0) return alert("Sin datos.");
    const formateado = BASE_DATOS.map(v => ({
        Fecha: v.fecha, SKU: v.sku || 'N/A', Artículo: v.prenda, Categoría: v.categoria, Talla: v.talla,
        'Coste (€)': parseFloat(v.precioCompra || 0).toFixed(2), 'Venta (€)': parseFloat(v.precioVenta || 0).toFixed(2), 
        'Envío (€)': parseFloat(v.gastosEnvio || 0).toFixed(2), Canal: v.canalVenta || 'Vinted', Comentarios: v.comentariosProducto || '', Rating: v.rating || 0, TiendaOrigen: v.proveedor || 'Sin definir', Estado: v.estado
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
    try {
        const r = await fetch(`${BACKEND_URL}/api/ventas/${id}/estado`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ estado: nuevoEstado }) });
        if(r.ok) { 
            const eConfig = LISTA_ESTADOS_KANBAN.find(est => est.nombre === nuevoEstado);
            if (eConfig && eConfig.rolFinanciero === 'Venta') { tocarSonidoCajaRegistradora(); lanzarConfetiVenta(); cantarPorVoz("Vendido"); }
            procesarMultiplicadorCombo(); await forceRefreshDataManual(); 
        }
    } catch (err) {}
}

document.getElementById('form-escaner-pistola').onsubmit = async (e) => { e.preventDefault(); const ip = document.getElementById('input-pistola'); const skuInput = ip ? ip.value.trim() : ''; if(!skuInput) return; await ejecutarLogicaEscaneo(skuInput); if(ip) ip.value = ''; };

function toggleEscanerCamara() {
    const modulo = document.getElementById('modulo-camara'); if(!modulo) return;
    if (modulo.classList.contains('hidden')) {
        modulo.classList.remove('hidden'); if (OBJETO_ESCANER_CAMARA) { try { OBJETO_ESCANER_CAMARA.clear(); } catch(e){} }
        OBJETO_ESCANER_CAMARA = new Html5Qrcode("reader"); LECTOR_BLOQUEADO_POR_CAPTURA = false;
        OBJETO_ESCANER_CAMARA.start({ facingMode: "environment" }, { fps: 30, qrbox: { width: 260, height: 260 } }, async (codigoMapeado) => {
            if (!LECTOR_BLOQUEADO_POR_CAPTURA) {
                LECTOR_BLOQUEADO_POR_CAPTURA = true; document.getElementById('camara-ping-state').className = "w-2 h-2 rounded-full bg-amber-500 animate-pulse";
                document.getElementById('camara-text-state').innerText = "Procesado"; document.getElementById('btn-rearmar-escaner').classList.remove('hidden');
                await ejecutarLogicaEscaneo(codigoMapeado);
            }
        }, () => {}).catch(err => { modulo.classList.add('hidden'); });
    } else { cerrarCamara(); }
}

function rearmarLectorParaSiguientePrenda() { LECTOR_BLOQUEADO_POR_CAPTURA = false; document.getElementById('camara-ping-state').className = "w-2 h-2 rounded-full bg-emerald-500 animate-ping"; document.getElementById('camara-text-state').innerText = "Lector Listo"; document.getElementById('btn-rearmar-escaner').classList.add('hidden'); }
function cerrarCamara() { const modulo = document.getElementById('modulo-camara'); if(modulo) modulo.classList.add('hidden'); if (OBJETO_ESCANER_CAMARA) { OBJETO_ESCANER_CAMARA.stop().then(() => { OBJETO_ESCANER_CAMARA = null; }).catch(e => {}); } }

async function ejecutarLogicaEscaneo(skuParam) {
    try {
        const response = await fetch(`${BACKEND_URL}/api/ventas/escanear/${skuParam}`, { method: 'PUT', credentials: 'include' });
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
        const res = await fetch(`${BACKEND_URL}/api/ventas?page=1`, { credentials: 'include' });
        if (!res.ok) throw new Error('Fallo de red al cargar datos.');
        const data = await res.json();
        
        BASE_DATOS = data.ventas || [];
        CURRENT_PAGE = data.currentPage || 1;
        TOTAL_PAGES = data.totalPages || 1;

        document.getElementById('kpi-ingresos').innerText = `${(data.resumen.ingresos || 0).toFixed(2)} €`;
        document.getElementById('kpi-beneficio').innerText = `${(data.resumen.beneficio || 0).toFixed(2)} €`;
        document.getElementById('kpi-inversion').innerText = `${(data.resumen.inversion || 0).toFixed(2)} €`;
        document.getElementById('kpi-prendas').innerText = data.resumen.prendasVendidas || 0;
        document.getElementById('kpi-roi').innerText = `${(data.resumen.roi || 0).toFixed(1)}%`;

        renderKanban(true);
        updateTickerWallStreet();
        ejecutarVerificacionAlertasStock();
        actualizarVisibilidadPanelMasivo();
        renderCalendarioStock();
        
        if (!document.getElementById('sec-analitica').classList.contains('hidden')) {
            actualizarTodoElBloqueGrafico();
        }
        
        const contenedorLogs = document.getElementById('contenedor-logs-auditoria');
        if (contenedorLogs && data.logs && data.logs.length > 0) {
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
        const res = await fetch(`${BACKEND_URL}/api/ventas?page=${CURRENT_PAGE}`, { credentials: 'include' });
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
    const bloquesHorarios = ['00:00-06:00', '06:00-12:00', '12:00-18:00', '18:00-00:00'];
    const matrizDatos = Array(7).fill(0).map(() => Array(4).fill(0)); let maxVentas = 1;

    const datosFiltrados = obtenerDatosFiltradosParaAnalitica();
    datosFiltrados.forEach(v => {
        const fechaObj = v.fechaVenta ? new Date(v.fechaVenta) : new Date(); if (isNaN(fechaObj.getTime())) return;
        const diaIndex = fechaObj.getDay(); const hora = fechaObj.getHours();
        let bloqueIndex = 0;
        if (hora >= 6 && hora < 12) bloqueIndex = 1;
        else if (hora >= 12 && hora < 18) bloqueIndex = 2;
        else if (hora >= 18) bloqueIndex = 3;
        matrizDatos[diaIndex][bloqueIndex] += (parseInt(v.cantidad) || 1);
        if (matrizDatos[diaIndex][bloqueIndex] > maxVentas) maxVentas = matrizDatos[diaIndex][bloqueIndex];
    });

    const scatterData = [];
    for (let d = 0; d < 7; d++) { for (let h = 0; h < 4; h++) { if (matrizDatos[d][h] > 0) scatterData.push({ x: d, y: h, v: matrizDatos[d][h] }); } }

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
                backgroundColor: function(context) { const value = context.raw ? context.raw.v : 0; const alpha = Math.min(0.2 + (value / maxVentas) * 0.8, 1); return `rgba(${cfg.base}, ${alpha})`; },
                pointStyle: 'rectRounded', radius: function(context) { return Math.min(context.chart.width / 24, 28); }
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: { duration: 1500, easing: 'easeOutElastic', delay: (context) => context.dataIndex * 30 },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => ` ${diasSemana[context.raw.x]} (${bloquesHorarios[context.raw.y]}): ${context.raw.v} prenda(s)` } } },
            scales: {
                x: { type: 'linear', min: -0.5, max: 6.5, grid: { color: cfg.malla }, ticks: { color: cfg.texto, stepSize: 1, callback: v => diasSemana[v] } },
                y: { type: 'linear', min: -0.5, max: 3.5, grid: { color: cfg.malla }, ticks: { color: cfg.texto, stepSize: 1, callback: v => bloquesHorarios[v] } }
            }
        }
    });
}

function renderKanban(isFullRefresh = false) {
    const wrapper = document.getElementById('kanban-dynamic-wrapper');
    if (!wrapper) return;

    if (isFullRefresh) {
        let htmlColumns = '';
        LISTA_ESTADOS_KANBAN.sort((a, b) => a.orden - b.orden).forEach((est, index) => {
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
    BASE_DATOS.filter(x => { const eConfig = LISTA_ESTADOS_KANBAN.find(e => e.nombre === x.estado); return eConfig && eConfig.rolFinanciero === 'Stock'; }).forEach(x => { totalStockPorPrenda[x.prenda] = (totalStockPorPrenda[x.prenda] || 0) + 1; });

    LISTA_ESTADOS_KANBAN.forEach(est => {
        let vCount = 0;
        const colDom = document.getElementById(`col-dinamica-${est._id}`);
        if(!colDom) return;

        if (isFullRefresh) colDom.innerHTML = '';

        const criterio = CONFIG_ORDEN_COLUMNAS[est.nombre] || 'reciente';
        const query = CONFIG_FILTRO_COLUMNAS[est.nombre] || '';
        const filtroGlobalCat = document.getElementById('filtro-categoria').value;
        const filtroGlobalTalla = document.getElementById('filtro-talla').value;
        const filtroGlobalCanal = document.getElementById('filtro-canal').value;

        let filtrados = BASE_DATOS.filter(v => 
            v.estado === est.nombre &&
            (!query || v.prenda.toLowerCase().includes(query) || (v.sku && v.sku.toLowerCase().includes(query))) &&
            (filtroGlobalCat === 'TODOS' || v.categoria === filtroGlobalCat) &&
            (filtroGlobalTalla === 'TODOS' || v.talla === filtroGlobalTalla) &&
            (filtroGlobalCanal === 'TODOS' || v.canalVenta === filtroGlobalCanal)
        );
        
        filtrados.sort((a, b) => {
            if (criterio === 'precio-desc') return (b.precioVenta || 0) - (a.precioVenta || 0);
            if (criterio === 'precio-asc') return (a.precioVenta || 0) - (b.precioVenta || 0);
            if (criterio === 'nombre') return a.prenda.localeCompare(b.prenda);
            return new Date(b.fecha) - new Date(a.fecha);
        });

        const itemsToRender = isFullRefresh ? filtrados : filtrados.filter(v => !document.getElementById(v._id));

        itemsToRender.forEach(v => {
            const card = document.createElement('div'); card.id = v._id; card.setAttribute('draggable', 'true'); card.setAttribute('ondragstart', `window.handleDragStart(event, '${v._id}')`); card.setAttribute('ondragend', `this.classList.remove('dragging')`);
            
            const esStockCritico = est.rolFinanciero === 'Stock' && totalStockPorPrenda[v.prenda] < 2;
            const claseAlertaStock = esStockCritico ? 'alerta-stock-critico border-amber-500/70 bg-amber-500/5' : '';
            card.className = `kanban-card input-bg border p-4 rounded-2xl shadow-sm cursor-grab active:cursor-grabbing hover:scale-[1.01] flex items-center gap-3 select-none ${claseAlertaStock} border-${est.color}-500/30`;

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

            card.innerHTML = `
                <input type="checkbox" id="check-${v._id}" ${estaMarcado ? 'checked' : ''} onchange="manejarSeleccionCheckMasiva('${v._id}', this)" class="w-4 h-4 rounded text-blue-600 border-slate-700 bg-black/20 cursor-pointer flex-shrink-0" onclick="event.stopPropagation();">
                ${thumb}
                <div class="flex-1 min-w-0 cursor-pointer hover:opacity-80 transition-opacity" onclick="editItem('${v._id}'); event.stopPropagation();" title="Hacer clic para editar el artículo">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <h4 class="font-bold text-xs uppercase tracking-wide truncate">${v.prenda}</h4> 
                        ${badgeCanal} ${badgeTienda} ${badgeEst} ${badgeComentarios}
                    </div>
                    <span class="text-[9px] font-mono opacity-50 block mt-0.5">${v.categoria} • Talla ${v.talla} ${v.sku ? `• 🆔 ${v.sku}` : ''}</span>
                    <div class="text-[11px] mt-0.5 ${colorEstrellas} tracking-tight">${stringEstrellas}</div>
                    
                    ${fechasHtml}
                    ${miniComentario}
                    <span class="text-[10px] font-bold block mt-2 font-mono">${pVentaFormateado.toFixed(2)} €</span>
                </div>
                <div class="flex items-center gap-1.5 flex-shrink-0 text-[11px]">
                    <button onclick="duplicarPrendaIndividual('${v._id}'); event.stopPropagation();" class="bg-current/5 hover:bg-current/10 p-1 rounded-lg" title="Duplicar">👯</button>
                    <button onclick="lanzarModalImpresionEtiqueta('${v._id}'); event.stopPropagation();" class="bg-current/5 hover:bg-current/10 p-1 rounded-lg" title="Imprimir Código QR">🖨️</button>
                    <button onclick="editItem('${v._id}'); event.stopPropagation();" class="text-[10px] text-blue-500 font-bold uppercase hover:underline px-0.5">Editar</button>
                    <button onclick="deleteItem('${v._id}'); event.stopPropagation();" class="opacity-30 hover:opacity-100 text-xs px-0.5" title="Borrar">✕</button>
                </div>`;

            colDom.appendChild(card);
            vCount += (v.cantidad || 1);
        });
        
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
        txt += `<span onclick="navegarASeccion('sec-tareas'); setTimeout(() => editarTarea('${t._id}'), 100)" class="text-white font-mono uppercase cursor-pointer hover:bg-white/10 transition-colors mx-4 border border-white/20 bg-black/40 px-3 py-1 rounded-full inline-flex items-center gap-1.5"><span class="${colorTexto} font-black">${icon} TAREA ${t.estado.toUpperCase()}:</span> ${t.titulo}</span>`;
    });

    const nombresEstadosReserva = LISTA_ESTADOS_KANBAN.filter(e => e.nombre.toLowerCase().includes('reserva') || e.icono.includes('🤝')).map(e => e.nombre);
    const reservas = BASE_DATOS.filter(v => nombresEstadosReserva.includes(v.estado) || v.estado === 'Reservado');
    reservas.forEach(v => {
        txt += `<span onclick="navegarASeccion('sec-inventario'); setTimeout(() => editItem('${v._id}'), 100)" class="text-white font-mono uppercase cursor-pointer hover:bg-indigo-500/20 transition-colors mx-4 border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 rounded-full inline-flex items-center gap-1.5"><span class="text-indigo-400 font-black">🤝 RESERVA:</span> ${v.prenda} [${v.talla}]</span>`;
    });

    const nombresEstadosVenta = LISTA_ESTADOS_KANBAN.filter(e => e.rolFinanciero === 'Venta').map(e => e.nombre);
    BASE_DATOS.slice(0, 10).forEach(v => { 
        const symbol = nombresEstadosVenta.includes(v.estado) ? '<span class="text-emerald-400">▲</span>' : '<span class="text-amber-400">●</span>'; 
        txt += `<span class="text-white font-mono uppercase mx-4 inline-flex items-center gap-1">${symbol} ${v.prenda} [${v.talla}] <b class="text-slate-400 ml-1">${parseFloat(v.precioVenta || 0).toFixed(2)}€</b></span>`; 
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

function abrirModalPostVenta(itemIds, nuevoEstado) {
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
        document.getElementById('post-venta-canal').value = item.canalVenta || 'Vinted';
        document.getElementById('post-venta-comentarios').value = item.comentariosProducto || '';
        setPostVentaRating(item.rating || 0);
    } else {
        tituloEl.innerHTML = `Registrando venta de <span class="font-black text-emerald-300">${itemIds.length}</span> artículos en lote.`;
        precioContainerEl.classList.add('hidden');
        envioContainerEl.classList.add('hidden');
        document.getElementById('post-venta-precio').value = 0;
        document.getElementById('post-venta-canal').value = 'Vinted';
        document.getElementById('post-venta-comentarios').value = 'Venta en lote.';
        setPostVentaRating(0);
    }

    document.getElementById('post-venta-fecha').value = new Date().toISOString().split('T')[0];
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
        const res = await fetch(`${BACKEND_URL}/api/auth/verificar`, { credentials: 'include' }); 
        const data = await res.json();
        
        if (data.autenticado) { 
            setTheme(localStorage.getItem('seychelles-theme-multi') || 'dark');
            document.getElementById('login-box').classList.add('hidden'); 
            document.getElementById('panel-control').classList.remove('hidden'); 
            document.getElementById('ticker-bar').classList.remove('hidden'); 
            document.getElementById('user-display').innerText = `👤 Conectado: ${data.usuario.split('@')[0]} [${data.rol}]`; 

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

            await refrescarEstadosKanban();
            await refrescarYListarTiendasCloud();
            await refrescarCategoriasCloud();
            await reloadCoreData(true); 
            await cargarNotasBoard();
            actualizarVistaFotosFormulario();
        }
    } catch(e){ console.error("Error en la inicialización:", e); }
});

if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(err => {}); }); }

particlesJS("particles-js", {
    "particles": {
        "number": { "value": 35, "density": { "enable": true, "value_area": 800 } },
        "color": { "value": ["#d4af37", "#fbbf24", "#f59e0b"] },
        "shape": { "type": ["circle"] },
        "opacity": { "value": 0.5, "random": true },
        "size": { "value": 3.5, "random": true },
        "line_linked": { "enable": true, "distance": 110, "color": "#d4af37", "opacity": 0.2, "width": 1 },
        "move": { "enable": true, "speed": 1.5, "direction": "none", "random": true, "out_mode": "out" }
    },
    "interactivity": { "events": { "onhover": { "enable": true, "mode": "grab" }, "resize": true } },
    "retina_detect": true
});
