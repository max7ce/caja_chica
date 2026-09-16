import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  avalarSolicitud, decidirSolicitud, desembolsar, listarComprobantes, listarMovimientos,
  obtenerSolicitud, reportarGasto, subirComprobante, urlPublica, validarDevolucion, verificarFisica
} from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { bs, fechaHora, horasRestantes } from '../lib/formato'
import { Cabecera, Cargando, Error as AvisoError, Estado, Exito, Reloj } from '../components/Ui'
import { ValeQR } from '../components/ValeQR'
import { SubirArchivo } from '../components/SubirArchivo'
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
  const [montoReal, setMontoReal] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [trabajando, setTrabajando] = useState(false)

  const cargar = useCallback(async () => {
    if (!id) return
    try {
      const [s, c, m] = await Promise.all([
        obtenerSolicitud(id), listarComprobantes(id), listarMovimientos({ solicitudId: id })
      ])
      setSolicitud(s); setComprobantes(c); setMovimientos(m)
    } catch (e: any) { setError(e.message) } finally { setCargando(false) }
  }, [id])

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
  const puedeRendir = esPropia && solicitud.estado === 'desembolsado'
  const horas = horasRestantes(solicitud.limite_tiempo_devolucion)
  const diferencia = Number(solicitud.monto_solicitado) - Number(solicitud.monto_real ?? 0)

  async function accion(fn: () => Promise<void>, mensaje: string) {
    setTrabajando(true); setError(null); setExito(null)
    try { await fn(); setExito(mensaje); await cargar() }
    catch (e: any) { setError(e.message ?? 'No se pudo completar la acción.') }
    finally { setTrabajando(false) }
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
              <div>Comprobante de {c.tipo} · <a href={urlPublica(c.archivo_url)} target="_blank" rel="noreferrer">abrir</a></div>
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

      {puedeRendir && (
        <div className="cc-card" style={{ maxWidth: 560 }}>
          <h2>Rendir el gasto</h2>
          <div className="cc-campo" style={{ maxWidth: 240 }}>
            <label>¿Cuánto gastaste realmente?</label>
            <input type="number" step="0.01" min="0" value={montoReal} onChange={(e) => setMontoReal(e.target.value)} />
          </div>
          <SubirArchivo etiqueta="Comprobante de compra" onSeleccion={setArchivo} />
          <button className="cc-btn cc-btn-p" disabled={trabajando || !montoReal || !archivo}
            onClick={() => accion(async () => {
              await subirComprobante({ archivo: archivo!, solicitudId: solicitud.id, tipo: 'compra', usuarioId: perfil!.id })
              const hay = await reportarGasto(solicitud, Number(montoReal))
              if (hay) navegar(`/devoluciones/${solicitud.id}`)
            }, 'Gasto reportado.')}>
            Guardar rendición
          </button>
        </div>
      )}

      {solicitud.estado === 'pendiente_devolucion' && esPropia && (
        <div className="cc-card">
          <h2>Falta devolver la diferencia</h2>
          <p className="cc-tenue">Debes transferir {bs(diferencia)} y subir el comprobante del depósito.</p>
          <Link className="cc-btn cc-btn-p" to={`/devoluciones/${solicitud.id}`}>Ir a la devolución</Link>
        </div>
      )}

      {solicitud.estado === 'pendiente_verificacion' && esPropia && (
        <div className={`cc-aviso ${solicitud.conforme_fisica === false ? 'cc-av-mal' : 'cc-av-oro'}`}>
          {solicitud.conforme_fisica === false
            ? `El administrador observó tu documentación: ${solicitud.observacion_fisica ?? ''}`
            : 'Ya rendiste en el sistema. Falta entregar en físico el vale y las facturas con la firma y el sello de tu coordinador al reverso.'}
        </div>
      )}

      {puedeCotejar && (
        <div className="cc-card">
          <h2>Cotejo de la documentación física</h2>
          <p className="cc-tenue" style={{ marginTop: 0 }}>
            Verifica que el vale y las facturas entregadas en papel coincidan con lo cargado, y que lleven
            firma y sello del coordinador al reverso.
          </p>
          {solicitud.conforme_fisica === false && solicitud.observacion_fisica && (
            <div className="cc-aviso cc-av-oro">Observación anterior: {solicitud.observacion_fisica}</div>
          )}
          <div className="cc-campo" style={{ maxWidth: 460 }}>
            <label>Observación (obligatoria si no coincide)</label>
            <input value={obsFisica} onChange={(e) => setObsFisica(e.target.value)} />
          </div>
          <div className="cc-acc">
            <button className="cc-btn cc-btn-ok" disabled={trabajando}
              onClick={() => accion(
                () => verificarFisica(solicitud.id, true, obsFisica, perfil!.id),
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
