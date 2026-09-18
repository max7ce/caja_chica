import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { devolucionEnviada, obtenerSolicitud, registrarDevolucion, subirComprobante } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { bs } from '../lib/formato'
import { ValeQR } from '../components/ValeQR'
import { SubirArchivo } from '../components/SubirArchivo'
import { Cabecera, Cargando, Error as AvisoError, Exito } from '../components/Ui'
import type { MovimientoCaja, Solicitud } from '../types/database'
import { Link } from 'react-router-dom'
import { fechaHora } from '../lib/formato'

export function DevolucionesPage() {
  const { solicitudId } = useParams<{ solicitudId: string }>()
  const { perfil, periodo, parametros } = useAuth()
  const navegar = useNavigate()
  const [solicitud, setSolicitud] = useState<Solicitud | null>(null)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [yaEnviada, setYaEnviada] = useState<MovimientoCaja | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const [sol, mov] = await Promise.all([
          obtenerSolicitud(solicitudId!), devolucionEnviada(solicitudId!)
        ])
        setSolicitud(sol); setYaEnviada(mov)
      } catch (e: any) { setError(e.message) } finally { setCargando(false) }
    })()
  }, [solicitudId])

  if (cargando) return <Cargando />
  if (!solicitud) return <div className="cc-card"><h2>No encontramos esa solicitud.</h2></div>

  const diferencia = Number(solicitud.monto_solicitado) - Number(solicitud.monto_real ?? 0)

  async function enviar() {
    if (!archivo) return
    setTrabajando(true); setError(null)
    try {
      const ruta = await subirComprobante({
        archivo, solicitudId: solicitud!.id, tipo: 'devolucion',
        usuarioId: perfil!.id, descripcion: 'Comprobante de depósito'
      })
      await registrarDevolucion({
        solicitudId: solicitud!.id, monto: diferencia, rutaComprobante: ruta,
        usuarioId: perfil!.id, periodoId: periodo?.id ?? null
      })
      setExito('Devolución enviada. El administrador de caja la va a validar.')
      setTimeout(() => navegar(`/solicitudes/${solicitud!.id}`), 1400)
    } catch (e: any) { setError(e.message) } finally { setTrabajando(false) }
  }

  return (
    <>
      <Cabecera
        titulo={`Devolver ${bs(diferencia)}`}
        bajada="Transfiere ese monto a la cuenta de caja chica y sube el comprobante del depósito. La solicitud se cierra cuando el administrador valide el depósito y reciba tus papeles."
      />

      <div className="cc-card" style={{ maxWidth: 520 }}>
        <h2>De dónde sale este monto</h2>
        <table className="cc-tabla">
          <tbody>
            <tr><td>Recibiste</td><td className="num">{bs(solicitud.monto_solicitado)}</td></tr>
            <tr><td>Declaraste haber gastado</td><td className="num">{bs(solicitud.monto_real)}</td></tr>
            <tr>
              <td><strong>Diferencia a devolver</strong></td>
              <td className="num"><strong>{bs(diferencia)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
      <AvisoError mensaje={error} />
      <Exito mensaje={exito} />
      <div className="cc-card">
        <ValeQR
          titulo="Cuenta de caja chica"
          qrRuta={parametros?.qr_caja_url}
          nota="Escanea este código desde tu banco y transfiere la diferencia a la cuenta de caja chica."
          faltaQR="La caja todavía no tiene cargado su QR de cobro. Pídeselo al administrador de caja."
          datos={{
            solicitud_id: solicitud.id, monto: diferencia,
            admin: perfil!.full_name ?? perfil!.email, tipo: 'devolucion'
          }}
        />
      </div>
      {yaEnviada && (
        <div className="cc-aviso cc-av-ok">
          Ya enviaste el comprobante de esta devolución el {fechaHora(yaEnviada.created_at)}. Está
          esperando que el administrador de caja lo valide; no hace falta volver a enviarlo.{' '}
          <Link to={`/solicitudes/${solicitud.id}`}>Ver la solicitud</Link>
        </div>
      )}

      <div className="cc-card" style={{ maxWidth: 560 }}>
        <h2>Comprobante del depósito</h2>
        <SubirArchivo etiqueta="Captura o PDF de la transferencia" onSeleccion={setArchivo}
          disabled={trabajando || !!yaEnviada} />
        <button className="cc-btn cc-btn-p" disabled={!archivo || trabajando || !!yaEnviada} onClick={enviar}>
          {trabajando ? 'Enviando…' : 'Enviar devolución'}
        </button>
      </div>
    </>
  )
}
