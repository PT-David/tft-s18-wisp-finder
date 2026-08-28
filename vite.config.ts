import { defineConfig } from 'vite';

export default defineConfig({ test: { environment: 'node', exclude: ['e2e/**', 'node_modules/**'] } });
