-- =====================================================================
-- caja_chica · Migración 13 · Seguridad del flujo (solo base de datos)
-- No requiere cambios en el frontend. Las edge functions con
-- service_role (aprobaciones por WhatsApp/correo) quedan exentas porque
-- auth.uid() es NULL en ese contexto.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Permisos de funciones: nada ejecutable por anon; los triggers no
--    son RPC para nadie; los helpers de RLS solo para authenticated.
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;

revoke execute on function
  public.avisar_aval(), public.avisar_respuesta(), public.avisar_solicitud_nueva(),
  public.avisar_verificacion(), public.handle_new_user(),
  public.limpiar_devoluciones_hermanas(), public.marcar_desembolso(),
  public.proteger_cierre(), public.proteger_informe(), public.proteger_observacion(),
  public.proteger_rol(), public.validar_tope(), public.exigir_reporte_contable()
from authenticated;

grant execute on function
  public.es_admin(), public.es_operativo(), public.es_coordinador(), public.rol_actual(),
  public.coordinador_de(uuid), public.tiene_rendicion_vencida(uuid),
  public.periodo_vigente(), public.vencimiento_habil(timestamptz, integer)
to authenticated;

alter default privileges in schema public revoke execute on functions from public, anon;


-- ---------------------------------------------------------------------
-- 2. Guardia de solicitudes: columnas y transiciones permitidas por rol.
--    Nombre "00_" para que corra ANTES que marcar_desembolso y vea los
--    valores tal como los mandó el cliente.
-- ---------------------------------------------------------------------
create or replace function public.guardia_solicitud()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_rol      rol_usuario := public.rol_actual();
  v_cambios  text[];
  v_permit   text[];
begin
  -- Edge functions (service_role) y super_admin
  if v_uid is null or v_rol = 'super_admin' then
    return new;
  end if;

  select coalesce(array_agg(n.key), '{}')
    into v_cambios
    from jsonb_each(to_jsonb(new)) n
   where n.value is distinct from (to_jsonb(old) -> n.key);

  -- Campos que ningún cliente puede tocar: los fija el sistema
  if v_cambios && array['solicitante_id','periodo_id','coordinador_id','fecha_creacion',
                        'created_at','limite_tiempo_devolucion','fecha_cierre'] then
    raise exception 'Hay campos de la solicitud que solo el sistema puede modificar';
  end if;

  -- ── Operativos (DAF y administrador de caja) ─────────────────────────
  if v_rol in ('daf','admin_caja') then
    if new.estado is distinct from old.estado then
      if new.estado = 'aprobado_daf' and v_rol <> 'daf' then
        raise exception 'Solo el DAF puede aprobar una solicitud';
      end if;
      if new.estado = 'desembolsado' and v_rol <> 'admin_caja' then
        raise exception 'Solo el administrador de caja registra el desembolso';
      end if;
      if new.estado = 'aprobado_daf' then
        new.aprobado_por_id := v_uid;
      end if;
    end if;
    if 'monto_solicitado' = any(v_cambios)
       and old.estado not in ('pendiente_coordinador','pendiente_daf') then
      raise exception 'El monto solicitado no se puede cambiar después de la aprobación';
    end if;
    if new.monto_solicitado > (select tope_solicitud from parametros where id = 1) then
      raise exception 'El monto supera el tope vigente';
    end if;
    return new;
  end if;

  -- ── Coordinador dando su aval ───────────────────────────────────────
  if old.coordinador_id = v_uid and old.estado = 'pendiente_coordinador' then
    v_permit := array['estado','aval_coordinador','observacion_coordinador',
                      'fecha_aval_coordinador','origen_aval','motivo_rechazo','updated_at'];
    if not v_cambios <@ v_permit then
      raise exception 'El coordinador solo puede registrar su aval u observación';
    end if;
    if new.estado not in ('pendiente_coordinador','pendiente_daf','rechazado') then
      raise exception 'El coordinador solo puede avalar (pasa al DAF) o rechazar';
    end if;
    return new;
  end if;

  -- ── Solicitante rindiendo cuentas ───────────────────────────────────
  if old.solicitante_id = v_uid then
    v_permit := array['estado','monto_real','respuesta_solicitante',
                      'fecha_respuesta_solicitante','updated_at'];
    if not v_cambios <@ v_permit then
      raise exception 'Solo puedes registrar tu rendición (monto real y respuestas)';
    end if;
    if new.estado is distinct from old.estado and not (
         (old.estado = 'desembolsado'          and new.estado in ('pendiente_devolucion','pendiente_verificacion'))
      or (old.estado = 'pendiente_devolucion'  and new.estado = 'pendiente_verificacion')
      or (old.estado = 'pendiente_verificacion' and new.estado = 'pendiente_devolucion')
    ) then
      raise exception 'Transición de estado no permitida para el solicitante (% → %)', old.estado, new.estado;
    end if;
    return new;
  end if;

  raise exception 'No tienes permiso para modificar esta solicitud';
end;
$$;

revoke execute on function public.guardia_solicitud() from public, anon, authenticated;

drop trigger if exists solicitudes_00_guardia on public.solicitudes;
create trigger solicitudes_00_guardia
  before update on public.solicitudes
  for each row execute function public.guardia_solicitud();


-- ---------------------------------------------------------------------
-- 3. Informes de rendición: solo el DAF aprueba; montos congelados
--    tras el envío. Se conserva la regla existente de contabilidad.
-- ---------------------------------------------------------------------
create or replace function public.proteger_informe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rol rol_usuario := public.rol_actual();
  v_montos_cambian boolean :=
       new.total_desembolsado is distinct from old.total_desembolsado
    or new.total_devuelto     is distinct from old.total_devuelto
    or new.saldo_cuenta       is distinct from old.saldo_cuenta
    or new.monto_reposicion   is distinct from old.monto_reposicion
    or new.periodo_id         is distinct from old.periodo_id
    or new.admin_caja_id      is distinct from old.admin_caja_id;
begin
  new.updated_at := now();

  if v_uid is null or v_rol = 'super_admin' then
    return new;
  end if;

  if v_rol = 'contabilidad' then
    if old.estado <> 'aprobado_daf' or new.estado <> 'completado' then
      raise exception 'Contabilidad solo puede cerrar informes ya aprobados por el DAF';
    end if;
    if v_montos_cambian then
      raise exception 'Contabilidad no puede modificar los montos del informe';
    end if;
  end if;

  if new.estado is distinct from old.estado and new.estado = 'aprobado_daf' then
    if v_rol <> 'daf' then
      raise exception 'Solo el DAF puede aprobar un informe de rendición';
    end if;
    new.aprobado_por_id      := v_uid;
    new.fecha_aprobacion_daf := coalesce(new.fecha_aprobacion_daf, now());
  end if;

  if v_rol = 'daf' and v_montos_cambian then
    raise exception 'El DAF aprueba o rechaza, pero no modifica los montos del informe';
  end if;

  if old.estado <> 'borrador' and v_montos_cambian then
    raise exception 'Los montos del informe quedan congelados después de enviarlo al DAF';
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 4. Perfiles: el usuario no puede cambiarse de oficina (eso cambia su
--    coordinador), ni reactivarse, ni cambiar su email. Se permite
--    elegir oficina la primera vez (oficina_id vacío).
-- ---------------------------------------------------------------------
create or replace function public.proteger_rol()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if auth.uid() is null or public.rol_actual() = 'super_admin' then
    return new;
  end if;
  if new.role is distinct from old.role then
    raise exception 'Solo un super_admin puede cambiar el rol de un usuario';
  end if;
  if new.oficina_id is distinct from old.oficina_id and old.oficina_id is not null then
    raise exception 'El cambio de oficina lo hace un super_admin';
  end if;
  if new.activo is distinct from old.activo or new.email is distinct from old.email then
    raise exception 'El estado y el correo de la cuenta los gestiona un super_admin';
  end if;
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 5. Libro de movimientos: un movimiento aprobado ya no se edita
--    (solo se le puede asignar informe). Quien aprueba queda registrado.
-- ---------------------------------------------------------------------
create or replace function public.proteger_movimiento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.rol_actual() = 'super_admin' then
    return new;
  end if;
  if old.estado = 'aprobado' and (
        new.monto        is distinct from old.monto
     or new.tipo         is distinct from old.tipo
     or new.solicitud_id is distinct from old.solicitud_id
     or new.periodo_id   is distinct from old.periodo_id
     or new.estado       is distinct from old.estado
     or new.admin_caja_id is distinct from old.admin_caja_id) then
    raise exception 'Un movimiento aprobado no se modifica; registre un movimiento de ajuste';
  end if;
  if new.estado = 'aprobado' and old.estado is distinct from 'aprobado' then
    new.aprobado_por_id := auth.uid();
  end if;
  return new;
end;
$$;

revoke execute on function public.proteger_movimiento() from public, anon, authenticated;

drop trigger if exists movimientos_00_proteger on public.movimientos_caja;
create trigger movimientos_00_proteger
  before update on public.movimientos_caja
  for each row execute function public.proteger_movimiento();
