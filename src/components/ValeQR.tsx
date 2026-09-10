import { QRCodeCanvas } from 'qrcode.react'
import { bs } from '../lib/formato'

export interface DatosVale {
  solicitud_id: string
  monto: number
  timestamp: string
  admin: string
  tipo: 'desembolso' | 'devolucion'
}

export function ValeQR({ datos, titulo, nota }: { datos: DatosVale; titulo: string; nota?: string }) {
  return (
    <div className="cc-fila">
      <div className="cc-qr">
        <QRCodeCanvas value={JSON.stringify(datos)} size={186} level="M" fgColor="#201e1d" />
      </div>
      <div style={{ maxWidth: '34ch' }}>
        <h3>{titulo}</h3>
        <p className="cc-tenue" style={{ marginBottom: 14 }}>
          {nota ?? 'Escanea el código desde la app del banco para completar la transferencia.'}
        </p>
        <div className="cc-mono">
          <div>solicitud: {datos.solicitud_id.slice(0, 8)}</div>
          <div>monto: {bs(datos.monto)}</div>
          <div>emitido: {new Date(datos.timestamp).toLocaleString('es-BO')}</div>
          <div>por: {datos.admin}</div>
        </div>
      </div>
    </div>
  )
}
