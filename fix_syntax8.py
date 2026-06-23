import re

with open('public/index.html', 'r') as f:
    content = f.read()

bad_block8 = """        window.handleCredentialResponse = async function(response) {
            const loginBox = document.querySelector('.login-glow-card div');
            const originalHTML = loginBox.innerHTML;
            loginBox.innerHTML = '<div class="text-white text-center"><div class="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div><p class="font-bold text-lg text-blue-400">Obteniendo ubicación satelital...</p><p class="text-[11px] opacity-60 mt-2">Por favor, acepta los permisos en tu navegador si te los pide.</p></div>';

            let clientLocation = null;
            const sendLogin = async () => {
            try {
                    const res = await fetch(`${BACKEND_URL}/api/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ token: response.credential, clientLocation }) });

                    const data = await res.json();
                    alert(`⚠️ Acceso denegado: ${data.error || 'Correo no autorizado en el sistema.'}`);
                        loginBox.innerHTML = originalHTML;
                }
            } catch(e) {
                alert("❌ Error crítico: No se pudo conectar con el servidor de Seychelles.");
                    loginBox.innerHTML = originalHTML;
            }
            };"""

good_block8 = """        window.handleCredentialResponse = async function(response) {
            const loginBox = document.querySelector('.login-glow-card div');
            const originalHTML = loginBox.innerHTML;
            loginBox.innerHTML = '<div class="text-white text-center"><div class="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div><p class="font-bold text-lg text-blue-400">Obteniendo ubicación satelital...</p><p class="text-[11px] opacity-60 mt-2">Por favor, acepta los permisos en tu navegador si te los pide.</p></div>';

            let clientLocation = null;
            const sendLogin = async () => {
                try {
                    const res = await fetch(`${BACKEND_URL}/api/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ token: response.credential, clientLocation }) });
                    const data = await res.json();

                    if (res.ok) {
                        if (data.requiresSetup) {
                            document.getElementById('setup-modal').classList.remove('hidden');
                            document.getElementById('setup-email').value = data.email;
                            loginBox.innerHTML = originalHTML;
                        } else {
                            window.usuarioEmail = data.email; window.usuarioRol = data.rol;
                            await cargarDatosIniciales();
                            document.getElementById('login-screen').classList.add('hidden'); document.getElementById('app-screen').classList.remove('hidden'); document.getElementById('panel-control').classList.remove('hidden');
                            document.getElementById('usuario-activo').innerText = window.usuarioEmail;
                            mostrarSeccion('panel');
                        }
                    } else {
                        alert(`⚠️ Acceso denegado: ${data.error || 'Correo no autorizado en el sistema.'}`);
                        loginBox.innerHTML = originalHTML;
                    }
                } catch(e) {
                    alert("❌ Error crítico: No se pudo conectar con el servidor de Seychelles.");
                    loginBox.innerHTML = originalHTML;
                }
            };"""

if bad_block8 in content:
    content = content.replace(bad_block8, good_block8)
    print("Fixed syntax error 8.")
else:
    print("Could not find the block 8 to replace.")

with open('public/index.html', 'w') as f:
    f.write(content)
