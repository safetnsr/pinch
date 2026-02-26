import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync } from 'fs';

export default defineConfig({
  entry: [
    'src/plugin.ts',
    'src/dashboard/server.ts',
  ],
  outDir: 'server',
  format: 'esm',
  target: 'node20',
  splitting: false,
  clean: true,
  dts: false,
  sourcemap: false,
  external: ['hono', '@hono/node-server'],
  noExternal: [],
  async onSuccess() {
    // Copy static assets that tsup doesn't handle
    mkdirSync('server/dashboard', { recursive: true });
    copyFileSync('src/dashboard/index.html', 'server/dashboard/index.html');
    console.log('Copied dashboard/index.html');
  },
});
