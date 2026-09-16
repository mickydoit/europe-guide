import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

function buildId(): string {
  try { return `${execSync('git rev-parse --short HEAD').toString().trim()} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}` } catch { return 'local' }
}

export default defineConfig({
  base: '/europe-guide/',
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: false,
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,pbf,json,mjs,woff2}'],
        cleanupOutdatedCaches: true,
        navigateFallback: '/europe-guide/index.html',
      },
    }),
  ],
})
