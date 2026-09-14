import { useEffect, useMemo, useState } from 'react'
import { BarChart, Bar, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { listarOficinas, listarPerfiles, listarSolicitudes } from '../lib/api'
import { bs } from '../lib/formato'
import { Cabecera, Cargando, Dato, Error as AvisoError, Vacio } from '../components/Ui'
import type { Oficina, Profile, Solicitud } from '../types/database'

const AZUL = '#1b3a6b'
const GRIS = '#6c757d'

export function ReportesPage() {
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([])
  const [oficinas, setOficinas] = useState<Oficina[]>([])
  const [perfiles, setPerfiles] = useState<Profile[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [oficinaId, setOficinaId] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const [s, o, p] = await Promise.all([listarSolicitudes(), listarOficinas(), listarPerfiles()])
        setSolicitudes(s); setOficinas(o); setPerfiles(p)
      } catch (e: any) { setError(e.message) } finally { setCargando(false) }
    })()
  }, [])

  const oficinaDe = useMemo(() => {
    const m = new Map<string, string | null>()
    perfiles.forEach((p) => m.set(p.id, p.oficina_id))
    return m
  }, [perfiles])

  const monto = (s: Solicitud) => Number(s.monto_real ?? s.monto_solicitado)

  /** Solo cuentan las que movieron dinero: pedidas y rechazadas no son gasto. */
  const base = useMemo(() => solicitudes.filter((s) => {
    if (!['desembolsado', 'pendiente_devolucion', 'completado'].includes(s.estado)) return false
    const f = new Date(s.fecha_desembolso ?? s.fecha_creacion)
    if (desde && f < new Date(desde)) return false
    if (hasta && f > new Date(hasta + 'T23:59:59')) return false
    if (oficinaId && oficinaDe.get(s.solicitante_id) !== oficinaId) return false
    return true
  }), [solicitudes, desde, hasta, oficinaId, oficinaDe])

  /** Una fila por categoría, con quién la usa más. */
  const porCategoria = useMemo(() => {
    const m = new Map<string, { vales: number; monto: number; personas: Map<string, number> }>()
    base.forEach((s) => {
      const c = s.categoria ?? 'Sin categoría'
      if (!m.has(c)) m.set(c, { vales: 0, monto: 0, personas: new Map() })
      const fila = m.get(c)!
      fila.vales += 1
      fila.monto += monto(s)
      const quien = s.solicitante?.full_name ?? '—'
      fila.personas.set(quien, (fila.personas.get(quien) ?? 0) + monto(s))
    })
    return [...m.entries()]
      .map(([categoria, d]) => {
        const top = [...d.personas.entries()].sort((a, b) => b[1] - a[1])[0]
        return {
          categoria, vales: d.vales, monto: d.monto,
          promedio: d.monto / d.vales,
          quienMas: top ? top[0] : '—',
          montoQuienMas: top ? top[1] : 0
        }
      })
      .sort((a, b) => b.monto - a.monto)
  }, [base])

  /** Qué pide cada persona, resumido a lo que se puede leer de un vistazo. */
  const porPersona = useMemo(() => {
    const m = new Map<string, { vales: number; monto: number; cats: Map<string, number> }>()
    base.forEach((s) => {
      const quien = s.solicitante?.full_name ?? '—'
      if (!m.has(quien)) m.set(quien, { vales: 0, monto: 0, cats: new Map() })
      const f = m.get(quien)!
      f.vales += 1
      f.monto += monto(s)
      const c = s.categoria ?? 'Sin categoría'
      f.cats.set(c, (f.cats.get(c) ?? 0) + monto(s))
    })
    return [...m.entries()]
      .map(([persona, d]) => {
        const top = [...d.cats.entries()].sort((a, b) => b[1] - a[1])[0]
        return {
          persona, vales: d.vales, monto: d.monto,
          categoriaHabitual: top ? top[0] : '—',
          variedad: d.cats.size
        }
      })
      .sort((a, b) => b.monto - a.monto)
  }, [base])

  const porOficina = useMemo(() => {
    const nombres = new Map(oficinas.map((o) => [o.id, o.nombre]))
    const m = new Map<string, number>()
    base.forEach((s) => {
      const oid = oficinaDe.get(s.solicitante_id)
      const nombre = (oid && nombres.get(oid)) || 'Sin oficina'
      m.set(nombre, (m.get(nombre) ?? 0) + monto(s))
    })
    return [...m.entries()].map(([oficina, total]) => ({ oficina, monto: total }))
      .sort((a, b) => b.monto - a.monto)
  }, [base, oficinas, oficinaDe])

  const porMes = useMemo(() => {
    const m = new Map<string, number>()
    base.forEach((s) => {
      const d = new Date(s.fecha_desembolso ?? s.fecha_creacion)
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      m.set(k, (m.get(k) ?? 0) + monto(s))
    })
    return [...m.entries()].sort().map(([mes, total]) => ({ mes, monto: total }))
  }, [base])

  if (cargando) return <Cargando />

  const total = base.reduce((a, s) => a + monto(s), 0)
  const lider = porCategoria[0]
  const rendidas = base.filter((s) => s.fecha_rendicion && s.limite_tiempo_devolucion)
  const enPlazo = rendidas.filter((s) => new Date(s.fecha_rendicion!) <= new Date(s.limite_tiempo_devolucion!))
  const pct = rendidas.length ? Math.round((enPlazo.length / rendidas.length) * 100) : null

  return (
    <>
      <Cabecera titulo="Reportes" bajada="En qué se usa la caja, quién la usa y con qué ritmo." />
      <AvisoError mensaje={error} />

      <div className="cc-card">
        <h2>Filtros</h2>
        <div className="cc-dos">
          <div className="cc-campo">
            <label>Desde</label>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="cc-campo">
            <label>Hasta</label>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
          <div className="cc-campo">
            <label>Oficina</label>
            <select value={oficinaId} onChange={(e) => setOficinaId(e.target.value)}>
              <option value="">Todas</option>
              {oficinas.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          </div>
        </div>
        {(desde || hasta || oficinaId) && (
          <button className="cc-btn cc-btn-x" onClick={() => { setDesde(''); setHasta(''); setOficinaId('') }}>
            Quitar filtros
          </button>
        )}
      </div>

      <div className="cc-grid cc-g3">
        <Dato valor={bs(total)} rotulo="Ejecutado en el período" />
        <Dato valor={base.length} rotulo="Vales entregados" />
        <Dato valor={lider ? lider.categoria : '—'} rotulo="Categoría con más gasto" />
        <Dato valor={pct == null ? '—' : `${pct}%`} rotulo="Rendidos dentro del plazo" />
      </div>

      <div className="cc-grid cc-g2">
        <div className="cc-card">
          <h2>Monto por categoría</h2>
          {!porCategoria.length ? <Vacio texto="Sin datos en este período." /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={porCategoria} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid stroke="#dee2e6" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12 }} stroke={GRIS} />
                <YAxis type="category" dataKey="categoria" width={120} tick={{ fontSize: 12 }} stroke={GRIS} />
                <Tooltip formatter={(v: number) => bs(v)} />
                <Bar dataKey="monto" radius={[0, 4, 4, 0]}>
                  {porCategoria.map((d) => <Cell key={d.categoria} fill={AZUL} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="cc-card">
          <h2>Cantidad de vales por categoría</h2>
          {!porCategoria.length ? <Vacio texto="Sin datos en este período." /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={porCategoria} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid stroke="#dee2e6" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} stroke={GRIS} />
                <YAxis type="category" dataKey="categoria" width={120} tick={{ fontSize: 12 }} stroke={GRIS} />
                <Tooltip formatter={(v: number) => `${v} vales`} />
                <Bar dataKey="vales" radius={[0, 4, 4, 0]}>
                  {porCategoria.map((d) => <Cell key={d.categoria} fill={GRIS} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="cc-card">
        <h2>Detalle por categoría</h2>
        <p className="cc-tenue" style={{ marginTop: 0 }}>
          El monto grande no siempre es lo que más cuesta: una categoría con muchos vales chicos consume
          más tiempo de aprobación que una con pocos vales grandes.
        </p>
        {!porCategoria.length ? <Vacio texto="Sin datos en este período." /> : (
          <div className="cc-scroll">
            <table className="cc-tabla">
              <thead>
                <tr>
                  <th>Categoría</th><th className="num">Vales</th><th className="num">Monto total</th>
                  <th className="num">Promedio</th><th>Quien más pide</th><th className="num">Su parte</th>
                </tr>
              </thead>
              <tbody>
                {porCategoria.map((c) => (
                  <tr key={c.categoria}>
                    <td>{c.categoria}</td>
                    <td className="num">{c.vales}</td>
                    <td className="num">{bs(c.monto)}</td>
                    <td className="num">{bs(c.promedio)}</td>
                    <td>{c.quienMas}</td>
                    <td className="num">{Math.round((c.montoQuienMas / c.monto) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="cc-card">
        <h2>Quién pide y de qué</h2>
        {!porPersona.length ? <Vacio texto="Sin datos en este período." /> : (
          <div className="cc-scroll">
            <table className="cc-tabla">
              <thead>
                <tr>
                  <th>Persona</th><th className="num">Vales</th><th className="num">Monto</th>
                  <th className="num">Promedio</th><th>Categoría habitual</th><th className="num">Categorías distintas</th>
                </tr>
              </thead>
              <tbody>
                {porPersona.slice(0, 25).map((p) => (
                  <tr key={p.persona}>
                    <td>{p.persona}</td>
                    <td className="num">{p.vales}</td>
                    <td className="num">{bs(p.monto)}</td>
                    <td className="num">{bs(p.monto / p.vales)}</td>
                    <td><span className="cc-cat">{p.categoriaHabitual}</span></td>
                    <td className="num">{p.variedad}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="cc-grid cc-g2">
        <div className="cc-card">
          <h2>Gasto por oficina</h2>
          {!porOficina.length ? <Vacio texto="Sin datos en este período." /> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={porOficina} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid stroke="#dee2e6" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12 }} stroke={GRIS} />
                <YAxis type="category" dataKey="oficina" width={110} tick={{ fontSize: 12 }} stroke={GRIS} />
                <Tooltip formatter={(v: number) => bs(v)} />
                <Bar dataKey="monto" radius={[0, 4, 4, 0]}>
                  {porOficina.map((d) => <Cell key={d.oficina} fill={AZUL} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="cc-card">
          <h2>Gasto mes a mes</h2>
          {!porMes.length ? <Vacio texto="Sin datos en este período." /> : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={porMes}>
                <CartesianGrid stroke="#dee2e6" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 12 }} stroke={GRIS} />
                <YAxis tick={{ fontSize: 12 }} stroke={GRIS} />
                <Tooltip formatter={(v: number) => bs(v)} />
                <Line type="monotone" dataKey="monto" stroke={AZUL} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </>
  )
}
