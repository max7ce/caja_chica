import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from 'react'
import { urlEnCache, urlFirmada, type Bucket } from '../lib/storageUrls'

function useUrlFirmada(bucket: Bucket, ruta: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(() => urlEnCache(bucket, ruta))
  const [fallo, setFallo] = useState(false)

  useEffect(() => {
    let vivo = true
    setFallo(false)
    setUrl(urlEnCache(bucket, ruta))
    if (!ruta) return
    urlFirmada(bucket, ruta).then((u) => {
      if (!vivo) return
      setUrl(u)
      setFallo(!u)
    })
    return () => { vivo = false }
  }, [bucket, ruta])

  return { url, fallo }
}

/** Enlace a un archivo privado de Storage (comprobantes, reportes). */
export function EnlaceArchivo({ ruta, bucket = 'comprobantes', children }: {
  ruta: string | null | undefined
  bucket?: Bucket
  children: ReactNode
}) {
  const { url, fallo } = useUrlFirmada(bucket, ruta)
  if (!ruta) return null
  if (fallo) return <span className="cc-tenue" title="No tienes acceso o el archivo no existe">no disponible</span>
  if (!url) return <span className="cc-tenue">{children}…</span>
  return <a href={url} target="_blank" rel="noreferrer">{children}</a>
}

/** Imagen guardada en un bucket privado (QR de cobro). */
export function ImagenFirmada({ ruta, bucket = 'qr', ...img }: {
  ruta: string | null | undefined
  bucket?: Bucket
} & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>) {
  const { url, fallo } = useUrlFirmada(bucket, ruta)
  if (!ruta) return null
  if (fallo) return <p className="cc-tenue">No se pudo cargar la imagen.</p>
  if (!url) return <div style={{ ...(img.style ?? {}), minHeight: 120 }} aria-busy="true" />
  return <img src={url} {...img} />
}
