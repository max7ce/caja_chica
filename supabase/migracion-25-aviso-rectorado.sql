-- =====================================================================
-- caja_chica · Migración 25 · Aviso a Rectorado cuando se repone la caja
--
-- Rectorado firma el informe del ciclo en papel; cuando Contabilidad
-- confirma la transferencia de la reposición, recibe el aviso de que el
-- fondo quedó repuesto. Quién lo recibe (el Rector y/o su asistente) se
-- elige en Gestiones de caja → Parámetros.
-- =====================================================================

alter table public.parametros
  add column if not exists aviso_rectorado_ids uuid[] not null default '{}';

create or replace function public.avisar_informe()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_vars jsonb := jsonb_build_object('informe', new.id, 'monto', new.monto_reposicion,
                                            'numero', new.numero, 'gestion', new.gestion);
begin
  if new.fecha_firma_daf is not null and old.fecha_firma_daf is null then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    values ('informe_en_rectorado', 'ambos', new.admin_caja_id, 'informe', new.id, v_vars);
  end if;
  if new.estado is not distinct from old.estado then return new; end if;
  if new.estado = 'pendiente_daf' then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    select 'informe_enviado', 'ambos', p.id, 'informe', new.id, v_vars
      from public.profiles p where p.role = 'daf' and p.activo;
  elsif new.estado in ('aprobado_daf', 'rechazado') then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    values ('informe_aprobado', 'ambos', new.admin_caja_id, 'informe', new.id,
            v_vars || jsonb_build_object('estado', case when new.estado = 'aprobado_daf' then 'aprobado' else 'rechazado' end,
                                         'motivo', coalesce(new.motivo_rechazo, '')));
  elsif new.estado = 'reposicion_solicitada' then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    select 'reposicion_por_procesar', 'ambos', p.id, 'informe', new.id, v_vars
      from public.profiles p where p.role = 'contabilidad' and p.activo;
  elsif new.estado = 'completado' then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    values ('reposicion_hecha', 'ambos', new.admin_caja_id, 'informe', new.id, v_vars);
    -- Rectorado: el fondo quedó repuesto
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    select 'reposicion_rectorado', 'ambos', p.id, 'informe', new.id,
           v_vars || jsonb_build_object('admin', (select full_name from public.profiles where id = new.admin_caja_id),
                                        'fondo', (select monto_reposicion from public.parametros where id = 1))
      from public.profiles p
     where p.activo and p.id = any (coalesce((select aviso_rectorado_ids from public.parametros where id = 1), '{}'));
  end if;
  return new;
end; $$;
