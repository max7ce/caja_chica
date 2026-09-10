import { useCallback, useEffect, useState } from 'react'
import { guardarParametros, listarPerfiles, listarPeriodos, rotarPeriodo } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { bs, fecha } from '../lib/formato'
import { Cabecera, Cargando, Error as AvisoError, Exito, Persona, Vacio } from '../components/Ui'
import type { Parametros, Periodo, Profile } from '../types/database'

export function PeriodosPage() {
  const { parametros, recargar } = useAuth()
  const [periodos, setPeriodos] = useState<Periodo[]>([])
  const [admins, setAdmins] = useState<Profile[]>([])
  const [adminId, setAdminId] = useState('')
  const [etiqueta, setEtiqueta] = useState('')
  const [fondo, setFondo] = useState(String(parametros?.monto_reposicion ?? 7000))
  const [form, setForm] = useState<Partial<Parametros>>({})
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const [p, perfiles] = await Promise.all([listarPeriodos(), listarPerfiles()])
      setPeriodos(p)
      setAdmins(perfiles.filter((x) => ['admin_caja', 'super_admin'].includes(x.role) && x.activo))
    } catch (e: any) { setError(e.message) } finally { setCargando(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { if (parametros) setForm(parametros) }, [parametros])

  if (cargando) return <Cargando />

  return (
    <>
      <Cabecera titulo="Gestiones de caja"
        bajada="El cargo de administrador de caja es rotativo. Cada gestión agrupa sus solicitudes e informes, y es lo que compara el reporte del DAF." />
      <AvisoError mensaje={error} />
      <Exito mensaje={exito} />

      <div className="cc-card" style={{ maxWidth: 640 }}>
        <h2>Rotar el cargo</h2>
        <p className="cc-tenue" style={{ marginBottom: 14 }}>
          Abrir una gestión nueva cierra automáticamente la vigente. Solo puede haber una a la vez.
        </p>
        <div className="cc-dos">
          <div className="cc-campo">
            <label>Nuevo administrador de caja</label>
            <select value={adminId} onChange={(e) => setAdminId(e.target.value)}>
              <option value="">Elegir…</option>
              {admins.map((a) => <option key={a.id} value={a.id}>{a.full_name ?? a.email}</option>)}
            </select>
          </div>
          <div className="cc-campo">
            <label>Etiqueta del período</label>
            <input value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} placeholder="oct – dic 2026" />
          </div>
        </div>
        <div className="cc-campo" style={{ maxWidth: 220 }}>
          <label>Fondo asignado</label>
          <input type="number" value={fondo} onChange={(e) => setFondo(e.target.value)} />
        </div>
        <button className="cc-btn cc-btn-p" disabled={!adminId || !etiqueta.trim()}
          onClick={async () => {
            setError(null)
            try {
              await rotarPeriodo(adminId, etiqueta.trim(), Number(fondo))
              setExito('Gestión abierta.'); setAdminId(''); setEtiqueta('')
              await cargar(); await recargar()
            } catch (e: any) { setError(e.message) }
          }}>
          Abrir gestión
        </button>
      </div>

      <div className="cc-card">
        <h2>Historial de gestiones</h2>
        {!periodos.length ? <Vacio texto="Todavía no hay gestiones." /> : (
          <table className="cc-tabla">
            <thead><tr><th>Administrador</th><th>Período</th><th>Desde</th><th>Hasta</th><th className="num">Fondo</th><th>Estado</th></tr></thead>
            <tbody>
              {periodos.map((p) => (
                <tr key={p.id}>
                  <td><Persona nombre={p.admin?.full_name} /></td>
                  <td>{p.etiqueta}</td>
                  <td className="cc-mono">{fecha(p.fecha_inicio)}</td>
                  <td className="cc-mono">{fecha(p.fecha_fin)}</td>
                  <td className="num">{bs(p.fondo_asignado)}</td>
                  <td>
                    <span className={`cc-chip ${p.estado === 'vigente' ? 'cc-curso' : 'cc-ok'}`}>
                      {p.estado === 'vigente' ? 'Vigente' : 'Cerrada'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="cc-card" style={{ maxWidth: 640 }}>
        <h2>Parámetros del sistema</h2>
        <div className="cc-dos">
          <div className="cc-campo">
            <label>Tope por vale</label>
            <input type="number" value={form.tope_solicitud ?? ''} onChange={(e) => setForm({ ...form, tope_solicitud: Number(e.target.value) })} />
          </div>
          <div className="cc-campo">
            <label>Umbral de reposición</label>
            <input type="number" value={form.umbral_reposicion ?? ''} onChange={(e) => setForm({ ...form, umbral_reposicion: Number(e.target.value) })} />
          </div>
        </div>
        <div className="cc-dos">
          <div className="cc-campo">
            <label>Monto de reposición</label>
            <input type="number" value={form.monto_reposicion ?? ''} onChange={(e) => setForm({ ...form, monto_reposicion: Number(e.target.value) })} />
          </div>
          <div className="cc-campo">
            <label>Plazo de rendición (horas)</label>
            <input type="number" value={form.plazo_rendicion_horas ?? ''} onChange={(e) => setForm({ ...form, plazo_rendicion_horas: Number(e.target.value) })} />
          </div>
        </div>
        <div className="cc-campo">
          <label>
            <input type="checkbox" style={{ width: 16, minHeight: 16, marginRight: 8 }}
              checked={!!form.pausar_fin_semana}
              onChange={(e) => setForm({ ...form, pausar_fin_semana: e.target.checked })} />
            Pausar el reloj sábados y domingos
          </label>
        </div>
        <div className="cc-campo">
          <label>
            <input type="checkbox" style={{ width: 16, minHeight: 16, marginRight: 8 }}
              checked={!!form.bloquear_si_vencida}
              onChange={(e) => setForm({ ...form, bloquear_si_vencida: e.target.checked })} />
            Bloquear vales nuevos si hay una rendición vencida
          </label>
        </div>
        <button className="cc-btn cc-btn-p" onClick={async () => {
          setError(null)
          try {
            await guardarParametros(form)
            await recargar()
            setExito('Parámetros actualizados. Aplican a los desembolsos nuevos, no a los plazos ya calculados.')
          } catch (e: any) { setError(e.message) }
        }}>
          Guardar parámetros
        </button>
      </div>
    </>
  )
}
