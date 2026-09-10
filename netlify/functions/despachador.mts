/**
 * Despachador de avisos. Corre cada 15 minutos.
 *
 * Toma de la agenda lo que ya venció, arma el mensaje y lo manda por WhatsApp,
 * por correo o por ambos. Los recordatorios de plazo los agendó el trigger de
 * la base al momento del desembolso; aquí solo se envían.
 */
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Config } from '@netlify/functions'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

const URL_PUBLICA = process.env.URL_PUBLICA ?? ''

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
