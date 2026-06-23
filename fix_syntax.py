import re

with open('public/index.html', 'r') as f:
    content = f.read()

# Let's find the exact block and replace it
bad_block = """            try {
                const res = await fetch(`${BACKEND_URL}/api/categorias`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ nombre: nombre.trim() })
                });

                    const err = await res.json(); alert(err.error || "Error al crear categoría.");
                }
            } catch(e) { alert("Fallo de conexión."); }"""

good_block = """            try {
                const res = await fetch(`${BACKEND_URL}/api/categorias`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ nombre: nombre.trim() })
                });
                if (res.ok) {
                    await cargarCategorias();
                    alert("Categoría creada.");
                } else {
                    const err = await res.json(); alert(err.error || "Error al crear categoría.");
                }
            } catch(e) { alert("Fallo de conexión."); }"""

if bad_block in content:
    content = content.replace(bad_block, good_block)
    print("Fixed syntax error.")
else:
    print("Could not find the block to replace. Here's what's there:")
    lines = content.split('\n')
    for i, line in enumerate(lines):
        if "api/categorias" in line and "POST" in content.split('\n')[i+1]:
            print("\n".join(lines[i-2:i+12]))

with open('public/index.html', 'w') as f:
    f.write(content)
