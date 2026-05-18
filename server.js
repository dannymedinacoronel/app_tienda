// ==========================================
// 1. CARGA DE CONFIGURACIÓN (SIEMPRE LO PRIMERO)
// ==========================================
require('dotenv').config(); 

const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const cookieSession = require('cookie-session');
const path = require('path');
const mongoose = require('mongoose');

// ==========================================
// 2. INICIALIZACIÓN DE SERVICIOS Y CLIENTES
// ==========================================
const app = express();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ==========================================
// 3. CONEXIÓN A BASE DE DATOS (MongoDB Cloud)
// ==========================================
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('\x1b[32m[OK]\x1b[0m Conectado con éxito a MongoDB Atlas'))
    .catch(err => console.error('Error crítico al conectar a MongoDB:', err));

// ==========================================
// 4. MODELO DE DATOS PARA LA TIENDA DE ROPA
// ==========================================
const VentaRopaSchema = new mongoose.Schema({
    fecha: { type: String, default: () => new Date().toISOString().split('T')[0] },
    prenda: { type: String, required: true },
    categoria: { type: String, required: true },
    talla: { type: String, required: true },
    cantidad: { type: Number, required: true },
    precioCompra: { type: Number, required: true },
    precioVenta: { type: Number, required: true }
});
const VentaRopa = mongoose.model('VentaRopa', VentaRopaSchema);

// ==========================================
// 5. CONFIGURACIÓN DE MIDDLEWARES, CORS Y SESIONES
// ==========================================

// Lista blanca oficial de administradores para Seychelles Shop
const ADMIN_WHITELIST = [
    'dannymedinacoronel@gmail.com',
    'juliamugo2001@gmail.com'
];

// Configuración de encriptación de cookies y sesiones
app.use(cookieSession({
    name: 'session-admin',
    keys: [process.env.SESSION_SECRET || 'clave_alternativa_segura_123'],
    maxAge: 12 * 60 * 60 * 1000 // Expira en 12 horas de forma segura
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// CONTROL DE CORS: Enlace vital para que Netlify pueda leer/escribir en Render sin bloqueos
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'https://seychellesshop.com');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Middleware para restringir accesos si no eres administrador
function exigeAdmin(req, res, next) {
    if (req.session && req.session.esAdmin) {
        next();
    } else {
        res.status(403).json({ error: 'Acceso denegado. No eres administrador autorizado.' });
    }
}

// ==========================================
// 6. ENDPOINTS / RUTAS DEL SISTEMA
// ==========================================

// Autenticación con Google OAuth
app.post('/api/auth/google', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token no suministrado.' });

    try {
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const emailUsuario = payload['email'].toLowerCase().trim(); // Limpieza estricta de cadenas

        if (ADMIN_WHITELIST.includes(emailUsuario)) {
            req.session.esAdmin = true;
            req.session.email = emailUsuario;
            return res.json({ status: 'success', usuario: emailUsuario });
        } else {
            return res.status(401).json({ status: 'unauthorized', error: 'Tu correo no está en la lista de administradores.' });
        }
    } catch (error) {
        return res.status(400).json({ error: 'Token inválido o expirado.' });
    }
});

// Obtener métricas financieras de la tienda (Blindado contra bases de datos vacías)
app.get('/api/ventas', exigeAdmin, async (req, res) => {
    try {
        const ventas = await VentaRopa.find().sort({ _id: -1 }); 
        
        // Si no hay ventas en MongoDB, devolvemos ceros limpios en vez de colgar la app
        if (!ventas || ventas.length === 0) {
            return res.json({
                resumen: { ingresos: 0, beneficio: 0, prendasVendidas: 0 },
                ventas: []
            });
        }
        
        // Si hay datos, realizamos los cálculos matemáticos de forma segura
        const totalIngresos = ventas.reduce((sum, v) => sum + (Number(v.precioVenta) * Number(v.cantidad)), 0);
        const totalCostes = ventas.reduce((sum, v) => sum + (Number(v.precioCompra) * Number(v.cantidad)), 0);
        const beneficioNeto = totalIngresos - totalCostes;
        const totalPrendas = ventas.reduce((sum, v) => sum + Number(v.cantidad), 0);

        res.json({
            resumen: {
                ingresos: totalIngresos,
                beneficio: beneficioNeto,
                prendasVendidas: totalPrendas
            },
            ventas: ventas
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al consultar los datos en la nube.' });
    }
});

// Guardar nueva transacción de prenda de ropa en MongoDB
app.post('/api/ventas', exigeAdmin, async (req, res) => {
    const { prenda, categoria, talla, cantidad, precioCompra, precioVenta } = req.body;

    if (!prenda || !categoria || !talla || !cantidad || !precioCompra || !precioVenta) {
        return res.status(400).json({ error: "Todos los campos de la prenda son completamente obligatorios." });
    }

    try {
        const nuevaVenta = new VentaRopa({
            prenda,
            categoria,
            talla,
            cantidad: parseInt(cantidad),
            precioCompra: parseFloat(precioCompra),
            precioVenta: parseFloat(precioVenta)
        });

        await nuevaVenta.save(); 
        res.status(201).json({ status: "success", venta: nuevaVenta });
    } catch (error) {
        res.status(500).json({ error: 'Error interno al intentar guardar el registro.' });
    }
});

// Cierre de sesión seguro modificado para API
app.get('/api/logout', (req, res) => {
    req.session = null;
    res.sendStatus(200); // Devuelve éxito al frontend para que index.html controle la salida
});

// Arranque del servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[OK] Servidor en puerto: ${PORT}`));