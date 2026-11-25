import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const out = process.argv[3];
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
// Rebuilds static/css/tailwind.css after you change classes in HTML/JS.
//   npm install tailwindcss@4      (once, anywhere)
//   node tools/build_css.mjs . static/css/tailwind.css
const twDir = process.env.TAILWIND_DIR ||
  path.dirname(createRequire(path.resolve(process.argv[2] || '.', 'x.js')).resolve('tailwindcss/package.json'));
const { compile } = await import(pathToFileURL(path.join(twDir, 'dist/lib.mjs')).href);
const files = [];
const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f);
  if (fs.statSync(p).isDirectory()) { if (!/vendor/.test(p)) walk(p); } else if (/\.(html|js)$/.test(f)) files.push(p); } };
walk(path.join(root, 'static'));
const candidates = new Set();
for (const f of files) for (const tok of fs.readFileSync(f, 'utf8').split(/[\s"'`<>{}()=,;]+/)) if (tok && tok.length < 80) candidates.add(tok.replace(/^\$\{|\}$/g, ''));
const input = fs.readFileSync(path.join(root, 'static/css/tailwind.input.css'), 'utf8');
const compiler = await compile(input, {
  base: twDir,
  loadStylesheet: async (id, base) => {
    const p = id === 'tailwindcss' ? path.join(twDir, 'index.css') : path.resolve(base, id.replace(/^tailwindcss\//, '') .endsWith('.css') ? path.join(twDir, id.replace(/^tailwindcss\//,'')) : id);
    return { path: p, base: path.dirname(p), content: fs.readFileSync(p, 'utf8') };
  },
});
const css = compiler.build([...candidates]);
fs.writeFileSync(out, css);
console.log('files', files.length, 'candidates', candidates.size, 'css bytes', css.length);
