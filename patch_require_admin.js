const fs = require('fs');

let serverCode = fs.readFileSync('server.js', 'utf8');

serverCode = serverCode.replace(
    /function exigeAdmin\(req, res, next\) \{/,
    `function exigeAdmin(req, res, next) {
    if (!req.session || !req.session.email || !req.session.negocioId) {
        return res.status(401).send('No autorizado o sesión caducada');
    }`
);

// Fix verifyToken duplicate code created previously
serverCode = serverCode.replace(
    /app\.post\('\/api\/auth\/google', async \(req, res\) => \{[\s\S]*?app\.post\('\/api\/auth\/google', async \(req, res\) => \{/,
    `app.post('/api/auth/google', async (req, res) => {`
);

fs.writeFileSync('server.js', serverCode);
console.log('Middleware patched correctly');
