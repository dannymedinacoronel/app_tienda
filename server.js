require('dotenv').config(); 
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const session = require('express-session'); 
const MongoStore = require('connect-mongo'); 
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

app.set('trust proxy', 1);

const MONGO_URI_FINAL = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb+srv://dannymedinacoronel_db_user:ccVg5uBpXkh5C0eo@cluster0.qnh4rbz.mongodb.net/tienda_ropa?appName=Cluster0";

mongoose.connect(MONGO_URI_FINAL)
    .then(() => console.log('\x1b[32m[OK]\x1b[0m Core Estable de Seychelles conectado a MongoDB Atlas.'))
    .catch(err => console.error('Fallo crítico en Atlas:', err));

// --- Modelos ---

const TiendaSchema = new mongoose.Schema({
    nombre: { type: String, required: true, unique: true, trim: true },
    fechaCreacion: { type: Date, default: Date.now }
});
const Tienda = mongoose.model('Tienda', TiendaSchema);

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
    estado: { type: String, enum: ['Vendido', 'No Vendido', 'Devuelto'], default: 'No Vendido' },
    tienda: { type: mongoose.Schema.Types.ObjectId, ref: 'Tienda', required: true } // Relación añadida
});
const VentaRopa = mongoose.model('VentaRopa', VentaRopaSchema);

const LogAuditoriaSchema = new mongoose.Schema({
    fechaHora: { type: Date, default: Date.now },
    usuario: { type: String, required: true },
    accion: { type: String, required: true }
});
const LogAuditoria = mongoose.model('LogAuditoria', LogAuditoriaSchema);

const ADMIN_WHITELIST = ['dannymedinacoronel@gmail.com', 'juliamugo2001@gmail.com'];

app.use(express.json());

const mongoStoreBuilder = MongoStore.create ? MongoStore : MongoStore.default;
app.use(session({
    secret: process.env.SESSION_SECRET || 'clave_maestra_seychelles_987654321',
    resave: false,
    saveUninitialized: false,
    store: mongoStoreBuilder.create({ mongoUrl: MONGO_URI_FINAL, collectionName: 'sesiones_activas', ttl: 14 * 24 * 60 * 60 }),
    cookie: { secure: true, sameSite: 'lax', maxAge: 14 * 24 * 60 * 60 * 1000 }
}));

app.use(express.static(path.join(__dirname, 'public')));

function exigeAdmin(req, res, next) {
    if (req.session && req.session.esAdmin) return next();
    return res.status(403).json({ error: 'No autorizado.' });
}

async function registrarLog(usuario, accion) {
    try {
        const nuevoLog = new LogAuditoria({ usuario, accion });
        await nuevoLog.save();
    } catch (e) { console.error("Error al guardar log:", e); }
}

// --- Rutas de Tiendas ---

app.get('/api/tiendas', exigeAdmin, async (req, res) => {
    const tiendas = await Tienda.find().lean();
    res.json(tiendas);
});

app.post('/api/tiendas', exigeAdmin, async (req, res) => {
    try {
        const nuevaTienda = new Tienda({ nombre: req.body.nombre });
        await nuevaTienda.save();
        await registrarLog(req.session.email, `Creó la tienda: ${nuevaTienda.nombre}`);
        res.json({ status: 'success', tienda: nuevaTienda });
    } catch (e) {
        res.status(400).json({ error: 'La tienda ya existe o hay un error.' });
    }
});

// --- Rutas de Auth ---

app.get('/api/auth/verificar', (req, res) => {
    if (req.session && req.session.esAdmin) return res.json({ autenticado: true, usuario: req.session.email });
    return res.json({ autenticado: false });
});

app.post('/api/auth/google', async (req, res) => {
    const { token } = req.body;
    try {
        const ticket = await client.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();
        const emailUsuario = payload['email'].toLowerCase().trim();
        if (ADMIN_WHITELIST.includes(emailUsuario)) {
            req.session.esAdmin = true;
            req.session.email = emailUsuario;
            await registrarLog(emailUsuario, "Inició sesión en el sistema core");
            return res.json({ status: 'success', usuario: emailUsuario });
        }
        return res.status(401).json({ error: 'Email no autorizado.' });
    } catch (error) { return res.status(400).json({ error: 'Token inválido.' }); }
});

// --- Rutas de Ventas ---

app.get('/api/ventas', exigeAdmin, async (req, res) => {
    try {
        const ventas = await VentaRopa.find().populate('tienda').sort({ _id: -1 }).lean();
        const logs = await LogAuditoria.find().sort({ _id: -1 }).limit(50).lean(); 
        
        let ingresos = 0, inversion = 0, prendasVendidas = 0, gastosTotalesEnvio = 0;
        
        ventas.forEach(v => {
            const cant = parseInt(v.cantidad, 10) || 0;
            const pCompra = parseFloat(v.precioCompra) || 0;
            const pVenta = parseFloat(v.precioVenta) || 0;
            const gEnvio = parseFloat(v.gastosEnvio) || 0;

            inversion += (pCompra * cant);
            gastosTotalesEnvio += (gEnvio * cant);

            if (v.estado === 'Vendido') {
                let comisionPlataforma = 0;
                if (v.canalVenta === 'Vinted' || v.canalVenta === 'Wallapop') {
                    comisionPlataforma = (pVenta * 0.05); 
                }
                ingresos += ((pVenta - comisionPlataforma) * cant);
                prendasVendidas += cant;
            }
        });

        const beneficioNeto = ingresos - inversion - gastosTotalesEnvio;

        return res.json({ 
            resumen: { ingresos, beneficio: beneficioNeto, inversion: inversion + gastosTotalesEnvio, prendasVendidas }, 
            ventas,
            logs 
        });
    } catch (error) { return res.status(500).json({ error: 'Fallo analíticas.' }); }
});

app.post('/api/ventas', exigeAdmin, async (req, res) => {
    try {
        // Se espera que req.body contenga tiendaId
        const { tiendaId, ...datosVenta } = req.body;
        const nuevaVenta = new VentaRopa({ ...datosVenta, tienda: tiendaId });
        await nuevaVenta.save(); 
        await registrarLog(req.session.email, `Añadió artículo a tienda ${tiendaId}: ${nuevaVenta.prenda}`);
        return res.json({ status: "success", venta: nuevaVenta });
    } catch (error) { return res.status(500).json({ error: 'Error al registrar.' }); }
});

// (Resto de métodos PUT/DELETE similares, manteniendo la lógica de administración)

app.get('/api/logout', (req, res) => { req.session.destroy(() => res.sendStatus(200)); });
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[SERVER] Seychelles Core Activo en puerto: ${PORT}`));