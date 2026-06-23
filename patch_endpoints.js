const fs = require('fs');

let serverCode = fs.readFileSync('server.js', 'utf8');

// The login needs to return early if no negocio is found to create one
// Let's modify the `verificarTokenGoogle`
serverCode = serverCode.replace(
    /async function verificarTokenGoogle\(token\) \{/,
    `async function verificarTokenGoogle(token, req) {`
);

serverCode = serverCode.replace(
    /const usuario = await UsuarioAutorizado\.findOne\(\{ email \}\);/,
    `const usuario = await UsuarioAutorizado.findOne({ email }).populate('negocio');
        if (!usuario && email) {
            // First time logic? Wait, Google verification shouldn't handle this here.
            // But let's attach the info.
        }`
);

// We need a proper find with negocioId
// Instead of replacing every single endpoint by hand which is error prone,
// let's use a regex replace pattern.

const listFindReplaces = [
    { model: 'Tienda', req: '' },
    { model: 'Categoria', req: '' },
    { model: 'Cliente', req: '' },
    { model: 'Gasto', req: '' },
    { model: 'EstadoKanban', req: '' },
    { model: 'VentaRopa', req: '' },
    { model: 'LogAuditoria', req: '' },
    { model: 'Tarea', req: '' },
    { model: 'Faq', req: '' },
    { model: 'Nota', req: '' }
];

for (const p of listFindReplaces) {
    // Replace .find()
    serverCode = serverCode.replace(
        new RegExp(`await ${p.model}\\.find\\(\\)(?!\\.)`, 'g'),
        `await ${p.model}.find({ negocio: req.session.negocioId })`
    );
    // Add logic to save with negocioId
    serverCode = serverCode.replace(
        new RegExp(`const nuevo = new ${p.model}\\(req\\.body\\);`, 'g'),
        `const nuevo = new ${p.model}({ ...req.body, negocio: req.session.negocioId });`
    );
    // Delete and update require negocioId scope
    serverCode = serverCode.replace(
        new RegExp(`await ${p.model}\\.findByIdAndDelete\\(req\\.params\\.id\\);`, 'g'),
        `await ${p.model}.findOneAndDelete({ _id: req.params.id, negocio: req.session.negocioId });`
    );
    // FindOne and delete with destructured id
    serverCode = serverCode.replace(
        new RegExp(`await ${p.model}\\.findByIdAndDelete\\(id\\)`, 'g'),
        `await ${p.model}.findOneAndDelete({ _id: id, negocio: req.session.negocioId })`
    );
}

// VentasRopa find logic has some extra params
serverCode = serverCode.replace(
    /const ventasRaw = await VentaRopa\.find\(\)\.populate\('tienda'\)\.sort\(\{ _id: -1 \}\)\.lean\(\);/,
    `const ventasRaw = await VentaRopa.find({ negocio: req.session.negocioId }).populate('tienda').sort({ _id: -1 }).lean();`
);

serverCode = serverCode.replace(
    /const logs = await LogAuditoria\.find\(\)\.sort\(\{ _id: -1 \}\)\.limit\(50\)\.lean\(\);/,
    `const logs = await LogAuditoria.find({ negocio: req.session.negocioId }).sort({ _id: -1 }).limit(50).lean();`
);

fs.writeFileSync('server.js', serverCode);
console.log('Endpoints patched');
