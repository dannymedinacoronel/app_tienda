const fs = require('fs');

let serverCode = fs.readFileSync('server.js', 'utf8');

serverCode = serverCode.replace(
    /await registrarLog\(emailUsuario, "Cerró sesión en el sistema", locationData\);/,
    `await registrarLog(emailUsuario, "Cerró sesión en el sistema", locationData, req.session.negocioId);`
);

fs.writeFileSync('server.js', serverCode);
console.log('Logout logging patched');
