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
    rol: { type: String, enum: ['Admin', 'Editor', 'Lector'], default: 'Editor' },
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

const ADMIN_WHITELIST = (process.env.ADMIN_WHITELIST || 'dannymedinacoronel@gmail.com,juliamugo2001@gmail.com').split(',').map(e => e.trim().toLowerCase());

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
            MensajeInterno.updateMany({ $or: [{ empresa: { $exists: false } }, { empresa: '' }, { empresa: null }] }, { $set: { empresa: EMPRESA_DEFAULT } })
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

app.use(express.static(path.join(__dirname, 'public')));
function empresaActual(req) {
    return normalizarEmpresa(req.session?.empresa || EMPRESA_DEFAULT);
}

function exigeAdmin(req, res, next) {
    if (req.session && req.session.esAdmin) return next();
    return res.status(403).json({ error: 'No autorizado.' });
}

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

app.get('/api/auth/verificar', (req, res) => {
    if (req.session && req.session.esAdmin) {
        return res.json({
            autenticado: true,
            usuario: req.session.email,
            rol: req.session.rol || 'Admin',
            empresa: req.session.empresa || EMPRESA_DEFAULT
        });
    }
    return res.json({ autenticado: false });
});

app.post('/api/auth/google', async (req, res) => {
    const { token, clientLocation } = req.body;
    try {
        if (!token) return res.status(400).json({ error: 'Token no proporcionado.' });

        const ticket = await client.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();
        const emailUsuario = payload['email'].toLowerCase().trim();

        const autorizado = await UsuarioAutorizado.findOne({ email: emailUsuario });

        if (autorizado) {
            autorizado.empresa = normalizarEmpresa(autorizado.empresa);
            autorizado.ultimaConexion = new Date();
            await autorizado.save();

            req.session.esAdmin = true;
            req.session.email = emailUsuario;
            req.session.rol = autorizado.rol || 'Admin';
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
app.get('/api/system/db-stats', exigeAdmin, async (req, res) => {
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
app.get('/api/usuarios-admin', exigeAdmin, async (req, res) => {
    try { 
        const empresa = normalizarEmpresa(req.session?.empresa || EMPRESA_DEFAULT);
        res.json(await UsuarioAutorizado.find({ empresa }).sort({ fechaAgregado: -1 })); 
    } catch (e) { res.status(500).send(e); }
});

app.post('/api/usuarios-admin', exigeAdmin, async (req, res) => {
    try {
        const empresa = normalizarEmpresa(req.session?.empresa || EMPRESA_DEFAULT);
        const emailLimpio = req.body.email ? req.body.email.toLowerCase().trim() : "";
        const rolAsignado = String(req.body.rol || "Editor").trim();
        const rolesPermitidos = ['Admin', 'Editor'];
        if (!emailLimpio) return res.status(400).json({ error: 'Email requerido.' });
        if (!rolesPermitidos.includes(rolAsignado)) return res.status(400).json({ error: 'Rol inválido. Solo Admin o Editor.' });
        const nuevo = new UsuarioAutorizado({ email: emailLimpio, rol: rolAsignado, empresa });
        await nuevo.save();
        await registrarLog(req.session.email, `Autorizó cuenta: ${emailLimpio} [Rol: ${rolAsignado}] [Empresa: ${empresa}]`);
        res.json(nuevo);
    } catch (e) { res.status(400).json({ error: 'El usuario ya está autorizado en la lista.' }); }
});

app.put('/api/usuarios-admin/:id/rol', exigeAdmin, async (req, res) => {
    try {
        if ((req.session?.rol || 'Editor') !== 'Admin') {
            return res.status(403).json({ error: 'Solo un Admin puede modificar permisos.' });
        }

        const empresa = normalizarEmpresa(req.session?.empresa || EMPRESA_DEFAULT);
        const nuevoRol = String(req.body?.rol || '').trim();
        const rolesPermitidos = ['Admin', 'Editor'];
        if (!rolesPermitidos.includes(nuevoRol)) {
            return res.status(400).json({ error: 'Solo se permite Admin o Editor.' });
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

app.delete('/api/usuarios-admin/:id', exigeAdmin, async (req, res) => {
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

        const filtrados = usuarios
            .filter(u => u.email !== emailActual)
            .map(u => ({
                email: u.email,
                rol: u.rol || 'Editor',
                empresa: normalizarEmpresa(u.empresa || EMPRESA_DEFAULT),
                nombreVisible: u.nombreVisible || '',
                fotoPerfil: u.fotoPerfil || '',
                ultimaConexion: u.ultimaConexion || null
            }));

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
                    await registrarLog(req.session.email, `IA actualizó precio de ${params.sku}`);
                } else if (actionType === 'CAMBIAR_ESTADO' && params.sku && params.estado) {
                    await VentaRopa.findOneAndUpdate({ sku: params.sku, empresa }, { estado: params.estado, fechaModificacion: new Date().toISOString().slice(0, 10) });
                    await registrarLog(req.session.email, `IA cambió estado de ${params.sku} a ${params.estado}`);
                } else if (actionType === 'BORRAR_PRODUCTO' && params.sku) {
                    await VentaRopa.findOneAndDelete({ sku: params.sku, empresa });
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
app.get('/api/logs/calendario', exigeAdmin, async (req, res) => {
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

app.get('/api/logs/locations', exigeAdmin, async (req, res) => {
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
app.get('/api/gastos', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        res.json(await Gasto.find({ empresa }).sort({ fecha: -1 }));
    } catch (e) { res.status(500).send(e); }
});
app.post('/api/gastos', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const nuevo = new Gasto({ ...req.body, empresa });
        await nuevo.save();
        await registrarLog(req.session.email, `Registró gasto: ${nuevo.concepto} (${nuevo.monto}€)`);
        res.json(nuevo);
    } catch (e) { res.status(400).send(e); }
});
app.delete('/api/gastos/:id', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        await Gasto.deleteOne({ _id: req.params.id, empresa });
        res.sendStatus(200);
    } catch (e) { res.status(500).send(e); }
});

app.get('/api/ventas', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 40; // Lotes de 40 productos
        const skip = (page - 1) * limit;
        const lightweight = String(req.query.lightweight || '').toLowerCase() === '1' || page > 1;

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

            const usuariosEquipo = await UsuarioAutorizado.find({ empresa }).select('email').lean();
            const emailsEquipo = usuariosEquipo.map(u => String(u.email || '').toLowerCase().trim()).filter(Boolean);
            logs = emailsEquipo.length
                ? await LogAuditoria.find({ empresa, usuario: { $in: emailsEquipo } })
                    .select('fechaHora usuario accion')
                    .sort({ _id: -1 })
                    .limit(25)
                    .lean()
                : [];
        }

        return res.json({
            resumen,
            ventas,
            logs,
            totalPages: Math.ceil(totalVentas / limit),
            currentPage: page
        });
    } catch (error) {
        console.error('Fallo en API /ventas:', error);
        return res.status(500).json({ error: 'Fallo al obtener datos de ventas.' });
    }
});

app.post('/api/ventas', exigeAdmin, async (req, res) => {
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
        await registrarLog(req.session.email, `Registró prenda en stock: ${nuevaVenta.prenda} (${proveedor})`);
        return res.json({ status: "success", venta: nuevaVenta });
    } catch (error) { 
        return res.status(500).json({ error: 'Error al registrar artículo.' }); 
    }
});

app.put('/api/ventas/:id', exigeAdmin, async (req, res) => {
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

        await registrarLog(req.session.email, `Modificó datos de la prenda ID: ${id} (${ventaActualizada.prenda})`);
        return res.json({ status: "success", venta: ventaActualizada });
    } catch (error) {
        return res.status(500).json({ error: 'Error al actualizar registro.' });
    }
});

app.put('/api/ventas/:id/estado', exigeAdmin, async (req, res) => {
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
        await registrarLog(req.session.email, `Transición de estado: [${ventaActualizada.prenda}] -> ${estado.toUpperCase()}`);
        return res.json({ status: "success", venta: ventaActualizada });
    } catch (error) {
        return res.status(500).json({ error: 'Error en la actualización de la columna Kanban.' });
    }
});

app.put('/api/ventas/escanear/:sku', exigeAdmin, async (req, res) => {
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
            return res.json({ operacion: nuevoEstado, venta });
        }
    } catch (error) {
        return res.status(500).json({ error: 'Fallo en la llamada del decodificador del escáner.' });
    }
});

app.delete('/api/ventas/:id', exigeAdmin, async (req, res) => {
    try {
        const empresa = empresaActual(req);
        const { id } = req.params;
        const ventaEliminada = await VentaRopa.findOneAndDelete({ _id: id, empresa });
        if (ventaEliminada) {
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
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

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
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL de Vinted requerida.' });

        // 🚀 NUEVA LÓGICA: En lugar de escrapear desde Render (bloqueado),
        // le pedimos a GitHub Actions que haga el trabajo por nosotros.
        
        const GITHUB_PAT = process.env.GITHUB_PAT;
        const REPO_OWNER = process.env.GITHUB_OWNER || 'dannymedinacoronel'; 
        const REPO_NAME = process.env.GITHUB_REPO || 'app_tienda'; // El nombre exacto de tu repo en GitHub

        if (!GITHUB_PAT) {
            return res.status(500).json({ error: 'Falta configurar GITHUB_PAT en Render para lanzar el scraper remoto.' });
        }

        if (!REPO_OWNER || !REPO_NAME) {
            return res.status(500).json({ error: 'Falta configurar GITHUB_OWNER o GITHUB_REPO en Render.' });
        }

        console.log(`[GITHUB-API] Lanzando scraper remoto para: ${url}`);

        // Llamada a la API de GitHub para ejecutar el flujo manual-scraper.yml
        await axios.post(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/manual-scraper.yml/dispatches`,
            {
                ref: 'main', // o la rama que estés usando
                inputs: {
                    vinted_url: url,
                    empresa: empresa
                }
            },
            {
                headers: {
                    'Authorization': `token ${GITHUB_PAT}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

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
                error: 'GitHub no encontró el repo o el workflow. Revisa GITHUB_OWNER/GITHUB_REPO y que exista .github/workflows/manual-scraper.yml en main.'
            });
        }

        if (ghStatus === 401 || ghStatus === 403) {
            return res.status(500).json({
                error: 'GITHUB_PAT inválido o sin permisos repo/workflow. Regenera el token y habilita permisos para Actions en el repositorio.'
            });
        }

        if (ghStatus === 422) {
            return res.status(500).json({
                error: 'GitHub rechazó el dispatch (posible rama o workflow incorrecto). Verifica que la rama main exista y el archivo manual-scraper.yml esté en esa rama.'
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

        const cleanStr = str => str.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        const hayCoincidenciaFlexible = (a, b) => {
            if (!a || !b) return false;
            if (a === b) return true;
            return (a.length > 4 && b.includes(a)) || (b.length > 4 && a.includes(b));
        };

        const titulosWebNormalizados = [];

        productosExtraidos.forEach(item => {
            const titulo = item.titulo || '';
            const precioWeb = parseFloat(item.precio);
            const imagen = item.imagen || '';
            const galeria = item.galeria || [];

            if (titulo && !isNaN(precioWeb)) {
                const cleanItemTitle = cleanStr(titulo);
                titulosWebNormalizados.push(cleanItemTitle);
                const coincidencia = productosBD.find(p => {
                    const cleanP = cleanStr(p.prenda);
                    return hayCoincidenciaFlexible(cleanP, cleanItemTitle);
                });

                if (coincidencia) {
                    if (Math.abs(coincidencia.precioVenta - precioWeb) > 0.01 || coincidencia.prenda !== titulo) {
                        resultados.discrepancias.push({
                            idMongo: coincidencia._id,
                            prenda: coincidencia.prenda,
                            prendaNueva: titulo,
                            valorAntiguo: coincidencia.precioVenta,
                            valorNuevo: precioWeb,
                            imagen,
                            fechaRegistro: coincidencia.fecha || '',
                            fechaVenta: coincidencia.fechaVenta || ''
                        });
                    } else {
                        resultados.identicos.push({
                            idMongo: coincidencia._id,
                            prenda: coincidencia.prenda,
                            precio: coincidencia.precioVenta,
                            imagen,
                            fechaRegistro: coincidencia.fecha || '',
                            fechaVenta: coincidencia.fechaVenta || ''
                        });
                    }
                } else {
                    resultados.nuevos.push({ prenda: titulo, precioVenta: precioWeb, imagen, galeria, canalVenta: 'Vinted', estado: 'No Vendido' });
                }
            }
        });

        // Detectar artículos de Vinted en MongoDB que no aparecen en el scraping actual.
        const activosMongo = productosBD.filter(p => !p.fechaVenta);
        activosMongo.forEach(p => {
            const cleanP = cleanStr(p.prenda || '');
            if (!cleanP) return;
            const existeEnWeb = titulosWebNormalizados.some(t => hayCoincidenciaFlexible(cleanP, t));
            if (!existeEnWeb) {
                resultados.desaparecidos.push({
                    idMongo: p._id,
                    prenda: p.prenda,
                    precio: p.precioVenta,
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
        for (const prod of productos) {
            // OPTIMIZACIÓN: No convertir a Base64, guardar URL directamente.
            const galeriaUrls = [];
            if (prod.galeria && Array.isArray(prod.galeria)) {
                for (const gUrl of prod.galeria.slice(0, 12)) {
                    galeriaUrls.push(gUrl);
                }
            }

            const nombreTienda = (prod.proveedor || '').trim() || 'Vinted';
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
        notificarCambio(); // Notificar cambio para refrescar el panel principal

        await registrarLog(req.session.email, `Importó ${registrosCreados.length} productos desde Vinted: ${registrosCreados.join(', ')}`);
        res.json({ success: true, count: registrosCreados.length, tiendas: resumenTiendas });
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
        const { productos, urlOrigen } = req.body;
        const empresa = normalizarEmpresa(req.body?.empresa || EMPRESA_DEFAULT);
        console.log(`[GITHUB-WEBHOOK] Recibidos ${productos.length} productos de ${urlOrigen}`);
        
        // Notificar a los administradores conectados vía Socket.io
        if (global.io) {
            global.io.to(`empresa:${empresa}`).emit('scraper_update', {
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
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar precios.' });
    }
});
