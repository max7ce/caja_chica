import { supabase } from './supabase'

/**
 * URLs firmadas para los buckets privados. Reemplazan a getPublicUrl:
 * cada enlace dura una hora y solo lo obtiene quien tiene permiso de leer
 * el archivo según las políticas de Storage. Se cachean en memoria para no
 * pedir una firma nueva en cada render.
 */

export type Bucket = 'comprobantes' | 'qr'

const DURACION_SEG = 60 * 60
const MARGEN_MS = 5 * 60 * 1000

type Entrada = { url: string; vence: number }
const cache = new Map<string, Entrada>()
const enCurso = new Map<string, Promise<string | null>>()

const clave = (bucket: Bucket, ruta: string) => `${bucket}/${ruta}`

export function urlEnCache(bucket: Bucket, ruta: string | null | undefined): string | null {
  if (!ruta) return null
  const hit = cache.get(clave(bucket, ruta))
  return hit && hit.vence - MARGEN_MS > Date.now() ? hit.url : null
}

export async function urlFirmada(bucket: Bucket, ruta: string | null | undefined): Promise<string | null> {
  if (!ruta) return null
  const enCacheYa = urlEnCache(bucket, ruta)
  if (enCacheYa) return enCacheYa

  const k = clave(bucket, ruta)
  const pendiente = enCurso.get(k)
  if (pendiente) return pendiente

  const p = (async () => {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(ruta, DURACION_SEG)
    if (error || !data?.signedUrl) {
      console.warn(`No se pudo firmar ${k}:`, error?.message)
      return null
    }
    cache.set(k, { url: data.signedUrl, vence: Date.now() + DURACION_SEG * 1000 })
    return data.signedUrl
  })().finally(() => enCurso.delete(k))

  enCurso.set(k, p)
  return p
}

/** Las firmas pertenecen al usuario que inició sesión: se descartan al salir. */
export function limpiarCacheUrls() {
  cache.clear()
  enCurso.clear()
}

/* ------------------------------------------- validación antes de subir */

const LIMITES: Record<Bucket, { maxMB: number; tipos: string[]; texto: string }> = {
  comprobantes: {
    maxMB: 5,
    tipos: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    texto: 'JPG, PNG, WEBP o PDF'
  },
  qr: {
    maxMB: 2,
    tipos: ['image/jpeg', 'image/png', 'image/webp'],
    texto: 'JPG, PNG o WEBP'
  }
}

/** Mismas reglas que el bucket en Supabase, para avisar con un mensaje claro. */
export function validarArchivo(bucket: Bucket, archivo: File) {
  const l = LIMITES[bucket]
  if (!l.tipos.includes(archivo.type)) {
    throw new Error(`Formato no permitido. Sube un archivo ${l.texto}.`)
  }
  if (archivo.size > l.maxMB * 1024 * 1024) {
    throw new Error(`El archivo pesa más de ${l.maxMB} MB. Reduce la foto o el PDF e inténtalo de nuevo.`)
  }
}

/** Descarga el archivo como Blob (para guardarlo o compartirlo desde el teléfono). */
export async function descargarArchivo(bucket: Bucket, ruta: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(bucket).download(ruta)
  if (error || !data) throw new Error('No se pudo descargar la imagen del QR.')
  return data
}
