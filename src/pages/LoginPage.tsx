import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Error as AvisoError } from '../components/Ui'

export function LoginPage() {
  const { session, iniciarSesion } = useAuth()
  const ubicacion = useLocation() as { state?: { desde?: string } }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  if (session) return <Navigate to={ubicacion.state?.desde ?? '/dashboard'} replace />

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setEnviando(true)
    try {
      await iniciarSesion(email.trim(), password)
    } catch (err: any) {
      setError(err?.message === 'Invalid login credentials'
        ? 'Correo o contraseña incorrectos.' : err?.message ?? 'No se pudo iniciar sesión.')
    } finally { setEnviando(false) }
  }

  return (
    <div className="cc-login cc">
      <form className="caja" onSubmit={entrar}>
        <div className="marca" />
        <h1>Caja chica</h1>
        <p>Vales, devoluciones y rendición de cuentas.</p>
        <AvisoError mensaje={error} />
        <div className="cc-campo">
          <label>Correo institucional</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        </div>
        <div className="cc-campo">
          <label>Contraseña</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </div>
        <button className="cc-btn cc-btn-p" style={{ width: '100%', justifyContent: 'center' }} disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
