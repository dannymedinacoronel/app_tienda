require('dotenv').config(); 
const express = require('express');
const { OAuth2Client } = require('google-auth-library'); 
const session = require('express-session'); 
const MongoStore = require('connect-mongo').default; // Corregido para manejar el export por defecto
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const compression = require('compression');
const axios = require('axios');
const nodemailer = require('nodemailer');
const http = require('http');
const { Server } = require('socket.io');
const { scrapeMonopolio, scrapeVinted, obtenerFichaItemVinted, ejecutarConConcurrencia } = require('./scripts/scraper-engine');

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
// gzip/brotli para HTML, JS, CSS y JSON: app.js e index.html pasan de ~640KB a ~120KB.
app.use(compression({ threshold: 1024 }));
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
            },
            timeout: 15000
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

// --- Disponibilidad de GitHub Actions ---
// Con la cuenta de GitHub bloqueada (facturación) o sin minutos, el dispatch se acepta pero
// el job muere en segundos sin ejecutar ningún paso. Lo detectamos y escaneamos desde aquí.
const GITHUB_PAUSA_TRAS_FALLO_MS = 30 * 60 * 1000;
let GITHUB_ACTIONS_NO_DISPONIBLE_HASTA = 0;

function githubActionsDisponible() {
    return Boolean(process.env.GITHUB_PAT) && Date.now() > GITHUB_ACTIONS_NO_DISPONIBLE_HASTA;
}

function marcarGithubNoDisponible(motivo) {
    GITHUB_ACTIONS_NO_DISPONIBLE_HASTA = Date.now() + GITHUB_PAUSA_TRAS_FALLO_MS;
    console.warn(`[GITHUB] Actions no disponible (${motivo}). Durante 30 min se escanea desde el servidor.`);
}

// true si algún run lanzado desde `desdeMs` terminó en fallo sin llegar a ejecutar ningún paso.
async function hayRunsGithubQueNoArrancaron(desdeMs) {
    const owner = process.env.GITHUB_OWNER || 'dannymedinacoronel';
    const repo = process.env.GITHUB_REPO || 'app_tienda';
    const headers = { Authorization: `token ${process.env.GITHUB_PAT}`, Accept: 'application/vnd.github.v3+json' };
    const { data } = await axios.get(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/vinted-scraper.yml/runs`, {
        params: { event: 'workflow_dispatch', per_page: 20 },
        headers,
        timeout: 10000
    });
    const fallidos = (data?.workflow_runs || []).filter((run) => (
        new Date(run.created_at).getTime() >= desdeMs - 15000
        && run.status === 'completed'
        && run.conclusion === 'failure'
    ));
    for (const run of fallidos) {
        const jobs = await axios.get(run.jobs_url, { headers, timeout: 10000 });
        if ((jobs.data?.jobs || []).some((job) => !Array.isArray(job.steps) || job.steps.length === 0)) return true;
    }
    return false;
}

// Tras lanzar en GitHub comprobamos (a los ~25 s y ~70 s) que los jobs arrancan de verdad.
function vigilarArranqueGithub(desdeMs, alNoArrancar) {
    const comprobar = async (intento) => {
        try {
            if (await hayRunsGithubQueNoArrancaron(desdeMs)) {
                marcarGithubNoDisponible('los jobs no arrancan: cuenta de GitHub bloqueada o sin minutos');
                alNoArrancar();
                return;
            }
        } catch (error) {
            console.warn('[GITHUB] No se pudo comprobar el estado de Actions:', error.message);
        }
        if (intento < 2) setTimeout(() => comprobar(intento + 1), 45000);
    };
    setTimeout(() => comprobar(1), 25000);
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
    color: { type: String, default: '#38bdf8', trim: true },
    // Perfil de Vinted de esta tienda: permite comprobar ventas sin volver a escanear a mano.
    vintedPerfilUrl: { type: String, default: '', trim: true },
    fechaCreacion: { type: Date, default: Date.now }
});
TiendaSchema.index({ empresa: 1, nombre: 1 }, { unique: true });
const Tienda = mongoose.models.Tienda || mongoose.model('Tienda', TiendaSchema);

// Opciones de "Comprobar ventas en Vinted" de cada empresa (las guarda el Admin desde la app).
const ConfigVintedSchema = new mongoose.Schema({
    empresa: { type: String, required: true, unique: true, trim: true, lowercase: true },
    avisar: {
        vendido: { type: Boolean, default: true },
        no_visible: { type: Boolean, default: true },
        eliminado: { type: Boolean, default: true }
    },
    registrarVendidosAuto: { type: Boolean, default: false },
    autoCadaHoras: { type: Number, default: 0 }, // 0 = solo cuando se pulsa el botón
    maxAnuncios: { type: Number, default: 80 },
    completarFichas: { type: Boolean, default: true },
    avisoVoz: { type: Boolean, default: true },
    ultimaComprobacion: { type: Date, default: null },
    ultimaComprobacionPor: { type: String, default: '' },
    ultimoResumen: { type: Object, default: null },
    actualizadoPor: { type: String, default: '' },
    actualizadoEn: { type: Date, default: Date.now }
});
const ConfigVinted = mongoose.models.ConfigVinted || mongoose.model('ConfigVinted', ConfigVintedSchema);

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
ClienteSchema.index({ empresa: 1, nombre: 1 });
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
GastoSchema.index({ empresa: 1, fecha: -1 });
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
    gastoPromocion: { type: Number, default: 0 },
    canalVenta: { type: String, enum: ['Tienda Física', 'Vinted', 'Wallapop', 'Web'], default: 'Tienda Física' }, 
    rating: { type: Number, default: 0, min: 0, max: 5 },
    estado: { type: String, default: 'No Vendido' },
    comentariosProducto: { type: String, default: '', trim: true },
    tienda: { type: mongoose.Schema.Types.ObjectId, ref: 'Tienda' },
    imagen: { type: String, default: '' },
    galeria: { type: [String], default: [] },
    fechaVenta: { type: String, default: '' },
    loteVendido: { type: Boolean, default: false },
    loteVentaEtiqueta: { type: String, default: '', trim: true },
    facturado: { type: Boolean, default: false },
    cliente: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente' },
    // Ficha completa traída de Vinted. Las fotos se guardan como URL de su CDN (no ocupan espacio).
    descripcion: { type: String, default: '', trim: true },
    color: { type: String, default: '', trim: true },
    categoriaVinted: { type: String, default: '', trim: true },
    imagenMiniatura: { type: String, default: '' },
    // Enlace con el anuncio de Vinted y estado detectado por el scraper.
    vintedId: { type: String, default: '', trim: true },
    vintedUrl: { type: String, default: '', trim: true },
    vintedVendedorId: { type: String, default: '', trim: true },
    vintedEstado: { type: String, default: '' },       // activo | reservado | vendido | eliminado | oculto | no_visible
    vintedRevisadoEn: { type: Date },
    vintedAviso: { type: String, default: '' },        // vendido | no_visible | eliminado (pendiente de revisar)
    vintedAvisoEn: { type: Date },
    vintedAvisoIgnorado: { type: String, default: '' } // aviso que el usuario descartó (no se repite)
});
// Todas las consultas filtran por empresa: sin estos índices cada carga del panel recorría la colección entera.
VentaRopaSchema.index({ empresa: 1, _id: -1 });
VentaRopaSchema.index({ empresa: 1, canalVenta: 1 });
VentaRopaSchema.index({ empresa: 1, sku: 1 });
VentaRopaSchema.index({ empresa: 1, tienda: 1 });
VentaRopaSchema.index({ empresa: 1, vintedId: 1 });
VentaRopaSchema.index({ empresa: 1, vintedVendedorId: 1 });
VentaRopaSchema.index({ empresa: 1, vintedAviso: 1 });
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
LogAuditoriaSchema.index({ empresa: 1, fechaHora: -1 });
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
TareaSchema.index({ empresa: 1, fechaCreacion: -1 });
const Tarea = mongoose.models.Tarea || mongoose.model('Tarea', TareaSchema);

const FaqSchema = new mongoose.Schema({
    pregunta: { type: String, required: true, trim: true },
    empresa: { type: String, default: EMPRESA_DEFAULT, trim: true, lowercase: true },
    respuesta: { type: String, required: true, trim: true },
    fechaCreacion: { type: Date, default: Date.now }
});
FaqSchema.index({ empresa: 1 });
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
NotaSchema.index({ empresa: 1 });
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


const ADMIN_WHITELIST = (process.env.ADMIN_WHITELIST || 'dannymedinacoronel@gmail.com,juliamugo2001@gmail.com').split(',').map(e => e.trim().toLowerCase());

function normalizarClaveTexto(valor) {
    return String(valor || '').trim().toLowerCase();
}

function pareceObjectIdTexto(valor) {
    return /^[0-9a-f]{24}$/i.test(String(valor || '').trim());
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

// --- Resultados recientes de scraping ---
// Socket.IO solo entrega a quien está conectado en ese momento. Si el navegador se reconecta
// (Render dormido, red móvil...) mientras GitHub trabaja, el resultado se perdía. Guardamos
// los últimos eventos por empresa para que el panel los recupere al volver.
const EVENTOS_SCRAPER = new Map();
const EVENTOS_SCRAPER_LIMITES = {
    scraper_update: { max: 3, ttlMs: 60 * 60 * 1000 },
    monopolio_update: { max: 4, ttlMs: 30 * 60 * 1000 }
};

function emitirEventoScraper(empresa, tipo, data) {
    const evento = { ...data, eventoId: crypto.randomUUID(), timestamp: data?.timestamp || new Date() };
    const clave = `${empresa}|${tipo}`;
    const cfg = EVENTOS_SCRAPER_LIMITES[tipo] || { max: 3, ttlMs: 30 * 60 * 1000 };
    const ahora = Date.now();
    const lista = (EVENTOS_SCRAPER.get(clave) || []).filter((e) => (ahora - e.ts) < cfg.ttlMs);
    lista.push({ ts: ahora, evento });
    EVENTOS_SCRAPER.set(clave, lista.slice(-cfg.max));
    if (global.io) global.io.to(`empresa:${empresa}`).emit(tipo, evento);
    return evento;
}

io.on('connection', (socket) => {
    socket.on('join_empresa', () => {
        // La sala sale de la sesión del servidor, no del cliente: así nadie puede escuchar otra empresa.
        const sess = socket.request?.session;
        if (!sess || !sess.esAdmin) return;
        socket.join(`empresa:${normalizarEmpresa(sess.empresa || EMPRESA_DEFAULT)}`);
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

const sessionMiddleware = session({
    name: 'seychelles.sid',
    secret: process.env.SESSION_SECRET || 'clave_maestra_seychelles_987654321',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    store: MONGO_URI_FINAL ? MongoStore.create({
        mongoUrl: MONGO_URI_FINAL,
        collectionName: 'sesiones_activas',
        ttl: 14 * 24 * 60 * 60,
        touchAfter: 12 * 60 * 60
    }) : undefined,
    cookie: {
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        maxAge: 14 * 24 * 60 * 60 * 1000
    }
});
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

// --- Frontend estático con versionado automático ---
// index.html se sirve con el hash de app.js/CSS en la URL: los assets se cachean un año
// y cada despliegue cambia el hash, así nadie se queda con un frontend viejo.
const PUBLIC_DIR = path.join(__dirname, 'public');
const ASSETS_VERSIONADOS = ['app.js', 'styles.css', 'tailwind.generated.css'];

function hashCorto(contenido) {
    return crypto.createHash('md5').update(contenido).digest('hex').slice(0, 10);
}

function construirIndexHtml() {
    let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    for (const asset of ASSETS_VERSIONADOS) {
        let version = 'dev';
        try { version = hashCorto(fs.readFileSync(path.join(PUBLIC_DIR, asset))); } catch (_) {}
        const escaped = asset.replace(/\./g, '\\.');
        html = html.replace(new RegExp(`(["'])${escaped}(?:\\?v=[^"']*)?\\1`, 'g'), `$1${asset}?v=${version}$1`);
    }
    return { html, etag: `"${hashCorto(html)}"` };
}

let INDEX_HTML_CACHE = null;
function obtenerIndexHtml() {
    if (!isProd || !INDEX_HTML_CACHE) INDEX_HTML_CACHE = construirIndexHtml();
    return INDEX_HTML_CACHE;
}

function enviarIndexHtml(req, res) {
    const { html, etag } = obtenerIndexHtml();
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.type('html').send(html);
}

app.get(['/', '/index.html'], enviarIndexHtml);

app.use(express.static(PUBLIC_DIR, {
    index: false,
    etag: true,
    lastModified: true,
    setHeaders: (res) => {
        // Con ?v=hash el contenido es inmutable; sin él, el navegador revalida (304 si no cambió).
        if (res.req?.query?.v) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
            res.setHeader('Cache-Control', isProd ? 'public, max-age=3600' : 'no-cache');
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
        safe.gastoPromocion = 0;
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

const EMPRESA_POR_EMAIL_CACHE = new Map();
const EMPRESA_POR_EMAIL_TTL_MS = 5 * 60 * 1000;

async function empresaDeUsuario(usuario) {
    const email = String(usuario || '').toLowerCase().trim();
    const hit = EMPRESA_POR_EMAIL_CACHE.get(email);
    if (hit && (Date.now() - hit.ts) < EMPRESA_POR_EMAIL_TTL_MS) return hit.empresa;
    const usuarioDoc = await UsuarioAutorizado.findOne({ email }).select('empresa').lean();
    const empresa = normalizarEmpresa(usuarioDoc?.empresa || EMPRESA_DEFAULT);
    EMPRESA_POR_EMAIL_CACHE.set(email, { empresa, ts: Date.now() });
    return empresa;
}

async function guardarLog(usuario, accion, locationData = {}) {
    try {
        const empresa = await empresaDeUsuario(usuario);
        await LogAuditoria.create({ empresa, usuario, accion, ...locationData });
    } catch (e) { console.error("Error al guardar log:", e); }
}

// El log de auditoría no debe retrasar la respuesta al usuario: se guarda en segundo plano.
function registrarLog(usuario, accion, locationData = {}) {
    guardarLog(usuario, accion, locationData);
    return Promise.resolve();
}

// Geolocaliza y registra el evento sin bloquear la petición (login/logout).
function registrarLogConUbicacion(req, usuario, accion, clientLocation) {
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',').shift() || req.socket?.remoteAddress;
    obtenerUbicacionCompleta(ip, clientLocation)
        .catch(() => ({ ip }))
        .then((locationData) => guardarLog(usuario, accion, locationData));
}

// --- Motor de Geolocalización Precisa (IP + HTML5) ---
async function obtenerUbicacionCompleta(ip, clientLocation) {
    let locationData = { ip };

    try {
        const geoRes = await axios.get(`http://ip-api.com/json/${encodeURIComponent(ip || '')}?fields=status,message,country,city,lat,lon`, { timeout: 4000 });
        if (geoRes.data && geoRes.data.status === 'success') {
            locationData.ciudad = geoRes.data.city; locationData.pais = geoRes.data.country;
            locationData.lat = geoRes.data.lat; locationData.lon = geoRes.data.lon;
        }
    } catch (e) { console.warn(`[GEO-IP] Fallo al obtener localización por IP:`, e.message); }

    // Si el navegador proporcionó coordenadas exactas GPS/HTML5, las usamos y buscamos la ciudad real
    const latCliente = Number(clientLocation?.lat);
    const lonCliente = Number(clientLocation?.lon);
    if (Number.isFinite(latCliente) && Number.isFinite(lonCliente) && (latCliente || lonCliente)) {
        locationData.lat = latCliente;
        locationData.lon = lonCliente;
        try {
            // Búsqueda Inversa para saber a qué ciudad pertenecen las coordenadas HTML5
            const reverseGeo = await axios.get(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latCliente}&lon=${lonCliente}`, { headers: { 'User-Agent': 'Seychelles-App/1.0' }, timeout: 4000 });
            if (reverseGeo.data && reverseGeo.data.address) {
                locationData.ciudad = reverseGeo.data.address.city || reverseGeo.data.address.town || reverseGeo.data.address.village || locationData.ciudad;
                locationData.pais = reverseGeo.data.address.country || locationData.pais;
            }
        } catch(e) { console.warn("[GEO-HTML5] Fallo reverse geocoding"); }
    }

    return locationData;
}


// --- Fotos servidas por URL en vez de incrustadas en el JSON ---
// Las fotos se guardan como data URL base64 dentro de cada producto. Mandarlas en cada
// listado hacía que /api/ventas pesara megas. Ahora el listado lleva URLs cortas
// (/api/ventas/:id/foto/:n?v=firma) que el navegador descarga una vez y cachea.
const REF_FOTO_VENTA_RE = /^\/api\/ventas\/([a-f0-9]{24})\/foto\/(\d+)(?:\?.*)?$/i;
const REF_FOTO_USUARIO_RE = /^\/api\/usuarios\/([a-f0-9]{24})\/foto(?:\?.*)?$/i;

// Metadatos baratos de una foto calculados en Mongo (sin traer el base64 completo).
// Solo se aplica a data URLs base64 (ASCII), así $substrBytes nunca corta un carácter.
function exprMetaFoto(campo) {
    return {
        $let: {
            vars: { s: { $cond: [{ $eq: [{ $type: campo }, 'string'] }, campo, ''] } },
            in: {
                $cond: [
                    {
                        $and: [
                            { $eq: [{ $substrCP: ['$$s', 0, 5] }, 'data:'] },
                            { $gt: [{ $indexOfCP: ['$$s', ';base64,', 0, 120] }, -1] }
                        ]
                    },
                    {
                        len: { $strLenBytes: '$$s' },
                        mid: { $substrBytes: ['$$s', { $floor: { $divide: [{ $strLenBytes: '$$s' }, 2] } }, 16] },
                        tail: { $substrBytes: ['$$s', { $max: [0, { $subtract: [{ $strLenBytes: '$$s' }, 24] }] }, 24] }
                    },
                    '$$s'
                ]
            }
        }
    };
}

function firmaMetaFoto(meta) {
    return hashCorto(`${meta.len}|${meta.mid}|${meta.tail}`);
}

function valorFotoDesdeMeta(meta, construirUrl) {
    if (meta && typeof meta === 'object') return construirUrl(firmaMetaFoto(meta));
    return typeof meta === 'string' ? meta : '';
}

function firmaFotoDesdeValor(valor) {
    const s = String(valor || '');
    const len = Buffer.byteLength(s);
    const mitad = Math.floor(len / 2);
    return firmaMetaFoto({ len, mid: s.slice(mitad, mitad + 16), tail: s.slice(Math.max(0, len - 24)) });
}

// Sustituye imagenMeta/galeriaMeta (calculados en la agregación) por URLs servibles.
function adjuntarUrlsFotosVenta(venta) {
    const id = String(venta._id);
    venta.imagen = valorFotoDesdeMeta(venta.imagenMeta, (v) => `/api/ventas/${id}/foto/0?v=${v}`);
    venta.galeria = (Array.isArray(venta.galeriaMeta) ? venta.galeriaMeta : [])
        .map((meta, i) => valorFotoDesdeMeta(meta, (v) => `/api/ventas/${id}/foto/${i + 1}?v=${v}`))
        .filter(Boolean);
    delete venta.imagenMeta;
    delete venta.galeriaMeta;
    return venta;
}

function enviarFotoDataUrl(res, valor) {
    const s = typeof valor === 'string' ? valor : '';
    if (/^https?:\/\//i.test(s)) return res.redirect(302, s);
    const m = s.match(/^data:([^;,]*)(;base64)?,/i);
    if (!m || !/^image\//i.test(m[1] || '')) return res.sendStatus(404);
    const contenido = s.slice(m[0].length);
    const buffer = m[2] ? Buffer.from(contenido, 'base64') : Buffer.from(decodeURIComponent(contenido), 'utf8');
    res.setHeader('Content-Type', m[1]);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    return res.send(buffer);
}

// Convierte las URLs de foto que vuelve a mandar el cliente (editar, duplicar, reordenar
// galería...) en los datos reales guardados, para no perder nunca una imagen.
async function resolverFotosEntrantes(empresa, datos, idPropio = null) {
    if (!datos || typeof datos !== 'object') return datos;
    const tieneImagen = typeof datos.imagen === 'string';
    const tieneGaleria = Array.isArray(datos.galeria);
    if (!tieneImagen && !tieneGaleria) return datos;

    const propio = idPropio ? String(idPropio).toLowerCase() : null;
    const parsear = (valor) => {
        if (typeof valor !== 'string') return null;
        const m = valor.match(REF_FOTO_VENTA_RE);
        return m ? { id: m[1].toLowerCase(), n: parseInt(m[2], 10) } : null;
    };

    const ids = new Set();
    if (tieneImagen) { const r = parsear(datos.imagen); if (r) ids.add(r.id); }
    if (tieneGaleria) datos.galeria.forEach((g) => { const r = parsear(g); if (r) ids.add(r.id); });
    if (ids.size === 0) return datos;

    const docs = await VentaRopa.find({ _id: { $in: [...ids] }, empresa }).select('imagen galeria').lean();
    const porId = new Map(docs.map((d) => [String(d._id).toLowerCase(), d]));
    const valorDe = (ref) => {
        const doc = porId.get(ref.id);
        if (!doc) return null;
        const valor = ref.n === 0 ? doc.imagen : (Array.isArray(doc.galeria) ? doc.galeria[ref.n - 1] : null);
        return typeof valor === 'string' && valor ? valor : null;
    };

    if (tieneImagen) {
        const r = parsear(datos.imagen);
        if (r) {
            const valor = (propio && r.id === propio && r.n === 0) ? undefined : valorDe(r);
            // Misma portada (o referencia rota): no tocamos la imagen guardada.
            if (!valor) delete datos.imagen;
            else datos.imagen = valor;
        }
    }

    if (tieneGaleria) {
        const galeriaActual = propio ? porId.get(propio)?.galeria : null;
        const sinCambios = Array.isArray(galeriaActual)
            && galeriaActual.length === datos.galeria.length
            && datos.galeria.every((g, i) => { const r = parsear(g); return r && r.id === propio && r.n === i + 1; });
        if (sinCambios) {
            delete datos.galeria;
        } else {
            datos.galeria = datos.galeria
                .map((g) => { const r = parsear(g); return r ? valorDe(r) : g; })
                .filter((g) => typeof g === 'string' && g);
        }
    }
    return datos;
}

// Campos que el cliente nunca puede fijar en un producto (evita mover productos entre empresas).
function limpiarCamposProtegidosVenta(datos) {
    if (!datos || typeof datos !== 'object') return {};
    const limpio = { ...datos };
    delete limpio._id;
    delete limpio.__v;
    delete limpio.empresa;
    delete limpio.tienda;
    // El estado detectado en Vinted lo gestiona el servidor (el cliente podría mandarlo desfasado).
    delete limpio.vintedEstado;
    delete limpio.vintedRevisadoEn;
    delete limpio.vintedAviso;
    delete limpio.vintedAvisoEn;
    delete limpio.vintedAvisoIgnorado;
    return limpio;
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
    // Sin credenciales de correo no tiene sentido volcar toda la base de datos a memoria.
    if (!process.env.BACKUP_EMAIL_USER || !process.env.BACKUP_EMAIL_PASS) return;
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
        const colorLimpio = /^#[0-9a-f]{6}$/i.test(String(req.body.color || '').trim()) ? String(req.body.color).trim() : '#38bdf8';
        if (!nombreLimpio) return res.status(400).json({ error: 'El nombre es obligatorio.' });

        const nuevaTienda = new Tienda({ nombre: nombreLimpio, empresa, color: colorLimpio });
        await nuevaTienda.save();
        await registrarLog(req.session.email, `Creó la tienda en MongoDB: ${nuevaTienda.nombre}`);
        res.json({ status: 'success', tienda: nuevaTienda });
    } catch (e) {
        res.status(400).json({ error: 'La tienda ya existe o hay un error de validación.' });
    }
});

app.put('/api/tiendas/:id', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { id } = req.params;
        const updateData = {};
        const nombreLimpio = req.body.nombre ? String(req.body.nombre).trim() : '';
        const colorLimpio = String(req.body.color || '').trim();

        if (nombreLimpio) updateData.nombre = nombreLimpio;
        if (colorLimpio) {
            if (!/^#[0-9a-f]{6}$/i.test(colorLimpio)) return res.status(400).json({ error: 'Color no válido.' });
            updateData.color = colorLimpio;
        }
        if (Object.keys(updateData).length === 0) return res.status(400).json({ error: 'Sin cambios para guardar.' });

        const tiendaActualizada = await Tienda.findOneAndUpdate({ _id: id, empresa }, updateData, { new: true });
        if (!tiendaActualizada) return res.status(404).json({ error: 'La tienda no existe.' });

        await registrarLog(req.session.email, `Actualizó la tienda "${tiendaActualizada.nombre}".`);
        res.json({ status: 'success', tienda: tiendaActualizada });
    } catch (e) {
        res.status(400).json({ error: 'No se pudo actualizar la tienda.' });
    }
});

app.get('/api/tiendas/:id/inspeccion', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { id } = req.params;
        const tienda = await Tienda.findOne({ _id: id, empresa }).lean();
        if (!tienda) return res.status(404).json({ error: 'La tienda no existe.' });

        const nombreTienda = String(tienda.nombre || '').trim();
        const pareceFantasma = pareceObjectIdTexto(nombreTienda);

        const [asociadosPorRef, asociadosPorProveedor] = await Promise.all([
            VentaRopa.countDocuments({ empresa, tienda: id }),
            VentaRopa.countDocuments({ empresa, proveedor: { $in: [nombreTienda, id].filter(Boolean) } })
        ]);

        res.json({
            tienda: {
                _id: String(tienda._id),
                nombre: nombreTienda,
                color: tienda.color || '#38bdf8',
                pareceFantasma
            },
            impacto: {
                asociadosPorRef,
                asociadosPorProveedor,
                totalAfectados: Math.max(asociadosPorRef, asociadosPorProveedor)
            }
        });
    } catch (e) {
        res.status(500).json({ error: 'No se pudo inspeccionar la tienda.' });
    }
});

// BAJA DE TIENDA
app.delete('/api/tiendas/:id', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { id } = req.params;
        const force = String(req.query.force || '').toLowerCase() === '1';
        
        const tiendaPorBorrar = await Tienda.findOne({ _id: id, empresa });
        if (!tiendaPorBorrar) return res.status(404).json({ error: 'La tienda no existe.' });

        const nombreTienda = String(tiendaPorBorrar.nombre || '').trim();
        const candidatosProveedor = [nombreTienda, id].filter(Boolean);

        // Desasignar tienda de los productos asociados por referencia y limpiar proveedores fantasma.
        await VentaRopa.updateMany(
            {
                empresa,
                $or: [
                    { tienda: id },
                    { proveedor: { $in: candidatosProveedor } }
                ]
            },
            {
                $unset: { tienda: 1, proveedor: 1 }
            }
        );

        // Fuerza extra: si el nombre de la tienda ya era un ObjectId guardado como texto, límpialo también.
        if (force && pareceObjectIdTexto(nombreTienda)) {
            await VentaRopa.updateMany(
                { empresa, proveedor: nombreTienda },
                { $unset: { proveedor: 1 } }
            );
        }
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

// Salud del servicio: para el health check de Render y para pingers que eviten que se duerma.
app.get('/api/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
        ok: true,
        uptimeSeg: Math.round(process.uptime()),
        mongo: mongoose.connection.readyState === 1,
        githubActions: githubActionsDisponible() ? 'disponible' : 'no-disponible'
    });
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

// En el servidor web limitamos el tamaño de cada análisis para no saturar la instancia.
const MONOPOLIO_LOCAL_MAX_CUENTAS = Math.max(5, Math.min(parseInt(process.env.MONOPOLIO_LOCAL_MAX_CUENTAS, 10) || 120, 400));
const MONOPOLIO_LOCAL_EN_CURSO = new Set();

function lanzarFallbackMonopolioLocal(empresa, items = []) {
    const lista = (Array.isArray(items) ? items.filter(i => i?.url) : [])
        .filter((item) => !MONOPOLIO_LOCAL_EN_CURSO.has(`${empresa}|${normalizarUrlObjetivo(item.url)}`));
    if (lista.length === 0) return;
    lista.forEach((item) => MONOPOLIO_LOCAL_EN_CURSO.add(`${empresa}|${normalizarUrlObjetivo(item.url)}`));

    setTimeout(async () => {
        for (const item of lista) {
            const urlOrigen = normalizarUrlObjetivo(item.url);
            try {
                const alias = String(item.alias || sugerirAliasDesdeUrl(urlOrigen)).trim() || urlOrigen;
                const resultado = await scrapeMonopolio(urlOrigen, alias, {
                    maxProfiles: MONOPOLIO_LOCAL_MAX_CUENTAS,
                    timeBudgetMs: 90000
                });
                const grupos = Array.isArray(resultado?.grupos) ? resultado.grupos : [];
                const gruposConProductos = grupos.some((g) => Array.isArray(g?.productos) && g.productos.length);

                emitirEventoScraper(empresa, 'monopolio_update', {
                    mensaje: `Scraping local finalizado para ${alias}.`,
                    // Los grupos ya contienen los productos: no duplicamos la lista plana.
                    productos: gruposConProductos ? [] : (Array.isArray(resultado?.productos) ? resultado.productos : []),
                    grupos,
                    esModoSeguidos: Boolean(resultado?.esModoSeguidos),
                    exploracion: resultado?.exploracion || null,
                    urlOrigen,
                    alias,
                    empresa,
                    origen: 'fallback-local',
                    timestamp: new Date()
                });
            } catch (err) {
                emitirEventoScraper(empresa, 'monopolio_update', {
                    error: err?.message || 'Fallo en fallback local de monopolio.',
                    urlOrigen: item.url,
                    alias: item.alias || item.url,
                    empresa,
                    origen: 'fallback-local',
                    timestamp: new Date()
                });
            } finally {
                MONOPOLIO_LOCAL_EN_CURSO.delete(`${empresa}|${urlOrigen}`);
            }

            await esperar(350);
        }
    }, 25);
}

// Escaneo de un perfil desde el propio servidor (API de Vinted con sesión, sin navegador).
// Devuelve el evento emitido, o null si Vinted no respondió y conviene probar con GitHub.
async function escanearPerfilEnServidor(empresa, url, alias) {
    try {
        const { productos, resumen } = await scrapeVinted(url, { sinNavegador: true });
        const parcial = !resumen.apiRespondio;
        // Sin respuesta de la API solo tenemos (como mucho) la primera tanda del HTML:
        // si GitHub está disponible, preferimos su escaneo completo con navegador.
        if (parcial && (!productos.length || githubActionsDisponible())) return null;
        const aliasProveedor = String(alias || 'Vinted').trim().slice(0, 80) || 'Vinted';
        const conAlias = productos.map((p) => ({ ...p, proveedor: aliasProveedor, cuenta: aliasProveedor, origenGrupo: aliasProveedor }));
        console.log(`[SCRAPER-LOCAL] ${url} -> ${conAlias.length} productos${parcial ? ' (parcial)' : ''}`);
        return emitirEventoScraper(empresa, 'scraper_update', {
            mensaje: `Escaneo completado en el servidor: ${conAlias.length} productos.`,
            productos: conAlias,
            empresa,
            urlOrigen: url,
            origen: 'servidor',
            timestamp: new Date()
        });
    } catch (error) {
        console.warn(`[SCRAPER-LOCAL] ${url}: ${error.message}`);
        return null;
    }
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
            EMPRESA_POR_EMAIL_CACHE.delete(emailUsuario);

            registrarLogConUbicacion(req, emailUsuario, "Inició sesión en el sistema", clientLocation);

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
        res.json(await obtenerUsuariosConAvatarUrl({ empresa }));
    } catch (e) { res.status(500).json({ error: 'Error al cargar usuarios.' }); }
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
        const cambios = { nombreVisible };
        // Si llega la URL servida por /api/usuarios/:id/foto, la foto no ha cambiado.
        if (!REF_FOTO_USUARIO_RE.test(fotoPerfil)) cambios.fotoPerfil = fotoPerfil;

        const actualizado = await UsuarioAutorizado.findOneAndUpdate(
            { email },
            cambios,
            { new: true }
        ).lean();

        if (!actualizado) return res.status(404).json({ error: 'Perfil no encontrado.' });
        await registrarLog(req.session.email, 'Actualizó su perfil de usuario.');
        res.json({ success: true, perfil: actualizado });
    } catch (e) {
        res.status(500).json({ error: 'Error al guardar perfil.' });
    }
});

// Usuarios con el avatar como URL cacheable en lugar del base64 completo.
async function obtenerUsuariosConAvatarUrl(filtro) {
    const usuarios = await UsuarioAutorizado.aggregate([
        { $match: filtro },
        { $sort: { fechaAgregado: -1 } },
        { $addFields: { fotoMeta: exprMetaFoto('$fotoPerfil') } },
        { $project: { fotoPerfil: 0 } }
    ]);
    return usuarios.map((u) => {
        const id = String(u._id);
        u.fotoPerfil = valorFotoDesdeMeta(u.fotoMeta, (v) => `/api/usuarios/${id}/foto?v=${v}`);
        delete u.fotoMeta;
        return u;
    });
}

app.get('/api/usuarios/:id/foto', exigeAdmin, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(404);
        const empresa = empresaActual(req);
        const usuario = await UsuarioAutorizado.findOne({ _id: req.params.id, empresa }).select('fotoPerfil').lean();
        return enviarFotoDataUrl(res, usuario?.fotoPerfil);
    } catch (e) {
        return res.sendStatus(500);
    }
});

app.get('/api/mensajes/usuarios', exigeAdmin, async (req, res) => {
    try {
        const emailActual = (req.session?.email || '').toLowerCase().trim();
        const empresa = normalizarEmpresa(req.session?.empresa || EMPRESA_DEFAULT);

        // 3 consultas en total (antes eran 2 por cada usuario del equipo, cada 16 s de polling).
        const [usuarios, noLeidosAgg, ultimosAgg] = await Promise.all([
            obtenerUsuariosConAvatarUrl({ empresa, email: { $ne: emailActual } }),
            MensajeInterno.aggregate([
                { $match: { empresa, paraEmail: emailActual, leido: false } },
                { $group: { _id: '$deEmail', total: { $sum: 1 } } }
            ]),
            MensajeInterno.aggregate([
                { $match: { empresa, $or: [{ deEmail: emailActual }, { paraEmail: emailActual }] } },
                { $sort: { creadoEn: -1 } },
                { $project: { texto: 1, creadoEn: 1, deEmail: 1, otro: { $cond: [{ $eq: ['$deEmail', emailActual] }, '$paraEmail', '$deEmail'] } } },
                { $group: { _id: '$otro', texto: { $first: '$texto' }, creadoEn: { $first: '$creadoEn' }, deEmail: { $first: '$deEmail' } } }
            ])
        ]);
        const noLeidosPorEmail = new Map(noLeidosAgg.map((x) => [x._id, x.total]));
        const ultimoPorEmail = new Map(ultimosAgg.map((x) => [x._id, x]));

        const filtrados = usuarios.map((u) => {
            const ultimoMensaje = ultimoPorEmail.get(u.email);
            return {
                email: u.email,
                rol: u.rol || 'Editor',
                empresa: normalizarEmpresa(u.empresa || EMPRESA_DEFAULT),
                nombreVisible: u.nombreVisible || '',
                fotoPerfil: u.fotoPerfil || '',
                ultimaConexion: u.ultimaConexion || null,
                unread: Number(noLeidosPorEmail.get(u.email) || 0),
                ultimoMensaje: ultimoMensaje?.texto || '',
                ultimoMensajeTs: ultimoMensaje?.creadoEn || null,
                ultimoMensajeEsMio: ultimoMensaje?.deEmail === emailActual
            };
        });

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

// Autocompletado para nombres de producto
app.get('/api/productos/sugerir-nombre', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const query = String(req.query.q || '').trim();

        if (query.length < 2) {
            return res.json([]);
        }

        const regex = new RegExp(escapeRegexSafe(query), 'i');

        const pipeline = [
            { $match: { empresa, prenda: regex } },
            { $group: { _id: '$prenda' } },
            { $sort: { _id: 1 } },
            { $limit: 8 },
            { $project: { prenda: '$_id', _id: 0 } }
        ];
        const resultados = await VentaRopa.aggregate(pipeline);
        const sugerencias = resultados.map(item => item.prenda);

        res.json(sugerencias);
    } catch (error) {
        console.error('[SUGERIR-NOMBRE] Error en autocompletado:', error);
        res.status(500).json({ error: 'Error al obtener sugerencias de producto.' });
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

// Página de productos: ordena sobre una proyección mínima (sin fotos) y luego trae solo esa página.
async function obtenerPaginaVentas(empresa, skip, limit) {
    const ordenados = await VentaRopa.aggregate([
        { $match: { empresa } },
        { $project: { orden: { $max: ['$fechaModificacion', '$fechaVenta', '$fecha'] } } },
        { $sort: { orden: -1, _id: -1 } },
        { $skip: skip },
        { $limit: limit }
    ]);
    return obtenerDetalleVentas(empresa, ordenados.map((d) => d._id));
}

// Productos listos para el cliente (fotos como URL cacheable y nombre de tienda), en el orden de `ids`.
async function obtenerDetalleVentas(empresa, ids) {
    if (!ids.length) return [];
    const pipelineDetalle = (conMetaFotos) => [
        { $match: { _id: { $in: ids }, empresa } },
        { $lookup: { from: 'tiendas', let: { tiendaId: '$tienda' }, pipeline: [ { $match: { $expr: { $and: [ { $eq: ['$_id', '$$tiendaId'] }, { $eq: ['$empresa', empresa] } ] } } }, { $project: { nombre: 1 } } ], as: 'tiendaInfo' } },
        { $unwind: { path: '$tiendaInfo', preserveNullAndEmptyArrays: true } },
        {
            $addFields: {
                proveedor: { $ifNull: ['$tiendaInfo.nombre', '$proveedor'] },
                ...(conMetaFotos ? {
                    imagenMeta: exprMetaFoto('$imagen'),
                    galeriaMeta: { $map: { input: { $cond: [{ $isArray: '$galeria' }, '$galeria', []] }, as: 'g', in: exprMetaFoto('$$g') } }
                } : {})
            }
        },
        { $project: conMetaFotos ? { tiendaInfo: 0, imagen: 0, galeria: 0 } : { tiendaInfo: 0 } }
    ];

    let detalle;
    try {
        detalle = (await VentaRopa.aggregate(pipelineDetalle(true))).map(adjuntarUrlsFotosVenta);
    } catch (errMeta) {
        // Red de seguridad: si algún dato raro rompe el cálculo de metadatos, firmamos en Node.
        console.warn('[VENTAS] Metadatos de foto en Mongo fallaron, usando fallback:', errMeta.message);
        detalle = (await VentaRopa.aggregate(pipelineDetalle(false))).map((v) => {
            const id = String(v._id);
            const aUrl = (valor, n) => (typeof valor === 'string' && valor.startsWith('data:'))
                ? `/api/ventas/${id}/foto/${n}?v=${firmaFotoDesdeValor(valor)}`
                : (typeof valor === 'string' ? valor : '');
            v.imagen = aUrl(v.imagen, 0);
            v.galeria = (Array.isArray(v.galeria) ? v.galeria : []).map((g, i) => aUrl(g, i + 1)).filter(Boolean);
            return v;
        });
    }

    const porId = new Map(detalle.map((v) => [String(v._id), v]));
    return ids.map((id) => porId.get(String(id))).filter(Boolean);
}

app.get('/api/ventas', exigeRol(['Admin', 'Editor', 'Visualizador', 'Lector']), async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 60, 500));
        const offsetParam = parseInt(req.query.offset, 10);
        const skip = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : (page - 1) * limit;
        const lightweight = String(req.query.lightweight || '').toLowerCase() === '1' || page > 1;
        const includeLogs = String(req.query.includeLogs || '').toLowerCase() === '1';

        const estadosKanban = await EstadoKanban.find({ empresa }).select('nombre rolFinanciero').lean();
        const nombresEstadosVenta = estadosKanban.filter(e => e.rolFinanciero === 'Venta').map(e => e.nombre);

        const [ventas, totalVentas] = await Promise.all([
            obtenerPaginaVentas(empresa, skip, limit),
            VentaRopa.countDocuments({ empresa })
        ]);

        let resumen = { ingresos: 0, beneficio: 0, inversion: 0, prendasVendidas: 0, roi: 0, totalGastosOperativos: 0 };
        let logs = [];

        const cachedResumen = getKpiResumenCache(empresa);
        if (cachedResumen) {
            resumen = cachedResumen;
        } else {
            // Cálculo financiero siempre basado en artículos cuyo estado pertenece a Venta.
            const [summaryData] = await VentaRopa.aggregate([
                { $match: { empresa } },
                {
                    $group: {
                        _id: null,
                        totalInversion: {
                            $sum: {
                                $cond: [
                                    { $in: ['$estado', nombresEstadosVenta] },
                                    { $multiply: [{ $ifNull: ['$precioCompra', 0] }, { $ifNull: ['$cantidad', 1] }] },
                                    0
                                ]
                            }
                        },
                        totalGastosEnvio: {
                            $sum: {
                                $cond: [
                                    { $in: ['$estado', nombresEstadosVenta] },
                                    { $multiply: [{ $ifNull: ['$gastosEnvio', 0] }, { $ifNull: ['$cantidad', 1] }] },
                                    0
                                ]
                            }
                        },
                        totalPromocion: {
                            $sum: {
                                $cond: [
                                    { $in: ['$estado', nombresEstadosVenta] },
                                    { $multiply: [{ $ifNull: ['$gastoPromocion', 0] }, { $ifNull: ['$cantidad', 1] }] },
                                    0
                                ]
                            }
                        },
                        ingresosBrutos: {
                            $sum: {
                                $cond: [
                                    { $in: ['$estado', nombresEstadosVenta] },
                                    { $multiply: [{ $ifNull: ['$precioVenta', 0] }, { $ifNull: ['$cantidad', 1] }] },
                                    0
                                ]
                            }
                        },
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
                        comisionesVenta: {
                            $sum: {
                                $cond: [
                                    { $in: ['$estado', nombresEstadosVenta] },
                                    {
                                        $multiply: [
                                            {
                                                $cond: [
                                                    { $in: ['$canalVenta', ['Vinted', 'Wallapop']] },
                                                    { $multiply: [{ $ifNull: ['$precioVenta', 0] }, 0.05] },
                                                    0
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
            const ingresos = summaryData?.ingresosBrutos || 0;
            const ingresosNetos = summaryData?.ingresosNetos || 0;
            const prendasVendidas = summaryData?.prendasVendidas || 0;
            const inversionVentas = (summaryData?.totalInversion || 0) + (summaryData?.totalGastosEnvio || 0) + (summaryData?.totalPromocion || 0);
            const comisionesVenta = summaryData?.comisionesVenta || 0;
            const beneficioNeto = ingresosNetos - inversionVentas - totalGastosOperativos;
            const roi = (inversionVentas + totalGastosOperativos) > 0 ? (beneficioNeto / (inversionVentas + totalGastosOperativos)) * 100 : 0;

            resumen = { ingresos, beneficio: beneficioNeto, inversion: inversionVentas + totalGastosOperativos, prendasVendidas, roi, totalGastosOperativos };
            setKpiResumenCache(empresa, resumen);
        }

        if (!lightweight && includeLogs) {
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

        return res.json({
            resumen: resumenSeguroPorRol(resumen, req),
            ventas: sanitizarVentasParaRol(ventas, req),
            logs: logsSegurosPorRol(logs, req),
            totalPages: Math.ceil(totalVentas / limit),
            currentPage: page,
            total: totalVentas,
            offset: skip,
            limit
        });
    } catch (error) {
        console.error('Fallo en API /ventas:', error);
        return res.status(500).json({ error: 'Fallo al obtener datos de ventas.' });
    }
});

// Productos concretos por id (p. ej. para registrar la venta de uno que no está en la página cargada).
app.get('/api/ventas/por-ids', exigeRol(['Admin', 'Editor', 'Visualizador', 'Lector']), async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const ids = String(req.query.ids || '')
            .split(',')
            .map((id) => id.trim())
            .filter((id) => mongoose.isValidObjectId(id))
            .slice(0, 300)
            .map((id) => new mongoose.Types.ObjectId(id));
        const ventas = await obtenerDetalleVentas(empresa, ids);
        res.json({ ventas: sanitizarVentasParaRol(ventas, req) });
    } catch (error) {
        res.status(500).json({ error: 'No se pudieron cargar los productos.' });
    }
});

// Foto n de un producto (0 = portada, 1..N = galería). Cacheable: la URL lleva la firma del contenido.
app.get('/api/ventas/:id/foto/:n', exigeRol(['Admin', 'Editor', 'Visualizador', 'Lector']), async (req, res) => {
    try {
        const { id } = req.params;
        const n = parseInt(req.params.n, 10);
        if (!mongoose.isValidObjectId(id) || !Number.isInteger(n) || n < 0 || n > 500) return res.sendStatus(404);
        const empresa = empresaActual(req);
        const [doc] = await VentaRopa.aggregate([
            { $match: { _id: new mongoose.Types.ObjectId(id), empresa } },
            { $project: { _id: 0, foto: n === 0 ? '$imagen' : { $arrayElemAt: [{ $cond: [{ $isArray: '$galeria' }, '$galeria', []] }, n - 1] } } }
        ]);
        return enviarFotoDataUrl(res, doc?.foto);
    } catch (error) {
        return res.sendStatus(500);
    }
});

// Exportación completa (con fotos reales) para la copia de seguridad local.
// Se envía producto a producto desde un cursor: con miles de fotos base64 cargarlo todo
// en memoria podía tumbar una instancia pequeña de Render.
app.get('/api/ventas/export', exigeSoloAdmin, async (req, res) => {
    const empresa = empresaActual(req);
    let empezado = false;
    try {
        const tiendas = await Tienda.find({ empresa }).select('nombre').lean();
        const nombreTienda = new Map(tiendas.map((t) => [String(t._id), t.nombre]));
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="Backup_Seychelles_${new Date().toISOString().split('T')[0]}.json"`);
        res.write('[');
        empezado = true;
        let primero = true;
        for await (const v of VentaRopa.find({ empresa }).lean().cursor()) {
            const fila = JSON.stringify({ ...v, proveedor: nombreTienda.get(String(v.tienda)) || v.proveedor || '' });
            const puedeSeguir = res.write(primero ? fila : `,${fila}`);
            primero = false;
            if (!puedeSeguir) await new Promise((resolve) => res.once('drain', resolve));
        }
        return res.end(']');
    } catch (error) {
        console.error('[EXPORT] Error exportando inventario:', error.message);
        if (empezado) return res.destroy(error);
        return res.status(500).json({ error: 'No se pudo exportar el inventario.' });
    }
});

async function buscarTiendaPorNombre(empresa, nombre) {
    const limpio = String(nombre || '').trim();
    if (!limpio) return null;
    return Tienda.findOne({ nombre: limpio, empresa }).select('_id nombre').lean();
}

app.post('/api/ventas', exigeRol(['Admin', 'Editor']), bloquearMutacionVisualizador, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { proveedor, ...resto } = req.body || {};
        const datosVenta = await resolverFotosEntrantes(empresa, limpiarCamposProtegidosVenta(resto));

        const tiendaDoc = await buscarTiendaPorNombre(empresa, proveedor);

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
        await registrarLog(req.session.email, `Registró prenda en stock: ${nuevaVenta.prenda} (${proveedor || 'Sin tienda'})`);
        const { imagen, galeria, ...ventaSinFotos } = nuevaVenta.toObject();
        return res.json({ status: "success", venta: ventaSinFotos });
    } catch (error) { 
        return res.status(500).json({ error: 'Error al registrar artículo.' }); 
    }
});

app.put('/api/ventas/:id', exigeSoloAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: 'Producto no encontrado en tu empresa.' });
        const body = req.body || {};
        const { proveedor, ...resto } = body;
        const datosVenta = await resolverFotosEntrantes(empresa, limpiarCamposProtegidosVenta(resto), id);

        // Solo cambiamos la tienda si el cliente la envía: añadir una foto o un comentario
        // ya no deja el producto "Sin asignar".
        if (Object.prototype.hasOwnProperty.call(body, 'proveedor')) {
            const tiendaDoc = await buscarTiendaPorNombre(empresa, proveedor);
            datosVenta.tienda = tiendaDoc ? tiendaDoc._id : null;
        }

        if (datosVenta.estado) {
            const estadoCfg = await EstadoKanban.findOne({ nombre: datosVenta.estado, empresa }).lean();
            const esVenta = estadoCfg && estadoCfg.rolFinanciero === 'Venta';
            if (esVenta && !datosVenta.fechaVenta) {
                datosVenta.fechaVenta = new Date().toISOString().split('T')[0];
            }
            if (!esVenta && datosVenta.fechaVenta) {
                datosVenta.fechaVenta = '';
            }
            if (!esVenta) {
                datosVenta.loteVendido = false;
                datosVenta.loteVentaEtiqueta = '';
            } else {
                datosVenta.vintedAviso = ''; // venta registrada: el aviso de Vinted queda resuelto
            }
        }

        const ventaActualizada = await VentaRopa.findOneAndUpdate(
            { _id: id, empresa },
            { ...datosVenta, fechaModificacion: new Date().toISOString().slice(0, 10) },
            { new: true, projection: { imagen: 0, galeria: 0 } }
        ).lean();
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
            updateData.vintedAviso = '';
            if (typeof comentariosProducto === 'string') {
                updateData.comentariosProducto = comentariosProducto.trim();
            }
        } else {
            updateData.fechaVenta = '';
            updateData.loteVendido = false;
            updateData.loteVentaEtiqueta = '';
        }

        const ventaActualizada = await VentaRopa.findOneAndUpdate({ _id: id, empresa }, updateData, { new: true, projection: { imagen: 0, galeria: 0 } }).lean();
        if (!ventaActualizada) return res.status(404).json({ error: 'Producto no encontrado en tu empresa.' });
        invalidateKpiResumenCache(empresa);
        await registrarLog(req.session.email, `Transición de estado: [${ventaActualizada.prenda}] -> ${String(estado || '').toUpperCase()}`);
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
    const { clientLocation } = req.body || {};
    if (req.session && req.session.email) {
        const emailUsuario = req.session.email;
        registrarLogConUbicacion(req, emailUsuario, "Cerró sesión en el sistema", clientLocation);
        req.session.destroy(() => res.sendStatus(200));
    } else {
        res.sendStatus(200);
    }
});
app.get('/api/logout', (req, res) => { req.session.destroy(() => res.sendStatus(200)); }); // Compatibilidad

// Fallback SPA solo para rutas no-API; evita romper endpoints GET registrados debajo.
app.get(/^\/(?!api(?:\/|$)).*/, (req, res) => {
    // Un recurso con extensión que no existe (p. ej. /sw.js) es un 404, no la SPA en HTML.
    if (path.extname(req.path)) return res.sendStatus(404);
    return enviarIndexHtml(req, res);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[SERVER] Seychelles Core Activo en puerto: ${PORT}`));

// Render envía SIGTERM a la instancia vieja en cada despliegue: dejamos terminar lo que
// esté en curso (máx. 10 s) en vez de cortar peticiones a mitad.
function apagarConGracia(senal) {
    console.log(`[SERVER] ${senal} recibido: cerrando conexiones...`);
    setTimeout(() => process.exit(0), 10000).unref();
    io.close(() => {
        mongoose.connection.close().catch(() => {}).finally(() => process.exit(0));
    });
}
process.once('SIGTERM', () => apagarConGracia('SIGTERM'));
process.once('SIGINT', () => apagarConGracia('SIGINT'));


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
        const { url, alias } = req.body || {};
        if (!url) return res.status(400).json({ error: 'URL de Vinted requerida.' });

        const aliasLimpio = String(alias || '').trim() || 'Vinted';
        const urlNormalizada = normalizarUrlObjetivo(url);
        const serverTime = Date.now();

        // 1) Directo desde el servidor: la API de Vinted responde en segundos y no depende de GitHub.
        const eventoLocal = await escanearPerfilEnServidor(empresa, urlNormalizada, aliasLimpio);
        if (eventoLocal) {
            return res.json({ success: true, local: true, serverTime, evento: eventoLocal, mensaje: eventoLocal.mensaje });
        }

        // 2) Respaldo: GitHub Actions con navegador real (si Vinted no respondió al servidor).
        if (!githubActionsDisponible()) {
            return res.status(503).json({
                error: process.env.GITHUB_PAT
                    ? 'Vinted no respondió al servidor y GitHub Actions no está arrancando los escaneos (revisa la facturación de tu cuenta de GitHub). Inténtalo de nuevo en unos minutos.'
                    : 'Vinted no respondió al servidor y no hay GITHUB_PAT configurado para usar GitHub Actions como respaldo.'
            });
        }

        await lanzarScraperUnificadoGithub({
            mode: 'manual',
            targetUrl: urlNormalizada,
            empresa,
            alias: aliasLimpio,
            webhookPath: '/api/scraper/webhook-github',
            logTag: 'GITHUB-UNIFIED-MANUAL'
        });
        vigilarArranqueGithub(serverTime, () => {
            emitirEventoScraper(empresa, 'scraper_update', {
                error: 'GitHub Actions no llegó a arrancar el escaneo (cuenta de GitHub bloqueada por facturación o sin minutos) y Vinted no respondió al servidor.',
                empresa,
                urlOrigen: urlNormalizada,
                timestamp: new Date()
            });
        });

        res.json({
            success: true,
            serverTime,
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

// --- Detección de ventas en Vinted ---
// El armario público de Vinted solo lista lo que sigue a la venta. Una prenda nuestra que
// deja de aparecer se ha vendido, reservado, ocultado o borrado: lo confirmamos en su ficha
// (/items/:id) y lo dejamos como aviso en el producto para revisarlo desde el panel.
const RE_DIACRITICOS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');

function tituloComparable(texto) {
    return String(texto || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(RE_DIACRITICOS, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function coincidenciaFlexibleTitulos(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    return (a.length > 4 && b.includes(a)) || (b.length > 4 && a.includes(b));
}

function idVintedDeUrl(valor) {
    const m = String(valor || '').match(/\/items\/(\d+)/);
    return m ? m[1] : '';
}

function idMiembroDeUrl(valor) {
    const m = String(valor || '').match(/\/member\/(?:general\/)?(\d+)/);
    return m ? m[1] : '';
}

async function estadosPorRol(empresa) {
    const estados = await EstadoKanban.find({ empresa }).sort({ orden: 1 }).select('nombre rolFinanciero').lean();
    return {
        venta: estados.filter((e) => e.rolFinanciero === 'Venta').map((e) => e.nombre),
        stock: estados.filter((e) => e.rolFinanciero === 'Stock').map((e) => e.nombre)
    };
}

const TIPOS_AVISO_VINTED = ['vendido', 'no_visible', 'eliminado'];
const HORAS_AUTO_VINTED = [0, 1, 3, 6, 12, 24];
const CONFIG_VINTED_DEFECTO = {
    avisar: { vendido: true, no_visible: true, eliminado: true },
    registrarVendidosAuto: false,
    autoCadaHoras: 0,
    maxAnuncios: 80,
    completarFichas: true,
    avisoVoz: true,
    ultimaComprobacion: null,
    ultimaComprobacionPor: '',
    ultimoResumen: null
};

async function obtenerConfigVinted(empresa) {
    const doc = await ConfigVinted.findOne({ empresa }).lean();
    if (!doc) return { ...CONFIG_VINTED_DEFECTO, avisar: { ...CONFIG_VINTED_DEFECTO.avisar } };
    return {
        ...CONFIG_VINTED_DEFECTO,
        ...doc,
        avisar: { ...CONFIG_VINTED_DEFECTO.avisar, ...(doc.avisar || {}) }
    };
}

const tiposAvisoActivos = (config) => TIPOS_AVISO_VINTED.filter((t) => config?.avisar?.[t] !== false);

function configVintedPublica(config) {
    return {
        avisar: { ...config.avisar },
        registrarVendidosAuto: Boolean(config.registrarVendidosAuto),
        autoCadaHoras: Number(config.autoCadaHoras) || 0,
        maxAnuncios: Number(config.maxAnuncios) || CONFIG_VINTED_DEFECTO.maxAnuncios,
        completarFichas: config.completarFichas !== false,
        avisoVoz: config.avisoVoz !== false,
        ultimaComprobacion: config.ultimaComprobacion || null,
        ultimaComprobacionPor: config.ultimaComprobacionPor || '',
        ultimoResumen: config.ultimoResumen || null
    };
}

// Acepta la URL del perfil (vinted.es/.fr/... /member/123-alias) o solo el número de miembro.
function normalizarPerfilVinted(valor) {
    const texto = String(valor || '').trim();
    if (!texto) return { ok: true, url: '' };
    const id = /^\d{3,}$/.test(texto) ? texto : idMiembroDeUrl(texto);
    return id ? { ok: true, url: `https://www.vinted.es/member/${id}` } : { ok: false, url: '' };
}

// Consulta la ficha de Vinted de los productos enlazados que ya no salen en el armario.
async function confirmarEstadoEnVinted(productos, { limite = 40, presupuestoMs = 35000 } = {}) {
    const fechaLimite = Date.now() + presupuestoMs;
    const enlazados = productos.filter((p) => p.vintedId || idVintedDeUrl(p.vintedUrl)).slice(0, limite);
    const fichas = new Map();
    await ejecutarConConcurrencia(enlazados, 4, async (p) => {
        if (Date.now() > fechaLimite) return;
        fichas.set(String(p._id), await obtenerFichaItemVinted(p.vintedId || p.vintedUrl));
    });
    return fichas;
}

// Guarda en una sola escritura lo detectado: enlaces con anuncios, estado visto y avisos.
// Los tipos de aviso desactivados en las opciones solo actualizan el estado, sin avisar.
async function guardarDeteccionVinted(empresa, deteccion, tiposAviso = TIPOS_AVISO_VINTED) {
    const ahora = new Date();
    const ops = [];
    for (const e of deteccion.enlaces || []) {
        ops.push({
            updateOne: {
                filter: { _id: e.id, empresa, $or: [{ vintedId: '' }, { vintedId: { $exists: false } }] },
                update: { $set: { vintedId: e.vintedId, vintedUrl: e.vintedUrl || '', ...(e.vintedVendedorId ? { vintedVendedorId: String(e.vintedVendedorId) } : {}) } }
            }
        });
    }
    for (const v of deteccion.vistos || []) {
        // Si vuelve a estar a la venta, cualquier aviso anterior deja de tener sentido.
        ops.push({ updateOne: { filter: { _id: v.id, empresa }, update: { $set: { vintedEstado: v.estado, vintedRevisadoEn: ahora, vintedAviso: '', vintedAvisoIgnorado: '' } } } });
    }
    const avisar = (id, aviso, estado) => {
        ops.push({ updateOne: { filter: { _id: id, empresa }, update: { $set: { vintedEstado: estado, vintedRevisadoEn: ahora } } } });
        if (!tiposAviso.includes(aviso)) return;
        // La fecha del aviso es la de la primera detección.
        // No repetimos un aviso que el usuario ya ignoró para este producto.
        ops.push({ updateOne: { filter: { _id: id, empresa, vintedAviso: { $ne: aviso }, vintedAvisoIgnorado: { $ne: aviso } }, update: { $set: { vintedAviso: aviso, vintedAvisoEn: ahora } } } });
    };
    (deteccion.vendidos || []).forEach((id) => avisar(id, 'vendido', 'vendido'));
    (deteccion.noVisibles || []).forEach((id) => avisar(id, 'no_visible', 'no_visible'));
    (deteccion.eliminados || []).forEach(({ id, estado }) => avisar(id, 'eliminado', estado));
    if (ops.length) await VentaRopa.bulkWrite(ops, { ordered: false });
}

// Recuerda qué perfil de Vinted corresponde a cada tienda (para "Comprobar ventas").
async function enlazarTiendasConPerfiles(empresa, perfilesPorTienda) {
    for (const [nombreTienda, perfilUrl] of perfilesPorTienda) {
        const idMiembro = idMiembroDeUrl(perfilUrl);
        if (!idMiembro || !String(nombreTienda || '').trim()) continue;
        await Tienda.updateOne(
            { empresa, nombre: { $regex: new RegExp(`^${escapeRegexSafe(String(nombreTienda).trim())}$`, 'i') } },
            { $set: { vintedPerfilUrl: `https://www.vinted.es/member/${idMiembro}` } }
        );
    }
}

// Completa en segundo plano la ficha (descripción, color, categoría y todas las fotos como URL)
// de productos enlazados con Vinted a los que les falte.
const FICHAS_EN_CURSO = new Set();
function completarFichasVinted(empresa, productos, { limite = 200 } = {}) {
    const lista = (productos || [])
        .filter((p) => p && p.vintedId && !FICHAS_EN_CURSO.has(String(p._id)))
        .slice(0, limite);
    if (!lista.length) return 0;
    lista.forEach((p) => FICHAS_EN_CURSO.add(String(p._id)));

    setTimeout(async () => {
        let completados = 0;
        await ejecutarConConcurrencia(lista, 3, async (p) => {
            try {
                const ficha = await obtenerFichaItemVinted(p.vintedId);
                if (!ficha || ficha.estado === 'desconocido' || ficha.estado === 'eliminado') return;
                const actual = await VentaRopa.findOne({ _id: p._id, empresa }).select('descripcion marca condicion color categoriaVinted galeria imagen imagenMiniatura').lean();
                if (!actual) return;
                const cambios = { vintedRevisadoEn: new Date() };
                if (!actual.descripcion && ficha.descripcion) cambios.descripcion = ficha.descripcion.slice(0, 3000);
                if (!actual.marca && ficha.marca) cambios.marca = ficha.marca;
                if (!actual.condicion && ficha.condicion) cambios.condicion = ficha.condicion;
                if (!actual.color && ficha.color) cambios.color = ficha.color;
                if (!actual.categoriaVinted && ficha.categoria) cambios.categoriaVinted = ficha.categoria;
                if (!actual.imagenMiniatura && ficha.miniatura) cambios.imagenMiniatura = ficha.miniatura;
                // Si solo teníamos una foto (p. ej. desde CSV), guardamos todas las del anuncio (como URL).
                const fotosActuales = (actual.imagen ? 1 : 0) + (Array.isArray(actual.galeria) ? actual.galeria.length : 0);
                const imagenEsDato = String(actual.imagen || '').startsWith('data:');
                if (!imagenEsDato && ficha.fotos?.length > fotosActuales) {
                    cambios.imagen = ficha.fotos[0];
                    cambios.galeria = ficha.fotos.slice(1, 20);
                }
                await VentaRopa.updateOne({ _id: p._id, empresa }, { $set: cambios });
                completados += 1;
            } catch (error) {
                console.warn(`[VINTED-FICHA] ${p.vintedId}: ${error.message}`);
            } finally {
                FICHAS_EN_CURSO.delete(String(p._id));
            }
        });
        console.log(`[VINTED-FICHA] Fichas completadas: ${completados}/${lista.length} (${empresa})`);
        if (completados && global.io) {
            global.io.to(`empresa:${empresa}`).emit('inventario_actualizado', { motivo: 'fichas-vinted', total: completados });
        }
    }, 50);
    return lista.length;
}

/**
 * Analiza datos del scraper o de un CSV/Excel (p. ej. Instant Data Scraper) contra el inventario.
 * Además de nuevos / cambios de precio / sin cambios, detecta prendas vendidas en Vinted.
 */
app.post('/api/scraper/analizar-manual', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { productosExtraidos } = req.body || {};
        console.log(`[SCRAPER MANUAL] Recibidos ${productosExtraidos?.length || 0} productos para comparar.`);
        if (!productosExtraidos || !Array.isArray(productosExtraidos)) {
            return res.status(400).json({ error: 'Datos no válidos.' });
        }

        const resultados = { discrepancias: [], nuevos: [], identicos: [], desaparecidos: [], vendidos: [] };
        // Sin fotos: con cientos de productos base64 esta consulta pesaba decenas de MB.
        const [productosBD, tiendasEmpresa, roles] = await Promise.all([
            VentaRopa.find({ empresa, $or: [{ canalVenta: 'Vinted' }, { vintedId: { $nin: ['', null] } }] })
                .select('prenda precioVenta fecha fechaVenta proveedor tienda comentariosProducto estado vintedId vintedUrl vintedVendedorId')
                .lean(),
            Tienda.find({ empresa }).select('nombre').lean(),
            estadosPorRol(empresa)
        ]);
        const nombreTiendaPorId = new Map(tiendasEmpresa.map((t) => [String(t._id), t.nombre]));
        const yaVendidoEnBD = (p) => Boolean(p.fechaVenta) || roles.venta.includes(p.estado);

        const normalizarProveedor = (v) => String(v || 'Vinted').trim().toLowerCase() || 'vinted';
        // El esquema no guarda "proveedor": la tienda real sale de la referencia a Tienda.
        const proveedorDeProducto = (p) => nombreTiendaPorId.get(String(p.tienda)) || p.proveedor || 'Vinted';

        const bdPorProveedor = new Map();
        const bdPorTituloExacto = new Map();
        const bdPorVintedId = new Map();
        productosBD.forEach((p) => {
            p._titulo = tituloComparable(p.prenda);
            p._proveedor = normalizarProveedor(proveedorDeProducto(p));
            if (!bdPorProveedor.has(p._proveedor)) bdPorProveedor.set(p._proveedor, []);
            bdPorProveedor.get(p._proveedor).push(p);
            const claveExacta = `${p._proveedor}::${p._titulo}`;
            if (!bdPorTituloExacto.has(claveExacta)) bdPorTituloExacto.set(claveExacta, p);
            const idV = p.vintedId || idVintedDeUrl(p.vintedUrl);
            if (idV) bdPorVintedId.set(idV, p);
        });

        // Primero por id de anuncio (exacto); si no, por título dentro de la misma tienda.
        const buscarCoincidencia = (vintedId, tituloLimpio, proveedorFuente) => {
            if (vintedId && bdPorVintedId.has(vintedId)) return { producto: bdPorVintedId.get(vintedId), tipo: 'id' };
            const exacta = bdPorTituloExacto.get(`${proveedorFuente}::${tituloLimpio}`);
            if (exacta) return { producto: exacta, tipo: 'exacto' };
            const mismaTienda = bdPorProveedor.get(proveedorFuente) || [];
            const flexible = mismaTienda.find((p) => coincidenciaFlexibleTitulos(p._titulo, tituloLimpio));
            if (flexible) return { producto: flexible, tipo: 'flexible' };
            // Escaneo genérico ("Vinted") o alias sin productos aún: buscamos en todas las tiendas
            // para no duplicar artículos que ya están dados de alta con otra tienda.
            if (proveedorFuente === 'vinted' || mismaTienda.length === 0) {
                const global = productosBD.find((p) => p._titulo === tituloLimpio)
                    || productosBD.find((p) => coincidenciaFlexibleTitulos(p._titulo, tituloLimpio));
                if (global) return { producto: global, tipo: 'flexible' };
            }
            return { producto: null, tipo: '' };
        };

        const filaProducto = (p, extra = {}) => ({
            idMongo: p._id,
            prenda: p.prenda,
            precio: p.precioVenta,
            proveedor: proveedorDeProducto(p),
            imagen: '',
            fechaRegistro: p.fecha || '',
            comentariosProducto: p.comentariosProducto || '',
            vintedUrl: p.vintedUrl || (p.vintedId ? `https://www.vinted.es/items/${p.vintedId}` : ''),
            ...extra
        });

        const titulosWebPorProveedor = new Map();
        const idsEmparejados = new Set();
        const idsVintedEscaneados = new Set();
        const vendedoresEscaneados = new Set();
        const perfilesPorTienda = new Map();
        const deteccion = { enlaces: [], vistos: [], vendidos: [], noVisibles: [], eliminados: [] };

        productosExtraidos.forEach(item => {
            const titulo = String(item.titulo || item.prenda || '').trim();
            const precioWeb = parseFloat(String(item.precio ?? '').replace(',', '.'));
            const imagen = item.imagen || '';
            const galeria = Array.isArray(item.galeria) ? item.galeria : [];
            const proveedorLabel = String(item.proveedor || item.cuenta || item.aliasFuente || item.origenGrupo || item.alias || 'Vinted').trim() || 'Vinted';
            const proveedorFuente = normalizarProveedor(proveedorLabel);
            const vintedId = String(item.vintedId || item.id || '').replace(/\D/g, '') || idVintedDeUrl(item.url);
            const vendidoEnVinted = Boolean(item.vendido);
            if (vintedId && !vendidoEnVinted) idsVintedEscaneados.add(vintedId);
            if (item.vendedorId) vendedoresEscaneados.add(String(item.vendedorId));
            if (item.perfilUrl) perfilesPorTienda.set(proveedorLabel, item.perfilUrl);

            if (!titulo || isNaN(precioWeb)) return;
            const cleanItemTitle = tituloComparable(titulo);
            if (!vendidoEnVinted) {
                const listaActual = titulosWebPorProveedor.get(proveedorFuente) || [];
                listaActual.push(cleanItemTitle);
                titulosWebPorProveedor.set(proveedorFuente, listaActual);
            }

            const { producto: coincidencia, tipo } = buscarCoincidencia(vintedId, cleanItemTitle, proveedorFuente);
            if (!coincidencia) {
                resultados.nuevos.push({
                    prenda: titulo,
                    precioVenta: precioWeb,
                    imagen, galeria, canalVenta: 'Vinted',
                    proveedor: proveedorLabel,
                    estado: 'No Vendido',
                    marca: item.marca || '', talla: item.talla || '',
                    condicion: item.condicion || '', popularidad: item.favoritos || 0,
                    descripcion: item.descripcion || '',
                    url: item.url || (vintedId ? `https://www.vinted.es/items/${vintedId}` : ''),
                    vintedId,
                    vendedorId: item.vendedorId || '',
                    miniatura: item.miniatura || '',
                    perfilUrl: item.perfilUrl || '',
                    reservado: Boolean(item.reservado),
                    vendido: vendidoEnVinted
                });
                return;
            }

            idsEmparejados.add(String(coincidencia._id));
            // Solo enlazamos con el anuncio si la coincidencia es segura (id o título exacto).
            if (vintedId && !coincidencia.vintedId && (tipo === 'id' || tipo === 'exacto')) {
                deteccion.enlaces.push({ id: coincidencia._id, vintedId, vintedUrl: item.url || `https://www.vinted.es/items/${vintedId}`, vintedVendedorId: item.vendedorId || '' });
            }

            // El CSV o el anuncio dicen que está vendida y en el inventario sigue en stock.
            if (vendidoEnVinted && !yaVendidoEnBD(coincidencia)) {
                resultados.vendidos.push(filaProducto(coincidencia, { imagen, fuente: 'scraper' }));
                deteccion.vendidos.push(coincidencia._id);
                return;
            }
            if (!vendidoEnVinted) deteccion.vistos.push({ id: coincidencia._id, estado: item.reservado ? 'reservado' : 'activo' });

            if (Math.abs(coincidencia.precioVenta - precioWeb) > 0.01 || coincidencia.prenda !== titulo) {
                resultados.discrepancias.push({
                    idMongo: coincidencia._id,
                    prenda: coincidencia.prenda,
                    prendaNueva: titulo,
                    valorAntiguo: coincidencia.precioVenta,
                    valorNuevo: precioWeb,
                    proveedor: proveedorLabel,
                    imagen,
                    reservado: Boolean(item.reservado),
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
                    reservado: Boolean(item.reservado),
                    fechaRegistro: coincidencia.fecha || '',
                    fechaVenta: coincidencia.fechaVenta || ''
                });
            }
        });

        // Prendas en stock de las tiendas/perfiles escaneados que ya no salen en Vinted.
        const noVistos = productosBD.filter((p) => {
            if (yaVendidoEnBD(p) || !p._titulo || idsEmparejados.has(String(p._id))) return false;
            const titulosProveedor = titulosWebPorProveedor.get(p._proveedor);
            const enAlcance = Boolean(titulosProveedor?.length) || (p.vintedVendedorId && vendedoresEscaneados.has(String(p.vintedVendedorId)));
            // Si no se ha escaneado esa tienda/perfil, no podemos decir nada de ella.
            if (!enAlcance) return false;
            if (p.vintedId && idsVintedEscaneados.has(p.vintedId)) return false;
            return !(titulosProveedor || []).some((t) => coincidenciaFlexibleTitulos(p._titulo, t));
        });

        // Los enlazados con su anuncio se confirman en la ficha: vendida, borrada, oculta...
        const fichas = await confirmarEstadoEnVinted(noVistos);
        noVistos.forEach((p) => {
            const estado = fichas.get(String(p._id))?.estado;
            if (estado === 'activo' || estado === 'reservado') {
                deteccion.vistos.push({ id: p._id, estado });
                return;
            }
            if (estado === 'vendido') {
                resultados.vendidos.push(filaProducto(p, { fuente: 'vinted' }));
                deteccion.vendidos.push(p._id);
                return;
            }
            const motivo = (estado === 'eliminado' || estado === 'oculto') ? estado : 'no_visible';
            resultados.desaparecidos.push(filaProducto(p, { motivo }));
            if (motivo === 'no_visible') deteccion.noVisibles.push(p._id);
            else deteccion.eliminados.push({ id: p._id, estado: motivo });
        });

        // Miniaturas por URL (la foto real se sirve desde /api/ventas/:id/foto/0).
        const conImagenPropia = [...resultados.discrepancias, ...resultados.identicos, ...resultados.desaparecidos, ...resultados.vendidos];
        if (conImagenPropia.length) {
            const metas = await VentaRopa.aggregate([
                { $match: { empresa, _id: { $in: conImagenPropia.map((r) => r.idMongo) } } },
                { $project: { meta: exprMetaFoto('$imagen'), mini: '$imagenMiniatura' } }
            ]);
            const fotoPorId = new Map(metas.map((m) => [String(m._id), m.mini || valorFotoDesdeMeta(m.meta, (v) => `/api/ventas/${m._id}/foto/0?v=${v}`)]));
            conImagenPropia.forEach((r) => {
                if (!r.imagen) r.imagen = fotoPorId.get(String(r.idMongo)) || '';
            });
        }

        await guardarDeteccionVinted(empresa, deteccion, tiposAvisoActivos(await obtenerConfigVinted(empresa)));
        if (perfilesPorTienda.size) await enlazarTiendasConPerfiles(empresa, perfilesPorTienda);

        res.json(resultados);
    } catch (error) {
        console.error('Error en Scraper Manual:', error);
        res.status(500).json({ error: 'Error al procesar los datos manuales.' });
    }
});

// --- Panel de ventas detectadas en Vinted ---
app.get('/api/vinted/avisos', exigeSoloAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const [roles, config] = await Promise.all([estadosPorRol(empresa), obtenerConfigVinted(empresa)]);
        const filas = await VentaRopa.aggregate([
            { $match: { empresa, vintedAviso: { $in: tiposAvisoActivos(config) }, estado: { $nin: roles.venta } } },
            { $sort: { vintedAvisoEn: -1, _id: -1 } },
            { $limit: 300 },
            { $lookup: { from: 'tiendas', localField: 'tienda', foreignField: '_id', as: 'tiendaInfo' } },
            {
                $project: {
                    prenda: 1, sku: 1, precioVenta: 1, estado: 1, fecha: 1, vintedAviso: 1, vintedAvisoEn: 1,
                    vintedUrl: 1, vintedId: 1, imagenMiniatura: 1, proveedorLegado: '$proveedor',
                    tiendaNombre: { $arrayElemAt: ['$tiendaInfo.nombre', 0] },
                    meta: exprMetaFoto('$imagen')
                }
            }
        ]);
        const avisos = filas.map((f) => ({
            _id: f._id,
            prenda: f.prenda,
            sku: f.sku || '',
            precioVenta: f.precioVenta || 0,
            estado: f.estado,
            fecha: f.fecha || '',
            aviso: f.vintedAviso,
            avisoEn: f.vintedAvisoEn || null,
            vintedUrl: f.vintedUrl || (f.vintedId ? `https://www.vinted.es/items/${f.vintedId}` : ''),
            proveedor: f.tiendaNombre || f.proveedorLegado || '',
            imagen: f.imagenMiniatura || valorFotoDesdeMeta(f.meta, (v) => `/api/ventas/${f._id}/foto/0?v=${v}`)
        }));
        const [tiendasEnlazadas, productosEnlazados] = await Promise.all([
            Tienda.countDocuments({ empresa, vintedPerfilUrl: { $nin: ['', null] } }),
            VentaRopa.countDocuments({ empresa, vintedId: { $nin: ['', null] }, estado: { $nin: roles.venta } })
        ]);
        res.json({
            avisos, total: avisos.length, tiendasEnlazadas, productosEnlazados,
            config: configVintedPublica(config),
            enCurso: COMPROBACIONES_VENTAS_EN_CURSO.has(empresa)
        });
    } catch (error) {
        console.error('[VINTED-AVISOS]', error.message);
        res.status(500).json({ error: 'No se pudieron cargar los avisos de Vinted.' });
    }
});

app.post('/api/vinted/avisos/descartar', exigeSoloAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((id) => mongoose.isValidObjectId(id)).slice(0, 500);
        if (!ids.length) return res.status(400).json({ error: 'No hay avisos seleccionados.' });
        // Pipeline con el driver nativo: guarda qué aviso se ignoró y lo limpia en una sola operación.
        const r = await VentaRopa.collection.updateMany(
            { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) }, empresa },
            [{ $set: { vintedAvisoIgnorado: '$vintedAviso', vintedAviso: '' } }]
        );
        res.json({ success: true, descartados: r.modifiedCount });
    } catch (error) {
        res.status(500).json({ error: 'No se pudieron descartar los avisos.' });
    }
});

// Revisa en Vinted todos los perfiles enlazados y detecta qué productos en stock se han vendido.
// La usan el botón "Comprobar" y la comprobación automática, siempre con las opciones guardadas.
const COMPROBACIONES_VENTAS_EN_CURSO = new Set();
const MAX_PERFILES_COMPROBACION = 50;

class ComprobacionEnCursoError extends Error {}

// Opción "registrar solas las ventas confirmadas": solo para anuncios que Vinted marca como vendidos.
async function registrarVentasConfirmadasVinted(empresa, ids, roles) {
    if (!ids.length) return 0;
    const estadoVenta = roles.venta[0] || 'Vendido';
    const hoy = new Date().toISOString().slice(0, 10);
    const nota = `Vendido en Vinted (registrado automáticamente el ${hoy}).`;
    const comentarioActual = { $ifNull: ['$comentariosProducto', ''] };
    const r = await VentaRopa.collection.updateMany(
        { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(String(id))) }, empresa, estado: { $nin: roles.venta } },
        [{
            $set: {
                estado: estadoVenta,
                fechaVenta: hoy,
                fechaModificacion: hoy,
                vintedAviso: '',
                comentariosProducto: { $cond: [{ $gt: [{ $strLenCP: comentarioActual }, 0] }, { $concat: [comentarioActual, ' · ', nota] }, nota] }
            }
        }]
    );
    if (r.modifiedCount) invalidateKpiResumenCache(empresa);
    return r.modifiedCount;
}

async function ejecutarComprobacionVentasVinted(empresa, { actor = '', automatica = false } = {}) {
    if (COMPROBACIONES_VENTAS_EN_CURSO.has(empresa)) {
        throw new ComprobacionEnCursoError('Ya hay una comprobación en marcha. Espera unos segundos.');
    }
    COMPROBACIONES_VENTAS_EN_CURSO.add(empresa);
    const inicio = Date.now();
    const quien = automatica ? 'automática' : actor;
    try {
        const [roles, tiendas, config] = await Promise.all([
            estadosPorRol(empresa),
            Tienda.find({ empresa }).select('nombre vintedPerfilUrl').lean(),
            obtenerConfigVinted(empresa)
        ]);
        const productos = await VentaRopa.find({ empresa, estado: { $nin: roles.venta }, fechaVenta: { $in: ['', null] }, $or: [{ canalVenta: 'Vinted' }, { vintedId: { $nin: ['', null] } }] })
            .select('prenda estado tienda vintedId vintedUrl vintedVendedorId descripcion')
            .lean();

        // Perfiles a revisar: tiendas con perfil guardado + vendedores de productos enlazados.
        const vendedorPorTienda = new Map();
        tiendas.forEach((t) => {
            const idMiembro = idMiembroDeUrl(t.vintedPerfilUrl);
            if (idMiembro) vendedorPorTienda.set(String(t._id), idMiembro);
        });
        const vendedores = new Set(vendedorPorTienda.values());
        productos.forEach((p) => { if (p.vintedVendedorId) vendedores.add(String(p.vintedVendedorId)); });

        const resumen = { perfilesRevisados: 0, perfilesConError: 0, perfilesOmitidos: 0, productosRevisados: 0, activos: 0, reservados: 0, vendidos: 0, vendidosNuevos: 0, noVisibles: 0, eliminados: 0, sinEnlace: 0, fichasPendientes: 0, registradosAuto: 0 };
        let mensaje = '';
        if (!vendedores.size) {
            resumen.sinEnlace = productos.length;
            mensaje = 'Ninguna tienda está enlazada todavía con su perfil de Vinted. Añádelo en ⚙️ Opciones.';
        } else {
            const listaVendedores = [...vendedores];
            resumen.perfilesOmitidos = Math.max(0, listaVendedores.length - MAX_PERFILES_COMPROBACION);
            const armarios = new Map();
            await ejecutarConConcurrencia(listaVendedores.slice(0, MAX_PERFILES_COMPROBACION), 3, async (vendedorId) => {
                const { productos: activos, resumen: r } = await scrapeVinted(`https://www.vinted.es/member/${vendedorId}`, { sinNavegador: true });
                if (!r.apiRespondio) { resumen.perfilesConError += 1; return; }
                resumen.perfilesRevisados += 1;
                armarios.set(vendedorId, {
                    porId: new Map(activos.map((a) => [String(a.id), a])),
                    titulos: activos.map((a) => ({ titulo: tituloComparable(a.titulo), item: a }))
                });
            });

            const deteccion = { enlaces: [], vistos: [], vendidos: [], noVisibles: [], eliminados: [] };
            const noVistos = [];
            for (const p of productos) {
                const vendedorId = p.vintedVendedorId ? String(p.vintedVendedorId) : vendedorPorTienda.get(String(p.tienda));
                if (!vendedorId) { resumen.sinEnlace += 1; continue; }
                const armario = armarios.get(vendedorId);
                if (!armario) continue;
                resumen.productosRevisados += 1;

                let visto = p.vintedId ? armario.porId.get(String(p.vintedId)) : null;
                if (!visto && !p.vintedId) {
                    const titulo = tituloComparable(p.prenda);
                    const exacto = armario.titulos.find((t) => t.titulo === titulo);
                    if (exacto) {
                        visto = exacto.item;
                        deteccion.enlaces.push({ id: p._id, vintedId: String(exacto.item.id), vintedUrl: exacto.item.url, vintedVendedorId: vendedorId });
                    } else {
                        visto = armario.titulos.find((t) => coincidenciaFlexibleTitulos(t.titulo, titulo))?.item || null;
                    }
                }
                if (visto) {
                    deteccion.vistos.push({ id: p._id, estado: visto.reservado ? 'reservado' : 'activo' });
                    if (visto.reservado) resumen.reservados += 1; else resumen.activos += 1;
                } else {
                    noVistos.push(p);
                }
            }

            // Cada anuncio que ya no está en el armario se abre para confirmar qué le pasó.
            const maxAnuncios = Math.min(Math.max(Number(config.maxAnuncios) || 80, 10), 200);
            const fichas = await confirmarEstadoEnVinted(noVistos, { limite: maxAnuncios, presupuestoMs: Math.min(120000, 20000 + maxAnuncios * 400) });
            noVistos.forEach((p) => {
                const estado = fichas.get(String(p._id))?.estado;
                if (estado === 'activo' || estado === 'reservado') {
                    deteccion.vistos.push({ id: p._id, estado });
                    resumen[estado === 'activo' ? 'activos' : 'reservados'] += 1;
                } else if (estado === 'vendido') {
                    deteccion.vendidos.push(p._id);
                    resumen.vendidos += 1;
                } else if (estado === 'eliminado' || estado === 'oculto') {
                    deteccion.eliminados.push({ id: p._id, estado });
                    resumen.eliminados += 1;
                } else {
                    deteccion.noVisibles.push(p._id);
                    resumen.noVisibles += 1;
                }
            });

            if (deteccion.vendidos.length) {
                resumen.vendidosNuevos = await VentaRopa.countDocuments({ _id: { $in: deteccion.vendidos }, empresa, vintedAviso: { $ne: 'vendido' }, vintedAvisoIgnorado: { $ne: 'vendido' } });
            }
            await guardarDeteccionVinted(empresa, deteccion, tiposAvisoActivos(config));
            if (config.registrarVendidosAuto) resumen.registradosAuto = await registrarVentasConfirmadasVinted(empresa, deteccion.vendidos, roles);

            // De paso, completa la ficha de los enlazados a los que les falte la descripción.
            if (config.completarFichas !== false) {
                const sinFicha = productos
                    .filter((p) => !p.descripcion && (p.vintedId || deteccion.enlaces.some((e) => String(e.id) === String(p._id))))
                    .map((p) => ({ _id: p._id, vintedId: p.vintedId || deteccion.enlaces.find((e) => String(e.id) === String(p._id))?.vintedId }));
                resumen.fichasPendientes = completarFichasVinted(empresa, sinFicha, { limite: 60 });
            }
        }

        resumen.segundos = Math.round((Date.now() - inicio) / 1000);
        await ConfigVinted.updateOne(
            { empresa },
            { $set: { ultimaComprobacion: new Date(), ultimaComprobacionPor: quien, ultimoResumen: { ...resumen, mensaje } } },
            { upsert: true }
        );
        await registrarLog(automatica ? 'Sistema (comprobación automática)' : actor, `Comprobó ventas en Vinted: ${resumen.vendidos} vendidos, ${resumen.noVisibles} no visibles, ${resumen.eliminados} retirados${resumen.registradosAuto ? `, ${resumen.registradosAuto} registrados solos` : ''}.`);
        if (global.io) {
            global.io.to(`empresa:${empresa}`).emit('vinted_ventas_comprobadas', { resumen, mensaje, automatica });
            if (resumen.registradosAuto) global.io.to(`empresa:${empresa}`).emit('inventario_actualizado', { motivo: 'ventas-vinted', total: resumen.registradosAuto });
        }
        return { resumen, mensaje };
    } catch (error) {
        if (!(error instanceof ComprobacionEnCursoError)) {
            // Se anota el intento fallido para que la comprobación automática no reintente en bucle.
            await ConfigVinted.updateOne(
                { empresa },
                { $set: { ultimaComprobacion: new Date(), ultimaComprobacionPor: quien, ultimoResumen: { error: 'No se pudo completar la comprobación.' } } },
                { upsert: true }
            ).catch(() => {});
        }
        throw error;
    } finally {
        COMPROBACIONES_VENTAS_EN_CURSO.delete(empresa);
    }
}

app.post('/api/vinted/comprobar-ventas', exigeSoloAdmin, async (req, res) => {
    try {
        const { resumen, mensaje } = await ejecutarComprobacionVentasVinted(empresaActual(req), { actor: req.session.email });
        res.json({ success: true, resumen, ...(mensaje ? { mensaje } : {}) });
    } catch (error) {
        if (error instanceof ComprobacionEnCursoError) return res.status(409).json({ error: error.message });
        console.error('[VINTED-VENTAS]', error);
        res.status(500).json({ error: 'No se pudo comprobar las ventas en Vinted.' });
    }
});

// --- Opciones de la comprobación (botón ⚙️) ---
async function datosOpcionesVinted(empresa) {
    const [config, roles, tiendas] = await Promise.all([
        obtenerConfigVinted(empresa),
        estadosPorRol(empresa),
        Tienda.find({ empresa }).select('nombre vintedPerfilUrl').lean()
    ]);
    const stock = await VentaRopa.aggregate([
        { $match: { empresa, estado: { $nin: roles.venta }, tienda: { $ne: null } } },
        { $group: { _id: '$tienda', n: { $sum: 1 } } }
    ]);
    const stockPorTienda = new Map(stock.map((t) => [String(t._id), t.n]));
    const lista = tiendas
        .map((t) => ({ _id: t._id, nombre: t.nombre, vintedPerfilUrl: t.vintedPerfilUrl || '', enStock: stockPorTienda.get(String(t._id)) || 0 }))
        .sort((a, b) => Number(Boolean(b.vintedPerfilUrl)) - Number(Boolean(a.vintedPerfilUrl)) || b.enStock - a.enStock || a.nombre.localeCompare(b.nombre, 'es'));
    return {
        config: configVintedPublica(config),
        tiendas: lista.slice(0, 500),
        totalTiendas: lista.length,
        enCurso: COMPROBACIONES_VENTAS_EN_CURSO.has(empresa),
        maxPerfiles: MAX_PERFILES_COMPROBACION,
        horasPermitidas: HORAS_AUTO_VINTED
    };
}

app.get('/api/vinted/config', exigeSoloAdmin, async (req, res) => {
    try {
        res.json(await datosOpcionesVinted(empresaActual(req)));
    } catch (error) {
        console.error('[VINTED-CONFIG]', error.message);
        res.status(500).json({ error: 'No se pudieron cargar las opciones de Vinted.' });
    }
});

app.put('/api/vinted/config', exigeSoloAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const body = req.body || {};
        const avisar = {};
        TIPOS_AVISO_VINTED.forEach((t) => { avisar[t] = body.avisar?.[t] !== false; });
        const horas = Number(body.autoCadaHoras);
        const maxAnuncios = Math.round(Number(body.maxAnuncios));
        const cambios = {
            avisar,
            registrarVendidosAuto: body.registrarVendidosAuto === true,
            autoCadaHoras: HORAS_AUTO_VINTED.includes(horas) ? horas : 0,
            maxAnuncios: Number.isFinite(maxAnuncios) ? Math.min(Math.max(maxAnuncios, 10), 200) : CONFIG_VINTED_DEFECTO.maxAnuncios,
            completarFichas: body.completarFichas !== false,
            avisoVoz: body.avisoVoz !== false,
            actualizadoPor: req.session.email || '',
            actualizadoEn: new Date()
        };

        // Perfiles de Vinted: de las tiendas que ya existen y de tiendas nuevas.
        const errores = [];
        const ops = [];
        (Array.isArray(body.perfiles) ? body.perfiles : []).slice(0, 500).forEach((p) => {
            if (!mongoose.isValidObjectId(p?.tiendaId)) return;
            const perfil = normalizarPerfilVinted(p.url);
            if (!perfil.ok) { errores.push(String(p.nombre || 'una tienda')); return; }
            ops.push({ updateOne: { filter: { _id: p.tiendaId, empresa }, update: { $set: { vintedPerfilUrl: perfil.url } } } });
        });
        const altas = [];
        (Array.isArray(body.nuevasTiendas) ? body.nuevasTiendas : []).slice(0, 20).forEach((t) => {
            const nombre = String(t?.nombre || '').trim().slice(0, 80);
            const perfil = normalizarPerfilVinted(t?.url);
            if (!nombre || !perfil.ok || !perfil.url) { errores.push(nombre || 'el perfil nuevo'); return; }
            altas.push({ nombre, url: perfil.url });
        });
        if (errores.length) {
            return res.status(400).json({ error: `Perfil de Vinted no válido en: ${errores.slice(0, 5).join(', ')}. Pega la URL del perfil (vinted.es/member/...) o solo su número.` });
        }

        if (ops.length) await Tienda.bulkWrite(ops, { ordered: false });
        for (const alta of altas) {
            const existente = await Tienda.findOne({ empresa, nombre: { $regex: new RegExp(`^${escapeRegexSafe(alta.nombre)}$`, 'i') } }).select('_id').lean();
            if (existente) await Tienda.updateOne({ _id: existente._id }, { $set: { vintedPerfilUrl: alta.url } });
            else await Tienda.create({ nombre: alta.nombre, empresa, vintedPerfilUrl: alta.url }).catch(() => {});
        }
        await ConfigVinted.updateOne({ empresa }, { $set: cambios }, { upsert: true });
        await registrarLog(req.session.email, `Guardó las opciones de Vinted (automático: ${cambios.autoCadaHoras ? `cada ${cambios.autoCadaHoras} h` : 'no'}; registrar ventas solas: ${cambios.registrarVendidosAuto ? 'sí' : 'no'}; ${ops.length + altas.length} perfil(es)).`);
        res.json({ success: true, ...(await datosOpcionesVinted(empresa)) });
    } catch (error) {
        console.error('[VINTED-CONFIG]', error);
        res.status(500).json({ error: 'No se pudieron guardar las opciones de Vinted.' });
    }
});

// Comprobación automática: cada pocos minutos mira qué empresas la tienen activada y ya les toca.
let REVISANDO_AUTO_VINTED = false;
async function revisarComprobacionesAutomaticasVinted() {
    if (REVISANDO_AUTO_VINTED || mongoose.connection.readyState !== 1) return;
    REVISANDO_AUTO_VINTED = true;
    try {
        const configs = await ConfigVinted.find({ autoCadaHoras: { $gt: 0 } }).select('empresa autoCadaHoras ultimaComprobacion').lean();
        for (const c of configs) {
            const toca = !c.ultimaComprobacion || Date.now() - new Date(c.ultimaComprobacion).getTime() >= c.autoCadaHoras * 3600000;
            if (!toca || COMPROBACIONES_VENTAS_EN_CURSO.has(c.empresa)) continue;
            try {
                const { resumen } = await ejecutarComprobacionVentasVinted(c.empresa, { automatica: true });
                console.log(`[VINTED-AUTO] ${c.empresa}: ${resumen.vendidos} vendidos, ${resumen.noVisibles} no visibles, ${resumen.eliminados} retirados (${resumen.segundos} s)`);
            } catch (error) {
                console.warn(`[VINTED-AUTO] ${c.empresa}: ${error.message}`);
            }
        }
    } catch (error) {
        console.warn('[VINTED-AUTO]', error.message);
    } finally {
        REVISANDO_AUTO_VINTED = false;
    }
}
const VINTED_AUTO_REVISION_MS = Math.max(parseInt(process.env.VINTED_AUTO_REVISION_MS, 10) || 5 * 60 * 1000, 1000);
setInterval(revisarComprobacionesAutomaticasVinted, VINTED_AUTO_REVISION_MS);
setTimeout(revisarComprobacionesAutomaticasVinted, Math.min(VINTED_AUTO_REVISION_MS, 90 * 1000));

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

        const [existentesMismaEmpresa, tiendasEmpresa] = await Promise.all([
            VentaRopa.find({ empresa, $or: [{ canalVenta: 'Vinted' }, { vintedId: { $nin: ['', null] } }] }).select('prenda proveedor tienda vintedId').lean(),
            Tienda.find({ empresa }).select('nombre').lean()
        ]);
        const nombreTiendaPorId = new Map(tiendasEmpresa.map((t) => [String(t._id), t.nombre]));

        // La tienda real de cada producto sale de su referencia (el esquema no guarda "proveedor").
        const firmasExistentes = new Set(
            existentesMismaEmpresa.map(v => firmaPorProveedor(v.prenda, nombreTiendaPorId.get(String(v.tienda)) || v.proveedor || 'Vinted'))
        );
        // Un mismo anuncio de Vinted nunca se importa dos veces, aunque cambie de título.
        const vintedIdsExistentes = new Set(existentesMismaEmpresa.map((v) => String(v.vintedId || '')).filter(Boolean));
        const vintedIdsLote = new Set();
        const perfilesPorTienda = new Map();
        const firmasLote = new Set();
        const estadosKanban = await EstadoKanban.find({ empresa }).select('nombre rolFinanciero').lean();
        const estadoStock = estadosKanban.find(e => e.rolFinanciero === 'Stock')?.nombre || 'No Vendido';
        const estadoVenta = estadosKanban.find(e => e.rolFinanciero === 'Venta')?.nombre || 'Vendido';
        const resolverEstadoImportacion = (rawEstado) => {
            const valor = String(rawEstado || '').trim();
            if (!valor) return estadoStock;

            const valorNorm = valor
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .trim();

            const matchExacto = estadosKanban.find(e => String(e.nombre || '').trim().toLowerCase() === valor.toLowerCase());
            if (matchExacto) return matchExacto.nombre;
            if (valorNorm.includes('vendido') || valorNorm.includes('venta') || valorNorm.includes('sold')) return estadoVenta;
            return estadoStock;
        };

        const tiendasCache = new Map();
        const obtenerTiendaPorNombre = async (nombre) => {
            const limpio = (nombre || '').trim();
            if (!limpio) return null;
            if (tiendasCache.has(limpio)) return tiendasCache.get(limpio);

            let tiendaDoc = await Tienda.findOne({ nombre: limpio, empresa });
            if (!tiendaDoc) {
                try {
                    tiendaDoc = await Tienda.create({ nombre: limpio, empresa });
                } catch (errTienda) {
                    // Carrera con otra importación simultánea: la tienda ya existe.
                    tiendaDoc = await Tienda.findOne({ nombre: limpio, empresa });
                }
            }
            tiendasCache.set(limpio, tiendaDoc);
            return tiendaDoc;
        };

        const registrosCreados = [];
        const documentosNuevos = [];
        const resumenTiendas = {};
        let omitidosDuplicados = 0;
        const marcaImportacion = Date.now();
        for (const [indice, prodRaw] of productos.entries()) {
            const prod = limpiarCamposProtegidosVenta(prodRaw);
            if (!String(prod.prenda || '').trim()) continue;
            const nombreTienda = String(prod.proveedor || '').trim() || 'Vinted';
            const firmaActual = firmaPorProveedor(prod.prenda, nombreTienda);
            const vintedId = String(prod.vintedId || '').replace(/\D/g, '') || idVintedDeUrl(prod.url);
            // Regla clave: solo consideramos duplicado dentro de la misma tienda/proveedor
            // (o si es el mismo anuncio de Vinted).
            if (firmasExistentes.has(firmaActual) || firmasLote.has(firmaActual)
                || (vintedId && (vintedIdsExistentes.has(vintedId) || vintedIdsLote.has(vintedId)))) {
                omitidosDuplicados += 1;
                continue;
            }
            firmasLote.add(firmaActual);
            if (vintedId) vintedIdsLote.add(vintedId);
            if (prod.perfilUrl) perfilesPorTienda.set(nombreTienda, prod.perfilUrl);

            // Fotos como URL del CDN de Vinted: cero bytes de imagen en Mongo.
            const esUrl = (u) => /^https?:\/\//i.test(String(u || ''));
            const galeriaUrls = (Array.isArray(prod.galeria) ? prod.galeria : []).filter(esUrl).slice(0, 20);

            const tiendaSeleccionada = await obtenerTiendaPorNombre(nombreTienda);
            resumenTiendas[nombreTienda] = (resumenTiendas[nombreTienda] || 0) + 1;
            const estadoFinal = resolverEstadoImportacion(prod.estado);
            const fechaVentaFinal = estadoFinal === estadoVenta
                ? (prod.fechaVenta || new Date().toISOString().split('T')[0])
                : '';

            documentosNuevos.push({
                ...prod,
                empresa,
                estado: estadoFinal,
                fechaVenta: fechaVentaFinal,
                // Guardar URL directamente en lugar de Base64
                imagen: esUrl(prod.imagen) ? prod.imagen : (galeriaUrls[0] || ''),
                galeria: esUrl(prod.imagen) ? galeriaUrls : galeriaUrls.slice(1),
                imagenMiniatura: esUrl(prod.miniatura) ? prod.miniatura : '',
                descripcion: String(prod.descripcion || '').slice(0, 3000),
                vintedId,
                vintedUrl: esUrl(prod.url) ? prod.url : (vintedId ? `https://www.vinted.es/items/${vintedId}` : ''),
                vintedVendedorId: String(prod.vendedorId || '').replace(/\D/g, ''),
                vintedEstado: vintedId ? (prod.vendido ? 'vendido' : (prod.reservado ? 'reservado' : 'activo')) : '',
                vintedRevisadoEn: vintedId ? new Date() : undefined,
                vintedAviso: '',
                tienda: tiendaSeleccionada ? tiendaSeleccionada._id : null,
                sku: `VNT-${marcaImportacion}-${indice}`,
                comentariosProducto: `${prod.comentariosProducto || ''}${prod.comentariosProducto ? ' · ' : ''}Importado por Scraper el ${new Date().toLocaleDateString('es-ES')} (${nombreTienda})`
            });
            registrosCreados.push(prod.prenda);
        }
        let fichasEnCurso = 0;
        if (documentosNuevos.length) {
            const insertados = await VentaRopa.insertMany(documentosNuevos);
            // Descripción, color, categoría y todas las fotos se completan en segundo plano.
            fichasEnCurso = completarFichasVinted(empresa, insertados.filter((d) => d.vintedId).map((d) => ({ _id: d._id, vintedId: d.vintedId })));
        }
        if (perfilesPorTienda.size) await enlazarTiendasConPerfiles(empresa, perfilesPorTienda);
        invalidateKpiResumenCache(empresa);
        notificarCambio(); // Notificar cambio para refrescar el panel principal

        await registrarLog(req.session.email, `Importó ${registrosCreados.length} productos desde Vinted (omitidos duplicados misma tienda: ${omitidosDuplicados}): ${registrosCreados.join(', ')}`);
        res.json({ success: true, count: registrosCreados.length, duplicadosOmitidos: omitidosDuplicados, tiendas: resumenTiendas, fichasEnCurso });
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
        const tiendas = await Tienda.find({ empresa }).select('nombre').lean();
        const tiendaPorNombre = new Map(tiendas.map((t) => [String(t.nombre).trim(), t._id]));
        const marca = Date.now();
        const productosProcesados = [];
        for (const [indice, original] of productos.entries()) {
            if (!original || typeof original !== 'object') continue;
            // Sin _id: así un backup se puede restaurar aunque los productos sigan existiendo.
            const p = await resolverFotosEntrantes(empresa, limpiarCamposProtegidosVenta(original));
            const nombreTienda = String(p.proveedor || '').trim();
            delete p.proveedor;
            productosProcesados.push({
                ...p,
                empresa,
                tienda: tiendaPorNombre.get(nombreTienda) || null,
                sku: p.sku || `BK-${marca}-${indice}`
            });
        }

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
        const { urlOrigen, empresa: empresaBody, error: errorMsg } = req.body || {};
        const productos = Array.isArray(req.body?.productos) ? req.body.productos : [];
        const empresa = normalizarEmpresa(empresaBody || EMPRESA_DEFAULT);

        if (errorMsg) {
            console.error(`[GITHUB-WEBHOOK-ERROR] Recibido error de scraper: ${errorMsg}`);
            emitirEventoScraper(empresa, 'scraper_update', {
                error: errorMsg,
                empresa,
                urlOrigen: urlOrigen,
                timestamp: new Date()
            });
            return res.json({ success: true, status: 'error_received' });
        }

        console.log(`[GITHUB-WEBHOOK] Recibidos ${productos.length} productos de ${urlOrigen}`);
        
        // Notificar a los administradores conectados vía Socket.io
        emitirEventoScraper(empresa, 'scraper_update', { // Notificar al room correcto
            mensaje: `GitHub ha terminado de escanear ${productos.length} productos.`,
            productos: productos,
            empresa,
            urlOrigen: urlOrigen,
            timestamp: new Date()
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error procesando webhook' });
    }
});

/**
 * Eventos de scraping recientes de la empresa (para recuperar los que llegaron sin socket).
 */
app.get('/api/scraper/eventos', exigeAdmin, (req, res) => {
    const empresa = empresaActual(req);
    const tipo = req.query.tipo === 'monopolio' ? 'monopolio_update' : 'scraper_update';
    const desde = Number(req.query.desde) || 0;
    const cfg = EVENTOS_SCRAPER_LIMITES[tipo];
    const ahora = Date.now();
    const eventos = (EVENTOS_SCRAPER.get(`${empresa}|${tipo}`) || [])
        .filter((e) => e.ts > desde && (ahora - e.ts) < cfg.ttlMs)
        .map((e) => e.evento);
    res.json({ eventos });
});

/**
 * Aplica cambios de precio a productos existentes
 */
app.post('/api/scraper/aplicar', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const cambios = (Array.isArray(req.body?.cambios) ? req.body.cambios : [])
            .filter((c) => c && mongoose.isValidObjectId(c.idMongo) && Number.isFinite(Number(c.valorNuevo)));
        if (cambios.length === 0) return res.status(400).json({ error: 'No hay cambios válidos para aplicar.' });

        const hoy = new Date().toISOString().slice(0, 10);
        const resultado = await VentaRopa.bulkWrite(cambios.map((cambio) => ({
            updateOne: {
                filter: { _id: cambio.idMongo, empresa },
                update: {
                    $set: {
                        precioVenta: Number(cambio.valorNuevo),
                        ...(String(cambio.prenda || '').trim() ? { prenda: String(cambio.prenda).trim() } : {}),
                        fechaModificacion: hoy
                    }
                }
            }
        })), { ordered: false });
        cambios.forEach((cambio) => registrarLog(req.session.email, `Sincronización artículo: ${cambio.prenda} -> ${cambio.valorNuevo}€`));
        invalidateKpiResumenCache(empresa);
        res.json({ success: true, modificados: resultado.modifiedCount });
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

// Lanza cada URL de Monopolio en GitHub Actions. Lo que no se pueda lanzar, o todo si
// GitHub no arranca los jobs (cuenta bloqueada, sin minutos...), se analiza desde el servidor.
async function despacharMonopolio(empresa, items) {
    const serverTime = Date.now();
    if (!githubActionsDisponible()) {
        lanzarFallbackMonopolioLocal(empresa, items);
        return { serverTime, lanzadas: 0, errores: [], fallbackItems: items, soloServidor: true };
    }

    let lanzadas = 0;
    const errores = [];
    const lanzadasOk = [];
    for (const item of items) {
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
            lanzadasOk.push(item);
        } catch (errItem) {
            errores.push({
                url: item.url,
                alias: item.alias || item.url,
                detalle: errItem?.response?.data?.message || errItem?.response?.data?.error || errItem.message || 'error desconocido'
            });
        }
        await esperar(400);
    }

    const fallbackItems = errores.map((e) => ({ url: e.url, alias: e.alias || e.url }));
    if (fallbackItems.length > 0) lanzarFallbackMonopolioLocal(empresa, fallbackItems);
    if (lanzadasOk.length > 0) vigilarArranqueGithub(serverTime, () => lanzarFallbackMonopolioLocal(empresa, lanzadasOk));
    return { serverTime, lanzadas, errores, fallbackItems, soloServidor: false };
}

// Endpoint para disparar el scraping de todas las URLs guardadas
app.post('/api/monopolio/scrape-all', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const urls = await MonopolioUrl.find({ empresa }).lean();
        console.log(`[MONOPOLIO] scrape-all empresa=${empresa} urls=${urls.length}`);
        if (urls.length === 0) {
            return res.status(400).json({ error: 'No hay URLs guardadas para scrapear.' });
        }

        const { serverTime, lanzadas, errores, fallbackItems, soloServidor } = await despacharMonopolio(
            empresa,
            urls.map((item) => ({ url: item.url, alias: String(item.alias || '').trim() || sugerirAliasDesdeUrl(item.url) }))
        );

        if (lanzadas === 0 && fallbackItems.length > 0) {
            return res.json({
                success: true,
                serverTime,
                lanzadas: 0,
                lanzadasLocal: fallbackItems.length,
                fallidas: 0,
                detallesFallos: [],
                message: soloServidor
                    ? `GitHub Actions no está disponible: analizando ${fallbackItems.length} URL(s) desde el servidor.`
                    : `GitHub no respondió. Se analizan ${fallbackItems.length} URL(s) desde el servidor.`
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
            serverTime,
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

        const { serverTime, lanzadas, errores, fallbackItems, soloServidor } = await despacharMonopolio(empresa, normalizadas);

        if (lanzadas === 0 && fallbackItems.length > 0) {
            return res.json({
                success: true,
                serverTime,
                lanzadas: 0,
                lanzadasLocal: fallbackItems.length,
                fallidas: 0,
                detallesFallos: [],
                totalSolicitadas: normalizadas.length,
                message: soloServidor
                    ? `GitHub Actions no está disponible: analizando ${fallbackItems.length} URL(s) desde el servidor.`
                    : `GitHub no respondió. Se analizan ${fallbackItems.length} URL(s) desde el servidor.`
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
            serverTime,
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

        // Presupuesto de tiempo: la petición HTTP no puede quedarse colgada minutos explorando.
        const resultado = await scrapeMonopolio(url, alias, {
            discoverOnly: true,
            maxProfiles,
            timeBudgetMs: 70000
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
            emitirEventoScraper(empresaNormalizada, 'monopolio_update', {
                error: errorMsg,
                empresa: empresaNormalizada,
                urlOrigen,
                alias,
                timestamp: new Date()
            });
            return res.json({ success: true, status: 'error_received' });
        }

        console.log(`[MONOPOLIO-WEBHOOK] Recibidos ${(productos || []).length} productos de ${alias || urlOrigen}`);
        if (urlOrigen) {
            MonopolioUrl.updateOne(
                { empresa: empresaNormalizada, url: normalizarUrlObjetivo(urlOrigen) },
                { $set: { lastScraped: new Date() } }
            ).catch(() => {});
        }
        emitirEventoScraper(empresaNormalizada, 'monopolio_update', {
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
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error procesando webhook de monopolio' });
    }
});
