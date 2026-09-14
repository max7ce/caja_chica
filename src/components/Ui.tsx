import { ETIQUETA_ESTADO, type EstadoInforme, type EstadoSolicitud } from '../types/database'
import { iniciales } from '../lib/formato'

const CLASE: Record<EstadoSolicitud, string> = {
  pendiente_coordinador: 'cc-espera',
  pendiente_daf: 'cc-espera',
  aprobado_daf: 'cc-curso',
  desembolsado: 'cc-curso',
  pendiente_devolucion: 'cc-espera',
  completado: 'cc-ok',
  rechazado: 'cc-mal'
}

export function Estado({ estado }: { estado: EstadoSolicitud }) {
  return <span className={`cc-chip ${CLASE[estado]}`}>{ETIQUETA_ESTADO[estado]}</span>
}

const INFORME: Record<EstadoInforme, [string, string]> = {
  borrador: ['cc-ok', 'Borrador'],
  pendiente_daf: ['cc-espera', 'Esperando al DAF'],
  aprobado_daf: ['cc-curso', 'Aprobado, en contabilidad'],
  completado: ['cc-ok', 'Repuesto'],
  rechazado: ['cc-mal', 'Rechazado']
}

export function EstadoInformeChip({ estado }: { estado: EstadoInforme }) {
  const [clase, texto] = INFORME[estado]
  return <span className={`cc-chip ${clase}`}>{texto}</span>
}

/** Contador de plazo. En rojo sólido cuando ya venció. */
export function Reloj({ horas }: { horas: number | null }) {
  if (horas == null) return <span className="cc-tenue">—</span>
  const tarde = horas < 0
  return (
    <span className={`cc-reloj ${tarde ? 'tarde' : ''}`}>
      {tarde ? `vencida hace ${Math.abs(horas)} h` : `faltan ${horas} h`}
    </span>
  )
}

export function Persona({ nombre, depto }: { nombre?: string | null; depto?: string | null }) {
  return (
    <div className="cc-persona">
      <div className="cc-ini">{iniciales(nombre)}</div>
      <div>{nombre ?? '—'}{depto && <span>{depto}</span>}</div>
    </div>
  )
}

export function Dato({ valor, rotulo }: { valor: React.ReactNode; rotulo: string }) {
  return (
    <div className="cc-dato">
      <div className="v">{valor}</div>
      <div className="r">{rotulo}</div>
    </div>
  )
}

export function Error({ mensaje }: { mensaje: string | null }) {
  if (!mensaje) return null
  return <div className="cc-aviso cc-av-mal">{mensaje}</div>
}

export function Exito({ mensaje }: { mensaje: string | null }) {
  if (!mensaje) return null
  return <div className="cc-aviso cc-av-ok">{mensaje}</div>
}

export function Alerta({ mensaje }: { mensaje: string | null }) {
  if (!mensaje) return null
  return <div className="cc-aviso cc-av-oro">{mensaje}</div>
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return <div className="cc-vacio">{texto}</div>
}

export function Vacio({ texto }: { texto: string }) {
  return <div className="cc-vacio">{texto}</div>
}

export function Cabecera({ titulo, bajada }: { titulo: string; bajada?: string }) {
  return (
    <div className="cc-cab">
      <h1>{titulo}</h1>
      {bajada && <p>{bajada}</p>}
    </div>
  )
}
