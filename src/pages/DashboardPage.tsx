import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import { listarSolicitudes, obtenerSaldo } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { bs, horasRestantes } from '../lib/formato'
import { Alerta, Cabecera, Cargando, Dato, Error as AvisoError } from '../components/Ui'
import { TablaSolicitudes } from './TablaSolicitudes'
import type { SaldoCaja, Solicitud } from '../types/database'

export function DashboardPage() {
  const { perfil, parametros, periodo } = useAuth()
  const [saldo, setSaldo] = useState<SaldoCaja | null>(null)
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const esSolicitante = perfil?.role === 'solicitante'

  useEffect(() => {
    ;(async () => {
      try {
        const [s, lista] = await Promise.all([
          esSolicitante ? Promise.resolve(null) : obtenerSaldo(periodo?.id ?? null),
          listarSolicitudes(esSolicitante ? { solicitanteId: perfil!.id } : undefined)
        ])
        setSaldo(s); setSolicitudes(lista)
      } catch (e: any) { setError(e.message) } finally { setCargando(false) }
    })()
  }, [esSolicitante, perfil, periodo])

  const porUsuario = useMemo(() => {
    const m = new Map<string, number>()
    solicitudes
      .filter((s) => ['desembolsado', 'pendiente_devolucion', 'completado'].includes(s.estado))
      .forEach((s) => {
        const n = s.solicitante?.full_name ?? s.solicitante?.email ?? 'Sin nombre'
        m.set(n.split(' ')[0], (m.get(n.split(' ')[0]) ?? 0) + Number(s.monto_real ?? s.monto_solicitado))
      })
    return [...m.entries()].map(([nombre, monto]) => ({ nombre, monto })).sort((a, b) => b.monto - a.monto).slice(0, 8)
  }, [solicitudes])

  if (cargando) return <Cargando />

  const tope = parametros?.monto_reposicion ?? 7000
  const umbral = parametros?.umbral_reposicion ?? 2000
  const valor = Number(saldo?.saldo ?? 0)
  const pct = Math.max(0, Math.min(100, (valor / tope) * 100))
  const bajo = valor <= umbral

  const pendientes = solicitudes.filter((s) => s.estado === 'pendiente_daf').length
  const porPagar = solicitudes.filter((s) => s.estado === 'aprobado_daf').length
  const porRendir = solicitudes.filter((s) => ['desembolsado', 'pendiente_devolucion'].includes(s.estado))
  const vencidas = porRendir.filter((s) => (horasRestantes(s.limite_tiempo_devolucion) ?? 99) < 0)

  return (
    <>
      <Cabecera
        titulo={`Hola, ${perfil?.full_name?.split(' ')[0] ?? 'buen día'}`}
        bajada={esSolicitante
          ? `Tus vales y lo que falta rendir. El plazo es de ${parametros?.plazo_rendicion_horas ?? 48} horas hábiles.`
          : 'Estado de la caja y lo que espera una acción tuya.'}
      />
      <AvisoError mensaje={error} />
      {vencidas.length > 0 && (
        <div className="cc-aviso cc-av-mal">
          {esSolicitante
            ? `Tienes ${vencidas.length} rendición(es) fuera de plazo. Hasta regularizarlas no puedes pedir vales nuevos.`
            : `${vencidas.length} rendición(es) pasaron el plazo sin completarse.`}
        </div>
      )}
      {bajo && !esSolicitante && (
        <Alerta mensaje={`El saldo bajó de ${bs(umbral)}. Es momento de armar el informe de rendición para pedir la reposición.`} />
      )}

      <div className="cc-grid cc-g3">
        {saldo && (
          <div className="cc-hero">
            <div style={{ flex: 1, minWidth: 280 }}>
              <div className="rot">Saldo disponible en caja</div>
              <div className="cif">{valor.toLocaleString('es-BO', { minimumFractionDigits: 2 })}<small>Bs</small></div>
              <div className="cc-barra" style={{ height: 20, marginTop: 20, background: 'rgba(243,242,242,.22)' }}>
                <span style={{ width: `${pct}%`, background: bajo ? 'var(--acento)' : '#f3f2f2' }} />
              </div>
              <div className="nota">{Math.round(pct)}% del fondo · se repone con {bs(tope)} al llegar a {bs(umbral)}</div>
            </div>
          </div>
        )}
        <Dato valor={pendientes} rotulo="Esperando al DAF" />
        <Dato valor={porPagar} rotulo="Listas para desembolso" />
        <Dato valor={porRendir.length} rotulo="En plazo de rendición" />
      </div>

      {!esSolicitante && porUsuario.length > 0 && (
        <div className="cc-card">
          <h2>Gasto por persona</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={porUsuario}>
              <CartesianGrid stroke="#d7d3d3" vertical={false} />
              <XAxis dataKey="nombre" tick={{ fontSize: 12 }} stroke="#605d5d" />
              <YAxis tick={{ fontSize: 12 }} stroke="#605d5d" />
              <Tooltip formatter={(v: number) => bs(v)} />
              <Bar dataKey="monto" radius={0}>
                {porUsuario.map((d) => <Cell key={d.nombre} fill="#201e1d" />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="cc-card">
        <h2>Últimas solicitudes</h2>
        <TablaSolicitudes solicitudes={solicitudes.slice(0, 8)} />
        <Link className="cc-btn cc-btn-x" to="/solicitudes" style={{ marginTop: 14 }}>Ver todas</Link>
      </div>
    </>
  )
}
