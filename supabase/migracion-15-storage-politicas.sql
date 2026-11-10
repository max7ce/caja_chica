-- =====================================================================
-- caja_chica · Migración 15 · Storage: acceso por dueño y límites
-- Aplicada el 10-nov-2026 (historial Supabase: storage_politicas_por_dueno).
-- Compatible con buckets públicos; la 16 los vuelve privados.
-- =====================================================================

-- Extrae el id de solicitud de rutas tipo "solicitud-<uuid>/archivo.ext"
create or replace function public.solicitud_de_archivo(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^solicitud-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then substring((storage.foldername(p_name))[1] from 11)::uuid
  end;
$$;
revoke execute on function public.solicitud_de_archivo(text) from public, anon;
grant execute on function public.solicitud_de_archivo(text) to authenticated;

drop policy if exists "comprobantes lectura" on storage.objects;
drop policy if exists "comprobantes subida"  on storage.objects;

-- Lectura: administrativos, o quien puede ver la solicitud (lo decide el RLS de solicitudes)
create policy "comprobantes lectura" on storage.objects for select to authenticated
  using (
    bucket_id = 'comprobantes'
    and ((select public.es_admin())
         or exists (select 1 from public.solicitudes s
                    where s.id = public.solicitud_de_archivo(name)))
  );

-- Subida: el solicitante a su propia solicitud; los operativos a cualquier ruta
create policy "comprobantes subida" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'comprobantes'
    and ((select public.es_operativo())
         or exists (select 1 from public.solicitudes s
                    where s.id = public.solicitud_de_archivo(name)
                      and s.solicitante_id = (select auth.uid())))
  );

drop policy if exists "qr lectura" on storage.objects;
create policy "qr lectura" on storage.objects for select to authenticated
  using (bucket_id = 'qr');

update storage.buckets
   set file_size_limit = 5 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf']
 where id = 'comprobantes';

update storage.buckets
   set file_size_limit = 2 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg','image/png','image/webp']
 where id = 'qr';
