import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { crearSolicitud, listarCategorias, subirComprobante, tieneRendicionVencida } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { SubirArchivo } from '../components/SubirArchivo'
import { Alerta, Cabecera, Error as AvisoError } from '../components/Ui'
import { CATEGORIAS_RESPALDO } from '../types/database'
import { bs } from '../lib/formato'

export function SolicitudNuevaPage() {
  const { perfil, parametros } = useAuth()
  const navegar = useNavigate()
  const [monto, setMonto] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [categorias, setCategorias] = useState<string[]>(CATEGORIAS_RESPALDO)
  const [categoria, setCategoria] = useState(CATEGORIAS_RESPALDO[0])
  const [archivo, setArchivo] = useState<File | null>(null)
  const [bloqueado, setBloqueado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const tope = parametros?.tope_solicitud ?? 700
  const excede = Number(monto) > tope

  useEffect(() => {
    listarCategorias(true)
      .then((cats) => {
        if (!cats.length) return
        const nombres = cats.map((c) => c.nombre)
        setCategorias(nombres)
        setCategoria(nombres[0])
      })
      .catch(() => { /* se quedan las de respaldo */ })
  }, [])

  useEffect(() => {
    if (!perfil || !parametros?.bloquear_si_vencida) return
    tieneRendicionVencida(perfil.id).then(setBloqueado).catch(() => setBloqueado(false))
  }, [perfil, parametros])

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const valor = Number(monto)
    if (!valor || valor <= 0) return setError('Escribe un monto mayor a cero.')
    if (excede) return setError(`El tope por vale es ${bs(tope)}.`)

    setEnviando(true)
    try {
      const id = await crearSolicitud({
        solicitante_id: perfil!.id,
        monto_solicitado: valor,
        descripcion: descripcion.trim(),
        categoria
      })
      if (archivo) {
        await subirComprobante({ archivo, solicitudId: id, tipo: 'compra', usuarioId: perfil!.id, descripcion: 'Respaldo inicial' })
      }
      navegar(`/solicitudes/${id}`)
    } catch (err: any) {
      setError(err.message ?? 'No se pudo crear la solicitud.')
    } finally { setEnviando(false) }
  }

  return (
    <>
      <Cabecera titulo="Pedir caja chica" bajada="El DAF recibe el pedido por WhatsApp y por correo, y decide desde cualquiera de los dos." />
      {bloqueado ? (
        <div className="cc-aviso cc-av-mal">
          Tienes una rendición fuera de plazo. Regularízala para poder pedir vales nuevos.
        </div>
      ) : (
        <Alerta mensaje={`Una vez recibido el dinero tienes ${parametros?.plazo_rendicion_horas ?? 48} horas hábiles (el reloj se pausa sábados y domingos) para subir el comprobante y devolver la diferencia.`} />
      )}

      <form className="cc-card" style={{ maxWidth: 640 }} onSubmit={enviar}>
        <AvisoError mensaje={error} />
        <div className="cc-dos">
          <div className="cc-campo">
            <label>Monto — máximo {bs(tope)}</label>
            <input type="number" step="0.01" min="0.01" max={tope} value={monto}
              onChange={(e) => setMonto(e.target.value)} required disabled={bloqueado} />
          </div>
          <div className="cc-campo">
            <label>Categoría</label>
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} disabled={bloqueado}>
              {categorias.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="cc-campo">
          <label>¿Para qué es?</label>
          <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} required disabled={bloqueado}
            placeholder="Ejemplo: compra de tóner para la impresora de secretaría" />
        </div>
        <SubirArchivo etiqueta="Cotización o respaldo (opcional)" onSeleccion={setArchivo} disabled={bloqueado} />
        <div className="cc-acc">
          <button className="cc-btn cc-btn-p" disabled={enviando || bloqueado || excede}>
            {enviando ? 'Enviando…' : 'Enviar al DAF'}
          </button>
          <button type="button" className="cc-btn" onClick={() => navegar('/solicitudes')}>Cancelar</button>
        </div>
      </form>
    </>
  )
}
