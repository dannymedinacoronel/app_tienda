import re

with open('public/index.html', 'r') as f:
    content = f.read()

# Quitar la seccion de "Perfil del Negocio" duplicada dentro de sec-usuarios
dupe_profile = """                <div class="card-bg border p-6 rounded-3xl shadow-xl lg:col-span-3 mb-6">
                    <h3 class="text-xs font-black text-blue-400 uppercase tracking-widest flex items-center gap-2 mb-4">🏢 Perfil del Negocio</h3>
                    <form onsubmit="actualizarAjustesNegocio(event)" class="flex flex-col sm:flex-row gap-4 items-end">
                        <div class="flex-1 w-full">
                            <label class="block text-[9px] font-bold uppercase opacity-60 mb-1">Nombre</label>
                            <input type="text" id="ajustes-negocio-nombre" class="input-bg w-full rounded-xl px-3 py-2 text-xs font-bold" required>
                        </div>
                        <div class="flex-1 w-full">
                            <label class="block text-[9px] font-bold uppercase opacity-60 mb-1">Tipo de Industria</label>
                            <select id="ajustes-negocio-tipo" class="input-bg w-full rounded-xl px-3 py-2 text-xs dropdown-bg">
                                <option value="General">🏢 General / Otros</option>
                                <option value="Ropa">👗 Tienda de Ropa</option>
                                <option value="Peluquería">✂️ Peluquería / Barbería</option>
                                <option value="Joyería">💍 Joyería / Relojería</option>
                                <option value="Tecnología">💻 Tecnología / Móviles</option>
                            </select>
                        </div>
                        <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-xl text-xs uppercase shadow-md w-full sm:w-auto h-9">Guardar</button>
                    </form>
                </div>"""

if dupe_profile in content:
    content = content.replace(dupe_profile, "")
    print("Removed duplicate profile section.")

# Mejorar el texto en la seccion de añadir usuarios
old_auth_title = "🔑 Autorizar Nueva Cuenta"
new_auth_title = "🔑 Añadir Empleado a Tienda"
content = content.replace(old_auth_title, new_auth_title)

old_auth_desc = "<p class=\"text-[10px] opacity-60\">Solo los emails de Gmail añadidos aquí podrán saltar la pantalla de login.</p>"
new_auth_desc = "<p class=\"text-[10px] opacity-60\">Añade correos de Gmail para que tus empleados tengan acceso a tu tienda. Tú, como creador, tienes acceso total.</p>"
content = content.replace(old_auth_desc, new_auth_desc)

old_auth_roles = """<option value="Admin">👑 Administrador (Control Total)</option>
                                <option value="Editor" selected>📝 Editor (Gestión de Tienda)</option>
                                <option value="Lector">👀 Lector (Solo Ver Cifras)</option>"""
new_auth_roles = """<option value="Admin">👑 Manager (Gestión de Personal y Tienda)</option>
                                <option value="Editor" selected>📝 Empleado (Gestión de CRM y Ventas)</option>
                                <option value="Lector">👀 Contable (Solo ver cifras y analíticas)</option>"""
content = content.replace(old_auth_roles, new_auth_roles)

old_list_title = "👥 Cuentas con Acceso al Core"
new_list_title = "👥 Empleados de la Tienda"
content = content.replace(old_list_title, new_list_title)

with open('public/index.html', 'w') as f:
    f.write(content)

print("public/index.html updated")
