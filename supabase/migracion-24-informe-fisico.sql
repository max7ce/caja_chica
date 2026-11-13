-- =====================================================================
-- caja_chica · Migración 24 · Informe del ciclo en papel, con firmas
--
-- El informe se imprime con número correlativo, carátula y detalle; lo
-- firma el administrador de caja y se presenta al DAF. El DAF lo firma y
-- lo envía a Rectorado; cuando vuelve firmado por Rectorado, el DAF sube
-- el escaneo y recién entonces da el OK (aprobado_daf) para que el
-- administrador pida la reposición.
-- =====================================================================

alter table public.informe_rendicion_cuentas
  add column if not exists gestion               int,
  add column if not exists numero                int,
  add column if not exists firma_admin_fisica    boolean,
  add column if not exists fecha_recepcion_daf   timestamptz,
  add column if not exists fecha_firma_daf       timestamptz,
  add column if not exists fecha_firma_rectorado timestamptz,
  add column if not exists informe_firmado_url   text,
  add column if not exists motivo_rechazo        text;

-- Numeración de los informes ya existentes, por año y en orden de creación
with n as (
  select id,
         extract(year from created_at at time zone 'America/La_Paz')::int as g,
         row_number() over (partition by extract(year from created_at at time zone 'America/La_Paz')
                            order by created_at) as k
    from public.informe_rendicion_cuentas
   where numero is null
)
update public.informe_rendicion_cuentas i set gestion = n.g, numero = n.k from n where i.id = n.id;

create unique index if not exists idx_informe_numero on public.informe_rendicion_cuentas (gestion, numero);

-- ---------- Al crear: además de las reglas del ciclo, el número correlativo
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

  perform pg_advisory_xact_lock(hashtext('numero_informe'));
  new.gestion := extract(year from now() at time zone 'America/La_Paz')::int;
  new.numero  := coalesce((select max(numero) from public.informe_rendicion_cuentas where gestion = new.gestion), 0) + 1;
  return new;
end; $$;

-- ---------- Quién mueve el informe y qué firmas exige el OK del DAF
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
    or new.admin_caja_id      is distinct from old.admin_caja_id
    or new.numero             is distinct from old.numero
    or new.gestion            is distinct from old.gestion;
  v_firmas_cambian boolean :=
       new.firma_admin_fisica    is distinct from old.firma_admin_fisica
    or new.fecha_recepcion_daf   is distinct from old.fecha_recepcion_daf
    or new.fecha_firma_daf       is distinct from old.fecha_firma_daf
    or new.fecha_firma_rectorado is distinct from old.fecha_firma_rectorado
    or new.informe_firmado_url   is distinct from old.informe_firmado_url
    or new.motivo_rechazo        is distinct from old.motivo_rechazo;
begin
  new.updated_at := now();
  if old.estado <> 'borrador' and v_montos_cambian and v_uid is not null and v_rol <> 'super_admin' then
    raise exception 'Los montos del informe quedan congelados después de enviarlo al DAF';
  end if;

  -- Firmas físicas: las registra el DAF mientras el informe está en su poder
  if v_firmas_cambian and v_uid is not null and v_rol <> 'super_admin' then
    if v_rol <> 'daf' then
      raise exception 'Las firmas del informe las registra el DAF';
    end if;
    if old.estado <> 'pendiente_daf' then
      raise exception 'Las firmas se registran mientras el informe está en revisión del DAF';
    end if;
  end if;
  if new.fecha_firma_daf is not null and old.fecha_firma_daf is null then
    if new.firma_admin_fisica is not true then
      raise exception 'Antes de firmar, el DAF debe recibir el informe impreso con la firma del administrador de caja';
    end if;
    new.fecha_recepcion_daf := coalesce(new.fecha_recepcion_daf, now());
  end if;
  if new.fecha_firma_rectorado is not null and new.fecha_firma_daf is null then
    raise exception 'Rectorado firma después del DAF';
  end if;

  if new.estado is not distinct from old.estado then
    if v_uid is not null and v_rol not in ('super_admin','admin_caja','daf') then
      raise exception 'No tienes permiso para modificar este informe';
    end if;
    if v_uid is not null and v_rol = 'daf' and not v_firmas_cambian then
      raise exception 'El DAF solo registra las firmas o resuelve el informe';
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
    null;
  elsif new.estado = 'pendiente_daf' and v_rol <> 'admin_caja' then
    raise exception 'Solo el administrador de caja envía el informe al DAF';
  elsif new.estado in ('aprobado_daf','rechazado') and v_rol <> 'daf' then
    raise exception 'Solo el DAF aprueba o rechaza un informe de rendición';
  elsif new.estado = 'reposicion_solicitada' and v_rol <> 'admin_caja' then
    raise exception 'El pedido de reposición lo hace el administrador de caja';
  elsif new.estado = 'completado' and v_rol <> 'contabilidad' then
    raise exception 'La reposición la confirma contabilidad';
  end if;

  -- El OK del DAF exige el papel firmado por los tres y su escaneo
  if new.estado = 'aprobado_daf' and v_uid is not null then
    if new.firma_admin_fisica is not true or new.fecha_firma_daf is null or new.fecha_firma_rectorado is null then
      raise exception 'El OK exige el informe impreso firmado por el administrador de caja, el DAF y Rectorado';
    end if;
    if coalesce(new.informe_firmado_url, '') = '' then
      raise exception 'Falta subir el escaneo del informe con las tres firmas';
    end if;
  end if;
  if new.estado = 'rechazado' and v_uid is not null and coalesce(trim(new.motivo_rechazo), '') = '' then
    raise exception 'Para rechazar el informe hay que indicar el motivo';
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

-- ---------- Aviso al administrador cuando el informe pasa a Rectorado
create or replace function public.avisar_informe()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_vars jsonb := jsonb_build_object('informe', new.id, 'monto', new.monto_reposicion,
                                            'numero', new.numero, 'gestion', new.gestion);
begin
  if new.fecha_firma_daf is not null and old.fecha_firma_daf is null then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    values ('informe_en_rectorado', 'ambos', new.admin_caja_id, 'informe', new.id, v_vars);
  end if;

  if new.estado is not distinct from old.estado then return new; end if;
  if new.estado = 'pendiente_daf' then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    select 'informe_enviado', 'ambos', p.id, 'informe', new.id, v_vars
      from public.profiles p where p.role = 'daf' and p.activo;
  elsif new.estado in ('aprobado_daf', 'rechazado') then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    values ('informe_aprobado', 'ambos', new.admin_caja_id, 'informe', new.id,
            v_vars || jsonb_build_object('estado', case when new.estado = 'aprobado_daf' then 'aprobado' else 'rechazado' end,
                                         'motivo', coalesce(new.motivo_rechazo, '')));
  elsif new.estado = 'reposicion_solicitada' then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    select 'reposicion_por_procesar', 'ambos', p.id, 'informe', new.id, v_vars
      from public.profiles p where p.role = 'contabilidad' and p.activo;
  elsif new.estado = 'completado' then
    insert into public.notificaciones (plantilla, canal, destinatario_id, recurso_tipo, recurso_id, variables)
    values ('reposicion_hecha', 'ambos', new.admin_caja_id, 'informe', new.id, v_vars);
  end if;
  return new;
end; $$;
