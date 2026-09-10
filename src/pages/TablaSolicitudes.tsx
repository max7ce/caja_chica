import { Link } from 'react-router-dom'
import { bs, fecha, horasRestantes } from '../lib/formato'
import { Estado, Reloj, Persona, Vacio } from '../components/Ui'
import type { Solicitud } from '../types/database'

export function TablaSolicitudes({ solicitudes }: { solicitudes: Solicitud[] }) {
  if (!solicitudes.length) return <Vacio texto="No hay solicitudes que mostrar." />
  return (
    <div className="cc-scroll">
      <table className="cc-tabla">
        <thead>
          <tr>
            <th>Fecha</th><th>Solicitante</th><th>Detalle</th><th>Categoría</th>
            <th className="num">Pedido</th><th className="num">Gastado</th><th>Estado</th><th>Plazo</th><th />
          </tr>
        </thead>
        <tbody>
          {solicitudes.map((s) => (
            <tr key={s.id}>
              <td className="cc-mono">{fecha(s.fecha_creacion)}</td>
              <td><Persona nombre={s.solicitante?.full_name} depto={s.solicitante?.departamento} /></td>
              <td>{s.descripcion}</td>
              <td><span className="cc-cat">{s.categoria ?? '—'}</span></td>
              <td className="num">{bs(s.monto_solicitado)}</td>
              <td className="num">{s.monto_real == null ? '—' : bs(s.monto_real)}</td>
              <td><Estado estado={s.estado} /></td>
              <td>
                {['desembolsado', 'pendiente_devolucion'].includes(s.estado)
                  ? <Reloj horas={horasRestantes(s.limite_tiempo_devolucion)} />
                  : <span className="cc-tenue">—</span>}
              </td>
              <td><Link className="cc-btn cc-btn-x" to={`/solicitudes/${s.id}`}>Ver</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
