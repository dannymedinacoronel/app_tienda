const fs = require('fs');

let html = fs.readFileSync('public/index.html', 'utf8');

const setupHtml = `
            <!-- Setup Flow -->
            <div id="setup-container" class="hidden text-white w-full max-w-sm mt-4 p-4 rounded bg-[#1A1A2E]">
                <h3 class="font-bold text-lg mb-2">Crear Negocio</h3>
                <p class="text-xs mb-4 opacity-80">Por favor, escribe el nombre de tu empresa para crear tu espacio de trabajo (CRM).</p>
                <input type="text" id="setup-business-name" placeholder="Nombre de tu negocio" class="w-full bg-[#12122A] p-2 rounded text-sm mb-3 outline-none" />
                <button id="btn-submit-setup" class="w-full bg-blue-600 hover:bg-blue-500 font-bold p-2 rounded text-sm transition-all shadow-[0_0_15px_rgba(37,99,235,0.4)]">Crear Espacio CRM</button>
            </div>
`;

html = html.replace(
    /<div class="mt-4 flex justify-center">[\s\S]*?<div class="g_id_signin" data-type="standard"/,
    `${setupHtml}\n                        <div class="mt-4 flex justify-center">\n                            <div class="g_id_signin" data-type="standard"`
);

const oldLoginFlow = `
            const sendLogin = async () => {
            try {
                    const res = await fetch(\`\${BACKEND_URL}/api/auth/google\`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ token: response.credential, clientLocation }) });
                if (res.ok) {
                    window.location.reload();
                } else {
                    const data = await res.json();
                    alert(\`⚠️ Acceso denegado: \${data.error || 'Correo no autorizado en el sistema.'}\`);
                        loginBox.innerHTML = originalHTML;
                }
            } catch(e) {
                alert("❌ Error crítico: No se pudo conectar con el servidor de Seychelles.");
                    loginBox.innerHTML = originalHTML;
            }
`;

const newLoginFlow = `
            const sendLogin = async () => {
                try {
                    const res = await fetch(\`\${BACKEND_URL}/api/auth/google\`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ token: response.credential, clientLocation }) });
                    const data = await res.json();

                    if (data.success) {
                        window.location.reload();
                    } else if (data.setupRequired) {
                        loginBox.innerHTML = originalHTML;
                        document.querySelector('.g_id_signin').parentElement.classList.add('hidden');
                        document.getElementById('setup-container').classList.remove('hidden');

                        document.getElementById('btn-submit-setup').onclick = async () => {
                            const negocioNombre = document.getElementById('setup-business-name').value;
                            if (!negocioNombre) return alert('Debes escribir un nombre para tu negocio');

                            loginBox.innerHTML = '<div class="text-white text-center"><div class="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div><p>Creando CRM...</p></div>';

                            const setupRes = await fetch(\`\${BACKEND_URL}/api/auth/setup\`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                credentials: 'include',
                                body: JSON.stringify({ token: response.credential, negocioNombre, email: data.email })
                            });

                            const setupData = await setupRes.json();
                            if (setupData.success) {
                                window.location.reload();
                            } else {
                                alert(setupData.error || 'Error configurando negocio');
                                window.location.reload();
                            }
                        };
                    } else {
                        alert(\`⚠️ Acceso denegado: \${data.error || 'Correo no autorizado en el sistema.'}\`);
                        loginBox.innerHTML = originalHTML;
                    }
                } catch(e) {
                    alert("❌ Error crítico: No se pudo conectar con el servidor de Seychelles.");
                    loginBox.innerHTML = originalHTML;
                }
`;

html = html.replace(oldLoginFlow, newLoginFlow);

fs.writeFileSync('public/index.html', html);
console.log('Frontend Auth Flow Patched');
