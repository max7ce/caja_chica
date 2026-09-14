export type Rol = 'super_admin' | 'solicitante' | 'daf' | 'admin_caja' | 'contabilidad'

export type EstadoSolicitud =
  | 'pendiente_coordinador' | 'pendiente_daf' | 'aprobado_daf' | 'desembolsado'
  | 'pendiente_devolucion' | 'completado' | 'rechazado'

export type EstadoInforme = 'borrador' | 'pendiente_daf' | 'aprobado_daf' | 'completado' | 'rechazado'
export type TipoComprobante = 'compra' | 'devolucion'
export type TipoMovimiento = 'desembolso' | 'devolucion' | 'reposicion'
export type EstadoMovimiento = 'pendiente_validacion' | 'aprobado'
export type CanalAviso = 'whatsapp' | 'correo' | 'ambos'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: Rol
  departamento: string | null
  telefono: string | null
  whatsapp_optin: boolean
  activo: boolean
  oficina_id: string | null
  cargo: string | null
  qr_url: string | null
  oficina?: Pick<Oficina, 'id' | 'nombre' | 'coordinador_id'> | null
}

export interface Oficina {
  id: string
  nombre: string
  coordinador_id: string | null
  activa: boolean
  coordinador?: Pick<Profile, 'id' | 'full_name' | 'email'> | null
}

export interface Parametros {
  id: number
  tope_solicitud: number
  umbral_reposicion: number
  monto_reposicion: number
  plazo_rendicion_horas: number
  pausar_fin_semana: boolean
  bloquear_si_vencida: boolean
  correos_contabilidad: string[]
  qr_caja_url: string | null
}

export interface Periodo {
  id: string
  admin_caja_id: string
  etiqueta: string
  fecha_inicio: string
  fecha_fin: string | null
  fondo_asignado: number
  estado: 'vigente' | 'cerrado'
  admin?: Pick<Profile, 'id' | 'full_name'> | null
}

export interface Solicitud {
  id: string
  solicitante_id: string
  periodo_id: string | null
  monto_solicitado: number
  monto_real: number | null
  descripcion: string
  categoria: string | null
  estado: EstadoSolicitud
  motivo_rechazo: string | null
  origen_decision: 'app' | 'whatsapp' | 'correo' | null
  coordinador_id: string | null
  aval_coordinador: boolean | null
  observacion_coordinador: string | null
  fecha_aval_coordinador: string | null
  fecha_creacion: string
  fecha_desembolso: string | null
  limite_tiempo_devolucion: string | null
  fecha_rendicion: string | null
  fecha_cierre: string | null
  admin_caja_id: string | null
  aprobado_por_id: string | null
  solicitante?: Pick<Profile, 'id' | 'full_name' | 'email' | 'departamento' | 'qr_url'> | null
}

export interface Comprobante {
  id: string
  solicitud_id: string
  archivo_url: string
  tipo: TipoComprobante
  descripcion: string | null
  fecha_subida: string
  subido_por_id: string
}

export interface MovimientoCaja {
  id: string
  tipo: TipoMovimiento
  monto: number
  solicitud_id: string | null
  informe_id: string | null
  comprobante_url: string | null
  estado: EstadoMovimiento
  created_at: string
  solicitud?: Pick<Solicitud, 'id' | 'descripcion' | 'monto_solicitado' | 'solicitante_id'> | null
}

export interface InformeRendicion {
  id: string
  periodo_id: string | null
  admin_caja_id: string
  monto_reposicion: number
  fecha_inicio_periodo: string | null
  fecha_fin_periodo: string | null
  estado: EstadoInforme
  total_desembolsado: number
  total_devuelto: number
  saldo_cuenta: number
  observaciones: string | null
  fecha_creacion: string
  fecha_envio_daf: string | null
  fecha_aprobacion_daf: string | null
}

export interface SaldoCaja {
  periodo_id: string | null
  saldo: number
  total_desembolsado: number
  total_devuelto: number
  total_repuesto: number
}

export interface RendicionAdmin {
  periodo_id: string
  admin_caja_id: string
  admin_nombre: string | null
  periodo: string
  estado_periodo: 'vigente' | 'cerrado'
  informes: number
  monto_rendido: number
  dias_aprobacion: number | null
  informes_abiertos: number
  solicitudes: number
  pct_en_plazo: number | null
}

export interface Notificacion {
  id: string
  plantilla: string
  canal: CanalAviso
  destinatario_id: string
  recurso_tipo: 'solicitud' | 'informe'
  recurso_id: string
  programada_para: string
  estado: 'pendiente' | 'enviada' | 'fallida' | 'cancelada'
  enviada_en: string | null
}

export const ETIQUETA_ESTADO: Record<EstadoSolicitud, string> = {
  pendiente_coordinador: 'Esperando al coordinador',
  pendiente_daf: 'Esperando al DAF',
  aprobado_daf: 'Lista para desembolso',
  desembolsado: 'Por rendir',
  pendiente_devolucion: 'Devolución pendiente',
  completado: 'Cerrada',
  rechazado: 'Rechazada'
}

export const ETIQUETA_ROL: Record<Rol, string> = {
  super_admin: 'Administrador general',
  solicitante: 'Solicitante',
  daf: 'DAF',
  admin_caja: 'Administrador de caja',
  contabilidad: 'Contabilidad'
}

export const CATEGORIAS = ['Materiales', 'Refrigerios', 'Transporte', 'Mantenimiento', 'Imprenta', 'Otros']
