const fs = require('fs');
const path = require('path');
async function main() {
  const sharp = require('sharp');
  const svgPath = path.join(__dirname, '..', 'public', 'logo.svg');
  const outDir = path.join(__dirname, '..', 'public', 'icons');
  if (!fs.existsSync(svgPath)) {
    console.error('No existe public/logo.svg. Asegúrate de tener el SVG en su lugar.');
    process.exit(1);
  }
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const svgBuffer = fs.readFileSync(svgPath);
  try {
    console.log('Generando public/icons/logo-192.png ...');
    await sharp(svgBuffer).resize(192, 192, { fit: 'contain' }).png({ compressionLevel: 9 }).toFile(path.join(outDir, 'logo-192.png'));
    console.log('Generando public/icons/logo-512.png ...');
    await sharp(svgBuffer).resize(512, 512, { fit: 'contain' }).png({ compressionLevel: 9 }).toFile(path.join(outDir, 'logo-512.png'));
    console.log('Iconos generados en public/icons/');
  } catch (e) {
    console.error('Error generando iconos:', e);
    process.exit(2);
  }
}

main();
