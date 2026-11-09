import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'PatternHunter AI',
        short_name: 'PatternHunter',
        description: 'Enterprise AI Crypto Pattern Recognition & Algorithmic Trading Suite',
        theme_color: '#0F172A',
        background_color: '#0F172A',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'https://images.unsplash.com/photo-1622979135225-d2ba269bc1df?w=192&auto=format&fit=crop&q=80',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'https://images.unsplash.com/photo-1622979135225-d2ba269bc1df?w=512&auto=format&fit=crop&q=80',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'https://images.unsplash.com/photo-1622979135225-d2ba269bc1df?w=512&auto=format&fit=crop&q=80',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    include: ['lightweight-charts'],
    exclude: ['lucide-react'],
  },
});
