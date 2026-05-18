require('dotenv').config(); 
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const cookieSession = require('cookie-session');
const mongoose = require('mongoose');

const app = express();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Conexión limpia a MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('\x1b[32m[OK]\x1b[0m MongoDB Atlas conectado con éxito.'))
    .catch(err => console.error('Error de conexión en MongoDB:', err));

// Definición estricta del Esquema
const VentaRopaSchema = new mongoose.Schema({
    fecha: { type: String, default: () => new Date().toISOString().split('T')[0] },
    prenda: { type: String, required: true, trim: true },
    categoria: { type: String, required: true },
    talla: { type: String, required: true },
    cantidad: { type: Number, required: true, min: 1 },
    precioCompra: { type: Number, required: true, min: 0 },
    precioVenta: { type: Number, required: true, min: 0 },
    estado: { type: String, enum: ['Vendido', 'Devuelto'], default: 'Vendido' }
});
const VentaRopa = mongoose.model('VentaRopa', VentaRopaSchema);

// Whitelist de Acceso Corporativo
const ADMIN_WHITELIST = [
    'dannymedinacoronel@gmail.com',
    'juliamugo2001@gmail.com'
];

// Middlewares Base
app.use(express.json());

app.use(cookieSession({
    name: 'session-admin',
    keys: [process.env.SESSION_SECRET || 'clave_alternativa_segura_123'],
    maxAge: 12 * 60 * 60 * 1000 // 12 Horas
}));

// Configuración Robusta de CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'https://seychellesshop.com');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Guardián de Autenticación
function exigeAdmin(req, res, next) {
    if (req.session && req.session.esAdmin) {
        return next();
    }
    return res.status(403).json({ error: 'No autorizado.' });
}

// === ENDPOINTS DE LA API ===

// Autenticación OAuth2
app.post('/api/auth/google', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token ausente.' });

    try {
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const emailUsuario = payload['email'].toLowerCase().trim();

        if (ADMIN_WHITELIST.includes(emailUsuario)) {
            req.session.esAdmin = true;
            req.session.email = emailUsuario;
            return res.json({ status: 'success', usuario: emailUsuario });
        }
        return res.status(401).json({ error: 'El email no figura en la lista de administradores.' });
    } catch (error) {
        return res.status(400).json({ error: 'Autenticación fallida o token expirado.' });
    }
});

// GET: Retornar Ventas y Analíticas consolidadas
app.get('/api/ventas', exigeAdmin, async (req, res) => {
    try {
        const ventas = await VentaRopa.find().sort({ _id: -1 }).lean();
        
        let ingresos = 0;
        let inversion = 0;
        let prendasVendidas = 0;
        const contadoresCat = {};

        ventas.forEach(v => {
            const estado = v.estado || 'Vendido'; // Sanitización preventiva
            const cantidad = Number(v.cantidad) || 0;
            const pCompra = Number(v.precioCompra) || 0;
            const pVenta = Number(v.precioVenta) || 0;

            if (estado === 'Vendido') {
                ingresos += (pVenta * cantidad);
                inversion += (pCompra * cantidad);
                prendasVendidas += cantidad;
                contadoresCat[v.categoria] = (contadoresCat[v.categoria] || 0) + cantidad;
            } else if (estado === 'Devuelto') {
                inversion += (pCompra * cantidad); // El coste del stock se mantiene retenido
            }
        });

        // Cálculo de categoría estrella
        let topCategoria = 'Ninguna';
        let maxUnidades = 0;
        Object.entries(contadoresCat).forEach(([cat, cant]) => {
            if (cant > maxUnidades) {
                maxUnidades = cant;
                topCategoria = cat;
            }
        });

        return res.json({
            resumen: {
                ingresos,
                beneficio: ingresos - inversion,
                inversion,
                prendasVendidas,
                topCategoria
            },
            ventas
        });
    } catch (error) {
        return res.status(500).json({ error: 'Error en el servidor al procesar analíticas.' });
    }
});

// POST: Registrar nueva entrada
app.post('/api/ventas', exigeAdmin, async (req, res) => {
    try {
        const { prenda, categoria, talla, cantidad, precioCompra, precioVenta } = req.body;
        
        if (!prenda || !categoria || !talla || !cantidad || precioCompra === undefined || precioVenta === undefined) {
            return res.status(400).json({ error: 'Faltan campos obligatorios.' });
        }

        const nuevaVenta = new VentaRopa({
            prenda,
            categoria,
            talla,
            cantidad: parseInt(cantidad, 10),
            precioCompra: parseFloat(precioCompra),
            precioVenta: parseFloat(precioVenta),
            estado: 'Vendido'
        });

        await nuevaVenta.save();
        return res.status(201).json({ status: "success", venta: nuevaVenta });
    } catch (error) {
        return res.status(500).json({ error: 'No se pudo registrar la venta.' });
    }
});

// PUT: Procesar Devolución
app.put('/api/ventas/:id/devolucion', exigeAdmin, async (req, res) => {
    try {
        const articulo = await VentaRopa.findByIdAndUpdate(
            req.params.id, 
            { estado: 'Devuelto' }, 
            { new: true }
        );
        if (!articulo) return res.status(404).json({ error: 'Artículo no encontrado.' });
        return res.json({ status: "success", articulo });
    } catch (error) {
        return res.status(500).json({ error: 'Error al procesar la devolución.' });
    }
});

// DELETE: Eliminar Registro Permanente
app.delete('/api/ventas/:id', exigeAdmin, async (req, res) => {
    try {
        const eliminado = await VentaRopa.findByIdAndDelete(req.params.id);
        if (!eliminado) return res.status(404).json({ error: 'Registro no encontrado.' });
        return res.json({ status: "success" });
    } catch (error) {
        return res.status(500).json({ error: 'Error al eliminar el registro.' });
    }
});

// Cierre de Sesión API
app.get('/api/logout', (req, res) => {
    req.session = null;
    return res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[OK] Servidor API corriendo en puerto: ${PORT}`));