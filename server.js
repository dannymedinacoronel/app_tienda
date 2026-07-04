require('dotenv').config(); 
const express = require('express');
const { OAuth2Client } = require('google-auth-library'); 
const session = require('express-session'); 
const MongoStore = require('connect-mongo').default; // Corregido para manejar el export por defecto
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer');
const http = require('http');
const { Server } = require('socket.io');
const { scrapeMonopolio } = require('./scripts/scraper-engine');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
global.io = io; // Para que sea accesible en cualquier ruta

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
if (!GOOGLE_CLIENT_ID) {
    console.error('\x1b[33m[WARN]\x1b[0m GOOGLE_CLIENT_ID no está definido. El login fallará.');
}
const client = new OAuth2Client(GOOGLE_CLIENT_ID);
const isProd = process.env.NODE_ENV === 'production';
const EMPRESA_DEFAULT = String(process.env.APP_EMPRESA_DEFAULT || 'seychelles').trim().toLowerCase();
console.log(`[INIT] Modo: ${isProd ? 'PROD' : 'DEV'}`);

// Es vital para que las sesiones funcionen en plataformas como Render/Heroku
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 🔒 CONEXIÓN DEPURADA: Purgadas las credenciales del código fuente
const MONGO_URI_FINAL = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!MONGO_URI_FINAL) {
    console.error('\x1b[31m[ERROR]\x1b[0m No se detectó la variable MONGODB_URI en el entorno.');
}

// Función de soporte para evitar errores al notificar actualizaciones en clientes
function notificarCambio() {
    // Placeholder preparado para usar WebSockets en el futuro
}

function normalizarEmpresa(empresa) {
    return String(empresa || EMPRESA_DEFAULT)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .slice(0, 60) || EMPRESA_DEFAULT;
}

function normalizarUrlObjetivo(rawUrl) {
    const raw = String(rawUrl || '').trim();
    if (!raw) return '';
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
        const u = new URL(withProtocol);
        u.hash = '';
        u.search = '';
        u.pathname = u.pathname.replace(/\/+$/, '');
        return u.toString();
    } catch (_) {
        return withProtocol.replace(/\/+$/, '');
    }
}

function sugerirAliasDesdeUrl(url) {
    const txt = String(url || 'Competidor').trim();
    const match = txt.match(/\/member\/\d+-([a-z0-9_-]+)/i);
    if (match && match[1]) {
        return match[1].replace(/[-_]+/g, ' ').slice(0, 80);
    }
    return txt.slice(0, 80) || 'Competidor';
}

function escapeRegexSafe(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function dispararWorkflowGithub({ workflowFile, inputs, logTag = 'SCRAPER' }) {
    const GITHUB_PAT = process.env.GITHUB_PAT;
    const REPO_OWNER = process.env.GITHUB_OWNER || 'dannymedinacoronel';
    const REPO_NAME = process.env.GITHUB_REPO || 'app_tienda';

    if (!GITHUB_PAT) {
        throw new Error('Falta configurar GITHUB_PAT en Render para lanzar el scraper remoto.');
    }
    if (!REPO_OWNER || !REPO_NAME) {
        throw new Error('Falta configurar GITHUB_OWNER o GITHUB_REPO en Render.');
    }

    const endpoint = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${workflowFile}/dispatches`;
    console.log(`[${logTag}] Dispatch workflow=${workflowFile}`);

    await axios.post(
        endpoint,
        { ref: 'main', inputs },
        {
            headers: {
                'Authorization': `token ${GITHUB_PAT}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        }
    );
}

async function lanzarScraperUnificadoGithub({
    mode,
    targetUrl,
    empresa,
    alias,
    webhookPath,
    logTag = 'SCRAPER-UNIFIED'
}) {
    const modeNormalizado = String(mode || 'manual').trim().toLowerCase() === 'monopolio' ? 'monopolio' : 'manual';
    const urlNormalizada = normalizarUrlObjetivo(targetUrl);
    const aliasNormalizado = String(alias || '').trim() || sugerirAliasDesdeUrl(urlNormalizada);

    await dispararWorkflowGithub({
        workflowFile: 'vinted-scraper.yml',
        inputs: {
            mode: modeNormalizado,
            target_url: urlNormalizada,
            empresa,
            alias: aliasNormalizado,
            webhook_path: webhookPath || (modeNormalizado === 'monopolio' ? '/api/monopolio/webhook-github' : '/api/scraper/webhook-github')
        },
        logTag
    });
}

const KPI_CACHE_TTL_MS = Math.max(10000, Math.min(parseInt(process.env.KPI_CACHE_TTL_MS, 10) || 15000, 20000));
const kpiResumenCache = new Map();
const LOGS_CACHE_TTL_MS = Math.max(5000, Math.min(parseInt(process.env.LOGS_CACHE_TTL_MS, 10) || 8000, 15000));
const logsResumenCache = new Map();

function getKpiResumenCache(empresa) {
    const key = normalizarEmpresa(empresa);
    const hit = kpiResumenCache.get(key);
    if (!hit) return null;
    if ((Date.now() - hit.ts) > KPI_CACHE_TTL_MS) {
        kpiResumenCache.delete(key);
        return null;
    }
    return hit.value;
}

function setKpiResumenCache(empresa, value) {
    const key = normalizarEmpresa(empresa);
    kpiResumenCache.set(key, { ts: Date.now(), value });
}

function invalidateKpiResumenCache(empresa) {
    const key = normalizarEmpresa(empresa);
    kpiResumenCache.delete(key);
}

function getLogsResumenCache(empresa) {
    const key = normalizarEmpresa(empresa);
    const hit = logsResumenCache.get(key);
    if (!hit) return null;
    if ((Date.now() - hit.ts) > LOGS_CACHE_TTL_MS) {
        logsResumenCache.delete(key);
        return null;
    }
    return hit.value;
}

function setLogsResumenCache(empresa, value) {
    const key = normalizarEmpresa(empresa);
    logsResumenCache.set(key, { ts: Date.now(), value });
}

// --- Modelos de MongoDB ---

const TiendaSchema = new mongoose.Schema({
    nombre: { type: String, required: true, trim: true },
    empresa: { type: String, default: EMPRESA_DEFAULT, trim: true, lowercase: true },
    fechaCreacion: { type: Date, default: Date.now }
});
TiendaSchema.index({ empresa: 1, nombre: 1 }, { unique: true });
const Tienda = mongoose.models.Tienda || mongoose.model('Tienda', TiendaSchema);

const CategoriaSchema = new mongoose.Schema({
    nombre: { type: String, required: true, trim: true },
    empresa: { type: String, default: EMPRESA_DEFAULT, trim: true, lowercase: true }
});
CategoriaSchema.index({ empresa: 1, nombre: 1 }, { unique: true });
const Categoria = mongoose.models.Categoria || mongoose.model('Categoria', CategoriaSchema);

const ClienteSchema = new mongoose.Schema({
    nombre: { type: String, required: true, trim: true },
    empresa: { type: String, default: EMPRESA_DEFAULT, trim: true, lowercase: true },
    nif: { type: String, trim: true },
    email: { type: String, trim: true },
    telefono: { type: String, trim: true },
    direccion: { type: String, trim: true },
    comentarios: { type: String, default: '', trim: true },
    reservas: [{ 
        fecha: { type: Date },
        nota: { type: String, trim: true }
    }],
    fechaRegistro: { type: Date, default: Date.now }
});
const Cliente = mongoose.models.Cliente || mongoose.model('Cliente', ClienteSchema);

const CitaSchema = new mongoose.Schema({
    empresa: { type: String, default: EMPRESA_DEFAULT, trim: true, lowercase: true, index: true },
    nombre: { type: String, required: true, trim: true },
    apellidos: { type: String, default: '', trim: true },
    telefono: { type: String, required: true, trim: true },
    email: { type: String, default: '', trim: true, lowercase: true },
    servicio: { type: String, default: '', trim: true },
    fechaDia: { type: String, required: true, trim: true },
    hora: { type: String, required: true, trim: true },
    asesorEmail: { type: String, required: true, trim: true, lowercase: true },
    asesorNombre: { type: String, default: '', trim: true },
    estado: { type: String, enum: ['Pendiente', 'Confirmada', 'En curso', 'Completada', 'Cancelada'], default: 'Pendiente' },
    notasCliente: { type: String, default: '', trim: true, maxlength: 2000 },
    notasInternas: { type: String, default: '', trim: true, maxlength: 2000 },
    creadoEn: { type: Date, default: Date.now },
    actualizadoEn: { type: Date, default: Date.now }
});
CitaSchema.index({ empresa: 1, fechaDia: 1, hora: 1, asesorEmail: 1, estado: 1 });
const Cita = mongoose.models.Cita || mongoose.model('Cita', CitaSchema);

const GastoSchema = new mongoose.Schema({
    fecha: { type: String, default: () => new Date().toISOString().split('T')[0] },
    empresa: { type: String, default: EMPRESA_DEFAULT, trim: true, lowercase: true },
    concepto: { type: String, required: true },
    monto: { type: Number, required: true },
    categoria: { type: String, default: 'General' }
});
const Gasto = mongoose.models.Gasto || mongoose.model('Gasto', GastoSchema);

const EstadoKanbanSchema = new mongoose.Schema({
    nombre: { type: String, required: true, trim: true },
    empresa: { type: String, default: EMPRESA_DEFAULT, trim: true, lowercase: true },
    icono: { type: String, default: '📦' },
    color: { type: String, default: 'slate' },
    rolFinanciero: { type: String, enum: ['Stock', 'Venta', 'Oculto'], default: 'Stock' },
    orden: { type: Number, default: 0 }
});
EstadoKanbanSchema.index({ empresa: 1, nombre: 1 }, { unique: true });
const EstadoKanban = mongoose.models.EstadoKanban || mongoose.model('EstadoKanban', EstadoKanbanSchema);

const VentaRopaSchema = new mongoose.Schema({
    fecha: { type: String, default: () => new Date().toISOString().split('T')[0] },
    empresa: { type: String, default: EMPRESA_DEFAULT, trim: true, lowercase: true },
    fechaModificacion: { type: String, default: '' },
    sku: { type: String, default: '', trim: true },
    prenda: { type: String, default: 'Artículo Escaneado', trim: true },
    categoria: { type: String, default: 'Camisetas' },
    talla: { type: String, default: 'M' },
    marca: { type: String, default: '', trim: true },
    condicion: { type: String, default: '', trim: true },
    popularidad: { type: Number, default: 0 },
    cantidad: { type: Number, default: 1 },
    precioCompra: { type: Number, default: 0 },
    precioVenta: { type: Number, default: 0 },
    gastosEnvio: { type: Number, default: 0 }, 
    canalVenta: { type: String, enum: ['Tienda Física', 'Vinted', 'Wallapop', 'Web'], default: 'Tienda Física' }, 
    rating: { type: Number, default: 0, min: 0, max: 5 },
    estado: { type: String, default: 'No Vendido' },
    comentariosProducto: { type: String, default: '', trim: true },
    tienda: { type: mongoose.Schema.Types.ObjectId, ref: 'Tienda' },
    imagen: { type: String, default: '' },
    galeria: { type: [String], default: [] },
    fechaVenta: { type: String, default: '' },
    facturado: { type: Boolean, default: false },
    cliente: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente' }
});
const VentaRopa = mongoose.models.VentaRopa || mongoose.model('VentaRopa', VentaRopaSchema);

const LogAuditoriaSchema = new mongoose.Schema({
    fechaHora: { type: Date, default: Date.now },
    empresa: { type: String, default: EMPRESA_DEFAULT, trim: true, lowercase: true },
    usuario: { type: String, required: true },
    accion: { type: String, required: true },
    ip: { type: String },
    ciudad: { type: String },
    pais: { type: String },
    lat: { type: Number },
    lon: { type: Number }
});
LogAuditoriaSchema.index({ fechaHora: -1 });
LogAuditoriaSchema.index({ usuario: 1, fechaHora: -1 });
LogAuditoriaSchema.index({ lat: 1, lon: 1, fechaHora: -1 });
const LogAuditoria = mongoose.models.LogAuditoria || mongoose.model('LogAuditoria', LogAuditoriaSchema);

const TareaSchema = new mongoose.Schema({
    titulo: { type: String, required: true, trim: true },
    empresa: { type: String, default: EMPRESA_DEFAULT, trim: true, lowercase: true },
    descripcion: { type: String, default: '', trim: true },
    estado: { type: String, enum: ['Pendiente', 'En Proceso', 'Completada'], default: 'Pendiente' },
    prioridad: { type: String, enum: ['Baja', 'Media', 'Alta'], default: 'Media' },
    fechaVencimiento: { type: String, default: '' },
    fechaCreacion: { type: Date, default: Date.now }
});
const Tarea = mongoose.models.Tarea || mongoose.model('Tarea', TareaSchema);

const FaqSchema = new mongoose.Schema({
    pregunta: { type: String, required: true, trim: true },
    empresa: { type: String, default: EMPRESA_DEFAULT, trim: true, lowercase: true },
    respuesta: { type: String, required: true, trim: true },
    fechaCreacion: { type: Date, default: Date.now }
});
const Faq = mongoose.models.Faq || mongoose.model('Faq', FaqSchema);

const NotaSchema = new mongoose.Schema({
    texto: { type: String, default: 'Nueva nota...', trim: true },
    empresa: { type: String, default: EMPRESA_DEFAULT, trim: true, lowercase: true },
    color: { type: String, default: 'bg-yellow-400' },
    x: { type: Number, default: 20 },
    y: { type: Number, default: 40 },
    width: { type: Number, default: 150 },
    height: { type: Number, default: 120 },
    usuario: String,
    fecha: { type: Date, default: Date.now }
});
const Nota = mongoose.models.Nota || mongoose.model('Nota', NotaSchema);

const NegocioSchema = new mongoose.Schema({
    nombre: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    ownerEmail: { type: String, required: true, lowercase: true, trim: true },
    fechaCreacion: { type: Date, default: Date.now }
});
const Negocio = mongoose.models.Negocio || mongoose.model('Negocio', NegocioSchema);

const UsuarioAutorizadoSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    rol: { type: String, enum: ['Admin', 'Editor', 'Visualizador', 'Lector'], default: 'Editor' },
    empresa: { type: String, default: EMPRESA_DEFAULT, trim: true, lowercase: true },
    nombreVisible: { type: String, default: '', trim: true },
    fotoPerfil: { type: String, default: '' },
    fechaAgregado: { type: Date, default: Date.now },
    ultimaConexion: { type: Date }
});
const UsuarioAutorizado = mongoose.models.UsuarioAutorizado || mongoose.model('UsuarioAutorizado', UsuarioAutorizadoSchema);

const MensajeInternoSchema = new mongoose.Schema({
    empresa: { type: String, required: true, default: EMPRESA_DEFAULT, lowercase: true, trim: true },
    deEmail: { type: String, required: true, lowercase: true, trim: true },
    paraEmail: { type: String, required: true, lowercase: true, trim: true },
    texto: { type: String, required: true, trim: true, maxlength: 4000 },
    leido: { type: Boolean, default: false },
    creadoEn: { type: Date, default: Date.now }
});
MensajeInternoSchema.index({ empresa: 1, deEmail: 1, paraEmail: 1, creadoEn: -1 });
MensajeInternoSchema.index({ empresa: 1, paraEmail: 1, leido: 1, creadoEn: -1 });
const MensajeInterno = mongoose.models.MensajeInterno || mongoose.model('MensajeInterno', MensajeInternoSchema);

const MonopolioUrlSchema = new mongoose.Schema({
    empresa: { type: String, required: true, trim: true, lowercase: true, index: true },
    url: { type: String, required: true, trim: true },
    alias: { type: String, trim: true },
    lastScraped: { type: Date },
    createdAt: { type: Date, default: Date.now }
});
MonopolioUrlSchema.index({ empresa: 1, url: 1 }, { unique: true });
const MonopolioUrl = mongoose.models.MonopolioUrl || mongoose.model('MonopolioUrl', MonopolioUrlSchema);

const UI_SECTION_KEYS = [
    'sec-inventario',
    'sec-tareas',
    'sec-monopolio',
    'sec-analitica',
    'sec-higiene',
    'sec-notas',
    'sec-crm',
    'sec-citas',
    'sec-usuarios',
    'sec-gestion',
    'sec-faqs',
    'sec-auditoria',
    'sec-ajustes'
];

const UiGodConfigSchema = new mongoose.Schema({
    empresa: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
    sectionOrder: { type: [String], default: UI_SECTION_KEYS },
    hiddenSections: { type: [String], default: [] },
    tabLabels: { type: Object, default: {} },
    theme: {
        navBackground: { type: String, default: '#0f172a' },
        cardBackground: { type: String, default: '#111827' },
        accent: { type: String, default: '#6366f1' },
        textPrimary: { type: String, default: '#e2e8f0' }
    },
    customCss: { type: String, default: '' },
    updatedBy: { type: String, default: '' },
    updatedAt: { type: Date, default: Date.now }
});
const UiGodConfig = mongoose.models.UiGodConfig || mongoose.model('UiGodConfig', UiGodConfigSchema);

const UiGodUserAccessSchema = new mongoose.Schema({
    empresa: { type: String, required: true, trim: true, lowercase: true, index: true },
    userEmail: { type: String, required: true, trim: true, lowercase: true, index: true },
    blockedSections: { type: [String], default: [] },
    updatedBy: { type: String, default: '' },
    updatedAt: { type: Date, default: Date.now }
});
UiGodUserAccessSchema.index({ empresa: 1, userEmail: 1 }, { unique: true });
const UiGodUserAccess = mongoose.models.UiGodUserAccess || mongoose.model('UiGodUserAccess', UiGodUserAccessSchema);

function normalizarSeccionesInput(lista) {
    const inList = Array.isArray(lista) ? lista : [];
    const dedupe = new Set();
    const out = [];
    for (const raw of inList) {
        const sec = String(raw || '').trim();
        if (!UI_SECTION_KEYS.includes(sec)) continue;
        if (dedupe.has(sec)) continue;
        dedupe.add(sec);
        out.push(sec);
    }
    return out;
}

function normalizarOrdenSecciones(lista) {
    const parsed = normalizarSeccionesInput(lista);
    const faltantes = UI_SECTION_KEYS.filter(sec => !parsed.includes(sec));
    return [...parsed, ...faltantes];
}

function esColorHexValido(valor, fallback) {
    const v = String(valor || '').trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}

function limpiarTabLabels(labels) {
    const raw = labels && typeof labels === 'object' ? labels : {};
    const out = {};
    UI_SECTION_KEYS.forEach((sec) => {
        if (raw[sec] === undefined || raw[sec] === null) return;
        out[sec] = String(raw[sec]).trim().slice(0, 40);
    });
    return out;
}

const ADMIN_WHITELIST = (process.env.ADMIN_WHITELIST || 'dannymedinacoronel@gmail.com,juliamugo2001@gmail.com').split(',').map(e => e.trim().toLowerCase());

function normalizarClaveTexto(valor) {
    return String(valor || '').trim().toLowerCase();
}

async function obtenerProveedoresSinTienda(empresa) {
    const [proveedoresRaw, tiendasRaw] = await Promise.all([
        VentaRopa.distinct('proveedor', { empresa, proveedor: { $exists: true, $ne: '' } }),
        Tienda.distinct('nombre', { empresa })
    ]);

    const tiendasSet = new Set((tiendasRaw || []).map(normalizarClaveTexto).filter(Boolean));
    const faltantesMap = new Map();

    (proveedoresRaw || []).forEach((nombre) => {
        const limpio = String(nombre || '').trim();
        const key = normalizarClaveTexto(limpio);
        if (!key || tiendasSet.has(key)) return;
        if (!faltantesMap.has(key)) faltantesMap.set(key, limpio);
    });

    return Array.from(faltantesMap.values()).sort((a, b) => a.localeCompare(b, 'es'));
}

async function obtenerCategoriasSinCatalogo(empresa) {
    const [categoriasRaw, catalogoRaw] = await Promise.all([
        VentaRopa.distinct('categoria', { empresa, categoria: { $exists: true, $ne: '' } }),
        Categoria.distinct('nombre', { empresa })
    ]);

    const catalogoSet = new Set((catalogoRaw || []).map(normalizarClaveTexto).filter(Boolean));
    const faltantesMap = new Map();

    (categoriasRaw || []).forEach((nombre) => {
        const limpio = String(nombre || '').trim();
        const key = normalizarClaveTexto(limpio);
        if (!key || catalogoSet.has(key)) return;
        if (!faltantesMap.has(key)) faltantesMap.set(key, limpio);
    });

    return Array.from(faltantesMap.values()).sort((a, b) => a.localeCompare(b, 'es'));
}

async function generarReporteHigiene(empresa, sampleLimit = 25) {
    const limit = Math.max(5, Math.min(Number(sampleLimit) || 25, 100));

    const [estados, tiendasRaw, categoriasRaw] = await Promise.all([
        EstadoKanban.find({ empresa }).select('nombre rolFinanciero').lean(),
        Tienda.distinct('nombre', { empresa }),
        Categoria.distinct('nombre', { empresa })
    ]);

    const estadosValidos = (estados || []).map((e) => String(e.nombre || '').trim()).filter(Boolean);
    const tiendasSet = new Set((tiendasRaw || []).map(normalizarClaveTexto).filter(Boolean));
    const categoriasSet = new Set((categoriasRaw || []).map(normalizarClaveTexto).filter(Boolean));

    const queryEstadoInvalido = estadosValidos.length
        ? { empresa, estado: { $nin: estadosValidos } }
        : { empresa };

    const [estadosInvalidosCount, estadosInvalidosSample] = await Promise.all([
        VentaRopa.countDocuments(queryEstadoInvalido),
        VentaRopa.find(queryEstadoInvalido)
            .select('_id prenda estado proveedor categoria fecha')
            .sort({ fecha: -1, _id: -1 })
            .limit(limit)
            .lean()
    ]);

    const [incompletosCount, incompletosSample] = await Promise.all([
        VentaRopa.countDocuments({
            empresa,
            $or: [
                { prenda: { $in: ['', null] } },
                { categoria: { $in: ['', null] } },
                { talla: { $in: ['', null] } }
            ]
        }),
        VentaRopa.find({
            empresa,
            $or: [
                { prenda: { $in: ['', null] } },
                { categoria: { $in: ['', null] } },
                { talla: { $in: ['', null] } }
            ]
        })
            .select('_id prenda categoria talla estado proveedor fecha')
            .sort({ fecha: -1, _id: -1 })
            .limit(limit)
            .lean()
    ]);

    const proveedoresHuerfanos = await VentaRopa.aggregate([
        { $match: { empresa, proveedor: { $type: 'string', $ne: '' } } },
        { $addFields: { proveedorNorm: { $toLower: { $trim: { input: '$proveedor' } } } } },
        { $match: { proveedorNorm: { $nin: Array.from(tiendasSet) } } },
        {
            $group: {
                _id: '$proveedorNorm',
                proveedor: { $first: '$proveedor' },
                cantidad: { $sum: 1 },
                ejemploVentaId: { $first: '$_id' },
                ejemploPrenda: { $first: '$prenda' }
            }
        },
        { $sort: { cantidad: -1 } },
        { $limit: limit }
    ]);

    const categoriasHuerfanas = await VentaRopa.aggregate([
        { $match: { empresa, categoria: { $type: 'string', $ne: '' } } },
        { $addFields: { categoriaNorm: { $toLower: { $trim: { input: '$categoria' } } } } },
        { $match: { categoriaNorm: { $nin: Array.from(categoriasSet) } } },
        {
            $group: {
                _id: '$categoriaNorm',
                categoria: { $first: '$categoria' },
                cantidad: { $sum: 1 },
                ejemploVentaId: { $first: '$_id' },
                ejemploPrenda: { $first: '$prenda' }
            }
        },
        { $sort: { cantidad: -1 } },
        { $limit: limit }
    ]);

    const duplicadosTop = await VentaRopa.aggregate([
        { $match: { empresa } },
        {
            $addFields: {
                prendaNorm: { $toLower: { $trim: { input: { $ifNull: ['$prenda', ''] } } } },
                proveedorNorm: { $toLower: { $trim: { input: { $ifNull: ['$proveedor', ''] } } } },
                tallaNorm: { $toLower: { $trim: { input: { $ifNull: ['$talla', ''] } } } },
                categoriaNorm: { $toLower: { $trim: { input: { $ifNull: ['$categoria', ''] } } } }
            }
        },
        {
            $group: {
                _id: {
                    prenda: '$prendaNorm',
                    proveedor: '$proveedorNorm',
                    talla: '$tallaNorm',
                    categoria: '$categoriaNorm'
                },
                count: { $sum: 1 },
                ejemploPrenda: { $first: '$prenda' },
                ejemploProveedor: { $first: '$proveedor' },
                ejemploCategoria: { $first: '$categoria' },
                ejemploTalla: { $first: '$talla' }
            }
        },
        {
            $match: {
                count: { $gt: 1 },
                '_id.prenda': { $ne: '' }
            }
        },
        { $sort: { count: -1 } },
        { $limit: limit }
    ]);

    const duplicadosTotales = await VentaRopa.aggregate([
        { $match: { empresa } },
        {
            $addFields: {
                prendaNorm: { $toLower: { $trim: { input: { $ifNull: ['$prenda', ''] } } } },
                proveedorNorm: { $toLower: { $trim: { input: { $ifNull: ['$proveedor', ''] } } } },
                tallaNorm: { $toLower: { $trim: { input: { $ifNull: ['$talla', ''] } } } },
                categoriaNorm: { $toLower: { $trim: { input: { $ifNull: ['$categoria', ''] } } } }
            }
        },
        {
            $group: {
                _id: {
                    prenda: '$prendaNorm',
                    proveedor: '$proveedorNorm',
                    talla: '$tallaNorm',
                    categoria: '$categoriaNorm'
                },
                count: { $sum: 1 }
            }
        },
        {
            $match: {
                count: { $gt: 1 },
                '_id.prenda': { $ne: '' }
            }
        },
        {
            $group: {
                _id: null,
                grupos: { $sum: 1 },
                extras: { $sum: { $subtract: ['$count', 1] } }
            }
        }
    ]);

    const dupResumen = duplicadosTotales[0] || { grupos: 0, extras: 0 };

    return {
        empresa,
        generadoEn: new Date(),
        catalogos: {
            tiendas: (tiendasRaw || []).map((x) => String(x || '').trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, 'es')),
            categorias: (categoriasRaw || []).map((x) => String(x || '').trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, 'es'))
        },
        resumen: {
            estadosInvalidos: estadosInvalidosCount,
            incompletos: incompletosCount,
            proveedoresHuerfanos: proveedoresHuerfanos.reduce((acc, it) => acc + Number(it.cantidad || 0), 0),
            categoriasHuerfanas: categoriasHuerfanas.reduce((acc, it) => acc + Number(it.cantidad || 0), 0),
            duplicadosGrupos: Number(dupResumen.grupos || 0),
            duplicadosExtras: Number(dupResumen.extras || 0)
        },
        detalles: {
            estadosInvalidos: estadosInvalidosSample,
            productosIncompletos: incompletosSample,
            proveedoresHuerfanos,
            categoriasHuerfanas,
            duplicadosFirma: duplicadosTop
        }
    };
}

io.on('connection', (socket) => {
    socket.on('join_empresa', (empresa) => {
        const room = `empresa:${normalizarEmpresa(empresa)}`;
        socket.join(room);
    });
});

mongoose.connect(MONGO_URI_FINAL)
    .then(async () => {
        console.log('\x1b[32m[OK]\x1b[0m Core Estable de Seychelles conectado a MongoDB Atlas.');
        
        // Migrar whitelist inicial si la base de datos está vacía
        const countUsers = await UsuarioAutorizado.countDocuments();
        if (countUsers === 0) {
            const initialEmails = (process.env.ADMIN_WHITELIST || 'dannymedinacoronel@gmail.com,juliamugo2001@gmail.com').split(',').map(e => e.trim().toLowerCase()).filter(e => e);
            await UsuarioAutorizado.insertMany(initialEmails.map(e => ({ email: e, empresa: EMPRESA_DEFAULT })));
            console.log('[INIT] Whitelist inicial migrada a MongoDB.');
        }

        await UsuarioAutorizado.updateMany(
            { $or: [{ empresa: { $exists: false } }, { empresa: '' }, { empresa: null }] },
            { $set: { empresa: EMPRESA_DEFAULT } }
        );
        await Promise.all([
            Tienda.updateMany({ $or: [{ empresa: { $exists: false } }, { empresa: '' }, { empresa: null }] }, { $set: { empresa: EMPRESA_DEFAULT } }),
            Categoria.updateMany({ $or: [{ empresa: { $exists: false } }, { empresa: '' }, { empresa: null }] }, { $set: { empresa: EMPRESA_DEFAULT } }),
            EstadoKanban.updateMany({ $or: [{ empresa: { $exists: false } }, { empresa: '' }, { empresa: null }] }, { $set: { empresa: EMPRESA_DEFAULT } }),
            VentaRopa.updateMany({ $or: [{ empresa: { $exists: false } }, { empresa: '' }, { empresa: null }] }, { $set: { empresa: EMPRESA_DEFAULT } }),
            Cliente.updateMany({ $or: [{ empresa: { $exists: false } }, { empresa: '' }, { empresa: null }] }, { $set: { empresa: EMPRESA_DEFAULT } }),
            Gasto.updateMany({ $or: [{ empresa: { $exists: false } }, { empresa: '' }, { empresa: null }] }, { $set: { empresa: EMPRESA_DEFAULT } }),
            Nota.updateMany({ $or: [{ empresa: { $exists: false } }, { empresa: '' }, { empresa: null }] }, { $set: { empresa: EMPRESA_DEFAULT } }),
            Tarea.updateMany({ $or: [{ empresa: { $exists: false } }, { empresa: '' }, { empresa: null }] }, { $set: { empresa: EMPRESA_DEFAULT } }),
            Faq.updateMany({ $or: [{ empresa: { $exists: false } }, { empresa: '' }, { empresa: null }] }, { $set: { empresa: EMPRESA_DEFAULT } }),
            LogAuditoria.updateMany({ $or: [{ empresa: { $exists: false } }, { empresa: '' }, { empresa: null }] }, { $set: { empresa: EMPRESA_DEFAULT } }),
            MensajeInterno.updateMany({ $or: [{ empresa: { $exists: false } }, { empresa: '' }, { empresa: null }] }, { $set: { empresa: EMPRESA_DEFAULT } }),
            MonopolioUrl.updateMany({ $or: [{ empresa: { $exists: false } }, { empresa: '' }, { empresa: null }] }, { $set: { empresa: EMPRESA_DEFAULT } })
        ]);

        const negocioBase = await Negocio.findOne({ slug: EMPRESA_DEFAULT }).lean();
        if (!negocioBase) {
            await Negocio.create({ nombre: 'Seychelles', slug: EMPRESA_DEFAULT, ownerEmail: ADMIN_WHITELIST[0] || 'owner@local' });
        }
        
        // Auto-poblar tiendas si la colección está vacía
        const tiendaCount = await Tienda.countDocuments();
        if (tiendaCount === 0) {
            await Tienda.insertMany([{ nombre: 'seyshelleshop' }, { nombre: 'Vinted' }]);
            console.log('[INIT] Tiendas base inyectadas.');
        }

        // Auto-poblar categorías si la colección está vacía
        const catCount = await Categoria.countDocuments();
        if (catCount === 0) {
            const defaultCats = [
                '👕 Camisetas', '🧥 Sudaderas', '👖 Pantalones', '👗 Vestidos', '👜 Accesorios',
                '🩳 Shorts', '👗 Faldas', '🧥 Chaquetas', '🧥 Abrigos', '👟 Zapatos',
                '👟 Zapatillas', '👙 Ropa Interior', '🩱 Bañadores', '🧢 Gorras', '👒 Sombreros',
                '💍 Joyas', '👛 Bolsos', '👔 Camisas', '👚 Blusas', '👕 Tops', '🩳 Bermudas',
                '👖 Leggings', '🧥 Trajes', '💤 Pijamas', '🧣 Bufandas', '🧤 Guantes',
                '🎗️ Cinturones', '🧦 Calcetines', '⌚ Relojes', '🕶️ Gafas de sol', '👛 Monederos',
                '👕 Polos', '🧥 Chalecos', '🥾 Botas', '👡 Sandalias', '🥋 Albornoces',
                '👔 Corbatas', '🎀 Pajaritas', '🧣 Pañuelos', '🎒 Mochilas', '👜 Bolsos de mano',
                '👖 Vaqueros', '🧥 Rebecas', '👕 Jerséis', '🏃 Ropa Deportiva', '🧘 Leggings Deportivos',
                '🩱 Bikinis', '🧤 Mitones', '👒 Tocados', '👞 Mocasines', '👢 Botines', '🧤 Calentadores',
                '👗 Monos', '👗 Petos', '👘 Kimonos', '🧥 Parkas', '🧥 Gabardinas', '🎿 Ropa de Esquí'
            ];
            try {
                await Categoria.insertMany(defaultCats.map(n => ({ nombre: n })));
                console.log('[INIT] Catálogo maestro de categorías inyectado correctamente.');
            } catch (err) {
                console.error("Error inyectando categorías iniciales:", err);
            }
        }
        
        // Auto-poblar FAQs predeterminadas si está vacío
        const faqCount = await Faq.countDocuments();
        if (faqCount === 0) {
            await Faq.insertMany([
                { pregunta: "🔄 ¿Cómo muevo un producto a 'Vendido'?", respuesta: "Puedes arrastrar la tarjeta del producto hacia la columna 'VENTAS' en el Kanban principal, o editar el producto haciendo click en el botón azul de 'Editar' y cambiar su estado." },
                { pregunta: "⚡ ¿Cómo aplico acciones masivas?", respuesta: "Selecciona las casillas redondas de varios artículos en el Kanban para desplegar el 'Panel Flotante Oscuro' abajo. Desde ahí podrás ajustar precios o estados en lote." },
                { pregunta: "📷 ¿Para qué sirve el escáner superior?", respuesta: "Convierte la cámara de tu móvil o tablet en una pistola láser. Imprime las etiquetas con QR de tus prendas, y al escanearlas desde aquí se marcarán automáticamente como Vendidas." },
                { pregunta: "💸 Gastos Operativos vs Coste de Ropa", respuesta: "El sistema separa tu inversión en 2 bloques para darte un Beneficio Neto real: El Coste Unitario (lo que costó la prenda) y los Gastos Operativos (Alquiler, cajas, luz) que se añaden en la sección de Gastos." }
            ]);
            console.log('[INIT] FAQs predeterminadas inyectadas.');
        }
        
        // Auto-poblar Configuración Kanban si está vacío
        const estadoCount = await EstadoKanban.countDocuments();
        if (estadoCount === 0) {
            await EstadoKanban.insertMany([
                { nombre: 'No Vendido', icono: '📦', color: 'amber', rolFinanciero: 'Stock', orden: 1 },
                { nombre: 'Vendido', icono: '💰', color: 'emerald', rolFinanciero: 'Venta', orden: 2 },
                { nombre: 'Reservado', icono: '🤝', color: 'indigo', rolFinanciero: 'Stock', orden: 3 },
                { nombre: 'Devuelto', icono: '⚠️', color: 'rose', rolFinanciero: 'Oculto', orden: 4 }
            ]);
        } else {
            // Migración forzada para corregir el orden de las columnas en bases de datos que ya existían
            const estVendido = await EstadoKanban.findOne({ nombre: 'Vendido', empresa: EMPRESA_DEFAULT });
            const estReservado = await EstadoKanban.findOne({ nombre: 'Reservado', empresa: EMPRESA_DEFAULT });
            if (estVendido && estReservado && estVendido.orden > estReservado.orden) {
                await EstadoKanban.updateOne({ nombre: 'Vendido', empresa: EMPRESA_DEFAULT }, { orden: 2 });
                await EstadoKanban.updateOne({ nombre: 'Reservado', empresa: EMPRESA_DEFAULT }, { orden: 3 });
            }
        }

        // Auto-poblar Tareas predeterminadas si está vacío
        const tareaCount = await Tarea.countDocuments();
        if (tareaCount === 0) {
            await Tarea.insertMany([
                { titulo: "📦 Inventariar nueva colección", descripcion: "Subir fotos, añadir tallas y establecer el margen de beneficio en el sistema.", estado: "Pendiente", prioridad: "Alta" },
                { titulo: "📸 Actualizar catálogo online", descripcion: "Sincronizar artículos nuevos con Vinted / Wallapop usando el Scraper.", estado: "En Proceso", prioridad: "Media" },
                { titulo: "🛍️ Revisar stock de packaging", descripcion: "Comprobar si quedan suficientes cajas y bolsas de envío para esta semana.", estado: "Pendiente", prioridad: "Media" },
                { titulo: "🧾 Cuadrar contabilidad mensual", descripcion: "Exportar el Excel y revisar los Gastos Operativos (OpEx) del mes.", estado: "Completada", prioridad: "Baja" }
            ]);
            console.log('[INIT] Tareas predeterminadas inyectadas.');
        }
    })
    .catch(err => console.error('Fallo crítico en Atlas. Verifica tus variables en Render:', err));

app.use(session({
    name: 'seychelles.sid', 
    secret: process.env.SESSION_SECRET || 'clave_maestra_seychelles_987654321',
    resave: false, 
    saveUninitialized: false, 
    proxy: true, 
    store: MONGO_URI_FINAL ? MongoStore.create({ 
        mongoUrl: MONGO_URI_FINAL, 
        collectionName: 'sesiones_activas', 
        ttl: 14 * 24 * 60 * 60 
    }) : undefined,
    cookie: { 
        secure: isProd, 
        sameSite: isProd ? 'none' : 'lax', 
        maxAge: 14 * 24 * 60 * 60 * 1000 
    }
}));

app.use(express.static(path.join(__dirname, 'public'), {
    etag: true,
    lastModified: true,
    maxAge: isProd ? '7d' : 0,
    setHeaders: (res, filePath) => {
        const f = String(filePath || '').replace(/\\/g, '/').toLowerCase();
        // Evita quedarte con frontend viejo cuando hay fixes críticos en app.js/index.html
        if (f.endsWith('/index.html') || f.endsWith('/app.js')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        }
    }
}));
function empresaActual(req) {
    return normalizarEmpresa(req.session?.empresa || EMPRESA_DEFAULT);
}

function rolActual(req) {
    const email = String(req.session?.email || '').toLowerCase().trim();
    if (email && ADMIN_WHITELIST.includes(email)) return 'Admin';
    return String(req.session?.rol || 'Editor').trim();
}

function tieneRol(req, rolesPermitidos = []) {
    if (!req.session || !req.session.esAdmin) return false;
    const rol = rolActual(req);
    return Array.isArray(rolesPermitidos) && rolesPermitidos.includes(rol);
}

function exigeRol(rolesPermitidos = []) {
    return (req, res, next) => {
        if (tieneRol(req, rolesPermitidos)) return next();
        return res.status(403).json({ error: 'No autorizado para este rol.' });
    };
}

function exigeAdmin(req, res, next) {
    if (req.session && req.session.esAdmin) return next();
    return res.status(403).json({ error: 'No autorizado.' });
}

function exigeSoloAdmin(req, res, next) {
    if (tieneRol(req, ['Admin'])) return next();
    return res.status(403).json({ error: 'Solo un Admin puede realizar esta acción.' });
}

function sanitizarVentasParaRol(ventas, req) {
    const rol = rolActual(req);
    if (rol !== 'Editor' && rol !== 'Visualizador') return ventas;

    return (Array.isArray(ventas) ? ventas : []).map((v) => {
        const safe = { ...v };
        safe.precioCompra = 0;
        safe.precioVenta = 0;
        safe.gastosEnvio = 0;
        safe.fechaVenta = '';
        safe.facturado = false;
        return safe;
    });
}

function resumenSeguroPorRol(resumen, req) {
    const rol = rolActual(req);
    if (rol !== 'Editor' && rol !== 'Visualizador') return resumen;
    return {
        ingresos: 0,
        beneficio: 0,
        inversion: 0,
        prendasVendidas: Number(resumen?.prendasVendidas || 0),
        roi: 0,
        totalGastosOperativos: 0
    };
}

function logsSegurosPorRol(logs, req) {
    const rol = rolActual(req);
    if (rol !== 'Editor' && rol !== 'Visualizador') return logs;
    return [];
}

function esRolSoloLectura(req) {
    return rolActual(req) === 'Visualizador';
}

function bloquearMutacionVisualizador(req, res, next) {
    if (esRolSoloLectura(req)) {
        return res.status(403).json({ error: 'El rol Visualizador es de solo lectura.' });
    }
    return next();
}

app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    if (!req.session || !req.session.esAdmin) return next();

    const rol = rolActual(req);
    const method = String(req.method || 'GET').toUpperCase();
    const pathReq = String(req.path || '');
    const esLectura = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';

    // Visualizador: solo lectura (excepto login/logout del propio usuario).
    if (rol === 'Visualizador') {
        if (esLectura) return next();
        if (method === 'POST' && (pathReq === '/api/logout' || pathReq === '/api/auth/google')) return next();
        if (pathReq === '/api/perfil' && method === 'PUT') return next();
        return res.status(403).json({ error: 'El rol Visualizador no puede modificar datos.' });
    }

    // Editor: solo puede añadir productos y gestionar su propio perfil/sesion.
    if (rol === 'Editor') {
        if (esLectura) return next();
        if (method === 'POST' && pathReq === '/api/ventas') return next();
        if (method === 'POST' && (pathReq === '/api/logout' || pathReq === '/api/auth/google')) return next();
        if (pathReq === '/api/perfil' && method === 'PUT') return next();
        return res.status(403).json({ error: 'El rol Editor solo puede añadir productos.' });
    }

    return next();
});

async function registrarLog(usuario, accion, locationData = {}) {
    try {
        const usuarioDoc = await UsuarioAutorizado.findOne({ email: String(usuario || '').toLowerCase().trim() }).select('empresa').lean();
        const empresa = normalizarEmpresa(usuarioDoc?.empresa || EMPRESA_DEFAULT);
        const nuevoLog = new LogAuditoria({ 
            empresa,
            usuario, 
            accion,
            ...locationData
        });
        await nuevoLog.save();
    } catch (e) { console.error("Error al guardar log:", e); }
}

// --- Motor de Geolocalización Precisa (IP + HTML5) ---
async function obtenerUbicacionCompleta(req, clientLocation) {
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',').shift() || req.socket.remoteAddress;
    let locationData = { ip };

    try {
        const geoRes = await axios.get(`http://ip-api.com/json/${ip}?fields=status,message,country,city,lat,lon`);
        if (geoRes.data && geoRes.data.status === 'success') {
            locationData.ciudad = geoRes.data.city; locationData.pais = geoRes.data.country;
            locationData.lat = geoRes.data.lat; locationData.lon = geoRes.data.lon;
        }
    } catch (e) { console.warn(`[GEO-IP] Fallo al obtener localización por IP:`, e.message); }

    // Si el navegador proporcionó coordenadas exactas GPS/HTML5, las usamos y buscamos la ciudad real
    if (clientLocation && clientLocation.lat && clientLocation.lon) {
        locationData.lat = clientLocation.lat;
        locationData.lon = clientLocation.lon;
        try {
            // Búsqueda Inversa para saber a qué ciudad pertenecen las coordenadas HTML5
            const reverseGeo = await axios.get(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${clientLocation.lat}&lon=${clientLocation.lon}`, { headers: { 'User-Agent': 'Seychelles-App/1.0' } });
            if (reverseGeo.data && reverseGeo.data.address) {
                locationData.ciudad = reverseGeo.data.address.city || reverseGeo.data.address.town || reverseGeo.data.address.village || locationData.ciudad;
                locationData.pais = reverseGeo.data.address.country || locationData.pais;
            }
        } catch(e) { console.warn("[GEO-HTML5] Fallo reverse geocoding"); }
    }

    return locationData;
}

// --- Utilidades de Imagen ---
async function downloadAndConvertToBase64(url) {
    if (!url || !url.startsWith('http')) return url || '';
    try {
        const response = await axios.get(url, { 
            responseType: 'arraybuffer', 
            timeout: 8000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        });
        const contentType = response.headers['content-type'];
        const base64 = Buffer.from(response.data, 'binary').toString('base64');
        return `data:${contentType};base64,${base64}`;
    } catch (error) {
        console.error(`[IMAGE] Error descargando imagen: ${url}`, error.message);
        return url; // Retornamos la URL original si falla la conversión
    }
}

// --- Sistema de Backup Automatizado por Email ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.BACKUP_EMAIL_USER,
        pass: process.env.BACKUP_EMAIL_PASS
    },
    disableFileAccess: true,
    disableUrlAccess: true
});

async function realizarBackupDiarioEmail() {
    try {
        // Extracción total de todas las colecciones de MongoDB
        const baseDatosCompleta = {
            ventas: await VentaRopa.find().populate('tienda').lean(),
            clientes: await Cliente.find().lean(),
            gastos: await Gasto.find().lean(),
            tiendas: await Tienda.find().lean(),
            categorias: await Categoria.find().lean(),
            usuariosAutorizados: await UsuarioAutorizado.find().lean()
        };
        const backupData = JSON.stringify(baseDatosCompleta, null, 2);
        const ahora = new Date();
        const dateStr = ahora.toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');

        const fromAddress = String(process.env.BACKUP_EMAIL_USER || '').trim();
        const toAddress = 'dannymedinacoronel@gmail.com';
        if (!fromAddress || !fromAddress.includes('@')) {
            throw new Error('BACKUP_EMAIL_USER no válido para envío de backup.');
        }

        const mailOptions = {
            from: process.env.BACKUP_EMAIL_USER,
            to: toAddress,
            subject: `BACKUP_${dateStr}`,
            text: `Backup diario automático generado el ${ahora.toLocaleString('es-ES')}.`,
            attachments: [{ filename: `Backup_Seychelles_${dateStr}.json`, content: backupData }],
            disableFileAccess: true,
            disableUrlAccess: true
        };

        await transporter.sendMail(mailOptions);
        console.log(`[SYSTEM] Backup enviado a dannymedinacoronel@gmail.com: BACKUP_${dateStr}`);
    } catch (error) {
        console.error("[ERROR] Fallo en backup automático:", error.message);
    }
}

// Se ejecuta una vez al día (86400000 ms)
setInterval(realizarBackupDiarioEmail, 24 * 60 * 60 * 1000);
// También permitimos un trigger manual si fuera necesario vía ruta secreta o similar en el futuro

// --- Rutas de Categorías ---

app.get('/api/categorias', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const categorias = await Categoria.find({ empresa }).sort({ nombre: 1 }).lean();
        res.json({ categorias });
    } catch (e) { res.status(500).json({ error: 'Fallo al recuperar categorías.' }); }
});

app.post('/api/categorias', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const nombreLimpio = req.body.nombre ? req.body.nombre.trim() : "";
        if (!nombreLimpio) return res.status(400).json({ error: 'Nombre requerido.' });
        const nueva = new Categoria({ nombre: nombreLimpio, empresa });
        await nueva.save();
        await registrarLog(req.session.email, `Creó nueva categoría: ${nombreLimpio}`);
        res.json({ status: 'success', categoria: nueva });
    } catch (e) { res.status(400).json({ error: 'La categoría ya existe.' }); }
});

app.put('/api/categorias/:id', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { id } = req.params;
        const { nombre } = req.body;
        const cat = await Categoria.findOneAndUpdate({ _id: id, empresa }, { nombre }, { new: true });
        if (!cat) return res.status(404).json({ error: 'Categoría no encontrada en tu empresa.' });
        await registrarLog(req.session.email, `Modificó categoría: ${nombre}`);
        res.json(cat);
    } catch (e) { res.status(400).json({ error: 'Error al actualizar categoría.' }); }
});

app.delete('/api/categorias/:id', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { id } = req.params;
        const cat = await Categoria.findOne({ _id: id, empresa });
        if (!cat) return res.status(404).json({ error: 'No existe.' });
        await Categoria.deleteOne({ _id: id, empresa });
        await registrarLog(req.session.email, `Eliminó categoría: ${cat.nombre}`);
        res.sendStatus(200);
    } catch (e) { res.status(500).json({ error: 'Error al purgar categoría.' }); }
});

// --- Rutas de Tiendas ---

app.get('/api/tiendas', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const tiendas = await Tienda.find({ empresa }).sort({ nombre: 1 }).lean();
        res.json({ tiendas });
    } catch (e) {
        res.status(500).json({ error: 'Fallo al recuperar tiendas.' });
    }
});

app.post('/api/tiendas', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const nombreLimpio = req.body.nombre ? req.body.nombre.trim() : "";
        if (!nombreLimpio) return res.status(400).json({ error: 'El nombre es obligatorio.' });

        const nuevaTienda = new Tienda({ nombre: nombreLimpio, empresa });
        await nuevaTienda.save();
        await registrarLog(req.session.email, `Creó la tienda en MongoDB: ${nuevaTienda.nombre}`);
        res.json({ status: 'success', tienda: nuevaTienda });
    } catch (e) {
        res.status(400).json({ error: 'La tienda ya existe o hay un error de validación.' });
    }
});

// BAJA DE TIENDA
app.delete('/api/tiendas/:id', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { id } = req.params;
        
        const tiendaPorBorrar = await Tienda.findOne({ _id: id, empresa });
        if (!tiendaPorBorrar) return res.status(404).json({ error: 'La tienda no existe.' });

        // Desasignar tienda de los productos asociados
        await VentaRopa.updateMany({ tienda: id, empresa }, { $unset: { tienda: 1 } });
        await Tienda.deleteOne({ _id: id, empresa });

        await registrarLog(req.session.email, `Eliminó la tienda "${tiendaPorBorrar.nombre}".`);
        return res.sendStatus(200);
    } catch (err) {
        console.error("Error al borrar tienda:", err);
        return res.status(500).json({ error: 'Fallo crítico al purgar la tienda.' });
    }
});

// --- Rutas de Auth ---

app.post('/api/public/registrar-negocio', async (req, res) => {
    try {
        const nombreNegocio = String(req.body?.nombreNegocio || '').trim();
        const email = String(req.body?.email || '').toLowerCase().trim();
        const nombreVisible = String(req.body?.nombreVisible || '').trim().slice(0, 80);

        if (!nombreNegocio) return res.status(400).json({ error: 'El nombre del negocio es obligatorio.' });
        if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email inválido.' });

        const slug = normalizarEmpresa(nombreNegocio);
        const existeNegocio = await Negocio.findOne({ slug }).lean();
        if (existeNegocio) {
            return res.status(409).json({ error: 'Ese nombre de negocio ya está registrado. Prueba con otro nombre.' });
        }

        const existeUsuario = await UsuarioAutorizado.findOne({ email }).lean();
        if (existeUsuario) {
            return res.status(409).json({ error: 'Este email ya existe en la plataforma.' });
        }

        await Negocio.create({ nombre: nombreNegocio, slug, ownerEmail: email });
        await UsuarioAutorizado.create({ email, rol: 'Admin', empresa: slug, nombreVisible });

        // Seed mínimo por negocio para onboarding profesional.
        await Tienda.insertMany([
            { nombre: 'Principal', empresa: slug },
            { nombre: 'Vinted', empresa: slug }
        ]).catch(() => {});
        await EstadoKanban.insertMany([
            { nombre: 'No Vendido', icono: '📦', color: 'blue', rolFinanciero: 'Stock', orden: 1, empresa: slug },
            { nombre: 'Vendido', icono: '💰', color: 'emerald', rolFinanciero: 'Venta', orden: 2, empresa: slug },
            { nombre: 'Reservado', icono: '🤝', color: 'amber', rolFinanciero: 'Stock', orden: 3, empresa: slug }
        ]).catch(() => {});
        await Categoria.insertMany([
            { nombre: '👕 Camisetas', empresa: slug },
            { nombre: '🧥 Sudaderas', empresa: slug },
            { nombre: '👖 Pantalones', empresa: slug }
        ]).catch(() => {});

        return res.json({
            success: true,
            negocio: { nombre: nombreNegocio, slug },
            mensaje: 'Negocio registrado. Ahora inicia sesión con Google usando ese email para entrar a tu espacio.'
        });
    } catch (e) {
        return res.status(500).json({ error: 'No se pudo registrar el negocio.' });
    }
});

app.get('/api/public/citas/negocios', async (req, res) => {
    try {
        const negocios = await Negocio.find({}).select('nombre slug').sort({ nombre: 1 }).lean();
        res.json({ negocios });
    } catch (e) {
        res.status(500).json({ error: 'No se pudieron cargar los negocios.' });
    }
});

app.get('/api/public/citas/disponibilidad', async (req, res) => {
    try {
        const empresa = normalizarEmpresa(String(req.query?.empresa || ''));
        if (!empresa) return res.status(400).json({ error: 'Empresa requerida.' });

        const negocio = await Negocio.findOne({ slug: empresa }).select('nombre slug').lean();
        if (!negocio) return res.status(404).json({ error: 'Negocio no encontrado.' });

        const personal = await UsuarioAutorizado.find({ empresa, rol: { $in: ['Admin', 'Editor'] } })
            .select('email nombreVisible rol')
            .sort({ rol: 1, email: 1 })
            .lean();

        const asesores = personal.map(u => ({
            email: u.email,
            nombre: u.nombreVisible || u.email.split('@')[0],
            rol: u.rol || 'Editor'
        }));

        res.json({ negocio, asesores });
    } catch (e) {
        res.status(500).json({ error: 'No se pudo cargar la disponibilidad.' });
    }
});

app.post('/api/public/citas', async (req, res) => {
    try {
        const empresa = normalizarEmpresa(String(req.body?.empresa || ''));
        const nombre = String(req.body?.nombre || '').trim();
        const apellidos = String(req.body?.apellidos || '').trim();
        const telefono = String(req.body?.telefono || '').trim();
        const email = String(req.body?.email || '').trim().toLowerCase();
        const servicio = String(req.body?.servicio || '').trim();
        const fechaDia = String(req.body?.fechaDia || '').trim();
        const hora = String(req.body?.hora || '').trim();
        const asesorEmail = String(req.body?.asesorEmail || '').trim().toLowerCase();
        const notasCliente = String(req.body?.notasCliente || '').trim();

        if (!empresa) return res.status(400).json({ error: 'Empresa requerida.' });
        if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio.' });
        if (!telefono) return res.status(400).json({ error: 'El teléfono es obligatorio.' });
        if (!fechaDia || !/^\d{4}-\d{2}-\d{2}$/.test(fechaDia)) return res.status(400).json({ error: 'Fecha inválida.' });
        if (!hora || !/^\d{2}:\d{2}$/.test(hora)) return res.status(400).json({ error: 'Hora inválida.' });
        if (!asesorEmail) return res.status(400).json({ error: 'Selecciona la persona que atenderá la cita.' });

        const negocio = await Negocio.findOne({ slug: empresa }).lean();
        if (!negocio) return res.status(404).json({ error: 'Negocio no encontrado.' });

        const asesor = await UsuarioAutorizado.findOne({ email: asesorEmail, empresa }).select('email nombreVisible').lean();
        if (!asesor) return res.status(400).json({ error: 'La persona seleccionada no pertenece al negocio.' });

        const existeBloque = await Cita.findOne({
            empresa,
            fechaDia,
            hora,
            asesorEmail,
            estado: { $in: ['Pendiente', 'Confirmada', 'En curso'] }
        }).lean();
        if (existeBloque) {
            return res.status(409).json({ error: 'Ese horario ya está ocupado. Elige otra hora.' });
        }

        const nueva = await Cita.create({
            empresa,
            nombre,
            apellidos,
            telefono,
            email,
            servicio,
            fechaDia,
            hora,
            asesorEmail,
            asesorNombre: asesor.nombreVisible || asesor.email.split('@')[0],
            notasCliente,
            estado: 'Pendiente',
            actualizadoEn: new Date()
        });

        // Sincronizar con el CRM (Clientes)
        try {
            const nombreCompleto = `${nombre} ${apellidos}`.trim();
            let cliente = null;

            // 1. Buscar por email si está disponible
            if (email) {
                cliente = await Cliente.findOne({ email, empresa });
            }

            // 2. Si no se encuentra por email, buscar por teléfono
            if (!cliente && telefono) {
                cliente = await Cliente.findOne({ telefono, empresa });
            }

            const fechaCita = new Date(`${fechaDia}T${hora}:00`);
            const notaReserva = `Cita creada: ${servicio || 'General'} con ${asesor.nombreVisible || asesor.email.split('@')[0]}.`;

            if (cliente) {
                // 3. Si el cliente existe, actualizarlo
                cliente.nombre = nombreCompleto;
                if (email) cliente.email = email;
                if (telefono) cliente.telefono = telefono;
                cliente.reservas.push({ fecha: fechaCita, nota: notaReserva });
                await cliente.save();
                console.log(`[CRM] Cliente existente actualizado para la cita: ${cliente.nombre}`);
            } else {
                // 4. Si el cliente no existe, crearlo
                await Cliente.create({ empresa, nombre: nombreCompleto, email, telefono, reservas: [{ fecha: fechaCita, nota: notaReserva }] });
                console.log(`[CRM] Nuevo cliente creado para la cita: ${nombreCompleto}`);
            }
        } catch (crmError) {
            console.error(`[CRM] Fallo al sincronizar cita en el CRM para ${email || telefono}:`, crmError);
            // No fallar la petición principal, solo registrar el error.
        }

        if (global.io) {
            global.io.to(`empresa:${empresa}`).emit('cita_nueva', {
                empresa,
                citaId: String(nueva._id),
                estado: nueva.estado,
                fechaDia: nueva.fechaDia,
                hora: nueva.hora
            });
        }

        res.json({ success: true, cita: nueva });
    } catch (e) {
        res.status(500).json({ error: 'No se pudo registrar la cita.' });
    }
});

app.get('/api/auth/verificar', (req, res) => {
    if (req.session && req.session.esAdmin) {
        const rol = rolActual(req);
        return res.json({
            autenticado: true,
            usuario: req.session.email,
            rol,
            empresa: req.session.empresa || EMPRESA_DEFAULT
        });
    }
    return res.json({ autenticado: false });
});

function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function lanzarFallbackMonopolioLocal(empresa, items = []) {
    const lista = Array.isArray(items) ? items.filter(i => i?.url) : [];
    if (lista.length === 0) return;

    setTimeout(async () => {
        for (const item of lista) {
            try {
                const urlOrigen = normalizarUrlObjetivo(item.url);
                const alias = String(item.alias || sugerirAliasDesdeUrl(urlOrigen)).trim() || urlOrigen;
                const resultado = await scrapeMonopolio(urlOrigen, alias);

                if (global.io) {
                    global.io.to(`empresa:${empresa}`).emit('monopolio_update', {
                        mensaje: `Scraping local finalizado para ${alias}.`,
                        productos: Array.isArray(resultado?.productos) ? resultado.productos : [],
                        grupos: Array.isArray(resultado?.grupos) ? resultado.grupos : [],
                        esModoSeguidos: Boolean(resultado?.esModoSeguidos),
                        exploracion: resultado?.exploracion || null,
                        urlOrigen,
                        alias,
                        empresa,
                        origen: 'fallback-local',
                        timestamp: new Date()
                    });
                }
            } catch (err) {
                if (global.io) {
                    global.io.to(`empresa:${empresa}`).emit('monopolio_update', {
                        error: err?.message || 'Fallo en fallback local de monopolio.',
                        urlOrigen: item.url,
                        alias: item.alias || item.url,
                        empresa,
                        origen: 'fallback-local',
                        timestamp: new Date()
                    });
                }
            }

            await esperar(350);
        }
    }, 25);
}


app.post('/api/auth/google', async (req, res) => {
    const { token, clientLocation } = req.body;
    try {
        if (!token) return res.status(400).json({ error: 'Token no proporcionado.' });

        const ticket = await client.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();
        const emailUsuario = payload['email'].toLowerCase().trim();

        let autorizado = await UsuarioAutorizado.findOne({ email: emailUsuario });

        if (!autorizado && ADMIN_WHITELIST.includes(emailUsuario)) {
            autorizado = await UsuarioAutorizado.create({
                email: emailUsuario,
                rol: 'Admin',
                empresa: EMPRESA_DEFAULT,
                nombreVisible: String(payload?.name || '').trim().slice(0, 80)
            });
        }

        if (autorizado) {
            autorizado.empresa = normalizarEmpresa(autorizado.empresa);
            if (ADMIN_WHITELIST.includes(emailUsuario)) {
                autorizado.rol = 'Admin';
            }
            autorizado.ultimaConexion = new Date();
            await autorizado.save();

            req.session.esAdmin = true;
            req.session.email = emailUsuario;
            req.session.rol = ADMIN_WHITELIST.includes(emailUsuario) ? 'Admin' : (autorizado.rol || 'Admin');
            req.session.empresa = autorizado.empresa || EMPRESA_DEFAULT;
            
            const locationData = await obtenerUbicacionCompleta(req, clientLocation);
            await registrarLog(emailUsuario, "Inició sesión en el sistema", locationData);
            
            return req.session.save(err => {
                if (err) return res.status(500).json({ error: 'Fallo al guardar sesión.' });
                res.json({ status: 'success', usuario: emailUsuario });
            });
        } else {
            console.warn(`[AUTH] Intento de acceso no autorizado: ${emailUsuario}`);
            return res.status(401).json({ error: 'Email no autorizado en la lista blanca.' });
        }
    } catch (error) { 
        console.error('[AUTH] Error al verificar token de Google:', error.message);
        return res.status(400).json({ error: 'Token inválido o expirado.' }); 
    }
});

// --- Rutas de Sistema / Mantenimiento ---
app.get('/api/system/db-stats', exigeSoloAdmin, async (req, res) => {
    try {
        const stats = await mongoose.connection.db.command({ dbStats: 1 });
        const MAX_BYTES = 512 * 1024 * 1024; // 512MB (Límite del clúster gratuito M0 de Atlas)
        const usedBytes = (stats.dataSize || 0) + (stats.indexSize || 0);
        const percentage = Math.min(((usedBytes / MAX_BYTES) * 100), 100).toFixed(2);
        res.json({ usedBytes, totalBytes: MAX_BYTES, percentage: parseFloat(percentage) });
    } catch (e) {
        console.error("Error obteniendo dbStats:", e);
        res.status(500).json({ error: 'Fallo al recuperar estadísticas de DB.' });
    }
});

// --- Rutas de Gestión de Usuarios ---
app.get('/api/usuarios-admin', exigeSoloAdmin, async (req, res) => {
    try { 
        const empresa = normalizarEmpresa(req.session?.empresa || EMPRESA_DEFAULT);
        res.json(await UsuarioAutorizado.find({ empresa }).sort({ fechaAgregado: -1 })); 
    } catch (e) { res.status(500).send(e); }
});

app.post('/api/usuarios-admin', exigeSoloAdmin, async (req, res) => {
    try {
        const empresa = normalizarEmpresa(req.session?.empresa || EMPRESA_DEFAULT);
        const emailLimpio = req.body.email ? req.body.email.toLowerCase().trim() : "";
        const rolAsignado = String(req.body.rol || "Editor").trim();
        const rolesPermitidos = ['Admin', 'Editor', 'Visualizador', 'Lector'];
        if (!emailLimpio) return res.status(400).json({ error: 'Email requerido.' });
        if (!rolesPermitidos.includes(rolAsignado)) return res.status(400).json({ error: 'Rol inválido.' });
        const nuevo = new UsuarioAutorizado({ email: emailLimpio, rol: rolAsignado, empresa });
        await nuevo.save();
        await registrarLog(req.session.email, `Autorizó cuenta: ${emailLimpio} [Rol: ${rolAsignado}] [Empresa: ${empresa}]`);
        res.json(nuevo);
    } catch (e) { res.status(400).json({ error: 'El usuario ya está autorizado en la lista.' }); }
});

app.put('/api/usuarios-admin/:id/rol', exigeSoloAdmin, async (req, res) => {
    try {
        if ((req.session?.rol || 'Editor') !== 'Admin') {
            return res.status(403).json({ error: 'Solo un Admin puede modificar permisos.' });
        }

        const empresa = normalizarEmpresa(req.session?.empresa || EMPRESA_DEFAULT);
        const nuevoRol = String(req.body?.rol || '').trim();
        const rolesPermitidos = ['Admin', 'Editor', 'Visualizador', 'Lector'];
        if (!rolesPermitidos.includes(nuevoRol)) {
            return res.status(400).json({ error: 'Rol inválido.' });
        }

        const usuario = await UsuarioAutorizado.findById(req.params.id);
        if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });
        if (normalizarEmpresa(usuario.empresa) !== empresa) {
            return res.status(403).json({ error: 'No puedes modificar usuarios de otra empresa.' });
        }
        if ((usuario.rol || 'Editor') === 'Lector') {
            return res.status(403).json({ error: 'Los usuarios Lectores no son editables desde este panel.' });
        }
        if (usuario.email === req.session.email && nuevoRol !== 'Admin') {
            return res.status(400).json({ error: 'No puedes quitarte permisos de Admin a ti mismo.' });
        }

        const rolAnterior = usuario.rol || 'Editor';
        usuario.rol = nuevoRol;
        await usuario.save();
        await registrarLog(req.session.email, `Cambió permisos de ${usuario.email}: ${rolAnterior} -> ${nuevoRol}`);

        res.json({ success: true, usuario });
    } catch (e) {
        res.status(500).json({ error: 'Error al actualizar permisos.' });
    }
});

app.delete('/api/usuarios-admin/:id', exigeSoloAdmin, async (req, res) => {
    try {
        const empresa = normalizarEmpresa(req.session?.empresa || EMPRESA_DEFAULT);
        const u = await UsuarioAutorizado.findById(req.params.id);
        if (u) {
            if (normalizarEmpresa(u.empresa) !== empresa) {
                return res.status(403).json({ error: 'No puedes eliminar usuarios de otra empresa.' });
            }
            await UsuarioAutorizado.findByIdAndDelete(req.params.id);
            await registrarLog(req.session.email, `Revocó el acceso permanente a: ${u.email}`);
        }
        res.sendStatus(200);
    } catch (e) { res.status(500).send(e); }
});

// --- Perfil de Usuario / Mensajería Interna ---
app.get('/api/perfil', exigeAdmin, async (req, res) => {
    try {
        const email = (req.session?.email || '').toLowerCase().trim();
        const user = await UsuarioAutorizado.findOne({ email }).lean();
        if (!user) return res.status(404).json({ error: 'Perfil no encontrado.' });
        res.json({
            email: user.email,
            rol: user.rol || 'Editor',
            empresa: normalizarEmpresa(user.empresa || EMPRESA_DEFAULT),
            nombreVisible: user.nombreVisible || '',
            fotoPerfil: user.fotoPerfil || ''
        });
    } catch (e) {
        res.status(500).json({ error: 'Error al recuperar perfil.' });
    }
});

app.put('/api/perfil', exigeAdmin, async (req, res) => {
    try {
        const email = (req.session?.email || '').toLowerCase().trim();
        const nombreVisible = String(req.body?.nombreVisible || '').trim().slice(0, 80);
        const fotoPerfil = String(req.body?.fotoPerfil || '').trim().slice(0, 2000000);

        const actualizado = await UsuarioAutorizado.findOneAndUpdate(
            { email },
            { nombreVisible, fotoPerfil },
            { new: true }
        ).lean();

        if (!actualizado) return res.status(404).json({ error: 'Perfil no encontrado.' });
        await registrarLog(req.session.email, 'Actualizó su perfil de usuario.');
        res.json({ success: true, perfil: actualizado });
    } catch (e) {
        res.status(500).json({ error: 'Error al guardar perfil.' });
    }
});

app.get('/api/mensajes/usuarios', exigeAdmin, async (req, res) => {
    try {
        const emailActual = (req.session?.email || '').toLowerCase().trim();
        const empresa = normalizarEmpresa(req.session?.empresa || EMPRESA_DEFAULT);
        const usuarios = await UsuarioAutorizado.find({ empresa })
            .sort({ fechaAgregado: -1 })
            .lean();

        const filtrados = [];
        for (const u of usuarios) {
            if (u.email === emailActual) continue;

            const [noLeidos, ultimoMensaje] = await Promise.all([
                MensajeInterno.countDocuments({ empresa, deEmail: u.email, paraEmail: emailActual, leido: false }),
                MensajeInterno.findOne({
                    empresa,
                    $or: [
                        { deEmail: emailActual, paraEmail: u.email },
                        { deEmail: u.email, paraEmail: emailActual }
                    ]
                }).sort({ creadoEn: -1 }).select('texto creadoEn deEmail').lean()
            ]);

            filtrados.push({
                email: u.email,
                rol: u.rol || 'Editor',
                empresa: normalizarEmpresa(u.empresa || EMPRESA_DEFAULT),
                nombreVisible: u.nombreVisible || '',
                fotoPerfil: u.fotoPerfil || '',
                ultimaConexion: u.ultimaConexion || null,
                unread: Number(noLeidos || 0),
                ultimoMensaje: ultimoMensaje?.texto || '',
                ultimoMensajeTs: ultimoMensaje?.creadoEn || null,
                ultimoMensajeEsMio: ultimoMensaje?.deEmail === emailActual
            });
        }

        filtrados.sort((a, b) => {
            if (Number(b.unread || 0) !== Number(a.unread || 0)) {
                return Number(b.unread || 0) - Number(a.unread || 0);
            }
            const bt = b.ultimoMensajeTs ? new Date(b.ultimoMensajeTs).getTime() : 0;
            const at = a.ultimoMensajeTs ? new Date(a.ultimoMensajeTs).getTime() : 0;
            return bt - at;
        });

        res.json({ usuarios: filtrados });
    } catch (e) {
        res.status(500).json({ error: 'Error al recuperar usuarios para chat.' });
    }
});

app.get('/api/mensajes', exigeAdmin, async (req, res) => {
    try {
        const emailActual = (req.session?.email || '').toLowerCase().trim();
        const conEmail = String(req.query?.con || '').toLowerCase().trim();
        if (!conEmail) return res.status(400).json({ error: 'Falta destinatario de conversación.' });

        const empresa = normalizarEmpresa(req.session?.empresa || EMPRESA_DEFAULT);
        const destinatario = await UsuarioAutorizado.findOne({ email: conEmail, empresa }).lean();
        if (!destinatario) return res.status(403).json({ error: 'El usuario no pertenece a tu equipo.' });

        const mensajes = await MensajeInterno.find({
            empresa,
            $or: [
                { deEmail: emailActual, paraEmail: conEmail },
                { deEmail: conEmail, paraEmail: emailActual }
            ]
        })
            .sort({ creadoEn: 1 })
            .limit(500)
            .lean();

        await MensajeInterno.updateMany(
            { empresa, deEmail: conEmail, paraEmail: emailActual, leido: false },
            { $set: { leido: true } }
        );

        res.json({ mensajes });
    } catch (e) {
        res.status(500).json({ error: 'Error al recuperar conversación.' });
    }
});

app.post('/api/mensajes', exigeAdmin, async (req, res) => {
    try {
        const emailActual = (req.session?.email || '').toLowerCase().trim();
        const paraEmail = String(req.body?.paraEmail || '').toLowerCase().trim();
        const texto = String(req.body?.texto || '').trim();

        if (!paraEmail || !texto) return res.status(400).json({ error: 'Datos incompletos para enviar mensaje.' });
        if (texto.length > 4000) return res.status(400).json({ error: 'Mensaje demasiado largo.' });

        const empresa = normalizarEmpresa(req.session?.empresa || EMPRESA_DEFAULT);
        const existeDestino = await UsuarioAutorizado.findOne({ email: paraEmail, empresa }).lean();
        if (!existeDestino) return res.status(404).json({ error: 'Usuario destino no encontrado.' });

        const mensaje = new MensajeInterno({ empresa, deEmail: emailActual, paraEmail, texto });
        await mensaje.save();

        if (global.io) {
            global.io.to(`empresa:${empresa}`).emit('mensaje_interno_nuevo', {
                deEmail: emailActual,
                paraEmail,
                empresa,
                creadoEn: mensaje.creadoEn
            });
        }

        res.json({ success: true, mensaje });
    } catch (e) {
        res.status(500).json({ error: 'Error al enviar mensaje.' });
    }
});

// --- Rutas de Tareas (Kanban) ---
app.get('/api/tareas', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        res.json(await Tarea.find({ empresa }).sort({ fechaCreacion: -1 }));
    } catch (e) { res.status(500).send(e); }
});
app.post('/api/tareas', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const nueva = new Tarea({ ...req.body, empresa });
        await nueva.save();
        await registrarLog(req.session.email, `Creó una tarea: ${nueva.titulo}`);
        res.json(nueva);
    } catch (e) { res.status(400).send(e); }
});
app.put('/api/tareas/:id', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const tarea = await Tarea.findOneAndUpdate({ _id: req.params.id, empresa }, req.body, { new: true });
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada en tu empresa.' });
        await registrarLog(req.session.email, `Actualizó la tarea: ${tarea.titulo}`);
        res.json(tarea);
    } catch (e) { res.status(400).send(e); }
});
app.put('/api/tareas/:id/estado', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const tarea = await Tarea.findOneAndUpdate({ _id: req.params.id, empresa }, { estado: req.body.estado }, { new: true });
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada en tu empresa.' });
        await registrarLog(req.session.email, `Movió tarea a ${req.body.estado}: ${tarea.titulo}`);
        res.json(tarea);
    } catch (e) { res.status(400).send(e); }
});
app.delete('/api/tareas/:id', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const tarea = await Tarea.findOneAndDelete({ _id: req.params.id, empresa });
        if(tarea) await registrarLog(req.session.email, `Eliminó la tarea: ${tarea.titulo}`);
        res.sendStatus(200);
    } catch (e) { res.status(500).send(e); }
});

// --- Rutas de Citas ---
app.get('/api/citas', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const citas = await Cita.find({ empresa }).sort({ fechaDia: 1, hora: 1, creadoEn: -1 }).lean();
        const pendientes = citas.filter(c => c.estado === 'Pendiente').length;
        res.json({ citas, pendientes });
    } catch (e) {
        res.status(500).json({ error: 'No se pudieron recuperar las citas.' });
    }
});

app.get('/api/citas/resumen', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const pendientes = await Cita.countDocuments({ empresa, estado: 'Pendiente' });
        res.json({ pendientes });
    } catch (e) {
        res.status(500).json({ error: 'No se pudo obtener el resumen de citas.' });
    }
});

app.put('/api/citas/:id/estado', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const estado = String(req.body?.estado || '').trim();
        const estadosPermitidos = ['Pendiente', 'Confirmada', 'En curso', 'Completada', 'Cancelada'];
        if (!estadosPermitidos.includes(estado)) return res.status(400).json({ error: 'Estado inválido.' });

        const cita = await Cita.findOneAndUpdate(
            { _id: req.params.id, empresa },
            { estado, actualizadoEn: new Date() },
            { new: true }
        ).lean();

        if (!cita) return res.status(404).json({ error: 'Cita no encontrada.' });

        await registrarLog(req.session.email, `Movió cita de ${cita.nombre} ${cita.apellidos || ''} a ${estado}`);

        if (global.io) {
            global.io.to(`empresa:${empresa}`).emit('cita_actualizada', {
                empresa,
                citaId: String(cita._id),
                estado: cita.estado
            });
        }

        res.json({ success: true, cita });
    } catch (e) {
        res.status(500).json({ error: 'No se pudo actualizar el estado de la cita.' });
    }
});

app.put('/api/citas/:id/notas', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const notasInternas = String(req.body?.notasInternas || '').trim().slice(0, 2000);
        const cita = await Cita.findOneAndUpdate(
            { _id: req.params.id, empresa },
            { notasInternas, actualizadoEn: new Date() },
            { new: true }
        ).lean();
        if (!cita) return res.status(404).json({ error: 'Cita no encontrada.' });
        res.json({ success: true, cita });
    } catch (e) {
        res.status(500).json({ error: 'No se pudo guardar la nota interna.' });
    }
});

// --- Rutas de FAQs Dinámicas ---
app.get('/api/faqs', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        res.json(await Faq.find({ empresa }).sort({ fechaCreacion: 1 }));
    } catch (e) { res.status(500).send(e); }
});
app.post('/api/faqs', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const nueva = new Faq({ ...req.body, empresa }); await nueva.save();
        await registrarLog(req.session.email, `Añadió nueva FAQ`); res.json(nueva);
    } catch (e) { res.status(400).send(e); }
});
app.put('/api/faqs/:id', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const f = await Faq.findOneAndUpdate({ _id: req.params.id, empresa }, req.body, { new: true });
        if (!f) return res.status(404).json({ error: 'FAQ no encontrada en tu empresa.' });
        await registrarLog(req.session.email, `Modificó una FAQ`); res.json(f);
    } catch (e) { res.status(400).send(e); }
});
app.delete('/api/faqs/:id', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        await Faq.deleteOne({ _id: req.params.id, empresa });
        await registrarLog(req.session.email, `Eliminó una FAQ`);
        res.sendStatus(200);
    } catch (e) { res.status(500).send(e); }
});

function sanitizarCodigoProducto(codigo) {
    return String(codigo || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 64);
}

function inferirCategoriaPorTexto(texto) {
    const t = String(texto || '').toLowerCase();
    if (!t) return 'General';
    if (/camis|t-shirt|tee|shirt/.test(t)) return 'Camisetas';
    if (/pantal|jean|trouser/.test(t)) return 'Pantalones';
    if (/chaquet|jacket|blazer|abrigo|coat/.test(t)) return 'Chaquetas';
    if (/sudader|hoodie/.test(t)) return 'Sudaderas';
    if (/vestido|dress/.test(t)) return 'Vestidos';
    if (/zapat|sneaker|shoe|calzado/.test(t)) return 'Calzado';
    if (/bolso|bag|mochila/.test(t)) return 'Accesorios';
    return 'General';
}

function normalizarProductoIA(producto = {}, codigo = '') {
    const prenda = String(producto.prenda || producto.nombre || 'Articulo detectado').trim().slice(0, 120);
    const categoria = String(producto.categoria || inferirCategoriaPorTexto(prenda)).trim().slice(0, 80) || 'General';
    const precioNum = Number(producto.precioVenta || producto.precio || 0);
    const precioVenta = Number.isFinite(precioNum) && precioNum > 0 ? Number(precioNum.toFixed(2)) : 0;
    const marca = String(producto.marca || '').trim().slice(0, 60);
    const descripcion = String(producto.descripcion || '').trim().slice(0, 600);
    const talla = String(producto.talla || '').trim().slice(0, 20);
    const condicion = String(producto.condicion || '').trim().slice(0, 40);
    const skuSugerido = sanitizarCodigoProducto(producto.skuSugerido || codigo || `AI-${Date.now().toString().slice(-6)}`);

    return { prenda, categoria, precioVenta, marca, descripcion, talla, condicion, skuSugerido };
}

function extraerJsonDeTexto(texto) {
    const raw = String(texto || '').trim();
    if (!raw) return null;

    const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
    if (fenced && fenced[1]) {
        try { return JSON.parse(fenced[1]); } catch (_) {}
    }

    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) {
        try { return JSON.parse(raw.slice(first, last + 1)); } catch (_) {}
    }

    return null;
}

// Lookup de codigo (barcode/QR SKU) para autocompletar formulario
app.get('/api/producto/lookup-codigo/:codigo', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const codigoRaw = String(req.params.codigo || '').trim();
        if (!codigoRaw) return res.status(400).json({ error: 'Codigo vacio.' });

        const codigo = sanitizarCodigoProducto(codigoRaw);
        const encontrado = await VentaRopa.findOne({ empresa, sku: codigo }).lean();
        if (encontrado) {
            return res.json({
                fuente: 'inventario',
                producto: {
                    skuSugerido: encontrado.sku || codigo,
                    prenda: encontrado.prenda || '',
                    categoria: encontrado.categoria || 'General',
                    precioVenta: Number(encontrado.precioVenta || 0),
                    marca: encontrado.marca || '',
                    descripcion: encontrado.comentariosProducto || '',
                    talla: encontrado.talla || '',
                    condicion: encontrado.condicion || ''
                }
            });
        }

        // Intento de enriquecimiento con OpenFoodFacts para codigos EAN/UPC.
        if (/^\d{8,14}$/.test(codigoRaw)) {
            try {
                const off = await axios.get(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(codigoRaw)}.json`, { timeout: 10000 });
                const p = off?.data?.product || {};
                if (off?.data?.status === 1 && p) {
                    const nombre = p.product_name || p.product_name_es || p.generic_name || `Producto ${codigoRaw}`;
                    const marca = p.brands || '';
                    const categoria = inferirCategoriaPorTexto(p.categories || nombre);
                    return res.json({
                        fuente: 'openfoodfacts',
                        producto: normalizarProductoIA({
                            prenda: nombre,
                            categoria,
                            marca,
                            descripcion: p.ingredients_text_es || p.ingredients_text || '',
                            precioVenta: 0,
                            skuSugerido: codigo
                        }, codigo)
                    });
                }
            } catch (_) {
                // Fallo remoto no bloquea la respuesta.
            }
        }

        return res.json({
            fuente: 'codigo',
            producto: normalizarProductoIA({
                prenda: `Articulo ${codigoRaw}`,
                categoria: 'General',
                precioVenta: 0,
                skuSugerido: codigo
            }, codigo)
        });
    } catch (error) {
        res.status(500).json({ error: 'No se pudo resolver informacion del codigo.' });
    }
});

// Analisis de foto para generar sugerencias de producto sin modificar la base de datos.
app.post('/api/producto/analizar-foto', exigeAdmin, async (req, res) => {
    try {
        const imagen = String(req.body?.imagen || '').trim();
        const imagenesRaw = Array.isArray(req.body?.imagenes) ? req.body.imagenes : [];
        const imagenes = [
            imagen,
            ...imagenesRaw.map((x) => String(x || '').trim())
        ].filter(Boolean).slice(0, 3);
        const codigo = sanitizarCodigoProducto(req.body?.codigo || '');
        if (!imagenes.length) return res.status(400).json({ error: 'Imagen vacia.' });

        const apiKey = (process.env.TOGETHER_API_KEY || '').replace(/['"]/g, '').trim();
        if (!apiKey) {
            return res.json({
                fuente: 'fallback-local',
                producto: normalizarProductoIA({
                    prenda: 'Articulo fotografiado',
                    categoria: 'General',
                    precioVenta: 0,
                    descripcion: 'Configura TOGETHER_API_KEY para analisis visual avanzado.',
                    skuSugerido: codigo || `AI-${Date.now().toString().slice(-6)}`
                }, codigo)
            });
        }

        const prompt = `Analiza la imagen del producto y devuelve SOLO JSON valido, sin texto extra, con esta estructura:
{
  "prenda": "nombre comercial corto",
  "categoria": "categoria sugerida",
  "precioVenta": 0,
  "marca": "marca si se ve",
  "descripcion": "resumen breve para inventario",
  "talla": "si se detecta",
  "condicion": "Nueva|Muy buena|Buena|Usada",
  "skuSugerido": "${codigo || 'SKU sugerido'}"
}
Usa precioVenta en EUR como numero. Si no estas seguro, usa 0.
Si vienen varias imagenes, combina todas para una unica respuesta.`;

        const modelos = [
            'google/gemini-2.0-flash-lite-preview-02-05:free',
            'meta-llama/llama-3.2-11b-vision-instruct:free',
            'qwen/qwen-vl-plus:free'
        ];

        let parsed = null;
        let lastError = 'No hubo respuesta de IA.';

        for (const modelId of modelos) {
            try {
                const payload = {
                    model: modelId,
                    messages: [
                        { role: 'system', content: 'Eres un analista de catalogo. Responde estrictamente con JSON valido.' },
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: prompt },
                                ...imagenes.map((img) => ({ type: 'image_url', image_url: { url: img } }))
                            ]
                        }
                    ],
                    temperature: 0.2,
                    max_tokens: 650
                };

                const r = await axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://seychelles-shop.com',
                        'X-Title': 'Seychelles Core'
                    },
                    timeout: 28000
                });

                const text = r?.data?.choices?.[0]?.message?.content || '';
                parsed = extraerJsonDeTexto(text);
                if (parsed) break;
            } catch (e) {
                lastError = e?.response?.data?.error?.message || e.message;
            }
        }

        if (!parsed) {
            return res.json({
                fuente: 'fallback-ia',
                producto: normalizarProductoIA({
                    prenda: codigo ? `Articulo ${codigo}` : 'Articulo fotografiado',
                    categoria: 'General',
                    precioVenta: 0,
                    descripcion: `Analisis parcial: la IA no devolvio JSON parseable (${String(lastError || 'sin detalle').slice(0, 180)}).`,
                    skuSugerido: codigo || `AI-${Date.now().toString().slice(-6)}`
                }, codigo)
            });
        }

        return res.json({
            fuente: 'ia-vision',
            producto: normalizarProductoIA(parsed, codigo)
        });
    } catch (error) {
        res.status(500).json({ error: 'Error analizando la foto del producto.' });
    }
});

// --- Rutas de Ajustes del Tablero Kanban ---
app.get('/api/estados-kanban', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        res.json(await EstadoKanban.find({ empresa }).sort({ orden: 1 }));
    } catch (e) { res.status(500).send(e); }
});
app.post('/api/estados-kanban', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const nuevo = new EstadoKanban({ ...req.body, empresa }); await nuevo.save();
        await registrarLog(req.session.email, `Creó el estado Kanban: ${nuevo.nombre}`); res.json(nuevo);
    } catch (e) { res.status(400).send(e); }
});
app.put('/api/estados-kanban/:id', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const estado = await EstadoKanban.findOneAndUpdate({ _id: req.params.id, empresa }, req.body, { new: true });
        if (!estado) return res.status(404).json({ error: 'Estado no encontrado en tu empresa.' });
        await registrarLog(req.session.email, `Modificó estado Kanban: ${estado.nombre}`); res.json(estado);
    } catch (e) { res.status(400).send(e); }
});
app.delete('/api/estados-kanban/:id', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const estado = await EstadoKanban.findOneAndDelete({ _id: req.params.id, empresa });
        if(estado) await registrarLog(req.session.email, `Eliminó el estado Kanban: ${estado.nombre}`); res.sendStatus(200);
    } catch (e) { res.status(500).send(e); }
});

// --- Ruta del Asistente IA (Together AI - Llama 3) ---
app.post('/api/chat', exigeAdmin, async (req, res) => {
    const { mensaje, imagen } = req.body;
    if (!mensaje && !imagen) return res.status(400).json({ error: 'Mensaje vacío' });
    const empresa = empresaActual(req);

    const apiKey = (process.env.TOGETHER_API_KEY || '').replace(/['"]/g, '').trim();
    
    // Fallback amigable si el usuario aún no ha configurado la API Key
    if (!apiKey) {
        return res.json({
            respuesta: "He migrado a un nuevo motor de IA más estable: **Together AI**. Para activarme, crea una cuenta gratuita en **api.together.ai**, genera una clave y pégala en la variable de entorno `TOGETHER_API_KEY` en Render. ¡Te dan 25$ de crédito gratis que duran meses!"
        });
    }

    try {
        // 1. Damos visión del inventario a la IA para que pueda analizarlo (Máx 150 items recientes)
        const productos = await VentaRopa.find({ empresa }).select('sku prenda estado precioVenta cantidad').limit(150).lean();
        const inventarioContexto = productos.map(p => `[SKU: ${p.sku || 'N/A'}] ${p.prenda} (${p.cantidad} ud) - ${p.estado} - ${p.precioVenta}€`).join('\n');

        // Le damos personalidad y contexto a la IA
        const promptSistema = `Eres Seychelles AI, asistente ERP y gerente virtual de la tienda.
Respuestas extremadamente breves y amigables.
Inventario actual para análisis:
${inventarioContexto || 'Inventario vacío.'}

¡TIENES PERMISOS DE ADMINISTRADOR! Puedes ejecutar acciones reales en la base de datos respondiendo EXACTAMENTE con este formato en una línea nueva al final de tu texto:
[ACCION: comando | param1: valor | param2: valor]

Comandos permitidos:
1. ACTUALIZAR_PRECIO -> params: sku, precio
2. CAMBIAR_ESTADO -> params: sku, estado
3. BORRAR_PRODUCTO -> params: sku
4. CREAR_PRODUCTO -> params: prenda, precio, categoria
5. PREPARAR_FACTURA -> params: cliente, sku

Ejemplo: Si te piden cambiar precio de VNT-123 a 20 euros, responde:
Claro, he actualizado el precio a 20€.
[ACCION: ACTUALIZAR_PRECIO | sku: VNT-123 | precio: 20]

Ejemplo: Si te piden hacer una factura a Pedro del producto 999:
[ACCION: PREPARAR_FACTURA | cliente: Pedro | sku: 999]

Si el usuario te envía una FOTO de ropa y pide registrarla/añadirla al stock, inventa un buen título SEO, un precio estimado de venta de mercado y una categoría, y responde:
[ACCION: CREAR_PRODUCTO | prenda: Camiseta Nike Vintage 90s | precio: 35 | categoria: Camisetas]`;
        
        let userContent = mensaje || "Revisa esta imagen y dime qué prenda es.";

        if (imagen) {
            userContent = [
                { type: "text", text: userContent },
                { type: "image_url", image_url: { url: imagen } }
            ];
        }

        const endpoints = [
            { id: "google/gemini-2.0-flash-lite-preview-02-05:free", vision: true },
            { id: "meta-llama/llama-3.2-11b-vision-instruct:free", vision: true },
            { id: "qwen/qwen-vl-plus:free", vision: true },
            { id: "deepseek/deepseek-r1:free", vision: false },
            { id: "meta-llama/llama-3.1-8b-instruct:free", vision: false },
            { id: "mistralai/mistral-7b-instruct:free", vision: false }
        ];

        let iaData = null;
        let lastErrorMsg = "Error desconocido.";
        let rateLimitExcedido = false;

        for (const ep of endpoints) {
            try {
                let currentContent = userContent;
                // Si el modelo de respaldo no soporta fotos, enviamos solo texto para evitar un crash
                if (!ep.vision && imagen) currentContent = mensaje || "Por favor, responde basándote en los datos de la base de datos.";

                const payload = {
                    model: ep.id,
                    messages: [
                        { role: "system", content: promptSistema },
                        { role: "user", content: currentContent }
                    ],
                    temperature: 0.5,
                    max_tokens: 2000
                };

                const apiRes = await axios.post(
                    'https://openrouter.ai/api/v1/chat/completions',
                    payload,
                    { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://seychelles-shop.com', 'X-Title': 'Seychelles Core' }, timeout: 15000 }
                );
                iaData = apiRes.data;
                console.log(`[IA INFO] Éxito con OpenRouter usando el modelo: ${ep.id}`);
                break; // Si funciona, rompemos el bucle y continuamos
            } catch (err) {
                lastErrorMsg = err.response?.data?.error?.message || err.message;
                console.warn(`[IA WARN] Falló ${ep.id} en OpenRouter: ${lastErrorMsg}`);
                if (err.response?.status === 429) rateLimitExcedido = true;
            }
        }

        if (!iaData) {
            if (rateLimitExcedido) {
                lastErrorMsg = "Has alcanzado el límite de peticiones gratuitas por minuto de OpenRouter. Espera unos segundos y vuelve a intentarlo.";
            }
            console.error("[IA ERROR TOTAL] OpenRouter:", lastErrorMsg);
            return res.status(400).json({ error: `Fallo de IA: ${lastErrorMsg}` });
        }

        let textoIA = iaData.choices?.[0]?.message?.content || "El modelo no pudo generar una respuesta.";
        let accionEjecutada = false;
        const accionesDetectadas = [];

        // 3. Interceptor de Comandos Mágicos (Si la IA ha decidido modificar la base de datos)
        const actionRegex = /\[ACCION:\s*(.*?)\s*\]/g;
        let match;
        while ((match = actionRegex.exec(textoIA)) !== null) {
            accionEjecutada = true;
            const partsCmd = match[1].split('|').map(p => p.trim());
            const actionType = partsCmd[0];
            const params = {};
            for (let i = 1; i < partsCmd.length; i++) {
                const kv = partsCmd[i].split(':');
                if (kv.length >= 2) params[kv[0].trim().toLowerCase()] = kv.slice(1).join(':').trim();
            }
            
            accionesDetectadas.push({ tipo: actionType, params });

            try {
                if (actionType === 'ACTUALIZAR_PRECIO' && params.sku && params.precio) {
                    await VentaRopa.findOneAndUpdate({ sku: params.sku, empresa }, { precioVenta: parseFloat(params.precio), fechaModificacion: new Date().toISOString().slice(0, 10) });
                    invalidateKpiResumenCache(empresa);
                    await registrarLog(req.session.email, `IA actualizó precio de ${params.sku}`);
                } else if (actionType === 'CAMBIAR_ESTADO' && params.sku && params.estado) {
                    await VentaRopa.findOneAndUpdate({ sku: params.sku, empresa }, { estado: params.estado, fechaModificacion: new Date().toISOString().slice(0, 10) });
                    invalidateKpiResumenCache(empresa);
                    await registrarLog(req.session.email, `IA cambió estado de ${params.sku} a ${params.estado}`);
                } else if (actionType === 'BORRAR_PRODUCTO' && params.sku) {
                    await VentaRopa.findOneAndDelete({ sku: params.sku, empresa });
                    invalidateKpiResumenCache(empresa);
                    await registrarLog(req.session.email, `IA borró producto ${params.sku}`);
                } else if (actionType === 'CREAR_PRODUCTO' && params.prenda) {
                    const nuevo = new VentaRopa({
                        empresa,
                        sku: `IA-${Date.now().toString().slice(-6)}`,
                        prenda: params.prenda, precioVenta: parseFloat(params.precio) || 0,
                        categoria: params.categoria || 'General', estado: 'No Vendido',
                        imagen: imagen || '' // Se guarda la foto que le pasaste en el chat directamente en la ficha del producto!
                    });
                    await nuevo.save();
                    invalidateKpiResumenCache(empresa);
                    await registrarLog(req.session.email, `IA creó producto ${params.prenda}`);
                }
            } catch(e) { console.error("Error ejecutando orden de IA:", e); }
        }

        // Quitamos el texto de sistema para que el usuario no vea los comandos de máquina
        textoIA = textoIA.replace(actionRegex, '').trim();
        if (textoIA === '') textoIA = "¡Acción ejecutada con éxito en la base de datos! ✅";

        res.json({ respuesta: textoIA, accionEjecutada, acciones: accionesDetectadas });
    } catch (error) {
        console.error("[IA ERROR] Fallo crítico:", error);
        res.status(500).json({ error: 'No se pudo conectar con el motor de IA.' });
    }
});

// --- Rutas de Notas ---

app.get('/api/notas', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const notas = await Nota.find({ empresa }).lean();
        res.json(notas);
    } catch (e) { res.status(500).json({ error: 'Fallo al recuperar notas.' }); }
});

app.post('/api/notas', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const count = await Nota.countDocuments({ empresa });
        if (count >= 10) return res.status(400).json({ error: 'Límite de 10 notas alcanzado.' });
        const nuevaNota = new Nota({ ...req.body, empresa, usuario: req.session.email });
        await nuevaNota.save();
        res.json(nuevaNota);
    } catch (e) { res.status(500).json({ error: 'Error al crear nota.' }); }
});

app.put('/api/notas/:id', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { id } = req.params;
        const notaActualizada = await Nota.findOneAndUpdate({ _id: id, empresa }, req.body, { new: true });
        if (!notaActualizada) return res.status(404).json({ error: 'Nota no encontrada en tu empresa.' });
        res.json(notaActualizada);
    } catch (e) { res.status(500).json({ error: 'Error al mover nota.' }); }
});

app.delete('/api/notas/:id', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { id } = req.params;
        await Nota.deleteOne({ _id: id, empresa });
        res.sendStatus(200);
    } catch (e) { res.status(500).json({ error: 'Error al borrar nota.' }); }
});

// --- Rutas de Ventas / Inventario ---

/**
 * Recupera logs de auditoría para el calendario (filtrado por mes/año)
 */
app.get('/api/logs/calendario', exigeRol(['Admin', 'Visualizador']), async (req, res) => {
    try {
        const { mes, anio } = req.query; // mes: 1-12
        if (!mes || !anio) return res.status(400).json({ error: 'Mes y año requeridos.' });

        const empresa = normalizarEmpresa(req.session?.empresa || EMPRESA_DEFAULT);
        const usuariosEquipo = await UsuarioAutorizado.find({ empresa }).select('email').lean();
        const emailsEquipo = usuariosEquipo.map(u => String(u.email || '').toLowerCase().trim()).filter(Boolean);
        if (emailsEquipo.length === 0) return res.json({ logs: [] });

        const m = parseInt(mes);
        const a = parseInt(anio);
        
        const fechaInicio = new Date(Date.UTC(a, m - 1, 1, 0, 0, 0));
        const fechaFin = new Date(Date.UTC(a, m, 0, 23, 59, 59)); 
        
        const logs = await LogAuditoria.find({
            empresa,
            fechaHora: { $gte: fechaInicio, $lte: fechaFin },
            usuario: { $in: emailsEquipo }
        })
            .select('fechaHora usuario accion ip ciudad pais lat lon')
            .sort({ fechaHora: 1 })
            .lean();
        
        res.json({ logs });
    } catch (e) { res.status(500).json({ error: 'Fallo al recuperar logs.' }); }
});

app.get('/api/logs/locations', exigeRol(['Admin', 'Visualizador']), async (req, res) => {
    try {
        const empresa = normalizarEmpresa(req.session?.empresa || EMPRESA_DEFAULT);
        const maxRegistros = Math.max(300, Math.min(parseInt(req.query?.limit, 10) || 1200, 2500));
        const usuariosEquipo = await UsuarioAutorizado.find({ empresa }).select('email').lean();
        const emailsEquipo = usuariosEquipo.map(u => String(u.email || '').toLowerCase().trim()).filter(Boolean);
        if (emailsEquipo.length === 0) return res.json({ locations: [], lastLogin: null, usuariosDisponibles: [], topIps: [] });

        const usuarioFiltro = String(req.query?.usuario || '').toLowerCase().trim();
        if (usuarioFiltro && !emailsEquipo.includes(usuarioFiltro)) {
            return res.status(403).json({ error: 'No puedes consultar logs de usuarios fuera de tu equipo.' });
        }

        const filtroBase = {
            empresa,
            lat: { $ne: null },
            lon: { $ne: null },
            accion: { $in: [/Inició sesión/i, /Cerró sesión/i] },
            usuario: usuarioFiltro || { $in: emailsEquipo }
        };

        // Recuperamos logs de conexiones Y desconexiones con coordenadas
        const activityLogs = await LogAuditoria.find(filtroBase)
            .select('usuario accion fechaHora ip ciudad pais lat lon')
            .sort({ fechaHora: -1 })
            .limit(maxRegistros)
            .lean();

        // Adicionalmente, buscar el último log de conexión para centrar el mapa
        const lastLoginLog = await LogAuditoria.findOne({
            empresa,
            accion: /Inició sesión/i,
            lat: { $ne: null },
            lon: { $ne: null },
            usuario: usuarioFiltro || { $in: emailsEquipo }
        })
            .select('usuario fechaHora ip ciudad pais lat lon')
            .sort({ fechaHora: -1 })
            .lean();

        // Agrupar los datos para obtener localizaciones únicas y sus eventos
        const locations = {};
        const contadorIps = {};
        activityLogs.forEach(log => {
            const key = `${log.lat.toFixed(4)},${log.lon.toFixed(4)}`; // Agrupar por coordenadas cercanas
            if (!locations[key]) {
                locations[key] = {
                    lat: log.lat,
                    lon: log.lon,
                    ciudad: log.ciudad || 'Desconocida',
                    pais: log.pais || 'Desconocido',
                    count: 0,
                    ips: {},
                    eventos: []
                };
            }
            locations[key].count++;
            if (log.ip) {
                locations[key].ips[log.ip] = (locations[key].ips[log.ip] || 0) + 1;
                contadorIps[log.ip] = (contadorIps[log.ip] || 0) + 1;
            }
            locations[key].eventos.push({
                usuario: log.usuario,
                accion: log.accion,
                fecha: log.fechaHora,
                ip: log.ip || 'N/A'
            });
        });

        const topIps = Object.entries(contadorIps)
            .map(([ip, count]) => ({ ip, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        res.json({
            locations: Object.values(locations).map(loc => ({
                ...loc,
                ips: Object.entries(loc.ips).map(([ip, count]) => ({ ip, count })).sort((a, b) => b.count - a.count)
            })),
            lastLogin: lastLoginLog,
            usuariosDisponibles: emailsEquipo,
            topIps,
            filtroUsuario: usuarioFiltro || ''
        });

    } catch (e) { res.status(500).json({ error: 'Fallo al recuperar datos del mapa.' }); }
});

// --- Rutas de Clientes (CRM) ---
app.get('/api/clientes', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        res.json(await Cliente.find({ empresa }).sort({ nombre: 1 }));
    } catch (e) { res.status(500).send(e); }
});
app.post('/api/clientes', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const nuevo = new Cliente({ ...req.body, empresa });
        await nuevo.save();
        await registrarLog(req.session.email, `Registró cliente: ${nuevo.nombre}`);
        res.json(nuevo);
    } catch (e) { res.status(400).send(e); }
});
app.put('/api/clientes/:id', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const cliente = await Cliente.findOneAndUpdate({ _id: req.params.id, empresa }, req.body, { new: true });
        if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado en tu empresa.' });
        await registrarLog(req.session.email, `Actualizó datos del cliente: ${cliente.nombre}`);
        notificarCambio(); // Notificar cambio para refrescar la lista de clientes en otros navegadores
        res.json(cliente);
    } catch (e) { res.status(400).send(e); }
});
app.delete('/api/clientes/:id', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        await Cliente.deleteOne({ _id: req.params.id, empresa });
        notificarCambio(); // Notificar cambio para refrescar la lista de clientes en otros navegadores
        res.sendStatus(200);
    } catch (e) { res.status(500).send(e); }
});

// --- Rutas de Gastos Operativos ---
app.get('/api/gastos', exigeSoloAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        res.json(await Gasto.find({ empresa }).sort({ fecha: -1 }));
    } catch (e) { res.status(500).send(e); }
});
app.post('/api/gastos', exigeSoloAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const nuevo = new Gasto({ ...req.body, empresa });
        await nuevo.save();
        invalidateKpiResumenCache(empresa);
        await registrarLog(req.session.email, `Registró gasto: ${nuevo.concepto} (${nuevo.monto}€)`);
        res.json(nuevo);
    } catch (e) { res.status(400).send(e); }
});
app.delete('/api/gastos/:id', exigeSoloAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        await Gasto.deleteOne({ _id: req.params.id, empresa });
        invalidateKpiResumenCache(empresa);
        res.sendStatus(200);
    } catch (e) { res.status(500).send(e); }
});

app.get('/api/ventas', exigeRol(['Admin', 'Editor', 'Visualizador', 'Lector']), async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 40; // Lotes de 40 productos
        const skip = (page - 1) * limit;
        const lightweight = String(req.query.lightweight || '').toLowerCase() === '1' || page > 1;
        const includeLogs = String(req.query.includeLogs || '').toLowerCase() === '1';

        let nombresEstadosVenta = [];
        if (!lightweight) {
            const estadosKanban = await EstadoKanban.find({ empresa }).select('nombre rolFinanciero').lean();
            nombresEstadosVenta = estadosKanban.filter(e => e.rolFinanciero === 'Venta').map(e => e.nombre);
        }

        // Pipeline para obtener datos paginados y conteo total en una sola consulta
        const [ventasData] = await VentaRopa.aggregate([
            { $match: { empresa } },
            { $sort: { _id: -1 } },
            {
                $facet: {
                    paginatedResults: [
                        { $skip: skip },
                        { $limit: limit },
                        { $lookup: { from: 'tiendas', let: { tiendaId: '$tienda' }, pipeline: [ { $match: { $expr: { $and: [ { $eq: ['$_id', '$$tiendaId'] }, { $eq: ['$empresa', empresa] } ] } } } ], as: 'tiendaInfo' } },
                        { $unwind: { path: '$tiendaInfo', preserveNullAndEmptyArrays: true } },
                        { $addFields: { proveedor: '$tiendaInfo.nombre' } },
                        { $project: { tiendaInfo: 0 } }
                    ],
                    totalCount: [{ $count: 'count' }]
                }
            }
        ]);

        const ventas = ventasData.paginatedResults;
        const totalVentas = ventasData.totalCount[0] ? ventasData.totalCount[0].count : 0;

        let resumen = { ingresos: 0, beneficio: 0, inversion: 0, prendasVendidas: 0, roi: 0, totalGastosOperativos: 0 };
        let logs = [];

        if (!lightweight) {
            const cachedResumen = getKpiResumenCache(empresa);
            if (cachedResumen) {
                resumen = cachedResumen;
            } else {
                // Cálculo financiero en aggregate sin cargar arrays grandes en memoria.
                const [summaryData] = await VentaRopa.aggregate([
                    { $match: { empresa } },
                    {
                        $group: {
                            _id: null,
                            totalInversion: { $sum: { $multiply: [{ $ifNull: ['$precioCompra', 0] }, { $ifNull: ['$cantidad', 1] }] } },
                            totalGastosEnvio: { $sum: { $multiply: [{ $ifNull: ['$gastosEnvio', 0] }, { $ifNull: ['$cantidad', 1] }] } },
                            ingresosNetos: {
                                $sum: {
                                    $cond: [
                                        { $in: ['$estado', nombresEstadosVenta] },
                                        {
                                            $multiply: [
                                                {
                                                    $subtract: [
                                                        { $ifNull: ['$precioVenta', 0] },
                                                        {
                                                            $cond: [
                                                                { $in: ['$canalVenta', ['Vinted', 'Wallapop']] },
                                                                { $multiply: [{ $ifNull: ['$precioVenta', 0] }, 0.05] },
                                                                0
                                                            ]
                                                        }
                                                    ]
                                                },
                                                { $ifNull: ['$cantidad', 1] }
                                            ]
                                        },
                                        0
                                    ]
                                }
                            },
                            prendasVendidas: {
                                $sum: {
                                    $cond: [
                                        { $in: ['$estado', nombresEstadosVenta] },
                                        { $ifNull: ['$cantidad', 1] },
                                        0
                                    ]
                                }
                            }
                        }
                    }
                ]);

                const [gastosAgg] = await Gasto.aggregate([
                    { $match: { empresa } },
                    { $group: { _id: null, totalGastosOperativos: { $sum: { $ifNull: ['$monto', 0] } } } }
                ]);

                const totalGastosOperativos = gastosAgg?.totalGastosOperativos || 0;
                const ingresos = summaryData?.ingresosNetos || 0;
                const prendasVendidas = summaryData?.prendasVendidas || 0;
                const inversion = (summaryData?.totalInversion || 0) + (summaryData?.totalGastosEnvio || 0);
                const beneficioNeto = ingresos - inversion - totalGastosOperativos;
                const roi = (inversion + totalGastosOperativos) > 0 ? (beneficioNeto / (inversion + totalGastosOperativos)) * 100 : 0;

                resumen = { ingresos, beneficio: beneficioNeto, inversion: inversion + totalGastosOperativos, prendasVendidas, roi, totalGastosOperativos };
                setKpiResumenCache(empresa, resumen);
            }

            if (includeLogs) {
                const cachedLogs = getLogsResumenCache(empresa);
                if (cachedLogs) {
                    logs = cachedLogs;
                } else {
                    const usuariosEquipo = await UsuarioAutorizado.find({ empresa }).select('email').lean();
                    const emailsEquipo = usuariosEquipo.map(u => String(u.email || '').toLowerCase().trim()).filter(Boolean);
                    logs = emailsEquipo.length
                        ? await LogAuditoria.find({ empresa, usuario: { $in: emailsEquipo } })
                            .select('fechaHora usuario accion')
                            .sort({ _id: -1 })
                            .limit(25)
                            .lean()
                        : [];
                    setLogsResumenCache(empresa, logs);
                }
            }
        }

        return res.json({
            resumen: resumenSeguroPorRol(resumen, req),
            ventas: sanitizarVentasParaRol(ventas, req),
            logs: logsSegurosPorRol(logs, req),
            totalPages: Math.ceil(totalVentas / limit),
            currentPage: page
        });
    } catch (error) {
        console.error('Fallo en API /ventas:', error);
        return res.status(500).json({ error: 'Fallo al obtener datos de ventas.' });
    }
});

app.post('/api/ventas', exigeRol(['Admin', 'Editor']), bloquearMutacionVisualizador, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { proveedor, ...datosVenta } = req.body;
        
        const tiendaDoc = await Tienda.findOne({ nombre: proveedor, empresa });

        if (datosVenta.estado) {
            const estadoCfg = await EstadoKanban.findOne({ nombre: datosVenta.estado, empresa }).lean();
            const esVenta = estadoCfg && estadoCfg.rolFinanciero === 'Venta';
            if (esVenta && !datosVenta.fechaVenta) {
                datosVenta.fechaVenta = new Date().toISOString().split('T')[0];
            }
            if (!esVenta && datosVenta.fechaVenta) {
                datosVenta.fechaVenta = '';
            }
        }

        const nuevaVenta = new VentaRopa({ ...datosVenta, empresa, tienda: tiendaDoc ? tiendaDoc._id : null });
        await nuevaVenta.save(); 
        invalidateKpiResumenCache(empresa);
        await registrarLog(req.session.email, `Registró prenda en stock: ${nuevaVenta.prenda} (${proveedor})`);
        return res.json({ status: "success", venta: nuevaVenta });
    } catch (error) { 
        return res.status(500).json({ error: 'Error al registrar artículo.' }); 
    }
});

app.put('/api/ventas/:id', exigeSoloAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { id } = req.params;
        const { proveedor, ...datosVenta } = req.body;

        const tiendaDoc = await Tienda.findOne({ nombre: proveedor, empresa });

        if (datosVenta.estado) {
            const estadoCfg = await EstadoKanban.findOne({ nombre: datosVenta.estado, empresa }).lean();
            const esVenta = estadoCfg && estadoCfg.rolFinanciero === 'Venta';
            if (esVenta && !datosVenta.fechaVenta) {
                datosVenta.fechaVenta = new Date().toISOString().split('T')[0];
            }
            if (!esVenta && datosVenta.fechaVenta) {
                datosVenta.fechaVenta = '';
            }
        }

        const ventaActualizada = await VentaRopa.findOneAndUpdate(
            { _id: id, empresa }, 
            { ...datosVenta, tienda: tiendaDoc ? tiendaDoc._id : null, fechaModificacion: new Date().toISOString().slice(0, 10) }, 
            { new: true }
        );
        if (!ventaActualizada) return res.status(404).json({ error: 'Producto no encontrado en tu empresa.' });

        invalidateKpiResumenCache(empresa);
        await registrarLog(req.session.email, `Modificó datos de la prenda ID: ${id} (${ventaActualizada.prenda})`);
        return res.json({ status: "success", venta: ventaActualizada });
    } catch (error) {
        return res.status(500).json({ error: 'Error al actualizar registro.' });
    }
});

app.put('/api/ventas/:id/estado', exigeSoloAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { id } = req.params;
        const { estado, fechaVenta, comentariosProducto } = req.body;

        const estadoConfig = await EstadoKanban.findOne({ nombre: estado, empresa });
        const updateData = { estado };
        updateData.fechaModificacion = new Date().toISOString().slice(0, 10);
        
        if (estadoConfig && estadoConfig.rolFinanciero === 'Venta') {
            updateData.fechaVenta = fechaVenta || new Date().toISOString().split('T')[0];
            if (typeof comentariosProducto === 'string') {
                updateData.comentariosProducto = comentariosProducto.trim();
            }
        } else {
            updateData.fechaVenta = '';
        }

        const ventaActualizada = await VentaRopa.findOneAndUpdate({ _id: id, empresa }, updateData, { new: true });
        if (!ventaActualizada) return res.status(404).json({ error: 'Producto no encontrado en tu empresa.' });
        invalidateKpiResumenCache(empresa);
        await registrarLog(req.session.email, `Transición de estado: [${ventaActualizada.prenda}] -> ${estado.toUpperCase()}`);
        return res.json({ status: "success", venta: ventaActualizada });
    } catch (error) {
        return res.status(500).json({ error: 'Error en la actualización de la columna Kanban.' });
    }
});

app.put('/api/ventas/escanear/:sku', exigeSoloAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { sku } = req.params;
        let venta = await VentaRopa.findOne({ sku: sku, empresa });
        
        const estadosConfig = await EstadoKanban.find({ empresa }).sort({ orden: 1 });
        const estStock = estadosConfig.find(e => e.rolFinanciero === 'Stock');
        const estVenta = estadosConfig.find(e => e.rolFinanciero === 'Venta');
        
        const nombreStock = estStock ? estStock.nombre : 'No Vendido';
        const nombreVenta = estVenta ? estVenta.nombre : 'Vendido';

        if (!venta) {
            venta = new VentaRopa({
                empresa,
                sku: sku,
                prenda: 'Artículo Escaneado Nuevo',
                estado: nombreStock
            });
            await venta.save();
            invalidateKpiResumenCache(empresa);
            return res.json({ operacion: "Creado", venta });
        } else {
            const nuevoEstado = venta.estado === nombreVenta ? nombreStock : nombreVenta;
            venta.estado = nuevoEstado;
            if (nuevoEstado === nombreVenta) {
                venta.fechaVenta = new Date().toISOString().split('T')[0];
                if (!venta.comentariosProducto) {
                    venta.comentariosProducto = 'Venta registrada por escáner.';
                }
            } else {
                venta.fechaVenta = '';
            }
            await venta.save();
            invalidateKpiResumenCache(empresa);
            return res.json({ operacion: nuevoEstado, venta });
        }
    } catch (error) {
        return res.status(500).json({ error: 'Fallo en la llamada del decodificador del escáner.' });
    }
});

app.delete('/api/ventas/:id', exigeSoloAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { id } = req.params;
        const ventaEliminada = await VentaRopa.findOneAndDelete({ _id: id, empresa });
        if (ventaEliminada) {
            invalidateKpiResumenCache(empresa);
            await registrarLog(req.session.email, `Eliminó permanentemente la prenda: ${ventaEliminada.prenda}`);
        }
        return res.sendStatus(200);
    } catch (error) {
        return res.status(500).json({ error: 'Error al purgar elemento de la base de datos.' });
    }
});

app.post('/api/logout', async (req, res) => { 
    const { clientLocation } = req.body;
    if (req.session && req.session.email) {
        const emailUsuario = req.session.email;
        const locationData = await obtenerUbicacionCompleta(req, clientLocation);
        await registrarLog(emailUsuario, "Cerró sesión en el sistema", locationData);
        req.session.destroy(() => res.sendStatus(200));
    } else {
        res.sendStatus(200);
    }
});
app.get('/api/logout', (req, res) => { req.session.destroy(() => res.sendStatus(200)); }); // Compatibilidad

// Fallback SPA solo para rutas no-API; evita romper endpoints GET registrados debajo.
app.get(/^\/(?!api(?:\/|$)).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[SERVER] Seychelles Core Activo en puerto: ${PORT}`));


//SCRIPT DE SCRAPING

// --- SISTEMA DE SCRAPING WEB --- //

// 1. Analizar cuenta, hacer el scrape y devolver comparativa
// --- SISTEMA DE SCRAPING MEJORADO --- //

/**
 * Analiza una URL de Vinted y devuelve una comparativa detallada:
 * 1. Productos existentes con cambios de precio (discrepancias).
 * 2. Productos nuevos encontrados en la web que no están en el sistema.
 */

app.post('/api/scraper/analizar', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { url, alias } = req.body;
        if (!url) return res.status(400).json({ error: 'URL de Vinted requerida.' });

        const aliasLimpio = String(alias || '').trim() || 'Vinted';

        await lanzarScraperUnificadoGithub({
            mode: 'manual',
            targetUrl: url,
            empresa,
            alias: aliasLimpio,
            webhookPath: '/api/scraper/webhook-github',
            logTag: 'GITHUB-UNIFIED-MANUAL'
        });

        res.json({ 
            success: true, 
            mensaje: 'GitHub está iniciando el escaneo sin bloqueos. Recibirás un aviso en esta pantalla en 1-2 minutos cuando termine.' 
        });

    } catch (error) {
        const ghStatus = error?.response?.status;
        const ghData = error?.response?.data;

        console.error('[GITHUB-API] Error al lanzar workflow:', ghStatus || error.message, ghData || '');

        if (ghStatus === 404) {
            return res.status(500).json({
                error: 'GitHub no encontró el repo o el workflow. Revisa GITHUB_OWNER/GITHUB_REPO y que exista .github/workflows/vinted-scraper.yml en main.'
            });
        }

        if (ghStatus === 401 || ghStatus === 403) {
            return res.status(500).json({
                error: 'GITHUB_PAT inválido o sin permisos repo/workflow. Regenera el token y habilita permisos para Actions en el repositorio.'
            });
        }

        if (ghStatus === 422) {
            return res.status(500).json({
                error: 'GitHub rechazó el dispatch (posible rama o workflow incorrecto). Verifica que la rama main exista y el archivo vinted-scraper.yml esté en esa rama.'
            });
        }

        res.status(500).json({ error: 'No se pudo iniciar el scraper remoto en GitHub Actions.' });
    }
});

/**
 * Analiza datos subidos manualmente (ej. desde un Excel de Instant Data Scraper)
 */
app.post('/api/scraper/analizar-manual', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { productosExtraidos } = req.body;
        console.log(`[SCRAPER MANUAL] Recibidos ${productosExtraidos?.length || 0} productos para comparar.`);
        if (!productosExtraidos || !Array.isArray(productosExtraidos)) {
            return res.status(400).json({ error: 'Datos no válidos.' });
        }

        const resultados = { discrepancias: [], nuevos: [], identicos: [], desaparecidos: [] };
        const productosBD = await VentaRopa.find({ canalVenta: 'Vinted', empresa }).lean();

        const cleanStr = str => String(str || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        const normalizarProveedor = (v) => String(v || 'Vinted').trim().toLowerCase() || 'vinted';
        const hayCoincidenciaFlexible = (a, b) => {
            if (!a || !b) return false;
            if (a === b) return true;
            return (a.length > 4 && b.includes(a)) || (b.length > 4 && a.includes(b));
        };

        const titulosWebPorProveedor = new Map();

        productosExtraidos.forEach(item => {
            const titulo = item.titulo || item.prenda || '';
            const precioWeb = parseFloat(item.precio);
            const imagen = item.imagen || '';
            const galeria = item.galeria || [];
            const proveedorFuente = normalizarProveedor(
                item.proveedor || item.cuenta || item.aliasFuente || item.origenGrupo || item.alias || 'Vinted'
            );
            const proveedorLabel = String(item.proveedor || item.cuenta || item.aliasFuente || item.origenGrupo || item.alias || 'Vinted').trim() || 'Vinted';

            if (titulo && !isNaN(precioWeb)) {
                const cleanItemTitle = cleanStr(titulo);
                const listaActual = titulosWebPorProveedor.get(proveedorFuente) || [];
                listaActual.push(cleanItemTitle);
                titulosWebPorProveedor.set(proveedorFuente, listaActual);
                
                // MODIFICACIÓN: Ahora la coincidencia requiere que el título y el proveedor (tienda) sean similares.
                const coincidencia = productosBD.find(p => {
                    const cleanP = cleanStr(p.prenda);
                    const mismoTitulo = hayCoincidenciaFlexible(cleanP, cleanItemTitle);
                    const mismoProveedor = normalizarProveedor(p.proveedor) === proveedorFuente;
                    return mismoTitulo && mismoProveedor;
                });

                if (coincidencia) {
                    if (Math.abs(coincidencia.precioVenta - precioWeb) > 0.01 || coincidencia.prenda !== titulo) {
                        resultados.discrepancias.push({
                            idMongo: coincidencia._id,
                            prenda: coincidencia.prenda,
                            prendaNueva: titulo,
                            valorAntiguo: coincidencia.precioVenta,
                            valorNuevo: precioWeb,
                            proveedor: proveedorLabel,
                            imagen,
                            fechaRegistro: coincidencia.fecha || '',
                            fechaVenta: coincidencia.fechaVenta || ''
                        });
                    } else {
                        resultados.identicos.push({
                            idMongo: coincidencia._id,
                            prenda: coincidencia.prenda,
                            precio: coincidencia.precioVenta,
                            proveedor: proveedorLabel,
                            imagen,
                            fechaRegistro: coincidencia.fecha || '',
                            fechaVenta: coincidencia.fechaVenta || ''
                        });
                    }
                } else {
                    resultados.nuevos.push({ 
                        prenda: titulo, 
                        precioVenta: precioWeb, 
                        imagen, galeria, canalVenta: 'Vinted', 
                        proveedor: proveedorLabel,
                        estado: 'No Vendido',
                        marca: item.marca || '', talla: item.talla || '',
                        condicion: item.condicion || '', popularidad: item.favoritos || 0,
                        descripcion: item.descripcion || '' });
                }
            }
        });

        // Detectar artículos de Vinted en MongoDB que no aparecen en el scraping actual.
        const activosMongo = productosBD.filter(p => !p.fechaVenta);
        activosMongo.forEach(p => {
            const cleanP = cleanStr(p.prenda || '');
            if (!cleanP) return;
            const proveedorMongo = normalizarProveedor(p.proveedor);
            const titulosProveedor = titulosWebPorProveedor.get(proveedorMongo);
            // Si no se ha scrapeado ese proveedor concreto, no lo marcamos como desaparecido.
            if (!titulosProveedor || titulosProveedor.length === 0) return;

            const existeEnWeb = titulosProveedor.some(t => hayCoincidenciaFlexible(cleanP, t));
            if (!existeEnWeb) {
                resultados.desaparecidos.push({
                    idMongo: p._id,
                    prenda: p.prenda,
                    precio: p.precioVenta,
                    proveedor: p.proveedor || 'Vinted',
                    imagen: p.imagen || '',
                    fechaRegistro: p.fecha || '',
                    comentariosProducto: p.comentariosProducto || ''
                });
            }
        });

        res.json(resultados);
    } catch (error) {
        console.error('Error en Scraper Manual:', error);
        res.status(500).json({ error: 'Error al procesar los datos manuales.' });
    }
});

/**
 * Importa productos nuevos seleccionados por el usuario
 */
app.post('/api/scraper/importar', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { productos } = req.body; // Array de productos seleccionados en el frontend
        if (!productos || !Array.isArray(productos)) return res.status(400).json({ error: 'Datos de productos no válidos.' });

        const normalizarTxt = (v) => String(v || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const firmaPorProveedor = (titulo, proveedor) => `${normalizarTxt(proveedor || 'vinted')}::${normalizarTxt(titulo)}`;

        const proveedoresLote = [...new Set(productos.map(p => String(p?.proveedor || 'Vinted').trim()).filter(Boolean))];
        const existentesMismaEmpresa = await VentaRopa.find({
            empresa,
            canalVenta: 'Vinted',
            proveedor: { $in: proveedoresLote }
        }).select('prenda proveedor').lean();

        const firmasExistentes = new Set(
            existentesMismaEmpresa.map(v => firmaPorProveedor(v.prenda, v.proveedor))
        );
        const firmasLote = new Set();

        const tiendasCache = new Map();
        const obtenerTiendaPorNombre = async (nombre) => {
            const limpio = (nombre || '').trim();
            if (!limpio) return null;
            if (tiendasCache.has(limpio)) return tiendasCache.get(limpio);

            let tiendaDoc = await Tienda.findOne({ nombre: limpio, empresa });
            if (!tiendaDoc) {
                tiendaDoc = new Tienda({ nombre: limpio, empresa });
                await tiendaDoc.save();
            }
            tiendasCache.set(limpio, tiendaDoc);
            return tiendaDoc;
        };

        const registrosCreados = [];
        const resumenTiendas = {};
        let omitidosDuplicados = 0;
        for (const prod of productos) {
            const nombreTienda = (prod.proveedor || '').trim() || 'Vinted';
            const firmaActual = firmaPorProveedor(prod.prenda, nombreTienda);
            // Regla clave: solo consideramos duplicado dentro de la misma tienda/proveedor.
            if (firmasExistentes.has(firmaActual) || firmasLote.has(firmaActual)) {
                omitidosDuplicados += 1;
                continue;
            }
            firmasLote.add(firmaActual);

            // OPTIMIZACIÓN: No convertir a Base64, guardar URL directamente.
            const galeriaUrls = [];
            if (prod.galeria && Array.isArray(prod.galeria)) {
                for (const gUrl of prod.galeria.slice(0, 12)) {
                    galeriaUrls.push(gUrl);
                }
            }

            const tiendaSeleccionada = await obtenerTiendaPorNombre(nombreTienda);
            resumenTiendas[nombreTienda] = (resumenTiendas[nombreTienda] || 0) + 1;

            const nuevaVenta = new VentaRopa({
                ...prod,
                empresa,
                // Guardar URL directamente en lugar de Base64
                imagen: prod.imagen,
                galeria: galeriaUrls,
                tienda: tiendaSeleccionada ? tiendaSeleccionada._id : null,
                sku: `VNT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                comentariosProducto: `${prod.comentariosProducto || ''}${prod.comentariosProducto ? ' · ' : ''}Importado por Scraper el ${new Date().toLocaleDateString()} (${nombreTienda})`
            });
            await nuevaVenta.save();
            registrosCreados.push(nuevaVenta.prenda);
        }
        invalidateKpiResumenCache(empresa);
        notificarCambio(); // Notificar cambio para refrescar el panel principal

        await registrarLog(req.session.email, `Importó ${registrosCreados.length} productos desde Vinted (omitidos duplicados misma tienda: ${omitidosDuplicados}): ${registrosCreados.join(', ')}`);
        res.json({ success: true, count: registrosCreados.length, duplicadosOmitidos: omitidosDuplicados, tiendas: resumenTiendas });
    } catch (error) {
        console.error('Error en importación:', error);
        res.status(500).json({ error: 'Fallo al guardar los nuevos productos.' });
    }
});

/**
 * Inserción masiva de productos (Para restauración de backups o migraciones)
 */
app.post('/api/ventas/bulk', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { productos } = req.body;
        if (!productos || !Array.isArray(productos)) return res.status(400).json({ error: 'Lista de productos no válida.' });

        // Mapeamos los productos para asegurar que tengan IDs de tienda válidos
        const productosProcesados = await Promise.all(productos.map(async (p) => {
            let tiendaId = null;
            if (p.proveedor) {
                const t = await Tienda.findOne({ nombre: p.proveedor, empresa });
                if (t) tiendaId = t._id;
            }
            return {
                ...p,
                empresa,
                tienda: tiendaId,
                sku: p.sku || `BK-${Date.now()}-${Math.floor(Math.random() * 1000)}`
            };
        }));

        const insertados = await VentaRopa.insertMany(productosProcesados);
        invalidateKpiResumenCache(empresa);
        await registrarLog(req.session.email, `Restauración masiva: Insertados ${insertados.length} productos.`);
        res.json({ success: true, count: insertados.length });
    } catch (error) {
        console.error("Error en bulk insert:", error);
        res.status(500).json({ error: 'Fallo al procesar la inserción masiva.' });
    }
});

/**
 * Recibe datos del scraper ejecutado en GitHub Actions
 */
app.post('/api/scraper/webhook-github', async (req, res) => {
    const token = req.headers['x-github-token'];
    const GITHUB_SECRET = process.env.SCRAPER_TOKEN;

    console.log(`[WEBHOOK] Intento de conexión. Token recibido: ${token ? 'SÍ' : 'NO'}. Match: ${token === GITHUB_SECRET}`);

    if (!GITHUB_SECRET || token !== GITHUB_SECRET) {
        console.error('[WEBHOOK] Error: Token no autorizado o no configurado en Render.');
        return res.status(401).json({ error: 'No autorizado' });
    }

    try {
        const { productos, urlOrigen, empresa: empresaBody, error: errorMsg } = req.body;
        const empresa = normalizarEmpresa(empresaBody || EMPRESA_DEFAULT);

        if (errorMsg) {
            console.error(`[GITHUB-WEBHOOK-ERROR] Recibido error de scraper: ${errorMsg}`);
            if (global.io) {
                global.io.to(`empresa:${empresa}`).emit('scraper_update', {
                    error: errorMsg,
                    empresa,
                    urlOrigen: urlOrigen,
                    timestamp: new Date()
                });
            }
            return res.json({ success: true, status: 'error_received' });
        }

        console.log(`[GITHUB-WEBHOOK] Recibidos ${productos.length} productos de ${urlOrigen}`);
        
        // Notificar a los administradores conectados vía Socket.io
        if (global.io) {
            global.io.to(`empresa:${empresa}`).emit('scraper_update', { // Notificar al room correcto
                mensaje: `GitHub ha terminado de escanear ${productos.length} productos.`,
                productos: productos,
                empresa,
                urlOrigen: urlOrigen,
                timestamp: new Date()
            });
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error procesando webhook' });
    }
});

/**
 * Aplica cambios de precio a productos existentes
 */
app.post('/api/scraper/aplicar', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { cambios } = req.body;
        for (const cambio of cambios) {
            await VentaRopa.findOneAndUpdate({ _id: cambio.idMongo, empresa }, { precioVenta: cambio.valorNuevo, prenda: cambio.prenda, fechaModificacion: new Date().toISOString().slice(0, 10) });
            await registrarLog(req.session.email, `Sincronización artículo: ${cambio.prenda} -> ${cambio.valorNuevo}€`);
        }
        invalidateKpiResumenCache(empresa);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar precios.' });
    }
});

// --- RUTAS DE HIGIENE DE DATOS ---

app.get('/api/higiene/scan', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const limit = Math.max(5, Math.min(Number.parseInt(String(req.query?.limit || '25'), 10) || 25, 100));
        const reporte = await generarReporteHigiene(empresa, limit);
        res.json(reporte);
    } catch (e) {
        console.error('[HIGIENE] Error en scan:', e.message);
        res.status(500).json({ error: 'No se pudo ejecutar el escaneo de higiene.' });
    }
});

app.post('/api/higiene/apply', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const action = String(req.body?.action || '').trim();
        const dryRun = req.body?.dryRun !== false;

        if (!action) {
            return res.status(400).json({ error: 'Acción requerida.' });
        }

        if (action === 'aplicar-decisiones-objetos') {
            const decisionesRaw = Array.isArray(req.body?.decisions) ? req.body.decisions : [];
            const decisiones = decisionesRaw.slice(0, 300);

            if (!decisiones.length) {
                return res.status(400).json({ error: 'Debes enviar al menos una decisión por objeto.' });
            }

            const [tiendasRaw, categoriasRaw] = await Promise.all([
                Tienda.distinct('nombre', { empresa }),
                Categoria.distinct('nombre', { empresa })
            ]);

            const tiendasSet = new Set((tiendasRaw || []).map(normalizarClaveTexto).filter(Boolean));
            const categoriasSet = new Set((categoriasRaw || []).map(normalizarClaveTexto).filter(Boolean));

            const ahoraIso = new Date().toISOString().slice(0, 10);
            const resultados = [];
            let cambiosVentas = 0;
            let eliminadosVentas = 0;
            let creadosObjetos = 0;

            for (const decision of decisiones) {
                const tipo = String(decision?.tipo || '').trim();
                const origen = String(decision?.origen || '').trim();
                const accion = String(decision?.accion || '').trim();
                const destino = String(decision?.destino || '').trim();

                const isProveedor = tipo === 'proveedor-huerfano';
                const isCategoria = tipo === 'categoria-huerfana';
                if (!isProveedor && !isCategoria) {
                    resultados.push({ ok: false, tipo, origen, accion, error: 'Tipo no soportado.' });
                    continue;
                }

                if (!origen) {
                    resultados.push({ ok: false, tipo, origen, accion, error: 'Origen vacío.' });
                    continue;
                }

                if (!['ignorar', 'crear', 'renombrar', 'anidar', 'limpiar-referencia', 'eliminar-articulos'].includes(accion)) {
                    resultados.push({ ok: false, tipo, origen, accion, error: 'Acción no soportada.' });
                    continue;
                }

                const campo = isProveedor ? 'proveedor' : 'categoria';
                const origenRegex = new RegExp(`^\\s*${escapeRegexSafe(origen)}\\s*$`, 'i');
                const queryBase = {
                    empresa,
                    [campo]: { $regex: origenRegex }
                };

                try {
                    if (accion === 'ignorar') {
                        const total = await VentaRopa.countDocuments(queryBase);
                        resultados.push({ ok: true, tipo, origen, accion, total, skipped: true });
                        continue;
                    }

                    if (accion === 'crear') {
                        const nombre = origen.slice(0, 120);
                        const nombreNorm = normalizarClaveTexto(nombre);
                        if (!nombreNorm) {
                            resultados.push({ ok: false, tipo, origen, accion, error: 'Nombre inválido para crear.' });
                            continue;
                        }

                        const yaExiste = isProveedor
                            ? tiendasSet.has(nombreNorm)
                            : categoriasSet.has(nombreNorm);

                        if (dryRun) {
                            resultados.push({ ok: true, tipo, origen, accion, nombre, exists: yaExiste, wouldCreate: !yaExiste });
                            continue;
                        }

                        if (!yaExiste) {
                            if (isProveedor) {
                                await Tienda.create({ nombre, empresa, fechaCreacion: new Date() });
                                tiendasSet.add(nombreNorm);
                            } else {
                                await Categoria.create({ nombre, empresa });
                                categoriasSet.add(nombreNorm);
                            }
                            creadosObjetos += 1;
                        }

                        resultados.push({ ok: true, tipo, origen, accion, nombre, created: !yaExiste, exists: yaExiste });
                        continue;
                    }

                    if (accion === 'renombrar' || accion === 'anidar') {
                        const destinoFinal = destino.slice(0, 120);
                        const destinoNorm = normalizarClaveTexto(destinoFinal);
                        if (!destinoNorm) {
                            resultados.push({ ok: false, tipo, origen, accion, error: 'Debes indicar destino para renombrar/anidar.' });
                            continue;
                        }

                        if (accion === 'anidar') {
                            const existeDestino = isProveedor ? tiendasSet.has(destinoNorm) : categoriasSet.has(destinoNorm);
                            if (!existeDestino) {
                                resultados.push({ ok: false, tipo, origen, accion, destino: destinoFinal, error: 'El destino de anidación no existe en catálogo.' });
                                continue;
                            }
                        }

                        if (dryRun) {
                            const total = await VentaRopa.countDocuments(queryBase);
                            resultados.push({ ok: true, tipo, origen, accion, destino: destinoFinal, matched: total, wouldModify: total });
                            continue;
                        }

                        const upd = await VentaRopa.updateMany(queryBase, {
                            $set: {
                                [campo]: destinoFinal,
                                fechaModificacion: ahoraIso
                            }
                        });
                        cambiosVentas += Number(upd.modifiedCount || 0);
                        resultados.push({ ok: true, tipo, origen, accion, destino: destinoFinal, matched: upd.matchedCount, modified: upd.modifiedCount });
                        continue;
                    }

                    if (accion === 'limpiar-referencia') {
                        if (dryRun) {
                            const total = await VentaRopa.countDocuments(queryBase);
                            resultados.push({ ok: true, tipo, origen, accion, matched: total, wouldModify: total, valueAfter: '' });
                            continue;
                        }

                        const upd = await VentaRopa.updateMany(queryBase, {
                            $set: {
                                [campo]: '',
                                fechaModificacion: ahoraIso
                            }
                        });
                        cambiosVentas += Number(upd.modifiedCount || 0);
                        resultados.push({ ok: true, tipo, origen, accion, matched: upd.matchedCount, modified: upd.modifiedCount });
                        continue;
                    }

                    if (accion === 'eliminar-articulos') {
                        if (dryRun) {
                            const total = await VentaRopa.countDocuments(queryBase);
                            resultados.push({ ok: true, tipo, origen, accion, matched: total, wouldDelete: total, dangerous: true });
                            continue;
                        }

                        const del = await VentaRopa.deleteMany(queryBase);
                        eliminadosVentas += Number(del.deletedCount || 0);
                        resultados.push({ ok: true, tipo, origen, accion, deleted: del.deletedCount, dangerous: true });
                        continue;
                    }

                    resultados.push({ ok: false, tipo, origen, accion, error: 'Acción no controlada.' });
                } catch (eItem) {
                    resultados.push({ ok: false, tipo, origen, accion, error: eItem.message || 'Error inesperado en decisión.' });
                }
            }

            const okCount = resultados.filter((r) => r.ok).length;
            const errorCount = resultados.length - okCount;

            if (!dryRun && (cambiosVentas > 0 || eliminadosVentas > 0 || creadosObjetos > 0)) {
                invalidateKpiResumenCache(empresa);
                await registrarLog(
                    req.session.email,
                    `[HIGIENE] Decisiones por objeto: ${okCount}/${resultados.length} ok · cambios=${cambiosVentas} · eliminados=${eliminadosVentas} · creados=${creadosObjetos}`
                );
            }

            return res.json({
                dryRun,
                action,
                empresa,
                resumen: {
                    totalDecisiones: resultados.length,
                    exitosas: okCount,
                    errores: errorCount,
                    cambiosVentas,
                    eliminadosVentas,
                    creadosObjetos
                },
                resultados
            });
        }

        if (action === 'corregir-estados-invalidos') {
            const estados = await EstadoKanban.find({ empresa }).select('nombre rolFinanciero').lean();
            const estadosValidos = (estados || []).map((e) => String(e.nombre || '').trim()).filter(Boolean);
            const fallback = (estados.find((e) => e.rolFinanciero === 'Stock')?.nombre)
                || estadosValidos[0]
                || 'No Vendido';

            const queryInvalidos = estadosValidos.length
                ? { empresa, estado: { $nin: estadosValidos } }
                : { empresa };

            const total = await VentaRopa.countDocuments(queryInvalidos);
            const sample = await VentaRopa.find(queryInvalidos)
                .select('_id prenda estado proveedor categoria fecha')
                .limit(30)
                .lean();

            if (dryRun) {
                return res.json({
                    dryRun: true,
                    action,
                    empresa,
                    fallback,
                    total,
                    sample
                });
            }

            const result = await VentaRopa.updateMany(queryInvalidos, {
                $set: {
                    estado: fallback,
                    fechaModificacion: new Date().toISOString().slice(0, 10)
                }
            });

            invalidateKpiResumenCache(empresa);
            await registrarLog(req.session.email, `[HIGIENE] Corrigió estados inválidos: ${result.modifiedCount} -> ${fallback}`);

            return res.json({
                dryRun: false,
                action,
                empresa,
                fallback,
                matched: result.matchedCount,
                modified: result.modifiedCount
            });
        }

        if (action === 'crear-tiendas-faltantes') {
            const faltantes = await obtenerProveedoresSinTienda(empresa);
            if (dryRun) {
                return res.json({ dryRun: true, action, empresa, total: faltantes.length, items: faltantes.slice(0, 80) });
            }

            const docs = faltantes.map((nombre) => ({ nombre, empresa, fechaCreacion: new Date() }));
            let created = 0;
            if (docs.length) {
                const result = await Tienda.insertMany(docs, { ordered: false }).catch((err) => {
                    if (Array.isArray(err?.insertedDocs)) return err.insertedDocs;
                    return [];
                });
                created = Array.isArray(result) ? result.length : 0;
            }

            await registrarLog(req.session.email, `[HIGIENE] Alta masiva de tiendas faltantes: ${created}`);
            return res.json({ dryRun: false, action, empresa, detected: faltantes.length, created });
        }

        if (action === 'crear-categorias-faltantes') {
            const faltantes = await obtenerCategoriasSinCatalogo(empresa);
            if (dryRun) {
                return res.json({ dryRun: true, action, empresa, total: faltantes.length, items: faltantes.slice(0, 80) });
            }

            const docs = faltantes.map((nombre) => ({ nombre, empresa }));
            let created = 0;
            if (docs.length) {
                const result = await Categoria.insertMany(docs, { ordered: false }).catch((err) => {
                    if (Array.isArray(err?.insertedDocs)) return err.insertedDocs;
                    return [];
                });
                created = Array.isArray(result) ? result.length : 0;
            }

            await registrarLog(req.session.email, `[HIGIENE] Alta masiva de categorías faltantes: ${created}`);
            return res.json({ dryRun: false, action, empresa, detected: faltantes.length, created });
        }

        return res.status(400).json({
            error: 'Acción no soportada.',
            allowed: ['corregir-estados-invalidos', 'crear-tiendas-faltantes', 'crear-categorias-faltantes', 'aplicar-decisiones-objetos']
        });
    } catch (e) {
        console.error('[HIGIENE] Error en apply:', e.message);
        res.status(500).json({ error: 'No se pudo ejecutar la acción de higiene.' });
    }
});

// --- RUTAS DE TENDENCIAS Y MONOPOLIO ---

app.get('/api/monopolio/urls/search', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const q = String(req.query?.q || '').trim();
        const limitRaw = Number.parseInt(String(req.query?.limit || '25'), 10);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 100)) : 25;

        const baseFilter = { empresa };
        if (!q) {
            const recientes = await MonopolioUrl.find(baseFilter)
                .sort({ createdAt: -1 })
                .limit(limit)
                .lean();
            return res.json({ empresa, q: '', total: recientes.length, items: recientes });
        }

        const regex = new RegExp(escapeRegexSafe(q), 'i');
        const filter = {
            ...baseFilter,
            $or: [
                { alias: regex },
                { url: regex }
            ]
        };

        const items = await MonopolioUrl.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        res.json({ empresa, q, total: items.length, items });
    } catch (e) {
        res.status(500).json({ error: 'No se pudo buscar URLs de monopolio.' });
    }
});

app.get('/api/monopolio/urls', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const urls = await MonopolioUrl.find({ empresa }).sort({ alias: 1, createdAt: -1 }).lean();
        console.log(`[MONOPOLIO] GET urls empresa=${empresa} total=${urls.length}`);
        res.json(urls);
    } catch (e) {
        res.status(500).json({ error: 'Error al cargar las URLs de monopolio.' });
    }
});

app.post('/api/monopolio/urls', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { url, alias } = req.body;
        console.log(`[MONOPOLIO] POST url empresa=${empresa} url=${String(url || '').slice(0, 140)} alias=${String(alias || '').slice(0, 80)}`);
        if (!url) return res.status(400).json({ error: 'La URL es obligatoria.' });

        const urlNormalizada = normalizarUrlObjetivo(url);
        const aliasLimpio = String(alias || '').trim() || sugerirAliasDesdeUrl(urlNormalizada);
        const nuevaUrl = new MonopolioUrl({ empresa, url: urlNormalizada, alias: aliasLimpio });
        await nuevaUrl.save();
        await registrarLog(req.session.email, `Añadió URL a Monopolio: ${aliasLimpio || urlNormalizada || 'sin alias'}`);
        res.status(201).json(nuevaUrl);
    } catch (e) {
        if (e.code === 11000) {
            const empresa = empresaActual(req);
            const urlNormalizada = normalizarUrlObjetivo(req.body?.url || '');
            const aliasLimpio = String(req.body?.alias || '').trim();
            const existente = await MonopolioUrl.findOne({ empresa, url: urlNormalizada });
            if (!existente) return res.status(409).json({ error: 'Esa URL ya está guardada.' });

            if (aliasLimpio && aliasLimpio !== existente.alias) {
                existente.alias = aliasLimpio;
                await existente.save();
            }

            return res.json({ ...existente.toObject(), actualizada: true, duplicada: true, mensaje: 'La URL ya existía; se ha mantenido/actualizado su alias.' });
        }
        res.status(500).json({ error: 'No se pudo guardar la URL.' });
    }
});

app.put('/api/monopolio/urls/:id', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { id } = req.params;
        const { url, alias } = req.body;
        if (!url) return res.status(400).json({ error: 'La URL es obligatoria.' });

        const urlNormalizada = normalizarUrlObjetivo(url);
        const aliasLimpio = String(alias || '').trim() || sugerirAliasDesdeUrl(urlNormalizada);

        const actualizada = await MonopolioUrl.findOneAndUpdate(
            { _id: id, empresa },
            { url: urlNormalizada, alias: aliasLimpio },
            { new: true }
        );
        if (!actualizada) return res.status(404).json({ error: 'URL no encontrada.' });
        await registrarLog(req.session.email, `Modificó URL de Monopolio: ${aliasLimpio || urlNormalizada}`);
        res.json(actualizada);
    } catch (e) {
        if (e.code === 11000) {
            return res.status(409).json({ error: 'Ya existe otra URL igual en Monopolio.' });
        }
        res.status(500).json({ error: 'No se pudo actualizar la URL.' });
    }
});

app.delete('/api/monopolio/urls/:id', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { id } = req.params;
        const borrada = await MonopolioUrl.findOneAndDelete({ _id: id, empresa });
        if (!borrada) return res.status(404).json({ error: 'URL no encontrada.' });
        await registrarLog(req.session.email, `Eliminó URL de Monopolio: ${borrada.alias || borrada.url}`);
        res.sendStatus(204);
    } catch (e) {
        res.status(500).json({ error: 'No se pudo eliminar la URL.' });
    }
});

// Endpoint para disparar el scraping de todas las URLs guardadas
app.post('/api/monopolio/scrape-all', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const urls = await MonopolioUrl.find({ empresa }).lean();
        console.log(`[MONOPOLIO] scrape-all empresa=${empresa} urls=${urls.length}`);
        if (urls.length === 0) {
            return res.status(400).json({ error: 'No hay URLs guardadas para scrapear.' });
        }

        let lanzadas = 0;
        const errores = [];

        for (const item of urls) {
            try {
                await lanzarScraperUnificadoGithub({
                    mode: 'monopolio',
                    targetUrl: item.url,
                    empresa,
                    alias: String(item.alias || '').trim() || sugerirAliasDesdeUrl(item.url),
                    webhookPath: '/api/monopolio/webhook-github',
                    logTag: 'GITHUB-UNIFIED-MONOPOLIO'
                });
                lanzadas += 1;
            } catch (errItem) {
                errores.push({
                    url: item.url,
                    alias: item.alias || item.url,
                    detalle: errItem?.response?.data?.message || errItem?.response?.data?.error || errItem.message || 'error desconocido'
                });
            }
            await new Promise(resolve => setTimeout(resolve, 800));
        }

        const fallbackItems = errores.map((e) => ({ url: e.url, alias: e.alias || e.url }));
        if (fallbackItems.length > 0) {
            lanzarFallbackMonopolioLocal(empresa, fallbackItems);
        }

        if (lanzadas === 0 && fallbackItems.length > 0) {
            return res.json({
                success: true,
                lanzadas: 0,
                lanzadasLocal: fallbackItems.length,
                fallidas: 0,
                detallesFallos: [],
                message: `GitHub no respondió. Se lanzó fallback local para ${fallbackItems.length} URL(s).`
            });
        }

        if (lanzadas === 0) {
            return res.status(500).json({
                error: 'No se pudo lanzar ninguna tarea de scraping en GitHub Actions.',
                detalles: errores
            });
        }

        res.json({
            success: true,
            lanzadas,
            lanzadasLocal: fallbackItems.length,
            fallidas: errores.length,
            detallesFallos: errores,
            message: `Se han lanzado ${lanzadas}/${urls.length} tareas de scraping en GitHub Actions.${fallbackItems.length ? ` Fallback local activo: ${fallbackItems.length}.` : ''}`
        });

    } catch (error) {
        console.error('[MONOPOLIO-API] Error al lanzar workflows:', error.response?.data || error.message);
        res.status(500).json({ error: 'No se pudieron iniciar las tareas de scraping remoto.' });
    }
});

// Endpoint para lanzar scraping de URLs seleccionadas sin persistir en base de datos
app.post('/api/monopolio/scrape-selected', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const entrada = Array.isArray(req.body?.urls) ? req.body.urls : [];

        const normalizadas = [];
        const dedupe = new Set();

        for (const item of entrada) {
            const rawUrl = typeof item === 'string' ? item : item?.url;
            if (!rawUrl) continue;

            const url = normalizarUrlObjetivo(rawUrl);
            if (!url || dedupe.has(url)) continue;

            const aliasRaw = typeof item === 'object' && item ? item.alias : '';
            const alias = String(aliasRaw || '').trim() || sugerirAliasDesdeUrl(url);

            dedupe.add(url);
            normalizadas.push({ url, alias });
        }

        console.log(`[MONOPOLIO] scrape-selected empresa=${empresa} urls=${normalizadas.length}`);

        if (normalizadas.length === 0) {
            return res.status(400).json({ error: 'No hay URLs válidas seleccionadas para scrapear.' });
        }

        if (normalizadas.length > 25) {
            return res.status(400).json({ error: 'Máximo 25 URLs por ejecución en modo sin guardar.' });
        }

        let lanzadas = 0;
        const errores = [];

        for (const item of normalizadas) {
            try {
                await lanzarScraperUnificadoGithub({
                    mode: 'monopolio',
                    targetUrl: item.url,
                    empresa,
                    alias: item.alias,
                    webhookPath: '/api/monopolio/webhook-github',
                    logTag: 'GITHUB-UNIFIED-MONOPOLIO'
                });
                lanzadas += 1;
            } catch (errItem) {
                errores.push({
                    url: item.url,
                    alias: item.alias || item.url,
                    detalle: errItem?.response?.data?.message || errItem?.response?.data?.error || errItem.message || 'error desconocido'
                });
            }
            await new Promise(resolve => setTimeout(resolve, 800));
        }

        const fallbackItems = errores.map((e) => ({ url: e.url, alias: e.alias || e.url }));
        if (fallbackItems.length > 0) {
            lanzarFallbackMonopolioLocal(empresa, fallbackItems);
        }

        if (lanzadas === 0 && fallbackItems.length > 0) {
            return res.json({
                success: true,
                lanzadas: 0,
                lanzadasLocal: fallbackItems.length,
                fallidas: 0,
                detallesFallos: [],
                totalSolicitadas: normalizadas.length,
                message: `GitHub no respondió. Fallback local iniciado para ${fallbackItems.length} URL(s).`
            });
        }

        if (lanzadas === 0) {
            return res.status(500).json({
                error: 'No se pudo lanzar ninguna tarea de scraping en GitHub Actions.',
                detalles: errores
            });
        }

        res.json({
            success: true,
            lanzadas,
            lanzadasLocal: fallbackItems.length,
            fallidas: errores.length,
            detallesFallos: errores,
            totalSolicitadas: normalizadas.length,
            message: `Se han lanzado ${lanzadas}/${normalizadas.length} tareas de scraping (modo sin guardar).${fallbackItems.length ? ` Fallback local activo: ${fallbackItems.length}.` : ''}`
        });
    } catch (error) {
        console.error('[MONOPOLIO-API] Error al lanzar workflows seleccionados:', error.response?.data || error.message);
        res.status(500).json({ error: 'No se pudieron iniciar las tareas de scraping seleccionadas.' });
    }
});

// Descubre perfiles desde una URL de Monopolio sin scrapear productos (pasada 1)
app.post('/api/monopolio/discover-profiles', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const rawUrl = String(req.body?.url || '').trim();
        if (!rawUrl) return res.status(400).json({ error: 'La URL es obligatoria.' });

        const url = normalizarUrlObjetivo(rawUrl);
        if (!url) return res.status(400).json({ error: 'La URL no es valida.' });

        const alias = String(req.body?.alias || sugerirAliasDesdeUrl(url)).trim() || sugerirAliasDesdeUrl(url);
        const maxProfilesRaw = Number.parseInt(req.body?.maxProfiles, 10);
        const maxProfiles = Number.isFinite(maxProfilesRaw)
            ? Math.max(1, Math.min(maxProfilesRaw, 600))
            : undefined;

        const resultado = await scrapeMonopolio(url, alias, {
            discoverOnly: true,
            maxProfiles
        });

        const perfilesCrudos = Array.isArray(resultado?.perfiles) ? resultado.perfiles : [];
        const dedupe = new Map();
        for (const p of perfilesCrudos) {
            const urlPerfil = normalizarUrlObjetivo(String(p?.url || '').trim());
            if (!urlPerfil || dedupe.has(urlPerfil)) continue;
            dedupe.set(urlPerfil, {
                url: urlPerfil,
                alias: String(p?.alias || sugerirAliasDesdeUrl(urlPerfil)).trim() || sugerirAliasDesdeUrl(urlPerfil),
                nivelCadena: Number(p?.nivelCadena || 0),
                parentUrl: String(p?.parentUrl || '').trim(),
                parentAlias: String(p?.parentAlias || '').trim()
            });
        }

        const perfiles = Array.from(dedupe.values());
        await registrarLog(req.session.email, `Descubrió perfiles Monopolio desde ${alias} (${perfiles.length} detectados)`);

        return res.json({
            success: true,
            empresa,
            urlOrigen: url,
            alias,
            total: perfiles.length,
            perfiles,
            exploracion: resultado?.exploracion || null
        });
    } catch (error) {
        console.error('[MONOPOLIO-DISCOVER] Error descubriendo perfiles:', error?.message || error);
        return res.status(500).json({ error: 'No se pudieron descubrir perfiles desde la URL indicada.' });
    }
});

// Webhook para recibir datos del scraper de monopolio
app.post('/api/monopolio/webhook-github', async (req, res) => {
    const token = req.headers['x-github-token'];
    const GITHUB_SECRET = process.env.SCRAPER_TOKEN;

    if (!GITHUB_SECRET || token !== GITHUB_SECRET) return res.status(401).json({ error: 'No autorizado' });

    try {
        const { productos, grupos, esModoSeguidos, exploracion, urlOrigen, empresa, alias, error: errorMsg } = req.body;
        const empresaNormalizada = normalizarEmpresa(empresa || EMPRESA_DEFAULT);

        if (errorMsg) {
            console.error(`[MONOPOLIO-WEBHOOK-ERROR] Recibido error de scraper: ${errorMsg}`);
            if (global.io) {
                global.io.to(`empresa:${empresaNormalizada}`).emit('monopolio_update', {
                    error: errorMsg,
                    empresa: empresaNormalizada,
                    urlOrigen,
                    alias,
                    timestamp: new Date()
                });
            }
            return res.json({ success: true, status: 'error_received' });
        }

        console.log(`[MONOPOLIO-WEBHOOK] Recibidos ${(productos || []).length} productos de ${alias || urlOrigen}`);
        if (global.io) {
            global.io.to(`empresa:${empresaNormalizada}`).emit('monopolio_update', {
                mensaje: `Scraping finalizado para ${alias || urlOrigen}.`,
                productos: productos || [],
                grupos: Array.isArray(grupos) ? grupos : [],
                esModoSeguidos: Boolean(esModoSeguidos),
                exploracion: exploracion || null,
                urlOrigen,
                alias,
                empresa: empresaNormalizada,
                timestamp: new Date()
            });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error procesando webhook de monopolio' });
    }
});
