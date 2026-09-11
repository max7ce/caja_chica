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
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: '/index.html',
        // Nunca cachear la API ni el almacenamiento: los datos de dinero
        // deben venir siempre del servidor, no de una copia vieja.
        navigateFallbackDenylist: [/^\/\.netlify\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith('supabase.co'),
            handler: 'NetworkOnly'
          }
        ]
      }
    })
  ],
  build: { outDir: 'dist' }
})
