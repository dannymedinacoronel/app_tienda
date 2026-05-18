require('dotenv').config(); 
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const session = require('express-session'); // Cambiado a express-session nativo
const MongoStore = require('connect-mongo'); // Persistencia de sesiones en la nube
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

app.set('trust proxy', 1);

const MONGO_URI_FINAL = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb+srv://dannymedinacoronel_db_user:ccVg5uBpXkh5C0eo@cluster0.qnh4rbz.mongodb.net/tienda_ropa?appName=Cluster0";

// Conexión Centralizada de Mongoose
mongoose.connect(MONGO_URI_FINAL)
    .then(() => console.log('\x1b[32m[OK]\x1b[0m MongoDB Cloud conectado y listo.'))
    .catch(err => console.error('Fallo en conexión MongoDB:', err));

// Esquema Optimizado
const VentaRopaSchema = new mongoose.Schema({
    fecha: { type: String, default: () => new Date().toISOString().split('T')[0] },
    prenda: { type: String, default: 'Artículo General', trim: true },
    categoria: { type: String, default: 'Camisetas' },
    talla: { type: String, default: 'M' },
    cantidad: { type: Number, default: 1, min: 1 },
    precioCompra: { type: Number, default: 0, min: 0 },
    precioVenta: { type: Number, default: 0, min: 0 },
    estado: { type: String, enum: ['Vendido', 'Devuelto'], default: 'Vendido' }
});
const VentaRopa = mongoose.model('VentaRopa', VentaRopaSchema);

const ADMIN_WHITELIST = ['dannymedinacoronel@gmail.com', 'juliamugo2001@gmail.com'];

app.use(express.json());

// BLINDAJE DE SESIONES: Guardadas en Mongo Atlas en lugar de la memoria volatil del servidor
app.use(session({
    secret: process.env.SESSION_SECRET || 'clave_maestra_seychelles_987654321',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: MONGO_URI_FINAL,
        collectionName: 'sesiones_activas',
        ttl: 14 * 24 * 60 * 60 // Las sesiones duran 14 días guardadas aunque Render se reinicie
    }),
    cookie: {
        secure: true, 
        sameSite: 'lax',
        maxAge: 14 * 24 * 60 * 60 * 1000
    }
}));

app.use(express.static(path.join(__dirname, 'public')));

function exigeAdmin(req, res, next) {
    if (req.session && req.session.esAdmin) return next();
    return res.status(403).json({ error: 'No autorizado. Inicie sesión.' });
}

// --- API ---

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
        // En el futuro, si el volumen es gigante, aquí aplicaremos .limit()
        const ventas = await VentaRopa.find().sort({ _id: -1 }).lean();
        
        let ingresos = 0, inversion = 0, prendasVendidas = 0;

        ventas.forEach(v => {
            const estadoActual = v.estado || 'Vendido';
            const cant = parseInt(v.cantidad, 10) || 0;
            const pCompra = parseFloat(v.precioCompra) || 0;
            const pVenta = parseFloat(v.precioVenta) || 0;

            if (estadoActual === 'Vendido') {
                ingresos += (pVenta * cant);
                inversion += (pCompra * cant);
                prendasVendidas += cant;
            } else if (estadoActual === 'Devuelto') {
                inversion += (pCompra * cant);
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
        const { prenda, categoria, talla, cantidad, precioCompra, precioVenta } = req.body;
        const nuevaVenta = new VentaRopa({
            prenda: prenda ? prenda.trim() : "Artículo General",
            categoria, talla,
            cantidad: parseInt(cantidad, 10) || 1,
            precioCompra: parseFloat(precioCompra) || 0,
            precioVenta: parseFloat(precioVenta) || 0
        });
        await nuevaVenta.save(); 
        return res.json({ status: "success", venta: nuevaVenta });
    } catch (error) { return res.status(500).json({ error: 'Error al indexar stock.' }); }
});

app.put('/api/ventas/:id/devolucion', exigeAdmin, async (req, res) => {
    try {
        await VentaRopa.findByIdAndUpdate(req.params.id, { estado: 'Devuelto' });
        return res.json({ status: "success" });
    } catch (error) { return res.status(500).json({ error: 'Error operativo.' }); }
});

app.delete('/api/ventas/:id', exigeAdmin, async (req, res) => {
    try {
        await VentaRopa.findByIdAndDelete(req.params.id);
        return res.json({ status: "success" });
    } catch (error) { return res.status(500).json({ error: 'Error al remover.' }); }
});

app.get('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.sendStatus(200);
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[PRODUCTION-READY] Servidor en puerto: ${PORT}`));