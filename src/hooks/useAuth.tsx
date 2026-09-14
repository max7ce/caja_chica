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
  errorContexto: string | null
  tieneRol: (roles: Rol[]) => boolean
  iniciarSesion: (email: string, password: string) => Promise<void>
  cerrarSesion: () => Promise<void>
  recargar: () => Promise<void>
}

const C = createContext<Ctx | null>(null)

function mensaje(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as any).message)
  return String(e)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Profile | null>(null)
  const [parametros, setParametros] = useState<Parametros | null>(null)
  const [periodo, setPeriodo] = useState<Periodo | null>(null)
  const [oficinasQueCoordino, setOficinas] = useState<Oficina[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorContexto, setErrorContexto] = useState<string | null>(null)

  const cargarContexto = useCallback(async (userId?: string) => {
    if (!userId) {
      setPerfil(null); setParametros(null); setPeriodo(null); setOficinas([]); setErrorContexto(null)
      return
    }

    // allSettled y no all: si falla el período o los parámetros, el perfil
    // igual se carga y la persona puede entrar. Antes, cualquier fallo dejaba
    // el perfil en nulo y la pantalla colgada en "Cargando el perfil…".
    const [rPerfil, rParam, rPeriodo, rOficinas] = await Promise.allSettled([
      obtenerPerfil(userId), obtenerParametros(), periodoVigente(), misOficinas(userId)
    ])

    const fallos: string[] = []

    if (rPerfil.status === 'fulfilled') setPerfil(rPerfil.value)
    else { setPerfil(null); fallos.push(`perfil: ${mensaje(rPerfil.reason)}`) }

    if (rParam.status === 'fulfilled') setParametros(rParam.value)
    else fallos.push(`parámetros: ${mensaje(rParam.reason)}`)

    if (rPeriodo.status === 'fulfilled') setPeriodo(rPeriodo.value)
    else fallos.push(`gestión vigente: ${mensaje(rPeriodo.reason)}`)

    if (rOficinas.status === 'fulfilled') setOficinas(rOficinas.value)
    else fallos.push(`oficinas: ${mensaje(rOficinas.reason)}`)

    if (fallos.length) console.error('No se pudo cargar el contexto:', fallos.join(' | '))
    setErrorContexto(fallos.length ? fallos.join(' · ') : null)
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
    session, perfil, parametros, periodo, cargando, errorContexto,
    oficinasQueCoordino,
    esCoordinador: oficinasQueCoordino.length > 0,
    tieneRol: (roles) => !!perfil && roles.includes(perfil.role),
    iniciarSesion: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    },
    cerrarSesion: async () => { await supabase.auth.signOut(); setPerfil(null) },
    recargar: async () => cargarContexto(session?.user.id)
  }), [session, perfil, parametros, periodo, oficinasQueCoordino, cargando, errorContexto, cargarContexto])

  return <C.Provider value={valor}>{children}</C.Provider>
}

export function useAuth() {
  const ctx = useContext(C)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
