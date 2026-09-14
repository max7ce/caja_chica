import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Cargando } from '../components/Ui'
import type { Rol } from '../types/database'

export function RutaProtegida({ roles, children }: { roles?: Rol[]; children: React.ReactNode }) {
  const { session, perfil, cargando, errorContexto, cerrarSesion, recargar } = useAuth()
  const ubicacion = useLocation()

  if (cargando) return <Cargando texto="Verificando la sesión…" />
  if (!session) return <Navigate to="/login" state={{ desde: ubicacion.pathname }} replace />
  // Sin perfil no se puede seguir, pero hay que decir por qué en vez de
  // dejar la pantalla girando indefinidamente.
  if (!perfil) {
    return (
      <div className="cc" style={{ padding: 30 }}>
        <div className="cc-card" style={{ maxWidth: 620 }}>
          <h2>No se pudo cargar tu perfil</h2>
          <p>
            La sesión se abrió correctamente, pero la aplicación no pudo leer tus datos.
            Suele deberse a una interrupción de conexión.
          </p>
          {errorContexto && (
            <div className="cc-aviso cc-av-mal" style={{ marginTop: 16 }}>{errorContexto}</div>
          )}
          <div className="cc-acc" style={{ marginTop: 16 }}>
            <button className="cc-btn cc-btn-p" onClick={() => recargar()}>Reintentar</button>
            <button className="cc-btn" onClick={() => cerrarSesion()}>Cerrar sesión</button>
          </div>
          <p className="cc-tenue" style={{ fontSize: 13 }}>
            Si se repite, pasa este mensaje al administrador del sistema.
          </p>
        </div>
      </div>
    )
  }

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
