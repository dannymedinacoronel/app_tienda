const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

function construirWebhookTargets(webUrl) {
    if (!webUrl || typeof webUrl !== 'string') return [];

    const raw = webUrl.trim().replace(/\/+$/, '');
    if (!raw) return [];

    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const targets = [];

    try {
        const parsed = new URL(withProtocol);
        const origin = parsed.origin.replace(/\/+$/, '');
        const path = parsed.pathname.replace(/\/+$/, '');

        if (path.endsWith('/api/scraper/webhook-github')) {
            targets.push(withProtocol);
        } else if (path === '/api') {
            targets.push(`${origin}/api/scraper/webhook-github`);
        } else {
            targets.push(`${withProtocol}/api/scraper/webhook-github`);
            targets.push(`${origin}/api/scraper/webhook-github`);
        }
    } catch (e) {
        targets.push(`${withProtocol}/api/scraper/webhook-github`);
    }

    return [...new Set(targets)];
}

function extraerObjetoAsignado(scriptContent, nombreVariable) {
    const escapedName = nombreVariable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escapedName}\\s*=`, 'm');
    const match = scriptContent.match(regex);
    if (!match || typeof match.index !== 'number') return null;

    const idxAsignacion = match.index + match[0].length;
    const startIdx = scriptContent.indexOf('{', idxAsignacion);
    if (startIdx === -1) return null;

    let depth = 0;
    let inString = false;
    let stringChar = '';
    let escaped = false;

    for (let i = startIdx; i < scriptContent.length; i++) {
        const ch = scriptContent[i];

        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === '\\') {
                escaped = true;
                continue;
            }
            if (ch === stringChar) {
                inString = false;
                stringChar = '';
            }
            continue;
        }

        if (ch === '"' || ch === "'") {
            inString = true;
            stringChar = ch;
            continue;
        }

        if (ch === '{') depth++;
        if (ch === '}') {
            depth--;
            if (depth === 0) {
                return scriptContent.slice(startIdx, i + 1);
            }
        }
    }

    return null;
}

function extraerProductosDesdeLdJson($) {
    const productos = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).html();
        if (!raw) return;

        try {
            const parsed = JSON.parse(raw);
            const bloques = Array.isArray(parsed) ? parsed : [parsed];

            const recolectar = (node) => {
                if (!node || typeof node !== 'object') return;

                const tipo = String(node['@type'] || '').toLowerCase();
                if (tipo.includes('product')) {
                    const titulo = node.name || node.title || '';
                    const precio = normalizarPrecio(node?.offers?.price ?? node?.price);
                    const imagen = Array.isArray(node.image) ? (node.image[0] || '') : (node.image || '');
                    if (titulo && Number.isFinite(precio)) {
                        productos.push({ titulo, precio, imagen });
                    }
                }

                if (Array.isArray(node.itemListElement)) {
                    node.itemListElement.forEach((it) => {
                        if (it?.item) recolectar(it.item);
                        else recolectar(it);
                    });
                }

                Object.values(node).forEach((v) => {
                    if (Array.isArray(v)) v.forEach(recolectar);
                    else if (v && typeof v === 'object') recolectar(v);
                });
            };

            bloques.forEach(recolectar);
        } catch (e) {
            // Ignoramos bloques ld+json inválidos y seguimos.
        }
    });

    const seen = new Set();
    return productos.filter((p) => {
        const key = `${p.titulo}__${p.precio}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function normalizarPrecio(valor) {
    if (valor == null) return NaN;
    const num = Number(String(valor).replace(/\s+/g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) ? num : NaN;
}

function mapearProductoVinted(item) {
    if (!item) return null;

    const titulo = item.title || item.name || item.item_title || '';
    const precio = normalizarPrecio(
        item?.price?.amount ??
        item?.price_numeric ??
        item?.total_item_price?.amount ??
        item?.total_item_price ??
        item?.price
    );

    const imagen =
        item?.photo?.url ||
        item?.photo?.full_size_url ||
        item?.photos?.[0]?.url ||
        item?.photos?.[0]?.full_size_url ||
        item?.image_url ||
        '';

    if (!titulo || !Number.isFinite(precio)) return null;
    return { titulo, precio, imagen };
}

function deduplicarProductos(lista) {
    const seen = new Set();
    const unicos = [];
    for (const p of lista) {
        if (!p || !p.titulo || !Number.isFinite(Number(p.precio))) continue;
        const normalizado = { titulo: String(p.titulo).trim(), precio: Number(p.precio), imagen: p.imagen || '' };
        const k = `${normalizado.titulo}__${normalizado.precio}`;
        if (!seen.has(k)) {
            seen.add(k);
            unicos.push(normalizado);
        }
    }
    return unicos;
}

async function extraerProductosPorApiVinted(urlObjetivo) {
    const memberMatch = String(urlObjetivo).match(/\/member\/(\d+)/i);
    if (!memberMatch) return [];

    const userId = memberMatch[1];
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Referer': `https://www.vinted.es/member/${userId}`
    };

    const acumulados = [];
    const maxPaginas = 8;

    const extraerItems = (data) => {
        if (!data || typeof data !== 'object') return [];
        if (Array.isArray(data.items)) return data.items;
        if (Array.isArray(data.catalog_items)) return data.catalog_items;
        if (Array.isArray(data?.data?.items)) return data.data.items;
        if (Array.isArray(data?.data?.catalog_items)) return data.data.catalog_items;
        return [];
    };

    // Endpoint principal para inventario por usuario
    for (let page = 1; page <= maxPaginas; page++) {
        try {
            const res = await axios.get(`https://www.vinted.es/api/v2/users/${userId}/items`, {
                headers,
                params: { page, per_page: 96 },
                timeout: 15000
            });
            const items = extraerItems(res.data);
            if (!items.length) break;
            acumulados.push(...items);
        } catch (e) {
            break;
        }
    }

    // Fallback alternativo si el endpoint principal no devolvió nada
    if (acumulados.length === 0) {
        for (let page = 1; page <= maxPaginas; page++) {
            try {
                const res = await axios.get('https://www.vinted.es/api/v2/catalog/items', {
                    headers,
                    params: { user_id: userId, page, per_page: 96, order: 'newest_first' },
                    timeout: 15000
                });
                const items = extraerItems(res.data);
                if (!items.length) break;
                acumulados.push(...items);
            } catch (e) {
                break;
            }
        }
    }

    const normalizados = acumulados
        .map(mapearProductoVinted)
        .filter(Boolean);

    return deduplicarProductos(normalizados);
}

async function extraerProductosConPlaywright(urlObjetivo) {
    let chromium;
    try {
        ({ chromium } = require('playwright'));
    } catch (e) {
        console.log('[SCRAPER] Playwright no está disponible en este entorno.');
        return [];
    }

    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ]
    });

    const context = await browser.newContext({
        locale: 'es-ES',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 900 }
    });

    const page = await context.newPage();
    const capturadosApi = [];

    page.on('response', async (res) => {
        try {
            const rUrl = res.url();
            if (!rUrl.includes('/api/v2/')) return;
            if (!(rUrl.includes('/catalog/items') || rUrl.includes('/users/') || rUrl.includes('/items'))) return;
            const ctype = (res.headers()['content-type'] || '').toLowerCase();
            if (!ctype.includes('application/json')) return;
            const body = await res.json();
            const items = body?.items || body?.catalog_items || body?.data?.items || body?.data?.catalog_items || [];
            if (Array.isArray(items) && items.length > 0) {
                capturadosApi.push(...items.map(mapearProductoVinted).filter(Boolean));
            }
        } catch (e) {
            // Ignorar fallos puntuales de parseo de respuesta.
        }
    });

    try {
        await page.goto(urlObjetivo, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(3500);

        const extraidosDom = await page.evaluate(() => {
            const normalizarPrecio = (txt) => {
                if (txt == null) return NaN;
                const n = Number(String(txt).replace(/\s+/g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
                return Number.isFinite(n) ? n : NaN;
            };

            const out = [];
            const cards = Array.from(document.querySelectorAll('div[data-testid^="grid-item"], .item-card, [class*="feed-grid"] [class*="item"]'));
            for (const card of cards) {
                const titleEl = card.querySelector('[data-testid$="--title"], h3, h4, a[title]');
                const priceEl = card.querySelector('[data-testid$="--price-text"], [class*="price"], h2, h3');
                const imgEl = card.querySelector('img');
                const titulo = (titleEl?.textContent || titleEl?.getAttribute('title') || '').trim();
                const precio = normalizarPrecio(priceEl?.textContent || '');
                const imagen = imgEl?.src || '';
                if (titulo && Number.isFinite(precio)) out.push({ titulo, precio, imagen });
            }
            return out;
        });

        const combinados = deduplicarProductos([...(extraidosDom || []), ...capturadosApi]);
        return combinados;
    } catch (e) {
        console.error(`[SCRAPER] Playwright falló: ${e.message}`);
        return deduplicarProductos(capturadosApi);
    } finally {
        await context.close();
        await browser.close();
    }
}

async function run() {
    const url = process.argv[2];
    if (!url) {
        console.error("❌ Error: Debes proporcionar una URL de Vinted como argumento.");
        process.exit(1);
    }

    const secretToken = process.env.SCRAPER_TOKEN;

    try {
        let htmlContent = '';
        console.log(`[SCRAPER] Intento directo para Vinted: ${url}`);
        const response = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'es-ES,es;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Cookie': 'v_p=1; access_token_web=true' // Ayuda a simular navegador real
            },
            timeout: 15000 
        });
        htmlContent = response.data;

        const $ = cheerio.load(htmlContent);
        const productosExtraidos = [];

        // MÉTODO ULTRA RÁPIDO: Extraer del JSON interno de Vinted
        const scripts = $('script').toArray();
        for (const script of scripts) {
            const content = $(script).html();
            if (content && (content.includes('INITIAL_STATE') || content.includes('items'))) {
                const initialStateRaw = extraerObjetoAsignado(content, 'window.__INITIAL_STATE__');
                const nuxtRaw = extraerObjetoAsignado(content, 'window.__NUXT__');
                const jsonRaw = initialStateRaw || nuxtRaw;

                if (jsonRaw) {
                    try {
                        const data = JSON.parse(jsonRaw);
                        const items = data?.items || data?.catalog?.items || data?.itemsOrRecommendations?.items || [];
                        items.forEach(it => {
                            if (it.title && it.price) {
                                productosExtraidos.push({
                                    titulo: it.title,
                                    precio: parseFloat(it.price?.amount || it.price || '0'),
                                    imagen: it.photo?.url || it.image_url || ''
                                });
                            }
                        });
                        if (productosExtraidos.length > 0) break; 
                    } catch (e) {
                        // Seguimos iterando scripts; algunas asignaciones no son JSON puro.
                    }
                }
            }
        }

        // Si el JSON falla, usamos selectores CSS
        if (productosExtraidos.length === 0) {
            $('div[data-testid^="grid-item"], .item-card').each((i, el) => {
                const titulo = $(el).find('[data-testid$="--title"], h4').text().trim();
                const precioTexto = $(el).find('[data-testid$="--price-text"], h3').text().trim();
                const cleanPrice = precioTexto.replace(/\s+/g, '').replace(',', '.').replace(/[^\d.-]/g, '');
                if (titulo && !isNaN(parseFloat(cleanPrice))) {
                    productosExtraidos.push({ titulo, precio: parseFloat(cleanPrice), imagen: '' });
                }
            });
        }

        // Fallback adicional: datos estructurados JSON-LD
        if (productosExtraidos.length === 0) {
            const porLdJson = extraerProductosDesdeLdJson($);
            if (porLdJson.length > 0) {
                productosExtraidos.push(...porLdJson);
                console.log(`[SCRAPER] JSON-LD devolvió ${porLdJson.length} productos.`);
            }
        }

        // Fallback robusto: extraer por API de Vinted (perfil /member/:id)
        if (productosExtraidos.length === 0) {
            console.log('[SCRAPER] HTML devolvió 0 productos. Probando API pública de Vinted...');
            const porApi = await extraerProductosPorApiVinted(url);
            if (porApi.length > 0) {
                productosExtraidos.push(...porApi);
                console.log(`[SCRAPER] API de Vinted devolvió ${porApi.length} productos.`);
            }
        }

        // Último fallback: navegador real con Playwright para páginas anti-bot
        if (productosExtraidos.length === 0) {
            console.log('[SCRAPER] API devolvió 0 productos. Probando extracción con navegador real (Playwright)...');
            const porNavegador = await extraerProductosConPlaywright(url);
            if (porNavegador.length > 0) {
                productosExtraidos.push(...porNavegador);
                console.log(`[SCRAPER] Playwright devolvió ${porNavegador.length} productos.`);
            }
        }

        const productosUnicos = deduplicarProductos(productosExtraidos);
        productosExtraidos.length = 0;
        productosExtraidos.push(...productosUnicos);
        console.log(`[INFO] Se encontraron ${productosExtraidos.length} productos en la web.`);

        // --- ENVIAR A LA WEB ---
        const webUrl = process.env.MY_WEB_URL;

        if (webUrl && secretToken) {
            const webhookTargets = construirWebhookTargets(webUrl);
            let enviado = false;
            let ultimoError = null;

            for (const target of webhookTargets) {
                try {
                    console.log(`[WEBHOOK] Enviando resultados a: ${target}`);
                    await axios.post(target, {
                        productos: productosExtraidos,
                        urlOrigen: url
                    }, {
                        headers: { 'x-github-token': secretToken },
                        timeout: 15000
                    });
                    console.log('[WEBHOOK] ¡Datos enviados con éxito!');
                    enviado = true;
                    break;
                } catch (err) {
                    ultimoError = err;
                    const status = err?.response?.status || 'sin-status';
                    console.error(`[WEBHOOK] Fallo en ${target} -> status: ${status}`);
                }
            }

            if (!enviado) {
                const detalle = ultimoError?.response?.data?.error || ultimoError?.message || 'error desconocido';
                throw new Error(`No se pudo entregar el webhook a MY_WEB_URL. Revisa que apunte al dominio raiz de Render (sin /api). Detalle: ${detalle}`);
            }
        } else {
            console.warn('[WEBHOOK] Saltado: faltan MY_WEB_URL o SCRAPER_TOKEN en GitHub Secrets.');
        }

        process.exit(0);

    } catch (error) {
        console.error("❌ Error durante el scraping:", error.message);
        process.exit(1);
    }
}

run();
