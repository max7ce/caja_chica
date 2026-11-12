-- =====================================================================
-- caja_chica · Migración 21 · Fondo inicial de la gestión
-- La migración 20 exigía informe y pedido para toda reposición, y con eso
-- bloqueaba también la carga del fondo inicial de un período. El fondo
-- inicial (reposición sin informe) vuelve a estar permitido, pero solo
-- para super_admin o mantenimiento, y uno solo por período.
-- =====================================================================
create or replace function public.guardia_reposicion()
returns trigger language plpgsql security definer set search_path = public as $$
declare i record;
begin
  if new.tipo <> 'reposicion' then return new; end if;

  -- Fondo inicial de la gestión
  if new.informe_id is null then
    if auth.uid() is not null and public.rol_actual() <> 'super_admin' then
      raise exception 'La reposición la registra contabilidad sobre un pedido de reposición';
    end if;
    new.periodo_id := coalesce(new.periodo_id, public.periodo_vigente());
    if exists (select 1 from public.movimientos_caja
                where tipo = 'reposicion' and informe_id is null and periodo_id = new.periodo_id) then
      raise exception 'Este período ya tiene cargado su fondo inicial';
    end if;
    new.descripcion := coalesce(new.descripcion, 'Fondo inicial de la gestión');
    return new;
  end if;

  -- Reposición de un ciclo
  if auth.uid() is not null and public.rol_actual() not in ('contabilidad','super_admin') then
    raise exception 'La reposición la registra contabilidad';
  end if;
  select * into i from public.informe_rendicion_cuentas where id = new.informe_id;
  if i.id is null or i.estado <> 'reposicion_solicitada' then
    raise exception 'Solo se registra una reposición sobre un informe con pedido de reposición';
  end if;
  if new.monto <> i.monto_reposicion then
    raise exception 'La reposición debe ser exactamente % Bs', i.monto_reposicion;
  end if;
  if exists (select 1 from public.movimientos_caja where informe_id = i.id and tipo = 'reposicion') then
    raise exception 'Este informe ya tiene su reposición registrada';
  end if;
  new.admin_caja_id := i.admin_caja_id;
  new.periodo_id    := coalesce(new.periodo_id, i.periodo_id, public.periodo_vigente());
  return new;
end; $$;
revoke execute on function public.guardia_reposicion() from public, anon, authenticated;
