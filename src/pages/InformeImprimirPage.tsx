import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { facturasDeInforme, gastoNeto, numeroInforme, obtenerInforme, obtenerParametros } from '../lib/api'
import { supabase } from '../lib/supabase'
import { bs, fecha, montoLiteral } from '../lib/formato'
import type { Factura, InformeRendicion, Parametros, Profile, Solicitud } from '../types/database'

/**
 * Informe del ciclo para imprimir: carátula con el resumen, tabla con todos
 * los movimientos y las firmas del administrador de caja, el DAF y Rectorado.
 * Se presenta en papel; el escaneo con las tres firmas lo sube el DAF.
 */
export function InformeImprimirPage() {
  const { id } = useParams<{ id: string }>()
  const [datos, setDatos] = useState<{
    informe: InformeRendicion; solicitudes: Solicitud[]; admin: Profile | null
    facturas: Factura[]; param: Parametros | null; daf: string | null
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const { informe, solicitudes, admin } = await obtenerInforme(id!)
      if (!informe) throw new Error('No encontramos ese informe.')
      const orden = [...solicitudes].sort((a, b) =>
        (a.fecha_desembolso ?? a.fecha_creacion).localeCompare(b.fecha_desembolso ?? b.fecha_creacion))
      const [facturas, param, daf] = await Promise.all([
        facturasDeInforme(solicitudes.map((s) => s.id)),
        obtenerParametros().catch(() => null),
        supabase.from('profiles').select('full_name').eq('role', 'daf').eq('activo', true).limit(1).maybeSingle()
          .then((r) => r.data?.full_name ?? null)
      ])
      setDatos({ informe, solicitudes: orden, admin, facturas, param, daf })
      document.title = `Informe de caja chica ${numeroInforme(informe)}`
    })().catch((e) => setError(e.message ?? String(e)))
  }, [id])

  if (error) return <div style={{ padding: 30 }}>{error}</div>
  if (!datos) return <div style={{ padding: 30 }}>Preparando el informe…</div>

  const { informe, solicitudes, admin, facturas, param, daf } = datos
  // En borrador los totales del informe todavía no están congelados: se calculan de los vales.
  const calc = gastoNeto(solicitudes)
  const enBorrador = informe.estado === 'borrador'
  const desembolsado = enBorrador ? calc.desembolsado : Number(informe.total_desembolsado)
  const devuelto = enBorrador ? calc.devuelto : Number(informe.total_devuelto)
  const reposicion = enBorrador ? calc.neto : Number(informe.monto_reposicion)
  const facturado = facturas.reduce((s, f) => s + Number(f.monto), 0)
  const institucion = param?.razon_social_institucion || 'Universidad Católica Boliviana «San Pablo»'
  const adminNombre = admin?.full_name ?? 'Administrador de caja chica'
  const inicio = informe.fecha_inicio_periodo ?? solicitudes[0]?.fecha_desembolso ?? null
  const fin = informe.fecha_fin_periodo ?? solicitudes[solicitudes.length - 1]?.fecha_desembolso ?? null

  return (
    <div className="inf">
      <style>{CSS}</style>

      <div className="inf-barra">
        <Link to={`/rendicion-cuentas/${informe.id}`}>← Volver al informe</Link>
        <button onClick={() => window.print()}>Imprimir</button>
        <span>Imprime en hoja carta u oficio, vertical. Fírmalo y entrégalo al DAF.</span>
      </div>

      <div className="inf-hoja">
        {enBorrador && <div className="inf-marca">Borrador — aún no enviado al DAF</div>}

        <header className="inf-cab">
          <div>
            <div className="inf-inst">{institucion}</div>
            <div className="inf-sub">Sede Tarija · Caja chica</div>
          </div>
          <div className="inf-nro">
            <div>Informe {numeroInforme(informe)}</div>
            <div className="inf-sub">Tarija, {fecha(new Date().toISOString())}</div>
          </div>
        </header>

        <h1>Informe de rendición de caja chica</h1>

        <table className="inf-ref">
          <tbody>
            <tr><th>A:</th><td>{daf ?? '—'} · Dirección Administrativa Financiera</td></tr>
            <tr><th>Vía:</th><td>Rectorado</td></tr>
            <tr><th>De:</th><td>{adminNombre} · Administrador de caja chica</td></tr>
            <tr><th>Ref.:</th><td>Rendición de cuentas del ciclo y pedido de reposición del fondo</td></tr>
          </tbody>
        </table>

        <h2>Resumen</h2>
        <table className="inf-resumen">
          <tbody>
            <tr><td>Período de los movimientos</td><td className="n">{fecha(inicio)} al {fecha(fin)}</td></tr>
            {param?.monto_reposicion != null && <tr><td>Fondo de caja chica asignado</td><td className="n">{bs(param.monto_reposicion)}</td></tr>}
            <tr><td>Vales rendidos en este informe</td><td className="n">{solicitudes.length}</td></tr>
            <tr><td>Total desembolsado</td><td className="n">{bs(desembolsado)}</td></tr>
            <tr><td>Total devuelto a caja</td><td className="n">{bs(devuelto)}</td></tr>
            <tr><td>Total facturado ({facturas.length} factura{facturas.length === 1 ? '' : 's'})</td><td className="n">{bs(facturado)}</td></tr>
            <tr><td>Saldo en caja al armar el informe</td><td className="n">{bs(informe.saldo_cuenta)}</td></tr>
            {informe.reporte_contable_nro && <tr><td>Reporte del sistema contable</td><td className="n">N.º {informe.reporte_contable_nro}</td></tr>}
            <tr className="inf-total"><td>Reposición solicitada (gasto neto rendido)</td><td className="n">{bs(reposicion)}</td></tr>
          </tbody>
        </table>
        <p className="inf-son"><strong>Son:</strong> {montoLiteral(reposicion)}</p>

        <p>
          Se presenta la rendición de los {solicitudes.length} vales de caja chica detallados a continuación.
          Cada vale cuenta con sus facturas o comprobantes originales, firmados por el superior del
          solicitante y verificados por el administrador de caja. Se solicita la reposición del fondo por
          el monto del gasto neto rendido.
        </p>
        {informe.observaciones && <p><strong>Observaciones:</strong> {informe.observaciones}</p>}

        <h2 className="inf-salto">Detalle de movimientos</h2>
        <table className="inf-detalle">
          <thead>
            <tr>
              <th>#</th><th>Fecha</th><th>Solicitante</th><th style={{ width: '30%' }}>Detalle · vale</th><th>Categoría</th>
              <th className="n">Desembolsado</th><th className="n">Gastado</th><th className="n">Devuelto</th>
              <th className="n">Facturas</th>
            </tr>
          </thead>
          <tbody>
            {solicitudes.map((s, i) => {
              const gastado = Number(s.monto_real ?? s.monto_solicitado)
              const dev = Math.max(Number(s.monto_solicitado) - gastado, 0)
              const fs = facturas.filter((f) => f.solicitud_id === s.id)
              return (
                <tr key={s.id}>
                  <td>{i + 1}</td>
                  <td className="nw">{fecha(s.fecha_desembolso ?? s.fecha_creacion)}</td>
                  <td>{s.solicitante?.full_name ?? '—'}</td>
                  <td>{s.descripcion} <span className="mono">· {s.id.slice(0, 8)}</span></td>
                  <td>{s.categoria ?? '—'}</td>
                  <td className="n">{bs(s.monto_solicitado)}</td>
                  <td className="n">{bs(gastado)}</td>
                  <td className="n">{dev ? bs(dev) : '—'}</td>
                  <td className="n">{fs.length ? `${fs.length} · ${bs(fs.reduce((t, f) => t + Number(f.monto), 0))}` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>Totales</td>
              <td className="n">{bs(desembolsado)}</td>
              <td className="n">{bs(desembolsado - devuelto)}</td>
              <td className="n">{bs(devuelto)}</td>
              <td className="n">{bs(facturado)}</td>
            </tr>
          </tfoot>
        </table>

        <div className="inf-cierre">
          <p>
            Informe {numeroInforme(informe)} · {solicitudes.length} vales · reposición solicitada de {bs(reposicion)}{' '}
            ({montoLiteral(reposicion)}). En constancia firman:
          </p>
          <div className="inf-firmas">
          <div>
            <div className="inf-linea" />
            <strong>{adminNombre}</strong>
            <span>Administrador de caja chica</span>
            <span className="inf-rol">Elaborado y presentado</span>
          </div>
          <div>
            <div className="inf-linea" />
            <strong>{daf ?? ' '}</strong>
            <span>Dirección Administrativa Financiera</span>
            <span className="inf-rol">Revisado y aprobado</span>
          </div>
          <div>
            <div className="inf-linea" />
            <strong>&nbsp;</strong>
            <span>Rectorado</span>
            <span className="inf-rol">Visto bueno</span>
          </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const CSS = `
.inf { background: #e9ecef; min-height: 100vh; padding: 0 16px 40px; color: #111;
  font-family: "Helvetica Neue", Arial, sans-serif; font-size: 12.5px; line-height: 1.45; }
.inf * { box-sizing: border-box; }
.inf-barra { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 12px; align-items: center;
  max-width: 820px; margin: 0 auto; padding: 12px 0; background: #e9ecef; font-size: 14px; }
.inf-barra a { color: #1b3a6b; }
.inf-barra button { background: #1b3a6b; color: #fff; border: 0; padding: 9px 18px; font-size: 14px; font-weight: 600; cursor: pointer; }
.inf-barra span { color: #555; font-size: 13px; }
.inf-hoja { position: relative; background: #fff; max-width: 820px; margin: 0 auto; padding: 48px 52px; box-shadow: 0 2px 10px rgba(0,0,0,.12); }
.inf-marca { border: 2px dashed #b02a37; color: #b02a37; text-align: center; font-weight: 700; padding: 6px; margin-bottom: 18px; text-transform: uppercase; letter-spacing: .05em; }
.inf-cab { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #1b3a6b; padding-bottom: 10px; }
.inf-inst { font-weight: 700; font-size: 14px; color: #1b3a6b; }
.inf-sub { color: #555; font-size: 12px; }
.inf-nro { text-align: right; font-weight: 700; font-size: 14px; }
.inf h1 { font-size: 19px; text-align: center; text-transform: uppercase; letter-spacing: .04em; margin: 22px 0 16px; }
.inf h2 { font-size: 13.5px; text-transform: uppercase; letter-spacing: .04em; color: #1b3a6b; margin: 22px 0 8px; }
.inf p { margin: 8px 0; text-align: justify; }
.inf table { border-collapse: collapse; width: 100%; }
.inf-ref th { text-align: left; width: 48px; vertical-align: top; padding: 2px 0; }
.inf-ref td { padding: 2px 0; }
.inf-resumen td { border-bottom: 1px solid #ccc; padding: 5px 4px; }
.inf-resumen tr.inf-total td { border-top: 2px solid #111; border-bottom: 2px solid #111; font-weight: 700; font-size: 14px; }
.inf-son { background: #f3f5f8; padding: 6px 10px; }
.inf-detalle { font-size: 11px; }
.inf-detalle th, .inf-detalle td { border: 1px solid #999; padding: 4px 5px; vertical-align: top; }
.inf-detalle thead th { background: #eef1f6; text-align: left; }
.inf-detalle tfoot td { font-weight: 700; background: #eef1f6; }
.inf .n { text-align: right; white-space: nowrap; }
.inf .nw { white-space: nowrap; }
.inf .mono { font-family: ui-monospace, Menlo, monospace; font-size: 10px; color: #555; white-space: nowrap; }
.inf-cierre { margin-top: 18px; break-inside: avoid; page-break-inside: avoid; }
.inf-firmas { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; margin-top: 70px; text-align: center; }
.inf-firmas > div { display: flex; flex-direction: column; font-size: 11.5px; }
.inf-linea { border-top: 1px solid #111; margin-bottom: 6px; }
.inf-rol { color: #555; font-style: italic; margin-top: 2px; }
@media (max-width: 640px) {
  .inf-hoja { padding: 24px 18px; }
  .inf-firmas { grid-template-columns: 1fr; gap: 60px; }
  .inf-detalle { display: block; overflow-x: auto; }
}
@media print {
  @page { size: auto; margin: 16mm 14mm; }
  .inf { background: #fff; padding: 0; }
  .inf-barra { display: none; }
  .inf-hoja { box-shadow: none; padding: 0; max-width: none; }
  .inf-salto { break-before: page; page-break-before: always; margin-top: 0; }
  .inf-detalle thead { display: table-header-group; }
  .inf-detalle tr { break-inside: avoid; }
  .inf-firmas { grid-template-columns: repeat(3, 1fr); }
}
`
