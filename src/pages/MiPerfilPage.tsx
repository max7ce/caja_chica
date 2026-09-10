import { useState } from 'react'
import { actualizarPerfil } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Cabecera, Error as AvisoError, Exito } from '../components/Ui'
import { ETIQUETA_ROL } from '../types/database'

export function MiPerfilPage() {
  const { perfil, recargar } = useAuth()
  const [nombre, setNombre] = useState(perfil?.full_name ?? '')
  const [departamento, setDepartamento] = useState(perfil?.departamento ?? '')
  const [telefono, setTelefono] = useState(perfil?.telefono ?? '')
  const [optin, setOptin] = useState(!!perfil?.whatsapp_optin)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setExito(null); setTrabajando(true)
    try {
      await actualizarPerfil(perfil!.id, {
        full_name: nombre.trim(), departamento: departamento.trim(),
        telefono: telefono.trim() || null, whatsapp_optin: optin
      })
      await recargar()
      setExito('Datos actualizados.')
    } catch (e: any) { setError(e.message) } finally { setTrabajando(false) }
  }

  async function cambiarClave(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setExito(null); setTrabajando(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setPassword(''); setExito('Contraseña cambiada.')
    } catch (e: any) { setError(e.message) } finally { setTrabajando(false) }
  }

  return (
    <>
      <Cabecera titulo="Mi perfil" bajada={`${perfil?.email} · ${perfil ? ETIQUETA_ROL[perfil.role] : ''}`} />
      <AvisoError mensaje={error} />
      <Exito mensaje={exito} />

      <form className="cc-card" style={{ maxWidth: 560 }} onSubmit={guardar}>
        <h2>Datos</h2>
        <div className="cc-campo">
          <label>Nombre completo</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div className="cc-campo">
          <label>Departamento</label>
          <input value={departamento} onChange={(e) => setDepartamento(e.target.value)} />
        </div>
        <div className="cc-campo">
          <label>WhatsApp — formato +591…</label>
          <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="+59171234567" />
        </div>
        <div className="cc-campo">
          <label>
            <input type="checkbox" style={{ width: 16, minHeight: 16, marginRight: 8 }}
              checked={optin} onChange={(e) => setOptin(e.target.checked)} />
            Quiero recibir avisos por WhatsApp además del correo
          </label>
        </div>
        <button className="cc-btn cc-btn-p" disabled={trabajando}>Guardar cambios</button>
      </form>

      <form className="cc-card" style={{ maxWidth: 560 }} onSubmit={cambiarClave}>
        <h2>Contraseña</h2>
        <div className="cc-campo">
          <label>Contraseña nueva</label>
          <input type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button className="cc-btn" disabled={trabajando || password.length < 6}>Cambiar contraseña</button>
      </form>
    </>
  )
}
