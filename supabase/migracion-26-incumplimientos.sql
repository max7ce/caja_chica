-- =====================================================================
-- caja_chica · Migración 26 · Rendiciones fuera de plazo: aviso del DAF
-- e historial de incumplimientos
--
-- Cuando vence el plazo y el solicitante no rindió, el sistema:
--   1. registra el incumplimiento (queda en el historial aunque luego rinda);
--   2. avisa al solicitante, a nombre del DAF, que está fuera de plazo y
--      debe justificarlo (plantilla plazo_vencido, ya agendada al desembolsar);
--   3. avisa al DAF, que puede escribirle por WhatsApp desde la app.
-- La justificación puede darse fuera del sistema; el DAF la registra aquí.
-- La detección corre en el despachador cada 15 minutos y, además, al
-- rendir tarde (por si rinde entre dos pasadas).
-- =====================================================================

create table if not exists public.incumplimientos_rendicion (
  id                  uuid primary key default gen_random_uuid(),
  solicitud_id        uuid not null unique references public.solicitudes(id) on delete cascade,
  solicitante_id      uuid not null references public.profiles(id),
  periodo_id          uuid references public.periodos_gestion(id),
  monto               numeric(12,2) not null,
  fecha_desembolso    timestamptz,
  fecha_limite        timestamptz not null,
  detectado_en        timestamptz not null default now(),
  regularizado_en     timestamptz,
  justificacion       text not null default 'pendiente'
                      check (justificacion in ('pendiente','justificado','no_justificado')),
  nota_justificacion  text,
  justificado_por_id  uuid references public.profiles(id),
  fecha_justificacion timestamptz,
  recordatorios       int not null default 0,
  ultimo_recordatorio timestamptz
);
create index if not exists idx_incumplimientos_solicitante on public.incumplimientos_rendicion (solicitante_id);
create index if not exists idx_incumplimientos_periodo on public.incumplimientos_rendicion (periodo_id);

alter table public.incumplimientos_rendicion enable row level security;

drop policy if exists incumplimientos_select on public.incumplimientos_rendicion;
create policy incumplimientos_select on public.incumplimientos_rendicion for select to authenticated
  using ((select public.es_admin()) or solicitante_id = (select auth.uid()));

drop policy if exists incumplimientos_update on public.incumplimientos_rendicion;
create policy incumplimientos_update on public.incumplimientos_rendicion for update to authenticated
  using ((select public.rol_actual()) in ('daf','super_admin'))
  with check ((select public.rol_actual()) in ('daf','super_admin'));
-- Sin políticas de insert ni delete: el historial lo escribe solo la base.

-- ---------- El DAF registra la justificación y los recordatorios; nada más
create or replace function public.proteger_incumplimiento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.rol_actual() = 'super_admin' then return new; end if;
  if new.solicitud_id is distinct from old.solicitud_id
     or new.solicitante_id is distinct from old.solicitante_id
     or new.periodo_id is distinct from old.periodo_id
     or new.monto is distinct from old.monto
     or new.fecha_desembolso is distinct from old.fecha_desembolso
     or new.fecha_limite is distinct from old.fecha_limite
     or new.detectado_en is distinct from old.detectado_en
     or new.regularizado_en is distinct from old.regularizado_en then
    raise exception 'El historial de incumplimientos no se modifica; solo se registra la justificación';
  end if;
  if new.justificacion is distinct from old.justificacion or new.nota_justificacion is distinct from old.nota_justificacion then
    if new.justificacion <> 'pendiente' and coalesce(trim(new.nota_justificacion), '') = '' then
      raise exception 'Anota cómo justificó (o por qué no) el solicitante';
    end if;
    new.justificado_por_id  := auth.uid();
    new.fecha_justificacion := now();
  end if;
  if new.recordatorios is distinct from old.recordatorios then
    new.ultimo_recordatorio := now();
  end if;
  return new;
end; $$;
revoke execute on function public.proteger_incumplimiento() from public, anon, authenticated;

drop trigger if exists incumplimientos_proteger on public.incumplimientos_rendicion;
create trigger incumplimientos_proteger
  before update on public.incumplimientos_rendicion
  for each row execute function public.proteger_incumplimiento();

-- ---------- Detección: vales con el plazo vencido y sin rendir
create or replace function public.registrar_incumplimientos(p_avisar boolean default true)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  with nuevos as (
    insert into public.incumplimientos_rendicion
           (solicitud_id, solicitante_id, periodo_id, monto, fecha_desembolso, fecha_limite)
    select s.id, s.solicitante_id, s.periodo_id, s.monto_solicitado, s.fecha_desembolso, s.limite_tiempo_devolucion
      from public.solicitudes s
     where s.estado in ('desembolsado','pendiente_devolucion')
       and s.limite_tiempo_devolucion is not null
       and s.limite_tiempo_devolucion < now()
    on conflict (solicitud_id) do nothing
    returning id, solicitud_id, solicitante_id, monto, fecha_limite
  ), avisos as (
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    select 'rendicion_vencida_daf', 'ambos', d.id, 'solicitud', n.solicitud_id,
           jsonb_build_object('solicitud', n.solicitud_id, 'monto', n.monto, 'limite', n.fecha_limite,
                              'solicitante', p.full_name, 'descripcion', s.descripcion)
      from nuevos n
      join public.profiles p on p.id = n.solicitante_id
      join public.solicitudes s on s.id = n.solicitud_id
      join public.profiles d on d.role = 'daf' and d.activo
     where p_avisar
    returning 1
  )
  select count(*) into v_n from nuevos;
  return v_n;
end; $$;
revoke execute on function public.registrar_incumplimientos(boolean) from public, anon, authenticated;
grant execute on function public.registrar_incumplimientos(boolean) to service_role;

-- ---------- Al rendir: marca la regularización (y registra si rindió tarde entre dos pasadas)
create or replace function public.regularizar_incumplimiento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado in ('pendiente_verificacion','completado')
     and old.estado in ('desembolsado','pendiente_devolucion') then
    if new.limite_tiempo_devolucion is not null and new.limite_tiempo_devolucion < now() then
      insert into public.incumplimientos_rendicion
             (solicitud_id, solicitante_id, periodo_id, monto, fecha_desembolso, fecha_limite, regularizado_en)
      values (new.id, new.solicitante_id, new.periodo_id, new.monto_solicitado, new.fecha_desembolso,
              new.limite_tiempo_devolucion, now())
      on conflict (solicitud_id) do nothing;
    end if;
    update public.incumplimientos_rendicion
       set regularizado_en = now()
     where solicitud_id = new.id and regularizado_en is null;
  end if;
  return new;
end; $$;
revoke execute on function public.regularizar_incumplimiento() from public, anon, authenticated;

drop trigger if exists solicitudes_regularizar on public.solicitudes;
create trigger solicitudes_regularizar
  after update on public.solicitudes
  for each row execute function public.regularizar_incumplimiento();

-- ---------- El aviso al solicitante sale a nombre del DAF, por push y correo
update public.notificaciones set canal = 'ambos'
 where plantilla = 'plazo_vencido' and estado = 'pendiente';

create or replace function public.canal_plazo_vencido()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.plantilla = 'plazo_vencido' then new.canal := 'ambos'; end if;
  return new;
end; $$;
revoke execute on function public.canal_plazo_vencido() from public, anon, authenticated;
drop trigger if exists notificaciones_canal_vencido on public.notificaciones;
create trigger notificaciones_canal_vencido
  before insert on public.notificaciones
  for each row execute function public.canal_plazo_vencido();

-- ---------- Historial de lo ya vencido, sin avisar a nadie
select public.registrar_incumplimientos(false);
