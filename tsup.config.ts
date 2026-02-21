import { defineConfig } from 'tsup';

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
});
