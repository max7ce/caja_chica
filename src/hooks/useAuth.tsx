import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { misOficinas, obtenerParametros, obtenerPerfil, periodoVigente } from '../lib/api'
import type { Oficina, Parametros, Periodo, Profile, Rol } from '../types/database'

interface Ctx {
  session: Session | null
  perfil: Profile | null
  parametros: Parametros | null
  periodo: Periodo | null
  oficinasQueCoordino: Oficina[]
  esCoordinador: boolean
  cargando: boolean
  tieneRol: (roles: Rol[]) => boolean
  iniciarSesion: (email: string, password: string) => Promise<void>
  cerrarSesion: () => Promise<void>
  recargar: () => Promise<void>
}

const C = createContext<Ctx | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Profile | null>(null)
  const [parametros, setParametros] = useState<Parametros | null>(null)
  const [periodo, setPeriodo] = useState<Periodo | null>(null)
  const [oficinasQueCoordino, setOficinas] = useState<Oficina[]>([])
  const [cargando, setCargando] = useState(true)

  const cargarContexto = useCallback(async (userId?: string) => {
    if (!userId) { setPerfil(null); setParametros(null); setPeriodo(null); setOficinas([]); return }
    try {
      const [p, par, per, ofis] = await Promise.all([
        obtenerPerfil(userId), obtenerParametros(), periodoVigente(), misOficinas(userId)
      ])
      setPerfil(p); setParametros(par); setPeriodo(per); setOficinas(ofis)
    } catch (e) {
      console.error('No se pudo cargar el contexto', e)
    }
  }, [])

  useEffect(() => {
    let vivo = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!vivo) return
      setSession(data.session)
      await cargarContexto(data.session?.user.id)
      setCargando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      cargarContexto(s?.user.id)
    })
    return () => { vivo = false; sub.subscription.unsubscribe() }
  }, [cargarContexto])

  const valor = useMemo<Ctx>(() => ({
    session, perfil, parametros, periodo, cargando,
    oficinasQueCoordino,
    esCoordinador: oficinasQueCoordino.length > 0,
    tieneRol: (roles) => !!perfil && roles.includes(perfil.role),
    iniciarSesion: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    },
    cerrarSesion: async () => { await supabase.auth.signOut(); setPerfil(null) },
    recargar: async () => cargarContexto(session?.user.id)
  }), [session, perfil, parametros, periodo, oficinasQueCoordino, cargando, cargarContexto])

  return <C.Provider value={valor}>{children}</C.Provider>
}

export function useAuth() {
  const ctx = useContext(C)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
