import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // El service worker se actualiza solo, pero avisa antes de recargar:
      // recargar sin avisar en medio de un formulario perdería lo escrito.
      registerType: 'prompt',
      // injectManifest y no generateSW: el service worker es nuestro, porque
      // tiene que atender los eventos push y notificationclick.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['apple-touch-icon.png', 'logo-ucb.png'],
      manifest: {
        name: 'Caja chica · UCB Tarija',
        short_name: 'Caja chica',
        description: 'Vales, devoluciones y rendición de cuentas de caja chica',
        lang: 'es-BO',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#ffffff',
        theme_color: '#1b3a6b',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ],
        shortcuts: [
          { name: 'Pedir un vale', url: '/solicitudes/nueva' },
          { name: 'Mis solicitudes', url: '/solicitudes' }
        ]
      },
      injectManifest: {
        // Solo el armazón. Los datos de dinero nunca se cachean: el service
        // worker no intercepta las llamadas a Supabase, así que siempre salen
        // a la red.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}']
      }
    })
  ],
  build: { outDir: 'dist' }
})
