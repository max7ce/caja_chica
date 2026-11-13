import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  darOkInforme, enviarInformeAlDaf, facturasDeInforme, firmarYEnviarARectorado, listarComprobantes,
  numeroInforme, obtenerInforme, rechazarInforme, registrarReposicion, subirReporteContable
} from '../lib/api'
import { EnlaceArchivo } from '../components/ArchivoFirmado'
import { exportarDatosFiscales, exportarInforme } from '../lib/exportar'
import { ValeQR } from '../components/ValeQR'
import { PedirReposicion } from '../components/PedirReposicion'
import { useAuth } from '../hooks/useAuth'
import { bs, etiquetaComprobante, fecha, fechaHora } from '../lib/formato'
import { Cabecera, Cargando, Dato, Error as AvisoError, EstadoInformeChip, Exito } from '../components/Ui'
import type { Comprobante, Factura, InformeRendicion, Profile, Solicitud } from '../types/database'
import { avisos, ofrecerLuego } from '../lib/whatsapp'

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
  // Pasos del DAF con el papel
  const [recibido, setRecibido] = useState(false)
  const [firmado, setFirmado] = useState(false)
  const [rectorado, setRectorado] = useState(false)
  const [escaneo, setEscaneo] = useState<File | null>(null)
  const [rechazando, setRechazando] = useState(false)
  const [motivo, setMotivo] = useState('')

  const cargar = useCallback(async () => {
    try {
      const { informe, solicitudes, admin } = await obtenerInforme(id!)
      setInforme(informe); setSolicitudes(solicitudes); setAdmin(admin)
      const listas = await Promise.all(solicitudes.map((s) => listarComprobantes(s.id)))
      setAdjuntos(listas.flat().filter((c) => c.tipo !== 'cotizacion'))
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
  const enRectorado = informe.estado === 'pendiente_daf' && !!informe.fecha_firma_daf
  const imprimir = `/rendicion-cuentas/${informe.id}/imprimir`
  // La reposición la procesa contabilidad, no el administrador de caja:
  // quien recibe el dinero no puede ser quien declara haberlo recibido.
  const puedeReponer = ['contabilidad', 'super_admin'].includes(rol) && informe.estado === 'reposicion_solicitada'
  // El pedido es obligatorio y manual: lo hace el administrador de caja tras la aprobación del DAF.
  const puedePedir = esAdminDelInforme && informe.estado === 'aprobado_daf'

  async function accion(fn: () => Promise<void>, mensaje: string) {
    setTrabajando(true); setError(null); setExito(null)
    try { await fn(); setExito(mensaje); await cargar() }
    catch (e: any) { setError(e.message) } finally { setTrabajando(false) }
  }

  return (
    <>
      <div className="cc-acc" style={{ marginBottom: 16 }}>
        <Link className="cc-btn cc-btn-x" to="/rendicion-cuentas">Volver</Link>
        <Link className="cc-btn" to={imprimir} target="_blank" rel="noreferrer">Imprimir informe</Link>
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
      <Cabecera titulo={`Informe ${numeroInforme(informe)}`} />
      <p style={{ marginTop: -12, marginBottom: 20 }}>
        Creado el {fecha(informe.fecha_creacion)} · Período {fecha(informe.fecha_inicio_periodo)} — {fecha(informe.fecha_fin_periodo)} ·{' '}
        <EstadoInformeChip estado={informe.estado} enRectorado={enRectorado} />
      </p>

      <AvisoError mensaje={error} />
      <Exito mensaje={exito} />

      <div className="cc-grid cc-g3">
        <Dato valor={bs(informe.total_desembolsado)} rotulo="Desembolsado" />
        <Dato valor={bs(informe.total_devuelto)} rotulo="Devuelto" />
        <Dato valor={bs(informe.monto_reposicion)} rotulo="Reposición (gasto neto)" />
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
              <EnlaceArchivo ruta={c.archivo_url}>
                {etiquetaComprobante(c)} · {fecha(c.fecha_subida)}
              </EnlaceArchivo>
            </li>
          ))}
        </ul>
      </div>

      {esAdminDelInforme && enBorrador && (
        <div className="cc-card">
          <h2>Antes de enviarlo al DAF</h2>
          <p className="cc-tenue" style={{ marginTop: 0 }}>
            Las facturas ya están en el sistema: las cargaron los solicitantes al rendir y vos las
            verificaste al recibir los papeles. Lo que falta es llevarlas al sistema contable de la
            universidad, con tu rol especial en ese sistema, y adjuntar acá el reporte que emite. Ese
            reporte es el respaldo con el que el DAF autoriza la reposición.
          </p>

          <p><strong>1.</strong> Descarga la planilla con los datos fiscales ya cargados. No hay que
            volver a tipear nada.</p>

          {(() => {
            const sinFacturas = solicitudes.filter(
              (s) => !facturas.some((f) => f.solicitud_id === s.id)
            )
            if (!facturas.length) {
              return (
                <div className="cc-aviso cc-av-mal">
                  Ninguna de las {solicitudes.length} solicitudes de este informe tiene facturas cargadas,
                  así que la planilla saldría vacía. Esto no debería pasar si se cargaron al rendir: entra a
                  cada solicitud y cárgalas en "Facturas de esta compra". Podés hacerlo vos aunque ya
                  estén cerradas.
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

          <p><strong>2.</strong> Con esa planilla, cárgalas en el <strong>sistema contable de la
            universidad</strong> y sube acá el reporte que te devuelve.</p>
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
              <EnlaceArchivo ruta={informe.reporte_contable_url}>abrir</EnlaceArchivo>
            </div>
          )}

          <p style={{ marginTop: 18 }}><strong>3.</strong> Envíalo al DAF en el sistema. Después imprime el
            informe (carátula, detalle de movimientos y firmas), <strong>fírmalo</strong> y entrégalo en
            físico al DAF: él lo firma, lo envía a Rectorado y, cuando vuelva firmado, te da el OK para
            pedir la reposición.</p>
          <button className="cc-btn cc-btn-p" disabled={trabajando || !informe.reporte_contable_url}
            onClick={() => accion(async () => { await enviarInformeAlDaf(informe!); ofrecerLuego(() => avisos.informeEnviado(informe!)) }, 'Informe enviado al DAF.')}>
            Enviar al DAF
          </button>{' '}
          <Link className="cc-btn" to={imprimir} target="_blank" rel="noreferrer">Ver la hoja para imprimir</Link>
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
            <EnlaceArchivo ruta={informe.reporte_contable_url}>
              Ver el reporte
            </EnlaceArchivo>
          </p>
        </div>
      )}

      {!enBorrador && (
        <div className="cc-card">
          <h2>Informe en papel y firmas</h2>
          <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
            <li>{informe.firma_admin_fisica ? '✔' : '○'} Firmado por el administrador de caja y entregado al DAF
              {informe.fecha_recepcion_daf && <span className="cc-tenue"> · recibido el {fechaHora(informe.fecha_recepcion_daf)}</span>}</li>
            <li>{informe.fecha_firma_daf ? '✔' : '○'} Firmado por el DAF y enviado a Rectorado
              {informe.fecha_firma_daf && <span className="cc-tenue"> · {fechaHora(informe.fecha_firma_daf)}</span>}</li>
            <li>{informe.fecha_firma_rectorado ? '✔' : '○'} Firmado por Rectorado y OK del DAF
              {informe.fecha_firma_rectorado && <span className="cc-tenue"> · {fechaHora(informe.fecha_firma_rectorado)}</span>}</li>
          </ol>
          {informe.informe_firmado_url && (
            <p style={{ marginBottom: 0 }}>
              <EnlaceArchivo ruta={informe.informe_firmado_url}>Ver el informe escaneado con las tres firmas</EnlaceArchivo>
            </p>
          )}
          {informe.estado === 'pendiente_daf' && !puedeResolver && (
            <p className="cc-tenue" style={{ marginBottom: 0 }}>
              {enRectorado
                ? 'El informe está en Rectorado. Cuando vuelva firmado, el DAF dará el OK para pedir la reposición.'
                : 'Entrega el informe impreso y firmado al DAF. Él registra aquí cada firma.'}
            </p>
          )}
        </div>
      )}

      {puedeResolver && !enRectorado && (
        <div className="cc-card" style={{ borderLeft: '6px solid var(--azul-ucb)' }}>
          <h2>Paso 1 · Recibir, firmar y enviar a Rectorado</h2>
          <p className="cc-tenue" style={{ marginTop: 0 }}>
            El administrador de caja te entrega el informe {numeroInforme(informe)} impreso. Compáralo con
            esta pantalla (reposición de {bs(informe.monto_reposicion)}, {solicitudes.length} vales) antes de firmar.
          </p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
            <input type="checkbox" checked={recibido} onChange={(e) => setRecibido(e.target.checked)} />
            <span>Recibí el informe impreso firmado por {admin?.full_name ?? 'el administrador de caja'}.</span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 12 }}>
            <input type="checkbox" checked={firmado} onChange={(e) => setFirmado(e.target.checked)} />
            <span>Lo revisé, lo firmé y lo envío a Rectorado.</span>
          </label>
          <div className="cc-acc">
            <button className="cc-btn cc-btn-p" disabled={trabajando || !recibido || !firmado}
              onClick={() => accion(async () => {
                await firmarYEnviarARectorado(informe)
                ofrecerLuego(() => avisos.informeEnRectorado(informe))
              }, 'Registrado: el informe está en Rectorado.')}>
              Firmado, enviar a Rectorado
            </button>
            <button className="cc-btn cc-btn-r" disabled={trabajando} onClick={() => setRechazando(true)}>Rechazar</button>
          </div>
        </div>
      )}

      {puedeResolver && enRectorado && (
        <div className="cc-card" style={{ borderLeft: '6px solid var(--azul-ucb)' }}>
          <h2>Paso 2 · Volvió de Rectorado: dar el OK</h2>
          <p className="cc-tenue" style={{ marginTop: 0 }}>
            Enviado a Rectorado el {fechaHora(informe.fecha_firma_daf)}. Con la firma de Rectorado, sube el
            escaneo del informe con las tres firmas. Recién entonces el administrador de caja podrá pedir la
            reposición de {bs(informe.monto_reposicion)} a Contabilidad.
          </p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 12 }}>
            <input type="checkbox" checked={rectorado} onChange={(e) => setRectorado(e.target.checked)} />
            <span>Rectorado firmó el informe.</span>
          </label>
          <div className="cc-campo" style={{ maxWidth: 420 }}>
            <label>Escaneo o foto del informe con las tres firmas (PDF o imagen)</label>
            <input type="file" accept="application/pdf,image/*" onChange={(e) => setEscaneo(e.target.files?.[0] ?? null)} />
          </div>
          <div className="cc-acc">
            <button className="cc-btn cc-btn-p" disabled={trabajando || !rectorado || !escaneo}
              onClick={() => accion(async () => {
                await darOkInforme(informe, escaneo!)
                ofrecerLuego(() => avisos.informeResuelto(informe, true))
              }, 'OK registrado. El administrador de caja ya puede pedir la reposición.')}>
              Dar OK para pedir la reposición
            </button>
            <button className="cc-btn cc-btn-r" disabled={trabajando} onClick={() => setRechazando(true)}>Rechazar</button>
          </div>
          {(!rectorado || !escaneo) && (
            <p className="cc-tenue" style={{ fontSize: 13 }}>Marca la firma de Rectorado y adjunta el escaneo para habilitar el OK.</p>
          )}
        </div>
      )}

      {puedeResolver && rechazando && (
        <div className="cc-card" style={{ borderLeft: '6px solid #b02a37' }}>
          <h2>Rechazar el informe</h2>
          <p className="cc-tenue" style={{ marginTop: 0 }}>
            Sus vales vuelven a quedar disponibles y el administrador de caja tiene que armar el informe de nuevo.
          </p>
          <div className="cc-campo">
            <label>Motivo (lo recibe el administrador de caja)</label>
            <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <div className="cc-acc">
            <button className="cc-btn cc-btn-r" disabled={trabajando || !motivo.trim()}
              onClick={() => accion(async () => {
                await rechazarInforme(informe, motivo)
                ofrecerLuego(() => avisos.informeResuelto(informe, false, motivo.trim()))
                setRechazando(false)
              }, 'Informe rechazado.')}>
              Confirmar rechazo
            </button>
            <button className="cc-btn cc-btn-x" disabled={trabajando} onClick={() => setRechazando(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {puedePedir && (
        <div className="cc-card">
          <h2>Pedir la reposición</h2>
          <p className="cc-tenue" style={{ marginTop: 0 }}>
            El informe tiene las firmas del DAF y de Rectorado, y el DAF dio el OK{informe.fecha_aprobacion_daf && ` el ${fecha(informe.fecha_aprobacion_daf)}`}.
            Para cerrar el ciclo tienes que pedir la reposición: contabilidad recién transfiere con este pedido.
          </p>
          <PedirReposicion informe={informe} cantidadVales={solicitudes.length} verInforme={false}
            onListo={() => { void cargar() }} />
        </div>
      )}

      {puedeReponer && (
        <div className="cc-card">
          <h2>Procesar la reposición</h2>
          <p className="cc-tenue" style={{ marginTop: 0 }}>
            El administrador de caja pidió la reposición
            {informe.fecha_pedido_reposicion && ` el ${fecha(informe.fecha_pedido_reposicion)}`}.
            Transfiere {bs(informe.monto_reposicion)} al QR de
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
                async () => { await registrarReposicion(informe, perfil!.id); ofrecerLuego(() => avisos.reposicionHecha(informe)) },
                'Reposición registrada. El saldo de caja subió y el informe quedó cerrado.'
              )}>
              Confirmar transferencia de {bs(informe.monto_reposicion)}
            </button>
          </div>
        </div>
      )}

      {informe.estado === 'aprobado_daf' && !puedePedir && (
        <div className="cc-aviso cc-av-oro">
          Firmado por el DAF y Rectorado, con el OK del DAF. Falta que el administrador de caja pida la reposición de
          {' '}{bs(informe.monto_reposicion)}.
        </div>
      )}

      {informe.estado === 'reposicion_solicitada' && !puedeReponer && (
        <div className="cc-aviso cc-av-oro">
          Reposición pedida{informe.fecha_pedido_reposicion && ` el ${fecha(informe.fecha_pedido_reposicion)}`}.
          Contabilidad tiene que transferir {bs(informe.monto_reposicion)} para que el saldo de caja vuelva a subir.
        </div>
      )}

      {informe.estado === 'rechazado' && (
        <div className="cc-aviso cc-av-mal">
          Informe rechazado{informe.motivo_rechazo && <>: {informe.motivo_rechazo}</>}. Sus vales vuelven a estar disponibles para armar el informe de nuevo.
        </div>
      )}
    </>
  )
}
