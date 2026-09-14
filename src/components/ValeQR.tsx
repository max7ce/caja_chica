import { bs } from '../lib/formato'
import { urlQR } from '../lib/api'

export interface DatosVale {
  solicitud_id: string
  monto: number
  admin: string
  tipo: 'desembolso' | 'devolucion'
}

/**
 * Muestra el QR de cobro real de quien recibe el dinero. La aplicación ya no
 * genera ningún código: los QR bancarios siguen el estándar del BCB e
 * incluyen la cuenta destino, algo que el sistema no puede fabricar.
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
  const url = urlQR(qrRuta)

  return (
    <div className="cc-fila">
      {url ? (
        <div className="cc-qr">
          <img src={url} alt="QR de cobro" style={{ width: 210, height: 'auto', display: 'block' }} />
        </div>
      ) : (
        <div className="cc-qr" style={{ width: 240, textAlign: 'center', padding: 28 }}>
          <p className="cc-tenue" style={{ margin: 0, fontSize: '.9rem' }}>
            {faltaQR ?? 'Todavía no hay un QR de cobro cargado.'}
          </p>
        </div>
      )}

      <div style={{ maxWidth: '36ch' }}>
        <h3>{titulo}</h3>
        <p className="cc-tenue" style={{ marginBottom: 14 }}>
          {nota ?? 'Escanea este código desde la aplicación de tu banco para hacer la transferencia.'}
        </p>
        <table className="cc-tabla">
          <tbody>
            <tr><td>Monto</td><td className="num">{bs(datos.monto)}</td></tr>
            <tr><td>Solicitud</td><td className="num">{datos.solicitud_id.slice(0, 8)}</td></tr>
            <tr><td>Registra</td><td className="num">{datos.admin}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
