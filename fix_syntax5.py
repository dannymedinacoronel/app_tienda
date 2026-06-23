import re

with open('public/index.html', 'r') as f:
    content = f.read()

bad_block5 = """            try {
                const res = await fetch(`${BACKEND_URL}/api/chat`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ mensaje, imagen: imgData })
                });
                const data = await res.json();
                document.getElementById(idTemp).remove();


                                                    alert("IA: No he podido facturar porque el artículo " + acc.params.sku + " no existe o no está marcado como Vendido.");
                                                }
                                            }
                                        }, 200); // Esperar a que la pestaña de facturación se dibuje
                                    }, 100);
                                }
                            });
                        }
                    }
                } else {
                    throw new Error(data.error);
                }
            } catch (err) {"""

good_block5 = """            try {
                const res = await fetch(`${BACKEND_URL}/api/chat`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ mensaje, imagen: imgData })
                });
                const data = await res.json();
                document.getElementById(idTemp).remove();

                if (res.ok) {
                    appendChatMessage("Seychelles Shop AI", data.respuesta, "bot");

                    if (data.acciones && data.acciones.length > 0) {
                        data.acciones.forEach(acc => {
                            if (acc.action === 'navigate_to' && acc.params.section) {
                                window.mostrarSeccion(acc.params.section);
                                appendChatMessage("Sistema", `Navegando a: ${acc.params.section}...`, "bot", true);
                            }
                            if (acc.action === 'buscar_articulo' && acc.params.query) {
                                window.mostrarSeccion('panel');
                                document.getElementById('buscador').value = acc.params.query;
                                window.filtrarTabla();
                            }
                            if (acc.action === 'preparar_factura' && acc.params.sku) {
                                window.mostrarSeccion('facturas');
                                setTimeout(() => {
                                    window.abrirModalNuevaFactura();
                                    setTimeout(() => {
                                        const selectArticulos = document.getElementById('factura-articulo');
                                        if (selectArticulos) {
                                            const options = Array.from(selectArticulos.options);
                                            const match = options.find(o => o.text.includes(acc.params.sku));
                                            if (match) {
                                                selectArticulos.value = match.value;
                                                window.seleccionarArticuloFactura();
                                            } else {
                                                alert("IA: No he podido facturar porque el artículo " + acc.params.sku + " no existe o no está marcado como Vendido.");
                                            }
                                        }
                                    }, 200); // Esperar a que la pestaña de facturación se dibuje
                                }, 100);
                            }
                        });
                    }
                } else {
                    throw new Error(data.error || "Error de la API.");
                }
            } catch (err) {"""

if bad_block5 in content:
    content = content.replace(bad_block5, good_block5)
    print("Fixed syntax error 5.")
else:
    print("Could not find the block 5 to replace.")

with open('public/index.html', 'w') as f:
    f.write(content)
