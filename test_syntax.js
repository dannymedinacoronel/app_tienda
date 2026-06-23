const fs = require('fs');
const code = fs.readFileSync('public/index.html', 'utf8');
try {
  // We can't really parse HTML easily with V8 syntax check, but we can extract script tags.
} catch (e) {}
