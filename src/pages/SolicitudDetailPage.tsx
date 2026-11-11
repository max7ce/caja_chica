import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  avalarSolicitud, decidirSolicitud, desembolsar, listarComprobantes, listarMovimientos,
  listarFacturas, obtenerSolicitud, reportarGasto, responderObservacion, subirComprobante,
  validarDevolucion, verificarFisica
} from '../lib/api'
import { EnlaceArchivo } from '../components/ArchivoFirmado'
import { useAuth } from '../hooks/useAuth'
import { bs, etiquetaComprobante, fechaHora, horasRestantes } from '../lib/formato'
import { Cabecera, Cargando, Error as AvisoError, Estado, Exito, Reloj } from '../components/Ui'
import { ValeQR } from '../components/ValeQR'
import { SubirArchivo } from '../components/SubirArchivo'
import { FacturasDeSolicitud } from '../components/FacturasDeSolicitud'
import type { Comprobante, MovimientoCaja, Solicitud } from '../types/database'

export function SolicitudDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { perfil, periodo } = useAuth()
  const navegar = useNavigate()

  const [solicitud, setSolicitud] = useState<Solicitud | null>(null)
  const [comprobantes, setComprobantes] = useState<Comprobante[]>([])
  const [movimientos, setMovimientos] = useState<MovimientoCaja[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [observacion, setObservacion] = useState('')
  const [obsFisica, setObsFisica] = useState('')
  const [recibiOriginales, setRecibiOriginales] = useState(false)
  const [firmaVerificada, setFirmaVerificada] = useState(false)
  const [totalFacturado, setTotalFacturado] = useState(0)
  const [cantidadFacturas, setCantidadFacturas] = useState(0)
  const montoEditado = useRef(false)
  const [respuesta, setRespuesta] = useState('')
  const [extra, setExtra] = useState<File | null>(null)
  const [montoReal, setMontoReal] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [trabajando, setTrabajando] = useState(false)

  /** Suma de facturas y adjuntos. Se llama al cargar y cada vez que se agrega o quita una factura. */
  const recalcularFacturas = useCallback(async () => {
    if (!id) return
    const [fs, c] = await Promise.all([listarFacturas(id), listarComprobantes(id)])
    const total = Math.round(fs.reduce((a, f) => a + Number(f.monto), 0) * 100) / 100
    setTotalFacturado(total)
    setCantidadFacturas(fs.length)
    setComprobantes(c)
    // Mientras la persona no escriba otro monto, el gasto real sigue a las facturas.
    if (!montoEditado.current) setMontoReal(total > 0 ? String(total) : '')
  }, [id])

  const cargar = useCallback(async () => {
    if (!id) return
    try {
      const [s, m] = await Promise.all([obtenerSolicitud(id), listarMovimientos({ solicitudId: id })])
      setSolicitud(s); setMovimientos(m)
      await recalcularFacturas()
    } catch (e: any) { setError(e.message) } finally { setCargando(false) }
  }, [id, recalcularFacturas])

  useEffect(() => { cargar() }, [cargar])

  if (cargando) return <Cargando />
  if (!solicitud) return <div className="cc-card"><h2>Esa solicitud no existe o no tienes acceso.</h2></div>

  const rol = perfil!.role
  const esPropia = solicitud.solicitante_id === perfil!.id
  const puedeAvalar = solicitud.coordinador_id === perfil!.id && solicitud.estado === 'pendiente_coordinador'
  const puedeDecidir = ['daf', 'super_admin'].includes(rol) && solicitud.estado === 'pendiente_daf'
  const puedeDesembolsar = ['admin_caja', 'super_admin'].includes(rol) && solicitud.estado === 'aprobado_daf'
  const puedeValidar = ['admin_caja', 'super_admin'].includes(rol) && solicitud.estado === 'pendiente_devolucion'
  const puedeCotejar = ['admin_caja', 'super_admin'].includes(rol) && solicitud.estado === 'pendiente_verificacion'
  const devolucionPendiente = movimientos.find(
    (m) => m.tipo === 'devolucion' && m.estado === 'pendiente_validacion'
  )
  const puedeRendir = esPropia && solicitud.estado === 'desembolsado'
  const horas = horasRestantes(solicitud.limite_tiempo_devolucion)
  const diferencia = Number(solicitud.monto_solicitado) - Number(solicitud.monto_real ?? 0)

  async function accion(fn: () => Promise<void>, mensaje: string) {
    setTrabajando(true); setError(null); setExito(null)
    try { await fn(); setExito(mensaje); await cargar() }
    catch (e: any) { setError(e.message ?? 'No se pudo completar la acción.') }
    finally {
      setTrabajando(false)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  return (
    <>
      <Link className="cc-btn cc-btn-x" to="/solicitudes" style={{ marginBottom: 16 }}>Volver</Link>
      <Cabecera titulo={solicitud.descripcion} />
      <p style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: -12, marginBottom: 20 }}>
        <span className="cc-mono">{solicitud.id.slice(0, 8)}</span>
        {solicitud.solicitante?.full_name} · <Estado estado={solicitud.estado} />
        {['desembolsado', 'pendiente_devolucion'].includes(solicitud.estado) && <Reloj horas={horas} />}
      </p>

      <AvisoError mensaje={error} />
      <Exito mensaje={exito} />
      {(horas ?? 99) < 0 && ['desembolsado', 'pendiente_devolucion'].includes(solicitud.estado) && (
        <div className="cc-aviso cc-av-mal">
          El plazo venció. Se envían recordatorios diarios con copia al DAF y el solicitante no puede pedir vales nuevos.
        </div>
      )}

      <div className="cc-card" style={{ maxWidth: 560 }}>
        <h2>Datos del vale</h2>
        <table className="cc-tabla">
          <tbody>
            <tr><td>Monto solicitado</td><td className="num">{bs(solicitud.monto_solicitado)}</td></tr>
            <tr><td>Gasto real</td><td className="num">{solicitud.monto_real == null ? '—' : bs(solicitud.monto_real)}</td></tr>
            <tr><td>Diferencia a devolver</td><td className="num">{solicitud.monto_real == null ? '—' : bs(diferencia)}</td></tr>
            <tr><td>Categoría</td><td className="num">{solicitud.categoria ?? '—'}</td></tr>
            <tr><td>Desembolsado</td><td className="num">{fechaHora(solicitud.fecha_desembolso)}</td></tr>
            <tr><td>Vence</td><td className="num">{fechaHora(solicitud.limite_tiempo_devolucion)}</td></tr>
            {solicitud.fecha_recepcion_fisica && (
              <tr><td>Físico recibido</td><td className="num">{fechaHora(solicitud.fecha_recepcion_fisica)}</td></tr>
            )}
            {solicitud.firma_superior && (
              <tr><td>Firma del superior</td><td className="num">verificada</td></tr>
            )}
            {solicitud.origen_decision && (
              <tr><td>Decisión tomada desde</td><td className="num">{solicitud.origen_decision}</td></tr>
            )}
          </tbody>
        </table>
        {solicitud.motivo_rechazo && <p className="cc-tenue">Motivo del rechazo: {solicitud.motivo_rechazo}</p>}
      </div>

      {solicitud.aval_coordinador !== null && (
        <div className={`cc-aviso ${solicitud.aval_coordinador ? 'cc-av-ok' : 'cc-av-oro'}`}>
          <strong>{solicitud.aval_coordinador ? 'Avalada por el coordinador' : 'El coordinador no la avaló'}</strong>
          {solicitud.observacion_coordinador && <> — {solicitud.observacion_coordinador}</>}
          {' · '}{fechaHora(solicitud.fecha_aval_coordinador)}
        </div>
      )}

      <div className="cc-card">
        <h2>Historial</h2>
        <ul className="cc-linea">
          <li><div>Solicitud creada</div><div className="cuando">{fechaHora(solicitud.fecha_creacion)}</div></li>
          {movimientos.slice().reverse().map((m) => (
            <li key={m.id}>
              <div>
                {m.tipo === 'desembolso' ? 'Desembolso' : m.tipo === 'devolucion' ? 'Devolución registrada' : 'Reposición'} · {bs(m.monto)}
                {m.estado === 'pendiente_validacion' && ' (por validar)'}
              </div>
              <div className="cuando">{fechaHora(m.created_at)}</div>
            </li>
          ))}
          {comprobantes.map((c) => (
            <li key={c.id}>
              <div>{etiquetaComprobante(c)} · <EnlaceArchivo ruta={c.archivo_url}>abrir</EnlaceArchivo></div>
              <div className="cuando">{fechaHora(c.fecha_subida)}</div>
            </li>
          ))}
        </ul>
      </div>

      {puedeAvalar && (
        <div className="cc-card">
          <h2>Tu aval como coordinador</h2>
          <p className="cc-tenue" style={{ marginTop: 0 }}>
            Avales o no, la solicitud continúa al DAF. Lo que cambia es el dictamen que va adjunto.
          </p>
          <div className="cc-campo" style={{ maxWidth: 460 }}>
            <label>Observación (obligatoria si no la avalas)</label>
            <input value={observacion} onChange={(e) => setObservacion(e.target.value)} />
          </div>
          <div className="cc-acc">
            <button className="cc-btn cc-btn-ok" disabled={trabajando}
              onClick={() => accion(() => avalarSolicitud(solicitud.id, true, observacion), 'Aval registrado. La solicitud pasó al DAF.')}>
              Avalar
            </button>
            <button className="cc-btn cc-btn-r" disabled={trabajando || !observacion.trim()}
              onClick={() => accion(() => avalarSolicitud(solicitud.id, false, observacion), 'Registrado. La solicitud pasó al DAF con tu observación.')}>
              No avalar
            </button>
          </div>
        </div>
      )}

      {puedeDecidir && (
        <div className="cc-card">
          <h2>Decisión del DAF</h2>
          <div className="cc-campo" style={{ maxWidth: 420 }}>
            <label>Motivo (obligatorio si rechazas)</label>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <div className="cc-acc">
            <button className="cc-btn cc-btn-p" disabled={trabajando}
              onClick={() => accion(() => decidirSolicitud(solicitud.id, perfil!.id, true), 'Solicitud autorizada.')}>
              Autorizar
            </button>
            <button className="cc-btn cc-btn-r" disabled={trabajando || !motivo.trim()}
              onClick={() => accion(() => decidirSolicitud(solicitud.id, perfil!.id, false, motivo.trim()), 'Solicitud rechazada.')}>
              Rechazar
            </button>
          </div>
        </div>
      )}

      {puedeDesembolsar && (
        <div className="cc-card">
          <h2>Desembolsar por QR</h2>
          <ValeQR
            titulo={`Transferir a ${solicitud.solicitante?.full_name ?? 'el solicitante'}`}
            qrRuta={solicitud.solicitante?.qr_url}
            faltaQR="El solicitante todavía no cargó su QR de cobro. Pídele que lo suba desde Mi perfil."
            datos={{
              solicitud_id: solicitud.id, monto: Number(solicitud.monto_solicitado),
              admin: perfil!.full_name ?? perfil!.email, tipo: 'desembolso'
            }}
          />
          <div className="cc-acc" style={{ marginTop: 18 }}>
            <button className="cc-btn cc-btn-p" disabled={trabajando}
              onClick={() => accion(() => desembolsar(solicitud, perfil!.id, periodo?.id ?? null), 'Desembolso registrado. El plazo empieza ahora.')}>
              Confirmar transferencia
            </button>
          </div>
        </div>
      )}

      {['desembolsado', 'pendiente_devolucion', 'pendiente_verificacion', 'completado'].includes(solicitud.estado) && (
        <FacturasDeSolicitud
          solicitudId={solicitud.id}
          onCambio={() => { recalcularFacturas().catch((e) => setError(e.message)) }}
          editable={
            ['admin_caja', 'super_admin'].includes(rol)
            || (esPropia && (
              ['desembolsado', 'pendiente_devolucion'].includes(solicitud.estado)
              || (solicitud.estado === 'pendiente_verificacion' && solicitud.conforme_fisica === false)
            ))
          }
        />
      )}

      {puedeRendir && (() => {
        const recibido = Number(solicitud.monto_solicitado)
        const gastado = Number(montoReal || 0)
        const sobra = montoReal ? Math.round((recibido - gastado) * 100) / 100 : null
        const excede = gastado > recibido
        const sinFacturas = cantidadFacturas === 0
        const faltaComprobante = sinFacturas && !archivo
        const distintoDeFacturas = !sinFacturas && montoReal !== '' && gastado !== totalFacturado

        return (
          <div className="cc-card" style={{ maxWidth: 620 }}>
            <h2>Rendir el gasto</h2>

            <table className="cc-tabla" style={{ marginBottom: 18 }}>
              <tbody>
                <tr>
                  <td>Recibiste</td>
                  <td className="num">{bs(recibido)}</td>
                </tr>
                <tr>
                  <td>
                    Facturas cargadas ({cantidadFacturas})
                    {sinFacturas && (
                      <div className="cc-tenue" style={{ fontSize: '.85rem' }}>
                        Todavía no cargaste ninguna factura arriba.
                      </div>
                    )}
                  </td>
                  <td className="num">{bs(totalFacturado)}</td>
                </tr>
                <tr>
                  <td><strong>{sobra != null && sobra < 0 ? 'Gastaste de más' : 'Diferencia a devolver'}</strong></td>
                  <td className="num"><strong>{sobra == null ? '—' : bs(Math.abs(sobra))}</strong></td>
                </tr>
              </tbody>
            </table>

            <div className="cc-campo" style={{ maxWidth: 260 }}>
              <label>¿Cuánto gastaste realmente?</label>
              <input type="number" step="0.01" min="0" value={montoReal}
                onChange={(e) => { montoEditado.current = true; setMontoReal(e.target.value) }} />
            </div>

            {distintoDeFacturas && (
              <p className="cc-tenue" style={{ fontSize: 13, marginTop: -6 }}>
                No coincide con la suma de las facturas ({bs(totalFacturado)}).{' '}
                <button className="cc-btn cc-btn-x" onClick={() => { montoEditado.current = false; setMontoReal(String(totalFacturado)) }}>
                  Usar la suma de las facturas
                </button>
              </p>
            )}

            {montoReal && !excede && (
              <div className={`cc-aviso ${sobra! > 0 ? 'cc-av-oro' : 'cc-av-ok'}`}>
                {sobra! > 0
                  ? `Te sobran ${bs(sobra!)}. Al guardar vas a pasar a la pantalla de devolución para depositarlos.`
                  : 'Gastaste todo lo recibido. No hay diferencia que devolver.'}
              </div>
            )}

            {excede && (
              <div className="cc-aviso cc-av-mal">
                Estás declarando más de lo que recibiste. La caja no reembolsa diferencias por esta vía:
                conversa con tu coordinador y con el DAF antes de guardar.
              </div>
            )}

            <SubirArchivo
              etiqueta={sinFacturas
                ? 'Comprobante de compra (recibo o nota de venta)'
                : 'Comprobante adicional (opcional)'}
              onSeleccion={setArchivo}
            />

            <button className="cc-btn cc-btn-p" disabled={trabajando || !montoReal || faltaComprobante}
              onClick={() => accion(async () => {
                if (archivo) {
                  await subirComprobante({
                    archivo, solicitudId: solicitud.id, tipo: 'compra', usuarioId: perfil!.id
                  })
                }
                const hay = await reportarGasto(solicitud, Number(montoReal))
                setArchivo(null); montoEditado.current = false
                if (hay) navegar(`/devoluciones/${solicitud.id}`)
              }, 'Rendición guardada.')}>
              {trabajando ? 'Guardando…' : 'Guardar rendición'}
            </button>

            {(!montoReal || faltaComprobante) && (
              <p className="cc-tenue" style={{ fontSize: 13 }}>
                Falta {!montoReal ? 'cargar las facturas o escribir cuánto gastaste' : ''}
                {!montoReal && faltaComprobante ? ' y ' : ''}
                {faltaComprobante ? 'adjuntar un comprobante, porque no hay facturas cargadas' : ''}.
              </p>
            )}
          </div>
        )
      })()}

      {solicitud.estado === 'pendiente_devolucion' && esPropia && (
        devolucionPendiente ? (
          <div className="cc-aviso cc-av-ok">
            Ya enviaste el comprobante de {bs(devolucionPendiente.monto)} el{' '}
            {fechaHora(devolucionPendiente.created_at)}. El administrador de caja tiene que validarlo;
            no hace falta volver a enviarlo.
          </div>
        ) : (
          <div className="cc-card">
            <h2>Falta devolver la diferencia</h2>
            <p className="cc-tenue">Debes transferir {bs(diferencia)} y subir el comprobante del depósito.</p>
            <Link className="cc-btn cc-btn-p" to={`/devoluciones/${solicitud.id}`}>Ir a la devolución</Link>
          </div>
        )
      )}

      {solicitud.estado === 'pendiente_verificacion' && esPropia && solicitud.conforme_fisica !== false && (
        <div className="cc-aviso cc-av-oro">
          {solicitud.fecha_respuesta_solicitante
            ? 'Respondiste la observación. El administrador de caja va a revisarlo de nuevo.'
            : 'Ya rendiste en el sistema. Falta entregar en físico el vale y las facturas con la firma y el sello de tu coordinador al reverso.'}
        </div>
      )}

      {solicitud.estado === 'pendiente_verificacion' && esPropia && solicitud.conforme_fisica === false && (
        <div className="cc-card">
          <h2>Tu rendición fue observada</h2>
          <div className="cc-aviso cc-av-mal">{solicitud.observacion_fisica}</div>

          <p className="cc-tenue" style={{ marginTop: 0 }}>
            Corrige lo observado y respondé desde acá. Según lo que falte:
          </p>
          <ul style={{ margin: '0 0 16px 18px' }}>
            <li>Si falta una firma o un papel, entrégalo de nuevo al administrador de caja.</li>
            <li>Si una factura está mal cargada, corrígela en la sección de arriba.</li>
            <li>Si falta un comprobante, adjúntalo acá abajo.</li>
          </ul>

          <SubirArchivo etiqueta="Adjuntar otro comprobante (opcional)" onSeleccion={setExtra} />

          <div className="cc-campo">
            <label>Tu respuesta</label>
            <textarea value={respuesta} onChange={(e) => setRespuesta(e.target.value)}
              placeholder="Ejemplo: ya conseguí la firma del coordinador y dejé la factura en caja esta mañana." />
          </div>

          <button className="cc-btn cc-btn-p" disabled={trabajando || !respuesta.trim()}
            onClick={() => accion(async () => {
              if (extra) {
                await subirComprobante({
                  archivo: extra, solicitudId: solicitud.id, tipo: 'compra',
                  usuarioId: perfil!.id, descripcion: 'Adjunto tras observación'
                })
              }
              await responderObservacion(solicitud.id, respuesta)
              setRespuesta(''); setExtra(null)
            }, 'Respuesta enviada. El administrador de caja fue notificado.')}>
            Enviar respuesta
          </button>
        </div>
      )}

      {puedeCotejar && (
        <div className="cc-card">
          <h2>Cotejo de la documentación física</h2>
          <p className="cc-tenue" style={{ marginTop: 0 }}>
            La rendición solo se da por válida con los documentos físicos en mano: el vale y las facturas
            originales, iguales a lo cargado, con la firma de{' '}
            <strong>{solicitud.coordinador?.full_name ?? 'su superior inmediato'}</strong> al reverso.
          </p>
          {solicitud.observacion_fisica && (
            <div className="cc-aviso cc-av-oro">
              Observación anterior: {solicitud.observacion_fisica}
            </div>
          )}
          {solicitud.respuesta_solicitante && (
            <div className="cc-aviso cc-av-ok">
              Respuesta del solicitante ({fechaHora(solicitud.fecha_respuesta_solicitante)}):{' '}
              {solicitud.respuesta_solicitante}
            </div>
          )}
          <div style={{ display: 'grid', gap: 8, margin: '4px 0 14px' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <input type="checkbox" style={{ width: 18, minHeight: 18, marginTop: 2 }}
                checked={recibiOriginales} onChange={(e) => setRecibiOriginales(e.target.checked)} />
              Recibí el vale y las facturas originales, y coinciden con lo cargado en el sistema.
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <input type="checkbox" style={{ width: 18, minHeight: 18, marginTop: 2 }}
                checked={firmaVerificada} onChange={(e) => setFirmaVerificada(e.target.checked)} />
              Están firmados por {solicitud.coordinador?.full_name ?? 'el superior inmediato'}.
            </label>
          </div>
          <div className="cc-campo" style={{ maxWidth: 460 }}>
            <label>Observación (obligatoria si no coincide o falta la firma)</label>
            <input value={obsFisica} onChange={(e) => setObsFisica(e.target.value)} />
          </div>
          <div className="cc-acc">
            <button className="cc-btn cc-btn-ok" disabled={trabajando || !recibiOriginales || !firmaVerificada}
              onClick={() => accion(
                () => verificarFisica(solicitud.id, true, obsFisica, perfil!.id, firmaVerificada),
                'Documentación conforme. La solicitud queda cerrada.'
              )}>
              Recibí y coincide
            </button>
            <button className="cc-btn cc-btn-r" disabled={trabajando || !obsFisica.trim()}
              onClick={() => accion(
                () => verificarFisica(solicitud.id, false, obsFisica, perfil!.id),
                'Observación registrada. El solicitante ya fue notificado.'
              )}>
              Observar
            </button>
          </div>
        </div>
      )}

      {puedeValidar && movimientos.some((m) => m.estado === 'pendiente_validacion') && (
        <div className="cc-card">
          <h2>Validar el depósito</h2>
          <button className="cc-btn cc-btn-ok" disabled={trabajando}
            onClick={() => accion(
              () => validarDevolucion(movimientos.find((m) => m.estado === 'pendiente_validacion')!, perfil!.id),
              'Devolución validada. La solicitud queda cerrada.')}>
            Validar {bs(diferencia)}
          </button>
        </div>
      )}
    </>
  )
}
