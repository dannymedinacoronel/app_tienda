const fs = require('fs');

let serverCode = fs.readFileSync('server.js', 'utf8');

serverCode = serverCode.replace(
    /async function registrarLog\(usuario, accion, locationData = \{\}\) \{/,
    `async function registrarLog(usuario, accion, locationData = {}, negocioId = null) {`
);

serverCode = serverCode.replace(
    /const nuevoLog = new LogAuditoria\(\{\s*usuario,\s*accion,\s*\.\.\.locationData\s*\}\);/,
    `const nuevoLog = new LogAuditoria({ \n            usuario, \n            accion,\n            negocio: negocioId,\n            ...locationData\n        });`
);

// Fix the actual broken call on 520
serverCode = serverCode.replace(
    /await registrarLog\(usuario\.email, "Inició sesión exitosamente", locationData, \{\}, req, req\);/,
    `await registrarLog(usuario.email, "Inició sesión exitosamente", locationData, usuario.negocio._id);`
);

// Also need to patch all other registrarLog calls to include negocioId from req.session if available
serverCode = serverCode.replace(
    /await registrarLog\(req\.session\.email, `([^`]+)`\);/g,
    `await registrarLog(req.session.email, \`$1\`, {}, req.session.negocioId);`
);

// and for faqs, or where it's not a template literal
serverCode = serverCode.replace(
    /await registrarLog\(req\.session\.email, "Añadió nueva FAQ"\);/g,
    `await registrarLog(req.session.email, "Añadió nueva FAQ", {}, req.session.negocioId);`
);

fs.writeFileSync('server.js', serverCode);
console.log('Logging patched');
