// Abre el modal inicial
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

// REALIZA EL SCRAPING DESDE EL NAVEGADOR (ORDENADOR LOCAL) PARA EVITAR BLOQUEOS DE IP
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
        if (!response.ok) throw new Error('Error al comparar con la base de datos.');

        resultadosScraperActual = data;
        console.log("Análisis completado:", resultadosScraperActual);
        
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

// Procesa el archivo Excel/CSV subido manualmente
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

                // Limpieza de precios europeos
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

    // Renderizar Discrepancias (Cambios de precio)
    if (discCount > 0) {
        data.discrepancias.forEach((d, i) => {
            const tituloMostrado = d.prendaNueva || d.prenda;
            tbody.innerHTML += `
                <tr class="border-b border-white/5 align-middle">
                    <td class="py-2 pr-2 w-8"><input type="checkbox" class="check-disc-scraper" value="${i}" checked></td>
                    <td class="py-2"><img src="${d.imagen || ''}" onclick="abrirVisorScraper('disc', ${i})" class="w-8 h-8 rounded object-cover border border-white/10 cursor-pointer hover:scale-110 transition-transform" title="Ver foto" onerror="this.src='https://via.placeholder.com/60'"></td>
                    <td class="py-2 px-2">
                        <input type="text" id="disc-item-title-${i}" value="${tituloMostrado}" class="bg-transparent border-b border-white/10 text-[11px] font-bold uppercase w-full focus:outline-none focus:border-amber-400 px-1 py-0.5 text-white" placeholder="Título...">
                        <div class="text-[8px] opacity-40 mt-0.5 lowercase">En Mongo: ${d.prenda}</div>
                    </td>
                    <td class="py-2 text-rose-400/50 line-through text-[11px] font-mono text-right">${d.valorAntiguo}€</td>
                    <td class="py-2 text-emerald-400 font-black text-right">
                        <input type="number" id="disc-item-price-${i}" value="${d.valorNuevo}" step="0.01" class="bg-transparent border-b border-white/10 text-[11px] text-emerald-400 font-mono w-14 focus:outline-none focus:border-emerald-400 px-1 py-0.5 text-right"> €
                    </td>
                </tr>`;
        });
    }

    // Renderizar Nuevos Productos
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
                                <img src="${n.imagen || ''}" class="w-14 h-14 rounded-xl object-cover shadow-md group-hover:scale-105 transition-transform" onerror="this.src='https://via.placeholder.com/60'">
                                ${badgeGaleriaInfo}
                            </div>
                        <div class="min-w-0 flex-1 flex flex-col gap-1.5 pr-6">
                            <input type="text" id="new-item-title-${i}" value="${n.prenda}" class="bg-transparent border-b border-white/10 text-[11px] font-bold uppercase w-full focus:outline-none focus:border-emerald-400 px-1 py-0.5 text-white transition-colors" placeholder="Título a guardar...">
                            <div class="flex items-center gap-1 mt-1">
                                <span class="text-[9px] opacity-60">Precio:</span>
                                <input type="number" id="new-item-price-${i}" value="${n.precioVenta}" step="0.01" class="bg-transparent border-b border-white/10 text-[11px] text-emerald-400 font-mono w-16 focus:outline-none focus:border-emerald-400 px-1 py-0.5 transition-colors text-right">
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

    // Renderizar Idénticos (Ya en sistema sin cambios)
    if (identCount > 0) {
        data.identicos.forEach((n, i) => {
            gridExistentes.innerHTML += `
                <div class="flex items-center gap-3 p-2 bg-white/5 border border-white/5 rounded-xl">
                    <img src="${n.imagen || ''}" class="w-8 h-8 rounded object-cover grayscale" onerror="this.src='https://via.placeholder.com/60'">
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

// Sincroniza precios de productos existentes
async function autorizarCambiosScraping() {
    const checkNodes = Array.from(document.querySelectorAll('.check-disc-scraper:checked'));
    const selected = checkNodes.map(cb => {
        const idx = cb.value;
        const item = resultadosScraperActual.discrepancias[idx];
        const tituloEditado = document.getElementById(`disc-item-title-${idx}`).value.trim() || item.prendaNueva || item.prenda;
        const precioEditado = parseFloat(document.getElementById(`disc-item-price-${idx}`).value) || item.valorNuevo;
        return { idMongo: item.idMongo, prenda: tituloEditado, valorNuevo: precioEditado };
    });
    if (selected.length === 0) return alert('Selecciona algún cambio a sincronizar.');

    if (!confirm(`¿Estás seguro de actualizar estos ${selected.length} artículos en MongoDB basándote en lo encontrado en Vinted?`)) return;

    try {
        const response = await fetch('/api/scraper/aplicar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cambios: selected })
        });

        if (!response.ok) throw new Error('Fallo al actualizar.');

        cantarPorVoz("Precios actualizados.");
        alert(`✅ Se han actualizado los precios de ${selected.length} artículos correctamente.`);
        if (typeof forceRefreshDataManual === "function") {
            await forceRefreshDataManual();
        }
        
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

// Importa productos nuevos
async function importarNuevosScraping() {
    const checkNodes = Array.from(document.querySelectorAll('.check-new-scraper:checked'));
    const selected = checkNodes.map(cb => {
        const idx = cb.value;
        const itemOriginal = resultadosScraperActual.nuevos[idx];
        const tituloEditado = document.getElementById(`new-item-title-${idx}`).value.trim() || itemOriginal.prenda;
        const precioEditado = parseFloat(document.getElementById(`new-item-price-${idx}`).value) || itemOriginal.precioVenta;
        const catEditada = document.getElementById(`new-item-cat-${idx}`).value || 'General';
        const tallaEditada = document.getElementById(`new-item-talla-${idx}`).value || 'Única';
        const costEditado = parseFloat(document.getElementById(`new-item-cost-${idx}`)?.value) || 0;
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
            body: JSON.stringify({ productos: selected })
        });

        if (!response.ok) throw new Error('Fallo al importar.');

        const res = await response.json();
        alert(`✅ Se han importado ${res.count} productos exitosamente con sus fotografías a la base de datos.\n\nYa puedes verificarlos en tu inventario.`);
        cantarPorVoz("Importación completada.");

        if (typeof forceRefreshDataManual === "function") {
            await forceRefreshDataManual();
        }
        
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
        iniciarScraping(); // Refrescar lista
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