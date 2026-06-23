import re

with open('public/index.html', 'r') as f:
    content = f.read()

bad_block6 = """                try {
                    const json = JSON.parse(e.target.result);
                    if (confirm(`¿Importar ${json.length} productos del backup? Esto añadirá los productos a tu base de datos actual.`)) {
                        const res = await fetch(`${BACKEND_URL}/api/ventas/bulk`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                            body: JSON.stringify({ productos: json })
                        });
         if(bBadge) bBadge.classList.add('hidden'); bCards.forEach(card => card.classList.remove('combo-fire-active')); }
        }"""

good_block6 = """                try {
                    const json = JSON.parse(e.target.result);
                    if (confirm(`¿Importar ${json.length} productos del backup? Esto añadirá los productos a tu base de datos actual.`)) {
                        const res = await fetch(`${BACKEND_URL}/api/ventas/bulk`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                            body: JSON.stringify({ productos: json })
                        });
                        if(res.ok) {
                            alert("Importación exitosa.");
                            await cargarDatosIniciales();
                        } else {
                            alert("Fallo al importar.");
                        }
                    }
                } catch(err) {
                    alert("Error parseando el archivo JSON de backup.");
                }
            };
            reader.readAsText(file);
        }

        function checkComboFire() {
            const now = Date.now();
            if (now - COMBO_LAST_TIME < COMBO_WINDOW_MS) { COMBO_COUNT++; COMBO_LAST_TIME = now; } else { COMBO_COUNT = 1; COMBO_LAST_TIME = now; }
            const bBadge = document.getElementById('combo-badge'); const bCards = document.querySelectorAll('.card-bg');
            if (COMBO_COUNT >= 3) { cantarPorVoz("Racha de ventas activa!"); if(bBadge) bBadge.classList.remove('hidden'); bCards.forEach(card => card.classList.add('combo-fire-active')); }
            else { if(bBadge) bBadge.classList.add('hidden'); bCards.forEach(card => card.classList.remove('combo-fire-active')); }
        }"""

if bad_block6 in content:
    content = content.replace(bad_block6, good_block6)
    print("Fixed syntax error 6.")
else:
    print("Could not find the block 6 to replace.")

with open('public/index.html', 'w') as f:
    f.write(content)
