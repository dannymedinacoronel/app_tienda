// 1. IMPORTACIONES (Añade esta línea arriba del todo en tu server.js)
const { exec } = require('child_process'); // 👈 ¡ESTA ES LA LÍNEA QUE FALTA!

// Variable temporal en memoria para almacenar la sesión de raspado actual
let sesionRaspadoTemporal = { nuevos: [], vendidos: [] };

// 2. LA RUTA (Corregida con buenas prácticas de logs para Render)
app.post('/api/ventas/sincronizar-vinted', exigeAdmin, async (req, res) => {
    console.log("⚡ [NÚCLEO] Analizando perfil de Vinted para revisión manual...");
    
    // Ejecutamos el script de Python
    exec('python3 sincronizador_vinted.py', async (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ Error en el script de Python: ${error.message}`);
            // Es vital registrar también el stderr para saber si Python falló por falta de librerías
            if (stderr) console.error(`⚠️ Python Stderr: ${stderr}`);
            return res.status(500).json({ ok: false, error: 'Error en el motor de raspado.' });
        }
        
        try {
            // El script de Python ahora nos devolverá un JSON directo por consola (stdout)
            const datosVinted = JSON.parse(stdout);
            const ventasLocales = await VentaRopa.find().lean();
            
            const diccionarioLocal = {};
            ventasLocales.forEach(v => { diccionarioLocal[v.prenda] = v; });
            
            const nuevos = [];
            const vendidosDetectados = [];
            const titulosActivosVinted = new Set();
            
            // 1. Detectar Nuevos o Cambios de precio
            datosVinted.forEach(item => {
                titulosActivosVinted.add(item.title);
                if (!diccionarioLocal[item.title]) {
                    nuevos.push({
                        sku: `VINTED-${item.id}`,
                        prenda: item.title,
                        precioVenta: parseFloat(item.price),
                        url: item.url,
                        categoria: 'Camisetas',
                        talla: 'M'
                    });
                }
            });
            
            // 2. Detectar prendas que ya no están online (posibles ventas)
            ventasLocales.forEach(local_item => {
                if (local_item.estado === 'No Vendido' && local_item.canalVenta === 'Vinted') {
                    if (!titulosActivosVinted.has(local_item.prenda)) {
                        vendidosDetectados.push(local_item);
                    }
                }
            });
            
            // Guardamos temporalmente en el servidor para cuando confirmes
            sesionRaspadoTemporal = { nuevos, vendidos: vendidosDetectados };
            
            // Respondemos al frontend con los hallazgos para que te los proponga en pantalla
            res.json({
                ok: true,
                propuestas: {
                    nuevos: nuevos,
                    vendidos: vendidosDetectados
                }
            });
            
        } catch (e) {
            console.error("❌ Error procesando el output de Python:", e);
            res.status(500).json({ ok: false, error: 'Error al procesar las propuestas de inventario.' });
        }
    });
});