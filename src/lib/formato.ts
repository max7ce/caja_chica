export function bs(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Bs'
}

export function fecha(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-BO', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  })
}

/** Horas que faltan para el vencimiento. Negativo si ya pasó. */
export function horasRestantes(iso: string | null | undefined): number | null {
  if (!iso) return null
  return Math.round((new Date(iso).getTime() - Date.now()) / 3600000)
}

export function iniciales(nombre: string | null | undefined): string {
  if (!nombre) return '··'
  return nombre.split(' ').slice(0, 2).map((p) => p[0]).join('').toUpperCase()
}

/** Nombre legible de un adjunto, según su tipo y cómo se subió. */
export function etiquetaComprobante(c: { tipo: string; descripcion: string | null }): string {
  if (c.tipo === 'cotizacion') return 'Cotización o respaldo'
  if (c.tipo === 'devolucion') return 'Comprobante de devolución'
  if (c.descripcion === 'Factura en PDF') return 'Factura (PDF)'
  if (c.descripcion === 'Adjunto tras observación') return 'Comprobante adicional'
  return 'Comprobante de compra'
}

/* ------------------------------------------------ monto literal (Bs) */

const UNIDADES = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis',
  'veintisiete', 'veintiocho', 'veintinueve']
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos',
  'setecientos', 'ochocientos', 'novecientos']

function hasta999(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'cien'
  const c = Math.floor(n / 100), r = n % 100
  let t = ''
  if (r < 30) t = UNIDADES[r]
  else t = DECENAS[Math.floor(r / 10)] + (r % 10 ? ` y ${UNIDADES[r % 10]}` : '')
  return [CENTENAS[c], t].filter(Boolean).join(' ')
}

function entero(n: number): string {
  if (n === 0) return 'cero'
  const millones = Math.floor(n / 1_000_000), miles = Math.floor((n % 1_000_000) / 1000), resto = n % 1000
  const partes: string[] = []
  if (millones) partes.push(millones === 1 ? 'un millón' : `${entero(millones).replace(/uno$/, 'un')} millones`)
  if (miles) partes.push(miles === 1 ? 'mil' : `${hasta999(miles).replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un')} mil`)
  if (resto) partes.push(hasta999(resto))
  return partes.join(' ')
}

/** "Son: seis mil cuatrocientos setenta y cinco 00/100 Bolivianos" */
export function montoLiteral(n: number | null | undefined): string {
  const v = Math.round(Number(n ?? 0) * 100)
  const e = Math.floor(v / 100), c = v % 100
  const txt = entero(e)
  return `${txt.charAt(0).toUpperCase()}${txt.slice(1)} ${String(c).padStart(2, '0')}/100 Bolivianos`
}
