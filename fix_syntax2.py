import re

with open('public/index.html', 'r') as f:
    content = f.read()

bad_block2 = """            try {
                const res = await fetch(`${BACKEND_URL}/api/categorias/${cat._id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ nombre: nuevoNombre.trim() })
                });

                    const errData = await res.json(); alert(errData.error || "Error al inyectar tienda.");
                }
            } catch (err) { alert("Error crítico de comunicación."); }"""

good_block2 = """            try {
                const res = await fetch(`${BACKEND_URL}/api/categorias/${cat._id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ nombre: nuevoNombre.trim() })
                });
                if (res.ok) {
                    await cargarCategorias();
                    alert("Categoría actualizada.");
                } else {
                    const errData = await res.json(); alert(errData.error || "Error al inyectar categoría.");
                }
            } catch (err) { alert("Error crítico de comunicación."); }"""

if bad_block2 in content:
    content = content.replace(bad_block2, good_block2)
    print("Fixed syntax error 2.")
else:
    print("Could not find the block 2 to replace.")

with open('public/index.html', 'w') as f:
    f.write(content)
