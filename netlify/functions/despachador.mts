/**
 * Despachador de avisos. Corre cada 15 minutos.
 *
 * Toma de la agenda lo que ya venció y lo manda por los canales automáticos:
 *   · push a los dispositivos donde la persona instaló la app;
 *   · correo, salvo en los recordatorios rápidos (canal 'whatsapp' en la
 *     base), que van solo por push y caen al correo si no hay push.
 * Cada canal se intenta por separado: si uno falla, el otro igual sale.
 *
 * El WhatsApp no es automático: lo envía la persona desde la app con el
 * botón "Avisar por WhatsApp", que abre su WhatsApp con el mensaje armado.
 */
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'
import type { Config } from '@netlify/functions'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

const URL_PUBLICA = process.env.URL_PUBLICA ?? ''
const HAY_CORREO = Boolean(process.env.RESEND_API_KEY?.trim() && process.env.CORREO_REMITENTE?.trim())
const MAX_INTENTOS = 3

/** Limpia lo que suele colarse al pegar en Netlify: espacios, comillas, saltos de línea. */
const limpio = (v: string | undefined) => (v ?? '').trim().replace(/^["']|["']$/g, '').trim()

/**
 * Configura el push sin tumbar la función: si una clave tiene un formato
 * inválido, el push queda desactivado y el motivo se registra en cada aviso,
 * mientras el correo sigue funcionando.
 */
let PUSH_LISTO = false
let MOTIVO_SIN_PUSH = 'faltan VAPID_PUBLIC_KEY o VAPID_PRIVATE_KEY en Netlify'
function prepararPush() {
  const publica = limpio(process.env.VAPID_PUBLIC_KEY)
  const privada = limpio(process.env.VAPID_PRIVATE_KEY)
  if (!publica || !privada) return
  let sujeto = limpio(process.env.VAPID_SUBJECT) || limpio(process.env.CORREO_REMITENTE) || 'cajachica@ucb.edu.bo'
  if (!/^(mailto:|https?:\/\/)/i.test(sujeto)) sujeto = `mailto:${sujeto}`
  try {
    webpush.setVapidDetails(sujeto, publica, privada)
    PUSH_LISTO = true
  } catch (e: any) {
    MOTIVO_SIN_PUSH = `claves VAPID inválidas: ${e?.message ?? e}`
    console.error(MOTIVO_SIN_PUSH)
  }
}
prepararPush()

const TEXTOS: Record<string, (v: any) => { asunto: string; cuerpo: string }> = {
  vale_aprobado: (v) => ({
    asunto: 'Tu vale de caja chica fue aprobado',
    cuerpo: `El DAF aprobó tu vale por ${bs(v.monto)}.\n${v.descripcion ?? ''}\nEl administrador de caja te transferirá el monto a tu QR de cobro.`
  }),
  vale_por_pagar: (v) => ({
    asunto: `Vale aprobado, listo para desembolsar (${bs(v.monto)})`,
    cuerpo: `El DAF aprobó un vale por ${bs(v.monto)}.\n${v.descripcion ?? ''}\nDesembólsalo en ${URL_PUBLICA}/caja/desembolsos`
  }),
  devolucion_por_validar: (v) => ({
    asunto: `Devolución por validar (${bs(v.monto)})`,
    cuerpo: `Un solicitante subió el comprobante de su devolución por ${bs(v.monto)}.\n${v.descripcion ?? ''}\nValídala en ${URL_PUBLICA}/caja/validar-devoluciones`
  }),
  rendicion_cerrada: (v) => ({
    asunto: 'Tu rendición quedó cerrada',
    cuerpo: `Se recibieron y verificaron los documentos físicos de tu vale${v.descripcion ? ` (${v.descripcion})` : ''}. La rendición quedó cerrada. Gracias.`
  }),
  saldo_bajo: (v) => ({
    asunto: `Caja chica en ${bs(v.saldo)}: toca armar el informe del ciclo`,
    cuerpo: `El saldo de caja chica llegó a ${bs(v.saldo)} (umbral: ${bs(v.umbral)}).\nEl administrador de caja debe armar el informe del ciclo para pedir la reposición: ${URL_PUBLICA}/rendicion-cuentas`
  }),
  solicitud_nueva: (v) => ({
    asunto: `Solicitud ${corto(v.solicitud)} requiere su autorización`,
    cuerpo: `Nueva solicitud de caja chica.\n${v.descripcion ?? ''}\nMonto: ${bs(v.monto)}\n\nAutorícela en ${URL_PUBLICA}/aprobaciones`
  }),
  solicitud_rechazada: (v) => ({
    asunto: 'Su solicitud no fue autorizada',
    cuerpo: `Su solicitud de caja chica no fue autorizada.\nMotivo: ${v.motivo ?? 'sin detalle'}`
  }),
  desembolso_hecho: (v) => ({
    asunto: 'Desembolso realizado — plazo de rendición en curso',
    cuerpo: `Se transfirieron ${bs(v.monto)}.\nTiene plazo para rendir hasta el ${fecha(v.limite)}.\nSuba el comprobante y devuelva la diferencia antes de esa fecha.`
  }),
  plazo_24h: (v) => ({
    asunto: 'Quedan 24 horas para rendir',
    cuerpo: `Recordatorio: quedan 24 horas para rendir su vale de caja chica.\nVence el ${fecha(v.limite)}.`
  }),
  plazo_8h: (v) => ({
    asunto: 'Quedan 8 horas para rendir',
    cuerpo: `Últimas horas para rendir su vale de caja chica.\nVence el ${fecha(v.limite)}.`
  }),
  plazo_vencido: (v) => ({
    asunto: 'Plazo de rendición vencido',
    cuerpo: `El plazo para rendir su vale de caja chica venció el ${fecha(v.limite)}.\nHasta regularizarlo no podrá solicitar vales nuevos.`
  }),
  entregar_fisico: (v) => ({
    asunto: 'Falta entregar la documentación en papel',
    cuerpo: `Ya registraste la rendición en el sistema. Falta entregar al administrador de caja el vale y las facturas originales, firmados por tu superior inmediato.\nLa rendición no se da por válida hasta ese cotejo.`
  }),
  fisico_por_recibir: (v) => ({
    asunto: 'Documentación física por recibir',
    cuerpo: `Hay una rendición esperando el cotejo del papel por ${bs(v.monto)}.\nRevísala en ${URL_PUBLICA}/caja/validar-devoluciones`
  }),
  observacion_respondida: (v) => ({
    asunto: 'Respondieron una observación',
    cuerpo: `Un solicitante respondió la observación de su rendición.\n${v.respuesta ?? ''}\nVuelve a revisarla en ${URL_PUBLICA}/caja/validar-devoluciones`
  }),
  documentacion_observada: (v) => ({
    asunto: 'Tu documentación fue observada',
    cuerpo: `El administrador de caja observó la documentación de tu rendición.\nMotivo: ${v.observacion ?? 'sin detalle'}\nHay que subsanarlo para poder cerrar la solicitud.`
  }),
  reposicion_por_procesar: (v) => ({
    asunto: 'Reposición de caja chica por procesar',
    cuerpo: `El administrador de caja pidió la reposición de ${bs(v.monto)} sobre un informe aprobado por el DAF.\nProcésala en ${URL_PUBLICA}/reposiciones`
  }),
  reposicion_hecha: (v) => ({
    asunto: 'Reposición acreditada',
    cuerpo: `Contabilidad transfirió la reposición de ${bs(v.monto)}. El saldo de caja ya está disponible.`
  }),
  aval_registrado: (v) => ({
    asunto: 'Tu coordinador emitió su dictamen',
    cuerpo: v.avalada
      ? 'Tu coordinador avaló la solicitud. Ya pasó al DAF para su autorización.'
      : `Tu coordinador no avaló la solicitud, pero igual pasó al DAF.\nObservación: ${v.observacion ?? 'sin detalle'}`
  }),
  solicitud_por_avalar: (v) => ({
    asunto: 'Una solicitud de tu oficina espera tu aval',
    cuerpo: `${v.descripcion ?? ''}\nMonto: ${bs(v.monto)}\n\n¿La avalas?`
  }),
  solicitud_avalada: (v) => ({
    asunto: 'Solicitud avalada, pendiente de autorización',
    cuerpo: `${v.descripcion ?? ''}\nMonto: ${bs(v.monto)}\nAval del coordinador: ${v.avalada ? 'favorable' : 'desfavorable'}${v.observacion ? ` — ${v.observacion}` : ''}`
  }),
  devolucion_validada: (v) => ({
    asunto: 'Devolución recibida',
    cuerpo: `Se validó su devolución de ${bs(v.monto)}. Para cerrar la rendición falta entregar al administrador de caja el vale y las facturas originales, firmados por su superior.`
  }),
  informe_enviado: (v) => ({
    asunto: 'Informe de rendición pendiente de aprobación',
    cuerpo: `Hay un informe de rendición esperando su aprobación por ${bs(v.monto)}.\nRevíselo en ${URL_PUBLICA}/rendicion-cuentas`
  }),
  informe_aprobado: (v) => ({
    asunto: `Informe de rendición ${v.estado}`,
    cuerpo: v.estado === 'aprobado'
      ? `El informe de rendición fue aprobado por la Dirección Administrativa Financiera. Entra al informe y haz el pedido de reposición: ${URL_PUBLICA}/rendicion-cuentas`
      : `El informe de rendición fue rechazado por la Dirección Administrativa Financiera. Sus solicitudes vuelven a quedar disponibles para el próximo informe.`
  })
}

const bs = (n: any) => Number(n ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 2 }) + ' Bs'
const fecha = (d: any) => d
  ? new Date(d).toLocaleString('es-BO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/La_Paz' })
  : ''
const corto = (id: any) => String(id ?? '').slice(0, 8)

export default async () => {
  try {
    return await despachar()
  } catch (e: any) {
    console.error('despachador', e)
    return new Response(`error: ${e?.message ?? e}`, { status: 500 })
  }
}

async function despachar() {
  const { data: pendientes, error } = await supabase
    .from('notificaciones')
    .select('*, destinatario:profiles!notificaciones_destinatario_id_fkey(id, email, full_name)')
    .eq('estado', 'pendiente')
    .lte('programada_para', new Date().toISOString())
    .lt('intentos', MAX_INTENTOS)
    .order('programada_para')
    .limit(50)

  if (error) return new Response(error.message, { status: 500 })

  for (const aviso of pendientes ?? []) {
    const plantilla = TEXTOS[aviso.plantilla]
    const destinatario: any = (aviso as any).destinatario
    if (!plantilla || !destinatario) {
      await marcar(aviso.id, 'fallida', 'plantilla o destinatario desconocido')
      continue
    }
    const { asunto, cuerpo } = plantilla(aviso.variables ?? {})

    const enviados: string[] = []
    const errores: string[] = []

    // 1. Push
    try {
      if (await enviarPush(aviso, destinatario, asunto, cuerpo) > 0) enviados.push('push')
    } catch (e: any) { errores.push(`Push: ${e.message ?? e}`) }

    // 2. Correo: siempre, salvo en recordatorios rápidos que ya llegaron por push
    const quiereCorreo = aviso.canal !== 'whatsapp' || !enviados.includes('push')
    if (quiereCorreo && HAY_CORREO && destinatario.email) {
      try { await enviarCorreo(destinatario.email, asunto, cuerpo); enviados.push('correo') }
      catch (e: any) { errores.push(`Correo: ${e.message ?? e}`) }
    }

    if (enviados.length) {
      await marcar(aviso.id, 'enviada', errores.join(' | ') || null, enviados.join('+'))
    } else if (!errores.length) {
      // Ningún canal disponible: sin push instalado y sin correo configurado.
      // Se marca y no se reintenta, para no soltar avisos viejos cuando se
      // configuren los canales.
      const motivos = [
        PUSH_LISTO ? 'el destinatario no activó los avisos push' : `push: ${MOTIVO_SIN_PUSH}`,
        HAY_CORREO ? 'sin correo del destinatario' : 'correo no configurado'
      ]
      await marcar(aviso.id, 'fallida', `sin canal disponible (${motivos.join('; ')})`)
    } else {
      const intentos = aviso.intentos + 1
      await supabase.from('notificaciones').update({
        intentos, error: errores.join(' | '),
        ...(intentos >= MAX_INTENTOS ? { estado: 'fallida' } : {})
      }).eq('id', aviso.id)
    }
  }

  return new Response(`procesados: ${pendientes?.length ?? 0}`, { status: 200 })
}

async function marcar(id: string, estado: string, error: string | null = null, proveedor?: string) {
  await supabase.from('notificaciones')
    .update({ estado, enviada_en: new Date().toISOString(), error, ...(proveedor ? { proveedor_id: proveedor } : {}) })
    .eq('id', id)
}

/**
 * Push a todos los dispositivos donde la persona instaló la aplicación.
 * Devuelve cuántos lo recibieron. Las suscripciones vencidas (404/410) se
 * borran para no reintentar contra un dispositivo que ya no existe.
 */
async function enviarPush(aviso: any, destinatario: any, titulo: string, cuerpo: string): Promise<number> {
  if (!PUSH_LISTO) return 0

  const { data: dispositivos } = await supabase
    .from('push_suscripciones')
    .select('*')
    .eq('usuario_id', destinatario.id)
    .eq('activa', true)
  if (!dispositivos?.length) return 0

  const destino = aviso.recurso_tipo === 'informe'
    ? `/rendicion-cuentas/${aviso.recurso_id}`
    : `/solicitudes/${aviso.recurso_id}`
  const carga = JSON.stringify({
    titulo: `Caja chica — ${titulo}`,
    cuerpo,
    url: destino,
    tag: `${aviso.plantilla}-${aviso.recurso_id}`
  })

  let entregados = 0
  const fallos: string[] = []
  for (const d of dispositivos) {
    try {
      await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, carga)
      entregados++
      await supabase.from('push_suscripciones').update({ ultimo_uso: new Date().toISOString() }).eq('id', d.id)
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await supabase.from('push_suscripciones').delete().eq('id', d.id)
      } else {
        fallos.push(`${e?.statusCode ?? ''} ${e?.body ?? e?.message ?? e}`.trim())
      }
    }
  }
  // Si ningún dispositivo lo recibió por un error real (por ejemplo, la
  // clave pública de Netlify no coincide con la de la app), se registra.
  if (!entregados && fallos.length) throw new Error(fallos.join(' | ').slice(0, 300))
  return entregados
}

async function enviarCorreo(para: string, asunto: string, cuerpo: string) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `Caja chica UCB <${process.env.CORREO_REMITENTE}>`,
      to: [para],
      subject: asunto,
      text: `${cuerpo}\n\n—\nDirección Administrativa Financiera\nUniversidad Católica Boliviana "San Pablo" · Sede Tarija`
    })
  })
  if (!r.ok) throw new Error(await r.text())
}

export const config: Config = { schedule: '*/15 * * * *' }
