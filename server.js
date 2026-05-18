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
    .then(() => console.log('\x1b[32m[OK]\x1b[0m Conectado correctamente a MongoDB Atlas (tienda_ropa)'))
    .catch(err => console.error('Error de conexión en MongoDB Atlas:', err));

// Esquema de Datos Adaptado para los dos estados
const VentaRopaSchema = new mongoose.Schema({
    fecha: { type: String, default: () => new Date().toISOString().split('T')[0] },
    prenda: { type: String, default: 'Artículo General', trim: true },
    categoria: { type: String, default: 'Camisetas' },
    talla: { type: String, default: 'M' },
    cantidad: { type: Number, default: 1, min: 1 },
    precioCompra: { type: Number, default: 0, min: 0 },
    precioVenta: { type: Number, default: 0, min: 0 },
    estado: { type: String, enum: ['Vendido', 'No Vendido', 'Devuelto'], default: 'No Vendido' } // 'No Vendido' por defecto al registrar stock
});
const VentaRopa = mongoose.model('VentaRopa', VentaRopaSchema);

const ADMIN_WHITELIST = ['dannymedinacoronel@gmail.com', 'juliamugo2001@gmail.com'];

app.use(express.json());

const mongoStoreBuilder = MongoStore.create ? MongoStore : MongoStore.default;

app.use(session({
    secret: process.env.SESSION_SECRET || 'clave_maestra_seychelles_987654321',
    resave: false,
    saveUninitialized: false,
    store: mongoStoreBuilder.create({
        mongoUrl: MONGO_URI_FINAL,
        collectionName: 'sesiones_activas',
        ttl: 14 * 24 * 60 * 60
    }),
    cookie: { secure: true, sameSite: 'lax', maxAge: 14 * 24 * 60 * 60 * 1000 }
}));

app.use(express.static(path.join(__dirname, 'public')));

function exigeAdmin(req, res, next) {
    if (req.session && req.session.esAdmin) return next();
    return res.status(403).json({ error: 'No autorizado. Inicie sesión.' });
}

// --- API ENDPOINTS ---

app.post('/api/auth/google', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token ausente.' });
    try {
        const ticket = await client.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();
        const emailUsuario = payload['email'].toLowerCase().trim();

        if (ADMIN_WHITELIST.includes(emailUsuario)) {
            req.session.esAdmin = true;
            req.session.email = emailUsuario;
            return res.json({ status: 'success', usuario: emailUsuario });
        }
        return res.status(401).json({ error: 'Email no autorizado.' });
    } catch (error) { return res.status(400).json({ error: 'Token no válido.' }); }
});

app.get('/api/ventas', exigeAdmin, async (req, res) => {
    try {
        const ventas = await VentaRopa.find().sort({ _id: -1 }).lean();
        let ingresos = 0, inversion = 0, prendasVendidas = 0;

        ventas.forEach(v => {
            const estadoActual = v.estado || 'No Vendido';
            const cant = parseInt(v.cantidad, 10) || 0;
            const pCompra = parseFloat(v.precioCompra) || 0;
            const pVenta = parseFloat(v.precioVenta) || 0;

            // Inversión se calcula siempre (es stock comprado)
            inversion += (pCompra * cant);

            if (estadoActual === 'Vendido') {
                ingresos += (pVenta * cant);
                prendasVendidas += cant;
            }
        });

        return res.json({
            resumen: { ingresos, beneficio: ingresos - inversion, inversion, prendasVendidas },
            ventas
        });
    } catch (error) { return res.status(500).json({ error: 'Fallo al procesar analíticas.' }); }
});

app.post('/api/ventas', exigeAdmin, async (req, res) => {
    try {
        const { prenda, categoria, talla, cantidad, precioCompra, precioVenta, estado } = req.body;
        const nuevaVenta = new VentaRopa({
            prenda: prenda ? prenda.trim() : "Artículo General",
            categoria, talla,
            cantidad: parseInt(cantidad, 10) || 1,
            precioCompra: parseFloat(precioCompra) || 0,
            precioVenta: parseFloat(precioVenta) || 0,
            estado: estado || 'No Vendido' // Se puede elegir al crear si ya se vendió o es stock nuevo
        });
        await nuevaVenta.save(); 
        return res.json({ status: "success", venta: nuevaVenta });
    } catch (error) { return res.status(500).json({ error: 'Error al indexar stock.' }); }
});

// NUEVO ENDPOINT CRÍTICO: Actualiza el estado al arrastrar y soltar
app.put('/api/ventas/:id/estado', exigeAdmin, async (req, res) => {
    try {
        const { estado } = req.body;
        if (!['Vendido', 'No Vendido', 'Devuelto'].includes(estado)) {
            return res.status(400).json({ error: 'Estado no válido' });
        }
        await VentaRopa.findByIdAndUpdate(req.params.id, { estado });
        return res.json({ status: "success" });
    } catch (error) { return res.status(500).json({ error: 'Error al actualizar estado.' }); }
});

app.delete('/api/ventas/:id', exigeAdmin, async (req, res) => {
    try {
        await VentaRopa.findByIdAndDelete(req.params.id);
        return res.json({ status: "success" });
    } catch (error) { return res.status(500).json({ error: 'Error al remover.' }); }
});

app.get('/api/logout', (req, res) => {
    req.session.destroy(() => res.sendStatus(200));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[PRODUCTION-READY] Servidor en puerto: ${PORT}`));