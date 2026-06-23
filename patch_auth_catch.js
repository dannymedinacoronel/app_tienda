const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

const badCatch = `    } catch (e) {
        console.error("Error obteniendo dbStats:", e);
        res.status(500).json({ error: 'Fallo al recuperar estadísticas de DB.' });
    }
});

// --- Rutas de Gestión de Usuarios ---`;

const goodCatch = `    } catch (e) {
        console.error("Error en login Google:", e);
        res.status(500).json({ error: 'Error interno de autenticación' });
    }
});

// --- Rutas de Gestión de Usuarios ---`;

code = code.replace(badCatch, goodCatch);
fs.writeFileSync('server.js', code);
console.log('Catch patched');
