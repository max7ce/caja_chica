import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { RutaProtegida } from './RutaProtegida'
import { LoginPage } from '../pages/LoginPage'
import { DashboardPage } from '../pages/DashboardPage'
import { SolicitudesListPage } from '../pages/SolicitudesListPage'
import { SolicitudNuevaPage } from '../pages/SolicitudNuevaPage'
import { SolicitudDetailPage } from '../pages/SolicitudDetailPage'
import { DevolucionesPage } from '../pages/DevolucionesPage'
import { AprobacionesPage } from '../pages/AprobacionesPage'
import { AvalesPage } from '../pages/AvalesPage'
import { DesembolsosPage } from '../pages/DesembolsosPage'
import { ValidarDevolucionesPage } from '../pages/ValidarDevolucionesPage'
import { RendicionCuentasPage } from '../pages/RendicionCuentasPage'
import { RendicionDetailPage } from '../pages/RendicionDetailPage'
import { RendicionesAdminPage } from '../pages/RendicionesAdminPage'
import { ReportesPage } from '../pages/ReportesPage'
import { AvisosPage } from '../pages/AvisosPage'
import { PeriodosPage } from '../pages/PeriodosPage'
import { CategoriasPage } from '../pages/CategoriasPage'
import { UsuariosPage } from '../pages/UsuariosPage'
import { MiPerfilPage } from '../pages/MiPerfilPage'

const OPERATIVOS = ['admin_caja', 'super_admin'] as const
const DAF = ['daf', 'super_admin'] as const

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RutaProtegida><Layout /></RutaProtegida>}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/solicitudes" element={<SolicitudesListPage />} />
          <Route path="/solicitudes/nueva" element={
            <RutaProtegida roles={['solicitante', 'super_admin']}><SolicitudNuevaPage /></RutaProtegida>} />
          <Route path="/solicitudes/:id" element={<SolicitudDetailPage />} />
          <Route path="/devoluciones/:solicitudId" element={<DevolucionesPage />} />
          <Route path="/avales" element={<AvalesPage />} />
          <Route path="/aprobaciones" element={
            <RutaProtegida roles={[...DAF]}><AprobacionesPage /></RutaProtegida>} />
          <Route path="/caja/desembolsos" element={
            <RutaProtegida roles={[...OPERATIVOS]}><DesembolsosPage /></RutaProtegida>} />
          <Route path="/caja/validar-devoluciones" element={
            <RutaProtegida roles={[...OPERATIVOS]}><ValidarDevolucionesPage /></RutaProtegida>} />
          <Route path="/rendicion-cuentas" element={
            <RutaProtegida roles={['admin_caja', 'daf', 'super_admin', 'contabilidad']}><RendicionCuentasPage /></RutaProtegida>} />
          <Route path="/rendicion-cuentas/:id" element={
            <RutaProtegida roles={['admin_caja', 'daf', 'super_admin', 'contabilidad']}><RendicionDetailPage /></RutaProtegida>} />
          <Route path="/rendiciones-admin" element={
            <RutaProtegida roles={['daf', 'super_admin', 'contabilidad']}><RendicionesAdminPage /></RutaProtegida>} />
          <Route path="/reportes" element={
            <RutaProtegida roles={['daf', 'admin_caja', 'super_admin', 'contabilidad']}><ReportesPage /></RutaProtegida>} />
          <Route path="/avisos" element={
            <RutaProtegida roles={['daf', 'admin_caja', 'super_admin']}><AvisosPage /></RutaProtegida>} />
          <Route path="/categorias" element={
            <RutaProtegida roles={['super_admin']}><CategoriasPage /></RutaProtegida>} />
          <Route path="/periodos" element={
            <RutaProtegida roles={['super_admin']}><PeriodosPage /></RutaProtegida>} />
          <Route path="/usuarios" element={
            <RutaProtegida roles={['super_admin']}><UsuariosPage /></RutaProtegida>} />
          <Route path="/mi-perfil" element={<MiPerfilPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
