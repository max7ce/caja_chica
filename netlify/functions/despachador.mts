/**
 * Despachador de avisos. Corre cada 15 minutos.
 *
 * Toma de la agenda lo que ya venció, arma el mensaje y lo manda por WhatsApp,
 * por correo o por ambos. Los recordatorios de plazo los agendó el trigger de
 * la base al momento del desembolso; aquí solo se envían.
 */
import crypto from 'node:crypto'
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'
import type { Config } from '@netlify/functions'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

const URL_PUBLICA = process.env.URL_PUBLICA ?? ''

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? `mailto:${process.env.CORREO_REMITENTE ?? 'cajachica@ucb.edu.bo'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )
}

/** Texto por plantilla. Las de WhatsApp deben estar aprobadas en Meta con el mismo nombre. */
const TEXTOS: Record<string, (v: any) => { asunto: string; cuerpo: string }> = {
  solicitud_nueva: (v) => ({
    asunto: `Solicitud ${corto(v.solicitud)} requiere su autorización`,
    cuerpo: `Nueva solicitud de caja chica.\n${v.descripcion ?? ''}\nMonto: ${bs(v.monto)}\n\n¿Autoriza el desembolso?`
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
    cuerpo: `Ya registraste la rendición en el sistema. Falta entregar al administrador de caja el vale y las facturas originales, con la firma y el sello de tu coordinador al reverso.\nLa solicitud no se cierra hasta ese cotejo.`
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
    cuerpo: `Hay un informe aprobado por el DAF esperando la transferencia de ${bs(v.monto)}.\nProcésala en ${URL_PUBLICA}/reposiciones`
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
    cuerpo: `Se recibió su devolución de ${bs(v.monto)}. La solicitud queda cerrada. Gracias.`
  }),
  informe_enviado: (v) => ({
    asunto: 'Informe de rendición pendiente de aprobación',
    cuerpo: `Hay un informe de rendición esperando su aprobación por ${bs(v.monto)}.\nRevíselo en ${URL_PUBLICA}/rendicion-cuentas`
  }),
  informe_aprobado: (v) => ({
    asunto: `Informe de rendición ${v.estado}`,
    cuerpo: `El informe de rendición fue ${v.estado} por la Dirección Administrativa Financiera.`
  })
}

const bs = (n: any) => Number(n ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 2 }) + ' Bs'
const fecha = (d: any) => d ? new Date(d).toLocaleString('es-BO', { dateStyle: 'medium', timeStyle: 'short' }) : ''
const corto = (id: any) => String(id ?? '').slice(0, 8)

export default async () => {
  const { data: pendientes, error } = await supabase
    .from('notificaciones')
    .select('*, destinatario:profiles!notificaciones_destinatario_id_fkey(id, email, full_name, telefono, whatsapp_optin)')
    .eq('estado', 'pendiente')
    .lte('programada_para', new Date().toISOString())
    .lt('intentos', 3)
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
    const errores: string[] = []

    try {
      // El push va siempre que la persona tenga la app instalada, sea cual sea
      // el canal del aviso: es el más inmediato y el que menos cuesta.
      await enviarPush(aviso, destinatario, asunto, cuerpo)

      if (aviso.canal !== 'correo' && destinatario.telefono && destinatario.whatsapp_optin) {
        await enviarWhatsApp(aviso, destinatario, cuerpo)
      }
      if (aviso.canal !== 'whatsapp' || !destinatario.whatsapp_optin) {
        await enviarCorreo(destinatario.email, asunto, cuerpo)
      }
      await marcar(aviso.id, 'enviada')
    } catch (e: any) {
      errores.push(e.message ?? String(e))
      await supabase.from('notificaciones')
        .update({ intentos: aviso.intentos + 1, error: errores.join(' | ') })
        .eq('id', aviso.id)
    }
  }

  return new Response(`procesados: ${pendientes?.length ?? 0}`, { status: 200 })
}

async function marcar(id: string, estado: string, error?: string) {
  await supabase.from('notificaciones')
    .update({ estado, enviada_en: new Date().toISOString(), error: error ?? null })
    .eq('id', id)
}

/** Los avisos con decisión llevan botones; cada botón es un token de un solo uso. */
async function enviarWhatsApp(aviso: any, destinatario: any, cuerpo: string) {
  const conBotones = aviso.plantilla === 'solicitud_nueva'
  let botones: any[] = []

  if (conBotones) {
    botones = await Promise.all(['aprobar', 'rechazar'].map(async (accion) => {
      const token = crypto.randomBytes(24).toString('hex')
      await supabase.from('tokens_accion').insert({
        token_hash: crypto.createHash('sha256').update(token).digest('hex'),
        usuario_id: destinatario.id,
        recurso_tipo: aviso.recurso_tipo,
        recurso_id: aviso.recurso_id,
        accion
      })
      return { type: 'reply', reply: { id: token, title: accion === 'aprobar' ? 'Autorizar' : 'Rechazar' } }
    }))
  }

  const payload = conBotones
    ? {
        messaging_product: 'whatsapp',
        to: destinatario.telefono,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: cuerpo },
          footer: { text: 'Caja chica · UCB Tarija' },
          action: { buttons: botones }
        }
      }
    : { messaging_product: 'whatsapp', to: destinatario.telefono, text: { body: cuerpo } }

  const r = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!r.ok) throw new Error(`WhatsApp: ${await r.text()}`)
}

/**
 * Push a todos los dispositivos donde la persona instaló la aplicación.
 *
 * Los endpoints caducan: cuando el navegador devuelve 404 o 410 la
 * suscripción ya no sirve y se borra, para no arrastrar basura ni reintentar
 * eternamente contra un dispositivo que se formateó.
 */
async function enviarPush(aviso: any, destinatario: any, titulo: string, cuerpo: string) {
  if (!process.env.VAPID_PRIVATE_KEY) return

  const { data: dispositivos } = await supabase
    .from('push_suscripciones')
    .select('*')
    .eq('usuario_id', destinatario.id)
    .eq('activa', true)

  if (!dispositivos?.length) return

  const destino = aviso.recurso_tipo === 'informe'
    ? `/rendicion-cuentas/${aviso.recurso_id}`
    : `/solicitudes/${aviso.recurso_id}`

  const carga = JSON.stringify({
    titulo: `Caja chica — ${titulo}`,
    cuerpo,
    url: destino,
    tag: `${aviso.recurso_tipo}-${aviso.recurso_id}`
  })

  for (const d of dispositivos) {
    try {
      await webpush.sendNotification(
        { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
        carga
      )
      await supabase.from('push_suscripciones')
        .update({ ultimo_uso: new Date().toISOString() }).eq('id', d.id)
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await supabase.from('push_suscripciones').delete().eq('id', d.id)
      } else {
        console.error('push fallido', d.endpoint.slice(0, 40), e?.statusCode ?? e?.message)
      }
    }
  }
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
  if (!r.ok) throw new Error(`Correo: ${await r.text()}`)
}

export const config: Config = { schedule: '*/15 * * * *' }
