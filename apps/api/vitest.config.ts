import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC (not esbuild) so Nest's decorator metadata, and with it constructor injection, works in tests.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup-env.ts'],
  },
});
