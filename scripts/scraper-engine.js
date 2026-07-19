const axios = require('axios');
const cheerio = require('cheerio');
const os = require('os');
const path = require('path');
const fs = require('fs');

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
    const a = Number(min) || 0;
    const b = Number(max) || 0;
    return Math.floor(a + Math.random() * Math.max(1, b - a + 1));
}

async function withRetry(task, options = {}) {
    const retries = Number.isFinite(options.retries) ? options.retries : 2;
    const baseDelay = Number.isFinite(options.baseDelay) ? options.baseDelay : 600;
    const factor = Number.isFinite(options.factor) ? options.factor : 2;
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await task(attempt);
        } catch (error) {
            lastError = error;
            if (attempt >= retries) break;
            const delay = Math.round(baseDelay * Math.pow(factor, attempt));
            await sleep(delay);
        }
    }
    throw lastError;
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

function limpiarProducto(input, fuente = '') {
    if (!input || typeof input !== 'object') return null;

    const titulo = String(input.titulo || input.title || input.name || '').trim();
    const precio = normalizarPrecio(input.precio ?? input.price ?? input.amount);
    if (!titulo || !Number.isFinite(precio)) return null;

    return {
        titulo,
        precio,
        imagen: String(input.imagen || input.image || '').trim(),
        descripcion: String(input.descripcion || input.description || '').trim(),
        marca: String(input.marca || input.brand || '').trim(),
        talla: String(input.talla || input.size || '').trim(),
        condicion: String(input.condicion || input.status || '').trim(),
        favoritos: Number.isFinite(Number(input.favoritos)) ? Number(input.favoritos) : 0,
        fuente
    };
}

function deduplicarProductos(list) {
    const map = new Map();
    for (const raw of list || []) {
        const p = limpiarProducto(raw, raw?.fuente || 'unknown');
        if (!p) continue;
        const key = firmaProducto(p);
        const prev = map.get(key);
        if (!prev || scoreProducto(p) > scoreProducto(prev)) {
            map.set(key, p);
        }
    }
    return Array.from(map.values());
}

function deduplicarProductosMonopolio(list) {
    const map = new Map();
    for (const raw of list || []) {
        const p = limpiarProducto(raw, raw?.fuente || 'monopolio');
        if (!p) continue;

        const cuentaKey = normalizarTexto(raw?.cuenta || raw?.proveedor || raw?.urlCuenta || 'sin-cuenta') || 'sin-cuenta';
        const key = `${cuentaKey}__${firmaProducto(p)}`;
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

function mapearProductoVinted(item, fuente = 'api') {
    if (!item) return null;
    const precio = normalizarPrecio(
        item?.price?.amount ??
        item?.price_numeric ??
        item?.total_item_price?.amount ??
        item?.total_item_price ??
        item?.price
    );
    const titulo = String(item.title || item.name || item.item_title || '').trim();
    if (!titulo || !Number.isFinite(precio)) return null;

    const producto = {
        titulo,
        precio,
        imagen: item?.photo?.url || item?.photo?.full_size_url || item?.photos?.[0]?.url || item?.image_url || '',
        descripcion: item.description || '',
        marca: item.brand_title || '',
        talla: item.size_title || '',
        condicion: item.status || '',
        favoritos: Number(item.favourite_count || 0),
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

    const browser = await chromium.launch({
        headless,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const context = await browser.newContext({
        locale,
        timezoneId,
        userAgent: DEFAULT_UA,
        viewport: { width: 1366, height: 900 },
        storageState: storageState || undefined
    });

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

async function navegarComoNavegadorReal(page, urlObjetivo) {
    await page.goto(urlObjetivo, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(randomBetween(900, 1700));
    await page.mouse.move(randomBetween(80, 420), randomBetween(60, 260), { steps: randomBetween(6, 14) });

    const scrollBursts = Math.max(2, Math.min(parseInt(process.env.SCRAPER_SCROLL_BURSTS || '4', 10), 10));
    for (let i = 0; i < scrollBursts; i++) {
        await page.mouse.wheel(0, randomBetween(1400, 3200));
        await page.waitForTimeout(randomBetween(700, 1400));
    }
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

async function extraerPorApiVinted(urlObjetivo) {
    const userId = extraerMemberId(urlObjetivo);
    if (!userId) return [];

    const headers = {
        'User-Agent': DEFAULT_UA,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Referer': `https://www.vinted.es/member/${userId}`
    };

    const maxPages = Math.max(2, Math.min(parseInt(process.env.SCRAPER_MAX_PAGES || '12', 10), 20));
    const out = [];

    const extractItems = (data) => {
        if (!data || typeof data !== 'object') return [];
        if (Array.isArray(data.items)) return data.items;
        if (Array.isArray(data.catalog_items)) return data.catalog_items;
        if (Array.isArray(data?.data?.items)) return data.data.items;
        if (Array.isArray(data?.data?.catalog_items)) return data.data.catalog_items;
        return [];
    };

    const callEndpoint = async (requestConfig) => {
        for (let page = 1; page <= maxPages; page++) {
            const response = await withRetry(
                () => axios.request({
                    ...requestConfig,
                    params: { ...(requestConfig.params || {}), page, per_page: 96 },
                    timeout: 18000,
                    headers
                }),
                { retries: 2, baseDelay: 500, factor: 2 }
            );

            const items = extractItems(response.data);
            if (!items.length) break;
            out.push(...items.map((it) => mapearProductoVinted(it, 'api')).filter(Boolean));

            if (items.length < 96) break;
        }
    };

    try {
        await callEndpoint({
            method: 'GET',
            url: `https://www.vinted.es/api/v2/users/${userId}/items`
        });
    } catch (_) {
        // Seguimos a fallback.
    }

    if (out.length === 0) {
        try {
            await callEndpoint({
                method: 'GET',
                url: 'https://www.vinted.es/api/v2/catalog/items',
                params: { user_id: userId, order: 'newest_first' }
            });
        } catch (_) {
            // Sin resultados por API.
        }
    }

    return deduplicarProductos(out);
}

async function extraerConPlaywright(urlObjetivo, session = null) {
    const ownSession = !session;
    const internalSession = session || await crearSesionNavegador('vinted');
    if (!internalSession) {
        console.log('[SCRAPER] Playwright no esta disponible.');
        return [];
    }

    const page = await internalSession.context.newPage();
    const capturedApi = [];

    page.on('response', async (response) => {
        try {
            const rUrl = response.url();
            if (!rUrl.includes('/api/v2/')) return;
            const ctype = String(response.headers()['content-type'] || '').toLowerCase();
            if (!ctype.includes('application/json')) return;

            const body = await response.json();
            const items = body?.items || body?.catalog_items || body?.data?.items || body?.data?.catalog_items || [];
            if (!Array.isArray(items) || items.length === 0) return;
            capturedApi.push(...items.map((it) => mapearProductoVinted(it, 'playwright-api')).filter(Boolean));
        } catch (_) {
            // Ignorar respuestas no parseables.
        }
    });

    try {
        await navegarComoNavegadorReal(page, urlObjetivo);

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
                const titulo = (titleEl?.textContent || titleEl?.getAttribute('title') || '').trim();
                const precio = normalizePrice(priceEl?.textContent || '');
                const imagen = (imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || '').trim();
                if (titulo && Number.isFinite(precio)) {
                    out.push({ titulo, precio, imagen, fuente: 'playwright-dom' });
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

function extraerUsuariosCandidatosDesdePayload(payload) {
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

    const perPage = 96;
    const maxPages = Math.max(1, Math.min(parseInt(process.env.MONOPOLIO_API_REL_PAGES || '6', 10), 14));
    const headers = {
        'User-Agent': DEFAULT_UA,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Referer': `https://www.vinted.es/member/${memberId}/following`
    };

    const endpoints = [
        `https://www.vinted.es/api/v2/users/${memberId}/followings`,
        `https://www.vinted.es/api/v2/users/${memberId}/followers`,
        `https://www.vinted.es/api/v2/users/${memberId}/relations/following`
    ];

    const dedupe = new Map();

    for (const endpoint of endpoints) {
        for (let page = 1; page <= maxPages; page += 1) {
            try {
                const response = await withRetry(
                    () => axios.get(endpoint, {
                        timeout: 17000,
                        headers,
                        params: { page, per_page: perPage }
                    }),
                    { retries: 1, baseDelay: 420, factor: 2 }
                );

                const candidatos = extraerUsuariosCandidatosDesdePayload(response.data);
                if (!candidatos.length) break;

                let nuevos = 0;
                for (const c of candidatos) {
                    const url = normalizarUrlPerfilVinted(c.url);
                    if (!url || dedupe.has(url)) continue;
                    dedupe.set(url, { url, alias: sanitizarAlias(c.alias, extraerAliasDesdeUrlPerfil(url)) });
                    nuevos += 1;
                }

                if (candidatos.length < perPage || nuevos === 0) break;
            } catch (_) {
                break;
            }
        }
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
                const actual = cola.shift();
                const relUrl = normalizarUrlRelacionVinted(actual?.url || '');
                if (!relUrl || visitadas.has(relUrl)) continue;
                visitadas.add(relUrl);

                const perfilOrigen = normalizarUrlPerfilVinted(relUrl);
                if (perfilOrigen) {
                    registrarPerfil(perfilOrigen, {
                        alias: actual?.parentAlias || extraerAliasDesdeUrlPerfil(perfilOrigen),
                        depth: Number.isFinite(Number(actual?.depth)) ? Number(actual.depth) : 0,
                        parentProfileUrl: actual?.parentProfileUrl || '',
                        parentAlias: actual?.parentAlias || '',
                        sourceRelationUrl: relUrl
                    });
                }

                const resultado = await extraerCuentasDesdeSeguidores(relUrl, session);
                const cuentas = Array.isArray(resultado?.cuentas) ? resultado.cuentas : [];
                const relaciones = Array.isArray(resultado?.relaciones) ? resultado.relaciones : [];
                const items = Array.isArray(resultado?.items) ? resultado.items : [];

                let cuentasExpandidas = [...cuentas];
                if (cuentasExpandidas.length < 4) {
                    const desdeApiRel = await extraerCuentasDesdeApiRelaciones(relUrl);
                    if (desdeApiRel.length > 0) {
                        cuentasExpandidas = [...cuentasExpandidas, ...desdeApiRel];
                    }
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

            for (const cuenta of objetivosFinales) {
                const { productos } = await scrapeVinted(cuenta.url, { playwrightFirst: true, session, deepMode: true });
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
                    const { productos } = await scrapeVinted(perfilOrigen, { playwrightFirst: true, session, deepMode: true });
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

            const { productos } = await scrapeVinted(urlNormalizada, { playwrightFirst: true, session, deepMode: true });
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
    const playwrightFirst = Boolean(options.playwrightFirst || parseBoolEnv('SCRAPER_PLAYWRIGHT_FIRST', false));
    const sharedSession = options.session || null;
    const deepMode = Boolean(options.deepMode || parseBoolEnv('SCRAPER_DEEP_MODE', false));

    if (playwrightFirst && !deepMode) {
        const porPlaywright = await extraerConPlaywright(url, sharedSession);
        if (porPlaywright.length >= 3) {
            return {
                productos: deduplicarProductos(porPlaywright),
                resumen: { scripts: 0, ldjson: 0, dom: 0, api: 0, playwright: porPlaywright.length }
            };
        }
    }

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
        { retries: 2, baseDelay: 700, factor: 2 }
    );

    const $ = cheerio.load(htmlResponse.data || '');

    const desdeScripts = extraerDesdeScripts($);
    const desdeLdJson = extraerProductosDesdeLdJson($);
    const desdeDom = extraerDesdeDomCheerio($);

    let productos = deduplicarProductos([...desdeScripts, ...desdeLdJson, ...desdeDom]);
    const resumen = {
        scripts: desdeScripts.length,
        ldjson: desdeLdJson.length,
        dom: desdeDom.length,
        api: 0,
        playwright: 0
    };

    if (deepMode || productos.length < 3) {
        const porApi = await extraerPorApiVinted(url);
        resumen.api = porApi.length;
        productos = deduplicarProductos([...productos, ...porApi]);
    }

    if (deepMode || productos.length < 3) {
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
    }

    await enviarWebhook(payload, {
        webUrl: process.env.MY_WEB_URL,
        secretToken: process.env.SCRAPER_TOKEN,
        webhookPath
    });

    return { productosCount: productos.length, resumen, esModoSeguidos, gruposCount: Array.isArray(grupos) ? grupos.length : 0 };
}

module.exports = {
    ejecutarScraper,
    scrapeMonopolio,
    normalizarPrecio,
    deduplicarProductos
};
