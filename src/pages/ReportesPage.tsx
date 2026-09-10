import { useEffect, useMemo, useState } from 'react'
import { BarChart, Bar, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { listarSolicitudes } from '../lib/api'
import { bs, fecha, horasRestantes } from '../lib/formato'
import { Cabecera, Cargando, Dato, Error as AvisoError, Vacio } from '../components/Ui'
import type { Solicitud } from '../types/database'

export function ReportesPage() {
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try { setSolicitudes(await listarSolicitudes()) }
      catch (e: any) { setError(e.message) } finally { setCargando(false) }
    })()
  }, [])

  const ejecutadas = useMemo(
    () => solicitudes.filter((s) => ['desembolsado', 'pendiente_devolucion', 'completado'].includes(s.estado)),
    [solicitudes])

  const porCategoria = useMemo(() => {
    const m = new Map<string, number>()
    ejecutadas.forEach((s) => {
      const c = s.categoria ?? 'Sin categoría'
      m.set(c, (m.get(c) ?? 0) + Number(s.monto_real ?? s.monto_solicitado))
    })
    return [...m.entries()].map(([categoria, monto]) => ({ categoria, monto })).sort((a, b) => b.monto - a.monto)
  }, [ejecutadas])

  const porMes = useMemo(() => {
    const m = new Map<string, number>()
    ejecutadas.forEach((s) => {
      const d = new Date(s.fecha_desembolso ?? s.fecha_creacion)
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      m.set(k, (m.get(k) ?? 0) + Number(s.monto_real ?? s.monto_solicitado))
    })
    return [...m.entries()].sort().map(([mes, monto]) => ({ mes, monto }))
  }, [ejecutadas])

  const rendidas = ejecutadas.filter((s) => s.fecha_rendicion && s.limite_tiempo_devolucion)
  const enPlazo = rendidas.filter((s) => new Date(s.fecha_rendicion!) <= new Date(s.limite_tiempo_devolucion!))
  const pct = rendidas.length ? Math.round((enPlazo.length / rendidas.length) * 100) : null
  const abiertas = solicitudes.filter((s) => s.estado === 'pendiente_devolucion')
  const total = ejecutadas.reduce((a, s) => a + Number(s.monto_real ?? s.monto_solicitado), 0)

  if (cargando) return <Cargando />

  return (
    <>
      <Cabecera titulo="Reportes" bajada="En qué se usa la caja, con qué ritmo, y qué tan bien se cumple el plazo." />
      <AvisoError mensaje={error} />

      <div className="cc-grid cc-g3">
        <Dato valor={bs(total)} rotulo="Ejecutado histórico" />
        <Dato valor={ejecutadas.length} rotulo="Vales entregados" />
        <Dato valor={pct == null ? '—' : `${pct}%`} rotulo="Rendidos dentro del plazo" />
      </div>

      <div className="cc-card">
        <h2>Gasto por categoría</h2>
        {!porCategoria.length ? <Vacio texto="Sin datos todavía." /> : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={porCategoria} layout="vertical" margin={{ left: 10, right: 20 }}>
              <CartesianGrid stroke="#d7d3d3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 12 }} stroke="#605d5d" />
              <YAxis type="category" dataKey="categoria" width={120} tick={{ fontSize: 12 }} stroke="#605d5d" />
              <Tooltip formatter={(v: number) => bs(v)} />
              <Bar dataKey="monto" radius={0}>
                {porCategoria.map((d) => <Cell key={d.categoria} fill="#201e1d" />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="cc-card">
        <h2>Gasto mes a mes</h2>
        {!porMes.length ? <Vacio texto="Sin datos todavía." /> : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={porMes}>
              <CartesianGrid stroke="#d7d3d3" vertical={false} />
              <XAxis dataKey="mes" tick={{ fontSize: 12 }} stroke="#605d5d" />
              <YAxis tick={{ fontSize: 12 }} stroke="#605d5d" />
              <Tooltip formatter={(v: number) => bs(v)} />
              <Line type="monotone" dataKey="monto" stroke="#201e1d" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="cc-card">
        <h2>Devoluciones abiertas ({abiertas.length})</h2>
        {!abiertas.length ? <Vacio texto="Ninguna devolución pendiente." /> : (
          <table className="cc-tabla">
            <thead><tr><th>Solicitante</th><th>Detalle</th><th className="num">A devolver</th><th>Vence</th></tr></thead>
            <tbody>
              {abiertas.map((s) => (
                <tr key={s.id}>
                  <td>{s.solicitante?.full_name ?? '—'}</td>
                  <td>{s.descripcion}</td>
                  <td className="num">{bs(Number(s.monto_solicitado) - Number(s.monto_real ?? 0))}</td>
                  <td className="cc-mono">
                    {fecha(s.limite_tiempo_devolucion)}
                    {(horasRestantes(s.limite_tiempo_devolucion) ?? 0) < 0 && ' · vencida'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
