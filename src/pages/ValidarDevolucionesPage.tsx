import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  listarComprobantes, listarFacturas, listarMovimientos, listarSolicitudes,
  validarDevolucion, verificarFisica
} from '../lib/api'
import { EnlaceArchivo } from '../components/ArchivoFirmado'
import { useAuth } from '../hooks/useAuth'
import { bs, etiquetaComprobante, fechaHora } from '../lib/formato'
import { Cabecera, Cargando, Error as AvisoError, Vacio } from '../components/Ui'
import type { Comprobante, Factura, MovimientoCaja, Solicitud } from '../types/database'
import { Persona } from '../components/Ui'
import { bs as formatoBs } from '../lib/formato'

export function ValidarDevolucionesPage() {
  const { perfil } = useAuth()
  const [lista, setLista] = useState<MovimientoCaja[]>([])
  const [porVerificar, setPorVerificar] = useState<Solicitud[]>([])
  const [adjuntos, setAdjuntos] = useState<Record<string, Comprobante[]>>({})
  const [facturas, setFacturas] = useState<Record<string, Factura[]>>({})
  const [observaciones, setObservaciones] = useState<Record<string, string>>({})
  const [checks, setChecks] = useState<Record<string, { originales: boolean; firma: boolean }>>({})
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
      const mapaF: Record<string, Factura[]> = {}
      for (const sol of pendientes) {
        mapa[sol.id] = await listarComprobantes(sol.id)
        mapaF[sol.id] = await listarFacturas(sol.id)
      }
      setAdjuntos(mapa)
      setFacturas(mapaF)
    } catch (e: any) { setError(e.message) } finally { setCargando(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  async function cotejar(sol: Solicitud, conforme: boolean) {
    const obs = observaciones[sol.id] ?? ''
    if (!conforme && !obs.trim()) {
      setError('Para observar la documentación hay que indicar qué falta o qué no coincide.')
      return
    }
    const c = checks[sol.id]
    if (conforme && !(c?.originales && c?.firma)) {
      setError('Para dar por válida la rendición marca que recibiste los originales y que están firmados por el superior.')
      return
    }
    setTrabajando(sol.id); setError(null)
    try { await verificarFisica(sol.id, conforme, obs, perfil!.id, !!c?.firma); await cargar() }
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
        <h2>Depósitos por validar</h2>
        <p className="cc-tenue" style={{ marginTop: 0 }}>
          Revisa que el depósito exista y que el monto coincida. Al validarlo, el dinero vuelve al saldo
          y la solicitud pasa al cotejo del papel, en la sección de abajo.
        </p>
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
                      ? <EnlaceArchivo ruta={m.comprobante_url}>Abrir</EnlaceArchivo>
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
          El solicitante ya rindió en el sistema. La rendición solo se da por válida cuando entrega el
          vale y las facturas originales, firmados por su superior inmediato, y coinciden con lo cargado. Este es el momento de
          revisar también los datos fiscales: lo que se verifique acá es lo que después va al informe de
          rendición sin volver a tipearse.
        </p>
        {!porVerificar.length ? (
          <Vacio texto={lista.length
            ? 'Nada pendiente de cotejo todavía. Las solicitudes con devolución aparecen aquí recién después de validar el depósito, arriba.'
            : 'No hay documentación pendiente de cotejo.'} />
        ) : (
          <div className="cc-scroll">
            <table className="cc-tabla">
              <thead>
                <tr>
                  <th>Nº</th><th>Solicitante</th><th>Detalle</th><th className="num">Gastado</th>
                  <th>Facturas</th><th>Adjuntos</th><th>Observación</th><th />
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
                      {(() => {
                        const fs = facturas[sol.id] ?? []
                        const totalF = fs.reduce((a, f) => a + Number(f.monto), 0)
                        const gastado = Number(sol.monto_real ?? 0)
                        if (!fs.length) {
                          return <span className="cc-chip cc-mal">sin facturas</span>
                        }
                        const difiere = Math.abs(totalF - gastado) > 0.009
                        return (
                          <>
                            <div>{fs.length} · {formatoBs(totalF)}</div>
                            {difiere && (
                              <div className="cc-chip cc-espera" style={{ marginTop: 4 }}>
                                no coincide con lo gastado
                              </div>
                            )}
                          </>
                        )
                      })()}
                    </td>
                    <td>
                      {(adjuntos[sol.id] ?? []).length === 0
                        ? <span className="cc-tenue">sin adjuntos</span>
                        : (adjuntos[sol.id] ?? []).map((c) => (
                            <div key={c.id}>
                              <EnlaceArchivo ruta={c.archivo_url}>
                                {etiquetaComprobante(c)}
                              </EnlaceArchivo>
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
                    <td style={{ minWidth: 220 }}>
                      {(['originales', 'firma'] as const).map((k) => (
                        <label key={k} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: '.85rem', marginBottom: 4 }}>
                          <input type="checkbox" style={{ width: 16, minHeight: 16, marginTop: 2 }}
                            checked={!!checks[sol.id]?.[k]}
                            onChange={(e) => setChecks({
                              ...checks,
                              [sol.id]: { ...(checks[sol.id] ?? { originales: false, firma: false }), [k]: e.target.checked }
                            })} />
                          {k === 'originales'
                            ? 'Originales recibidos y coinciden'
                            : `Firmados por ${sol.coordinador?.full_name ?? 'el superior'}`}
                        </label>
                      ))}
                      <div className="cc-acc" style={{ marginTop: 6 }}>
                        <button className="cc-btn cc-btn-x cc-btn-ok"
                          disabled={trabajando === sol.id || !checks[sol.id]?.originales || !checks[sol.id]?.firma}
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
