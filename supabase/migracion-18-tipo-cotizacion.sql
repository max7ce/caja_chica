-- =====================================================================
-- caja_chica · Migración 18 · La cotización deja de figurar como compra
-- Aplicada en dos pasos (historial: tipo_cotizacion, cotizaciones_existentes)
-- porque un valor nuevo de enum no puede usarse en la misma transacción.
-- =====================================================================

-- Paso 1
alter type public.tipo_comprobante add value if not exists 'cotizacion' before 'devolucion';

-- Paso 2
update public.comprobantes set tipo = 'cotizacion'
 where tipo = 'compra' and descripcion = 'Respaldo inicial';

-- Cubre a quien todavía tenga en caché la versión anterior de la app.
create or replace function public.normalizar_cotizacion()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.tipo = 'compra' and new.descripcion = 'Respaldo inicial' then
    new.tipo := 'cotizacion';
  end if;
  return new;
end; $$;
revoke execute on function public.normalizar_cotizacion() from public, anon, authenticated;

drop trigger if exists comprobantes_normalizar_cotizacion on public.comprobantes;
create trigger comprobantes_normalizar_cotizacion
  before insert on public.comprobantes
  for each row execute function public.normalizar_cotizacion();
