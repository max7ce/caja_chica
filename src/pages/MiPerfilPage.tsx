import { useState } from 'react'
import { actualizarPerfil, subirQR, urlQR } from '../lib/api'
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
  const [qr, setQr] = useState<File | null>(null)
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

      <div className="cc-card" style={{ maxWidth: 560 }}>
        <h2>Mi QR de cobro</h2>
        <p className="cc-tenue" style={{ marginTop: 0 }}>
          Sube la imagen del QR de tu cuenta bancaria. Es el que va a escanear el administrador de caja
          para transferirte el dinero de tus vales. Sin él, tiene que pedirte los datos de cuenta aparte.
        </p>

        {perfil?.qr_url && (
          <img
            src={urlQR(perfil.qr_url)!}
            alt="Mi QR de cobro"
            style={{ width: 190, border: '1px solid var(--borde)', borderRadius: 6, padding: 10, marginBottom: 14 }}
          />
        )}

        <div className="cc-campo">
          <label>{perfil?.qr_url ? 'Reemplazar por otra imagen' : 'Imagen del QR (captura o foto)'}</label>
          <input type="file" accept="image/*" onChange={(e) => setQr(e.target.files?.[0] ?? null)} />
        </div>

        <button className="cc-btn cc-btn-p" disabled={!qr || trabajando}
          onClick={async () => {
            setError(null); setExito(null); setTrabajando(true)
            try {
              const ruta = await subirQR(qr!, perfil!.id)
              await actualizarPerfil(perfil!.id, { qr_url: ruta })
              await recargar()
              setQr(null)
              setExito('QR de cobro guardado.')
            } catch (e: any) { setError(e.message) } finally { setTrabajando(false) }
          }}>
          Guardar QR
        </button>
      </div>

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
