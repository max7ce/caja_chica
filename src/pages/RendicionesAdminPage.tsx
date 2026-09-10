import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import { rendicionesPorAdmin } from '../lib/api'
import { bs } from '../lib/formato'
import { Cabecera, Cargando, Dato, Error as AvisoError, Persona, Vacio } from '../components/Ui'
import type { RendicionAdmin } from '../types/database'

/** Reporte para el DAF: cómo rindió cada responsable durante su gestión rotativa. */
export function RendicionesAdminPage() {
  const [filas, setFilas] = useState<RendicionAdmin[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try { setFilas(await rendicionesPorAdmin()) }
      catch (e: any) { setError(e.message) } finally { setCargando(false) }
    })()
  }, [])

  if (cargando) return <Cargando />

  const totalRendido = filas.reduce((a, x) => a + Number(x.monto_rendido ?? 0), 0)
  const totalInformes = filas.reduce((a, x) => a + Number(x.informes ?? 0), 0)
  const conDias = filas.filter((f) => f.dias_aprobacion != null)
  const promedio = conDias.length
    ? (conDias.reduce((a, x) => a + Number(x.dias_aprobacion), 0) / conDias.length).toFixed(1)
    : '—'

  const datos = filas.map((f) => ({
    nombre: (f.admin_nombre ?? 'Sin nombre').split(' ')[0],
    monto: Number(f.monto_rendido ?? 0),
    dias: Number(f.dias_aprobacion ?? 0)
  }))

  return (
    <>
      <Cabecera
        titulo="Rendiciones por administrador"
        bajada="Cómo rindió cada responsable de caja durante su período. Sirve para comparar gestiones y ver dónde se demora el circuito."
      />
      <AvisoError mensaje={error} />

      {!filas.length ? <Vacio texto="Todavía no hay gestiones registradas." /> : (
        <>
          <div className="cc-grid cc-g3">
            <Dato valor={bs(totalRendido)} rotulo="Total rendido histórico" />
            <Dato valor={totalInformes} rotulo="Informes presentados" />
            <Dato valor={`${promedio} días`} rotulo="Promedio de aprobación" />
          </div>

          <div className="cc-card">
            <h2>Detalle por responsable</h2>
            <div className="cc-scroll">
              <table className="cc-tabla">
                <thead>
                  <tr>
                    <th>Administrador</th><th>Período</th><th className="num">Informes</th>
                    <th className="num">Monto rendido</th><th className="num">Días de aprobación</th>
                    <th>Rendido dentro del plazo</th><th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => {
                    const pct = f.pct_en_plazo == null ? null : Number(f.pct_en_plazo)
                    const dias = f.dias_aprobacion == null ? null : Number(f.dias_aprobacion)
                    return (
                      <tr key={f.periodo_id}>
                        <td><Persona nombre={f.admin_nombre} /></td>
                        <td className="cc-tenue">{f.periodo}</td>
                        <td className="num">{f.informes}</td>
                        <td className="num">{bs(f.monto_rendido)}</td>
                        <td className="num">
                          {dias == null ? '—' : (
                            <span style={{ color: dias > 5 ? 'var(--acento)' : 'var(--tinta)', fontWeight: 800 }}>{dias}</span>
                          )}
                        </td>
                        <td>
                          {pct == null ? <span className="cc-tenue">sin datos</span> : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div className="cc-barra">
                                <span style={{ width: `${pct}%`, background: pct < 80 ? 'var(--acento)' : 'var(--tinta)' }} />
                              </div>
                              <span className="cc-mono" style={{ color: 'var(--tinta)' }}>{pct}%</span>
                            </div>
                          )}
                        </td>
                        <td>
                          {f.informes_abiertos > 0
                            ? <span className="cc-chip cc-espera">{f.informes_abiertos} abierto(s)</span>
                            : <span className="cc-chip cc-ok">Al día</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="cc-grid cc-g2">
            <div className="cc-card">
              <h2>Monto rendido por gestión</h2>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={datos}>
                  <CartesianGrid stroke="#d7d3d3" vertical={false} />
                  <XAxis dataKey="nombre" tick={{ fontSize: 12 }} stroke="#605d5d" />
                  <YAxis tick={{ fontSize: 12 }} stroke="#605d5d" />
                  <Tooltip formatter={(v: number) => bs(v)} />
                  <Bar dataKey="monto" radius={0}>
                    {datos.map((d) => <Cell key={d.nombre} fill="#201e1d" />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="cc-card">
              <h2>Días hasta la aprobación del informe</h2>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={datos} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid stroke="#d7d3d3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} stroke="#605d5d" />
                  <YAxis type="category" dataKey="nombre" width={80} tick={{ fontSize: 12 }} stroke="#605d5d" />
                  <Tooltip formatter={(v: number) => `${v} días`} />
                  <Bar dataKey="dias" radius={0}>
                    {datos.map((d) => <Cell key={d.nombre} fill={d.dias > 5 ? '#ec3013' : '#201e1d'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </>
  )
}
