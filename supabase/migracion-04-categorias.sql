-- =====================================================================
-- MIGRACIÓN 04 — Categorías administrables
--
-- Estaban escritas en el código: agregar una obligaba a redesplegar.
-- Ahora viven en la base y se administran desde la aplicación.
--
-- La solicitud sigue guardando el NOMBRE de la categoría, no su id.
-- Es deliberado: si mañana se renombra "Materiales" a "Material de
-- escritorio", los vales de 2026 deben seguir diciendo lo que decían
-- cuando se pidieron.
--
-- IMPORTANTE: la primera línea es parte de la ejecución.
-- =====================================================================

reset role;

create table if not exists public.categorias (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  activa     boolean not null default true,
  orden      int not null default 100,
  created_at timestamptz not null default now()
);

insert into public.categorias (nombre, orden) values
  ('Materiales', 10),
  ('Refrigerios', 20),
  ('Transporte', 30),
  ('Mantenimiento', 40),
  ('Imprenta', 50),
  ('Otros', 900)
on conflict (nombre) do nothing;

alter table public.categorias enable row level security;

drop policy if exists categorias_select on public.categorias;
create policy categorias_select on public.categorias
  for select to authenticated using (true);

drop policy if exists categorias_escribir on public.categorias;
create policy categorias_escribir on public.categorias
  for all to authenticated
  using (public.rol_actual() = 'super_admin')
  with check (public.rol_actual() = 'super_admin');

-- Verificación
-- reset role;
-- select nombre, activa, orden from public.categorias order by orden;
