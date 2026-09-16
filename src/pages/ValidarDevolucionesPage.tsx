import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  listarComprobantes, listarMovimientos, listarSolicitudes, urlPublica,
  validarDevolucion, verificarFisica
} from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { bs, fechaHora } from '../lib/formato'
import { Cabecera, Cargando, Error as AvisoError, Vacio } from '../components/Ui'
import type { Comprobante, MovimientoCaja, Solicitud } from '../types/database'
import { Persona } from '../components/Ui'
import { bs as formatoBs } from '../lib/formato'

export function ValidarDevolucionesPage() {
  const { perfil } = useAuth()
  const [lista, setLista] = useState<MovimientoCaja[]>([])
  const [porVerificar, setPorVerificar] = useState<Solicitud[]>([])
  const [adjuntos, setAdjuntos] = useState<Record<string, Comprobante[]>>({})
  const [observaciones, setObservaciones] = useState<Record<string, string>>({})
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const [movs, pendientes] = await Promise.all([
        listarMovimientos({ estado: 'pendiente_validacion' }),
        listarSolicitudes({ estado: 'pendiente_verificacion' })
      ])
      setLista(movs.filter((m) => m.tipo === 'devolucion'))
      setPorVerificar(pendientes)

      // Se precargan los comprobantes para poder cotejarlos sin abrir cada solicitud
      const mapa: Record<string, Comprobante[]> = {}
      for (const sol of pendientes) mapa[sol.id] = await listarComprobantes(sol.id)
      setAdjuntos(mapa)
    } catch (e: any) { setError(e.message) } finally { setCargando(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  async function cotejar(sol: Solicitud, conforme: boolean) {
    const obs = observaciones[sol.id] ?? ''
    if (!conforme && !obs.trim()) {
      setError('Para observar la documentación hay que indicar qué falta o qué no coincide.')
      return
    }
    setTrabajando(sol.id); setError(null)
    try { await verificarFisica(sol.id, conforme, obs, perfil!.id); await cargar() }
    catch (e: any) { setError(e.message) } finally { setTrabajando(null) }
  }

  async function validar(m: MovimientoCaja) {
    setTrabajando(m.id); setError(null)
    try { await validarDevolucion(m, perfil!.id); await cargar() }
    catch (e: any) { setError(e.message) } finally { setTrabajando(null) }
  }

  if (cargando) return <Cargando />

  return (
    <>
      <Cabecera
        titulo="Validar rendiciones"
        bajada="Dos revisiones: los depósitos de las diferencias devueltas, y la documentación física que debe coincidir con lo cargado en el sistema."
      />
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
      <div className="cc-card">
        <h2>Documentación física por recibir</h2>
        <p className="cc-tenue" style={{ marginTop: 0 }}>
          El solicitante ya rindió en el sistema. Falta que entregue el vale y las facturas con la firma
          y el sello de su coordinador al reverso, y que coincidan con lo cargado. Hasta entonces la
          solicitud no se cierra.
        </p>
        {!porVerificar.length ? <Vacio texto="No hay documentación pendiente de cotejo." /> : (
          <div className="cc-scroll">
            <table className="cc-tabla">
              <thead>
                <tr>
                  <th>Nº</th><th>Solicitante</th><th>Detalle</th><th className="num">Gastado</th>
                  <th>Cargado en el sistema</th><th>Observación</th><th />
                </tr>
              </thead>
              <tbody>
                {porVerificar.map((sol) => (
                  <tr key={sol.id}>
                    <td><Link className="cc-mono" to={`/solicitudes/${sol.id}`}>{sol.id.slice(0, 8)}</Link></td>
                    <td><Persona nombre={sol.solicitante?.full_name} depto={sol.solicitante?.departamento} /></td>
                    <td>
                      {sol.descripcion}
                      {sol.conforme_fisica === false && (
                        <div style={{ marginTop: 6 }}>
                          <span className="cc-chip cc-mal">Observada</span>
                        </div>
                      )}
                    </td>
                    <td className="num">{formatoBs(sol.monto_real)}</td>
                    <td>
                      {(adjuntos[sol.id] ?? []).length === 0
                        ? <span className="cc-tenue">sin adjuntos</span>
                        : (adjuntos[sol.id] ?? []).map((c) => (
                            <div key={c.id}>
                              <a href={urlPublica(c.archivo_url)} target="_blank" rel="noreferrer">
                                {c.tipo === 'compra' ? 'Factura' : 'Depósito'}
                              </a>
                            </div>
                          ))}
                    </td>
                    <td style={{ minWidth: 190 }}>
                      <input
                        placeholder="Obligatoria si observas"
                        value={observaciones[sol.id] ?? ''}
                        onChange={(e) => setObservaciones({ ...observaciones, [sol.id]: e.target.value })}
                        style={{ width: '100%', font: 'inherit', fontSize: '.88rem', padding: '6px 10px', border: '1px solid #ced4da', borderRadius: 4 }}
                      />
                    </td>
                    <td>
                      <div className="cc-acc">
                        <button className="cc-btn cc-btn-x cc-btn-ok" disabled={trabajando === sol.id}
                          onClick={() => cotejar(sol, true)}>
                          Recibí y coincide
                        </button>
                        <button className="cc-btn cc-btn-x cc-btn-r" disabled={trabajando === sol.id}
                          onClick={() => cotejar(sol, false)}>
                          Observar
                        </button>
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
