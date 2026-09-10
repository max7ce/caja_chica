import { useEffect, useState } from 'react'
import { listarAvisos } from '../lib/api'
import { fechaHora } from '../lib/formato'
import { Cabecera, Cargando, Error as AvisoError, Vacio } from '../components/Ui'
import type { Notificacion } from '../types/database'

const REGLAS: [string, string, string, string][] = [
  ['Solicitud nueva', 'DAF', 'WhatsApp + correo', 'Al crearse'],
  ['Autorizada', 'Administrador de caja', 'WhatsApp', 'Al autorizar'],
  ['Rechazada', 'Solicitante', 'Correo', 'Al rechazar'],
  ['Desembolso confirmado', 'Solicitante', 'WhatsApp + correo', 'Arranca el plazo'],
  ['Faltan 24 horas', 'Solicitante', 'WhatsApp', '24 h antes del vencimiento'],
  ['Faltan 8 horas', 'Solicitante', 'WhatsApp', '8 h antes del vencimiento'],
  ['Plazo vencido', 'Solicitante, copia al DAF', 'Correo', 'Al vencer y luego diario'],
  ['Devolución validada', 'Solicitante', 'WhatsApp', 'Al validar el depósito'],
  ['Saldo bajo el umbral', 'Administrador de caja y DAF', 'WhatsApp + correo', 'Al cruzarlo'],
  ['Informe enviado', 'DAF', 'Correo', 'Al enviarse'],
  ['Informe aprobado', 'Administrador de caja y contabilidad', 'Correo', 'Al aprobarse']
]

const ESTADO_AVISO: Record<string, string> = {
  pendiente: 'cc-espera', enviada: 'cc-ok', fallida: 'cc-mal', cancelada: 'cc-ok'
}

export function AvisosPage() {
  const [avisos, setAvisos] = useState<Notificacion[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try { setAvisos(await listarAvisos()) }
      catch (e: any) { setError(e.message) } finally { setCargando(false) }
    })()
  }, [])

  return (
    <>
      <Cabecera titulo="Avisos"
        bajada="WhatsApp para lo urgente, correo para lo que necesita constancia. Los recordatorios se agendan al desembolsar y se cancelan solos cuando la persona rinde." />
      <AvisoError mensaje={error} />

      <div className="cc-card">
        <h2>Qué se envía y por dónde</h2>
        <div className="cc-scroll">
          <table className="cc-tabla">
            <thead><tr><th>Evento</th><th>Destinatario</th><th>Canal</th><th>Cuándo</th></tr></thead>
            <tbody>
              {REGLAS.map(([ev, dest, canal, cuando]) => (
                <tr key={ev}>
                  <td>{ev}</td>
                  <td className="cc-tenue">{dest}</td>
                  <td><span className={`cc-chip ${canal.includes('+') ? 'cc-curso' : 'cc-ok'}`}>{canal}</span></td>
                  <td className="cc-tenue">{cuando}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="cc-card">
        <h2>Agenda reciente</h2>
        {cargando ? <Cargando /> : !avisos.length ? <Vacio texto="Todavía no se agendó ningún aviso." /> : (
          <div className="cc-scroll">
            <table className="cc-tabla">
              <thead><tr><th>Plantilla</th><th>Canal</th><th>Programado</th><th>Enviado</th><th>Estado</th></tr></thead>
              <tbody>
                {avisos.map((a) => (
                  <tr key={a.id}>
                    <td className="cc-mono">{a.plantilla}</td>
                    <td>{a.canal}</td>
                    <td className="cc-mono">{fechaHora(a.programada_para)}</td>
                    <td className="cc-mono">{fechaHora(a.enviada_en)}</td>
                    <td><span className={`cc-chip ${ESTADO_AVISO[a.estado] ?? 'cc-ok'}`}>{a.estado}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
