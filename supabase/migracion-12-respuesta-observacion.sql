-- =====================================================================
-- MIGRACIÓN 12 — Respuesta del solicitante a una observación
--
-- Cuando el administrador de caja observa una rendición, el solicitante
-- veía el motivo pero no tenía cómo responder: ni subsanar documentos ni
-- contestar. La solicitud quedaba trabada sin salida.
--
-- Va todo junto, en una sola ejecución.
-- =====================================================================

reset role;

alter table public.solicitudes add column if not exists respuesta_solicitante text;
alter table public.solicitudes add column if not exists fecha_respuesta_solicitante timestamptz;

-- ---------------------------------------------------------------------
-- 1. El solicitante puede editar su solicitud mientras está observada
-- ---------------------------------------------------------------------
drop policy if exists solicitudes_update on public.solicitudes;
create policy solicitudes_update on public.solicitudes for update to authenticated
  using (
    public.es_operativo()
    or (solicitante_id = auth.uid()
        and estado in ('desembolsado','pendiente_devolucion','pendiente_verificacion'))
    or (coordinador_id = auth.uid() and estado = 'pendiente_coordinador')
  )
  with check (
    public.es_operativo()
    or solicitante_id = auth.uid()
    or coordinador_id = auth.uid()
  );

-- ---------------------------------------------------------------------
-- 2. También puede corregir las facturas observadas
-- ---------------------------------------------------------------------
drop policy if exists facturas_delete on public.facturas;
create policy facturas_delete on public.facturas for delete to authenticated
  using (
    public.rol_actual() in ('admin_caja','super_admin')
    or exists (select 1 from public.solicitudes s
               where s.id = facturas.solicitud_id
                 and s.solicitante_id = auth.uid()
                 and s.estado in ('desembolsado','pendiente_devolucion','pendiente_verificacion'))
  );

-- ---------------------------------------------------------------------
-- 3. Nadie se levanta su propia observación
--
-- Al responder, el solicitante deja el cotejo en blanco para que el
-- administrador vuelva a revisarlo. Lo que no puede es marcarse conforme:
-- eso sigue siendo del administrador.
-- ---------------------------------------------------------------------
create or replace function public.proteger_observacion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.solicitante_id = auth.uid()
     and public.rol_actual() not in ('admin_caja','super_admin')
     and new.conforme_fisica is true
     and old.conforme_fisica is distinct from true then
    raise exception 'Solo el administrador de caja puede dar por conforme una rendición';
  end if;
  return new;
end;
$$;

drop trigger if exists solicitudes_proteger_observacion on public.solicitudes;
create trigger solicitudes_proteger_observacion
  before update on public.solicitudes
  for each row execute function public.proteger_observacion();

-- ---------------------------------------------------------------------
-- 4. Aviso al administrador cuando el solicitante responde
-- ---------------------------------------------------------------------
create or replace function public.avisar_respuesta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.fecha_respuesta_solicitante is distinct from old.fecha_respuesta_solicitante
     and new.fecha_respuesta_solicitante is not null
     and new.admin_caja_id is not null then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    values ('observacion_respondida', 'whatsapp', new.admin_caja_id, 'solicitud', new.id,
            jsonb_build_object('solicitud', new.id,
                               'respuesta', coalesce(new.respuesta_solicitante, '')));
  end if;
  return new;
end;
$$;

drop trigger if exists solicitudes_aviso_respuesta on public.solicitudes;
create trigger solicitudes_aviso_respuesta
  after update on public.solicitudes
  for each row execute function public.avisar_respuesta();

-- Verificación
-- reset role;
-- select id, estado, conforme_fisica, observacion_fisica, respuesta_solicitante
--   from public.solicitudes where conforme_fisica is false;
