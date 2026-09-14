import { useCallback, useEffect, useState } from 'react'
import { actualizarCategoria, crearCategoria, listarCategorias, listarSolicitudes } from '../lib/api'
import { bs } from '../lib/formato'
import { Cabecera, Cargando, Error as AvisoError, Exito, Vacio } from '../components/Ui'
import type { Categoria, Solicitud } from '../types/database'

export function CategoriasPage() {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([])
  const [nombre, setNombre] = useState('')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([listarCategorias(), listarSolicitudes()])
      setCategorias(c); setSolicitudes(s)
    } catch (e: any) { setError(e.message) } finally { setCargando(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  /** Cuántos vales usan cada categoría: define si conviene desactivarla o no. */
  function uso(nombre: string) {
    const usadas = solicitudes.filter((s) => s.categoria === nombre)
    return {
      vales: usadas.length,
      monto: usadas.reduce((a, s) => a + Number(s.monto_real ?? s.monto_solicitado), 0)
    }
  }

  async function accion(fn: () => Promise<void>, mensaje: string) {
    setError(null); setExito(null)
    try { await fn(); setExito(mensaje); await cargar() }
    catch (e: any) { setError(e.message) }
  }

  if (cargando) return <Cargando />

  return (
    <>
      <Cabecera
        titulo="Categorías de gasto"
        bajada="Son las opciones que ve la gente al pedir caja chica, y la base de los reportes por tipo de gasto."
      />
      <AvisoError mensaje={error} />
      <Exito mensaje={exito} />

      <div className="cc-card" style={{ maxWidth: 560 }}>
        <h2>Agregar categoría</h2>
        <div className="cc-campo">
          <label>Nombre</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ejemplo: Insumos de laboratorio" />
        </div>
        <button className="cc-btn cc-btn-p" disabled={!nombre.trim()}
          onClick={() => accion(async () => {
            await crearCategoria(nombre, (categorias.length ? categorias[categorias.length - 1].orden : 100) + 10)
            setNombre('')
          }, 'Categoría agregada.')}>
          Agregar
        </button>
      </div>

      <div className="cc-card">
        <h2>Categorías existentes</h2>
        {!categorias.length ? <Vacio texto="No hay categorías cargadas." /> : (
          <div className="cc-scroll">
            <table className="cc-tabla">
              <thead>
                <tr><th>Nombre</th><th className="num">Vales</th><th className="num">Monto acumulado</th><th>Estado</th><th /></tr>
              </thead>
              <tbody>
                {categorias.map((c) => {
                  const u = uso(c.nombre)
                  return (
                    <tr key={c.id}>
                      <td>{c.nombre}</td>
                      <td className="num">{u.vales}</td>
                      <td className="num">{bs(u.monto)}</td>
                      <td>
                        <span className={`cc-chip ${c.activa ? 'cc-ok' : 'cc-mal'}`}>
                          {c.activa ? 'Disponible' : 'Retirada'}
                        </span>
                      </td>
                      <td>
                        <button className={`cc-btn cc-btn-x ${c.activa ? 'cc-btn-r' : ''}`}
                          onClick={() => accion(
                            () => actualizarCategoria(c.id, { activa: !c.activa }),
                            c.activa ? 'Categoría retirada.' : 'Categoría disponible otra vez.'
                          )}>
                          {c.activa ? 'Retirar' : 'Reactivar'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="cc-tenue" style={{ fontSize: 13 }}>
          Retirar una categoría la saca del formulario, pero no toca los vales que ya la usaron: siguen
          contando en los reportes con el nombre que tenían. Por eso no se borran.
        </p>
      </div>
    </>
  )
}
