require('dotenv').config(); 
const express = require('express');
const { OAuth2Client } = require('google-auth-library'); 
const session = require('express-session'); 
const MongoStoreModule = require('connect-mongo'); // Importa el módulo completo
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
// const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Desactivado temporalmente
const nodemailer = require('nodemailer');

const app = express();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ⚙️ CONFIGURACIÓN DE ENTORNO
const isProd = process.env.NODE_ENV === 'production';
console.log(`[INIT] Modo: ${isProd ? 'PROD' : 'DEV'}`);

app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    next();
});

// Stripe webhook necesita el body raw, así que lo ponemos antes del parser de JSON
// app.post('/api/stripe/webhook', ...); // Desactivado temporalmente

// Es vital para que las sesiones funcionen en plataformas como Render/Heroku
app.set('trust proxy', 1);
app.enable('trust proxy');
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 🔒 CONEXIÓN DEPURADA: Purgadas las credenciales del código fuente
const MONGO_URI_FINAL = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/seychelles_crm';

if (!MONGO_URI_FINAL) {
    console.error('\x1b[31m[ERROR]\x1b[0m No se detectó la variable MONGODB_URI en el entorno.');
}

// Función de soporte para evitar errores al notificar actualizaciones en clientes
function notificarCambio() {
    // Placeholder preparado para usar WebSockets en el futuro
}

// --- Modelos de MongoDB ---


const NegocioSchema = new mongoose.Schema({
    nombre: { type: String, required: true, unique: true },
    tipo: { type: String, default: 'General' },
    nombreVisible: { type: String, trim: true },
    plan: { type: String, default: 'free' },
    fechaCreacion: { type: Date, default: Date.now }
    // Campos de Stripe desactivados temporalmente
    // stripeCustomerId: String,
    // stripeSubscriptionId: String,
    // stripePriceId: String,
    // stripeCurrentPeriodEnd: Date
});
const Negocio = mongoose.model('Negocio', NegocioSchema);

const TiendaSchema = new mongoose.Schema({
    negocio: { type: mongoose.Schema.Types.ObjectId, ref: 'Negocio' },
    nombre: { type: String, required: true, trim: true },
    fechaCreacion: { type: Date, default: Date.now }
});
TiendaSchema.index({ negocio: 1, nombre: 1 }, { unique: true });
const Tienda = mongoose.models.Tienda || mongoose.model('Tienda', TiendaSchema);

const CategoriaSchema = new mongoose.Schema({
    negocio: { type: mongoose.Schema.Types.ObjectId, ref: 'Negocio' },
    nombre: { type: String, required: true, trim: true }
});
CategoriaSchema.index({ negocio: 1, nombre: 1 }, { unique: true });
const Categoria = mongoose.models.Categoria || mongoose.model('Categoria', CategoriaSchema);

const ClienteSchema = new mongoose.Schema({
    negocio: { type: mongoose.Schema.Types.ObjectId, ref: 'Negocio' },
    nombre: { type: String, required: true, trim: true },
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

const GastoSchema = new mongoose.Schema({
    negocio: { type: mongoose.Schema.Types.ObjectId, ref: 'Negocio' },
    fecha: { type: String, default: () => new Date().toISOString().split('T')[0] },
    concepto: { type: String, required: true },
    monto: { type: Number, required: true },
    categoria: { type: String, default: 'General' }
});
const Gasto = mongoose.models.Gasto || mongoose.model('Gasto', GastoSchema);

const EstadoKanbanSchema = new mongoose.Schema({
    negocio: { type: mongoose.Schema.Types.ObjectId, ref: 'Negocio' },
    nombre: { type: String, required: true, trim: true },
    icono: { type: String, default: '📦' },
    color: { type: String, default: 'slate' },
    rolFinanciero: { type: String, enum: ['Stock', 'Venta', 'Oculto'], default: 'Stock' },
    orden: { type: Number, default: 0 }
});
EstadoKanbanSchema.index({ negocio: 1, nombre: 1 }, { unique: true });
const EstadoKanban = mongoose.models.EstadoKanban || mongoose.model('EstadoKanban', EstadoKanbanSchema);

const VentaRopaSchema = new mongoose.Schema({
    negocio: { type: mongoose.Schema.Types.ObjectId, ref: 'Negocio' },
    fecha: { type: String, default: () => new Date().toISOString().split('T')[0] },
    sku: { type: String, default: '', trim: true },
    prenda: { type: String, default: 'Artículo Escaneado', trim: true },
    categoria: { type: String, default: 'Camisetas' },
    talla: { type: String, default: 'M' },
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
    negocio: { type: mongoose.Schema.Types.ObjectId, ref: 'Negocio' },
    fechaHora: { type: Date, default: Date.now },
    usuario: { type: String, required: true },
    accion: { type: String, required: true },
    ip: { type: String },
    ciudad: { type: String },
    pais: { type: String },
    lat: { type: Number },
    lon: { type: Number }
});
const LogAuditoria = mongoose.models.LogAuditoria || mongoose.model('LogAuditoria', LogAuditoriaSchema);

const TareaSchema = new mongoose.Schema({
    negocio: { type: mongoose.Schema.Types.ObjectId, ref: 'Negocio' },
    titulo: { type: String, required: true, trim: true },
    descripcion: { type: String, default: '', trim: true },
    estado: { type: String, enum: ['Pendiente', 'En Proceso', 'Completada'], default: 'Pendiente' },
    prioridad: { type: String, enum: ['Baja', 'Media', 'Alta'], default: 'Media' },
    fechaVencimiento: { type: String, default: '' },
    fechaCreacion: { type: Date, default: Date.now }
});
const Tarea = mongoose.models.Tarea || mongoose.model('Tarea', TareaSchema);

const FaqSchema = new mongoose.Schema({
    negocio: { type: mongoose.Schema.Types.ObjectId, ref: 'Negocio' },
    pregunta: { type: String, required: true, trim: true },
    respuesta: { type: String, required: true, trim: true },
    fechaCreacion: { type: Date, default: Date.now }
});
const Faq = mongoose.models.Faq || mongoose.model('Faq', FaqSchema);

const NotaSchema = new mongoose.Schema({
    negocio: { type: mongoose.Schema.Types.ObjectId, ref: 'Negocio' },
    texto: { type: String, default: 'Nueva nota...', trim: true },
    color: { type: String, default: 'bg-yellow-400' },
    x: { type: Number, default: 20 },
    y: { type: Number, default: 40 },
    width: { type: Number, default: 150 },
    height: { type: Number, default: 120 },
    usuario: String,
    fecha: { type: Date, default: Date.now }
});
const Nota = mongoose.models.Nota || mongoose.model('Nota', NotaSchema);

const UsuarioAutorizadoSchema = new mongoose.Schema({
    negocio: { type: mongoose.Schema.Types.ObjectId, ref: 'Negocio' },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    rol: { type: String, enum: ['Admin', 'Manager', 'Employee', 'Editor', 'Lector'], default: 'Employee' },
    fechaAgregado: { type: Date, default: Date.now },
    ultimaConexion: { type: Date }
});
const UsuarioAutorizado = mongoose.models.UsuarioAutorizado || mongoose.model('UsuarioAutorizado', UsuarioAutorizadoSchema);

const MongoStore = MongoStoreModule.default || MongoStoreModule; // Obtiene la clase MongoStore, manejando el 'default' export si existe

mongoose.connect(MONGO_URI_FINAL || 'mongodb://localhost:27017/seychelles_crm')
    .then(async () => {
        console.log('\x1b[32m[OK]\x1b[0m Core Estable de Seychelles conectado a MongoDB Atlas.');

        // --- MIGRACIÓN LEGACY Y SEEDING INICIAL ---
        const legacyEmails = ['dannymedinacoronel@gmail.com', 'juliamugo2001@gmail.com'];
        let seychellesOriginal = await Negocio.findOne({ nombre: 'Seychelles Original' });

        if (!seychellesOriginal) {
            seychellesOriginal = new Negocio({ nombre: 'Seychelles Original', nombreVisible: 'Seychelles Shop', tipo: 'Tienda de Ropa' });
            await seychellesOriginal.save();
            console.log('[MIGRATION] Creado el negocio "Seychelles Original".');
        }

        // Asignar usuarios legacy al negocio original
        for (const email of legacyEmails) {
            let usuario = await UsuarioAutorizado.findOne({ email });
            if (usuario && !usuario.negocio) {
                usuario.negocio = seychellesOriginal._id;
                usuario.rol = 'Admin';
                await usuario.save();
                console.log(`[MIGRATION] Usuario ${email} asignado a "Seychelles Original".`);
            }
        }

        // Migrar datos sin negocio al negocio "Seychelles Original"
        const migrateCollection = async (model, modelName) => {
            const count = await model.countDocuments({ negocio: { $exists: false } });
            if (count > 0) {
                await model.updateMany({ negocio: { $exists: false } }, { $set: { negocio: seychellesOriginal._id } });
                console.log(`[MIGRATION] ${count} documentos de ${modelName} asignados a "Seychelles Original".`);
            }
        };

        await migrateCollection(VentaRopa, 'VentaRopa');
        await migrateCollection(Cliente, 'Cliente');
        await migrateCollection(Gasto, 'Gasto');
        await migrateCollection(Tienda, 'Tienda');
        await migrateCollection(Categoria, 'Categoria');
        await migrateCollection(EstadoKanban, 'EstadoKanban');
        await migrateCollection(LogAuditoria, 'LogAuditoria');
        await migrateCollection(Tarea, 'Tarea');
        await migrateCollection(Faq, 'Faq');
        await migrateCollection(Nota, 'Nota');

        // Seedear datos si el negocio legacy no los tiene, lo que arregla el problema de visualización.
        const legacyEstadoCount = await EstadoKanban.countDocuments({ negocio: seychellesOriginal._id });
        if (legacyEstadoCount === 0) {
            await EstadoKanban.insertMany([
                { negocio: seychellesOriginal._id, nombre: 'No Vendido', icono: '📦', color: 'amber', rolFinanciero: 'Stock', orden: 1 },
                { negocio: seychellesOriginal._id, nombre: 'Vendido', icono: '💰', color: 'emerald', rolFinanciero: 'Venta', orden: 2 },
                { negocio: seychellesOriginal._id, nombre: 'Reservado', icono: '🤝', color: 'indigo', rolFinanciero: 'Stock', orden: 3 },
                { negocio: seychellesOriginal._id, nombre: 'Devuelto', icono: '⚠️', color: 'rose', rolFinanciero: 'Oculto', orden: 4 }
            ]);
            console.log('[MIGRATION] Inyectados estados Kanban para "Seychelles Original".');
        }
    })
    .catch(err => console.error('Fallo crítico en Atlas. Verifica tus variables en Render:', err));

app.use(session({
    name: 'seychelles.sid', // Nombre único para evitar conflictos
    secret: process.env.SESSION_SECRET || 'clave_maestra_seychelles_987654321',
    resave: false, 
    saveUninitialized: false, 
    proxy: true, // Necesario para que las cookies funcionen tras el balanceador de carga de Render
    store: MongoStore.create({ mongoUrl: MONGO_URI_FINAL, collectionName: 'sesiones_activas', ttl: 14 * 24 * 60 * 60 }),
    cookie: { 
        secure: isProd, 
        sameSite: isProd ? 'none' : 'lax', // Permite el flujo de Google
        maxAge: 14 * 24 * 60 * 60 * 1000 
    }
}));

app.use(express.static(path.join(__dirname, 'public')));
function exigeLogin(req, res, next) {
    if (req.session && req.session.email && req.session.negocioId) {
        return next();
    }
    res.status(401).json({ error: 'No autorizado o sesión caducada.' });
}

function exigeEditor(req, res, next) {
    if (req.session && req.session.rol && ['Admin', 'Editor', 'Manager'].includes(req.session.rol)) {
        return next();
    }
    res.status(403).json({ error: 'Permisos insuficientes. Se requiere rol de Editor o superior.' });
}

function exigeAdmin(req, res, next) {
    if (req.session && req.session.rol && ['Admin'].includes(req.session.rol)) {
        return next();
    }
    res.status(403).json({ error: 'Permisos insuficientes. Se requiere rol de Administrador.' });
}

async function registrarLog(usuario, accion, locationData = {}, negocioId = null) {
    try {
        const nuevoLog = new LogAuditoria({ 
            usuario, 
            accion,
            negocio: negocioId,
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
    }
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

        const mailOptions = {
            from: process.env.BACKUP_EMAIL_USER,
            to: 'dannymedinacoronel@gmail.com',
            subject: `BACKUP_${dateStr}`,
            text: `Backup diario automático generado el ${ahora.toLocaleString('es-ES')}.`,
            attachments: [{ filename: `Backup_Seychelles_${dateStr}.json`, content: backupData }]
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

app.get('/api/categorias', exigeLogin, async (req, res) => {
    try {
        const categorias = await Categoria.find({ negocio: req.session.negocioId }).sort({ nombre: 1 }).lean();
        res.json({ categorias });
    } catch (e) { res.status(500).json({ error: 'Fallo al recuperar categorías.' }); }
});

app.post('/api/categorias', exigeEditor, async (req, res) => {
    try {
        const nombreLimpio = req.body.nombre ? req.body.nombre.trim() : "";
        if (!nombreLimpio) return res.status(400).json({ error: 'Nombre requerido.' });
        const nueva = new Categoria({ nombre: nombreLimpio, negocio: req.session.negocioId });
        await nueva.save();
        await registrarLog(req.session.email, `Creó nueva categoría: ${nombreLimpio}`, {}, req.session.negocioId);
        res.json({ status: 'success', categoria: nueva });
    } catch (e) { res.status(400).json({ error: 'La categoría ya existe.' }); }
});

app.put('/api/categorias/:id', exigeEditor, async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre } = req.body;
        const cat = await Categoria.findOneAndUpdate({ _id: id, negocio: req.session.negocioId }, { nombre }, { new: true });
        await registrarLog(req.session.email, `Modificó categoría: ${nombre}`, {}, req.session.negocioId);
        res.json(cat);
    } catch (e) { res.status(400).json({ error: 'Error al actualizar categoría.' }); }
});

app.delete('/api/categorias/:id', exigeEditor, async (req, res) => {
    try {
        const { id } = req.params;
        const cat = await Categoria.findOne({ _id: id, negocio: req.session.negocioId });
        if (!cat) return res.status(404).json({ error: 'No existe.' });
        await Categoria.findOneAndDelete({ _id: id, negocio: req.session.negocioId });
        await registrarLog(req.session.email, `Eliminó categoría: ${cat.nombre}`, {}, req.session.negocioId);
        res.sendStatus(200);
    } catch (e) { res.status(500).json({ error: 'Error al purgar categoría.' }); }
});

// --- Rutas de Tiendas ---

app.get('/api/tiendas', exigeLogin, async (req, res) => {
    try {
        const tiendas = await Tienda.find({ negocio: req.session.negocioId }).sort({ nombre: 1 }).lean();
        res.json({ tiendas });
    } catch (e) {
        res.status(500).json({ error: 'Fallo al recuperar tiendas.' });
    }
});

app.post('/api/tiendas', exigeEditor, async (req, res) => {
    try {
        const nombreLimpio = req.body.nombre ? req.body.nombre.trim() : "";
        if (!nombreLimpio) return res.status(400).json({ error: 'El nombre es obligatorio.' });

        const nuevaTienda = new Tienda({ nombre: nombreLimpio, negocio: req.session.negocioId });
        await nuevaTienda.save();
        await registrarLog(req.session.email, `Creó la tienda en MongoDB: ${nuevaTienda.nombre}`, {}, req.session.negocioId);
        res.json({ status: 'success', tienda: nuevaTienda });
    } catch (e) {
        res.status(400).json({ error: 'La tienda ya existe o hay un error de validación.' });
    }
});

// BAJA DE TIENDA
app.delete('/api/tiendas/:id', exigeEditor, async (req, res) => {
    try {
        const { id } = req.params;
        
        const tiendaPorBorrar = await Tienda.findOne({ _id: id, negocio: req.session.negocioId });
        if (!tiendaPorBorrar) return res.status(404).json({ error: 'La tienda no existe.' });

        // Desasignar tienda de los productos asociados
        await VentaRopa.updateMany({ tienda: id, negocio: req.session.negocioId }, { $unset: { tienda: 1 } });
        await Tienda.findOneAndDelete({ _id: id, negocio: req.session.negocioId });

        await registrarLog(req.session.email, `Eliminó la tienda "${tiendaPorBorrar.nombre}".`, {}, req.session.negocioId);
        return res.sendStatus(200);
    } catch (err) {
        console.error("Error al borrar tienda:", err);
        return res.status(500).json({ error: 'Fallo crítico al purgar la tienda.' });
    }
});

// --- Rutas de Auth ---

app.get('/api/auth/verificar', (req, res) => {
    if (req.session && req.session.email && req.session.negocioId) return res.json({ autenticado: true, usuario: req.session.email, rol: req.session.rol || 'Admin', plan: 'business' }); // Forzamos plan business en beta
    return res.json({ autenticado: false, error: 'No hay sesión activa' });
});


async function verificarTokenGoogle(token) {
    try {
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        return ticket.getPayload();
    } catch (error) {
        console.error("Error al verificar token de Google:", error);
        return null;
    }
}

app.post('/api/auth/google', async (req, res) => {
    try {
        const { token, clientLocation } = req.body;
        const payload = await verificarTokenGoogle(token);
        if (!payload || !payload.email) return res.status(401).json({ error: 'Token inválido' });

        const email = payload.email.toLowerCase();
        let usuario = await UsuarioAutorizado.findOne({ email }).populate('negocio');

        if (usuario) {
            req.session.email = usuario.email;
            req.session.rol = usuario.rol;
            req.session.negocioId = usuario.negocio._id;
            req.session.negocioPlan = usuario.negocio.plan || 'free';
            if (usuario.rol === 'Admin') {
                req.session.esAdmin = true;
            }
            
            const locationData = await obtenerUbicacionCompleta(req, clientLocation);
            await registrarLog(usuario.email, "Inició sesión exitosamente", locationData, usuario.negocio._id);
            req.session.save((err) => {
                if(err) console.error("Session save error", err);
                return res.json({ success: true, email: usuario.email, redirect: '/' });
            });
        } else {
            // No existe usuario, necesita setup de negocio
            return res.json({ success: false, setupRequired: true, email: email });
        }
    } catch (e) {
        console.error("Error en login Google:", e);
        res.status(500).json({ error: 'Error interno de autenticación' });
    }
});

// --- Rutas de Gestión de Usuarios ---
app.get('/api/usuarios-admin', exigeAdmin, async (req, res) => {
    try { 
        res.json(await UsuarioAutorizado.find({ negocio: req.session.negocioId }).sort({ fechaAgregado: -1 }));
    } catch (e) { res.status(500).send(e); }
});

app.post('/api/usuarios-admin', exigeAdmin, async (req, res) => {
    try {
        if (req.session.negocioPlan === 'free') {
            const userCount = await UsuarioAutorizado.countDocuments({ negocio: req.session.negocioId });
            if (userCount >= 2) { // Admin + 1
                return res.status(403).json({ error: 'Has alcanzado el límite de 2 usuarios de tu plan gratuito.' });
            }
        }
        const emailLimpio = req.body.email ? req.body.email.toLowerCase().trim() : "";
        const rolAsignado = req.body.rol || "Editor";
        if (!emailLimpio) return res.status(400).json({ error: 'Email requerido.' });
        const nuevo = new UsuarioAutorizado({ email: emailLimpio, rol: rolAsignado, negocio: req.session.negocioId });
        await nuevo.save();
        await registrarLog(req.session.email, `Autorizó cuenta: ${emailLimpio} [Rol: ${rolAsignado}]`, {}, req.session.negocioId);
        res.json(nuevo);
    } catch (e) { res.status(400).json({ error: 'El usuario ya está autorizado en la lista.' }); }
});

app.delete('/api/usuarios-admin/:id', exigeAdmin, async (req, res) => {
    try {
        const u = await UsuarioAutorizado.findOne({ _id: req.params.id, negocio: req.session.negocioId });
        if (u) {
            await UsuarioAutorizado.deleteOne({ _id: req.params.id });
            await registrarLog(req.session.email, `Revocó el acceso permanente a: ${u.email}`, {}, req.session.negocioId);
        }
        res.sendStatus(200);
    } catch (e) { res.status(500).send(e); }
});

// --- Rutas de Tareas (Kanban) ---
app.get('/api/tareas', exigeLogin, async (req, res) => {
    try { res.json(await Tarea.find({ negocio: req.session.negocioId }).sort({ fechaCreacion: -1 })); } catch (e) { res.status(500).send(e); }
});
app.post('/api/tareas', exigeEditor, async (req, res) => {
    try {
        const nueva = new Tarea({ ...req.body, negocio: req.session.negocioId });
        await nueva.save();
        await registrarLog(req.session.email, `Creó una tarea: ${nueva.titulo}`, {}, req.session.negocioId);
        res.json(nueva);
    } catch (e) { res.status(400).send(e); }
});
app.put('/api/tareas/:id', exigeEditor, async (req, res) => {
    try {
        const tarea = await Tarea.findOneAndUpdate({ _id: req.params.id, negocio: req.session.negocioId }, req.body, { new: true });
        await registrarLog(req.session.email, `Actualizó la tarea: ${tarea.titulo}`, {}, req.session.negocioId);
        res.json(tarea);
    } catch (e) { res.status(400).send(e); }
});
app.put('/api/tareas/:id/estado', exigeEditor, async (req, res) => {
    try {
        const tarea = await Tarea.findOneAndUpdate({ _id: req.params.id, negocio: req.session.negocioId }, { estado: req.body.estado }, { new: true });
        await registrarLog(req.session.email, `Movió tarea a ${req.body.estado}: ${tarea.titulo}`, {}, req.session.negocioId);
        res.json(tarea);
    } catch (e) { res.status(400).send(e); }
});
app.delete('/api/tareas/:id', exigeEditor, async (req, res) => {
    try {
        const tarea = await Tarea.findOneAndDelete({ _id: req.params.id, negocio: req.session.negocioId });
        if(tarea) await registrarLog(req.session.email, `Eliminó la tarea: ${tarea.titulo}`, {}, req.session.negocioId);
        res.sendStatus(200);
    } catch (e) { res.status(500).send(e); }
});

// --- Rutas de FAQs Dinámicas ---
app.get('/api/faqs', exigeLogin, async (req, res) => {
    try { res.json(await Faq.find({ negocio: req.session.negocioId }).sort({ fechaCreacion: 1 })); } catch (e) { res.status(500).send(e); }
});
app.post('/api/faqs', exigeEditor, async (req, res) => {
    try {
        const nueva = new Faq({ ...req.body, negocio: req.session.negocioId }); await nueva.save();
        await registrarLog(req.session.email, `Añadió nueva FAQ`, {}, req.session.negocioId); res.json(nueva);
    } catch (e) { res.status(400).send(e); }
});
app.put('/api/faqs/:id', exigeEditor, async (req, res) => {
    try {
        const f = await Faq.findOneAndUpdate({ _id: req.params.id, negocio: req.session.negocioId }, req.body, { new: true });
        await registrarLog(req.session.email, `Modificó una FAQ`, {}, req.session.negocioId); res.json(f);
    } catch (e) { res.status(400).send(e); }
});
app.delete('/api/faqs/:id', exigeEditor, async (req, res) => {
    try { await Faq.findOneAndDelete({ _id: req.params.id, negocio: req.session.negocioId }); await registrarLog(req.session.email, `Eliminó una FAQ`, {}, req.session.negocioId); res.sendStatus(200); } catch (e) { res.status(500).send(e); }
});

// --- Rutas de Ajustes del Tablero Kanban ---
app.get('/api/estados-kanban', exigeLogin, async (req, res) => {
    try { res.json(await EstadoKanban.find({ negocio: req.session.negocioId }).sort({ orden: 1 })); } catch (e) { res.status(500).send(e); }
});
app.post('/api/estados-kanban', exigeAdmin, async (req, res) => {
    try {
        const nuevo = new EstadoKanban({ ...req.body, negocio: req.session.negocioId }); await nuevo.save();
        await registrarLog(req.session.email, `Creó el estado Kanban: ${nuevo.nombre}`, {}, req.session.negocioId); res.json(nuevo);
    } catch (e) { res.status(400).send(e); }
});
app.put('/api/estados-kanban/:id', exigeAdmin, async (req, res) => {
    try {
        const estado = await EstadoKanban.findOneAndUpdate({ _id: req.params.id, negocio: req.session.negocioId }, req.body, { new: true });
        await registrarLog(req.session.email, `Modificó estado Kanban: ${estado.nombre}`, {}, req.session.negocioId); res.json(estado);
    } catch (e) { res.status(400).send(e); }
});
app.delete('/api/estados-kanban/:id', exigeAdmin, async (req, res) => {
    try {
        const estado = await EstadoKanban.findOneAndDelete({ _id: req.params.id, negocio: req.session.negocioId });
        if(estado) await registrarLog(req.session.email, `Eliminó el estado Kanban: ${estado.nombre}`, {}, req.session.negocioId); res.sendStatus(200);
    } catch (e) { res.status(500).send(e); }
});

// --- Ruta del Asistente IA (Together AI - Llama 3) ---
app.post('/api/chat', exigeEditor, async (req, res) => {
    const { mensaje, imagen } = req.body;
    if (!mensaje && !imagen) return res.status(400).json({ error: 'Mensaje vacío' });

    const apiKey = (process.env.TOGETHER_API_KEY || '').replace(/['"]/g, '').trim();
    
    // Fallback amigable si el usuario aún no ha configurado la API Key
    if (!apiKey) {
        return res.json({
            respuesta: "He migrado a un nuevo motor de IA más estable: **Together AI**. Para activarme, crea una cuenta gratuita en **api.together.ai**, genera una clave y pégala en la variable de entorno `TOGETHER_API_KEY` en Render. ¡Te dan 25$ de crédito gratis que duran meses!"
        });
    }

    try {
        // 1. Damos visión del inventario a la IA para que pueda analizarlo (Máx 150 items recientes)
        const productos = await VentaRopa.find({ negocio: req.session.negocioId }).select('sku prenda estado precioVenta cantidad').limit(150).lean();
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
                    await VentaRopa.findOneAndUpdate({ sku: params.sku, negocio: req.session.negocioId }, { precioVenta: parseFloat(params.precio) });
                    await registrarLog(req.session.email, `IA actualizó precio de ${params.sku}`, {}, req.session.negocioId);
                } else if (actionType === 'CAMBIAR_ESTADO' && params.sku && params.estado) {
                    await VentaRopa.findOneAndUpdate({ sku: params.sku, negocio: req.session.negocioId }, { estado: params.estado });
                    await registrarLog(req.session.email, `IA cambió estado de ${params.sku} a ${params.estado}`, {}, req.session.negocioId);
                } else if (actionType === 'BORRAR_PRODUCTO' && params.sku) {
                    await VentaRopa.findOneAndDelete({ sku: params.sku, negocio: req.session.negocioId });
                    await registrarLog(req.session.email, `IA borró producto ${params.sku}`, {}, req.session.negocioId);
                } else if (actionType === 'CREAR_PRODUCTO' && params.prenda) {
                    const nuevo = new VentaRopa({
                        negocio: req.session.negocioId,
                        sku: `IA-${Date.now().toString().slice(-6)}`,
                        prenda: params.prenda, precioVenta: parseFloat(params.precio) || 0,
                        categoria: params.categoria || 'General', estado: 'No Vendido',
                        imagen: imagen || '' // Se guarda la foto que le pasaste en el chat directamente en la ficha del producto!
                    });
                    await nuevo.save();
                    await registrarLog(req.session.email, `IA creó producto ${params.prenda}`, {}, req.session.negocioId);
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

app.get('/api/notas', exigeLogin, async (req, res) => {
    try {
        const notas = await Nota.find({ negocio: req.session.negocioId }).lean();
        res.json(notas);
    } catch (e) { res.status(500).json({ error: 'Fallo al recuperar notas.' }); }
});

app.post('/api/notas', exigeEditor, async (req, res) => {
    try {
        const count = await Nota.countDocuments({ negocio: req.session.negocioId });
        if (count >= 10) return res.status(400).json({ error: 'Límite de 10 notas alcanzado.' });
        const nuevaNota = new Nota({ ...req.body, usuario: req.session.email, negocio: req.session.negocioId });
        await nuevaNota.save();
        res.json(nuevaNota);
    } catch (e) { res.status(500).json({ error: 'Error al crear nota.' }); }
});

app.put('/api/notas/:id', exigeEditor, async (req, res) => {
    try {
        const notaActualizada = await Nota.findOneAndUpdate({ _id: req.params.id, negocio: req.session.negocioId }, req.body, { new: true });
        res.json(notaActualizada);
    } catch (e) { res.status(500).json({ error: 'Error al mover nota.' }); }
});

app.delete('/api/notas/:id', exigeEditor, async (req, res) => {
    try {
        const { id } = req.params;
        await Nota.findOneAndDelete({ _id: id, negocio: req.session.negocioId });
        res.sendStatus(200);
    } catch (e) { res.status(500).json({ error: 'Error al borrar nota.' }); }
});

// --- Rutas de Ventas / Inventario ---

/**
 * Recupera logs de auditoría para el calendario (filtrado por mes/año)
 */
app.get('/api/logs/calendario', exigeLogin, async (req, res) => {
    try {
        const { mes, anio } = req.query; // mes: 1-12
        if (!mes || !anio) return res.status(400).json({ error: 'Mes y año requeridos.' });

        const m = parseInt(mes);
        const a = parseInt(anio);
        
        const fechaInicio = new Date(Date.UTC(a, m - 1, 1, 0, 0, 0));
        const fechaFin = new Date(Date.UTC(a, m, 0, 23, 59, 59)); 
        
        const logs = await LogAuditoria.find({
            fechaHora: { $gte: fechaInicio, $lte: fechaFin }
        }).sort({ fechaHora: 1 }).lean();
        
        res.json({ logs });
    } catch (e) { res.status(500).json({ error: 'Fallo al recuperar logs.' }); }
});

app.get('/api/logs/locations', exigeLogin, async (req, res) => {
    try {
        // Recuperamos logs de conexiones Y desconexiones con coordenadas
        const activityLogs = await LogAuditoria.find({
            lat: { $ne: null }, lon: { $ne: null },
            accion: { $in: [ /Inició sesión/i, /Cerró sesión/i ] }
        }).lean();

        // Adicionalmente, buscar el último log de conexión para centrar el mapa
        const lastLoginLog = await LogAuditoria.findOne({
            accion: /Inició sesión/i,
            lat: { $ne: null }, lon: { $ne: null }
        }).sort({ fechaHora: -1 }).lean();

        // Agrupar los datos para obtener localizaciones únicas y sus eventos
        const locations = {};
        activityLogs.forEach(log => {
            const key = `${log.lat.toFixed(4)},${log.lon.toFixed(4)}`; // Agrupar por coordenadas cercanas
            if (!locations[key]) {
                locations[key] = {
                    lat: log.lat,
                    lon: log.lon,
                    ciudad: log.ciudad || 'Desconocida',
                    pais: log.pais || 'Desconocido',
                    count: 0,
                    eventos: []
                };
            }
            locations[key].count++;
            locations[key].eventos.push({
                usuario: log.usuario, accion: log.accion, fecha: log.fechaHora
            });
        });

        res.json({
            locations: Object.values(locations),
            lastLogin: lastLoginLog 
        });

    } catch (e) { res.status(500).json({ error: 'Fallo al recuperar datos del mapa.' }); }
});

// --- Rutas de Clientes (CRM) ---
app.get('/api/clientes', exigeLogin, async (req, res) => {
    try { res.json(await Cliente.find({ negocio: req.session.negocioId }).sort({ nombre: 1 })); } catch (e) { res.status(500).send(e); }
});
app.post('/api/clientes', exigeEditor, async (req, res) => {
    try {
        if (req.session.negocioPlan === 'free') {
            const clientCount = await Cliente.countDocuments({ negocio: req.session.negocioId });
            if (clientCount >= 20) {
                return res.status(403).json({ error: 'Has alcanzado el límite de 20 clientes de tu plan gratuito.' });
            }
        }
        const nuevo = new Cliente({ ...req.body, negocio: req.session.negocioId });
        await nuevo.save();
        await registrarLog(req.session.email, `Registró cliente: ${nuevo.nombre}`, {}, req.session.negocioId);
        res.json(nuevo);
    } catch (e) { res.status(400).send(e); }
});
app.put('/api/clientes/:id', exigeEditor, async (req, res) => {
    try {
        const cliente = await Cliente.findOneAndUpdate({ _id: req.params.id, negocio: req.session.negocioId }, req.body, { new: true });
        await registrarLog(req.session.email, `Actualizó datos del cliente: ${cliente.nombre}`, {}, req.session.negocioId);
        notificarCambio(); // Notificar cambio para refrescar la lista de clientes en otros navegadores
        res.json(cliente);
    } catch (e) { res.status(400).send(e); }
});
app.delete('/api/clientes/:id', exigeEditor, async (req, res) => {
    try {
        await Cliente.findOneAndDelete({ _id: req.params.id, negocio: req.session.negocioId });
        notificarCambio(); // Notificar cambio para refrescar la lista de clientes en otros navegadores
        res.sendStatus(200);
    } catch (e) { res.status(500).send(e); }
});

// --- Rutas de Gastos Operativos ---
app.get('/api/gastos', exigeLogin, async (req, res) => {
    try { res.json(await Gasto.find({ negocio: req.session.negocioId }).sort({ fecha: -1 })); } catch (e) { res.status(500).send(e); }
});
app.post('/api/gastos', exigeEditor, async (req, res) => {
    try {
        const nuevo = new Gasto({ ...req.body, negocio: req.session.negocioId });
        await nuevo.save();
        await registrarLog(req.session.email, `Registró gasto: ${nuevo.concepto} (${nuevo.monto}€)`, {}, req.session.negocioId);
        res.json(nuevo);
    } catch (e) { res.status(400).send(e); }
});
app.delete('/api/gastos/:id', exigeEditor, async (req, res) => {
    try {
        await Gasto.findOneAndDelete({ _id: req.params.id, negocio: req.session.negocioId });
        res.sendStatus(200);
    } catch (e) { res.status(500).send(e); }
});

// --- Rutas de Personalización del Negocio ---
app.get('/api/negocio/detalles', exigeLogin, async (req, res) => {
    try {
        const negocio = await Negocio.findById(req.session.negocioId).lean();
        if (!negocio) return res.status(404).json({ error: 'Negocio no encontrado.' });
        res.json(negocio);
    } catch (e) {
        res.status(500).json({ error: 'Error al obtener detalles del negocio.' });
    }
});

app.put('/api/negocio/ajustes', exigeAdmin, async (req, res) => {
    try {
        const { nombreVisible } = req.body;
        const negocio = await Negocio.findByIdAndUpdate(
            req.session.negocioId,
            { nombreVisible },
            { new: true }
        ).lean();
        await registrarLog(req.session.email, `Actualizó los ajustes del negocio. Nuevo nombre: ${nombreVisible}`, {}, req.session.negocioId);
        res.json(negocio);
    } catch (e) {
        res.status(500).json({ error: 'Error al actualizar los ajustes del negocio.' });
    }
});

app.get('/api/ventas', exigeLogin, async (req, res) => {
    try {
        // Optimización: Ejecutar consultas en paralelo para mejorar la velocidad de carga.
        const [ventasRaw, logs, gastosExtra, estadosKanban] = await Promise.all([
            VentaRopa.find({ negocio: req.session.negocioId }).populate('tienda').sort({ _id: -1 }).lean(),
            LogAuditoria.find({ negocio: req.session.negocioId }).sort({ _id: -1 }).limit(50).lean(),
            Gasto.find({ negocio: req.session.negocioId }).lean(),
            EstadoKanban.find({ negocio: req.session.negocioId }).lean()
        ]);
        const nombresEstadosVenta = estadosKanban.filter(e => e.rolFinanciero === 'Venta').map(e => e.nombre);
        
        let ingresos = 0, inversion = 0, prendasVendidas = 0, gastosTotalesEnvio = 0, totalGastosOperativos = 0, costeVendidosTotal = 0;
        
        gastosExtra.forEach(g => totalGastosOperativos += g.monto);

        const ventas = ventasRaw.map(v => {
            const proveedorNombre = v.tienda && v.tienda.nombre ? v.tienda.nombre : 'Sin Tienda';
            
            const cant = parseInt(v.cantidad, 10) || 0;
            const pCompra = parseFloat(v.precioCompra) || 0;
            const pVenta = parseFloat(v.precioVenta) || 0;
            const gEnvio = parseFloat(v.gastosEnvio) || 0;

            inversion += (pCompra * cant);
            gastosTotalesEnvio += (gEnvio * cant);

            if (nombresEstadosVenta.includes(v.estado) && v.canalVenta) {
                let comisionPlataforma = 0;
                if (v.canalVenta === 'Vinted' || v.canalVenta === 'Wallapop') {
                    comisionPlataforma = (pVenta * 0.05); 
                }
                ingresos += ((pVenta - comisionPlataforma) * cant);
                prendasVendidas += cant;
                costeVendidosTotal += (pCompra * cant);
            }

            return { ...v, proveedor: proveedorNombre };
        });

        const beneficioNeto = ingresos - inversion - gastosTotalesEnvio - totalGastosOperativos;
        const roi = (inversion + totalGastosOperativos) > 0 ? (beneficioNeto / (inversion + gastosTotalesEnvio + totalGastosOperativos)) * 100 : 0;

        let resumenFinal = { ingresos, beneficio: beneficioNeto, inversion: inversion + gastosTotalesEnvio + totalGastosOperativos, prendasVendidas, roi, totalGastosOperativos };

        // Ocultar datos financieros para roles que no son Administrador
        if (req.session.rol !== 'Admin') {
            resumenFinal = { prendasVendidas, ingresos: 0, beneficio: 0, inversion: 0, roi: 0, totalGastosOperativos: 0 };
        }

        return res.json({ 
            resumen: resumenFinal, 
            ventas,
            logs 
        });
    } catch (error) { return res.status(500).json({ error: 'Fallo analíticas.' }); }
});

app.post('/api/ventas', exigeEditor, async (req, res) => {
    try {
        if (req.session.negocioPlan === 'free') {
            const productCount = await VentaRopa.countDocuments({ negocio: req.session.negocioId });
            if (productCount >= 50) {
                return res.status(403).json({ error: 'Has alcanzado el límite de 50 productos de tu plan gratuito. ¡Considera mejorar tu plan para añadir más!' });
            }
        }
        const { proveedor, ...datosVenta } = req.body;
        
        const tiendaDoc = await Tienda.findOne({ nombre: proveedor });

        const nuevaVenta = new VentaRopa({ ...datosVenta, negocio: req.session.negocioId, tienda: tiendaDoc ? tiendaDoc._id : null });
        await nuevaVenta.save(); 
        await registrarLog(req.session.email, `Registró prenda en stock: ${nuevaVenta.prenda} (${proveedor})`, {}, req.session.negocioId);
        return res.json({ status: "success", venta: nuevaVenta });
    } catch (error) { 
        return res.status(500).json({ error: 'Error al registrar artículo.' }); 
    }
});

app.put('/api/ventas/:id', exigeEditor, async (req, res) => {
    try {
        const { id } = req.params;
        const { proveedor, ...datosVenta } = req.body;

        const tiendaDoc = await Tienda.findOne({ nombre: proveedor, negocio: req.session.negocioId });

        const ventaActualizada = await VentaRopa.findOneAndUpdate(
            { _id: id, negocio: req.session.negocioId },
            { ...datosVenta, tienda: tiendaDoc ? tiendaDoc._id : null }, 
            { new: true }
        );

        await registrarLog(req.session.email, `Modificó datos de la prenda ID: ${id} (${ventaActualizada.prenda})`, {}, req.session.negocioId);
        return res.json({ status: "success", venta: ventaActualizada });
    } catch (error) {
        return res.status(500).json({ error: 'Error al actualizar registro.' });
    }
});

app.put('/api/ventas/:id/estado', exigeEditor, async (req, res) => {
    try {
        const { id } = req.params;
        const { estado } = req.body;

        const estadoConfig = await EstadoKanban.findOne({ nombre: estado, negocio: req.session.negocioId });
        const updateData = { estado };
        
        if (estadoConfig && estadoConfig.rolFinanciero === 'Venta') {
            updateData.fechaVenta = new Date().toISOString().split('T')[0];
        } else {
            updateData.fechaVenta = '';
        }

        const ventaActualizada = await VentaRopa.findOneAndUpdate({ _id: id, negocio: req.session.negocioId }, updateData, { new: true });
        await registrarLog(req.session.email, `Transición de estado: [${ventaActualizada.prenda}] -> ${estado.toUpperCase()}`, {}, req.session.negocioId);
        return res.json({ status: "success", venta: ventaActualizada });
    } catch (error) {
        return res.status(500).json({ error: 'Error en la actualización de la columna Kanban.' });
    }
});

app.put('/api/ventas/escanear/:sku', exigeEditor, async (req, res) => {
    try {
        const { sku } = req.params;
        let venta = await VentaRopa.findOne({ sku: sku, negocio: req.session.negocioId });
        
        const estadosConfig = await EstadoKanban.find({ negocio: req.session.negocioId }).sort({ orden: 1 });
        const estStock = estadosConfig.find(e => e.rolFinanciero === 'Stock');
        const estVenta = estadosConfig.find(e => e.rolFinanciero === 'Venta');
        
        const nombreStock = estStock ? estStock.nombre : 'No Vendido';
        const nombreVenta = estVenta ? estVenta.nombre : 'Vendido';

        if (!venta) {
            venta = new VentaRopa({
                negocio: req.session.negocioId,
                sku: sku,
                prenda: 'Artículo Escaneado Nuevo',
                estado: nombreStock
            });
            await venta.save();
            return res.json({ operacion: "Creado", venta });
        } else {
            const nuevoEstado = venta.estado === nombreVenta ? nombreStock : nombreVenta;
            venta.estado = nuevoEstado;
            if (nuevoEstado === nombreVenta) {
                venta.fechaVenta = new Date().toISOString().split('T')[0];
            } else {
                venta.fechaVenta = '';
            }
            await venta.save();
            return res.json({ operacion: nuevoEstado, venta });
        }
    } catch (error) {
        return res.status(500).json({ error: 'Fallo en la llamada del decodificador del escáner.' });
    }
});

app.delete('/api/ventas/:id', exigeEditor, async (req, res) => {
    try {
        const { id } = req.params;
        const ventaEliminada = await VentaRopa.findOneAndDelete({ _id: id, negocio: req.session.negocioId });
        if (ventaEliminada) {
            await registrarLog(req.session.email, `Eliminó permanentemente la prenda: ${ventaEliminada.prenda}`, {}, req.session.negocioId);
        }
        return res.sendStatus(200);
    } catch (error) {
        return res.status(500).json({ error: 'Error al purgar elemento de la base de datos.' });
    }
});

app.post('/api/auth/setup', async (req, res) => {
    try {
        const { email, negocioNombre, tipoNegocio, rolUsuario, token } = req.body;
        const payload = await verificarTokenGoogle(token);
        if (!payload || payload.email.toLowerCase() !== email.toLowerCase()) {
            return res.status(401).json({ error: 'Validación de Google fallida.' });
        }

        const existingBusiness = await Negocio.findOne({ nombre: negocioNombre });
        if (existingBusiness) {
            return res.status(400).json({ error: 'El nombre del negocio ya está en uso. Por favor, elige otro.' });
        }

        const nuevoNegocio = new Negocio({ nombre: negocioNombre, nombreVisible: negocioNombre, tipo: tipoNegocio || 'General', plan: 'free' });
        await nuevoNegocio.save();


        const adminUser = new UsuarioAutorizado({
            email: email.toLowerCase(),
            rol: rolUsuario || 'Admin',
            negocio: nuevoNegocio._id
        });
        await adminUser.save();

        // 🟢 INYECCIÓN DE DATOS INICIALES PARA EL NUEVO NEGOCIO
        const negocioId = nuevoNegocio._id;

        // Estados Kanban por defecto
        await EstadoKanban.insertMany([
            { negocio: negocioId, nombre: 'No Vendido', icono: '📦', color: 'amber', rolFinanciero: 'Stock', orden: 1 },
            { negocio: negocioId, nombre: 'Vendido', icono: '💰', color: 'emerald', rolFinanciero: 'Venta', orden: 2 },
            { negocio: negocioId, nombre: 'Reservado', icono: '🤝', color: 'indigo', rolFinanciero: 'Stock', orden: 3 },
            { negocio: negocioId, nombre: 'Devuelto', icono: '⚠️', color: 'rose', rolFinanciero: 'Oculto', orden: 4 }
        ]);

        // Tiendas por defecto
        await Tienda.insertMany([
            { negocio: negocioId, nombre: 'Tienda Física' }, { negocio: negocioId, nombre: 'Vinted' }, { negocio: negocioId, nombre: 'Wallapop' }
        ]);

        // Categorías por defecto
        const defaultCats = [
            '👕 Camisetas', '🧥 Sudaderas', '👖 Pantalones', '👗 Vestidos', '👜 Accesorios', '👟 Zapatos', '👔 Camisas'
        ];
        await Categoria.insertMany(defaultCats.map(n => ({ negocio: negocioId, nombre: n })));

        // FAQs por defecto
        await Faq.insertMany([
            { negocio: negocioId, pregunta: "🔄 ¿Cómo muevo un producto a 'Vendido'?", respuesta: "Puedes arrastrar la tarjeta del producto hacia la columna 'VENTAS' en el Kanban principal, o editar el producto haciendo click en el botón azul de 'Editar' y cambiar su estado." },
            { negocio: negocioId, pregunta: "⚡ ¿Cómo aplico acciones masivas?", respuesta: "Selecciona las casillas redondas de varios artículos en el Kanban para desplegar el 'Panel Flotante Oscuro' abajo. Desde ahí podrás ajustar precios o estados en lote." },
            { negocio: negocioId, pregunta: "📷 ¿Para qué sirve el escáner superior?", respuesta: "Convierte la cámara de tu móvil o tablet en una pistola láser. Imprime las etiquetas con QR de tus prendas, y al escanearlas desde aquí se marcarán automáticamente como Vendidas." },
            { negocio: negocioId, pregunta: "💸 Gastos Operativos vs Coste de Ropa", respuesta: "El sistema separa tu inversión en 2 bloques para darte un Beneficio Neto real: El Coste Unitario (lo que costó la prenda) y los Gastos Operativos (Alquiler, cajas, luz) que se añaden en la sección de Gastos." }
        ]);

        // Tareas de ejemplo
        await Tarea.insertMany([
            { negocio: negocioId, titulo: "📦 Inventariar nueva colección", descripcion: "Subir fotos, añadir tallas y establecer el margen de beneficio en el sistema.", estado: "Pendiente", prioridad: "Alta" },
            { negocio: negocioId, titulo: "📸 Actualizar catálogo online", descripcion: "Sincronizar artículos nuevos con Vinted / Wallapop usando el Scraper.", estado: "En Proceso", prioridad: "Media" },
            { negocio: negocioId, titulo: "🛍️ Revisar stock de packaging", descripcion: "Comprobar si quedan suficientes cajas y bolsas de envío para esta semana.", estado: "Pendiente", prioridad: "Media" },
            { negocio: negocioId, titulo: "🧾 Cuadrar contabilidad mensual", descripcion: "Exportar el Excel y revisar los Gastos Operativos (OpEx) del mes.", estado: "Completada", prioridad: "Baja" }
        ]);

        console.log(`[SETUP] Inyectados datos iniciales para el nuevo negocio: ${negocioNombre}`);

        req.session.email = adminUser.email;
        req.session.rol = adminUser.rol;
        req.session.negocioId = nuevoNegocio._id;
        req.session.negocioPlan = nuevoNegocio.plan;
        req.session.esAdmin = (adminUser.rol === 'Admin');

        req.session.save((err) => {
            if(err) console.error("Session save error", err);
            res.json({ success: true, redirect: '/' });
        });
    } catch (error) {
        console.error("Error en /api/auth/setup:", error);
        res.status(500).json({ error: 'Error al configurar el negocio. Es posible que el email ya esté registrado o haya un problema con la base de datos.' });
    }
});

app.get('/api/account/stats', exigeLogin, async (req, res) => {
    try {
        const negocioId = req.session.negocioId;
        const plan = req.session.negocioPlan || 'free';

        const [productCount, clientCount, userCount] = await Promise.all([
            VentaRopa.countDocuments({ negocio: negocioId }),
            Cliente.countDocuments({ negocio: negocioId }),
            UsuarioAutorizado.countDocuments({ negocio: negocioId })
        ]);

        const limits = {
            free: { products: 50, clients: 20, users: 2 },
            professional: { products: 500, clients: Infinity, users: 5 },
            business: { products: Infinity, clients: Infinity, users: Infinity }
        };

        res.json({
            plan,
            usage: {
                products: productCount,
                clients: clientCount,
                users: userCount
            },
            limits: limits[plan] || limits.free
        });

    } catch (error) {
        res.status(500).json({ error: 'Error al obtener las estadísticas de la cuenta.' });
    }
});

app.post('/api/logout', async (req, res) => { 
    const { clientLocation } = req.body;
    if (req.session && req.session.email) {
        const emailUsuario = req.session.email;
        const locationData = await obtenerUbicacionCompleta(req, clientLocation);
        await registrarLog(emailUsuario, "Cerró sesión en el sistema", locationData, req.session.negocioId);
        req.session.destroy(() => res.sendStatus(200));
    } else {
        res.sendStatus(200);
    }
});
app.get('/api/logout', (req, res) => { req.session.destroy(() => res.sendStatus(200)); }); // Compatibilidad
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[SERVER] Seychelles Core Activo en puerto: ${PORT}`));


//SCRIPT DE SCRAPING

// --- SISTEMA DE SCRAPING WEB --- //

// 1. Analizar cuenta, hacer el scrape y devolver comparativa
// --- SISTEMA DE SCRAPING MEJORADO --- //

/**
 * Analiza una URL de Vinted y devuelve una comparativa detallada:
 * 1. Productos existentes con cambios de precio (discrepancias).
 * 2. Productos nuevos encontrados en la web que no están en el sistema.
 */

app.post('/api/scraper/analizar', exigeEditor, async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL de Vinted requerida.' });

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'es-ES,es;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            timeout: 15000
        });

        const $ = cheerio.load(response.data);
        const productosExtraidos = [];

        $('div[data-testid^="grid-item"], div[data-testid="item-card"], .new-item-box__container, .feed-grid__item, .web_ui__ItemBox__component, .item-card, .grid__item').each((i, el) => {
            const titulo = $(el).find('[data-testid$="--title"], [data-testid$="--description"], .new-item-box__description h2, .new-item-box__title, .web_ui__ItemBox__title, .truncated, h4, [itemprop="name"]').text().trim();
            const precioTexto = $(el).find('[data-testid$="--price-text"], [data-testid$="--price"], .new-item-box__description h4, .new-item-box__price, .web_ui__ItemBox__price, .price, h3, [itemprop="price"]').text().trim();
            const imgTag = $(el).find('img');
            const imagen = imgTag.attr('src') || imgTag.attr('data-src') || (imgTag.attr('srcset') ? imgTag.attr('srcset').split(' ')[0] : '');

            if (titulo && precioTexto) {
                let cleanPrice = precioTexto.replace(/[^\d,.]/g, '').trim();
                if (cleanPrice.includes(',') && cleanPrice.includes('.')) cleanPrice = cleanPrice.replace(/\./g, '').replace(',', '.');
                else if (cleanPrice.includes(',')) cleanPrice = cleanPrice.replace(',', '.');
                
                if (!isNaN(parseFloat(cleanPrice))) productosExtraidos.push({ titulo, precio: cleanPrice, imagen });
            }
        });

        if (productosExtraidos.length === 0) return res.status(400).json({ error: 'No se encontraron productos. Es posible que Vinted haya bloqueado la solicitud.' });

        const resultados = { discrepancias: [], nuevos: [], identicos: [] };
        const productosBD = await VentaRopa.find({ canalVenta: 'Vinted', negocio: req.session.negocioId }).lean();

        const cleanStr = str => str.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

        productosExtraidos.forEach(item => {
            const precioWeb = parseFloat(item.precio);
            if (item.titulo && !isNaN(precioWeb)) {
                const cleanItemTitle = cleanStr(item.titulo);
                const coincidencia = productosBD.find(p => {
                    const cleanP = cleanStr(p.prenda);
                    return cleanP === cleanItemTitle || (cleanP.length > 4 && cleanItemTitle.includes(cleanP)) || (cleanItemTitle.length > 4 && cleanP.includes(cleanItemTitle));
                });
                if (coincidencia) {
                    if (Math.abs(coincidencia.precioVenta - precioWeb) > 0.01 || coincidencia.prenda !== item.titulo) {
                        resultados.discrepancias.push({ idMongo: coincidencia._id, prenda: coincidencia.prenda, prendaNueva: item.titulo, valorAntiguo: coincidencia.precioVenta, valorNuevo: precioWeb, imagen: item.imagen });
                    } else {
                        resultados.identicos.push({ idMongo: coincidencia._id, prenda: coincidencia.prenda, precio: coincidencia.precioVenta, imagen: item.imagen });
                    }
                } else {
                    resultados.nuevos.push({ prenda: item.titulo, precioVenta: precioWeb, imagen: item.imagen, canalVenta: 'Vinted', estado: 'No Vendido' });
                }
            }
        });
        res.json(resultados);
    } catch (error) {
        res.status(500).json({ error: 'Error del servidor al intentar analizar la URL de Vinted.' });
    }
});

/**
 * Analiza datos subidos manualmente (ej. desde un Excel de Instant Data Scraper)
 */
app.post('/api/scraper/analizar-manual', exigeEditor, async (req, res) => {
    try {
        const { productosExtraidos } = req.body;
        console.log(`[SCRAPER MANUAL] Recibidos ${productosExtraidos?.length || 0} productos para comparar.`);
        if (!productosExtraidos || !Array.isArray(productosExtraidos)) {
            return res.status(400).json({ error: 'Datos no válidos.' });
        }

        const resultados = { discrepancias: [], nuevos: [], identicos: [] };
        const productosBD = await VentaRopa.find({ canalVenta: 'Vinted', negocio: req.session.negocioId }).lean();

        const cleanStr = str => str.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

        productosExtraidos.forEach(item => {
            const titulo = item.titulo || '';
            const precioWeb = parseFloat(item.precio);
            const imagen = item.imagen || '';
            const galeria = item.galeria || [];

            if (titulo && !isNaN(precioWeb)) {
                const cleanItemTitle = cleanStr(titulo);
                const coincidencia = productosBD.find(p => {
                    const cleanP = cleanStr(p.prenda);
                    return cleanP === cleanItemTitle || (cleanP.length > 4 && cleanItemTitle.includes(cleanP)) || (cleanItemTitle.length > 4 && cleanP.includes(cleanItemTitle));
                });

                if (coincidencia) {
                    if (Math.abs(coincidencia.precioVenta - precioWeb) > 0.01 || coincidencia.prenda !== titulo) {
                        resultados.discrepancias.push({ idMongo: coincidencia._id, prenda: coincidencia.prenda, prendaNueva: titulo, valorAntiguo: coincidencia.precioVenta, valorNuevo: precioWeb, imagen });
                    } else {
                        resultados.identicos.push({ idMongo: coincidencia._id, prenda: coincidencia.prenda, precio: coincidencia.precioVenta, imagen });
                    }
                } else {
                    resultados.nuevos.push({ prenda: titulo, precioVenta: precioWeb, imagen, galeria, canalVenta: 'Vinted', estado: 'No Vendido' });
                }
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
app.post('/api/scraper/importar', exigeEditor, async (req, res) => {
    try {
        const { productos } = req.body; // Array de productos seleccionados en el frontend
        if (!productos || !Array.isArray(productos)) return res.status(400).json({ error: 'Datos de productos no válidos.' });

        let tiendaVinted = await Tienda.findOne({ nombre: 'Vinted', negocio: req.session.negocioId });
        if (!tiendaVinted) {
            tiendaVinted = new Tienda({ nombre: 'Vinted', negocio: req.session.negocioId });
            await tiendaVinted.save();
        }

        const registrosCreados = [];
        for (const prod of productos) {
            const galeriaBase64 = [];
            // Procesamos un máximo de 12 fotos extra por producto para galerías completas
            if (prod.galeria && Array.isArray(prod.galeria)) {
                for (const gUrl of prod.galeria.slice(0, 12)) {
                    const b64 = await downloadAndConvertToBase64(gUrl);
                    if (b64) {
                        galeriaBase64.push(b64.startsWith('data:image') ? b64 : gUrl);
                    }
                }
            }
            const mainImg = await downloadAndConvertToBase64(prod.imagen);
            const nuevaVenta = new VentaRopa({
                ...prod,
                imagen: mainImg && mainImg.startsWith('data:image') ? mainImg : prod.imagen,
                negocio: req.session.negocioId,
                galeria: galeriaBase64,
                tienda: tiendaVinted._id,
                sku: `VNT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                comentariosProducto: `Importado automáticamente desde Vinted el ${new Date().toLocaleDateString()}`
            });
            await nuevaVenta.save();
            registrosCreados.push(nuevaVenta.prenda);
        }
        notificarCambio(); // Notificar cambio para refrescar el panel principal

        await registrarLog(req.session.email, `Importó ${registrosCreados.length} productos desde Vinted: ${registrosCreados.join(', ')}`, {}, req.session.negocioId);
        res.json({ success: true, count: registrosCreados.length });
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
        const { productos } = req.body;
        if (!productos || !Array.isArray(productos)) return res.status(400).json({ error: 'Lista de productos no válida.' });

        // Mapeamos los productos para asegurar que tengan IDs de tienda válidos
        const productosProcesados = await Promise.all(productos.map(async (p) => {
            let tiendaId = null;
            if (p.proveedor) {
                const t = await Tienda.findOne({ nombre: p.proveedor, negocio: req.session.negocioId });
                if (t) tiendaId = t._id;
            }
            return {
                ...p,
                tienda: tiendaId,
                sku: p.sku || `BK-${Date.now()}-${Math.floor(Math.random() * 1000)}`
            };
        }));

        const insertados = await VentaRopa.insertMany(productosProcesados);
        await registrarLog(req.session.email, `Restauración masiva: Insertados ${insertados.length} productos.`, {}, req.session.negocioId);
        res.json({ success: true, count: insertados.length });
    } catch (error) {
        console.error("Error en bulk insert:", error);
        res.status(500).json({ error: 'Fallo al procesar la inserción masiva.' });
    }
});

/**
 * Aplica cambios de precio a productos existentes
 */
app.post('/api/scraper/aplicar', exigeEditor, async (req, res) => {
    try {
        const { cambios } = req.body;
        for (const cambio of cambios) {
            await VentaRopa.findOneAndUpdate({ _id: cambio.idMongo, negocio: req.session.negocioId }, { precioVenta: cambio.valorNuevo, prenda: cambio.prenda });
            await registrarLog(req.session.email, `Sincronización artículo: ${cambio.prenda} -> ${cambio.valorNuevo}€`, {}, req.session.negocioId);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar precios.' });
    }
});
