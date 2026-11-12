import { cerrarWhatsApp, enlaceWhatsApp, normalizarCelular, useAvisosWhatsApp } from '../lib/whatsapp'

/**
 * Aparece abajo a la derecha después de una acción que alguien más tiene que
 * conocer. Cada botón abre WhatsApp con el mensaje ya escrito.
 */
export function PanelWhatsApp() {
  const avisos = useAvisosWhatsApp()
  if (!avisos.length) return null

  return (
    <div role="dialog" aria-label="Avisar por WhatsApp" style={{
      position: 'fixed', right: 16, bottom: 16, zIndex: 50, width: 'min(380px, calc(100vw - 32px))',
      background: 'var(--papel, #fff)', border: '2px solid var(--tinta)', boxShadow: '0 8px 24px rgba(0,0,0,.18)',
      padding: 16
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <strong>Avisa por WhatsApp</strong>
        <button className="cc-btn cc-btn-x" onClick={cerrarWhatsApp} aria-label="Cerrar">Listo</button>
      </div>
      <p className="cc-tenue" style={{ margin: '6px 0 12px', fontSize: 13 }}>
        Se abre tu WhatsApp con el mensaje escrito; solo pulsa Enviar.
      </p>
      <div style={{ display: 'grid', gap: 10 }}>
        {avisos.map((a, i) => {
          const conNumero = Boolean(normalizarCelular(a.para.telefono))
          return (
            <div key={i} style={{ borderTop: i ? '1px solid var(--borde, #d7d3d3)' : 'none', paddingTop: i ? 10 : 0 }}>
              <div style={{ fontSize: 14 }}><strong>{a.para.nombre}</strong></div>
              <div className="cc-tenue" style={{ fontSize: 12, marginBottom: 6 }}>
                {a.motivo}{!conNumero && ' · sin celular cargado: elige el contacto en WhatsApp'}
              </div>
              <a className="cc-btn cc-btn-p" href={enlaceWhatsApp(a.para.telefono, a.texto)}
                target="_blank" rel="noreferrer" style={{ background: '#1f7a4d', borderColor: '#1f7a4d', color: '#fff', textDecoration: 'none', display: 'inline-block' }}>
                Abrir WhatsApp
              </a>
            </div>
          )
        })}
      </div>
    </div>
  )
}
