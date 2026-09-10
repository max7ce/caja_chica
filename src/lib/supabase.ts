import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.error('Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. Cargalas en Netlify y volvé a desplegar.')
}

export const supabase = createClient(url, anonKey)

/**
 * Cliente aparte para dar de alta usuarios desde el panel: misma anon key,
 * pero sin persistir sesión, así el signUp no reemplaza la del administrador.
 */
export function crearClienteAltas() {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'sb-altas' }
  })
}
