import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { desembolsar, listarSolicitudes, obtenerSaldo } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { bs, fecha } from '../lib/formato'
import { ValeQR } from '../components/ValeQR'
import { Alerta, Cabecera, Cargando, Error as AvisoError, Persona, Vacio } from '../components/Ui'
import type { Solicitud } from '../types/database'

export function DesembolsosPage() {
  const { perfil, parametros, periodo } = useAuth()
  const [lista, setLista] = useState<Solicitud[]>([])
  const [saldo, setSaldo] = useState(0)
  const [abierta, setAbierta] = useState<Solicitud | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([listarSolicitudes({ estado: 'aprobado_daf' }), obtenerSaldo(periodo?.id ?? null)])
      setLista(l); setSaldo(Number(s.saldo))
    } catch (e: any) { setError(e.message) } finally { setCargando(false) }
  }, [periodo])
  useEffect(() => { cargar() }, [cargar])

  async function confirmar(s: Solicitud) {
    setTrabajando(true); setError(null)
    try { await desembolsar(s, perfil!.id, periodo?.id ?? null); setAbierta(null); await cargar() }
    catch (e: any) { setError(e.message) } finally { setTrabajando(false) }
  }

  if (cargando) return <Cargando />
  const umbral = parametros?.umbral_reposicion ?? 2000

  return (
    <>
      <Cabecera titulo="Desembolsos" bajada="Genera el QR, transfiere desde la app del banco y confirma aquí. El plazo de rendición empieza en ese momento." />
      <AvisoError mensaje={error} />
      {saldo <= umbral && <Alerta mensaje={`Saldo actual ${bs(saldo)}. Conviene rendir antes de seguir desembolsando.`} />}

      {abierta && (
        <div className="cc-card">
          <ValeQR
            titulo={`Transferir a ${abierta.solicitante?.full_name ?? 'el solicitante'}`}
            qrRuta={abierta.solicitante?.qr_url}
            faltaQR={`${abierta.solicitante?.full_name ?? 'Esta persona'} todavía no cargó su QR de cobro. Pídele que lo suba desde Mi perfil, o transfiere con los datos de cuenta que ya manejas.`}
            datos={{
              solicitud_id: abierta.id, monto: Number(abierta.monto_solicitado),
              admin: perfil!.full_name ?? perfil!.email, tipo: 'desembolso'
            }}
          />
          <div className="cc-acc" style={{ marginTop: 18 }}>
            <button className="cc-btn cc-btn-p" disabled={trabajando} onClick={() => confirmar(abierta)}>
              {trabajando ? 'Registrando…' : 'Confirmar transferencia'}
            </button>
            <button className="cc-btn" onClick={() => setAbierta(null)}>Cerrar</button>
          </div>
        </div>
      )}

      <div className="cc-card">
        {!lista.length ? <Vacio texto="No hay solicitudes esperando desembolso." /> : (
          <div className="cc-scroll">
            <table className="cc-tabla">
              <thead><tr><th>Fecha</th><th>Solicitante</th><th>Detalle</th><th className="num">Monto</th><th /></tr></thead>
              <tbody>
                {lista.map((s) => (
                  <tr key={s.id}>
                    <td className="cc-mono">{fecha(s.fecha_creacion)}</td>
                    <td><Persona nombre={s.solicitante?.full_name} depto={s.solicitante?.departamento} /></td>
                    <td><Link to={`/solicitudes/${s.id}`}>{s.descripcion}</Link></td>
                    <td className="num">{bs(s.monto_solicitado)}</td>
                    <td><button className="cc-btn cc-btn-x cc-btn-p" onClick={() => setAbierta(s)}>Generar QR</button></td>
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
