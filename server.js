require('dotenv').config(); 
const express = require('express');
const { OAuth2Client } = require('google-auth-library'); 
const session = require('express-session'); 
const MongoStoreModule = require('connect-mongo'); // Importa el módulo completo
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

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
// --- Modelos de MongoDB ---

const TiendaSchema = new mongoose.Schema({
    nombre: { type: String, required: true, unique: true, trim: true },
    fechaCreacion: { type: Date, default: Date.now }
});
const Tienda = mongoose.models.Tienda || mongoose.model('Tienda', TiendaSchema);

const CategoriaSchema = new mongoose.Schema({
    nombre: { type: String, required: true, unique: true, trim: true }
});
const Categoria = mongoose.models.Categoria || mongoose.model('Categoria', CategoriaSchema);

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
    tienda: { type: mongoose.Schema.Types.ObjectId, ref: 'Tienda', required: true },
    imagen: { type: String, default: '' },
    fechaVenta: { type: String, default: '' }
});
const VentaRopa = mongoose.models.VentaRopa || mongoose.model('VentaRopa', VentaRopaSchema);

const LogAuditoriaSchema = new mongoose.Schema({
    fechaHora: { type: Date, default: Date.now },
    usuario: { type: String, required: true },
    accion: { type: String, required: true }
});
const LogAuditoria = mongoose.models.LogAuditoria || mongoose.model('LogAuditoria', LogAuditoriaSchema);

const NotaSchema = new mongoose.Schema({
    texto: { type: String, default: 'Nueva nota...', trim: true },
    color: { type: String, default: 'bg-yellow-400' },
    x: { type: Number, default: 20 },
    y: { type: Number, default: 40 },
    width: { type: Number, default: 150 },
    height: { type: Number, default: 120 },
    usuario: String,
    fecha: { type: Date, default: Date.now }
});
const Nota = mongoose.models.Nota || mongoose.model('Nota', NotaSchema);

const ADMIN_WHITELIST = (process.env.ADMIN_WHITELIST || 'dannymedinacoronel@gmail.com,juliamugo2001@gmail.com').split(',').map(e => e.trim().toLowerCase());

const MongoStore = MongoStoreModule.default || MongoStoreModule; // Obtiene la clase MongoStore, manejando el 'default' export si existe

mongoose.connect(MONGO_URI_FINAL)
    .then(async () => {
        console.log('\x1b[32m[OK]\x1b[0m Core Estable de Seychelles conectado a MongoDB Atlas.');
        
        // Auto-poblar categorías si la colección está vacía
        const catCount = await Categoria.countDocuments();
        if (catCount === 0) {
            const defaultCats = [
                '👕 Camisetas', '🧥 Sudaderas', '👖 Pantalones', '👗 Vestidos', '👜 Accesorios',
                '🩳 Shorts', '👗 Faldas', '🧥 Chaquetas', '🧥 Abrigos', '👟 Zapatos',
                '👟 Zapatillas', '👙 Ropa Interior', '🩱 Bañadores', '🧢 Gorras', '👒 Sombreros',
                '💍 Joyas', '👛 Bolsos', '👔 Camisas', '👚 Blusas', '👕 Tops', '🩳 Bermudas',
                '👖 Leggings', '🧥 Trajes', '💤 Pijamas', '🧣 Bufandas', '🧤 Guantes',
                '🎗️ Cinturones', '🧦 Calcetines', '⌚ Relojes', '🕶️ Gafas de sol', '👛 Monederos',
                '👕 Polos', '🧥 Chalecos', '🥾 Botas', '👡 Sandalias', '🥋 Albornoces',
                '👔 Corbatas', '🎀 Pajaritas', '🧣 Pañuelos', '🎒 Mochilas', '👜 Bolsos de mano',
                '👖 Vaqueros', '🧥 Rebecas', '👕 Jerséis', '🏃 Ropa Deportiva', '🧘 Leggings Deportivos',
                '🩱 Bikinis', '🧤 Mitones', '👒 Tocados', '👞 Mocasines', '👢 Botines', '🧤 Calentadores',
                '👗 Monos', '👗 Petos', '👘 Kimonos', '🧥 Parkas', '🧥 Gabardinas', '🎿 Ropa de Esquí'
            ];
            try {
                await Categoria.insertMany(defaultCats.map(n => ({ nombre: n })));
                console.log('[INIT] Catálogo maestro de categorías inyectado correctamente.');
            } catch (err) {
                console.error("Error inyectando categorías iniciales:", err);
            }
        }
    })
    .catch(err => console.error('Fallo crítico en Atlas. Verifica tus variables en Render:', err));

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

// --- Rutas de Categorías ---

app.get('/api/categorias', exigeAdmin, async (req, res) => {
    try {
        const categorias = await Categoria.find().sort({ nombre: 1 }).lean();
        res.json({ categorias });
    } catch (e) { res.status(500).json({ error: 'Fallo al recuperar categorías.' }); }
});

app.post('/api/categorias', exigeAdmin, async (req, res) => {
    try {
        const nombreLimpio = req.body.nombre ? req.body.nombre.trim() : "";
        if (!nombreLimpio) return res.status(400).json({ error: 'Nombre requerido.' });
        const nueva = new Categoria({ nombre: nombreLimpio });
        await nueva.save();
        await registrarLog(req.session.email, `Creó nueva categoría: ${nombreLimpio}`);
        res.json({ status: 'success', categoria: nueva });
    } catch (e) { res.status(400).json({ error: 'La categoría ya existe.' }); }
});

app.put('/api/categorias/:id', exigeAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre } = req.body;
        const cat = await Categoria.findByIdAndUpdate(id, { nombre }, { new: true });
        await registrarLog(req.session.email, `Modificó categoría: ${nombre}`);
        res.json(cat);
    } catch (e) { res.status(400).json({ error: 'Error al actualizar categoría.' }); }
});

app.delete('/api/categorias/:id', exigeAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const cat = await Categoria.findById(id);
        if (!cat) return res.status(404).json({ error: 'No existe.' });
        await Categoria.findByIdAndDelete(id);
        await registrarLog(req.session.email, `Eliminó categoría: ${cat.nombre}`);
        res.sendStatus(200);
    } catch (e) { res.status(500).json({ error: 'Error al purgar categoría.' }); }
});

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

// --- Rutas de Notas ---

app.get('/api/notas', exigeAdmin, async (req, res) => {
    try {
        const notas = await Nota.find().lean();
        res.json(notas);
    } catch (e) { res.status(500).json({ error: 'Fallo al recuperar notas.' }); }
});

app.post('/api/notas', exigeAdmin, async (req, res) => {
    try {
        const count = await Nota.countDocuments();
        if (count >= 3) return res.status(400).json({ error: 'Límite de 3 notas alcanzado.' });
        const nuevaNota = new Nota({ ...req.body, usuario: req.session.email });
        await nuevaNota.save();
        res.json(nuevaNota);
    } catch (e) { res.status(500).json({ error: 'Error al crear nota.' }); }
});

app.put('/api/notas/:id', exigeAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const notaActualizada = await Nota.findByIdAndUpdate(id, req.body, { new: true });
        res.json(notaActualizada);
    } catch (e) { res.status(500).json({ error: 'Error al mover nota.' }); }
});

app.delete('/api/notas/:id', exigeAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await Nota.findByIdAndDelete(id);
        res.sendStatus(200);
    } catch (e) { res.status(500).json({ error: 'Error al borrar nota.' }); }
});

// --- Rutas de Ventas / Inventario ---

/**
 * Recupera logs de auditoría para el calendario (filtrado por mes/año)
 */
app.get('/api/logs/calendario', exigeAdmin, async (req, res) => {
    try {
        const { mes, anio } = req.query; // mes: 1-12
        if (!mes || !anio) return res.status(400).json({ error: 'Mes y año requeridos.' });

        const m = parseInt(mes);
        const a = parseInt(anio);
        
        const fechaInicio = new Date(Date.UTC(a, m - 1, 1, 0, 0, 0));
        const fechaFin = new Date(Date.UTC(a, m, 0, 23, 59, 59)); 
        
        const logs = await LogAuditoria.find({
            fechaHora: { $gte: fechaInicio, $lte: fechaFin }
        }).sort({ fechaHora: 1 }).lean();
        
        res.json({ logs });
    } catch (e) { res.status(500).json({ error: 'Fallo al recuperar logs.' }); }
});

app.get('/api/ventas', exigeAdmin, async (req, res) => {
    try {
        const ventasRaw = await VentaRopa.find().populate('tienda').sort({ _id: -1 }).lean();
        const logs = await LogAuditoria.find().sort({ _id: -1 }).limit(50).lean(); 
        
        let ingresos = 0, inversion = 0, prendasVendidas = 0, gastosTotalesEnvio = 0, costeVendidos = 0;
        
        const ventas = ventasRaw.map(v => {
            const proveedorNombre = v.tienda ? v.tienda.nombre : 'Sin definir';
            
            const cant = parseInt(v.cantidad, 10) || 0;
            const pCompra = parseFloat(v.precioCompra) || 0;
            const pVenta = parseFloat(v.precioVenta) || 0;
            const gEnvio = parseFloat(v.gastosEnvio) || 0;

            inversion += (pCompra * cant);
            gastosTotalesEnvio += (gEnvio * cant);

            if (v.estado === 'Vendido' && v.canalVenta) {
                let comisionPlataforma = 0;
                if (v.canalVenta === 'Vinted' || v.canalVenta === 'Wallapop') {
                    comisionPlataforma = (pVenta * 0.05); 
                }
                ingresos += ((pVenta - comisionPlataforma) * cant);
                prendasVendidas += cant;
                costeVendidos += (pCompra * cant);
            }

            return { ...v, proveedor: proveedorNombre };
        });

        const beneficioNeto = ingresos - inversion - gastosTotalesEnvio;
        const roi = inversion > 0 ? (beneficioNeto / (inversion + gastosTotalesEnvio)) * 100 : 0;

        return res.json({ 
            resumen: { ingresos, beneficio: beneficioNeto, inversion: inversion + gastosTotalesEnvio, prendasVendidas, roi }, 
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

        const updateData = { estado };
        if (estado === 'Vendido') {
            updateData.fechaVenta = new Date().toISOString().split('T')[0];
        } else {
            updateData.fechaVenta = '';
        }

        const ventaActualizada = await VentaRopa.findByIdAndUpdate(id, updateData, { new: true });
        await registrarLog(req.session.email, `Transición de estado: [${ventaActualizada.prenda}] -> ${estado.toUpperCase()}`);
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
            if (nuevoEstado === 'Vendido') {
                venta.fechaVenta = new Date().toISOString().split('T')[0];
            } else {
                venta.fechaVenta = '';
            }
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
// --- SISTEMA DE SCRAPING MEJORADO --- //

/**
 * Analiza una URL de Vinted y devuelve una comparativa detallada:
 * 1. Productos existentes con cambios de precio (discrepancias).
 * 2. Productos nuevos encontrados en la web que no están en el sistema.
 */

/**
 * Analiza datos subidos manualmente (ej. desde un Excel de Instant Data Scraper)
 */
app.post('/api/scraper/analizar-manual', exigeAdmin, async (req, res) => {
    try {
        const { productosExtraidos } = req.body;
        console.log(`[SCRAPER MANUAL] Recibidos ${productosExtraidos?.length || 0} productos para comparar.`);
        if (!productosExtraidos || !Array.isArray(productosExtraidos)) {
            return res.status(400).json({ error: 'Datos no válidos.' });
        }

        const resultados = { discrepancias: [], nuevos: [], identicos: [] };
        const productosBD = await VentaRopa.find({ canalVenta: 'Vinted' }).lean();

        productosExtraidos.forEach(item => {
            const titulo = item.titulo || '';
            const precioWeb = parseFloat(item.precio);
            const imagen = item.imagen || '';

            if (titulo && !isNaN(precioWeb)) {
                const coincidencia = productosBD.find(p => 
                    p.prenda.toLowerCase().includes(titulo.toLowerCase()) || 
                    titulo.toLowerCase().includes(p.prenda.toLowerCase())
                );

                if (coincidencia) {
                    if (Math.abs(coincidencia.precioVenta - precioWeb) > 0.01) {
                        resultados.discrepancias.push({
                            idMongo: coincidencia._id, prenda: coincidencia.prenda,
                            valorAntiguo: coincidencia.precioVenta, valorNuevo: precioWeb, imagen
                        });
                    } else {
                        resultados.identicos.push({
                            idMongo: coincidencia._id, prenda: coincidencia.prenda, precio: coincidencia.precioVenta, imagen
                        });
                    }
                } else {
                    resultados.nuevos.push({ prenda: titulo, precioVenta: precioWeb, imagen, canalVenta: 'Vinted', estado: 'No Vendido' });
                }
            }
        });

        res.json(resultados);
    } catch (error) {
        console.error('Error en Scraper Manual:', error);
        res.status(500).json({ error: 'Error al procesar los datos manuales.' });
    }
});

/**
 * Importa productos nuevos seleccionados por el usuario
 */
app.post('/api/scraper/importar', exigeAdmin, async (req, res) => {
    try {
        const { productos } = req.body; // Array de productos seleccionados en el frontend
        if (!productos || !Array.isArray(productos)) return res.status(400).json({ error: 'Datos de productos no válidos.' });

        const tiendaVinted = await Tienda.findOne({ nombre: 'Vinted' }) || await Tienda.findOne({ nombre: 'Sin definir' });
        const tiendaId = tiendaVinted ? tiendaVinted._id : (await new Tienda({ nombre: 'Vinted' }).save())._id;

        const registrosCreados = [];
        for (const prod of productos) {
            const nuevaVenta = new VentaRopa({
                ...prod,
                tienda: tiendaId,
                sku: `VNT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                comentariosProducto: `Importado automáticamente desde Vinted el ${new Date().toLocaleDateString()}`
            });
            await nuevaVenta.save();
            registrosCreados.push(nuevaVenta.prenda);
        }

        await registrarLog(req.session.email, `Importó ${registrosCreados.length} productos desde Vinted: ${registrosCreados.join(', ')}`);
        res.json({ success: true, count: registrosCreados.length });
    } catch (error) {
        console.error('Error en importación:', error);
        res.status(500).json({ error: 'Fallo al guardar los nuevos productos.' });
    }
});

/**
 * Inserción masiva de productos (Para restauración de backups o migraciones)
 */
app.post('/api/ventas/bulk', exigeAdmin, async (req, res) => {
    try {
        const { productos } = req.body;
        if (!productos || !Array.isArray(productos)) return res.status(400).json({ error: 'Lista de productos no válida.' });

        const tiendaDefecto = await Tienda.findOne({ nombre: 'Sin definir' }) || await new Tienda({ nombre: 'Sin definir' }).save();
        
        // Mapeamos los productos para asegurar que tengan IDs de tienda válidos
        const productosProcesados = await Promise.all(productos.map(async (p) => {
            let tiendaId = tiendaDefecto._id;
            if (p.proveedor) {
                const t = await Tienda.findOne({ nombre: p.proveedor });
                if (t) tiendaId = t._id;
            }
            return {
                ...p,
                tienda: tiendaId,
                sku: p.sku || `BK-${Date.now()}-${Math.floor(Math.random() * 1000)}`
            };
        }));

        const insertados = await VentaRopa.insertMany(productosProcesados);
        await registrarLog(req.session.email, `Restauración masiva: Insertados ${insertados.length} productos.`);
        res.json({ success: true, count: insertados.length });
    } catch (error) {
        console.error("Error en bulk insert:", error);
        res.status(500).json({ error: 'Fallo al procesar la inserción masiva.' });
    }
});

/**
 * Aplica cambios de precio a productos existentes
 */
app.post('/api/scraper/aplicar', exigeAdmin, async (req, res) => {
    try {
        const { cambios } = req.body;
        for (const cambio of cambios) {
            await VentaRopa.findByIdAndUpdate(cambio.idMongo, { precioVenta: cambio.valorNuevo });
            await registrarLog(req.session.email, `Sincronización precio: ${cambio.prenda} -> ${cambio.valorNuevo}€`);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar precios.' });
    }
});
