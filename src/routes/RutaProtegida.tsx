import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Cargando } from '../components/Ui'
import type { Rol } from '../types/database'

export function RutaProtegida({ roles, children }: { roles?: Rol[]; children: React.ReactNode }) {
  const { session, perfil, cargando } = useAuth()
  const ubicacion = useLocation()

  if (cargando) return <Cargando texto="Verificando la sesión…" />
  if (!session) return <Navigate to="/login" state={{ desde: ubicacion.pathname }} replace />
  if (!perfil) return <Cargando texto="Cargando el perfil…" />

  if (!perfil.activo) {
    return (
      <div className="cc-card">
        <h2>Cuenta desactivada</h2>
        <p className="cc-tenue">Pide al administrador que la reactive para volver a entrar.</p>
      </div>
    )
  }

  if (roles && !roles.includes(perfil.role)) {
    return (
      <div className="cc-card">
        <h2>Esta sección no corresponde a tu rol</h2>
        <p className="cc-tenue">Entraste como {perfil.role}. Si necesitas acceso, solicítalo al administrador general.</p>
      </div>
    )
  }

  return <>{children}</>
}
