import readXlsxFile from 'read-excel-file/browser'
import writeXlsxFile, { getSheetData } from 'write-excel-file/browser'
import type { Rol } from '../types/database'
import { ETIQUETA_ROL } from '../types/database'

export interface FilaImport {
  fila: number
  nombre: string
  email: string
  departamento: string
  telefono: string
  rol: Rol
  oficina: string
  cargo: string
  esCoordinador: boolean
  password: string
  generada: boolean
  errores: string[]
}

export interface ResultadoImport {
  fila: number
  email: string
  password: string
  estado: 'creado' | 'ya_existia' | 'error'
  detalle: string
}

const ROLES_VALIDOS: Rol[] = ['solicitante', 'daf', 'admin_caja', 'contabilidad', 'super_admin']

/** Acepta el nombre del rol en español o la clave interna. */
const ALIAS_ROL: Record<string, Rol> = {
  solicitante: 'solicitante',
  daf: 'daf',
  admin_caja: 'admin_caja',
  'administrador de caja': 'admin_caja',
  'admin caja': 'admin_caja',
  contabilidad: 'contabilidad',
  super_admin: 'super_admin',
  'administrador general': 'super_admin'
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RE_TELEFONO = /^\+\d{8,15}$/

/** Contraseña inicial legible: dos sílabas y cuatro dígitos. */
function generarPassword(): string {
  const silabas = ['ka', 'mi', 'to', 'ru', 'pe', 'la', 'so', 'ne', 'vi', 'da']
  const a = silabas[Math.floor(Math.random() * silabas.length)]
  const b = silabas[Math.floor(Math.random() * silabas.length)]
  const n = Math.floor(1000 + Math.random() * 9000)
  return `${a}${b}${n}`
}

function limpiar(v: unknown): string {
  return String(v ?? '').trim()
}

/** Busca una columna por varios nombres posibles, sin distinguir mayúsculas ni tildes. */
function columna(fila: Record<string, unknown>, ...nombres: string[]): string {
  const normalizar = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  const claves = Object.keys(fila)
  for (const nombre of nombres) {
    const clave = claves.find((k) => normalizar(k) === normalizar(nombre))
    if (clave) return limpiar(fila[clave])
  }
  return ''
}

export async function leerExcel(archivo: File): Promise<FilaImport[]> {
  const leido = (await readXlsxFile(archivo)) as unknown
  // Según la versión, la librería devuelve las filas directamente o una lista
  // de hojas con la forma { sheet, data }. Se aceptan las dos.
  const lista = leido as any[]
  const filas: unknown[][] =
    Array.isArray(lista) && lista.length > 0 && Array.isArray(lista[0]?.data)
      ? lista[0].data
      : (lista as unknown[][])

  if (!Array.isArray(filas) || filas.length < 2) return []

  const encabezados = (filas[0] as unknown[]).map((h) => limpiar(h))
  const vistos = new Set<string>()

  return filas.slice(1)
    .filter((f) => f.some((c) => limpiar(c) !== ''))
    .map((cruda, i) => {
      const obj: Record<string, unknown> = {}
      encabezados.forEach((h, j) => { if (h) obj[h] = cruda[j] })

      const nombre = columna(obj, 'nombre', 'nombre completo')
      const email = columna(obj, 'email', 'correo', 'correo electronico').toLowerCase()
      const departamento = columna(obj, 'departamento', 'unidad')
      const telefono = columna(obj, 'telefono', 'whatsapp', 'celular')
      const rolTexto = columna(obj, 'rol', 'perfil').toLowerCase()
      const passwordTexto = columna(obj, 'contrasena', 'contraseña', 'password', 'clave')
      const oficina = columna(obj, 'oficina', 'unidad organizacional').toUpperCase()
      const cargo = columna(obj, 'cargo', 'puesto').toUpperCase()
      const esCoordinador = /COORDINADOR/.test(cargo)

      const errores: string[] = []

      if (!nombre) errores.push('Falta el nombre')
      if (!email) errores.push('Falta el correo')
      else if (!RE_EMAIL.test(email)) errores.push('El correo no tiene un formato válido')
      else if (vistos.has(email)) errores.push('El correo está repetido en el archivo')
      vistos.add(email)

      let rol: Rol = 'solicitante'
      if (rolTexto) {
        const encontrado = ALIAS_ROL[rolTexto]
        if (!encontrado) errores.push(`Rol desconocido: ${rolTexto}`)
        else rol = encontrado
      }

      if (telefono && !RE_TELEFONO.test(telefono)) {
        errores.push('El teléfono debe ir con código de país, por ejemplo +59171234567')
      }

      let password = passwordTexto
      let generada = false
      if (!password) {
        password = generarPassword()
        generada = true
      } else if (password.length < 6) {
        errores.push('La contraseña debe tener al menos 6 caracteres')
      }

      if (esCoordinador && !oficina) errores.push('Un coordinador necesita oficina')

      return {
        fila: i + 2, // +2: la fila 1 son los encabezados
        nombre, email, departamento, telefono, rol,
        oficina, cargo, esCoordinador, password, generada, errores
      }
    })
}

/** Fila de encabezado en negrita, igual en las dos hojas. */
const CABECERA = { fontWeight: 'bold' as const, backgroundColor: '#f8f9fa' }

/** Descarga la plantilla con los encabezados esperados y dos filas de ejemplo. */
export async function descargarPlantilla() {
  const ejemplos = [
    { nombre: 'Lucía Ávila', email: 'lucia.avila@ucb.edu.bo', departamento: 'ASISTENTE EMPRESAS',
      telefono: '+59171234567', rol: 'solicitante', contrasena: '', oficina: 'EMPRESAS', cargo: 'ASISTENTE' },
    { nombre: 'José Fernández', email: 'jfernandez@ucb.edu.bo', departamento: 'COORDINADOR EMPRESAS',
      telefono: '+59176543210', rol: 'solicitante', contrasena: '', oficina: 'EMPRESAS', cargo: 'COORDINADOR' }
  ]

  const columnasUsuarios = [
    { header: { value: 'nombre', ...CABECERA }, width: 26, cell: (o: any) => ({ value: o.nombre, type: String }) },
    { header: { value: 'email', ...CABECERA }, width: 32, cell: (o: any) => ({ value: o.email, type: String }) },
    { header: { value: 'departamento', ...CABECERA }, width: 30, cell: (o: any) => ({ value: o.departamento, type: String }) },
    { header: { value: 'telefono', ...CABECERA }, width: 18, cell: (o: any) => ({ value: o.telefono, type: String }) },
    { header: { value: 'rol', ...CABECERA }, width: 16, cell: (o: any) => ({ value: o.rol, type: String }) },
    { header: { value: 'contrasena', ...CABECERA }, width: 18, cell: (o: any) => ({ value: o.contrasena, type: String }) },
    { header: { value: 'oficina', ...CABECERA }, width: 18, cell: (o: any) => ({ value: o.oficina, type: String }) },
    { header: { value: 'cargo', ...CABECERA }, width: 18, cell: (o: any) => ({ value: o.cargo, type: String }) }
  ]

  const instrucciones = [
    { campo: 'nombre', ayuda: 'Obligatorio. Nombre y apellido.' },
    { campo: 'email', ayuda: 'Obligatorio. Correo institucional, único por persona.' },
    { campo: 'departamento', ayuda: 'Opcional.' },
    { campo: 'telefono', ayuda: 'Opcional. Con código de país: +59171234567. Sin él, los avisos llegan solo por correo.' },
    { campo: 'rol', ayuda: `Uno de: ${ROLES_VALIDOS.join(', ')}. Vacío equivale a solicitante.` },
    { campo: 'contrasena', ayuda: 'Opcional. Vacía: el sistema genera una y la muestra al terminar.' },
    { campo: 'oficina', ayuda: 'Unidad a la que pertenece: EMPRESAS, DAF, UTSI… Define quién debe avalar sus solicitudes.' },
    { campo: 'cargo', ayuda: 'ASISTENTE o COORDINADOR. Quien diga COORDINADOR queda como responsable de avalar en su oficina.' },
    { campo: '—', ayuda: 'No cambies los nombres de los encabezados de la primera hoja.' }
  ]

  const columnasAyuda = [
    { header: { value: 'campo', ...CABECERA }, width: 16, cell: (o: any) => ({ value: o.campo, type: String }) },
    { header: { value: 'cómo llenarlo', ...CABECERA }, width: 80, cell: (o: any) => ({ value: o.ayuda, type: String }) }
  ]

  await writeXlsxFile(
    [
      { data: getSheetData(ejemplos, columnasUsuarios), sheet: 'Usuarios', columns: columnasUsuarios.map((c) => ({ width: c.width })) },
      { data: getSheetData(instrucciones, columnasAyuda), sheet: 'Instrucciones', columns: columnasAyuda.map((c) => ({ width: c.width })) }
    ]
  ).toFile('plantilla-usuarios-caja-chica.xlsx')
}

/** Exporta el resultado, con las contraseñas generadas, para poder repartirlas. */
export async function descargarResultados(resultados: ResultadoImport[]) {
  const columnas = [
    { header: { value: 'fila', ...CABECERA }, width: 8, cell: (r: ResultadoImport) => ({ value: r.fila, type: Number }) },
    { header: { value: 'email', ...CABECERA }, width: 32, cell: (r: ResultadoImport) => ({ value: r.email, type: String }) },
    { header: { value: 'contraseña inicial', ...CABECERA }, width: 20,
      cell: (r: ResultadoImport) => ({ value: r.estado === 'creado' ? r.password : '', type: String }) },
    { header: { value: 'estado', ...CABECERA }, width: 14,
      cell: (r: ResultadoImport) => ({
        value: r.estado === 'creado' ? 'Creado' : r.estado === 'ya_existia' ? 'Ya existía' : 'Error',
        type: String
      }) },
    { header: { value: 'detalle', ...CABECERA }, width: 50, cell: (r: ResultadoImport) => ({ value: r.detalle, type: String }) }
  ]

  await writeXlsxFile(getSheetData(resultados, columnas), {
    sheet: 'Resultado',
    columns: columnas.map((c) => ({ width: c.width }))
  }).toFile(`usuarios-creados-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

export { ETIQUETA_ROL }
