// Empacota a extensão e as dependências (tedious) num único arquivo em dist/.
// Uso: node esbuild.mjs [--production]
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');

await esbuild.build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // Node do VS Code 1.85 (versão mínima em package.json -> engines).
  target: 'node18',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'warning',
});
