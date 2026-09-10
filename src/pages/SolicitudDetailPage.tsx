import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  decidirSolicitud, desembolsar, listarComprobantes, listarMovimientos,
  obtenerSolicitud, reportarGasto, subirComprobante, urlPublica, validarDevolucion
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
  const puedeDecidir = ['daf', 'super_admin'].includes(rol) && solicitud.estado === 'pendiente_daf'
  const puedeDesembolsar = ['admin_caja', 'super_admin'].includes(rol) && solicitud.estado === 'aprobado_daf'
  const puedeValidar = ['admin_caja', 'super_admin'].includes(rol) && solicitud.estado === 'pendiente_devolucion'
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
            {solicitud.origen_decision && (
              <tr><td>Decisión tomada desde</td><td className="num">{solicitud.origen_decision}</td></tr>
            )}
          </tbody>
        </table>
        {solicitud.motivo_rechazo && <p className="cc-tenue">Motivo del rechazo: {solicitud.motivo_rechazo}</p>}
      </div>

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
          <ValeQR titulo="Vale de desembolso" datos={{
            solicitud_id: solicitud.id, monto: Number(solicitud.monto_solicitado),
            timestamp: new Date().toISOString(), admin: perfil!.full_name ?? perfil!.email, tipo: 'desembolso'
          }} />
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
