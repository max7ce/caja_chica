import { useState } from 'react'
import { Link } from 'react-router-dom'
import { pedirReposicion } from '../lib/api'
import { bs, fecha } from '../lib/formato'
import type { InformeRendicion } from '../types/database'

/**
 * Pedido de reposición en dos pasos: el botón muestra el resumen del
 * informe aprobado y recién "Confirmar pedido" lo envía a contabilidad.
 */
export function PedirReposicion({ informe, cantidadVales, onListo, verInforme = true }: {
  informe: InformeRendicion
  cantidadVales?: number
  onListo?: () => void
  verInforme?: boolean
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState(false)

  if (hecho) {
    return (
      <div className="cc-aviso cc-av-ok" style={{ margin: 0 }}>
        Reposición de {bs(informe.monto_reposicion)} pedida. Contabilidad ya fue avisada.
      </div>
    )
  }

  if (!confirmando) {
    return (
      <div className="cc-acc">
        <button className="cc-btn cc-btn-p" onClick={() => setConfirmando(true)}>
          Pedir reposición de {bs(informe.monto_reposicion)}
        </button>
        {verInforme && <Link className="cc-btn cc-btn-x" to={`/rendicion-cuentas/${informe.id}`}>Ver el informe</Link>}
      </div>
    )
  }

  return (
    <div style={{ border: '2px solid var(--tinta)', padding: 16, maxWidth: 520 }}>
      <strong>Confirma el pedido de reposición</strong>
      <table className="cc-tabla" style={{ margin: '10px 0 14px' }}>
        <tbody>
          {cantidadVales != null && <tr><td>Vales del ciclo</td><td className="num">{cantidadVales}</td></tr>}
          <tr><td>Desembolsado</td><td className="num">{bs(informe.total_desembolsado)}</td></tr>
          <tr><td>Devuelto</td><td className="num">{bs(informe.total_devuelto)}</td></tr>
          <tr><td>Aprobado por el DAF</td><td className="num">{fecha(informe.fecha_aprobacion_daf)}</td></tr>
          <tr><td><strong>Reposición a pedir</strong></td><td className="num"><strong>{bs(informe.monto_reposicion)}</strong></td></tr>
        </tbody>
      </table>
      <p className="cc-tenue" style={{ marginTop: 0, fontSize: 13 }}>
        Contabilidad recibirá el pedido y transferirá este monto exacto a tu QR de cobro.
      </p>
      {error && <p style={{ color: '#b02a37', fontSize: 13 }}>{error}</p>}
      <div className="cc-acc">
        <button className="cc-btn cc-btn-p" disabled={enviando}
          onClick={async () => {
            setEnviando(true); setError(null)
            try { await pedirReposicion(informe); setHecho(true); onListo?.() }
            catch (e: any) { setError(e.message ?? 'No se pudo enviar el pedido.') }
            finally { setEnviando(false) }
          }}>
          {enviando ? 'Enviando…' : 'Confirmar pedido de reposición'}
        </button>
        <button className="cc-btn cc-btn-x" disabled={enviando} onClick={() => setConfirmando(false)}>Cancelar</button>
      </div>
    </div>
  )
}
