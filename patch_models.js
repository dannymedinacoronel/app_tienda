const fs = require('fs');

let serverCode = fs.readFileSync('server.js', 'utf8');

const negocioModel = `
const NegocioSchema = new mongoose.Schema({
    nombre: { type: String, required: true },
    plan: { type: String, default: 'free' },
    fechaCreacion: { type: Date, default: Date.now }
});
const Negocio = mongoose.model('Negocio', NegocioSchema);
`;

serverCode = serverCode.replace(
    /const TiendaSchema = new mongoose\.Schema\(\{/,
    `${negocioModel}\nconst TiendaSchema = new mongoose.Schema({\n    negocio: { type: mongoose.Schema.Types.ObjectId, ref: 'Negocio' },`
);

serverCode = serverCode.replace(
    /const UsuarioAutorizadoSchema = new mongoose\.Schema\(\{/,
    `const UsuarioAutorizadoSchema = new mongoose.Schema({\n    negocio: { type: mongoose.Schema.Types.ObjectId, ref: 'Negocio' },\n    rol: { type: String, enum: ['Admin', 'Manager', 'Editor', 'Employee', 'Lector', 'Accountant'], default: 'Admin' },`
);

const schemas = [
    'CategoriaSchema', 'ClienteSchema', 'GastoSchema',
    'EstadoKanbanSchema', 'VentaRopaSchema', 'LogAuditoriaSchema',
    'TareaSchema', 'FaqSchema', 'NotaSchema'
];

schemas.forEach(schemaName => {
    const regex = new RegExp(`const ${schemaName} = new mongoose\\.Schema\\(\\{`);
    serverCode = serverCode.replace(
        regex,
        `const ${schemaName} = new mongoose.Schema({\n    negocio: { type: mongoose.Schema.Types.ObjectId, ref: 'Negocio' },`
    );
});

fs.writeFileSync('server.js', serverCode);
console.log('Models patched');
