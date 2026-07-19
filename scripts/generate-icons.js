const fs = require('fs');
const path = require('path');
async function main() {
  const sharp = require('sharp');
  const svgPath = path.join(__dirname, '..', 'public', 'logo.svg');
  const pngPath = path.join(__dirname, '..', 'public', 'logo.png');
  const outDir = path.join(__dirname, '..', 'public', 'icons');
  let inputPath = null;
  if (fs.existsSync(svgPath)) inputPath = svgPath;
  else if (fs.existsSync(pngPath)) inputPath = pngPath;
  else {
    console.error('No existe public/logo.svg ni public/logo.png. Añade uno de los dos y vuelve a ejecutar.');
    process.exit(1);
  }
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const svgBuffer = fs.readFileSync(inputPath);
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
