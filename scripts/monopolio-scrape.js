require('dotenv').config();
const { ejecutarScraper } = require('./scraper-engine');

async function run() {
    const url = process.argv[2];
    const empresa = process.argv[3] || 'seychelles';
    const alias = process.argv[4] || url;

    if (!url) {
        console.error('Error: Debes proporcionar una URL como argumento.');
        process.exit(1);
    }

    try {
        await ejecutarScraper({
            mode: 'monopolio',
            url,
            empresa,
            alias,
            webhookPath: '/api/monopolio/webhook-github'
        });
        process.exit(0);
    } catch (error) {
        console.error(`Error durante el scraping de monopolio: ${error.message}`);
        process.exit(1);
    }
}

run();
