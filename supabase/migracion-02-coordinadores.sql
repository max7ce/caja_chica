-- =====================================================================
-- MIGRACIÓN 02 — Oficinas, coordinadores y aval previo
--
-- La base ya existe: esto se agrega encima, no reemplaza nada.
--
-- IMPORTANTE: ejecutá el §1 SOLO, dale Run, y recién después pegá el
-- resto. Postgres no permite usar un valor nuevo de un enum en la misma
-- transacción en que se crea.
-- =====================================================================

-- ---------------------------------------------------------------------
-- §1. EJECUTAR SOLO ESTA LÍNEA, APARTE
-- ---------------------------------------------------------------------
alter type public.estado_solicitud add value if not exists 'pendiente_coordinador' before 'pendiente_daf';


-- =====================================================================
-- §2. DE AQUÍ EN ADELANTE, TODO JUNTO EN UNA SEGUNDA EJECUCIÓN
-- =====================================================================

-- ---------------------------------------------------------------------
-- 2.1 Oficinas
-- ---------------------------------------------------------------------
create table if not exists public.oficinas (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null unique,
  coordinador_id uuid references public.profiles(id) on delete set null,
  activa         boolean not null default true,
  created_at     timestamptz not null default now()
);

alter table public.profiles add column if not exists oficina_id uuid references public.oficinas(id);
alter table public.profiles add column if not exists cargo text;

create index if not exists idx_profiles_oficina on public.profiles(oficina_id);

-- ---------------------------------------------------------------------
-- 2.2 Campos del aval en la solicitud
--
-- El aval NO corta el circuito: avalada o no, la solicitud llega al DAF.
-- Por eso se guarda como un dictamen (aval_coordinador + observación) y
-- no como un estado terminal.
-- ---------------------------------------------------------------------
alter table public.solicitudes add column if not exists coordinador_id uuid references public.profiles(id);
alter table public.solicitudes add column if not exists aval_coordinador boolean;
alter table public.solicitudes add column if not exists observacion_coordinador text;
alter table public.solicitudes add column if not exists fecha_aval_coordinador timestamptz;
alter table public.solicitudes add column if not exists origen_aval public.origen_accion;

-- ---------------------------------------------------------------------
-- 2.3 Funciones de apoyo
-- ---------------------------------------------------------------------

-- ¿El usuario actual coordina alguna oficina?
create or replace function public.es_coordinador()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.oficinas where coordinador_id = auth.uid() and activa);
$$;
grant execute on function public.es_coordinador() to authenticated;

-- Coordinador que le corresponde a una persona. Devuelve NULL en tres casos,
-- y en los tres la solicitud arranca directamente en el DAF:
--   1. la persona no tiene oficina, o la oficina no tiene coordinador;
--   2. la persona ES la coordinadora — nadie se avala a sí mismo;
--   3. quien coordina esa oficina es además el DAF que aprueba después.
--      Sin esto, el coordinador de la oficina DAF vería cada solicitud de su
--      equipo dos veces: primero para avalar y luego para autorizar.
create or replace function public.coordinador_de(p_usuario uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case
           when o.coordinador_id = p_usuario then null
           when c.role = 'daf' then null
           else o.coordinador_id
         end
  from public.profiles p
  join public.oficinas o on o.id = p.oficina_id
  left join public.profiles c on c.id = o.coordinador_id
  where p.id = p_usuario and o.activa;
$$;
grant execute on function public.coordinador_de(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2.4 Enrutamiento al crear la solicitud
--     Con coordinador -> pendiente_coordinador
--     Sin coordinador, o si quien pide es el coordinador -> pendiente_daf
-- ---------------------------------------------------------------------
create or replace function public.validar_tope()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  tope    numeric;
  v_coord uuid;
begin
  select tope_solicitud into tope from public.parametros where id = 1;
  if new.monto_solicitado > tope then
    raise exception 'El monto supera el tope vigente de % Bs', tope;
  end if;

  new.periodo_id := coalesce(new.periodo_id, public.periodo_vigente());

  v_coord := public.coordinador_de(new.solicitante_id);
  if v_coord is not null then
    new.coordinador_id := v_coord;
    new.estado := 'pendiente_coordinador';
  else
    new.coordinador_id := null;
    new.estado := 'pendiente_daf';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2.5 Avisos
-- ---------------------------------------------------------------------

-- Al crearse: avisa al coordinador, o al DAF si no hay coordinador.
create or replace function public.avisar_solicitud_nueva()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'pendiente_coordinador' and new.coordinador_id is not null then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    values ('solicitud_por_avalar', 'ambos', new.coordinador_id, 'solicitud', new.id,
            jsonb_build_object('solicitud', new.id, 'monto', new.monto_solicitado,
                               'descripcion', new.descripcion));
  else
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    select 'solicitud_nueva', 'ambos', p.id, 'solicitud', new.id,
           jsonb_build_object('solicitud', new.id, 'monto', new.monto_solicitado,
                              'descripcion', new.descripcion)
    from public.profiles p where p.role = 'daf' and p.activo;
  end if;
  return new;
end;
$$;

-- Al pasar el aval: el DAF recibe el aviso solo, con el dictamen incluido.
create or replace function public.avisar_aval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'pendiente_daf' and old.estado = 'pendiente_coordinador' then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    select 'solicitud_avalada', 'ambos', p.id, 'solicitud', new.id,
           jsonb_build_object(
             'solicitud', new.id,
             'monto', new.monto_solicitado,
             'descripcion', new.descripcion,
             'avalada', coalesce(new.aval_coordinador, false),
             'observacion', coalesce(new.observacion_coordinador, '')
           )
    from public.profiles p where p.role = 'daf' and p.activo;

    -- El solicitante se entera del dictamen de su coordinador
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    values ('aval_registrado', 'whatsapp', new.solicitante_id, 'solicitud', new.id,
            jsonb_build_object('solicitud', new.id,
                               'avalada', coalesce(new.aval_coordinador, false),
                               'observacion', coalesce(new.observacion_coordinador, '')));
  end if;
  return new;
end;
$$;

drop trigger if exists solicitudes_aviso_aval on public.solicitudes;
create trigger solicitudes_aviso_aval
  after update on public.solicitudes for each row execute function public.avisar_aval();

-- ---------------------------------------------------------------------
-- 2.6 Seguridad a nivel de fila
-- ---------------------------------------------------------------------
alter table public.oficinas enable row level security;

drop policy if exists oficinas_select on public.oficinas;
create policy oficinas_select on public.oficinas for select to authenticated using (true);

drop policy if exists oficinas_escribir on public.oficinas;
create policy oficinas_escribir on public.oficinas for all to authenticated
  using (public.rol_actual() = 'super_admin')
  with check (public.rol_actual() = 'super_admin');

-- El coordinador ve las solicitudes que le toca avalar, y las de su oficina.
drop policy if exists solicitudes_select on public.solicitudes;
create policy solicitudes_select on public.solicitudes for select to authenticated
  using (
    solicitante_id = auth.uid()
    or public.es_admin()
    or coordinador_id = auth.uid()
  );

-- Puede avalar solo lo suyo y solo mientras está pendiente de aval.
drop policy if exists solicitudes_update on public.solicitudes;
create policy solicitudes_update on public.solicitudes for update to authenticated
  using (
    public.es_operativo()
    or (solicitante_id = auth.uid() and estado in ('desembolsado','pendiente_devolucion'))
    or (coordinador_id = auth.uid() and estado = 'pendiente_coordinador')
  )
  with check (
    public.es_operativo()
    or solicitante_id = auth.uid()
    or coordinador_id = auth.uid()
  );

-- ---------------------------------------------------------------------
-- 2.7 Reporte: cuánto tarda cada eslabón
-- ---------------------------------------------------------------------
drop view if exists public.v_tiempos_aprobacion;
create view public.v_tiempos_aprobacion with (security_invoker = on) as
select
  o.nombre as oficina,
  count(*) as solicitudes,
  round(avg(extract(epoch from (s.fecha_aval_coordinador - s.fecha_creacion)) / 3600)
        filter (where s.fecha_aval_coordinador is not null)::numeric, 1) as horas_hasta_aval,
  count(*) filter (where s.aval_coordinador is false) as sin_aval,
  count(*) filter (where s.estado = 'pendiente_coordinador') as esperando_aval
from public.solicitudes s
join public.profiles p on p.id = s.solicitante_id
left join public.oficinas o on o.id = p.oficina_id
group by o.nombre
order by o.nombre;

grant select on public.v_tiempos_aprobacion to authenticated;

-- ---------------------------------------------------------------------
-- §3. VERIFICACIÓN — debería devolver las oficinas con su coordinador
-- ---------------------------------------------------------------------
-- select o.nombre, p.full_name as coordinador,
--        (select count(*) from public.profiles x where x.oficina_id = o.id) as personas
--   from public.oficinas o
--   left join public.profiles p on p.id = o.coordinador_id
--  order by o.nombre;
