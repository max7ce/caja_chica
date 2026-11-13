import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { bs, fechaHora } from './formato'
import type { InformeRendicion, Rol, Solicitud } from '../types/database'

/**
 * WhatsApp sin integración con Meta: la app arma el mensaje y abre el
 * WhatsApp de quien está usando el equipo (web o celular) con el texto ya
 * escrito. La persona solo pulsa Enviar.
 */

export interface Contacto { nombre: string; telefono: string | null }
export interface AvisoWa { para: Contacto; texto: string; motivo: string }

/** Celular boliviano a formato internacional sin "+" (591 + 8 dígitos). */
export function normalizarCelular(tel: string | null | undefined): string | null {
  const d = (tel ?? '').replace(/\D/g, '')
  if (/^[67]\d{7}$/.test(d)) return `591${d}`
  if (/^591[67]\d{7}$/.test(d)) return d
  if (d.length >= 10 && d.length <= 15) return d   // otro país, ya con código
  return null
}

/** Enlace que abre WhatsApp con el mensaje. Sin número, deja elegir el contacto. */
export function enlaceWhatsApp(tel: string | null | undefined, texto: string) {
  const n = normalizarCelular(tel)
  return `https://wa.me/${n ?? ''}?text=${encodeURIComponent(texto)}`
}

/* ------------------------------------------- panel "Avisa por WhatsApp" */

let pendientes: AvisoWa[] = []
const oyentes = new Set<() => void>()
const emitir = () => oyentes.forEach((f) => f())

/** Muestra el panel con los avisos sugeridos tras una acción. */
export function ofrecerWhatsApp(avisos: AvisoWa[]) {
  pendientes = avisos.filter((a) => a.texto)
  emitir()
}
export function cerrarWhatsApp() { pendientes = []; emitir() }
export function useAvisosWhatsApp() {
  return useSyncExternalStore(
    (f) => { oyentes.add(f); return () => oyentes.delete(f) },
    () => pendientes
  )
}

/**
 * Ofrece el panel sin que un fallo al armarlo (por ejemplo, un contacto que
 * no se pudo leer) afecte la acción que ya se completó.
 */
export function ofrecerLuego(armar: () => Promise<AvisoWa[]>) {
  armar().then(ofrecerWhatsApp).catch((e) => console.warn('No se pudo armar el aviso de WhatsApp', e))
}

/* ------------------------------------------------------------ contactos */

export async function contactosPorRol(rol: Rol): Promise<Contacto[]> {
  const { data } = await supabase.from('profiles').select('full_name, email, telefono')
    .eq('role', rol).eq('activo', true)
  return (data ?? []).map((p) => ({ nombre: p.full_name ?? p.email, telefono: p.telefono }))
}

export async function contactoPorId(id: string | null | undefined): Promise<Contacto> {
  if (!id) return { nombre: 'el administrador de caja', telefono: null }
  const { data } = await supabase.from('profiles').select('full_name, email, telefono').eq('id', id).maybeSingle()
  return { nombre: data?.full_name ?? data?.email ?? 'el administrador de caja', telefono: data?.telefono ?? null }
}

async function adminDeCaja(): Promise<Contacto> {
  const { data } = await supabase.from('periodos_gestion').select('admin_caja_id').eq('estado', 'vigente').maybeSingle()
  return contactoPorId(data?.admin_caja_id)
}

function solicitante(s: Solicitud): Contacto {
  return { nombre: s.solicitante?.full_name ?? 'el solicitante', telefono: s.solicitante?.telefono ?? null }
}

/* ------------------------------------------------------------- mensajes */

const app = () => (typeof window !== 'undefined' ? window.location.origin : '')
const pie = '\n\n— Caja chica UCB Tarija'
const nro = (id: string) => id.slice(0, 8)
const nroInf = (i: InformeRendicion) => (i.numero ? `N.º ${i.numero}/${i.gestion}` : '')
const primer = (n: string) => n.split(' ')[0]
const titulo = (s: Solicitud) => `«${s.descripcion}» (vale ${nro(s.id)})`

export const avisos = {
  /** Coordinador → DAF */
  async avalado(s: Solicitud, avala: boolean): Promise<AvisoWa[]> {
    return (await contactosPorRol('daf')).map((daf) => ({
      para: daf, motivo: 'Para que autorice el vale',
      texto: `Hola ${primer(daf.nombre)}. ${avala ? 'Avalé' : 'Revisé (sin aval)'} el vale de caja chica ${titulo(s)} por ${bs(s.monto_solicitado)}. Queda pendiente de su autorización:\n${app()}/solicitudes/${s.id}${pie}`
    }))
  },

  /** DAF aprueba → solicitante y administrador de caja */
  async aprobado(s: Solicitud): Promise<AvisoWa[]> {
    const admin = await adminDeCaja()
    const sol = solicitante(s)
    return [
      { para: admin, motivo: 'Para que desembolse',
        texto: `Hola ${primer(admin.nombre)}. Autoricé el vale ${titulo(s)} de ${sol.nombre} por ${bs(s.monto_solicitado)}. Ya puede desembolsarlo:\n${app()}/caja/desembolsos${pie}` },
      { para: sol, motivo: 'Para que sepa que fue aprobado',
        texto: `Hola ${primer(sol.nombre)}. Tu vale de caja chica ${titulo(s)} por ${bs(s.monto_solicitado)} fue aprobado. El administrador de caja te lo transferirá a tu QR de cobro.${pie}` }
    ]
  },

  /** DAF rechaza → solicitante */
  async rechazado(s: Solicitud, motivo: string): Promise<AvisoWa[]> {
    const sol = solicitante(s)
    return [{ para: sol, motivo: 'Para que sepa el motivo',
      texto: `Hola ${primer(sol.nombre)}. Tu vale de caja chica ${titulo(s)} no fue autorizado.${motivo ? `\nMotivo: ${motivo}` : ''}${pie}` }]
  },

  /** Administrador desembolsa → solicitante (con el plazo) */
  async desembolsado(s: Solicitud): Promise<AvisoWa[]> {
    const { data } = await supabase.from('solicitudes').select('limite_tiempo_devolucion').eq('id', s.id).maybeSingle()
    const sol = solicitante(s)
    return [{ para: sol, motivo: 'Para que rinda a tiempo',
      texto: `Hola ${primer(sol.nombre)}. Te transferí ${bs(s.monto_solicitado)} por el vale ${titulo(s)}.\nTienes plazo para rendir hasta el ${fechaHora(data?.limite_tiempo_devolucion ?? null)}: carga tus facturas y, si sobra, devuelve la diferencia por QR.\n${app()}/solicitudes/${s.id}${pie}` }]
  },

  /** Recordatorio manual del plazo → solicitante */
  async recordarPlazo(s: Solicitud): Promise<AvisoWa[]> {
    const sol = solicitante(s)
    return [{ para: sol, motivo: 'Recordatorio de plazo',
      texto: `Hola ${primer(sol.nombre)}. Te recuerdo que el plazo para rendir el vale ${titulo(s)} vence el ${fechaHora(s.limite_tiempo_devolucion)}.\n${app()}/solicitudes/${s.id}${pie}` }]
  },

  /** Administrador valida la devolución → solicitante */
  async devolucionValidada(s: Solicitud, monto: number): Promise<AvisoWa[]> {
    const sol = solicitante(s)
    return [{ para: sol, motivo: 'Para que entregue el físico',
      texto: `Hola ${primer(sol.nombre)}. Recibí tu devolución de ${bs(monto)} del vale ${titulo(s)}. Para cerrar la rendición falta que me entregues el vale y las facturas originales, firmados por tu superior.${pie}` }]
  },

  /** Cotejo físico → solicitante */
  async cotejo(s: Solicitud, conforme: boolean, observacion: string): Promise<AvisoWa[]> {
    const sol = solicitante(s)
    return [{ para: sol, motivo: conforme ? 'Rendición cerrada' : 'Para que corrija',
      texto: conforme
        ? `Hola ${primer(sol.nombre)}. Recibí y verifiqué los documentos físicos del vale ${titulo(s)}. Tu rendición quedó cerrada. Gracias.${pie}`
        : `Hola ${primer(sol.nombre)}. Observé la documentación física del vale ${titulo(s)}.${observacion ? `\nMotivo: ${observacion}` : ''}\nCorrígelo y vuelve a entregarla para cerrar la rendición.\n${app()}/solicitudes/${s.id}${pie}` }]
  },

  /** Administrador envía el informe → DAF */
  async informeEnviado(i: InformeRendicion): Promise<AvisoWa[]> {
    return (await contactosPorRol('daf')).map((daf) => ({
      para: daf, motivo: 'Para que lo reciba y lo firme',
      texto: `Hola ${primer(daf.nombre)}. Le envié el informe de rendición de caja chica ${nroInf(i)}, con una reposición de ${bs(i.monto_reposicion)}. Le llevo el informe impreso y firmado para su firma y envío a Rectorado:\n${app()}/rendicion-cuentas/${i.id}${pie}`
    }))
  },

  /** DAF firma y lo manda a Rectorado → administrador */
  async informeEnRectorado(i: InformeRendicion): Promise<AvisoWa[]> {
    const admin = await contactoPorId(i.admin_caja_id)
    return [{ para: admin, motivo: 'Para que sepa dónde está el informe',
      texto: `Hola ${primer(admin.nombre)}. Recibí y firmé el informe de rendición ${nroInf(i)}; ya lo envié a Rectorado. Cuando vuelva firmado le daré el OK para que pida la reposición de ${bs(i.monto_reposicion)}.${pie}` }]
  },

  /** DAF da el OK o rechaza → administrador */
  async informeResuelto(i: InformeRendicion, aprobado: boolean, motivo = ''): Promise<AvisoWa[]> {
    const admin = await contactoPorId(i.admin_caja_id)
    return [{ para: admin, motivo: aprobado ? 'Para que pida la reposición' : 'Para que lo rehaga',
      texto: aprobado
        ? `Hola ${primer(admin.nombre)}. El informe de rendición ${nroInf(i)} volvió firmado por Rectorado y le di el OK. Ya puede pedir la reposición de ${bs(i.monto_reposicion)} a Contabilidad:\n${app()}/rendicion-cuentas/${i.id}${pie}`
        : `Hola ${primer(admin.nombre)}. Rechacé el informe de rendición ${nroInf(i)}.${motivo ? `\nMotivo: ${motivo}` : ''}\nSus vales vuelven a quedar disponibles para armarlo de nuevo:\n${app()}/rendicion-cuentas${pie}` }]
  },

  /** Administrador pide la reposición → contabilidad */
  async reposicionPedida(i: InformeRendicion): Promise<AvisoWa[]> {
    return (await contactosPorRol('contabilidad')).map((c) => ({
      para: c, motivo: 'Para que transfiera',
      texto: `Hola ${primer(c.nombre)}. El informe de rendición de caja chica ${nroInf(i)} ya tiene las firmas del DAF y de Rectorado, y pedí la reposición de ${bs(i.monto_reposicion)}. Por favor transfiérela a mi QR de cobro:\n${app()}/reposiciones${pie}`
    }))
  },

  /** Contabilidad confirma la reposición → administrador */
  async reposicionHecha(i: InformeRendicion): Promise<AvisoWa[]> {
    const admin = await contactoPorId(i.admin_caja_id)
    return [{ para: admin, motivo: 'Para que confirme el saldo',
      texto: `Hola ${primer(admin.nombre)}. Transferí la reposición de caja chica de ${bs(i.monto_reposicion)} a tu QR de cobro. El saldo ya está disponible.${pie}` }]
  }
}
