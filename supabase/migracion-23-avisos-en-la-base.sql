-- =====================================================================
-- caja_chica · Migración 23 · Todos los avisos automáticos nacen en la base
--
-- Antes, varios avisos los agendaba la app desde el navegador de quien
-- pulsaba el botón; si esa persona no tenía permiso para crear avisos
-- (contabilidad) el aviso se perdía en silencio. Ahora todos los genera la
-- base al cambiar el estado, sin importar quién ni desde dónde.
--
-- Canal: 'ambos' = push + correo · 'correo' = push + correo · 'whatsapp' =
-- solo push (recordatorios rápidos). El WhatsApp real lo envía la persona
-- con el botón de la app; no hay envío automático por WhatsApp.
-- =====================================================================

-- Administrador de caja del período vigente
create or replace function public.admin_caja_vigente()
returns uuid language sql stable security definer set search_path = public as $$
  select admin_caja_id from public.periodos_gestion where estado = 'vigente' limit 1;
$$;
revoke execute on function public.admin_caja_vigente() from public, anon, authenticated;

-- ---------- Solicitudes: decisión del DAF y cierre de la rendición
create or replace function public.avisar_decision()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_admin uuid := coalesce(new.admin_caja_id, public.admin_caja_vigente());
begin
  if new.estado is not distinct from old.estado then return new; end if;

  if new.estado = 'aprobado_daf' then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    values ('vale_aprobado', 'ambos', new.solicitante_id, 'solicitud', new.id,
            jsonb_build_object('solicitud', new.id, 'monto', new.monto_solicitado, 'descripcion', new.descripcion));
    if v_admin is not null then
      insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
      values ('vale_por_pagar', 'ambos', v_admin, 'solicitud', new.id,
              jsonb_build_object('solicitud', new.id, 'monto', new.monto_solicitado, 'descripcion', new.descripcion));
    end if;
  end if;

  if new.estado = 'rechazado' then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    values ('solicitud_rechazada', 'ambos', new.solicitante_id, 'solicitud', new.id,
            jsonb_build_object('solicitud', new.id, 'descripcion', new.descripcion,
                               'motivo', coalesce(new.motivo_rechazo, new.observacion_coordinador, '')));
  end if;

  if new.estado = 'completado' then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    values ('rendicion_cerrada', 'ambos', new.solicitante_id, 'solicitud', new.id,
            jsonb_build_object('solicitud', new.id, 'descripcion', new.descripcion,
                               'monto', new.monto_solicitado, 'gastado', new.monto_real));
  end if;
  return new;
end; $$;
revoke execute on function public.avisar_decision() from public, anon, authenticated;

drop trigger if exists solicitudes_aviso_decision on public.solicitudes;
create trigger solicitudes_aviso_decision
  after update on public.solicitudes
  for each row execute function public.avisar_decision();

-- ---------- Movimientos: devoluciones y saldo bajo el umbral
create or replace function public.avisar_movimiento()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_solicitante uuid;
  v_desc        text;
  v_admin       uuid;
  v_saldo       numeric;
  v_umbral      numeric;
begin
  if new.solicitud_id is not null then
    select solicitante_id, descripcion, admin_caja_id
      into v_solicitante, v_desc, v_admin
      from public.solicitudes where id = new.solicitud_id;
  end if;
  v_admin := coalesce(v_admin, public.admin_caja_vigente());

  -- El solicitante subió el comprobante de su devolución
  if tg_op = 'INSERT' and new.tipo = 'devolucion' and new.estado = 'pendiente_validacion' and v_admin is not null then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    values ('devolucion_por_validar', 'ambos', v_admin, 'solicitud', new.solicitud_id,
            jsonb_build_object('solicitud', new.solicitud_id, 'monto', new.monto, 'descripcion', v_desc));
  end if;

  -- El administrador validó la devolución
  if tg_op = 'UPDATE' and new.tipo = 'devolucion' and new.estado = 'aprobado'
     and old.estado is distinct from 'aprobado' and v_solicitante is not null then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    values ('devolucion_validada', 'whatsapp', v_solicitante, 'solicitud', new.solicitud_id,
            jsonb_build_object('solicitud', new.solicitud_id, 'monto', new.monto));
  end if;

  -- Un desembolso dejó el saldo en el umbral o por debajo: toca armar el informe
  if new.tipo = 'desembolso' and new.estado = 'aprobado' and new.solicitud_id is not null
     and (tg_op = 'INSERT' or old.estado is distinct from 'aprobado') then
    v_saldo  := public.saldo_vigente();
    v_umbral := (select umbral_reposicion from public.parametros where id = 1);
    if v_saldo <= v_umbral and v_saldo + new.monto > v_umbral and public.informe_en_curso() is null then
      insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
      select 'saldo_bajo', 'ambos', p.id, 'solicitud', new.solicitud_id,
             jsonb_build_object('saldo', v_saldo, 'umbral', v_umbral)
        from public.profiles p
       where p.activo and (p.role = 'daf' or p.id = v_admin);
    end if;
  end if;
  return new;
end; $$;
revoke execute on function public.avisar_movimiento() from public, anon, authenticated;

drop trigger if exists movimientos_aviso on public.movimientos_caja;
create trigger movimientos_aviso
  after insert or update on public.movimientos_caja
  for each row execute function public.avisar_movimiento();

-- ---------- Informe del ciclo
create or replace function public.avisar_informe()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_vars jsonb := jsonb_build_object('informe', new.id, 'monto', new.monto_reposicion);
begin
  if new.estado is not distinct from old.estado then return new; end if;

  if new.estado = 'pendiente_daf' then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    select 'informe_enviado', 'ambos', p.id, 'informe', new.id, v_vars
      from public.profiles p where p.role = 'daf' and p.activo;
  elsif new.estado in ('aprobado_daf', 'rechazado') then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    values ('informe_aprobado', 'ambos', new.admin_caja_id, 'informe', new.id,
            v_vars || jsonb_build_object('estado', case when new.estado = 'aprobado_daf' then 'aprobado' else 'rechazado' end));
  elsif new.estado = 'reposicion_solicitada' then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    select 'reposicion_por_procesar', 'ambos', p.id, 'informe', new.id, v_vars
      from public.profiles p where p.role = 'contabilidad' and p.activo;
  elsif new.estado = 'completado' then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    values ('reposicion_hecha', 'ambos', new.admin_caja_id, 'informe', new.id, v_vars);
  end if;
  return new;
end; $$;
revoke execute on function public.avisar_informe() from public, anon, authenticated;

drop trigger if exists informes_aviso on public.informe_rendicion_cuentas;
create trigger informes_aviso
  after update on public.informe_rendicion_cuentas
  for each row execute function public.avisar_informe();
