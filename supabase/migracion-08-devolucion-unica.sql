-- =====================================================================
-- MIGRACIÓN 08 — Una sola devolución pendiente por solicitud
--
-- La pantalla no mostraba que la devolución ya había sido enviada, así
-- que se podía mandar dos veces. Cada envío crea un movimiento de caja,
-- y si el administrador validaba los dos, el saldo subía el doble de lo
-- que la persona realmente depositó.
--
-- Esta migración limpia los duplicados que ya existan y los impide a
-- futuro desde la base, no solo desde la interfaz.
--
-- Va todo junto, en una sola ejecución.
-- =====================================================================

reset role;

-- ---------------------------------------------------------------------
-- 1. Limpieza: de cada grupo de devoluciones pendientes repetidas sobre
--    la misma solicitud, se conserva la primera y se borran las demás.
--    Solo toca las que siguen pendientes: las ya aprobadas no se tocan.
-- ---------------------------------------------------------------------
with repetidas as (
  select id,
         row_number() over (partition by solicitud_id order by created_at) as n
    from public.movimientos_caja
   where tipo = 'devolucion'
     and estado = 'pendiente_validacion'
     and solicitud_id is not null
)
delete from public.movimientos_caja
 where id in (select id from repetidas where n > 1);

-- ---------------------------------------------------------------------
-- 2. Impedirlas a futuro
-- ---------------------------------------------------------------------
create unique index if not exists idx_una_devolucion_pendiente
  on public.movimientos_caja (solicitud_id)
  where tipo = 'devolucion' and estado = 'pendiente_validacion';

-- ---------------------------------------------------------------------
-- 3. Al validar una devolución, ninguna otra de la misma solicitud
--    puede quedar viva esperando validación.
-- ---------------------------------------------------------------------
create or replace function public.limpiar_devoluciones_hermanas()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tipo = 'devolucion' and new.estado = 'aprobado'
     and old.estado = 'pendiente_validacion' and new.solicitud_id is not null then
    delete from public.movimientos_caja
     where solicitud_id = new.solicitud_id
       and tipo = 'devolucion'
       and estado = 'pendiente_validacion'
       and id <> new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists movimientos_limpiar_hermanas on public.movimientos_caja;
create trigger movimientos_limpiar_hermanas
  after update on public.movimientos_caja
  for each row execute function public.limpiar_devoluciones_hermanas();

-- ---------------------------------------------------------------------
-- 4. Verificación: no debería quedar ninguna solicitud con más de una
--    devolución pendiente.
-- ---------------------------------------------------------------------
-- reset role;
-- select solicitud_id, count(*)
--   from public.movimientos_caja
--  where tipo = 'devolucion' and estado = 'pendiente_validacion'
--  group by solicitud_id having count(*) > 1;
--
-- Y el saldo, para confirmar que no quedó inflado:
-- select * from public.v_saldo_caja;
