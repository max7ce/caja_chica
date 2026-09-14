-- =====================================================================
-- MIGRACIÓN 05 — Contabilidad procesa la reposición
--
-- Antes, tras la aprobación del DAF, el mismo administrador de caja
-- registraba la reposición. Ahora el circuito termina en contabilidad:
-- ellos transfieren al QR del administrador y registran el ingreso.
--
-- Contabilidad deja de ser un rol de solo lectura, pero solo puede hacer
-- una cosa: cerrar un informe ya aprobado por el DAF. El trigger del
-- §3 es lo que impide que toque cualquier otra cosa del informe.
--
-- Va todo junto, en una sola ejecución.
-- =====================================================================

reset role;

-- ---------------------------------------------------------------------
-- §1. Contabilidad puede actualizar informes
-- ---------------------------------------------------------------------
drop policy if exists informes_update on public.informe_rendicion_cuentas;
create policy informes_update on public.informe_rendicion_cuentas
  for update to authenticated
  using (public.rol_actual() in ('admin_caja','daf','super_admin','contabilidad'))
  with check (public.rol_actual() in ('admin_caja','daf','super_admin','contabilidad'));

-- ---------------------------------------------------------------------
-- §2. Contabilidad puede registrar la reposición, y solo eso
-- ---------------------------------------------------------------------
drop policy if exists movimientos_insert on public.movimientos_caja;
create policy movimientos_insert on public.movimientos_caja
  for insert to authenticated
  with check (
    public.rol_actual() in ('admin_caja','super_admin')
    or (tipo = 'reposicion' and public.rol_actual() = 'contabilidad')
    or (tipo = 'devolucion' and estado = 'pendiente_validacion'
        and exists (select 1 from public.solicitudes s
                    where s.id = solicitud_id and s.solicitante_id = auth.uid()))
  );

-- ---------------------------------------------------------------------
-- §3. Límite real de lo que contabilidad puede cambiar
--
-- La política del §1 deja actualizar la fila completa. Este trigger
-- acota el permiso a la única transición que les corresponde:
-- aprobado_daf -> completado. Cualquier otro cambio se rechaza.
-- ---------------------------------------------------------------------
create or replace function public.proteger_informe()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.rol_actual() = 'contabilidad' then
    if old.estado <> 'aprobado_daf' or new.estado <> 'completado' then
      raise exception 'Contabilidad solo puede cerrar informes ya aprobados por el DAF';
    end if;
    if new.total_desembolsado is distinct from old.total_desembolsado
       or new.monto_reposicion is distinct from old.monto_reposicion
       or new.periodo_id is distinct from old.periodo_id then
      raise exception 'Contabilidad no puede modificar los montos del informe';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists informes_proteger on public.informe_rendicion_cuentas;
create trigger informes_proteger
  before update on public.informe_rendicion_cuentas
  for each row execute function public.proteger_informe();

-- ---------------------------------------------------------------------
-- §4. Verificación
-- ---------------------------------------------------------------------
-- reset role;
-- select full_name, email from public.profiles where role = 'contabilidad';
--
-- El administrador de caja de la gestión vigente debe tener QR cargado:
-- select p.full_name, p.qr_url
--   from public.periodos_gestion g
--   join public.profiles p on p.id = g.admin_caja_id
--  where g.estado = 'vigente';
