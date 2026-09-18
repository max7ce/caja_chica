/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & typeof globalThis

// Armazón de la aplicación, igual que antes.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// La actualización la decide la persona desde la franja azul, no el navegador.
self.addEventListener('message', (evento) => {
  if (evento.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

/**
 * Llegada de una notificación push.
 *
 * Esto corre aunque la aplicación esté cerrada: el sistema operativo despierta
 * al service worker solo para esto y lo vuelve a dormir. No es la app
 * ejecutándose en segundo plano.
 */
self.addEventListener('push', (evento) => {
  let datos: { titulo?: string; cuerpo?: string; url?: string; tag?: string } = {}
  try {
    datos = evento.data ? evento.data.json() : {}
  } catch {
    datos = { cuerpo: evento.data?.text() }
  }

  const titulo = datos.titulo ?? 'Caja chica'
  const opciones: NotificationOptions = {
    body: datos.cuerpo ?? '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // El tag agrupa por solicitud: dos avisos del mismo vale se reemplazan
    // en lugar de apilarse en la pantalla de bloqueo.
    tag: datos.tag ?? 'caja-chica',
    data: { url: datos.url ?? '/dashboard' },
    lang: 'es-BO'
  }

  evento.waitUntil(self.registration.showNotification(titulo, opciones))
})

/** Al tocar la notificación: si la app ya está abierta, se reutiliza la pestaña. */
self.addEventListener('notificationclick', (evento) => {
  evento.notification.close()
  const destino = (evento.notification.data?.url as string) ?? '/dashboard'

  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      for (const v of ventanas) {
        if ('focus' in v) {
          v.navigate?.(destino)
          return v.focus()
        }
      }
      return self.clients.openWindow(destino)
    })
  )
})
