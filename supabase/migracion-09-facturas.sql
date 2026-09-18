-- =====================================================================
-- MIGRACIÓN 09 — Datos fiscales de las facturas
--
-- Contabilidad carga cada factura a mano en su sistema: NIT del vendedor,
-- número, fecha, monto y código de autorización. Todos esos datos ya
-- están en el QR de la factura, salvo el monto.
--
-- Una solicitud puede tener varias facturas, por eso es tabla aparte.
--
-- Va todo junto, en una sola ejecución.
-- =====================================================================

reset role;

create table if not exists public.facturas (
  id             uuid primary key default gen_random_uuid(),
  solicitud_id   uuid not null references public.solicitudes(id) on delete cascade,
  comprobante_id uuid references public.comprobantes(id) on delete set null,

  nit_vendedor   text,
  razon_social   text,
  nro_factura    text,
  autorizacion   text,                  -- CUF en facturación en línea
  fecha_emision  timestamptz,
  monto          numeric(10,2) not null check (monto >= 0),

  -- Verificado por quien coteja el papel: la factura debe estar emitida
  -- a nombre de la universidad para servir como crédito fiscal.
  emitida_a_ucb  boolean,

  origen         text not null default 'manual',   -- qr | manual
  qr_crudo       text,
  cargado_por_id uuid not null references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now()
);

create index if not exists idx_facturas_solicitud on public.facturas(solicitud_id);

-- Una misma factura no puede rendirse dos veces en el sistema.
create unique index if not exists idx_factura_unica
  on public.facturas (nit_vendedor, nro_factura)
  where nit_vendedor is not null and nro_factura is not null;

alter table public.facturas enable row level security;

drop policy if exists facturas_select on public.facturas;
create policy facturas_select on public.facturas for select to authenticated
  using (
    public.es_admin()
    or exists (select 1 from public.solicitudes s
               where s.id = facturas.solicitud_id and s.solicitante_id = auth.uid())
  );

drop policy if exists facturas_insert on public.facturas;
create policy facturas_insert on public.facturas for insert to authenticated
  with check (
    exists (select 1 from public.solicitudes s
            where s.id = solicitud_id and s.solicitante_id = auth.uid())
    or public.rol_actual() in ('admin_caja','super_admin')
  );

drop policy if exists facturas_update on public.facturas;
create policy facturas_update on public.facturas for update to authenticated
  using (
    public.rol_actual() in ('admin_caja','super_admin')
    or exists (select 1 from public.solicitudes s
               where s.id = facturas.solicitud_id
                 and s.solicitante_id = auth.uid()
                 and s.estado in ('desembolsado','pendiente_devolucion','pendiente_verificacion'))
  );

drop policy if exists facturas_delete on public.facturas;
create policy facturas_delete on public.facturas for delete to authenticated
  using (
    public.rol_actual() in ('admin_caja','super_admin')
    or exists (select 1 from public.solicitudes s
               where s.id = facturas.solicitud_id
                 and s.solicitante_id = auth.uid()
                 and s.estado in ('desembolsado','pendiente_devolucion'))
  );

-- Verificación
-- reset role;
-- select f.nit_vendedor, f.nro_factura, f.fecha_emision, f.monto, f.origen
--   from public.facturas f order by f.created_at desc limit 20;
