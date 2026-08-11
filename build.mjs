// Builds the site into build/. Dev and production run the same pipeline:
//
//   node build.mjs                  one-off build
//   node build.mjs --minify         production
//   node build.mjs --watch --serve  development

import esbuild from 'esbuild';
import { copyFile, cp, mkdir, readdir, rm } from 'node:fs/promises';
import { watch } from 'node:fs';

const OUT = 'build';
const PORT = Number(process.env.PORT) || 8080;

// Floor set by color-mix() in css/styles.css; lowering only adds unused prefixes.
const TARGET = ['safari16', 'chrome111', 'firefox113', 'edge111'];

// Copied out so the page never points at node_modules
const VENDOR = [
  'node_modules/jsmediatags/dist/jsmediatags.min.js',
  'node_modules/music-tempo/dist/browser/music-tempo.min.js'
];

const flags = new Set(process.argv.slice(2));
const copyIndex = () => copyFile('index.html', `${OUT}/index.html`);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await copyIndex();

for (const dir of ['images', 'sounds']) {
  await cp(dir, `${OUT}/${dir}`, { recursive: true, filter: p => !p.endsWith('.DS_Store') });
}
for (const src of VENDOR) {
  await cp(src, `${OUT}/vendor/${src.split('/').pop()}`);
}

// Built individually rather than bundled: these are classic scripts sharing
// globals, and only in this mode does esbuild leave top-level names intact.
const scripts = (await readdir('js')).filter(f => f.endsWith('.js')).map(f => `js/${f}`);

const context = await esbuild.context({
  entryPoints: [...scripts, 'css/styles.css'],
  outdir: OUT,
  outbase: '.', // mirror the source layout, so index.html needs no rewriting
  target: TARGET,
  minify: flags.has('--minify'),
  logLevel: 'info'
});

if (flags.has('--watch')) {
  await context.watch();
  // esbuild only watches what it compiles, so index.html needs its own watch.
  // It has to be on the directory, not the file: editors save atomically by
  // renaming over the original, which a file watch would stop following.
  // Debounce because one save fires several events, and catch because an
  // unhandled rejection in here would take the server down.
  let pending;
  watch('.', (_event, filename) => {
    if (filename !== 'index.html') return;
    clearTimeout(pending);
    pending = setTimeout(() => copyIndex().catch(e => console.error('[watch]', e.message)), 50);
  });
}

if (flags.has('--serve')) {
  await context.serve({ servedir: OUT, port: PORT }); // prints its own URLs
} else {
  await context.rebuild();
  await context.dispose();
}
