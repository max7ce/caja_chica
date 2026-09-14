import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { avalarSolicitud, listarSolicitudes } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { bs, fecha } from '../lib/formato'
import { Cabecera, Cargando, Error as AvisoError, Persona, Vacio } from '../components/Ui'
import type { Solicitud } from '../types/database'

/**
 * Bandeja del coordinador. El aval no corta el circuito: avalada o no, la
 * solicitud sigue al DAF con el dictamen adjunto.
 */
export function AvalesPage() {
  const { perfil, oficinasQueCoordino } = useAuth()
  const [lista, setLista] = useState<Solicitud[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [observaciones, setObservaciones] = useState<Record<string, string>>({})

  const cargar = useCallback(async () => {
    try {
      const todas = await listarSolicitudes({ estado: 'pendiente_coordinador' })
      setLista(todas.filter((s) => s.coordinador_id === perfil!.id))
    } catch (e: any) { setError(e.message) } finally { setCargando(false) }
  }, [perfil])
  useEffect(() => { cargar() }, [cargar])

  async function dictaminar(s: Solicitud, avala: boolean) {
    const obs = observaciones[s.id] ?? ''
    if (!avala && !obs.trim()) {
      setError('Para no avalar hay que escribir el motivo: el DAF y la persona lo van a leer.')
      return
    }
    setTrabajando(s.id); setError(null)
    try {
      await avalarSolicitud(s.id, avala, obs)
      await cargar()
    } catch (e: any) { setError(e.message) } finally { setTrabajando(null) }
  }

  if (cargando) return <Cargando />

  return (
    <>
      <Cabecera
        titulo="Solicitudes por avalar"
        bajada={`Pedidos de ${oficinasQueCoordino.map((o) => o.nombre).join(', ') || 'tu oficina'}. Tu dictamen acompaña la solicitud hasta el DAF: si no la avalas, igual continúa, pero con tu observación a la vista.`}
      />
      <AvisoError mensaje={error} />
      <div className="cc-card">
        <h2>Pendientes de aval</h2>
        {!lista.length ? <Vacio texto="No hay solicitudes esperando tu aval." /> : (
          <div className="cc-scroll">
            <table className="cc-tabla">
              <thead>
                <tr><th>Fecha</th><th>Solicitante</th><th>Detalle</th><th className="num">Monto</th><th>Observación</th><th /></tr>
              </thead>
              <tbody>
                {lista.map((s) => (
                  <tr key={s.id}>
                    <td className="cc-mono">{fecha(s.fecha_creacion)}</td>
                    <td><Persona nombre={s.solicitante?.full_name} depto={s.solicitante?.departamento} /></td>
                    <td><Link to={`/solicitudes/${s.id}`}>{s.descripcion}</Link></td>
                    <td className="num">{bs(s.monto_solicitado)}</td>
                    <td style={{ minWidth: 220 }}>
                      <input
                        placeholder="Obligatoria si no avalas"
                        value={observaciones[s.id] ?? ''}
                        onChange={(e) => setObservaciones({ ...observaciones, [s.id]: e.target.value })}
                        style={{ width: '100%', font: 'inherit', fontSize: '.9rem', padding: '6px 10px', border: '1px solid #ced4da', borderRadius: 4 }}
                      />
                    </td>
                    <td>
                      <div className="cc-acc">
                        <button className="cc-btn cc-btn-x cc-btn-ok" disabled={trabajando === s.id}
                          onClick={() => dictaminar(s, true)}>Avalar</button>
                        <button className="cc-btn cc-btn-x cc-btn-r" disabled={trabajando === s.id}
                          onClick={() => dictaminar(s, false)}>No avalar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
