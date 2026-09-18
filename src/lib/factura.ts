import jsQR from 'jsqr'

export interface DatosFactura {
  formato: 'siat' | 'antiguo' | 'desconocido'
  nitVendedor: string
  nroFactura: string
  autorizacion: string
  fechaEmision: string | null   // ISO
  crudo: string
}

/**
 * Interpreta el contenido del QR de una factura boliviana.
 *
 * Facturación en línea: el QR es una URL del SIAT con el NIT, el CUF y el
 * número. Facturación antigua: es una cadena suelta con el código de
 * autorización, sin NIT ni número separables.
 */
export function interpretarQR(texto: string): DatosFactura {
  const base: DatosFactura = {
    formato: 'desconocido', nitVendedor: '', nroFactura: '',
    autorizacion: '', fechaEmision: null, crudo: texto
  }

  if (/siat\.impuestos\.gob\.bo/i.test(texto)) {
    try {
      const q = new URL(texto).searchParams
      const nit = q.get('nit') ?? ''
      const cuf = q.get('cuf') ?? ''
      return {
        ...base,
        formato: 'siat',
        nitVendedor: nit,
        nroFactura: q.get('numero') ?? '',
        autorizacion: cuf,
        fechaEmision: fechaDesdeCUF(cuf, nit)
      }
    } catch {
      return base
    }
  }

  // Cadena suelta: se guarda como código de autorización y se completa a mano.
  if (/^[0-9A-Z]{10,}$/i.test(texto.trim())) {
    return { ...base, formato: 'antiguo', autorizacion: texto.trim() }
  }

  return base
}

/**
 * El CUF es la representación en base 16 de una cadena que empieza con el NIT
 * del emisor seguido de la fecha y hora de emisión. Se prueba corte por corte
 * hasta que el resultado empiece con el NIT: ese es el punto exacto.
 *
 * Con esto la fecha no se transcribe a mano ni se deduce de la foto: sale del
 * propio código fiscal.
 */
export function fechaDesdeCUF(cuf: string, nit: string): string | null {
  if (!cuf || !nit) return null

  for (let corte = 30; corte <= cuf.length; corte++) {
    let decimal: string
    try {
      decimal = BigInt('0x' + cuf.slice(0, corte)).toString()
    } catch {
      continue
    }
    if (!decimal.startsWith(nit)) continue

    const f = decimal.slice(nit.length, nit.length + 14)
    if (f.length !== 14 || !f.startsWith('20')) continue

    const [a, m, d, h, mi, s] = [
      f.slice(0, 4), f.slice(4, 6), f.slice(6, 8),
      f.slice(8, 10), f.slice(10, 12), f.slice(12, 14)
    ]
    if (+m < 1 || +m > 12 || +d < 1 || +d > 31 || +h > 23) continue

    const fecha = new Date(`${a}-${m}-${d}T${h}:${mi}:${s}`)
    if (isNaN(fecha.getTime())) continue
    return fecha.toISOString()
  }
  return null
}

/** Busca un QR dentro de una imagen ya cargada. */
export async function leerQRdeImagen(archivo: File): Promise<DatosFactura | null> {
  const bitmap = await createImageBitmap(archivo)

  // Se prueba a varias escalas: una foto de la hoja entera deja el QR con muy
  // pocos píxeles, y reducir a veces ayuda tanto como ampliar.
  for (const escala of [1, 0.5, 1.5, 2]) {
    const ancho = Math.round(bitmap.width * escala)
    const alto = Math.round(bitmap.height * escala)
    if (ancho < 50 || ancho > 4000) continue

    const lienzo = document.createElement('canvas')
    lienzo.width = ancho
    lienzo.height = alto
    const ctx = lienzo.getContext('2d', { willReadFrequently: true })
    if (!ctx) continue
    ctx.drawImage(bitmap, 0, 0, ancho, alto)

    const datos = ctx.getImageData(0, 0, ancho, alto)
    const encontrado = jsQR(datos.data, ancho, alto, { inversionAttempts: 'attemptBoth' })
    if (encontrado?.data) return interpretarQR(encontrado.data)
  }
  return null
}

/** Un cuadro de video convertido a lectura de QR, para el escáner en vivo. */
export function leerQRdeVideo(video: HTMLVideoElement, lienzo: HTMLCanvasElement): DatosFactura | null {
  if (!video.videoWidth) return null
  lienzo.width = video.videoWidth
  lienzo.height = video.videoHeight
  const ctx = lienzo.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  ctx.drawImage(video, 0, 0, lienzo.width, lienzo.height)
  const datos = ctx.getImageData(0, 0, lienzo.width, lienzo.height)
  const encontrado = jsQR(datos.data, lienzo.width, lienzo.height, { inversionAttempts: 'dontInvert' })
  return encontrado?.data ? interpretarQR(encontrado.data) : null
}
