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
