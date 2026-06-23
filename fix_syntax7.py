import re

with open('public/index.html', 'r') as f:
    content = f.read()

bad_block7 = """            let clientLocation = null;
            const sendLogin = async () => {
            try {
                    const res = await fetch(`${BACKEND_URL}/api/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ token: response.credential, clientLocation }) });

                        const data = await res.json();
                        if (data.requiresSetup) {
                            document.getElementById('setup-modal').classList.remove('hidden');
                            document.getElementById('setup-email').value = data.email;
                        } else {
                            window.usuarioEmail = data.email; window.usuarioRol = data.rol;
                            await cargarDatosIniciales();
                            document.getElementById('login-screen').classList.add('hidden'); document.getElementById('app-screen').classList.remove('hidden'); document.getElementById('panel-control').classList.remove('hidden');
                            document.getElementById('usuario-activo').innerText = window.usuarioEmail;
                            mostrarSeccion('panel');
                        }
                    } else { alert("Acceso denegado. No estás en la lista de Cuentas Autorizadas."); }
                } catch(e) { alert("Error de conexión al servidor de autenticación."); }
            };

            navigator.geolocation.getCurrentPosition(
                async (pos) => { clientLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude }; await sendLogin(); },
                async (err) => { await sendLogin(); },
                { timeout: 5000, enableHighAccuracy: true }
            );
        };"""

good_block7 = """            let clientLocation = null;
            const sendLogin = async () => {
                try {
                    const res = await fetch(`${BACKEND_URL}/api/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ token: response.credential, clientLocation }) });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.requiresSetup) {
                            document.getElementById('setup-modal').classList.remove('hidden');
                            document.getElementById('setup-email').value = data.email;
                        } else {
                            window.usuarioEmail = data.email; window.usuarioRol = data.rol;
                            await cargarDatosIniciales();
                            document.getElementById('login-screen').classList.add('hidden'); document.getElementById('app-screen').classList.remove('hidden'); document.getElementById('panel-control').classList.remove('hidden');
                            document.getElementById('usuario-activo').innerText = window.usuarioEmail;
                            mostrarSeccion('panel');
                        }
                    } else { alert("Acceso denegado. No estás en la lista de Cuentas Autorizadas."); }
                } catch(e) { alert("Error de conexión al servidor de autenticación."); }
            };

            navigator.geolocation.getCurrentPosition(
                async (pos) => { clientLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude }; await sendLogin(); },
                async (err) => { await sendLogin(); },
                { timeout: 5000, enableHighAccuracy: true }
            );
        };"""

if bad_block7 in content:
    content = content.replace(bad_block7, good_block7)
    print("Fixed syntax error 7.")
else:
    print("Could not find the block 7 to replace.")

with open('public/index.html', 'w') as f:
    f.write(content)
