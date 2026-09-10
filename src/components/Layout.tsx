import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard, FileText, PlusCircle, CheckCircle2, Wallet, RefreshCcw,
  BarChart3, Building2, Bell, Users, CalendarRange, UserCog
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { ETIQUETA_ROL, type Rol } from '../types/database'
import { iniciales } from '../lib/formato'

const ENLACES: { a: string; texto: string; Icono: typeof FileText; roles: Rol[] }[] = [
  { a: '/dashboard', texto: 'Panel', Icono: LayoutDashboard, roles: ['super_admin', 'solicitante', 'daf', 'admin_caja', 'contabilidad'] },
  { a: '/solicitudes', texto: 'Solicitudes', Icono: FileText, roles: ['super_admin', 'solicitante', 'daf', 'admin_caja', 'contabilidad'] },
  { a: '/solicitudes/nueva', texto: 'Pedir un vale', Icono: PlusCircle, roles: ['super_admin', 'solicitante'] },
  { a: '/aprobaciones', texto: 'Por autorizar', Icono: CheckCircle2, roles: ['super_admin', 'daf'] },
  { a: '/caja/desembolsos', texto: 'Desembolsar', Icono: Wallet, roles: ['super_admin', 'admin_caja'] },
  { a: '/caja/validar-devoluciones', texto: 'Validar devoluciones', Icono: RefreshCcw, roles: ['super_admin', 'admin_caja'] },
  { a: '/rendicion-cuentas', texto: 'Rendición', Icono: FileText, roles: ['super_admin', 'admin_caja', 'daf', 'contabilidad'] },
  { a: '/rendiciones-admin', texto: 'Rendiciones por admin', Icono: Building2, roles: ['super_admin', 'daf', 'contabilidad'] },
  { a: '/reportes', texto: 'Reportes', Icono: BarChart3, roles: ['super_admin', 'daf', 'admin_caja', 'contabilidad'] },
  { a: '/avisos', texto: 'Avisos', Icono: Bell, roles: ['super_admin', 'daf', 'admin_caja'] },
  { a: '/periodos', texto: 'Gestiones de caja', Icono: CalendarRange, roles: ['super_admin'] },
  { a: '/usuarios', texto: 'Usuarios', Icono: Users, roles: ['super_admin'] },
  { a: '/mi-perfil', texto: 'Mi perfil', Icono: UserCog, roles: ['super_admin', 'solicitante', 'daf', 'admin_caja', 'contabilidad'] }
]

export function Layout() {
  const { perfil, periodo, cerrarSesion } = useAuth()
  const rol = perfil?.role

  return (
    <div className="cc">
      <aside className="cc-lat">
        <div className="cc-marca">
          <div className="cc-logo" />
          <div>
            <strong>Caja chica</strong>
            <span>UCB · Sede Tarija</span>
          </div>
        </div>
        <nav className="cc-nav">
          {ENLACES.filter((e) => rol && e.roles.includes(rol)).map(({ a, texto, Icono }) => (
            <NavLink key={a} to={a} end={a === '/solicitudes'} className={({ isActive }) => (isActive ? 'on' : '')}>
              <Icono size={16} strokeWidth={2} /> {texto}
            </NavLink>
          ))}
        </nav>
        <div className="cc-pie">
          {periodo && <p className="cc-mono" style={{ marginBottom: 10 }}>gestión: {periodo.etiqueta}</p>}
          <div className="cc-yo">
            <div className="cc-ini">{iniciales(perfil?.full_name ?? perfil?.email)}</div>
            <div>
              <strong>{perfil?.full_name || perfil?.email}</strong>
              <span>{rol ? ETIQUETA_ROL[rol] : ''}</span>
            </div>
          </div>
          <button className="cc-btn cc-btn-x" style={{ marginTop: 12 }} onClick={() => cerrarSesion()}>
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="cc-centro">
        <Outlet />
      </main>
    </div>
  )
}
