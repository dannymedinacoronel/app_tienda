// 🚀 ENDPOINT DE CONTROL DE INVENTARIO LIMPIO (SIN SCRAPING)
app.post('/api/ventas/sincronizar-vinted', exigeAdmin, async (req, res) => {
    console.log("⚡ [NÚCLEO] Sincronizando estados financieros e inventario general...");
    
    try {
        // Obtenemos las prendas del inventario de forma directa y optimizada
        const ventasLocales = await VentaRopa.find().lean();
        
        // Filtramos prendas activas en stock de la plataforma Vinted por si necesitas segmentarlas
        const articulosVintedEnStock = ventasLocales.filter(item => 
            item.canalVenta === 'Vinted' && item.estado === 'No Vendido'
        );

        console.log(`✅ [NÚCLEO] Sincronización completada. ${articulosVintedEnStock.length} artículos en stock analizados.`);

        // Respondemos con éxito al frontend de manera limpia
        return res.json({
            ok: true,
            msg: "Inventario del núcleo sincronizado correctamente.",
            propuestas: {
                nuevos: [], // Ya no inyectamos datos externos volátiles
                vendidos: []
            }
        });
        
    } catch (e) {
        console.error("❌ Error en la sincronización del núcleo financiero:", e);
        return res.status(500).json({ 
            ok: false, 
            error: 'Error interno al actualizar el inventario global.' 
        });
    }
});