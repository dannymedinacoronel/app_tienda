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
        console.log(`[SCRAPER] Intento directo para: ${url}`);
        console.log(`[SCRAPER] Intento directo para: ${url}`);
        const response = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'es-ES,es;q=0.9'
            },
            timeout: 10000 // Reducido a 10 segundos
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
        const secretToken = process.env.SCRAPER_TOKEN; // Usamos el nombre correcto

        if (webUrl && secretToken) {
            console.log(`[WEBHOOK] Enviando resultados a la web: ${webUrl}`);
            await axios.post(`${webUrl}/api/scraper/webhook-github`, {
                productos: productosExtraidos,
                urlOrigen: url
            }, {
                headers: { 'x-github-token': secretToken }
            });
            console.log(`[WEBHOOK] ¡Datos enviados con éxito!`);
        }

        process.exit(0);

    } catch (error) {
        console.error("❌ Error durante el scraping:", error.message);
        process.exit(1);
    }
}

run();
