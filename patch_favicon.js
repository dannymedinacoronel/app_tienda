const fs = require('fs');

let html = fs.readFileSync('public/index.html', 'utf8');

// Insert favicon if not exists
if (!html.includes('<link rel="icon"')) {
    html = html.replace(
        /<title>/,
        `<link rel="icon" type="image/x-icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌺</text></svg>">\n    <title>`
    );
    fs.writeFileSync('public/index.html', html);
    console.log('Favicon added to index.html');
} else {
    console.log('Favicon already exists');
}
