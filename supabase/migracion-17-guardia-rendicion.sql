-- =====================================================================
-- caja_chica · Migración 17 · Corrige la guardia del solicitante
-- La migración 13 bloqueaba dos acciones legítimas del solicitante:
--   · Guardar rendición: la app envía fecha_rendicion.
--   · Responder una observación: la app limpia conforme_fisica (→ null).
-- Ahora se permiten, con dos reglas nuevas:
--   · conforme_fisica solo puede volver a null (el cotejo lo hace admin_caja).
--   · monto_real solo se declara mientras la solicitud está desembolsada.
-- =====================================================================
create or replace function public.guardia_solicitud()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_rol rol_usuario := public.rol_actual();
  v_cambios text[];
  v_permit text[];
begin
  if v_uid is null or v_rol = 'super_admin' then return new; end if;
  select coalesce(array_agg(n.key), '{}') into v_cambios
    from jsonb_each(to_jsonb(new)) n where n.value is distinct from (to_jsonb(old) -> n.key);
  if v_cambios && array['solicitante_id','periodo_id','coordinador_id','fecha_creacion','created_at','limite_tiempo_devolucion','fecha_cierre'] then
    raise exception 'Hay campos de la solicitud que solo el sistema puede modificar';
  end if;

  -- Operativos (DAF y administrador de caja)
  if v_rol in ('daf','admin_caja') then
    if new.estado is distinct from old.estado then
      if new.estado = 'aprobado_daf' and v_rol <> 'daf' then raise exception 'Solo el DAF puede aprobar una solicitud'; end if;
      if new.estado = 'desembolsado' and v_rol <> 'admin_caja' then raise exception 'Solo el administrador de caja registra el desembolso'; end if;
      if new.estado = 'aprobado_daf' then new.aprobado_por_id := v_uid; end if;
    end if;
    if 'monto_solicitado' = any(v_cambios) and old.estado not in ('pendiente_coordinador','pendiente_daf') then
      raise exception 'El monto solicitado no se puede cambiar después de la aprobación';
    end if;
    if new.monto_solicitado > (select tope_solicitud from parametros where id = 1) then raise exception 'El monto supera el tope vigente'; end if;
    return new;
  end if;

  -- Coordinador dando su aval
  if old.coordinador_id = v_uid and old.estado = 'pendiente_coordinador' then
    v_permit := array['estado','aval_coordinador','observacion_coordinador','fecha_aval_coordinador','origen_aval','motivo_rechazo','updated_at'];
    if not v_cambios <@ v_permit then raise exception 'El coordinador solo puede registrar su aval u observación'; end if;
    if new.estado not in ('pendiente_coordinador','pendiente_daf','rechazado') then raise exception 'El coordinador solo puede avalar (pasa al DAF) o rechazar'; end if;
    return new;
  end if;

  -- Solicitante rindiendo cuentas o respondiendo una observación
  if old.solicitante_id = v_uid then
    v_permit := array['estado','monto_real','fecha_rendicion','respuesta_solicitante',
                      'fecha_respuesta_solicitante','conforme_fisica','updated_at'];
    if not v_cambios <@ v_permit then
      raise exception 'Solo puedes registrar tu rendición (monto real y respuestas)';
    end if;
    if 'conforme_fisica' = any(v_cambios) and new.conforme_fisica is not null then
      raise exception 'El cotejo de la documentación física lo registra el administrador de caja';
    end if;
    if 'monto_real' = any(v_cambios) and old.estado <> 'desembolsado' then
      raise exception 'El gasto real ya fue declarado; para corregirlo habla con el administrador de caja';
    end if;
    if new.estado is distinct from old.estado and not (
         (old.estado = 'desembolsado'           and new.estado in ('pendiente_devolucion','pendiente_verificacion'))
      or (old.estado = 'pendiente_devolucion'   and new.estado = 'pendiente_verificacion')
      or (old.estado = 'pendiente_verificacion' and new.estado = 'pendiente_devolucion')) then
      raise exception 'Transición de estado no permitida para el solicitante (% → %)', old.estado, new.estado;
    end if;
    return new;
  end if;

  raise exception 'No tienes permiso para modificar esta solicitud';
end; $$;
revoke execute on function public.guardia_solicitud() from public, anon, authenticated;
