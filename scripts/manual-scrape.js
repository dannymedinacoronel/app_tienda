require('dotenv').config();
const { ejecutarScraper } = require('./scraper-engine');

async function run() {
    const url = process.argv[2];
    const empresa = process.argv[3] || 'seychelles';

    if (!url) {
        console.error('Error: Debes proporcionar una URL de Vinted como argumento.');
        process.exit(1);
    }

    try {
        await ejecutarScraper({
            mode: 'manual',
            url,
            empresa,
            webhookPath: '/api/scraper/webhook-github'
        });
        process.exit(0);
    } catch (error) {
        console.error(`Error durante el scraping manual: ${error.message}`);
        process.exit(1);
    }
}

run();
