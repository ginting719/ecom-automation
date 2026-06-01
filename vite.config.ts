
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Ganti 'stock-master-automation' dengan nama repository GitHub Anda jika berbeda
export default defineConfig({
  plugins: [react()],
  base: './', 
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  }
});
