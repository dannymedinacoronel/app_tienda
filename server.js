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

// --- Modelos de MongoDB ---

const TiendaSchema = new mongoose.Schema({
    nombre: { type: String, required: true, unique: true, trim: true },
    fechaCreacion: { type: Date, default: Date.now }
});
const Tienda = mongoose.models.Tienda || mongoose.model('Tienda', TiendaSchema);

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
    comentariosProducto: { type: String, default: '', trim: true },
    tienda: { type: mongoose.Schema.Types.ObjectId, ref: 'Tienda', required: true }
});
const VentaRopa = mongoose.models.VentaRopa || mongoose.model('VentaRopa', VentaRopaSchema);

const LogAuditoriaSchema = new mongoose.Schema({
    fechaHora: { type: Date, default: Date.now },
    usuario: { type: String, required: true },
    accion: { type: String, required: true }
});
const LogAuditoria = mongoose.models.LogAuditoria || mongoose.model('LogAuditoria', LogAuditoriaSchema);

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

// --- Rutas de Ventas / Inventario ---

app.get('/api/ventas', exigeAdmin, async (req, res) => {
    try {
        const ventasRaw = await VentaRopa.find().populate('tienda').sort({ _id: -1 }).lean();
        const logs = await LogAuditoria.find().sort({ _id: -1 }).limit(50).lean(); 
        
        let ingresos = 0, inversion = 0, prendasVendidas = 0, gastosTotalesEnvio = 0;
        
        const ventas = ventasRaw.map(v => {
            const proveedorNombre = v.tienda ? v.tienda.nombre : 'Sin definir';
            
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

            return {
                ...v,
                proveedor: proveedorNombre 
            };
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
        const { proveedor, ...datosVenta } = req.body;
        
        let tiendaDoc = await Tienda.findOne({ nombre: proveedor });
        if (!tiendaDoc) {
            tiendaDoc = await Tienda.findOne({ nombre: 'Sin definir' });
            if (!tiendaDoc) {
                tiendaDoc = new Tienda({ nombre: 'Sin definir' });
                await tiendaDoc.save();
            }
        }

        const nuevaVenta = new VentaRopa({ 
            ...datosVenta, 
            tienda: tiendaDoc._id 
        });
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

        let tiendaDoc = await Tienda.findOne({ nombre: proveedor });
        if (!tiendaDoc) {
            tiendaDoc = await Tienda.findOne({ nombre: 'Sin definir' }) || new Tienda({ nombre: 'Sin definir' });
            if (!tiendaDoc._id) await tiendaDoc.save();
        }

        const ventaActualizada = await VentaRopa.findByIdAndUpdate(
            id, 
            { ...datosVenta, tienda: tiendaDoc._id }, 
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

        const ventaActualizada = await VentaRopa.findByIdAndUpdate(id, { estado }, { new: true });
        await registrarLog(req.session.email, `Cambió estado de la prenda [${ventaActualizada.prenda}] a: ${estado}`);
        return res.json({ status: "success", venta: ventaActualizada });
    } catch (error) {
        return res.status(500).json({ error: 'Error en la actualización de la columna Kanban.' });
    }
});

app.put('/api/ventas/escanear/:sku', exigeAdmin, async (req, res) => {
    try {
        const { sku } = req.params;
        let venta = await VentaRopa.findOne({ sku: sku });

        if (!venta) {
            const tiendaDefecto = await Tienda.findOne({ nombre: 'Sin definir' }) || await new Tienda({ nombre: 'Sin definir' }).save();
            venta = new VentaRopa({
                sku: sku,
                prenda: 'Artículo Escaneado Nuevo',
                estado: 'No Vendido',
                tienda: tiendaDefecto._id
            });
            await venta.save();
            return res.json({ operacion: "Creado", venta });
        } else {
            const nuevoEstado = venta.estado === 'Vendido' ? 'No Vendido' : 'Vendido';
            venta.estado = nuevoEstado;
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

app.get('/api/logout', (req, res) => { req.session.destroy(() => res.sendStatus(200)); });
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[SERVER] Seychelles Core Activo en puerto: ${PORT}`));
