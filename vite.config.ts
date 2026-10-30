import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

function copyExtensionAssets() {
  return {
    name: 'copy-extension-assets',
    closeBundle() {
      const distDir = resolve(rootDir, 'dist');
      if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
      }

      // Copy manifest.json
      const manifestPath = resolve(rootDir, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        fs.copyFileSync(manifestPath, resolve(distDir, 'manifest.json'));
      }

      // Copy icons
      const iconsDir = resolve(rootDir, 'icons');
      const distIconsDir = resolve(distDir, 'icons');
      if (fs.existsSync(iconsDir)) {
        if (!fs.existsSync(distIconsDir)) {
          fs.mkdirSync(distIconsDir, { recursive: true });
        }
        fs.cpSync(iconsDir, distIconsDir, { recursive: true });
      }
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), copyExtensionAssets()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(rootDir, 'sidepanel.html'),
        newtab: resolve(rootDir, 'newtab.html'),
        redirect: resolve(rootDir, 'redirect.html'),
        background: resolve(rootDir, 'src/background/index.ts')
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') {
            return 'background.js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  }
});
