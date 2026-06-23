const fs = require('fs');

let serverCode = fs.readFileSync('server.js', 'utf8');

// We need to add a fallback in login:
// If the user logs in and the database ALREADY HAS data but it doesn't belong to a Negocio,
// we should probably auto-create a default business for the user and migrate the old data.
// For now, let's just make sure the user's legacy user account can be upgraded smoothly.

const oldLogin = `
        const usuario = await UsuarioAutorizado.findOne({ email }).populate('negocio');

        if (usuario) {
            req.session.email = usuario.email;
            req.session.rol = usuario.rol;
            req.session.negocioId = usuario.negocio ? usuario.negocio._id : null;
`;

const newLogin = `
        let usuario = await UsuarioAutorizado.findOne({ email }).populate('negocio');

        if (usuario) {
            // MIGRACIÓN LEGACY: Si el usuario existe pero no tiene negocio, creamos uno por defecto y asignamos todos los registros antiguos a ese negocio.
            if (!usuario.negocio) {
                const legacyNegocio = new Negocio({ nombre: 'Mi Negocio ' + email.split('@')[0] });
                await legacyNegocio.save();
                usuario.negocio = legacyNegocio._id;
                await usuario.save();

                // Migrar todos los registros huérfanos (legacy) al nuevo negocio principal
                await Cliente.updateMany({ negocio: { $exists: false } }, { $set: { negocio: legacyNegocio._id } });
                await Gasto.updateMany({ negocio: { $exists: false } }, { $set: { negocio: legacyNegocio._id } });
                await EstadoKanban.updateMany({ negocio: { $exists: false } }, { $set: { negocio: legacyNegocio._id } });
                await VentaRopa.updateMany({ negocio: { $exists: false } }, { $set: { negocio: legacyNegocio._id } });
                await Tienda.updateMany({ negocio: { $exists: false } }, { $set: { negocio: legacyNegocio._id } });
                await Categoria.updateMany({ negocio: { $exists: false } }, { $set: { negocio: legacyNegocio._id } });
                await Tarea.updateMany({ negocio: { $exists: false } }, { $set: { negocio: legacyNegocio._id } });
                await Faq.updateMany({ negocio: { $exists: false } }, { $set: { negocio: legacyNegocio._id } });
                await Nota.updateMany({ negocio: { $exists: false } }, { $set: { negocio: legacyNegocio._id } });

                // Recargar el usuario con el negocio
                usuario = await UsuarioAutorizado.findOne({ email }).populate('negocio');
            }

            req.session.email = usuario.email;
            req.session.rol = usuario.rol;
            req.session.negocioId = usuario.negocio._id;
`;

serverCode = serverCode.replace(oldLogin, newLogin);

fs.writeFileSync('server.js', serverCode);
console.log('Legacy migration patched');
