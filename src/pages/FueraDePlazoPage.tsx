import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { contarRecordatorio, justificarIncumplimiento, listarIncumplimientos } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { bs, fechaHora } from '../lib/formato'
import { asuntoAviso, avisos, enlaceCorreo, enlaceWhatsApp } from '../lib/whatsapp'
import { Cabecera, Cargando, Error as AvisoError, Exito, Persona, Vacio } from '../components/Ui'
import type { Incumplimiento } from '../types/database'

const JUST: Record<Incumplimiento['justificacion'], string> = {
  pendiente: 'Sin justificar',
  justificado: 'Justificado',
  no_justificado: 'No justificado'
}

function retraso(i: Incumplimiento) {
  const fin = i.regularizado_en ? Date.parse(i.regularizado_en) : Date.now()
  const h = Math.max(0, Math.round((fin - Date.parse(i.fecha_limite)) / 36e5))
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} días`
}

/**
 * Rendiciones que pasaron el plazo. El DAF recuerda por WhatsApp y registra
 * la justificación (que puede darse fuera del sistema). Nada se borra: es el
 * historial de incumplimientos.
 */
export function FueraDePlazoPage() {
  const { perfil } = useAuth()
  const puedeActuar = perfil?.role === 'daf' || perfil?.role === 'super_admin'
  const [lista, setLista] = useState<Incumplimiento[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [editando, setEditando] = useState<string | null>(null)
  const [estado, setEstado] = useState<Incumplimiento['justificacion']>('justificado')
  const [nota, setNota] = useState('')
  const [filtro, setFiltro] = useState('')

  const cargar = useCallback(async () => {
    try { setLista(await listarIncumplimientos()) }
    catch (e: any) { setError(e.message) }
    finally { setCargando(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const abiertos = lista.filter((i) => !i.regularizado_en)
  const porPersona = useMemo(() => {
    const m = new Map<string, { nombre: string; depto: string | null; veces: number; sinJustificar: number; ultimo: string }>()
    for (const i of lista) {
      const k = i.solicitante_id
      const x = m.get(k) ?? { nombre: i.solicitante?.full_name ?? '—', depto: i.solicitante?.departamento ?? null, veces: 0, sinJustificar: 0, ultimo: i.fecha_limite }
      x.veces++
      if (i.justificacion !== 'justificado') x.sinJustificar++
      if (i.fecha_limite > x.ultimo) x.ultimo = i.fecha_limite
      m.set(k, x)
    }
    return [...m.values()].sort((a, b) => b.veces - a.veces || b.ultimo.localeCompare(a.ultimo))
  }, [lista])
  const historial = lista.filter((i) => !filtro || (i.solicitante?.full_name ?? '').toLowerCase().includes(filtro.toLowerCase()))

  if (cargando) return <Cargando />

  const recordar = async (i: Incumplimiento, medio: 'whatsapp' | 'correo') => {
    const a = avisos.vencido(i)
    if (medio === 'whatsapp') window.open(enlaceWhatsApp(a.para.telefono, a.texto), '_blank', 'noopener')
    else window.location.href = enlaceCorreo(a.para.email, asuntoAviso(a), a.texto)
    try { await contarRecordatorio(i); await cargar() } catch (e: any) { setError(e.message) }
  }

  const formulario = (i: Incumplimiento) => (
    <div style={{ borderTop: '1px solid var(--borde)', marginTop: 10, paddingTop: 10 }}>
      <div className="cc-dos">
        <div className="cc-campo">
          <label>Resultado</label>
          <select value={estado} onChange={(e) => setEstado(e.target.value as Incumplimiento['justificacion'])}>
            <option value="justificado">Justificado</option>
            <option value="no_justificado">No justificado</option>
            <option value="pendiente">Sin justificar todavía</option>
          </select>
        </div>
        <div className="cc-campo">
          <label>Cómo justificó (nota, documento o motivo)</label>
          <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: nota firmada del 18/11 por viaje imprevisto" />
        </div>
      </div>
      <div className="cc-acc">
        <button className="cc-btn cc-btn-p" disabled={estado !== 'pendiente' && !nota.trim()} onClick={async () => {
          setError(null)
          try {
            await justificarIncumplimiento(i.id, estado, nota)
            setEditando(null); setExito('Justificación registrada.'); await cargar()
          } catch (e: any) { setError(e.message) }
        }}>Guardar</button>
        <button className="cc-btn cc-btn-x" onClick={() => setEditando(null)}>Cancelar</button>
      </div>
    </div>
  )

  return (
    <>
      <Cabecera titulo="Fuera de plazo"
        bajada="Rendiciones que pasaron el plazo. El aviso al solicitante sale solo, a nombre del DAF; aquí se le recuerda por WhatsApp o correo y se registra su justificación. El historial no se borra." />
      <AvisoError mensaje={error} />
      <Exito mensaje={exito} />

      <div className="cc-card">
        <h2>Pendientes de rendir ({abiertos.length})</h2>
        {abiertos.length === 0 ? <Vacio texto="Nadie está fuera de plazo ahora." /> : abiertos.map((i) => (
          <div key={i.id} style={{ borderTop: '1px solid var(--borde)', padding: '12px 0' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
              <div>
                <Persona nombre={i.solicitante?.full_name} depto={i.solicitante?.departamento} />
                <div style={{ fontSize: 14, marginTop: 4 }}>
                  <Link to={`/solicitudes/${i.solicitud_id}`}>{i.solicitud?.descripcion ?? i.solicitud_id.slice(0, 8)}</Link> · {bs(i.monto)}
                </div>
                <div className="cc-tenue" style={{ fontSize: 13 }}>
                  Venció el {fechaHora(i.fecha_limite)} · lleva {retraso(i)} de retraso
                  {i.recordatorios > 0 && ` · ${i.recordatorios} recordatorio(s), el último ${fechaHora(i.ultimo_recordatorio)}`}
                  {' · '}{JUST[i.justificacion]}
                </div>
              </div>
              {puedeActuar && (
                <div className="cc-acc" style={{ alignItems: 'flex-start' }}>
                  <button className="cc-btn cc-btn-p" style={{ background: '#1f7a4d', borderColor: '#1f7a4d' }} onClick={() => recordar(i, 'whatsapp')}>
                    Recordar por WhatsApp
                  </button>
                  {i.solicitante?.email && (
                    <button className="cc-btn cc-btn-x" onClick={() => recordar(i, 'correo')}>Recordar por correo</button>
                  )}
                  <button className="cc-btn cc-btn-x" onClick={() => { setEditando(i.id); setEstado(i.justificacion === 'pendiente' ? 'justificado' : i.justificacion); setNota(i.nota_justificacion ?? '') }}>
                    Registrar justificación
                  </button>
                </div>
              )}
            </div>
            {editando === i.id && formulario(i)}
          </div>
        ))}
      </div>

      <div className="cc-card">
        <h2>Incumplimientos por solicitante</h2>
        {porPersona.length === 0 ? <Vacio texto="Sin incumplimientos registrados." /> : (
          <table className="cc-tabla">
            <thead><tr><th>Solicitante</th><th className="num">Veces fuera de plazo</th><th className="num">Sin justificar</th><th>Último vencimiento</th></tr></thead>
            <tbody>
              {porPersona.map((p) => (
                <tr key={p.nombre + p.ultimo}>
                  <td><Persona nombre={p.nombre} depto={p.depto} /></td>
                  <td className="num">{p.veces}</td>
                  <td className="num">{p.sinJustificar}</td>
                  <td className="cc-mono">{fechaHora(p.ultimo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="cc-card">
        <h2>Historial</h2>
        <div className="cc-campo" style={{ maxWidth: 320 }}>
          <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar por solicitante" />
        </div>
        {historial.length === 0 ? <Vacio texto="Sin registros." /> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="cc-tabla">
              <thead><tr><th>Solicitante</th><th>Vale</th><th className="num">Monto</th><th>Venció</th><th>Rindió</th><th>Retraso</th><th>Justificación</th></tr></thead>
              <tbody>
                {historial.map((i) => (
                  <tr key={i.id}>
                    <td>{i.solicitante?.full_name ?? '—'}</td>
                    <td><Link to={`/solicitudes/${i.solicitud_id}`}>{i.solicitud?.descripcion ?? i.solicitud_id.slice(0, 8)}</Link></td>
                    <td className="num">{bs(i.monto)}</td>
                    <td className="cc-mono">{fechaHora(i.fecha_limite)}</td>
                    <td className="cc-mono">{i.regularizado_en ? fechaHora(i.regularizado_en) : 'Pendiente'}</td>
                    <td>{retraso(i)}</td>
                    <td>
                      {JUST[i.justificacion]}
                      {i.nota_justificacion && <div className="cc-tenue" style={{ fontSize: 12 }}>{i.nota_justificacion}</div>}
                      {puedeActuar && i.regularizado_en && editando !== i.id && (
                        <button className="cc-btn cc-btn-x" style={{ marginTop: 6, fontSize: 12 }}
                          onClick={() => { setEditando(i.id); setEstado(i.justificacion === 'pendiente' ? 'justificado' : i.justificacion); setNota(i.nota_justificacion ?? '') }}>
                          {i.justificacion === 'pendiente' ? 'Registrar' : 'Cambiar'}
                        </button>
                      )}
                      {i.regularizado_en && editando === i.id && formulario(i)}
                    </td>
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
