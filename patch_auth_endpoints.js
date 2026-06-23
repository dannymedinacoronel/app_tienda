const fs = require('fs');

let serverCode = fs.readFileSync('server.js', 'utf8');

serverCode = serverCode.replace(
    /app\.post\('\/api\/auth\/google', async \(req, res\) => \{[\s\S]*?\} catch \(e\) \{/,
    `app.post('/api/auth/google', async (req, res) => {
    try {
        const { token, clienteInfo } = req.body;
        const payload = await verificarTokenGoogle(token);
        if (!payload || !payload.email) return res.status(401).json({ error: 'Token inválido' });

        const email = payload.email.toLowerCase();
        const usuario = await UsuarioAutorizado.findOne({ email }).populate('negocio');

        if (usuario) {
            req.session.email = usuario.email;
            req.session.rol = usuario.rol;
            req.session.negocioId = usuario.negocio ? usuario.negocio._id : null;

            const locationData = await obtenerUbicacionCompleta(req, clienteInfo);
            await registrarLog(usuario.email, "Inició sesión exitosamente", locationData, {}, req, req);
            return res.json({ success: true, email: usuario.email, redirect: '/' });
        } else {
            // Flow to register a new tenant
            return res.json({ success: false, setupRequired: true, email: email });
        }
    } catch (e) {`
);

serverCode = serverCode.replace(
    /app\.post\('\/api\/auth\/google', async \(req, res\) => \{[\s\S]*?\} catch \(e\) \{/,
    `app.post('/api/auth/google', async (req, res) => {
    try {
        const { token, clienteInfo } = req.body;
        const payload = await verificarTokenGoogle(token);
        if (!payload || !payload.email) return res.status(401).json({ error: 'Token inválido' });

        const email = payload.email.toLowerCase();
        const usuario = await UsuarioAutorizado.findOne({ email }).populate('negocio');

        if (usuario) {
            req.session.email = usuario.email;
            req.session.rol = usuario.rol;
            req.session.negocioId = usuario.negocio ? usuario.negocio._id : null;

            const locationData = await obtenerUbicacionCompleta(req, clienteInfo);
            await registrarLog(usuario.email, "Inició sesión exitosamente", locationData, {}, req, req);
            return res.json({ success: true, email: usuario.email, redirect: '/' });
        } else {
            // Flow to register a new tenant
            return res.json({ success: false, setupRequired: true, email: email });
        }
    } catch (e) {`
);

// We need a setup endpoint
const setupEndpoint = `
app.post('/api/auth/setup', async (req, res) => {
    try {
        const { email, negocioNombre, token } = req.body;
        const payload = await verificarTokenGoogle(token);
        if (!payload || payload.email.toLowerCase() !== email.toLowerCase()) {
            return res.status(401).json({ error: 'Validación de Google fallida.' });
        }

        const existingBusiness = await Negocio.findOne({ nombre: negocioNombre });
        if (existingBusiness) {
            return res.status(400).json({ error: 'El nombre del negocio ya está en uso.' });
        }

        const nuevoNegocio = new Negocio({ nombre: negocioNombre });
        await nuevoNegocio.save();

        const adminUser = new UsuarioAutorizado({
            email: email.toLowerCase(),
            rol: 'Admin',
            negocio: nuevoNegocio._id
        });
        await adminUser.save();

        req.session.email = adminUser.email;
        req.session.rol = adminUser.rol;
        req.session.negocioId = nuevoNegocio._id;

        res.json({ success: true, redirect: '/' });
    } catch (error) {
        res.status(500).json({ error: 'Error al configurar el negocio' });
    }
});
`;

serverCode = serverCode.replace(
    /app\.post\('\/api\/logout',/,
    `${setupEndpoint}\napp.post('/api/logout',`
);

fs.writeFileSync('server.js', serverCode);
console.log('Auth patched');
