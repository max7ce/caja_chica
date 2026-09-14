-- =====================================================================
-- MIGRACIÓN 03 — QR de cobro propios
--
-- El QR que generaba la aplicación era un texto con los datos del vale:
-- ningún banco lo puede leer. Ahora cada persona guarda la imagen de su
-- propio QR de cobro, y la caja guarda el suyo para las devoluciones.
--
-- Va todo junto, en una sola ejecución.
-- =====================================================================

alter table public.profiles   add column if not exists qr_url text;
alter table public.parametros add column if not exists qr_caja_url text;

-- Bucket aparte de los comprobantes: distinto contenido, distinta vida útil.
insert into storage.buckets (id, name, public)
values ('qr', 'qr', true)
on conflict (id) do nothing;

-- Lectura abierta: el QR de cobro está hecho para mostrarse a quien paga.
drop policy if exists "qr lectura" on storage.objects;
create policy "qr lectura" on storage.objects
  for select using (bucket_id = 'qr');

-- Escritura solo sobre la carpeta propia. Sin esto, cualquier usuario podría
-- reemplazar el QR de otro y desviarse los desembolsos a su cuenta.
drop policy if exists "qr subida" on storage.objects;
create policy "qr subida" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'qr'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.rol_actual() = 'super_admin'
    )
  );

drop policy if exists "qr reemplazo" on storage.objects;
create policy "qr reemplazo" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'qr'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.rol_actual() = 'super_admin'
    )
  );

drop policy if exists "qr borrado" on storage.objects;
create policy "qr borrado" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'qr'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.rol_actual() = 'super_admin'
    )
  );

-- Verificación: quiénes todavía no cargaron su QR.
--
-- reset role;
-- select full_name, email from public.profiles
--  where qr_url is null and activo and role = 'solicitante'
--  order by full_name;
