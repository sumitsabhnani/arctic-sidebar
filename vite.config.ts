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

      // Copy lightweight newtab.html launcher
      const newtabPath = resolve(rootDir, 'newtab.html');
      if (fs.existsSync(newtabPath)) {
        fs.copyFileSync(newtabPath, resolve(distDir, 'newtab.html'));
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
        command: resolve(rootDir, 'command.html'),
        background: resolve(rootDir, 'src/background/index.ts'),
        edgeTrigger: resolve(rootDir, 'src/content/edgeTrigger.ts')
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') {
            return 'background.js';
          }
          if (chunkInfo.name === 'edgeTrigger') {
            return 'edgeTrigger.js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  }
});
