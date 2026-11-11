-- =====================================================================
-- caja_chica · Migración 20 · Ciclo de reposición
--
--   1. Con saldo ≤ umbral (700 Bs) el administrador de caja arma UN
--      informe con todas las solicitudes rendidas. Un solo informe en
--      curso a la vez.
--   2. El DAF lo aprueba.
--   3. El administrador de caja hace el pedido de reposición (paso
--      obligatorio, manual).
--   4. Contabilidad transfiere y confirma.
--
-- La reposición es el gasto neto rendido (desembolsado − devuelto) y la
-- calcula la base: nadie la escribe a mano.
--
-- Aplicada en dos pasos (historial: ciclo_reposicion_estado y
-- ciclo_reposicion_reglas) porque un valor nuevo de enum no puede usarse
-- en la misma transacción en que se crea.
-- =====================================================================

-- ============================ Paso 1 ==================================
alter type public.estado_informe add value if not exists 'reposicion_solicitada' after 'aprobado_daf';

alter table public.informe_rendicion_cuentas
  add column if not exists fecha_pedido_reposicion timestamptz,
  add column if not exists pedido_reposicion_por_id uuid references public.profiles(id);
create index if not exists idx_inf_pedido_por on public.informe_rendicion_cuentas (pedido_reposicion_por_id);


-- ============================ Paso 2 ==================================

-- Saldo del período vigente (lo mismo que muestra la app)
create or replace function public.saldo_vigente()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select saldo from public.v_saldo_caja where periodo_id = public.periodo_vigente()), 0);
$$;
revoke execute on function public.saldo_vigente() from public, anon;
grant execute on function public.saldo_vigente() to authenticated;

-- Un informe "en curso" es cualquiera que no terminó ni fue rechazado
create or replace function public.informe_en_curso(p_excepto uuid default null)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.informe_rendicion_cuentas
   where estado in ('borrador','pendiente_daf','aprobado_daf','reposicion_solicitada')
     and id is distinct from p_excepto
   limit 1;
$$;
revoke execute on function public.informe_en_curso(uuid) from public, anon;
grant execute on function public.informe_en_curso(uuid) to authenticated;

-- ---------- 2.1 Una solicitud puede volver a rendirse si su informe fue rechazado
alter table public.informe_solicitudes drop constraint if exists informe_solicitudes_solicitud_id_key;
create index if not exists idx_infsol_solicitud on public.informe_solicitudes (solicitud_id);

create or replace function public.exigir_solicitud_cerrada()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (
    select 1 from public.solicitudes s
     where s.id = new.solicitud_id
       and s.estado = 'completado'
       and s.conforme_fisica is true
       and s.firma_superior is true
  ) then
    raise exception 'Solo entran al informe las solicitudes con la documentación física recibida, firmada y conforme';
  end if;
  if exists (
    select 1 from public.informe_solicitudes x
      join public.informe_rendicion_cuentas i on i.id = x.informe_id
     where x.solicitud_id = new.solicitud_id
       and x.id is distinct from new.id
       and i.estado <> 'rechazado'
  ) then
    raise exception 'Esa solicitud ya está en otro informe de rendición';
  end if;
  if (select estado from public.informe_rendicion_cuentas where id = new.informe_id) <> 'borrador' then
    raise exception 'Solo se pueden agregar solicitudes a un informe en borrador';
  end if;
  return new;
end; $$;

-- ---------- 2.2 Totales calculados por la base
create or replace function public.calcular_totales_informe(p_informe uuid,
  out desembolsado numeric, out devuelto numeric, out inicio timestamptz, out fin timestamptz)
language sql stable security definer set search_path = public as $$
  select coalesce(sum(s.monto_solicitado), 0),
         coalesce(sum(greatest(s.monto_solicitado - coalesce(s.monto_real, s.monto_solicitado), 0)), 0),
         min(s.fecha_creacion), max(s.fecha_creacion)
    from public.informe_solicitudes x join public.solicitudes s on s.id = x.solicitud_id
   where x.informe_id = p_informe;
$$;
revoke execute on function public.calcular_totales_informe(uuid) from public, anon, authenticated;

-- Al crear: solo con saldo ≤ umbral y sin otro informe en curso
create or replace function public.guardia_informe_nuevo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_umbral numeric := (select umbral_reposicion from public.parametros where id = 1);
  v_saldo  numeric := public.saldo_vigente();
begin
  if public.informe_en_curso() is not null then
    raise exception 'Ya hay un informe de rendición en curso. Hay que cerrarlo (reposición confirmada) antes de armar otro.';
  end if;
  if auth.uid() is not null and v_saldo > v_umbral then
    raise exception 'Solo se arma el informe cuando el saldo llega a % Bs o menos. Saldo actual: % Bs.', v_umbral, v_saldo;
  end if;
  new.estado := 'borrador';
  new.total_desembolsado := 0;
  new.total_devuelto := 0;
  new.monto_reposicion := 0;
  return new;
end; $$;
revoke execute on function public.guardia_informe_nuevo() from public, anon, authenticated;

drop trigger if exists informes_00_nuevo on public.informe_rendicion_cuentas;
create trigger informes_00_nuevo
  before insert on public.informe_rendicion_cuentas
  for each row execute function public.guardia_informe_nuevo();

-- En borrador los montos siempre se recalculan desde las solicitudes;
-- al enviarlo al DAF quedan congelados (proteger_informe).
create or replace function public.fijar_montos_informe()
returns trigger language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if old.estado = 'borrador' then
    select * into t from public.calcular_totales_informe(new.id);
    new.total_desembolsado   := t.desembolsado;
    new.total_devuelto       := t.devuelto;
    new.monto_reposicion     := t.desembolsado - t.devuelto;
    new.fecha_inicio_periodo := t.inicio;
    new.fecha_fin_periodo    := t.fin;

    if new.estado = 'pendiente_daf' then
      if not exists (select 1 from public.informe_solicitudes where informe_id = new.id) then
        raise exception 'El informe no tiene solicitudes';
      end if;
      -- Un informe por ciclo: no puede quedar afuera ninguna solicitud ya rendida
      if exists (
        select 1 from public.solicitudes s
         where s.estado = 'completado' and s.conforme_fisica is true and s.firma_superior is true
           and not exists (
             select 1 from public.informe_solicitudes x
               join public.informe_rendicion_cuentas i on i.id = x.informe_id
              where x.solicitud_id = s.id and i.estado <> 'rechazado')
      ) then
        raise exception 'Hay solicitudes rendidas que no están en el informe. El informe del ciclo debe incluirlas todas.';
      end if;
    end if;
  end if;
  return new;
end; $$;
revoke execute on function public.fijar_montos_informe() from public, anon, authenticated;

drop trigger if exists informes_00_montos on public.informe_rendicion_cuentas;
create trigger informes_00_montos
  before update on public.informe_rendicion_cuentas
  for each row execute function public.fijar_montos_informe();

-- Al agregar o quitar solicitudes, el borrador se recalcula solo
create or replace function public.recalcular_informe_por_detalle()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.informe_rendicion_cuentas set updated_at = now()
   where id = coalesce(new.informe_id, old.informe_id) and estado = 'borrador';
  return null;
end; $$;
revoke execute on function public.recalcular_informe_por_detalle() from public, anon, authenticated;

drop trigger if exists informe_solicitudes_recalcular on public.informe_solicitudes;
create trigger informe_solicitudes_recalcular
  after insert or delete on public.informe_solicitudes
  for each row execute function public.recalcular_informe_por_detalle();

-- ---------- 2.3 Quién mueve el informe a cada estado
create or replace function public.proteger_informe()
returns trigger language plpgsql security definer set search_path = public as $$
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
  if old.estado <> 'borrador' and v_montos_cambian and v_uid is not null and v_rol <> 'super_admin' then
    raise exception 'Los montos del informe quedan congelados después de enviarlo al DAF';
  end if;

  if new.estado is not distinct from old.estado then
    if v_uid is not null and v_rol not in ('super_admin','admin_caja') then
      raise exception 'No tienes permiso para modificar este informe';
    end if;
    return new;
  end if;

  -- Transiciones permitidas
  if not (
       (old.estado = 'borrador'              and new.estado = 'pendiente_daf')
    or (old.estado = 'pendiente_daf'         and new.estado in ('aprobado_daf','rechazado'))
    or (old.estado = 'aprobado_daf'          and new.estado = 'reposicion_solicitada')
    or (old.estado = 'reposicion_solicitada' and new.estado = 'completado')
  ) and v_uid is not null then
    raise exception 'Cambio de estado no permitido (% → %)', old.estado, new.estado;
  end if;

  if v_uid is null or v_rol = 'super_admin' then
    null;  -- mantenimiento y super_admin: solo se valida la secuencia de estados
  elsif new.estado = 'pendiente_daf' and v_rol <> 'admin_caja' then
    raise exception 'Solo el administrador de caja envía el informe al DAF';
  elsif new.estado in ('aprobado_daf','rechazado') and v_rol <> 'daf' then
    raise exception 'Solo el DAF aprueba o rechaza un informe de rendición';
  elsif new.estado = 'reposicion_solicitada' and v_rol <> 'admin_caja' then
    raise exception 'El pedido de reposición lo hace el administrador de caja';
  elsif new.estado = 'completado' and v_rol <> 'contabilidad' then
    raise exception 'La reposición la confirma contabilidad';
  end if;

  if new.estado in ('aprobado_daf','rechazado') then
    new.aprobado_por_id      := coalesce(v_uid, new.aprobado_por_id);
    new.fecha_aprobacion_daf := coalesce(new.fecha_aprobacion_daf, now());
  end if;
  if new.estado = 'reposicion_solicitada' then
    new.pedido_reposicion_por_id := coalesce(v_uid, new.pedido_reposicion_por_id);
    new.fecha_pedido_reposicion  := now();
  end if;
  if new.estado = 'completado' and not exists (
    select 1 from public.movimientos_caja m
     where m.informe_id = new.id and m.tipo = 'reposicion' and m.monto = new.monto_reposicion
  ) then
    raise exception 'Primero hay que registrar la transferencia de la reposición';
  end if;
  return new;
end; $$;

-- ---------- 2.4 El movimiento de reposición: solo contabilidad, solo sobre un pedido, monto exacto
create or replace function public.guardia_reposicion()
returns trigger language plpgsql security definer set search_path = public as $$
declare i record;
begin
  if new.tipo <> 'reposicion' then return new; end if;
  if auth.uid() is not null and public.rol_actual() not in ('contabilidad','super_admin') then
    raise exception 'La reposición la registra contabilidad';
  end if;
  select * into i from public.informe_rendicion_cuentas where id = new.informe_id;
  if i.id is null or i.estado <> 'reposicion_solicitada' then
    raise exception 'Solo se registra una reposición sobre un informe con pedido de reposición';
  end if;
  if new.monto <> i.monto_reposicion then
    raise exception 'La reposición debe ser exactamente % Bs', i.monto_reposicion;
  end if;
  if exists (select 1 from public.movimientos_caja where informe_id = i.id and tipo = 'reposicion') then
    raise exception 'Este informe ya tiene su reposición registrada';
  end if;
  new.admin_caja_id := i.admin_caja_id;
  new.periodo_id    := coalesce(new.periodo_id, i.periodo_id, public.periodo_vigente());
  return new;
end; $$;
revoke execute on function public.guardia_reposicion() from public, anon, authenticated;

drop trigger if exists movimientos_00_reposicion on public.movimientos_caja;
create trigger movimientos_00_reposicion
  before insert on public.movimientos_caja
  for each row execute function public.guardia_reposicion();
