import re

with open('public/index.html', 'r') as f:
    content = f.read()

bad_block3 = """                try {
                    const res = await fetch(`${BACKEND_URL}/api/tiendas/${tiendaObjeto._id}`, {
                        method: 'DELETE',
                        credentials: 'include'
                    });

                        alert("No se pudo eliminar el elemento.");
                    }
                } catch(e) { alert("Error al procesar la baja."); }"""

good_block3 = """                try {
                    const res = await fetch(`${BACKEND_URL}/api/tiendas/${tiendaObjeto._id}`, {
                        method: 'DELETE',
                        credentials: 'include'
                    });
                    if (res.ok) {
                        await cargarTiendas();
                        alert("Tienda eliminada.");
                    } else {
                        alert("No se pudo eliminar el elemento.");
                    }
                } catch(e) { alert("Error al procesar la baja."); }"""

if bad_block3 in content:
    content = content.replace(bad_block3, good_block3)
    print("Fixed syntax error 3.")
else:
    print("Could not find the block 3 to replace.")

with open('public/index.html', 'w') as f:
    f.write(content)
