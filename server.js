require('dotenv').config(); 
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const cookieSession = require('cookie-session');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Conexión robusta a MongoDB Cloud
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('\x1b[32m[OK]\x1b[0m Conectado con éxito a MongoDB Atlas'))
    .catch(err => console.error('Error crítico al conectar a MongoDB:', err));

// Esquema de Datos Elástico de Producción
const VentaRopaSchema = new mongoose.Schema({
    fecha: { type: String, default: () => new Date().toISOString().split('T')[0] },
    prenda: { type: String, default: 'Artículo General', trim: true },
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
    keys: [process.env.SESSION_SECRET || 'clave_alternativa_segura_123'],
    maxAge: 12 * 60 * 60 * 1000 // 12 horas
}));

// Servir la interfaz estática
app.use(express.static(path.join(__dirname, 'public')));

function exigeAdmin(req, res, next) {
    if (req.session && req.session.esAdmin) return next();
    return res.status(403).json({ error: 'Acceso denegado. No autorizado.' });
}

// --- ENDPOINTS DE LA API ---

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
        return res.status(401).json({ error: 'Tu correo no está en la lista de administradores.' });
    } catch (error) { return res.status(400).json({ error: 'Token inválido o expirado.' }); }
});

// GET TOTALMENTE BLINDADO CONTRA DATOS CORRUPTOS (ERR 500 FIX)
app.get('/api/ventas', exigeAdmin, async (req, res) => {
    try {
        const ventas = await VentaRopa.find().sort({ _id: -1 }).lean();
        
        let ingresos = 0;
        let inversion = 0;
        let prendasVendidas = 0;

        if (ventas && ventas.length > 0) {
            ventas.forEach(v => {
                const estadoActual = v.estado || 'Vendido';
                
                // Forzar conversión y aplicar un "Salvavidas" si el dato es NaN o corrupto
                const cant = parseInt(v.cantidad, 10);
                const pCompra = parseFloat(v.precioCompra);
                const pVenta = parseFloat(v.precioVenta);

                const cantidadSegura = isNaN(cant) ? 0 : cant;
                const compraSegura = isNaN(pCompra) ? 0 : pCompra;
                const ventaSegura = isNaN(pVenta) ? 0 : pVenta;

                if (estadoActual === 'Vendido') {
                    ingresos += (ventaSegura * cantidadSegura);
                    inversion += (compraSegura * cantidadSegura);
                    prendasVendidas += cantidadSegura;
                } else if (estadoActual === 'Devuelto') {
                    inversion += (compraSegura * cantidadSegura);
                }
            });
        }

        return res.json({
            resumen: { ingresos, beneficio: ingresos - inversion, inversion, prendasVendidas },
            ventas: ventas || []
        });
    } catch (error) { 
        console.error("Fallo crítico controlado en GET /api/ventas:", error);
        return res.status(500).json({ error: 'Error interno del servidor al mapear registros.' }); 
    }
});

app.post('/api/ventas', exigeAdmin, async (req, res) => {
    try {
        const { prenda, categoria, talla, cantidad, precioCompra, precioVenta } = req.body;
        
        const nuevaVenta = new VentaRopa({
            prenda: prenda ? prenda.trim() : "Artículo Seychelles",
            categoria: categoria || "Otros",
            talla: talla || "M",
            cantidad: parseInt(cantidad, 10) || 1,
            precioCompra: parseFloat(precioCompra) || 0,
            precioVenta: parseFloat(precioVenta) || 0,
            estado: 'Vendido'
        });

        await nuevaVenta.save(); 
        return res.json({ status: "success", venta: nuevaVenta });
    } catch (error) { 
        return res.status(500).json({ error: 'Error al procesar la inserción.' }); 
    }
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[OK] Servidor corriendo de forma segura en puerto: ${PORT}`));