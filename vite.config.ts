import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
    const port = Number(process.env.PORT) || 3000;
    return {
      server: {
        port,
        strictPort: Boolean(process.env.PORT),
        host: '0.0.0.0',
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': resolve(projectRoot),
        }
      }
    };
});
