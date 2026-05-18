// ==========================================
// 1. CARGA DE CONFIGURACIÓN Y MÓDULOS
// ==========================================
require('dotenv').config(); 
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const cookieSession = require('cookie-session');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Conexión limpia y segura a MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('\x1b[32m[OK]\x1b[0m Conectado con éxito a MongoDB Atlas'))
    .catch(err => console.error('Error crítico al conectar a MongoDB:', err));

// ==========================================
// 2. ESQUEMA DE DATOS (Seychelles Shop)
// ==========================================
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

// Whitelist de acceso
const ADMIN_WHITELIST = [
    'dannymedinacoronel@gmail.com',
    'juliamugo2001@gmail.com'
];

// ==========================================
// 3. MIDDLEWARES Y ARCHIVOS ESTÁTICOS
// ==========================================
app.use(express.json());

app.use(cookieSession({
    name: 'session-admin',
    keys: [process.env.SESSION_SECRET || 'clave_alternativa_segura_123'],
    maxAge: 12 * 60 * 60 * 1000 // 12 horas de sesión activa
}));

// Servir la carpeta public donde tienes el index.html
app.use(express.static(path.join(__dirname, 'public')));

// Guardián de seguridad
function exigeAdmin(req, res, next) {
    if (req.session && req.session.esAdmin) return next();
    return res.status(403).json({ error: 'Acceso denegado. No autorizado.' });
}

// ==========================================
// 4. ENDPOINTS DE LA API (RUTAS COMPLETAS)
// ==========================================

// Login con Google OAuth
app.post('/api/auth/google', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token no suministrado.' });
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
        return res.status(401).json({ error: 'Tu correo no está autorizado.' });
    } catch (error) { 
        return res.status(400).json({ error: 'Token inválido o expirado.' }); 
    }
});

// GET: Obtener stock y calcular métricas consolidadas
app.get('/api/ventas', exigeAdmin, async (req, res) => {
    try {
        const ventas = await VentaRopa.find().sort({ _id: -1 }).lean();
        let ingresos = 0, inversion = 0, prendasVendidas = 0;

        ventas.forEach(v => {
            const estadoActual = v.estado || 'Vendido';
            const cant = Number(v.cantidad) || 0;
            const pCompra = Number(v.precioCompra) || 0;
            const pVenta = Number(v.precioVenta) || 0;

            if (estadoActual === 'Vendido') {
                ingresos += (pVenta * cant);
                inversion += (pCompra * cant);
                prendasVendidas += cant;
            } else if (estadoActual === 'Devuelto') {
                inversion += (pCompra * cant);
            }
        });
        return res.json({ resumen: { ingresos, beneficio: ingresos - inversion, inversion, prendasVendidas }, ventas });
    } catch (error) { 
        return res.status(500).json({ error: 'Error al consultar la base de datos.' }); 
    }
});

// POST: Registrar nuevo artículo
app.post('/api/ventas', exigeAdmin, async (req, res) => {
    try {
        const { prenda, categoria, talla, cantidad, precioCompra, precioVenta } = req.body;
        const nuevaVenta = new VentaRopa({
            prenda, categoria, talla,
            cantidad: parseInt(cantidad, 10),
            precioCompra: parseFloat(precioCompra),
            precioVenta: parseFloat(precioVenta),
            estado: 'Vendido'
        });
        await nuevaVenta.save(); 
        return res.status(201).json({ status: "success", venta: nuevaVenta });
    } catch (error) { 
        return res.status(500).json({ error: 'Error al guardar el registro.' }); 
    }
});

// PUT: Procesar Devolución
app.put('/api/ventas/:id/devolucion', exigeAdmin, async (req, res) => {
    try {
        const articulo = await VentaRopa.findByIdAndUpdate(req.params.id, { estado: 'Devuelto' }, { new: true });
        if (!articulo) return res.status(404).json({ error: 'Artículo no encontrado.' });
        return res.json({ status: "success" });
    } catch (error) { 
        return res.status(500).json({ error: 'Error en la devolución.' }); 
    }
});

// DELETE: Eliminar registro físico
app.delete('/api/ventas/:id', exigeAdmin, async (req, res) => {
    try {
        const eliminado = await VentaRopa.findByIdAndDelete(req.params.id);
        if (!eliminado) return res.status(404).json({ error: 'Registro no encontrado.' });
        return res.json({ status: "success" });
    } catch (error) { 
        return res.status(500).json({ error: 'Error al eliminar.' }); 
    }
});

// Cierre de sesión seguro
app.get('/api/logout', (req, res) => {
    req.session = null;
    return res.sendStatus(200);
});

// CAPTURA GLOBAL: Si entran a la raíz o refrescan, sirve el archivo visual index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ARRANQUE DINÁMICO: Render necesita leer su puerto inyectado, si no, usa el 3000 en local
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[OK] Servidor activo en el puerto: ${PORT}`));