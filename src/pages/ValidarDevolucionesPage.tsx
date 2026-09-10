import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listarMovimientos, urlPublica, validarDevolucion } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { bs, fechaHora } from '../lib/formato'
import { Cabecera, Cargando, Error as AvisoError, Vacio } from '../components/Ui'
import type { MovimientoCaja } from '../types/database'

export function ValidarDevolucionesPage() {
  const { perfil } = useAuth()
  const [lista, setLista] = useState<MovimientoCaja[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const movs = await listarMovimientos({ estado: 'pendiente_validacion' })
      setLista(movs.filter((m) => m.tipo === 'devolucion'))
    } catch (e: any) { setError(e.message) } finally { setCargando(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  async function validar(m: MovimientoCaja) {
    setTrabajando(m.id); setError(null)
    try { await validarDevolucion(m, perfil!.id); await cargar() }
    catch (e: any) { setError(e.message) } finally { setTrabajando(null) }
  }

  if (cargando) return <Cargando />

  return (
    <>
      <Cabecera titulo="Devoluciones por validar" bajada="Revisa el comprobante del depósito. Al validarlo, la solicitud se cierra y el saldo sube." />
      <AvisoError mensaje={error} />
      <div className="cc-card">
        {!lista.length ? <Vacio texto="No hay depósitos esperando validación." /> : (
          <div className="cc-scroll">
            <table className="cc-tabla">
              <thead><tr><th>Recibido</th><th>Solicitud</th><th className="num">Monto</th><th>Comprobante</th><th /></tr></thead>
              <tbody>
                {lista.map((m) => (
                  <tr key={m.id}>
                    <td className="cc-mono">{fechaHora(m.created_at)}</td>
                    <td>{m.solicitud_id
                      ? <Link to={`/solicitudes/${m.solicitud_id}`}>{m.solicitud?.descripcion ?? 'Ver solicitud'}</Link>
                      : '—'}</td>
                    <td className="num">{bs(m.monto)}</td>
                    <td>{m.comprobante_url
                      ? <a href={urlPublica(m.comprobante_url)} target="_blank" rel="noreferrer">Abrir</a>
                      : <span className="cc-tenue">Sin adjunto</span>}</td>
                    <td>
                      <button className="cc-btn cc-btn-x cc-btn-ok" disabled={trabajando === m.id} onClick={() => validar(m)}>
                        Validar depósito
                      </button>
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
