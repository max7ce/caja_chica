import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listarInformes, listarPerfiles, registrarReposicion } from '../lib/api'
import { exportarInformes } from '../lib/exportar'
import { useAuth } from '../hooks/useAuth'
import { bs, fecha } from '../lib/formato'
import { ValeQR } from '../components/ValeQR'
import { Cabecera, Cargando, Dato, Error as AvisoError, Exito, Persona, Vacio } from '../components/Ui'
import type { InformeRendicion, Profile } from '../types/database'

/** Días transcurridos desde que el DAF aprobó: mide la demora de contabilidad. */
function diasEsperando(iso: string | null): number {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

export function ReposicionesPage() {
  const { perfil } = useAuth()
  const [informes, setInformes] = useState<InformeRendicion[]>([])
  const [perfiles, setPerfiles] = useState<Map<string, Profile>>(new Map())
  const [abierto, setAbierto] = useState<InformeRendicion | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const [inf, gente] = await Promise.all([listarInformes(), listarPerfiles()])
      setInformes(inf)
      setPerfiles(new Map(gente.map((p) => [p.id, p])))
    } catch (e: any) { setError(e.message) } finally { setCargando(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  if (cargando) return <Cargando />

  const pendientes = informes.filter((i) => i.estado === 'aprobado_daf')
  const hechas = informes.filter((i) => i.estado === 'completado')
  const admin = (id: string) => perfiles.get(id)
  const totalPendiente = pendientes.reduce((a, i) => a + Number(i.monto_reposicion), 0)

  async function procesar(i: InformeRendicion) {
    setTrabajando(true); setError(null); setExito(null)
    try {
      await registrarReposicion(i, perfil!.id)
      setExito(`Reposición de ${bs(i.monto_reposicion)} registrada. El saldo de caja ya subió.`)
      setAbierto(null)
      await cargar()
    } catch (e: any) { setError(e.message) } finally { setTrabajando(false) }
  }

  return (
    <>
      <Cabecera
        titulo="Reposiciones por procesar"
        bajada="Informes que el DAF ya aprobó. Transfiere el monto al QR del administrador de caja y registra el movimiento para que el saldo vuelva a subir."
      />
      <AvisoError mensaje={error} />
      <Exito mensaje={exito} />

      <div className="cc-grid cc-g3">
        <Dato valor={pendientes.length} rotulo="Esperando transferencia" />
        <Dato valor={bs(totalPendiente)} rotulo="Monto comprometido" />
        <Dato valor={hechas.length} rotulo="Reposiciones hechas" />
      </div>

      {abierto && (
        <div className="cc-card">
          <h2>Transferir la reposición</h2>
          <ValeQR
            titulo={`Transferir a ${admin(abierto.admin_caja_id)?.full_name ?? 'el administrador de caja'}`}
            qrRuta={admin(abierto.admin_caja_id)?.qr_url}
            faltaQR="El administrador de caja todavía no cargó su QR de cobro. Pídele que lo suba desde Mi perfil antes de transferir."
            datos={{
              solicitud_id: abierto.id,
              monto: Number(abierto.monto_reposicion),
              admin: perfil!.full_name ?? perfil!.email,
              tipo: 'desembolso'
            }}
          />
          <div className="cc-acc" style={{ marginTop: 18 }}>
            <button className="cc-btn cc-btn-p" disabled={trabajando} onClick={() => procesar(abierto)}>
              {trabajando ? 'Registrando…' : `Confirmar transferencia de ${bs(abierto.monto_reposicion)}`}
            </button>
            <Link className="cc-btn" to={`/rendicion-cuentas/${abierto.id}`}>Ver el informe completo</Link>
            <button className="cc-btn" onClick={() => setAbierto(null)}>Cerrar</button>
          </div>
        </div>
      )}

      <div className="cc-card">
        <h2>Pendientes</h2>
        {!pendientes.length ? <Vacio texto="No hay reposiciones esperando. Todo al día." /> : (
          <div className="cc-scroll">
            <table className="cc-tabla">
              <thead>
                <tr>
                  <th>Administrador de caja</th><th>Aprobado por el DAF</th><th className="num">Espera</th>
                  <th className="num">Rendido</th><th className="num">A transferir</th><th />
                </tr>
              </thead>
              <tbody>
                {pendientes.map((i) => {
                  const dias = diasEsperando(i.fecha_aprobacion_daf)
                  return (
                    <tr key={i.id}>
                      <td><Persona nombre={admin(i.admin_caja_id)?.full_name} /></td>
                      <td className="cc-mono">{fecha(i.fecha_aprobacion_daf)}</td>
                      <td className="num">
                        {dias > 3
                          ? <span className="cc-chip cc-mal">{dias} días</span>
                          : <span className="cc-tenue">{dias} días</span>}
                      </td>
                      <td className="num">{bs(i.total_desembolsado)}</td>
                      <td className="num">{bs(i.monto_reposicion)}</td>
                      <td>
                        <button className="cc-btn cc-btn-x cc-btn-p" onClick={() => setAbierto(i)}>
                          Procesar
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="cc-card">
        <h2>Reposiciones ya procesadas</h2>
        {hechas.length > 0 && (
          <button className="cc-btn cc-btn-x" style={{ marginBottom: 14 }}
            onClick={async () => {
              try {
                await exportarInformes(hechas, new Map([...perfiles].map(([k, v]) => [k, v.full_name ?? v.email])))
              } catch (e: any) { setError(e.message) }
            }}>
            Descargar en Excel
          </button>
        )}
        {!hechas.length ? <Vacio texto="Todavía no se procesó ninguna reposición." /> : (
          <div className="cc-scroll">
            <table className="cc-tabla">
              <thead>
                <tr><th>Administrador</th><th>Período</th><th className="num">Rendido</th><th className="num">Repuesto</th><th /></tr>
              </thead>
              <tbody>
                {hechas.map((i) => (
                  <tr key={i.id}>
                    <td><Persona nombre={admin(i.admin_caja_id)?.full_name} /></td>
                    <td className="cc-tenue">{fecha(i.fecha_inicio_periodo)} — {fecha(i.fecha_fin_periodo)}</td>
                    <td className="num">{bs(i.total_desembolsado)}</td>
                    <td className="num">{bs(i.monto_reposicion)}</td>
                    <td><Link className="cc-btn cc-btn-x" to={`/rendicion-cuentas/${i.id}`}>Ver</Link></td>
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
