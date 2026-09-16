-- =====================================================================
-- MIGRACIÓN 06 — Verificación física antes del cierre
--
-- Hasta ahora, una solicitud sin diferencia que devolver se cerraba sola
-- en cuanto el solicitante rendía en el sistema. Ahora ninguna se cierra
-- sin que el administrador de caja reciba los documentos en físico —el
-- vale y las facturas con firma y sello del coordinador al reverso— y
-- confirme que coinciden con lo cargado.
--
-- El estado nuevo se llama 'pendiente_verificacion' y se ubica entre la
-- rendición y el cierre.
--
-- IMPORTANTE: ejecutá el §1 SOLO, dale Run, y después el resto.
-- =====================================================================

-- ---------------------------------------------------------------------
-- §1. EJECUTAR SOLO ESTA LÍNEA, APARTE
-- ---------------------------------------------------------------------
alter type public.estado_solicitud add value if not exists 'pendiente_verificacion' before 'completado';


-- =====================================================================
-- §2. DE AQUÍ EN ADELANTE, TODO JUNTO
-- =====================================================================

reset role;

-- ---------------------------------------------------------------------
-- 2.1 Registro del cotejo
-- ---------------------------------------------------------------------
alter table public.solicitudes add column if not exists fecha_recepcion_fisica timestamptz;
alter table public.solicitudes add column if not exists verificado_por_id uuid references public.profiles(id);
alter table public.solicitudes add column if not exists conforme_fisica boolean;
alter table public.solicitudes add column if not exists observacion_fisica text;

-- ---------------------------------------------------------------------
-- 2.2 El cierre ya no ocurre al rendir
--
-- Se agrega la cancelación de recordatorios cuando la persona entra en
-- verificación: ya cumplió con lo suyo en plazo, y seguir recordándole
-- sería injusto mientras espera que el administrador reciba el físico.
-- ---------------------------------------------------------------------
create or replace function public.marcar_desembolso()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  horas int;
  limite timestamptz;
begin
  new.updated_at := now();

  if new.estado = 'desembolsado' and old.estado is distinct from 'desembolsado' then
    select plazo_rendicion_horas into horas from public.parametros where id = 1;
    new.fecha_desembolso := coalesce(new.fecha_desembolso, now());
    limite := public.vencimiento_habil(new.fecha_desembolso, coalesce(horas, 48));
    new.limite_tiempo_devolucion := limite;

    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables, programada_para)
    values
      ('desembolso_hecho', 'ambos', new.solicitante_id, 'solicitud', new.id,
        jsonb_build_object('monto', new.monto_solicitado, 'solicitud', new.id, 'limite', limite), now()),
      ('plazo_24h', 'whatsapp', new.solicitante_id, 'solicitud', new.id,
        jsonb_build_object('solicitud', new.id, 'limite', limite), limite - interval '24 hours'),
      ('plazo_8h', 'whatsapp', new.solicitante_id, 'solicitud', new.id,
        jsonb_build_object('solicitud', new.id, 'limite', limite), limite - interval '8 hours'),
      ('plazo_vencido', 'correo', new.solicitante_id, 'solicitud', new.id,
        jsonb_build_object('solicitud', new.id, 'limite', limite), limite);
  end if;

  if new.estado in ('pendiente_devolucion','pendiente_verificacion')
     and old.estado is distinct from new.estado then
    new.fecha_rendicion := coalesce(new.fecha_rendicion, now());
  end if;

  -- Rindió y entregó todo lo digital: se apagan los recordatorios de plazo.
  if new.estado = 'pendiente_verificacion' and old.estado is distinct from 'pendiente_verificacion' then
    update public.notificaciones
       set estado = 'cancelada'
     where recurso_tipo = 'solicitud' and recurso_id = new.id
       and estado = 'pendiente'
       and plantilla in ('plazo_24h','plazo_8h','plazo_vencido');
  end if;

  if new.estado = 'completado' and old.estado is distinct from 'completado' then
    new.fecha_cierre := now();
    update public.notificaciones
       set estado = 'cancelada'
     where recurso_tipo = 'solicitud' and recurso_id = new.id and estado = 'pendiente';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2.3 Avisos del cotejo
-- ---------------------------------------------------------------------
create or replace function public.avisar_verificacion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Entró en verificación: se le recuerda al solicitante que falta el físico
  -- y se le avisa al administrador que debe recibirlo.
  if new.estado = 'pendiente_verificacion' and old.estado is distinct from 'pendiente_verificacion' then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    values ('entregar_fisico', 'ambos', new.solicitante_id, 'solicitud', new.id,
            jsonb_build_object('solicitud', new.id, 'monto', new.monto_solicitado));

    if new.admin_caja_id is not null then
      insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
      values ('fisico_por_recibir', 'whatsapp', new.admin_caja_id, 'solicitud', new.id,
              jsonb_build_object('solicitud', new.id, 'monto', new.monto_solicitado));
    end if;
  end if;

  -- El cotejo encontró diferencias: el solicitante tiene que corregir.
  if new.conforme_fisica is false and old.conforme_fisica is distinct from false then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    values ('documentacion_observada', 'ambos', new.solicitante_id, 'solicitud', new.id,
            jsonb_build_object('solicitud', new.id,
                               'observacion', coalesce(new.observacion_fisica, '')));
  end if;

  return new;
end;
$$;

drop trigger if exists solicitudes_aviso_verificacion on public.solicitudes;
create trigger solicitudes_aviso_verificacion
  after update on public.solicitudes
  for each row execute function public.avisar_verificacion();

-- ---------------------------------------------------------------------
-- 2.4 Nadie cierra su propia solicitud
--
-- El cierre corresponde a quien recibe el físico. Sin esta verificación,
-- un solicitante con permisos podría marcar su propia rendición como
-- conforme y cerrarla sin que nadie haya visto un papel.
-- ---------------------------------------------------------------------
create or replace function public.proteger_cierre()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'completado' and old.estado = 'pendiente_verificacion' then
    if public.rol_actual() not in ('admin_caja','super_admin') then
      raise exception 'Solo el administrador de caja puede cerrar una rendición verificada';
    end if;
    if new.solicitante_id = auth.uid() and public.rol_actual() <> 'super_admin' then
      raise exception 'No se puede cerrar la propia solicitud';
    end if;
    new.fecha_recepcion_fisica := coalesce(new.fecha_recepcion_fisica, now());
    new.verificado_por_id := coalesce(new.verificado_por_id, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists solicitudes_proteger_cierre on public.solicitudes;
create trigger solicitudes_proteger_cierre
  before update on public.solicitudes
  for each row execute function public.proteger_cierre();

-- ---------------------------------------------------------------------
-- 2.5 Solicitudes ya cerradas antes de esta regla
--
-- Quedan como están: se cerraron bajo la norma anterior y reabrirlas
-- distorsionaría los informes de rendición ya presentados.
-- ---------------------------------------------------------------------

-- Verificación
-- reset role;
-- select estado, count(*) from public.solicitudes group by estado order by estado;
