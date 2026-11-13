import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  crearInforme, gastoNeto, INFORME_EN_CURSO, listarInformes, listarPerfiles, obtenerSaldo, solicitudesSinRendir
} from '../lib/api'
import { exportarInformes } from '../lib/exportar'
import { PedirReposicion } from '../components/PedirReposicion'
import { useAuth } from '../hooks/useAuth'
import { bs, fecha } from '../lib/formato'
import { Alerta, Cabecera, Cargando, Error as AvisoError, EstadoInformeChip, Vacio } from '../components/Ui'
import type { InformeRendicion, Solicitud } from '../types/database'

export function RendicionCuentasPage() {
  const { perfil, parametros, periodo } = useAuth()
  const navegar = useNavigate()
  const [informes, setInformes] = useState<InformeRendicion[]>([])
  const [candidatas, setCandidatas] = useState<Solicitud[]>([])
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

  if (cargando) return <Cargando />
  const umbral = Number(parametros?.umbral_reposicion ?? 700)
  const enCurso = informes.find((i) => INFORME_EN_CURSO.includes(i.estado))
  const totales = gastoNeto(candidatas)
  const puedeArmar = !enCurso && saldo <= umbral && candidatas.length > 0

  return (
    <>
      <Cabecera titulo="Rendición de cuentas"
        bajada={`Cuando el saldo llega a ${bs(umbral)} o menos se arma un único informe con todo lo rendido. El DAF lo aprueba, el administrador de caja pide la reposición y contabilidad la transfiere.`} />
      <AvisoError mensaje={error} />
      {saldo <= umbral && !enCurso && (
        <Alerta mensaje={`El saldo está en ${bs(saldo)}: toca armar el informe del ciclo para pedir la reposición.`} />
      )}

      {puedeCrear && (
        <div className="cc-card">
          <h2>Informe del ciclo</h2>

          {enCurso?.estado === 'aprobado_daf' ? (
            <>
              <div className="cc-aviso cc-av-ok">
                El DAF aprobó el informe del ciclo. Pide la reposición para que contabilidad transfiera.
              </div>
              <PedirReposicion informe={enCurso} onListo={() => { void cargar() }} />
            </>
          ) : enCurso ? (
            <div className="cc-aviso cc-av-oro">
              Hay un informe en curso (<EstadoInformeChip estado={enCurso.estado} enRectorado={!!enCurso.fecha_firma_daf} />). Hasta que
              contabilidad confirme su reposición no se puede armar otro.{' '}
              <Link to={`/rendicion-cuentas/${enCurso.id}`}>Ver el informe</Link>
            </div>
          ) : saldo > umbral ? (
            <div className="cc-aviso cc-av-ok">
              El informe se arma cuando el saldo llegue a <strong>{bs(umbral)}</strong> o menos. Saldo
              actual: <strong>{bs(saldo)}</strong>. Mientras tanto se acumulan las rendiciones cerradas:
              {' '}{candidatas.length} solicitud(es), gasto neto {bs(totales.neto)}.
            </div>
          ) : !candidatas.length ? (
            <Vacio texto="No hay solicitudes rendidas y cerradas para incluir." />
          ) : null}

          {candidatas.length > 0 && (
            <>
              <p className="cc-tenue" style={{ marginTop: 14 }}>
                Entran todas las solicitudes cerradas con su documentación física firmada y conforme. La
                reposición es el gasto neto: lo desembolsado menos lo devuelto.
              </p>
              <div className="cc-scroll">
                <table className="cc-tabla">
                  <thead>
                    <tr><th>Fecha</th><th>Solicitante</th><th>Detalle</th>
                      <th className="num">Desembolsado</th><th className="num">Devuelto</th></tr>
                  </thead>
                  <tbody>
                    {candidatas.map((c) => (
                      <tr key={c.id}>
                        <td className="cc-mono">{fecha(c.fecha_desembolso ?? c.fecha_creacion)}</td>
                        <td>{c.solicitante?.full_name ?? '—'}</td>
                        <td><Link to={`/solicitudes/${c.id}`}>{c.descripcion}</Link></td>
                        <td className="num">{bs(c.monto_solicitado)}</td>
                        <td className="num">{bs(Math.max(Number(c.monto_solicitado) - Number(c.monto_real ?? c.monto_solicitado), 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>Totales</td>
                      <td className="num">{bs(totales.desembolsado)}</td>
                      <td className="num">{bs(totales.devuelto)}</td>
                    </tr>
                    <tr>
                      <td colSpan={4}><strong>Reposición a pedir (desembolsado − devuelto)</strong></td>
                      <td className="num"><strong>{bs(totales.neto)}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}

          {puedeArmar && (
            <>
              <div className="cc-campo" style={{ marginTop: 18 }}>
                <label>Observaciones para el DAF</label>
                <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
              </div>
              <button className="cc-btn cc-btn-p" disabled={trabajando}
                onClick={async () => {
                  setTrabajando(true); setError(null)
                  try {
                    const id = await crearInforme({
                      adminCajaId: perfil!.id, periodoId: periodo?.id ?? null,
                      solicitudes: candidatas, observaciones
                    })
                    navegar(`/rendicion-cuentas/${id}`)
                  } catch (e: any) { setError(e.message) } finally { setTrabajando(false) }
                }}>
                {trabajando ? 'Creando…' : `Crear informe del ciclo — ${candidatas.length} solicitudes, ${bs(totales.neto)}`}
              </button>
            </>
          )}
        </div>
      )}

      <div className="cc-card">
        <h2>Informes</h2>
        {informes.length > 0 && (
          <button className="cc-btn cc-btn-x" style={{ marginBottom: 14 }}
            onClick={async () => {
              try {
                const perfiles = await listarPerfiles()
                await exportarInformes(informes, new Map(perfiles.map((p) => [p.id, p.full_name ?? p.email])))
              } catch (e: any) { setError(e.message) }
            }}>
            Descargar historial en Excel
          </button>
        )}
        {!informes.length ? <Vacio texto="Todavía no se generó ningún informe." /> : (
          <div className="cc-scroll">
            <table className="cc-tabla">
              <thead>
                <tr><th>N.º</th><th>Creado</th><th>Período</th><th className="num">Desembolsado</th>
                  <th className="num">Devuelto</th><th className="num">Reposición</th><th>Estado</th><th /></tr>
              </thead>
              <tbody>
                {informes.map((i) => (
                  <tr key={i.id}>
                    <td className="cc-mono">{i.numero ? `${i.numero}/${i.gestion}` : '—'}</td>
                    <td className="cc-mono">{fecha(i.fecha_creacion)}</td>
                    <td className="cc-tenue">{fecha(i.fecha_inicio_periodo)} — {fecha(i.fecha_fin_periodo)}</td>
                    <td className="num">{bs(i.total_desembolsado)}</td>
                    <td className="num">{bs(i.total_devuelto)}</td>
                    <td className="num">{bs(i.monto_reposicion)}</td>
                    <td><EstadoInformeChip estado={i.estado} enRectorado={!!i.fecha_firma_daf} /></td>
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
