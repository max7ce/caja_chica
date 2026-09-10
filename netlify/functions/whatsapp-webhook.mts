/**
 * Webhook de WhatsApp Cloud API.
 *
 * Meta llama a esta URL cuando alguien responde o toca un botón. Verifica la
 * firma antes de procesar nada, resuelve el token de un solo uso y aplica la
 * decisión. Es la única pieza que escribe con service_role además del
 * despachador, y nunca confía en el cuerpo sin validar.
 *
 * Configurar en Meta → Webhooks:
 *   URL:   https://tu-sitio.netlify.app/.netlify/functions/whatsapp-webhook
 *   Token: el mismo valor de WHATSAPP_VERIFY_TOKEN
 */
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Context } from '@netlify/functions'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

function firmaValida(cuerpo: string, cabecera: string | null): boolean {
  if (!cabecera || !process.env.META_APP_SECRET) return false
  const esperada = 'sha256=' + crypto
    .createHmac('sha256', process.env.META_APP_SECRET)
    .update(cuerpo)
    .digest('hex')
  // Comparación en tiempo constante: evita filtrar la firma por temporización.
  const a = Buffer.from(esperada)
  const b = Buffer.from(cabecera)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function hash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export default async (request: Request, _context: Context) => {
  // Verificación inicial del webhook (Meta la hace una sola vez)
  if (request.method === 'GET') {
    const url = new URL(request.url)
    if (url.searchParams.get('hub.verify_token') === process.env.WHATSAPP_VERIFY_TOKEN) {
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 })
    }
    return new Response('token inválido', { status: 403 })
  }

  const cuerpo = await request.text()
  if (!firmaValida(cuerpo, request.headers.get('x-hub-signature-256'))) {
    return new Response('firma inválida', { status: 401 })
  }

  const evento = JSON.parse(cuerpo)
  const mensaje = evento?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
  const respuesta = mensaje?.interactive?.button_reply
  if (!respuesta) return new Response('ok', { status: 200 })

  // El id del botón es el token de un solo uso que generó el despachador.
  const { data: token } = await supabase
    .from('tokens_accion')
    .select('*')
    .eq('token_hash', hash(respuesta.id))
    .is('usado_en', null)
    .gt('expira_en', new Date().toISOString())
    .maybeSingle()

  if (!token) {
    await responder(mensaje.from, 'Ese botón ya se usó o venció. Abre el sistema para decidir.')
    return new Response('ok', { status: 200 })
  }

  if (token.recurso_tipo === 'solicitud') {
    const aprobar = token.accion === 'aprobar'
    await supabase.from('solicitudes').update({
      estado: aprobar ? 'aprobado_daf' : 'rechazado',
      aprobado_por_id: token.usuario_id,
      origen_decision: 'whatsapp',
      motivo_rechazo: aprobar ? null : 'Rechazada desde WhatsApp'
    }).eq('id', token.recurso_id).eq('estado', 'pendiente_daf')

    await responder(mensaje.from, aprobar
      ? 'Listo, la solicitud quedó autorizada.'
      : 'La solicitud quedó rechazada.')
  }

  await supabase.from('tokens_accion')
    .update({ usado_en: new Date().toISOString() })
    .eq('id', token.id)

  return new Response('ok', { status: 200 })
}

async function responder(a: string, texto: string) {
  await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: a, text: { body: texto } })
  })
}
