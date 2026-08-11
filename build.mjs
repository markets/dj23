// Builds the site into build/ — the same pipeline for development and
// production. Production adds minification, development adds a watcher and a
// server. Run with no flags for a plain one-off build.
//
//   node build.mjs                 one-off, unminified
//   node build.mjs --minify        production
//   node build.mjs --watch --serve development
import esbuild from 'esbuild';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { watch } from 'node:fs';

const OUT = 'build';
const PORT = Number(process.env.PORT) || 8080;

// The floor is set by color-mix(), which css/styles.css relies on. Raising
// these versions is safe; lowering them only adds prefixes nobody needs.
const TARGET = ['safari16', 'chrome111', 'firefox113', 'edge111'];

// Browser builds pulled straight out of node_modules, so nothing in the page
// ever points at node_modules itself.
const VENDOR = [
  'node_modules/jsmediatags/dist/jsmediatags.min.js',
  'node_modules/music-tempo/dist/browser/music-tempo.min.js'
];

const STATIC_DIRS = ['images', 'sounds'];

const flags = new Set(process.argv.slice(2));
const minify = flags.has('--minify');

async function copyStatic() {
  await cp('index.html', `${OUT}/index.html`);

  await Promise.all(STATIC_DIRS.map(dir =>
    cp(dir, `${OUT}/${dir}`, {
      recursive: true,
      filter: src => !src.endsWith('.DS_Store')
    })
  ));

  await mkdir(`${OUT}/vendor`, { recursive: true });
  await Promise.all(VENDOR.map(src =>
    cp(src, `${OUT}/vendor/${src.split('/').pop()}`)
  ));
}

await rm(OUT, { recursive: true, force: true });
await copyStatic();

// js/*.js are classic scripts sharing globals across files, so they are built
// individually rather than bundled — esbuild leaves top-level names alone in
// this mode, which is what keeps cross-file references like `new Deck(...)`
// working. outbase keeps the source layout, so build/js/… and build/css/…
// mirror the paths index.html already uses.
const scripts = (await readdir('js')).filter(f => f.endsWith('.js')).map(f => `js/${f}`);

const context = await esbuild.context({
  entryPoints: [...scripts, 'css/styles.css'],
  outdir: OUT,
  outbase: '.',
  target: TARGET,
  minify,
  logLevel: 'info'
});

if (flags.has('--watch')) {
  await context.watch();
  // esbuild only watches what it compiles; index.html is a plain copy
  watch('index.html', () => cp('index.html', `${OUT}/index.html`));
}

if (flags.has('--serve')) {
  // esbuild prints the URLs it is listening on itself
  await context.serve({ servedir: OUT, port: PORT });
} else {
  await context.rebuild();
  await context.dispose();
}
