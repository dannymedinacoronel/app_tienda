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
    const match = str.match(/\/member\/(\d+)/i);
    return match ? match[1] : '';
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
        const idInPath = pathOnly.match(/\/(\d{3,})\b/);
        if (!idInPath) return '';
        return `https://www.vinted.es/member/${idInPath[1]}`;
    }

    const idPerfil = pathOnly.match(/\/member\/(?:general\/)?(\d{3,})(?:-[^/?#]+)?/i);
    if (idPerfil && idPerfil[1]) {
        return `https://www.vinted.es/member/${idPerfil[1]}`;
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
    const relationType = relMatch && relMatch[1] ? relMatch[1].toLowerCase() : 'following';

    if (!pathOnly.toLowerCase().includes('/member/')) return '';

    const idPerfil = pathOnly.match(/\/member\/(?:general\/)?(\d{3,})(?:-[^/?#]+)?/i);
    if (!idPerfil || !idPerfil[1]) return '';

    return `https://www.vinted.es/member/${idPerfil[1]}/${relationType}`;
}

function construirUrlFollowingDesdePerfil(urlPerfil) {
    const perfil = normalizarUrlPerfilVinted(urlPerfil);
    if (!perfil) return '';
    return `${perfil}/following`;
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
                const anchors = Array.from(document.querySelectorAll('a[href*="/member/"]'));
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
            const out = [];
            const rels = [];
            const anchors = Array.from(document.querySelectorAll('a[href*="/member/"]'));
            for (const a of anchors) {
                const href = a.getAttribute('href') || '';
                const abs = href.startsWith('http') ? href : `https://www.vinted.es${href}`;
                if (!/\/member\//i.test(abs)) continue;
                const clean = abs.split('?')[0].replace(/\/+$/, '');
                const txt = (a.textContent || '').trim().replace(/\s+/g, ' ');
                if (/\/(following|followers|relations)\b/i.test(clean)) {
                    rels.push({ url: clean, alias: txt || '' });
                } else {
                    out.push({ url: clean, alias: txt || '' });
                }
            }
            return { out, rels };
        });

        const map = new Map();
        for (const p of perfiles?.out || []) {
            const url = normalizarUrlPerfilVinted(String(p.url || '').trim());
            if (!url) continue;
            const alias = sanitizarAlias(p.alias || extraerAliasDesdeUrlPerfil(url), extraerAliasDesdeUrlPerfil(url));
            if (!map.has(url)) map.set(url, { url, alias });
        }

        const relaciones = [];
        const seenRel = new Set();
        for (const r of perfiles?.rels || []) {
            const relUrl = normalizarUrlRelacionVinted(String(r.url || '').trim());
            if (!relUrl || seenRel.has(relUrl)) continue;
            seenRel.add(relUrl);
            relaciones.push(relUrl);
        }

        return {
            cuentas: Array.from(map.values()),
            relaciones
        };
    } catch (error) {
        console.error(`[MONOPOLIO] Fallo al extraer cuentas seguidas: ${error.message}`);
        return { cuentas: [], relaciones: [] };
    } finally {
        try { await page.close(); } catch (_) {}
        if (ownSession) {
            await cerrarSesionNavegador(internalSession);
        }
    }
}

async function scrapeMonopolio(url, aliasBase = '') {
    const urlNormalizada = normalizarUrlVinted(url);
    const aliasPrincipal = sanitizarAlias(aliasBase || extraerAliasDesdeUrlPerfil(urlNormalizada), 'Competidor');
    const grupos = [];
    const session = await crearSesionNavegador('monopolio');

    try {
        if (esUrlSeguidoresVinted(urlNormalizada)) {
            const maxDepth = Math.max(1, Math.min(parseInt(process.env.MONOPOLIO_MAX_CHAIN_DEPTH || '3', 10), 3));
            const maxChainUrls = Math.max(8, Math.min(parseInt(process.env.MONOPOLIO_MAX_CHAIN_URLS || '36', 10), 60));
            const maxCuentas = Math.max(1, Math.min(parseInt(process.env.MONOPOLIO_MAX_ACCOUNTS || '60', 10), 120));
            const maxBranch = Math.max(4, Math.min(parseInt(process.env.MONOPOLIO_CHAIN_BRANCH || '12', 10), 30));

            const cola = [{ url: normalizarUrlRelacionVinted(urlNormalizada) || urlNormalizada, depth: 0 }];
            const visitadas = new Set();
            const perfilesMap = new Map();

            while (cola.length > 0 && visitadas.size < maxChainUrls) {
                const actual = cola.shift();
                const relUrl = normalizarUrlRelacionVinted(actual?.url || '');
                if (!relUrl || visitadas.has(relUrl)) continue;
                visitadas.add(relUrl);

                const perfilOrigen = normalizarUrlPerfilVinted(relUrl);
                if (perfilOrigen && !perfilesMap.has(perfilOrigen)) {
                    perfilesMap.set(perfilOrigen, {
                        url: perfilOrigen,
                        alias: sanitizarAlias(extraerAliasDesdeUrlPerfil(perfilOrigen), 'Competidor')
                    });
                }

                const resultado = await extraerCuentasDesdeSeguidores(relUrl, session);
                const cuentas = Array.isArray(resultado?.cuentas) ? resultado.cuentas : [];
                const relaciones = Array.isArray(resultado?.relaciones) ? resultado.relaciones : [];

                for (const cuenta of cuentas) {
                    const urlCuenta = normalizarUrlPerfilVinted(cuenta.url);
                    if (!urlCuenta || perfilesMap.has(urlCuenta)) continue;
                    perfilesMap.set(urlCuenta, {
                        url: urlCuenta,
                        alias: sanitizarAlias(cuenta.alias, extraerAliasDesdeUrlPerfil(urlCuenta))
                    });
                }

                if (actual.depth < maxDepth - 1) {
                    for (const rel of relaciones) {
                        const relNorm = normalizarUrlRelacionVinted(rel);
                        if (!relNorm || visitadas.has(relNorm)) continue;
                        cola.push({ url: relNorm, depth: actual.depth + 1 });
                    }

                    for (const cuenta of cuentas.slice(0, maxBranch)) {
                        const nextRel = construirUrlFollowingDesdePerfil(cuenta.url);
                        const relNorm = normalizarUrlRelacionVinted(nextRel);
                        if (!relNorm || visitadas.has(relNorm)) continue;
                        cola.push({ url: relNorm, depth: actual.depth + 1 });
                    }
                }
            }

            const objetivos = Array.from(perfilesMap.values()).slice(0, maxCuentas);

            console.log(`[MONOPOLIO] Cadena de seguidos: visitadas=${visitadas.size}, perfiles=${perfilesMap.size}, procesando=${objetivos.length}`);

            if (objetivos.length === 0) {
                console.warn('[MONOPOLIO] No se detectaron perfiles desde la URL de seguidos.');
            }

            for (const cuenta of objetivos) {
                const { productos } = await scrapeVinted(cuenta.url, { playwrightFirst: true, session });
                const aliasCuenta = sanitizarAlias(cuenta.alias, extraerAliasDesdeUrlPerfil(cuenta.url));
                const enriquecidos = (productos || []).map((p) => ({
                    ...p,
                    proveedor: aliasCuenta,
                    cuenta: aliasCuenta,
                    urlCuenta: cuenta.url,
                    origenGrupo: aliasPrincipal
                }));

                grupos.push({
                    cuenta: aliasCuenta,
                    urlCuenta: cuenta.url,
                    total: enriquecidos.length,
                    productos: enriquecidos
                });
            }
        } else {
            const { productos } = await scrapeVinted(urlNormalizada, { playwrightFirst: true, session });
            const aliasCuenta = sanitizarAlias(aliasPrincipal, extraerAliasDesdeUrlPerfil(urlNormalizada));
            const enriquecidos = (productos || []).map((p) => ({
                ...p,
                proveedor: aliasCuenta,
                cuenta: aliasCuenta,
                urlCuenta: urlNormalizada,
                origenGrupo: aliasPrincipal
            }));

            grupos.push({
                cuenta: aliasCuenta,
                urlCuenta: urlNormalizada,
                total: enriquecidos.length,
                productos: enriquecidos
            });
        }

        const productos = deduplicarProductos(grupos.flatMap((g) => g.productos || []));
        return {
            productos,
            grupos,
            esModoSeguidos: esUrlSeguidoresVinted(urlNormalizada),
            aliasPrincipal,
            urlNormalizada
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

    if (playwrightFirst) {
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

    if (productos.length < 3) {
        const porApi = await extraerPorApiVinted(url);
        resumen.api = porApi.length;
        productos = deduplicarProductos([...productos, ...porApi]);
    }

    if (productos.length < 3) {
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
            grupos: Array.isArray(grupos) ? grupos.length : 0
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
    normalizarPrecio,
    deduplicarProductos
};
