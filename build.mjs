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

// Floor set by color-mix() and @container in css/; lowering only adds unused prefixes.
const TARGET = ['safari16', 'chrome111', 'firefox113', 'edge111'];

// Copied out so the page never points at node_modules
const VENDOR = [
  'node_modules/jsmediatags/dist/jsmediatags.min.js',
  'node_modules/music-tempo/dist/browser/music-tempo.min.js',
  'node_modules/@breezystack/lamejs/dist/lamejs.iife.js'
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

const shared = {
  outdir: OUT,
  outbase: '.', // mirror the source layout, so index.html needs no rewriting
  target: TARGET,
  minify: flags.has('--minify'),
  logLevel: 'info'
};

// Built individually rather than bundled: these are classic scripts sharing
// globals, and only in this mode does esbuild leave top-level names intact.
const scripts = (await readdir('js')).filter(f => f.endsWith('.js')).map(f => `js/${f}`);

const context = await esbuild.context({ entryPoints: scripts, ...shared });

// The stylesheet is the opposite case: css/main.css is nothing but @imports,
// and bundling is what folds them back into the single file the page loads.
// The icons it points at are copied above, so they stay plain URLs — without
// this, bundling tries to inline them and stops at the missing loader.
const styles = await esbuild.context({
  entryPoints: ['css/main.css'],
  bundle: true,
  external: ['../images/*'],
  ...shared
});

if (flags.has('--watch')) {
  await context.watch();
  await styles.watch();
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
  // One server for both: it serves the directory, and the stylesheet lands
  // there the same way the scripts do
  await context.serve({ servedir: OUT, port: PORT }); // prints its own URLs
} else {
  await Promise.all([context.rebuild(), styles.rebuild()]);
  await Promise.all([context.dispose(), styles.dispose()]);
}
