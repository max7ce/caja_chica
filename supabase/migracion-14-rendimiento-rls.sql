-- =====================================================================
-- caja_chica · Migración 14 · Rendimiento de RLS e índices
-- Misma lógica de acceso; solo cambia cómo se evalúa.
-- (select f()) hace que Postgres evalúe la función una vez por consulta
-- y no una vez por fila.
-- =====================================================================

-- ---------- profiles ----------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.es_admin()));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using      (id = (select auth.uid()) or (select public.rol_actual()) = 'super_admin')
  with check (id = (select auth.uid()) or (select public.rol_actual()) = 'super_admin');

-- ---------- solicitudes ----------
drop policy if exists solicitudes_select on public.solicitudes;
create policy solicitudes_select on public.solicitudes for select to authenticated
  using (solicitante_id = (select auth.uid())
         or coordinador_id = (select auth.uid())
         or (select public.es_admin()));

drop policy if exists solicitudes_insert on public.solicitudes;
create policy solicitudes_insert on public.solicitudes for insert to authenticated
  with check (
    solicitante_id = (select auth.uid())
    and (select public.rol_actual()) in ('solicitante','super_admin')
    and not ((select bloquear_si_vencida from public.parametros where id = 1)
             and (select public.tiene_rendicion_vencida((select auth.uid())))));

drop policy if exists solicitudes_update on public.solicitudes;
create policy solicitudes_update on public.solicitudes for update to authenticated
  using (
    (select public.es_operativo())
    or (solicitante_id = (select auth.uid())
        and estado in ('desembolsado','pendiente_devolucion','pendiente_verificacion'))
    or (coordinador_id = (select auth.uid()) and estado = 'pendiente_coordinador'))
  with check (
    (select public.es_operativo())
    or solicitante_id = (select auth.uid())
    or coordinador_id = (select auth.uid()));

-- ---------- comprobantes ----------
drop policy if exists comprobantes_select on public.comprobantes;
create policy comprobantes_select on public.comprobantes for select to authenticated
  using (subido_por_id = (select auth.uid()) or (select public.es_admin()));

drop policy if exists comprobantes_insert on public.comprobantes;
create policy comprobantes_insert on public.comprobantes for insert to authenticated
  with check (subido_por_id = (select auth.uid()));

-- ---------- movimientos_caja ----------
drop policy if exists movimientos_select on public.movimientos_caja;
create policy movimientos_select on public.movimientos_caja for select to authenticated
  using ((select public.es_admin())
         or exists (select 1 from public.solicitudes s
                    where s.id = movimientos_caja.solicitud_id
                      and s.solicitante_id = (select auth.uid())));

drop policy if exists movimientos_insert on public.movimientos_caja;
create policy movimientos_insert on public.movimientos_caja for insert to authenticated
  with check (
    (select public.rol_actual()) in ('admin_caja','super_admin')
    or (tipo = 'reposicion' and (select public.rol_actual()) = 'contabilidad')
    or (tipo = 'devolucion' and estado = 'pendiente_validacion'
        and exists (select 1 from public.solicitudes s
                    where s.id = movimientos_caja.solicitud_id
                      and s.solicitante_id = (select auth.uid()))));

drop policy if exists movimientos_update on public.movimientos_caja;
create policy movimientos_update on public.movimientos_caja for update to authenticated
  using      ((select public.rol_actual()) in ('admin_caja','super_admin'))
  with check ((select public.rol_actual()) in ('admin_caja','super_admin'));

-- ---------- notificaciones ----------
drop policy if exists notif_select on public.notificaciones;
create policy notif_select on public.notificaciones for select to authenticated
  using (destinatario_id = (select auth.uid()) or (select public.es_admin()));

drop policy if exists notif_insert on public.notificaciones;
create policy notif_insert on public.notificaciones for insert to authenticated
  with check ((select public.es_operativo()));

-- ---------- push_suscripciones ----------
drop policy if exists push_select on public.push_suscripciones;
create policy push_select on public.push_suscripciones for select to authenticated
  using (usuario_id = (select auth.uid()) or (select public.rol_actual()) = 'super_admin');

drop policy if exists push_insert on public.push_suscripciones;
create policy push_insert on public.push_suscripciones for insert to authenticated
  with check (usuario_id = (select auth.uid()));

drop policy if exists push_update on public.push_suscripciones;
create policy push_update on public.push_suscripciones for update to authenticated
  using (usuario_id = (select auth.uid())) with check (usuario_id = (select auth.uid()));

drop policy if exists push_delete on public.push_suscripciones;
create policy push_delete on public.push_suscripciones for delete to authenticated
  using (usuario_id = (select auth.uid()) or (select public.rol_actual()) = 'super_admin');

-- ---------- facturas ----------
drop policy if exists facturas_select on public.facturas;
create policy facturas_select on public.facturas for select to authenticated
  using ((select public.es_admin())
         or exists (select 1 from public.solicitudes s
                    where s.id = facturas.solicitud_id
                      and s.solicitante_id = (select auth.uid())));

drop policy if exists facturas_insert on public.facturas;
create policy facturas_insert on public.facturas for insert to authenticated
  with check ((select public.rol_actual()) in ('admin_caja','super_admin')
              or exists (select 1 from public.solicitudes s
                         where s.id = facturas.solicitud_id
                           and s.solicitante_id = (select auth.uid())));

drop policy if exists facturas_update on public.facturas;
create policy facturas_update on public.facturas for update to authenticated
  using ((select public.rol_actual()) in ('admin_caja','super_admin')
         or exists (select 1 from public.solicitudes s
                    where s.id = facturas.solicitud_id
                      and s.solicitante_id = (select auth.uid())
                      and s.estado in ('desembolsado','pendiente_devolucion','pendiente_verificacion')));

drop policy if exists facturas_delete on public.facturas;
create policy facturas_delete on public.facturas for delete to authenticated
  using ((select public.rol_actual()) in ('admin_caja','super_admin')
         or exists (select 1 from public.solicitudes s
                    where s.id = facturas.solicitud_id
                      and s.solicitante_id = (select auth.uid())
                      and s.estado in ('desembolsado','pendiente_devolucion','pendiente_verificacion')));

-- ---------- informes ----------
drop policy if exists informes_select on public.informe_rendicion_cuentas;
create policy informes_select on public.informe_rendicion_cuentas for select to authenticated
  using ((select public.es_admin()));

drop policy if exists informes_insert on public.informe_rendicion_cuentas;
create policy informes_insert on public.informe_rendicion_cuentas for insert to authenticated
  with check ((select public.rol_actual()) in ('admin_caja','super_admin'));

drop policy if exists informes_update on public.informe_rendicion_cuentas;
create policy informes_update on public.informe_rendicion_cuentas for update to authenticated
  using      ((select public.rol_actual()) in ('admin_caja','daf','super_admin','contabilidad'))
  with check ((select public.rol_actual()) in ('admin_caja','daf','super_admin','contabilidad'));

-- ---------- Políticas ALL → separadas (evita doble evaluación en SELECT) ----------
-- categorias, oficinas, periodos_gestion: lectura para todos, escritura super_admin
do $$
declare t text; p text;
begin
  foreach t in array array['categorias','oficinas','periodos_gestion'] loop
    p := case t when 'periodos_gestion' then 'periodos' else t end;
    execute format('drop policy if exists %I on public.%I', p || '_escribir', t);
    execute format('drop policy if exists %I on public.%I', p || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', p || '_select', t);
    execute format($f$create policy %I on public.%I for insert to authenticated
                     with check ((select public.rol_actual()) = 'super_admin')$f$, p || '_insert', t);
    execute format($f$create policy %I on public.%I for update to authenticated
                     using ((select public.rol_actual()) = 'super_admin')
                     with check ((select public.rol_actual()) = 'super_admin')$f$, p || '_update', t);
    execute format($f$create policy %I on public.%I for delete to authenticated
                     using ((select public.rol_actual()) = 'super_admin')$f$, p || '_delete', t);
  end loop;
end $$;

drop policy if exists informe_sol_escribir on public.informe_solicitudes;
drop policy if exists informe_sol_select   on public.informe_solicitudes;
create policy informe_sol_select on public.informe_solicitudes for select to authenticated
  using ((select public.es_admin()));
create policy informe_sol_insert on public.informe_solicitudes for insert to authenticated
  with check ((select public.rol_actual()) in ('admin_caja','super_admin'));
create policy informe_sol_update on public.informe_solicitudes for update to authenticated
  using ((select public.rol_actual()) in ('admin_caja','super_admin'))
  with check ((select public.rol_actual()) in ('admin_caja','super_admin'));
create policy informe_sol_delete on public.informe_solicitudes for delete to authenticated
  using ((select public.rol_actual()) in ('admin_caja','super_admin'));

-- ---------- parametros ----------
drop policy if exists parametros_update on public.parametros;
create policy parametros_update on public.parametros for update to authenticated
  using      ((select public.rol_actual()) = 'super_admin')
  with check ((select public.rol_actual()) = 'super_admin');

-- ---------- Índices de claves foráneas usadas en RLS, joins y dashboard ----------
create index if not exists idx_sol_coordinador      on public.solicitudes (coordinador_id);
create index if not exists idx_sol_admin_caja       on public.solicitudes (admin_caja_id);
create index if not exists idx_sol_aprobado_por     on public.solicitudes (aprobado_por_id);
create index if not exists idx_sol_verificado_por   on public.solicitudes (verificado_por_id);
create index if not exists idx_mov_solicitud        on public.movimientos_caja (solicitud_id);
create index if not exists idx_mov_informe          on public.movimientos_caja (informe_id);
create index if not exists idx_mov_admin_caja       on public.movimientos_caja (admin_caja_id);
create index if not exists idx_mov_registrado_por   on public.movimientos_caja (registrado_por_id);
create index if not exists idx_mov_aprobado_por     on public.movimientos_caja (aprobado_por_id);
create index if not exists idx_inf_periodo          on public.informe_rendicion_cuentas (periodo_id);
create index if not exists idx_inf_admin_caja       on public.informe_rendicion_cuentas (admin_caja_id);
create index if not exists idx_inf_aprobado_por     on public.informe_rendicion_cuentas (aprobado_por_id);
create index if not exists idx_infsol_informe       on public.informe_solicitudes (informe_id);
create index if not exists idx_comp_subido_por      on public.comprobantes (subido_por_id);
create index if not exists idx_fact_comprobante     on public.facturas (comprobante_id);
create index if not exists idx_fact_cargado_por     on public.facturas (cargado_por_id);
create index if not exists idx_notif_destinatario   on public.notificaciones (destinatario_id);
create index if not exists idx_ofi_coordinador      on public.oficinas (coordinador_id);
create index if not exists idx_per_admin_caja       on public.periodos_gestion (admin_caja_id);
create index if not exists idx_tok_usuario          on public.tokens_accion (usuario_id);
