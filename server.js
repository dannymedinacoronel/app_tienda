require('dotenv').config(); 
const express = require('express');
const { OAuth2Client } = require('google-auth-library'); 
const session = require('express-session'); 
const MongoStoreModule = require('connect-mongo'); // Importa el módulo completo
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer');

const app = express();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ⚙️ CONFIGURACIÓN DE ENTORNO
const isProd = process.env.NODE_ENV === 'production';
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
// --- Modelos de MongoDB ---

const TiendaSchema = new mongoose.Schema({
    nombre: { type: String, required: true, unique: true, trim: true },
    fechaCreacion: { type: Date, default: Date.now }
});
const Tienda = mongoose.models.Tienda || mongoose.model('Tienda', TiendaSchema);

const CategoriaSchema = new mongoose.Schema({
    nombre: { type: String, required: true, unique: true, trim: true }
});
const Categoria = mongoose.models.Categoria || mongoose.model('Categoria', CategoriaSchema);

const ClienteSchema = new mongoose.Schema({
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
    fecha: { type: String, default: () => new Date().toISOString().split('T')[0] },
    concepto: { type: String, required: true },
    monto: { type: Number, required: true },
    categoria: { type: String, default: 'General' }
});
const Gasto = mongoose.models.Gasto || mongoose.model('Gasto', GastoSchema);

const EstadoKanbanSchema = new mongoose.Schema({
    nombre: { type: String, required: true, unique: true, trim: true },
    icono: { type: String, default: '📦' },
    color: { type: String, default: 'slate' },
    rolFinanciero: { type: String, enum: ['Stock', 'Venta', 'Oculto'], default: 'Stock' },
    orden: { type: Number, default: 0 }
});
const EstadoKanban = mongoose.models.EstadoKanban || mongoose.model('EstadoKanban', EstadoKanbanSchema);

const VentaRopaSchema = new mongoose.Schema({
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
    fechaVenta: { type: String, default: '' },
    facturado: { type: Boolean, default: false },
    cliente: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente' }
});
const VentaRopa = mongoose.models.VentaRopa || mongoose.model('VentaRopa', VentaRopaSchema);

const LogAuditoriaSchema = new mongoose.Schema({
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
    titulo: { type: String, required: true, trim: true },
    descripcion: { type: String, default: '', trim: true },
    estado: { type: String, enum: ['Pendiente', 'En Proceso', 'Completada'], default: 'Pendiente' },
    prioridad: { type: String, enum: ['Baja', 'Media', 'Alta'], default: 'Media' },
    fechaVencimiento: { type: String, default: '' },
    fechaCreacion: { type: Date, default: Date.now }
});
const Tarea = mongoose.models.Tarea || mongoose.model('Tarea', TareaSchema);

const FaqSchema = new mongoose.Schema({
    pregunta: { type: String, required: true, trim: true },
    respuesta: { type: String, required: true, trim: true },
    fechaCreacion: { type: Date, default: Date.now }
});
const Faq = mongoose.models.Faq || mongoose.model('Faq', FaqSchema);

const NotaSchema = new mongoose.Schema({
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
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    rol: { type: String, enum: ['Admin', 'Editor', 'Lector'], default: 'Editor' },
    fechaAgregado: { type: Date, default: Date.now },
    ultimaConexion: { type: Date }
});
const UsuarioAutorizado = mongoose.models.UsuarioAutorizado || mongoose.model('UsuarioAutorizado', UsuarioAutorizadoSchema);

const ADMIN_WHITELIST = (process.env.ADMIN_WHITELIST || 'dannymedinacoronel@gmail.com,juliamugo2001@gmail.com').split(',').map(e => e.trim().toLowerCase());

const MongoStore = MongoStoreModule.default || MongoStoreModule; // Obtiene la clase MongoStore, manejando el 'default' export si existe

mongoose.connect(MONGO_URI_FINAL)
    .then(async () => {
        console.log('\x1b[32m[OK]\x1b[0m Core Estable de Seychelles conectado a MongoDB Atlas.');
        
        // Migrar whitelist inicial si la base de datos está vacía
        const countUsers = await UsuarioAutorizado.countDocuments();
        if (countUsers === 0) {
            const initialEmails = (process.env.ADMIN_WHITELIST || 'dannymedinacoronel@gmail.com,juliamugo2001@gmail.com').split(',').map(e => e.trim().toLowerCase()).filter(e => e);
            await UsuarioAutorizado.insertMany(initialEmails.map(e => ({ email: e })));
            console.log('[INIT] Whitelist inicial migrada a MongoDB.');
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
            const estVendido = await EstadoKanban.findOne({ nombre: 'Vendido' });
            const estReservado = await EstadoKanban.findOne({ nombre: 'Reservado' });
            if (estVendido && estReservado && estVendido.orden > estReservado.orden) {
                await EstadoKanban.updateOne({ nombre: 'Vendido' }, { orden: 2 });
                await EstadoKanban.updateOne({ nombre: 'Reservado' }, { orden: 3 });
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
function exigeAdmin(req, res, next) {
    if (req.session && req.session.esAdmin) return next();
    return res.status(403).json({ error: 'No autorizado.' });
}

async function registrarLog(usuario, accion, locationData = {}) {
    try {
        const nuevoLog = new LogAuditoria({ 
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
        const categorias = await Categoria.find().sort({ nombre: 1 }).lean();
        res.json({ categorias });
    } catch (e) { res.status(500).json({ error: 'Fallo al recuperar categorías.' }); }
});

app.post('/api/categorias', exigeAdmin, async (req, res) => {
    try {
        const nombreLimpio = req.body.nombre ? req.body.nombre.trim() : "";
        if (!nombreLimpio) return res.status(400).json({ error: 'Nombre requerido.' });
        const nueva = new Categoria({ nombre: nombreLimpio });
        await nueva.save();
        await registrarLog(req.session.email, `Creó nueva categoría: ${nombreLimpio}`);
        res.json({ status: 'success', categoria: nueva });
    } catch (e) { res.status(400).json({ error: 'La categoría ya existe.' }); }
});

app.put('/api/categorias/:id', exigeAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre } = req.body;
        const cat = await Categoria.findByIdAndUpdate(id, { nombre }, { new: true });
        await registrarLog(req.session.email, `Modificó categoría: ${nombre}`);
        res.json(cat);
    } catch (e) { res.status(400).json({ error: 'Error al actualizar categoría.' }); }
});

app.delete('/api/categorias/:id', exigeAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const cat = await Categoria.findById(id);
        if (!cat) return res.status(404).json({ error: 'No existe.' });
        await Categoria.findByIdAndDelete(id);
        await registrarLog(req.session.email, `Eliminó categoría: ${cat.nombre}`);
        res.sendStatus(200);
    } catch (e) { res.status(500).json({ error: 'Error al purgar categoría.' }); }
});

// --- Rutas de Tiendas ---

app.get('/api/tiendas', exigeAdmin, async (req, res) => {
    try {
        const tiendas = await Tienda.find().sort({ nombre: 1 }).lean();
        res.json({ tiendas });
    } catch (e) {
        res.status(500).json({ error: 'Fallo al recuperar tiendas.' });
    }
});

app.post('/api/tiendas', exigeAdmin, async (req, res) => {
    try {
        const nombreLimpio = req.body.nombre ? req.body.nombre.trim() : "";
        if (!nombreLimpio) return res.status(400).json({ error: 'El nombre es obligatorio.' });

        const nuevaTienda = new Tienda({ nombre: nombreLimpio });
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
        const { id } = req.params;
        
        const tiendaPorBorrar = await Tienda.findById(id);
        if (!tiendaPorBorrar) return res.status(404).json({ error: 'La tienda no existe.' });

        // Desasignar tienda de los productos asociados
        await VentaRopa.updateMany({ tienda: id }, { $unset: { tienda: 1 } });
        await Tienda.findByIdAndDelete(id);

        await registrarLog(req.session.email, `Eliminó la tienda "${tiendaPorBorrar.nombre}".`);
        return res.sendStatus(200);
    } catch (err) {
        console.error("Error al borrar tienda:", err);
        return res.status(500).json({ error: 'Fallo crítico al purgar la tienda.' });
    }
});

// --- Rutas de Auth ---

app.get('/api/auth/verificar', (req, res) => {
    if (req.session && req.session.esAdmin) return res.json({ autenticado: true, usuario: req.session.email, rol: req.session.rol || 'Admin' });
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
            autorizado.ultimaConexion = new Date();
            await autorizado.save();

            req.session.esAdmin = true;
            req.session.email = emailUsuario;
            req.session.rol = autorizado.rol || 'Admin';
            
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

// --- Rutas de Gestión de Usuarios ---
app.get('/api/usuarios-admin', exigeAdmin, async (req, res) => {
    try { 
        res.json(await UsuarioAutorizado.find().sort({ fechaAgregado: -1 })); 
    } catch (e) { res.status(500).send(e); }
});

app.post('/api/usuarios-admin', exigeAdmin, async (req, res) => {
    try {
        const emailLimpio = req.body.email ? req.body.email.toLowerCase().trim() : "";
        const rolAsignado = req.body.rol || "Editor";
        if (!emailLimpio) return res.status(400).json({ error: 'Email requerido.' });
        const nuevo = new UsuarioAutorizado({ email: emailLimpio, rol: rolAsignado });
        await nuevo.save();
        await registrarLog(req.session.email, `Autorizó cuenta: ${emailLimpio} [Rol: ${rolAsignado}]`);
        res.json(nuevo);
    } catch (e) { res.status(400).json({ error: 'El usuario ya está autorizado en la lista.' }); }
});

app.delete('/api/usuarios-admin/:id', exigeAdmin, async (req, res) => {
    try {
        const u = await UsuarioAutorizado.findById(req.params.id);
        if (u) {
            await UsuarioAutorizado.findByIdAndDelete(req.params.id);
            await registrarLog(req.session.email, `Revocó el acceso permanente a: ${u.email}`);
        }
        res.sendStatus(200);
    } catch (e) { res.status(500).send(e); }
});

// --- Rutas de Tareas (Kanban) ---
app.get('/api/tareas', exigeAdmin, async (req, res) => {
    try { res.json(await Tarea.find().sort({ fechaCreacion: -1 })); } catch (e) { res.status(500).send(e); }
});
app.post('/api/tareas', exigeAdmin, async (req, res) => {
    try {
        const nueva = new Tarea(req.body);
        await nueva.save();
        await registrarLog(req.session.email, `Creó una tarea: ${nueva.titulo}`);
        res.json(nueva);
    } catch (e) { res.status(400).send(e); }
});
app.put('/api/tareas/:id', exigeAdmin, async (req, res) => {
    try {
        const tarea = await Tarea.findByIdAndUpdate(req.params.id, req.body, { new: true });
        await registrarLog(req.session.email, `Actualizó la tarea: ${tarea.titulo}`);
        res.json(tarea);
    } catch (e) { res.status(400).send(e); }
});
app.put('/api/tareas/:id/estado', exigeAdmin, async (req, res) => {
    try {
        const tarea = await Tarea.findByIdAndUpdate(req.params.id, { estado: req.body.estado }, { new: true });
        await registrarLog(req.session.email, `Movió tarea a ${req.body.estado}: ${tarea.titulo}`);
        res.json(tarea);
    } catch (e) { res.status(400).send(e); }
});
app.delete('/api/tareas/:id', exigeAdmin, async (req, res) => {
    try {
        const tarea = await Tarea.findByIdAndDelete(req.params.id);
        if(tarea) await registrarLog(req.session.email, `Eliminó la tarea: ${tarea.titulo}`);
        res.sendStatus(200);
    } catch (e) { res.status(500).send(e); }
});

// --- Rutas de FAQs Dinámicas ---
app.get('/api/faqs', exigeAdmin, async (req, res) => {
    try { res.json(await Faq.find().sort({ fechaCreacion: 1 })); } catch (e) { res.status(500).send(e); }
});
app.post('/api/faqs', exigeAdmin, async (req, res) => {
    try {
        const nueva = new Faq(req.body); await nueva.save();
        await registrarLog(req.session.email, `Añadió nueva FAQ`); res.json(nueva);
    } catch (e) { res.status(400).send(e); }
});
app.put('/api/faqs/:id', exigeAdmin, async (req, res) => {
    try {
        const f = await Faq.findByIdAndUpdate(req.params.id, req.body, { new: true });
        await registrarLog(req.session.email, `Modificó una FAQ`); res.json(f);
    } catch (e) { res.status(400).send(e); }
});
app.delete('/api/faqs/:id', exigeAdmin, async (req, res) => {
    try { await Faq.findByIdAndDelete(req.params.id); await registrarLog(req.session.email, `Eliminó una FAQ`); res.sendStatus(200); } catch (e) { res.status(500).send(e); }
});

// --- Rutas de Ajustes del Tablero Kanban ---
app.get('/api/estados-kanban', exigeAdmin, async (req, res) => {
    try { res.json(await EstadoKanban.find().sort({ orden: 1 })); } catch (e) { res.status(500).send(e); }
});
app.post('/api/estados-kanban', exigeAdmin, async (req, res) => {
    try {
        const nuevo = new EstadoKanban(req.body); await nuevo.save();
        await registrarLog(req.session.email, `Creó el estado Kanban: ${nuevo.nombre}`); res.json(nuevo);
    } catch (e) { res.status(400).send(e); }
});
app.put('/api/estados-kanban/:id', exigeAdmin, async (req, res) => {
    try {
        const estado = await EstadoKanban.findByIdAndUpdate(req.params.id, req.body, { new: true });
        await registrarLog(req.session.email, `Modificó estado Kanban: ${estado.nombre}`); res.json(estado);
    } catch (e) { res.status(400).send(e); }
});
app.delete('/api/estados-kanban/:id', exigeAdmin, async (req, res) => {
    try {
        const estado = await EstadoKanban.findByIdAndDelete(req.params.id);
        if(estado) await registrarLog(req.session.email, `Eliminó el estado Kanban: ${estado.nombre}`); res.sendStatus(200);
    } catch (e) { res.status(500).send(e); }
});

// --- Ruta del Asistente IA (Together AI - Llama 3) ---
app.post('/api/chat', exigeAdmin, async (req, res) => {
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
        const productos = await VentaRopa.find().select('sku prenda estado precioVenta cantidad').limit(150).lean();
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
                    await VentaRopa.findOneAndUpdate({ sku: params.sku }, { precioVenta: parseFloat(params.precio) });
                    await registrarLog(req.session.email, `IA actualizó precio de ${params.sku}`);
                } else if (actionType === 'CAMBIAR_ESTADO' && params.sku && params.estado) {
                    await VentaRopa.findOneAndUpdate({ sku: params.sku }, { estado: params.estado });
                    await registrarLog(req.session.email, `IA cambió estado de ${params.sku} a ${params.estado}`);
                } else if (actionType === 'BORRAR_PRODUCTO' && params.sku) {
                    await VentaRopa.findOneAndDelete({ sku: params.sku });
                    await registrarLog(req.session.email, `IA borró producto ${params.sku}`);
                } else if (actionType === 'CREAR_PRODUCTO' && params.prenda) {
                    const nuevo = new VentaRopa({
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
        const notas = await Nota.find().lean();
        res.json(notas);
    } catch (e) { res.status(500).json({ error: 'Fallo al recuperar notas.' }); }
});

app.post('/api/notas', exigeAdmin, async (req, res) => {
    try {
        const count = await Nota.countDocuments();
        if (count >= 10) return res.status(400).json({ error: 'Límite de 10 notas alcanzado.' });
        const nuevaNota = new Nota({ ...req.body, usuario: req.session.email });
        await nuevaNota.save();
        res.json(nuevaNota);
    } catch (e) { res.status(500).json({ error: 'Error al crear nota.' }); }
});

app.put('/api/notas/:id', exigeAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const notaActualizada = await Nota.findByIdAndUpdate(id, req.body, { new: true });
        res.json(notaActualizada);
    } catch (e) { res.status(500).json({ error: 'Error al mover nota.' }); }
});

app.delete('/api/notas/:id', exigeAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await Nota.findByIdAndDelete(id);
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

app.get('/api/logs/locations', exigeAdmin, async (req, res) => {
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
app.get('/api/clientes', exigeAdmin, async (req, res) => {
    try { res.json(await Cliente.find().sort({ nombre: 1 })); } catch (e) { res.status(500).send(e); }
});
app.post('/api/clientes', exigeAdmin, async (req, res) => {
    try {
        const nuevo = new Cliente(req.body);
        await nuevo.save();
        await registrarLog(req.session.email, `Registró cliente: ${nuevo.nombre}`);
        res.json(nuevo);
    } catch (e) { res.status(400).send(e); }
});
app.put('/api/clientes/:id', exigeAdmin, async (req, res) => {
    try {
        const cliente = await Cliente.findByIdAndUpdate(req.params.id, req.body, { new: true });
        await registrarLog(req.session.email, `Actualizó datos del cliente: ${cliente.nombre}`);
        notificarCambio(); // Notificar cambio para refrescar la lista de clientes en otros navegadores
        res.json(cliente);
    } catch (e) { res.status(400).send(e); }
});
app.delete('/api/clientes/:id', exigeAdmin, async (req, res) => {
    try {
        await Cliente.findByIdAndDelete(req.params.id);
        notificarCambio(); // Notificar cambio para refrescar la lista de clientes en otros navegadores
        res.sendStatus(200);
    } catch (e) { res.status(500).send(e); }
});

// --- Rutas de Gastos Operativos ---
app.get('/api/gastos', exigeAdmin, async (req, res) => {
    try { res.json(await Gasto.find().sort({ fecha: -1 })); } catch (e) { res.status(500).send(e); }
});
app.post('/api/gastos', exigeAdmin, async (req, res) => {
    try {
        const nuevo = new Gasto(req.body);
        await nuevo.save();
        await registrarLog(req.session.email, `Registró gasto: ${nuevo.concepto} (${nuevo.monto}€)`);
        res.json(nuevo);
    } catch (e) { res.status(400).send(e); }
});
app.delete('/api/gastos/:id', exigeAdmin, async (req, res) => {
    try {
        await Gasto.findByIdAndDelete(req.params.id);
        res.sendStatus(200);
    } catch (e) { res.status(500).send(e); }
});

app.get('/api/ventas', exigeAdmin, async (req, res) => {
    try {
        const ventasRaw = await VentaRopa.find().populate('tienda').sort({ _id: -1 }).lean();
        const logs = await LogAuditoria.find().sort({ _id: -1 }).limit(50).lean(); 
        const gastosExtra = await Gasto.find().lean();
        const estadosKanban = await EstadoKanban.find().lean();
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

        return res.json({ 
            resumen: { ingresos, beneficio: beneficioNeto, inversion: inversion + gastosTotalesEnvio + totalGastosOperativos, prendasVendidas, roi, totalGastosOperativos }, 
            ventas,
            logs 
        });
    } catch (error) { return res.status(500).json({ error: 'Fallo analíticas.' }); }
});

app.post('/api/ventas', exigeAdmin, async (req, res) => {
    try {
        const { proveedor, ...datosVenta } = req.body;
        
        const tiendaDoc = await Tienda.findOne({ nombre: proveedor });

        const nuevaVenta = new VentaRopa({ ...datosVenta, tienda: tiendaDoc ? tiendaDoc._id : null });
        await nuevaVenta.save(); 
        await registrarLog(req.session.email, `Registró prenda en stock: ${nuevaVenta.prenda} (${proveedor})`);
        return res.json({ status: "success", venta: nuevaVenta });
    } catch (error) { 
        return res.status(500).json({ error: 'Error al registrar artículo.' }); 
    }
});

app.put('/api/ventas/:id', exigeAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { proveedor, ...datosVenta } = req.body;

        const tiendaDoc = await Tienda.findOne({ nombre: proveedor });

        const ventaActualizada = await VentaRopa.findByIdAndUpdate(
            id, 
            { ...datosVenta, tienda: tiendaDoc ? tiendaDoc._id : null }, 
            { new: true }
        );

        await registrarLog(req.session.email, `Modificó datos de la prenda ID: ${id} (${ventaActualizada.prenda})`);
        return res.json({ status: "success", venta: ventaActualizada });
    } catch (error) {
        return res.status(500).json({ error: 'Error al actualizar registro.' });
    }
});

app.put('/api/ventas/:id/estado', exigeAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { estado } = req.body;

        const estadoConfig = await EstadoKanban.findOne({ nombre: estado });
        const updateData = { estado };
        
        if (estadoConfig && estadoConfig.rolFinanciero === 'Venta') {
            updateData.fechaVenta = new Date().toISOString().split('T')[0];
        } else {
            updateData.fechaVenta = '';
        }

        const ventaActualizada = await VentaRopa.findByIdAndUpdate(id, updateData, { new: true });
        await registrarLog(req.session.email, `Transición de estado: [${ventaActualizada.prenda}] -> ${estado.toUpperCase()}`);
        return res.json({ status: "success", venta: ventaActualizada });
    } catch (error) {
        return res.status(500).json({ error: 'Error en la actualización de la columna Kanban.' });
    }
});

app.put('/api/ventas/escanear/:sku', exigeAdmin, async (req, res) => {
    try {
        const { sku } = req.params;
        let venta = await VentaRopa.findOne({ sku: sku });
        
        const estadosConfig = await EstadoKanban.find().sort({ orden: 1 });
        const estStock = estadosConfig.find(e => e.rolFinanciero === 'Stock');
        const estVenta = estadosConfig.find(e => e.rolFinanciero === 'Venta');
        
        const nombreStock = estStock ? estStock.nombre : 'No Vendido';
        const nombreVenta = estVenta ? estVenta.nombre : 'Vendido';

        if (!venta) {
            venta = new VentaRopa({
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

app.delete('/api/ventas/:id', exigeAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const ventaEliminada = await VentaRopa.findByIdAndDelete(id);
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

/**
 * Analiza datos subidos manualmente (ej. desde un Excel de Instant Data Scraper)
 */
app.post('/api/scraper/analizar-manual', exigeAdmin, async (req, res) => {
    try {
        const { productosExtraidos } = req.body;
        console.log(`[SCRAPER MANUAL] Recibidos ${productosExtraidos?.length || 0} productos para comparar.`);
        if (!productosExtraidos || !Array.isArray(productosExtraidos)) {
            return res.status(400).json({ error: 'Datos no válidos.' });
        }

        const resultados = { discrepancias: [], nuevos: [], identicos: [] };
        const productosBD = await VentaRopa.find({ canalVenta: 'Vinted' }).lean();

        productosExtraidos.forEach(item => {
            const titulo = item.titulo || '';
            const precioWeb = parseFloat(item.precio);
            const imagen = item.imagen || '';

            if (titulo && !isNaN(precioWeb)) {
                const coincidencia = productosBD.find(p => 
                    p.prenda.toLowerCase().includes(titulo.toLowerCase()) || 
                    titulo.toLowerCase().includes(p.prenda.toLowerCase())
                );

                if (coincidencia) {
                    if (Math.abs(coincidencia.precioVenta - precioWeb) > 0.01) {
                        resultados.discrepancias.push({
                            idMongo: coincidencia._id, prenda: coincidencia.prenda,
                            valorAntiguo: coincidencia.precioVenta, valorNuevo: precioWeb, imagen
                        });
                    } else {
                        resultados.identicos.push({
                            idMongo: coincidencia._id, prenda: coincidencia.prenda, precio: coincidencia.precioVenta, imagen
                        });
                    }
                } else {
                    resultados.nuevos.push({ prenda: titulo, precioVenta: precioWeb, imagen, canalVenta: 'Vinted', estado: 'No Vendido' });
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
app.post('/api/scraper/importar', exigeAdmin, async (req, res) => {
    try {
        const { productos } = req.body; // Array de productos seleccionados en el frontend
        if (!productos || !Array.isArray(productos)) return res.status(400).json({ error: 'Datos de productos no válidos.' });

        let tiendaVinted = await Tienda.findOne({ nombre: 'Vinted' });
        if (!tiendaVinted) {
            tiendaVinted = new Tienda({ nombre: 'Vinted' });
            await tiendaVinted.save();
        }

        const registrosCreados = [];
        for (const prod of productos) {
            const nuevaVenta = new VentaRopa({
                ...prod,
                imagen: await downloadAndConvertToBase64(prod.imagen), // Descargar y guardar imagen como Base64
                tienda: tiendaVinted._id,
                sku: `VNT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                comentariosProducto: `Importado automáticamente desde Vinted el ${new Date().toLocaleDateString()}`
            });
            await nuevaVenta.save();
            registrosCreados.push(nuevaVenta.prenda);
        }
        notificarCambio(); // Notificar cambio para refrescar el panel principal

        await registrarLog(req.session.email, `Importó ${registrosCreados.length} productos desde Vinted: ${registrosCreados.join(', ')}`);
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
                const t = await Tienda.findOne({ nombre: p.proveedor });
                if (t) tiendaId = t._id;
            }
            return {
                ...p,
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
 * Aplica cambios de precio a productos existentes
 */
app.post('/api/scraper/aplicar', exigeAdmin, async (req, res) => {
    try {
        const { cambios } = req.body;
        for (const cambio of cambios) {
            await VentaRopa.findByIdAndUpdate(cambio.idMongo, { precioVenta: cambio.valorNuevo });
            await registrarLog(req.session.email, `Sincronización precio: ${cambio.prenda} -> ${cambio.valorNuevo}€`);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar precios.' });
    }
});
