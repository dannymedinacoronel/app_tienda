require('dotenv').config(); 
const express = require('express');
const { OAuth2Client } = require('google-auth-library'); 
const session = require('express-session'); 
const MongoStore = require('connect-mongo'); 
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ⚙️ CONFIGURACIÓN DE ENTORNO
const isProd = process.env.NODE_ENV === 'production';
console.log(`[INIT] Modo: ${isProd ? 'PROD' : 'DEV'}`);

// Es vital para que las sesiones funcionen en plataformas como Render/Heroku
app.set('trust proxy', 1);
app.use(express.json());

// 🔒 CONEXIÓN DEPURADA: Purgadas las credenciales del código fuente
const MONGO_URI_FINAL = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!MONGO_URI_FINAL) {
    console.error('\x1b[31m[ERROR]\x1b[0m No se detectó la variable MONGODB_URI en el entorno.');
}

mongoose.connect(MONGO_URI_FINAL)
    .then(() => console.log('\x1b[32m[OK]\x1b[0m Core Estable de Seychelles conectado a MongoDB Atlas.'))
    .catch(err => console.error('Fallo crítico en Atlas. Verifica tus variables en Render:', err));

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

const ADMIN_WHITELIST = (process.env.ADMIN_WHITELIST || 'dannymedinacoronel@gmail.com,juliamugo2001@gmail.com').split(',').map(e => e.trim().toLowerCase());

app.use(session({
    name: 'seychelles.sid', // Nombre único para evitar conflictos
    secret: process.env.SESSION_SECRET || 'clave_maestra_seychelles_987654321',
    resave: false, 
    saveUninitialized: false, 
    store: MongoStore.create({ mongoUrl: MONGO_URI_FINAL, collectionName: 'sesiones_activas', ttl: 14 * 24 * 60 * 60 }),
    cookie: { 
        secure: isProd, // True solo en HTTPS
        sameSite: 'lax', // 'lax' es más compatible para apps que sirven su propio frontend
        maxAge: 14 * 24 * 60 * 60 * 1000 
    }
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

// BAJA SEGURA DE TIENDA CON REASIGNACIÓN EN CASCADA
app.delete('/api/tiendas/:id', exigeAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        let tiendaDefecto = await Tienda.findOne({ nombre: 'Sin definir' });
        if (!tiendaDefecto) {
            tiendaDefecto = new Tienda({ nombre: 'Sin definir' });
            await tiendaDefecto.save();
        }

        if (id === tiendaDefecto._id.toString()) {
            return res.status(400).json({ error: 'No se permite la remoción de la tienda base del sistema.' });
        }

        const tiendaPorBorrar = await Tienda.findById(id);
        if (!tiendaPorBorrar) return res.status(404).json({ error: 'La tienda no existe.' });

        await VentaRopa.updateMany({ tienda: id }, { tienda: tiendaDefecto._id });
        await Tienda.findByIdAndDelete(id);

        await registrarLog(req.session.email, `Eliminó la tienda "${tiendaPorBorrar.nombre}". Productos reasignados a "Sin definir"`);
        return res.sendStatus(200);
    } catch (err) {
        console.error("Error al borrar tienda:", err);
        return res.status(500).json({ error: 'Fallo crítico al purgar la tienda.' });
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
        if (!token) return res.status(400).json({ error: 'Token no proporcionado.' });

        const ticket = await client.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();
        const emailUsuario = payload['email'].toLowerCase().trim();

        if (ADMIN_WHITELIST.includes(emailUsuario)) {
            req.session.esAdmin = true;
            req.session.email = emailUsuario;
            await registrarLog(emailUsuario, "Inició sesión en el sistema core");
            
            // Forzar el guardado de la sesión antes de responder al cliente
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

            return { ...v, proveedor: proveedorNombre };
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
            tiendaDoc = await Tienda.findOne({ nombre: 'Sin definir' }) || await new Tienda({ nombre: 'Sin definir' }).save();
        }

        const nuevaVenta = new VentaRopa({ ...datosVenta, tienda: tiendaDoc._id });
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


//SCRIPT DE SCRAPING

// --- SISTEMA DE SCRAPING WEB --- //

// 1. Analizar cuenta, hacer el scrape y devolver comparativa
app.post('/api/scraper/analizar', exigeAdmin, async (req, res) => {
    try {
        const { url } = req.body;
        
        // AQUI VA LA LÓGICA DE TU SCRAPER EXTERNO (Puppeteer, Cheerio, o llamada a Python).
        // Una vez obtenida la data extraída de la web, se compara con MongoDB:
        const discrepancias = [];

        // EJEMPLO/MOCK: Simulando que el scraper comparó datos y detectó cambios
        // (Deberás reemplazar esta parte con el array generado por tu script de extracción)
        const productosVinted = await VentaRopa.find({ canalVenta: 'Vinted' }).limit(2);
        
        if (productosVinted.length > 0) {
            // Ejemplo 1: Detectar que cambió el precio
            discrepancias.push({
                idMongo: productosVinted[0]._id,
                sku: productosVinted[0].sku,
                prenda: productosVinted[0].prenda,
                campoModificado: 'precioVenta',
                valorAntiguo: productosVinted[0].precioVenta,
                valorNuevo: productosVinted[0].precioVenta + 5 
            });
            
            // Ejemplo 2: Detectar que ya no está disponible (cambio de estado)
            if (productosVinted.length > 1) {
                discrepancias.push({
                    idMongo: productosVinted[1]._id,
                    sku: productosVinted[1].sku,
                    prenda: productosVinted[1].prenda,
                    campoModificado: 'estado',
                    valorAntiguo: productosVinted[1].estado,
                    valorNuevo: 'Vendido' 
                });
            }
        }

        res.json(discrepancias);
    } catch (error) {
        console.error('Error en ejecución de Scraper:', error);
        res.status(500).json({ error: 'Fallo al realizar el web scraping' });
    }
});

// 2. Ejecutar directamente las modificaciones autorizadas
app.post('/api/scraper/aplicar', exigeAdmin, async (req, res) => {
    try {
        const { cambios } = req.body;
        
        for (const cambio of cambios) {
            // Preparamos el objeto de actualización dinámico
            const updatePayload = {};
            updatePayload[cambio.campoModificado] = cambio.valorNuevo;
            
            // Actualizar producto en la BBDD
            await VentaRopa.findByIdAndUpdate(cambio.idMongo, updatePayload);
            
            // Registrar acción en la Auditoría si la tienes habilitada
            if (typeof registrarLog === "function") {
                await registrarLog(
                    req.session.email || 'Admin', 
                    `Scraper Autoupdate: ${cambio.prenda} | ${cambio.campoModificado} -> ${cambio.valorNuevo}`
                );
            }
        }

        res.json({ success: true, message: 'Cambios sincronizados correctamente' });
    } catch (error) {
        console.error('Error aplicando updates del scraper:', error);
        res.status(500).json({ error: 'Fallo al actualizar en MongoDB' });
    }
});
