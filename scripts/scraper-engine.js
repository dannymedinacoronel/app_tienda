const axios = require('axios');
const cheerio = require('cheerio');
const os = require('os');
const path = require('path');
const fs = require('fs');

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';
const VINTED_BASE_DEFAULT = 'https://www.vinted.es';
const VINTED_PER_PAGE = 96;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
    const a = Number(min) || 0;
    const b = Number(max) || 0;
    return Math.floor(a + Math.random() * Math.max(1, b - a + 1));
}

// Reintenta solo errores transitorios (red, 429, 5xx): un 404 o 401 no mejora reintentando.
function esErrorTransitorio(error) {
    const status = error?.response?.status;
    return !status || status === 429 || status >= 500;
}

async function withRetry(task, options = {}) {
    const retries = Number.isFinite(options.retries) ? options.retries : 2;
    const baseDelay = Number.isFinite(options.baseDelay) ? options.baseDelay : 600;
    const factor = Number.isFinite(options.factor) ? options.factor : 2;
    const shouldRetry = typeof options.shouldRetry === 'function' ? options.shouldRetry : esErrorTransitorio;
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await task(attempt);
        } catch (error) {
            lastError = error;
            if (attempt >= retries || !shouldRetry(error)) break;
            const delay = Math.round(baseDelay * Math.pow(factor, attempt));
            await sleep(delay);
        }
    }
    throw lastError;
}

function parseIntEnv(name, fallback, min, max) {
    const n = parseInt(process.env[name] || '', 10);
    const valor = Number.isFinite(n) ? n : fallback;
    return Math.max(min, Math.min(valor, max));
}

// Ejecuta tareas con un máximo de N en paralelo, conservando el orden de resultados.
async function ejecutarConConcurrencia(items, limite, tarea) {
    const lista = Array.isArray(items) ? items : [];
    const resultados = new Array(lista.length).fill(null);
    let siguiente = 0;
    const trabajadores = Array.from({ length: Math.max(1, Math.min(limite, lista.length)) }, async () => {
        while (siguiente < lista.length) {
            const indice = siguiente++;
            try {
                resultados[indice] = await tarea(lista[indice], indice);
            } catch (error) {
                console.warn(`[SCRAPER] Tarea ${indice + 1}/${lista.length} falló: ${error.message}`);
                resultados[indice] = null;
            }
        }
    });
    await Promise.all(trabajadores);
    return resultados;
}

function normalizarEmpresa(empresa) {
    return String(empresa || 'seychelles')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .slice(0, 60) || 'seychelles';
}

function normalizarTexto(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function normalizarPrecio(value) {
    if (value == null) return NaN;
    let raw = String(value).trim();
    if (!raw) return NaN;

    raw = raw
        .replace(/\s+/g, '')
        .replace(/€/g, '')
        .replace(/eur/gi, '')
        .replace(/[^\d.,-]/g, '');

    if (!raw) return NaN;

    const lastComma = raw.lastIndexOf(',');
    const lastDot = raw.lastIndexOf('.');

    if (lastComma > -1 && lastDot > -1) {
        if (lastComma > lastDot) {
            raw = raw.replace(/\./g, '').replace(',', '.');
        } else {
            raw = raw.replace(/,/g, '');
        }
    } else if (lastComma > -1) {
        raw = raw.replace(',', '.');
    }

    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) return NaN;
    return Number(num.toFixed(2));
}

function scoreProducto(p) {
    if (!p) return -1;
    let score = 0;
    if (p.titulo) score += Math.min(String(p.titulo).length, 80);
    if (Number.isFinite(p.precio)) score += 50;
    if (p.imagen) score += 12;
    if (p.descripcion) score += 8;
    if (p.marca) score += 6;
    if (p.talla) score += 4;
    if (p.condicion) score += 4;
    return score;
}

function firmaProducto(p) {
    const t = normalizarTexto(p.titulo).slice(0, 90);
    const precio = Number.isFinite(p.precio) ? p.precio.toFixed(2) : 'na';
    return `${t}__${precio}`;
}

// Id estable del anuncio (id de la API o el número de /items/123-slug).
function claveIdProducto(p) {
    if (p?.id) return `id:${p.id}`;
    const m = String(p?.url || '').match(/\/items\/(\d+)/);
    return m ? `id:${m[1]}` : '';
}

function textoPlano(valor) {
    if (valor == null) return '';
    if (typeof valor === 'object') return String(valor.title || valor.name || valor.label || '').trim();
    return String(valor).trim();
}

function limpiarProducto(input, fuente = '') {
    if (!input || typeof input !== 'object') return null;

    const titulo = String(input.titulo || input.title || input.name || '').trim();
    const precio = normalizarPrecio(input.precio ?? input.price ?? input.amount);
    if (!titulo || !Number.isFinite(precio)) return null;

    const galeria = (Array.isArray(input.galeria) ? input.galeria : [])
        .map((g) => String(g || '').trim())
        .filter((g) => /^https?:\/\//i.test(g))
        .slice(0, 12);

    const producto = {
        titulo,
        precio,
        imagen: String(input.imagen || input.image || '').trim(),
        galeria,
        descripcion: String(input.descripcion || input.description || '').trim(),
        marca: textoPlano(input.marca || input.brand),
        talla: textoPlano(input.talla || input.size),
        condicion: textoPlano(input.condicion || input.status),
        favoritos: Number.isFinite(Number(input.favoritos)) ? Number(input.favoritos) : 0,
        url: String(input.url || '').trim(),
        fuente
    };
    if (input.id) producto.id = String(input.id);
    if (input.vendedorId) producto.vendedorId = String(input.vendedorId);
    if (/^https?:\/\//i.test(String(input.miniatura || ''))) producto.miniatura = String(input.miniatura).trim();
    if (input.reservado) producto.reservado = true;
    if (input.vendido) producto.vendido = true;
    return producto;
}

// Deduplica por id de anuncio; lo que no tiene id se agrupa por título+precio,
// y se descarta si ya hay un anuncio con id que coincide (misma prenda vista por DOM y por API).
function deduplicarProductos(list) {
    const conId = new Map();
    const sinId = new Map();
    const firmasConId = new Set();
    for (const raw of list || []) {
        const p = limpiarProducto(raw, raw?.fuente || 'unknown');
        if (!p) continue;
        const idKey = claveIdProducto(p);
        const firma = firmaProducto(p);
        const destino = idKey ? conId : sinId;
        const key = idKey || firma;
        if (idKey) firmasConId.add(firma);
        const prev = destino.get(key);
        if (!prev || scoreProducto(p) > scoreProducto(prev)) {
            destino.set(key, p);
        }
    }
    const resultado = Array.from(conId.values());
    for (const [firma, p] of sinId) {
        if (!firmasConId.has(firma)) resultado.push(p);
    }
    return resultado;
}

function deduplicarProductosMonopolio(list) {
    const map = new Map();
    for (const raw of list || []) {
        const p = limpiarProducto(raw, raw?.fuente || 'monopolio');
        if (!p) continue;

        const cuentaKey = normalizarTexto(raw?.cuenta || raw?.proveedor || raw?.urlCuenta || 'sin-cuenta') || 'sin-cuenta';
        const key = `${cuentaKey}__${claveIdProducto(p) || firmaProducto(p)}`;
        const prev = map.get(key);

        const candidate = {
            ...raw,
            ...p
        };

        if (!prev || scoreProducto(candidate) > scoreProducto(prev)) {
            map.set(key, candidate);
        }
    }
    return Array.from(map.values());
}

function mapearProductoVinted(item, fuente = 'api', base = VINTED_BASE_DEFAULT) {
    if (!item || typeof item !== 'object') return null;
    const precio = normalizarPrecio(
        item?.price?.amount ??
        item?.price_numeric ??
        item?.total_item_price?.amount ??
        item?.total_item_price ??
        (typeof item?.price === 'object' ? null : item?.price)
    );
    const titulo = String(item.title || item.name || item.item_title || '').trim();
    if (!titulo || !Number.isFinite(precio)) return null;

    const fotosBrutas = Array.isArray(item.photos) && item.photos.length ? item.photos : (item.photo ? [item.photo] : []);
    const fotos = fotosBrutas
        .map((f) => (typeof f === 'string' ? f : (f?.url || f?.full_size_url || '')))
        .filter(Boolean);
    // Miniatura ligera (150x210, ~15 KB) para tarjetas; cada tamaño lleva su propia firma.
    const thumbs = Array.isArray(fotosBrutas[0]?.thumbnails) ? fotosBrutas[0].thumbnails : [];
    const miniatura = (thumbs.find((t) => t?.type === 'thumb150x210') || thumbs.find((t) => t?.type === 'thumb310x430') || {}).url || '';
    const rutaItem = String(item.url || item.path || '').trim();
    const urlItem = rutaItem
        ? (/^https?:\/\//i.test(rutaItem) ? rutaItem : `${base}${rutaItem.startsWith('/') ? '' : '/'}${rutaItem}`)
        : (item.id ? `${base}/items/${item.id}` : '');

    const producto = {
        id: item.id || '',
        titulo,
        precio,
        imagen: fotos[0] || item?.image_url || '',
        galeria: fotos.slice(1),
        descripcion: item.description || '',
        marca: textoPlano(item.brand_title || item.brand),
        talla: textoPlano(item.size_title || item.size),
        condicion: textoPlano(item.status_title || item.status),
        favoritos: Number(item.favourite_count ?? item.favorites_count ?? 0) || 0,
        url: urlItem,
        vendedorId: item.user_id ?? item.user?.id ?? '',
        miniatura,
        reservado: Boolean(item.is_reserved),
        vendido: Boolean(item.is_closed && (item.item_closing_action === 'sold' || !item.item_closing_action)),
        fuente
    };
    return limpiarProducto(producto, fuente);
}

function extraerMemberId(urlObjetivo) {
    const str = String(urlObjetivo || '');
    const direct = str.match(/\/member\/(\d+)/i);
    if (direct && direct[1]) return direct[1];

    const withGeneral = str.match(/\/member\/general\/(\d+)(?:-[^/?#]+)?/i);
    if (withGeneral && withGeneral[1]) return withGeneral[1];

    const relationTail = str.match(/\/(?:following|followers|relations)\/(\d+)(?:-[^/?#]+)?/i);
    if (relationTail && relationTail[1]) return relationTail[1];

    return '';
}

function sanitizarAlias(alias, fallback = 'Vinted') {
    return String(alias || fallback)
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 80) || fallback;
}

function esUrlSeguidoresVinted(url) {
    const u = String(url || '').toLowerCase();
    return u.includes('/following') || u.includes('/followers') || u.includes('/relations');
}

function extraerAliasDesdeUrlPerfil(url) {
    const str = String(url || '').trim();
    const match = str.match(/\/member\/\d+-([a-z0-9_-]+)/i);
    if (match && match[1]) {
        return match[1].replace(/[-_]+/g, ' ');
    }
    return 'Competidor';
}

function normalizarUrlVinted(inputUrl) {
    const raw = String(inputUrl || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    return `https://${raw}`;
}

// Dominio de Vinted de la URL (vinted.fr, vinted.it...) o vinted.es por defecto.
function baseVintedDesdeUrl(inputUrl) {
    try {
        const u = new URL(normalizarUrlVinted(inputUrl));
        if (/(^|\.)vinted\.[a-z.]+$/i.test(u.hostname)) return `https://${u.hostname}`;
    } catch (_) {}
    return VINTED_BASE_DEFAULT;
}

// --- Sesión anónima para la API de Vinted ---
// La API devuelve 401 sin la cookie de sesión que Vinted da al visitar la portada.
// La pedimos una vez por dominio y la reutilizamos (se renueva ante un 401/403).
const COOKIES_VINTED = new Map();
const COOKIES_VINTED_TTL_MS = 10 * 60 * 1000;

// Vinted manda algunas cookies dos veces (primero vacía para borrarla y luego la buena):
// nos quedamos con el último valor no vacío de cada nombre.
function cookiesDeRespuesta(response) {
    const setCookie = response?.headers?.['set-cookie'];
    const lista = Array.isArray(setCookie) ? setCookie : (setCookie ? [setCookie] : []);
    const jar = new Map();
    for (const linea of lista) {
        const par = String(linea).split(';')[0];
        const igual = par.indexOf('=');
        if (igual <= 0) continue;
        const nombre = par.slice(0, igual).trim();
        const valor = par.slice(igual + 1).trim();
        if (valor) jar.set(nombre, valor);
    }
    return [...jar].map(([nombre, valor]) => `${nombre}=${valor}`);
}

async function obtenerCookiesVinted(base, forzar = false) {
    const hit = COOKIES_VINTED.get(base);
    if (!forzar && hit && (Date.now() - hit.ts) < COOKIES_VINTED_TTL_MS) return hit.cookie;
    try {
        // Solo necesitamos las cabeceras: cortamos la descarga de la portada (~1,7 MB).
        const response = await axios.get(`${base}/`, {
            timeout: 15000,
            maxRedirects: 5,
            responseType: 'stream',
            validateStatus: () => true,
            headers: {
                'User-Agent': DEFAULT_UA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
            }
        });
        try { response.data.destroy(); } catch (_) {}
        const cookie = cookiesDeRespuesta(response).join('; ');
        COOKIES_VINTED.set(base, { cookie, ts: Date.now() });
        return cookie;
    } catch (error) {
        console.warn(`[SCRAPER] No se pudo abrir sesión en ${base}: ${error.message}`);
        return hit?.cookie || '';
    }
}

async function getApiVinted(base, ruta, params = {}, referer = '') {
    const pedir = (cookie) => axios.get(`${base}${ruta}`, {
        params,
        timeout: 18000,
        headers: {
            'User-Agent': DEFAULT_UA,
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
            'Referer': referer || `${base}/`,
            ...(cookie ? { Cookie: cookie } : {})
        }
    });

    const cookie = await obtenerCookiesVinted(base);
    try {
        return await pedir(cookie);
    } catch (error) {
        const status = error?.response?.status;
        if (status !== 401 && status !== 403) throw error;
        // Cookie caducada o rechazada: pedimos una nueva y reintentamos una vez.
        return pedir(await obtenerCookiesVinted(base, true));
    }
}

function extraerItemsDePayload(data) {
    if (!data || typeof data !== 'object') return [];
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.catalog_items)) return data.catalog_items;
    if (Array.isArray(data?.data?.items)) return data.data.items;
    if (Array.isArray(data?.data?.catalog_items)) return data.data.catalog_items;
    return [];
}

function itemPerteneceAUsuario(item, userId) {
    const propietario = item?.user?.id ?? item?.user_id ?? item?.owner_id;
    return propietario == null ? false : String(propietario) === String(userId);
}

// --- Ficha completa de una prenda (página /items/:id) ---
// Sin login la API no da la ficha, y el armario público solo lista lo que está a la venta.
// La página de la prenda sí trae sus datos incrustados (payload de Next.js, al final del HTML):
// sirve para confirmar si se vendió y para completar la importación (descripción, color...).
const BARRA = String.fromCharCode(92);

// Lee un literal de cadena JSON que empieza en texto[inicio] === '"'. Devuelve [valor, fin].
function leerCadenaJson(texto, inicio) {
    let i = inicio + 1;
    while (i < texto.length) {
        const c = texto[i];
        if (c === BARRA) { i += 2; continue; }
        if (c === '"') break;
        i += 1;
    }
    const literal = texto.slice(inicio, i + 1);
    try {
        return [JSON.parse(literal), i + 1];
    } catch (_) {
        return [literal.slice(1, -1), i + 1];
    }
}

// Une los fragmentos self.__next_f.push([1,"..."]) ya decodificados (JSON legible).
function payloadNextDesdeHtml(html) {
    const marca = 'self.__next_f.push([1,';
    const partes = [];
    let pos = html.indexOf(marca);
    while (pos >= 0) {
        const ini = pos + marca.length;
        if (html[ini] === '"') {
            const [texto, fin] = leerCadenaJson(html, ini);
            partes.push(texto);
            pos = html.indexOf(marca, fin);
        } else {
            pos = html.indexOf(marca, ini);
        }
    }
    return partes.join('');
}

// Lee el array/objeto JSON que empieza en texto[inicio] ('[' o '{'), respetando cadenas.
function leerJsonEstructurado(texto, inicio) {
    const apertura = texto[inicio];
    if (apertura !== '[' && apertura !== '{') return null;
    let profundidad = 0;
    let i = inicio;
    while (i < texto.length) {
        const c = texto[i];
        if (c === '"') { i = leerCadenaJson(texto, i)[1]; continue; }
        if (c === '[' || c === '{') profundidad += 1;
        else if (c === ']' || c === '}') {
            profundidad -= 1;
            if (profundidad === 0) {
                try { return JSON.parse(texto.slice(inicio, i + 1)); } catch (_) { return null; }
            }
        }
        i += 1;
    }
    return null;
}

function cadenaTras(texto, clave, desde = 0, hasta = Infinity) {
    const i = texto.indexOf(clave, desde);
    if (i < 0 || i > hasta) return '';
    const j = i + clave.length;
    return texto[j] === '"' ? String(leerCadenaJson(texto, j)[0] || '') : '';
}

function atributoFicha(texto, codigo) {
    const i = texto.indexOf(`"code":"${codigo}","data":{`);
    if (i < 0) return '';
    return cadenaTras(texto, '"value":', i, i + 800);
}

function booleanoEnBloque(bloque, clave) {
    const i = bloque.indexOf(clave);
    if (i < 0) return null;
    return bloque.startsWith('true', i + clave.length);
}

function extraerFichaDesdeHtml(html, itemId) {
    const texto = payloadNextDesdeHtml(String(html || ''));
    const id = String(itemId || '');

    // Estado de compra de ESTA prenda (la página también trae prendas recomendadas).
    let bloqueCompra = '';
    const anclaId = id ? texto.indexOf(`"item_id":"${id}"`) : -1;
    const anclaCompra = texto.indexOf('"can_buy":');
    if (anclaId >= 0) {
        const previo = texto.lastIndexOf('"can_buy":', anclaId);
        if (previo >= 0 && anclaId - previo < 400) bloqueCompra = texto.slice(previo, anclaId + 60);
    }
    if (!bloqueCompra && anclaCompra >= 0) bloqueCompra = texto.slice(anclaCompra, anclaCompra + 300);

    const puedeComprar = booleanoEnBloque(bloqueCompra, '"can_buy":');
    const oculta = booleanoEnBloque(bloqueCompra, '"is_hidden":');
    const reservada = booleanoEnBloque(bloqueCompra, '"is_reserved":');
    const selloVendido = /Cell__body">\s*(Vendido|Sold|Vendu|Venduto|Verkauft)\s*</.test(html);

    let estado = 'desconocido';
    if (oculta === true) estado = 'oculto';
    else if (reservada === true) estado = 'reservado';
    else if (selloVendido || puedeComprar === false) estado = 'vendido';
    else if (puedeComprar === true) estado = 'activo';

    // Ruta de categoría desde las migas de pan (Mujer › Ropa › Vestidos...).
    const iMigas = texto.indexOf('"name":"breadcrumbs"');
    const zonaMigas = iMigas >= 0 ? texto.slice(Math.max(0, iMigas - 2500), iMigas) : '';
    const categoria = [...zonaMigas.matchAll(/"title":"([^"]{1,60})","url":"\/catalog\/\d+[^"\/]*"/g)]
        .map((m) => m[1])
        .join(' › ');

    // Fotos de la prenda: el primer "photos":[ es el de la propia ficha (empieza por la principal).
    const iFotos = texto.indexOf('"photos":[');
    const fotosJson = iFotos >= 0 ? leerJsonEstructurado(texto, iFotos + '"photos":'.length) : null;
    const fotos = (Array.isArray(fotosJson) ? fotosJson : [])
        .map((f) => f?.url || f?.full_size_url || '')
        .filter((u) => /^https?:\/\//i.test(u));
    const thumbsPrincipal = Array.isArray(fotosJson?.[0]?.thumbnails) ? fotosJson[0].thumbnails : [];
    const miniatura = (thumbsPrincipal.find((t) => t?.type === 'thumb150x210') || {}).url || '';

    return {
        estado,
        fotos,
        miniatura,
        descripcion: cadenaTras(texto, '"description":').trim(),
        color: atributoFicha(texto, 'color'),
        talla: atributoFicha(texto, 'size'),
        condicion: atributoFicha(texto, 'status'),
        marca: atributoFicha(texto, 'brand'),
        categoria
    };
}

// Consulta la ficha de una prenda. estado: activo | reservado | vendido | oculto | eliminado | desconocido
async function obtenerFichaItemVinted(idOUrl, baseOpcional) {
    const id = String(idOUrl || '').match(/(\d{5,})/)?.[1] || '';
    if (!id) return { estado: 'desconocido' };
    const base = baseOpcional || baseVintedDesdeUrl(idOUrl);
    const cookie = await obtenerCookiesVinted(base);
    let ultimoFallo = {};
    // Un reintento corto si Vinted limita (429), falla (5xx) o la red corta; 404/403 son respuestas reales.
    for (let intento = 0; intento < 2; intento++) {
        if (intento > 0) await new Promise((resolve) => setTimeout(resolve, 1500 + Math.floor(Math.random() * 1500)));
        try {
            const respuesta = await axios.get(`${base}/items/${id}`, {
                timeout: 20000,
                maxRedirects: 5,
                validateStatus: () => true,
                headers: {
                    'User-Agent': DEFAULT_UA,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                    ...(cookie ? { Cookie: cookie } : {})
                }
            });
            if (respuesta.status === 404 || respuesta.status === 410) return { estado: 'eliminado' };
            const urlFinal = String(respuesta.request?.res?.responseUrl || '');
            if (urlFinal && !/\/items\/\d+/.test(urlFinal)) return { estado: 'eliminado' };
            if (respuesta.status === 200) return extraerFichaDesdeHtml(String(respuesta.data || ''), id);
            ultimoFallo = { status: respuesta.status };
            if (respuesta.status !== 429 && respuesta.status < 500) break;
        } catch (error) {
            ultimoFallo = { error: error.message };
        }
    }
    return { estado: 'desconocido', ...ultimoFallo };
}

function extraerIdPerfilDesdePath(pathOnly) {
    const cleanPath = String(pathOnly || '');
    if (!cleanPath) return '';

    // Caso canonico: /member/<id> o /member/general/<id>-alias
    const direct = cleanPath.match(/\/member\/(?:general\/)?(\d{3,})(?:-[^/?#]+)?/i);
    if (direct && direct[1]) return direct[1];

    // Caso observado en produccion: /member/general/following/<id>
    const relTail = cleanPath.match(/\/(following|followers|relations)\/(\d{3,})(?:-[^/?#]+)?$/i);
    if (relTail && relTail[2]) return relTail[2];

    // Fallback final: ultimo bloque numerico del path
    const anyNumeric = cleanPath.match(/\/(\d{3,})(?:-[^/?#]+)?(?:\/)?$/i);
    return anyNumeric && anyNumeric[1] ? anyNumeric[1] : '';
}

function normalizarUrlPerfilVinted(inputUrl) {
    const abs = normalizarUrlVinted(inputUrl);
    if (!abs) return '';

    let urlObj;
    try {
        urlObj = new URL(abs);
    } catch (_) {
        return '';
    }

    const pathOnly = String(urlObj.pathname || '').replace(/\/+$/, '');
    if (!pathOnly.toLowerCase().includes('/member/')) return '';

    // Evitar rutas de relación/listados, queremos URL de perfil.
    if (/\/(following|followers|relations)\b/i.test(pathOnly)) {
        const idInPath = extraerIdPerfilDesdePath(pathOnly);
        if (!idInPath) return '';
        return `https://www.vinted.es/member/${idInPath}`;
    }

    const idPerfil = extraerIdPerfilDesdePath(pathOnly);
    if (idPerfil) {
        return `https://www.vinted.es/member/${idPerfil}`;
    }

    // Fallback: conservar ruta miembro limpia si no encontramos id, pero evitar query/hash.
    urlObj.search = '';
    urlObj.hash = '';
    return urlObj.toString().replace(/\/+$/, '');
}

function normalizarUrlRelacionVinted(inputUrl) {
    const abs = normalizarUrlVinted(inputUrl);
    if (!abs) return '';

    let urlObj;
    try {
        urlObj = new URL(abs);
    } catch (_) {
        return '';
    }

    const pathOnly = String(urlObj.pathname || '').replace(/\/+$/, '');
    const relMatch = pathOnly.match(/\/(following|followers|relations)\b/i);
    if (!relMatch || !relMatch[1]) return '';
    const relationType = relMatch[1].toLowerCase();

    if (!pathOnly.toLowerCase().includes('/member/')) return '';

    const idPerfil = extraerIdPerfilDesdePath(pathOnly);
    if (!idPerfil) return '';

    return `https://www.vinted.es/member/${idPerfil}/${relationType}`;
}

function construirUrlFollowingDesdePerfil(urlPerfil) {
    const perfil = normalizarUrlPerfilVinted(urlPerfil);
    if (!perfil) return '';
    return `${perfil}/following`;
}

function obtenerSemillaRelacionMonopolio(inputUrl) {
    const relation = normalizarUrlRelacionVinted(inputUrl);
    if (relation) return relation;

    const perfil = normalizarUrlPerfilVinted(inputUrl);
    if (!perfil) return '';

    return normalizarUrlRelacionVinted(construirUrlFollowingDesdePerfil(perfil));
}

function clasificarPrecioMonopolio(precioRaw) {
    const precio = normalizarPrecio(precioRaw);
    if (!Number.isFinite(precio)) return 'sin_precio';
    if (precio < 12) return 'entry';
    if (precio < 35) return 'medio';
    return 'premium';
}

function clasificarCondicionMonopolio(condicionRaw) {
    const txt = normalizarTexto(condicionRaw);
    if (!txt) return 'sin_dato';
    if (txt.includes('nuevo') || txt.includes('new')) return 'nueva';
    if (txt.includes('muy buena') || txt.includes('very good')) return 'muy_buena';
    if (txt.includes('buena') || txt.includes('good')) return 'buena';
    return 'usada';
}

function enriquecerProductoMonopolio(producto, meta = {}) {
    const base = limpiarProducto(producto, producto?.fuente || 'monopolio') || producto;
    return {
        ...base,
        proveedor: meta.cuenta || base?.proveedor || '',
        cuenta: meta.cuenta || base?.cuenta || '',
        urlCuenta: meta.urlCuenta || base?.urlCuenta || '',
        origenGrupo: meta.origenGrupo || base?.origenGrupo || '',
        nivelCadena: Number.isFinite(Number(meta.nivelCadena)) ? Number(meta.nivelCadena) : 0,
        parentUrl: meta.parentUrl || '',
        parentCuenta: meta.parentCuenta || '',
        clasificacionPrecio: clasificarPrecioMonopolio(base?.precio),
        clasificacionCondicion: clasificarCondicionMonopolio(base?.condicion)
    };
}

function normalizarUrlItemVinted(inputUrl) {
    const abs = normalizarUrlVinted(inputUrl);
    if (!abs) return '';

    let urlObj;
    try {
        urlObj = new URL(abs);
    } catch (_) {
        return '';
    }

    const pathOnly = String(urlObj.pathname || '').replace(/\/+$/, '');
    if (!/\/items\//i.test(pathOnly)) return '';

    urlObj.search = '';
    urlObj.hash = '';
    return urlObj.toString().replace(/\/+$/, '');
}

function clasificarUrlVinted(inputUrl) {
    const raw = String(inputUrl || '').trim();
    const item = normalizarUrlItemVinted(raw);
    const relation = normalizarUrlRelacionVinted(raw);
    const profile = normalizarUrlPerfilVinted(raw);

    if (relation) return { tipo: 'relation', url: relation, score: 100 };
    if (profile) return { tipo: 'profile', url: profile, score: 95 };
    if (item) return { tipo: 'item', url: item, score: 70 };
    return { tipo: 'other', url: normalizarUrlVinted(raw), score: 0 };
}

function parseBoolEnv(name, fallback = false) {
    const raw = String(process.env[name] || '').trim().toLowerCase();
    if (!raw) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(raw);
}

function leerStorageStateDesdeEnv() {
    const b64 = String(process.env.VINTED_STORAGE_STATE_B64 || '').trim();
    if (!b64) return null;
    try {
        const json = Buffer.from(b64, 'base64').toString('utf8');
        const parsed = JSON.parse(json);
        if (parsed && typeof parsed === 'object') return parsed;
    } catch (error) {
        console.warn(`[SCRAPER] VINTED_STORAGE_STATE_B64 invalido: ${error.message}`);
    }
    return null;
}

async function crearSesionNavegador(tag = 'scraper') {
    let chromium;
    try {
        ({ chromium } = require('playwright'));
    } catch (_) {
        return null;
    }

    const headless = !parseBoolEnv('SCRAPER_SHOW_BROWSER', false);
    const storageState = leerStorageStateDesdeEnv();
    const locale = String(process.env.SCRAPER_LOCALE || 'es-ES');
    const timezoneId = String(process.env.SCRAPER_TIMEZONE || 'Europe/Madrid');
    const userDataDir = path.join(os.tmpdir(), `seychelles-${tag}-${Date.now()}-${randomBetween(100, 999)}`);

    let browser;
    try {
        browser = await chromium.launch({
            headless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
            ]
        });
    } catch (error) {
        // Playwright instalado pero sin Chromium (p. ej. en Render): seguimos sin navegador.
        console.warn(`[SCRAPER] No se pudo arrancar Chromium: ${error.message.split('\n')[0]}`);
        return null;
    }

    const context = await browser.newContext({
        locale,
        timezoneId,
        userAgent: DEFAULT_UA,
        viewport: { width: 1366, height: 900 },
        storageState: storageState || undefined
    });

    // Las URLs de las fotos ya están en el DOM/JSON: no hace falta descargarlas.
    if (parseBoolEnv('SCRAPER_BLOCK_MEDIA', true)) {
        await context.route('**/*', (route) => {
            const tipo = route.request().resourceType();
            if (tipo === 'image' || tipo === 'media' || tipo === 'font') return route.abort();
            return route.continue();
        });
    }

    // Reducimos señales automáticas sin alterar funcionalidad de la web.
    await context.addInitScript(() => {
        try {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        } catch (_) {}
    });

    return { browser, context, userDataDir };
}

async function cerrarSesionNavegador(session) {
    if (!session) return;
    try { await session.context?.close(); } catch (_) {}
    try { await session.browser?.close(); } catch (_) {}
    try {
        if (session.userDataDir && fs.existsSync(session.userDataDir)) {
            fs.rmSync(session.userDataDir, { recursive: true, force: true });
        }
    } catch (_) {}
}

async function abrirPaginaVinted(page, urlObjetivo) {
    await page.goto(urlObjetivo, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(randomBetween(700, 1300));
    // Banner de cookies (OneTrust): si tapa la página, el feed no termina de cargar.
    try {
        const aceptar = page.locator('#onetrust-accept-btn-handler');
        if (await aceptar.isVisible({ timeout: 1500 })) await aceptar.click({ timeout: 2000 });
    } catch (_) {}
    await page.mouse.move(randomBetween(80, 420), randomBetween(60, 260), { steps: randomBetween(6, 14) });
}

async function scrollHumano(page, bursts) {
    for (let i = 0; i < bursts; i++) {
        await page.mouse.wheel(0, randomBetween(1400, 3200));
        await page.waitForTimeout(randomBetween(600, 1200));
    }
}

async function navegarComoNavegadorReal(page, urlObjetivo) {
    await abrirPaginaVinted(page, urlObjetivo);
    await scrollHumano(page, parseIntEnv('SCRAPER_SCROLL_BURSTS', 4, 2, 10));
}

// Pagina la API del armario desde dentro de la página: la petición sale del navegador
// real (con sus cookies y cabeceras), así que pasa los controles anti-bot y trae todo
// el armario sin depender del scroll infinito.
async function extraerArmarioDesdeNavegador(page, memberId, maxPages) {
    return page.evaluate(async ({ memberId, maxPages, perPage }) => {
        const rutas = [`/api/v2/wardrobe/${memberId}/items`, `/api/v2/users/${memberId}/items`];
        for (const ruta of rutas) {
            const items = [];
            for (let p = 1; p <= maxPages; p += 1) {
                let data = null;
                try {
                    const r = await fetch(`${ruta}?page=${p}&per_page=${perPage}&order=newest_first`, {
                        credentials: 'include',
                        headers: { accept: 'application/json, text/plain, */*' }
                    });
                    if (!r.ok) break;
                    data = await r.json();
                } catch (_) {
                    break;
                }
                const lote = Array.isArray(data?.items) ? data.items : [];
                if (!lote.length) break;
                items.push(...lote);
                const totalPages = Number(data?.pagination?.total_pages || 0);
                if ((totalPages && p >= totalPages) || lote.length < perPage) break;
                await new Promise((res) => setTimeout(res, 250 + Math.random() * 350));
            }
            if (items.length) return items;
        }
        return [];
    }, { memberId, maxPages, perPage: VINTED_PER_PAGE });
}

function extraerProductosDesdeLdJson($) {
    const productos = [];

    const recolectar = (node) => {
        if (!node || typeof node !== 'object') return;

        const typeValue = String(node['@type'] || '').toLowerCase();
        if (typeValue.includes('product')) {
            const precio = normalizarPrecio(node?.offers?.price ?? node?.price);
            const titulo = String(node?.name || node?.title || '').trim();
            if (titulo && Number.isFinite(precio)) {
                productos.push(limpiarProducto({
                    titulo,
                    precio,
                    imagen: Array.isArray(node.image) ? node.image[0] || '' : node.image || '',
                    descripcion: node.description || '',
                    fuente: 'ldjson'
                }, 'ldjson'));
            }
        }

        for (const value of Object.values(node)) {
            if (Array.isArray(value)) {
                value.forEach(recolectar);
            } else if (value && typeof value === 'object') {
                recolectar(value);
            }
        }
    };

    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).html();
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) parsed.forEach(recolectar);
            else recolectar(parsed);
        } catch (_) {
            // Ignorar bloques no parseables.
        }
    });

    return deduplicarProductos(productos);
}

function recorrerObjetoParaProductos(node, out, fuente) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        node.forEach((it) => recorrerObjetoParaProductos(it, out, fuente));
        return;
    }

    const mapped = mapearProductoVinted(node, fuente);
    if (mapped) out.push(mapped);

    for (const value of Object.values(node)) {
        if (value && typeof value === 'object') {
            recorrerObjetoParaProductos(value, out, fuente);
        }
    }
}

function extraerDesdeScripts($) {
    const out = [];

    $('script').each((_, el) => {
        const type = String($(el).attr('type') || '').toLowerCase();
        const content = $(el).html() || '';
        if (!content || content.length < 20) return;

        const candidates = [];
        if (type.includes('application/json') || type.includes('application/ld+json')) {
            candidates.push(content);
        } else {
            const assignmentPatterns = [
                /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/m,
                /window\.__NUXT__\s*=\s*({[\s\S]*?});/m,
                /window\.__NEXT_DATA__\s*=\s*({[\s\S]*?});/m
            ];
            for (const pattern of assignmentPatterns) {
                const match = content.match(pattern);
                if (match && match[1]) candidates.push(match[1]);
            }
        }

        for (const candidate of candidates) {
            try {
                const parsed = JSON.parse(candidate);
                recorrerObjetoParaProductos(parsed, out, 'script-json');
            } catch (_) {
                // Ignorar fragmentos no JSON puro.
            }
        }
    });

    return deduplicarProductos(out);
}

function extraerDesdeDomCheerio($) {
    const out = [];
    const selectors = [
        'div[data-testid^="grid-item"]',
        '.item-card',
        '[class*="feed-grid"] [class*="item"]',
        '[class*="catalog"] [class*="item"]'
    ];

    for (const selector of selectors) {
        $(selector).each((_, el) => {
            const root = $(el);
            const titulo = (
                root.find('[data-testid$="--title"]').first().text() ||
                root.find('h3').first().text() ||
                root.find('h4').first().text() ||
                root.find('a[title]').first().attr('title') ||
                ''
            ).trim();

            const precio = normalizarPrecio(
                root.find('[data-testid$="--price-text"]').first().text() ||
                root.find('[class*="price"]').first().text() ||
                root.find('h2').first().text() ||
                root.find('h3').first().text() ||
                ''
            );

            const imagen = root.find('img').first().attr('src') || root.find('img').first().attr('data-src') || '';
            const limpio = limpiarProducto({ titulo, precio, imagen, fuente: 'dom' }, 'dom');
            if (limpio) out.push(limpio);
        });
    }

    return deduplicarProductos(out);
}

// respondio = la API contestó con datos válidos (aunque el armario esté vacío):
// sirve para distinguir "perfil sin prendas" de "Vinted nos bloquea".
async function consultarApiVinted(urlObjetivo) {
    const userId = extraerMemberId(urlObjetivo);
    if (!userId) return { productos: [], respondio: false };
    let respondio = false;

    const base = baseVintedDesdeUrl(urlObjetivo);
    const referer = `${base}/member/${userId}`;
    const maxPages = parseIntEnv('SCRAPER_MAX_PAGES', 12, 1, 25);

    // /wardrobe/:id/items es el endpoint vigente (verificado oct-2026; /users/:id/items ya da 404).
    // Filtramos por propietario por si algún endpoint mezcla prendas de otros vendedores.
    const endpoints = [
        { ruta: `/api/v2/wardrobe/${userId}/items`, params: { order: 'newest_first' }, filtrarPropietario: true },
        { ruta: `/api/v2/users/${userId}/items`, params: {}, filtrarPropietario: true }
    ];

    for (const ep of endpoints) {
        const out = [];
        try {
            for (let page = 1; page <= maxPages; page++) {
                const response = await withRetry(
                    () => getApiVinted(base, ep.ruta, { ...ep.params, page, per_page: VINTED_PER_PAGE }, referer),
                    { retries: 2, baseDelay: 700, factor: 2 }
                );

                if (Array.isArray(response.data?.items)) respondio = true;
                const brutos = extraerItemsDePayload(response.data);
                if (!brutos.length) break;
                // Si la API no indica propietario no descartamos nada (el endpoint ya es del usuario).
                const conPropietario = brutos.some((it) => (it?.user?.id ?? it?.user_id) != null);
                const items = ep.filtrarPropietario && conPropietario ? brutos.filter((it) => itemPerteneceAUsuario(it, userId)) : brutos;
                out.push(...items.map((it) => mapearProductoVinted(it, 'api', base)).filter(Boolean));

                const totalPages = Number(response.data?.pagination?.total_pages || 0);
                if ((totalPages && page >= totalPages) || brutos.length < VINTED_PER_PAGE) break;
                await sleep(randomBetween(250, 600));
            }
        } catch (error) {
            const status = error?.response?.status || error.code || 'sin-status';
            console.log(`[SCRAPER] API ${ep.ruta} sin datos (${status}).`);
        }
        if (out.length) return { productos: deduplicarProductos(out), respondio: true };
        if (respondio) break;
    }

    return { productos: [], respondio };
}

async function extraerPorApiVinted(urlObjetivo) {
    return (await consultarApiVinted(urlObjetivo)).productos;
}

async function extraerConPlaywright(urlObjetivo, session = null) {
    const ownSession = !session;
    const internalSession = session || await crearSesionNavegador('vinted');
    if (!internalSession) {
        console.log('[SCRAPER] Playwright no esta disponible.');
        return [];
    }

    const base = baseVintedDesdeUrl(urlObjetivo);
    const memberId = extraerMemberId(urlObjetivo);
    const page = await internalSession.context.newPage();
    const capturedApi = [];

    page.on('response', async (response) => {
        try {
            const rUrl = response.url();
            if (!rUrl.includes('/api/v2/')) return;
            // Solo el armario de este perfil: la página también carga recomendaciones de otros vendedores.
            if (memberId && !rUrl.includes(`/wardrobe/${memberId}/`) && !rUrl.includes(`/users/${memberId}/items`)) return;
            const ctype = String(response.headers()['content-type'] || '').toLowerCase();
            if (!ctype.includes('application/json')) return;

            const body = await response.json();
            const items = extraerItemsDePayload(body);
            if (!items.length) return;
            capturedApi.push(...items.map((it) => mapearProductoVinted(it, 'playwright-api', base)).filter(Boolean));
        } catch (_) {
            // Ignorar respuestas no parseables.
        }
    });

    try {
        await abrirPaginaVinted(page, urlObjetivo);

        if (memberId) {
            const itemsArmario = await extraerArmarioDesdeNavegador(page, memberId, parseIntEnv('SCRAPER_MAX_PAGES', 12, 1, 25)).catch(() => []);
            const desdeArmario = (itemsArmario || []).map((it) => mapearProductoVinted(it, 'playwright-api', base)).filter(Boolean);
            if (desdeArmario.length) {
                return deduplicarProductos([...desdeArmario, ...capturedApi]);
            }
        }

        // Último recurso: scroll y lectura del DOM.
        await scrollHumano(page, parseIntEnv('SCRAPER_SCROLL_BURSTS', 4, 2, 10));

        const domProducts = await page.evaluate(() => {
            const normalizePrice = (value) => {
                if (value == null) return NaN;
                let raw = String(value).trim();
                raw = raw.replace(/\s+/g, '').replace(/€/g, '').replace(/eur/gi, '').replace(/[^\d.,-]/g, '');
                const lastComma = raw.lastIndexOf(',');
                const lastDot = raw.lastIndexOf('.');
                if (lastComma > -1 && lastDot > -1) {
                    if (lastComma > lastDot) raw = raw.replace(/\./g, '').replace(',', '.');
                    else raw = raw.replace(/,/g, '');
                } else if (lastComma > -1) {
                    raw = raw.replace(',', '.');
                }
                const num = Number(raw);
                return Number.isFinite(num) && num > 0 ? Number(num.toFixed(2)) : NaN;
            };

            const cards = Array.from(document.querySelectorAll('div[data-testid^="grid-item"], .item-card, [class*="feed-grid"] [class*="item"], [class*="catalog"] [class*="item"]'));
            const out = [];

            for (const card of cards) {
                const titleEl = card.querySelector('[data-testid$="--title"], h3, h4, a[title]');
                const priceEl = card.querySelector('[data-testid$="--price-text"], [class*="price"], h2, h3');
                const imgEl = card.querySelector('img');
                const linkEl = card.querySelector('a[href*="/items/"]');
                const titulo = (titleEl?.textContent || titleEl?.getAttribute('title') || '').trim();
                const precio = normalizePrice(priceEl?.textContent || '');
                const imagen = (imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || '').trim();
                const url = linkEl ? linkEl.href.split('?')[0] : '';
                if (titulo && Number.isFinite(precio)) {
                    out.push({ titulo, precio, imagen, url, fuente: 'playwright-dom' });
                }
            }
            return out;
        });

        return deduplicarProductos([...(domProducts || []), ...capturedApi]);
    } catch (error) {
        console.error(`[SCRAPER] Playwright fallo: ${error.message}`);
        return deduplicarProductos(capturedApi);
    } finally {
        try { await page.close(); } catch (_) {}
        if (ownSession) {
            await cerrarSesionNavegador(internalSession);
        }
    }
}

function usuarioDesdeObjeto(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const u = obj.user && typeof obj.user === 'object' ? obj.user : obj;
    const id = u.id ?? u.user_id ?? u.member_id;
    const login = u.login ?? u.username ?? u.nick_name ?? u.nickname;
    // Exigimos login o profile_url: así un objeto cualquiera con "id" (foto, marca...) no se toma por perfil.
    if (!login && !u.profile_url) return null;
    const url = normalizarUrlPerfilVinted(u.profile_url || (id ? `https://www.vinted.es/member/${id}` : ''));
    if (!url) return null;
    return { url, alias: sanitizarAlias(login || extraerAliasDesdeUrlPerfil(url), extraerAliasDesdeUrlPerfil(url)) };
}

function extraerUsuariosCandidatosDesdePayload(payload) {
    // Formato habitual de la API: una lista explícita de usuarios.
    const listaDirecta = [payload?.users, payload?.followers, payload?.followings, payload?.following, payload?.items]
        .find((v) => Array.isArray(v) && v.length);
    if (listaDirecta) {
        const dedupeDirecto = new Map();
        listaDirecta.map(usuarioDesdeObjeto).filter(Boolean).forEach((c) => {
            if (!dedupeDirecto.has(c.url)) dedupeDirecto.set(c.url, c);
        });
        if (dedupeDirecto.size) return Array.from(dedupeDirecto.values());
    }

    const out = [];
    const queue = [payload];
    const seen = new Set();
    let guard = 0;

    while (queue.length > 0 && guard < 1200) {
        guard += 1;
        const curr = queue.shift();
        if (!curr) continue;

        if (Array.isArray(curr)) {
            for (const it of curr) queue.push(it);
            continue;
        }

        if (typeof curr !== 'object') continue;
        if (seen.has(curr)) continue;
        seen.add(curr);

        const nestedUser = curr.user && typeof curr.user === 'object' ? curr.user : null;
        const idRaw = curr.id ?? curr.user_id ?? curr.member_id ?? nestedUser?.id ?? nestedUser?.user_id;
        const loginRaw = curr.login ?? curr.username ?? curr.nick_name ?? curr.nickname ?? nestedUser?.login ?? nestedUser?.username ?? nestedUser?.nick_name;
        const urlRaw = curr.profile_url ?? curr.profileUrl ?? curr.url ?? curr.permalink ?? nestedUser?.profile_url ?? nestedUser?.url;

        const urlPerfil = normalizarUrlPerfilVinted(urlRaw || (idRaw ? `https://www.vinted.es/member/${idRaw}` : ''));
        if (urlPerfil) {
            const alias = sanitizarAlias(loginRaw || extraerAliasDesdeUrlPerfil(urlPerfil), extraerAliasDesdeUrlPerfil(urlPerfil));
            out.push({ url: urlPerfil, alias });
        }

        for (const value of Object.values(curr)) {
            if (value && (typeof value === 'object' || Array.isArray(value))) {
                queue.push(value);
            }
        }
    }

    const dedupe = new Map();
    for (const c of out) {
        const url = normalizarUrlPerfilVinted(c.url);
        if (!url) continue;
        if (!dedupe.has(url)) {
            dedupe.set(url, { url, alias: sanitizarAlias(c.alias, extraerAliasDesdeUrlPerfil(url)) });
        }
    }
    return Array.from(dedupe.values());
}

async function extraerCuentasDesdeApiRelaciones(urlObjetivo) {
    const memberId = extraerMemberId(urlObjetivo);
    if (!memberId) return [];

    const perPage = VINTED_PER_PAGE;
    const maxPages = parseIntEnv('MONOPOLIO_API_REL_PAGES', 6, 1, 14);
    const base = baseVintedDesdeUrl(urlObjetivo);
    // Respetamos el tipo de relación pedido: una URL de seguidos no debe traer también los seguidores.
    const tipo = /\/followers\b/i.test(String(urlObjetivo || '')) ? 'followers' : 'following';
    const referer = `${base}/member/${memberId}/${tipo}`;
    // Vigentes (oct-2026): /followed_users (seguidos) y /followers (seguidores).
    const endpoints = tipo === 'followers'
        ? [`/api/v2/users/${memberId}/followers`]
        : [`/api/v2/users/${memberId}/followed_users`, `/api/v2/users/${memberId}/followings`];

    const dedupe = new Map();

    for (const ruta of endpoints) {
        for (let page = 1; page <= maxPages; page += 1) {
            try {
                const response = await withRetry(
                    () => getApiVinted(base, ruta, { page, per_page: perPage }, referer),
                    { retries: 1, baseDelay: 500, factor: 2 }
                );

                const candidatos = extraerUsuariosCandidatosDesdePayload(response.data)
                    .filter((c) => extraerMemberId(c.url) !== String(memberId));
                if (!candidatos.length) break;

                let nuevos = 0;
                for (const c of candidatos) {
                    const url = normalizarUrlPerfilVinted(c.url);
                    if (!url || dedupe.has(url)) continue;
                    dedupe.set(url, { url, alias: sanitizarAlias(c.alias, extraerAliasDesdeUrlPerfil(url)) });
                    nuevos += 1;
                }

                const totalPages = Number(response.data?.pagination?.total_pages || 0);
                if ((totalPages && page >= totalPages) || candidatos.length < perPage || nuevos === 0) break;
            } catch (_) {
                break;
            }
        }
        // El primer endpoint que responde ya es la relación completa.
        if (dedupe.size) break;
    }

    return Array.from(dedupe.values());
}

async function extraerCuentasDesdeSeguidores(urlObjetivo, session = null) {
    const ownSession = !session;
    const internalSession = session || await crearSesionNavegador('following');
    if (!internalSession) {
        console.log('[MONOPOLIO] Playwright no esta disponible para expandir seguidos.');
        return { cuentas: [], relaciones: [] };
    }
    const page = await internalSession.context.newPage();

    try {
        await navegarComoNavegadorReal(page, urlObjetivo);

        const maxScrolls = Math.max(6, Math.min(parseInt(process.env.MONOPOLIO_SCROLL_MAX || '14', 10), 28));
        let estables = 0;
        let lastCount = -1;

        for (let i = 0; i < maxScrolls; i++) {
            const count = await page.evaluate(() => {
                const anchors = Array.from(document.querySelectorAll('a[href*="/member/"], a[href*="/items/"]'));
                return anchors.length;
            });

            if (count === lastCount) estables += 1;
            else estables = 0;
            lastCount = count;

            await page.mouse.wheel(0, randomBetween(2200, 5200));
            await page.waitForTimeout(randomBetween(700, 1400));

            // Si tras varias iteraciones no aparecen más enlaces, cortamos.
            if (estables >= 3) break;
        }

        const perfiles = await page.evaluate(() => {
            const enlaces = [];
            const anchors = Array.from(document.querySelectorAll('a[href]'));
            for (const a of anchors) {
                const href = a.getAttribute('href') || '';
                if (!href) continue;
                const abs = href.startsWith('http') ? href : `https://www.vinted.es${href}`;
                const clean = abs.split('?')[0].replace(/\/+$/, '');
                const txt = (a.textContent || '').trim().replace(/\s+/g, ' ');
                if (!/vinted\./i.test(clean) && !/\/(member|items)\//i.test(clean)) continue;
                enlaces.push({ url: clean, alias: txt || '' });
            }
            return { enlaces };
        });

        const map = new Map();
        const relaciones = [];
        const items = [];
        const seenRel = new Set();
        const seenItems = new Set();
        const resumenClasificacion = { relation: 0, profile: 0, item: 0, other: 0 };

        for (const r of perfiles?.enlaces || []) {
            const clasificada = clasificarUrlVinted(String(r.url || '').trim());
            resumenClasificacion[clasificada.tipo] = Number(resumenClasificacion[clasificada.tipo] || 0) + 1;

            if (clasificada.tipo === 'profile') {
                const alias = sanitizarAlias(r.alias || extraerAliasDesdeUrlPerfil(clasificada.url), extraerAliasDesdeUrlPerfil(clasificada.url));
                if (!map.has(clasificada.url)) map.set(clasificada.url, { url: clasificada.url, alias });
                continue;
            }

            if (clasificada.tipo === 'relation') {
                if (seenRel.has(clasificada.url)) continue;
                seenRel.add(clasificada.url);
                relaciones.push(clasificada.url);

                const perfilDesdeRelacion = normalizarUrlPerfilVinted(clasificada.url);
                if (perfilDesdeRelacion && !map.has(perfilDesdeRelacion)) {
                    const alias = sanitizarAlias(r.alias || extraerAliasDesdeUrlPerfil(perfilDesdeRelacion), extraerAliasDesdeUrlPerfil(perfilDesdeRelacion));
                    map.set(perfilDesdeRelacion, { url: perfilDesdeRelacion, alias });
                }
                continue;
            }

            if (clasificada.tipo === 'item') {
                if (seenItems.has(clasificada.url)) continue;
                seenItems.add(clasificada.url);
                items.push(clasificada.url);
            }
        }

        for (const rel of relaciones) {
            const perfilRel = normalizarUrlPerfilVinted(rel);
            if (!perfilRel || map.has(perfilRel)) continue;
            const alias = sanitizarAlias(extraerAliasDesdeUrlPerfil(perfilRel), extraerAliasDesdeUrlPerfil(perfilRel));
            map.set(perfilRel, { url: perfilRel, alias });
        }

        return {
            cuentas: Array.from(map.values()),
            relaciones,
            items,
            resumenClasificacion
        };
    } catch (error) {
        console.error(`[MONOPOLIO] Fallo al extraer cuentas seguidas: ${error.message}`);
        return { cuentas: [], relaciones: [], items: [], resumenClasificacion: { relation: 0, profile: 0, item: 0, other: 0 } };
    } finally {
        try { await page.close(); } catch (_) {}
        if (ownSession) {
            await cerrarSesionNavegador(internalSession);
        }
    }
}

async function extraerPerfilesDesdeItemsVinted(itemUrls, session = null) {
    const ownSession = !session;
    const internalSession = session || await crearSesionNavegador('item-profile');
    if (!internalSession) return [];

    const page = await internalSession.context.newPage();
    const map = new Map();

    try {
        const limit = Math.max(1, Math.min(parseInt(process.env.MONOPOLIO_ITEM_PROBE_MAX || '4', 10), 10));
        const objetivos = (Array.isArray(itemUrls) ? itemUrls : []).slice(0, limit);

        for (const itemUrl of objetivos) {
            try {
                await navegarComoNavegadorReal(page, itemUrl);
                const perfiles = await page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a[href*="/member/"]'));
                    return links.map((a) => {
                        const href = a.getAttribute('href') || '';
                        const abs = href.startsWith('http') ? href : `https://www.vinted.es${href}`;
                        return {
                            url: abs.split('?')[0].replace(/\/+$/, ''),
                            alias: String(a.textContent || '').trim().replace(/\s+/g, ' ')
                        };
                    });
                });

                for (const p of perfiles || []) {
                    const urlPerfil = normalizarUrlPerfilVinted(p.url);
                    if (!urlPerfil || map.has(urlPerfil)) continue;
                    const alias = sanitizarAlias(p.alias || extraerAliasDesdeUrlPerfil(urlPerfil), extraerAliasDesdeUrlPerfil(urlPerfil));
                    map.set(urlPerfil, { url: urlPerfil, alias });
                }
            } catch (_) {
                // Seguimos con el siguiente item.
            }
        }

        return Array.from(map.values());
    } finally {
        try { await page.close(); } catch (_) {}
        if (ownSession) {
            await cerrarSesionNavegador(internalSession);
        }
    }
}

async function scrapeMonopolio(url, aliasBase = '', options = {}) {
    const urlNormalizada = normalizarUrlVinted(url);
    const aliasPrincipal = sanitizarAlias(aliasBase || extraerAliasDesdeUrlPerfil(urlNormalizada), 'Competidor');
    const discoverOnly = Boolean(options?.discoverOnly);
    const maxProfilesOverride = Number.parseInt(options?.maxProfiles, 10);
    const timeBudgetMs = Number(options?.timeBudgetMs);
    const fechaLimite = Number.isFinite(timeBudgetMs) && timeBudgetMs > 0 ? Date.now() + timeBudgetMs : Infinity;
    const grupos = [];
    const session = await crearSesionNavegador('monopolio');
    const semillaRelacion = obtenerSemillaRelacionMonopolio(urlNormalizada);
    let totalRelacionesCapturadas = 0;
    let totalPerfilesDetectados = 0;
    let perfilesDescubiertos = [];

    try {
        if (semillaRelacion) {
            const maxDepth = Math.max(1, Math.min(parseInt(process.env.MONOPOLIO_MAX_CHAIN_DEPTH || '5', 10), 8));
            const maxChainUrls = Math.max(8, Math.min(parseInt(process.env.MONOPOLIO_MAX_CHAIN_URLS || '220', 10), 1200));
            const maxCuentasBase = Math.max(1, Math.min(parseInt(process.env.MONOPOLIO_MAX_ACCOUNTS || '260', 10), 1800));
            const maxCuentas = Number.isFinite(maxProfilesOverride) && maxProfilesOverride > 0
                ? Math.max(1, Math.min(maxProfilesOverride, maxCuentasBase))
                : maxCuentasBase;
            const maxBranch = Math.max(4, Math.min(parseInt(process.env.MONOPOLIO_CHAIN_BRANCH || '120', 10), 600));

            const cola = [{ url: semillaRelacion, depth: 0, parentProfileUrl: '', parentAlias: '' }];
            const visitadas = new Set();
            const relacionesDescubiertas = new Set([semillaRelacion]);
            const perfilesMap = new Map();

            const registrarPerfil = (urlPerfil, meta = {}) => {
                const cleanUrl = normalizarUrlPerfilVinted(urlPerfil);
                if (!cleanUrl) return;

                const existing = perfilesMap.get(cleanUrl);
                const nextDepth = Number.isFinite(Number(meta.depth)) ? Number(meta.depth) : 0;
                const alias = sanitizarAlias(meta.alias || extraerAliasDesdeUrlPerfil(cleanUrl), extraerAliasDesdeUrlPerfil(cleanUrl));
                const parentUrl = normalizarUrlPerfilVinted(meta.parentProfileUrl || '');
                const parentAlias = sanitizarAlias(meta.parentAlias || extraerAliasDesdeUrlPerfil(parentUrl), '');

                if (!existing || nextDepth < Number(existing.depth || 99)) {
                    perfilesMap.set(cleanUrl, {
                        url: cleanUrl,
                        alias,
                        depth: nextDepth,
                        parentProfileUrl: parentUrl,
                        parentAlias,
                        sourceRelationUrl: String(meta.sourceRelationUrl || '').trim()
                    });
                    return;
                }

                if (!existing.alias && alias) existing.alias = alias;
                if (!existing.parentProfileUrl && parentUrl) {
                    existing.parentProfileUrl = parentUrl;
                    existing.parentAlias = parentAlias;
                }
            };

            while (cola.length > 0 && visitadas.size < maxChainUrls) {
                if (Date.now() > fechaLimite) {
                    console.warn(`[MONOPOLIO] Presupuesto de tiempo agotado tras ${visitadas.size} relaciones.`);
                    break;
                }
                const actual = cola.shift();
                const relUrl = normalizarUrlRelacionVinted(actual?.url || '');
                if (!relUrl || visitadas.has(relUrl)) continue;
                visitadas.add(relUrl);

                const perfilOrigen = normalizarUrlPerfilVinted(relUrl);
                if (perfilOrigen) {
                    const esSemilla = Number(actual?.depth || 0) === 0;
                    registrarPerfil(perfilOrigen, {
                        alias: esSemilla ? aliasPrincipal : (actual?.parentAlias || extraerAliasDesdeUrlPerfil(perfilOrigen)),
                        depth: Number.isFinite(Number(actual?.depth)) ? Number(actual.depth) : 0,
                        parentProfileUrl: actual?.parentProfileUrl || '',
                        parentAlias: actual?.parentAlias || '',
                        sourceRelationUrl: relUrl
                    });
                }

                // Primero la API (segundos y con paginación completa); el navegador solo si no basta.
                let cuentasExpandidas = await extraerCuentasDesdeApiRelaciones(relUrl).catch(() => []);
                let relaciones = [];
                let items = [];
                if (cuentasExpandidas.length < 4) {
                    const resultado = await extraerCuentasDesdeSeguidores(relUrl, session);
                    const cuentas = Array.isArray(resultado?.cuentas) ? resultado.cuentas : [];
                    relaciones = Array.isArray(resultado?.relaciones) ? resultado.relaciones : [];
                    items = Array.isArray(resultado?.items) ? resultado.items : [];
                    cuentasExpandidas = [...cuentasExpandidas, ...cuentas];
                }
                if (cuentasExpandidas.length < 2 && items.length > 0) {
                    const desdeItems = await extraerPerfilesDesdeItemsVinted(items, session);
                    cuentasExpandidas = [...cuentasExpandidas, ...desdeItems];
                }

                const dedupeCuentas = new Map();
                for (const c of cuentasExpandidas) {
                    const urlCuenta = normalizarUrlPerfilVinted(c.url);
                    if (!urlCuenta || dedupeCuentas.has(urlCuenta)) continue;
                    dedupeCuentas.set(urlCuenta, {
                        url: urlCuenta,
                        alias: sanitizarAlias(c.alias, extraerAliasDesdeUrlPerfil(urlCuenta))
                    });
                }

                for (const cuenta of dedupeCuentas.values()) {
                    const urlCuenta = normalizarUrlPerfilVinted(cuenta.url);
                    if (!urlCuenta) continue;
                    registrarPerfil(urlCuenta, {
                        alias: sanitizarAlias(cuenta.alias, extraerAliasDesdeUrlPerfil(urlCuenta)),
                        depth: Number.isFinite(Number(actual?.depth)) ? Number(actual.depth) + 1 : 1,
                        parentProfileUrl: perfilOrigen,
                        parentAlias: perfilesMap.get(perfilOrigen)?.alias || extraerAliasDesdeUrlPerfil(perfilOrigen),
                        sourceRelationUrl: relUrl
                    });
                }

                if (actual.depth < maxDepth - 1) {
                    for (const rel of relaciones) {
                        const relNorm = normalizarUrlRelacionVinted(rel);
                        if (!relNorm || visitadas.has(relNorm)) continue;
                        relacionesDescubiertas.add(relNorm);
                        cola.push({
                            url: relNorm,
                            depth: Number(actual.depth) + 1,
                            parentProfileUrl: perfilOrigen,
                            parentAlias: perfilesMap.get(perfilOrigen)?.alias || extraerAliasDesdeUrlPerfil(perfilOrigen)
                        });
                    }

                    const capacidadRestante = Math.max(0, maxChainUrls - (visitadas.size + cola.length));
                    const branchLimit = Math.min(maxBranch, capacidadRestante > 0 ? capacidadRestante : maxBranch);
                    for (const cuenta of Array.from(dedupeCuentas.values()).slice(0, branchLimit)) {
                        const nextRel = construirUrlFollowingDesdePerfil(cuenta.url);
                        const relNorm = normalizarUrlRelacionVinted(nextRel);
                        if (!relNorm || visitadas.has(relNorm)) continue;
                        relacionesDescubiertas.add(relNorm);
                        cola.push({
                            url: relNorm,
                            depth: Number(actual.depth) + 1,
                            parentProfileUrl: perfilOrigen,
                            parentAlias: perfilesMap.get(perfilOrigen)?.alias || extraerAliasDesdeUrlPerfil(perfilOrigen)
                        });
                    }
                }
            }

            totalRelacionesCapturadas = relacionesDescubiertas.size;
            totalPerfilesDetectados = perfilesMap.size;

            const objetivos = Array.from(perfilesMap.values())
                .sort((a, b) => Number(a.depth || 0) - Number(b.depth || 0))
                .slice(0, maxCuentas);

            console.log(`[MONOPOLIO] Cadena de seguidos: visitadas=${visitadas.size}, perfiles=${perfilesMap.size}, procesando=${objetivos.length}`);

            if (objetivos.length === 0) {
                console.warn('[MONOPOLIO] No se detectaron perfiles desde la URL de seguidos.');
                const perfilFallback = normalizarUrlPerfilVinted(urlNormalizada);
                if (perfilFallback) {
                    registrarPerfil(perfilFallback, {
                        alias: sanitizarAlias(aliasPrincipal, extraerAliasDesdeUrlPerfil(perfilFallback)),
                        depth: 0,
                        parentProfileUrl: '',
                        parentAlias: ''
                    });
                }
            }

            const objetivosFinales = Array.from(perfilesMap.values())
                .sort((a, b) => Number(a.depth || 0) - Number(b.depth || 0))
                .slice(0, maxCuentas);

            totalPerfilesDetectados = objetivosFinales.length;

            perfilesDescubiertos = objetivosFinales.map((cuenta) => ({
                alias: sanitizarAlias(cuenta.alias, extraerAliasDesdeUrlPerfil(cuenta.url)),
                url: cuenta.url,
                nivelCadena: Number(cuenta.depth || 0),
                parentUrl: cuenta.parentProfileUrl || '',
                parentAlias: cuenta.parentAlias || ''
            }));

            if (discoverOnly) {
                return {
                    productos: [],
                    grupos: [],
                    perfiles: perfilesDescubiertos,
                    esModoSeguidos: true,
                    aliasPrincipal,
                    urlNormalizada,
                    exploracion: {
                        semillaRelacion,
                        maxDepth: Math.max(1, Math.min(parseInt(process.env.MONOPOLIO_MAX_CHAIN_DEPTH || '5', 10), 8)),
                        urlsCapturadas: Number(totalRelacionesCapturadas || 0),
                        usuariosDetectados: Number(totalPerfilesDetectados || perfilesDescubiertos.length)
                    }
                };
            }

            // Varias cuentas en paralelo (pestañas del mismo navegador); el orden se conserva.
            const concurrencia = parseIntEnv('MONOPOLIO_CONCURRENCY', 3, 1, 8);
            const resultadosCuentas = await ejecutarConConcurrencia(objetivosFinales, concurrencia, async (cuenta, indice) => {
                const { productos } = await scrapeVinted(cuenta.url, { session, deepMode: true });
                console.log(`[MONOPOLIO] ${indice + 1}/${objetivosFinales.length} ${cuenta.url} -> ${(productos || []).length} productos`);
                return { cuenta, productos };
            });

            for (const resultadoCuenta of resultadosCuentas) {
                if (!resultadoCuenta) continue;
                const { cuenta, productos } = resultadoCuenta;
                const aliasCuenta = sanitizarAlias(cuenta.alias, extraerAliasDesdeUrlPerfil(cuenta.url));
                const enriquecidos = (productos || []).map((p) => enriquecerProductoMonopolio(p, {
                    cuenta: aliasCuenta,
                    urlCuenta: cuenta.url,
                    origenGrupo: aliasPrincipal,
                    nivelCadena: Number(cuenta.depth || 0),
                    parentUrl: cuenta.parentProfileUrl || '',
                    parentCuenta: cuenta.parentAlias || ''
                }));

                grupos.push({
                    cuenta: aliasCuenta,
                    urlCuenta: cuenta.url,
                    nivelCadena: Number(cuenta.depth || 0),
                    parentUrl: cuenta.parentProfileUrl || '',
                    parentCuenta: cuenta.parentAlias || '',
                    total: enriquecidos.length,
                    productos: enriquecidos
                });
            }

            // Fallback final: si venimos de seguidos y no hubo productos, intentar la cuenta origen.
            const totalProductos = grupos.reduce((acc, g) => acc + Number(g?.total || 0), 0);
            if (totalProductos === 0) {
                const perfilOrigen = normalizarUrlPerfilVinted(urlNormalizada);
                if (perfilOrigen) {
                    const { productos } = await scrapeVinted(perfilOrigen, { session, deepMode: true });
                    const aliasCuenta = sanitizarAlias(aliasPrincipal, extraerAliasDesdeUrlPerfil(perfilOrigen));
                    grupos.push({
                        cuenta: aliasCuenta,
                        urlCuenta: perfilOrigen,
                        nivelCadena: 0,
                        parentUrl: '',
                        parentCuenta: '',
                        total: (productos || []).length,
                        productos: (productos || []).map((p) => enriquecerProductoMonopolio(p, {
                            cuenta: aliasCuenta,
                            urlCuenta: perfilOrigen,
                            origenGrupo: aliasPrincipal,
                            nivelCadena: 0,
                            parentUrl: '',
                            parentCuenta: ''
                        }))
                    });
                }
            }
        } else {
            const perfilBase = normalizarUrlPerfilVinted(urlNormalizada) || urlNormalizada;
            perfilesDescubiertos = [{
                alias: sanitizarAlias(aliasPrincipal, extraerAliasDesdeUrlPerfil(perfilBase)),
                url: perfilBase,
                nivelCadena: 0,
                parentUrl: '',
                parentAlias: ''
            }];

            if (discoverOnly) {
                return {
                    productos: [],
                    grupos: [],
                    perfiles: perfilesDescubiertos,
                    esModoSeguidos: false,
                    aliasPrincipal,
                    urlNormalizada,
                    exploracion: {
                        semillaRelacion,
                        maxDepth: 1,
                        urlsCapturadas: 1,
                        usuariosDetectados: 1
                    }
                };
            }

            const { productos } = await scrapeVinted(urlNormalizada, { session, deepMode: true });
            const aliasCuenta = sanitizarAlias(aliasPrincipal, extraerAliasDesdeUrlPerfil(urlNormalizada));
            const enriquecidos = (productos || []).map((p) => enriquecerProductoMonopolio(p, {
                cuenta: aliasCuenta,
                urlCuenta: urlNormalizada,
                origenGrupo: aliasPrincipal,
                nivelCadena: 0,
                parentUrl: '',
                parentCuenta: ''
            }));

            grupos.push({
                cuenta: aliasCuenta,
                urlCuenta: urlNormalizada,
                nivelCadena: 0,
                parentUrl: '',
                parentCuenta: '',
                total: enriquecidos.length,
                productos: enriquecidos
            });

            totalRelacionesCapturadas = 1;
            totalPerfilesDetectados = 1;
        }

        const productosCrudos = grupos.flatMap((g) => g.productos || []);
        let productos = deduplicarProductosMonopolio(productosCrudos);
        if (productos.length === 0 && productosCrudos.length > 0) {
            productos = productosCrudos;
        }

        if ((!Array.isArray(perfilesDescubiertos) || perfilesDescubiertos.length === 0) && grupos.length > 0) {
            perfilesDescubiertos = grupos.map((g) => ({
                alias: sanitizarAlias(g?.cuenta || extraerAliasDesdeUrlPerfil(g?.urlCuenta), 'Perfil'),
                url: normalizarUrlPerfilVinted(g?.urlCuenta || ''),
                nivelCadena: Number(g?.nivelCadena || 0),
                parentUrl: String(g?.parentUrl || ''),
                parentAlias: String(g?.parentCuenta || '')
            })).filter((p) => Boolean(p.url));
        }

        return {
            productos,
            grupos,
            perfiles: perfilesDescubiertos,
            esModoSeguidos: Boolean(semillaRelacion),
            aliasPrincipal,
            urlNormalizada,
            exploracion: {
                semillaRelacion,
                maxDepth: Math.max(1, Math.min(parseInt(process.env.MONOPOLIO_MAX_CHAIN_DEPTH || '5', 10), 8)),
                urlsCapturadas: Number(totalRelacionesCapturadas || 0),
                usuariosDetectados: Number(totalPerfilesDetectados || [...new Set(grupos.map((g) => String(g?.cuenta || '').trim()).filter(Boolean))].length)
            }
        };
    } finally {
        await cerrarSesionNavegador(session);
    }
}

function construirWebhookTargets(webUrl, webhookPath) {
    if (!webUrl || typeof webUrl !== 'string') return [];
    const raw = webUrl.trim().replace(/\/+$/, '');
    if (!raw) return [];

    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const normalizedPath = `/${String(webhookPath || '').replace(/^\/+/, '')}`.replace(/\/+$/, '');
    const targets = [];

    try {
        const parsed = new URL(withProtocol);
        const origin = parsed.origin.replace(/\/+$/, '');
        const path = parsed.pathname.replace(/\/+$/, '');

        if (path.endsWith(normalizedPath)) {
            targets.push(withProtocol);
        } else if (path === '/api') {
            targets.push(`${origin}${normalizedPath}`);
        } else {
            targets.push(`${withProtocol}${normalizedPath}`);
            targets.push(`${origin}${normalizedPath}`);
        }
    } catch (_) {
        targets.push(`${withProtocol}${normalizedPath}`);
    }

    return [...new Set(targets)];
}

async function enviarWebhook(payload, options) {
    const webUrl = options.webUrl;
    const secretToken = options.secretToken;
    const webhookPath = options.webhookPath;

    if (!webUrl || !secretToken) {
        console.warn('[WEBHOOK] Saltado: faltan MY_WEB_URL o SCRAPER_TOKEN.');
        return { sent: false, skipped: true };
    }

    const webhookTargets = construirWebhookTargets(webUrl, webhookPath);
    if (!webhookTargets.length) {
        throw new Error('MY_WEB_URL no genero endpoints de webhook validos.');
    }

    let lastError = null;

    for (const target of webhookTargets) {
        try {
            await withRetry(
                () => axios.post(target, payload, {
                    headers: { 'x-github-token': secretToken },
                    timeout: 20000
                }),
                { retries: 2, baseDelay: 700, factor: 2 }
            );
            console.log(`[WEBHOOK] Enviado correctamente a ${target}`);
            return { sent: true, target };
        } catch (error) {
            lastError = error;
            const status = error?.response?.status || 'sin-status';
            console.error(`[WEBHOOK] Fallo en ${target} -> status: ${status}`);
        }
    }

    const detalle = lastError?.response?.data?.error || lastError?.message || 'error desconocido';
    throw new Error(`No se pudo entregar el webhook (${webhookPath}). Detalle: ${detalle}`);
}

async function scrapeVinted(url, options = {}) {
    const sharedSession = options.session || null;
    const deepMode = Boolean(options.deepMode || parseBoolEnv('SCRAPER_DEEP_MODE', false));
    const resumen = { scripts: 0, ldjson: 0, dom: 0, api: 0, playwright: 0, apiRespondio: false };

    // 1) API con sesión anónima: segundos por perfil y el armario completo paginado.
    const consulta = await consultarApiVinted(url).catch(() => ({ productos: [], respondio: false }));
    resumen.api = consulta.productos.length;
    resumen.apiRespondio = consulta.respondio;
    // Armario leído (con o sin prendas): no hace falta nada más.
    if (consulta.productos.length > 0 || consulta.respondio) return { productos: consulta.productos, resumen };

    // 2) HTML estático (JSON incrustado, ld+json o DOM). Si Vinted lo bloquea, seguimos.
    let productos = [];
    try {
        const htmlResponse = await withRetry(
            () => axios.get(url, {
                timeout: 20000,
                headers: {
                    'User-Agent': DEFAULT_UA,
                    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Cache-Control': 'no-cache'
                }
            }),
            { retries: 1, baseDelay: 700, factor: 2 }
        );

        const $ = cheerio.load(htmlResponse.data || '');
        const desdeScripts = extraerDesdeScripts($);
        const desdeLdJson = extraerProductosDesdeLdJson($);
        const desdeDom = extraerDesdeDomCheerio($);
        resumen.scripts = desdeScripts.length;
        resumen.ldjson = desdeLdJson.length;
        resumen.dom = desdeDom.length;
        productos = deduplicarProductos([...desdeScripts, ...desdeLdJson, ...desdeDom]);
    } catch (error) {
        console.log(`[SCRAPER] HTML no disponible para ${url} (${error?.response?.status || error.code || error.message}).`);
    }

    // 3) Navegador real: el HTML solo trae la primera tanda, así que en modo profundo
    //    también se usa aunque haya encontrado algo. (sinNavegador: escaneo rápido en el servidor web)
    if (!options.sinNavegador && (deepMode || productos.length < 3)) {
        const porPlaywright = await extraerConPlaywright(url, sharedSession);
        resumen.playwright = porPlaywright.length;
        productos = deduplicarProductos([...productos, ...porPlaywright]);
    }

    return { productos, resumen };
}

async function ejecutarScraper(params) {
    const mode = String(params.mode || 'manual').trim();
    const url = String(params.url || '').trim();
    const empresa = normalizarEmpresa(params.empresa);
    const alias = String(params.alias || url).trim();
    const webhookPath = String(params.webhookPath || '/api/scraper/webhook-github').trim();

    if (!url) {
        throw new Error('Debes proporcionar una URL valida.');
    }

    console.log(`[SCRAPER:${mode}] Iniciando URL=${url} empresa=${empresa}`);

    let productos = [];
    let grupos = null;
    let esModoSeguidos = false;
    let resumen = null;

    if (mode === 'monopolio') {
        const resultadoMonopolio = await scrapeMonopolio(url, alias);
        productos = resultadoMonopolio.productos;
        grupos = resultadoMonopolio.grupos;
        esModoSeguidos = resultadoMonopolio.esModoSeguidos;
        resumen = {
            modo: esModoSeguidos ? 'seguidos' : 'perfil',
            grupos: Array.isArray(grupos) ? grupos.length : 0,
            exploracion: resultadoMonopolio.exploracion || null
        };
        console.log(`[SCRAPER:${mode}] Modo ${esModoSeguidos ? 'seguidos' : 'perfil'} | grupos=${grupos.length} | productos=${productos.length}`);
    } else {
        const resultado = await scrapeVinted(url);
        productos = resultado.productos;
        resumen = resultado.resumen;
        console.log(`[SCRAPER:${mode}] Productos unicos: ${productos.length}`);
        console.log(`[SCRAPER:${mode}] Cobertura fuentes -> scripts:${resumen.scripts} ldjson:${resumen.ldjson} dom:${resumen.dom} api:${resumen.api} pw:${resumen.playwright}`);

        if (alias) {
            const aliasProveedor = sanitizarAlias(alias, 'Vinted');
            productos = productos.map((p) => ({
                ...p,
                proveedor: aliasProveedor,
                cuenta: aliasProveedor,
                origenGrupo: aliasProveedor
            }));
        }
    }

    const payload = {
        productos,
        urlOrigen: url,
        empresa
    };

    if (mode === 'monopolio') {
        payload.alias = alias;
        payload.grupos = grupos || [];
        payload.esModoSeguidos = esModoSeguidos;
        payload.exploracion = resumen?.exploracion || null;
        // Los grupos ya llevan todos los productos: no enviamos la lista plana duplicada
        // (el panel la reconstruye desde los grupos) y el webhook pesa la mitad.
        if (payload.grupos.some((g) => Array.isArray(g?.productos) && g.productos.length)) {
            payload.productos = [];
        }
    }

    await enviarWebhook(payload, {
        webUrl: process.env.MY_WEB_URL,
        secretToken: process.env.SCRAPER_TOKEN,
        webhookPath
    });

    return { productosCount: productos.length, resumen, esModoSeguidos, gruposCount: Array.isArray(grupos) ? grupos.length : 0 };
}

// Si el scraper revienta, avisamos al panel para que no se quede esperando para siempre.
async function notificarErrorScraper(params, error) {
    const url = String(params?.url || '').trim();
    const payload = {
        error: String(error?.message || error || 'Fallo desconocido en el scraper.').slice(0, 500),
        urlOrigen: url,
        empresa: normalizarEmpresa(params?.empresa),
        alias: String(params?.alias || url).trim()
    };
    try {
        await enviarWebhook(payload, {
            webUrl: process.env.MY_WEB_URL,
            secretToken: process.env.SCRAPER_TOKEN,
            webhookPath: String(params?.webhookPath || '/api/scraper/webhook-github').trim()
        });
    } catch (errWebhook) {
        console.error(`[WEBHOOK] No se pudo notificar el error: ${errWebhook.message}`);
    }
}

module.exports = {
    ejecutarScraper,
    notificarErrorScraper,
    scrapeMonopolio,
    scrapeVinted,
    normalizarPrecio,
    deduplicarProductos,
    mapearProductoVinted,
    extraerUsuariosCandidatosDesdePayload,
    extraerFichaDesdeHtml,
    obtenerFichaItemVinted,
    ejecutarConConcurrencia
};
