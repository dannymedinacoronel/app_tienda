require('dotenv').config();
const { ejecutarScraper } = require('./scraper-engine');

function webhookPorModo(mode) {
    return mode === 'monopolio'
        ? '/api/monopolio/webhook-github'
        : '/api/scraper/webhook-github';
}

async function run() {
    const modeRaw = String(process.argv[2] || 'manual').trim().toLowerCase();
    const mode = modeRaw === 'monopolio' ? 'monopolio' : 'manual';
    const url = process.argv[3];
    const empresa = process.argv[4] || 'seychelles';
    const alias = process.argv[5] || '';
    const webhookPathArg = String(process.argv[6] || '').trim();
    const webhookPath = webhookPathArg || webhookPorModo(mode);

    if (!url) {
        console.error('Error: Debes proporcionar una URL de Vinted como argumento.');
        process.exit(1);
    }

    try {
        await ejecutarScraper({
            mode,
            url,
            empresa,
            alias,
            webhookPath
        });
        process.exit(0);
    } catch (error) {
        console.error(`Error durante el scraping (${mode}): ${error.message}`);
        process.exit(1);
    }
}

run();