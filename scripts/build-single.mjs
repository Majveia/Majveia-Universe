/**
 * Bundle the whole simulation into one self-contained HTML file.
 *
 * Produces two artefacts:
 *   dist-single/majveia.html   a complete page you can open from disk
 *   dist-single/artifact.html  the same content without the document skeleton,
 *                              for hosts that supply their own
 *
 * Everything - the engine, the shaders, the generation worker, the stylesheet -
 * is inlined, so the page has no network dependencies at all and runs offline.
 */
import { build } from 'vite';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.single-build');

await rm(outDir, { recursive: true, force: true });
await build({
  root,
  base: './',
  logLevel: 'warn',
  worker: { format: 'es' },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.join(root, 'index.html'),
      output: { inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: 'app[extname]' },
    },
  },
});

const html = await readFile(path.join(outDir, 'index.html'), 'utf8');
const js = await readFile(path.join(outDir, 'app.js'), 'utf8');
let css = '';
try { css = await readFile(path.join(outDir, 'app.css'), 'utf8'); } catch { /* styles inlined */ }

// A literal </script> inside the bundle would close the tag early.
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');

const title = 'Majveia — a simulated universe';
const body = `
<canvas id="stage"></canvas>
<div id="ui"></div>
<noscript>This universe requires JavaScript and WebGL2.</noscript>
`;

const fragment = `<title>${title}</title>
<meta name="description" content="An interactive, physically-grounded simulation of the universe: LambdaCDM structure formation, procedural galaxies, Keplerian systems, and ray-traced black holes." />
<style>
${css}
</style>
${body}
<script type="module">
${safe(js)}
</script>
`;

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="dark" />
${fragment.split('\n').slice(0, 2).join('\n')}
<style>
${css}
</style>
</head>
<body style="margin:0;background:#000">
${body}
<script type="module">
${safe(js)}
</script>
</body>
</html>
`;

const dest = path.join(root, 'dist-single');
await mkdir(dest, { recursive: true });
await writeFile(path.join(dest, 'majveia.html'), standalone);
await writeFile(path.join(dest, 'artifact.html'), fragment);
await rm(outDir, { recursive: true, force: true });

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} kB`;
console.log(`dist-single/majveia.html   ${kb(standalone)}`);
console.log(`dist-single/artifact.html  ${kb(fragment)}`);
