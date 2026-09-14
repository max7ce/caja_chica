-- =====================================================================
-- PARCHE 02b — El coordinador que también es DAF no avala dos veces
--
-- Solo hace falta si YA ejecutaste la migración 02. Si todavía no lo
-- hiciste, usá el archivo migracion-02-coordinadores.sql, que ya lo trae.
--
-- Se puede ejecutar todo junto, sin partirlo.
-- =====================================================================

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

-- Verificación: para cada persona, quién le avalaría hoy.
-- La oficina DAF debe aparecer con "(va directo al DAF)".
--
-- select p.full_name, o.nombre as oficina,
--        coalesce(c.full_name, '(va directo al DAF)') as avala
--   from public.profiles p
--   left join public.oficinas o on o.id = p.oficina_id
--   left join public.profiles c on c.id = public.coordinador_de(p.id)
--  where p.activo
--  order by o.nombre, p.full_name;
