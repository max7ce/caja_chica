import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { crearInforme, listarInformes, obtenerSaldo, solicitudesSinRendir } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { bs, fecha } from '../lib/formato'
import { Alerta, Cabecera, Cargando, Error as AvisoError, EstadoInformeChip, Vacio } from '../components/Ui'
import type { InformeRendicion, Solicitud } from '../types/database'

export function RendicionCuentasPage() {
  const { perfil, parametros, periodo } = useAuth()
  const navegar = useNavigate()
  const [informes, setInformes] = useState<InformeRendicion[]>([])
  const [candidatas, setCandidatas] = useState<Solicitud[]>([])
  const [elegidas, setElegidas] = useState<Set<string>>(new Set())
  const [observaciones, setObservaciones] = useState('')
  const [saldo, setSaldo] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)

  const puedeCrear = ['admin_caja', 'super_admin'].includes(perfil!.role)

  const cargar = useCallback(async () => {
    try {
      const [inf, cand, s] = await Promise.all([
        listarInformes(),
        puedeCrear ? solicitudesSinRendir() : Promise.resolve([]),
        obtenerSaldo(periodo?.id ?? null)
      ])
      setInformes(inf); setCandidatas(cand); setSaldo(Number(s.saldo))
    } catch (e: any) { setError(e.message) } finally { setCargando(false) }
  }, [puedeCrear, periodo])
  useEffect(() => { cargar() }, [cargar])

  const seleccionadas = candidatas.filter((c) => elegidas.has(c.id))
  const total = seleccionadas.reduce((s, x) => s + Number(x.monto_solicitado), 0)

  if (cargando) return <Cargando />
  const umbral = parametros?.umbral_reposicion ?? 2000

  return (
    <>
      <Cabecera titulo="Rendición de cuentas" bajada="Agrupa las solicitudes del período, envíalas al DAF y registra la reposición cuando llegue." />
      <AvisoError mensaje={error} />
      {saldo <= umbral && <Alerta mensaje={`El saldo está en ${bs(saldo)}: toca rendir para pedir la reposición.`} />}

      {puedeCrear && (
        <div className="cc-card">
          <h2>Armar un informe nuevo</h2>
          {!candidatas.length ? <Vacio texto="No hay solicitudes sin rendir." /> : (
            <>
              <div className="cc-scroll">
                <table className="cc-tabla">
                  <thead>
                    <tr><th /><th>Fecha</th><th>Solicitante</th><th>Detalle</th>
                      <th className="num">Desembolsado</th><th className="num">Devuelto</th></tr>
                  </thead>
                  <tbody>
                    {candidatas.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <input type="checkbox" style={{ width: 16, minHeight: 16 }} checked={elegidas.has(c.id)}
                            onChange={() => setElegidas((p) => {
                              const n = new Set(p)
                              n.has(c.id) ? n.delete(c.id) : n.add(c.id)
                              return n
                            })} />
                        </td>
                        <td className="cc-mono">{fecha(c.fecha_desembolso ?? c.fecha_creacion)}</td>
                        <td>{c.solicitante?.full_name ?? '—'}</td>
                        <td><Link to={`/solicitudes/${c.id}`}>{c.descripcion}</Link></td>
                        <td className="num">{bs(c.monto_solicitado)}</td>
                        <td className="num">{c.monto_real == null ? '—' : bs(Number(c.monto_solicitado) - Number(c.monto_real))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="cc-campo" style={{ marginTop: 18 }}>
                <label>Observaciones para el DAF</label>
                <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
              </div>
              <button className="cc-btn cc-btn-p" disabled={!seleccionadas.length || trabajando}
                onClick={async () => {
                  setTrabajando(true); setError(null)
                  try {
                    const id = await crearInforme({
                      adminCajaId: perfil!.id, periodoId: periodo?.id ?? null,
                      solicitudes: seleccionadas, observaciones,
                      montoReposicion: parametros?.monto_reposicion ?? 7000
                    })
                    navegar(`/rendicion-cuentas/${id}`)
                  } catch (e: any) { setError(e.message) } finally { setTrabajando(false) }
                }}>
                {trabajando ? 'Creando…' : `Enviar al DAF — ${seleccionadas.length} solicitudes, ${bs(total)}`}
              </button>
            </>
          )}
        </div>
      )}

      <div className="cc-card">
        <h2>Informes</h2>
        {!informes.length ? <Vacio texto="Todavía no se generó ningún informe." /> : (
          <div className="cc-scroll">
            <table className="cc-tabla">
              <thead>
                <tr><th>Creado</th><th>Período</th><th className="num">Desembolsado</th>
                  <th className="num">Devuelto</th><th className="num">Reposición</th><th>Estado</th><th /></tr>
              </thead>
              <tbody>
                {informes.map((i) => (
                  <tr key={i.id}>
                    <td className="cc-mono">{fecha(i.fecha_creacion)}</td>
                    <td className="cc-tenue">{fecha(i.fecha_inicio_periodo)} — {fecha(i.fecha_fin_periodo)}</td>
                    <td className="num">{bs(i.total_desembolsado)}</td>
                    <td className="num">{bs(i.total_devuelto)}</td>
                    <td className="num">{bs(i.monto_reposicion)}</td>
                    <td><EstadoInformeChip estado={i.estado} /></td>
                    <td><Link className="cc-btn cc-btn-x" to={`/rendicion-cuentas/${i.id}`}>Ver</Link></td>
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
