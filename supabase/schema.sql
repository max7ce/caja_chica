-- =====================================================================
-- CAJA CHICA — Esquema completo (Fase 3, sobre la Fase 2 corregida)
-- Pegar ENTERO en Supabase → SQL Editor → Run. Una sola vez.
--
-- Incluye: períodos de gestión rotativos, parámetros editables,
-- plazo de 48 horas que se pausa sábado y domingo, bloqueo por
-- rendición vencida, rol de contabilidad de solo lectura, agenda de
-- notificaciones por WhatsApp y correo, y tokens de aprobación.
--
-- Si alguna vez corriste el esquema anterior, ejecutá primero el
-- bloque §0 para limpiar. Si es la primera vez, saltealo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- §0. REINICIO (solo si ya existía una versión previa) — descomentar
-- ---------------------------------------------------------------------
-- drop table if exists public.notificaciones, public.notificaciones_pendientes,
--   public.tokens_accion, public.informe_solicitudes, public.movimientos_caja,
--   public.comprobantes, public.solicitudes, public.informe_rendicion_cuentas,
--   public.periodos_gestion, public.parametros, public.profiles cascade;
-- drop view if exists public.v_saldo_caja, public.v_rendiciones_por_admin cascade;
-- drop type if exists public.rol_usuario, public.estado_solicitud, public.tipo_comprobante,
--   public.estado_informe, public.tipo_movimiento, public.estado_movimiento,
--   public.canal_aviso, public.estado_aviso, public.recurso_tipo, public.accion_token,
--   public.origen_accion, public.estado_periodo cascade;

-- ---------------------------------------------------------------------
-- §1. TIPOS
-- ---------------------------------------------------------------------
do $$ begin
  create type public.rol_usuario as enum
    ('super_admin','solicitante','daf','admin_caja','contabilidad');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_solicitud as enum
    ('pendiente_daf','aprobado_daf','desembolsado','pendiente_devolucion','completado','rechazado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tipo_comprobante as enum ('compra','devolucion');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_informe as enum
    ('borrador','pendiente_daf','aprobado_daf','completado','rechazado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tipo_movimiento as enum ('desembolso','devolucion','reposicion');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_movimiento as enum ('pendiente_validacion','aprobado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_periodo as enum ('vigente','cerrado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.canal_aviso as enum ('whatsapp','correo','ambos');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_aviso as enum ('pendiente','enviada','fallida','cancelada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.recurso_tipo as enum ('solicitud','informe');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.accion_token as enum ('aprobar','rechazar');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.origen_accion as enum ('app','whatsapp','correo');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- §2. TABLAS
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text unique not null,
  full_name      text,
  role           public.rol_usuario not null default 'solicitante',
  departamento   text,
  telefono       text,                       -- formato E.164: +59171234567
  whatsapp_optin boolean not null default false,
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Parámetros del negocio: una sola fila, editable por super_admin.
create table if not exists public.parametros (
  id                    int primary key default 1 check (id = 1),
  tope_solicitud        numeric(10,2) not null default 700,
  umbral_reposicion     numeric(10,2) not null default 2000,
  monto_reposicion      numeric(10,2) not null default 7000,
  plazo_rendicion_horas int not null default 48,
  pausar_fin_semana     boolean not null default true,
  bloquear_si_vencida   boolean not null default true,
  zona_horaria          text not null default 'America/La_Paz',
  correos_contabilidad  text[] not null default '{}',
  updated_at            timestamptz not null default now()
);
insert into public.parametros (id) values (1) on conflict (id) do nothing;

-- El cargo de administrador de caja es rotativo: cada gestión es un período.
create table if not exists public.periodos_gestion (
  id             uuid primary key default gen_random_uuid(),
  admin_caja_id  uuid not null references public.profiles(id),
  etiqueta       text not null,
  fecha_inicio   timestamptz not null default now(),
  fecha_fin      timestamptz,
  fondo_asignado numeric(10,2) not null default 7000,
  estado         public.estado_periodo not null default 'vigente',
  created_at     timestamptz not null default now()
);
-- Solo puede haber un período vigente a la vez.
create unique index if not exists idx_un_periodo_vigente
  on public.periodos_gestion ((estado = 'vigente')) where estado = 'vigente';

create table if not exists public.solicitudes (
  id                       uuid primary key default gen_random_uuid(),
  solicitante_id           uuid not null references public.profiles(id),
  periodo_id               uuid references public.periodos_gestion(id),
  monto_solicitado         numeric(10,2) not null check (monto_solicitado > 0),
  monto_real               numeric(10,2) check (monto_real >= 0),
  descripcion              text not null,
  categoria                text,
  estado                   public.estado_solicitud not null default 'pendiente_daf',
  motivo_rechazo           text,
  origen_decision          public.origen_accion,
  fecha_creacion           timestamptz not null default now(),
  fecha_desembolso         timestamptz,
  limite_tiempo_devolucion timestamptz,
  fecha_rendicion          timestamptz,   -- cuándo reportó el gasto
  fecha_cierre             timestamptz,   -- cuándo quedó cerrada
  admin_caja_id            uuid references public.profiles(id),
  aprobado_por_id          uuid references public.profiles(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists idx_sol_solicitante on public.solicitudes(solicitante_id);
create index if not exists idx_sol_estado on public.solicitudes(estado);
create index if not exists idx_sol_periodo on public.solicitudes(periodo_id);

create table if not exists public.comprobantes (
  id            uuid primary key default gen_random_uuid(),
  solicitud_id  uuid not null references public.solicitudes(id) on delete cascade,
  archivo_url   text not null,
  tipo          public.tipo_comprobante not null,
  descripcion   text,
  fecha_subida  timestamptz not null default now(),
  subido_por_id uuid not null references public.profiles(id),
  created_at    timestamptz not null default now()
);
create index if not exists idx_comp_solicitud on public.comprobantes(solicitud_id);

create table if not exists public.informe_rendicion_cuentas (
  id                   uuid primary key default gen_random_uuid(),
  periodo_id           uuid references public.periodos_gestion(id),
  admin_caja_id        uuid not null references public.profiles(id),
  monto_reposicion     numeric(10,2) not null default 7000,
  fecha_inicio_periodo timestamptz,
  fecha_fin_periodo    timestamptz,
  estado               public.estado_informe not null default 'borrador',
  total_desembolsado   numeric(10,2) not null default 0,
  total_devuelto       numeric(10,2) not null default 0,
  saldo_cuenta         numeric(10,2) not null default 0,
  observaciones        text,
  fecha_creacion       timestamptz not null default now(),
  fecha_envio_daf      timestamptz,
  fecha_aprobacion_daf timestamptz,
  aprobado_por_id      uuid references public.profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists public.informe_solicitudes (
  id           uuid primary key default gen_random_uuid(),
  informe_id   uuid not null references public.informe_rendicion_cuentas(id) on delete cascade,
  solicitud_id uuid not null references public.solicitudes(id),
  created_at   timestamptz not null default now(),
  unique (solicitud_id)
);

create table if not exists public.movimientos_caja (
  id                uuid primary key default gen_random_uuid(),
  tipo              public.tipo_movimiento not null,
  monto             numeric(10,2) not null check (monto > 0),
  periodo_id        uuid references public.periodos_gestion(id),
  solicitud_id      uuid references public.solicitudes(id) on delete set null,
  informe_id        uuid references public.informe_rendicion_cuentas(id) on delete set null,
  admin_caja_id     uuid references public.profiles(id),
  registrado_por_id uuid not null references public.profiles(id) default auth.uid(),
  descripcion       text,
  comprobante_url   text,
  aprobado_por_id   uuid references public.profiles(id),
  estado            public.estado_movimiento not null default 'pendiente_validacion',
  origen            public.origen_accion not null default 'app',
  created_at        timestamptz not null default now()
);
create index if not exists idx_mov_estado on public.movimientos_caja(estado);
create index if not exists idx_mov_periodo on public.movimientos_caja(periodo_id);

-- Agenda de avisos: no es una cola, tiene fecha programada y se cancela.
create table if not exists public.notificaciones (
  id              uuid primary key default gen_random_uuid(),
  plantilla       text not null,
  canal           public.canal_aviso not null default 'correo',
  destinatario_id uuid not null references public.profiles(id),
  copia_ids       uuid[] not null default '{}',
  recurso_tipo    public.recurso_tipo not null,
  recurso_id      uuid not null,
  variables       jsonb not null default '{}'::jsonb,
  programada_para timestamptz not null default now(),
  estado          public.estado_aviso not null default 'pendiente',
  intentos        int not null default 0,
  proveedor_id    text,
  error           text,
  enviada_en      timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_notif_agenda
  on public.notificaciones(estado, programada_para) where estado = 'pendiente';
create index if not exists idx_notif_recurso on public.notificaciones(recurso_tipo, recurso_id);

-- Un token de un solo uso por cada decisión ofrecida en un mensaje.
create table if not exists public.tokens_accion (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique,
  usuario_id   uuid not null references public.profiles(id),
  recurso_tipo public.recurso_tipo not null,
  recurso_id   uuid not null,
  accion       public.accion_token not null,
  expira_en    timestamptz not null default now() + interval '24 hours',
  usado_en     timestamptz,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- §3. FUNCIONES DE APOYO
-- ---------------------------------------------------------------------

-- Rol del usuario actual. SECURITY DEFINER para que las políticas sobre
-- profiles puedan consultarlo sin invocarse a sí mismas (recursión).
create or replace function public.rol_actual()
returns public.rol_usuario language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;
grant execute on function public.rol_actual() to authenticated;

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid())
    in ('super_admin','daf','admin_caja','contabilidad'), false);
$$;
grant execute on function public.es_admin() to authenticated;

create or replace function public.es_operativo()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid())
    in ('super_admin','daf','admin_caja'), false);
$$;
grant execute on function public.es_operativo() to authenticated;

-- Suma horas saltando sábados y domingos, en hora local de Bolivia.
-- Un desembolso del viernes al mediodía vence el martes al mediodía.
create or replace function public.vencimiento_habil(desde timestamptz, horas int)
returns timestamptz language plpgsql stable set search_path = public as $$
declare
  tz        text;
  pausar    boolean;
  local_ts  timestamp;
  restantes int := horas;
begin
  select zona_horaria, pausar_fin_semana into tz, pausar from public.parametros where id = 1;
  tz := coalesce(tz, 'America/La_Paz');

  if not coalesce(pausar, true) then
    return desde + (horas || ' hours')::interval;
  end if;

  local_ts := desde at time zone tz;
  while restantes > 0 loop
    local_ts := local_ts + interval '1 hour';
    if extract(isodow from local_ts) < 6 then     -- 6 = sábado, 7 = domingo
      restantes := restantes - 1;
    end if;
  end loop;
  return local_ts at time zone tz;
end;
$$;
grant execute on function public.vencimiento_habil(timestamptz, int) to authenticated;

-- ¿Este usuario tiene alguna rendición pasada de plazo?
-- SECURITY DEFINER para poder usarla dentro de la política de solicitudes
-- sin que la subconsulta dispare RLS sobre la misma tabla.
create or replace function public.tiene_rendicion_vencida(p_usuario uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.solicitudes
    where solicitante_id = p_usuario
      and estado in ('desembolsado','pendiente_devolucion')
      and limite_tiempo_devolucion is not null
      and limite_tiempo_devolucion < now()
  );
$$;
grant execute on function public.tiene_rendicion_vencida(uuid) to authenticated;

create or replace function public.periodo_vigente()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.periodos_gestion where estado = 'vigente' limit 1;
$$;
grant execute on function public.periodo_vigente() to authenticated;

-- ---------------------------------------------------------------------
-- §4. TRIGGERS
-- ---------------------------------------------------------------------

-- 4.1 Alta automática del perfil al registrarse el usuario
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, departamento, telefono, role)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'departamento',
    new.raw_user_meta_data->>'telefono',
    'solicitante'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- 4.2 Solo el super_admin cambia roles (una política WITH CHECK no puede
--     comparar el valor viejo con el nuevo; por eso va en un trigger)
create or replace function public.proteger_rol()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and public.rol_actual() <> 'super_admin' then
    raise exception 'Solo un super_admin puede cambiar el rol de un usuario';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists profiles_proteger_rol on public.profiles;
create trigger profiles_proteger_rol
  before update on public.profiles for each row execute function public.proteger_rol();

-- 4.3 Tope de la solicitud leído de parámetros (no hardcodeado)
create or replace function public.validar_tope()
returns trigger language plpgsql security definer set search_path = public as $$
declare tope numeric;
begin
  select tope_solicitud into tope from public.parametros where id = 1;
  if new.monto_solicitado > tope then
    raise exception 'El monto supera el tope vigente de % Bs', tope;
  end if;
  new.periodo_id := coalesce(new.periodo_id, public.periodo_vigente());
  return new;
end;
$$;
drop trigger if exists solicitudes_tope on public.solicitudes;
create trigger solicitudes_tope
  before insert on public.solicitudes for each row execute function public.validar_tope();

-- 4.4 Al desembolsar: calcula el vencimiento hábil y agenda los tres avisos
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

  -- Rindió: se cancelan los recordatorios que quedaban en la agenda
  if new.estado in ('completado','pendiente_devolucion')
     and old.estado is distinct from new.estado then
    new.fecha_rendicion := coalesce(new.fecha_rendicion, now());
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
drop trigger if exists solicitudes_desembolso on public.solicitudes;
create trigger solicitudes_desembolso
  before update on public.solicitudes for each row execute function public.marcar_desembolso();

-- 4.5 Aviso al DAF cuando entra una solicitud nueva
create or replace function public.avisar_solicitud_nueva()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
  select 'solicitud_nueva', 'ambos', p.id, 'solicitud', new.id,
         jsonb_build_object('solicitud', new.id, 'monto', new.monto_solicitado,
                            'descripcion', new.descripcion)
  from public.profiles p where p.role = 'daf' and p.activo;
  return new;
end;
$$;
drop trigger if exists solicitudes_aviso_nueva on public.solicitudes;
create trigger solicitudes_aviso_nueva
  after insert on public.solicitudes for each row execute function public.avisar_solicitud_nueva();

-- ---------------------------------------------------------------------
-- §5. VISTAS
-- ---------------------------------------------------------------------

drop view if exists public.v_saldo_caja;
create view public.v_saldo_caja with (security_invoker = on) as
select
  periodo_id,
  coalesce(sum(case when tipo in ('reposicion','devolucion') then monto else -monto end),0)::numeric(10,2) as saldo,
  coalesce(sum(case when tipo = 'desembolso' then monto else 0 end),0)::numeric(10,2) as total_desembolsado,
  coalesce(sum(case when tipo = 'devolucion' then monto else 0 end),0)::numeric(10,2) as total_devuelto,
  coalesce(sum(case when tipo = 'reposicion' then monto else 0 end),0)::numeric(10,2) as total_repuesto
from public.movimientos_caja
where estado = 'aprobado'
group by periodo_id;

grant select on public.v_saldo_caja to authenticated;

-- Reporte para el DAF: cómo rindió cada responsable en su gestión.
-- Los agregados se calculan por separado: unir informes y solicitudes en una
-- sola consulta multiplicaría las filas y falsearía los conteos.
drop view if exists public.v_rendiciones_por_admin;
create view public.v_rendiciones_por_admin with (security_invoker = on) as
with inf as (
  select
    periodo_id,
    count(*) filter (where estado <> 'borrador')                       as informes,
    coalesce(sum(total_desembolsado) filter (where estado <> 'borrador'), 0) as monto_rendido,
    round((avg(extract(epoch from (fecha_aprobacion_daf - fecha_envio_daf)) / 86400)
           filter (where fecha_aprobacion_daf is not null and fecha_envio_daf is not null))::numeric, 1)
                                                                       as dias_aprobacion,
    count(*) filter (where estado in ('borrador','pendiente_daf'))     as informes_abiertos
  from public.informe_rendicion_cuentas
  group by periodo_id
),
sol as (
  select
    periodo_id,
    count(*) as solicitudes,
    round(100.0 * count(*) filter (
            where fecha_rendicion is not null
              and fecha_rendicion <= limite_tiempo_devolucion)
          / nullif(count(*) filter (where limite_tiempo_devolucion is not null), 0), 0)
                                                                       as pct_en_plazo
  from public.solicitudes
  group by periodo_id
)
select
  pg.id            as periodo_id,
  pg.admin_caja_id,
  pr.full_name     as admin_nombre,
  pg.etiqueta      as periodo,
  pg.estado        as estado_periodo,
  coalesce(inf.informes, 0)              as informes,
  coalesce(inf.monto_rendido, 0)::numeric(12,2) as monto_rendido,
  inf.dias_aprobacion,
  coalesce(inf.informes_abiertos, 0)     as informes_abiertos,
  coalesce(sol.solicitudes, 0)           as solicitudes,
  sol.pct_en_plazo
from public.periodos_gestion pg
join public.profiles pr on pr.id = pg.admin_caja_id
left join inf on inf.periodo_id = pg.id
left join sol on sol.periodo_id = pg.id
order by pg.fecha_inicio desc;

grant select on public.v_rendiciones_por_admin to authenticated;

-- ---------------------------------------------------------------------
-- §6. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles                  enable row level security;
alter table public.parametros                enable row level security;
alter table public.periodos_gestion          enable row level security;
alter table public.solicitudes               enable row level security;
alter table public.comprobantes              enable row level security;
alter table public.informe_rendicion_cuentas enable row level security;
alter table public.informe_solicitudes       enable row level security;
alter table public.movimientos_caja          enable row level security;
alter table public.notificaciones            enable row level security;
alter table public.tokens_accion             enable row level security;

-- 6.1 profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.es_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.rol_actual() = 'super_admin')
  with check (id = auth.uid() or public.rol_actual() = 'super_admin');

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.rol_actual() = 'super_admin');

-- 6.2 parametros — todos leen (la app valida con ellos), solo super_admin escribe
drop policy if exists parametros_select on public.parametros;
create policy parametros_select on public.parametros for select to authenticated using (true);

drop policy if exists parametros_update on public.parametros;
create policy parametros_update on public.parametros for update to authenticated
  using (public.rol_actual() = 'super_admin') with check (public.rol_actual() = 'super_admin');

-- 6.3 periodos_gestion
drop policy if exists periodos_select on public.periodos_gestion;
create policy periodos_select on public.periodos_gestion for select to authenticated using (true);

drop policy if exists periodos_escribir on public.periodos_gestion;
create policy periodos_escribir on public.periodos_gestion for all to authenticated
  using (public.rol_actual() = 'super_admin') with check (public.rol_actual() = 'super_admin');

-- 6.4 solicitudes
drop policy if exists solicitudes_select on public.solicitudes;
create policy solicitudes_select on public.solicitudes for select to authenticated
  using (solicitante_id = auth.uid() or public.es_admin());

-- Bloqueo: no se puede pedir un vale nuevo con una rendición vencida encima.
drop policy if exists solicitudes_insert on public.solicitudes;
create policy solicitudes_insert on public.solicitudes for insert to authenticated
  with check (
    solicitante_id = auth.uid()
    and public.rol_actual() in ('solicitante','super_admin')
    and not (
      (select bloquear_si_vencida from public.parametros where id = 1)
      and public.tiene_rendicion_vencida(auth.uid())
    )
  );

drop policy if exists solicitudes_update on public.solicitudes;
create policy solicitudes_update on public.solicitudes for update to authenticated
  using (
    public.es_operativo()
    or (solicitante_id = auth.uid() and estado in ('desembolsado','pendiente_devolucion'))
  )
  with check (public.es_operativo() or solicitante_id = auth.uid());

-- 6.5 comprobantes
drop policy if exists comprobantes_select on public.comprobantes;
create policy comprobantes_select on public.comprobantes for select to authenticated
  using (subido_por_id = auth.uid() or public.es_admin());

drop policy if exists comprobantes_insert on public.comprobantes;
create policy comprobantes_insert on public.comprobantes for insert to authenticated
  with check (subido_por_id = auth.uid());

-- 6.6 informes — contabilidad ve, no toca
drop policy if exists informes_select on public.informe_rendicion_cuentas;
create policy informes_select on public.informe_rendicion_cuentas for select to authenticated
  using (public.es_admin());

drop policy if exists informes_insert on public.informe_rendicion_cuentas;
create policy informes_insert on public.informe_rendicion_cuentas for insert to authenticated
  with check (public.rol_actual() in ('admin_caja','super_admin'));

drop policy if exists informes_update on public.informe_rendicion_cuentas;
create policy informes_update on public.informe_rendicion_cuentas for update to authenticated
  using (public.rol_actual() in ('admin_caja','daf','super_admin'))
  with check (public.rol_actual() in ('admin_caja','daf','super_admin'));

drop policy if exists informe_sol_select on public.informe_solicitudes;
create policy informe_sol_select on public.informe_solicitudes for select to authenticated
  using (public.es_admin());

drop policy if exists informe_sol_escribir on public.informe_solicitudes;
create policy informe_sol_escribir on public.informe_solicitudes for all to authenticated
  using (public.rol_actual() in ('admin_caja','super_admin'))
  with check (public.rol_actual() in ('admin_caja','super_admin'));

-- 6.7 movimientos
drop policy if exists movimientos_select on public.movimientos_caja;
create policy movimientos_select on public.movimientos_caja for select to authenticated
  using (
    public.es_admin()
    or exists (select 1 from public.solicitudes s
               where s.id = movimientos_caja.solicitud_id and s.solicitante_id = auth.uid())
  );

drop policy if exists movimientos_insert on public.movimientos_caja;
create policy movimientos_insert on public.movimientos_caja for insert to authenticated
  with check (
    public.rol_actual() in ('admin_caja','super_admin')
    or (tipo = 'devolucion' and estado = 'pendiente_validacion'
        and exists (select 1 from public.solicitudes s
                    where s.id = solicitud_id and s.solicitante_id = auth.uid()))
  );

drop policy if exists movimientos_update on public.movimientos_caja;
create policy movimientos_update on public.movimientos_caja for update to authenticated
  using (public.rol_actual() in ('admin_caja','super_admin'))
  with check (public.rol_actual() in ('admin_caja','super_admin'));

-- 6.8 notificaciones — lectura; el envío lo hace el despachador con service_role
drop policy if exists notif_select on public.notificaciones;
create policy notif_select on public.notificaciones for select to authenticated
  using (destinatario_id = auth.uid() or public.es_admin());

drop policy if exists notif_insert on public.notificaciones;
create policy notif_insert on public.notificaciones for insert to authenticated
  with check (public.es_operativo());

-- 6.9 tokens_accion — ninguna política: nadie los lee desde el navegador.
--     Solo el webhook, que usa service_role y no pasa por RLS.

-- ---------------------------------------------------------------------
-- §7. STORAGE
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('comprobantes','comprobantes', true) on conflict (id) do nothing;

drop policy if exists "comprobantes lectura" on storage.objects;
create policy "comprobantes lectura" on storage.objects
  for select using (bucket_id = 'comprobantes');

drop policy if exists "comprobantes subida" on storage.objects;
create policy "comprobantes subida" on storage.objects
  for insert to authenticated with check (bucket_id = 'comprobantes');

-- ---------------------------------------------------------------------
-- §8. PASO ÚNICO MANUAL
--
-- a) Authentication → Users → Add user (correo y contraseña).
-- b) Reemplazá el correo y ejecutá estas dos líneas:
--
--    update public.profiles set role = 'super_admin' where email = 'tucorreo@ucb.edu.bo';
--
--    insert into public.periodos_gestion (admin_caja_id, etiqueta, fondo_asignado)
--    select id, 'Gestión inicial', 7000 from public.profiles where email = 'tucorreo@ucb.edu.bo';
--
-- Sin período vigente las solicitudes no se pueden atribuir a ninguna gestión.
-- ---------------------------------------------------------------------
