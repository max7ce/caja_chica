import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Dos avisos de la PWA, en la misma franja superior:
 *  - sin conexión: la app instalada abre igual, pero no puede leer ni guardar
 *    nada, así que conviene decirlo en vez de mostrar tablas vacías.
 *  - versión nueva disponible: se avisa en lugar de recargar solo, porque
 *    recargar en medio de un formulario borraría lo escrito.
 */
export function EstadoRed() {
  const [enLinea, setEnLinea] = useState(navigator.onLine)
  const {
    needRefresh: [hayVersionNueva],
    updateServiceWorker
  } = useRegisterSW()

  useEffect(() => {
    const arriba = () => setEnLinea(true)
    const abajo = () => setEnLinea(false)
    window.addEventListener('online', arriba)
    window.addEventListener('offline', abajo)
    return () => {
      window.removeEventListener('online', arriba)
      window.removeEventListener('offline', abajo)
    }
  }, [])

  if (!enLinea) {
    return (
      <div className="cc-red cc-red-off">
        <span>Sin conexión. Puedes ver la aplicación, pero no se cargan ni se guardan datos hasta que vuelva internet.</span>
      </div>
    )
  }

  if (hayVersionNueva) {
    return (
      <div className="cc-red cc-red-nueva">
        <span>Hay una versión nueva de la aplicación.</span>
        <button onClick={() => updateServiceWorker(true)}>Actualizar</button>
      </div>
    )
  }

  return null
}
