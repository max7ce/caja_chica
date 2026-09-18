import { useEffect, useRef, useState } from 'react'
import { adjuntarFactura, borrarFactura, guardarFactura, listarFacturas } from '../lib/api'
import { leerFacturaPdf } from '../lib/facturaPdf'
import { useAuth } from '../hooks/useAuth'
import { interpretarQR, leerQRdeImagen, leerQRdeVideo, type DatosFactura } from '../lib/factura'
import { bs, fechaHora } from '../lib/formato'
import { Error as AvisoError, Vacio } from './Ui'
import type { Factura } from '../types/database'

const vacia = {
  nitVendedor: '', razonSocial: '', nroFactura: '', autorizacion: '',
  fechaEmision: '', monto: '', crudo: '', clienteNit: '', clienteNombre: '',
  origen: 'manual' as 'manual' | 'qr' | 'pdf'
}

/**
 * Registro de las facturas de una solicitud, con lectura del QR fiscal.
 *
 * El QR del SIAT trae el NIT del vendedor, el número, el código de
 * autorización y —dentro del propio código— la fecha y hora exactas. Lo único
 * que no trae es el monto, así que ese se escribe.
 */
export function FacturasDeSolicitud({
  solicitudId, editable, onCambio
}: {
  solicitudId: string
  editable: boolean
  onCambio?: () => void
}) {
  const { perfil, parametros } = useAuth()
  const nitInstitucion = parametros?.nit_institucion ?? '1020141023'

  const [facturas, setFacturas] = useState<Factura[]>([])
  const [pdf, setPdf] = useState<File | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [form, setForm] = useState({ ...vacia })
  const [error, setError] = useState<string | null>(null)
  const [escaneando, setEscaneando] = useState(false)
  const [trabajando, setTrabajando] = useState(false)

  const video = useRef<HTMLVideoElement>(null)
  const lienzo = useRef<HTMLCanvasElement>(null)
  const flujo = useRef<MediaStream | null>(null)

  async function cargar() {
    try { setFacturas(await listarFacturas(solicitudId)) }
    catch (e: any) { setError(e.message) }
  }
  useEffect(() => { cargar() }, [solicitudId])

  // La cámara se apaga siempre al salir: dejarla encendida es una fuga fácil
  // de cometer y molesta de descubrir.
  useEffect(() => () => detenerCamara(), [])

  function detenerCamara() {
    flujo.current?.getTracks().forEach((t) => t.stop())
    flujo.current = null
    setEscaneando(false)
  }

  function aplicar(d: DatosFactura) {
    setForm((f) => ({
      ...f,
      nitVendedor: d.nitVendedor || f.nitVendedor,
      nroFactura: d.nroFactura || f.nroFactura,
      autorizacion: d.autorizacion || f.autorizacion,
      fechaEmision: d.fechaEmision ? d.fechaEmision.slice(0, 16) : f.fechaEmision,
      crudo: d.crudo,
      origen: 'qr'
    }))
  }

  async function abrirCamara() {
    setError(null)
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      })
      flujo.current = media
      setEscaneando(true)
      setTimeout(() => {
        if (video.current) {
          video.current.srcObject = media
          video.current.play()
          buscar()
        }
      }, 50)
    } catch {
      setError('No se pudo abrir la cámara. Puedes subir una foto del QR o escribir los datos a mano.')
    }
  }

  function buscar() {
    if (!flujo.current || !video.current || !lienzo.current) return
    const d = leerQRdeVideo(video.current, lienzo.current)
    if (d) {
      aplicar(d)
      detenerCamara()
      return
    }
    requestAnimationFrame(buscar)
  }

  /**
   * Camino principal: el PDF descargado del portal de Impuestos trae el texto
   * seleccionable, así que salen los seis datos sin escribir ninguno, incluido
   * el monto, que el QR no incluye.
   */
  async function desdePdf(archivo: File | null) {
    if (!archivo) return
    setError(null); setLeyendo(true)
    try {
      const d = await leerFacturaPdf(archivo)
      if (!d.nitVendedor && !d.autorizacion) {
        setError('No se reconoció el formato de esa factura. Puedes escanear su QR o escribir los datos.')
        return
      }
      setPdf(archivo)
      setForm({
        nitVendedor: d.nitVendedor,
        razonSocial: d.razonSocial,
        nroFactura: d.nroFactura,
        autorizacion: d.autorizacion,
        fechaEmision: d.fechaEmision ? d.fechaEmision.slice(0, 16) : '',
        monto: d.monto != null ? String(d.monto) : '',
        crudo: '',
        clienteNit: d.clienteNit,
        clienteNombre: d.clienteNombre,
        origen: 'pdf'
      })
    } catch {
      setError('No se pudo leer ese PDF.')
    } finally { setLeyendo(false) }
  }

  async function desdeArchivo(archivo: File | null) {
    if (!archivo) return
    setError(null)
    const d = await leerQRdeImagen(archivo)
    if (d) aplicar(d)
    else setError('No se encontró un QR legible en esa imagen. Acerca la cámara al código o escribe los datos a mano.')
  }

  async function guardar() {
    setError(null)
    const monto = Number(form.monto)
    if (!monto || monto <= 0) return setError('Falta el monto de la factura.')
    if (!form.nitVendedor && !form.autorizacion) {
      return setError('Escanea el QR o escribe al menos el NIT del vendedor.')
    }

    setTrabajando(true)
    try {
      let comprobanteId: string | null = null
      if (pdf) comprobanteId = (await adjuntarFactura(pdf, solicitudId, perfil!.id)).id

      await guardarFactura({
        solicitud_id: solicitudId,
        comprobante_id: comprobanteId,
        emitida_a_ucb: form.clienteNit ? form.clienteNit === nitInstitucion : null,
        nit_vendedor: form.nitVendedor || null,
        razon_social: form.razonSocial || null,
        nro_factura: form.nroFactura || null,
        autorizacion: form.autorizacion || null,
        fecha_emision: form.fechaEmision ? new Date(form.fechaEmision).toISOString() : null,
        monto,
        qr_crudo: form.crudo || null,
        origen: form.origen
      })
      setForm({ ...vacia })
      setPdf(null)
      await cargar()
      onCambio?.()
    } catch (e: any) {
      setError(/idx_factura_unica|duplicate key/.test(e.message)
        ? 'Esa factura ya fue registrada en otra solicitud.'
        : e.message)
    } finally { setTrabajando(false) }
  }

  const total = facturas.reduce((a, f) => a + Number(f.monto), 0)

  return (
    <div className="cc-card">
      <h2>Facturas de esta compra</h2>
      <p className="cc-tenue" style={{ marginTop: 0 }}>
        Lo más rápido es descargar la factura en PDF desde el portal de Impuestos y subirla acá: de ahí
        salen los seis datos sin escribir ninguno. Si solo tienes el papel, escanea su código QR; en ese
        caso habrá que escribir el monto, que el QR no incluye.
      </p>

      <AvisoError mensaje={error} />

      {facturas.length > 0 && (
        <div className="cc-scroll" style={{ marginBottom: 18 }}>
          <table className="cc-tabla">
            <thead>
              <tr>
                <th>NIT vendedor</th><th>Nº factura</th><th>Fecha</th>
                <th className="num">Monto</th><th>Autorización</th><th>Origen</th>{editable && <th />}
              </tr>
            </thead>
            <tbody>
              {facturas.map((f) => (
                <tr key={f.id}>
                  <td className="cc-mono">{f.nit_vendedor ?? '—'}</td>
                  <td className="cc-mono">{f.nro_factura ?? '—'}</td>
                  <td className="cc-mono">{f.fecha_emision ? fechaHora(f.fecha_emision) : '—'}</td>
                  <td className="num">{bs(f.monto)}</td>
                  <td className="cc-mono" title={f.autorizacion ?? ''}>
                    {f.autorizacion ? `${f.autorizacion.slice(0, 12)}…` : '—'}
                  </td>
                  <td>
                    <span className={`cc-chip ${f.origen === 'manual' ? 'cc-espera' : 'cc-ok'}`}>
                      {f.origen === 'pdf' ? 'PDF' : f.origen === 'qr' ? 'QR' : 'manual'}
                    </span>
                  </td>
                  {editable && (
                    <td>
                      <button className="cc-btn cc-btn-x cc-btn-r"
                        onClick={async () => { await borrarFactura(f.id); await cargar(); onCambio?.() }}>
                        Quitar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="cc-tenue" style={{ fontSize: 13 }}>
            Total facturado: <strong>{bs(total)}</strong>
          </p>
        </div>
      )}

      {!facturas.length && !editable && <Vacio texto="No se registraron facturas en esta solicitud." />}

      {editable && (
        <>
          {escaneando ? (
            <div style={{ marginBottom: 16 }}>
              <video ref={video} playsInline muted
                style={{ width: '100%', maxWidth: 380, borderRadius: 6, border: '1px solid #dee2e6' }} />
              <canvas ref={lienzo} style={{ display: 'none' }} />
              <div className="cc-acc" style={{ marginTop: 10 }}>
                <button className="cc-btn" onClick={detenerCamara}>Cancelar</button>
                <span className="cc-tenue">Apunta al QR de la factura.</span>
              </div>
            </div>
          ) : (
            <div className="cc-acc" style={{ marginBottom: 16 }}>
              <label className="cc-btn cc-btn-p" style={{ margin: 0 }}>
                {leyendo ? 'Leyendo…' : 'Subir factura en PDF'}
                <input type="file" accept="application/pdf" style={{ display: 'none' }}
                  onChange={(e) => desdePdf(e.target.files?.[0] ?? null)} />
              </label>
              <button className="cc-btn" onClick={abrirCamara}>Escanear QR con la cámara</button>
              <label className="cc-btn" style={{ margin: 0 }}>
                Leer QR de una foto
                <input type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={(e) => desdeArchivo(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          )}

          <div className="cc-dos">
            <div className="cc-campo">
              <label>NIT del vendedor</label>
              <input value={form.nitVendedor}
                onChange={(e) => setForm({ ...form, nitVendedor: e.target.value })} />
            </div>
            <div className="cc-campo">
              <label>Nº de factura</label>
              <input value={form.nroFactura}
                onChange={(e) => setForm({ ...form, nroFactura: e.target.value })} />
            </div>
          </div>

          <div className="cc-dos">
            <div className="cc-campo">
              <label>Fecha de emisión</label>
              <input type="datetime-local" value={form.fechaEmision}
                onChange={(e) => setForm({ ...form, fechaEmision: e.target.value })} />
            </div>
            <div className="cc-campo">
              <label>Monto de la factura</label>
              <input type="number" step="0.01" min="0" value={form.monto}
                onChange={(e) => setForm({ ...form, monto: e.target.value })} />
            </div>
          </div>

          <div className="cc-campo">
            <label>Código de autorización</label>
            <input value={form.autorizacion}
              onChange={(e) => setForm({ ...form, autorizacion: e.target.value })} />
          </div>

          <div className="cc-campo">
            <label>Razón social del vendedor (opcional)</label>
            <input value={form.razonSocial}
              onChange={(e) => setForm({ ...form, razonSocial: e.target.value })} />
          </div>

          {pdf && (
            <div className="cc-aviso cc-av-ok">
              Se leyó <strong>{pdf.name}</strong>. El PDF queda adjunto como respaldo de la compra.
            </div>
          )}

          {form.clienteNit && form.clienteNit !== nitInstitucion && (
            <div className="cc-aviso cc-av-mal">
              Esta factura está emitida a {form.clienteNombre || 'otro titular'} ({form.clienteNit}), no a la
              universidad. Sin el NIT {nitInstitucion} no sirve como crédito fiscal y contabilidad no la
              puede cargar.
            </div>
          )}

          {form.nitVendedor === nitInstitucion && (
            <div className="cc-aviso cc-av-oro">
              Ese NIT es el de la propia universidad. Revisa que estés cargando el del vendedor, no el del
              comprador.
            </div>
          )}

          <button className="cc-btn cc-btn-p" disabled={trabajando} onClick={guardar}>
            {trabajando ? 'Guardando…' : 'Agregar factura'}
          </button>
        </>
      )}
    </div>
  )
}
