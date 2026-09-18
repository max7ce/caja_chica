import writeXlsxFile, { getSheetData } from 'write-excel-file/browser'
import type { Factura, InformeRendicion, Solicitud } from '../types/database'

const CABECERA = { fontWeight: 'bold' as const, backgroundColor: '#f8f9fa' }
const fecha = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

/**
 * Informe de rendición en Excel, para adjuntar a la solicitud de reposición.
 *
 * Dos hojas: el resumen que se firma y el detalle de cada vale. Los montos
 * van como números, no como texto, para que contabilidad pueda sumarlos y
 * verificarlos sin retipearlos.
 */
export async function exportarInforme(
  informe: InformeRendicion,
  solicitudes: Solicitud[],
  adminNombre: string
) {
  const noDevuelto = (s: Solicitud) =>
    s.monto_real == null ? 0 : Number(s.monto_solicitado) - Number(s.monto_real)

  const resumen = [
    { campo: 'Informe de rendición de cuentas', valor: '' },
    { campo: 'Universidad Católica Boliviana "San Pablo" — Sede Tarija', valor: '' },
    { campo: '', valor: '' },
    { campo: 'Administrador de caja', valor: adminNombre },
    { campo: 'Fecha del informe', valor: fecha(informe.fecha_creacion) },
    { campo: 'Período rendido', valor: `${fecha(informe.fecha_inicio_periodo)} al ${fecha(informe.fecha_fin_periodo)}` },
    { campo: 'Solicitudes incluidas', valor: String(solicitudes.length) },
    { campo: '', valor: '' },
    { campo: 'Total desembolsado (Bs)', valor: Number(informe.total_desembolsado).toFixed(2) },
    { campo: 'Total devuelto (Bs)', valor: Number(informe.total_devuelto).toFixed(2) },
    { campo: 'Gasto neto del período (Bs)',
      valor: (Number(informe.total_desembolsado) - Number(informe.total_devuelto)).toFixed(2) },
    { campo: 'Saldo al cierre (Bs)', valor: Number(informe.saldo_cuenta).toFixed(2) },
    { campo: 'Reposición solicitada (Bs)', valor: Number(informe.monto_reposicion).toFixed(2) },
    { campo: '', valor: '' },
    { campo: 'Aprobado por el DAF', valor: fecha(informe.fecha_aprobacion_daf) },
    { campo: 'Observaciones', valor: informe.observaciones ?? '' },
    { campo: '', valor: '' },
    { campo: '', valor: '' },
    { campo: '_______________________', valor: '_______________________' },
    { campo: 'Administrador de caja', valor: 'Contabilidad' }
  ]

  const colsResumen = [
    { header: { value: 'Concepto', ...CABECERA }, width: 38,
      cell: (o: any) => ({ value: o.campo, type: String }) },
    { header: { value: 'Detalle', ...CABECERA }, width: 46,
      cell: (o: any) => ({ value: o.valor, type: String }) }
  ]

  const colsDetalle = [
    { header: { value: 'Nº', ...CABECERA }, width: 12,
      cell: (s: Solicitud) => ({ value: s.id.slice(0, 8), type: String }) },
    { header: { value: 'Fecha', ...CABECERA }, width: 12,
      cell: (s: Solicitud) => ({ value: fecha(s.fecha_desembolso ?? s.fecha_creacion), type: String }) },
    { header: { value: 'Solicitante', ...CABECERA }, width: 34,
      cell: (s: Solicitud) => ({ value: s.solicitante?.full_name ?? '—', type: String }) },
    { header: { value: 'Oficina', ...CABECERA }, width: 20,
      cell: (s: Solicitud) => ({ value: s.solicitante?.departamento ?? '—', type: String }) },
    { header: { value: 'Categoría', ...CABECERA }, width: 18,
      cell: (s: Solicitud) => ({ value: s.categoria ?? '—', type: String }) },
    { header: { value: 'Detalle del gasto', ...CABECERA }, width: 46,
      cell: (s: Solicitud) => ({ value: s.descripcion, type: String }) },
    { header: { value: 'Desembolsado', ...CABECERA }, width: 15,
      cell: (s: Solicitud) => ({ value: Number(s.monto_solicitado), type: Number, format: '#,##0.00' }) },
    { header: { value: 'Gastado', ...CABECERA }, width: 15,
      cell: (s: Solicitud) => ({ value: Number(s.monto_real ?? 0), type: Number, format: '#,##0.00' }) },
    { header: { value: 'Devuelto', ...CABECERA }, width: 15,
      cell: (s: Solicitud) => ({ value: noDevuelto(s), type: Number, format: '#,##0.00' }) }
  ]

  await writeXlsxFile([
    {
      data: getSheetData(resumen, colsResumen),
      sheet: 'Resumen',
      columns: colsResumen.map((c) => ({ width: c.width }))
    },
    {
      data: getSheetData(solicitudes, colsDetalle),
      sheet: 'Detalle',
      columns: colsDetalle.map((c) => ({ width: c.width }))
    }
  ]).toFile(`rendicion-${fecha(informe.fecha_creacion).replace(/\//g, '-')}.xlsx`)
}

/** Listado de informes, para ver la historia de reposiciones de un vistazo. */
export async function exportarInformes(informes: InformeRendicion[], nombrePorId: Map<string, string>) {
  const cols = [
    { header: { value: 'Fecha', ...CABECERA }, width: 14,
      cell: (i: InformeRendicion) => ({ value: fecha(i.fecha_creacion), type: String }) },
    { header: { value: 'Administrador', ...CABECERA }, width: 34,
      cell: (i: InformeRendicion) => ({ value: nombrePorId.get(i.admin_caja_id) ?? '—', type: String }) },
    { header: { value: 'Desde', ...CABECERA }, width: 13,
      cell: (i: InformeRendicion) => ({ value: fecha(i.fecha_inicio_periodo), type: String }) },
    { header: { value: 'Hasta', ...CABECERA }, width: 13,
      cell: (i: InformeRendicion) => ({ value: fecha(i.fecha_fin_periodo), type: String }) },
    { header: { value: 'Desembolsado', ...CABECERA }, width: 15,
      cell: (i: InformeRendicion) => ({ value: Number(i.total_desembolsado), type: Number, format: '#,##0.00' }) },
    { header: { value: 'Devuelto', ...CABECERA }, width: 15,
      cell: (i: InformeRendicion) => ({ value: Number(i.total_devuelto), type: Number, format: '#,##0.00' }) },
    { header: { value: 'Reposición', ...CABECERA }, width: 15,
      cell: (i: InformeRendicion) => ({ value: Number(i.monto_reposicion), type: Number, format: '#,##0.00' }) },
    { header: { value: 'Aprobado DAF', ...CABECERA }, width: 14,
      cell: (i: InformeRendicion) => ({ value: fecha(i.fecha_aprobacion_daf), type: String }) },
    { header: { value: 'Estado', ...CABECERA }, width: 22,
      cell: (i: InformeRendicion) => ({ value: i.estado, type: String }) }
  ]

  await writeXlsxFile(getSheetData(informes, cols), {
    sheet: 'Rendiciones',
    columns: cols.map((c) => ({ width: c.width }))
  }).toFile(`rendiciones-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

const NIT_UCB = '1020141023'

/**
 * Planilla de datos fiscales para cargar en el sistema de contabilidad.
 *
 * Una fila por factura, con las columnas en el orden en que se tipean.
 * Los montos van como números y los códigos como texto: un CUF de 56
 * caracteres o un NIT que empiece en cero se corrompen si Excel los
 * interpreta como número.
 */
export async function exportarDatosFiscales(
  facturas: Factura[],
  solicitudes: Solicitud[],
  etiquetaInforme: string
) {
  const porSolicitud = new Map(solicitudes.map((s) => [s.id, s]))

  const revisar = (f: Factura) => {
    const fallas: string[] = []
    if (!f.nit_vendedor) fallas.push('sin NIT del vendedor')
    if (!f.nro_factura) fallas.push('sin número')
    if (!f.autorizacion) fallas.push('sin código de autorización')
    if (!f.fecha_emision) fallas.push('sin fecha')
    if (f.nit_vendedor === NIT_UCB) fallas.push('el NIT cargado es el de la UCB')
    if (f.emitida_a_ucb === false) fallas.push('no está emitida a la UCB')
    return fallas.length ? fallas.join(' · ') : 'Completa'
  }

  const cols = [
    { header: { value: 'NIT vendedor', ...CABECERA }, width: 16,
      cell: (f: Factura) => ({ value: f.nit_vendedor ?? '', type: String }) },
    { header: { value: 'Razón social', ...CABECERA }, width: 34,
      cell: (f: Factura) => ({ value: f.razon_social ?? '', type: String }) },
    { header: { value: 'Nº factura', ...CABECERA }, width: 14,
      cell: (f: Factura) => ({ value: f.nro_factura ?? '', type: String }) },
    { header: { value: 'Fecha', ...CABECERA }, width: 12,
      cell: (f: Factura) => ({ value: fecha(f.fecha_emision), type: String }) },
    { header: { value: 'Monto Bs', ...CABECERA }, width: 14,
      cell: (f: Factura) => ({ value: Number(f.monto), type: Number, format: '#,##0.00' }) },
    { header: { value: 'Código de autorización', ...CABECERA }, width: 60,
      cell: (f: Factura) => ({ value: f.autorizacion ?? '', type: String }) },
    { header: { value: 'Solicitud', ...CABECERA }, width: 34,
      cell: (f: Factura) => ({ value: porSolicitud.get(f.solicitud_id)?.descripcion ?? '', type: String }) },
    { header: { value: 'Solicitante', ...CABECERA }, width: 30,
      cell: (f: Factura) => ({
        value: porSolicitud.get(f.solicitud_id)?.solicitante?.full_name ?? '', type: String }) },
    { header: { value: 'Origen', ...CABECERA }, width: 10,
      cell: (f: Factura) => ({ value: f.origen === 'qr' ? 'QR' : 'manual', type: String }) },
    { header: { value: 'Revisión', ...CABECERA }, width: 40,
      cell: (f: Factura) => ({ value: revisar(f), type: String }) }
  ]

  await writeXlsxFile(getSheetData(facturas, cols), {
    sheet: 'Datos fiscales',
    columns: cols.map((c) => ({ width: c.width }))
  }).toFile(`datos-fiscales-${etiquetaInforme}.xlsx`)
}
