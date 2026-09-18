-- =====================================================================
-- MIGRACIÓN 10 — NIT de la institución
--
-- La factura solo sirve como crédito fiscal si está emitida a nombre de
-- la universidad. El NIT vive en parámetros y no en el código: si algún
-- día cambia, se corrige sin volver a desplegar.
-- =====================================================================

reset role;

alter table public.parametros add column if not exists nit_institucion text;
alter table public.parametros add column if not exists razon_social_institucion text;

update public.parametros
   set nit_institucion = coalesce(nit_institucion, '1020141023'),
       razon_social_institucion = coalesce(razon_social_institucion,
                                           'UNIVERSIDAD CATOLICA BOLIVIANA SAN PABLO')
 where id = 1;

-- Verificación
-- reset role;
-- select nit_institucion, razon_social_institucion from public.parametros where id = 1;
