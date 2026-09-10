import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { obtenerSolicitud, registrarDevolucion, subirComprobante } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { bs } from '../lib/formato'
import { ValeQR } from '../components/ValeQR'
import { SubirArchivo } from '../components/SubirArchivo'
import { Cabecera, Cargando, Error as AvisoError, Exito } from '../components/Ui'
import type { Solicitud } from '../types/database'

export function DevolucionesPage() {
  const { solicitudId } = useParams<{ solicitudId: string }>()
  const { perfil, periodo } = useAuth()
  const navegar = useNavigate()
  const [solicitud, setSolicitud] = useState<Solicitud | null>(null)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)

  useEffect(() => {
    ;(async () => {
      try { setSolicitud(await obtenerSolicitud(solicitudId!)) }
      catch (e: any) { setError(e.message) } finally { setCargando(false) }
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
      <Cabecera titulo={`Devolver ${bs(diferencia)}`} bajada="Transfiere por QR a la cuenta de caja chica y sube el comprobante del depósito." />
      <AvisoError mensaje={error} />
      <Exito mensaje={exito} />
      <div className="cc-card">
        <ValeQR titulo="QR de devolución" nota="Escanea desde la app del banco para transferir la diferencia."
          datos={{
            solicitud_id: solicitud.id, monto: diferencia, timestamp: new Date().toISOString(),
            admin: perfil!.full_name ?? perfil!.email, tipo: 'devolucion'
          }} />
      </div>
      <div className="cc-card" style={{ maxWidth: 560 }}>
        <h2>Comprobante del depósito</h2>
        <SubirArchivo etiqueta="Captura o PDF de la transferencia" onSeleccion={setArchivo} disabled={trabajando} />
        <button className="cc-btn cc-btn-p" disabled={!archivo || trabajando} onClick={enviar}>
          {trabajando ? 'Enviando…' : 'Enviar devolución'}
        </button>
      </div>
    </>
  )
}
