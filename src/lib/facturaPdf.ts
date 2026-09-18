import * as pdfjs from 'pdfjs-dist'
import trabajador from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { fechaDesdeCUF } from './factura'

pdfjs.GlobalWorkerOptions.workerSrc = trabajador

export interface FacturaLeida {
  nitVendedor: string
  razonSocial: string
  nroFactura: string
  autorizacion: string
  fechaEmision: string | null
  monto: number | null
  clienteNombre: string
  clienteNit: string
  texto: string
}

/** Texto de todas las páginas, conservando los saltos de línea del original. */
export async function textoDePdf(archivo: File): Promise<string> {
  const datos = new Uint8Array(await archivo.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data: datos }).promise

  let salida = ''
  for (let n = 1; n <= pdf.numPages; n++) {
    const pagina = await pdf.getPage(n)
    const contenido = await pagina.getTextContent()

    // pdf.js entrega fragmentos sueltos con su posición: se reagrupan por
    // línea usando la coordenada vertical, porque los rótulos y sus valores
    // viven en columnas distintas del mismo renglón.
    const lineas = new Map<number, string[]>()
    for (const item of contenido.items as any[]) {
      if (typeof item.str !== 'string' || !item.str.trim()) continue
      const y = Math.round(item.transform[5])
      if (!lineas.has(y)) lineas.set(y, [])
      lineas.get(y)!.push(item.str)
    }

    const ordenadas = [...lineas.entries()].sort((a, b) => b[0] - a[0])
    salida += ordenadas.map(([, partes]) => partes.join(' ')).join('\n') + '\n'
  }
  return salida
}

const buscar = (texto: string, patrones: RegExp[]): string => {
  for (const p of patrones) {
    const m = texto.match(p)
    if (m) return (m[1] ?? '').trim()
  }
  return ''
}

/**
 * Reconstruye el código de autorización, que el PDF parte en varias líneas.
 *
 * Dos trampas resueltas aquí: el teléfono del proveedor puede caer en la
 * misma zona y son dígitos válidos en hexadecimal, así que se descarta por su
 * rótulo; y el código resultante se valida decodificándolo, porque un CUF
 * correcto empieza siempre con el NIT del emisor seguido de la fecha.
 */
function reconstruirCUF(texto: string, nit: string): string {
  const bloque = texto.match(
    /(?:C[ÓO]D\.?\s*AUTORIZACI[ÓO]N|CUF)\s*:?\s*((?:[^\n]*\n){0,5})/i
  )
  if (!bloque) return ''

  const fragmentos: string[] = []
  for (let linea of bloque[1].toUpperCase().split('\n')) {
    linea = linea.replace(/(?:TEL[EÉ]FONO|TEL\.?|FAX|CEL)\s*:?\s*[\d-]+/g, ' ')
    fragmentos.push(...(linea.match(/\b[0-9A-F]{5,}\b/g) ?? []))
  }
  if (!fragmentos.length) return ''

  const entero = fragmentos.join('')
  if (fechaDesdeCUF(entero, nit) && entero.length <= 60) return entero

  // Si no valida, se prueba descartando hasta dos fragmentos y se conserva
  // el más largo que siga decodificando.
  const validos: string[] = []
  for (let i = -1; i < fragmentos.length; i++) {
    for (let j = i; j < fragmentos.length; j++) {
      const cand = fragmentos.filter((_, k) => k !== i && k !== j).join('')
      if (cand.length < 45 || cand.length > 60) continue
      if (fechaDesdeCUF(cand, nit)) validos.push(cand)
    }
  }
  return validos.length ? validos.reduce((a, b) => (b.length > a.length ? b : a)) : entero
}

export function extraerFactura(texto: string): FacturaLeida {
  const plano = texto.replace(/[ \t]+/g, ' ')

  const nitVendedor = buscar(plano, [
    /\bNIT\b\s*:?\s*\n?\s*(\d{6,15})/i,
    /NIT\s+(\d{6,15})/i
  ])

  const nroFactura = buscar(plano, [
    /(?:N°\s*FACTURA|FACTURA\s*N°|N°FACTURA)\s*:?\s*\n?\s*(\d+)/i
  ])

  const autorizacion = reconstruirCUF(texto, nitVendedor)

  const fechaTexto = buscar(plano, [
    /FECHA DE EMISI[ÓO]N\s*:?\s*(\d{4}-\d{2}-\d{2}T[\d:.]+)/i,
    /FECHA DE EMISI[ÓO]N\s*:?\s*(\d{2}\/\d{2}\/\d{4}\s+[\d:]+\s*[AP]?\.?M?\.?)/i,
    /Fecha\s*:?\s*(\d{2}\/\d{2}\/\d{4}\s+[\d:]+\s*[AP]?\.?M?\.?)/i
  ])

  const montoTexto = buscar(plano, [
    /MONTO A PAGAR(?:\s*Bs)?\s*:?\s*([\d.,]+)/i,
    /Total Bs\.?\s*:?\s*([\d.,]+)/i,
    /TOTAL Bs\s*:?\s*([\d.,]+)/i
  ])

  // La fecha del código fiscal manda sobre la impresa: viene del propio CUF
  // y no depende de cómo cada proveedor maquete su factura.
  const fechaEmision = fechaDesdeCUF(autorizacion, nitVendedor) ?? normalizarFecha(fechaTexto)

  return {
    nitVendedor,
    razonSocial: (plano.trim().split('\n')[0] ?? '').trim().slice(0, 60),
    nroFactura,
    autorizacion,
    fechaEmision,
    monto: montoTexto ? Number(montoTexto.replace(/,/g, '')) : null,
    clienteNombre: buscar(plano, [/NOMBRE\/RAZ[ÓO]N(?:\s*SOCIAL)?\s*:?\s*([^\n]+?)(?:\s+Cod\.|\s{2,}|$)/i]),
    clienteNit: buscar(plano, [/NIT\/CI(?:\/CEX)?\s*:?\s*(\d+)/i]),
    texto
  }
}

function normalizarFecha(texto: string): string | null {
  if (!texto) return null
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})T([\d:]+)/)
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]}`).toISOString()

  const bo = texto.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP])?\.?M?/i)
  if (bo) {
    let hora = Number(bo[4])
    if (bo[6]?.toUpperCase() === 'P' && hora < 12) hora += 12
    if (bo[6]?.toUpperCase() === 'A' && hora === 12) hora = 0
    const f = new Date(`${bo[3]}-${bo[2]}-${bo[1]}T${String(hora).padStart(2, '0')}:${bo[5]}:00`)
    return isNaN(f.getTime()) ? null : f.toISOString()
  }
  return null
}

export async function leerFacturaPdf(archivo: File): Promise<FacturaLeida> {
  return extraerFactura(await textoDePdf(archivo))
}
