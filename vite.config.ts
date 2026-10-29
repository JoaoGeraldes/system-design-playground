import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));
// GitHub Pages serves the site under the repository's name; the Docker image
// serves it from the root, and says so with BASE_PATH.
const PAGES_BASE = process.env.BASE_PATH ?? '/system-design-playground/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? PAGES_BASE : '/',
  build: {
    rollupOptions: {
      input: {
        landing: resolve(root, 'index.html'),
        app: resolve(root, 'app/index.html'),
      },
    },
  },
}));
