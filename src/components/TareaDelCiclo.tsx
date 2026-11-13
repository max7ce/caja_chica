import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { INFORME_EN_CURSO, gastoNeto, listarInformes, numeroInforme, solicitudesSinRendir } from '../lib/api'
import { bs } from '../lib/formato'
import type { InformeRendicion, Rol } from '../types/database'
import { PedirReposicion } from './PedirReposicion'

/**
 * Tarjeta del Inicio con lo que el ciclo de reposición espera de quien
 * entra: el admin arma o envía el informe y pide la reposición, el DAF
 * aprueba y contabilidad transfiere. Si no le toca nada, no se muestra.
 */
export function TareaDelCiclo({ rol, saldo, umbral }: { rol: Rol; saldo: number; umbral: number }) {
  const [informe, setInforme] = useState<InformeRendicion | null>(null)
  const [listas, setListas] = useState<{ n: number; neto: number } | null>(null)
  const esAdmin = rol === 'admin_caja' || rol === 'super_admin'

  const cargar = useCallback(async () => {
    const informes = await listarInformes()
    const enCurso = informes.find((i) => INFORME_EN_CURSO.includes(i.estado)) ?? null
    setInforme(enCurso)
    if (esAdmin && !enCurso && saldo <= umbral) {
      const c = await solicitudesSinRendir()
      setListas({ n: c.length, neto: gastoNeto(c).neto })
    }
  }, [esAdmin, saldo, umbral])
  useEffect(() => { cargar().catch(() => { /* la tarjeta es un atajo: si falla, el resto del Inicio sigue */ }) }, [cargar])

  const tarjeta = (titulo: string, cuerpo: React.ReactNode) => (
    <div className="cc-card" style={{ borderLeft: '6px solid var(--azul-ucb)' }}>
      <h2>{titulo}</h2>
      {cuerpo}
    </div>
  )
  const ver = (texto: string, a: string) => <Link className="cc-btn cc-btn-p" to={a}>{texto}</Link>

  if (!informe) {
    if (esAdmin && listas && listas.n > 0) {
      return tarjeta('Toca armar el informe del ciclo', <>
        <p style={{ marginTop: 0 }}>
          El saldo está en {bs(saldo)}. Hay {listas.n} vale(s) rendidos con un gasto neto de {bs(listas.neto)}.
        </p>
        {ver('Armar el informe del ciclo', '/rendicion-cuentas')}
      </>)
    }
    return null
  }

  const enlace = `/rendicion-cuentas/${informe.id}`
  switch (informe.estado) {
    case 'borrador':
      return esAdmin ? tarjeta('Informe del ciclo en borrador', <>
        <p style={{ marginTop: 0 }}>Falta adjuntar el reporte contable y enviarlo al DAF.</p>
        {ver('Completar y enviar', enlace)}
      </>) : null
    case 'pendiente_daf': {
      const esDaf = rol === 'daf' || rol === 'super_admin'
      if (informe.fecha_firma_daf) {
        return tarjeta(`Informe ${numeroInforme(informe)} en Rectorado`, <>
          <p style={{ marginTop: 0 }}>
            {esDaf
              ? 'Cuando vuelva firmado por Rectorado, sube el escaneo con las tres firmas y da el OK.'
              : 'El DAF lo firmó y lo envió a Rectorado. Cuando vuelva firmado, el DAF te dará el OK para pedir la reposición.'}
          </p>
          {(esDaf || esAdmin) && ver(esDaf ? 'Dar el OK' : 'Ver el informe', enlace)}
        </>)
      }
      if (esDaf) {
        return tarjeta(`Informe ${numeroInforme(informe)} por recibir y firmar`, <>
          <p style={{ marginTop: 0 }}>
            Reposición de {bs(informe.monto_reposicion)}. El administrador de caja te entrega el informe impreso
            con su firma; revísalo, fírmalo y envíalo a Rectorado.
          </p>
          {ver('Registrar firma', enlace)}
        </>)
      }
      return esAdmin ? tarjeta(`Imprime, firma y entrega el informe ${numeroInforme(informe)} al DAF`, <>
        <p style={{ marginTop: 0 }}>
          El DAF necesita el informe en papel con tu firma. Él lo firma y lo envía a Rectorado; con las tres
          firmas te da el OK para pedir la reposición.
        </p>
        <div className="cc-acc">
          <Link className="cc-btn cc-btn-p" to={`${enlace}/imprimir`} target="_blank" rel="noreferrer">Imprimir el informe</Link>
          <Link className="cc-btn cc-btn-x" to={enlace}>Ver el informe</Link>
        </div>
      </>) : null
    }
    case 'aprobado_daf':
      return esAdmin ? tarjeta('Informe firmado por el DAF y Rectorado: pide la reposición', <>
        <p style={{ marginTop: 0 }}>Es el paso obligatorio para que contabilidad transfiera y la caja vuelva a su fondo.</p>
        <PedirReposicion informe={informe} onListo={() => { void cargar() }} />
      </>) : null
    case 'reposicion_solicitada':
      return rol === 'contabilidad' || rol === 'super_admin' ? tarjeta('Reposición pedida', <>
        <p style={{ marginTop: 0 }}>Transfiere {bs(informe.monto_reposicion)} al administrador de caja y confirma.</p>
        {ver('Procesar la reposición', '/reposiciones')}
      </>) : null
    default:
      return null
  }
}
