import { supabase } from './supabase'
import type {
  Comprobante, InformeRendicion, MovimientoCaja, Notificacion, Parametros,
  Periodo, Profile, RendicionAdmin, Rol, SaldoCaja, Solicitud, TipoComprobante
} from '../types/database'

const SEL_SOL = '*, solicitante:profiles!solicitudes_solicitante_id_fkey(id, full_name, email, departamento)'

/* ---------------------------------------------------------------- básicos */

export async function obtenerParametros(): Promise<Parametros> {
  const { data, error } = await supabase.from('parametros').select('*').eq('id', 1).single()
  if (error) throw error
  return data as Parametros
}

export async function guardarParametros(cambios: Partial<Parametros>) {
  const { error } = await supabase.from('parametros').update(cambios).eq('id', 1)
  if (error) throw error
}

export async function obtenerPerfil(id: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function listarPerfiles(): Promise<Profile[]> {
  const { data, error } = await supabase.from('profiles').select('*').order('full_name')
  if (error) throw error
  return data ?? []
}

export async function actualizarPerfil(id: string, cambios: Partial<Profile>) {
  const { error } = await supabase.from('profiles').update(cambios).eq('id', id)
  if (error) throw error
}

export async function cambiarRol(id: string, role: Rol) {
  const { error } = await supabase.from('profiles').update({ role }).eq('id', id)
  if (error) throw error
}

/* --------------------------------------------------------------- períodos */

export async function listarPeriodos(): Promise<Periodo[]> {
  const { data, error } = await supabase
    .from('periodos_gestion')
    .select('*, admin:profiles!periodos_gestion_admin_caja_id_fkey(id, full_name)')
    .order('fecha_inicio', { ascending: false })
  if (error) throw error
  return (data ?? []) as Periodo[]
}

export async function periodoVigente(): Promise<Periodo | null> {
  const { data, error } = await supabase
    .from('periodos_gestion')
    .select('*, admin:profiles!periodos_gestion_admin_caja_id_fkey(id, full_name)')
    .eq('estado', 'vigente')
    .maybeSingle()
  if (error) throw error
  return data as Periodo | null
}

/** Cierra la gestión vigente y abre la nueva. El índice único impide que haya dos. */
export async function rotarPeriodo(adminCajaId: string, etiqueta: string, fondo: number) {
  const vigente = await periodoVigente()
  if (vigente) {
    const { error } = await supabase
      .from('periodos_gestion')
      .update({ estado: 'cerrado', fecha_fin: new Date().toISOString() })
      .eq('id', vigente.id)
    if (error) throw error
  }
  const { error } = await supabase
    .from('periodos_gestion')
    .insert({ admin_caja_id: adminCajaId, etiqueta, fondo_asignado: fondo })
  if (error) throw error
}

/* ------------------------------------------------------------ solicitudes */

export async function listarSolicitudes(filtros?: { estado?: string; solicitanteId?: string }) {
  let q = supabase.from('solicitudes').select(SEL_SOL).order('fecha_creacion', { ascending: false })
  if (filtros?.estado) q = q.eq('estado', filtros.estado)
  if (filtros?.solicitanteId) q = q.eq('solicitante_id', filtros.solicitanteId)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as Solicitud[]
}

export async function obtenerSolicitud(id: string): Promise<Solicitud | null> {
  const { data, error } = await supabase.from('solicitudes').select(SEL_SOL).eq('id', id).maybeSingle()
  if (error) throw error
  return data as Solicitud | null
}

/** true si el usuario tiene una rendición pasada de plazo (bloquea vales nuevos). */
export async function tieneRendicionVencida(usuarioId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('solicitudes')
    .select('id, limite_tiempo_devolucion')
    .eq('solicitante_id', usuarioId)
    .in('estado', ['desembolsado', 'pendiente_devolucion'])
    .lt('limite_tiempo_devolucion', new Date().toISOString())
  if (error) throw error
  return (data ?? []).length > 0
}

export async function crearSolicitud(entrada: {
  solicitante_id: string
  monto_solicitado: number
  descripcion: string
  categoria: string | null
}) {
  const { data, error } = await supabase.from('solicitudes').insert(entrada).select('id').single()
  if (error) throw error
  return data.id as string
}

export async function decidirSolicitud(id: string, dafId: string, aprobar: boolean, motivo?: string) {
  const { error } = await supabase
    .from('solicitudes')
    .update({
      estado: aprobar ? 'aprobado_daf' : 'rechazado',
      aprobado_por_id: dafId,
      origen_decision: 'app',
      motivo_rechazo: aprobar ? null : motivo ?? null
    })
    .eq('id', id)
  if (error) throw error

  if (!aprobar) {
    const { data: s } = await supabase.from('solicitudes').select('solicitante_id').eq('id', id).single()
    if (s) await agendarAviso('solicitud_rechazada', 'correo', s.solicitante_id, id, { motivo: motivo ?? '' })
  }
}

/** El trigger de la base calcula el vencimiento hábil y agenda los recordatorios. */
export async function desembolsar(solicitud: Solicitud, adminCajaId: string, periodoId: string | null) {
  const { error: e1 } = await supabase
    .from('solicitudes')
    .update({ estado: 'desembolsado', admin_caja_id: adminCajaId })
    .eq('id', solicitud.id)
  if (e1) throw e1

  const { error: e2 } = await supabase.from('movimientos_caja').insert({
    tipo: 'desembolso',
    monto: solicitud.monto_solicitado,
    solicitud_id: solicitud.id,
    periodo_id: periodoId,
    admin_caja_id: adminCajaId,
    registrado_por_id: adminCajaId,
    descripcion: solicitud.descripcion,
    estado: 'aprobado',
    aprobado_por_id: adminCajaId
  })
  if (e2) throw e2
}

export async function reportarGasto(solicitud: Solicitud, montoReal: number) {
  const hayDiferencia = montoReal < Number(solicitud.monto_solicitado)
  const { error } = await supabase
    .from('solicitudes')
    .update({
      monto_real: montoReal,
      fecha_rendicion: new Date().toISOString(),
      estado: hayDiferencia ? 'pendiente_devolucion' : 'completado'
    })
    .eq('id', solicitud.id)
  if (error) throw error
  return hayDiferencia
}

/* ---------------------------------------------------------- comprobantes */

export async function subirComprobante(o: {
  archivo: File; solicitudId: string; tipo: TipoComprobante; usuarioId: string; descripcion?: string
}): Promise<string> {
  const ext = o.archivo.name.split('.').pop()?.toLowerCase() ?? 'pdf'
  const ruta = `solicitud-${o.solicitudId}/${o.tipo}-${Date.now()}.${ext}`

  const { error: e1 } = await supabase.storage.from('comprobantes').upload(ruta, o.archivo)
  if (e1) throw e1

  const { error: e2 } = await supabase.from('comprobantes').insert({
    solicitud_id: o.solicitudId, archivo_url: ruta, tipo: o.tipo,
    descripcion: o.descripcion ?? null, subido_por_id: o.usuarioId
  })
  if (e2) throw e2
  return ruta
}

export function urlPublica(ruta: string): string {
  return supabase.storage.from('comprobantes').getPublicUrl(ruta).data.publicUrl
}

export async function listarComprobantes(solicitudId: string): Promise<Comprobante[]> {
  const { data, error } = await supabase
    .from('comprobantes').select('*').eq('solicitud_id', solicitudId).order('fecha_subida')
  if (error) throw error
  return data ?? []
}

/* ------------------------------------------------- devoluciones y saldo */

export async function registrarDevolucion(o: {
  solicitudId: string; monto: number; rutaComprobante: string; usuarioId: string; periodoId: string | null
}) {
  const { error } = await supabase.from('movimientos_caja').insert({
    tipo: 'devolucion', monto: o.monto, solicitud_id: o.solicitudId, periodo_id: o.periodoId,
    registrado_por_id: o.usuarioId, comprobante_url: o.rutaComprobante,
    descripcion: 'Devolución de diferencia por QR', estado: 'pendiente_validacion'
  })
  if (error) throw error
}

export async function listarMovimientos(filtros?: { estado?: string; solicitudId?: string }) {
  let q = supabase
    .from('movimientos_caja')
    .select('*, solicitud:solicitudes(id, descripcion, monto_solicitado, solicitante_id)')
    .order('created_at', { ascending: false })
  if (filtros?.estado) q = q.eq('estado', filtros.estado)
  if (filtros?.solicitudId) q = q.eq('solicitud_id', filtros.solicitudId)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as MovimientoCaja[]
}

export async function validarDevolucion(m: MovimientoCaja, adminCajaId: string) {
  const { error: e1 } = await supabase
    .from('movimientos_caja')
    .update({ estado: 'aprobado', aprobado_por_id: adminCajaId, admin_caja_id: adminCajaId })
    .eq('id', m.id)
  if (e1) throw e1

  if (m.solicitud_id) {
    const { error: e2 } = await supabase
      .from('solicitudes').update({ estado: 'completado' }).eq('id', m.solicitud_id)
    if (e2) throw e2
    await agendarAviso('devolucion_validada', 'whatsapp', m.solicitud!.solicitante_id, m.solicitud_id, {
      monto: m.monto
    })
  }
}

export async function obtenerSaldo(periodoId: string | null): Promise<SaldoCaja> {
  // La vista devuelve una fila por período: sin período fijado hay que sumarlas.
  let q = supabase.from('v_saldo_caja').select('*')
  if (periodoId) q = q.eq('periodo_id', periodoId)
  const { data, error } = await q
  if (error) throw error

  const filas = (data ?? []) as SaldoCaja[]
  return filas.reduce<SaldoCaja>((acc, f) => ({
    periodo_id: periodoId,
    saldo: acc.saldo + Number(f.saldo),
    total_desembolsado: acc.total_desembolsado + Number(f.total_desembolsado),
    total_devuelto: acc.total_devuelto + Number(f.total_devuelto),
    total_repuesto: acc.total_repuesto + Number(f.total_repuesto)
  }), { periodo_id: periodoId, saldo: 0, total_desembolsado: 0, total_devuelto: 0, total_repuesto: 0 })
}

/* --------------------------------------------------- rendición de cuentas */

export async function solicitudesSinRendir(): Promise<Solicitud[]> {
  const { data: rendidas, error: e1 } = await supabase.from('informe_solicitudes').select('solicitud_id')
  if (e1) throw e1
  const ids = (rendidas ?? []).map((r) => r.solicitud_id)

  let q = supabase.from('solicitudes').select(SEL_SOL)
    .in('estado', ['completado', 'pendiente_devolucion']).order('fecha_desembolso')
  if (ids.length) q = q.not('id', 'in', `(${ids.join(',')})`)

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as Solicitud[]
}

export async function crearInforme(o: {
  adminCajaId: string; periodoId: string | null; solicitudes: Solicitud[]
  observaciones: string; montoReposicion: number
}): Promise<string> {
  const totalDesembolsado = o.solicitudes.reduce((s, x) => s + Number(x.monto_solicitado), 0)
  const totalDevuelto = o.solicitudes.reduce(
    (s, x) => s + Math.max(Number(x.monto_solicitado) - Number(x.monto_real ?? x.monto_solicitado), 0), 0)
  const fechas = o.solicitudes.map((s) => new Date(s.fecha_creacion).getTime())
  const saldo = await obtenerSaldo(o.periodoId)

  const { data, error } = await supabase.from('informe_rendicion_cuentas').insert({
    periodo_id: o.periodoId,
    admin_caja_id: o.adminCajaId,
    monto_reposicion: o.montoReposicion,
    fecha_inicio_periodo: fechas.length ? new Date(Math.min(...fechas)).toISOString() : null,
    fecha_fin_periodo: fechas.length ? new Date(Math.max(...fechas)).toISOString() : null,
    estado: 'pendiente_daf',
    fecha_envio_daf: new Date().toISOString(),
    total_desembolsado: totalDesembolsado,
    total_devuelto: totalDevuelto,
    saldo_cuenta: saldo.saldo,
    observaciones: o.observaciones
  }).select('id').single()
  if (error) throw error

  const { error: e2 } = await supabase.from('informe_solicitudes')
    .insert(o.solicitudes.map((s) => ({ informe_id: data.id, solicitud_id: s.id })))
  if (e2) throw e2

  const { data: dafs } = await supabase.from('profiles').select('id').eq('role', 'daf').eq('activo', true)
  for (const d of dafs ?? []) {
    await agendarAviso('informe_enviado', 'correo', d.id, data.id, { monto: totalDesembolsado }, 'informe')
  }
  return data.id as string
}

export async function listarInformes(): Promise<InformeRendicion[]> {
  const { data, error } = await supabase
    .from('informe_rendicion_cuentas').select('*').order('fecha_creacion', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function obtenerInforme(id: string) {
  const { data, error } = await supabase
    .from('informe_rendicion_cuentas').select('*').eq('id', id).maybeSingle()
  if (error) throw error

  const { data: rel, error: e2 } = await supabase
    .from('informe_solicitudes').select(`solicitud:solicitudes(${SEL_SOL})`).eq('informe_id', id)
  if (e2) throw e2

  return { informe: data as InformeRendicion | null, solicitudes: (rel ?? []).map((r: any) => r.solicitud as Solicitud) }
}

export async function resolverInforme(informe: InformeRendicion, aprobado: boolean, dafId: string) {
  const { error } = await supabase.from('informe_rendicion_cuentas').update({
    estado: aprobado ? 'aprobado_daf' : 'rechazado',
    fecha_aprobacion_daf: new Date().toISOString(),
    aprobado_por_id: dafId
  }).eq('id', informe.id)
  if (error) throw error

  await agendarAviso('informe_aprobado', 'correo', informe.admin_caja_id, informe.id,
    { estado: aprobado ? 'aprobado' : 'rechazado' }, 'informe')
}

export async function registrarReposicion(informe: InformeRendicion, adminCajaId: string) {
  const { error: e1 } = await supabase.from('movimientos_caja').insert({
    tipo: 'reposicion', monto: informe.monto_reposicion, informe_id: informe.id,
    periodo_id: informe.periodo_id, admin_caja_id: adminCajaId, registrado_por_id: adminCajaId,
    descripcion: 'Reposición de caja chica por contabilidad',
    estado: 'aprobado', aprobado_por_id: adminCajaId
  })
  if (e1) throw e1

  const { error: e2 } = await supabase
    .from('informe_rendicion_cuentas').update({ estado: 'completado' }).eq('id', informe.id)
  if (e2) throw e2
}

/* -------------------------------------------------- reporte para el DAF */

export async function rendicionesPorAdmin(): Promise<RendicionAdmin[]> {
  const { data, error } = await supabase.from('v_rendiciones_por_admin').select('*')
  if (error) throw error
  return (data ?? []) as RendicionAdmin[]
}

/* ------------------------------------------------------------- avisos */

export async function agendarAviso(
  plantilla: string,
  canal: 'whatsapp' | 'correo' | 'ambos',
  destinatarioId: string,
  recursoId: string,
  variables: Record<string, unknown> = {},
  recursoTipo: 'solicitud' | 'informe' = 'solicitud',
  programadaPara?: string
) {
  const { error } = await supabase.from('notificaciones').insert({
    plantilla, canal, destinatario_id: destinatarioId,
    recurso_tipo: recursoTipo, recurso_id: recursoId,
    variables, programada_para: programadaPara ?? new Date().toISOString()
  })
  if (error) console.error('No se pudo agendar el aviso', error)
}

export async function listarAvisos(recursoId?: string): Promise<Notificacion[]> {
  let q = supabase.from('notificaciones').select('*').order('programada_para', { ascending: false }).limit(50)
  if (recursoId) q = q.eq('recurso_id', recursoId)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as Notificacion[]
}
