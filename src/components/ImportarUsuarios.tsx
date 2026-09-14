import { useState } from 'react'
import {
  actualizarPerfil, asegurarOficina, asignarCoordinador, cambiarRol, obtenerPerfilPorEmail
} from '../lib/api'
import { crearClienteAltas } from '../lib/supabase'
import {
  descargarPlantilla, descargarResultados, leerExcel,
  type FilaImport, type ResultadoImport
} from '../lib/importar'
import { ETIQUETA_ROL } from '../types/database'

const PAUSA_MS = 600 // Supabase limita los registros por minuto; sin pausa corta el lote

export function ImportarUsuarios({ alTerminar }: { alTerminar: () => void }) {
  const [filas, setFilas] = useState<FilaImport[]>([])
  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null)
  const [resultados, setResultados] = useState<ResultadoImport[]>([])
  const [progreso, setProgreso] = useState(0)
  const [importando, setImportando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const validas = filas.filter((f) => f.errores.length === 0)
  const conError = filas.filter((f) => f.errores.length > 0)

  async function elegirArchivo(archivo: File | null) {
    setError(null); setResultados([]); setFilas([]); setNombreArchivo(null)
    if (!archivo) return
    try {
      const leidas = await leerExcel(archivo)
      if (!leidas.length) {
        setError('El archivo no tiene filas. Revisa que los datos estén en la primera hoja.')
        return
      }
      setFilas(leidas)
      setNombreArchivo(archivo.name)
    } catch (e: any) {
      setError('No se pudo leer el archivo. ¿Es un .xlsx o .csv válido?')
    }
  }

  async function importar() {
    setImportando(true); setError(null); setProgreso(0)
    const salida: ResultadoImport[] = []
    // Un solo cliente sin sesión persistente para todas las altas: así la
    // sesión del administrador no se pierde a mitad del lote.
    const clienteAltas = crearClienteAltas()

    // Primero las oficinas: se crean una sola vez y se reutilizan.
    const oficinas = new Map<string, string>()
    try {
      for (const nombre of new Set(validas.map((f) => f.oficina).filter(Boolean))) {
        oficinas.set(nombre, await asegurarOficina(nombre))
      }
    } catch (e: any) {
      setError(`No se pudieron crear las oficinas: ${e.message}`)
      setImportando(false)
      return
    }

    const coordinadores: { oficina: string; email: string }[] = []

    for (let i = 0; i < validas.length; i++) {
      const f = validas[i]
      try {
        const { data, error: eAlta } = await clienteAltas.auth.signUp({
          email: f.email,
          password: f.password,
          options: { data: { full_name: f.nombre, departamento: f.departamento, telefono: f.telefono } }
        })

        if (eAlta) {
          const yaExiste = /already registered|already been registered/i.test(eAlta.message)
          let detalle = yaExiste ? 'Ya tenía cuenta; no se tocó rol ni contraseña' : eAlta.message

          // La cuenta no se toca, pero sí se actualiza dónde trabaja: es lo que
          // define quién avala sus solicitudes.
          if (yaExiste && f.oficina) {
            const existente = await obtenerPerfilPorEmail(f.email)
            if (existente) {
              await actualizarPerfil(existente.id, {
                oficina_id: oficinas.get(f.oficina) ?? null,
                cargo: f.cargo || null
              })
              if (f.esCoordinador) coordinadores.push({ oficina: f.oficina, email: f.email })
              detalle += `; oficina actualizada a ${f.oficina}`
            }
          }

          salida.push({
            fila: f.fila, email: f.email, password: f.password,
            estado: yaExiste ? 'ya_existia' : 'error', detalle
          })
        } else if (data.user) {
          if (f.rol !== 'solicitante') await cambiarRol(data.user.id, f.rol)
          await actualizarPerfil(data.user.id, {
            oficina_id: oficinas.get(f.oficina) ?? null,
            cargo: f.cargo || null,
            ...(f.telefono ? { whatsapp_optin: true } : {})
          })
          if (f.esCoordinador) coordinadores.push({ oficina: f.oficina, email: f.email })
          salida.push({
            fila: f.fila, email: f.email, password: f.password,
            estado: 'creado',
            detalle: [ETIQUETA_ROL[f.rol], f.oficina, f.cargo].filter(Boolean).join(' · ')
          })
        } else {
          salida.push({
            fila: f.fila, email: f.email, password: f.password,
            estado: 'ya_existia',
            detalle: 'El correo ya estaba registrado o quedó pendiente de confirmación'
          })
        }
      } catch (e: any) {
        salida.push({
          fila: f.fila, email: f.email, password: f.password,
          estado: 'error', detalle: e.message ?? 'Error desconocido'
        })
      }

      setProgreso(i + 1)
      setResultados([...salida])
      if (i < validas.length - 1) await new Promise((r) => setTimeout(r, PAUSA_MS))
    }

    // Los coordinadores se asignan al final: la oficina ya existe y la persona
    // ya tiene perfil, sea recién creada o de antes.
    for (const c of coordinadores) {
      const oficinaId = oficinas.get(c.oficina)
      if (!oficinaId) continue
      try {
        const perfil = await obtenerPerfilPorEmail(c.email)
        if (perfil) await asignarCoordinador(oficinaId, perfil.id)
      } catch (e: any) {
        salida.push({
          fila: 0, email: c.email, password: '', estado: 'error',
          detalle: `No se pudo asignar como coordinador de ${c.oficina}: ${e.message}`
        })
      }
    }
    setResultados([...salida])

    setImportando(false)
    alTerminar()
  }

  const creados = resultados.filter((r) => r.estado === 'creado').length
  const fallidos = resultados.filter((r) => r.estado === 'error').length
  const existentes = resultados.filter((r) => r.estado === 'ya_existia').length

  return (
    <div className="cc-card">
      <h2>Carga masiva desde Excel</h2>

      {error && <div className="cc-aviso cc-av-mal">{error}</div>}

      <p className="cc-tenue" style={{ marginTop: 0 }}>
        Descarga la plantilla, llénala con una fila por persona y súbela. La columna de contraseña puede
        quedar vacía: el sistema genera una y te la entrega al final para que la repartas.
      </p>

      <div className="cc-acc" style={{ marginBottom: 16 }}>
        <button className="cc-btn" onClick={descargarPlantilla}>Descargar plantilla</button>
      </div>

      <div className="cc-campo">
        <label>Archivo de usuarios (.xlsx o .csv)</label>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          disabled={importando}
          onChange={(e) => elegirArchivo(e.target.files?.[0] ?? null)}
        />
      </div>

      {nombreArchivo && !resultados.length && (
        <>
          <div className={`cc-aviso ${conError.length ? 'cc-av-oro' : 'cc-av-ok'}`}>
            {nombreArchivo}: {validas.length} fila(s) listas para cargar
            {conError.length > 0 && `, ${conError.length} con problemas que se van a omitir`}.
          </div>

          <div className="cc-scroll">
            <table className="cc-tabla">
              <thead>
                <tr><th>Fila</th><th>Nombre</th><th>Correo</th><th>Oficina</th><th>Cargo</th><th>Rol</th><th>Revisión</th></tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.fila}>
                    <td className="cc-mono">{f.fila}</td>
                    <td>{f.nombre || <span className="cc-tenue">—</span>}</td>
                    <td className="cc-mono">{f.email || '—'}</td>
                    <td>{f.oficina || <span className="cc-tenue">—</span>}</td>
                    <td>
                      {f.esCoordinador
                        ? <span className="cc-chip cc-curso">Coordinador</span>
                        : <span className="cc-tenue">{f.cargo || '—'}</span>}
                    </td>
                    <td>{ETIQUETA_ROL[f.rol]}</td>
                    <td>
                      {f.errores.length
                        ? <span className="cc-chip cc-mal">{f.errores.join('. ')}</span>
                        : <span className="cc-chip cc-ok">Lista</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="cc-acc" style={{ marginTop: 16 }}>
            <button className="cc-btn cc-btn-p" disabled={!validas.length || importando} onClick={importar}>
              {importando
                ? `Creando ${progreso} de ${validas.length}…`
                : `Crear ${validas.length} usuario(s)`}
            </button>
            <span className="cc-tenue">
              Tarda alrededor de {Math.ceil((validas.length * PAUSA_MS) / 1000)} segundos. No cierres la pestaña.
            </span>
          </div>
        </>
      )}

      {resultados.length > 0 && (
        <>
          <div className={`cc-aviso ${fallidos ? 'cc-av-oro' : 'cc-av-ok'}`}>
            {creados} creado(s){existentes > 0 && `, ${existentes} ya existía(n)`}
            {fallidos > 0 && `, ${fallidos} con error`}.
          </div>

          <div className="cc-acc" style={{ marginBottom: 16 }}>
            <button className="cc-btn cc-btn-ok" onClick={() => descargarResultados(resultados)}>
              Descargar resultados con las contraseñas
            </button>
          </div>

          <p className="cc-tenue" style={{ marginTop: 0 }}>
            Las contraseñas generadas solo aparecen aquí y en ese archivo. Descárgalo antes de salir de la
            pantalla, entrégalo a cada persona y luego bórralo.
          </p>

          <div className="cc-scroll">
            <table className="cc-tabla">
              <thead>
                <tr><th>Fila</th><th>Correo</th><th>Contraseña</th><th>Estado</th><th>Detalle</th></tr>
              </thead>
              <tbody>
                {resultados.map((r) => (
                  <tr key={r.fila}>
                    <td className="cc-mono">{r.fila}</td>
                    <td className="cc-mono">{r.email}</td>
                    <td className="cc-mono">{r.estado === 'creado' ? r.password : '—'}</td>
                    <td>
                      <span className={`cc-chip ${r.estado === 'creado' ? 'cc-ok' : r.estado === 'ya_existia' ? 'cc-espera' : 'cc-mal'}`}>
                        {r.estado === 'creado' ? 'Creado' : r.estado === 'ya_existia' ? 'Ya existía' : 'Error'}
                      </span>
                    </td>
                    <td className="cc-tenue">{r.detalle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
