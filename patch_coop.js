const fs = require('fs');

let serverCode = fs.readFileSync('server.js', 'utf8');

const helmetConfig = `
// Permite los popups de autenticación con Google
app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    next();
});

// Es vital para que las sesiones funcionen en plataformas como Render/Heroku`;

serverCode = serverCode.replace(
    /\/\/ Es vital para que las sesiones funcionen en plataformas como Render\/Heroku/,
    helmetConfig
);

fs.writeFileSync('server.js', serverCode);
console.log('COOP headers patched correctly');
