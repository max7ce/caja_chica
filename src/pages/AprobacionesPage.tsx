import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { decidirSolicitud, listarSolicitudes } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { bs, fecha } from '../lib/formato'
import { Cabecera, Cargando, Error as AvisoError, Persona, Vacio } from '../components/Ui'
import type { Solicitud } from '../types/database'

export function AprobacionesPage() {
  const { perfil } = useAuth()
  const [lista, setLista] = useState<Solicitud[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try { setLista(await listarSolicitudes({ estado: 'pendiente_daf' })) }
    catch (e: any) { setError(e.message) } finally { setCargando(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  async function resolver(s: Solicitud, aprobar: boolean) {
    setTrabajando(s.id); setError(null)
    try {
      if (aprobar) await decidirSolicitud(s.id, perfil!.id, true)
      else {
        const motivo = window.prompt('¿Por qué se rechaza?')
        if (!motivo) { setTrabajando(null); return }
        await decidirSolicitud(s.id, perfil!.id, false, motivo)
      }
      await cargar()
    } catch (e: any) { setError(e.message) } finally { setTrabajando(null) }
  }

  if (cargando) return <Cargando />

  return (
    <>
      <Cabecera titulo="Solicitudes por autorizar" bajada="Lo mismo que llega por WhatsApp y correo, por si prefieres revisarlo con calma aquí." />
      <AvisoError mensaje={error} />
      <div className="cc-card">
        {!lista.length ? <Vacio texto="No hay nada pendiente. Todo al día." /> : (
          <div className="cc-scroll">
            <table className="cc-tabla">
              <thead><tr><th>Fecha</th><th>Solicitante</th><th>Detalle</th><th className="num">Monto</th><th /></tr></thead>
              <tbody>
                {lista.map((s) => (
                  <tr key={s.id}>
                    <td className="cc-mono">{fecha(s.fecha_creacion)}</td>
                    <td><Persona nombre={s.solicitante?.full_name} depto={s.solicitante?.departamento} /></td>
                    <td><Link to={`/solicitudes/${s.id}`}>{s.descripcion}</Link></td>
                    <td className="num">{bs(s.monto_solicitado)}</td>
                    <td>
                      <div className="cc-acc">
                        <button className="cc-btn cc-btn-x cc-btn-ok" disabled={trabajando === s.id} onClick={() => resolver(s, true)}>Autorizar</button>
                        <button className="cc-btn cc-btn-x cc-btn-r" disabled={trabajando === s.id} onClick={() => resolver(s, false)}>Rechazar</button>
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
