require('dotenv').config(); 
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const cookieSession = require('cookie-session');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// CADENA DE RESPALDO REAL (Si falla Render, usa esta directo)
const CADENA_CONEXION_REAL = "mongodb+srv://dannymedinacoronel_db_user:ccVg5uBpXkh5C0eo@cluster0.qnh4rbz.mongodb.net/tienda_ropa?appName=Cluster0";

// Mapeo inteligente: Busca con B, sin B o usa la directa
const mongoURI = process.env.MONGODB_URI || process.env.MONGO_URI || CADENA_CONEXION_REAL;

// Conexión robusta a MongoDB Cloud
mongoose.connect(mongoURI)
    .then(() => console.log('\x1b[32m[OK]\x1b[0m Conectado con éxito a MongoDB Atlas en la base: tienda_ropa'))
    .catch(err => console.error('Error crítico al conectar a MongoDB:', err));

const VentaRopaSchema = new mongoose.Schema({
    fecha: { type: String, default: () => new Date().toISOString().split('T')[0] },
    prenda: { type: String, default: 'Artículo Seychelles', trim: true },
    categoria: { type: String, default: 'Camisetas' },
    talla: { type: String, default: 'M' },
    cantidad: { type: Number, default: 1 },
    precioCompra: { type: Number, default: 0 },
    precioVenta: { type: Number, default: 0 },
    estado: { type: String, enum: ['Vendido', 'Devuelto'], default: 'Vendido' }
});
const VentaRopa = mongoose.model('VentaRopa', VentaRopaSchema);

const ADMIN_WHITELIST = [
    'dannymedinacoronel@gmail.com',
    'juliamugo2001@gmail.com'
];

app.use(express.json());
app.use(cookieSession({
    name: 'session-admin',
    keys: [process.env.SESSION_SECRET || 'una_clave_super_secreta_y_larga_para_encriptar_cookies'],
    maxAge: 12 * 60 * 60 * 1000
}));

// Servir la interfaz estática desde public
app.use(express.static(path.join(__dirname, 'public')));

function exigeAdmin(req, res, next) {
    if (req.session && req.session.esAdmin) return next();
    return res.status(403).json({ error: 'Acceso denegado. No autorizado.' });
}

// --- ENDPOINTS ---
app.post('/api/auth/google', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token no suministrado.' });
    try {
        const ticket = await client.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();
        const emailUsuario = payload['email'].toLowerCase().trim();

        if (ADMIN_WHITELIST.includes(emailUsuario)) {
            req.session.esAdmin = true;
            req.session.email = emailUsuario;
            return res.json({ status: 'success', usuario: emailUsuario });
        }
        return res.status(401).json({ error: 'Tu correo no está autorizado.' });
    } catch (error) { return res.status(400).json({ error: 'Token inválido.' }); }
});

app.get('/api/ventas', exigeAdmin, async (req, res) => {
    try {
        const ventas = await VentaRopa.find().sort({ _id: -1 }).lean();
        let ingresos = 0, inversion = 0, prendasVendidas = 0;

        if (ventas && ventas.length > 0) {
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
        }
        return res.json({ resumen: { ingresos, beneficio: ingresos - inversion, inversion, prendasVendidas }, ventas: ventas || [] });
    } catch (error) { return res.status(500).json({ error: 'Error al consultar los datos.' }); }
});

app.post('/api/ventas', exigeAdmin, async (req, res) => {
    try {
        const { prenda, categoria, talla, cantidad, precioCompra, precioVenta } = req.body;
        const nuevaVenta = new VentaRopa({
            prenda: prenda ? prenda.trim() : "Artículo General",
            categoria: categoria || "Camisetas",
            talla: talla || "M",
            cantidad: parseInt(cantidad, 10) || 1,
            precioCompra: parseFloat(precioCompra) || 0,
            precioVenta: parseFloat(precioVenta) || 0,
            estado: 'Vendido'
        });
        await nuevaVenta.save(); 
        return res.json({ status: "success", venta: nuevaVenta });
    } catch (error) { return res.status(500).json({ error: 'Error al guardar el registro.' }); }
});

app.put('/api/ventas/:id/devolucion', exigeAdmin, async (req, res) => {
    try {
        await VentaRopa.findByIdAndUpdate(req.params.id, { estado: 'Devuelto' });
        return res.json({ status: "success" });
    } catch (error) { return res.status(500).json({ error: 'Error en la devolución.' }); }
});

app.delete('/api/ventas/:id', exigeAdmin, async (req, res) => {
    try {
        await VentaRopa.findByIdAndDelete(req.params.id);
        return res.json({ status: "success" });
    } catch (error) { return res.status(500).json({ error: 'Error al eliminar.' }); }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Forzar puerto dinámico de Render (¡QUITAR EL PORT=3000 FIJO!)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[OK] Servidor corriendo de forma segura en puerto: ${PORT}`));