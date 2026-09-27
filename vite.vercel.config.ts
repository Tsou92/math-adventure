import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { createDevApiMiddleware } from './server/dev-api';

export default defineConfig(({ command, mode }) => {
  if (command === 'serve') {
    const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '');
    if (!process.env.DATABASE_URL && env.DATABASE_URL)
      process.env.DATABASE_URL = env.DATABASE_URL;
  }
  return {
    root: 'vercel',
    publicDir: '../public',
    css: { postcss: { plugins: [tailwindcss()] } },
    plugins: [
      react(),
      {
        name: 'local-math-api',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use(createDevApiMiddleware());
        },
      },
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('.', import.meta.url)),
      },
    },
    build: {
      outDir: '../vercel-dist',
      emptyOutDir: true,
    },
  };
});
