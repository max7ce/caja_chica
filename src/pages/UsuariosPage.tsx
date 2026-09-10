import { useCallback, useEffect, useState } from 'react'
import { actualizarPerfil, cambiarRol, listarPerfiles } from '../lib/api'
import { crearClienteAltas } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Cabecera, Cargando, Error as AvisoError, Exito, Persona } from '../components/Ui'
import { ETIQUETA_ROL, type Profile, type Rol } from '../types/database'

const ROLES: Rol[] = ['solicitante', 'daf', 'admin_caja', 'contabilidad', 'super_admin']

export function UsuariosPage() {
  const { perfil } = useAuth()
  const [usuarios, setUsuarios] = useState<Profile[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)

  const [email, setEmail] = useState('')
  const [nombre, setNombre] = useState('')
  const [departamento, setDepartamento] = useState('')
  const [telefono, setTelefono] = useState('')
  const [password, setPassword] = useState('')
  const [rol, setRol] = useState<Rol>('solicitante')

  const cargar = useCallback(async () => {
    try { setUsuarios(await listarPerfiles()) }
    catch (e: any) { setError(e.message) } finally { setCargando(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setExito(null); setTrabajando(true)
    try {
      // Cliente aparte, sin persistir sesión: el signUp no pisa la del administrador.
      const clienteAltas = crearClienteAltas()
      const { data, error: eAlta } = await clienteAltas.auth.signUp({
        email: email.trim(), password,
        options: { data: { full_name: nombre.trim(), departamento: departamento.trim(), telefono: telefono.trim() } }
      })
      if (eAlta) throw eAlta
      // El trigger ya creó el profile con rol 'solicitante'.
      if (data.user && rol !== 'solicitante') await cambiarRol(data.user.id, rol)
      if (data.user && telefono.trim()) await actualizarPerfil(data.user.id, { whatsapp_optin: true })
      setExito(`Usuario ${email} creado como ${ETIQUETA_ROL[rol]}.`)
      setEmail(''); setNombre(''); setDepartamento(''); setTelefono(''); setPassword(''); setRol('solicitante')
      await cargar()
    } catch (e: any) { setError(e.message ?? 'No se pudo crear el usuario.') }
    finally { setTrabajando(false) }
  }

  if (cargando) return <Cargando />

  return (
    <>
      <Cabecera titulo="Usuarios" bajada="Altas, roles y acceso. El rol define exactamente qué pantallas ve cada persona." />
      <AvisoError mensaje={error} />
      <Exito mensaje={exito} />

      <form className="cc-card" style={{ maxWidth: 720 }} onSubmit={crear}>
        <h2>Crear usuario</h2>
        <div className="cc-dos">
          <div className="cc-campo">
            <label>Nombre completo</label>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} required />
          </div>
          <div className="cc-campo">
            <label>Correo institucional</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
        </div>
        <div className="cc-dos">
          <div className="cc-campo">
            <label>Departamento</label>
            <input value={departamento} onChange={(e) => setDepartamento(e.target.value)} />
          </div>
          <div className="cc-campo">
            <label>WhatsApp — formato +591…</label>
            <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="+59171234567" />
          </div>
        </div>
        <div className="cc-dos">
          <div className="cc-campo">
            <label>Contraseña inicial</label>
            <input type="text" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div className="cc-campo">
            <label>Rol</label>
            <select value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
              {ROLES.map((r) => <option key={r} value={r}>{ETIQUETA_ROL[r]}</option>)}
            </select>
          </div>
        </div>
        <button className="cc-btn cc-btn-p" disabled={trabajando}>
          {trabajando ? 'Creando…' : 'Crear usuario'}
        </button>
        <p className="cc-tenue" style={{ fontSize: 13 }}>
          Sin teléfono cargado, la persona recibe solo correo. Si el proyecto tiene la confirmación de correo activada,
          debe confirmar antes de poder entrar.
        </p>
      </form>

      <div className="cc-card">
        <h2>Personas con acceso</h2>
        <div className="cc-scroll">
          <table className="cc-tabla">
            <thead><tr><th>Nombre</th><th>Correo</th><th>Departamento</th><th>WhatsApp</th><th>Rol</th><th>Acceso</th></tr></thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id}>
                  <td><Persona nombre={u.full_name} /></td>
                  <td className="cc-mono">{u.email}</td>
                  <td>{u.departamento ?? '—'}</td>
                  <td className="cc-mono">{u.telefono ?? '—'}</td>
                  <td>
                    <select value={u.role} disabled={u.id === perfil!.id}
                      onChange={async (e) => {
                        try { await cambiarRol(u.id, e.target.value as Rol); await cargar() }
                        catch (err: any) { setError(err.message) }
                      }}>
                      {ROLES.map((r) => <option key={r} value={r}>{ETIQUETA_ROL[r]}</option>)}
                    </select>
                  </td>
                  <td>
                    <button className={`cc-btn cc-btn-x ${u.activo ? 'cc-btn-r' : ''}`} disabled={u.id === perfil!.id}
                      onClick={async () => {
                        try { await actualizarPerfil(u.id, { activo: !u.activo }); await cargar() }
                        catch (err: any) { setError(err.message) }
                      }}>
                      {u.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="cc-tenue" style={{ fontSize: 13 }}>
          Desactivar bloquea el ingreso. Borrar la cuenta de autenticación por completo solo se puede desde el panel de
          Supabase, porque requiere una llave de servicio que la app no usa.
        </p>
      </div>
    </>
  )
}
