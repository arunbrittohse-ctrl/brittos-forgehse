// Production build / dev watcher for the FORGEHSE web app (esbuild).
//   node build.mjs           → minified, hashed bundle in dist/
//   node build.mjs --watch   → rebuild on change (serve dist/ via the API: WEB_DIST_DIR=apps/web/dist)
import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

const writeHtml = {
  name: 'write-html',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length || !result.metafile) return;
      const outputs = Object.keys(result.metafile.outputs).map((p) => path.relative(dist, path.join(process.cwd(), p)));
      const js = outputs.find((o) => o.endsWith('.js'));
      const css = outputs.find((o) => o.endsWith('.css'));
      const html = (await readFile(path.join(root, 'index.html'), 'utf8'))
        .replace('<!--CSS-->', css ? `<link rel="stylesheet" href="/${css.replace(/\\/g, '/')}">` : '')
        .replace('<!--JS-->', `<script type="module" src="/${js.replace(/\\/g, '/')}"></script>`);
      await writeFile(path.join(dist, 'index.html'), html);
      console.log(`[web] built ${js}${css ? ' + ' + css : ''}`);
    });
  },
};

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(path.join(root, 'public'), dist, { recursive: true });

const ctx = await esbuild.context({
  entryPoints: [path.join(root, 'src/main.tsx')],
  bundle: true,
  outdir: path.join(dist, 'assets'),
  entryNames: 'app-[hash]',
  assetNames: '[name]-[hash]',
  format: 'esm',
  target: ['es2021', 'chrome100', 'safari15'],
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch ? 'inline' : 'linked',
  metafile: true,
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  external: ['/fonts/*'],
  logLevel: 'warning',
  plugins: [writeHtml],
});

if (watch) {
  await ctx.watch();
  console.log('[web] watching for changes…');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
