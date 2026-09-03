import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  test: { environment: 'node', exclude: ['e2e/**', 'node_modules/**'] },
});
