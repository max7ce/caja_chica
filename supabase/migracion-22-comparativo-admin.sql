-- =====================================================================
-- caja_chica · Migración 22 · Comparativo por administrador
--   · "monto_rendido" pasa a ser el gasto neto (la reposición), no lo desembolsado.
--   · Los informes rechazados no suman monto ni días de aprobación.
--   · "Abiertos" incluye los que esperan el pedido o la transferencia.
-- Mismas columnas que antes, para no romper la pantalla.
-- =====================================================================
create or replace view public.v_rendiciones_por_admin with (security_invoker = on) as
with inf as (
  select periodo_id,
         count(*) filter (where estado <> 'borrador') as informes,
         coalesce(sum(monto_reposicion) filter (where estado not in ('borrador','rechazado')), 0) as monto_rendido,
         round(avg(extract(epoch from fecha_aprobacion_daf - fecha_envio_daf) / 86400)
               filter (where estado not in ('borrador','rechazado','pendiente_daf')
                         and fecha_aprobacion_daf is not null and fecha_envio_daf is not null), 1) as dias_aprobacion,
         count(*) filter (where estado in ('borrador','pendiente_daf','aprobado_daf','reposicion_solicitada')) as informes_abiertos
    from public.informe_rendicion_cuentas
   group by periodo_id
), sol as (
  select periodo_id,
         count(*) as solicitudes,
         round(100.0 * count(*) filter (where fecha_rendicion is not null and fecha_rendicion <= limite_tiempo_devolucion)
               / nullif(count(*) filter (where limite_tiempo_devolucion is not null), 0), 0) as pct_en_plazo
    from public.solicitudes
   group by periodo_id
)
select pg.id as periodo_id,
       pg.admin_caja_id,
       pr.full_name as admin_nombre,
       pg.etiqueta as periodo,
       pg.estado as estado_periodo,
       coalesce(inf.informes, 0::bigint) as informes,
       coalesce(inf.monto_rendido, 0)::numeric(12,2) as monto_rendido,
       inf.dias_aprobacion,
       coalesce(inf.informes_abiertos, 0::bigint) as informes_abiertos,
       coalesce(sol.solicitudes, 0::bigint) as solicitudes,
       sol.pct_en_plazo
  from public.periodos_gestion pg
  join public.profiles pr on pr.id = pg.admin_caja_id
  left join inf on inf.periodo_id = pg.id
  left join sol on sol.periodo_id = pg.id
 order by pg.fecha_inicio desc;

-- La vista respeta el RLS de quien consulta; los anónimos no tienen nada que ver aquí.
revoke all on public.v_rendiciones_por_admin from anon;
