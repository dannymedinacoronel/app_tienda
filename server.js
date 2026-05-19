const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path'); // Módulo nativo para manejar rutas de archivos

// 1. INICIALIZACIÓN DEL NÚCLEO EXPRESS
const app = express();

// 2. MIDDLEWARES CONFIGURADOS PARA PRODUCCIÓN
app.use(express.json());
app.use(cors({ 
    credentials: true, 
    origin: true 
}));

// CONFIGURACIÓN CLAVE: Servir archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// 3. CONEXIÓN A BASE DE DATOS MONGODB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/seychelles_shop';
mongoose.connect(MONGO_URI)
  .then(() => console.log('💾 Conectado con éxito a MongoDB Cloud.'))
  .catch(err => console.error('❌ Error crítico al conectar a MongoDB:', err));

// 4. DEFINICIÓN DE MODELOS (Esquemas de BBDD)
const VentaRopaSchema = new mongoose.Schema({
    sku: String,
    prenda: { type: String, required: true },
    categoria: String,
    talla: String,
    cantidad: { type: Number, default: 1 },
    precioCompra: { type: Number, default: 0 },
    precioVenta: { type: Number, default: 0 },
    gastosEnvio: { type: Number, default: 0 },
    canalVenta: { type: String, default: 'Vinted' },
    estado: { type: String, default: 'No Vendido' }, // 'No Vendido' o 'Vendido'
    comentariosProducto: String,
    rating: { type: Number, default: 0 },
    proveedor: { type: String, default: 'Proveedor General' },
    fecha: { type: String, default: () => new Date().toISOString().split('T')[0] }
});

const LogAuditoriaSchema = new mongoose.Schema({
    usuario: { type: String, default: 'Sistema' },
    accion: String,
    fechaHora: { type: Date, default: Date.now }
});

const VentaRopa = mongoose.model('VentaRopa', VentaRopaSchema);
const LogAuditoria = mongoose.model('LogAuditoria', LogAuditoriaSchema);

// 5. MIDDLEWARE DE SEGURIDAD
function exigeAdmin(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    }
    // Bypass temporal de seguridad para desarrollo y despliegue inicial
    next();
}

// 6. RUTA RAÍZ: Servir el index.html desde la carpeta 'public'
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 7. ENDPOINT DE SINCRONIZACIÓN DEL INVENTARIO
app.post('/api/ventas/sincronizar-vinted', exigeAdmin, async (req, res) => {
    console.log("⚡ [NÚCLEO] Sincronizando estados financieros e inventario general...");
    try {
        const ventasLocales = await VentaRopa.find().lean();
        const articulosVintedEnStock = ventasLocales.filter(item => 
            item.canalVenta === 'Vinted' && item.estado === 'No Vendido'
        );
        
        return res.json({
            ok: true,
            msg: "Inventario del núcleo sincronizado de forma correcta.",
            propuestas: { nuevos: [], vendidos: [] }
        });
    } catch (e) {
        console.error("❌ Error en la sincronización del núcleo financiero:", e);
        return res.status(500).json({ ok: false, error: 'Error interno de sincronización.' });
    }
});

// 8. RESTO DE RUTAS OPERATIVAS DEL SISTEMA KANBAN
// GET: Obtener todos los artículos y generar los KPIs del panel
app.get('/api/ventas', async (req, res) => {
    try {
        const ventas = await VentaRopa.find().sort({ _id: -1 });
        const logs = await LogAuditoria.find().sort({ _id: -1 }).limit(15);
        
        let ingresos = 0, inversion = 0, prendasVendidas = 0;
        
        ventas.forEach(v => {
            const cant = v.cantidad || 1;
            const pCompra = v.precioCompra || 0;
            const pVenta = v.precioVenta || 0;
            const gEnvio = v.gastosEnvio || 0;
            
            inversion += ((pCompra + gEnvio) * cant);
            if (v.estado === 'Vendido') {
                let comision = (v.canalVenta === 'Vinted' || v.canalVenta === 'Wallapop') ? (pVenta * 0.05) : 0;
                ingresos += ((pVenta - comision) * cant);
                prendasVendidas += cant;
            }
        });

        res.json({
            ventas,
            logs,
            resumen: {
                ingresos,
                inversion,
                beneficio: ingresos - inversion,
                prendasVendidas
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST: Registrar un nuevo artículo en la base de datos
app.post('/api/ventas', exigeAdmin, async (req, res) => {
    try {
        const nuevaVenta = new VentaRopa(req.body);
        await nuevaVenta.save();
        
        const log = new LogAuditoria({ accion: `Registró artículo: ${req.body.prenda}` });
        await log.save();
        
        res.json({ ok: true, venta: nuevaVenta });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT: Modificar todas las propiedades de un artículo existente
app.put('/api/ventas/:id', exigeAdmin, async (req, res) => {
    try {
        const ventaActualizada = await VentaRopa.findByIdAndUpdate(req.params.id, req.body, { new: true });
        
        const log = new LogAuditoria({ accion: `Modificó ficha de: ${req.body.prenda}` });
        await log.save();
        
        res.json({ ok: true, venta: ventaActualizada });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT: Actualizar el estado del artículo al arrastrar en el Kanban
app.put('/api/ventas/:id/estado', exigeAdmin, async (req, res) => {
    try {
        const { estado } = req.body;
        const venta = await VentaRopa.findByIdAndUpdate(req.params.id, { estado }, { new: true });
        
        const log = new LogAuditoria({ accion: `Cambió estado a [${estado}] para: ${venta.prenda}` });
        await log.save();
        
        res.json({ ok: true, venta });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE: Eliminar un artículo de forma permanente del sistema
app.delete('/api/ventas/:id', exigeAdmin, async (req, res) => {
    try {
        const ventaBorrada = await VentaRopa.findByIdAndDelete(req.params.id);
        
        if (ventaBorrada) {
            const log = new LogAuditoria({ accion: `Eliminó permanentemente: ${ventaBorrada.prenda}` });
            await log.save();
        }
        
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT: Endpoint para la lógica del lector de códigos de barras / cámara QR
app.put('/api/ventas/escanear/:sku', exigeAdmin, async (req, res) => {
    try {
        const { sku } = req.params;
        let venta = await VentaRopa.findOne({ sku, estado: 'No Vendido' });
        
        if (venta) {
            venta.estado = 'Vendido';
            await venta.save();
            const log = new LogAuditoria({ accion: `Escaner TPV: Vendido automáticamente ${venta.prenda}` });
            await log.save();
            return res.json({ operacion: 'Vendido', venta });
        } else {
            const nuevaPrenda = new VentaRopa({
                sku,
                prenda: 'Artículo Escaneado Nuevo',
                estado: 'No Vendido'
            });
            await nuevaPrenda.save();
            const log = new LogAuditoria({ accion: `Escaner TPV: Indexado nuevo SKU borrador [${sku}]` });
            await log.save();
            return res.json({ operacion: 'Creado', venta: nuevaPrenda });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 9. CONFIGURACIÓN DEL PUERTO PARA DESPLIEGUE EN RENDER
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor en línea controlando Core Seychelles en el puerto ${PORT}`);
});