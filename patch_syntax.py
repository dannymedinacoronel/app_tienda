import re

with open("public/index.html", "r") as f:
    content = f.read()

# The error was caused by injecting handleCredentialResponse logic inside the AI Chat window logic!
# Let's fix the AI chat window block:
bad_block = """                                if (res.ok) {
                    const data = await res.json();
                    if (data.necesitaRegistro) {
                        document.getElementById('setup-modal').classList.remove('hidden');
                        document.getElementById('setup-email').value = data.email;
                    } else {
                        window.location.reload();
                    }
                } else {"""

content = content.replace(bad_block, "")

with open("public/index.html", "w") as f:
    f.write(content)
