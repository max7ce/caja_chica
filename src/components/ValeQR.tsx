import { useState } from 'react'
import { bs } from '../lib/formato'
import { descargarArchivo } from '../lib/storageUrls'
import { ImagenFirmada } from './ArchivoFirmado'

export interface DatosVale {
  solicitud_id: string
  monto: number
  admin: string
  tipo: 'desembolso' | 'devolucion'
}

/** Teléfono o tablet: la persona no puede escanear un QR que está en su propia pantalla. */
const esTactil = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

/**
 * Muestra el QR de cobro real de quien recibe el dinero y guía la
 * transferencia paso a paso. La aplicación no genera ningún código: los QR
 * bancarios siguen el estándar del BCB e incluyen la cuenta destino.
 *
 * Ninguna web puede abrir "la app del banco" de forma genérica (cada banco
 * tiene la suya). En el teléfono, el camino que funciona con todos los
 * bancos es guardar la imagen y elegirla en "Pagar con QR → Galería".
 */
export function ValeQR({
  datos, titulo, qrRuta, nota, faltaQR
}: {
  datos: DatosVale
  titulo: string
  qrRuta: string | null | undefined
  nota?: string
  faltaQR?: string
}) {
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const movil = esTactil()

  async function guardarQR() {
    if (!qrRuta) return
    setGuardando(true); setError(null)
    try {
      const blob = await descargarArchivo('qr', qrRuta)
      const ext = qrRuta.split('.').pop() ?? 'jpg'
      const nombre = `QR-${datos.tipo}-${datos.solicitud_id.slice(0, 8)}.${ext}`
      const archivo = new File([blob], nombre, { type: blob.type || 'image/jpeg' })

      // En el teléfono, la hoja de compartir permite "Guardar imagen" y, en
      // algunos bancos, enviarla directo a su app.
      if (movil && navigator.canShare?.({ files: [archivo] })) {
        try {
          await navigator.share({ files: [archivo], title: 'QR de cobro' })
          setGuardado(true)
          return
        } catch (e: any) {
          if (e?.name === 'AbortError') return
          // si compartir falla, se descarga como archivo
        }
      }
      const url = URL.createObjectURL(archivo)
      const a = document.createElement('a')
      a.href = url; a.download = nombre
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setGuardado(true)
    } catch (e: any) {
      setError(e.message ?? 'No se pudo guardar el QR.')
    } finally { setGuardando(false) }
  }

  async function copiarMonto() {
    try {
      await navigator.clipboard.writeText(Number(datos.monto).toFixed(2))
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } catch { /* algunos navegadores no permiten copiar; el monto queda a la vista */ }
  }

  return (
    <div className="cc-fila">
      {qrRuta ? (
        <div className="cc-qr">
          <ImagenFirmada ruta={qrRuta} alt="QR de cobro" style={{ width: 210, height: 'auto', display: 'block' }} />
        </div>
      ) : (
        <div className="cc-qr" style={{ width: 240, textAlign: 'center', padding: 28 }}>
          <p className="cc-tenue" style={{ margin: 0, fontSize: '.9rem' }}>
            {faltaQR ?? 'Todavía no hay un QR de cobro cargado.'}
          </p>
        </div>
      )}

      <div style={{ maxWidth: '42ch', flex: '1 1 260px' }}>
        <h3>{titulo}</h3>
        {nota && <p className="cc-tenue" style={{ marginBottom: 12 }}>{nota}</p>}

        <table className="cc-tabla" style={{ marginBottom: 14 }}>
          <tbody>
            <tr>
              <td>Monto</td>
              <td className="num">
                <strong>{bs(datos.monto)}</strong>{' '}
                <button type="button" className="cc-btn cc-btn-x" onClick={copiarMonto}>
                  {copiado ? 'Copiado' : 'Copiar'}
                </button>
              </td>
            </tr>
            <tr><td>Solicitud</td><td className="num">{datos.solicitud_id.slice(0, 8)}</td></tr>
            <tr><td>Registra</td><td className="num">{datos.admin}</td></tr>
          </tbody>
        </table>

        {qrRuta && (
          <ol className="cc-pasos" style={{ margin: '0 0 4px 18px', padding: 0, lineHeight: 1.55 }}>
            {movil ? (
              <>
                <li style={{ marginBottom: 8 }}>
                  Guarda el QR en tu teléfono.{' '}
                  <button type="button" className="cc-btn cc-btn-x cc-btn-p" disabled={guardando} onClick={guardarQR}>
                    {guardando ? 'Preparando…' : guardado ? 'Guardar otra vez' : 'Guardar QR'}
                  </button>
                  {guardado && <span className="cc-tenue" style={{ marginLeft: 6 }}>✓ listo</span>}
                </li>
                <li style={{ marginBottom: 8 }}>
                  Abre la app de tu banco → <strong>Pagar con QR</strong> → <strong>Galería</strong> (o "subir
                  imagen") y elige el QR que guardaste.
                </li>
              </>
            ) : (
              <li style={{ marginBottom: 8 }}>
                Abre la app de tu banco en el celular → <strong>Pagar con QR</strong> y escanea este código
                en la pantalla.{' '}
                <button type="button" className="cc-btn cc-btn-x" disabled={guardando} onClick={guardarQR}>
                  {guardando ? 'Descargando…' : 'Descargar QR'}
                </button>
              </li>
            )}
            <li style={{ marginBottom: 8 }}>
              Verifica que el monto sea <strong>{bs(datos.monto)}</strong> y transfiere.
            </li>
            <li>
              Vuelve aquí y {datos.tipo === 'devolucion'
                ? 'sube la captura del comprobante.'
                : 'pulsa “Confirmar transferencia”.'}
            </li>
          </ol>
        )}
        {error && <p className="cc-tenue" style={{ color: '#b02a37' }}>{error}</p>}
      </div>
    </div>
  )
}
