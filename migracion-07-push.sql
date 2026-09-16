-- =====================================================================
-- MIGRACIÓN 07 — Notificaciones push a la aplicación instalada
--
-- Cada navegador donde alguien instala la app genera una suscripción
-- distinta. Una misma persona puede tener varias: el celular, la
-- computadora de la oficina. Todas reciben.
--
-- La clave pública VAPID se guarda en parámetros, no en una variable de
-- entorno, para poder cambiarla sin volver a desplegar la aplicación.
--
-- Va todo junto, en una sola ejecución.
-- =====================================================================

reset role;

alter table public.parametros add column if not exists vapid_public_key text;

create table if not exists public.push_suscripciones (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  activa      boolean not null default true,
  ultimo_uso  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_push_usuario on public.push_suscripciones(usuario_id) where activa;

alter table public.push_suscripciones enable row level security;

-- Cada quien administra las suscripciones de sus propios dispositivos.
drop policy if exists push_select on public.push_suscripciones;
create policy push_select on public.push_suscripciones
  for select to authenticated
  using (usuario_id = auth.uid() or public.rol_actual() = 'super_admin');

drop policy if exists push_insert on public.push_suscripciones;
create policy push_insert on public.push_suscripciones
  for insert to authenticated
  with check (usuario_id = auth.uid());

drop policy if exists push_update on public.push_suscripciones;
create policy push_update on public.push_suscripciones
  for update to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

drop policy if exists push_delete on public.push_suscripciones;
create policy push_delete on public.push_suscripciones
  for delete to authenticated
  using (usuario_id = auth.uid() or public.rol_actual() = 'super_admin');

-- ---------------------------------------------------------------------
-- Clave pública VAPID de este proyecto.
-- Si alguna vez se regenera el par de claves, hay que actualizar las dos:
-- esta y la privada en las variables de Netlify.
-- ---------------------------------------------------------------------
update public.parametros
   set vapid_public_key = 'BMYuTFRU9SnE7dyCmlN1JBYzF6nOLY9lI6YM2yHMfuZxcisQBFU73r--iy2ZiJLoXSc_Ma-1kGv_hMvx1tkRIFc'
 where id = 1;

-- Verificación
-- reset role;
-- select p.full_name, count(s.id) as dispositivos
--   from public.profiles p
--   left join public.push_suscripciones s on s.usuario_id = p.id and s.activa
--  group by p.full_name having count(s.id) > 0;
