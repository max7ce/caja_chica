import { useEffect, useMemo, useState } from 'react'
import { listarSolicitudes } from '../lib/api'
import { Cabecera, Cargando, Error as AvisoError } from '../components/Ui'
import { TablaSolicitudes } from './TablaSolicitudes'
import { ETIQUETA_ESTADO, type Solicitud } from '../types/database'

export function SolicitudesListPage() {
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [estado, setEstado] = useState('')
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    ;(async () => {
      try { setSolicitudes(await listarSolicitudes()) }
      catch (e: any) { setError(e.message) } finally { setCargando(false) }
    })()
  }, [])

  const filtradas = useMemo(() => solicitudes.filter((s) =>
    (!estado || s.estado === estado) &&
    (!busqueda || s.descripcion.toLowerCase().includes(busqueda.toLowerCase()) ||
      (s.solicitante?.full_name ?? '').toLowerCase().includes(busqueda.toLowerCase()))
  ), [solicitudes, estado, busqueda])

  if (cargando) return <Cargando />

  return (
    <>
      <Cabecera titulo="Solicitudes" bajada="Todo el histórico con el estado en el que quedó cada vale." />
      <AvisoError mensaje={error} />
      <div className="cc-dos" style={{ maxWidth: 560, marginBottom: 20 }}>
        <div className="cc-campo">
          <label>Estado</label>
          <select value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(ETIQUETA_ESTADO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="cc-campo">
          <label>Buscar</label>
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Detalle o persona" />
        </div>
      </div>
      <div className="cc-card"><TablaSolicitudes solicitudes={filtradas} /></div>
    </>
  )
}
