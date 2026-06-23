const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const acorn = require('acorn');

const html = fs.readFileSync('public/index.html', 'utf8');
const dom = new JSDOM(html);
const scripts = dom.window.document.querySelectorAll('script');

let errorFound = false;
scripts.forEach((script, index) => {
    if (script.textContent.trim() !== '') {
        try {
            acorn.parse(script.textContent, { ecmaVersion: 2020 });
        } catch (e) {
            console.error(`Syntax error in script tag #${index + 1}: ${e.message}`);
            // Show line where error occurred
            const lines = script.textContent.split('\n');
            const errorLine = e.loc.line - 1;
            console.error(lines.slice(Math.max(0, errorLine - 2), errorLine + 3).join('\n'));
            errorFound = true;
        }
    }
});
if (!errorFound) console.log("No syntax errors found in inline scripts.");
