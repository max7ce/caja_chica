-- =====================================================================
-- MIGRACIÓN 11 — Reporte del sistema contable
--
-- Corrección del circuito: quien carga las facturas en el sistema
-- contable de la universidad es el administrador de caja, con su rol
-- especial en ese sistema, y lo hace ANTES de enviar el informe.
-- El reporte que genera ese sistema se adjunta al informe como respaldo
-- para que el DAF autorice la reposición.
--
-- Contabilidad ya no carga facturas: solo procesa la transferencia.
--
-- Va todo junto, en una sola ejecución.
-- =====================================================================

reset role;

alter table public.informe_rendicion_cuentas
  add column if not exists reporte_contable_url text;
alter table public.informe_rendicion_cuentas
  add column if not exists reporte_contable_nro text;
alter table public.informe_rendicion_cuentas
  add column if not exists reporte_contable_fecha timestamptz;

-- ---------------------------------------------------------------------
-- El informe no puede llegar al DAF sin el respaldo contable.
--
-- Va como restricción de la base y no solo de la interfaz: es el
-- requisito que justifica la autorización de la reposición.
-- ---------------------------------------------------------------------
create or replace function public.exigir_reporte_contable()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.estado = 'pendiente_daf' and old.estado = 'borrador'
     and coalesce(new.reporte_contable_url, '') = '' then
    raise exception 'Antes de enviar al DAF hay que cargar las facturas en el sistema contable y adjuntar su reporte';
  end if;
  return new;
end;
$$;

drop trigger if exists informes_exigir_reporte on public.informe_rendicion_cuentas;
create trigger informes_exigir_reporte
  before update on public.informe_rendicion_cuentas
  for each row execute function public.exigir_reporte_contable();

-- Verificación
-- reset role;
-- select estado, reporte_contable_nro, reporte_contable_url is not null as tiene_respaldo
--   from public.informe_rendicion_cuentas order by fecha_creacion desc;
