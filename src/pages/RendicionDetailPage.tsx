import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  enviarInformeAlDaf, facturasDeInforme, listarComprobantes, obtenerInforme,
  registrarReposicion, resolverInforme, subirReporteContable, urlPublica
} from '../lib/api'
import { exportarDatosFiscales, exportarInforme } from '../lib/exportar'
import { ValeQR } from '../components/ValeQR'
import { useAuth } from '../hooks/useAuth'
import { bs, fecha } from '../lib/formato'
import { Cabecera, Cargando, Dato, Error as AvisoError, EstadoInformeChip, Exito } from '../components/Ui'
import type { Comprobante, Factura, InformeRendicion, Profile, Solicitud } from '../types/database'

export function RendicionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { perfil } = useAuth()
  const [informe, setInforme] = useState<InformeRendicion | null>(null)
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([])
  const [adjuntos, setAdjuntos] = useState<Comprobante[]>([])
  const [admin, setAdmin] = useState<Profile | null>(null)
  const [facturas, setFacturas] = useState<Factura[]>([])
  const [reporte, setReporte] = useState<File | null>(null)
  const [nroReporte, setNroReporte] = useState('')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const { informe, solicitudes, admin } = await obtenerInforme(id!)
      setInforme(informe); setSolicitudes(solicitudes); setAdmin(admin)
      const listas = await Promise.all(solicitudes.map((s) => listarComprobantes(s.id)))
      setAdjuntos(listas.flat())
      setFacturas(await facturasDeInforme(solicitudes.map((s) => s.id)))
    } catch (e: any) { setError(e.message) } finally { setCargando(false) }
  }, [id])
  useEffect(() => { cargar() }, [cargar])

  if (cargando) return <Cargando />
  if (!informe) return <div className="cc-card"><h2>No encontramos ese informe.</h2></div>

  const rol = perfil!.role
  const esAdminDelInforme = ['admin_caja', 'super_admin'].includes(rol)
  const enBorrador = informe.estado === 'borrador'
  const puedeResolver = ['daf', 'super_admin'].includes(rol) && informe.estado === 'pendiente_daf'
  // La reposición la procesa contabilidad, no el administrador de caja:
  // quien recibe el dinero no puede ser quien declara haberlo recibido.
  const puedeReponer = ['contabilidad', 'super_admin'].includes(rol) && informe.estado === 'aprobado_daf'

  async function accion(fn: () => Promise<void>, mensaje: string) {
    setTrabajando(true); setError(null); setExito(null)
    try { await fn(); setExito(mensaje); await cargar() }
    catch (e: any) { setError(e.message) } finally { setTrabajando(false) }
  }

  return (
    <>
      <div className="cc-acc" style={{ marginBottom: 16 }}>
        <Link className="cc-btn cc-btn-x" to="/rendicion-cuentas">Volver</Link>
        <button className="cc-btn cc-btn-x"
          onClick={() => accion(
            () => exportarInforme(informe!, solicitudes, admin?.full_name ?? '—'),
            'Informe descargado.'
          )}>
          Descargar en Excel
        </button>
        <button className="cc-btn cc-btn-x"
          onClick={() => accion(
            () => exportarDatosFiscales(facturas, solicitudes, fecha(informe!.fecha_creacion).replace(/\//g, '-')),
            `Planilla con ${facturas.length} factura(s) descargada.`
          )}>
          Datos fiscales ({facturas.length})
        </button>
      </div>
      <Cabecera titulo={`Informe del ${fecha(informe.fecha_creacion)}`} />
      <p style={{ marginTop: -12, marginBottom: 20 }}>
        Período {fecha(informe.fecha_inicio_periodo)} — {fecha(informe.fecha_fin_periodo)} ·{' '}
        <EstadoInformeChip estado={informe.estado} />
      </p>

      <AvisoError mensaje={error} />
      <Exito mensaje={exito} />

      <div className="cc-grid cc-g3">
        <Dato valor={bs(informe.total_desembolsado)} rotulo="Desembolsado" />
        <Dato valor={bs(informe.total_devuelto)} rotulo="Devuelto" />
        <Dato valor={bs(informe.monto_reposicion)} rotulo="Reposición solicitada" />
      </div>

      {informe.observaciones && (
        <div className="cc-card"><h2>Observaciones</h2><p style={{ margin: 0 }}>{informe.observaciones}</p></div>
      )}

      <div className="cc-card">
        <h2>Solicitudes incluidas ({solicitudes.length})</h2>
        <div className="cc-scroll">
          <table className="cc-tabla">
            <thead><tr><th>Fecha</th><th>Solicitante</th><th>Detalle</th><th className="num">Pedido</th><th className="num">Gastado</th></tr></thead>
            <tbody>
              {solicitudes.map((s) => (
                <tr key={s.id}>
                  <td className="cc-mono">{fecha(s.fecha_desembolso ?? s.fecha_creacion)}</td>
                  <td>{s.solicitante?.full_name ?? '—'}</td>
                  <td><Link to={`/solicitudes/${s.id}`}>{s.descripcion}</Link></td>
                  <td className="num">{bs(s.monto_solicitado)}</td>
                  <td className="num">{s.monto_real == null ? '—' : bs(s.monto_real)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="cc-card">
        <h2>Comprobantes adjuntos ({adjuntos.length})</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {adjuntos.map((c) => (
            <li key={c.id}>
              <a href={urlPublica(c.archivo_url)} target="_blank" rel="noreferrer">
                {c.tipo === 'compra' ? 'Compra' : 'Devolución'} · {fecha(c.fecha_subida)}
              </a>
            </li>
          ))}
        </ul>
      </div>

      {esAdminDelInforme && enBorrador && (
        <div className="cc-card">
          <h2>Antes de enviarlo al DAF</h2>
          <p className="cc-tenue" style={{ marginTop: 0 }}>
            Las facturas de este informe se cargan en el sistema contable de la universidad con tu rol
            especial en ese sistema. El reporte que emite ahí es el respaldo con el que el DAF autoriza
            la reposición, así que va adjunto al informe.
          </p>

          <p><strong>1.</strong> Descarga la planilla con los datos fiscales de las facturas de este informe.</p>

          {(() => {
            const sinFacturas = solicitudes.filter(
              (s) => !facturas.some((f) => f.solicitud_id === s.id)
            )
            if (!facturas.length) {
              return (
                <div className="cc-aviso cc-av-mal">
                  Ninguna de las {solicitudes.length} solicitudes de este informe tiene facturas cargadas,
                  así que la planilla saldría vacía. Abre cada solicitud y carga sus facturas en la sección
                  "Facturas de esta compra": puedes hacerlo tú, aunque la solicitud ya esté cerrada.
                </div>
              )
            }
            if (sinFacturas.length) {
              return (
                <div className="cc-aviso cc-av-oro">
                  Hay {facturas.length} factura(s) cargadas, pero {sinFacturas.length} solicitud(es) no
                  tienen ninguna:{' '}
                  {sinFacturas.map((s, i) => (
                    <span key={s.id}>
                      {i > 0 && ', '}
                      <Link to={`/solicitudes/${s.id}`}>{s.descripcion}</Link>
                    </span>
                  ))}
                  . Si esas compras tuvieron factura, cárgalas antes de exportar.
                </div>
              )
            }
            return (
              <div className="cc-aviso cc-av-ok">
                {facturas.length} factura(s) cargadas, de las {solicitudes.length} solicitudes del informe.
              </div>
            )
          })()}
          <button className="cc-btn" style={{ marginBottom: 18 }} disabled={!facturas.length}
            onClick={() => accion(
              () => exportarDatosFiscales(facturas, solicitudes, fecha(informe!.fecha_creacion).replace(/\//g, '-')),
              'Planilla descargada.'
            )}>
            Datos fiscales para el sistema contable
          </button>

          <p><strong>2.</strong> Cárgalas en el sistema contable y sube el reporte que te devuelve.</p>
          <div className="cc-dos">
            <div className="cc-campo">
              <label>Nº de reporte o comprobante contable</label>
              <input value={nroReporte} onChange={(e) => setNroReporte(e.target.value)} />
            </div>
            <div className="cc-campo">
              <label>Archivo del reporte</label>
              <input type="file" accept="application/pdf,image/*"
                onChange={(e) => setReporte(e.target.files?.[0] ?? null)} />
            </div>
          </div>
          <button className="cc-btn" disabled={!reporte || trabajando}
            onClick={() => accion(
              () => subirReporteContable(informe!.id, reporte!, nroReporte),
              'Reporte contable adjuntado.'
            )}>
            Adjuntar reporte contable
          </button>

          {informe.reporte_contable_url && (
            <div className="cc-aviso cc-av-ok" style={{ marginTop: 18 }}>
              Reporte adjunto{informe.reporte_contable_nro && ` — Nº ${informe.reporte_contable_nro}`} ·{' '}
              <a href={urlPublica(informe.reporte_contable_url)} target="_blank" rel="noreferrer">abrir</a>
            </div>
          )}

          <p style={{ marginTop: 18 }}><strong>3.</strong> Envíalo al DAF para que autorice la reposición.</p>
          <button className="cc-btn cc-btn-p" disabled={trabajando || !informe.reporte_contable_url}
            onClick={() => accion(() => enviarInformeAlDaf(informe!), 'Informe enviado al DAF.')}>
            Enviar al DAF
          </button>
          {!informe.reporte_contable_url && (
            <p className="cc-tenue" style={{ fontSize: 13 }}>
              Sin el reporte contable adjunto no se puede enviar.
            </p>
          )}
        </div>
      )}

      {informe.reporte_contable_url && !enBorrador && (
        <div className="cc-card">
          <h2>Respaldo contable</h2>
          <p style={{ marginTop: 0 }}>
            Las facturas fueron cargadas en el sistema contable
            {informe.reporte_contable_nro && ` bajo el Nº ${informe.reporte_contable_nro}`}.{' '}
            <a href={urlPublica(informe.reporte_contable_url)} target="_blank" rel="noreferrer">
              Ver el reporte
            </a>
          </p>
        </div>
      )}

      {puedeResolver && (
        <div className="cc-card">
          <h2>Decisión del DAF</h2>
          <p className="cc-tenue">Los informes se aprueban solo desde el sistema, nunca desde WhatsApp: el monto y la formalidad lo justifican.</p>
          <div className="cc-acc">
            <button className="cc-btn cc-btn-p" disabled={trabajando}
              onClick={() => accion(() => resolverInforme(informe, true, perfil!.id), 'Informe aprobado.')}>
              Aprobar informe
            </button>
            <button className="cc-btn cc-btn-r" disabled={trabajando}
              onClick={() => accion(() => resolverInforme(informe, false, perfil!.id), 'Informe rechazado.')}>
              Rechazar
            </button>
          </div>
        </div>
      )}

      {puedeReponer && (
        <div className="cc-card">
          <h2>Procesar la reposición</h2>
          <p className="cc-tenue" style={{ marginTop: 0 }}>
            El DAF ya aprobó este informe. Transfiere {bs(informe.monto_reposicion)} al QR de
            {' '}{admin?.full_name ?? 'el administrador de caja'} y registra el movimiento aquí.
          </p>
          <ValeQR
            titulo={`Transferir a ${admin?.full_name ?? 'el administrador de caja'}`}
            qrRuta={admin?.qr_url}
            faltaQR={`${admin?.full_name ?? 'El administrador de caja'} todavía no cargó su QR de cobro. Pídele que lo suba desde Mi perfil.`}
            datos={{
              solicitud_id: informe.id,
              monto: Number(informe.monto_reposicion),
              admin: perfil!.full_name ?? perfil!.email,
              tipo: 'desembolso'
            }}
          />
          <div className="cc-acc" style={{ marginTop: 18 }}>
            <button className="cc-btn cc-btn-p" disabled={trabajando}
              onClick={() => accion(
                () => registrarReposicion(informe, perfil!.id),
                'Reposición registrada. El saldo de caja subió y el informe quedó cerrado.'
              )}>
              Confirmar transferencia de {bs(informe.monto_reposicion)}
            </button>
          </div>
        </div>
      )}

      {informe.estado === 'aprobado_daf' && ['admin_caja', 'daf'].includes(rol) && (
        <div className="cc-aviso cc-av-oro">
          Aprobado por el DAF. Contabilidad tiene que procesar la transferencia de
          {' '}{bs(informe.monto_reposicion)} para que el saldo de caja vuelva a subir.
        </div>
      )}
    </>
  )
}
