const fs = require('fs');
let serverCode = fs.readFileSync('server.js', 'utf8');

const setupReplacement = `
        const adminUser = new UsuarioAutorizado({
            email: email.toLowerCase(),
            rol: 'Admin',
            negocio: nuevoNegocio._id
        });
        await adminUser.save();

        // 🟢 SEED DEFAULT KANBAN STATES FOR THE NEW BUSINESS
        const defaultStates = [
            { negocio: nuevoNegocio._id, nombre: 'Stock', icono: '📦', color: 'slate', rolFinanciero: 'Stock', orden: 1 },
            { negocio: nuevoNegocio._id, nombre: 'Reservado', icono: '⏳', color: 'amber', rolFinanciero: 'Oculto', orden: 2 },
            { negocio: nuevoNegocio._id, nombre: 'Vendido', icono: '✅', color: 'emerald', rolFinanciero: 'Venta', orden: 3 },
            { negocio: nuevoNegocio._id, nombre: 'Devuelto', icono: '↩️', color: 'rose', rolFinanciero: 'Oculto', orden: 4 }
        ];
        await EstadoKanban.insertMany(defaultStates);
`;

serverCode = serverCode.replace(
    /const adminUser = new UsuarioAutorizado\(\{\n\s*email: email\.toLowerCase\(\),\n\s*rol: 'Admin',\n\s*negocio: nuevoNegocio\._id\n\s*\}\);\n\s*await adminUser\.save\(\);/,
    setupReplacement
);

// We should also patch the backwards compatibility so if the user logs in and they have NO negocio assigned yet,
// they can just migrate their existing old data.
// But the user just wants the app to work. If they login and there's no data, it's because it's scoped to a negocio.

fs.writeFileSync('server.js', serverCode);
console.log('Setup default states patched');
