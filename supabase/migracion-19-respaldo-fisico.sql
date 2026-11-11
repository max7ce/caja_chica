-- =====================================================================
-- caja_chica · Migración 19 · Sin documentos físicos firmados no hay cierre
-- Una rendición solo se da por válida si el administrador de caja recibió
-- los originales, coinciden con lo cargado y llevan la firma del superior.
-- La regla vale para todos los roles y caminos (app, WhatsApp, service_role).
-- =====================================================================

alter table public.solicitudes
  add column if not exists firma_superior boolean;

comment on column public.solicitudes.firma_superior is
  'El administrador de caja verificó que los documentos físicos llevan la firma del superior inmediato.';

-- Las cerradas antes de esta regla ya pasaron el cotejo físico con la firma
-- al reverso como requisito escrito en la pantalla; se registra así.
update public.solicitudes
   set firma_superior = true
 where estado = 'completado' and conforme_fisica is true and firma_superior is null;

-- 1. Cierre de la solicitud
create or replace function public.exigir_respaldo_fisico()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.estado = 'completado' and old.estado is distinct from 'completado' then
    if new.fecha_recepcion_fisica is null or new.conforme_fisica is not true then
      raise exception 'No se puede cerrar la rendición sin recibir los documentos físicos y verificar que coinciden';
    end if;
    if new.firma_superior is not true then
      raise exception 'No se puede cerrar la rendición: los documentos físicos deben estar firmados por el superior inmediato';
    end if;
  end if;
  -- Si se observa la documentación, la firma se vuelve a verificar en el próximo cotejo
  if new.conforme_fisica is false and old.conforme_fisica is distinct from false then
    new.firma_superior := null;
  end if;
  return new;
end; $$;
revoke execute on function public.exigir_respaldo_fisico() from public, anon, authenticated;

drop trigger if exists solicitudes_10_respaldo_fisico on public.solicitudes;
create trigger solicitudes_10_respaldo_fisico
  before update on public.solicitudes
  for each row execute function public.exigir_respaldo_fisico();

-- 2. Informe de rendición: solo solicitudes ya validadas con su físico
create or replace function public.exigir_solicitud_cerrada()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (
    select 1 from public.solicitudes s
     where s.id = new.solicitud_id
       and s.estado = 'completado'
       and s.conforme_fisica is true
       and s.firma_superior is true
  ) then
    raise exception 'Solo entran al informe las solicitudes con la documentación física recibida, firmada y conforme';
  end if;
  return new;
end; $$;
revoke execute on function public.exigir_solicitud_cerrada() from public, anon, authenticated;

drop trigger if exists informe_solicitudes_exigir_cierre on public.informe_solicitudes;
create trigger informe_solicitudes_exigir_cierre
  before insert or update of solicitud_id on public.informe_solicitudes
  for each row execute function public.exigir_solicitud_cerrada();
