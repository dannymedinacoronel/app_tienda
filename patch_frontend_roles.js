const fs = require('fs');

let html = fs.readFileSync('public/index.html', 'utf8');

const oldSecUsuariosHtml = `
    <!-- SECCIÓN USUARIOS -->
    <section id="sec-usuarios" class="hidden mb-6 mt-8 relative z-10 w-full max-w-[1200px] mx-auto opacity-0 transition-opacity duration-300">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div class="glass-panel p-6 rounded-xl border border-white/5 flex flex-col md:col-span-1 min-h-[300px]">
                <h3 class="text-xs font-bold text-blue-400 mb-4 tracking-widest flex items-center"><span class="mr-2">🔑</span> AÑADIR CORREO DE ACCESO</h3>
                <p class="text-[11px] text-white/50 mb-4">Añade correos de Gmail para que tus empleados o socios tengan acceso. Tú, como creador, tienes acceso total por defecto.</p>
                <div class="mt-auto">
                    <input type="email" id="nuevo-usuario-email" placeholder="ejemplo@gmail.com" class="w-full bg-[#12122A] p-3 text-sm text-white rounded-lg border border-white/10 outline-none mb-4" />
                    <button onclick="agregarUsuarioAutorizado()" class="w-full bg-blue-600 hover:bg-blue-500 font-bold p-3 rounded-lg text-sm transition-all shadow-[0_0_15px_rgba(37,99,235,0.4)]">OTORGAR ACCESO</button>
                </div>
            </div>
`;

const newSecUsuariosHtml = `
    <!-- SECCIÓN USUARIOS -->
    <section id="sec-usuarios" class="hidden mb-6 mt-8 relative z-10 w-full max-w-[1200px] mx-auto opacity-0 transition-opacity duration-300">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div class="glass-panel p-6 rounded-xl border border-white/5 flex flex-col md:col-span-1 min-h-[300px]">
                <h3 class="text-xs font-bold text-blue-400 mb-4 tracking-widest flex items-center"><span class="mr-2">🔑</span> AÑADIR EMPLEADO A TIENDA</h3>
                <p class="text-[11px] text-white/50 mb-4">Añade correos de Gmail para que tus empleados tengan acceso a tu tienda. Tú, como creador, tienes acceso total.</p>
                <div class="mt-auto">
                    <input type="email" id="nuevo-usuario-email" placeholder="ejemplo@gmail.com" class="w-full bg-[#12122A] p-3 text-sm text-white rounded-lg border border-white/10 outline-none mb-4" />
                    <select id="nuevo-usuario-rol" class="w-full bg-[#12122A] p-3 text-sm text-white rounded-lg border border-white/10 outline-none mb-4">
                        <option value="Admin">🛠 Admin (Acceso Total)</option>
                        <option value="Manager">📈 Manager (Inventario, Precios y Finanzas)</option>
                        <option value="Editor">📝 Empleado (Gestión de CRM y Ventas)</option>
                        <option value="Lector">👀 Lector (Solo Contabilidad y Vistas)</option>
                    </select>
                    <button onclick="agregarUsuarioAutorizado()" class="w-full bg-blue-600 hover:bg-blue-500 font-bold p-3 rounded-lg text-sm transition-all shadow-[0_0_15px_rgba(37,99,235,0.4)]">OTORGAR ACCESO</button>
                </div>
            </div>
`;

html = html.replace(oldSecUsuariosHtml, newSecUsuariosHtml);

// Header titles mapping
html = html.replace(
    /AÑADIR CORREO DE ACCESO/g,
    'AÑADIR EMPLEADO A TIENDA'
);
html = html.replace(
    /CORREOS AUTORIZADOS/g,
    'EMPLEADOS DE LA TIENDA'
);

const oldListHtml = `
                    <div class="grid grid-cols-12 gap-4 text-[10px] text-white/40 border-b border-white/5 pb-2 px-2 uppercase font-bold tracking-wider">
                        <div class="col-span-6">Email Autorizado</div>
                        <div class="col-span-3 text-center">Última Conexión</div>
                        <div class="col-span-3 text-right">Acciones</div>
                    </div>
`;
const newListHtml = `
                    <div class="grid grid-cols-12 gap-4 text-[10px] text-white/40 border-b border-white/5 pb-2 px-2 uppercase font-bold tracking-wider">
                        <div class="col-span-4">Email Autorizado</div>
                        <div class="col-span-3 text-center">Permisos</div>
                        <div class="col-span-3 text-center">Alta</div>
                        <div class="col-span-2 text-right">Acciones</div>
                    </div>
`;

html = html.replace(oldListHtml, newListHtml);

fs.writeFileSync('public/index.html', html);
console.log('Frontend Sec-Usuarios HTML Patched');
