const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

const oldRenderUsuarios = `
        async function cargarUsuariosAutorizados() {
            try {
                const res = await fetch(\`\${BACKEND_URL}/api/usuarios\`);
                const usuarios = await res.json();
                const lista = document.getElementById('lista-usuarios');
                lista.innerHTML = usuarios.map(u => \`
                    <div class="grid grid-cols-12 gap-4 items-center p-3 hover:bg-white/5 rounded border-b border-white/5 transition-colors group">
                        <div class="col-span-6 text-xs text-white truncate"><span class="mr-2 text-blue-400">@</span>\${u.email}</div>
                        <div class="col-span-3 text-[10px] text-white/40 text-center">\${u.ultimoLogin || 'Nunca'}</div>
                        <div class="col-span-3 text-right">
                            <button onclick="eliminarUsuarioAdmin('\${u._id}')" class="text-red-500 hover:text-red-400 p-1.5 hover:bg-red-500/10 rounded transition-colors opacity-0 group-hover:opacity-100" title="Revocar Acceso">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    </div>
                \`).join('');
            } catch (e) { console.error('Error cargando usuarios:', e); }
        }
`;

const newRenderUsuarios = `
        async function cargarUsuariosAutorizados() {
            try {
                const res = await fetch(\`\${BACKEND_URL}/api/usuarios\`);
                const usuarios = await res.json();
                const lista = document.getElementById('lista-usuarios');
                lista.innerHTML = usuarios.map(u => \`
                    <div class="grid grid-cols-12 gap-4 items-center p-3 hover:bg-white/5 rounded border-b border-white/5 transition-colors group">
                        <div class="col-span-4 text-xs text-white truncate"><span class="mr-2 text-blue-400">@</span>\${u.email}</div>
                        <div class="col-span-3 text-[10px] text-blue-400/80 text-center">\${u.rol || 'Admin'}</div>
                        <div class="col-span-3 text-[10px] text-white/40 text-center">\${u.ultimoLogin || 'Nunca'}</div>
                        <div class="col-span-2 text-right">
                            <button onclick="eliminarUsuarioAdmin('\${u._id}')" class="text-red-500 hover:text-red-400 p-1.5 hover:bg-red-500/10 rounded transition-colors opacity-0 group-hover:opacity-100" title="Revocar Acceso">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    </div>
                \`).join('');
            } catch (e) { console.error('Error cargando usuarios:', e); }
        }
`;

html = html.replace(oldRenderUsuarios, newRenderUsuarios);

const oldAgregarUsuario = `
        async function agregarUsuarioAutorizado() {
            const email = document.getElementById('nuevo-usuario-email').value;
            if(!email) return alert('Por favor, escribe un correo.');
            try {
                await fetch(\`\${BACKEND_URL}/api/usuarios\`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email})});
                document.getElementById('nuevo-usuario-email').value = '';
                cargarUsuariosAutorizados();
            } catch (e) { alert('Error al otorgar acceso.'); }
        }
`;

const newAgregarUsuario = `
        async function agregarUsuarioAutorizado() {
            const email = document.getElementById('nuevo-usuario-email').value;
            const rol = document.getElementById('nuevo-usuario-rol').value;
            if(!email) return alert('Por favor, escribe un correo.');
            try {
                await fetch(\`\${BACKEND_URL}/api/usuarios\`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email, rol})});
                document.getElementById('nuevo-usuario-email').value = '';
                cargarUsuariosAutorizados();
            } catch (e) { alert('Error al otorgar acceso.'); }
        }
`;

html = html.replace(oldAgregarUsuario, newAgregarUsuario);

fs.writeFileSync('public/index.html', html);
console.log('Frontend Sec-Usuarios JS Patched');
