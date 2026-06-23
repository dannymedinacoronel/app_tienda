import re

with open('server.js', 'r') as f:
    content = f.read()

# GET /api/usuarios-admin
content = re.sub(
    r"app\.get\('/api/usuarios-admin',\s*exigeAdmin,\s*async\s*\(req,\s*res\)\s*=>\s*\{\s*try\s*\{\s*res\.json\(await\s*UsuarioAutorizado\.find\(\)\.sort\(\{\s*fechaAgregado:\s*-1\s*\}\)\);\s*\}\s*catch\s*\(e\)\s*\{\s*res\.status\(500\)\.send\(e\);\s*\}\s*\}\);",
    """app.get('/api/usuarios-admin', exigeAdmin, async (req, res) => {
    try {
        res.json(await UsuarioAutorizado.find({ negocio: req.session.negocioId }).sort({ fechaAgregado: -1 }));
    } catch (e) { res.status(500).send(e); }
});""",
    content
)

# POST /api/usuarios-admin
post_orig = """app.post('/api/usuarios-admin', exigeAdmin, async (req, res) => {
    try {
        const emailLimpio = req.body.email ? req.body.email.toLowerCase().trim() : "";
        const rolAsignado = req.body.rol || "Editor";
        if (!emailLimpio) return res.status(400).json({ error: 'Email requerido.' });
        const nuevo = new UsuarioAutorizado({ email: emailLimpio, rol: rolAsignado });
        await nuevo.save();
        await registrarLog(req.session.email,   `Autorizó cuenta: ${emailLimpio} [Rol: ${rolAsignado}]`,  {}, req, req);
        res.json(nuevo);
    } catch (e) { res.status(400).json({ error: 'El usuario ya está autorizado en la lista.' }); }
});"""

post_new = """app.post('/api/usuarios-admin', exigeAdmin, async (req, res) => {
    try {
        if (req.session.rol !== 'Admin') {
            return res.status(403).json({ error: 'Solo los administradores pueden añadir usuarios a la tienda.' });
        }
        const emailLimpio = req.body.email ? req.body.email.toLowerCase().trim() : "";
        const rolAsignado = req.body.rol || "Editor";
        if (!emailLimpio) return res.status(400).json({ error: 'Email requerido.' });

        // Comprobar si el usuario ya está en este negocio
        const existente = await UsuarioAutorizado.findOne({ email: emailLimpio, negocio: req.session.negocioId });
        if (existente) return res.status(400).json({ error: 'El usuario ya pertenece a esta tienda.' });

        const nuevo = new UsuarioAutorizado({ email: emailLimpio, rol: rolAsignado, negocio: req.session.negocioId });
        await nuevo.save();
        await registrarLog(req.session.email,   `Autorizó cuenta en tienda: ${emailLimpio} [Rol: ${rolAsignado}]`,  {}, req, req);
        res.json(nuevo);
    } catch (e) { res.status(400).json({ error: 'Error al autorizar el usuario.' }); }
});"""
content = content.replace(post_orig, post_new)

# DELETE /api/usuarios-admin/:id
delete_orig = """app.delete('/api/usuarios-admin/:id', exigeAdmin, async (req, res) => {
    try {
        const u = await UsuarioAutorizado.findById(req.params.id);
        if (u) {
            await UsuarioAutorizado.findByIdAndDelete(req.params.id);
            await registrarLog(req.session.email,   `Revocó el acceso permanente a: ${u.email}`,  {}, req, req);
        }
        res.sendStatus(200);
    } catch (e) { res.status(500).send(e); }
});"""

delete_new = """app.delete('/api/usuarios-admin/:id', exigeAdmin, async (req, res) => {
    try {
        if (req.session.rol !== 'Admin') {
            return res.status(403).json({ error: 'Solo los administradores pueden eliminar usuarios de la tienda.' });
        }
        const u = await UsuarioAutorizado.findOne({ _id: req.params.id, negocio: req.session.negocioId });
        if (u) {
            await UsuarioAutorizado.findOneAndDelete({ _id: req.params.id, negocio: req.session.negocioId });
            await registrarLog(req.session.email,   `Revocó el acceso permanente a: ${u.email}`,  {}, req, req);
        }
        res.sendStatus(200);
    } catch (e) { res.status(500).send(e); }
});"""
content = content.replace(delete_orig, delete_new)

with open('server.js', 'w') as f:
    f.write(content)

print("server.js updated")
