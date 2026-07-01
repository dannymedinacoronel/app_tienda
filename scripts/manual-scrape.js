const mongoose = require('mongoose');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

// Definición mínima de modelos para que el script funcione independientemente
const VentaRopaSchema = new mongoose.Schema({
    prenda: String,
    precioVenta: Number,
    canalVenta: String,
    estado: String,
    imagen: String,
    fechaCarga: { type: Date, default: Date.now }
}, { collection: 'VentaRopa' });

const VentaRopa = mongoose.models.VentaRopa || mongoose.model('VentaRopa', VentaRopaSchema);

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

    const seen = new Set();
    const unicos = [];
    for (const p of normalizados) {
        const k = `${p.titulo}__${p.precio}`;
        if (!seen.has(k)) {
            seen.add(k);
            unicos.push(p);
        }
    }

    return unicos;
}

async function run() {
    const url = process.argv[2];
    if (!url) {
        console.error("❌ Error: Debes proporcionar una URL de Vinted como argumento.");
        process.exit(1);
    }

    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    const secretToken = process.env.SCRAPER_TOKEN;

    if (!mongoUri) {
        console.error("❌ Error: MONGO_URI no definida en el entorno.");
        process.exit(1);
    }

    try {
        console.log(`[CONEXIÓN] Conectando a MongoDB...`);
        await mongoose.connect(mongoUri);
        console.log(`[CONEXIÓN] Conectado correctamente.`);

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
                const jsonMatch = content.match(/window\.__INITIAL_STATE__\s*=\s*({.*?});/s) || 
                                content.match(/window\.__NUXT__\s*=\s*({.*?});/s) ||
                                content.match(/\{"items":\[.*?\]\}/s);
                if (jsonMatch) {
                    try {
                        const data = JSON.parse(jsonMatch[1] || jsonMatch[0]);
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
                    } catch (e) {}
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

        // Fallback robusto: extraer por API de Vinted (perfil /member/:id)
        if (productosExtraidos.length === 0) {
            console.log('[SCRAPER] HTML devolvió 0 productos. Probando API pública de Vinted...');
            const porApi = await extraerProductosPorApiVinted(url);
            if (porApi.length > 0) {
                productosExtraidos.push(...porApi);
                console.log(`[SCRAPER] API de Vinted devolvió ${porApi.length} productos.`);
            }
        }

        console.log(`[INFO] Se encontraron ${productosExtraidos.length} productos en la web.`);

        let nuevos = 0;
        let actualizados = 0;

        // Procesar en lotes o más rápido
        const bulkOperations = productosExtraidos.map(async (item) => {
            const coincidencia = await VentaRopa.findOne({ 
                prenda: item.titulo,
                canalVenta: 'Vinted'
            });

            if (coincidencia) {
                if (Math.abs(coincidencia.precioVenta - item.precio) > 0.1) {
                    coincidencia.precioVenta = item.precio;
                    await coincidencia.save();
                    actualizados++;
                }
            } else {
                await VentaRopa.create({
                    prenda: item.titulo,
                    precioVenta: item.precio,
                    canalVenta: 'Vinted',
                    estado: 'Disponible',
                    imagen: item.imagen,
                    fechaCarga: new Date()
                });
                nuevos++;
            }
        });

        await Promise.all(bulkOperations);

        console.log(`[RESUMEN] Proceso finalizado. Nuevos: ${nuevos}, Actualizados: ${actualizados}`);

        // --- ENVIAR A LA WEB ---
        const webUrl = process.env.MY_WEB_URL;
        const secretToken = process.env.SCRAPER_TOKEN;

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
