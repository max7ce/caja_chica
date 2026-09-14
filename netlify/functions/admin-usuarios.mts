/**
 * Restablecimiento de contraseñas.
 *
 * Cambiar la contraseña de otra persona exige la llave de servicio, y esa
 * llave no puede estar en el navegador bajo ninguna circunstancia. Por eso
 * vive aquí: la función recibe el token de sesión de quien la llama, lo
 * valida contra Supabase, comprueba que sea super_admin y recién entonces
 * actúa. Sin ese triple control, cualquiera con la URL podría cambiarle la
 * contraseña a cualquiera.
 */
import { createClient } from '@supabase/supabase-js'
import type { Context } from '@netlify/functions'

const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

export default async (request: Request, _context: Context) => {
  if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Falta el token de sesión' }, 401)

  // 1. ¿Quién llama?
  const { data: quien, error: eToken } = await admin.auth.getUser(token)
  if (eToken || !quien.user) return json({ error: 'Sesión inválida o vencida' }, 401)

  // 2. ¿Tiene permiso?
  const { data: perfil } = await admin
    .from('profiles').select('role, activo').eq('id', quien.user.id).maybeSingle()

  if (!perfil?.activo || perfil.role !== 'super_admin') {
    return json({ error: 'Solo el administrador general puede restablecer contraseñas' }, 403)
  }

  // 3. ¿Sobre quién?
  let cuerpo: { usuarioId?: string; password?: string }
  try {
    cuerpo = await request.json()
  } catch {
    return json({ error: 'Cuerpo inválido' }, 400)
  }

  const { usuarioId, password } = cuerpo
  if (!usuarioId || !password || password.length < 6) {
    return json({ error: 'Faltan datos o la contraseña es muy corta' }, 400)
  }

  const { data: destino } = await admin
    .from('profiles').select('email, full_name').eq('id', usuarioId).maybeSingle()
  if (!destino) return json({ error: 'Ese usuario no existe' }, 404)

  const { error } = await admin.auth.admin.updateUserById(usuarioId, {
    password,
    email_confirm: true // por si quedó sin confirmar de una carga masiva
  })
  if (error) return json({ error: error.message }, 500)

  console.log(`Contraseña restablecida para ${destino.email} por ${quien.user.email}`)

  return json({ ok: true, email: destino.email, nombre: destino.full_name })
}
