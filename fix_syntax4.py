import re

with open('public/index.html', 'r') as f:
    content = f.read()

bad_block4 = """            try {
                const res = await fetch(url, { method, headers: {'Content-Type':'application/json'}, credentials: 'include', body: JSON.stringify(payload) });

                    const err = await res.json();
                    alert(err.error || "Error al autorizar.");
                }
            } catch(e) { alert("Fallo de conexión."); }"""

good_block4 = """            try {
                const res = await fetch(url, { method, headers: {'Content-Type':'application/json'}, credentials: 'include', body: JSON.stringify(payload) });
                if (res.ok) {
                    cancelarTarea();
                    await refrescarTareas();
                } else {
                    const err = await res.json();
                    alert(err.error || "Error al guardar tarea.");
                }
            } catch(e) { alert("Error al procesar la tarea."); }"""

if bad_block4 in content:
    content = content.replace(bad_block4, good_block4)
    print("Fixed syntax error 4.")
else:
    print("Could not find the block 4 to replace.")

with open('public/index.html', 'w') as f:
    f.write(content)
